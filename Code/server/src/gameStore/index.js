/**
 * DATABASE CONTROLLER:
 * In-memory cached database layer.
 *
 * All tables are loaded into memory at startup. Reads are served
 * instantly from the cache. Writes update the cache immediately and
 * schedule a debounced flush to disk so hot write paths stay cheap while the
 * on-disk JSON files are still written through a safer recovery-friendly path.
 *
 * The public API (read / write / remove) is unchanged — every
 * consumer in the codebase works without modification.
 */

const path = require("path");
const fs = require("fs");
const { isDeepStrictEqual } = require("util");
const pc = require("picocolors");

const log = require("../utils/logger");
const sqliteStore = require("./sqliteStore");
const persistenceWorker = require("./persistenceWorker");

// ── Config ──────────────────────────────────────────────────────────
const SOURCE_DATA_DIR = path.join(__dirname, "data");
const LOCAL_DATABASE_ROOT = path.resolve(__dirname, "../../..", "_local", "gameStore");
const LOCAL_DATA_DIR = path.join(LOCAL_DATABASE_ROOT, "data");
const TEST_STORE_ATTESTATION_FILE = ".evejs-test-store-attestation.json";
const CANONICAL_TEST_COMMAND = "npm run test:isolated -- server/tests/<file>.test.js";
const TEST_STORE_CLEANUP_SYMBOL = Symbol.for("evejs.testStore.cleanupHooksInstalled");
const TEST_STORE_CLEANUP_IN_PROGRESS_SYMBOL = Symbol.for("evejs.testStore.cleanupInProgress");

function realpathExisting(filePath) {
  const resolved = path.resolve(filePath);
  const missingSegments = [];
  let existingCandidate = resolved;

  while (true) {
    try {
      return path.resolve(
        fs.realpathSync.native(existingCandidate),
        ...missingSegments,
      );
    } catch (_) {
      const parent = path.dirname(existingCandidate);
      if (parent === existingCandidate) {
        return resolved;
      }
      missingSegments.unshift(path.basename(existingCandidate));
      existingCandidate = parent;
    }
  }
}

function samePath(left, right) {
  return path.resolve(realpathExisting(left)) === path.resolve(realpathExisting(right));
}

function isSubpath(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  const resolvedLeft = realpathExisting(left);
  const resolvedRight = realpathExisting(right);
  return isSubpath(resolvedLeft, resolvedRight) || isSubpath(resolvedRight, resolvedLeft);
}

function protectedGameStoreRoots(attestation = null) {
  return [
    LOCAL_DATABASE_ROOT,
    path.resolve(SOURCE_DATA_DIR, ".."),
    process.env.EVEJS_TEST_STORE_BASELINE_ROOT,
    attestation && attestation.baselineRoot,
  ].filter(Boolean);
}

function isNodeTestLaunchFlag(arg) {
  const value = String(arg || "");
  return value === "--test" || value === "--test=true";
}

function isCurrentNodeTestRunnerProcess() {
  return Boolean(
    process.env.NODE_TEST_CONTEXT ||
      process.env.NODE_TEST_WORKER_ID ||
      process.execArgv.some(isNodeTestLaunchFlag),
  );
}

function verifyNodeTestStoreAttestation() {
  const dataDir = process.env.EVEJS_GAMESTORE_DATA_DIR;
  const storeRoot = process.env.EVEJS_TEST_STORE_ROOT;
  if (
    process.env.EVEJS_TEST_STORE_ISOLATED !== "1" ||
    !dataDir ||
    !storeRoot
  ) {
    return false;
  }
  const attestationPath = path.resolve(
    process.env.EVEJS_TEST_STORE_ATTESTATION ||
      path.join(storeRoot, TEST_STORE_ATTESTATION_FILE),
  );
  if (!fs.existsSync(attestationPath)) {
    return false;
  }
  if (!isSubpath(realpathExisting(attestationPath), realpathExisting(storeRoot))) {
    return false;
  }
  if (!samePath(dataDir, path.join(storeRoot, "data"))) {
    return false;
  }
  if (!isSubpath(realpathExisting(dataDir), realpathExisting(storeRoot))) {
    return false;
  }
  try {
    const attestation = JSON.parse(fs.readFileSync(attestationPath, "utf8"));
    const attested =
      attestation.schemaVersion === 1 &&
      attestation.kind === "evejs-test-store" &&
      attestation.createdBy === "server/tests/helpers/isolatedGameStore.js" &&
      samePath(attestation.storeRoot, storeRoot) &&
      samePath(attestation.dataDir, dataDir);
    if (!attested) {
      return false;
    }
    const storeRealpath = realpathExisting(storeRoot);
    const dataRealpath = realpathExisting(dataDir);
    return !protectedGameStoreRoots(attestation).some((protectedRoot) =>
      pathsOverlap(storeRealpath, protectedRoot) || isSubpath(dataRealpath, realpathExisting(protectedRoot)));
  } catch (_) {
    return false;
  }
}

function assertNodeTestIsolationBeforeOpen() {
  if (!isCurrentNodeTestRunnerProcess()) {
    return;
  }
  if (verifyNodeTestStoreAttestation()) {
    return;
  }
  throw new Error(
    "Refusing to import server/src/gameStore in an unisolated node:test process. " +
      `Use the isolated runner before product imports: ${CANONICAL_TEST_COMMAND}`,
  );
}

