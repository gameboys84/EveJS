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
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));

const CATEGORY_DEPLOYABLE = 22;
const CATEGORY_STATION = 3;
const CATEGORY_STARBASE = 23;
const CATEGORY_UPWELL_STRUCTURE = 65;
const GROUP_STARGATE = 10;
const GROUP_WORMHOLE = 988;
const GROUP_CONTROL_TOWER = 365;
const GROUP_MOBILE_SCAN_INHIBITOR = 1275;
const TYPE_MOBILE_SCAN_INHIBITOR = 33589;
const TYPE_ANCHORING = 11584;

const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_SCAN_INHIBITOR_ACTIVATION_DELAY_MS = 60 * 1000;
const MOBILE_SCAN_INHIBITOR_LIFETIME_MS = 60 * 60 * 1000;
const MOBILE_SCAN_INHIBITOR_RANGE_METERS = 30_000;
const MOBILE_SCAN_INHIBITOR_MIN_DISTANCE_FROM_OWN_GROUP_METERS = 100_000;
const MOBILE_SCAN_INHIBITOR_MIN_DISTANCE_FROM_STATION_STARGATE_WORMHOLE_UPWELL_METERS = 75_000;
const MOBILE_SCAN_INHIBITOR_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS = 40_000;
const CUSTOM_INFO_KEY = "evejsMobileScanInhibitor";

const timersByInhibitorID = new Map();

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

function isMobileScanInhibitorType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_DEPLOYABLE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_MOBILE_SCAN_INHIBITOR
    ) || toInt(typeIDOrItem.typeID, 0) === TYPE_MOBILE_SCAN_INHIBITOR;
  }
  return toInt(typeIDOrItem, 0) === TYPE_MOBILE_SCAN_INHIBITOR;
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
    inhibitorID: toInt(state.inhibitorID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
  };
}

function getMobileScanInhibitorStateFromItem(item) {
  if (!item || !isMobileScanInhibitorType(item)) {
    return null;
  }
  const state = getStateFromCustomInfo(item.customInfo);
  if (!state || state.inhibitorID <= 0) {
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
    inhibitorID: toInt(state.inhibitorID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
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
  if (isMobileScanInhibitorType(source)) {
    return "scanInhibitor";
  }

  const typeID = getObjectTypeID(source);
  const metadata = typeID > 0 ? (getItemMetadata(typeID) || {}) : {};
  const groupID = toInt(source && source.groupID, toInt(metadata.groupID, 0));
  const categoryID = toInt(source && source.categoryID, toInt(metadata.categoryID, 0));

  if (
    groupID === GROUP_STARGATE ||
    groupID === GROUP_WORMHOLE ||
    categoryID === CATEGORY_STATION ||
    categoryID === CATEGORY_UPWELL_STRUCTURE
  ) {
    return "stationStargateWormholeUpwell";
  }
  if (groupID === GROUP_CONTROL_TOWER || categoryID === CATEGORY_STARBASE) {
    return "controlTower";
  }
  return null;
}

function getPlacementBlockerMinimumDistance(kind) {
  if (kind === "scanInhibitor") {
    return MOBILE_SCAN_INHIBITOR_MIN_DISTANCE_FROM_OWN_GROUP_METERS;
  }
  if (kind === "stationStargateWormholeUpwell") {
    return MOBILE_SCAN_INHIBITOR_MIN_DISTANCE_FROM_STATION_STARGATE_WORMHOLE_UPWELL_METERS;
  }
  if (kind === "controlTower") {
    return MOBILE_SCAN_INHIBITOR_MIN_DISTANCE_FROM_CONTROL_TOWER_METERS;
  }
  return 0;
}

function getPlacementConflictError(kind) {
  if (kind === "scanInhibitor") {
    return "MOBILE_SCAN_INHIBITOR_TOO_CLOSE_TO_INHIBITOR";
  }
  if (kind === "stationStargateWormholeUpwell") {
    return "MOBILE_SCAN_INHIBITOR_TOO_CLOSE_TO_STATION_STARGATE_WORMHOLE_OR_UPWELL";
  }
  if (kind === "controlTower") {
    return "MOBILE_SCAN_INHIBITOR_TOO_CLOSE_TO_CONTROL_TOWER";
  }
  return "MOBILE_SCAN_INHIBITOR_DEPLOYMENT_BLOCKED";
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
      "stationStargateWormholeUpwell",
    );
  }

  for (const stargate of worldData.getStargatesForSystem(systemID)) {
    append(stargate, "stationStargateWormholeUpwell");
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
      errorMsg: "MOBILE_SCAN_INHIBITOR_DEPLOY_POSITION_UNAVAILABLE",
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

function updateMobileScanInhibitorState(itemID, updater) {
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
      errorMsg: "MOBILE_SCAN_INHIBITOR_STATE_NOT_FOUND",
    };
  }
  const nextState =
    typeof updater === "function" ? updater({ ...currentState }, item) : updater;
  return updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    customInfo: buildCustomInfoWithState(currentItem.customInfo, nextState),
  }));
}

