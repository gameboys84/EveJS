const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  getItemMetadata,
  listContainerItems,
  listSystemSpaceItems,
  removeInventoryItem,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildShipResourceState,
  getShipBaseAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const worldData = require(path.join(__dirname, "../../space/worldData"));

const CATEGORY_STATION = 3;
const CATEGORY_DEPLOYABLE = 22;
const CATEGORY_STARBASE = 23;
const GROUP_STARGATE = 10;
const GROUP_CONTROL_TOWER = 365;
const GROUP_MOBILE_DEPOT = 1246;
const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_DEPOT_MIN_DISTANCE_FROM_OWN_GROUP_METERS = 6_000;
const MOBILE_DEPOT_MIN_DISTANCE_FROM_STATION_OR_STARGATE_METERS = 50_000;
const MOBILE_DEPOT_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS = 40_000;
const MOBILE_DEPOT_CARGO_ACCESS_RANGE_METERS = 2_500;
const MOBILE_DEPOT_FITTING_RANGE_METERS = 3_000;
const MOBILE_DEPOT_ACTIVATION_DELAY_MS = 60 * 1000;
const MOBILE_DEPOT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MOBILE_DEPOT_REINFORCE_DURATION_MS = 48 * 60 * 60 * 1000;
const MOBILE_DEPOT_REINFORCE_SHIELD_THRESHOLD = 0.25;
const MOBILE_DEPOT_HOLD_CAPACITY_ATTRIBUTE = "specialMobileDepotHoldCapacity";
const CUSTOM_INFO_KEY = "evejsMobileDepot";
const MAX_SAFE_TIMEOUT_DELAY_MS = 2 ** 31 - 1;

const timersByDepotID = new Map();

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toReal(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clampRatio(value, fallback = 0) {
  return Math.min(Math.max(toReal(value, fallback), 0), 1);
}

function round6(value) {
  return Number(toReal(value, 0).toFixed(6));
}

function normalizeConditionState(conditionState) {
  const source =
    conditionState && typeof conditionState === "object"
      ? conditionState
      : {};
  return {
    ...source,
    damage: clampRatio(source.damage, 0),
    charge: clampRatio(source.charge, 1),
    armorDamage: clampRatio(source.armorDamage, 0),
    shieldCharge: clampRatio(source.shieldCharge, 1),
    incapacitated: Boolean(source.incapacitated),
  };
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

function getEmitItemsChangedForSession() {
  const characterState = require(path.join(__dirname, "../character/characterState"));
  return characterState.emitItemsChangedForSession;
}

function isMobileDepotDeployableType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_DEPLOYABLE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_MOBILE_DEPOT
    );
  }

  const typeID = toInt(typeIDOrItem, 0);
  return typeID === 33474 || typeID === 33520 || typeID === 33522;
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
    // Keep opaque legacy text by nesting it instead of throwing it away.
  }
  return {
    legacyCustomInfo: text,
  };
}

function normalizeMobileDepotState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }
  return {
    ownerID: toInt(state.ownerID, 0),
    deployerCharacterID: toInt(state.deployerCharacterID, 0),
    sourceShipID: toInt(state.sourceShipID, 0),
    solarSystemID: toInt(state.solarSystemID, 0),
    depotID: toInt(state.depotID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
    reinforced: state.reinforced === true,
    reinforcedAtMs: toInt(state.reinforcedAtMs, 0),
    reinforcedUntilMs: toInt(state.reinforcedUntilMs, 0),
    reinforcementExitedAtMs: toInt(state.reinforcementExitedAtMs, 0),
  };
}

function getStateFromCustomInfo(customInfo) {
  const parsed = parseCustomInfo(customInfo);
  const state = parsed && parsed[CUSTOM_INFO_KEY];
  return normalizeMobileDepotState(state);
}

function getMobileDepotStateFromItem(item) {
  if (!item || !isMobileDepotDeployableType(item)) {
    return null;
  }
  const state =
    normalizeMobileDepotState(item.mobileDepotState) ||
    getStateFromCustomInfo(item.customInfo);
  if (!state || state.depotID <= 0) {
    return null;
  }
  return state;
}

function buildClientCustomInfoForShip(shipID) {
  const normalizedShipID = toInt(shipID, 0);
  return normalizedShipID > 0 ? [normalizedShipID, null] : undefined;
}

