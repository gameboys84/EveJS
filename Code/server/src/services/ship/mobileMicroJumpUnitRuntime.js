const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  getItemMetadata,
  listSystemSpaceItems,
  removeInventoryItem,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const hostileModuleRuntime = require(path.join(__dirname, "../../space/modules/hostileModuleRuntime"));

const CATEGORY_DEPLOYABLE = 22;
const CATEGORY_STATION = 3;
const CATEGORY_STARBASE = 23;
const CATEGORY_UPWELL_STRUCTURE = 65;
const GROUP_STARGATE = 10;
const GROUP_CONTROL_TOWER = 365;
const GROUP_MOBILE_MICRO_JUMP_UNIT = 1276;
const TYPE_MOBILE_MICRO_JUMP_UNIT = 33591;

const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_MICRO_JUMP_UNIT_ACTIVATION_DELAY_MS = 60 * 1000;
const MOBILE_MICRO_JUMP_UNIT_LIFETIME_MS = 48 * 60 * 60 * 1000;
const MOBILE_MICRO_JUMP_UNIT_USE_RANGE_METERS = 5_000;
const MOBILE_MICRO_JUMP_UNIT_SPOOLUP_MS = 12 * 1000;
const MOBILE_MICRO_JUMP_UNIT_JUMP_DISTANCE_METERS = 100_000;
const MOBILE_MICRO_JUMP_UNIT_MAX_SHIP_MASS_KG = 1_000_000_000;
const MOBILE_MICRO_JUMP_UNIT_MIN_DISTANCE_FROM_OWN_GROUP_METERS = 6_000;
const MOBILE_MICRO_JUMP_UNIT_MIN_DISTANCE_FROM_STATION_STARGATE_UPWELL_METERS = 20_000;
const MOBILE_MICRO_JUMP_UNIT_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS = 40_000;
const CUSTOM_INFO_KEY = "evejsMobileMicroJumpUnit";

const timersByUnitID = new Map();
const spoolTimersByShipID = new Map();

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

function getVectorDistance(left, right) {
  const leftVector = normalizeVector(left);
  const rightVector = normalizeVector(right);
  const dx = leftVector.x - rightVector.x;
  const dy = leftVector.y - rightVector.y;
  const dz = leftVector.z - rightVector.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function getSyncInventoryItemForSession() {
  const characterState = require(path.join(__dirname, "../character/characterState"));
  return characterState.syncInventoryItemForSession;
}

function isMobileMicroJumpUnitType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_DEPLOYABLE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_MOBILE_MICRO_JUMP_UNIT
    ) || toInt(typeIDOrItem.typeID, 0) === TYPE_MOBILE_MICRO_JUMP_UNIT;
  }
  return toInt(typeIDOrItem, 0) === TYPE_MOBILE_MICRO_JUMP_UNIT;
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
    unitID: toInt(state.unitID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
    lastJumpStartedAtMs: toInt(state.lastJumpStartedAtMs, 0),
    lastJumpStartedAtFileTime:
      state.lastJumpStartedAtFileTime === undefined ||
      state.lastJumpStartedAtFileTime === null
        ? null
        : String(state.lastJumpStartedAtFileTime),
  };
}

function getMobileMicroJumpUnitStateFromItem(item) {
  if (!item || !isMobileMicroJumpUnitType(item)) {
    return null;
  }
  const state = getStateFromCustomInfo(item.customInfo);
  if (!state || state.unitID <= 0) {
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
    unitID: toInt(state.unitID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
    lastJumpStartedAtMs: toInt(state.lastJumpStartedAtMs, 0),
    lastJumpStartedAtFileTime:
      state.lastJumpStartedAtFileTime === undefined ||
      state.lastJumpStartedAtFileTime === null
        ? null
        : String(state.lastJumpStartedAtFileTime),
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
    source,
  ];
  for (const candidate of candidates) {
    if (hasFiniteVectorCoordinates(candidate)) {
      return normalizeVector(candidate);
    }
  }
  return null;
}

function getObjectItemID(source) {
  return toInt(
    source && (
      source.itemID ||
      source.stationID ||
      source.stargateID ||
      source.structureID ||
      source.entityID ||
      source.id
    ),
    0,
  );
}

function getObjectTypeID(source) {
  return toInt(
    source && (
      source.typeID ||
      source.stationTypeID ||
      source.entityTypeID
    ),
    0,
  );
}

function firstPositiveReal(values, fallback = 0) {
  for (const value of values) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }
  }
  return Math.max(0, toReal(fallback, 0));
}

