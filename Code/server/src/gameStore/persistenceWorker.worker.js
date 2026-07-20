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
 * This file is the FIRST worker_threads use in the repo. It is intentionally
 * tiny and reuses sqliteStore.applyChanges so the on-disk write path is byte-for
 * byte identical to the in-process path it replaces — only the thread differs.
 */

"use strict";

const { parentPort, workerData } = require("worker_threads");
const sqliteStore = require("./sqliteStore");

const counter = new Int32Array(workerData.sharedBuffer);

// This worker's private connection to the shared WAL database.
sqliteStore.init(workerData.dbPath);

function complete() {
  // One unit of work finished (committed or failed). Decrement and wake any
  // main-thread drainer blocked in Atomics.wait.
  Atomics.sub(counter, 0, 1);
  Atomics.notify(counter, 0);
}

parentPort.on("message", (msg) => {
  if (!msg || typeof msg !== "object") {
    return;
  }
  switch (msg.type) {
    case "write": {
      try {
        sqliteStore.applyChanges(msg.table, msg.upserts || [], msg.deletes || []);
      } catch (error) {
        // Report the failure so the main thread can re-mark the table dirty and
        // force a full re-send (its baseline was advanced optimistically).
        parentPort.postMessage({
          type: "error",
          table: msg.table,
          error: error && error.message ? error.message : String(error),
        });
      } finally {
        complete();
      }
      break;
    }
    case "close": {
      try {
        sqliteStore.close();
      } finally {
        parentPort.postMessage({ type: "closed" });
      }
      break;
    }
    default:
      break;
  }
});