function buildCustomInfoWithState(customInfo, state) {
  const parsed = parseCustomInfo(customInfo);
  parsed[CUSTOM_INFO_KEY] = normalizeMobileDepotState(state);
  return JSON.stringify(parsed);
}

function buildCustomInfoWithoutState(customInfo) {
  const parsed = parseCustomInfo(customInfo);
  delete parsed[CUSTOM_INFO_KEY];
  return Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : "";
}

function updateMobileDepotState(itemID, updater) {
  const item = findItemById(itemID);
  if (!item) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const currentState = getMobileDepotStateFromItem(item);
  if (!currentState) {
    return {
      success: false,
      errorMsg: "MOBILE_DEPOT_STATE_NOT_FOUND",
    };
  }

  const nextState =
    typeof updater === "function" ? updater({ ...currentState }, item) : updater;
  const normalizedNextState = normalizeMobileDepotState(nextState);
  return updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    mobileDepotState: normalizedNextState,
    clientCustomInfo:
      buildClientCustomInfoForShip(normalizedNextState && normalizedNextState.sourceShipID) ??
      currentItem.clientCustomInfo,
    customInfo: buildCustomInfoWithoutState(currentItem.customInfo),
  }));
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

function isMobileDepotReinforcedState(state, nowMs = Date.now()) {
  if (!state || state.reinforced !== true) {
    return false;
  }
  const reinforcedUntilMs = toInt(state.reinforcedUntilMs, 0);
  return reinforcedUntilMs > 0 && reinforcedUntilMs > toInt(nowMs, Date.now());
}

function isMobileDepotReinforced(itemOrState, nowMs = Date.now()) {
  const state =
    itemOrState && typeof itemOrState === "object" && itemOrState.depotID
      ? itemOrState
      : getMobileDepotStateFromItem(itemOrState);
  return isMobileDepotReinforcedState(state, nowMs);
}

function isMobileDepotEntityReinforced(entity, nowMs = Date.now()) {
  if (!entity || !isMobileDepotDeployableType(entity)) {
    return false;
  }
  const item = findItemById(entity.itemID);
  return isMobileDepotReinforced(item, nowMs);
}

function adjustDamageResultForReinforcement(damageResult, nextConditionState) {
  if (!damageResult || damageResult.success !== true || !damageResult.data) {
    return;
  }
  const data = damageResult.data;
  const maxLayers = data.maxLayers || {};
  const beforeLayers = data.beforeLayers || {};
  const afterShield = round6(
    Math.max(0, toReal(maxLayers.shield, 0)) * MOBILE_DEPOT_REINFORCE_SHIELD_THRESHOLD,
  );
  data.destroyed = false;
  data.afterConditionState = {
    ...nextConditionState,
  };
  data.afterLayers = {
    shield: afterShield,
    armor: round6(beforeLayers.armor),
    structure: round6(beforeLayers.structure),
  };
  if (Array.isArray(data.perLayer)) {
    data.perLayer = data.perLayer.map((entry) => {
      if (!entry || entry.layer === "shield") {
        const beforeHP = round6(entry && entry.beforeHP);
        return {
          ...(entry || { layer: "shield" }),
          beforeHP,
          afterHP: afterShield,
          appliedEffective: round6(Math.max(0, beforeHP - afterShield)),
        };
      }
      if (entry.layer === "armor") {
        return {
          ...entry,
          afterHP: round6(beforeLayers.armor),
          appliedEffective: 0,
        };
      }
      if (entry.layer === "structure") {
        return {
          ...entry,
          afterHP: round6(beforeLayers.structure),
          appliedEffective: 0,
        };
      }
      return entry;
    });
  }
}

function shouldEnterReinforcementFromDamage(damageResult) {
  if (!damageResult || damageResult.success !== true || !damageResult.data) {
    return false;
  }
  const beforeConditionState = normalizeConditionState(damageResult.data.beforeConditionState);
  const afterConditionState = normalizeConditionState(damageResult.data.afterConditionState);
  const beforeShield = beforeConditionState.shieldCharge;
  const afterShield = afterConditionState.shieldCharge;
  return (
    beforeShield + 1e-6 >= MOBILE_DEPOT_REINFORCE_SHIELD_THRESHOLD &&
    afterShield <= MOBILE_DEPOT_REINFORCE_SHIELD_THRESHOLD + 1e-6 &&
    afterShield < beforeShield - 1e-6
  );
}

