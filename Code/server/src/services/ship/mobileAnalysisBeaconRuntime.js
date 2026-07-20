const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  findShipItemById,
  getItemMetadata,
  listSystemSpaceItems,
  removeInventoryItem,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const characterEnergyMgrService = require(path.join(
  __dirname,
  "../character/characterEnergyMgrService",
));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  isTriglavianSolarSystemID,
  isWormholeSolarSystemID,
} = require(path.join(__dirname, "../chat/channelRules"));
const {
  matchesTypeList,
} = require(path.join(__dirname, "../inventory/typeListAuthority"));

const CATEGORY_DEPLOYABLE = 22;
const CATEGORY_UPWELL_STRUCTURE = 65;
const GROUP_CONTROL_TOWER = 365;
const GROUP_MOBILE_ANALYSIS_BEACON = 4137;
const TYPE_CONCORD_ROGUE_ANALYSIS_BEACON = 60244;
const TYPE_CONCORD_CARRIER_ROGUE_ANALYSIS_BEACON = 92183;
const TYPE_ANCHORING = 11584;
const TYPE_COCKROACH = 11019;
const TYPE_LIST_STANDARD_CRAB_LINKABLE_SHIPS = 300;
const TYPE_LIST_CARRIER_CRAB_LINKABLE_SHIPS = 946;

const LINKSTATE_IDLE = 1;
const LINKSTATE_RUNNING = 2;
const LINKSTATE_COMPLETED = 3;

const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_ANALYSIS_BEACON_ACTIVATION_DELAY_MS = 20 * 1000;
const MOBILE_ANALYSIS_BEACON_LINK_DURATION_MS = 4 * 60 * 1000;
const MOBILE_ANALYSIS_BEACON_LINK_STATUS_CLEAR_DELAY_MS = 60 * 1000;
const MOBILE_ANALYSIS_BEACON_CHARACTER_ENERGY_COST = 100;
const MOBILE_ANALYSIS_BEACON_LIFETIME_MS = 60 * 60 * 1000;
const MOBILE_ANALYSIS_BEACON_SECURITY_CUTOFF = 0.45;
const MOBILE_ANALYSIS_BEACON_MIN_DISTANCE_FROM_UPWELL_METERS = 10_000_000;
const MOBILE_ANALYSIS_BEACON_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS = 30_000_000;
const CUSTOM_INFO_KEY = "evejsMobileAnalysisBeacon";
const SHIP_CATEGORY = 6;
const GROUP_TITAN = 30;
const GROUP_DREADNOUGHT = 485;
const GROUP_CARRIER = 547;
const GROUP_SUPERCARRIER = 659;
const GROUP_LANCER_DREADNOUGHT = 4594;
const GROUP_COMMAND_CARRIER = 5120;
const STANDARD_CRAB_LINKABLE_SHIP_GROUP_IDS = new Set([
  GROUP_TITAN,
  GROUP_DREADNOUGHT,
  GROUP_CARRIER,
  GROUP_SUPERCARRIER,
  GROUP_LANCER_DREADNOUGHT,
  GROUP_COMMAND_CARRIER,
]);
const STANDARD_CRAB_LINKABLE_SHIP_TYPE_IDS = new Set([TYPE_COCKROACH]);
const CARRIER_CRAB_LINKABLE_SHIP_GROUP_IDS = new Set([
  GROUP_CARRIER,
  GROUP_COMMAND_CARRIER,
]);
const CARRIER_CRAB_LINKABLE_SHIP_TYPE_IDS = new Set();

const timersByBeaconID = new Map();

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

function isMobileAnalysisBeaconType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_DEPLOYABLE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_MOBILE_ANALYSIS_BEACON
    ) || isMobileAnalysisBeaconType(toInt(typeIDOrItem.typeID, 0));
  }

  const typeID = toInt(typeIDOrItem, 0);
  if (
    typeID === TYPE_CONCORD_ROGUE_ANALYSIS_BEACON ||
    typeID === TYPE_CONCORD_CARRIER_ROGUE_ANALYSIS_BEACON
  ) {
    return true;
  }
  const metadata = getItemMetadata(typeID) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_DEPLOYABLE &&
    toInt(metadata.groupID, 0) === GROUP_MOBILE_ANALYSIS_BEACON
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
    // Preserve opaque legacy customInfo values.
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
    beaconID: toInt(state.beaconID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
    linkState: toInt(state.linkState, LINKSTATE_IDLE),
    linkCompleteAtMs: toInt(state.linkCompleteAtMs, 0),
    linkedShipID: toInt(state.linkedShipID, 0),
  };
}