function clearTimers(inhibitorID) {
  const normalizedInhibitorID = toInt(inhibitorID, 0);
  const timerState = timersByInhibitorID.get(normalizedInhibitorID);
  if (!timerState) {
    return;
  }
  if (timerState.activationTimer) {
    clearTimeout(timerState.activationTimer);
  }
  if (timerState.expiryTimer) {
    clearTimeout(timerState.expiryTimer);
  }
  timersByInhibitorID.delete(normalizedInhibitorID);
}

function setUnrefTimeout(callback, delayMs) {
  const timer = setTimeout(callback, Math.max(0, toInt(delayMs, 0)));
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

function clearMobileScanInhibitor(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }
  clearTimers(itemID);

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileScanInhibitorStateFromItem(item);
  if (!state) {
    return false;
  }

  if (findItemById(itemID)) {
    updateMobileScanInhibitorState(itemID, (currentState) => ({
      ...currentState,
      active: false,
      deactivatedAtMs: Date.now(),
    }));
  }
  log.info(`[ScanInhibitor] Cleared inhibitor=${itemID} reason=${reason}`);
  return true;
}

function activateMobileScanInhibitor(itemID) {
  const item = findItemById(itemID);
  const state = getMobileScanInhibitorStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  const now = Date.now();
  if (state.expiresAtMs > 0 && state.expiresAtMs <= now) {
    expireMobileScanInhibitor(itemID, "expired-before-activation");
    return false;
  }
  if (
    toInt(item.locationID, 0) !== state.solarSystemID ||
    toInt(item.flagID, 0) !== 0 ||
    !item.spaceState
  ) {
    clearMobileScanInhibitor(item, "removed-before-activation");
    return false;
  }

  updateMobileScanInhibitorState(itemID, (currentState) => ({
    ...currentState,
    active: true,
    activatedAtMs: now,
  }));
  getSpaceRuntime().refreshInventoryBackedEntityPresentation(state.solarSystemID, itemID);
  scheduleMobileScanInhibitorTimers(itemID);
  log.info(
    `[ScanInhibitor] Activated inhibitor=${itemID} system=${state.solarSystemID}`,
  );
  return true;
}

function expireMobileScanInhibitor(itemID, reason = "expired") {
  const item = findItemById(itemID);
  const state = getMobileScanInhibitorStateFromItem(item);
  const systemID = toInt(
    state && state.solarSystemID,
    toInt(item && item.locationID, 0),
  );
  clearTimers(itemID);

  if (systemID > 0) {
    const destroyResult = getSpaceRuntime().destroyDynamicInventoryEntity(systemID, itemID);
    if (destroyResult && destroyResult.success) {
      log.info(`[ScanInhibitor] Removed inhibitor=${itemID} reason=${reason}`);
      return true;
    }
  }

  const removeResult = removeInventoryItem(itemID, { removeContents: true });
  if (removeResult.success) {
    log.info(`[ScanInhibitor] Removed inhibitor=${itemID} reason=${reason}`);
    return true;
  }
  return false;
}

function scheduleMobileScanInhibitorTimers(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileScanInhibitorStateFromItem(item);
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
      () => expireMobileScanInhibitor(itemID, "expired"),
      state.expiresAtMs - now,
    );
  }

  if (state.active || state.activateAtMs <= now) {
    if (!state.active) {
      nextTimers.activationTimer = setUnrefTimeout(
        () => activateMobileScanInhibitor(itemID),
        0,
      );
    }
  } else {
    nextTimers.activationTimer = setUnrefTimeout(
      () => activateMobileScanInhibitor(itemID),
      state.activateAtMs - now,
    );
  }

  timersByInhibitorID.set(itemID, nextTimers);
  return true;
}

function registerMobileScanInhibitorItem(itemOrID) {
  return scheduleMobileScanInhibitorTimers(itemOrID);
}

function isActiveScanInhibitorState(state, nowMs = Date.now()) {
  if (!state || state.deactivatedAtMs > 0) {
    return false;
  }
  if (state.expiresAtMs > 0 && state.expiresAtMs <= nowMs) {
    return false;
  }
  return state.active === true || (state.activateAtMs > 0 && state.activateAtMs <= nowMs);
}

function hydrateMobileScanInhibitorEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isMobileScanInhibitorType(itemRecord)) {
    return entity;
  }

  const state = getMobileScanInhibitorStateFromItem(itemRecord);
  if (!state) {
    return entity;
  }

  const active = isActiveScanInhibitorState(state, Date.now());
  entity.component_activate = [active, active ? null : state.activateAtMs];
  entity.activate_comp_durationSeconds = Math.trunc(
    MOBILE_SCAN_INHIBITOR_ACTIVATION_DELAY_MS / 1000,
  );
  entity.scanInhibitorRangeMeters = MOBILE_SCAN_INHIBITOR_RANGE_METERS;
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