function getItemMoveVolume(item) {
  const metadata = getItemMetadata(item && item.typeID) || {};
  return Math.max(
    0,
    toReal(item && item.volume, toReal(metadata.volume, 0)),
  );
}

function getShipMobileDepotHoldCapacity(shipItem) {
  return Math.max(
    0,
    toReal(
      getShipBaseAttributeValue(
        shipItem && shipItem.typeID,
        MOBILE_DEPOT_HOLD_CAPACITY_ATTRIBUTE,
      ),
      0,
    ),
  );
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
    const units = toInt(item.singleton, 0) === 1
      ? 1
      : Math.max(0, toReal(item.stacksize ?? item.quantity, 0));
    return sum + getItemMoveVolume(item) * units;
  }, 0);
}

function validateMobileDepotDestinationFlag(item, context, destinationFlagID) {
  const shipItem = findItemById(context.shipID);

  if (destinationFlagID === ITEM_FLAGS.CARGO_HOLD) {
    const capacity = getShipCargoCapacity(context.characterID, shipItem);
    const used = getShipFlagUsedVolume(
      context.characterID,
      context.shipID,
      destinationFlagID,
      item && item.itemID,
    );
    if (used + getItemMoveVolume(item) > capacity + 1e-7) {
      return "NOT_ENOUGH_CARGO_SPACE";
    }
    return null;
  }

  if (destinationFlagID !== ITEM_FLAGS.MOBILE_DEPOT_HOLD) {
    return "INVALID_DESTINATION_FLAG";
  }

  const capacity = getShipMobileDepotHoldCapacity(shipItem);
  if (capacity <= 0) {
    return "MOBILE_DEPOT_HOLD_NOT_AVAILABLE";
  }

  const used = getShipFlagUsedVolume(
    context.characterID,
    context.shipID,
    destinationFlagID,
    item && item.itemID,
  );
  if (used + getItemMoveVolume(item) > capacity + 1e-7) {
    return "NOT_ENOUGH_MOBILE_DEPOT_HOLD_SPACE";
  }

  return null;
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

function getObjectItemID(source) {
  return toInt(
    source && (
      source.itemID ||
      source.stationID ||
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
  if (isMobileDepotDeployableType(source)) {
    return "mobileDepot";
  }

  const typeID = getObjectTypeID(source);
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  const groupID = toInt(source && source.groupID, toInt(metadata.groupID, 0));
  const categoryID = toInt(source && source.categoryID, toInt(metadata.categoryID, 0));

  if (groupID === GROUP_STARGATE || categoryID === CATEGORY_STATION) {
    return "stationOrStargate";
  }
  if (groupID === GROUP_CONTROL_TOWER || categoryID === CATEGORY_STARBASE) {
    return "controlTower";
  }
  return null;
}

function getPlacementBlockerMinimumDistance(kind) {
  if (kind === "mobileDepot") {
    return MOBILE_DEPOT_MIN_DISTANCE_FROM_OWN_GROUP_METERS;
  }
  if (kind === "stationOrStargate") {
    return MOBILE_DEPOT_MIN_DISTANCE_FROM_STATION_OR_STARGATE_METERS;
  }
  if (kind === "controlTower") {
    return MOBILE_DEPOT_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS;
  }
  return 0;
}

function getPlacementConflictError(kind) {
  if (kind === "mobileDepot") {
    return "MOBILE_DEPOT_TOO_CLOSE_TO_DEPOT";
  }
  if (kind === "stationOrStargate") {
    return "MOBILE_DEPOT_TOO_CLOSE_TO_STATION_OR_STARGATE";
  }
  if (kind === "controlTower") {
    return "MOBILE_DEPOT_TOO_CLOSE_TO_CONTROL_TOWER";
  }
  return "MOBILE_DEPOT_DEPLOYMENT_BLOCKED";
}

function appendMobileDepotPlacementBlocker(blockers, seenKeys, source, options = {}) {
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
  const groupID = toInt(source && source.groupID, toInt(metadata.groupID, 0));
  const categoryID = toInt(source && source.categoryID, toInt(metadata.categoryID, 0));
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
    groupID,
    categoryID,
    position,
    radius: getObjectPlacementRadius(source, metadata),
    minimumDistance,
    errorMsg: getPlacementConflictError(kind),
  });
}

function collectMobileDepotPlacementBlockers(session, context, options = {}) {
  const blockers = [];
  const seenKeys = new Set();
  const systemID = toInt(context && context.systemID, 0);
  if (systemID <= 0) {
    return blockers;
  }

  const append = (source, kind = null) => appendMobileDepotPlacementBlocker(
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
      "stationOrStargate",
    );
  }

  for (const stargate of worldData.getStargatesForSystem(systemID)) {
    append(stargate, "stationOrStargate");
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

function findMobileDepotPlacementConflict(session, item, context, spawnState) {
  const deployPosition = getObjectPosition(spawnState);
  if (!deployPosition) {
    return {
      errorMsg: "MOBILE_DEPOT_DEPLOY_POSITION_UNAVAILABLE",
    };
  }

  const typeID = getObjectTypeID(item);
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  const deployedRadius = getObjectPlacementRadius(item, metadata);
  const blockers = collectMobileDepotPlacementBlockers(session, context, {
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

function validateMobileDepotLaunch(item, context) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileDepotDeployableType(item)) {
    return "ITEM_NOT_MOBILE_DEPOT";
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    ![ITEM_FLAGS.CARGO_HOLD, ITEM_FLAGS.MOBILE_DEPOT_HOLD].includes(toInt(item.flagID, 0))
  ) {
    return "ITEM_NOT_IN_SHIP_CARGO";
  }
  return null;
}

function validateMobileDepotSpaceAccess(
  session,
  item,
  state,
  context,
  options = {},
) {
  const rangeMeters = Math.max(
    0,
    toReal(options.rangeMeters, DEPLOY_DISTANCE_METERS),
  );
  if (!context.characterID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileDepotDeployableType(item)) {
    return "ITEM_NOT_MOBILE_DEPOT";
  }
  if (!state || state.depotID <= 0) {
    return "MOBILE_DEPOT_STATE_NOT_FOUND";
  }
  if (
    toInt(item.locationID, 0) !== context.systemID ||
    toInt(item.flagID, -1) !== 0 ||
    !item.spaceState
  ) {
    return "MOBILE_DEPOT_NOT_IN_SPACE";
  }
  if (
    toInt(item.ownerID, 0) !== context.characterID &&
    toInt(state.ownerID, 0) !== context.characterID &&
    toInt(state.deployerCharacterID, 0) !== context.characterID
  ) {
    return "MOBILE_DEPOT_NOT_OWNER";
  }
  const now = Date.now();
  if (state.active !== true && !(state.activateAtMs > 0 && state.activateAtMs <= now)) {
    return "MOBILE_DEPOT_NOT_ACTIVE";
  }
  if (options.disallowReinforced === true && isMobileDepotReinforcedState(state, now)) {
    return "MOBILE_DEPOT_REINFORCED";
  }

  const runtime = getSpaceRuntime();
  const shipEntity = runtime.getEntity(session, context.shipID);
  const depotEntity = runtime.getEntity(session, item.itemID);
  const shipPosition = shipEntity && shipEntity.position;
  const depotPosition =
    (depotEntity && depotEntity.position) ||
    (item.spaceState && item.spaceState.position);
  if (options.requirePositions === true && (!shipPosition || !depotPosition)) {
    return "TARGET_TOO_FAR";
  }
  if (
    shipPosition &&
    depotPosition &&
    getVectorDistance(shipPosition, depotPosition) > rangeMeters
  ) {
    return "TARGET_TOO_FAR";
  }

  return null;
}

function validateMobileDepotScoop(session, item, state, context) {
  return validateMobileDepotSpaceAccess(session, item, state, context, {
    rangeMeters: MOBILE_DEPOT_CARGO_ACCESS_RANGE_METERS,
  });
}

function validateMobileDepotCargoAccess(session, itemOrID, options = {}) {
  const item = itemOrID && typeof itemOrID === "object"
    ? itemOrID
    : findItemById(itemOrID);
  const state = getMobileDepotStateFromItem(item);
  const context = getSessionContext(session, options);
  const errorMsg = validateMobileDepotSpaceAccess(session, item, state, context, {
    rangeMeters: MOBILE_DEPOT_CARGO_ACCESS_RANGE_METERS,
  });

  if (errorMsg) {
    return {
      success: false,
      errorMsg,
      item,
      state,
    };
  }

  return {
    success: true,
    item,
    state,
  };
}

function validateMobileDepotFittingAccess(session, itemOrID, options = {}) {
  const item = itemOrID && typeof itemOrID === "object"
    ? itemOrID
    : findItemById(itemOrID);
  const state = getMobileDepotStateFromItem(item);
  const context = getSessionContext(session, options);
  const errorMsg = validateMobileDepotSpaceAccess(session, item, state, context, {
    rangeMeters: MOBILE_DEPOT_FITTING_RANGE_METERS,
    requirePositions: true,
    disallowReinforced: true,
  });

  if (errorMsg) {
    return {
      success: false,
      errorMsg,
      item,
      state,
    };
  }

  return {
    success: true,
    item,
    state,
  };
}

function clearTimers(depotID) {
  const normalizedDepotID = toInt(depotID, 0);
  const timerState = timersByDepotID.get(normalizedDepotID);
  if (!timerState) {
    return;
  }
  if (timerState.activationTimer) {
    clearUnrefTimeout(timerState.activationTimer);
  }
  if (timerState.expiryTimer) {
    clearUnrefTimeout(timerState.expiryTimer);
  }
  if (timerState.reinforcementTimer) {
    clearUnrefTimeout(timerState.reinforcementTimer);
  }
  timersByDepotID.delete(normalizedDepotID);
}

function clearUnrefTimeout(timerRef) {
  if (!timerRef) {
    return;
  }
  if (timerRef.chunked === true) {
    timerRef.cleared = true;
    if (timerRef.currentTimer) {
      clearTimeout(timerRef.currentTimer);
    }
    return;
  }
  clearTimeout(timerRef);
}

function setUnrefTimeout(callback, delayMs) {
  const normalizedDelayMs = Math.max(0, toInt(delayMs, 0));
  if (normalizedDelayMs <= MAX_SAFE_TIMEOUT_DELAY_MS) {
    const timer = setTimeout(callback, normalizedDelayMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  }

  const targetAtMs = Date.now() + normalizedDelayMs;
  const timerRef = {
    chunked: true,
    cleared: false,
    currentTimer: null,
  };
  const armNextChunk = () => {
    if (timerRef.cleared) {
      return;
    }
    const remainingMs = Math.max(0, targetAtMs - Date.now());
    if (remainingMs <= 0) {
      callback();
      return;
    }
    const chunkDelayMs = Math.min(remainingMs, MAX_SAFE_TIMEOUT_DELAY_MS);
    timerRef.currentTimer = setTimeout(armNextChunk, chunkDelayMs);
    if (typeof timerRef.currentTimer.unref === "function") {
      timerRef.currentTimer.unref();
    }
  };
  armNextChunk();
  return timerRef;
}

function activateMobileDepot(itemID) {
  const item = findItemById(itemID);
  const state = getMobileDepotStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  const now = Date.now();
  if (state.expiresAtMs > 0 && state.expiresAtMs <= now) {
    expireMobileDepot(itemID, "expired-before-activation");
    return false;
  }
  if (
    toInt(item.locationID, 0) !== state.solarSystemID ||
    toInt(item.flagID, 0) !== 0 ||
    !item.spaceState
  ) {
    clearTimers(itemID);
    return false;
  }

  const updateResult = updateMobileDepotState(itemID, (currentState) => ({
    ...currentState,
    active: true,
    activatedAtMs: now,
  }));
  if (!updateResult.success) {
    clearTimers(itemID);
    return false;
  }

  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, itemID);
  scheduleMobileDepotTimers(itemID);
  log.info(
    `[MobileDepot] Activated depot=${itemID} system=${state.solarSystemID}`,
  );
  return true;
}

function enterMobileDepotReinforcementFromDamage(scene, entity, damageResult, options = {}) {
  if (!entity || !isMobileDepotDeployableType(entity) || !shouldEnterReinforcementFromDamage(damageResult)) {
    return {
      success: true,
      entered: false,
    };
  }

  const item = findItemById(entity.itemID);
  const state = getMobileDepotStateFromItem(item);
  if (!item || !state) {
    return {
      success: false,
      entered: false,
      errorMsg: "MOBILE_DEPOT_STATE_NOT_FOUND",
    };
  }
  const now = toInt(options.nowMs, Date.now());
  if (isMobileDepotReinforcedState(state, now)) {
    return {
      success: true,
      entered: false,
    };
  }

  const nextConditionState = {
    ...normalizeConditionState(damageResult.data.beforeConditionState),
    shieldCharge: MOBILE_DEPOT_REINFORCE_SHIELD_THRESHOLD,
  };
  const nextState = {
    ...state,
    active: true,
    reinforced: true,
    reinforcedAtMs: now,
    reinforcedUntilMs: now + MOBILE_DEPOT_REINFORCE_DURATION_MS,
    reinforcementExitedAtMs: 0,
  };
  const updateResult = updateInventoryItem(item.itemID, (currentItem) => ({
    ...currentItem,
    conditionState: nextConditionState,
    mobileDepotState: normalizeMobileDepotState(nextState),
    clientCustomInfo:
      buildClientCustomInfoForShip(nextState.sourceShipID) ??
      currentItem.clientCustomInfo,
    customInfo: buildCustomInfoWithoutState(currentItem.customInfo),
  }));
  if (!updateResult.success) {
    return {
      success: false,
      entered: false,
      errorMsg: updateResult.errorMsg || "WRITE_ERROR",
    };
  }

  entity.conditionState = {
    ...nextConditionState,
  };
  entity.component_reinforce = [true, nextState.reinforcedUntilMs];
  adjustDamageResultForReinforcement(damageResult, nextConditionState);
  if (scene && typeof scene.refreshInventoryBackedEntityPresentation === "function") {
    scene.refreshInventoryBackedEntityPresentation(item.itemID);
  } else {
    getSpaceRuntime().refreshInventoryBackedEntityPresentation(nextState.solarSystemID, item.itemID);
  }
  scheduleMobileDepotTimers(item.itemID);
  log.info(
    `[MobileDepot] Depot=${item.itemID} entered reinforcement until=${nextState.reinforcedUntilMs}`,
  );
  return {
    success: true,
    entered: true,
    data: {
      itemID: item.itemID,
      reinforcedUntilMs: nextState.reinforcedUntilMs,
    },
  };
}

function exitMobileDepotReinforcement(itemID, reason = "reinforcement-expired") {
  const item = findItemById(itemID);
  const state = getMobileDepotStateFromItem(item);
  if (!item || !state) {
    clearTimers(itemID);
    return false;
  }
  if (state.reinforced !== true) {
    return false;
  }

  const now = Date.now();
  const nextConditionState = {
    ...normalizeConditionState(item.conditionState),
    shieldCharge: 0,
  };
  const nextState = {
    ...state,
    reinforced: false,
    reinforcedUntilMs: 0,
    reinforcementExitedAtMs: now,
  };
  const updateResult = updateInventoryItem(item.itemID, (currentItem) => ({
    ...currentItem,
    conditionState: nextConditionState,
    mobileDepotState: normalizeMobileDepotState(nextState),
    clientCustomInfo:
      buildClientCustomInfoForShip(nextState.sourceShipID) ??
      currentItem.clientCustomInfo,
    customInfo: buildCustomInfoWithoutState(currentItem.customInfo),
  }));
  if (!updateResult.success) {
    log.warn(
      `[MobileDepot] Failed to exit reinforcement depot=${item.itemID}: ${updateResult.errorMsg}`,
    );
    return false;
  }

  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, item.itemID);
  scheduleMobileDepotTimers(item.itemID);
  log.info(`[MobileDepot] Depot=${item.itemID} exited reinforcement reason=${reason}`);
  return true;
}

function expireMobileDepot(itemID, reason = "expired") {
  const item = findItemById(itemID);
  const state = getMobileDepotStateFromItem(item);
  const systemID = toInt(
    state && state.solarSystemID,
    toInt(item && item.locationID, 0),
  );
  clearTimers(itemID);

  if (systemID > 0) {
    const destroyResult = getSpaceRuntime().destroyDynamicInventoryEntity(systemID, itemID);
    if (destroyResult && destroyResult.success) {
      log.info(`[MobileDepot] Removed depot=${itemID} reason=${reason}`);
      return true;
    }
  }

  const removeResult = removeInventoryItem(itemID, { removeContents: true });
  if (removeResult.success) {
    log.info(`[MobileDepot] Removed depot=${itemID} reason=${reason}`);
    return true;
  }
  return false;
}

function clearMobileDepot(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }
  clearTimers(itemID);

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileDepotStateFromItem(item);
  if (state && findItemById(itemID)) {
    updateMobileDepotState(itemID, (currentState) => ({
      ...currentState,
      active: false,
      deactivatedAtMs: Date.now(),
      reinforced: false,
      reinforcedUntilMs: 0,
    }));
  }
  if (state) {
    log.info(`[MobileDepot] Cleared depot=${itemID} reason=${reason}`);
  }
  return Boolean(state);
}

function scheduleMobileDepotTimers(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileDepotStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  clearTimers(itemID);

  const now = Date.now();
  const nextTimers = {
    activationTimer: null,
    expiryTimer: null,
    reinforcementTimer: null,
  };

  if (state.expiresAtMs > 0) {
    nextTimers.expiryTimer = setUnrefTimeout(
      () => expireMobileDepot(itemID, "expired"),
      state.expiresAtMs - now,
    );
  }

  if (!state.active) {
    nextTimers.activationTimer = setUnrefTimeout(
      () => activateMobileDepot(itemID),
      state.activateAtMs - now,
    );
  }

  if (state.reinforced === true && state.reinforcedUntilMs > 0) {
    if (state.reinforcedUntilMs <= now) {
      return exitMobileDepotReinforcement(itemID, "reinforcement-expired");
    }
    nextTimers.reinforcementTimer = setUnrefTimeout(
      () => exitMobileDepotReinforcement(itemID, "reinforcement-expired"),
      state.reinforcedUntilMs - now,
    );
  }

  timersByDepotID.set(itemID, nextTimers);
  return true;
}

function registerMobileDepotItem(itemOrID) {
  return scheduleMobileDepotTimers(itemOrID);
}

function hydrateMobileDepotEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isMobileDepotDeployableType(itemRecord)) {
    return entity;
  }

  const state = getMobileDepotStateFromItem(itemRecord);
  if (!state) {
    return entity;
  }

  const now = Date.now();
  const isActive = state.active === true || (state.activateAtMs > 0 && state.activateAtMs <= now);
  entity.component_activate = [isActive, isActive ? null : state.activateAtMs];
  entity.activate_comp_durationSeconds = Math.trunc(MOBILE_DEPOT_ACTIVATION_DELAY_MS / 1000);
  entity.component_reinforce = [
    isMobileDepotReinforcedState(state, now),
    isMobileDepotReinforcedState(state, now) ? state.reinforcedUntilMs : null,
  ];
  entity.component_decay = state.expiresAtMs > 0 ? state.expiresAtMs : null;
  return entity;
}

function launchMobileDepotFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateMobileDepotLaunch(item, context);
  if (validationError) {
    return {
      success: false,
      errorMsg: validationError,
    };
  }

  const sourceTypeID = toInt(item.typeID, 0);
  const spawnState = buildDeployableSpawnState(session, context);
  const placementConflict = findMobileDepotPlacementConflict(
    session,
    item,
    context,
    spawnState,
  );
  if (placementConflict) {
    log.info(
      `[MobileDepot] Launch rejected char=${context.characterID} item=${item.itemID} system=${context.systemID} reason=${placementConflict.errorMsg}`,
    );
    return {
      success: false,
      errorMsg: placementConflict.errorMsg,
    };
  }

  let launchSourceItemID = item.itemID;
  if (toInt(item.singleton, 0) !== 1 && toInt(item.stacksize ?? item.quantity, 0) <= 1) {
    const assembledResult = updateInventoryItem(item.itemID, (currentItem) => ({
      ...currentItem,
      singleton: 1,
      quantity: -1,
      stacksize: 1,
    }));
    if (!assembledResult.success || !assembledResult.data) {
      return assembledResult;
    }
    launchSourceItemID = assembledResult.data.itemID;
    syncInventoryChange(
      session,
      assembledResult.data,
      assembledResult.previousData || item,
      {
        locationContext: ["Ship", context.shipID, "ShipCargo"],
      },
    );
  }

  const transferResult = transferItemToOwnerLocation(
    launchSourceItemID,
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
    sourceShipID: context.shipID,
    solarSystemID: context.systemID,
    depotID: launchedItemID,
    deployedAtMs: now,
    activateAtMs: now + MOBILE_DEPOT_ACTIVATION_DELAY_MS,
    activatedAtMs: 0,
    expiresAtMs: now + MOBILE_DEPOT_LIFETIME_MS,
    active: false,
    deactivatedAtMs: 0,
    reinforced: false,
    reinforcedAtMs: 0,
    reinforcedUntilMs: 0,
    reinforcementExitedAtMs: 0,
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
    mobileDepotState: normalizeMobileDepotState(state),
    clientCustomInfo: buildClientCustomInfoForShip(context.shipID),
    customInfo: buildCustomInfoWithoutState(currentItem.customInfo),
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
      `[MobileDepot] Launched depot ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobileDepotItem(updatedResult.data);
  log.info(
    `[MobileDepot] char=${context.characterID} launched depot itemID=${launchedItemID} typeID=${sourceTypeID} system=${context.systemID}`,
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

function scoopMobileDepotToShipFlag(session, itemID, destinationFlagID) {
  const context = getSessionContext(session, { ownerID: 0 });
  const item = findItemById(itemID);
  const state = getMobileDepotStateFromItem(item);
  const validationError = validateMobileDepotScoop(session, item, state, context);
  if (validationError) {
    return {
      success: false,
      errorMsg: validationError,
    };
  }
  const normalizedDestinationFlagID = toInt(destinationFlagID, ITEM_FLAGS.CARGO_HOLD);
  const destinationValidationError = validateMobileDepotDestinationFlag(
    item,
    context,
    normalizedDestinationFlagID,
  );
  if (destinationValidationError) {
    return {
      success: false,
      errorMsg: destinationValidationError,
    };
  }

  clearTimers(item.itemID);
  const updateResult = updateInventoryItem(item.itemID, (currentItem) => ({
    ...currentItem,
    ownerID: context.characterID,
    locationID: context.shipID,
    flagID: normalizedDestinationFlagID,
    singleton: 1,
    expiresAtMs: null,
    spaceRadius: null,
    spaceState: null,
    mobileDepotState: null,
    clientCustomInfo:
      buildClientCustomInfoForShip(state && state.sourceShipID) ??
      buildClientCustomInfoForShip(context.shipID),
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
      locationContext: ["Ship", context.shipID, "ShipCargo"],
    },
  );

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
    `[MobileDepot] char=${context.characterID} scooped depot itemID=${item.itemID} system=${context.systemID} ship=${context.shipID} flag=${normalizedDestinationFlagID}`,
  );

  return {
    success: true,
    data: {
      itemID: item.itemID,
    },
  };
}

function scoopMobileDepotToCargo(session, itemID) {
  return scoopMobileDepotToShipFlag(session, itemID, ITEM_FLAGS.CARGO_HOLD);
}

function scoopMobileDepotToMobileDepotHold(session, itemID) {
  return scoopMobileDepotToShipFlag(session, itemID, ITEM_FLAGS.MOBILE_DEPOT_HOLD);
}

module.exports = {
  CATEGORY_DEPLOYABLE,
  GROUP_MOBILE_DEPOT,
  MOBILE_DEPOT_CARGO_ACCESS_RANGE_METERS,
  MOBILE_DEPOT_FITTING_RANGE_METERS,
  MOBILE_DEPOT_ACTIVATION_DELAY_MS,
  MOBILE_DEPOT_LIFETIME_MS,
  MOBILE_DEPOT_REINFORCE_DURATION_MS,
  MOBILE_DEPOT_REINFORCE_SHIELD_THRESHOLD,
  isMobileDepotDeployableType,
  isMobileDepotReinforced,
  isMobileDepotEntityReinforced,
  enterMobileDepotReinforcementFromDamage,
  exitMobileDepotReinforcement,
  launchMobileDepotFromShip,
  scoopMobileDepotToCargo,
  scoopMobileDepotToMobileDepotHold,
  registerMobileDepotItem,
  clearMobileDepot,
  getMobileDepotStateFromItem,
  validateMobileDepotCargoAccess,
  validateMobileDepotFittingAccess,
  hydrateMobileDepotEntityFromInventoryItem,
  _testing: {
    buildCustomInfoWithState,
    getStateFromCustomInfo,
  },
};
