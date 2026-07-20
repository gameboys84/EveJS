const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  createSpaceItemForOwner,
  findItemById,
  getItemMetadata,
  listContainerItems,
  listSystemSpaceItems,
  moveItemToLocation,
  removeInventoryItem,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildShipResourceState,
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const destiny = require(path.join(__dirname, "../../space/destiny"));
const nativeNpcStore = require(path.join(__dirname, "../../space/npc/nativeNpcStore"));
const {
  buildGodmaShipEffectEvent,
  buildModuleAttributeChangeEvent,
  sendOnMultiEventPairs,
} = require(path.join(__dirname, "../_shared/godmaMultiEvent"));

const CATEGORY_DEPLOYABLE = 22;
const CATEGORY_STATION = 3;
const CATEGORY_STARBASE = 23;
const CATEGORY_UPWELL_STRUCTURE = 65;
const GROUP_STARGATE = 10;
const GROUP_CONTROL_TOWER = 365;
const GROUP_MOBILE_TRACTOR_UNIT = 1250;

const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_TRACTOR_UNIT_ACTIVATION_DELAY_MS = 10 * 1000;
const MOBILE_TRACTOR_UNIT_LIFETIME_MS = 2 * 24 * 60 * 60 * 1000;
const MOBILE_TRACTOR_UNIT_CYCLE_TIME_SECONDS = 5;
const MOBILE_TRACTOR_UNIT_DEFAULT_RANGE_METERS = 125_000;
const MOBILE_TRACTOR_UNIT_DEFAULT_MAX_TRACTOR_VELOCITY = 1_000;
const MOBILE_TRACTOR_UNIT_DEFAULT_CAPACITY = 27_000;
const MOBILE_TRACTOR_UNIT_SCOOP_RANGE_METERS = 2_500;
const MOBILE_TRACTOR_UNIT_EJECTED_CONTAINER_DISTANCE_METERS = 275;
const MOBILE_TRACTOR_UNIT_EJECTED_CONTAINER_LIFETIME_MS = 2 * 60 * 60 * 1000;
const MOBILE_TRACTOR_UNIT_MIN_DISTANCE_FROM_OWN_GROUP_METERS = 5_000;
const MOBILE_TRACTOR_UNIT_MIN_DISTANCE_FROM_STATION_STARGATE_UPWELL_METERS = 50_000;
const MOBILE_TRACTOR_UNIT_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS = 40_000;
const CARGO_CONTAINER_NAME = "Cargo Container";
const CUSTOM_INFO_KEY = "evejsMobileTractorUnit";
const MOBILE_TRACTOR_UNIT_CARGO_FLAG_ID = ITEM_FLAGS.CARGO_HOLD;
const TRACTOR_BEAM_EFFECT_GUID = "effects.TractorBeam";
const TRACTOR_BEAM_GODMA_EFFECT_ID = 2255;
const TRACTOR_TARGET_MAX_SPEED_ATTRIBUTE_ID = 37;
const TRACTOR_BEAM_FOLLOW_RANGE_METERS = 500;
const TRACTOR_BEAM_EFFECT_DURATION_MS = 30_000;
const TRACTOR_BEAM_EFFECT_REPEAT = 1_000;
const TRACTOR_BEAM_TARGET_MASS = 10;

const timersByTractorUnitID = new Map();

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

function getNativeNpcWreckService() {
  return require(path.join(__dirname, "../../space/npc/nativeNpcWreckService"));
}

function getMaybeExpireEmptySpaceContainer() {
  return require(path.join(__dirname, "./jettisonRuntime")).maybeExpireEmptySpaceContainer;
}

function getEmitItemsChangedForSession() {
  const characterState = require(path.join(__dirname, "../character/characterState"));
  return characterState.emitItemsChangedForSession;
}

