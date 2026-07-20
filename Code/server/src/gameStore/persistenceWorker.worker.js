/**
 * PERSISTENCE WORKER (worker_threads entry):
 *
 * The off-loop SQLite writer. The main thread computes each flush diff
 * (upserts/deletes) exactly as before, then hands the already-serialized rows
 * to this worker so the synchronous better-sqlite3 transaction no longer stalls
 * the 10 Hz simulation loop. This worker owns its OWN better-sqlite3 connection
 * to the same WAL database (the main thread keeps a separate connection for
 * reads/preload); WAL + busy_timeout lets the two connections coexist.
 *
 * Coordination with the main thread uses a shared Int32 counter:
 *   - main  Atomics.add(counter, 0, +1)  before posting a write
 *   - here  Atomics.sub(counter, 0, -1)  after the write completes (success OR
 *           failure) + Atomics.notify, so the main thread can drain
 *           synchronously (Atomics.wait until 0) on flushTableSync / shutdown.
 *
 * The journaled operation is the worker's source of truth. The message carries
 * a second exact copy only so identity/table/payload mismatches fail closed
 * before the transaction runs.
 */

"use strict";

const { parentPort, workerData } = require("worker_threads");
const sqliteStore = require("./sqliteStore");

const counters = new Int32Array(workerData.sharedBuffer);
const PENDING_WRITE_INDEX = 0;
const FAILED_WRITE_INDEX = 1;
const blockedByTable = new Map();

// This worker's private connection to the shared WAL database.
sqliteStore.init(workerData.dbPath);

function complete() {
  // One unit of work finished (committed or failed). Decrement and wake any
  // main-thread drainer blocked in Atomics.wait.
  Atomics.sub(counters, PENDING_WRITE_INDEX, 1);
  Atomics.notify(counters, PENDING_WRITE_INDEX);
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

function assertExactMessage(operation, message) {
  if (operation.table !== message.table) {
    throw new Error(
      `persistence operation ${message.operationId} table mismatch`,
    );
  }
  const messageUpserts = copyUpserts(message.upserts);
  const messageDeletes = copyDeletes(message.deletes);
  if (
    !batchesEqual(operation.upserts, messageUpserts) ||
    !batchesEqual(operation.deletes, messageDeletes)
  ) {
    throw new Error(
      `persistence operation ${message.operationId} payload mismatch`,
    );
  }
}

function reportWriteError(message, error) {
  if (!blockedByTable.has(message.table)) {
    blockedByTable.set(message.table, message.operationId);
  }
  Atomics.add(counters, FAILED_WRITE_INDEX, 1);
  parentPort.postMessage({
    type: "error",
    operationId: message.operationId,
    table: message.table,
    error: error && error.message ? error.message : String(error),
  });
}

function applyWrite(message) {
  if (
    !Number.isSafeInteger(message.operationId) ||
    message.operationId <= 0 ||
    typeof message.table !== "string"
  ) {
    throw new Error("persistence write requires an exact operationId and table");
  }
  const blockedOperationId = blockedByTable.get(message.table);
  if (blockedOperationId !== undefined) {
    throw new Error(
      `persistence table ${message.table} is blocked by failed operation ${blockedOperationId}`,
    );
  }

  const recorded = sqliteStore.getPersistenceOperation(message.operationId);
  if (!recorded) {
    // Synchronous reconciliation may apply and delete the row before this
    // queued message runs. Reporting this exact identity as complete is safe;
    // the controller already released it and ignores the stale success.
    return null;
  }
  assertExactMessage(recorded, message);
  return sqliteStore.applyPersistenceOperation(
    message.operationId,
    message.table,
  );
}

parentPort.on("message", (msg) => {
  if (!msg || typeof msg !== "object") {
    return;
  }
  switch (msg.type) {
    case "write": {
      try {
        const applied = applyWrite(msg);
        parentPort.postMessage({
          type: "write-complete",
          operationId: msg.operationId,
          table: msg.table,
          reconciled: applied === null,
        });
      } catch (error) {
        reportWriteError(msg, error);
      } finally {
        complete();
      }
      break;
    }
    case "reconciled": {
      if (
        Number.isSafeInteger(msg.operationId) &&
        typeof msg.table === "string" &&
        blockedByTable.get(msg.table) === msg.operationId
      ) {
        blockedByTable.delete(msg.table);
      }
      break;
    }
    case "close": {
      let closeError = null;
      try {
        sqliteStore.close();
      } catch (error) {
        closeError = error && error.message ? error.message : String(error);
      }
      try {
        parentPort.postMessage({ type: "closed", error: closeError });
      } finally {
        // Closing the port lets a successfully closed worker exit naturally.
        // The main thread only calls terminate() as an explicit fallback.
        parentPort.close();
      }
      break;
    }
    default:
      break;
  }
});
