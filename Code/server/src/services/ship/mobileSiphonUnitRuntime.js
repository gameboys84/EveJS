const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  getItemMetadata,
  listContainerItems,
  removeInventoryItem,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildKeyVal,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));

const CATEGORY_DEPLOYABLE = 22;
const GROUP_MOBILE_SIPHON_UNIT = 1247;
const TYPE_SMALL_MOBILE_SIPHON_UNIT = 33477;
const TYPE_SMALL_MOBILE_HYBRID_SIPHON_UNIT = 33581;
const TYPE_SMALL_MOBILE_ROTE_SIPHON_UNIT = 33583;
const TYPE_ANCHORING = 11584;

const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_SIPHON_UNIT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MOBILE_SIPHON_UNIT_CYCLE_MS = 60 * 60 * 1000;
const MOBILE_SIPHON_UNIT_CONTROL_TOWER_MAX_RANGE_METERS = 50_000;
const MOBILE_SIPHON_UNIT_REQUIRED_ANCHORING_LEVEL = 2;
const CUSTOM_INFO_KEY = "evejsMobileSiphonUnit";
const MAX_TIMER_DELAY_MS = 2_147_000_000;

const SIPHON_TYPE_CONFIG_BY_TYPE_ID = Object.freeze({
  [TYPE_SMALL_MOBILE_SIPHON_UNIT]: Object.freeze({
    capacity: 900,
    rawAmount: 60,
    processedAmount: 30,
    wastePercent: 10,
    priority: "raw",
  }),
  [TYPE_SMALL_MOBILE_HYBRID_SIPHON_UNIT]: Object.freeze({
    capacity: 1200,
    polymerBatchFraction: 0.5,
    wastePercent: 10,
    priority: "polymer",
  }),
  [TYPE_SMALL_MOBILE_ROTE_SIPHON_UNIT]: Object.freeze({
    capacity: 1000,
    rawAmount: 20,
    processedAmount: 110,
    wastePercent: 10,
    priority: "processed",
  }),
});

const timersBySiphonID = new Map();

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toReal(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function firstFiniteReal(values, fallback = 0) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }
  return fallback;
}

function normalizeVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: toReal(source.x, fallback.x),
    y: toReal(source.y, fallback.y),
    z: toReal(source.z, fallback.z),
  };
}

function normalizeDirection(value, fallback = { x: 1, y: 0, z: 0 }) {
  const vector = normalizeVector(value, fallback);
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (length <= 0) {
    return { ...fallback };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function addVectors(left, right) {
  return {
    x: toReal(left && left.x, 0) + toReal(right && right.x, 0),
    y: toReal(left && left.y, 0) + toReal(right && right.y, 0),
    z: toReal(left && left.z, 0) + toReal(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  const factor = toReal(scalar, 0);
  return {
    x: toReal(vector && vector.x, 0) * factor,
    y: toReal(vector && vector.y, 0) * factor,
    z: toReal(vector && vector.z, 0) * factor,
  };
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function getSyncInventoryItemForSession() {
  const characterState = require(path.join(__dirname, "../character/characterState"));
  return characterState.syncInventoryItemForSession;
}

function getSiphonTypeConfig(typeIDOrItem) {
  const typeID = toInt(
    typeIDOrItem && typeof typeIDOrItem === "object" ? typeIDOrItem.typeID : typeIDOrItem,
    0,
  );
  return SIPHON_TYPE_CONFIG_BY_TYPE_ID[typeID] || null;
}

function isMobileSiphonUnitType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_DEPLOYABLE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_MOBILE_SIPHON_UNIT
    ) || isMobileSiphonUnitType(toInt(typeIDOrItem.typeID, 0));
  }

  const typeID = toInt(typeIDOrItem, 0);
  if (typeID <= 0) {
    return false;
  }
  if (SIPHON_TYPE_CONFIG_BY_TYPE_ID[typeID]) {
    return true;
  }
  const metadata = getItemMetadata(typeID) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_DEPLOYABLE &&
    toInt(metadata.groupID, 0) === GROUP_MOBILE_SIPHON_UNIT
  );
}

function parseCustomInfo(customInfo) {
  const text = String(customInfo || "").trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_) {
    // Preserve opaque legacy customInfo values instead of discarding them.
  }
  return {
    legacyCustomInfo: text,
  };
}