function resolveDataDir() {
  assertNodeTestIsolationBeforeOpen();
  if (process.env.EVEJS_GAMESTORE_DATA_DIR) {
    return path.resolve(process.env.EVEJS_GAMESTORE_DATA_DIR);
  }
  if (
    fs.existsSync(path.join(LOCAL_DATABASE_ROOT, "manifest.json")) ||
    fs.existsSync(LOCAL_DATA_DIR)
  ) {
    return LOCAL_DATA_DIR;
  }
  return SOURCE_DATA_DIR;
}

const DATA_DIR = resolveDataDir();
const FLUSH_DELAY_MS = 2000; // debounce: flush 2s after last write
const RECOVERABLE_EMPTY_TABLES = new Set([
  "npcRuntimeState",
  "npcControlState",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcWrecks",
  "npcWreckItems",
  "wormholeRuntimeState",
  "probeRuntimeState",
  "dungeonRuntimeState",
  "missionRuntimeState",
  "planetRuntimeState",
  "planetOrbitalState",
]);
// ────────────────────────────────────────────────────────────────────

// ── SQLite-backed tables (incremental migration off per-table JSON) ──
// Tables listed here persist to a single SQLite database — one SQL table
// each, keyed by top-level entity — instead of a data.json file. Reads and
// writes still flow through the in-memory cache and the same public API;
// only the durable backend differs. To migrate a table: add its name here
// and run migrateJsonToSqlite.js to seed its existing rows.
const SQLITE_TABLES = new Set([
  // First wave: clean flat {id → record} maps.
  "skillPlans",
  "skillQueues",
  "skillTradingState",
  "skills",
  "characters",
  "items",
  "raffles",
  "marketEscrow",
  // Second wave: remaining runtime tables not persistence-tested via data.json.
  "corporationRuntime",
  "alliances",
  "bookmarkFolders",
  "bookmarkGroups",
  "bookmarkKnownFolders",
  "bookmarks",
  "calendarEvents",
  "calendarResponses",
  "characterEnergyState",
  "corporationBills",
  "corporationGoals",
  "industryBlueprintState",
  "industryRuntime",
  "insuranceContracts",
  "killRights",
  "killmails",
  "mail",
  "mapTelemetry",
  "moduleGroupingState",
  "notifications",
  "npcEntities",
  "npcModules",
  "npcRuntimeControllers",
  "planetOrbitalState",
  "planetRuntimeState",
  "playerBounties",
  "rafflesRuntime",
  "savedFittings",
  "shipCosmetics",
  "solarSystemInterferenceState",
  "structurePaintwork",
  "structureProfiles",
  "structureTetherRestrictions",
  "structures",
  "wormholeRuntimeState",
  // Third wave: empty / created-on-demand runtime tables (no legacy rows yet).
  "accessGroups",
  "bookmarkRuntimeState",
  "bookmarkSubfolders",
  "characterExpertSystems",
  "characterNotes",
  "corpSkillPlans",
  "corporationVotes",
  "evermarkEntitlements",
  "industryFacilityState",
  "industryJobs",
  "lpWallets",
  "marketRuntime",
  "miningLedger",
  "newEdenStore",
  "newEdenStoreRuntime",
  "npcControlState",
  "npcRuntimeState",
  "npcSpawnSites",
  "pendingNpcBounties",
  "probeRuntimeState",
  "reprocessingFacilityState",
  "sharedBookmarkFolders",
  "shipLogoFittings",
  "structureAssetSafety",
  // Fourth wave: tables that appear in persistence-style tests (verified the
  // tests seed via data.json fixtures / assert via the service, not by reading
  // the file back, so auto-seed keeps them green).
  "shipDirt",
  "shipKillCounters",
  // Tables whose tests save/restore the source data.json or read it read-only
  // for report parity — both unaffected because the source file is untouched.
  "moonExtractions",
  "overviewSharedPresets",
  "sharedSettings",
  "sovereignty",
  "dungeonRuntimeState",
  "miningRuntimeState",
  "missionRuntimeState",
  // Final pair: accountLoginPersistenceParity now proves persistence by reading
  // the SQLite row back instead of the legacy data.json file.
  "accounts",
  "identityState",
  // Backfill (2026-06-25): runtime tables missed by the earlier waves. They
  // share the exact persistence path as their already-migrated siblings —
  // npcCargo/npcWrecks/npcWreckItems go through nativeNpcStore like
  // npcEntities/npcModules; corporations through corporationState like
  // corporationRuntime/alliances — and were simply never added. Seed existing
  // rows with: node src/gameStore/migrateJsonToSqlite.js <table...>
  "npcCargo",
  "npcWrecks",
  "npcWreckItems",
  "corporations",
  // Chat runtime state previously lived in _secondary/data/chat JSON/JSONL
  // sidecars. Keep it in the same SQLite runtime backend as the rest of the
  // mutable world state.
  "chatState",
  "chatStaticContracts",
  "chatBacklog",
  "contractRuntime",
]);
const SQLITE_DB_PATH = path.resolve(DATA_DIR, "..", "gamestore.sqlite");
let sqliteRecoveryRequired = true;
let persistenceCallbacksReady = false;
function ensureSqliteReady() {
  if (SQLITE_TABLES.size > 0 && sqliteStore.getDatabasePath() !== SQLITE_DB_PATH) {
    sqliteStore.init(SQLITE_DB_PATH);
    sqliteRecoveryRequired = true;
  }
  if (SQLITE_TABLES.size > 0 && sqliteRecoveryRequired) {
    // Clear the recursion guard before a recovery callback rebuilds a baseline
    // from this same connection. On initial module load there cannot yet be an
    // in-memory flight, so direct recovery is correct; after callback wiring,
    // route reopen recovery through the controller so its exact table leases and
    // the index's in-flight baseline are released together.
    sqliteRecoveryRequired = false;
    let recovered;
    try {
      recovered = persistenceCallbacksReady
        ? persistenceWorker.recover(SQLITE_DB_PATH)
        : sqliteStore.recoverPersistenceOperations();
    } catch (error) {
      // The controller retains any already-committed recovery batch when its
      // baseline callback fails, so the next readiness check can safely retry
      // exact callback delivery even though SQLite has no remaining outbox row.
      sqliteRecoveryRequired = true;
      throw error;
    }
    if (recovered.length > 0) {
      dbWarn(
        `recovered ${recovered.length} unacknowledged persistence operation` +
          (recovered.length === 1 ? "" : "s") +
          " before loading SQLite baselines",
      );
    }
  }
}