function getObjectPlacementRadius(source, metadata = null) {
  return firstPositiveReal([
    source && source.spaceRadius,
    source && source.radius,
    source && source.interactionRadius,
    metadata && metadata.radius,
  ]);
}

function resolvePlacementBlockerKind(source, explicitKind = null) {
  if (explicitKind) {
    return explicitKind;
  }
  if (isMobileMicroJumpUnitType(source)) {
    return "mobileMicroJumpUnit";
  }

  const typeID = getObjectTypeID(source);
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  const groupID = toInt(source && source.groupID, toInt(metadata.groupID, 0));
  const categoryID = toInt(source && source.categoryID, toInt(metadata.categoryID, 0));

  if (
    groupID === GROUP_STARGATE ||
    categoryID === CATEGORY_STATION ||
    categoryID === CATEGORY_UPWELL_STRUCTURE
  ) {
    return "stationStargateUpwell";
  }
  if (groupID === GROUP_CONTROL_TOWER || categoryID === CATEGORY_STARBASE) {
    return "controlTower";
  }
  return null;
}

function getPlacementBlockerMinimumDistance(kind) {
  if (kind === "mobileMicroJumpUnit") {
    return MOBILE_MICRO_JUMP_UNIT_MIN_DISTANCE_FROM_OWN_GROUP_METERS;
  }
  if (kind === "stationStargateUpwell") {
    return MOBILE_MICRO_JUMP_UNIT_MIN_DISTANCE_FROM_STATION_STARGATE_UPWELL_METERS;
  }
  if (kind === "controlTower") {
    return MOBILE_MICRO_JUMP_UNIT_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS;
  }
  return 0;
}

function getPlacementConflictError(kind) {
  if (kind === "mobileMicroJumpUnit") {
    return "MOBILE_MICRO_JUMP_UNIT_TOO_CLOSE_TO_UNIT";
  }
  if (kind === "stationStargateUpwell") {
    return "MOBILE_MICRO_JUMP_UNIT_TOO_CLOSE_TO_STATION_STARGATE_OR_UPWELL";
  }
  if (kind === "controlTower") {
    return "MOBILE_MICRO_JUMP_UNIT_TOO_CLOSE_TO_CONTROL_TOWER";
  }
  return "MOBILE_MICRO_JUMP_UNIT_DEPLOYMENT_BLOCKED";
}

function appendPlacementBlocker(blockers, seenKeys, source, options = {}) {
  const kind = resolvePlacementBlockerKind(source, options.kind);
  const minimumDistance = getPlacementBlockerMinimumDistance(kind);
  if (!minimumDistance) {
    return;
  }

  const itemID = getObjectItemID(source);
  if (itemID > 0 && itemID === toInt(options.sourceItemID, 0)) {
    return;
  }

  const position = getObjectPosition(source);
  if (!position) {
    return;
  }

  const typeID = getObjectTypeID(source);
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  const seenKey = itemID > 0
    ? `${kind}:${itemID}`
    : `${kind}:${typeID}:${position.x}:${position.y}:${position.z}`;
  if (seenKeys.has(seenKey)) {
    return;
  }
  seenKeys.add(seenKey);

  blockers.push({
    kind,
    itemID,
    typeID,
    position,
    radius: getObjectPlacementRadius(source, metadata),
    minimumDistance,
    errorMsg: getPlacementConflictError(kind),
  });
}