function getMobileAnalysisBeaconStateFromItem(item) {
  if (!item || !isMobileAnalysisBeaconType(item)) {
    return null;
  }
  const state = getStateFromCustomInfo(item.customInfo);
  if (!state || state.beaconID <= 0) {
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
    beaconID: toInt(state.beaconID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
    linkState: toInt(state.linkState, LINKSTATE_IDLE),
    linkCompleteAtMs: toInt(state.linkCompleteAtMs, 0),
    linkedShipID: toInt(state.linkedShipID, 0),
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

function isAbyssalSession(session) {
  return Boolean(
    session &&
      (
        session._abyssal ||
        session.abyssal ||
        session.abyssalPocketID ||
        session.abyssalInstanceID ||
        session.abyssalTraceID
      ),
  );
}

function getSolarSystemSecurity(system) {
  const security = Math.max(0, Math.min(1, toReal(system && system.security, 0)));
  if (security > 0 && security < 0.05) {
    return 0.05;
  }
  return security;
}

function getDeploymentRestriction(session, context) {
  if (isAbyssalSession(session)) {
    return "Mobile Analysis Beacons cannot be deployed in Abyssal space.";
  }
  if (isWormholeSolarSystemID(context.systemID)) {
    return "Mobile Analysis Beacons can only be deployed in low and null security space.";
  }
  if (isTriglavianSolarSystemID(context.systemID)) {
    return "Mobile Analysis Beacons can only be deployed in low and null security space.";
  }

  const system = worldData.getSolarSystemByID(context.systemID);
  if (!system) {
    return "Solar system data is unavailable for this deployment.";
  }
  if (getSolarSystemSecurity(system) >= MOBILE_ANALYSIS_BEACON_SECURITY_CUTOFF) {
    return "Mobile Analysis Beacons can only be deployed below 0.5 security.";
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
  const typeID = getObjectTypeID(source);
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  const groupID = toInt(source && source.groupID, toInt(metadata.groupID, 0));
  const categoryID = toInt(source && source.categoryID, toInt(metadata.categoryID, 0));

  if (categoryID === CATEGORY_UPWELL_STRUCTURE) {
    return "upwell";
  }
  if (groupID === GROUP_CONTROL_TOWER) {
    return "controlTower";
  }
  return null;
}

function getPlacementBlockerMinimumDistance(kind) {
  if (kind === "upwell") {
    return MOBILE_ANALYSIS_BEACON_MIN_DISTANCE_FROM_UPWELL_METERS;
  }
  if (kind === "controlTower") {
    return MOBILE_ANALYSIS_BEACON_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS;
  }
  return 0;
}

function getPlacementConflictError(kind) {
  if (kind === "upwell") {
    return "MOBILE_ANALYSIS_BEACON_TOO_CLOSE_TO_UPWELL";
  }
  if (kind === "controlTower") {
    return "MOBILE_ANALYSIS_BEACON_TOO_CLOSE_TO_CONTROL_TOWER";
  }
  return "MOBILE_ANALYSIS_BEACON_DEPLOYMENT_BLOCKED";
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
      ...options,
      kind,
    },
  );

  for (const item of listSystemSpaceItems(systemID)) {
    append(item);
  }

  const scene = getSpaceRuntime().ensureScene(systemID);
  if (scene) {
    for (const entity of scene.staticEntities || []) {
      append(entity);
    }
    for (const entity of scene.dynamicEntities ? scene.dynamicEntities.values() : []) {
      append(entity);
    }
  }

  if (worldData && typeof worldData.getCelestialsForSystem === "function") {
    for (const celestial of worldData.getCelestialsForSystem(systemID)) {
      append(celestial);
    }
  }

  return blockers;
}

function findPlacementConflict(session, item, context, spawnState) {
  const position = getObjectPosition({ spaceState: spawnState });
  if (!position) {
    return {
      errorMsg: "MOBILE_ANALYSIS_BEACON_DEPLOYMENT_POSITION_UNAVAILABLE",
    };
  }

  const blockers = collectPlacementBlockers(session, context, {
    sourceItemID: item && item.itemID,
  });
  for (const blocker of blockers) {
    const distance = getVectorDistance(position, blocker.position);
    const clearDistance = Math.max(0, distance - toReal(blocker.radius, 0));
    if (clearDistance < blocker.minimumDistance) {
      return {
        ...blocker,
        distance,
        clearDistance,
      };
    }
  }
  return null;
}

function buildDeployableSpawnState(session, context) {
  const shipEntity =
    session && session._space && session._space.shipID
      ? getSpaceRuntime().getEntity(session, session._space.shipID)
      : null;
  const position = shipEntity && hasFiniteVectorCoordinates(shipEntity.position)
    ? normalizeVector(shipEntity.position)
    : null;
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

function updateMobileAnalysisBeaconState(itemID, updater) {
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
      errorMsg: "MOBILE_ANALYSIS_BEACON_STATE_NOT_FOUND",
    };
  }
  const nextState =
    typeof updater === "function" ? updater({ ...currentState }, item) : updater;
  return updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    customInfo: buildCustomInfoWithState(currentItem.customInfo, nextState),
  }));
}