if (SQLITE_TABLES.size > 0) {
  ensureSqliteReady();
}

function isSqliteTable(table) {
  return SQLITE_TABLES.has(table);
}
// ────────────────────────────────────────────────────────────────────

// ── Cache state ─────────────────────────────────────────────────────
const cache = {};            // table name → parsed JS object
const dirty = new Set();     // tables that need flushing
const flushTimers = {};      // table name → pending setTimeout id
const transientPaths = {};   // table name → Set of cache paths excluded from disk flush
const flushBaselines = {};   // sqlite table → Map(key → last-persisted JSON string)
const inFlightFlushes = new Map(); // sqlite table → exact unacknowledged operation
const lastCompletedPersistenceOperationId = new Map(); // table → durable monotonic ID
let preloaded = false;

// ── Dirty-row tracking (flush fast path) ────────────────────────────
// Default ON (opt out with EVEJS_GAMESTORE_DIRTY_ROWS=0, which restores the
// whole-table re-serialize path). Path-scoped writes record exactly which
// stored row they touched, so flushSqliteTable re-serializes only those rows —
// turning a whole-table re-stringify (e.g. wormhole ~15ms) into O(changed rows)
// (measured ~280x: 19.55ms -> 0.07ms on a 3063-pair wormhole flush). Anything
// that can't be cleanly localized (root writes, whole-group writes, transient
// paths) sets fullDirty and falls back to the exact full diff, so the fast path
// is never less correct. Caveat: an in-place cache mutation NOT followed by a
// localizing write to that same row would be missed (the full path catches it
// by re-serializing everything); Phase 0.5 swept in-place mutations, which is
// why this stayed opt-in through validation before defaulting on.
const DIRTY_ROWS_TRACKING = process.env.EVEJS_GAMESTORE_DIRTY_ROWS !== "0";
const dirtyRowKeys = {};     // sqlite table → Set(rowKey) touched since last flush
const fullDirty = new Set(); // sqlite tables that must use the full diff next flush
const flushStats = { partial: 0, full: 0 }; // observability for tests/diagnostics
// ────────────────────────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────

function dbTag() {
  return pc.bgGreen(pc.black(" DB  "));
}

function timestamp() {
  return pc.dim(new Date().toISOString().slice(11, 19));
}

function dbLog(message) {
  console.log(`${timestamp()} ${dbTag()} ${message}`);
}

function dbWarn(message) {
  console.log(`${timestamp()} ${dbTag()} ${pc.yellow(message)}`);
}

function dbErr(message) {
  console.error(`${timestamp()} ${dbTag()} ${pc.red(message)}`);
}

function dataFilePath(table) {
  return path.join(DATA_DIR, table, "data.json");
}

function backupFilePath(table) {
  return `${dataFilePath(table)}.bak`;
}

function tempFilePath(filePath) {
  return `${filePath}.tmp-${process.pid}`;
}

function isSameValue(left, right) {
  if (left === right) {
    return true;
  }
  return isDeepStrictEqual(left, right);
}

function getSegments(pathKey) {
  return String(pathKey || "/").split("/").filter(Boolean);
}

function normalizeTransientPath(pathKey) {
  const segments = getSegments(pathKey);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function getTransientPathSet(table) {
  if (!transientPaths[table]) {
    transientPaths[table] = new Set();
  }
  return transientPaths[table];
}

function clearTransientPathsForPrefix(table, pathKey) {
  const normalizedPath = normalizeTransientPath(pathKey);
  const pathSet = transientPaths[table];
  if (!pathSet || pathSet.size === 0) {
    return;
  }

  for (const candidatePath of [...pathSet]) {
    if (
      candidatePath === normalizedPath ||
      candidatePath.startsWith(`${normalizedPath}/`)
    ) {
      pathSet.delete(candidatePath);
    }
  }
}

function setTransientPath(table, pathKey, enabled = true) {
  const normalizedPath = normalizeTransientPath(pathKey);
  const pathSet = getTransientPathSet(table);
  if (enabled) {
    pathSet.add(normalizedPath);
  } else {
    clearTransientPathsForPrefix(table, normalizedPath);
  }
}

function cloneForFlush(value) {
  return JSON.parse(JSON.stringify(value));
}

function deletePath(target, pathKey) {
  const segments = getSegments(pathKey);
  if (segments.length === 0) {
    return {};
  }

  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (
      current === null ||
      typeof current !== "object" ||
      !(segment in current)
    ) {
      return target;
    }
    current = current[segment];
  }

  const finalKey = segments[segments.length - 1];
  if (current && typeof current === "object" && finalKey in current) {
    delete current[finalKey];
  }
  return target;
}

function buildFlushSnapshot(table) {
  const source = cache[table];
  const pathSet = transientPaths[table];
  if (!pathSet || pathSet.size === 0) {
    return source;
  }

  const snapshot = cloneForFlush(source);
  for (const transientPath of pathSet) {
    deletePath(snapshot, transientPath);
  }
  return snapshot;
}

function ensureDataFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
}

function safeWriteFileSync(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = tempFilePath(filePath);
  fs.writeFileSync(temporaryPath, contents, "utf8");
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch (error) {
      dbWarn(`backup copy failed for ${path.basename(filePath)}: ${error.message}`);
    }
  }
  fs.copyFileSync(temporaryPath, filePath);
  fs.unlinkSync(temporaryPath);
}

function readParsedJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (String(raw || "").trim().length === 0) {
      return {
        success: false,
        raw,
        error: new SyntaxError("Unexpected end of JSON input"),
      };
    }
    return {
      success: true,
      raw,
      data: JSON.parse(raw),
    };
  } catch (error) {
    return {
      success: false,
      raw: null,
      error,
    };
  }
}

function getRecoveryCandidates(table) {
  const filePath = dataFilePath(table);
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const candidates = [];
  const backupPath = backupFilePath(table);
  if (fs.existsSync(backupPath)) {
    candidates.push(backupPath);
  }
  if (fs.existsSync(directory)) {
    const tempCandidates = fs.readdirSync(directory)
      .filter((name) => name.startsWith(`${baseName}.tmp-`))
      .map((name) => path.join(directory, name))
      .sort((left, right) => {
        try {
          return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
        } catch (error) {
          return 0;
        }
      });
    candidates.push(...tempCandidates);
  }
  return candidates;
}

function tryRecoverTableFile(table) {
  const filePath = dataFilePath(table);
  for (const candidatePath of getRecoveryCandidates(table)) {
    const parsedCandidate = readParsedJsonFile(candidatePath);
    if (!parsedCandidate.success) {
      continue;
    }
    cache[table] = parsedCandidate.data;
    safeWriteFileSync(filePath, parsedCandidate.raw);
    dbWarn(`recovered ${table} from ${path.basename(candidatePath)}`);
    return Buffer.byteLength(parsedCandidate.raw, "utf8");
  }
  return null;
}

// ── Cache loading ───────────────────────────────────────────────────

// If a legacy data.json with content exists for a not-yet-migrated table, hand
// it back so loadSqliteTable can seed SQLite from it once.
function readLegacyJsonSeed(table) {
  const filePath = dataFilePath(table);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = readParsedJsonFile(filePath);
  if (parsed.success && parsed.data && typeof parsed.data === "object") {
    return parsed.data;
  }
  return null;
}

function loadSqliteTable(table) {
  ensureSqliteReady();
  // First load only: seed from the legacy data.json (if any), then record the
  // migration so future loads read SQLite alone and deletions stay deleted.
  if (!sqliteStore.isMigrated(table)) {
    const seed = readLegacyJsonSeed(table);
    if (seed && Object.keys(seed).length > 0) {
      sqliteStore.replaceAll(table, seed);
    }
    sqliteStore.markMigrated(table);
  }
  // Build the cache (assembled) and the flush baseline (one entry per stored
  // row) from the raw rows, so the baseline keys line up with what
  // flushSqliteTable diffs — including per-entity rows for wrapper tables.
  const rawRows = sqliteStore.loadRows(table);
  const parsedRows = {};
  const baseline = new Map();
  let bytes = 0;
  for (const { key, json } of rawRows) {
    const value = JSON.parse(json);
    parsedRows[key] = value;
    const serialized = JSON.stringify(value); // re-stringify for a stable diff
    baseline.set(key, serialized);
    bytes += serialized.length;
  }
  cache[table] = sqliteStore.assembleFromRows(table, parsedRows);
  flushBaselines[table] = baseline;
  return bytes;
}

function loadTable(table) {
  if (isSqliteTable(table)) {
    return loadSqliteTable(table);
  }
  const filePath = dataFilePath(table);
  ensureDataFile(filePath);
  const parsedMain = readParsedJsonFile(filePath);
  if (parsedMain.success) {
    cache[table] = parsedMain.data;
    return Buffer.byteLength(parsedMain.raw, "utf8");
  }

  if (
    RECOVERABLE_EMPTY_TABLES.has(table) &&
    String(parsedMain.raw || "").trim().length === 0
  ) {
    cache[table] = {};
    safeWriteFileSync(filePath, JSON.stringify({}, null, 2));
    dbWarn(`recovered empty ${table} table with default {}`);
    return 2;
  }

  const recoveredBytes = tryRecoverTableFile(table);
  if (recoveredBytes !== null) {
    return recoveredBytes;
  }

  throw parsedMain.error;
}

/**
 * Preload every table directory under data/ into memory.
 * Called once at startup before the TCP server accepts connections.
 */
function preloadAll() {
  if (preloaded) return;
  preloaded = true;

  const totalStart = Date.now();
  // First run / fresh container: the data directory may not exist yet.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  const tables = entries
    .filter((e) => e.isDirectory() && fs.existsSync(dataFilePath(e.name)))
    .map((e) => e.name);

  // SQLite-backed tables may not have a data.json directory; ensure they load.
  for (const sqliteTable of SQLITE_TABLES) {
    if (!tables.includes(sqliteTable)) {
      tables.push(sqliteTable);
    }
  }

  dbLog(`preloading ${tables.length} tables into memory...`);

  let totalBytes = 0;
  const timings = [];

  for (const table of tables) {
    const t0 = Date.now();
    const bytes = loadTable(table);
    const elapsed = Date.now() - t0;
    totalBytes += bytes;
    timings.push({ table, bytes, elapsed });
  }

  const totalElapsed = Date.now() - totalStart;

  // Log per-table, sorted slowest first
  timings.sort((a, b) => b.elapsed - a.elapsed);
  for (const { table, bytes, elapsed } of timings) {
    const sizeMB = (bytes / 1024 / 1024).toFixed(1);
    const name = table.padEnd(25);
    const time = String(elapsed).padStart(5) + "ms";
    const size = `(${sizeMB} MB)`.padStart(11);
    dbLog(`  ${pc.cyan(name)} ${pc.white(time)}  ${pc.dim(size)}`);
  }

  const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
  dbLog(
    `${pc.green("cache ready")} — ${tables.length} tables, ` +
    `${totalMB} MB loaded in ${pc.bold(totalElapsed + "ms")}`,
  );
}

