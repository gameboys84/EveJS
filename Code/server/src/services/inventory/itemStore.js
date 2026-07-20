const path = require("path");
const { isDeepStrictEqual } = require("util");
const { performance } = require("perf_hooks");

// Phase 0 / 0.C: itemStore owns the items table (sole writer); access flows
// through a strict ownership-scoped repository. It also reads characters and
// other tables — reads pass through unrestricted.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:inventory", { strict: true });
const log = require(path.join(__dirname, "../../utils/logger"));
// Zero-dependency leaf — safe to require here without a cycle. Bumped on
// dogma-relevant changes (fitting, mutaplasmid) so the dogma context fingerprint
// can hold across ticks instead of being thrashed by routine item writes.
const {
  bumpDogmaInvalidationVersion,
} = require(path.join(__dirname, "../character/dogmaInvalidationVersion"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "./itemTypeRegistry",
));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const {
  resolveRuntimeWreckRadius,
} = require(path.join(__dirname, "./wreckRadius"));
const {
  reserveItemIDs,
} = require(path.join(__dirname, "../_shared/identityAllocator"));
const {
  FUEL_BAY_FLAG,
  STRUCTURE_FUEL_BAY_FLAG,
} = require(path.join(__dirname, "./fuelBayInventory"));

// Fitting flag ranges (hi/med/lo slots, rigs, subsystems, service slots).
// Duplicated from liveFittingState to avoid circular dependency.
const FITTING_FLAG_RANGES = Object.freeze([
  [11, 34],
  [92, 99],
  [125, 132],
  [164, 171],
]);

function isFittingFlag(flagID) {
  const f = Number(flagID) || 0;
  return FITTING_FLAG_RANGES.some(([lo, hi]) => f >= lo && f <= hi);
}

const CHARACTERS_TABLE = "characters";
const ITEMS_TABLE = "items";
const SHIP_CATEGORY_ID = 6;
const BLUEPRINT_CATEGORY_ID = 9;
const DEFAULT_SHIP_TYPE_ID = 606;
const CAPSULE_TYPE_ID = 670;
const CAPSULE_TYPE_ID_GOLDEN = 33328;
const GOLDEN_CAPSULE_IMPLANT_TYPE_ID = 33329;
const ITEM_FLAGS = {
  HANGAR: 4,
  CARGO_HOLD: 5,
  CORP_DELIVERIES: 62,
  FUEL_BAY: FUEL_BAY_FLAG,
  DRONE_BAY: 87,
  SHIP_HANGAR: 90,
  SPECIALIZED_FUEL_BAY: FUEL_BAY_FLAG,
  FIGHTER_BAY: 158,
  FIGHTER_TUBE_0: 159,
  FIGHTER_TUBE_1: 160,
  FIGHTER_TUBE_2: 161,
  FIGHTER_TUBE_3: 162,
  FIGHTER_TUBE_4: 163,
  STRUCTURE_DEED: 180,
  STRUCTURE_FUEL_BAY: STRUCTURE_FUEL_BAY_FLAG,
  DELIVERIES: 173,
  CORPSE_BAY: 174,
  BOOSTER_BAY: 176,
  SUBSYSTEM_BAY: 177,
  GENERAL_MINING_HOLD: 134,
  SPECIALIZED_MINERAL_HOLD: 136,
  SPECIALIZED_SALVAGE_HOLD: 137,
  SPECIALIZED_SHIP_HOLD: 138,
  SPECIALIZED_SMALL_SHIP_HOLD: 139,
  SPECIALIZED_MEDIUM_SHIP_HOLD: 140,
  SPECIALIZED_LARGE_SHIP_HOLD: 141,
  SPECIALIZED_INDUSTRIAL_SHIP_HOLD: 142,
  SPECIALIZED_AMMO_HOLD: 143,
  SPECIALIZED_COMMAND_CENTER_HOLD: 148,
  SPECIALIZED_PLANETARY_COMMODITIES_HOLD: 149,
  SPECIALIZED_MATERIAL_BAY: 151,
  QUAFE_BAY: 154,
  FLEET_HANGAR: 155,
  HIDDEN_MODIFIERS: 156,
  SPECIALIZED_GAS_HOLD: 135,
  SPECIALIZED_ICE_HOLD: 181,
  SPECIALIZED_ASTEROID_HOLD: 182,
  MOBILE_DEPOT_HOLD: 183,
  COLONY_RESOURCES_HOLD: 185,
  INFRASTRUCTURE_HOLD: 185,
  CAPSULEER_DELIVERIES: 187,
  EXPEDITION_HOLD: 188,
};
const STRUCTURE_DEED_GROUP_ID = 4086;
const FIGHTER_TUBE_FLAGS = Object.freeze([
  ITEM_FLAGS.FIGHTER_TUBE_0,
  ITEM_FLAGS.FIGHTER_TUBE_1,
  ITEM_FLAGS.FIGHTER_TUBE_2,
  ITEM_FLAGS.FIGHTER_TUBE_3,
  ITEM_FLAGS.FIGHTER_TUBE_4,
]);
const JUNK_LOCATION_ID = 6;
const DEFAULT_SHIP_CONDITION_STATE = Object.freeze({
  damage: 0.0,
  charge: 1.0,
  armorDamage: 0.0,
  shieldCharge: 1.0,
  incapacitated: false,
});
const DEFAULT_MODULE_STATE = Object.freeze({
  online: false,
  damage: 0.0,
  charge: 0.0,
  skillPoints: 0,
  armorDamage: 0.0,
  shieldCharge: 0.0,
  incapacitated: false,
});
const CLIENT_INVENTORY_STACK_LIMIT = 2147483647;
const ITEM_ID_RESERVE_BATCH_SIZE = 128;
const PACKAGED_VOLUME_OVERRIDES_BY_GROUP_ID = Object.freeze({
  // Mirrored from packaged client inventorycommon.const.packagedVolumeOverridesPerGroup.
  25: 2500.0,
  26: 10000.0,
  27: 50000.0,
  28: 20000.0,
  29: 500.0,
  30: 10000000.0,
  31: 500.0,
  324: 2500.0,
  358: 10000.0,
  380: 20000.0,
  381: 50000.0,
  419: 15000.0,
  420: 5000.0,
  463: 3750.0,
  485: 1300000.0,
  513: 1300000.0,
  540: 15000.0,
  541: 5000.0,
  543: 3750.0,
  547: 1300000.0,
  659: 1300000.0,
  830: 2500.0,
  831: 2500.0,
  832: 10000.0,
  833: 10000.0,
  834: 2500.0,
  883: 1300000.0,
  893: 2500.0,
  894: 10000.0,
  898: 50000.0,
  900: 50000.0,
  902: 1300000.0,
  906: 10000.0,
  941: 500000.0,
  963: 5000.0,
  1022: 500.0,
  1201: 15000.0,
  1202: 20000.0,
  1283: 2500.0,
  1305: 5000.0,
  1527: 2500.0,
  1534: 5000.0,
  1538: 1300000.0,
  1972: 10000.0,
  4594: 1300000.0,
  4902: 50000.0,
  5087: 10000.0,
  5120: 1300000.0,
});
const PACKAGED_VOLUME_OVERRIDES_BY_TYPE_ID = Object.freeze({
  // Mirrored from packaged client inventorycommon.const.packagedVolumeOverridesPerType.
  3293: 33,
  3296: 65,
  3297: 10,
  3465: 65,
  3466: 33,
  3467: 10,
  11019: 100,
  11488: 150,
  11489: 300,
  17363: 10,
  17364: 33,
  17365: 65,
  17366: 10000,
  24445: 1200,
  33003: 2500,
  33005: 500,
  33007: 100,
  33009: 50,
  33011: 10,
  42244: 50000,
});

let migrationComplete = false;
let itemMutationVersion = 1;
let itemsTableCache = null;
let itemIndexesDirty = true;
let itemIndexesCache = null;
// itemID -> { locationID, ownerID } the item is currently filed under, so an
// incremental update can find and move/remove it without a full rebuild.
let itemIndexKeys = new Map();
let reservedItemIDBatch = [];
let itemIndexFullRebuildCount = 0;
let itemIndexIntegrityValidationCount = 0;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function maybeNotifyInsuranceInventoryMutation(
  previousItem,
  nextItem,
  reason = "inventory",
) {
  const previousCategoryID = toNumber(
    previousItem && previousItem.categoryID,
    0,
  );
  const nextCategoryID = toNumber(nextItem && nextItem.categoryID, 0);
  if (
    previousCategoryID !== SHIP_CATEGORY_ID &&
    nextCategoryID !== SHIP_CATEGORY_ID
  ) {
    return;
  }

  try {
    const insuranceRuntime = require(path.join(
      __dirname,
      "../insurance/insuranceRuntime",
    ));
    if (typeof insuranceRuntime.handleInventoryMutation === "function") {
      insuranceRuntime.handleInventoryMutation({
        previousItem: previousItem ? cloneValue(previousItem) : null,
        nextItem: nextItem ? cloneValue(nextItem) : null,
        reason,
      });
    }
  } catch (error) {
    log.warn(
      `[ItemStore] Insurance inventory hook failed item=${
        (nextItem && nextItem.itemID) ||
        (previousItem && previousItem.itemID) ||
        0
      }: ${error.message}`,
    );
  }
}

function notifyInsuranceInventoryMutationChanges(
  changes = [],
  reason = "inventory",
) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || change.removed === true) {
      continue;
    }
    maybeNotifyInsuranceInventoryMutation(
      change.previousData || change.previousState || null,
      change.item || null,
      reason,
    );
  }
}

function normalizeTimestampMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function readCharacters() {
  const result = repo.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function readItems() {
  if (itemsTableCache) {
    return itemsTableCache;
  }
  const result = repo.read(ITEMS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  itemsTableCache = result.data;
  return itemsTableCache;
}

// Derive an index delta from a mutation's existing `changes` record (the same
// list it sends to the client), so a multi-item path reports exactly what it
// touched. Removed entries use previousData.itemID; everything else is an upsert.
function indexDeltaFromChanges(changes) {
  const upsertedIDs = [];
  const removedIDs = [];
  for (const change of changes || []) {
    if (change && change.removed) {
      const id = toNumber(change.previousData && change.previousData.itemID, 0);
      if (id) {
        removedIDs.push(id);
      }
    } else if (change && change.item) {
      const id = toNumber(change.item.itemID, 0);
      if (id) {
        upsertedIDs.push(id);
      }
    }
  }
  return { upsertedIDs, removedIDs };
}

function writeItems(data, options = {}) {
  const { indexDelta, ...dbOptions } = options;
  const writeResult = repo.write(ITEMS_TABLE, "/", data, dbOptions);
  if (writeResult && writeResult.success) {
    itemsTableCache = data;
    if (indexDelta && itemIndexesCache && !itemIndexesDirty) {
      // The caller told us exactly what changed and the index is current — patch
      // it in place instead of forcing an O(total items) rebuild on next read.
      applyItemIndexDelta(itemIndexesCache, data, indexDelta);
      itemIndexIncrementalUpdates += 1;
      if (
        ITEM_INDEX_SELFCHECK_INTERVAL > 0 &&
        itemIndexIncrementalUpdates % ITEM_INDEX_SELFCHECK_INTERVAL === 0
      ) {
        validateItemIndexIntegrity();
      }
    } else {
      // No delta (or index not built yet) → fall back to a full rebuild, exactly
      // as before. This keeps every not-yet-migrated caller correct.
      itemIndexesDirty = true;
      itemIndexesCache = null;
    }
    itemMutationVersion += 1;
    return true;
  }
  return false;
}

function getItemMutationVersion() {
  return itemMutationVersion;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function hasPositiveLocationID(value) {
  return toNumber(value, 0) > 0;
}

function appendIndexedItem(indexMap, key, item) {
  if (!Number.isFinite(Number(key))) {
    return;
  }
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(item);
}

// ── Incremental index maintenance ───────────────────────────────────
// These patch a live (already-built) index for a single item, matching exactly
// what a from-scratch ensureItemIndexes() rebuild produces: byID holds the
// normalized item; byLocation/byOwner buckets stay ascending by itemID; empty
// buckets are dropped. Only used when a caller passes writeItems an indexDelta.

function removeFromIndexBucket(indexMap, key, itemID) {
  if (!Number.isFinite(Number(key))) {
    return;
  }
  const bucket = indexMap.get(key);
  if (!bucket) {
    return;
  }
  const at = bucket.findIndex((entry) => entry.itemID === itemID);
  if (at >= 0) {
    bucket.splice(at, 1);
  }
  if (bucket.length === 0) {
    indexMap.delete(key);
  }
}

function insertIntoIndexBucket(indexMap, key, item) {
  if (!Number.isFinite(Number(key))) {
    return;
  }
  let bucket = indexMap.get(key);
  if (!bucket) {
    bucket = [];
    indexMap.set(key, bucket);
  }
  // Binary search for the ascending-by-itemID insertion point.
  let lo = 0;
  let hi = bucket.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bucket[mid].itemID < item.itemID) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // Idempotent insert: a bucket must NEVER hold the same itemID twice. If this
  // item is already filed here, replace it in place instead of adding a second
  // entry. The read paths (listOwnedItems/listContainerItems/listSystemSpaceItems)
  // re-filter by the bucket's own key, so a stale cross-bucket entry is dropped —
  // but a same-bucket duplicate would survive that filter and surface to the
  // client as a duplicated item (e.g. a ship + its contents shown twice). Guarding
  // here makes the incremental index self-correcting against a stale/incomplete
  // delta rather than silently doubling a row.
  if (lo < bucket.length && bucket[lo].itemID === item.itemID) {
    bucket[lo] = item;
    return;
  }
  bucket.splice(lo, 0, item);
}

function applyIndexUpsert(indexes, item) {
  const itemID = item.itemID;
  // Remove the prior filing before inserting the new one. byID holds the
  // previously-indexed copy, and inserts always file by that copy's own
  // locationID/ownerID — so it is the authoritative record of which buckets
  // currently hold this item. Removing by it (not only by the parallel
  // itemIndexKeys map) keeps the buckets correct even if itemIndexKeys ever
  // drifted, so a moved/re-owned item never lingers in its old bucket.
  const previous = indexes.byID.get(itemID) || null;
  const filed = itemIndexKeys.get(itemID) || null;
  if (previous) {
    removeFromIndexBucket(indexes.byLocation, previous.locationID, itemID);
    removeFromIndexBucket(indexes.byOwner, previous.ownerID, itemID);
  }
  if (filed && (!previous || filed.locationID !== previous.locationID)) {
    removeFromIndexBucket(indexes.byLocation, filed.locationID, itemID);
  }
  if (filed && (!previous || filed.ownerID !== previous.ownerID)) {
    removeFromIndexBucket(indexes.byOwner, filed.ownerID, itemID);
  }
  indexes.byID.set(itemID, item);
  insertIntoIndexBucket(indexes.byLocation, item.locationID, item);
  insertIntoIndexBucket(indexes.byOwner, item.ownerID, item);
  itemIndexKeys.set(itemID, { locationID: item.locationID, ownerID: item.ownerID });
}

function applyIndexRemoval(indexes, itemID) {
  const filed = itemIndexKeys.get(itemID);
  indexes.byID.delete(itemID);
  if (filed) {
    removeFromIndexBucket(indexes.byLocation, filed.locationID, itemID);
    removeFromIndexBucket(indexes.byOwner, filed.ownerID, itemID);
    itemIndexKeys.delete(itemID);
  }
}

// Apply a caller-reported set of changes to the live index.
function applyItemIndexDelta(indexes, data, delta) {
  for (const rawID of delta.removedIDs || []) {
    applyIndexRemoval(indexes, toNumber(rawID, 0));
  }
  for (const rawID of delta.upsertedIDs || []) {
    const itemID = toNumber(rawID, 0);
    const item = normalizeInventoryItem(data[itemID]);
    if (item) {
      applyIndexUpsert(indexes, item);
    } else {
      applyIndexRemoval(indexes, itemID);
    }
  }
}

// Scaling note: this rebuilds byID/byLocation/byOwner over ALL items whenever
// the index is dirty, and writeItems() marks it dirty on every mutation — so a
// mutate-then-read cycle is O(total items) (normalize + sort every bucket). It
// is deliberately kept simple-and-correct: every item mutation flows through
// writeItems() with the whole items map, so the choke-point cannot tell which
// items changed without an O(N) diff. At large item counts (100k+) the fix is
// incremental maintenance at the writeItems() choke-point — diff the new map
// against the last-indexed snapshot and patch only changed entries with sorted
// insertion into the location/owner buckets. Deferred until profiling shows it
// matters, since it adds real complexity (and regression risk) to a core path.
// Build a fresh index + filing map from the current items. Pure: returns new
// structures and never touches the live cache (so the self-check can rebuild a
// parallel copy to compare against).
function buildItemIndexes() {
  const indexes = {
    byID: new Map(),
    byLocation: new Map(),
    byOwner: new Map(),
  };
  const keys = new Map();

  for (const rawItem of Object.values(readItems())) {
    const item = normalizeInventoryItem(rawItem);
    if (!item) {
      continue;
    }
    indexes.byID.set(item.itemID, item);
    appendIndexedItem(indexes.byLocation, item.locationID, item);
    appendIndexedItem(indexes.byOwner, item.ownerID, item);
    keys.set(item.itemID, { locationID: item.locationID, ownerID: item.ownerID });
  }

  for (const indexMap of [indexes.byLocation, indexes.byOwner]) {
    for (const bucket of indexMap.values()) {
      bucket.sort((left, right) => left.itemID - right.itemID);
    }
  }

  return { indexes, keys };
}

function formatElapsedMs(ms) {
  return Number(ms).toFixed(ms >= 10 ? 1 : 3);
}

function rebuildItemIndexes(reason = "unknown") {
  const startedAtMs = performance.now();
  const built = buildItemIndexes();
  itemIndexFullRebuildCount += 1;
  const elapsedMs = performance.now() - startedAtMs;
  if (elapsedMs >= ITEM_INDEX_REBUILD_WARN_MS) {
    log.warn(
      `[itemStore] full item index rebuild reason=${reason} items=${built.keys.size} took ${formatElapsedMs(elapsedMs)}ms`,
    );
  }
  return built;
}

// Deep-comparable shape of an index (item objects in byID, itemID order in the
// buckets) — used by the self-check and the property test.
function snapshotItemIndexes(indexes) {
  const bucketEntries = (indexMap) =>
    [...indexMap.entries()]
      .map(([key, bucket]) => [key, bucket.map((entry) => entry.itemID)])
      .sort((left, right) => Number(left[0]) - Number(right[0]));
  return {
    byID: [...indexes.byID.entries()].sort((left, right) => left[0] - right[0]),
    byLocation: bucketEntries(indexes.byLocation),
    byOwner: bucketEntries(indexes.byOwner),
  };
}

function ensureItemIndexes() {
  ensureMigrated();
  if (!itemIndexesDirty && itemIndexesCache) {
    return itemIndexesCache;
  }

  const built = rebuildItemIndexes("ensure");
  itemIndexesCache = built.indexes;
  itemIndexKeys = built.keys;
  itemIndexesDirty = false;
  return itemIndexesCache;
}

// Safety backstop for incremental updates: every Nth incremental write, rebuild
// a parallel index and compare. If a caller ever reports a wrong/incomplete
// delta (e.g. mutates the items cache and bails before writeItems), this catches
// the drift and self-heals by swapping in the rebuild — so the worst case is a
// brief O(total items) rebuild, never an item permanently stuck/duplicated in
// the client's inventory.
//
// This default was previously 0 (disabled) for performance, which turned any
// transient delta inconsistency into PERMANENT drift — surfacing as intermittent
// duplicated/mis-located inventory rows. The structural guards above
// (idempotent insertIntoIndexBucket + byID-authoritative applyIndexUpsert) make
// reported-delta drift self-correcting at zero cost, so this periodic rebuild is
// now only a rare insurance pass against unreported mutations. The default is
// deliberately large so the amortized cost stays negligible (one rebuild per
// ~25k item writes); set EVEJS_ITEM_INDEX_SELFCHECK_INTERVAL=0 to opt out
// entirely, or smaller for aggressive diagnostics.
function readNonNegativeIntegerEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : fallback;
}

function readNonNegativeNumberEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const ITEM_INDEX_SELFCHECK_INTERVAL = (() => {
  return readNonNegativeIntegerEnv("EVEJS_ITEM_INDEX_SELFCHECK_INTERVAL", 25000);
})();
const ITEM_INDEX_REBUILD_WARN_MS = readNonNegativeNumberEnv(
  "EVEJS_ITEM_INDEX_REBUILD_WARN_MS",
  100,
);
let itemIndexIncrementalUpdates = 0;

function validateItemIndexIntegrity() {
  if (!itemIndexesCache || itemIndexesDirty) {
    return true; // nothing live to validate
  }
  itemIndexIntegrityValidationCount += 1;
  const rebuilt = rebuildItemIndexes("integrity-self-check");
  if (
    isDeepStrictEqual(
      snapshotItemIndexes(itemIndexesCache),
      snapshotItemIndexes(rebuilt.indexes),
    )
  ) {
    return true;
  }
  log.info(
    "[itemStore] incremental item index drift detected — self-healing with a full rebuild",
  );
  itemIndexesCache = rebuilt.indexes;
  itemIndexKeys = rebuilt.keys;
  return false;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSpaceVector(rawValue, fallback = { x: 0, y: 0, z: 0 }) {
  if (!rawValue || typeof rawValue !== "object") {
    return {
      x: fallback.x,
      y: fallback.y,
      z: fallback.z,
    };
  }

  return {
    x: toFiniteNumber(rawValue.x, fallback.x),
    y: toFiniteNumber(rawValue.y, fallback.y),
    z: toFiniteNumber(rawValue.z, fallback.z),
  };
}

function normalizeDunRotation(rawValue) {
  if (!Array.isArray(rawValue) || rawValue.length < 3) {
    return null;
  }

  return [
    toFiniteNumber(rawValue[0], 0),
    toFiniteNumber(rawValue[1], 0),
    toFiniteNumber(rawValue[2], 0),
  ];
}

function normalizeEmergencyWarpReturnState(rawValue, fallbackSystemID = 0) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const systemID = toNumber(rawValue.systemID, fallbackSystemID);
  if (systemID <= 0) {
    return null;
  }

  return {
    systemID,
    position: normalizeSpaceVector(rawValue.position),
    velocity: normalizeSpaceVector(rawValue.velocity),
    direction: normalizeSpaceVector(rawValue.direction, { x: 1, y: 0, z: 0 }),
    targetPoint: rawValue.targetPoint
      ? normalizeSpaceVector(rawValue.targetPoint)
      : normalizeSpaceVector(rawValue.position),
    speedFraction: 0,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    orbitDistance: 0,
    orbitNormal: rawValue.orbitNormal
      ? normalizeSpaceVector(rawValue.orbitNormal, { x: 0, y: 1, z: 0 })
      : null,
    orbitSign: toFiniteNumber(rawValue.orbitSign, 1) < 0 ? -1 : 1,
    warpState: null,
    pendingWarp: null,
  };
}

function normalizeSpaceState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalizedMode = ["GOTO", "FOLLOW", "WARP", "ORBIT"].includes(rawValue.mode)
    ? rawValue.mode
    : "STOP";

  return {
    systemID: toNumber(rawValue.systemID, 0),
    position: normalizeSpaceVector(rawValue.position),
    velocity: normalizeSpaceVector(rawValue.velocity),
    direction: normalizeSpaceVector(rawValue.direction, { x: 1, y: 0, z: 0 }),
    targetPoint: rawValue.targetPoint
      ? normalizeSpaceVector(rawValue.targetPoint)
      : null,
    speedFraction: toFiniteNumber(rawValue.speedFraction, 0),
    mode: normalizedMode,
    targetEntityID: rawValue.targetEntityID
      ? toNumber(rawValue.targetEntityID, 0)
      : null,
    followRange: toFiniteNumber(rawValue.followRange, 0),
    orbitDistance: toFiniteNumber(rawValue.orbitDistance, 0),
    orbitNormal: rawValue.orbitNormal
      ? normalizeSpaceVector(rawValue.orbitNormal, { x: 0, y: 1, z: 0 })
      : null,
    orbitSign: toFiniteNumber(rawValue.orbitSign, 1) < 0 ? -1 : 1,
    warpState:
      rawValue.warpState && typeof rawValue.warpState === "object"
        ? {
            startTimeMs: toFiniteNumber(rawValue.warpState.startTimeMs, Date.now()),
            durationMs: toFiniteNumber(rawValue.warpState.durationMs, 0),
            accelTimeMs: toFiniteNumber(rawValue.warpState.accelTimeMs, 0),
            cruiseTimeMs: toFiniteNumber(rawValue.warpState.cruiseTimeMs, 0),
            decelTimeMs: toFiniteNumber(rawValue.warpState.decelTimeMs, 0),
            totalDistance: toFiniteNumber(rawValue.warpState.totalDistance, 0),
            stopDistance: toFiniteNumber(rawValue.warpState.stopDistance, 0),
            maxWarpSpeedMs: toFiniteNumber(rawValue.warpState.maxWarpSpeedMs, 0),
            warpSpeed: toNumber(rawValue.warpState.warpSpeed, 0),
            effectStamp: toNumber(rawValue.warpState.effectStamp, 0),
            targetEntityID: rawValue.warpState.targetEntityID
              ? toNumber(rawValue.warpState.targetEntityID, 0)
              : null,
            followID: rawValue.warpState.followID
              ? toNumber(rawValue.warpState.followID, 0)
              : null,
            followRangeMarker: toFiniteNumber(
              rawValue.warpState.followRangeMarker,
              rawValue.warpState.stopDistance,
            ),
            origin: rawValue.warpState.origin
              ? normalizeSpaceVector(rawValue.warpState.origin)
              : null,
            rawDestination: rawValue.warpState.rawDestination
              ? normalizeSpaceVector(rawValue.warpState.rawDestination)
              : null,
            targetPoint: rawValue.warpState.targetPoint
              ? normalizeSpaceVector(rawValue.warpState.targetPoint)
              : null,
          }
        : null,
    emergencyWarpReturnState: normalizeEmergencyWarpReturnState(
      rawValue.emergencyWarpReturnState,
      toNumber(rawValue.systemID, 0),
    ),
  };
}

function buildStoppedSpaceStateForSystem(solarSystemID, existingState = null) {
  const rawState =
    existingState && typeof existingState === "object"
      ? existingState
      : {};
  return normalizeSpaceState({
    ...rawState,
    systemID: toNumber(solarSystemID, rawState.systemID),
    velocity: rawState.velocity || { x: 0, y: 0, z: 0 },
    direction: rawState.direction || { x: 1, y: 0, z: 0 },
    targetPoint: rawState.targetPoint || rawState.position || null,
    speedFraction: 0,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    orbitDistance: 0,
    orbitNormal: null,
    orbitSign: 1,
    warpState: null,
    pendingWarp: null,
  });
}