function clearTimers(beaconID) {
  const normalizedBeaconID = toInt(beaconID, 0);
  const timerState = timersByBeaconID.get(normalizedBeaconID);
  if (!timerState) {
    return;
  }
  for (const timer of [
    timerState.activationTimer,
    timerState.expiryTimer,
    timerState.linkTimer,
  ]) {
    if (timer) {
      clearTimeout(timer);
    }
  }
  timersByBeaconID.delete(normalizedBeaconID);
}

function setUnrefTimeout(callback, delayMs) {
  const timer = setTimeout(callback, Math.max(0, toInt(delayMs, 0)));
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

function clearMobileAnalysisBeacon(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }
  clearTimers(itemID);

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileAnalysisBeaconStateFromItem(item);
  if (!state) {
    return false;
  }

  if (findItemById(itemID)) {
    updateMobileAnalysisBeaconState(itemID, (currentState) => ({
      ...currentState,
      active: false,
      deactivatedAtMs: Date.now(),
    }));
  }
  log.info(`[MobileAnalysisBeacon] Cleared beacon=${itemID} reason=${reason}`);
  return true;
}

function activateMobileAnalysisBeacon(itemID) {
  const item = findItemById(itemID);
  const state = getMobileAnalysisBeaconStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  const now = Date.now();
  if (state.expiresAtMs > 0 && state.expiresAtMs <= now) {
    expireMobileAnalysisBeacon(itemID, "expired-before-activation");
    return false;
  }
  if (
    toInt(item.locationID, 0) !== state.solarSystemID ||
    toInt(item.flagID, 0) !== 0 ||
    !item.spaceState
  ) {
    clearMobileAnalysisBeacon(item, "removed-before-activation");
    return false;
  }

  updateMobileAnalysisBeaconState(itemID, (currentState) => ({
    ...currentState,
    active: true,
    activatedAtMs: now,
  }));
  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, itemID);
  scheduleMobileAnalysisBeaconTimers(itemID);
  log.info(
    `[MobileAnalysisBeacon] Activated beacon=${itemID} system=${state.solarSystemID}`,
  );
  return true;
}

function completeMobileAnalysisBeaconLink(itemID) {
  const item = findItemById(itemID);
  const state = getMobileAnalysisBeaconStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }
  if (toInt(state.linkState, LINKSTATE_IDLE) !== LINKSTATE_RUNNING) {
    scheduleMobileAnalysisBeaconTimers(itemID);
    return false;
  }

  const now = Date.now();
  if (state.expiresAtMs > 0 && state.expiresAtMs <= now) {
    expireMobileAnalysisBeacon(itemID, "expired-before-link-complete");
    return false;
  }
  if (state.linkCompleteAtMs > now) {
    scheduleMobileAnalysisBeaconTimers(itemID);
    return false;
  }

  updateMobileAnalysisBeaconState(itemID, (currentState) => ({
    ...currentState,
    linkState: LINKSTATE_COMPLETED,
  }));
  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, itemID);
  scheduleMobileAnalysisBeaconTimers(itemID);
  log.info(
    `[MobileAnalysisBeacon] Link completed beacon=${itemID} ship=${state.linkedShipID} system=${state.solarSystemID}`,
  );
  return true;
}