// ── Debounced async flush ───────────────────────────────────────────

function advanceFlushBaseline(table, upserts = [], deletes = []) {
  let baseline = flushBaselines[table];
  if (!baseline) {
    baseline = new Map();
    flushBaselines[table] = baseline;
  }
  for (const [rowKey, serialized] of upserts) {
    baseline.set(rowKey, serialized);
  }
  for (const rowKey of deletes) {
    baseline.delete(rowKey);
  }
}

function rebuildFlushBaselineFromDisk(table) {
  ensureSqliteReady();
  const baseline = new Map();
  for (const { key, json } of sqliteStore.loadRows(table)) {
    baseline.set(key, JSON.stringify(JSON.parse(json)));
  }
  flushBaselines[table] = baseline;
}

function handlePersistenceWorkerAcknowledged(operation) {
  if (!operation || !operation.table || operation.operationId === undefined) {
    throw new Error("persistence worker returned an invalid durable acknowledgment");
  }
  const inFlight = inFlightFlushes.get(operation.table);
  if (!inFlight) {
    if (
      operation.operationId <=
      (lastCompletedPersistenceOperationId.get(operation.table) || 0)
    ) {
      return;
    }
    throw new Error(
      `unexpected persistence acknowledgment ${operation.operationId} for ${operation.table}`,
    );
  }
  if (inFlight.operationId !== operation.operationId) {
    throw new Error(
      `stale persistence acknowledgment ${operation.operationId} cannot resolve ` +
        `${inFlight.operationId} for ${operation.table}`,
    );
  }

  advanceFlushBaseline(operation.table, inFlight.upserts, inFlight.deletes);
  inFlightFlushes.delete(operation.table);
  lastCompletedPersistenceOperationId.set(operation.table, operation.operationId);

  // Mutations made after this batch was captured kept their dirty-row keys.
  // Once the acknowledged baseline is current, let their normal debounce run.
  if (
    dirty.has(operation.table) &&
    !flushTimers[operation.table] &&
    process[TEST_STORE_CLEANUP_IN_PROGRESS_SYMBOL] !== true
  ) {
    scheduleFlush(operation.table);
  }
}

function handlePersistenceWorkerRecovered(operations = []) {
  if (!Array.isArray(operations)) {
    throw new Error("persistence recovery callback must provide an operation array");
  }
  const recoveredTables = [];
  for (const operation of operations) {
    if (!operation || !operation.table || operation.operationId === undefined) {
      throw new Error("persistence recovery callback contained an invalid operation");
    }
    const inFlight = inFlightFlushes.get(operation.table);
    if (inFlight) {
      if (inFlight.operationId !== operation.operationId) {
        throw new Error(
          `stale recovery ${operation.operationId} cannot resolve ` +
            `${inFlight.operationId} for ${operation.table}`,
        );
      }
      advanceFlushBaseline(operation.table, inFlight.upserts, inFlight.deletes);
      inFlightFlushes.delete(operation.table);
    } else if (
      operation.operationId >
      (lastCompletedPersistenceOperationId.get(operation.table) || 0)
    ) {
      // Controller recovery can happen after cache construction without a
      // surviving in-memory in-flight record. Rebuild successfully before the
      // operation is considered reconciled.
      rebuildFlushBaselineFromDisk(operation.table);
    }
    lastCompletedPersistenceOperationId.set(
      operation.table,
      Math.max(
        operation.operationId,
        lastCompletedPersistenceOperationId.get(operation.table) || 0,
      ),
    );
    recoveredTables.push(operation.table);
  }
  for (const table of new Set(recoveredTables)) {
    if (
      dirty.has(table) &&
      !flushTimers[table] &&
      process[TEST_STORE_CLEANUP_IN_PROGRESS_SYMBOL] !== true
    ) {
      scheduleFlush(table);
    }
  }
}

