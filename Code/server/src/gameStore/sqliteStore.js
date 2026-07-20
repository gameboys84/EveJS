/**
 * SQLITE PERSISTENCE BACKEND (proof-of-concept):
 *
 * A thin key/value-blob store used as the on-disk backend for selected
 * runtime tables, in place of one big data.json file per table.
 *
 * Each logical table maps to one SQL table with the shape:
 *     "<table>"(key TEXT PRIMARY KEY, json TEXT NOT NULL)
 * i.e. one row per top-level entity, with the entity record stored as a
 * JSON blob. This keeps the existing nested-object cache semantics in
 * server/src/gameStore/index.js completely intact — SQLite is only the
 * durable container — while giving us:
 *   - ACID writes (no more whole-file-rewrite corruption window), and
 *   - per-row upserts (a change to one character no longer rewrites the
 *     entire table file).
 *
 * The store is intentionally tiny and synchronous (better-sqlite3) so it
 * slots in behind the existing synchronous read/write/remove API without
 * forcing any consumer to become async.
 */

const fs = require("fs");
const path = require("path");

let Database = null;
let db = null;
let dbPath = null;

// SQL identifiers are interpolated into DDL/DML, so hard-fail on anything
// that is not a plain table name. Every real table name is camelCase ascii.
const SAFE_TABLE_NAME = /^[A-Za-z0-9_]+$/;

const ensuredTables = new Set();
const upsertStatements = new Map();
const deleteStatements = new Map();

function assertSafeTableName(table) {
  if (!SAFE_TABLE_NAME.test(String(table || ""))) {
    throw new Error(`unsafe sqlite table name: ${JSON.stringify(table)}`);
  }
  return table;
}

// ── Nested-row ("wrapper") tables ───────────────────────────────────
// Most tables are flat: each top-level key is an entity, stored one row per
// key. A few tables nest their entities one level under a named group (e.g.
// notifications.boxes[characterID], wormholeRuntimeState.pairsByID[pairID]).
// For those, storing the whole group as one row means a change to a single
// entity rewrites the entire group blob. Opt a table in here and its entities
// are stored one row per entity (key "group\u001fentityID"), so one change is
// one small row. Everything not listed is unchanged (flat).
const ROW_GROUPS = {
  notifications: ["boxes"],
  miningRuntimeState: ["systems"],
  wormholeRuntimeState: ["pairsByID", "staticSlotsByKey", "polarizationByCharacter"],
  alliances: ["records"],
  bookmarkFolders: ["records"],
  bookmarkGroups: ["records"],
  bookmarkKnownFolders: ["recordsByCharacterID"],
  bookmarks: ["records"],
  calendarEvents: ["events"],
  calendarResponses: ["responses"],
  characterEnergyState: ["characters"],
  corporationBills: ["bills", "automaticPaySettingsByOwner"],
  corporationGoals: ["goalsByID"],
  corporationRuntime: [
    "corporations", "alliances", "wars", "warNegotiations",
    "mutualWarInvites", "mutualWarInviteBlocks", "peaceTreaties",
  ],
  dungeonRuntimeState: ["instancesByID"],
  industryBlueprintState: ["records"],
  industryJobs: ["jobs"],
  industryRuntime: ["monitors"],
  insuranceContracts: ["contractsByShipID", "contractHistoryByID", "payoutLedgerByLossID"],
  lpWallets: ["characterWallets", "corporationWallets"],
  miningLedger: ["characters", "observers"],
  killRights: ["rights", "activations"],
  killmails: ["records"],
  mail: ["messages", "mailboxes", "mailingLists"],
  mapTelemetry: ["visitsByCharacterID"],
  missionRuntimeState: ["charactersByID"],
  moduleGroupingState: ["ships"],
  moonExtractions: ["resourcesByStructureID", "extractions"],
  npcEntities: ["entities"],
  npcModules: ["modules"],
  npcRuntimeControllers: ["controllers"],
  overviewSharedPresets: ["entries"],
  planetOrbitalState: ["orbitalsByID"],
  planetRuntimeState: [
    "resourcesByPlanetID", "coloniesByKey", "launchesByID", "acceptedNetworkEditsByKey",
  ],
  playerBounties: ["pools", "contributions", "hunterStats"],
  rafflesRuntime: ["reservations"],
  savedFittings: ["owners"],
  sharedSettings: ["entries"],
  shipCosmetics: ["characters", "ships"],
  shipDirt: ["ships"],
  shipKillCounters: ["ships"],
  solarSystemInterferenceState: ["systems"],
  sovereignty: ["alliances", "systems", "hubs", "skyhooks", "mercenaryDens", "resources"],
  structurePaintwork: ["catalogueByTypeID", "licensesByID", "structureAssignments"],
  structureProfiles: ["profilesByID"],
  structureTetherRestrictions: ["restrictions"],
  // Empty today; wrapper shapes confirmed from each owning service's defaults.
  bookmarkSubfolders: ["records", "recordsByCharacterID"],
  corporationVotes: ["corporations"],
  evermarkEntitlements: ["characters"],
  pendingNpcBounties: ["npcTypes"],
  probeRuntimeState: ["probesByID"],
  shipLogoFittings: ["ships"],
  chatState: ["channels", "privateChannelByPair"],
  chatStaticContracts: ["observations"],
  chatBacklog: ["entriesByRoomName"],
};
const ROW_KEY_SEP = "\u001f";