function normalizeFighterState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalized = {};
  const tubeFlagID = toNumber(rawValue.tubeFlagID, 0);
  const controllerID = toNumber(rawValue.controllerID, 0);
  const controllerOwnerID = toNumber(rawValue.controllerOwnerID, 0);

  if (tubeFlagID > 0) {
    normalized.tubeFlagID = tubeFlagID;
  }
  if (controllerID > 0) {
    normalized.controllerID = controllerID;
  }
  if (controllerOwnerID > 0) {
    normalized.controllerOwnerID = controllerOwnerID;
  }

  const abilityStates = normalizeFighterAbilityStates(rawValue.abilityStates);
  if (abilityStates) {
    normalized.abilityStates = abilityStates;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeFighterAbilitySlotState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalized = {};
  const activeSinceMs = toFiniteNumber(rawValue.activeSinceMs, null);
  const durationMs = toFiniteNumber(rawValue.durationMs, null);
  const activeUntilMs = toFiniteNumber(rawValue.activeUntilMs, null);
  const cooldownStartMs = toFiniteNumber(rawValue.cooldownStartMs, null);
  const cooldownEndMs = toFiniteNumber(rawValue.cooldownEndMs, null);
  const remainingChargeCount = toNumber(rawValue.remainingChargeCount, null);
  const targetID = toNumber(rawValue.targetID, 0);
  const targetPoint =
    rawValue.targetPoint && typeof rawValue.targetPoint === "object"
      ? normalizeSpaceVector(rawValue.targetPoint)
      : null;

  if (activeSinceMs !== null && activeSinceMs >= 0) {
    normalized.activeSinceMs = activeSinceMs;
  }
  if (durationMs !== null && durationMs > 0) {
    normalized.durationMs = durationMs;
  }
  if (activeUntilMs !== null && activeUntilMs >= 0) {
    normalized.activeUntilMs = activeUntilMs;
  }
  if (cooldownStartMs !== null && cooldownStartMs >= 0) {
    normalized.cooldownStartMs = cooldownStartMs;
  }
  if (cooldownEndMs !== null && cooldownEndMs >= 0) {
    normalized.cooldownEndMs = cooldownEndMs;
  }
  if (remainingChargeCount !== null && remainingChargeCount >= 0) {
    normalized.remainingChargeCount = remainingChargeCount;
  }
  if (targetID > 0) {
    normalized.targetID = targetID;
  }
  if (targetPoint) {
    normalized.targetPoint = targetPoint;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeFighterAbilityStates(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalized = {};
  for (const [slotID, slotState] of Object.entries(rawValue)) {
    const numericSlotID = toNumber(slotID, -1);
    if (numericSlotID < 0 || numericSlotID > 2) {
      continue;
    }

    const normalizedState = normalizeFighterAbilitySlotState(slotState);
    if (normalizedState) {
      normalized[numericSlotID] = normalizedState;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeShipConditionState(rawValue) {
  const source =
    rawValue && typeof rawValue === "object" ? rawValue : DEFAULT_SHIP_CONDITION_STATE;
  const conditionNumber = (value, fallback) =>
    value === undefined || value === null ? fallback : toFiniteNumber(value, fallback);

  return {
    damage: conditionNumber(source.damage, DEFAULT_SHIP_CONDITION_STATE.damage),
    charge: conditionNumber(source.charge, DEFAULT_SHIP_CONDITION_STATE.charge),
    armorDamage: conditionNumber(
      source.armorDamage,
      DEFAULT_SHIP_CONDITION_STATE.armorDamage,
    ),
    shieldCharge: conditionNumber(
      source.shieldCharge,
      DEFAULT_SHIP_CONDITION_STATE.shieldCharge,
    ),
    incapacitated: Boolean(
      source.incapacitated ?? DEFAULT_SHIP_CONDITION_STATE.incapacitated,
    ),
  };
}

function normalizeModuleState(rawValue) {
  if (rawValue === undefined) {
    return undefined;
  }

  const source =
    rawValue && typeof rawValue === "object" ? rawValue : DEFAULT_MODULE_STATE;

  const normalizedState = {
    online: Boolean(source.online),
    damage: toFiniteNumber(source.damage, DEFAULT_MODULE_STATE.damage),
    charge: toFiniteNumber(source.charge, DEFAULT_MODULE_STATE.charge),
    skillPoints: toNumber(source.skillPoints, DEFAULT_MODULE_STATE.skillPoints),
    armorDamage: toFiniteNumber(
      source.armorDamage,
      DEFAULT_MODULE_STATE.armorDamage,
    ),
    shieldCharge: toFiniteNumber(
      source.shieldCharge,
      DEFAULT_MODULE_STATE.shieldCharge,
    ),
    incapacitated: Boolean(source.incapacitated),
  };
  for (const key of [
    "serviceFuelOnlineAt",
    "serviceFuelLastCycleAt",
    "serviceFuelNextCycleAt",
  ]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      normalizedState[key] =
        value === null || value === undefined
          ? null
          : toNumber(value, null);
    }
  }
  return normalizedState;
}

function normalizePositiveInteger(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePositiveSafeInteger(value, fallback = null) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function isStackableInventoryItem(item) {
  return Boolean(item) && toNumber(item.singleton, 0) === 0;
}

function getStackableItemQuantity(item) {
  if (!item) {
    return 0;
  }
  if (!isStackableInventoryItem(item)) {
    return 1;
  }
  return Math.max(
    0,
    toNumber(item.quantity, 0),
    toNumber(item.stacksize, 0),
  );
}

function splitStackQuantityIntoClientSafeChunks(totalQuantity) {
  const normalizedQuantity = normalizePositiveSafeInteger(totalQuantity, 0);
  if (normalizedQuantity <= 0) {
    return [];
  }

  const chunks = [];
  let remainingQuantity = normalizedQuantity;
  while (remainingQuantity > 0) {
    const chunkQuantity = Math.min(
      remainingQuantity,
      CLIENT_INVENTORY_STACK_LIMIT,
    );
    chunks.push(chunkQuantity);
    remainingQuantity -= chunkQuantity;
  }

  return chunks;
}

function appendStackIndexEntry(stackIndex, item) {
  if (!stackIndex || !isStackableInventoryItem(item)) {
    return;
  }

  const stackKey = buildStackKey(
    item.ownerID,
    item.locationID,
    item.flagID,
    item.typeID,
  );
  let entries = stackIndex.get(stackKey);
  if (!entries) {
    entries = [];
    stackIndex.set(stackKey, entries);
  }

  const existingIndex = entries.findIndex(
    (candidate) => toNumber(candidate && candidate.itemID, 0) === toNumber(item.itemID, 0),
  );
  if (existingIndex >= 0) {
    entries[existingIndex] = item;
  } else {
    entries.push(item);
  }

  entries.sort((left, right) => toNumber(left.itemID, 0) - toNumber(right.itemID, 0));
}

function buildStackIndex(items) {
  const stackIndex = new Map();
  for (const rawItem of Object.values(items || {})) {
    const item = normalizeInventoryItem(rawItem);
    if (!isStackableInventoryItem(item)) {
      continue;
    }
    appendStackIndexEntry(stackIndex, item);
  }
  return stackIndex;
}

function findStackWithAvailableCapacity(
  stackIndex,
  ownerID,
  locationID,
  flagID,
  typeID,
) {
  const entries = stackIndex.get(
    buildStackKey(ownerID, locationID, flagID, typeID),
  ) || [];
  return entries.find(
    (candidate) => getStackableItemQuantity(candidate) < CLIENT_INVENTORY_STACK_LIMIT,
  ) || null;
}

function captureItemState(item) {
  if (!item || typeof item !== "object") {
    return {};
  }

  return {
    locationID: item.locationID,
    flagID: item.flagID,
    quantity: item.quantity,
    singleton: item.singleton,
    stacksize: item.stacksize,
    moduleState: Object.prototype.hasOwnProperty.call(item, "moduleState")
      ? cloneValue(item.moduleState)
      : undefined,
  };
}

function getItemMetadata(typeID, name = null) {
  const resolvedTypeID = toNumber(typeID, 0);
  const resolvedItem = resolveItemByTypeID(resolvedTypeID);
  if (resolvedItem) {
    return {
      ...resolvedItem,
      name: resolvedItem.name || name || "Item",
    };
  }

  const resolvedShip = resolveShipByTypeID(resolvedTypeID);
  if (resolvedShip) {
    return {
      ...resolvedShip,
      name: resolvedShip.name || name || "Ship",
      portionSize: 1,
      basePrice: null,
      marketGroupID: null,
      iconID: null,
      soundID: null,
      graphicID: null,
      raceID: null,
    };
  }

  return {
    typeID: resolvedTypeID,
    name: name || "Item",
    groupID: 0,
    categoryID: 0,
    groupName: "",
    mass: null,
    volume: null,
    capacity: null,
    portionSize: 1,
    raceID: null,
    basePrice: null,
    marketGroupID: null,
    iconID: null,
    soundID: null,
    graphicID: null,
    radius: null,
    published: true,
  };
}

function getShipMetadata(typeID, name = null) {
  const resolvedTypeID = toNumber(typeID, DEFAULT_SHIP_TYPE_ID);
  return (
    resolveShipByTypeID(resolvedTypeID) || {
      typeID: resolvedTypeID,
      name: name || "Ship",
      groupID: 25,
      categoryID: SHIP_CATEGORY_ID,
      mass: null,
      volume: null,
      capacity: null,
      radius: null,
    }
  );
}

function shouldItemDefaultToSingleton(metadata) {
  const categoryID = toNumber(metadata && metadata.categoryID, 0);
  return categoryID === SHIP_CATEGORY_ID || categoryID === BLUEPRINT_CATEGORY_ID;
}

function getPackagedVolumeForType(typeID, metadata = null) {
  const numericTypeID = toNumber(typeID, 0);
  if (Object.prototype.hasOwnProperty.call(
    PACKAGED_VOLUME_OVERRIDES_BY_TYPE_ID,
    numericTypeID,
  )) {
    return PACKAGED_VOLUME_OVERRIDES_BY_TYPE_ID[numericTypeID];
  }

  const resolvedMetadata = metadata || getItemMetadata(numericTypeID);
  const groupID = toNumber(resolvedMetadata && resolvedMetadata.groupID, 0);
  if (Object.prototype.hasOwnProperty.call(
    PACKAGED_VOLUME_OVERRIDES_BY_GROUP_ID,
    groupID,
  )) {
    return PACKAGED_VOLUME_OVERRIDES_BY_GROUP_ID[groupID];
  }

  return toFiniteNumber(resolvedMetadata && resolvedMetadata.volume, 0);
}

function getUnitVolumeForPackagingState(metadata, singleton) {
  const resolvedMetadata = metadata || {};
  if (toNumber(singleton, 0) === 0) {
    return getPackagedVolumeForType(resolvedMetadata.typeID, resolvedMetadata);
  }
  return toFiniteNumber(resolvedMetadata.volume, 0);
}

function getInventoryItemUnitVolume(item) {
  if (!item || typeof item !== "object") {
    return 0;
  }
  const metadata = getItemMetadata(item.typeID, item.itemName);
  const volume = getUnitVolumeForPackagingState(metadata, item.singleton);
  if (volume > 0) {
    return volume;
  }
  return toFiniteNumber(item.volume, 0);
}

function buildInventoryItem({
  itemID,
  typeID,
  ownerID,
  locationID,
  flagID = ITEM_FLAGS.HANGAR,
  itemName = null,
  quantity = null,
  stacksize = null,
  singleton = null,
  customInfo = "",
  spaceState = null,
  conditionState = null,
  moduleState = undefined,
  createdAtMs = null,
  expiresAtMs = null,
  launcherID = null,
  dunRotation = null,
  spaceRadius = null,
  clientCustomInfo = undefined,
  mobileDepotState = null,
  stackOriginID = null,
  fighterState = null,
}) {
  const metadata = getItemMetadata(typeID, itemName);
  const defaultSingleton = shouldItemDefaultToSingleton(metadata) ? 1 : 0;
  const rawSingleton = singleton === null || singleton === undefined
    ? defaultSingleton
    : toNumber(singleton, defaultSingleton);
  const normalizedSingleton = rawSingleton === 2 ? 2 : rawSingleton > 0 ? 1 : 0;
  const normalizedUnits = normalizePositiveInteger(
    quantity === null || quantity === undefined ? stacksize : quantity,
    normalizePositiveInteger(metadata.portionSize, 1),
  );

  const item = {
    itemID: toNumber(itemID),
    typeID: toNumber(metadata.typeID, 0),
    ownerID: toNumber(ownerID),
    locationID: toNumber(locationID),
    flagID: toNumber(flagID, ITEM_FLAGS.HANGAR),
    quantity:
      normalizedSingleton === 2
        ? -2
        : normalizedSingleton === 1
          ? -1
          : normalizedUnits,
    stacksize: normalizedSingleton > 0 ? 1 : normalizedUnits,
    singleton: normalizedSingleton,
    groupID: toNumber(metadata.groupID, 0),
    categoryID: toNumber(metadata.categoryID, 0),
    customInfo: String(customInfo || ""),
    itemName: itemName || metadata.name || "Item",
    mass: toFiniteNumber(metadata.mass, 0),
    volume: getUnitVolumeForPackagingState(metadata, normalizedSingleton),
    capacity: toFiniteNumber(metadata.capacity, 0),
    radius: toFiniteNumber(metadata.radius, 0),
  };
  const normalizedSpaceState = normalizeSpaceState(spaceState);
  const normalizedModuleState = normalizeModuleState(moduleState);
  const normalizedConditionState =
    conditionState === null || conditionState === undefined
      ? null
      : normalizeShipConditionState(conditionState);
  const normalizedCreatedAtMs = normalizeTimestampMs(createdAtMs);
  const normalizedExpiresAtMs = normalizeTimestampMs(expiresAtMs);
  const normalizedFighterState = normalizeFighterState(fighterState);

  if (normalizedCreatedAtMs !== null) {
    item.createdAtMs = normalizedCreatedAtMs;
  }
  if (normalizedExpiresAtMs !== null) {
    item.expiresAtMs = normalizedExpiresAtMs;
  }
  if (toNumber(launcherID, 0) > 0) {
    item.launcherID = toNumber(launcherID, 0);
  }
  if (toFiniteNumber(spaceRadius, 0) > 0) {
    item.spaceRadius = toFiniteNumber(spaceRadius, 0);
  }
  if (clientCustomInfo !== undefined) {
    item.clientCustomInfo = cloneValue(clientCustomInfo);
  }
  if (mobileDepotState && typeof mobileDepotState === "object" && !Array.isArray(mobileDepotState)) {
    item.mobileDepotState = cloneValue(mobileDepotState);
  }
  if (toNumber(stackOriginID, 0) > 0) {
    item.stackOriginID = toNumber(stackOriginID, 0);
  }
  const normalizedDunRotation = normalizeDunRotation(dunRotation);
  if (normalizedDunRotation) {
    item.dunRotation = normalizedDunRotation;
  }

  if (item.categoryID === SHIP_CATEGORY_ID) {
    item.spaceState = normalizedSpaceState;
    item.conditionState = normalizedConditionState || normalizeShipConditionState(null);
    if (item.flagID !== 0) {
      item.spaceState = null;
    }

    return {
      ...item,
      shipID: item.itemID,
      shipTypeID: item.typeID,
      shipName: item.itemName,
    };
  }

  if (item.flagID === 0 && normalizedSpaceState) {
    item.spaceState = normalizedSpaceState;
  }

  if (normalizedConditionState) {
    item.conditionState = normalizedConditionState;
  }

  if (normalizedModuleState !== undefined) {
    item.moduleState = normalizedModuleState;
  }
  if (normalizedFighterState) {
    item.fighterState = normalizedFighterState;
  }

  return item;
}

function buildShipItem({
  itemID,
  typeID,
  ownerID,
  locationID,
  flagID = ITEM_FLAGS.HANGAR,
  itemName = null,
  quantity = null,
  stacksize = 1,
  singleton = null,
  customInfo = "",
  spaceState = null,
  conditionState = null,
}) {
  const metadata = getShipMetadata(typeID, itemName);
  return buildInventoryItem({
    itemID,
    typeID: metadata.typeID,
    ownerID,
    locationID,
    flagID,
    itemName: itemName || metadata.name || "Ship",
    quantity,
    stacksize,
    singleton:
      singleton === null || singleton === undefined ? 1 : singleton,
    customInfo,
    spaceState,
    conditionState,
  });
}

function normalizeInventoryItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

  const itemID = toNumber(rawItem.itemID ?? rawItem.shipID, 0);
  const typeID = toNumber(rawItem.typeID ?? rawItem.shipTypeID, 0);
  if (itemID <= 0 || typeID <= 0) {
    return null;
  }

  return buildInventoryItem({
    itemID,
    typeID,
    ownerID: rawItem.ownerID ?? defaults.ownerID ?? 0,
    locationID: rawItem.locationID ?? defaults.locationID ?? 0,
    flagID: rawItem.flagID ?? defaults.flagID ?? ITEM_FLAGS.HANGAR,
    itemName: rawItem.itemName ?? rawItem.shipName ?? defaults.itemName ?? null,
    quantity: rawItem.quantity ?? defaults.quantity ?? null,
    stacksize: rawItem.stacksize ?? defaults.stacksize ?? null,
    singleton: rawItem.singleton ?? defaults.singleton ?? null,
    customInfo: rawItem.customInfo ?? defaults.customInfo ?? "",
    spaceState: Object.prototype.hasOwnProperty.call(rawItem, "spaceState")
      ? rawItem.spaceState
      : defaults.spaceState ?? null,
    conditionState: Object.prototype.hasOwnProperty.call(rawItem, "conditionState")
      ? rawItem.conditionState
      : defaults.conditionState ?? null,
    moduleState: Object.prototype.hasOwnProperty.call(rawItem, "moduleState")
      ? rawItem.moduleState
      : defaults.moduleState,
    createdAtMs: Object.prototype.hasOwnProperty.call(rawItem, "createdAtMs")
      ? rawItem.createdAtMs
      : defaults.createdAtMs ?? null,
    expiresAtMs: Object.prototype.hasOwnProperty.call(rawItem, "expiresAtMs")
      ? rawItem.expiresAtMs
      : defaults.expiresAtMs ?? null,
    launcherID: Object.prototype.hasOwnProperty.call(rawItem, "launcherID")
      ? rawItem.launcherID
      : defaults.launcherID ?? null,
    spaceRadius: Object.prototype.hasOwnProperty.call(rawItem, "spaceRadius")
      ? rawItem.spaceRadius
      : defaults.spaceRadius ?? null,
    clientCustomInfo: Object.prototype.hasOwnProperty.call(rawItem, "clientCustomInfo")
      ? rawItem.clientCustomInfo
      : defaults.clientCustomInfo,
    mobileDepotState: Object.prototype.hasOwnProperty.call(rawItem, "mobileDepotState")
      ? rawItem.mobileDepotState
      : defaults.mobileDepotState ?? null,
    stackOriginID: Object.prototype.hasOwnProperty.call(rawItem, "stackOriginID")
      ? rawItem.stackOriginID
      : defaults.stackOriginID ?? null,
    dunRotation: Object.prototype.hasOwnProperty.call(rawItem, "dunRotation")
      ? rawItem.dunRotation
      : defaults.dunRotation ?? null,
    fighterState: Object.prototype.hasOwnProperty.call(rawItem, "fighterState")
      ? rawItem.fighterState
      : defaults.fighterState ?? null,
  });
}

function normalizeShipItem(rawItem, defaults = {}) {
  const normalizedItem = normalizeInventoryItem(rawItem, defaults);
  return normalizedItem && normalizedItem.categoryID === SHIP_CATEGORY_ID
    ? normalizedItem
    : null;
}

function getStructureState() {
  return require(path.join(__dirname, "../structure/structureState"));
}

function getLocalItemIDHighWaterMark(charId, items, characterRecord = null) {
  let maxItemID = toNumber(charId, 0) + 100;
  const record = characterRecord || null;

  if (record && record.shipID && toNumber(record.shipID, 0) > maxItemID) {
    maxItemID = toNumber(record.shipID, maxItemID);
  }

  for (const rawItem of Object.values(items)) {
    const item = normalizeInventoryItem(rawItem);
    if (!item) {
      continue;
    }

    if (item.itemID > maxItemID) {
      maxItemID = item.itemID;
    }
  }

  return maxItemID;
}

function nextItemID(charId, items, characterRecord = null) {
  if (!Array.isArray(reservedItemIDBatch) || reservedItemIDBatch.length <= 0) {
    const localHighWaterMark =
      getLocalItemIDHighWaterMark(charId, items, characterRecord) + 1;
    reservedItemIDBatch = reserveItemIDs(ITEM_ID_RESERVE_BATCH_SIZE, {
      minCandidate: localHighWaterMark,
    });
  }

  const allocatedItemID = toNumber(
    reservedItemIDBatch.shift(),
    0,
  );
  if (allocatedItemID <= 0) {
    return getLocalItemIDHighWaterMark(charId, items, characterRecord) + 1;
  }
  return allocatedItemID;
}

function repairOversizedStackableItems(items, characters = {}) {
  let itemsDirty = false;
  const repairs = [];
  const stackableItems = Object.values(items || {})
    .map((rawItem) => normalizeInventoryItem(rawItem))
    .filter((item) => isStackableInventoryItem(item))
    .sort((left, right) => toNumber(left.itemID, 0) - toNumber(right.itemID, 0));

  for (const item of stackableItems) {
    const currentQuantity = getStackableItemQuantity(item);
    if (currentQuantity <= CLIENT_INVENTORY_STACK_LIMIT) {
      continue;
    }

    const chunks = splitStackQuantityIntoClientSafeChunks(currentQuantity);
    if (chunks.length === 0) {
      continue;
    }

    const [primaryChunk, ...overflowChunks] = chunks;
    const updatedPrimary = buildInventoryItem({
      ...item,
      quantity: primaryChunk,
      stacksize: primaryChunk,
      singleton: 0,
    });
    items[String(updatedPrimary.itemID)] = updatedPrimary;

    const ownerRecord = characters[String(toNumber(item.ownerID, 0))] || null;
    const stackOriginID =
      toNumber(item.stackOriginID, 0) > 0
        ? toNumber(item.stackOriginID, 0)
        : toNumber(item.itemID, 0);

    for (const chunkQuantity of overflowChunks) {
      const splitItem = buildInventoryItem({
        ...item,
        itemID: nextItemID(item.ownerID, items, ownerRecord),
        quantity: chunkQuantity,
        stacksize: chunkQuantity,
        singleton: 0,
        stackOriginID,
      });
      items[String(splitItem.itemID)] = splitItem;
    }

    repairs.push({
      itemID: toNumber(item.itemID, 0),
      ownerID: toNumber(item.ownerID, 0),
      typeID: toNumber(item.typeID, 0),
      originalQuantity: currentQuantity,
      resultingStacks: chunks.length,
    });
    itemsDirty = true;
  }

  return {
    itemsDirty,
    repairs,
  };
}

function applyStackableGrant({
  ownerID,
  locationID,
  flagID,
  metadata,
  quantity,
  options = {},
  items,
  stackIndex,
  changes,
  createdItems,
  transientCreatedItemIDs,
  characterRecord = null,
}) {
  let remainingQuantity = quantity;
  let stackTouchCount = 0;
  let splitApplied = false;

  while (remainingQuantity > 0) {
    const existingStack = findStackWithAvailableCapacity(
      stackIndex,
      ownerID,
      locationID,
      flagID,
      metadata.typeID,
    );

    if (existingStack) {
      const currentQuantity = getStackableItemQuantity(existingStack);
      const availableCapacity = Math.max(
        0,
        CLIENT_INVENTORY_STACK_LIMIT - currentQuantity,
      );
      if (availableCapacity > 0) {
        const mergedQuantity = Math.min(remainingQuantity, availableCapacity);
        const previousState = captureItemState(existingStack);
        const updatedItem = buildInventoryItem({
          ...existingStack,
          quantity: currentQuantity + mergedQuantity,
          stacksize: currentQuantity + mergedQuantity,
          singleton: 0,
        });
        items[String(updatedItem.itemID)] = updatedItem;
        appendStackIndexEntry(stackIndex, updatedItem);
        changes.push({
          created: false,
          item: cloneValue(updatedItem),
          previousState,
        });
        createdItems.push(cloneValue(updatedItem));
        remainingQuantity -= mergedQuantity;
        stackTouchCount += 1;
        splitApplied = splitApplied || remainingQuantity > 0;
        continue;
      }
    }

    const chunkQuantity = Math.min(
      remainingQuantity,
      CLIENT_INVENTORY_STACK_LIMIT,
    );
    const item = buildInventoryItem({
      itemID: nextItemID(ownerID, items, characterRecord),
      typeID: metadata.typeID,
      ownerID,
      locationID,
      flagID,
      itemName: options.itemName || metadata.name,
      quantity: chunkQuantity,
      stacksize: chunkQuantity,
      singleton: 0,
      customInfo: options.customInfo || "",
      spaceState: options.spaceState || null,
      conditionState: options.conditionState || null,
      moduleState: options.moduleState,
      createdAtMs: options.createdAtMs ?? null,
      expiresAtMs: options.expiresAtMs ?? null,
      launcherID: options.launcherID ?? null,
      dunRotation: options.dunRotation ?? null,
      spaceRadius: options.spaceRadius ?? null,
    });
    items[String(item.itemID)] = item;
    appendStackIndexEntry(stackIndex, item);
    changes.push({
      created: true,
      item: cloneValue(item),
      previousState: {
        locationID: 0,
        flagID: 0,
      },
    });
    createdItems.push(cloneValue(item));
    if (options.transient === true) {
      transientCreatedItemIDs.push(item.itemID);
    }
    remainingQuantity -= chunkQuantity;
    stackTouchCount += 1;
    splitApplied =
      splitApplied ||
      chunkQuantity !== quantity ||
      remainingQuantity > 0;
  }

  return {
    stackTouchCount,
    splitApplied,
  };
}

// One-time data-integrity pass run lazily on first ItemStore access. The legacy
// character→items ship migration (storedShips promotion, starter-ship backfill)
// has been retired: live records are normalized by characterState, imports write
// ship rows straight into the items table, and ships are provisioned on demand by
// ensureCharacterActiveShipItem(). All that remains here is repairing any
// oversized stackable items into client-safe stacks.
function ensureMigrated() {
  if (migrationComplete) {
    return;
  }

  const characters = readCharacters();
  const items = readItems();
  let itemsDirty = false;

  const stackRepairResult = repairOversizedStackableItems(items, characters);
  if (stackRepairResult.itemsDirty) {
    itemsDirty = true;
    for (const repair of stackRepairResult.repairs) {
      log.info(
        `[ItemStore] Repaired oversized stack item=${repair.itemID} owner=${repair.ownerID} type=${repair.typeID} quantity=${repair.originalQuantity} into ${repair.resultingStacks} client-safe stacks`,
      );
    }
  }

  if (itemsDirty && !writeItems(items)) {
    log.warn("[ItemStore] Failed to persist repaired items table");
  }

  migrationComplete = true;
}

function getAllItems() {
  ensureMigrated();
  return cloneValue(readItems());
}

function listOwnedItems(ownerId, options = {}) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  const locationID =
    options.locationID === undefined || options.locationID === null
      ? null
      : toNumber(options.locationID, 0);
  const flagID =
    options.flagID === undefined || options.flagID === null
      ? null
      : toNumber(options.flagID, ITEM_FLAGS.HANGAR);
  const categoryID =
    options.categoryID === undefined || options.categoryID === null
      ? null
      : toNumber(options.categoryID, 0);
  const typeID =
    options.typeID === undefined || options.typeID === null
      ? null
      : toNumber(options.typeID, 0);

  return (ensureItemIndexes().byOwner.get(numericOwnerId) || [])
    .filter(
      (entry) =>
        entry &&
        (locationID === null || entry.locationID === locationID) &&
        (flagID === null || entry.flagID === flagID) &&
        (categoryID === null || entry.categoryID === categoryID) &&
        (typeID === null || entry.typeID === typeID),
    )
    .map((entry) => cloneValue(entry));
}

function listCharacterItems(charId, options = {}) {
  return listOwnedItems(charId, options);
}

function listCharacterShipItems(charId, options = {}) {
  return listCharacterItems(charId, {
    ...options,
    categoryID: SHIP_CATEGORY_ID,
  });
}

function getCharacterShipItems(charId) {
  return listCharacterShipItems(charId);
}

function getCharacterHangarShipItems(charId, stationId) {
  return listCharacterShipItems(charId, {
    locationID: stationId,
    flagID: ITEM_FLAGS.HANGAR,
  });
}

function findCharacterShipItem(charId, shipId) {
  const numericShipId = toNumber(shipId, 0);
  if (numericShipId <= 0) {
    return null;
  }

  return (
    listCharacterShipItems(charId).find((entry) => entry.itemID === numericShipId) ||
    null
  );
}

function findShipItemById(shipId) {
  const numericShipId = toNumber(shipId, 0);
  if (numericShipId <= 0) {
    return null;
  }

  const entry = ensureItemIndexes().byID.get(numericShipId) || null;
  return entry && entry.categoryID === SHIP_CATEGORY_ID ? cloneValue(entry) : null;
}

function findItemById(itemId) {
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return null;
  }

  const entry = ensureItemIndexes().byID.get(numericItemId) || null;
  return entry ? cloneValue(entry) : null;
}

function findCharacterShipByType(charId, typeId, stationId = null) {
  const numericTypeId = toNumber(typeId, 0);
  if (numericTypeId <= 0) {
    return null;
  }

  const ships =
    stationId === null || stationId === undefined
      ? listCharacterShipItems(charId)
      : getCharacterHangarShipItems(charId, stationId);

  return ships.find((entry) => entry.typeID === numericTypeId) || null;
}

function isCapsuleTypeID(typeID) {
  const numericTypeID = toNumber(typeID, 0);
  return numericTypeID === CAPSULE_TYPE_ID || numericTypeID === CAPSULE_TYPE_ID_GOLDEN;
}

function findCharacterCapsule(charId, stationId = null) {
  const ships =
    stationId === null || stationId === undefined
      ? listCharacterShipItems(charId)
      : getCharacterHangarShipItems(charId, stationId);

  return ships.find((entry) => isCapsuleTypeID(entry.typeID)) || null;
}

function getShipSpaceRecordParts(shipItem) {
  return {
    locationID: toNumber(shipItem && shipItem.locationID, 0),
    flagID: toNumber(shipItem && shipItem.flagID, ITEM_FLAGS.HANGAR),
    stateSystemID: toNumber(
      shipItem && shipItem.spaceState && shipItem.spaceState.systemID,
      0,
    ),
  };
}

function isCoherentSpaceShipRecord(shipItem) {
  const { locationID, flagID, stateSystemID } = getShipSpaceRecordParts(shipItem);
  return (
    flagID === 0 &&
    locationID > 0 &&
    stateSystemID > 0 &&
    locationID === stateSystemID
  );
}

function isDockedShipRecord(shipItem) {
  const { locationID, flagID } = getShipSpaceRecordParts(shipItem);
  if (flagID !== ITEM_FLAGS.HANGAR || locationID <= 0) {
    return false;
  }
  if (worldData.getStationByID(locationID)) {
    return true;
  }
  const structure = getStructureState().getStructureByID(locationID, {
    refresh: false,
  });
  return Boolean(structure);
}

function resolveActiveShipSpaceRepairSystemID(shipItem, solarSystemID) {
  if (!shipItem) {
    return 0;
  }
  if (isDockedShipRecord(shipItem)) {
    return 0;
  }
  const { locationID, flagID, stateSystemID } = getShipSpaceRecordParts(shipItem);

  if (flagID === 0) {
    if (locationID > 0 && stateSystemID > 0) {
      if (locationID === stateSystemID) {
        return 0;
      }
      if (
        hasPositiveLocationID(solarSystemID) &&
        (toNumber(solarSystemID, 0) === locationID ||
          toNumber(solarSystemID, 0) === stateSystemID)
      ) {
        return toNumber(solarSystemID, 0);
      }
      return stateSystemID;
    }
    if (locationID > 0) {
      return locationID;
    }
    if (stateSystemID > 0) {
      return stateSystemID;
    }
  }

  if (hasPositiveLocationID(solarSystemID)) {
    return toNumber(solarSystemID, 0);
  }

  return 0;
}

function activeShipNeedsSpaceRecordRepair(shipItem, solarSystemID) {
  if (!shipItem) {
    return false;
  }
  return resolveActiveShipSpaceRepairSystemID(shipItem, solarSystemID) > 0;
}

function repairActiveShipToSpaceRecord(charId, shipItem, solarSystemID) {
  const repairSystemID = resolveActiveShipSpaceRepairSystemID(
    shipItem,
    solarSystemID,
  );
  if (!shipItem || repairSystemID <= 0) {
    return shipItem;
  }
  const { locationID, flagID, stateSystemID } = getShipSpaceRecordParts(shipItem);

  const moveResult = moveShipToSpace(
    shipItem.itemID,
    repairSystemID,
    buildStoppedSpaceStateForSystem(repairSystemID, shipItem.spaceState),
  );
  if (!moveResult.success) {
    log.warn(
      `[ItemStore] Failed to repair in-space active ship for char=${charId} ` +
        `ship=${shipItem.itemID} system=${repairSystemID}: ${moveResult.errorMsg}`,
    );
    return shipItem;
  }

  log.info(
    `[ItemStore] Repaired in-space active ship for char=${charId} ` +
      `ship=${shipItem.itemID} system=${repairSystemID} ` +
      `location=${locationID} flag=${flagID} stateSystem=${stateSystemID}`,
  );
  return cloneValue(moveResult.data || shipItem);
}

function ensureCharacterActiveShipItem(charId, existingRecord = null) {
  ensureMigrated();

  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return null;
  }

  const characters = readCharacters();
  const record = existingRecord || characters[String(numericCharId)];
  if (!record) {
    return null;
  }
  if (record.isDeleted === true || record.accountId === null) {
    return null;
  }

  const recordStationID = toNumber(record.stationID ?? record.stationid, 0);
  const recordStructureID = toNumber(record.structureID ?? record.structureid, 0);
  const recordSolarSystemID = toNumber(
    record.solarSystemID ??
      record.solarsystemID ??
      record.solarsystemid ??
      record.solarSystemId,
    0,
  );
  const recordIsInSpace =
    recordSolarSystemID > 0 && recordStationID <= 0 && recordStructureID <= 0;

  const activeShip = findCharacterShipItem(numericCharId, record.shipID);
  if (activeShip) {
    if (
      recordIsInSpace &&
      activeShipNeedsSpaceRecordRepair(activeShip, recordSolarSystemID)
    ) {
      return repairActiveShipToSpaceRecord(
        numericCharId,
        activeShip,
        recordSolarSystemID,
      );
    }
    return activeShip;
  }

  const ownedShips = listCharacterShipItems(numericCharId);
  if (ownedShips.length > 0) {
    let repairedShip = recordIsInSpace
      ? ownedShips.find(
          (ship) =>
            isCoherentSpaceShipRecord(ship) &&
            toNumber(ship.locationID, 0) === recordSolarSystemID,
        ) || ownedShips.find(
          (ship) => isCoherentSpaceShipRecord(ship),
        ) || ownedShips.find(
          (ship) =>
            toNumber(ship.locationID, 0) === recordSolarSystemID ||
            toNumber(ship.spaceState && ship.spaceState.systemID, 0) ===
              recordSolarSystemID,
        ) || ownedShips[0]
      : ownedShips[0];
    if (
      recordIsInSpace &&
      activeShipNeedsSpaceRecordRepair(repairedShip, recordSolarSystemID)
    ) {
      repairedShip = repairActiveShipToSpaceRecord(
        numericCharId,
        repairedShip,
        recordSolarSystemID,
      );
    }
    const syncResult = syncCharacterActiveShip(numericCharId, repairedShip);
    if (!syncResult.success) {
      log.warn(
        `[ItemStore] Failed to repair active ship for char=${numericCharId} from owned ship=${repairedShip.itemID}`,
      );
    } else {
      log.info(
        `[ItemStore] Repaired active ship for char=${numericCharId} -> ship=${repairedShip.itemID}`,
      );
    }
    return repairedShip;
  }

  if (recordIsInSpace) {
    const items = readItems();
    const starterShip = buildShipItem({
      itemID: nextItemID(numericCharId, items, record),
      typeID: record.shipTypeID || DEFAULT_SHIP_TYPE_ID,
      ownerID: numericCharId,
      locationID: recordSolarSystemID,
      flagID: 0,
      itemName: record.shipName || null,
      spaceState: buildStoppedSpaceStateForSystem(recordSolarSystemID),
    });

    items[String(starterShip.itemID)] = starterShip;
    if (!writeItems(items, { indexDelta: { upsertedIDs: [starterShip.itemID] } })) {
      log.warn(
        `[ItemStore] Failed to provision in-space starter ship for char=${numericCharId}`,
      );
      return null;
    }

    const syncResult = syncCharacterActiveShip(numericCharId, starterShip);
    if (!syncResult.success) {
      log.warn(
        `[ItemStore] Provisioned in-space starter ship=${starterShip.itemID} ` +
          `for char=${numericCharId} but failed to sync character record`,
      );
    } else {
      log.info(
        `[ItemStore] Provisioned in-space starter ship for char=${numericCharId} ` +
          `system=${recordSolarSystemID} -> ship=${starterShip.itemID}`,
      );
    }

    return cloneValue(starterShip);
  }

  const dockedLocationID = recordStationID || recordStructureID || 60003760;
  try {
    const {
      getStarterShipFitting,
    } = require(path.join(__dirname, "../ship/starterShipFittingState"));
    const starterShipFitting = getStarterShipFitting(record.shipTypeID);
    if (starterShipFitting) {
      const {
      spawnRookieShipForCharacter,
      } = require(path.join(__dirname, "../ship/rookieShipRuntime"));
      const rookieShipResult = spawnRookieShipForCharacter(
        numericCharId,
        dockedLocationID,
        {
          characterRecord: record,
          shipTypeID: toNumber(record.shipTypeID, DEFAULT_SHIP_TYPE_ID),
          shipName: record.shipName || null,
          preferExplicitShipType: true,
          setActiveShip: true,
          logLabel: "EnsureCharacterActiveShipItem",
        },
      );
      if (rookieShipResult.success && rookieShipResult.data && rookieShipResult.data.ship) {
        return cloneValue(rookieShipResult.data.ship);
      }
      const writeLog =
        rookieShipResult.errorMsg === "INVALID_ROOKIE_SHIP_REQUEST"
          ? log.debug
          : log.warn;
      writeLog(
        `[ItemStore] Failed to provision rookie ship for char=${numericCharId} error=${rookieShipResult.errorMsg}`,
      );
    }
  } catch (error) {
    log.warn(
      `[ItemStore] Failed to provision rookie ship for char=${numericCharId}: ${error.message}`,
    );
  }

  const items = readItems();
  const starterShip = buildShipItem({
    itemID: nextItemID(numericCharId, items, record),
    typeID: record.shipTypeID || DEFAULT_SHIP_TYPE_ID,
    ownerID: numericCharId,
    locationID: dockedLocationID,
    flagID: ITEM_FLAGS.HANGAR,
    itemName: record.shipName || null,
  });

  items[String(starterShip.itemID)] = starterShip;
  if (!writeItems(items, { indexDelta: { upsertedIDs: [starterShip.itemID] } })) {
    log.warn(
      `[ItemStore] Failed to provision starter ship for char=${numericCharId}`,
    );
    return null;
  }

  const syncResult = syncCharacterActiveShip(numericCharId, starterShip);
  if (!syncResult.success) {
    log.warn(
      `[ItemStore] Provisioned starter ship=${starterShip.itemID} for char=${numericCharId} but failed to sync character record`,
    );
  } else {
    log.info(
      `[ItemStore] Provisioned starter ship for char=${numericCharId} -> ship=${starterShip.itemID}`,
    );
  }

  return cloneValue(starterShip);
}

function getActiveShipItem(charId) {
  return ensureCharacterActiveShipItem(charId);
}

function syncCharacterActiveShip(charId, shipItem) {
  ensureMigrated();
  const characters = readCharacters();
  const record = characters[String(charId)];
  if (!record || !shipItem) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const nextRecord = {
    ...record,
    shipID: shipItem.itemID,
    shipTypeID: shipItem.typeID,
    shipName: shipItem.itemName,
  };

  if (Object.prototype.hasOwnProperty.call(nextRecord, "storedShips")) {
    delete nextRecord.storedShips;
  }

  // Phase 0: persist the single updated character record through its owner
  // (characterState) instead of mutating the whole characters map and writing
  // the table directly. Lazy require avoids the characterState->itemStore cycle.
  const writeResult = require("../character/characterState").writeCharacterRecord(
    charId,
    nextRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: nextRecord,
  };
}

function resolveItemTypeReference(itemType) {
  if (itemType && typeof itemType === "object" && itemType.typeID) {
    return getItemMetadata(itemType.typeID, itemType.name || itemType.itemName || null);
  }

  return getItemMetadata(itemType);
}

function buildStackKey(ownerID, locationID, flagID, typeID) {
  return [
    toNumber(ownerID, 0),
    toNumber(locationID, 0),
    toNumber(flagID, ITEM_FLAGS.HANGAR),
    toNumber(typeID, 0),
  ].join(":");
}

// Validate every grant entry BEFORE the mutation loop runs. Both grant paths
// write each created item straight into the shared items cache as they iterate;
// if a later entry failed validation and the function returned early, the
// earlier entries would already be in the cache with no matching writeItems() —
// stranding un-indexed, un-persisted rows that silently drift the item index
// (and later flush to the DB as phantoms). Fail the whole batch up front so the
// cache is only ever touched once the entire grant is known-good.
function validateGrantEntries(entries) {
  for (const entry of entries) {
    const metadata = resolveItemTypeReference(entry.itemType);
    if (
      !metadata ||
      !Number.isInteger(toNumber(metadata.typeID, 0)) ||
      metadata.typeID <= 0
    ) {
      return { success: false, errorMsg: "ITEM_TYPE_NOT_FOUND" };
    }
    if (!normalizePositiveSafeInteger(entry.quantity, null)) {
      return { success: false, errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE" };
    }
  }
  return null;
}

function grantItemsToCharacterLocation(
  charId,
  locationId,
  flagId,
  grantEntries = [],
) {
  ensureMigrated();
  const characters = readCharacters();
  const items = readItems();
  const record = characters[String(charId)];
  if (!record) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const entries = Array.isArray(grantEntries)
    ? grantEntries.filter(Boolean)
    : [];
  if (entries.length === 0) {
    return {
      success: true,
      data: {
        quantity: 0,
        items: [],
        changes: [],
        grantedEntries: [],
      },
    };
  }

  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId = toNumber(flagId, ITEM_FLAGS.HANGAR);
  const changes = [];
  const createdItems = [];
  const grantedEntries = [];
  const transientCreatedItemIDs = [];
  const entryValidationError = validateGrantEntries(entries);
  if (entryValidationError) {
    return entryValidationError;
  }
  const stackIndex = buildStackIndex(items);
  let stackSplitApplied = false;
  let stackSplitStackCount = 0;

  for (const entry of entries) {
    const metadata = resolveItemTypeReference(entry.itemType);
    if (!metadata || !Number.isInteger(toNumber(metadata.typeID, 0)) || metadata.typeID <= 0) {
      return {
        success: false,
        errorMsg: "ITEM_TYPE_NOT_FOUND",
      };
    }

    const normalizedQuantity = normalizePositiveSafeInteger(entry.quantity, null);
    if (!normalizedQuantity) {
      return {
        success: false,
        errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
      };
    }
    const options =
      entry.options && typeof entry.options === "object"
        ? entry.options
        : {};
    const singletonMode =
      options.singleton === undefined || options.singleton === null
        ? shouldItemDefaultToSingleton(metadata)
        : toNumber(options.singleton, 0) > 0;
    const resolvedSingleton =
      options.singleton !== undefined && options.singleton !== null
        ? toNumber(options.singleton, 1)
        : 1;

    if (singletonMode) {
      for (let index = 0; index < normalizedQuantity; index += 1) {
        const item = buildInventoryItem({
          itemID: nextItemID(charId, items, record),
          typeID: metadata.typeID,
          ownerID: charId,
          locationID: numericLocationId,
          flagID: numericFlagId,
          itemName: options.itemName || metadata.name,
          singleton: resolvedSingleton,
          customInfo: options.customInfo || "",
          spaceState: options.spaceState || null,
          conditionState: options.conditionState || null,
          moduleState: options.moduleState,
          createdAtMs: options.createdAtMs ?? null,
          expiresAtMs: options.expiresAtMs ?? null,
          launcherID: options.launcherID ?? null,
          dunRotation: options.dunRotation ?? null,
          spaceRadius: options.spaceRadius ?? null,
        });

        items[String(item.itemID)] = item;
        changes.push({
          created: true,
          item: cloneValue(item),
          previousState: {
            locationID: 0,
            flagID: 0,
          },
        });
        createdItems.push(cloneValue(item));
        if (options.transient === true) {
          transientCreatedItemIDs.push(item.itemID);
        }
      }
    } else {
      const stackGrantResult = applyStackableGrant({
        ownerID: charId,
        locationID: numericLocationId,
        flagID: numericFlagId,
        metadata,
        quantity: normalizedQuantity,
        options,
        items,
        stackIndex,
        changes,
        createdItems,
        transientCreatedItemIDs,
        characterRecord: record,
      });
      stackSplitApplied = stackSplitApplied || stackGrantResult.splitApplied;
      stackSplitStackCount += stackGrantResult.stackTouchCount;
    }

    grantedEntries.push({
      itemType: cloneValue(metadata),
      quantity: normalizedQuantity,
    });
  }

  if (!writeItems(items, { indexDelta: indexDeltaFromChanges(changes) })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  if (transientCreatedItemIDs.length > 0) {
    for (const itemID of transientCreatedItemIDs) {
      repo.setTransientPath(ITEMS_TABLE, `/${String(itemID)}`, true);
    }
  }

  const singleEntry = entries.length === 1 ? grantedEntries[0] || null : null;
  return {
    success: true,
    data: {
      itemType: singleEntry ? singleEntry.itemType : null,
      quantity: singleEntry ? singleEntry.quantity : grantedEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      ),
      items: createdItems,
      changes,
      grantedEntries,
      stackSplitApplied,
      stackSplitStackCount,
    },
  };
}

function grantItemToCharacterLocation(
  charId,
  locationId,
  flagId,
  itemType,
  quantity = 1,
  options = {},
) {
  return grantItemsToCharacterLocation(
    charId,
    locationId,
    flagId,
    [{
      itemType,
      quantity,
      options,
    }],
  );
}

function grantItemToCharacterStationHangar(charId, stationId, itemType, quantity = 1) {
  return grantItemToCharacterLocation(
    charId,
    stationId,
    ITEM_FLAGS.HANGAR,
    itemType,
    quantity,
  );
}

function grantItemsToCharacterStationHangar(charId, stationId, grantEntries = []) {
  return grantItemsToCharacterLocation(
    charId,
    stationId,
    ITEM_FLAGS.HANGAR,
    grantEntries,
  );
}

function grantItemsToOwnerLocation(
  ownerId,
  locationId,
  flagId,
  grantEntries = [],
) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  if (numericOwnerId <= 0) {
    return {
      success: false,
      errorMsg: "OWNER_NOT_FOUND",
    };
  }

  const characters = readCharacters();
  if (characters[String(numericOwnerId)]) {
    return grantItemsToCharacterLocation(
      numericOwnerId,
      locationId,
      flagId,
      grantEntries,
    );
  }

  const items = readItems();
  const entries = Array.isArray(grantEntries)
    ? grantEntries.filter(Boolean)
    : [];
  if (entries.length === 0) {
    return {
      success: true,
      data: {
        quantity: 0,
        items: [],
        changes: [],
        grantedEntries: [],
      },
    };
  }

  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId = toNumber(flagId, ITEM_FLAGS.HANGAR);
  const changes = [];
  const createdItems = [];
  const grantedEntries = [];
  const transientCreatedItemIDs = [];
  const entryValidationError = validateGrantEntries(entries);
  if (entryValidationError) {
    return entryValidationError;
  }
  const stackIndex = buildStackIndex(items);
  let stackSplitApplied = false;
  let stackSplitStackCount = 0;

  for (const entry of entries) {
    const metadata = resolveItemTypeReference(entry.itemType);
    if (!metadata || !Number.isInteger(toNumber(metadata.typeID, 0)) || metadata.typeID <= 0) {
      return {
        success: false,
        errorMsg: "ITEM_TYPE_NOT_FOUND",
      };
    }

    const normalizedQuantity = normalizePositiveSafeInteger(entry.quantity, null);
    if (!normalizedQuantity) {
      return {
        success: false,
        errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
      };
    }
    const options =
      entry.options && typeof entry.options === "object"
        ? entry.options
        : {};
    const singletonMode =
      options.singleton === undefined || options.singleton === null
        ? shouldItemDefaultToSingleton(metadata)
        : toNumber(options.singleton, 0) > 0;
    const resolvedSingleton =
      options.singleton !== undefined && options.singleton !== null
        ? toNumber(options.singleton, 1)
        : 1;

    if (singletonMode) {
      for (let index = 0; index < normalizedQuantity; index += 1) {
        const item = buildInventoryItem({
          itemID: nextItemID(
            numericOwnerId,
            items,
            characters[String(numericOwnerId)] || null,
          ),
          typeID: metadata.typeID,
          ownerID: numericOwnerId,
          locationID: numericLocationId,
          flagID: numericFlagId,
          itemName: options.itemName || metadata.name,
          singleton: resolvedSingleton,
          customInfo: options.customInfo || "",
          spaceState: options.spaceState || null,
          conditionState: options.conditionState || null,
          moduleState: options.moduleState,
          createdAtMs: options.createdAtMs ?? null,
          expiresAtMs: options.expiresAtMs ?? null,
          launcherID: options.launcherID ?? null,
          dunRotation: options.dunRotation ?? null,
          spaceRadius: options.spaceRadius ?? null,
        });

        items[String(item.itemID)] = item;
        changes.push({
          created: true,
          item: cloneValue(item),
          previousState: {
            locationID: 0,
            flagID: 0,
          },
        });
        createdItems.push(cloneValue(item));
        if (options.transient === true) {
          transientCreatedItemIDs.push(item.itemID);
        }
      }
    } else {
      const stackGrantResult = applyStackableGrant({
        ownerID: numericOwnerId,
        locationID: numericLocationId,
        flagID: numericFlagId,
        metadata,
        quantity: normalizedQuantity,
        options,
        items,
        stackIndex,
        changes,
        createdItems,
        transientCreatedItemIDs,
        characterRecord: characters[String(numericOwnerId)] || null,
      });
      stackSplitApplied = stackSplitApplied || stackGrantResult.splitApplied;
      stackSplitStackCount += stackGrantResult.stackTouchCount;
    }

    grantedEntries.push({
      itemType: cloneValue(metadata),
      quantity: normalizedQuantity,
    });
  }

  if (!writeItems(items, { indexDelta: indexDeltaFromChanges(changes) })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  if (transientCreatedItemIDs.length > 0) {
    for (const itemID of transientCreatedItemIDs) {
      repo.setTransientPath(ITEMS_TABLE, `/${String(itemID)}`, true);
    }
  }

  const singleEntry = entries.length === 1 ? grantedEntries[0] || null : null;
  return {
    success: true,
    data: {
      itemType: singleEntry ? singleEntry.itemType : null,
      quantity: singleEntry ? singleEntry.quantity : grantedEntries.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
      items: createdItems,
      changes,
      grantedEntries,
      stackSplitApplied,
      stackSplitStackCount,
    },
  };
}

function grantItemToOwnerLocation(
  ownerId,
  locationId,
  flagId,
  itemType,
  quantity = 1,
  options = {},
) {
  return grantItemsToOwnerLocation(
    ownerId,
    locationId,
    flagId,
    [{
      itemType,
      quantity,
      options,
    }],
  );
}

function resolveSpawnedSpaceItemRadius(itemType, options = {}) {
  const explicitSpaceRadius = toFiniteNumber(options && options.spaceRadius, 0);
  if (explicitSpaceRadius > 0) {
    return explicitSpaceRadius;
  }

  const metadata = getItemMetadata(
    itemType && itemType.typeID,
    itemType && (itemType.itemName || itemType.name),
  );
  const groupName = String(
    metadata && metadata.groupName || itemType && itemType.groupName || "",
  ).trim().toLowerCase();
  if (groupName !== "wreck") {
    return 0;
  }

  return resolveRuntimeWreckRadius(metadata, toFiniteNumber(metadata && metadata.radius, 0));
}

function createSpaceItemForCharacter(charId, solarSystemId, itemType, options = {}) {
  const normalizedSystemId = toNumber(solarSystemId, 0);
  if (normalizedSystemId <= 0) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const createResult = grantItemToCharacterLocation(
    charId,
    normalizedSystemId,
    0,
    itemType,
    1,
    {
      ...options,
      singleton: 1,
      createdAtMs: options.createdAtMs ?? Date.now(),
      expiresAtMs: options.expiresAtMs ?? null,
      spaceRadius: (
        resolveSpawnedSpaceItemRadius(itemType, options) || null
      ),
      spaceState: normalizeSpaceState({
        systemID: normalizedSystemId,
        position: options.position,
        velocity: options.velocity,
        direction: options.direction,
        targetPoint: options.targetPoint,
        speedFraction: options.speedFraction,
        mode: options.mode || "STOP",
        targetEntityID: options.targetEntityID,
        followRange: options.followRange,
        orbitDistance: options.orbitDistance,
        orbitNormal: options.orbitNormal,
        orbitSign: options.orbitSign,
      }),
    },
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: createResult.data.items[0] || null,
    changes: createResult.data.changes || [],
  };
}

function createSpaceItemForOwner(ownerId, solarSystemId, itemType, options = {}) {
  const normalizedSystemId = toNumber(solarSystemId, 0);
  if (normalizedSystemId <= 0) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const createResult = grantItemToOwnerLocation(
    ownerId,
    normalizedSystemId,
    0,
    itemType,
    1,
    {
      ...options,
      singleton: 1,
      createdAtMs: options.createdAtMs ?? Date.now(),
      expiresAtMs: options.expiresAtMs ?? null,
      spaceRadius: (
        resolveSpawnedSpaceItemRadius(itemType, options) || null
      ),
      spaceState: normalizeSpaceState({
        systemID: normalizedSystemId,
        position: options.position,
        velocity: options.velocity,
        direction: options.direction,
        targetPoint: options.targetPoint,
        speedFraction: options.speedFraction,
        mode: options.mode || "STOP",
        targetEntityID: options.targetEntityID,
        followRange: options.followRange,
        orbitDistance: options.orbitDistance,
        orbitNormal: options.orbitNormal,
        orbitSign: options.orbitSign,
      }),
    },
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: createResult.data.items[0] || null,
    changes: createResult.data.changes || [],
  };
}

function takeItemTypeFromCharacterLocation(
  charId,
  locationId,
  flagId,
  typeId,
  quantity = 1,
) {
  ensureMigrated();
  const numericCharId = toNumber(charId, 0);
  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId =
    flagId === null || flagId === undefined ? null : toNumber(flagId, 0);
  const numericTypeId = toNumber(typeId, 0);
  const normalizedQuantity = normalizePositiveInteger(quantity, 1);
  if (numericCharId <= 0 || numericTypeId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const matchingItems = Object.values(items)
    .map((entry) => normalizeInventoryItem(entry))
    .filter(
      (entry) =>
        entry &&
        entry.ownerID === numericCharId &&
        entry.locationID === numericLocationId &&
        (numericFlagId === null || entry.flagID === numericFlagId) &&
        entry.typeID === numericTypeId,
    )
    .sort((left, right) => left.itemID - right.itemID);

  const availableQuantity = matchingItems.reduce(
    (sum, entry) => sum + (entry.singleton === 1 ? 1 : toNumber(entry.quantity, 0)),
    0,
  );
  if (availableQuantity < normalizedQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
      data: {
        availableQuantity,
        requestedQuantity: normalizedQuantity,
      },
    };
  }

  let remaining = normalizedQuantity;
  const changes = [];
  for (const item of matchingItems) {
    if (remaining <= 0) {
      break;
    }

    const previousData = cloneValue(item);
    if (item.singleton === 1) {
      delete items[String(item.itemID)];
      repo.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= 1;
      continue;
    }

    const currentQuantity = toNumber(item.quantity, 0);
    if (currentQuantity <= remaining) {
      delete items[String(item.itemID)];
      repo.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= currentQuantity;
      continue;
    }

    const updatedQuantity = currentQuantity - remaining;
    const updatedItem = buildInventoryItem({
      ...item,
      quantity: updatedQuantity,
      stacksize: updatedQuantity,
      singleton: 0,
    });
    items[String(updatedItem.itemID)] = updatedItem;
    changes.push({
      removed: false,
      previousData,
      item: cloneValue(updatedItem),
    });
    remaining = 0;
  }

  if (!writeItems(items, { indexDelta: indexDeltaFromChanges(changes) })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: normalizedQuantity,
      changes,
    },
  };
}

function takeItemTypeFromOwnerLocation(
  ownerId,
  locationId,
  flagId,
  typeId,
  quantity = 1,
) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  const characters = readCharacters();
  if (characters[String(numericOwnerId)]) {
    return takeItemTypeFromCharacterLocation(
      numericOwnerId,
      locationId,
      flagId,
      typeId,
      quantity,
    );
  }

  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId =
    flagId === null || flagId === undefined ? null : toNumber(flagId, 0);
  const numericTypeId = toNumber(typeId, 0);
  const normalizedQuantity = normalizePositiveInteger(quantity, 1);
  if (numericOwnerId <= 0 || numericTypeId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const matchingItems = Object.values(items)
    .map((entry) => normalizeInventoryItem(entry))
    .filter(
      (entry) =>
        entry &&
        entry.ownerID === numericOwnerId &&
        entry.locationID === numericLocationId &&
        (numericFlagId === null || entry.flagID === numericFlagId) &&
        entry.typeID === numericTypeId,
    )
    .sort((left, right) => left.itemID - right.itemID);

  const availableQuantity = matchingItems.reduce(
    (sum, entry) => sum + (entry.singleton === 1 ? 1 : toNumber(entry.quantity, 0)),
    0,
  );
  if (availableQuantity < normalizedQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
      data: {
        availableQuantity,
        requestedQuantity: normalizedQuantity,
      },
    };
  }

  let remaining = normalizedQuantity;
  const changes = [];
  for (const item of matchingItems) {
    if (remaining <= 0) {
      break;
    }

    const previousData = cloneValue(item);
    if (item.singleton === 1) {
      delete items[String(item.itemID)];
      repo.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= 1;
      continue;
    }

    const currentQuantity = toNumber(item.quantity, 0);
    if (currentQuantity <= remaining) {
      delete items[String(item.itemID)];
      repo.setTransientPath(ITEMS_TABLE, `/${String(item.itemID)}`, false);
      changes.push({
        removed: true,
        previousData,
        item: null,
      });
      remaining -= currentQuantity;
      continue;
    }

    const updatedQuantity = currentQuantity - remaining;
    const updatedItem = buildInventoryItem({
      ...item,
      quantity: updatedQuantity,
      stacksize: updatedQuantity,
      singleton: 0,
    });
    items[String(updatedItem.itemID)] = updatedItem;
    changes.push({
      removed: false,
      previousData,
      item: cloneValue(updatedItem),
    });
    remaining = 0;
  }

  if (!writeItems(items, { indexDelta: indexDeltaFromChanges(changes) })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: normalizedQuantity,
      changes,
    },
  };
}

