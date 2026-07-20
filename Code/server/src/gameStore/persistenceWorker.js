/**
 * PERSISTENCE WORKER (main-thread handle):
 *
 * Routes SQLite flush writes to an off-loop worker_thread (persistenceWorker.
 * worker.js) so the synchronous better-sqlite3 transaction stops stalling the
 * 10 Hz simulation loop. The diff (which rows changed) is still computed on the
 * main thread in gameStore/index.js — only the durable write is offloaded.
 *
 * REVERSIBILITY: disabled by default. Enable with EVEJS_PERSISTENCE_WORKER=1.
 * When disabled, gameStore writes stay on the proven in-process synchronous path
 * (this module's submitWrite is never called). When enabled, the seam is:
 *   - async debounced flush  -> submitWrite(..., { sync: false })  (fire-and-forget)
 *   - flushTableSync / shutdown -> submitWrite(..., { sync: true }) then drain()
 *
 * The worker is the SOLE runtime writer when enabled, so there is never more
 * than one writer racing on the DB. The main thread keeps a read connection
 * (preload / lazy load); startup seeding (replaceAll) completes before the
 * worker is ever spawned (it spawns lazily on the first write).
 */

"use strict";

const path = require("path");
const { Worker } = require("worker_threads");

const WORKER_PATH = path.join(__dirname, "persistenceWorker.worker.js");
// Generous ceiling for a synchronous drain. The worker queue is short-lived
// (a handful of changed-row batches); this only guards against a wedged worker
// so shutdown can never hang forever.
const DRAIN_TIMEOUT_MS = 10000;

let worker = null;
let counter = null; // Int32Array(1) over a SharedArrayBuffer: in-flight write count
let onErrorCallback = null;

function isEnabled() {
  return process.env.EVEJS_PERSISTENCE_WORKER === "1";
}

function isActive() {
  return worker !== null;
}

// Register a callback invoked (on the main thread) when a worker write fails, so
// the caller can re-mark the table dirty and force a full re-send.
function onError(callback) {
  onErrorCallback = typeof callback === "function" ? callback : null;
}

function ensureWorker(dbPath) {
  if (worker) {
    return;
  }
  const sharedBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  counter = new Int32Array(sharedBuffer);
  worker = new Worker(WORKER_PATH, {
    workerData: { dbPath, sharedBuffer },
  });
  worker.on("message", (msg) => {
    if (msg && msg.type === "error" && onErrorCallback) {
      onErrorCallback(msg.table, msg.error);
    }
  });
  worker.on("error", (error) => {
    // A crashed worker would otherwise silently drop writes. Surface it; the
    // process-level handlers/logs make this visible. Reset so a later write can
    // respawn a fresh worker rather than wedging on a dead handle.
    if (onErrorCallback) {
      onErrorCallback(null, `persistence worker crashed: ${error.message}`);
    }
    worker = null;
    counter = null;
  });
  // Do not keep the process alive for the worker's sake; graceful shutdown
  // drains explicitly via drain(). Without this, a live worker would block
  // process exit (notably in test processes).
  worker.unref();
}

/**
 * Hand a computed flush diff to the worker. Returns immediately for async
 * flushes; for sync flushes (sync: true) it blocks until the worker has applied
 * every outstanding write (Atomics.wait drain), so callers keep their previous
 * synchronous durability guarantee.
 */
function submitWrite(dbPath, table, upserts, deletes, options = {}) {
  ensureWorker(dbPath);
  Atomics.add(counter, 0, 1);
  worker.postMessage({ type: "write", table, upserts, deletes });
  if (options.sync === true) {
    drain();
  }
}

/**
 * Synchronously block the main thread until the worker has drained every
 * in-flight write. Safe to call from shutdown / process 'exit' handlers because
 * the worker runs on its own OS thread and keeps processing while we wait.
 */
function drain() {
  if (!counter) {
    return;
  }
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (true) {
    const pending = Atomics.load(counter, 0);
    if (pending <= 0) {
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // Worker is wedged or dead; stop waiting rather than hang the process.
      return;
    }
    Atomics.wait(counter, 0, pending, remaining);
  }
}

/**
 * Drain, close the worker's DB connection, and terminate the thread. Used by
 * tests; production relies on drain() at shutdown plus the unref'd worker.
 */
async function shutdown() {
  if (!worker) {
    return;
  }
  drain();
  const current = worker;
  worker = null;
  counter = null;
  onErrorCallback = null;
  await new Promise((resolve) => {
    const finish = () => resolve();
    current.once("message", (msg) => {
      if (msg && msg.type === "closed") {
        finish();
      }
    });
    current.postMessage({ type: "close" });
    // Fallback: never hang teardown if the close ack is lost.
    setTimeout(finish, 1000).unref();
  });
  await current.terminate();
}

module.exports = {
  isEnabled,
  isActive,
  onError,
  submitWrite,
  drain,
  shutdown,
};