function rowGroupsFor(table) {
  return ROW_GROUPS[table] || null;
}

/**
 * Flatten a nested table object into the `{ rowKey: value }` map actually
 * stored as SQLite rows. For a configured group it emits one row per entity
 * (`group\u001fentityID`) plus a skeleton `group` row, so a group that is
 * present but empty still round-trips. Flat tables pass through unchanged.
 */
function explodeToRows(table, object = {}) {
  const groups = rowGroupsFor(table);
  const rows = {};
  for (const key of Object.keys(object || {})) {
    const value = object[key];
    const isGroup =
      groups &&
      groups.includes(key) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value);
    if (isGroup) {
      rows[key] = {}; // skeleton: records that the group exists (even if empty)
      for (const entityKey of Object.keys(value)) {
        if (String(entityKey).includes(ROW_KEY_SEP)) {
          throw new Error(
            `entity key contains reserved separator: ${table}.${key}.${entityKey}`,
          );
        }
        rows[`${key}${ROW_KEY_SEP}${entityKey}`] = value[entityKey];
      }
    } else {
      rows[key] = value;
    }
  }
  return rows;
}

/**
 * Inverse of explodeToRows: rebuild the nested table object from the flat
 * `{ rowKey: value }` row map. Order-independent and lossless.
 */
function assembleFromRows(table, rows = {}) {
  const groups = new Set(rowGroupsFor(table) || []);
  const object = {};
  for (const rowKey of Object.keys(rows)) {
    const sepIndex = rowKey.indexOf(ROW_KEY_SEP);
    if (sepIndex >= 0) {
      const group = rowKey.slice(0, sepIndex);
      const entityKey = rowKey.slice(sepIndex + 1);
      if (!object[group] || typeof object[group] !== "object") {
        object[group] = {};
      }
      object[group][entityKey] = rows[rowKey];
    } else if (groups.has(rowKey)) {
      // Group container row. In the per-entity format this is an empty skeleton.
      // A not-yet-reconverted install may still hold the whole group blob here
      // (from before the split) — merge it in without clobbering per-entity rows,
      // so the first flush cleanly converts it.
      const blob =
        rows[rowKey] && typeof rows[rowKey] === "object" && !Array.isArray(rows[rowKey])
          ? rows[rowKey]
          : {};
      object[rowKey] = { ...blob, ...(object[rowKey] || {}) };
    } else {
      object[rowKey] = rows[rowKey];
    }
  }
  return object;
}

/**
 * Resolve the value of a SINGLE stored row directly from a nested table object,
 * without exploding the whole table. This is the per-row counterpart to
 * explodeToRows used by the gameStore dirty-row flush fast path, and it MUST
 * mirror explodeToRows exactly:
 *   - `groupentity`  -> object[group][entity]   (the entity record)
 *   - bare group key       -> {}                       (the empty skeleton row)
 *   - flat / scalar key    -> object[key]
 *   - any absent key       -> undefined                (signals a deleted row)
 * The equivalence to explodeToRows()[rowKey] is pinned by a guard test.
 */
function rowValueForKey(table, object, rowKey) {
  const source = object && typeof object === "object" ? object : {};
  const sepIndex = String(rowKey).indexOf(ROW_KEY_SEP);
  if (sepIndex >= 0) {
    const group = rowKey.slice(0, sepIndex);
    const entityKey = rowKey.slice(sepIndex + 1);
    const groupValue = source[group];
    if (
      groupValue &&
      typeof groupValue === "object" &&
      !Array.isArray(groupValue) &&
      Object.prototype.hasOwnProperty.call(groupValue, entityKey)
    ) {
      return groupValue[entityKey];
    }
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(source, rowKey)) {
    return undefined;
  }
  const value = source[rowKey];
  const groups = rowGroupsFor(table);
  const isGroup =
    groups &&
    groups.includes(rowKey) &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value);
  return isGroup ? {} : value;
}

/**
 * Open (or create) the backing SQLite database. Idempotent: calling it
 * again with the same path is a no-op. WAL mode lets the running server
 * keep writing while a tool (DB Browser, DBeaver) reads the file.
 */