function createShipItemForCharacter(charId, stationId, shipType) {
  const createResult = grantItemToCharacterLocation(
    charId,
    stationId,
    ITEM_FLAGS.HANGAR,
    shipType,
    1,
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: createResult.data.items[0] || null,
    changes: createResult.data.changes,
  };
}

function updateInventoryItem(itemId, updater) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const updatedValue =
    typeof updater === "function" ? updater(cloneValue(currentItem)) : updater;
  const normalizedItem = normalizeInventoryItem(updatedValue, currentItem);
  if (!normalizedItem) {
    return {
      success: false,
      errorMsg: "INVALID_ITEM_STATE",
    };
  }

  items[String(numericItemId)] = normalizedItem;
  if (!writeItems(items, { indexDelta: { upsertedIDs: [numericItemId] } })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  maybeNotifyInsuranceInventoryMutation(
    currentItem,
    normalizedItem,
    "updateInventoryItem",
  );

  return {
    success: true,
    previousData: cloneValue(currentItem),
    data: cloneValue(normalizedItem),
  };
}

function removeInventoryItem(itemId, options = {}) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const rootItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!rootItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const removeContents = options.removeContents !== false;
  const orderedRemovalIDs = [];
  const seen = new Set();

  const collect = (currentID) => {
    const normalizedCurrentID = toNumber(currentID, 0);
    if (normalizedCurrentID <= 0 || seen.has(normalizedCurrentID)) {
      return;
    }

    seen.add(normalizedCurrentID);
    if (removeContents) {
      for (const rawItem of Object.values(items)) {
        const nestedItem = normalizeInventoryItem(rawItem);
        if (
          nestedItem &&
          toNumber(nestedItem.locationID, 0) === normalizedCurrentID &&
          toNumber(nestedItem.itemID, 0) !== normalizedCurrentID
        ) {
          collect(nestedItem.itemID);
        }
      }
    }

    orderedRemovalIDs.push(normalizedCurrentID);
  };

  collect(numericItemId);

  const changes = [];
  const removedItems = [];
  const removedIDs = [];
  for (const removalID of orderedRemovalIDs) {
    const currentItem = normalizeInventoryItem(items[String(removalID)]);
    if (!currentItem) {
      continue;
    }

    delete items[String(removalID)];
    repo.setTransientPath(ITEMS_TABLE, `/${String(removalID)}`, false);
    changes.push({
      removed: true,
      previousData: cloneValue(currentItem),
      item: buildRemovedItemNotificationState(currentItem),
    });
    removedItems.push(cloneValue(currentItem));
    removedIDs.push(removalID);
  }

  if (!writeItems(items, { indexDelta: { removedIDs } })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      removedItems,
      changes,
    },
  };
}

