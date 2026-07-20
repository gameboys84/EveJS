/**
 * PERSISTENCE WORKER (main-thread handle):
 *
 * Routes SQLite flush writes to an off-loop worker_thread so the synchronous
 * better-sqlite3 transaction does not stall the simulation loop.
 *
 * Shutdown is deliberately lossless. A worker write has an operation ID, its
 * original upserts/deletes remain recoverable until success is acknowledged,
 * and close waits for the specific "closed" message rather than whichever
 * worker message happens to be dispatched first.
 */

"use strict";

const path = require("path");
const { Worker } = require("worker_threads");
const sqliteStore = require("./sqliteStore");

const WORKER_PATH = path.join(__dirname, "persistenceWorker.worker.js");
const DRAIN_TIMEOUT_MS = 10000;
const CLOSE_TIMEOUT_MS = 1000;
const PENDING_WRITE_INDEX = 0;
const FAILED_WRITE_INDEX = 1;
const SHARED_COUNTER_SLOTS = 2;

function errorMessage(error, fallback) {
  if (error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (error !== undefined && error !== null) {
    const rendered = String(error);
    if (rendered.length > 0) {
      return rendered;
    }
  }
  return fallback;
}

function timeoutValue(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function copyUpserts(upserts) {
  if (!Array.isArray(upserts)) {
    return [];
  }
  return upserts.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      throw new TypeError("persistence upserts must be [key, json] pairs");
    }
    return [String(entry[0]), String(entry[1])];
  });
}

function copyDeletes(deletes) {
  return Array.isArray(deletes) ? deletes.map((key) => String(key)) : [];
}

function normalizeOperationId(operationId) {
  if (!Number.isSafeInteger(operationId) || operationId <= 0) {
    const error = new TypeError(
      "persistence operationId must be a positive safe integer",
    );
    error.code = "PERSISTENCE_OPERATION_ID_INVALID";
    throw error;
  }
  return operationId;
}

function copyOperation(operation) {
  if (!operation) {
    return null;
  }
  return {
    operationId: normalizeOperationId(operation.operationId),
    table: String(operation.table),
    upserts: copyUpserts(operation.upserts),
    deletes: copyDeletes(operation.deletes),
    state: operation.state || "pending",
    createdAt:
      operation.createdAt === undefined ? null : operation.createdAt,
    appliedAt:
      operation.appliedAt === undefined ? null : operation.appliedAt,
  };
}

function batchesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (Array.isArray(leftEntry) || Array.isArray(rightEntry)) {
      if (
        !Array.isArray(leftEntry) ||
        !Array.isArray(rightEntry) ||
        leftEntry.length !== rightEntry.length
      ) {
        return false;
      }
      for (let part = 0; part < leftEntry.length; part += 1) {
        if (leftEntry[part] !== rightEntry[part]) {
          return false;
        }
      }
    } else if (leftEntry !== rightEntry) {
      return false;
    }
  }
  return true;
}

function operationMatchesBatch(operation, table, upserts, deletes) {
  return (
    operation.table === table &&
    batchesEqual(operation.upserts, upserts) &&
    batchesEqual(operation.deletes, deletes)
  );
}