function syncInventoryChange(session, item, previousData, options = {}) {
  const emitItemsChangedForSession = getEmitItemsChangedForSession();
  if (typeof emitItemsChangedForSession !== "function") {
    return;
  }
  emitItemsChangedForSession(
    session,
    item,
    previousData || {},
    {
      idType: options.idType,
      locationContext: options.locationContext,
    },
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

function listInterestedSessions(scene, characterIDs = []) {
  if (!scene || !scene.sessions) {
    return [];
  }
  const interestedCharacterIDs = new Set(
    characterIDs.map((characterID) => toInt(characterID, 0)).filter((characterID) => characterID > 0),
  );
  if (interestedCharacterIDs.size === 0) {
    return [];
  }
  return [...scene.sessions.values()].filter((session) => (
    session && interestedCharacterIDs.has(toInt(session.characterID || session.charid, 0))
  ));
}

function syncInventoryChangesToInterestedSessions(scene, characterIDs = [], changes = [], options = {}) {
  if (!scene || !scene.sessions || !Array.isArray(changes) || changes.length === 0) {
    return;
  }
  for (const session of listInterestedSessions(scene, characterIDs)) {
    for (const change of changes) {
      if (!change || !change.item) {
        continue;
      }
      syncInventoryChange(
        session,
        change.item,
        change.previousData || change.previousState || {},
        options,
      );
    }
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

function isMobileTractorUnitType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    if (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_DEPLOYABLE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_MOBILE_TRACTOR_UNIT
    ) {
      return true;
    }
    return isMobileTractorUnitType(toInt(typeIDOrItem.typeID, 0));
  }

  const metadata = getItemMetadata(typeIDOrItem) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_DEPLOYABLE &&
    toInt(metadata.groupID, 0) === GROUP_MOBILE_TRACTOR_UNIT
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
    tractorUnitID: toInt(state.tractorUnitID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
    nextCycleAtMs: toInt(state.nextCycleAtMs, 0),
    lastCycleAtMs: toInt(state.lastCycleAtMs, 0),
    lastLootMoveAtMs: toInt(state.lastLootMoveAtMs, 0),
    lastTractorTargetID: toInt(state.lastTractorTargetID, 0),
    movedItemCount: toInt(state.movedItemCount, 0),
    rangeMeters: toReal(state.rangeMeters, MOBILE_TRACTOR_UNIT_DEFAULT_RANGE_METERS),
    cycleTimeSeconds: toReal(state.cycleTimeSeconds, MOBILE_TRACTOR_UNIT_CYCLE_TIME_SECONDS),
    maxTractorVelocity: toReal(
      state.maxTractorVelocity,
      MOBILE_TRACTOR_UNIT_DEFAULT_MAX_TRACTOR_VELOCITY,
    ),
    holdCapacity: toReal(state.holdCapacity, MOBILE_TRACTOR_UNIT_DEFAULT_CAPACITY),
  };
}

function getMobileTractorUnitStateFromItem(item) {
  if (!item || !isMobileTractorUnitType(item)) {
    return null;
  }
  const state = getStateFromCustomInfo(item.customInfo);
  if (!state || state.tractorUnitID <= 0) {
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
    tractorUnitID: toInt(state.tractorUnitID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
    nextCycleAtMs: toInt(state.nextCycleAtMs, 0),
    lastCycleAtMs: toInt(state.lastCycleAtMs, 0),
    lastLootMoveAtMs: toInt(state.lastLootMoveAtMs, 0),
    lastTractorTargetID: toInt(state.lastTractorTargetID, 0),
    movedItemCount: toInt(state.movedItemCount, 0),
    rangeMeters: toReal(state.rangeMeters, MOBILE_TRACTOR_UNIT_DEFAULT_RANGE_METERS),
    cycleTimeSeconds: toReal(state.cycleTimeSeconds, MOBILE_TRACTOR_UNIT_CYCLE_TIME_SECONDS),
    maxTractorVelocity: toReal(
      state.maxTractorVelocity,
      MOBILE_TRACTOR_UNIT_DEFAULT_MAX_TRACTOR_VELOCITY,
    ),
    holdCapacity: toReal(state.holdCapacity, MOBILE_TRACTOR_UNIT_DEFAULT_CAPACITY),
  };
  return JSON.stringify(parsed);
}

function buildCustomInfoWithoutState(customInfo) {
  const parsed = parseCustomInfo(customInfo);
  delete parsed[CUSTOM_INFO_KEY];
  return Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : "";
}

function resolveMobileTractorUnitStats(itemOrTypeID) {
  const typeID = toInt(itemOrTypeID && itemOrTypeID.typeID ? itemOrTypeID.typeID : itemOrTypeID, 0);
  const metadata = getItemMetadata(typeID) || {};
  const maxRange = firstPositiveReal([
    getTypeAttributeValue(typeID, "maxRange"),
    getTypeAttributeValue(typeID, "maxTargetRange"),
  ], MOBILE_TRACTOR_UNIT_DEFAULT_RANGE_METERS);
  return {
    rangeMeters: maxRange,
    cycleTimeSeconds: MOBILE_TRACTOR_UNIT_CYCLE_TIME_SECONDS,
    maxTractorVelocity: firstPositiveReal([
      getTypeAttributeValue(typeID, "maxTractorVelocity"),
    ], MOBILE_TRACTOR_UNIT_DEFAULT_MAX_TRACTOR_VELOCITY),
    holdCapacity: firstPositiveReal([
      metadata.capacity,
    ], MOBILE_TRACTOR_UNIT_DEFAULT_CAPACITY),
  };
}

function getObjectItemID(source) {
  return toInt(
    source && (
      source.itemID ||
      source.entityID ||
      source.objectID ||
      source.stationID ||
      source.stargateID ||
      source.structureID
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

function getObjectPosition(source) {
  if (!source || typeof source !== "object") {
    return null;
  }
  if (source.position && typeof source.position === "object") {
    return normalizeVector(source.position);
  }
  if (source.spaceState && source.spaceState.position) {
    return normalizeVector(source.spaceState.position);
  }
  if (
    Number.isFinite(Number(source.x)) ||
    Number.isFinite(Number(source.y)) ||
    Number.isFinite(Number(source.z))
  ) {
    return normalizeVector(source);
  }
  return null;
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
  if (isMobileTractorUnitType(source)) {
    return "mobileTractorUnit";
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
  if (kind === "mobileTractorUnit") {
    return MOBILE_TRACTOR_UNIT_MIN_DISTANCE_FROM_OWN_GROUP_METERS;
  }
  if (kind === "stationStargateUpwell") {
    return MOBILE_TRACTOR_UNIT_MIN_DISTANCE_FROM_STATION_STARGATE_UPWELL_METERS;
  }
  if (kind === "controlTower") {
    return MOBILE_TRACTOR_UNIT_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS;
  }
  return 0;
}

function getPlacementConflictError(kind) {
  if (kind === "mobileTractorUnit") {
    return "MOBILE_TRACTOR_UNIT_TOO_CLOSE_TO_TRACTOR_UNIT";
  }
  if (kind === "stationStargateUpwell") {
    return "MOBILE_TRACTOR_UNIT_TOO_CLOSE_TO_STATION_STARGATE_OR_UPWELL";
  }
  if (kind === "controlTower") {
    return "MOBILE_TRACTOR_UNIT_TOO_CLOSE_TO_CONTROL_TOWER";
  }
  return "MOBILE_TRACTOR_UNIT_DEPLOYMENT_BLOCKED";
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
    source,
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
    append({
      ...structure,
      itemID: structure.structureID || structure.itemID,
    });
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
      errorMsg: "MOBILE_TRACTOR_UNIT_DEPLOY_POSITION_UNAVAILABLE",
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

function validateMobileTractorUnitLaunch(item, context) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileTractorUnitType(item)) {
    return "ITEM_NOT_MOBILE_TRACTOR_UNIT";
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

function getShipCargoCapacity(characterID, shipItem) {
  if (!shipItem) {
    return 0;
  }
  const resourceState = buildShipResourceState(characterID, shipItem);
  return Math.max(0, toReal(resourceState && resourceState.cargoCapacity, 0));
}

function getShipFlagUsedVolume(ownerID, shipID, flagID, excludedItemID = 0) {
  return listContainerItems(ownerID, shipID, flagID).reduce((sum, item) => {
    if (!item || toInt(item.itemID, 0) === excludedItemID) {
      return sum;
    }
    return sum + getItemMoveVolume(item) * getItemMoveQuantity(item);
  }, 0);
}

function validateMobileTractorUnitDestinationCargo(item, context) {
  const shipItem = findItemById(context.shipID);
  const capacity = getShipCargoCapacity(context.characterID, shipItem);
  const used = getShipFlagUsedVolume(
    context.characterID,
    context.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    item && item.itemID,
  );
  if (used + getItemMoveVolume(item) > capacity + 1e-7) {
    return "NOT_ENOUGH_CARGO_SPACE";
  }
  return null;
}

function validateMobileTractorUnitSpaceAccess(session, item, state, context, options = {}) {
  const rangeMeters = Math.max(
    0,
    toReal(options.rangeMeters, MOBILE_TRACTOR_UNIT_SCOOP_RANGE_METERS),
  );
  if (!context.characterID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileTractorUnitType(item)) {
    return "ITEM_NOT_MOBILE_TRACTOR_UNIT";
  }
  if (!state || state.tractorUnitID <= 0) {
    return "MOBILE_TRACTOR_UNIT_STATE_NOT_FOUND";
  }
  if (
    toInt(item.locationID, 0) !== context.systemID ||
    toInt(item.flagID, -1) !== 0 ||
    !item.spaceState
  ) {
    return "MOBILE_TRACTOR_UNIT_NOT_IN_SPACE";
  }
  if (
    toInt(item.ownerID, 0) !== context.characterID &&
    toInt(state.ownerID, 0) !== context.characterID &&
    toInt(state.deployerCharacterID, 0) !== context.characterID
  ) {
    return "MOBILE_TRACTOR_UNIT_NOT_OWNER";
  }
  const now = Date.now();
  if (state.active !== true && !(state.activateAtMs > 0 && state.activateAtMs <= now)) {
    return "MOBILE_TRACTOR_UNIT_NOT_ACTIVE";
  }

  const runtime = getSpaceRuntime();
  const shipEntity = runtime.getEntity(session, context.shipID);
  const tractorEntity = runtime.getEntity(session, item.itemID);
  const shipPosition = shipEntity && shipEntity.position;
  const tractorPosition =
    (tractorEntity && tractorEntity.position) ||
    (item.spaceState && item.spaceState.position);
  if (shipPosition && tractorPosition && getVectorDistance(shipPosition, tractorPosition) > rangeMeters) {
    return "TARGET_TOO_FAR";
  }

  return null;
}

function validateMobileTractorUnitScoop(session, item, state, context) {
  return validateMobileTractorUnitSpaceAccess(session, item, state, context, {
    rangeMeters: MOBILE_TRACTOR_UNIT_SCOOP_RANGE_METERS,
  });
}

function updateMobileTractorUnitState(itemID, updater) {
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
      errorMsg: "MOBILE_TRACTOR_UNIT_STATE_NOT_FOUND",
    };
  }
  const nextState =
    typeof updater === "function" ? updater({ ...currentState }, item) : updater;
  return updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    customInfo: buildCustomInfoWithState(currentItem.customInfo, nextState),
  }));
}

function clearTimers(tractorUnitID) {
  const normalizedTractorUnitID = toInt(tractorUnitID, 0);
  const timerState = timersByTractorUnitID.get(normalizedTractorUnitID);
  if (!timerState) {
    return;
  }
  if (timerState.activationTimer) {
    clearTimeout(timerState.activationTimer);
  }
  if (timerState.expiryTimer) {
    clearTimeout(timerState.expiryTimer);
  }
  timersByTractorUnitID.delete(normalizedTractorUnitID);
}

function setUnrefTimeout(callback, delayMs) {
  const timer = setTimeout(callback, Math.max(0, toInt(delayMs, 0)));
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

function clearMobileTractorUnit(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }
  clearTimers(itemID);

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileTractorUnitStateFromItem(item);
  if (!state) {
    return false;
  }

  if (findItemById(itemID)) {
    updateMobileTractorUnitState(itemID, (currentState) => ({
      ...currentState,
      active: false,
      deactivatedAtMs: Date.now(),
    }));
  }
  log.info(`[MobileTractorUnit] Cleared tractorUnit=${itemID} reason=${reason}`);
  return true;
}

function activateMobileTractorUnit(itemID) {
  const item = findItemById(itemID);
  const state = getMobileTractorUnitStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  const now = Date.now();
  if (state.expiresAtMs > 0 && state.expiresAtMs <= now) {
    expireMobileTractorUnit(itemID, "expired-before-activation");
    return false;
  }
  if (
    toInt(item.locationID, 0) !== state.solarSystemID ||
    toInt(item.flagID, 0) !== 0 ||
    !item.spaceState
  ) {
    clearMobileTractorUnit(item, "removed-before-activation");
    return false;
  }

  updateMobileTractorUnitState(itemID, (currentState) => ({
    ...currentState,
    active: true,
    activatedAtMs: now,
    nextCycleAtMs: now + Math.max(1, currentState.cycleTimeSeconds) * 1000,
  }));
  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, itemID);
  scheduleMobileTractorUnitTimers(itemID);
  log.info(
    `[MobileTractorUnit] Activated tractorUnit=${itemID} system=${state.solarSystemID}`,
  );
  return true;
}

function expireMobileTractorUnit(itemID, reason = "expired") {
  const item = findItemById(itemID);
  const state = getMobileTractorUnitStateFromItem(item);
  const systemID = toInt(
    state && state.solarSystemID,
    toInt(item && item.locationID, 0),
  );
  clearTimers(itemID);

  if (systemID > 0) {
    const destroyResult = getSpaceRuntime().destroyDynamicInventoryEntity(systemID, itemID);
    if (destroyResult && destroyResult.success) {
      log.info(`[MobileTractorUnit] Removed tractorUnit=${itemID} reason=${reason}`);
      return true;
    }
  }

  const removeResult = removeInventoryItem(itemID, { removeContents: true });
  if (removeResult.success) {
    log.info(`[MobileTractorUnit] Removed tractorUnit=${itemID} reason=${reason}`);
    return true;
  }
  return false;
}

function scheduleMobileTractorUnitTimers(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileTractorUnitStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  clearTimers(itemID);

  const now = Date.now();
  const nextTimers = {
    activationTimer: null,
    expiryTimer: null,
  };

  if (state.expiresAtMs > 0) {
    nextTimers.expiryTimer = setUnrefTimeout(
      () => expireMobileTractorUnit(itemID, "expired"),
      state.expiresAtMs - now,
    );
  }

  if (state.active || state.activateAtMs <= now) {
    if (!state.active) {
      nextTimers.activationTimer = setUnrefTimeout(
        () => activateMobileTractorUnit(itemID),
        0,
      );
    }
  } else {
    nextTimers.activationTimer = setUnrefTimeout(
      () => activateMobileTractorUnit(itemID),
      state.activateAtMs - now,
    );
  }

  timersByTractorUnitID.set(itemID, nextTimers);
  return true;
}

function registerMobileTractorUnitItem(itemOrID) {
  return scheduleMobileTractorUnitTimers(itemOrID);
}

function isActiveTractorUnitState(state, nowMs = Date.now()) {
  if (!state || state.deactivatedAtMs > 0) {
    return false;
  }
  if (state.expiresAtMs > 0 && state.expiresAtMs <= nowMs) {
    return false;
  }
  return state.active === true || (state.activateAtMs > 0 && state.activateAtMs <= nowMs);
}

function hydrateMobileTractorUnitEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isMobileTractorUnitType(itemRecord)) {
    return entity;
  }

  const state = getMobileTractorUnitStateFromItem(itemRecord);
  if (!state) {
    return entity;
  }

  const active = isActiveTractorUnitState(state, Date.now());
  entity.component_activate = [active, active ? null : state.activateAtMs];
  entity.activate_comp_durationSeconds = Math.trunc(
    MOBILE_TRACTOR_UNIT_ACTIVATION_DELAY_MS / 1000,
  );
  entity.component_decay = state.expiresAtMs > 0 ? state.expiresAtMs : null;
  entity.autoTractorBeamMaxRange = state.rangeMeters;
  entity.autoTractorBeamCycleTimeSeconds = state.cycleTimeSeconds;
  entity.autoTractorBeamMaxTractorVelocity = state.maxTractorVelocity;
  entity.cargoCapacity = state.holdCapacity;
  return entity;
}

function launchMobileTractorUnitFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateMobileTractorUnitLaunch(item, context);
  if (validationError) {
    return {
      success: false,
      errorMsg: validationError,
    };
  }

  const sourceTypeID = toInt(item.typeID, 0);
  const spawnState = buildDeployableSpawnState(session, context);
  const placementConflict = findPlacementConflict(session, item, context, spawnState);
  if (placementConflict) {
    log.info(
      `[MobileTractorUnit] Launch rejected char=${context.characterID} item=${item.itemID} system=${context.systemID} reason=${placementConflict.errorMsg}`,
    );
    return {
      success: false,
      errorMsg: placementConflict.errorMsg,
    };
  }

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
  const stats = resolveMobileTractorUnitStats(item);
  const state = {
    ownerID: context.ownerID,
    deployerCharacterID: context.characterID,
    solarSystemID: context.systemID,
    tractorUnitID: launchedItemID,
    deployedAtMs: now,
    activateAtMs: now + MOBILE_TRACTOR_UNIT_ACTIVATION_DELAY_MS,
    activatedAtMs: 0,
    expiresAtMs: now + MOBILE_TRACTOR_UNIT_LIFETIME_MS,
    active: false,
    deactivatedAtMs: 0,
    nextCycleAtMs: 0,
    lastCycleAtMs: 0,
    lastLootMoveAtMs: 0,
    lastTractorTargetID: 0,
    movedItemCount: 0,
    ...stats,
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
    { idType: "charid" },
  );

  const spawnResult = getSpaceRuntime().spawnDynamicInventoryEntity(context.systemID, launchedItemID);
  if (!spawnResult || !spawnResult.success) {
    log.warn(
      `[MobileTractorUnit] Launched tractor unit ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobileTractorUnitItem(updatedResult.data);
  log.info(
    `[MobileTractorUnit] char=${context.characterID} launched tractorUnit itemID=${launchedItemID} typeID=${sourceTypeID} system=${context.systemID}`,
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

function buildNearbyEjectedContainerSpawnState(tractorItem, tractorEntity, shipEntity) {
  const position =
    getObjectPosition(tractorEntity) ||
    getObjectPosition(tractorItem) ||
    getObjectPosition(shipEntity);
  if (!position) {
    return null;
  }
  const direction = normalizeDirection(
    (tractorEntity && tractorEntity.direction) ||
      (tractorItem && tractorItem.spaceState && tractorItem.spaceState.direction) ||
      (shipEntity && shipEntity.direction),
    { x: 1, y: 0, z: 0 },
  );
  const containerPosition = addVectors(
    position,
    scaleVector(direction, MOBILE_TRACTOR_UNIT_EJECTED_CONTAINER_DISTANCE_METERS),
  );
  return {
    systemID: toInt(tractorItem && tractorItem.locationID, 0),
    position: containerPosition,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: containerPosition,
    mode: "STOP",
    speedFraction: 0,
  };
}

function resolveEjectedCargoContainerType() {
  const result = resolveItemByName(CARGO_CONTAINER_NAME);
  return result && result.success ? result.match : null;
}

function ejectMobileTractorUnitContentsToContainer(session, item, state, context) {
  const contents = listContainerItems(null, item.itemID, null);
  if (contents.length === 0) {
    return {
      success: true,
      data: {
        containerID: 0,
        movedItemCount: 0,
      },
    };
  }

  const containerType = resolveEjectedCargoContainerType();
  if (!containerType) {
    return {
      success: false,
      errorMsg: "MOBILE_TRACTOR_UNIT_CONTENT_EJECTION_FAILED",
    };
  }

  const runtime = getSpaceRuntime();
  const tractorEntity = runtime.getEntity(session, item.itemID);
  const shipEntity = runtime.getEntity(session, context.shipID);
  const spawnState = buildNearbyEjectedContainerSpawnState(item, tractorEntity, shipEntity);
  if (!spawnState) {
    return {
      success: false,
      errorMsg: "MOBILE_TRACTOR_UNIT_CONTENT_EJECTION_FAILED",
    };
  }

  const now = Date.now();
  const ownerID = toInt(state && state.ownerID, context.characterID);
  const createResult = createSpaceItemForOwner(ownerID, context.systemID, containerType, {
    ...spawnState,
    itemName: CARGO_CONTAINER_NAME,
    createdAtMs: now,
    expiresAtMs: now + MOBILE_TRACTOR_UNIT_EJECTED_CONTAINER_LIFETIME_MS,
  });
  if (!createResult.success || !createResult.data) {
    return {
      success: false,
      errorMsg: createResult.errorMsg || "MOBILE_TRACTOR_UNIT_CONTENT_EJECTION_FAILED",
    };
  }

  const containerItem = createResult.data;
  syncChangesExceptItem(session, createResult.changes || [], 0);

  let movedItemCount = 0;
  for (const contentItem of contents) {
    const moveResult = moveItemToLocation(
      contentItem.itemID,
      containerItem.itemID,
      ITEM_FLAGS.HANGAR,
    );
    if (!moveResult.success) {
      log.warn(
        `[MobileTractorUnit] Failed to eject content item=${contentItem.itemID} from tractorUnit=${item.itemID} to container=${containerItem.itemID}: ${moveResult.errorMsg}`,
      );
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "MOBILE_TRACTOR_UNIT_CONTENT_EJECTION_FAILED",
      };
    }
    movedItemCount += 1;
    syncChangesExceptItem(session, moveResult.data && moveResult.data.changes, 0);
  }

  const spawnResult = runtime.spawnDynamicInventoryEntity(context.systemID, containerItem.itemID);
  if (!spawnResult || !spawnResult.success) {
    log.warn(
      `[MobileTractorUnit] Ejected container ${containerItem.itemID} was created but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  return {
    success: true,
    data: {
      containerID: containerItem.itemID,
      movedItemCount,
    },
  };
}

function scoopMobileTractorUnitToCargo(session, itemID) {
  const context = getSessionContext(session, { ownerID: 0 });
  const item = findItemById(itemID);
  const state = getMobileTractorUnitStateFromItem(item);
  const validationError = validateMobileTractorUnitScoop(session, item, state, context);
  if (validationError) {
    return {
      success: false,
      errorMsg: validationError,
    };
  }

  const destinationValidationError = validateMobileTractorUnitDestinationCargo(item, context);
  if (destinationValidationError) {
    return {
      success: false,
      errorMsg: destinationValidationError,
    };
  }

  const ejectionResult = ejectMobileTractorUnitContentsToContainer(
    session,
    item,
    state,
    context,
  );
  if (!ejectionResult.success) {
    return ejectionResult;
  }

  const updateResult = updateInventoryItem(item.itemID, (currentItem) => ({
    ...currentItem,
    ownerID: context.characterID,
    locationID: context.shipID,
    flagID: ITEM_FLAGS.CARGO_HOLD,
    singleton: 1,
    expiresAtMs: null,
    spaceRadius: null,
    spaceState: null,
    customInfo: buildCustomInfoWithoutState(currentItem.customInfo),
  }));
  if (!updateResult.success || !updateResult.data) {
    return updateResult;
  }

  syncInventoryChange(
    session,
    updateResult.data,
    updateResult.previousData || item,
    {
      idType: "charid",
      locationContext: ["Ship", context.shipID, "ShipCargo"],
    },
  );

  clearTimers(item.itemID);
  const removeResult = getSpaceRuntime().removeDynamicEntity(context.systemID, item.itemID, {
    persistSpaceState: false,
  });
  if (!removeResult || !removeResult.success) {
    return {
      success: false,
      errorMsg: removeResult ? removeResult.errorMsg : "DYNAMIC_ENTITY_NOT_FOUND",
    };
  }

  log.info(
    `[MobileTractorUnit] char=${context.characterID} scooped tractorUnit itemID=${item.itemID} system=${context.systemID} ship=${context.shipID} ejectedContainer=${ejectionResult.data.containerID || 0} movedItems=${ejectionResult.data.movedItemCount || 0}`,
  );

  return {
    success: true,
    response: true,
    data: {
      itemID: item.itemID,
      ejectedContainerID: ejectionResult.data.containerID || 0,
      movedItemCount: ejectionResult.data.movedItemCount || 0,
    },
  };
}

function getItemMoveVolume(item) {
  const metadata = getItemMetadata(item && item.typeID) || {};
  return Math.max(
    0,
    firstFiniteReal([item && item.volume, metadata.volume], 0),
  );
}

function getItemMoveQuantity(item) {
  return toInt(item && item.singleton, 0) === 1
    ? 1
    : Math.max(0, toInt(item && (item.stacksize ?? item.quantity), 0));
}

function getContainerUsedVolume(locationID) {
  return listContainerItems(null, locationID, MOBILE_TRACTOR_UNIT_CARGO_FLAG_ID).reduce((sum, item) => (
    sum + getItemMoveVolume(item) * getItemMoveQuantity(item)
  ), 0);
}

function getMoveQuantityForFreeVolume(item, freeVolume) {
  const quantity = getItemMoveQuantity(item);
  if (quantity <= 0) {
    return 0;
  }
  if (toInt(item && item.singleton, 0) === 1) {
    return getItemMoveVolume(item) <= freeVolume + 1e-7 ? 1 : 0;
  }

  const unitVolume = getItemMoveVolume(item);
  if (unitVolume <= 0) {
    return quantity;
  }
  return Math.max(0, Math.min(quantity, Math.floor((freeVolume + 1e-7) / unitVolume)));
}

function isTractorableTarget(entity) {
  return Boolean(
    entity &&
      toInt(entity.itemID, 0) > 0 &&
      (entity.kind === "container" || entity.kind === "wreck")
  );
}

function hasTargetLoot(entity) {
  const targetID = toInt(entity && entity.itemID, 0);
  if (!targetID) {
    return false;
  }
  if (entity && entity.nativeNpcWreck === true) {
    return nativeNpcStore.listNativeWreckItemsForWreck(targetID).length > 0;
  }
  return listContainerItems(null, targetID, null).length > 0;
}

function getEntitySurfaceDistance(left, right) {
  const centerDistance = getVectorDistance(left && left.position, right && right.position);
  const leftRadius = Math.max(0, toReal(left && left.radius, 0));
  const rightRadius = Math.max(0, toReal(right && right.radius, 0));
  return Math.max(0, centerDistance - leftRadius - rightRadius);
}

function findNearestLootTarget(scene, tractorEntity, state) {
  const rangeMeters = Math.max(0, toReal(state && state.rangeMeters, 0));
  if (!scene || !tractorEntity || rangeMeters <= 0) {
    return null;
  }
  const candidates = typeof scene.getDynamicEntities === "function"
    ? scene.getDynamicEntities()
    : [];
  let nearest = null;
  for (const entity of candidates) {
    if (
      !isTractorableTarget(entity) ||
      toInt(entity.itemID, 0) === toInt(tractorEntity.itemID, 0) ||
      !hasTargetLoot(entity)
    ) {
      continue;
    }
    const surfaceDistance = getEntitySurfaceDistance(tractorEntity, entity);
    if (surfaceDistance > rangeMeters + 1e-7) {
      continue;
    }
    if (!nearest || surfaceDistance < nearest.surfaceDistance) {
      nearest = {
        entity,
        surfaceDistance,
      };
    }
  }
  return nearest;
}

function transferInventoryTargetLootToMtu(targetEntity, tractorUnitID, ownerID, holdCapacity) {
  const targetID = toInt(targetEntity && targetEntity.itemID, 0);
  const changes = [];
  let freeVolume = Math.max(0, toReal(holdCapacity, 0) - getContainerUsedVolume(tractorUnitID));
  let movedItemCount = 0;

  const contents = listContainerItems(null, targetID, null)
    .sort((left, right) => toInt(left.itemID, 0) - toInt(right.itemID, 0));
  for (const item of contents) {
    const moveQuantity = getMoveQuantityForFreeVolume(item, freeVolume);
    if (moveQuantity <= 0) {
      continue;
    }
    const moveResult = transferItemToOwnerLocation(
      item.itemID,
      ownerID,
      tractorUnitID,
      MOBILE_TRACTOR_UNIT_CARGO_FLAG_ID,
      moveQuantity,
    );
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "MOBILE_TRACTOR_UNIT_LOOT_TRANSFER_FAILED",
        changes,
        movedItemCount,
      };
    }
    movedItemCount += 1;
    changes.push(...((moveResult.data && moveResult.data.changes) || []));
    freeVolume -= getItemMoveVolume(item) * moveQuantity;
  }

  return {
    success: true,
    changes,
    movedItemCount,
  };
}