function consumeInventoryItemQuantity(itemId, quantity = 1, options = {}) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const availableQuantity =
    currentItem.singleton === 1
      ? 1
      : normalizePositiveInteger(currentItem.stacksize ?? currentItem.quantity, 1);
  const consumeQuantity =
    quantity === null || quantity === undefined
      ? availableQuantity
      : normalizePositiveSafeInteger(quantity, null);
  if (!consumeQuantity) {
    return {
      success: false,
      errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
    };
  }
  if (consumeQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  if (currentItem.singleton === 1 || consumeQuantity === availableQuantity) {
    return removeInventoryItem(itemId, options);
  }

  const previousData = cloneValue(currentItem);
  const updatedItem = buildInventoryItem({
    ...currentItem,
    quantity: availableQuantity - consumeQuantity,
    stacksize: availableQuantity - consumeQuantity,
    singleton: 0,
  });
  items[String(updatedItem.itemID)] = updatedItem;

  if (!writeItems(items, { indexDelta: { upsertedIDs: [updatedItem.itemID] } })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: consumeQuantity,
      removedItems: [],
      changes: [{
        removed: false,
        previousData,
        item: cloneValue(updatedItem),
      }],
    },
  };
}

function updateShipItem(shipId, updater) {
  const updateResult = updateInventoryItem(shipId, updater);
  if (!updateResult.success) {
    return {
      ...updateResult,
      errorMsg:
        updateResult.errorMsg === "ITEM_NOT_FOUND"
          ? "SHIP_NOT_FOUND"
          : updateResult.errorMsg === "INVALID_ITEM_STATE"
            ? "INVALID_SHIP_STATE"
            : updateResult.errorMsg,
    };
  }

  if (updateResult.data.categoryID !== SHIP_CATEGORY_ID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return updateResult;
}

function buildRemovedItemNotificationState(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  return {
    ...cloneValue(item),
    // The client removes container rows most reliably when the disappearing
    // item looks like it moved to a junk location, rather than an in-place
    // zero-stack update inside the same container.
    locationID: JUNK_LOCATION_ID,
    quantity:
      item.singleton === 2
        ? -2
        : item.singleton === 1
          ? -1
        : toNumber(item.stacksize ?? item.quantity, 0),
    stacksize:
      toNumber(item.singleton, 0) > 0
        ? 1
        : toNumber(item.stacksize ?? item.quantity, 0),
  };
}

function buildCreatedItemNotificationPreviousState(
  item,
  fallbackFlagID = ITEM_FLAGS.HANGAR,
  fallbackOwnerID = undefined,
) {
  return {
    ownerID:
      fallbackOwnerID === undefined
        ? toNumber(item && item.ownerID, 0)
        : toNumber(fallbackOwnerID, 0),
    locationID: 0,
    flagID: toNumber(item && item.flagID, fallbackFlagID),
    quantity: 0,
    stacksize: 0,
    singleton: toNumber(item && item.singleton, 0),
  };
}

function mergeItemStacks(sourceItemId, destinationItemId, quantity = null) {
  ensureMigrated();
  const numericSourceItemID = toNumber(sourceItemId, 0);
  const numericDestinationItemID = toNumber(destinationItemId, 0);
  if (numericSourceItemID <= 0 || numericDestinationItemID <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const sourceItem = normalizeInventoryItem(items[String(numericSourceItemID)]);
  const destinationItem = normalizeInventoryItem(items[String(numericDestinationItemID)]);
  if (!sourceItem || !destinationItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  if (sourceItem.singleton === 1 || destinationItem.singleton === 1) {
    return {
      success: false,
      errorMsg: "STACK_REQUIRED",
    };
  }

  if (
    toNumber(sourceItem.typeID, 0) !== toNumber(destinationItem.typeID, 0) ||
    toNumber(sourceItem.ownerID, 0) !== toNumber(destinationItem.ownerID, 0)
  ) {
    return {
      success: false,
      errorMsg: "STACK_MISMATCH",
    };
  }

  const sourceQuantity = toNumber(sourceItem.stacksize ?? sourceItem.quantity, 0);
  const destinationQuantity = toNumber(destinationItem.stacksize ?? destinationItem.quantity, 0);
  const requestedQuantity =
    quantity === null || quantity === undefined
      ? sourceQuantity
      : normalizePositiveSafeInteger(quantity, null);
  if (!requestedQuantity) {
    return {
      success: false,
      errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
    };
  }
  if (requestedQuantity > sourceQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  const availableDestinationCapacity = Math.max(
    0,
    CLIENT_INVENTORY_STACK_LIMIT - destinationQuantity,
  );
  if (availableDestinationCapacity <= 0) {
    return {
      success: false,
      errorMsg: "STACK_LIMIT_REACHED",
      data: {
        stackLimit: CLIENT_INVENTORY_STACK_LIMIT,
      },
    };
  }

  const transferQuantity = Math.min(requestedQuantity, availableDestinationCapacity);

  const changes = [];
  const destinationPreviousData = captureItemState(destinationItem);
  const updatedDestination = buildInventoryItem({
    ...destinationItem,
    quantity: destinationQuantity + transferQuantity,
    stacksize: destinationQuantity + transferQuantity,
    singleton: 0,
  });
  items[String(updatedDestination.itemID)] = updatedDestination;
  changes.push({
    removed: false,
    previousData: destinationPreviousData,
    item: cloneValue(updatedDestination),
  });

  const sourcePreviousData = cloneValue(sourceItem);
  if (transferQuantity === sourceQuantity) {
    delete items[String(sourceItem.itemID)];
    changes.push({
      removed: true,
      previousData: sourcePreviousData,
      item: buildRemovedItemNotificationState(sourceItem),
    });
  } else {
    const updatedSource = buildInventoryItem({
      ...sourceItem,
      quantity: sourceQuantity - transferQuantity,
      stacksize: sourceQuantity - transferQuantity,
      singleton: 0,
    });
    items[String(updatedSource.itemID)] = updatedSource;
    changes.push({
      removed: false,
      previousData: sourcePreviousData,
      item: cloneValue(updatedSource),
    });
  }

  if (!writeItems(items, { indexDelta: indexDeltaFromChanges(changes) })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      quantity: transferQuantity,
      changes,
    },
  };
}

function buildMovedItemState(currentItem, destinationLocationID, destinationFlagID) {
  const nextState = {
    ...currentItem,
    locationID: destinationLocationID,
    flagID: destinationFlagID,
  };

  const isCharge = toNumber(currentItem.categoryID, 0) === 8;
  if (!isCharge && destinationFlagID >= 11 && destinationFlagID <= 132) {
    // CCP parity: modules auto-online when fitted to a ship slot.  The client
    // expects fitted modules to be online so that CPU/powergrid load is
    // reflected correctly in the fitting window.  Charges (categoryID 8)
    // placed in the same flag as their parent module are NOT modules and
    // should not receive a moduleState at all.
    nextState.moduleState = normalizeModuleState({
      ...(currentItem.moduleState || {}),
      online: true,
    });
  } else if (!isCharge) {
    nextState.moduleState = normalizeModuleState({
      ...(currentItem.moduleState || {}),
      online: false,
    });
  }

  return nextState;
}

function moveItemToLocation(
  itemId,
  destinationLocationId,
  destinationFlagId,
  quantity = null,
) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  const destinationLocationID = toNumber(destinationLocationId, 0);
  const destinationFlagID = toNumber(destinationFlagId, ITEM_FLAGS.HANGAR);
  if (numericItemId <= 0 || destinationLocationID <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const characters = readCharacters();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const availableQuantity =
    currentItem.singleton === 1
      ? 1
      : normalizePositiveInteger(currentItem.stacksize, 1);
  const moveQuantity =
    quantity === null || quantity === undefined
      ? availableQuantity
      : normalizePositiveInteger(quantity, 1);
  if (moveQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  const changes = [];
  const movingWholeItem = currentItem.singleton === 1 || moveQuantity === availableQuantity;
  const movedBase = buildMovedItemState(
    currentItem,
    destinationLocationID,
    destinationFlagID,
  );

  const fittingDestination = isFittingFlag(destinationFlagID);
  // A move into OR out of a fitting flag changes the ship's fitting → invalidate
  // dogma. (Harmless over-bump if the move later bails; correctness-safe.)
  if (fittingDestination || isFittingFlag(toNumber(currentItem.flagID, 0))) {
    bumpDogmaInvalidationVersion();
  }
  // CCP parity: only modules (categoryID 7) become singletons when fitted.
  // Charges (categoryID 8) loaded into a module's flag keep their stack
  // quantity — they are NOT singletons.
  const isChargeCategory = toNumber(currentItem.categoryID, 0) === 8;
  const convertToSingleton =
    (fittingDestination && !isChargeCategory) ||
    (
      destinationFlagID === ITEM_FLAGS.STRUCTURE_DEED &&
      toNumber(currentItem.groupID, 0) === STRUCTURE_DEED_GROUP_ID
    );

  if (movingWholeItem) {
    const previousData = cloneValue(currentItem);
    const destinationSingleton = convertToSingleton ? 1 : currentItem.singleton;
    const singletonConvertedItem =
      convertToSingleton && currentItem.singleton !== 1
        ? buildInventoryItem({
            ...currentItem,
            quantity: null,
            stacksize: 1,
            singleton: 1,
          })
        : null;
    const movedItem = buildInventoryItem({
      ...movedBase,
      quantity:
        destinationSingleton === 1 ? null : moveQuantity,
      stacksize:
        destinationSingleton === 1 ? 1 : moveQuantity,
      singleton: destinationSingleton,
    });
    items[String(movedItem.itemID)] = movedItem;
    if (singletonConvertedItem) {
      changes.push({
        removed: false,
        previousData,
        item: cloneValue(singletonConvertedItem),
      });
      changes.push({
        removed: false,
        previousData: cloneValue(singletonConvertedItem),
        item: cloneValue(movedItem),
      });
    } else {
      changes.push({
        removed: false,
        previousData,
        item: cloneValue(movedItem),
      });
    }
  } else {
    const sourcePreviousData = cloneValue(currentItem);
    const updatedSource = buildInventoryItem({
      ...currentItem,
      quantity: availableQuantity - moveQuantity,
      stacksize: availableQuantity - moveQuantity,
      singleton: 0,
    });
    items[String(updatedSource.itemID)] = updatedSource;
    changes.push({
      removed: false,
      previousData: sourcePreviousData,
      item: cloneValue(updatedSource),
    });

    const splitSingleton = convertToSingleton ? 1 : 0;
    const nextItem = buildInventoryItem({
      ...movedBase,
      itemID: nextItemID(currentItem.ownerID, items, characters[String(currentItem.ownerID)]),
      quantity: splitSingleton === 1 ? null : moveQuantity,
      stacksize: splitSingleton === 1 ? 1 : moveQuantity,
      singleton: splitSingleton,
      stackOriginID:
        toNumber(currentItem.stackOriginID, 0) > 0
          ? toNumber(currentItem.stackOriginID, 0)
          : currentItem.itemID,
    });
    items[String(nextItem.itemID)] = nextItem;
    changes.push({
      removed: false,
      // CCP parity: a partial-stack move creates a brand-new item row in the
      // destination inventory. The client never knew about this new itemID in
      // the source container, so advertise it as arriving from "outside"
      // instead of as a move from the source stack's previous location.
      previousData: buildCreatedItemNotificationPreviousState(
        nextItem,
        sourcePreviousData.flagID,
        sourcePreviousData.ownerID,
      ),
      item: cloneValue(nextItem),
    });
  }

  if (!writeItems(items, { indexDelta: indexDeltaFromChanges(changes) })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  notifyInsuranceInventoryMutationChanges(changes, "moveItemToLocation");

  return {
    success: true,
    data: {
      quantity: moveQuantity,
      changes,
    },
  };
}

function transferItemToOwnerLocation(
  itemId,
  destinationOwnerId,
  destinationLocationId,
  destinationFlagId,
  quantity = null,
) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  const destinationOwnerID = toNumber(destinationOwnerId, 0);
  const destinationLocationID = toNumber(destinationLocationId, 0);
  const destinationFlagID = toNumber(destinationFlagId, ITEM_FLAGS.HANGAR);
  if (
    numericItemId <= 0 ||
    destinationOwnerID <= 0 ||
    destinationLocationID <= 0
  ) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const characters = readCharacters();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const availableQuantity =
    currentItem.singleton === 1
      ? 1
      : normalizePositiveInteger(currentItem.stacksize, 1);
  const moveQuantity =
    quantity === null || quantity === undefined
      ? availableQuantity
      : normalizePositiveInteger(quantity, 1);
  if (moveQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  const changes = [];
  const movingWholeItem =
    currentItem.singleton === 1 || moveQuantity === availableQuantity;
  const movedBase = buildMovedItemState(
    currentItem,
    destinationLocationID,
    destinationFlagID,
  );
  const isChargeCategory = toNumber(currentItem.categoryID, 0) === 8;
  const fittingDestination = isFittingFlag(destinationFlagID);
  const convertToSingleton =
    (fittingDestination && !isChargeCategory) ||
    (
      destinationFlagID === ITEM_FLAGS.STRUCTURE_DEED &&
      toNumber(currentItem.groupID, 0) === STRUCTURE_DEED_GROUP_ID
    );

  if (movingWholeItem) {
    const previousData = cloneValue(currentItem);
    const destinationSingleton = convertToSingleton ? 1 : currentItem.singleton;
    const singletonConvertedItem =
      convertToSingleton && currentItem.singleton !== 1
        ? buildInventoryItem({
            ...currentItem,
            quantity: null,
            stacksize: 1,
            singleton: 1,
          })
        : null;
    const movedItem = buildInventoryItem({
      ...movedBase,
      ownerID: destinationOwnerID,
      quantity: destinationSingleton === 1 ? null : moveQuantity,
      stacksize: destinationSingleton === 1 ? 1 : moveQuantity,
      singleton: destinationSingleton,
    });
    items[String(movedItem.itemID)] = movedItem;
    if (singletonConvertedItem) {
      changes.push({
        removed: false,
        previousData,
        item: cloneValue(singletonConvertedItem),
      });
      changes.push({
        removed: false,
        previousData: cloneValue(singletonConvertedItem),
        item: cloneValue(movedItem),
      });
    } else {
      changes.push({
        removed: false,
        previousData,
        item: cloneValue(movedItem),
      });
    }
  } else {
    const sourcePreviousData = cloneValue(currentItem);
    const updatedSource = buildInventoryItem({
      ...currentItem,
      quantity: availableQuantity - moveQuantity,
      stacksize: availableQuantity - moveQuantity,
      singleton: 0,
    });
    items[String(updatedSource.itemID)] = updatedSource;
    changes.push({
      removed: false,
      previousData: sourcePreviousData,
      item: cloneValue(updatedSource),
    });

    const splitSingleton = convertToSingleton ? 1 : 0;
    const nextItem = buildInventoryItem({
      ...movedBase,
      itemID: nextItemID(
        destinationOwnerID,
        items,
        characters[String(destinationOwnerID)] || null,
      ),
      ownerID: destinationOwnerID,
      quantity: splitSingleton === 1 ? null : moveQuantity,
      stacksize: splitSingleton === 1 ? 1 : moveQuantity,
      singleton: splitSingleton,
      stackOriginID:
        toNumber(currentItem.stackOriginID, 0) > 0
          ? toNumber(currentItem.stackOriginID, 0)
          : currentItem.itemID,
    });
    items[String(nextItem.itemID)] = nextItem;
    changes.push({
      removed: false,
      previousData: buildCreatedItemNotificationPreviousState(
        nextItem,
        sourcePreviousData.flagID,
        sourcePreviousData.ownerID,
      ),
      item: cloneValue(nextItem),
    });
  }

  if (!writeItems(items, { indexDelta: indexDeltaFromChanges(changes) })) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  notifyInsuranceInventoryMutationChanges(
    changes,
    "transferItemToOwnerLocation",
  );

  return {
    success: true,
    data: {
      quantity: moveQuantity,
      changes,
    },
  };
}

function moveItemTypeFromCharacterLocation(
  charId,
  sourceLocationId,
  sourceFlagId,
  destinationLocationId,
  destinationFlagId,
  typeId,
  quantity = 1,
) {
  ensureMigrated();
  const numericCharId = toNumber(charId, 0);
  const numericSourceLocationId = toNumber(sourceLocationId, 0);
  const numericDestinationLocationId = toNumber(destinationLocationId, 0);
  const numericDestinationFlagId = toNumber(destinationFlagId, ITEM_FLAGS.HANGAR);
  const numericTypeId = toNumber(typeId, 0);
  const numericQuantity = normalizePositiveInteger(quantity, 1);
  const numericSourceFlagId =
    sourceFlagId === null || sourceFlagId === undefined
      ? null
      : toNumber(sourceFlagId, 0);

  if (
    numericCharId <= 0 ||
    numericSourceLocationId <= 0 ||
    numericDestinationLocationId <= 0 ||
    numericTypeId <= 0
  ) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const sourceItems = listContainerItems(
    numericCharId,
    numericSourceLocationId,
    numericSourceFlagId,
  )
    .filter((item) => item && toNumber(item.typeID, 0) === numericTypeId)
    .sort((left, right) => left.itemID - right.itemID);

  const availableQuantity = sourceItems.reduce((sum, item) => (
    sum + (toNumber(item.singleton, 0) === 1 ? 1 : normalizePositiveInteger(item.stacksize, 1))
  ), 0);
  if (availableQuantity < numericQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
      data: {
        availableQuantity,
        requestedQuantity: numericQuantity,
      },
    };
  }

  const allChanges = [];
  const movedItems = [];
  let remaining = numericQuantity;

  for (const sourceItem of sourceItems) {
    if (remaining <= 0) {
      break;
    }

    const movableQuantity =
      toNumber(sourceItem.singleton, 0) === 1
        ? 1
        : Math.min(
            remaining,
            normalizePositiveInteger(sourceItem.stacksize, 1),
          );
    const moveResult = moveItemToLocation(
      sourceItem.itemID,
      numericDestinationLocationId,
      numericDestinationFlagId,
      movableQuantity,
    );
    if (!moveResult.success) {
      return moveResult;
    }

    allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
    const movedChange = ((moveResult.data && moveResult.data.changes) || []).find((change) => (
      change &&
      change.item &&
      toNumber(change.item.locationID, 0) === numericDestinationLocationId &&
      toNumber(change.item.flagID, 0) === numericDestinationFlagId &&
      toNumber(change.item.typeID, 0) === numericTypeId
    ));
    if (movedChange && movedChange.item) {
      movedItems.push(cloneValue(movedChange.item));
    }
    remaining -= movableQuantity;
  }

  return {
    success: true,
    data: {
      quantity: numericQuantity,
      changes: allChanges,
      items: movedItems,
    },
  };
}

function setShipPackagingState(shipId, packaged) {
  const result = updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    singleton: packaged ? 0 : 1,
    quantity: packaged ? 1 : -1,
    stacksize: 1,
  }));
  if (packaged && result && result.success) {
    try {
      const {
        clearShipDirtTimestamp,
      } = require(path.join(__dirname, "../ship/shipDirtState"));
      if (typeof clearShipDirtTimestamp === "function") {
        clearShipDirtTimestamp(shipId, "packaged");
      }
    } catch (error) {
      log.warn(`[ItemStore] Failed to clear ship dirt for packaged ship=${shipId}: ${error.message}`);
    }
    try {
      const {
        clearShipKillCounter,
      } = require(path.join(__dirname, "../ship/shipKillCounterState"));
      if (typeof clearShipKillCounter === "function") {
        clearShipKillCounter(shipId, "packaged");
      }
    } catch (error) {
      log.warn(`[ItemStore] Failed to clear ship killmarks for packaged ship=${shipId}: ${error.message}`);
    }
  }
  return result;
}

function setItemPackagingState(itemId, packaged) {
  return updateInventoryItem(itemId, (currentItem) => ({
    ...currentItem,
    singleton: packaged ? 0 : 1,
    quantity: packaged ? 1 : -1,
    stacksize: packaged ? 1 : 1,
  }));
}

function moveShipToSpace(shipId, solarSystemId, spaceState) {
  return updateShipItem(shipId, (currentItem) => {
    const nextSpaceState = { ...(spaceState || {}) };
    const hasCustomInfoOverride = Object.prototype.hasOwnProperty.call(
      nextSpaceState,
      "customInfo",
    );
    const customInfo = hasCustomInfoOverride
      ? String(nextSpaceState.customInfo || "")
      : currentItem.customInfo;
    if (hasCustomInfoOverride) {
      delete nextSpaceState.customInfo;
    }
    return {
      ...currentItem,
      locationID: toNumber(solarSystemId, currentItem.locationID),
      flagID: 0,
      customInfo,
      spaceState: normalizeSpaceState({
        ...nextSpaceState,
        systemID: toNumber(solarSystemId, currentItem.locationID),
      }),
      conditionState: normalizeShipConditionState(currentItem.conditionState),
    };
  });
}

function dockShipToStation(shipId, stationId) {
  return dockShipToLocation(shipId, stationId);
}

function dockShipToLocation(shipId, locationId) {
  const numericLocationId = toNumber(locationId, 0);
  const station = worldData.getStationByID(numericLocationId);
  const structure =
    station || numericLocationId <= 0
      ? null
      : getStructureState().getStructureByID(numericLocationId, {
          refresh: false,
        });
  if (!station && !structure) {
    return {
      success: false,
      errorMsg: "DOCK_LOCATION_NOT_FOUND",
    };
  }

  return updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    locationID: numericLocationId,
    flagID: ITEM_FLAGS.HANGAR,
    customInfo: String(currentItem.customInfo || "").startsWith("Undocking:")
      ? ""
      : currentItem.customInfo,
    spaceState: null,
  }));
}