function createController(options = {}) {
  const createWorker =
    typeof options.createWorker === "function"
      ? options.createWorker
      : (workerPath, workerOptions) => new Worker(workerPath, workerOptions);
  const workerPath = options.workerPath || WORKER_PATH;
  const defaultDrainTimeoutMs = timeoutValue(
    options.drainTimeoutMs,
    DRAIN_TIMEOUT_MS,
  );
  const defaultCloseTimeoutMs = timeoutValue(
    options.closeTimeoutMs,
    CLOSE_TIMEOUT_MS,
  );
  const defaultExitTimeoutMs = timeoutValue(
    options.exitTimeoutMs,
    defaultCloseTimeoutMs,
  );

  /**
   * Test controllers may inject a journal with the same synchronous surface as
   * sqliteStore: optional init(dbPath), enqueue/get/list/apply/acknowledge/
   * reconcile/recoverPersistenceOperation(s). Production always uses the
   * durable SQLite implementation.
   */
  const journal = options.journal || sqliteStore;

  let state = null;
  let onErrorCallback = null;
  let onAcknowledgedCallback = null;
  let onRecoveredCallback = null;
  let controllerCallbackError = null;
  const pendingWrites = new Map();
  const pendingByTable = new Map();
  const recoveredDbPaths = new Set();
  // Recovery may commit before a baseline callback can finish. Retain the exact
  // completed operations in memory so that callback can be retried; submissions
  // remain blocked from crossing that unresolved baseline boundary.
  const pendingRecoveryCallbacks = new Map();
  // Shutdown never clears unresolved failures. A failure is removed only after
  // that exact durable operation is acknowledged/reconciled, or when a caller
  // explicitly acknowledges the diagnostic without touching the journal row.
  const failedWrites = new Map();

  function requireJournalMethod(name) {
    const method = journal && journal[name];
    if (typeof method !== "function") {
      const error = new Error(
        `persistence journal does not implement ${name}()`,
      );
      error.code = "PERSISTENCE_JOURNAL_INTERFACE_INVALID";
      throw error;
    }
    return method.bind(journal);
  }

  function initializeJournal(dbPath) {
    if (journal && typeof journal.init === "function") {
      journal.init(dbPath);
    }
  }

  function getJournalOperation(dbPath, operationId) {
    initializeJournal(dbPath);
    const operation = requireJournalMethod("getPersistenceOperation")(
      normalizeOperationId(operationId),
    );
    return operation ? copyOperation(operation) : null;
  }

  function copyFailure(failure) {
    return {
      operationId: failure.operationId,
      table: failure.table,
      upserts: copyUpserts(failure.upserts),
      deletes: copyDeletes(failure.deletes),
      error: failure.error,
      source: failure.source,
    };
  }

  function getPendingFailures() {
    return [...failedWrites.values()].map(copyFailure);
  }

  function acknowledgeFailures(operationIds) {
    if (operationIds === undefined || operationIds === null) {
      return 0;
    }
    const ids = Array.isArray(operationIds) ? operationIds : [operationIds];
    let removed = 0;
    for (const operationId of ids) {
      if (failedWrites.delete(operationId)) {
        removed += 1;
      }
    }
    return removed;
  }

  function rememberCallbackError(targetState, error, fallback) {
    const message = errorMessage(error, fallback);
    if (targetState) {
      targetState.callbackError = targetState.callbackError || message;
    } else {
      controllerCallbackError = controllerCallbackError || message;
    }
    return message;
  }

  function invokeErrorCallback(targetState, table, message, failure) {
    if (!onErrorCallback) {
      return;
    }
    try {
      onErrorCallback(table, message, failure ? copyFailure(failure) : null);
    } catch (error) {
      rememberCallbackError(
        targetState,
        error,
        "persistence worker error callback failed",
      );
    }
  }

  function invokeAcknowledgedCallback(targetState, operation) {
    if (!onAcknowledgedCallback) {
      return;
    }
    try {
      onAcknowledgedCallback(copyOperation(operation));
    } catch (error) {
      const message = rememberCallbackError(
        targetState,
        error,
        "persistence acknowledgment callback failed",
      );
      invokeErrorCallback(targetState, operation.table, message, null);
      const callbackError = new Error(message);
      callbackError.code = "PERSISTENCE_ACKNOWLEDGMENT_CALLBACK_FAILED";
      callbackError.cause = error;
      callbackError.acknowledgedOperation = copyOperation(operation);
      throw callbackError;
    }
  }

  function invokeRecoveredCallback(targetState, operations) {
    if (!onRecoveredCallback || operations.length === 0) {
      return;
    }
    try {
      onRecoveredCallback(operations.map(copyOperation));
    } catch (error) {
      const message = rememberCallbackError(
        targetState,
        error,
        "persistence recovery callback failed",
      );
      invokeErrorCallback(targetState, null, message, null);
      const callbackError = new Error(message);
      callbackError.code = "PERSISTENCE_RECOVERY_CALLBACK_FAILED";
      callbackError.cause = error;
      callbackError.recoveredOperations = operations.map(copyOperation);
      throw callbackError;
    }
  }

  function removePendingOperation(operation) {
    pendingWrites.delete(operation.operationId);
    if (operation.workerState) {
      operation.workerState.pendingOperationIds.delete(operation.operationId);
    }
    if (pendingByTable.get(operation.table) === operation.operationId) {
      pendingByTable.delete(operation.table);
    }
  }

  function findPendingOperation(targetState, message) {
    if (
      !message ||
      !Number.isSafeInteger(message.operationId) ||
      typeof message.table !== "string"
    ) {
      return null;
    }
    const operation = pendingWrites.get(message.operationId);
    return operation &&
      operation.workerState === targetState &&
      operation.table === message.table
      ? operation
      : null;
  }

  function recordFailure(
    targetState,
    operation,
    rawError,
    source,
    notify = true,
  ) {
    const message = errorMessage(
      rawError,
      "persistence worker write failed without an error message",
    );
    let failure = failedWrites.get(operation.operationId);
    if (!failure) {
      failure = {
        operationId: operation.operationId,
        table: operation.table,
        upserts: copyUpserts(operation.upserts),
        deletes: copyDeletes(operation.deletes),
        error: message,
        source,
        notified: false,
      };
      failedWrites.set(operation.operationId, failure);
    } else if (source === "write-error" && failure.source !== "write-error") {
      // Prefer the worker's detailed write error over a generic crash/exit
      // fallback if both are observed for the same operation.
      failure.error = message;
      failure.source = source;
      failure.notified = false;
    }

    if (notify && !failure.notified) {
      failure.notified = true;
      invokeErrorCallback(targetState, failure.table, failure.error, failure);
    }
    return failure;
  }

  function failPendingWrites(targetState, rawError, source, notify = true) {
    const failures = [];
    for (const operationId of [...targetState.pendingOperationIds]) {
      const operation = pendingWrites.get(operationId);
      if (operation) {
        failures.push(
          recordFailure(targetState, operation, rawError, source, notify),
        );
      }
    }
    return failures;
  }

  function notifyWorkerReconciled(targetState, operation) {
    if (!targetState || targetState.exited) {
      return;
    }
    try {
      targetState.worker.postMessage({
        type: "reconciled",
        operationId: operation.operationId,
        table: operation.table,
      });
    } catch (error) {
      const message =
        "persistence worker reconciliation notice could not be posted: " +
        errorMessage(error, "unknown postMessage error");
      targetState.messageError = targetState.messageError || message;
      invokeErrorCallback(targetState, operation.table, message, null);
      const noticeError = new Error(message);
      noticeError.code = "PERSISTENCE_WORKER_RECONCILE_NOTICE_FAILED";
      noticeError.cause = error;
      noticeError.operationId = operation.operationId;
      noticeError.table = operation.table;
      throw noticeError;
    }
  }

  function finishAcknowledgedOperation(operation, acknowledgedOperation) {
    const completed = copyOperation(
      acknowledgedOperation || operation.acknowledgedOperation || operation,
    );
    const targetState = operation.workerState;
    // This metadata survives a callback exception after the durable journal row
    // is gone, allowing reconcileWrite() to retry the exact baseline callback.
    operation.acknowledgedOperation = completed;
    invokeAcknowledgedCallback(targetState, completed);
    failedWrites.delete(operation.operationId);
    removePendingOperation(operation);
    return copyOperation(completed);
  }

  function acknowledgeAppliedOperation(targetState, operation) {
    const stored = getJournalOperation(
      targetState.dbPath,
      operation.operationId,
    );
    if (!stored) {
      if (operation.acknowledgedOperation) {
        return finishAcknowledgedOperation(
          operation,
          operation.acknowledgedOperation,
        );
      }
      const error = new Error(
        `persistence operation ${operation.operationId} disappeared before acknowledgment`,
      );
      error.code = "PERSISTENCE_OPERATION_NOT_FOUND";
      throw error;
    }
    if (stored.table !== operation.table) {
      const error = new Error(
        `persistence operation ${operation.operationId} table mismatch`,
      );
      error.code = "PERSISTENCE_OPERATION_MISMATCH";
      throw error;
    }
    if (stored.state !== "applied") {
      const error = new Error(
        `persistence operation ${operation.operationId} was acknowledged before durable apply`,
      );
      error.code = "PERSISTENCE_OPERATION_NOT_APPLIED";
      throw error;
    }
    initializeJournal(targetState.dbPath);
    const acknowledged = copyOperation(
      requireJournalMethod("acknowledgePersistenceOperation")(
        operation.operationId,
        operation.table,
      ),
    );
    return finishAcknowledgedOperation(operation, acknowledged);
  }

  function consumeQueuedFailureSignal(targetState) {
    while (true) {
      const count = Atomics.load(
        targetState.counters,
        FAILED_WRITE_INDEX,
      );
      if (count <= 0) {
        return;
      }
      if (
        Atomics.compareExchange(
          targetState.counters,
          FAILED_WRITE_INDEX,
          count,
          count - 1,
        ) === count
      ) {
        return;
      }
    }
  }

  function handleWorkerMessage(targetState, message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "write-complete") {
      const operation = findPendingOperation(targetState, message);
      if (operation) {
        try {
          acknowledgeAppliedOperation(targetState, operation);
        } catch (error) {
          recordFailure(
            targetState,
            operation,
            "persistence worker acknowledgment failed: " +
              errorMessage(error, "unknown journal acknowledgment error"),
            "acknowledgment-error",
            true,
          );
        }
      }
      return;
    }
    if (message.type === "error") {
      // The production worker increments this shared diagnostic exactly once
      // before every error message. Consume it even when the ID is stale; exact
      // pending-state mutation remains gated by findPendingOperation below.
      consumeQueuedFailureSignal(targetState);
      const operation = findPendingOperation(targetState, message);
      const messageText = errorMessage(
        message.error,
        "persistence worker write failed without an error message",
      );
      if (operation) {
        recordFailure(
          targetState,
          operation,
          messageText,
          "write-error",
          true,
        );
      } else {
        // Even a malformed/unmatched write error remains observable.
        invokeErrorCallback(targetState, message.table || null, messageText, null);
      }
      return;
    }
    if (message.type === "closed") {
      targetState.closeAcknowledged = true;
      if (message.error !== undefined && message.error !== null) {
        targetState.closeError = errorMessage(
          message.error,
          "persistence worker close failed without an error message",
        );
      }
    }
  }

  function attachWorkerListeners(targetState) {
    const current = targetState.worker;
    current.on("message", (message) => {
      handleWorkerMessage(targetState, message);
    });
    current.on("messageerror", (error) => {
      const message = errorMessage(
        error,
        "persistence worker message could not be deserialized",
      );
      targetState.messageError = targetState.messageError || message;
      failPendingWrites(targetState, message, "message-error", false);
      invokeErrorCallback(targetState, null, message, null);
    });
    current.on("error", (error) => {
      const message =
        "persistence worker crashed: " +
        errorMessage(error, "unknown worker error");
      targetState.workerError = targetState.workerError || message;
      failPendingWrites(targetState, message, "worker-error", false);
      // Preserve the existing null-table signal: the caller must conservatively
      // recover every loaded SQLite table after a worker-level crash.
      invokeErrorCallback(targetState, null, message, null);
    });
    current.on("exit", (code) => {
      targetState.exited = true;
      targetState.exitCode = code;
      recoveredDbPaths.delete(targetState.dbPath);
      if (targetState.pendingOperationIds.size > 0) {
        failPendingWrites(
          targetState,
          "persistence worker exited before reporting write completion",
          "worker-exit",
          true,
        );
      }
      if (
        code !== 0 &&
        !targetState.workerError &&
        !targetState.terminationRequested
      ) {
        invokeErrorCallback(
          targetState,
          null,
          "persistence worker exited with code " + code,
          null,
        );
      }
    });
  }

  function ensureWorker(dbPath) {
    if (state && !state.exited) {
      if (state.shuttingDown) {
        const error = new Error("persistence worker shutdown is in progress");
        error.code = "PERSISTENCE_WORKER_SHUTTING_DOWN";
        throw error;
      }
      if (state.dbPath !== dbPath) {
        const error = new Error(
          "persistence worker cannot switch databases while active",
        );
        error.code = "PERSISTENCE_WORKER_DATABASE_MISMATCH";
        throw error;
      }
      return state;
    }

    const sharedBuffer = new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT * SHARED_COUNTER_SLOTS,
    );
    const counters = new Int32Array(sharedBuffer);
    const nextState = {
      worker: null,
      counters,
      dbPath,
      pendingOperationIds: new Set(),
      closeRequested: false,
      closeAcknowledged: false,
      closeError: null,
      workerError: null,
      messageError: null,
      callbackError: null,
      exited: false,
      exitCode: null,
      exitTimedOut: false,
      terminationRequested: false,
      shuttingDown: false,
      shutdownPromise: null,
    };
    nextState.callbackError = controllerCallbackError;
    nextState.worker = createWorker(workerPath, {
      workerData: { dbPath, sharedBuffer },
    });
    state = nextState;
    attachWorkerListeners(nextState);
    if (typeof nextState.worker.unref === "function") {
      nextState.worker.unref();
    }
    return nextState;
  }

  function isEnabled() {
    return process.env.EVEJS_PERSISTENCE_WORKER === "1";
  }

  function isActive() {
    return Boolean(state && !state.exited);
  }

  // Register a callback invoked when a worker write fails. The callback remains
  // registered across shutdown/respawn; only an explicit onError(null) clears it.
  function onError(callback) {
    onErrorCallback = typeof callback === "function" ? callback : null;
  }

  // Called only after the exact applied journal row has been durably deleted.
  function onAcknowledged(callback) {
    onAcknowledgedCallback =
      typeof callback === "function" ? callback : null;
  }

  // Recovery is delivered as one ordered array so a caller can rebuild or
  // reconcile all affected baselines as a single startup step.
  function onRecovered(callback) {
    onRecoveredCallback = typeof callback === "function" ? callback : null;
  }

  function registerPendingOperation(operation, dbPath) {
    const durable = copyOperation(operation);
    const existingById = pendingWrites.get(durable.operationId);
    if (existingById) {
      const error = new Error(
        `persistence operation ${durable.operationId} is already unresolved`,
      );
      error.code = "PERSISTENCE_OPERATION_PENDING";
      throw error;
    }
    const existingOperationId = pendingByTable.get(durable.table);
    if (existingOperationId !== undefined) {
      const error = new Error(
        `persistence table ${durable.table} already has unresolved operation ${existingOperationId}`,
      );
      error.code = "PERSISTENCE_TABLE_WRITE_PENDING";
      error.operationId = existingOperationId;
      error.table = durable.table;
      throw error;
    }
    const local = { ...durable, dbPath, workerState: null };
    pendingWrites.set(local.operationId, local);
    pendingByTable.set(local.table, local.operationId);
    return local;
  }

  function bindOperationToWorker(operation, targetState) {
    operation.workerState = targetState;
    targetState.pendingOperationIds.add(operation.operationId);
  }

  function assertControllerDatabase(dbPath) {
    if (state && !state.exited && state.dbPath !== dbPath) {
      const error = new Error(
        "persistence controller cannot switch databases while active",
      );
      error.code = "PERSISTENCE_WORKER_DATABASE_MISMATCH";
      throw error;
    }
    for (const operation of pendingWrites.values()) {
      if (operation.dbPath !== dbPath) {
        const error = new Error(
          `unresolved persistence operation ${operation.operationId} belongs to a different database`,
        );
        error.code = "PERSISTENCE_WORKER_DATABASE_MISMATCH";
        throw error;
      }
    }
    for (const recoveryPath of pendingRecoveryCallbacks.keys()) {
      if (recoveryPath !== dbPath) {
        const error = new Error(
          "unreported persistence recovery belongs to a different database",
        );
        error.code = "PERSISTENCE_WORKER_DATABASE_MISMATCH";
        throw error;
      }
    }
  }

  function recover(dbPath) {
    assertControllerDatabase(dbPath);
    initializeJournal(dbPath);
    const newlyRecovered = requireJournalMethod("recoverPersistenceOperations")()
      .map(copyOperation);
    recoveredDbPaths.add(dbPath);
    const recoveredById = new Map();
    for (const operation of [
      ...(pendingRecoveryCallbacks.get(dbPath) || []),
      ...newlyRecovered,
    ]) {
      const existing = recoveredById.get(operation.operationId);
      if (
        existing &&
        !operationMatchesBatch(
          existing,
          operation.table,
          operation.upserts,
          operation.deletes,
        )
      ) {
        const error = new Error(
          `conflicting recovered persistence operation ${operation.operationId}`,
        );
        error.code = "PERSISTENCE_OPERATION_MISMATCH";
        throw error;
      }
      recoveredById.set(operation.operationId, operation);
    }
    const recovered = [...recoveredById.values()].sort(
      (left, right) => left.operationId - right.operationId,
    );
    if (recovered.length > 0) {
      pendingRecoveryCallbacks.set(dbPath, recovered.map(copyOperation));
    }

    // Journal replay has committed, but the recovery boundary is not complete
    // until every required live-worker reconciliation notice has been posted
    // successfully and the consumer accepts this exact ordered recovery. Keep
    // the in-memory queue and table leases through both fallible phases so a
    // later recover() can retry notices idempotently and the callback without
    // an approximate diff.
    for (const operation of recovered) {
      const local = pendingWrites.get(operation.operationId);
      if (local) {
        notifyWorkerReconciled(local.workerState, operation);
      }
    }
    invokeRecoveredCallback(state, recovered);
    for (const operation of recovered) {
      const local = pendingWrites.get(operation.operationId);
      if (local && local.table === operation.table) {
        removePendingOperation(local);
      }
      failedWrites.delete(operation.operationId);
    }
    pendingRecoveryCallbacks.delete(dbPath);
    return recovered.map(copyOperation);
  }

  function ensureRecovered(dbPath) {
    if (
      recoveredDbPaths.has(dbPath) &&
      !pendingRecoveryCallbacks.has(dbPath)
    ) {
      return [];
    }
    return recover(dbPath);
  }

  function reconcileWrite(dbPath, operationId) {
    assertControllerDatabase(dbPath);
    const id = normalizeOperationId(operationId);
    const local = pendingWrites.get(id) || null;
    if (local && local.dbPath !== dbPath) {
      const error = new Error(
        `persistence operation ${id} belongs to a different database`,
      );
      error.code = "PERSISTENCE_WORKER_DATABASE_MISMATCH";
      throw error;
    }
    const stored = getJournalOperation(dbPath, id);
    if (!stored) {
      if (!local) {
        return null;
      }
      if (local.acknowledgedOperation) {
        notifyWorkerReconciled(
          local.workerState,
          local.acknowledgedOperation,
        );
        return finishAcknowledgedOperation(
          local,
          local.acknowledgedOperation,
        );
      }
      const error = new Error(
        `persistence operation ${id} disappeared before reconciliation`,
      );
      error.code = "PERSISTENCE_OPERATION_NOT_FOUND";
      throw error;
    }
    const expectedTable = local ? local.table : stored.table;
    const reconciledValue = requireJournalMethod(
      "reconcilePersistenceOperation",
    )(id, expectedTable);
    if (!reconciledValue) {
      const error = new Error(
        `persistence operation ${id} disappeared during reconciliation`,
      );
      error.code = "PERSISTENCE_OPERATION_NOT_FOUND";
      throw error;
    }
    const reconciled = copyOperation(reconciledValue);

    const completed = reconciled;
    const targetState = local ? local.workerState : state;
    if (local) {
      // Save the exact completion before a fallible worker notice or consumer
      // callback. Either failure leaves the lease in place for an exact retry.
      local.acknowledgedOperation = copyOperation(completed);
      // Clear a live worker's failed-table barrier before invoking a consumer
      // callback that may throw. The controller lease remains held until that
      // callback succeeds, so no newer same-table write can cross the boundary.
      notifyWorkerReconciled(targetState, completed);
      finishAcknowledgedOperation(local, completed);
    } else {
      failedWrites.delete(id);
    }
    return copyOperation(completed);
  }

  function makeDrainResult(targetState, values = {}) {
    const attempted = Boolean(targetState);
    const pending = attempted
      ? Atomics.load(targetState.counters, PENDING_WRITE_INDEX)
      : 0;
    const writeErrorCount = attempted
      ? Atomics.load(targetState.counters, FAILED_WRITE_INDEX)
      : 0;
    const timedOut = values.timedOut === true;
    const workerExited = Boolean(targetState && targetState.exited);
    let error = values.error || null;
    if (!error && writeErrorCount > 0) {
      error =
        "persistence worker reported " +
        writeErrorCount +
        " failed write" +
        (writeErrorCount === 1 ? "" : "s");
    }
    return {
      attempted,
      drained: pending <= 0,
      pending: Math.max(0, pending),
      timedOut,
      writeErrorCount,
      workerExited,
      workerError: targetState ? targetState.workerError : null,
      error,
    };
  }

  /**
   * Block until the shared in-flight count reaches zero. A zero count means all
   * writes completed, not necessarily that they succeeded; writeErrorCount and
   * error make that distinction explicit.
   */
  function drain(timeoutMs = defaultDrainTimeoutMs, targetState = state) {
    if (!targetState) {
      return makeDrainResult(null);
    }
    const waitTimeoutMs = timeoutValue(timeoutMs, defaultDrainTimeoutMs);
    const deadline = Date.now() + waitTimeoutMs;
    while (true) {
      const pending = Atomics.load(
        targetState.counters,
        PENDING_WRITE_INDEX,
      );
      if (pending <= 0) {
        return makeDrainResult(targetState);
      }
      if (targetState.exited) {
        return makeDrainResult(targetState, {
          error:
            "persistence worker exited with " +
            pending +
            " write" +
            (pending === 1 ? "" : "s") +
            " still pending",
        });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return makeDrainResult(targetState, {
          timedOut: true,
          error:
            "persistence worker drain timed out with " +
            pending +
            " write" +
            (pending === 1 ? "" : "s") +
            " still pending",
        });
      }
      Atomics.wait(
        targetState.counters,
        PENDING_WRITE_INDEX,
        pending,
        remaining,
      );
    }
  }

  /**
   * Submit a durable write. The exact batch is journaled before postMessage.
   * A caller-supplied operationId must already identify that exact durable row.
   */
  function submitWrite(dbPath, table, upserts, deletes, submitOptions = {}) {
    assertControllerDatabase(dbPath);
    if (state && state.shuttingDown) {
      const error = new Error("persistence worker shutdown is in progress");
      error.code = "PERSISTENCE_WORKER_SHUTTING_DOWN";
      throw error;
    }
    if (pendingRecoveryCallbacks.has(dbPath)) {
      recover(dbPath);
    }
    const normalizedTable = String(table);
    const normalizedUpserts = copyUpserts(upserts);
    const normalizedDeletes = copyDeletes(deletes);
    const suppliedOperationId = submitOptions.operationId;

    if (suppliedOperationId === undefined || suppliedOperationId === null) {
      ensureRecovered(dbPath);
    }
    if (pendingByTable.has(normalizedTable)) {
      const existingOperationId = pendingByTable.get(normalizedTable);
      const error = new Error(
        `persistence table ${normalizedTable} already has unresolved operation ${existingOperationId}`,
      );
      error.code = "PERSISTENCE_TABLE_WRITE_PENDING";
      error.operationId = existingOperationId;
      error.table = normalizedTable;
      throw error;
    }

    initializeJournal(dbPath);
    let durableOperation;
    if (suppliedOperationId === undefined || suppliedOperationId === null) {
      durableOperation = copyOperation(
        requireJournalMethod("enqueuePersistenceOperation")(
          normalizedTable,
          normalizedUpserts,
          normalizedDeletes,
        ),
      );
    } else {
      const operationId = normalizeOperationId(suppliedOperationId);
      durableOperation = getJournalOperation(dbPath, operationId);
      if (!durableOperation) {
        const error = new Error(
          `pre-journaled persistence operation ${operationId} does not exist`,
        );
        error.code = "PERSISTENCE_OPERATION_NOT_FOUND";
        throw error;
      }
      recoveredDbPaths.add(dbPath);
    }

    if (
      !operationMatchesBatch(
        durableOperation,
        normalizedTable,
        normalizedUpserts,
        normalizedDeletes,
      )
    ) {
      const error = new Error(
        `persistence operation ${durableOperation.operationId} does not match the submitted batch`,
      );
      error.code = "PERSISTENCE_OPERATION_MISMATCH";
      throw error;
    }

    const operation = registerPendingOperation(durableOperation, dbPath);
    let targetState;
    try {
      targetState = ensureWorker(dbPath);
      bindOperationToWorker(operation, targetState);
    } catch (error) {
      const message =
        "persistence worker could not be started: " +
        errorMessage(error, "unknown worker creation error");
      recordFailure(null, operation, message, "worker-create-error", true);
      throw error;
    }

    Atomics.add(targetState.counters, PENDING_WRITE_INDEX, 1);
    try {
      targetState.worker.postMessage({
        type: "write",
        operationId: operation.operationId,
        table: operation.table,
        upserts: operation.upserts,
        deletes: operation.deletes,
      });
    } catch (error) {
      Atomics.sub(targetState.counters, PENDING_WRITE_INDEX, 1);
      Atomics.notify(targetState.counters, PENDING_WRITE_INDEX);
      const message =
        "persistence worker write could not be posted: " +
        errorMessage(error, "unknown postMessage error");
      recordFailure(targetState, operation, message, "post-message-error", true);
      const postError = new Error(message);
      postError.code = "PERSISTENCE_WORKER_POST_FAILED";
      throw postError;
    }

    let drainResult = null;
    if (submitOptions.sync === true) {
      drainResult = drain(defaultDrainTimeoutMs, targetState);
      if (!drainResult.drained || drainResult.timedOut) {
        const drainError = new Error(
          drainResult.error || "persistence worker drain failed",
        );
        drainError.code = drainResult.timedOut
          ? "PERSISTENCE_WORKER_DRAIN_TIMEOUT"
          : "PERSISTENCE_WORKER_DRAIN_FAILED";
        throw drainError;
      }

      // A synchronous drain only says that workers finished dequeuing. Query
      // this exact durable identity; a global failure counter must never decide
      // the outcome of another operation.
      if (pendingWrites.has(operation.operationId)) {
        let exactState;
        try {
          exactState = getJournalOperation(dbPath, operation.operationId);
          if (!exactState) {
            if (!operation.acknowledgedOperation) {
              const missingError = new Error(
                `persistence operation ${operation.operationId} disappeared before synchronous acknowledgment`,
              );
              missingError.code = "PERSISTENCE_OPERATION_NOT_FOUND";
              throw missingError;
            }
            finishAcknowledgedOperation(
              operation,
              operation.acknowledgedOperation,
            );
          } else if (exactState.state === "applied") {
            acknowledgeAppliedOperation(targetState, operation);
          } else {
            consumeQueuedFailureSignal(targetState);
            const failure = recordFailure(
              targetState,
              operation,
              "persistence worker drained but the exact journal operation remains pending",
              "sync-write-not-applied",
              true,
            );
            const writeError = new Error(failure.error);
            writeError.code = "PERSISTENCE_WORKER_WRITE_FAILED";
            throw writeError;
          }
        } catch (error) {
          if (error.code === "PERSISTENCE_WORKER_WRITE_FAILED") {
            throw error;
          }
          const message =
            "persistence worker synchronous finalization failed: " +
            errorMessage(error, "unknown journal finalization error");
          recordFailure(
            targetState,
            operation,
            message,
            "sync-finalization-error",
            true,
          );
          const finalizationError = new Error(message);
          finalizationError.code = "PERSISTENCE_WORKER_FINALIZATION_FAILED";
          finalizationError.cause = error;
          throw finalizationError;
        }
      }
    }

    return {
      operationId: operation.operationId,
      drain: drainResult,
    };
  }

  function requestClose(targetState, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      const current = targetState.worker;

      const finish = (kind, postError = null) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        current.removeListener("message", onMessage);
        current.removeListener("exit", onExit);
        resolve({ kind, postError });
      };
      const onMessage = (message) => {
        if (message && message.type === "closed") {
          finish("acknowledged");
        }
      };
      const onExit = () => {
        finish("exit");
      };

      if (targetState.closeAcknowledged) {
        finish("acknowledged");
        return;
      }
      if (targetState.exited) {
        finish("exit");
        return;
      }

      current.on("message", onMessage);
      current.once("exit", onExit);
      timeout = setTimeout(() => {
        finish("timeout");
      }, timeoutMs);

      try {
        current.postMessage({ type: "close" });
        targetState.closeRequested = true;
      } catch (error) {
        const message =
          "persistence worker close could not be posted: " +
          errorMessage(error, "unknown postMessage error");
        finish("post-error", message);
      }
    });
  }

  function waitForExit(targetState, timeoutMs) {
    if (targetState.exited) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false;
      const current = targetState.worker;
      const finish = (exited) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        current.removeListener("exit", onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      current.once("exit", onExit);
      const timeout = setTimeout(() => finish(false), timeoutMs);
    });
  }

  function inactiveShutdownResult() {
    const writeErrors = getPendingFailures();
    const errors = writeErrors.map((failure) => ({
      type: "write-error",
      error: failure.error,
      operationId: failure.operationId,
      table: failure.table,
    }));
    return {
      active: false,
      drain: makeDrainResult(null),
      acknowledged: false,
      timedOut: false,
      terminated: false,
      error: errors.length > 0 ? errors[0].error : null,
      errors,
      close: {
        requested: false,
        acknowledged: false,
        timedOut: false,
        lostAcknowledgment: false,
        error: null,
      },
      worker: {
        error: null,
        messageError: null,
        callbackError: null,
        exited: false,
        exitCode: null,
        exitTimedOut: false,
      },
      termination: {
        attempted: false,
        forced: false,
        completed: false,
        error: null,
      },
      forcedTermination: false,
      writeErrors,
    };
  }

  function buildShutdownResult(
    targetState,
    drainResult,
    close,
    termination,
  ) {
    const writeErrors = getPendingFailures();
    const errors = [];
    for (const failure of writeErrors) {
      errors.push({
        type: "write-error",
        error: failure.error,
        operationId: failure.operationId,
        table: failure.table,
      });
    }
    if (writeErrors.length === 0 && drainResult.writeErrorCount > 0) {
      errors.push({
        type: "write-error",
        error:
          drainResult.error ||
          "persistence worker reported a failed write without details",
      });
    }
    if (drainResult.timedOut) {
      errors.push({ type: "drain-timeout", error: drainResult.error });
    } else if (!drainResult.drained && drainResult.error) {
      errors.push({ type: "drain-error", error: drainResult.error });
    }
    if (close.timedOut) {
      errors.push({ type: "close-timeout", error: close.error });
    } else if (close.lostAcknowledgment) {
      errors.push({ type: "lost-close-acknowledgment", error: close.error });
    } else if (close.error) {
      errors.push({ type: "close-error", error: close.error });
    }
    if (targetState.workerError) {
      errors.push({ type: "worker-error", error: targetState.workerError });
    }
    if (targetState.messageError) {
      errors.push({ type: "worker-message-error", error: targetState.messageError });
    }
    if (
      targetState.exitCode !== null &&
      targetState.exitCode !== 0 &&
      !termination.forced
    ) {
      errors.push({
        type: "worker-exit",
        error: "persistence worker exited with code " + targetState.exitCode,
      });
    }
    if (targetState.exitTimedOut) {
      errors.push({
        type: "worker-exit-timeout",
        error: "persistence worker did not exit after close acknowledgment",
      });
    }
    if (targetState.callbackError) {
      errors.push({
        type: "recovery-callback-error",
        error: targetState.callbackError,
      });
    }
    if (termination.error) {
      errors.push({ type: "termination-error", error: termination.error });
    }

    return {
      active: true,
      drain: drainResult,
      // Compatibility fields retained for cleanup-marker integration.
      acknowledged: close.acknowledged,
      timedOut: close.timedOut,
      terminated: Boolean(targetState.exited || termination.completed),
      error: errors.length > 0 ? errors[0].error : null,
      errors,
      close,
      worker: {
        error: targetState.workerError,
        messageError: targetState.messageError,
        callbackError: targetState.callbackError,
        exited: targetState.exited,
        exitCode: targetState.exitCode,
        exitTimedOut: targetState.exitTimedOut,
      },
      termination,
      forcedTermination: termination.forced,
      writeErrors,
    };
  }

  async function performShutdown(targetState) {
    let drainResult;
    try {
      drainResult = drain(defaultDrainTimeoutMs, targetState);
    } catch (error) {
      drainResult = makeDrainResult(targetState, {
        error:
          "persistence worker drain failed: " +
          errorMessage(error, "unknown drain error"),
      });
    }

    let refError = null;
    try {
      if (typeof targetState.worker.ref === "function") {
        targetState.worker.ref();
      }
    } catch (error) {
      refError =
        "persistence worker could not be referenced for close: " +
        errorMessage(error, "unknown ref error");
    }

    let closeWait = { kind: "exit", postError: null };
    if (!targetState.exited) {
      try {
        closeWait = await requestClose(
          targetState,
          defaultCloseTimeoutMs,
        );
      } catch (error) {
        closeWait = {
          kind: "post-error",
          postError:
            "persistence worker close wait failed: " +
            errorMessage(error, "unknown close error"),
        };
      }
    }

    const close = {
      requested: targetState.closeRequested,
      acknowledged: targetState.closeAcknowledged,
      timedOut: closeWait.kind === "timeout",
      lostAcknowledgment:
        closeWait.kind === "exit" && !targetState.closeAcknowledged,
      error: null,
    };
    if (targetState.closeError) {
      close.error = targetState.closeError;
    } else if (closeWait.postError) {
      close.error = closeWait.postError;
    } else if (refError) {
      close.error = refError;
    } else if (close.timedOut) {
      close.error = "persistence worker close acknowledgment timed out";
    } else if (close.lostAcknowledgment) {
      close.error =
        "persistence worker exited before the closed acknowledgment";
    }

    if (close.acknowledged && !targetState.exited) {
      const exited = await waitForExit(targetState, defaultExitTimeoutMs);
      if (!exited) {
        targetState.exitTimedOut = true;
      }
    }

    const termination = {
      attempted: false,
      forced: false,
      completed: false,
      error: null,
    };
    if (!targetState.exited) {
      termination.attempted = true;
      termination.forced = true;
      targetState.terminationRequested = true;
      try {
        const exitCode = await targetState.worker.terminate();
        termination.completed = true;
        if (!targetState.exited) {
          targetState.exited = true;
          targetState.exitCode = exitCode;
        }
      } catch (error) {
        termination.error =
          "persistence worker forced termination failed: " +
          errorMessage(error, "unknown termination error");
      }
    }

    // Any write still lacking a success/error acknowledgment now has an
    // uncertain durable outcome. Preserve its full operation for conservative
    // replay rather than silently discarding it.
    if (targetState.pendingOperationIds.size > 0) {
      let pendingError =
        "persistence worker stopped before reporting write completion";
      let source = "lost-write-acknowledgment";
      if (drainResult.timedOut) {
        pendingError = drainResult.error;
        source = "drain-timeout";
      } else if (termination.error) {
        pendingError = termination.error;
        source = "termination-error";
      }
      failPendingWrites(targetState, pendingError, source, true);
    }

    if (!targetState.exited && typeof targetState.worker.unref === "function") {
      // A failed terminate() must not turn the previously unref'd worker into a
      // new process-liveness leak merely because shutdown temporarily ref'd it.
      try {
        targetState.worker.unref();
      } catch (_error) {
        // The termination error already captures the actionable failure.
      }
    }

    return buildShutdownResult(
      targetState,
      drainResult,
      close,
      termination,
    );
  }

  function shutdown() {
    if (!state) {
      return Promise.resolve(inactiveShutdownResult());
    }
    const targetState = state;
    if (targetState.shutdownPromise) {
      return targetState.shutdownPromise;
    }
    targetState.shuttingDown = true;
    targetState.shutdownPromise = performShutdown(targetState).finally(() => {
      if (state === targetState && targetState.exited) {
        recoveredDbPaths.delete(targetState.dbPath);
        state = null;
      } else if (!targetState.exited) {
        // Keep a failed-termination worker visible as active so cleanup cannot
        // delete its root. Clearing the settled promise permits an explicit
        // shutdown retry while submitWrite remains blocked by shuttingDown.
        targetState.shutdownPromise = null;
      }
    });
    return targetState.shutdownPromise;
  }

  return {
    isEnabled,
    isActive,
    onError,
    onAcknowledged,
    onRecovered,
    submitWrite,
    recover,
    reconcileWrite,
    drain,
    shutdown,
    getPendingFailures,
    acknowledgeFailures,
  };
}

const controller = createController();

module.exports = {
  isEnabled: controller.isEnabled,
  isActive: controller.isActive,
  onError: controller.onError,
  onAcknowledged: controller.onAcknowledged,
  onRecovered: controller.onRecovered,
  submitWrite: controller.submitWrite,
  recover: controller.recover,
  reconcileWrite: controller.reconcileWrite,
  drain: controller.drain,
  shutdown: controller.shutdown,
  getPendingFailures: controller.getPendingFailures,
  acknowledgeFailures: controller.acknowledgeFailures,
  // Deterministic worker/event injection for focused protocol tests.
  _createControllerForTests: createController,
};