function transferNativeTargetLootToMtu(targetEntity, tractorUnitID, ownerID, holdCapacity) {
  const wreckID = toInt(targetEntity && targetEntity.itemID, 0);
  const changes = [];
  let freeVolume = Math.max(0, toReal(holdCapacity, 0) - getContainerUsedVolume(tractorUnitID));
  let movedItemCount = 0;

  const contents = nativeNpcStore.listNativeWreckItemsForWreck(wreckID)
    .sort((left, right) => toInt(left.wreckItemID, 0) - toInt(right.wreckItemID, 0));
  for (const itemRecord of contents) {
    const itemLike = {
      itemID: itemRecord && itemRecord.wreckItemID,
      typeID: itemRecord && itemRecord.typeID,
      quantity: itemRecord && itemRecord.quantity,
      stacksize: itemRecord && itemRecord.quantity,
      singleton: itemRecord && itemRecord.singleton === true ? 1 : 0,
      volume: itemRecord && itemRecord.volume,
    };
    const moveQuantity = getMoveQuantityForFreeVolume(itemLike, freeVolume);
    if (moveQuantity <= 0) {
      continue;
    }
    const moveResult = getNativeNpcWreckService().transferNativeWreckItemToCharacterLocation({
      characterID: ownerID,
      wreckID,
      wreckItemID: itemRecord.wreckItemID,
      destinationLocationID: tractorUnitID,
      destinationFlagID: MOBILE_TRACTOR_UNIT_CARGO_FLAG_ID,
      quantity: moveQuantity,
    });
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "MOBILE_TRACTOR_UNIT_LOOT_TRANSFER_FAILED",
        changes,
        movedItemCount,
      };
    }
    movedItemCount += 1;
    changes.push(...((moveResult.data && moveResult.data.changes) || []));
    freeVolume -= getItemMoveVolume(itemLike) * moveQuantity;
  }

  return {
    success: true,
    changes,
    movedItemCount,
  };
}