function spawnShipInStationHangar(charId, stationId, shipType) {
  ensureMigrated();
  const createResult = createShipItemForCharacter(charId, stationId, shipType);
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    created: true,
    data: createResult.data,
  };
}

function setActiveShipForCharacter(charId, shipId) {
  const shipItem = findCharacterShipItem(charId, shipId);
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const syncResult = syncCharacterActiveShip(charId, shipItem);
  if (!syncResult.success) {
    return syncResult;
  }

  return {
    success: true,
    data: shipItem,
  };
}

function characterHasGoldenCapsuleImplant(characterRecord) {
  const implants = Array.isArray(characterRecord && characterRecord.implants)
    ? characterRecord.implants
    : [];
  return implants.some((implant) => {
    if (implant && typeof implant === "object") {
      return toNumber(implant.typeID, 0) === GOLDEN_CAPSULE_IMPLANT_TYPE_ID;
    }
    return toNumber(implant, 0) === GOLDEN_CAPSULE_IMPLANT_TYPE_ID;
  });
}

function resolveCapsuleTypeIDForCharacter(charId) {
  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return CAPSULE_TYPE_ID;
  }
  const characters = readCharacters();
  return characterHasGoldenCapsuleImplant(characters[String(numericCharId)])
    ? CAPSULE_TYPE_ID_GOLDEN
    : CAPSULE_TYPE_ID;
}

