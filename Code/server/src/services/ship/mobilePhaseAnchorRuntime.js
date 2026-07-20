const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  getItemMetadata,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));

const CATEGORY_DEPLOYABLE = 22;
const GROUP_MOBILE_PHASE_ANCHOR = 4913;
const TYPE_MOBILE_PHASE_ANCHOR = 90037;
const TYPE_ANCHORING = 11584;

const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_PHASE_ANCHOR_REQUIRED_ENERGY = 100;
const MOBILE_PHASE_ANCHOR_NUM_CHARGES = 10;
const MOBILE_PHASE_ANCHOR_PHASEABLE_MAX_RANGE_METERS = 50_000;
const MOBILE_PHASE_ANCHOR_CHARGE_DURATION_MS = 60 * 1000;
const CUSTOM_INFO_KEY = "evejsMobilePhaseAnchor";

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toReal(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
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

function isMobilePhaseAnchorType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_DEPLOYABLE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_MOBILE_PHASE_ANCHOR
    ) || isMobilePhaseAnchorType(toInt(typeIDOrItem.typeID, 0));
  }

  const typeID = toInt(typeIDOrItem, 0);
  if (typeID <= 0) {
    return false;
  }
  if (typeID === TYPE_MOBILE_PHASE_ANCHOR) {
    return true;
  }
  const metadata = getItemMetadata(typeID) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_DEPLOYABLE &&
    toInt(metadata.groupID, 0) === GROUP_MOBILE_PHASE_ANCHOR
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
    anchorID: toInt(state.anchorID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    shipEnergy: toInt(state.shipEnergy, 0),
    phasingInCompletionAtMs: toInt(state.phasingInCompletionAtMs, 0),
    chargesRemaining: toInt(state.chargesRemaining, MOBILE_PHASE_ANCHOR_NUM_CHARGES),
    nearestPhaseableID: toInt(state.nearestPhaseableID, 0),
    phaseableIsAvailable: state.phaseableIsAvailable === true,
    phaseableIsPhasedIn: state.phaseableIsPhasedIn === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
  };
}

function getMobilePhaseAnchorStateFromItem(item) {
  if (!item || !isMobilePhaseAnchorType(item)) {
    return null;
  }
  const state = getStateFromCustomInfo(item.customInfo);
  if (!state || state.anchorID <= 0) {
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
    anchorID: toInt(state.anchorID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    shipEnergy: toInt(state.shipEnergy, 0),
    phasingInCompletionAtMs: toInt(state.phasingInCompletionAtMs, 0),
    chargesRemaining: Math.max(0, toInt(
      state.chargesRemaining,
      MOBILE_PHASE_ANCHOR_NUM_CHARGES,
    )),
    nearestPhaseableID: toInt(state.nearestPhaseableID, 0),
    phaseableIsAvailable: state.phaseableIsAvailable === true,
    phaseableIsPhasedIn: state.phaseableIsPhasedIn === true,
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

function buildPhaseStabilizerSlimValue(state) {
  return [
    Math.max(0, toInt(state && state.shipEnergy, 0)),
    toInt(state && state.phasingInCompletionAtMs, 0) > 0
      ? toInt(state.phasingInCompletionAtMs, 0)
      : null,
    Math.max(0, toInt(
      state && state.chargesRemaining,
      MOBILE_PHASE_ANCHOR_NUM_CHARGES,
    )),
    toInt(state && state.nearestPhaseableID, 0) > 0
      ? toInt(state.nearestPhaseableID, 0)
      : null,
    Boolean(state && state.phaseableIsAvailable),
    Boolean(state && state.phaseableIsPhasedIn),
  ];
}

function hydrateMobilePhaseAnchorEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isMobilePhaseAnchorType(itemRecord)) {
    return entity;
  }

  const state = getMobilePhaseAnchorStateFromItem(itemRecord);
  if (!state || state.deactivatedAtMs > 0) {
    return entity;
  }

  entity.component_phaseStabilizer = buildPhaseStabilizerSlimValue(state);
  entity.phaseStabilizerRequiredEnergy = MOBILE_PHASE_ANCHOR_REQUIRED_ENERGY;
  entity.phaseStabilizerNumCharges = MOBILE_PHASE_ANCHOR_NUM_CHARGES;
  entity.phaseStabilizerPhaseableMaxRangeMeters = MOBILE_PHASE_ANCHOR_PHASEABLE_MAX_RANGE_METERS;
  entity.phaseStabilizerChargeDurationMs = MOBILE_PHASE_ANCHOR_CHARGE_DURATION_MS;
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

function validateMobilePhaseAnchorLaunch(item, context) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobilePhaseAnchorType(item)) {
    return "ITEM_NOT_MOBILE_PHASE_ANCHOR";
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    toInt(item.flagID, 0) !== ITEM_FLAGS.CARGO_HOLD
  ) {
    return "ITEM_NOT_IN_SHIP_CARGO";
  }
  if (getSkillLevel(context.characterID, TYPE_ANCHORING) < 3) {
    return "Mobile Phase Anchor deployment requires Anchoring 3.";
  }
  return null;
}

function launchMobilePhaseAnchorFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateMobilePhaseAnchorLaunch(item, context);
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
      errorMsg: "MOBILE_PHASE_ANCHOR_DEPLOY_POSITION_UNAVAILABLE",
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
    anchorID: launchedItemID,
    deployedAtMs: now,
    shipEnergy: 0,
    phasingInCompletionAtMs: 0,
    chargesRemaining: MOBILE_PHASE_ANCHOR_NUM_CHARGES,
    nearestPhaseableID: 0,
    phaseableIsAvailable: false,
    phaseableIsPhasedIn: false,
    deactivatedAtMs: 0,
  };
  const updatedResult = updateInventoryItem(launchedItemID, (currentItem) => ({
    ...currentItem,
    ownerID: context.ownerID,
    locationID: context.systemID,
    flagID: 0,
    singleton: 1,
    createdAtMs: currentItem.createdAtMs || now,
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
      `[MobilePhaseAnchor] Launched anchor ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobilePhaseAnchorItem(updatedResult.data);
  log.info(
    `[MobilePhaseAnchor] char=${context.characterID} launched anchor itemID=${launchedItemID} system=${context.systemID}`,
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

function clearMobilePhaseAnchor(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobilePhaseAnchorStateFromItem(item);
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
  log.info(`[MobilePhaseAnchor] Cleared anchor=${itemID} reason=${reason}`);
  return true;
}

function registerMobilePhaseAnchorItem(itemOrID) {
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemOrID);
  return Boolean(getMobilePhaseAnchorStateFromItem(item));
}

module.exports = {
  CATEGORY_DEPLOYABLE,
  GROUP_MOBILE_PHASE_ANCHOR,
  TYPE_MOBILE_PHASE_ANCHOR,
  MOBILE_PHASE_ANCHOR_REQUIRED_ENERGY,
  MOBILE_PHASE_ANCHOR_NUM_CHARGES,
  MOBILE_PHASE_ANCHOR_PHASEABLE_MAX_RANGE_METERS,
  MOBILE_PHASE_ANCHOR_CHARGE_DURATION_MS,
  isMobilePhaseAnchorType,
  getMobilePhaseAnchorStateFromItem,
  launchMobilePhaseAnchorFromShip,
  registerMobilePhaseAnchorItem,
  clearMobilePhaseAnchor,
  hydrateMobilePhaseAnchorEntityFromInventoryItem,
  _testing: {
    buildCustomInfoWithState,
    buildDeployableSpawnState,
    buildPhaseStabilizerSlimValue,
    getSkillLevel,
    getStateFromCustomInfo,
    validateMobilePhaseAnchorLaunch,
  },
};