function getSceneMovementStamp(scene, nowMs) {
  if (scene && typeof scene.getMovementStamp === "function") {
    return scene.getMovementStamp(nowMs);
  }
  if (scene && typeof scene.getCurrentDestinyStamp === "function") {
    return scene.getCurrentDestinyStamp();
  }
  return 0;
}

function getSceneFileTime(scene, nowMs) {
  if (scene && typeof scene.toFileTimeFromSimMs === "function") {
    return scene.toFileTimeFromSimMs(nowMs);
  }
  if (scene && typeof scene.getCurrentFileTime === "function") {
    return scene.getCurrentFileTime();
  }
  return BigInt(Date.now()) * 10000n + 116444736000000000n;
}

function broadcastMobileTractorUnitTractorStart(scene, entity, targetEntity, state, nowMs) {
  if (!scene || !entity || !targetEntity) {
    return null;
  }
  const stamp = getSceneMovementStamp(scene, nowMs);
  const startTime = getSceneFileTime(scene, nowMs);
  const tractorVelocity = Math.max(
    0,
    toReal(state && state.maxTractorVelocity, MOBILE_TRACTOR_UNIT_DEFAULT_MAX_TRACTOR_VELOCITY),
  );

  targetEntity.mass = TRACTOR_BEAM_TARGET_MASS;
  targetEntity.maxVelocity = tractorVelocity;
  targetEntity.speedFraction = 1;
  targetEntity.mode = "FOLLOW";
  targetEntity.targetEntityID = entity.itemID;
  targetEntity.followRange = TRACTOR_BEAM_FOLLOW_RANGE_METERS;

  if (typeof scene.broadcastMovementUpdates === "function") {
    scene.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildOnSpecialFXPayload(entity.itemID, TRACTOR_BEAM_EFFECT_GUID, {
          moduleID: entity.itemID,
          moduleTypeID: entity.typeID,
          targetID: targetEntity.itemID,
          isOffensive: false,
          start: true,
          active: true,
          duration: TRACTOR_BEAM_EFFECT_DURATION_MS,
          repeat: TRACTOR_BEAM_EFFECT_REPEAT,
          startTime,
          timeFromStart: 0,
        }),
      },
      {
        stamp,
        payload: destiny.buildSetMaxSpeedPayload(targetEntity.itemID, tractorVelocity),
      },
      {
        stamp,
        payload: destiny.buildSetBallFreePayload(targetEntity.itemID, true),
      },
      {
        stamp,
        payload: destiny.buildSetBallMassPayload(targetEntity.itemID, TRACTOR_BEAM_TARGET_MASS),
      },
      {
        stamp,
        payload: destiny.buildSetMaxSpeedPayload(targetEntity.itemID, tractorVelocity),
      },
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(targetEntity.itemID, 1),
      },
      {
        stamp,
        payload: destiny.buildFollowBallPayload(
          targetEntity.itemID,
          entity.itemID,
          TRACTOR_BEAM_FOLLOW_RANGE_METERS,
        ),
      },
    ]);
  }

  if (typeof scene.persistDynamicEntity === "function") {
    scene.persistDynamicEntity(targetEntity);
  }

  const godmaEffect = buildGodmaShipEffectEvent(
    entity.itemID,
    state && state.ownerID,
    entity.itemID,
    TRACTOR_BEAM_GODMA_EFFECT_ID,
    startTime,
    {
      isStart: true,
      shouldStart: true,
      targetID: targetEntity.itemID,
      effectStartTime: startTime,
      duration: TRACTOR_BEAM_EFFECT_DURATION_MS,
      repeat: TRACTOR_BEAM_EFFECT_REPEAT,
    },
  );
  const velocityChange = buildModuleAttributeChangeEvent(
    state && state.ownerID,
    targetEntity.itemID,
    TRACTOR_TARGET_MAX_SPEED_ATTRIBUTE_ID,
    tractorVelocity,
    tractorVelocity,
    startTime,
  );
  for (const session of listInterestedSessions(scene, [state.ownerID, state.deployerCharacterID])) {
    sendOnMultiEventPairs(session, [
      { event: godmaEffect, time: startTime },
      { event: velocityChange, time: startTime },
    ]);
  }

  return {
    startTime,
  };
}