// Persist a SQLite-backed table by diffing its current cache state against
// the last-persisted baseline and upserting/deleting only the rows that
// actually changed — no whole-table rewrite.
function flushSqliteTable(table, options = {}) {
  ensureSqliteReady();
  if (
    persistenceWorker.isEnabled() &&
    !persistenceWorker.isActive() &&
    inFlightFlushes.size > 0
  ) {
    // A replacement controller/worker must reconcile the prior durable journal
    // before a new batch is created. This is triggered by the next real flush,
    // not by a broad autonomous retry scheduler (PST-002 remains separate).
    persistenceWorker.recover(SQLITE_DB_PATH);
  }
  if (inFlightFlushes.has(table)) {
    // Per-table single-flight is part of the persistence protocol. A second
    // diff against the still-unacknowledged baseline could omit a tombstone
    // (for example, insert then delete before the first acknowledgment).
    dirty.add(table);
    return 0;
  }
  const snapshot = buildFlushSnapshot(table) || {};
  let baseline = flushBaselines[table];
  if (!baseline) {
    baseline = new Map();
    flushBaselines[table] = baseline;
  }

  const trackedKeys = dirtyRowKeys[table];
  // Fast path: only when dirty-row tracking is on, the touched rows were all
  // cleanly localized (no fullDirty marker), AND no transient paths are active
  // (those reshape the flush snapshot, so the changed-row set can't be trusted).
  const usePartial =
    DIRTY_ROWS_TRACKING &&
    trackedKeys &&
    !fullDirty.has(table) &&
    !(transientPaths[table] && transientPaths[table].size > 0);

  const upserts = [];
  const deletes = [];

  if (usePartial) {
    // Re-serialize ONLY the rows write()/remove() recorded as touched. Each
    // tracked key resolves directly to its stored value (or undefined => the row
    // was removed) via rowValueForKey, which mirrors explodeToRows exactly.
    for (const rowKey of trackedKeys) {
      const value = sqliteStore.rowValueForKey(table, snapshot, rowKey);
      if (value === undefined) {
        if (baseline.has(rowKey)) {
          deletes.push(rowKey);
        }
        continue;
      }
      const serialized = JSON.stringify(value);
      if (baseline.get(rowKey) !== serialized) {
        upserts.push([rowKey, serialized]);
      }
    }
    flushStats.partial += 1;
  } else {
    // Full diff (default / fallback): flatten the whole table to its stored rows
    // and diff every one against the baseline. We re-serialize every row because
    // a root write("/") can't tell write() which entity changed — the diff finds
    // it. The disk write (the expensive part) is already minimal; this is CPU
    // only, on a 2s debounce.
    const rows = sqliteStore.explodeToRows(table, snapshot);
    const present = new Set();
    for (const rowKey of Object.keys(rows)) {
      present.add(rowKey);
      const serialized = JSON.stringify(rows[rowKey]);
      if (baseline.get(rowKey) !== serialized) {
        upserts.push([rowKey, serialized]);
      }
    }
    for (const rowKey of baseline.keys()) {
      if (!present.has(rowKey)) {
        deletes.push(rowKey);
      }
    }
    flushStats.full += 1;
  }

  if (upserts.length === 0 && deletes.length === 0) {
    fullDirty.delete(table);
    delete dirtyRowKeys[table];
    return 0;
  }

  // The journal INSERT is synchronous by design: the exact batch and its
  // AUTOINCREMENT identity must be durable before dirty tracking is released or
  // any asynchronous worker can observe the operation.
  const operation = sqliteStore.enqueuePersistenceOperation(table, upserts, deletes);
  const useWorker = persistenceWorker.isEnabled() && options.sync !== true;
  inFlightFlushes.set(table, { ...operation, submittedToWorker: useWorker });
  fullDirty.delete(table);
  delete dirtyRowKeys[table];

  // A synchronous caller may block, so it reconciles the journal directly on
  // the main connection. Async writes retain the outbox row until the matching
  // worker acknowledgment is durably consumed.
  if (useWorker) {
    try {
      persistenceWorker.submitWrite(SQLITE_DB_PATH, table, upserts, deletes, {
        operationId: operation.operationId,
      });
    } catch (error) {
      // The exact journal row and in-flight record deliberately remain intact.
      // Startup or an explicit synchronous reconciliation can replay it without
      // substituting an approximate full-state diff.
      throw error;
    }
  } else {
    try {
      const reconciled = sqliteStore.reconcilePersistenceOperation(
        operation.operationId,
        table,
      );
      if (!reconciled) {
        throw new Error(
          `persistence operation ${operation.operationId} disappeared before reconciliation`,
        );
      }
    } catch (error) {
      // The journal remains authoritative if the transaction rolled back.
      throw error;
    }
    advanceFlushBaseline(table, operation.upserts, operation.deletes);
    inFlightFlushes.delete(table);
  }
  return upserts.length + deletes.length;
}

// A failed or uncertain worker operation stays single-flight and journaled.
// Never replace it with a full-state diff: only its exact tombstones/upserts are
// safe to reconcile, either synchronously or during startup recovery.
function handlePersistenceWorkerError(table, error, failure) {
  dbErr(`persistence worker write failed${table ? ` for ${table}` : ""}: ${error}`);
  if (failure && table) {
    const inFlight = inFlightFlushes.get(table);
    if (inFlight && inFlight.operationId !== failure.operationId) {
      dbWarn(
        `ignored failure ${failure.operationId} while ${inFlight.operationId} is in flight for ${table}`,
      );
    }
  }
}
persistenceWorker.onAcknowledged(handlePersistenceWorkerAcknowledged);
persistenceWorker.onRecovered(handlePersistenceWorkerRecovered);
persistenceWorker.onError(handlePersistenceWorkerError);
persistenceCallbacksReady = true;

// Record which stored row a successful write/remove touched, for the flush fast
// path. Conservative: anything that can't be mapped to a single localizable row
// (root writes, whole-group writes, an empty path) marks the table fullDirty so
// the next flush uses the exact full diff. No-op when tracking is disabled or
// the table is not SQLite-backed.
function markRowDirty(table, segments) {
  if (!DIRTY_ROWS_TRACKING || !isSqliteTable(table)) {
    return;
  }
  if (fullDirty.has(table)) {
    return;
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    fullDirty.add(table); // root write/overwrite — whole table may have changed
    return;
  }
  const groups = sqliteStore.rowGroupsFor(table);
  const first = segments[0];
  if (groups && groups.includes(first)) {
    if (segments.length === 1) {
      fullDirty.add(table); // wrote/removed the whole group blob
      return;
    }
    let set = dirtyRowKeys[table];
    if (!set) {
      set = new Set();
      dirtyRowKeys[table] = set;
    }
    set.add(`${first}${sqliteStore.ROW_KEY_SEP}${segments[1]}`); // the entity row
    set.add(first); // the group skeleton row, to match explodeToRows' output
    return;
  }
  let set = dirtyRowKeys[table];
  if (!set) {
    set = new Set();
    dirtyRowKeys[table] = set;
  }
  set.add(first); // flat / scalar top-level row
}