function collectPlacementBlockers(session, context, options = {}) {
  const blockers = [];
  const seenKeys = new Set();
  const systemID = toInt(context && context.systemID, 0);
  if (systemID <= 0) {
    return blockers;
  }

  const append = (source, kind = null) => appendPlacementBlocker(
    blockers,
    seenKeys,
    {
      ...source,
      itemID: source && (source.itemID || source.stationID || source.stargateID || source.structureID),
    },
    {
      kind,
      sourceItemID: options.sourceItemID,
    },
  );

  for (const station of worldData.getStationsForSystem(systemID)) {
    append(
      {
        ...station,
        itemID: station.stationID,
        typeID: station.stationTypeID,
      },
      "stationStargateUpwell",
    );
  }

  for (const stargate of worldData.getStargatesForSystem(systemID)) {
    append(stargate, "stationStargateUpwell");
  }

  for (const structure of worldData.getStructuresForSystem(systemID)) {
    append(
      {
        ...structure,
        itemID: structure.structureID || structure.itemID,
      },
    );
  }

  for (const item of listSystemSpaceItems(systemID)) {
    append(item);
  }

  const scene = session ? getSpaceRuntime().getSceneForSession(session) : null;
  if (scene) {
    for (const entity of Array.isArray(scene.staticEntities) ? scene.staticEntities : []) {
      append(entity);
    }
    const dynamicEntities = typeof scene.getDynamicEntities === "function"
      ? scene.getDynamicEntities()
      : scene.dynamicEntities instanceof Map
        ? [...scene.dynamicEntities.values()]
        : [];
    for (const entity of dynamicEntities) {
      append(entity);
    }
  }

  return blockers;
}

function findPlacementConflict(session, item, context, spawnState) {
  const deployPosition = getObjectPosition(spawnState);
  if (!deployPosition) {
    return {
      errorMsg: "MOBILE_MICRO_JUMP_UNIT_DEPLOY_POSITION_UNAVAILABLE",
    };
  }

  const typeID = getObjectTypeID(item);
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  const deployedRadius = getObjectPlacementRadius(item, metadata);
  const blockers = collectPlacementBlockers(session, context, {
    sourceItemID: item && item.itemID,
  });

  for (const blocker of blockers) {
    const distance = getVectorDistance(deployPosition, blocker.position);
    const surfaceDistance = distance - deployedRadius - Math.max(0, blocker.radius);
    if (surfaceDistance < blocker.minimumDistance) {
      return {
        errorMsg: blocker.errorMsg,
        blocker,
        distance,
        surfaceDistance,
      };
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

function updateMobileMicroJumpUnitState(itemID, updater) {
  const item = findItemById(itemID);
  if (!item) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }
  const currentState = getStateFromCustomInfo(item.customInfo);
  if (!currentState) {
    return {
      success: false,
      errorMsg: "MOBILE_MICRO_JUMP_UNIT_STATE_NOT_FOUND",
    };
  }
  const nextState =
    typeof updater === "function" ? updater({ ...currentState }, item) : updater;
  return updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    customInfo: buildCustomInfoWithState(currentItem.customInfo, nextState),
  }));
}

function clearUnitTimers(unitID) {
  const normalizedUnitID = toInt(unitID, 0);
  const timerState = timersByUnitID.get(normalizedUnitID);
  if (timerState) {
    if (timerState.activationTimer) {
      clearTimeout(timerState.activationTimer);
    }
    if (timerState.expiryTimer) {
      clearTimeout(timerState.expiryTimer);
    }
    timersByUnitID.delete(normalizedUnitID);
  }

  for (const [shipID, spoolState] of [...spoolTimersByShipID.entries()]) {
    if (!spoolState || toInt(spoolState.unitID, 0) !== normalizedUnitID) {
      continue;
    }
    if (spoolState.timer) {
      clearTimeout(spoolState.timer);
    }
    spoolTimersByShipID.delete(shipID);
  }
}

function setUnrefTimeout(callback, delayMs) {
  const timer = setTimeout(callback, Math.max(0, toInt(delayMs, 0)));
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

function clearMobileMicroJumpUnit(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }
  clearUnitTimers(itemID);

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileMicroJumpUnitStateFromItem(item);
  if (!state) {
    return false;
  }

  if (findItemById(itemID)) {
    updateMobileMicroJumpUnitState(itemID, (currentState) => ({
      ...currentState,
      active: false,
      deactivatedAtMs: Date.now(),
    }));
  }
  log.info(`[MobileMicroJumpUnit] Cleared unit=${itemID} reason=${reason}`);
  return true;
}

function activateMobileMicroJumpUnit(itemID) {
  const item = findItemById(itemID);
  const state = getMobileMicroJumpUnitStateFromItem(item);
  if (!state) {
    clearUnitTimers(itemID);
    return false;
  }

  const now = Date.now();
  if (state.expiresAtMs > 0 && state.expiresAtMs <= now) {
    expireMobileMicroJumpUnit(itemID, "expired-before-activation");
    return false;
  }
  if (
    toInt(item.locationID, 0) !== state.solarSystemID ||
    toInt(item.flagID, 0) !== 0 ||
    !item.spaceState
  ) {
    clearMobileMicroJumpUnit(item, "removed-before-activation");
    return false;
  }

  updateMobileMicroJumpUnitState(itemID, (currentState) => ({
    ...currentState,
    active: true,
    activatedAtMs: now,
  }));
  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, itemID);
  scheduleMobileMicroJumpUnitTimers(itemID);
  log.info(
    `[MobileMicroJumpUnit] Activated unit=${itemID} system=${state.solarSystemID}`,
  );
  return true;
}