function init(targetPath) {
  if (db && dbPath === targetPath) {
    return db;
  }
  if (db && dbPath !== targetPath) {
    close();
  }
  if (!Database) {
    Database = require("better-sqlite3");
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  db = new Database(targetPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  // The persistence worker (when enabled) opens a SECOND connection to this same
  // WAL database for off-loop writes, while the main thread keeps a connection
  // for reads/preload. WAL serializes writers across connections; a non-zero
  // busy_timeout makes a momentarily-locked connection wait instead of erroring
  // with SQLITE_BUSY. Harmless for the single-connection (worker-disabled) case.
  db.pragma("busy_timeout = 5000");
  // Tracks which tables have already been seeded from their legacy data.json so
  // a lazy re-seed never resurrects rows that were intentionally deleted.
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (table_name TEXT PRIMARY KEY, migrated_at TEXT NOT NULL)",
  );
  dbPath = targetPath;
  return db;
}

function isMigrated(table) {
  assertSafeTableName(table);
  return Boolean(
    requireDb().prepare("SELECT 1 FROM _migrations WHERE table_name = ?").get(table),
  );
}

function markMigrated(table) {
  assertSafeTableName(table);
  requireDb()
    .prepare(
      `INSERT INTO _migrations(table_name, migrated_at) VALUES (?, ?)
       ON CONFLICT(table_name) DO NOTHING`,
    )
    .run(table, new Date().toISOString());
}

function requireDb() {
  if (!db) {
    throw new Error("sqliteStore.init(dbPath) must be called before use");
  }
  return db;
}

function ensureSqlTable(table) {
  assertSafeTableName(table);
  if (ensuredTables.has(table)) {
    return;
  }
  requireDb().exec(
    `CREATE TABLE IF NOT EXISTS "${table}" (key TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  );
  ensuredTables.add(table);
}

function getUpsertStatement(table) {
  if (!upsertStatements.has(table)) {
    upsertStatements.set(
      table,
      requireDb().prepare(
        `INSERT INTO "${table}"(key, json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json`,
      ),
    );
  }
  return upsertStatements.get(table);
}

function getDeleteStatement(table) {
  if (!deleteStatements.has(table)) {
    deleteStatements.set(
      table,
      requireDb().prepare(`DELETE FROM "${table}" WHERE key = ?`),
    );
  }
  return deleteStatements.get(table);
}

// Raw `[{ key, json }]` rows as stored — index.js uses these to build both the
// in-memory cache (assembled) and its per-row flush baseline.
function loadRows(table) {
  ensureSqlTable(table);
  return requireDb().prepare(`SELECT key, json FROM "${table}"`).all();
}

/**
 * Load an entire table into the nested object index.js caches in memory —
 * assembling wrapper tables back from their per-entity rows.
 */
function loadTableObject(table) {
  const parsed = {};
  for (const row of loadRows(table)) {
    parsed[row.key] = JSON.parse(row.json);
  }
  return assembleFromRows(table, parsed);
}

/**
 * Apply a batch of row changes in a single transaction.
 * @param {Array<[string, string]>} upserts  [key, jsonString] pairs to write.
 * @param {Array<string>} deletes            keys to remove.
 * @returns {number} number of rows touched.
 */
function applyChanges(table, upserts = [], deletes = []) {
  if (upserts.length === 0 && deletes.length === 0) {
    return 0;
  }
  ensureSqlTable(table);
  const upsert = getUpsertStatement(table);
  const remove = getDeleteStatement(table);
  const txn = requireDb().transaction(() => {
    for (const [key, json] of upserts) {
      upsert.run(String(key), json);
    }
    for (const key of deletes) {
      remove.run(String(key));
    }
  });
  txn();
  return upserts.length + deletes.length;
}

/**
 * Replace the full contents of a table from a plain object (used by the
 * one-shot JSON → SQLite importer).
 */
function replaceAll(table, object = {}) {
  ensureSqlTable(table);
  const rows = explodeToRows(table, object);
  const rowKeys = Object.keys(rows);
  const upsert = getUpsertStatement(table);
  const txn = requireDb().transaction(() => {
    requireDb().exec(`DELETE FROM "${table}"`);
    for (const rowKey of rowKeys) {
      upsert.run(String(rowKey), JSON.stringify(rows[rowKey]));
    }
  });
  txn();
  return rowKeys.length;
}

function rowCount(table) {
  ensureSqlTable(table);
  return requireDb().prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
}

function getDatabasePath() {
  return dbPath;
}

function close() {
  if (db) {
    db.close();
  }
  db = null;
  dbPath = null;
  ensuredTables.clear();
  upsertStatements.clear();
  deleteStatements.clear();
}

module.exports = {
  init,
  ensureSqlTable,
  isMigrated,
  markMigrated,
  loadRows,
  loadTableObject,
  explodeToRows,
  assembleFromRows,
  rowValueForKey,
  rowGroupsFor,
  ROW_KEY_SEP,
  applyChanges,
  replaceAll,
  rowCount,
  getDatabasePath,
  close,
};