function getStateFromCustomInfo(customInfo) {
  const parsed = parseCustomInfo(customInfo);
  const state = parsed && parsed[CUSTOM_INFO_KEY];
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }
  return {
    ownerID: toInt(state.ownerID, 0),
    deployerCharacterID: toInt(state.deployerCharacterID, 0),
    solarSystemID: toInt(state.solarSystemID, 0),
    siphonID: toInt(state.siphonID, 0),
    controlTowerID: toInt(state.controlTowerID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    lastCycleAtMs: toInt(state.lastCycleAtMs, 0),
    siphonCycleCount: toInt(state.siphonCycleCount, 0),
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
  };
}

function getMobileSiphonUnitStateFromItem(item) {
  if (!item || !isMobileSiphonUnitType(item)) {
    return null;
  }
  const state = getStateFromCustomInfo(item.customInfo);
  if (!state || state.siphonID <= 0) {
    return null;
  }
  return state;
}

function buildCustomInfoWithState(customInfo, state) {
  const parsed = parseCustomInfo(customInfo);
  parsed[CUSTOM_INFO_KEY] = {
    ownerID: toInt(state.ownerID, 0),
    deployerCharacterID: toInt(state.deployerCharacterID, 0),
    solarSystemID: toInt(state.solarSystemID, 0),
    siphonID: toInt(state.siphonID, 0),
    controlTowerID: toInt(state.controlTowerID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    lastCycleAtMs: toInt(state.lastCycleAtMs, 0),
    siphonCycleCount: Math.max(0, toInt(state.siphonCycleCount, 0)),
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
  };
  return JSON.stringify(parsed);
}

function syncInventoryChange(session, item, previousData) {
  const syncInventoryItemForSession = getSyncInventoryItemForSession();
  if (typeof syncInventoryItemForSession !== "function") {
    return;
  }
  syncInventoryItemForSession(
    session,
    item,
    previousData || {},
    { emitCfgLocation: true },
  );
}

function syncChangesExceptItem(session, changes = [], excludedItemID = 0) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item || toInt(change.item.itemID, 0) === excludedItemID) {
      continue;
    }
    syncInventoryChange(session, change.item, change.previousData || change.previousState || {});
  }
}

function getSessionContext(session, options = {}) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  const corporationID = toInt(
    session && (session.corporationID || session.corpid),
    characterID,
  );
  const behalfOwnerID = toInt(options.ownerID, 0);
  const shipID = toInt(
    session && session._space && session._space.shipID,
    toInt(session && (session.shipID || session.shipid || session.activeShipID), 0),
  );
  const systemID = toInt(
    session && session._space && session._space.systemID,
    toInt(session && (session.solarsystemid2 || session.solarsystemid), 0),
  );

  return {
    characterID,
    corporationID,
    ownerID: behalfOwnerID || characterID,
    shipID,
    systemID,
  };
}

function getSkillLevel(characterID, skillTypeID) {
  const skillMap = characterID > 0 ? getCachedCharacterSkillMap(characterID) : new Map();
  const record = skillMap.get(toInt(skillTypeID, 0)) || null;
  return Math.max(0, Math.min(5, toInt(
    record &&
      (
        record.effectiveSkillLevel ??
        record.trainedSkillLevel ??
        record.skillLevel
      ),
    0,
  )));
}

function hasFiniteVectorCoordinates(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Number.isFinite(Number(value.x)) &&
      Number.isFinite(Number(value.y)) &&
      Number.isFinite(Number(value.z)),
  );
}

function getObjectPosition(source) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const candidates = [
    source.spaceState && source.spaceState.position,
    source.position,
  ];
  for (const candidate of candidates) {
    if (hasFiniteVectorCoordinates(candidate)) {
      return normalizeVector(candidate);
    }
  }
  return null;
}