function expireMobileAnalysisBeacon(itemID, reason = "expired") {
  const item = findItemById(itemID);
  const state = getMobileAnalysisBeaconStateFromItem(item);
  const systemID = toInt(
    state && state.solarSystemID,
    toInt(item && item.locationID, 0),
  );
  clearTimers(itemID);

  if (systemID > 0) {
    const destroyResult = getSpaceRuntime().destroyDynamicInventoryEntity(systemID, itemID);
    if (destroyResult && destroyResult.success) {
      log.info(`[MobileAnalysisBeacon] Removed beacon=${itemID} reason=${reason}`);
      return true;
    }
  }

  const removeResult = removeInventoryItem(itemID, { removeContents: true });
  if (removeResult.success) {
    log.info(`[MobileAnalysisBeacon] Removed beacon=${itemID} reason=${reason}`);
    return true;
  }
  return false;
}

function scheduleMobileAnalysisBeaconTimers(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileAnalysisBeaconStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  clearTimers(itemID);

  const now = Date.now();
  const nextTimers = {
    activationTimer: null,
    expiryTimer: null,
    linkTimer: null,
  };

  if (state.expiresAtMs > 0) {
    nextTimers.expiryTimer = setUnrefTimeout(
      () => expireMobileAnalysisBeacon(itemID, "expired"),
      state.expiresAtMs - now,
    );
  }

  if (!state.active) {
    nextTimers.activationTimer = setUnrefTimeout(
      () => activateMobileAnalysisBeacon(itemID),
      state.activateAtMs - now,
    );
  }

  if (
    toInt(state.linkState, LINKSTATE_IDLE) === LINKSTATE_RUNNING &&
    state.linkCompleteAtMs > 0
  ) {
    nextTimers.linkTimer = setUnrefTimeout(
      () => completeMobileAnalysisBeaconLink(itemID),
      state.linkCompleteAtMs - now,
    );
  }

  timersByBeaconID.set(itemID, nextTimers);
  return true;
}

function registerMobileAnalysisBeaconItem(itemOrID) {
  return scheduleMobileAnalysisBeaconTimers(itemOrID);
}

function isActiveMobileAnalysisBeaconState(state, nowMs = Date.now()) {
  if (!state || state.deactivatedAtMs > 0) {
    return false;
  }
  if (state.expiresAtMs > 0 && state.expiresAtMs <= nowMs) {
    return false;
  }
  return state.active === true || (state.activateAtMs > 0 && state.activateAtMs <= nowMs);
}

function hydrateMobileAnalysisBeaconEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isMobileAnalysisBeaconType(itemRecord)) {
    return entity;
  }

  const state = getMobileAnalysisBeaconStateFromItem(itemRecord);
  if (!state) {
    return entity;
  }

  const active = isActiveMobileAnalysisBeaconState(state, Date.now());
  entity.component_activate = [active, active ? null : state.activateAtMs];
  entity.activate_comp_durationSeconds = Math.trunc(
    MOBILE_ANALYSIS_BEACON_ACTIVATION_DELAY_MS / 1000,
  );
  entity.component_linkWithShip = [
    state.deployedAtMs,
    Math.max(LINKSTATE_IDLE, Math.min(LINKSTATE_COMPLETED, toInt(state.linkState, LINKSTATE_IDLE))),
    state.linkCompleteAtMs > 0 ? state.linkCompleteAtMs : null,
    state.linkedShipID > 0 ? state.linkedShipID : null,
  ];
  return entity;
}