function broadcastMobileTractorUnitTractorStop(scene, entity, targetEntity, presentationState) {
  if (!scene || !entity || !targetEntity || typeof scene.broadcastSpecialFx !== "function") {
    return false;
  }
  scene.broadcastSpecialFx(entity.itemID, TRACTOR_BEAM_EFFECT_GUID, {
    moduleID: entity.itemID,
    moduleTypeID: entity.typeID,
    targetID: targetEntity.itemID,
    isOffensive: false,
    start: false,
    active: true,
    duration: TRACTOR_BEAM_EFFECT_DURATION_MS,
    repeat: TRACTOR_BEAM_EFFECT_REPEAT,
    startTime: presentationState && presentationState.startTime,
    timeFromStart: 0,
  }, entity);
  return true;
}

function processMobileTractorUnitCycle(scene, entity, item, state, nowMs) {
  const target = findNearestLootTarget(scene, entity, state);
  const targetEntity = target && target.entity ? target.entity : null;
  const tractorPresentation =
    targetEntity
      ? broadcastMobileTractorUnitTractorStart(scene, entity, targetEntity, state, nowMs)
      : null;
  let transferResult = {
    success: true,
    changes: [],
    movedItemCount: 0,
  };

  if (targetEntity) {
    transferResult = targetEntity.nativeNpcWreck === true
      ? transferNativeTargetLootToMtu(
        targetEntity,
        state.tractorUnitID,
        state.ownerID,
        state.holdCapacity,
      )
      : transferInventoryTargetLootToMtu(
        targetEntity,
        state.tractorUnitID,
        state.ownerID,
        state.holdCapacity,
      );
    if (!transferResult.success) {
      log.warn(
        `[MobileTractorUnit] Loot cycle failed tractorUnit=${state.tractorUnitID} target=${targetEntity.itemID} error=${transferResult.errorMsg}`,
      );
    }
  }

  const cycleMs = Math.max(1, toReal(state.cycleTimeSeconds, MOBILE_TRACTOR_UNIT_CYCLE_TIME_SECONDS)) * 1000;
  updateMobileTractorUnitState(state.tractorUnitID, (currentState) => ({
    ...currentState,
    lastCycleAtMs: nowMs,
    lastLootMoveAtMs:
      transferResult.movedItemCount > 0 ? nowMs : toInt(currentState.lastLootMoveAtMs, 0),
    lastTractorTargetID: targetEntity ? toInt(targetEntity.itemID, 0) : 0,
    movedItemCount:
      toInt(currentState.movedItemCount, 0) + toInt(transferResult.movedItemCount, 0),
    nextCycleAtMs: nowMs + cycleMs,
  }));

  if (transferResult.changes.length > 0) {
    syncInventoryChangesToInterestedSessions(
      scene,
      [state.ownerID, state.deployerCharacterID],
      transferResult.changes,
      { idType: "shipid" },
    );
    if (scene && typeof scene.refreshInventoryBackedEntityPresentation === "function") {
      scene.refreshInventoryBackedEntityPresentation(state.tractorUnitID, { broadcast: true });
      if (targetEntity && targetEntity.nativeNpcWreck !== true) {
        scene.refreshInventoryBackedEntityPresentation(targetEntity.itemID, { broadcast: true });
      }
    }
    if (targetEntity && targetEntity.nativeNpcWreck === true) {
      getNativeNpcWreckService().refreshNativeWreckRuntimeEntity(
        state.solarSystemID,
        targetEntity.itemID,
      );
    }
    if (targetEntity && targetEntity.nativeNpcWreck !== true) {
      const cleanupSession = listInterestedSessions(scene, [state.ownerID, state.deployerCharacterID])[0];
      getMaybeExpireEmptySpaceContainer()(cleanupSession, targetEntity.itemID);
    }
  }

  if (targetEntity && tractorPresentation) {
    broadcastMobileTractorUnitTractorStop(scene, entity, targetEntity, tractorPresentation);
  }

  return transferResult;
}