function buildDeployableSpawnState(session, context) {
  const shipEntity =
    session && context.shipID
      ? getSpaceRuntime().getEntity(session, context.shipID)
      : null;
  const position = getObjectPosition(shipEntity);
  if (!position) {
    return null;
  }
  const direction = normalizeDirection(
    shipEntity && shipEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const deployedPosition = addVectors(
    position,
    scaleVector(direction, DEPLOY_DISTANCE_METERS),
  );

  return {
    systemID: context.systemID,
    position: deployedPosition,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: deployedPosition,
    mode: "STOP",
    speedFraction: 0,
  };
}

function getSiphonCapacity(item) {
  const config = getSiphonTypeConfig(item);
  const metadata = getItemMetadata(item && item.typeID) || {};
  return Math.max(0, firstFiniteReal([
    item && item.capacity,
    metadata.capacity,
    config && config.capacity,
  ]));
}

function getItemQuantity(item) {
  if (!item) {
    return 0;
  }
  if (toInt(item.singleton, 0) > 0) {
    return 1;
  }
  return Math.max(0, toReal(item.quantity, 0), toReal(item.stacksize, 0));
}

function calculateSiphonUsedVolume(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (itemID <= 0) {
    return 0;
  }

  return listContainerItems(null, itemID, null).reduce((sum, childItem) => {
    const metadata = getItemMetadata(childItem.typeID) || {};
    const volume = firstFiniteReal([childItem.volume, metadata.volume], 0);
    return sum + Math.max(0, volume) * getItemQuantity(childItem);
  }, 0);
}

function getMobileSiphonUnitCapacityInfo(itemOrID) {
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemOrID);
  if (!item || !isMobileSiphonUnitType(item)) {
    return {
      capacity: 0,
      used: 0,
    };
  }

  return {
    capacity: getSiphonCapacity(item),
    used: calculateSiphonUsedVolume(item),
  };
}

function buildSiphonCapacityKeyVal(itemOrID) {
  const capacityInfo = getMobileSiphonUnitCapacityInfo(itemOrID);
  return buildKeyVal([
    ["capacity", capacityInfo.capacity],
    ["used", capacityInfo.used],
  ]);
}

function hydrateMobileSiphonUnitEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isMobileSiphonUnitType(itemRecord)) {
    return entity;
  }

  const state = getMobileSiphonUnitStateFromItem(itemRecord);
  if (!state || state.deactivatedAtMs > 0) {
    return entity;
  }

  const config = getSiphonTypeConfig(itemRecord) || {};
  entity.siphonCapacity = getSiphonCapacity(itemRecord);
  entity.siphonUsed = calculateSiphonUsedVolume(itemRecord);
  entity.siphonCycleSeconds = Math.trunc(MOBILE_SIPHON_UNIT_CYCLE_MS / 1000);
  entity.siphonWastePercent = toInt(config.wastePercent, 10);
  entity.siphonRawAmount = toInt(config.rawAmount, 0);
  entity.siphonProcessedAmount = toInt(config.processedAmount, 0);
  entity.siphonPolymerBatchFraction = toReal(config.polymerBatchFraction, 0);
  entity.siphonPriority = config.priority || "raw";
  entity.siphonControlTowerID = state.controlTowerID || null;
  entity.siphonDeployerCharacterID = state.deployerCharacterID || null;
  return entity;
}

function findLaunchedChange(changes = [], systemID, ownerID, sourceTypeID) {
  return (Array.isArray(changes) ? changes : []).find((change) => {
    const item = change && change.item;
    return Boolean(
      item &&
        toInt(item.locationID, 0) === systemID &&
        toInt(item.flagID, -1) === 0 &&
        toInt(item.ownerID, 0) === ownerID &&
        toInt(item.typeID, 0) === sourceTypeID,
    );
  }) || null;
}