function buildCapsuleTypeDescriptor(typeID) {
  const resolvedTypeID = isCapsuleTypeID(typeID) ? toNumber(typeID, CAPSULE_TYPE_ID) : CAPSULE_TYPE_ID;
  const metadata = getItemMetadata(resolvedTypeID);
  return {
    typeID: resolvedTypeID,
    name:
      metadata.name ||
      (resolvedTypeID === CAPSULE_TYPE_ID_GOLDEN
        ? "Capsule - Genolution 'Auroral' 197-variant"
        : "Capsule"),
  };
}

function syncCapsuleItemToType(charId, capsuleItem, targetTypeID) {
  if (!capsuleItem || !isCapsuleTypeID(capsuleItem.typeID)) {
    return {
      success: false,
      errorMsg: "CAPSULE_NOT_FOUND",
    };
  }

  const target = buildCapsuleTypeDescriptor(targetTypeID);
  const alreadySynced =
    toNumber(capsuleItem.typeID, 0) === target.typeID &&
    capsuleItem.itemName === target.name &&
    capsuleItem.shipName === target.name;
  if (alreadySynced) {
    return {
      success: true,
      changed: false,
      previousData: cloneValue(capsuleItem),
      data: cloneValue(capsuleItem),
    };
  }

  const updateResult = updateInventoryItem(capsuleItem.itemID, (item) => ({
    ...item,
    typeID: target.typeID,
    itemName: target.name,
    shipName: target.name,
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  const characters = readCharacters();
  const record = characters[String(toNumber(charId, 0))];
  if (record && toNumber(record.shipID, 0) === toNumber(updateResult.data.itemID, 0)) {
    syncCharacterActiveShip(charId, updateResult.data);
  }

  return {
    ...updateResult,
    changed: true,
  };
}

function syncCapsuleTypeForCharacter(charId, options = {}) {
  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const capsuleItem = findCharacterCapsule(numericCharId, options.stationId ?? null);
  if (!capsuleItem) {
    return {
      success: false,
      errorMsg: "CAPSULE_NOT_FOUND",
    };
  }

  return syncCapsuleItemToType(
    numericCharId,
    capsuleItem,
    resolveCapsuleTypeIDForCharacter(numericCharId),
  );
}

function ensureCapsuleForCharacter(charId, stationId) {
  const targetCapsuleType = buildCapsuleTypeDescriptor(
    resolveCapsuleTypeIDForCharacter(charId),
  );
  const existingCapsule = findCharacterCapsule(charId, stationId);
  if (existingCapsule) {
    const syncResult = syncCapsuleItemToType(
      charId,
      existingCapsule,
      targetCapsuleType.typeID,
    );
    if (!syncResult.success) {
      return syncResult;
    }
    return {
      success: true,
      created: false,
      data: syncResult.data,
      previousData: syncResult.previousData,
      changed: syncResult.changed === true,
    };
  }

  return createShipItemForCharacter(charId, stationId, {
    typeID: targetCapsuleType.typeID,
    name: targetCapsuleType.name,
  });
}

function listContainerItems(ownerId, locationId, flagId = null) {
  const numericLocationId = toNumber(locationId, 0);
  const numericOwnerId =
    ownerId === null || ownerId === undefined ? null : toNumber(ownerId, 0);
  const numericFlagId =
    flagId === null || flagId === undefined ? null : toNumber(flagId, 0);

  return (ensureItemIndexes().byLocation.get(numericLocationId) || [])
    .filter(
      (entry) =>
        entry &&
        entry.locationID === numericLocationId &&
        (numericOwnerId === null || entry.ownerID === numericOwnerId) &&
        (numericFlagId === null || entry.flagID === numericFlagId),
    )
    .map((entry) => cloneValue(entry));
}

function listSystemSpaceItems(systemId) {
  const numericSystemId = toNumber(systemId, 0);
  if (numericSystemId <= 0) {
    return [];
  }

  const now = Date.now();

  return (ensureItemIndexes().byLocation.get(numericSystemId) || [])
    .filter(
      (entry) =>
        entry &&
        entry.locationID === numericSystemId &&
        entry.flagID === 0 &&
        entry.spaceState &&
        toNumber(entry.spaceState.systemID, 0) === numericSystemId &&
        (
          !Number.isFinite(Number(entry.expiresAtMs)) ||
          Number(entry.expiresAtMs) > now
        ),
    )
    .map((entry) => cloneValue(entry));
}

function pruneExpiredSpaceItems(now = Date.now()) {
  ensureMigrated();
  const numericNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const items = Object.values(readItems())
    .map((entry) => normalizeInventoryItem(entry))
    .filter(Boolean)
    .sort((left, right) => left.itemID - right.itemID);

  const removedTopLevelItemIDs = [];
  const removedChanges = [];
  const seen = new Set();

  for (const item of items) {
    const itemID = toNumber(item && item.itemID, 0);
    if (
      itemID <= 0 ||
      seen.has(itemID) ||
      toNumber(item.locationID, 0) <= 0 ||
      toNumber(item.flagID, 0) !== 0 ||
      !item.spaceState ||
      !Number.isFinite(Number(item.expiresAtMs)) ||
      Number(item.expiresAtMs) > numericNow
    ) {
      continue;
    }

    const removeResult = removeInventoryItem(itemID, { removeContents: true });
    if (!removeResult.success) {
      continue;
    }

    removedTopLevelItemIDs.push(itemID);
    removedChanges.push(...((removeResult.data && removeResult.data.changes) || []));
    for (const removedItem of (removeResult.data && removeResult.data.removedItems) || []) {
      seen.add(toNumber(removedItem && removedItem.itemID, 0));
    }
  }

  return {
    success: true,
    data: {
      removedTopLevelItemIDs,
      changes: removedChanges,
    },
  };
}

function getShipConditionState(shipItem) {
  return normalizeShipConditionState(shipItem && shipItem.conditionState);
}

function resetInventoryStoreForTests() {
  migrationComplete = false;
  itemsTableCache = null;
  itemIndexesDirty = true;
  itemIndexesCache = null;
  itemIndexKeys = new Map();
  itemIndexIncrementalUpdates = 0;
  itemIndexFullRebuildCount = 0;
  itemIndexIntegrityValidationCount = 0;
  reservedItemIDBatch = [];
  itemMutationVersion += 1;
}

// Test-only: snapshot the current index in a deep-comparable shape, and force a
// rebuild — so a property test can assert incremental updates == a from-scratch
// rebuild.
function _itemIndexSnapshotForTest() {
  return snapshotItemIndexes(ensureItemIndexes());
}

function _invalidateItemIndexesForTest() {
  itemIndexesDirty = true;
  itemIndexesCache = null;
  itemIndexKeys = new Map();
}

function _writeItemsForTest(data, options) {
  return writeItems(data, options);
}

function _itemIndexStatsForTest() {
  return {
    fullRebuildCount: itemIndexFullRebuildCount,
    integrityValidationCount: itemIndexIntegrityValidationCount,
    incrementalUpdates: itemIndexIncrementalUpdates,
    selfCheckInterval: ITEM_INDEX_SELFCHECK_INTERVAL,
    rebuildWarnMs: ITEM_INDEX_REBUILD_WARN_MS,
    dirty: itemIndexesDirty,
    cached: Boolean(itemIndexesCache),
  };
}

function _resetItemIndexStatsForTest() {
  itemIndexFullRebuildCount = 0;
  itemIndexIntegrityValidationCount = 0;
}

// Owner API: write an item's customInfo metadata sub-path. Metadata only — it
// does not change item identity/location/owner, so the derived index is
// unaffected. Lets the dogma domain persist dynamic-item metadata without
// writing the items table directly.
function writeItemCustomInfo(itemID, customInfo, options = {}) {
  return repo.write(ITEMS_TABLE, `/${String(itemID)}/customInfo`, customInfo, options);
}

module.exports = {
  writeItemCustomInfo,
  validateItemIndexIntegrity,
  _itemIndexSnapshotForTest,
  _invalidateItemIndexesForTest,
  _writeItemsForTest,
  _itemIndexStatsForTest,
  _resetItemIndexStatsForTest,
  ITEMS_TABLE,
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
  SHIP_CATEGORY_ID,
  CAPSULE_TYPE_ID,
  CAPSULE_TYPE_ID_GOLDEN,
  GOLDEN_CAPSULE_IMPLANT_TYPE_ID,
  CLIENT_INVENTORY_STACK_LIMIT,
  ensureMigrated,
  getAllItems,
  listOwnedItems,
  listCharacterItems,
  getCharacterShipItems,
  getCharacterHangarShipItems,
  findCharacterShipItem,
  findCharacterCapsule,
  findItemById,
  findShipItemById,
  findCharacterShipByType,
  isCapsuleTypeID,
  ensureCharacterActiveShipItem,
  getActiveShipItem,
  grantItemsToCharacterLocation,
  grantItemToCharacterLocation,
  grantItemsToOwnerLocation,
  grantItemToOwnerLocation,
  grantItemToCharacterStationHangar,
  grantItemsToCharacterStationHangar,
  createSpaceItemForCharacter,
  createSpaceItemForOwner,
  takeItemTypeFromCharacterLocation,
  takeItemTypeFromOwnerLocation,
  spawnShipInStationHangar,
  updateInventoryItem,
  removeInventoryItem,
  consumeInventoryItemQuantity,
  pruneExpiredSpaceItems,
  moveItemToLocation,
  transferItemToOwnerLocation,
  moveItemTypeFromCharacterLocation,
  mergeItemStacks,
  updateShipItem,
  setShipPackagingState,
  setItemPackagingState,
  moveShipToSpace,
  dockShipToLocation,
  dockShipToStation,
  setActiveShipForCharacter,
  ensureCapsuleForCharacter,
  resolveCapsuleTypeIDForCharacter,
  syncCapsuleTypeForCharacter,
  buildRemovedItemNotificationState,
  listContainerItems,
  listSystemSpaceItems,
  buildInventoryItem,
  buildShipItem,
  normalizeInventoryItem,
  normalizeShipItem,
  captureItemState,
  getShipConditionState,
  resetInventoryStoreForTests,
  normalizeShipConditionState,
  normalizeModuleState,
  getItemMetadata,
  getPackagedVolumeForType,
  getInventoryItemUnitVolume,
  getItemMutationVersion,
};