function validateMobileScanInhibitorLaunch(item, context) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isMobileScanInhibitorType(item)) {
    return "ITEM_NOT_MOBILE_SCAN_INHIBITOR";
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    toInt(item.flagID, 0) !== ITEM_FLAGS.CARGO_HOLD
  ) {
    return "ITEM_NOT_IN_SHIP_CARGO";
  }
  if (getSkillLevel(context.characterID, TYPE_ANCHORING) < 3) {
    return "Mobile Scan Inhibitor deployment requires Anchoring III.";
  }
  return null;
}

function launchMobileScanInhibitorFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateMobileScanInhibitorLaunch(item, context);
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
      `[ScanInhibitor] Launch rejected char=${context.characterID} item=${item.itemID} system=${context.systemID} reason=${placementConflict.errorMsg}`,
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
    inhibitorID: launchedItemID,
    deployedAtMs: now,
    activateAtMs: now + MOBILE_SCAN_INHIBITOR_ACTIVATION_DELAY_MS,
    activatedAtMs: 0,
    expiresAtMs: now + MOBILE_SCAN_INHIBITOR_LIFETIME_MS,
    active: false,
    deactivatedAtMs: 0,
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
      `[ScanInhibitor] Launched inhibitor ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobileScanInhibitorItem(updatedResult.data);
  log.info(
    `[ScanInhibitor] char=${context.characterID} launched inhibitor itemID=${launchedItemID} system=${context.systemID}`,
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

function collectActiveScanInhibitors(systemID, options = {}) {
  const normalizedSystemID = toInt(systemID, 0);
  if (normalizedSystemID <= 0) {
    return [];
  }

  const now = toInt(options.nowMs, Date.now());
  const seen = new Set();
  const candidates = [];
  const appendCandidate = (source) => {
    const itemID = getObjectItemID(source);
    if (itemID > 0 && seen.has(itemID)) {
      return;
    }
    if (itemID > 0) {
      seen.add(itemID);
    }
    if (!isMobileScanInhibitorType(source)) {
      return;
    }
    const item = itemID > 0 ? (findItemById(itemID) || source) : source;
    const state = getMobileScanInhibitorStateFromItem(item);
    if (!isActiveScanInhibitorState(state, now)) {
      return;
    }
    const position = getObjectPosition(item) || getObjectPosition(source);
    if (!position) {
      return;
    }
    candidates.push({
      inhibitorID: itemID,
      typeID: getObjectTypeID(item) || getObjectTypeID(source),
      position,
      rangeMeters: MOBILE_SCAN_INHIBITOR_RANGE_METERS,
    });
  };

  for (const item of listSystemSpaceItems(normalizedSystemID)) {
    appendCandidate(item);
  }

  const scene = options.scene || null;
  if (scene) {
    const dynamicEntities = typeof scene.getDynamicEntities === "function"
      ? scene.getDynamicEntities()
      : scene.dynamicEntities instanceof Map
        ? [...scene.dynamicEntities.values()]
        : [];
    for (const entity of dynamicEntities) {
      appendCandidate(entity);
    }
  }

  return candidates;
}

function findActiveScanInhibitorForPosition(systemID, position, options = {}) {
  const targetPosition = getObjectPosition({ position });
  if (!targetPosition) {
    return null;
  }

  for (const inhibitor of collectActiveScanInhibitors(systemID, options)) {
    const distance = getVectorDistance(targetPosition, inhibitor.position);
    if (distance <= inhibitor.rangeMeters) {
      return {
        ...inhibitor,
        distance,
      };
    }
  }

  return null;
}

function isPositionScanInhibited(systemID, position, options = {}) {
  return Boolean(findActiveScanInhibitorForPosition(systemID, position, options));
}

module.exports = {
  CATEGORY_DEPLOYABLE,
  GROUP_MOBILE_SCAN_INHIBITOR,
  TYPE_MOBILE_SCAN_INHIBITOR,
  MOBILE_SCAN_INHIBITOR_ACTIVATION_DELAY_MS,
  MOBILE_SCAN_INHIBITOR_LIFETIME_MS,
  MOBILE_SCAN_INHIBITOR_RANGE_METERS,
  isMobileScanInhibitorType,
  launchMobileScanInhibitorFromShip,
  registerMobileScanInhibitorItem,
  clearMobileScanInhibitor,
  getMobileScanInhibitorStateFromItem,
  hydrateMobileScanInhibitorEntityFromInventoryItem,
  findActiveScanInhibitorForPosition,
  isPositionScanInhibited,
  _testing: {
    buildDeployableSpawnState,
    buildCustomInfoWithState,
    getStateFromCustomInfo,
    findPlacementConflict,
    collectActiveScanInhibitors,
    getSkillLevel,
    validateMobileScanInhibitorLaunch,
  },
};