function getLinkableShipTypeListIDForBeaconType(typeID) {
  return toInt(typeID, 0) === TYPE_CONCORD_CARRIER_ROGUE_ANALYSIS_BEACON
    ? TYPE_LIST_CARRIER_CRAB_LINKABLE_SHIPS
    : TYPE_LIST_STANDARD_CRAB_LINKABLE_SHIPS;
}

function getFallbackLinkableShipIDsForBeaconType(typeID) {
  return toInt(typeID, 0) === TYPE_CONCORD_CARRIER_ROGUE_ANALYSIS_BEACON
    ? {
        groupIDs: CARRIER_CRAB_LINKABLE_SHIP_GROUP_IDS,
        typeIDs: CARRIER_CRAB_LINKABLE_SHIP_TYPE_IDS,
      }
    : {
        groupIDs: STANDARD_CRAB_LINKABLE_SHIP_GROUP_IDS,
        typeIDs: STANDARD_CRAB_LINKABLE_SHIP_TYPE_IDS,
      };
}

function isShipTypeLinkableForBeaconType(beaconTypeID, shipType) {
  const typeListID = getLinkableShipTypeListIDForBeaconType(beaconTypeID);
  if (matchesTypeList(shipType, typeListID)) {
    return true;
  }

  const fallback = getFallbackLinkableShipIDsForBeaconType(beaconTypeID);
  return (
    fallback.groupIDs.has(toInt(shipType && shipType.groupID, 0)) ||
    fallback.typeIDs.has(toInt(shipType && shipType.typeID, 0))
  );
}

function resolveShipTypeContext(shipEntity, shipItem) {
  const typeID = toInt(
    shipEntity && shipEntity.typeID,
    toInt(shipItem && shipItem.typeID, 0),
  );
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  return {
    typeID,
    groupID: toInt(
      shipEntity && shipEntity.groupID,
      toInt(shipItem && shipItem.groupID, toInt(metadata.groupID, 0)),
    ),
    categoryID: toInt(
      shipEntity && shipEntity.categoryID,
      toInt(shipItem && shipItem.categoryID, toInt(metadata.categoryID, 0)),
    ),
    groupName: String(
      (shipEntity && shipEntity.groupName) ||
      (shipItem && shipItem.groupName) ||
      metadata.groupName ||
      "",
    ).trim(),
  };
}

function validateLinkingShip(beaconItem, shipEntity, shipItem) {
  if (!shipEntity || shipEntity.kind !== "ship") {
    return "SHIP_NOT_FOUND";
  }

  const shipType = resolveShipTypeContext(shipEntity, shipItem);
  if (shipType.categoryID !== SHIP_CATEGORY) {
    return "MOBILE_ANALYSIS_BEACON_LINK_INVALID_SHIP";
  }

  if (!isShipTypeLinkableForBeaconType(beaconItem && beaconItem.typeID, shipType)) {
    return "MOBILE_ANALYSIS_BEACON_LINK_INVALID_SHIP";
  }
  return null;
}

function applyLinkRestrictionsToShip(session, shipEntity, beaconID, linkCompleteAtMs) {
  if (!shipEntity) {
    return false;
  }

  const statusClearAtMs =
    linkCompleteAtMs + MOBILE_ANALYSIS_BEACON_LINK_STATUS_CLEAR_DELAY_MS;
  shipEntity.mobileAnalysisBeaconLinkedBeaconID = toInt(beaconID, 0);
  shipEntity.mobileAnalysisBeaconImmobileUntilMs = Math.max(
    toReal(shipEntity.mobileAnalysisBeaconImmobileUntilMs, 0),
    linkCompleteAtMs,
  );
  shipEntity.mobileAnalysisBeaconWarpDisabledUntilMs = Math.max(
    toReal(shipEntity.mobileAnalysisBeaconWarpDisabledUntilMs, 0),
    statusClearAtMs,
  );
  shipEntity.mobileAnalysisBeaconCloakBlockedUntilMs = Math.max(
    toReal(shipEntity.mobileAnalysisBeaconCloakBlockedUntilMs, 0),
    statusClearAtMs,
  );
  shipEntity.mobileAnalysisBeaconTetherBlockedUntilMs = Math.max(
    toReal(shipEntity.mobileAnalysisBeaconTetherBlockedUntilMs, 0),
    statusClearAtMs,
  );

  const scene = getSpaceRuntime().getSceneForSession(session);
  if (scene && typeof scene.stopShipEntity === "function") {
    scene.stopShipEntity(shipEntity, {
      reason: "mobile-analysis-beacon-link",
    });
  }
  return true;
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

function validateMobileAnalysisBeaconLaunch(item, context, session) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileAnalysisBeaconType(item)) {
    return "ITEM_NOT_MOBILE_ANALYSIS_BEACON";
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    toInt(item.flagID, 0) !== ITEM_FLAGS.CARGO_HOLD
  ) {
    return "ITEM_NOT_IN_SHIP_CARGO";
  }
  const deploymentRestriction = getDeploymentRestriction(session, context);
  if (deploymentRestriction) {
    return deploymentRestriction;
  }
  if (getSkillLevel(context.characterID, TYPE_ANCHORING) < 3) {
    return "Mobile Analysis Beacon deployment requires Anchoring 3.";
  }
  return null;
}

function launchMobileAnalysisBeaconFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateMobileAnalysisBeaconLaunch(item, context, session);
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
      errorMsg: "MOBILE_ANALYSIS_BEACON_DEPLOYMENT_POSITION_UNAVAILABLE",
    };
  }

  const placementConflict = findPlacementConflict(session, item, context, spawnState);
  if (placementConflict) {
    log.info(
      `[MobileAnalysisBeacon] Launch rejected char=${context.characterID} item=${item.itemID} system=${context.systemID} reason=${placementConflict.errorMsg}`,
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
    beaconID: launchedItemID,
    deployedAtMs: now,
    activateAtMs: now + MOBILE_ANALYSIS_BEACON_ACTIVATION_DELAY_MS,
    activatedAtMs: 0,
    expiresAtMs: now + MOBILE_ANALYSIS_BEACON_LIFETIME_MS,
    active: false,
    deactivatedAtMs: 0,
    linkState: LINKSTATE_IDLE,
    linkCompleteAtMs: 0,
    linkedShipID: 0,
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
      `[MobileAnalysisBeacon] Launched beacon ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobileAnalysisBeaconItem(updatedResult.data);
  log.info(
    `[MobileAnalysisBeacon] char=${context.characterID} launched beacon itemID=${launchedItemID} typeID=${sourceTypeID} system=${context.systemID}`,
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

function initiateMobileAnalysisBeaconLink(session, beaconID, options = {}) {
  const item = findItemById(beaconID);
  const state = getMobileAnalysisBeaconStateFromItem(item);
  const context = getSessionContext(session, options);
  const characterID = context.characterID;
  if (!context.characterID || !context.shipID || !context.systemID) {
    return {
      success: false,
      errorMsg: "INVALID_SESSION",
    };
  }
  if (!item || !state) {
    return {
      success: false,
      errorMsg: "MOBILE_ANALYSIS_BEACON_NOT_FOUND",
    };
  }

  const now = Date.now();
  if (!isActiveMobileAnalysisBeaconState(state, now)) {
    return {
      success: false,
      errorMsg: "MOBILE_ANALYSIS_BEACON_NOT_ACTIVE",
    };
  }
  if (toInt(state.solarSystemID, 0) !== toInt(context.systemID, 0)) {
    return {
      success: false,
      errorMsg: "MOBILE_ANALYSIS_BEACON_NOT_IN_SYSTEM",
    };
  }
  if (
    toInt(state.linkState, LINKSTATE_IDLE) !== LINKSTATE_IDLE ||
    toInt(state.linkedShipID, 0) > 0
  ) {
    return {
      success: false,
      errorMsg: "MOBILE_ANALYSIS_BEACON_ALREADY_LINKED",
    };
  }

  const shipEntity = getSpaceRuntime().getEntity(session, context.shipID);
  const shipItem = findShipItemById(context.shipID) || findItemById(context.shipID);
  const shipValidationError = validateLinkingShip(item, shipEntity, shipItem);
  if (shipValidationError) {
    return {
      success: false,
      errorMsg: shipValidationError,
    };
  }

  const currentEnergyState = characterEnergyMgrService.getCharacterEnergyStateNow(session);
  if (
    currentEnergyState.energyLevel - MOBILE_ANALYSIS_BEACON_CHARACTER_ENERGY_COST <
    currentEnergyState.minEnergyLevel
  ) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_CHARACTER_ENERGY",
    };
  }

  const linkCompleteAtMs = now + MOBILE_ANALYSIS_BEACON_LINK_DURATION_MS;
  const updatedResult = updateMobileAnalysisBeaconState(beaconID, (currentState) => ({
    ...currentState,
    active: true,
    activatedAtMs: currentState.activatedAtMs || now,
    linkState: LINKSTATE_RUNNING,
    linkCompleteAtMs,
    linkedShipID: context.shipID,
  }));
  if (!updatedResult.success || !updatedResult.data) {
    return updatedResult;
  }

  const energyResult = characterEnergyMgrService.spendCharacterEnergy(
    session,
    MOBILE_ANALYSIS_BEACON_CHARACTER_ENERGY_COST,
  );
  if (!energyResult.success) {
    updateMobileAnalysisBeaconState(beaconID, (currentState) => ({
      ...currentState,
      linkState: LINKSTATE_IDLE,
      linkCompleteAtMs: 0,
      linkedShipID: 0,
    }));
    return {
      success: false,
      errorMsg: energyResult.errorMsg || "INSUFFICIENT_CHARACTER_ENERGY",
    };
  }

  syncInventoryChange(
    session,
    updatedResult.data,
    updatedResult.previousData || {},
  );
  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, beaconID);
  scheduleMobileAnalysisBeaconTimers(beaconID);
  applyLinkRestrictionsToShip(session, shipEntity, beaconID, linkCompleteAtMs);
  log.info(
    `[MobileAnalysisBeacon] Link started char=${characterID} ship=${context.shipID} beacon=${beaconID} method=${options.quick ? "InitiateLinkQuick" : "InitiateLink"}`,
  );
  return {
    success: true,
    data: {
      beaconID: toInt(beaconID, 0),
      linkedShipID: context.shipID,
      linkCompleteAtMs,
      characterEnergyCost: MOBILE_ANALYSIS_BEACON_CHARACTER_ENERGY_COST,
    },
  };
}

module.exports = {
  CATEGORY_DEPLOYABLE,
  GROUP_MOBILE_ANALYSIS_BEACON,
  TYPE_CONCORD_ROGUE_ANALYSIS_BEACON,
  TYPE_CONCORD_CARRIER_ROGUE_ANALYSIS_BEACON,
  TYPE_LIST_STANDARD_CRAB_LINKABLE_SHIPS,
  TYPE_LIST_CARRIER_CRAB_LINKABLE_SHIPS,
  LINKSTATE_IDLE,
  LINKSTATE_RUNNING,
  LINKSTATE_COMPLETED,
  MOBILE_ANALYSIS_BEACON_ACTIVATION_DELAY_MS,
  MOBILE_ANALYSIS_BEACON_LINK_DURATION_MS,
  MOBILE_ANALYSIS_BEACON_LINK_STATUS_CLEAR_DELAY_MS,
  MOBILE_ANALYSIS_BEACON_CHARACTER_ENERGY_COST,
  MOBILE_ANALYSIS_BEACON_LIFETIME_MS,
  MOBILE_ANALYSIS_BEACON_MIN_DISTANCE_FROM_UPWELL_METERS,
  MOBILE_ANALYSIS_BEACON_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS,
  isMobileAnalysisBeaconType,
  getMobileAnalysisBeaconStateFromItem,
  launchMobileAnalysisBeaconFromShip,
  registerMobileAnalysisBeaconItem,
  clearMobileAnalysisBeacon,
  hydrateMobileAnalysisBeaconEntityFromInventoryItem,
  initiateMobileAnalysisBeaconLink,
  _testing: {
    findPlacementConflict,
    getDeploymentRestriction,
    getStateFromCustomInfo,
    buildCustomInfoWithState,
    getLinkableShipTypeListIDForBeaconType,
    isShipTypeLinkableForBeaconType,
    validateLinkingShip,
  },
};