function tickScene(scene, nowMs = Date.now()) {
  if (!scene || typeof scene.getDynamicEntities !== "function") {
    return;
  }
  for (const entity of scene.getDynamicEntities()) {
    if (!entity || entity.kind !== "deployable" || !isMobileTractorUnitType(entity)) {
      continue;
    }
    const item = findItemById(entity.itemID);
    const state = getMobileTractorUnitStateFromItem(item);
    if (!state) {
      continue;
    }
    if (state.expiresAtMs > 0 && state.expiresAtMs <= nowMs) {
      expireMobileTractorUnit(state.tractorUnitID, "expired");
      continue;
    }
    if (!isActiveTractorUnitState(state, nowMs)) {
      continue;
    }
    if (state.active !== true) {
      activateMobileTractorUnit(state.tractorUnitID);
      continue;
    }
    if (state.nextCycleAtMs > 0 && state.nextCycleAtMs > nowMs) {
      continue;
    }
    processMobileTractorUnitCycle(scene, entity, item, state, nowMs);
  }
}

module.exports = {
  CATEGORY_DEPLOYABLE,
  GROUP_MOBILE_TRACTOR_UNIT,
  MOBILE_TRACTOR_UNIT_ACTIVATION_DELAY_MS,
  MOBILE_TRACTOR_UNIT_LIFETIME_MS,
  MOBILE_TRACTOR_UNIT_CYCLE_TIME_SECONDS,
  MOBILE_TRACTOR_UNIT_DEFAULT_RANGE_METERS,
  MOBILE_TRACTOR_UNIT_SCOOP_RANGE_METERS,
  isMobileTractorUnitType,
  launchMobileTractorUnitFromShip,
  scoopMobileTractorUnitToCargo,
  registerMobileTractorUnitItem,
  clearMobileTractorUnit,
  getMobileTractorUnitStateFromItem,
  hydrateMobileTractorUnitEntityFromInventoryItem,
  tickScene,
  _testing: {
    buildDeployableSpawnState,
    buildCustomInfoWithState,
    buildCustomInfoWithoutState,
    getStateFromCustomInfo,
    findPlacementConflict,
    resolveMobileTractorUnitStats,
    validateMobileTractorUnitScoop,
    getMoveQuantityForFreeVolume,
    findNearestLootTarget,
    processMobileTractorUnitCycle,
  },
};