function scheduleFlush(table) {
  dirty.add(table);

  if (flushTimers[table]) {
    clearTimeout(flushTimers[table]);
  }

  flushTimers[table] = setTimeout(() => {
    flushTable(table);
  }, FLUSH_DELAY_MS);
}

function flushTable(table) {
  if (!dirty.has(table)) return;
  dirty.delete(table);
  delete flushTimers[table];

  try {
    if (isSqliteTable(table)) {
      flushSqliteTable(table);
      return;
    }
    const data = buildFlushSnapshot(table);
    const json = JSON.stringify(data, null, 2);
    safeWriteFileSync(dataFilePath(table), json);
  } catch (err) {
    dbErr(`flush FAILED for ${table}: ${err.message}`);
    dirty.add(table);
  }
}

function reconcileInFlightFlush(table) {
  const inFlight = inFlightFlushes.get(table);
  if (!inFlight) {
    return false;
  }
  const reconciled = inFlight.submittedToWorker
    ? persistenceWorker.reconcileWrite(SQLITE_DB_PATH, inFlight.operationId)
    : sqliteStore.reconcilePersistenceOperation(inFlight.operationId, table);
  // The controller normally invokes the acknowledgment callback itself. Keep
  // this fallback explicit for injected controllers used by focused tests.
  if (inFlightFlushes.get(table) === inFlight) {
    handlePersistenceWorkerAcknowledged(reconciled || inFlight);
  }
  const remaining = inFlightFlushes.get(table);
  if (remaining && remaining.operationId === inFlight.operationId) {
    throw new Error(
      `persistence operation ${inFlight.operationId} remained unresolved after reconciliation`,
    );
  }
  return true;
}

function flushTableSync(table, options = {}) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND" };
  }

  if (flushTimers[table]) {
    clearTimeout(flushTimers[table]);
    delete flushTimers[table];
  }

  try {
    const sqliteTable = isSqliteTable(table);
    if (sqliteTable) {
      // A same-process close/reopen must route durable recovery through the
      // controller before either worker-bound or direct in-flight reconciliation
      // touches the connection.
      ensureSqliteReady();
    }
    const reconciled = sqliteTable ? reconcileInFlightFlush(table) : false;
    if (!dirty.has(table)) {
      return { success: true, errorMsg: null, flushed: reconciled };
    }
    if (sqliteTable) {
      // sync: true reconciles directly on the main connection. Any earlier
      // async operation was resolved above before a newer diff was computed.
      flushSqliteTable(table, { sync: true });
    } else {
      safeWriteFileSync(
        dataFilePath(table),
        JSON.stringify(buildFlushSnapshot(table), null, 2),
      );
    }
    dirty.delete(table);
    if (options.log === true) {
      dbLog(`  ${pc.cyan(table)} ${pc.green("flushed")}`);
    }
    return { success: true, errorMsg: null, flushed: true };
  } catch (err) {
    dbErr(`sync flush FAILED for ${table}: ${err.message}`);
    dirty.add(table);
    return { success: false, errorMsg: "FLUSH_ERROR", flushed: false };
  }
}

function flushTablesSync(tables = []) {
  const uniqueTables = [...new Set(
    (Array.isArray(tables) ? tables : [tables]).filter((table) => Boolean(table)),
  )];
  const results = [];
  let success = true;

  for (const table of uniqueTables) {
    const result = flushTableSync(table);
    results.push({ table, ...result });
    if (!result.success) {
      success = false;
    }
  }

  return {
    success,
    results,
  };
}

/**
 * Synchronously flush ALL dirty tables.  Called on shutdown so
 * nothing is lost when the process exits.
 */
function flushAllSync() {
  const dirtyTables = [...new Set([...dirty, ...inFlightFlushes.keys()])];
  const results = [];
  if (dirtyTables.length === 0) {
    return { success: true, results };
  }

  dbLog(`shutdown flush — writing ${dirtyTables.length} dirty table(s)...`);

  let success = true;
  for (const table of dirtyTables) {
    const result = flushTableSync(table, { log: true });
    results.push({ table, ...result });
    if (!result.success) {
      success = false;
      dbErr(`shutdown flush FAILED for ${table}: ${result.errorMsg || "FLUSH_ERROR"}`);
    }
  }

  dbLog(pc.green("shutdown flush complete"));
  return { success, results };
}

// ── Graceful shutdown ───────────────────────────────────────────────

let shutdownInProgress = false;

function flushDirtyTablesForShutdown(reason) {
  if (shutdownInProgress) {
    return false;
  }
  shutdownInProgress = true;
  dbLog(`received ${reason}, flushing cache to disk...`);
  flushAllSync();
  return true;
}

function onShutdownSignal(signal, exitCode = 0) {
  if (process[TEST_STORE_CLEANUP_SYMBOL] === true) {
    process.exitCode = exitCode;
    return;
  }
  flushDirtyTablesForShutdown(signal);
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  try {
    process.on(signal, () => onShutdownSignal(signal));
  } catch (error) {
    dbWarn(`failed to register ${signal} shutdown handler: ${error.message}`);
  }
}