function expireMobileMicroJumpUnit(itemID, reason = "expired") {
  const item = findItemById(itemID);
  const state = getMobileMicroJumpUnitStateFromItem(item);
  const systemID = toInt(
    state && state.solarSystemID,
    toInt(item && item.locationID, 0),
  );
  clearUnitTimers(itemID);

  if (systemID > 0) {
    const destroyResult = getSpaceRuntime().destroyDynamicInventoryEntity(systemID, itemID);
    if (destroyResult && destroyResult.success) {
      log.info(`[MobileMicroJumpUnit] Removed unit=${itemID} reason=${reason}`);
      return true;
    }
  }

  const removeResult = removeInventoryItem(itemID, { removeContents: true });
  if (removeResult.success) {
    log.info(`[MobileMicroJumpUnit] Removed unit=${itemID} reason=${reason}`);
    return true;
  }
  return false;
}

function scheduleMobileMicroJumpUnitTimers(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileMicroJumpUnitStateFromItem(item);
  if (!state) {
    clearUnitTimers(itemID);
    return false;
  }

  clearUnitTimers(itemID);

  const now = Date.now();
  const nextTimers = {
    activationTimer: null,
    expiryTimer: null,
  };

  if (state.expiresAtMs > 0) {
    nextTimers.expiryTimer = setUnrefTimeout(
      () => expireMobileMicroJumpUnit(itemID, "expired"),
      state.expiresAtMs - now,
    );
  }

  if (state.active || state.activateAtMs <= now) {
    if (!state.active) {
      nextTimers.activationTimer = setUnrefTimeout(
        () => activateMobileMicroJumpUnit(itemID),
        0,
      );
    }
  } else {
    nextTimers.activationTimer = setUnrefTimeout(
      () => activateMobileMicroJumpUnit(itemID),
      state.activateAtMs - now,
    );
  }

  timersByUnitID.set(itemID, nextTimers);
  return true;
}

function registerMobileMicroJumpUnitItem(itemOrID) {
  return scheduleMobileMicroJumpUnitTimers(itemOrID);
}

function isActiveMobileMicroJumpUnitState(state, nowMs = Date.now()) {
  if (!state || state.deactivatedAtMs > 0) {
    return false;
  }
  if (state.expiresAtMs > 0 && state.expiresAtMs <= nowMs) {
    return false;
  }
  return state.active === true || (state.activateAtMs > 0 && state.activateAtMs <= nowMs);
}

function hydrateMobileMicroJumpUnitEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isMobileMicroJumpUnitType(itemRecord)) {
    return entity;
  }

  const state = getMobileMicroJumpUnitStateFromItem(itemRecord);
  if (!state) {
    return entity;
  }

  const active = isActiveMobileMicroJumpUnitState(state, Date.now());
  entity.component_activate = [active, active ? null : state.activateAtMs];
  entity.activate_comp_durationSeconds = Math.trunc(
    MOBILE_MICRO_JUMP_UNIT_ACTIVATION_DELAY_MS / 1000,
  );
  if (state.lastJumpStartedAtFileTime) {
    entity.component_microJumpDriver = state.lastJumpStartedAtFileTime;
  } else {
    delete entity.component_microJumpDriver;
  }
  entity.microJumpDriverUseRangeMeters = MOBILE_MICRO_JUMP_UNIT_USE_RANGE_METERS;
  entity.microJumpDriverSpoolupMs = MOBILE_MICRO_JUMP_UNIT_SPOOLUP_MS;
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

function validateMobileMicroJumpUnitLaunch(item, context) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileMicroJumpUnitType(item)) {
    return "ITEM_NOT_MOBILE_MICRO_JUMP_UNIT";
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    toInt(item.flagID, 0) !== ITEM_FLAGS.CARGO_HOLD
  ) {
    return "ITEM_NOT_IN_SHIP_CARGO";
  }
  return null;
}

function launchMobileMicroJumpUnitFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateMobileMicroJumpUnitLaunch(item, context);
  if (validationError) {
    return {
      success: false,
      errorMsg: validationError,
    };
  }

  const spawnState = buildDeployableSpawnState(session, context);
  const placementConflict = findPlacementConflict(session, item, context, spawnState);
  if (placementConflict) {
    log.info(
      `[MobileMicroJumpUnit] Launch rejected char=${context.characterID} item=${item.itemID} system=${context.systemID} reason=${placementConflict.errorMsg}`,
    );
    return {
      success: false,
      errorMsg: placementConflict.errorMsg,
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
    unitID: launchedItemID,
    deployedAtMs: now,
    activateAtMs: now + MOBILE_MICRO_JUMP_UNIT_ACTIVATION_DELAY_MS,
    activatedAtMs: 0,
    expiresAtMs: now + MOBILE_MICRO_JUMP_UNIT_LIFETIME_MS,
    active: false,
    deactivatedAtMs: 0,
    lastJumpStartedAtMs: 0,
    lastJumpStartedAtFileTime: null,
  };
  const updatedResult = updateInventoryItem(launchedItemID, (currentItem) => ({
    ...currentItem,
    ownerID: context.ownerID,
    locationID: context.systemID,
    flagID: 0,
    singleton: 1,
    createdAtMs: currentItem.createdAtMs || now,
    expiresAtMs: state.expiresAtMs,
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
      `[MobileMicroJumpUnit] Launched unit ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobileMicroJumpUnitItem(updatedResult.data);
  log.info(
    `[MobileMicroJumpUnit] char=${context.characterID} launched unit itemID=${launchedItemID} system=${context.systemID}`,
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

function getEntitySurfaceDistance(left, right) {
  const leftPosition = getObjectPosition(left);
  const rightPosition = getObjectPosition(right);
  if (!leftPosition || !rightPosition) {
    return Number.POSITIVE_INFINITY;
  }
  const leftRadius = firstPositiveReal([
    left && left.radius,
    left && left.spaceRadius,
  ]);
  const rightRadius = firstPositiveReal([
    right && right.radius,
    right && right.spaceRadius,
  ]);
  return Math.max(0, getVectorDistance(leftPosition, rightPosition) - leftRadius - rightRadius);
}

function resolveShipMassKg(shipEntity, shipItem = null) {
  const metadata = shipItem && shipItem.typeID ? getItemMetadata(shipItem.typeID) : null;
  return Math.max(
    0,
    toReal(shipEntity && shipEntity.mass, 0),
    toReal(shipItem && shipItem.mass, 0),
    toReal(metadata && metadata.mass, 0),
  );
}

function isShipCloaked(entity) {
  if (!entity) {
    return false;
  }
  if (entity.cloaked === true) {
    return true;
  }
  if (toInt(entity.isCloaked, 0) > 0 || toInt(entity.cloakMode, 0) > 0) {
    return true;
  }
  if (typeof entity.cloakState === "number") {
    return toInt(entity.cloakState, 0) > 0;
  }
  if (entity.cloakState && typeof entity.cloakState === "object") {
    return (
      entity.cloakState.active === true ||
      String(entity.cloakState.state || "").toLowerCase() === "active" ||
      toInt(entity.cloakState.mode, 0) > 0
    );
  }
  return false;
}

function resolveActiveUnit(session, unitID) {
  const numericUnitID = toInt(unitID, 0);
  if (numericUnitID <= 0) {
    return {
      success: false,
      errorMsg: "MOBILE_MICRO_JUMP_UNIT_NOT_FOUND",
    };
  }

  const item = findItemById(numericUnitID);
  const state = getMobileMicroJumpUnitStateFromItem(item);
  if (!item || !state || !isActiveMobileMicroJumpUnitState(state, Date.now())) {
    return {
      success: false,
      errorMsg: "MOBILE_MICRO_JUMP_UNIT_NOT_ACTIVE",
    };
  }

  const scene = getSpaceRuntime().getSceneForSession(session);
  const unitEntity = scene && typeof scene.getEntityByID === "function"
    ? scene.getEntityByID(numericUnitID)
    : null;
  if (!scene || !unitEntity || !isMobileMicroJumpUnitType(unitEntity)) {
    return {
      success: false,
      errorMsg: "MOBILE_MICRO_JUMP_UNIT_NOT_FOUND",
    };
  }

  if (toInt(state.solarSystemID, 0) !== toInt(scene.systemID, 0)) {
    return {
      success: false,
      errorMsg: "MOBILE_MICRO_JUMP_UNIT_WRONG_SYSTEM",
    };
  }

  return {
    success: true,
    data: {
      item,
      scene,
      state,
      unitEntity,
    },
  };
}

function validateShipCanUseUnit(session, unitEntity, scene) {
  const shipEntity = scene && typeof scene.getShipEntityForSession === "function"
    ? scene.getShipEntityForSession(session)
    : null;
  if (!shipEntity || shipEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (isShipCloaked(shipEntity)) {
    return {
      success: false,
      errorMsg: "SHIP_CLOAKED",
    };
  }
  if (hostileModuleRuntime.isMicroJumpDriveBlocked(shipEntity)) {
    return {
      success: false,
      errorMsg: "MICRO_JUMP_DRIVE_BLOCKED",
    };
  }

  const surfaceDistance = getEntitySurfaceDistance(shipEntity, unitEntity);
  if (surfaceDistance > MOBILE_MICRO_JUMP_UNIT_USE_RANGE_METERS) {
    return {
      success: false,
      errorMsg: "SHIP_TOO_FAR_FROM_MOBILE_MICRO_JUMP_UNIT",
      surfaceDistance,
    };
  }

  const shipItem = findItemById(shipEntity.itemID);
  const massKg = resolveShipMassKg(shipEntity, shipItem);
  if (massKg >= MOBILE_MICRO_JUMP_UNIT_MAX_SHIP_MASS_KG) {
    return {
      success: false,
      errorMsg: "SHIP_TOO_MASSIVE_FOR_MOBILE_MICRO_JUMP_UNIT",
      massKg,
    };
  }

  return {
    success: true,
    data: {
      massKg,
      shipEntity,
      shipID: toInt(shipEntity.itemID, 0),
      surfaceDistance,
    },
  };
}

function getSessionFileTimeString(session) {
  const fileTime = getSpaceRuntime().getSimulationFileTimeForSession(session);
  return String(fileTime);
}

function clearSpoolForShip(shipID) {
  const normalizedShipID = toInt(shipID, 0);
  const spoolState = spoolTimersByShipID.get(normalizedShipID);
  if (!spoolState) {
    return;
  }
  if (spoolState.timer) {
    clearTimeout(spoolState.timer);
  }
  spoolTimersByShipID.delete(normalizedShipID);
}

function completeMobileMicroJumpSpool(session, shipID, unitID) {
  const normalizedShipID = toInt(shipID, 0);
  const spoolState = spoolTimersByShipID.get(normalizedShipID);
  if (!spoolState || toInt(spoolState.unitID, 0) !== toInt(unitID, 0)) {
    return false;
  }
  spoolTimersByShipID.delete(normalizedShipID);

  const unitResult = resolveActiveUnit(session, unitID);
  if (!unitResult.success) {
    log.info(
      `[MobileMicroJumpUnit] Spool cancelled ship=${shipID} unit=${unitID} reason=${unitResult.errorMsg}`,
    );
    return false;
  }

  const { scene, unitEntity } = unitResult.data;
  const shipResult = validateShipCanUseUnit(session, unitEntity, scene);
  if (!shipResult.success && shipResult.errorMsg !== "SHIP_TOO_FAR_FROM_MOBILE_MICRO_JUMP_UNIT") {
    log.info(
      `[MobileMicroJumpUnit] Spool cancelled ship=${shipID} unit=${unitID} reason=${shipResult.errorMsg}`,
    );
    return false;
  }

  const shipEntity = scene.getShipEntityForSession(session);
  if (!shipEntity || toInt(shipEntity.itemID, 0) !== normalizedShipID) {
    log.info(
      `[MobileMicroJumpUnit] Spool cancelled ship=${shipID} unit=${unitID} reason=SHIP_CHANGED`,
    );
    return false;
  }
  if (isShipCloaked(shipEntity) || hostileModuleRuntime.isMicroJumpDriveBlocked(shipEntity)) {
    log.info(
      `[MobileMicroJumpUnit] Spool cancelled ship=${shipID} unit=${unitID} reason=SHIP_BLOCKED`,
    );
    return false;
  }

  const jumpResult = getSpaceRuntime().executeMobileMicroJumpForShip(session, unitID, {
    jumpDistanceMeters: MOBILE_MICRO_JUMP_UNIT_JUMP_DISTANCE_METERS,
    typeID: TYPE_MOBILE_MICRO_JUMP_UNIT,
  });
  if (!jumpResult || !jumpResult.success) {
    log.warn(
      `[MobileMicroJumpUnit] Jump failed ship=${shipID} unit=${unitID}: ${jumpResult ? jumpResult.errorMsg : "UNKNOWN"}`,
    );
    return false;
  }

  log.info(`[MobileMicroJumpUnit] Jumped ship=${shipID} unit=${unitID}`);
  return true;
}

function startMobileMicroJumpDriveForShip(session, unitID) {
  const unitResult = resolveActiveUnit(session, unitID);
  if (!unitResult.success) {
    log.info(
      `[MobileMicroJumpUnit] Activation rejected char=${session && session.characterID} unit=${unitID} reason=${unitResult.errorMsg}`,
    );
    return {
      success: false,
      errorMsg: unitResult.errorMsg,
    };
  }

  const { scene, state, unitEntity } = unitResult.data;
  const shipResult = validateShipCanUseUnit(session, unitEntity, scene);
  if (!shipResult.success) {
    log.info(
      `[MobileMicroJumpUnit] Activation rejected char=${session && session.characterID} unit=${unitID} reason=${shipResult.errorMsg}`,
    );
    return shipResult;
  }

  const shipID = shipResult.data.shipID;
  const existingSpool = spoolTimersByShipID.get(shipID);
  const now = Date.now();
  if (existingSpool && toInt(existingSpool.expiresAtMs, 0) > now) {
    return {
      success: false,
      errorMsg: "MOBILE_MICRO_JUMP_UNIT_ALREADY_SPOOLING",
    };
  }
  clearSpoolForShip(shipID);

  const lastJumpStartedAtFileTime = getSessionFileTimeString(session);
  const updateResult = updateMobileMicroJumpUnitState(unitID, (currentState) => ({
    ...currentState,
    active: true,
    lastJumpStartedAtMs: now,
    lastJumpStartedAtFileTime,
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, unitID);

  const timer = setUnrefTimeout(
    () => completeMobileMicroJumpSpool(session, shipID, unitID),
    MOBILE_MICRO_JUMP_UNIT_SPOOLUP_MS,
  );
  spoolTimersByShipID.set(shipID, {
    unitID: toInt(unitID, 0),
    startedAtMs: now,
    expiresAtMs: now + MOBILE_MICRO_JUMP_UNIT_SPOOLUP_MS,
    timer,
  });

  log.info(
    `[MobileMicroJumpUnit] Started spool ship=${shipID} unit=${unitID} char=${session && session.characterID}`,
  );
  return {
    success: true,
    data: {
      shipID,
      unitID: toInt(unitID, 0),
      startedAtMs: now,
      startedAtFileTime: lastJumpStartedAtFileTime,
      spoolupMs: MOBILE_MICRO_JUMP_UNIT_SPOOLUP_MS,
    },
  };
}

module.exports = {
  CATEGORY_DEPLOYABLE,
  GROUP_MOBILE_MICRO_JUMP_UNIT,
  TYPE_MOBILE_MICRO_JUMP_UNIT,
  MOBILE_MICRO_JUMP_UNIT_ACTIVATION_DELAY_MS,
  MOBILE_MICRO_JUMP_UNIT_LIFETIME_MS,
  MOBILE_MICRO_JUMP_UNIT_USE_RANGE_METERS,
  MOBILE_MICRO_JUMP_UNIT_SPOOLUP_MS,
  MOBILE_MICRO_JUMP_UNIT_JUMP_DISTANCE_METERS,
  MOBILE_MICRO_JUMP_UNIT_MAX_SHIP_MASS_KG,
  isMobileMicroJumpUnitType,
  launchMobileMicroJumpUnitFromShip,
  registerMobileMicroJumpUnitItem,
  clearMobileMicroJumpUnit,
  getMobileMicroJumpUnitStateFromItem,
  hydrateMobileMicroJumpUnitEntityFromInventoryItem,
  startMobileMicroJumpDriveForShip,
  _testing: {
    buildDeployableSpawnState,
    buildCustomInfoWithState,
    getStateFromCustomInfo,
    findPlacementConflict,
    validateShipCanUseUnit,
  },
};