function validateMobileSiphonUnitLaunch(item, context) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileSiphonUnitType(item)) {
    return "ITEM_NOT_MOBILE_SIPHON_UNIT";
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    toInt(item.flagID, 0) !== ITEM_FLAGS.CARGO_HOLD
  ) {
    return "ITEM_NOT_IN_SHIP_CARGO";
  }
  if (getSkillLevel(context.characterID, TYPE_ANCHORING) < MOBILE_SIPHON_UNIT_REQUIRED_ANCHORING_LEVEL) {
    return "Mobile Siphon Unit deployment requires Anchoring II.";
  }
  return null;
}

function clearTimers(siphonID) {
  const normalizedSiphonID = toInt(siphonID, 0);
  const timerState = timersBySiphonID.get(normalizedSiphonID);
  if (!timerState) {
    return;
  }
  if (timerState.expiryTimer) {
    clearTimeout(timerState.expiryTimer);
  }
  timersBySiphonID.delete(normalizedSiphonID);
}

function setUnrefTimeout(callback, delayMs) {
  const safeDelayMs = Math.max(0, Math.min(toInt(delayMs, 0), MAX_TIMER_DELAY_MS));
  const timer = setTimeout(callback, safeDelayMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

function expireMobileSiphonUnit(itemID, reason = "expired") {
  const item = findItemById(itemID);
  const state = getMobileSiphonUnitStateFromItem(item);
  const systemID = toInt(
    state && state.solarSystemID,
    toInt(item && item.locationID, 0),
  );
  clearTimers(itemID);

  if (systemID > 0) {
    const destroyResult = getSpaceRuntime().destroyDynamicInventoryEntity(systemID, itemID);
    if (destroyResult && destroyResult.success) {
      log.info(`[SiphonUnit] Removed siphon=${itemID} reason=${reason}`);
      return true;
    }
  }

  const removeResult = removeInventoryItem(itemID, { removeContents: true });
  if (removeResult.success) {
    log.info(`[SiphonUnit] Removed siphon=${itemID} reason=${reason}`);
    return true;
  }
  return false;
}

function scheduleMobileSiphonUnitTimers(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileSiphonUnitStateFromItem(item);
  if (!state || state.deactivatedAtMs > 0) {
    clearTimers(itemID);
    return false;
  }

  clearTimers(itemID);

  const now = Date.now();
  if (state.expiresAtMs > 0) {
    if (state.expiresAtMs <= now) {
      return expireMobileSiphonUnit(itemID, "expired");
    }
    timersBySiphonID.set(itemID, {
      expiryTimer: setUnrefTimeout(
        () => scheduleMobileSiphonUnitTimers(itemID),
        state.expiresAtMs - now,
      ),
    });
    return true;
  }

  return false;
}

function registerMobileSiphonUnitItem(itemOrID) {
  return scheduleMobileSiphonUnitTimers(itemOrID);
}

function clearMobileSiphonUnit(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }
  clearTimers(itemID);

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileSiphonUnitStateFromItem(item);
  if (!state) {
    return false;
  }

  if (findItemById(itemID)) {
    updateInventoryItem(itemID, (currentItem) => ({
      ...currentItem,
      customInfo: buildCustomInfoWithState(currentItem.customInfo, {
        ...state,
        deactivatedAtMs: Date.now(),
      }),
    }));
  }
  log.info(`[SiphonUnit] Cleared siphon=${itemID} reason=${reason}`);
  return true;
}

function launchMobileSiphonUnitFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateMobileSiphonUnitLaunch(item, context);
  if (validationError) {
    return {
      success: false,
      errorMsg: validationError,
    };
  }

  const spawnState = buildDeployableSpawnState(session, context);
  if (!spawnState) {
    return {
      success: false,
      errorMsg: "MOBILE_SIPHON_UNIT_DEPLOY_POSITION_UNAVAILABLE",
    };
  }

  const sourceTypeID = toInt(item.typeID, 0);
  const transferResult = transferItemToOwnerLocation(
    item.itemID,
    context.ownerID,
    context.systemID,
    0,
    1,
  );
  if (!transferResult.success) {
    return transferResult;
  }

  const transferChanges = transferResult.data && transferResult.data.changes
    ? transferResult.data.changes
    : [];
  const launchedChange = findLaunchedChange(
    transferChanges,
    context.systemID,
    context.ownerID,
    sourceTypeID,
  );
  const launchedItemID = toInt(launchedChange && launchedChange.item && launchedChange.item.itemID, 0);
  if (!launchedItemID) {
    return {
      success: false,
      errorMsg: "LAUNCHED_ITEM_NOT_FOUND",
    };
  }

  const now = Date.now();
  const state = {
    ownerID: context.ownerID,
    deployerCharacterID: context.characterID,
    solarSystemID: context.systemID,
    siphonID: launchedItemID,
    controlTowerID: 0,
    deployedAtMs: now,
    expiresAtMs: now + MOBILE_SIPHON_UNIT_LIFETIME_MS,
    lastCycleAtMs: 0,
    siphonCycleCount: 0,
    deactivatedAtMs: 0,
  };
  const updatedResult = updateInventoryItem(launchedItemID, (currentItem) => ({
    ...currentItem,
    ownerID: context.ownerID,
    locationID: context.systemID,
    flagID: 0,
    singleton: 1,
    quantity: null,
    stacksize: 1,
    createdAtMs: currentItem.createdAtMs || now,
    expiresAtMs: state.expiresAtMs,
    capacity: getSiphonCapacity(currentItem),
    spaceRadius: currentItem.spaceRadius || currentItem.radius || null,
    dunRotation: currentItem.dunRotation || [0, 0, 0],
    spaceState: spawnState,
    customInfo: buildCustomInfoWithState(currentItem.customInfo, state),
  }));
  if (!updatedResult.success || !updatedResult.data) {
    return updatedResult;
  }

  syncChangesExceptItem(session, transferChanges, launchedItemID);
  syncInventoryChange(
    session,
    updatedResult.data,
    launchedChange.previousData || updatedResult.previousData || {},
  );

  const spawnResult = getSpaceRuntime().spawnDynamicInventoryEntity(context.systemID, launchedItemID);
  if (!spawnResult || !spawnResult.success) {
    log.warn(
      `[SiphonUnit] Launched siphon ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobileSiphonUnitItem(updatedResult.data);
  log.info(
    `[SiphonUnit] char=${context.characterID} launched siphon itemID=${launchedItemID} system=${context.systemID}`,
  );

  return {
    success: true,
    data: {
      itemID: launchedItemID,
      sourceItemID: item.itemID,
      state,
    },
  };
}

module.exports = {
  CATEGORY_DEPLOYABLE,
  GROUP_MOBILE_SIPHON_UNIT,
  TYPE_SMALL_MOBILE_SIPHON_UNIT,
  TYPE_SMALL_MOBILE_HYBRID_SIPHON_UNIT,
  TYPE_SMALL_MOBILE_ROTE_SIPHON_UNIT,
  MOBILE_SIPHON_UNIT_LIFETIME_MS,
  MOBILE_SIPHON_UNIT_CYCLE_MS,
  MOBILE_SIPHON_UNIT_CONTROL_TOWER_MAX_RANGE_METERS,
  MOBILE_SIPHON_UNIT_REQUIRED_ANCHORING_LEVEL,
  isMobileSiphonUnitType,
  getMobileSiphonUnitStateFromItem,
  getMobileSiphonUnitCapacityInfo,
  buildSiphonCapacityKeyVal,
  launchMobileSiphonUnitFromShip,
  registerMobileSiphonUnitItem,
  clearMobileSiphonUnit,
  hydrateMobileSiphonUnitEntityFromInventoryItem,
  _testing: {
    buildCustomInfoWithState,
    buildDeployableSpawnState,
    calculateSiphonUsedVolume,
    getSiphonCapacity,
    getSiphonTypeConfig,
    getSkillLevel,
    getStateFromCustomInfo,
    validateMobileSiphonUnitLaunch,
  },
};