process.on("beforeExit", () => {
  if (process[TEST_STORE_CLEANUP_SYMBOL] === true) {
    return;
  }
  if (dirty.size > 0 || inFlightFlushes.size > 0) {
    flushDirtyTablesForShutdown("beforeExit");
  }
});

process.on("exit", () => {
  if (process[TEST_STORE_CLEANUP_SYMBOL] === true) {
    return;
  }
  // Last-chance sync flush for any remaining dirty tables
  if (dirty.size > 0 || inFlightFlushes.size > 0) {
    flushDirtyTablesForShutdown("exit");
  }
});

// ── Public API (unchanged signature) ────────────────────────────────

function ensureCached(table) {
  if (!(table in cache)) {
    if (isSqliteTable(table)) {
      loadTable(table);
      return true;
    }
    const tableDir = path.join(DATA_DIR, table);
    if (!fs.existsSync(tableDir)) {
      return false;
    }
    loadTable(table);
  }
  return true;
}

function tableExists(table) {
  if (table in cache || isSqliteTable(table)) {
    return true;
  }
  return fs.existsSync(path.join(DATA_DIR, table));
}

// Bootstrap a runtime-owned table that may not have been created by the
// database builder yet (e.g. a newly added pending-payout ledger). loadTable
// creates the directory and an empty {} data file on demand, so subsequent
// read/write calls resolve normally instead of failing with TABLE_NOT_FOUND.
function ensureTable(table) {
  if (!(table in cache)) {
    loadTable(table);
  }
  return true;
}

function read(table, pth) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND", data: null };
  }

  try {
    const segments = getSegments(pth);
    const db = cache[table];

    if (segments.length === 0) {
      return { success: true, errorMsg: null, data: db };
    }

    let current = db;
    for (const segment of segments) {
      if (
        current === null ||
        typeof current !== "object" ||
        !(segment in current)
      ) {
        return { success: false, errorMsg: "ENTRY_NOT_FOUND", data: null };
      }
      current = current[segment];
    }

    return { success: true, errorMsg: null, data: current };
  } catch (error) {
    log.error(`[DATABASE READ ERROR] ${error.message}`);
    return { success: false, errorMsg: "READ_ERROR", data: null };
  }
}

function write(table, pth, data, options = {}) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND" };
  }

  try {
    const segments = getSegments(pth);

    if (segments.length === 0) {
      // Full table overwrite
      const sameReference = cache[table] === data;
      const unchanged = sameReference ? false : isSameValue(cache[table], data);
      if (options.transient === true) {
        setTransientPath(table, "/", true);
      }
      if (unchanged && options.force !== true) {
        return { success: true, errorMsg: null };
      }
      if (!sameReference) {
        cache[table] = data;
      }
      if (!(options.transient === true && options.force !== true)) {
        markRowDirty(table, segments); // root write — marks the table fullDirty
        scheduleFlush(table);
      }
      return { success: true, errorMsg: null };
    }

    let current = cache[table];
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (
        !(segment in current) ||
        current[segment] === null ||
        typeof current[segment] !== "object"
      ) {
        current[segment] = {};
      }
      current = current[segment];
    }

    if (options.transient === true) {
      setTransientPath(table, pth, true);
    }
    const finalKey = segments[segments.length - 1];
    if (Object.prototype.hasOwnProperty.call(current, finalKey) && isSameValue(current[finalKey], data)) {
      return { success: true, errorMsg: null };
    }
    current[finalKey] = data;
    markRowDirty(table, segments);
    scheduleFlush(table);

    return { success: true, errorMsg: null };
  } catch (error) {
    log.error(`[DATABASE WRITE ERROR] ${error.message}`);
    return { success: false, errorMsg: "WRITE_ERROR" };
  }
}

function remove(table, pth) {
  if (!ensureCached(table)) {
    log.warn(`[DATABASE] database table: '${table}' not found!`);
    return { success: false, errorMsg: "TABLE_NOT_FOUND" };
  }

  try {
    const segments = getSegments(pth);

    if (segments.length === 0) {
      return { success: false, errorMsg: "INVALID_PATH" };
    }

    let current = cache[table];
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (
        current === null ||
        typeof current !== "object" ||
        !(segment in current)
      ) {
        return { success: false, errorMsg: "ENTRY_NOT_FOUND" };
      }
      current = current[segment];
    }

    const finalKey = segments[segments.length - 1];
    if (
      current === null ||
      typeof current !== "object" ||
      !(finalKey in current)
    ) {
      return { success: false, errorMsg: "ENTRY_NOT_FOUND" };
    }

    delete current[finalKey];
    clearTransientPathsForPrefix(table, pth);
    markRowDirty(table, segments);
    scheduleFlush(table);

    return { success: true, errorMsg: null };
  } catch (error) {
    log.error(`[DATABASE DELETE ERROR] ${error.message}`);
    return { success: false, errorMsg: "DELETE_ERROR" };
  }
}

module.exports = {
  read,
  write,
  remove,
  tableExists,
  ensureTable,
  setTransientPath,
  preloadAll,
  flushTableSync,
  flushTablesSync,
  flushAllSync,
  // Internal hooks for migration tooling and tests.
  _dataDir: DATA_DIR,
  _sqliteDbPath: SQLITE_DB_PATH,
  _sqliteTables: SQLITE_TABLES,
  _closeSqliteForTests: sqliteStore.close,
  _shutdownPersistenceWorkerForTests: persistenceWorker.shutdown,
  _flushStatsForTests: flushStats,
  _dirtyRowTrackingEnabled: DIRTY_ROWS_TRACKING,
};
