const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  transferItemToOwnerLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));
const {
  isTriglavianSolarSystemID,
  isWormholeSolarSystemID,
} = require(path.join(__dirname, "../chat/channelRules"));

const CATEGORY_DEPLOYABLE = 22;
const GROUP_MOBILE_CYNOSURAL_BEACON = 4093;

const TYPE_MOBILE_CYNOSURAL_BEACON = 57319;
const TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON = 58906;
const TYPE_COVERT_MOBILE_CYNOSURAL_BEACON = 59630;
const TYPE_ANCHORING = 11584;
const TYPE_CYNOSURAL_FIELD_THEORY = 21603;

const MOBILE_CYNOSURAL_BEACON_TYPES = new Set([
  TYPE_MOBILE_CYNOSURAL_BEACON,
  TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON,
  TYPE_COVERT_MOBILE_CYNOSURAL_BEACON,
]);

const DEPLOY_DISTANCE_METERS = 2_500;
const MOBILE_CYNO_ACTIVATION_DELAY_MS = 2 * 60 * 1000;
const MOBILE_CYNO_LIFETIME_MS = 60 * 60 * 1000;
const COVERT_MOBILE_CYNO_ACTIVATION_DELAY_MS = 60 * 1000;
const COVERT_MOBILE_CYNO_LIFETIME_MS = 30 * 60 * 1000;
const MOBILE_CYNO_SECURITY_CUTOFF = 0.45;
const CUSTOM_INFO_KEY = "evejsDeployableCyno";

const timersByDeployableID = new Map();

const STANDARD_MOBILE_CYNO_REQUIRED_SKILLS = Object.freeze([
  Object.freeze({
    typeID: TYPE_ANCHORING,
    level: 3,
    name: "Anchoring",
    levelLabel: "III",
  }),
]);

const COVERT_MOBILE_CYNO_REQUIRED_SKILLS = Object.freeze([
  Object.freeze({
    typeID: TYPE_ANCHORING,
    level: 5,
    name: "Anchoring",
    levelLabel: "V",
  }),
  Object.freeze({
    typeID: TYPE_CYNOSURAL_FIELD_THEORY,
    level: 5,
    name: "Cynosural Field Theory",
    levelLabel: "V",
  }),
]);

const MOBILE_CYNO_DEPLOYABLE_PROFILES = Object.freeze({
  [TYPE_MOBILE_CYNOSURAL_BEACON]: Object.freeze({
    typeID: TYPE_MOBILE_CYNOSURAL_BEACON,
    name: "Mobile Cynosural Beacon",
    activationDelayMs: MOBILE_CYNO_ACTIVATION_DELAY_MS,
    lifetimeMs: MOBILE_CYNO_LIFETIME_MS,
    requiredSkills: STANDARD_MOBILE_CYNO_REQUIRED_SKILLS,
    covert: false,
  }),
  [TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON]: Object.freeze({
    typeID: TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON,
    name: "Highsec Authorized Mobile Cynosural Beacon",
    activationDelayMs: MOBILE_CYNO_ACTIVATION_DELAY_MS,
    lifetimeMs: MOBILE_CYNO_LIFETIME_MS,
    requiredSkills: STANDARD_MOBILE_CYNO_REQUIRED_SKILLS,
    covert: false,
  }),
  [TYPE_COVERT_MOBILE_CYNOSURAL_BEACON]: Object.freeze({
    typeID: TYPE_COVERT_MOBILE_CYNOSURAL_BEACON,
    name: "Covert Mobile Cynosural Beacon",
    activationDelayMs: COVERT_MOBILE_CYNO_ACTIVATION_DELAY_MS,
    lifetimeMs: COVERT_MOBILE_CYNO_LIFETIME_MS,
    requiredSkills: COVERT_MOBILE_CYNO_REQUIRED_SKILLS,
    covert: true,
  }),
});

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

function isMobileCynoDeployableType(typeID) {
  return MOBILE_CYNOSURAL_BEACON_TYPES.has(toInt(typeID, 0));
}

function getInternalMobileCynoDeployableProfile(typeID) {
  return MOBILE_CYNO_DEPLOYABLE_PROFILES[toInt(typeID, 0)] || null;
}

function getMobileCynoDeployableProfile(typeID) {
  const profile = getInternalMobileCynoDeployableProfile(typeID);
  if (!profile) {
    return null;
  }
  return {
    ...profile,
    requiredSkills: profile.requiredSkills.map((requirement) => ({ ...requirement })),
  };
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
  const fleetID = toInt(session && session.fleetid, 0);

  return {
    characterID,
    corporationID,
    // Deploy components call Drop through both legacy menu and component menu
    // paths. Missing whoseBehalfID should still deploy for the character.
    ownerID: behalfOwnerID || characterID,
    shipID,
    systemID,
    fleetID,
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

function getMissingSkillRequirement(characterID, profile) {
  for (const requirement of profile && Array.isArray(profile.requiredSkills)
    ? profile.requiredSkills
    : []) {
    if (getSkillLevel(characterID, requirement.typeID) < requirement.level) {
      return requirement;
    }
  }
  return null;
}

function formatSkillRequirementMessage(profile, requirement) {
  return `${profile.name} deployment requires ${requirement.name} ${requirement.levelLabel}.`;
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
    return "Mobile Cynosural Beacons cannot be deployed in Abyssal space.";
  }
  if (isWormholeSolarSystemID(context.systemID)) {
    return "Mobile Cynosural Beacons cannot be deployed in wormhole space.";
  }
  if (isTriglavianSolarSystemID(context.systemID)) {
    return "Mobile Cynosural Beacons cannot be deployed in Pochven.";
  }

  const system = worldData.getSolarSystemByID(context.systemID);
  if (!system) {
    return "Solar system data is unavailable for this deployment.";
  }
  if (getSolarSystemSecurity(system) >= MOBILE_CYNO_SECURITY_CUTOFF) {
    return "Mobile Cynosural Beacons can only be deployed below 0.5 security.";
  }

  return null;
}

function buildDeployableSpawnState(session, context) {
  const shipEntity =
    session && context.shipID
      ? getSpaceRuntime().getEntity(session, context.shipID)
      : null;
  const position = normalizeVector(
    shipEntity && shipEntity.position,
    { x: 0, y: 0, z: 0 },
  );
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
    fleetID: toInt(state.fleetID, 0),
    ownerID: toInt(state.ownerID, 0),
    deployerCharacterID: toInt(state.deployerCharacterID, 0),
    solarSystemID: toInt(state.solarSystemID, 0),
    deployableID: toInt(state.deployableID, 0),
    beaconID: toInt(state.beaconID, 0),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
  };
}

function getMobileCynoStateFromItem(item) {
  if (!item || !isMobileCynoDeployableType(item.typeID)) {
    return null;
  }
  const state = getStateFromCustomInfo(item.customInfo);
  if (!state || state.deployableID <= 0 || state.fleetID <= 0) {
    return null;
  }
  return state;
}

function buildCustomInfoWithState(customInfo, state) {
  const parsed = parseCustomInfo(customInfo);
  parsed[CUSTOM_INFO_KEY] = {
    fleetID: toInt(state.fleetID, 0),
    ownerID: toInt(state.ownerID, 0),
    deployerCharacterID: toInt(state.deployerCharacterID, 0),
    solarSystemID: toInt(state.solarSystemID, 0),
    deployableID: toInt(state.deployableID, 0),
    beaconID: toInt(state.beaconID, toInt(state.deployableID, 0)),
    deployedAtMs: toInt(state.deployedAtMs, 0),
    activateAtMs: toInt(state.activateAtMs, 0),
    activatedAtMs: toInt(state.activatedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active === true,
    deactivatedAtMs: toInt(state.deactivatedAtMs, 0),
  };
  return JSON.stringify(parsed);
}

function updateMobileCynoState(itemID, updater) {
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
      errorMsg: "MOBILE_CYNO_STATE_NOT_FOUND",
    };
  }
  const nextState =
    typeof updater === "function" ? updater({ ...currentState }, item) : updater;
  return updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    customInfo: buildCustomInfoWithState(currentItem.customInfo, nextState),
  }));
}

function clearTimers(deployableID) {
  const normalizedDeployableID = toInt(deployableID, 0);
  const timerState = timersByDeployableID.get(normalizedDeployableID);
  if (!timerState) {
    return;
  }
  if (timerState.activationTimer) {
    clearTimeout(timerState.activationTimer);
  }
  if (timerState.expiryTimer) {
    clearTimeout(timerState.expiryTimer);
  }
  timersByDeployableID.delete(normalizedDeployableID);
}

function setUnrefTimeout(callback, delayMs) {
  const timer = setTimeout(callback, Math.max(0, toInt(delayMs, 0)));
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

function setFleetDeployableBeaconState(state, active) {
  try {
    return fleetRuntime.setJumpBeaconDeployableState(
      state.fleetID,
      state.deployableID,
      state.solarSystemID,
      state.beaconID || state.deployableID,
      state.ownerID || state.deployerCharacterID,
      active === true,
    );
  } catch (error) {
    log.warn(
      `[DeployableCyno] Failed to ${active ? "activate" : "clear"} fleet beacon deployable=${state.deployableID} fleet=${state.fleetID}: ${error.message}`,
    );
    return false;
  }
}

function clearMobileCynoDeployable(itemOrID, reason = "cleared") {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  if (!itemID) {
    return false;
  }
  clearTimers(itemID);

  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileCynoStateFromItem(item);
  if (!state) {
    return false;
  }

  setFleetDeployableBeaconState(state, false);
  if (findItemById(itemID)) {
    updateMobileCynoState(itemID, (currentState) => ({
      ...currentState,
      active: false,
      deactivatedAtMs: Date.now(),
    }));
  }
  log.info(`[DeployableCyno] Cleared mobile cyno deployable=${itemID} reason=${reason}`);
  return true;
}

function activateMobileCynoDeployable(itemID) {
  const item = findItemById(itemID);
  const state = getMobileCynoStateFromItem(item);
  if (!state) {
    clearTimers(itemID);
    return false;
  }

  const now = Date.now();
  if (state.expiresAtMs > 0 && state.expiresAtMs <= now) {
    clearMobileCynoDeployable(item, "expired-before-activation");
    return false;
  }
  if (
    toInt(item.locationID, 0) !== state.solarSystemID ||
    toInt(item.flagID, 0) !== 0 ||
    !item.spaceState
  ) {
    clearMobileCynoDeployable(item, "removed-before-activation");
    return false;
  }

  setFleetDeployableBeaconState(state, true);
  updateMobileCynoState(itemID, (currentState) => ({
    ...currentState,
    active: true,
    activatedAtMs: now,
  }));
  scheduleMobileCynoTimers(itemID);
  log.info(
    `[DeployableCyno] Activated mobile cyno deployable=${itemID} fleet=${state.fleetID} system=${state.solarSystemID}`,
  );
  return true;
}

function scheduleMobileCynoTimers(itemOrID) {
  const itemID = toInt(itemOrID && itemOrID.itemID ? itemOrID.itemID : itemOrID, 0);
  const item = itemOrID && itemOrID.itemID ? itemOrID : findItemById(itemID);
  const state = getMobileCynoStateFromItem(item);
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
      () => clearMobileCynoDeployable(itemID, "expired"),
      state.expiresAtMs - now,
    );
  }

  if (state.active || state.activateAtMs <= now) {
    if (!state.active) {
      nextTimers.activationTimer = setUnrefTimeout(
        () => activateMobileCynoDeployable(itemID),
        0,
      );
    } else {
      setFleetDeployableBeaconState(state, true);
    }
  } else {
    nextTimers.activationTimer = setUnrefTimeout(
      () => activateMobileCynoDeployable(itemID),
      state.activateAtMs - now,
    );
  }

  timersByDeployableID.set(itemID, nextTimers);
  return true;
}

function registerMobileCynoDeployableItem(itemOrID) {
  return scheduleMobileCynoTimers(itemOrID);
}

function isActiveMobileCynoDeployableState(state, nowMs = Date.now()) {
  if (!state || state.deactivatedAtMs > 0) {
    return false;
  }
  if (state.expiresAtMs > 0 && state.expiresAtMs <= nowMs) {
    return false;
  }
  return state.active === true || (state.activateAtMs > 0 && state.activateAtMs <= nowMs);
}

function hydrateMobileCynoDeployableEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !itemRecord || !isMobileCynoDeployableType(itemRecord.typeID)) {
    return entity;
  }

  const profile = getInternalMobileCynoDeployableProfile(itemRecord.typeID);
  const state = getMobileCynoStateFromItem(itemRecord);
  if (!profile || !state) {
    return entity;
  }

  const active = isActiveMobileCynoDeployableState(state, Date.now());
  entity.component_activate = [active, active ? null : state.activateAtMs];
  entity.activate_comp_durationSeconds = Math.trunc(profile.activationDelayMs / 1000);
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

function validateDeployableCynoLaunch(session, item, context) {
  if (!context.characterID || !context.ownerID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (
    toInt(item.categoryID, 0) !== CATEGORY_DEPLOYABLE ||
    toInt(item.groupID, 0) !== GROUP_MOBILE_CYNOSURAL_BEACON ||
    !isMobileCynoDeployableType(item.typeID)
  ) {
    return "ITEM_NOT_MOBILE_CYNO";
  }
  if (
    ![context.characterID, context.corporationID, context.ownerID].includes(toInt(item.ownerID, 0)) ||
    toInt(item.locationID, 0) !== context.shipID ||
    toInt(item.flagID, 0) !== ITEM_FLAGS.CARGO_HOLD
  ) {
    return "ITEM_NOT_IN_SHIP_CARGO";
  }
  if (context.fleetID <= 0) {
    return "CannotDeployRequireFleet";
  }

  const profile = getInternalMobileCynoDeployableProfile(item.typeID);
  if (!profile) {
    return "ITEM_NOT_MOBILE_CYNO";
  }
  const missingSkill = getMissingSkillRequirement(context.characterID, profile);
  if (missingSkill) {
    return formatSkillRequirementMessage(profile, missingSkill);
  }

  return getDeploymentRestriction(session, context);
}

function launchMobileCynoDeployableFromShip(session, itemID, options = {}) {
  const context = getSessionContext(session, options);
  const item = findItemById(itemID);
  const validationError = validateDeployableCynoLaunch(session, item, context);
  if (validationError) {
    return {
      success: false,
      errorMsg: validationError,
    };
  }

  const sourceTypeID = toInt(item.typeID, 0);
  const profile = getInternalMobileCynoDeployableProfile(sourceTypeID);
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
    fleetID: context.fleetID,
    ownerID: context.characterID,
    deployerCharacterID: context.characterID,
    solarSystemID: context.systemID,
    deployableID: launchedItemID,
    beaconID: launchedItemID,
    deployedAtMs: now,
    activateAtMs: now + profile.activationDelayMs,
    activatedAtMs: 0,
    expiresAtMs: now + profile.lifetimeMs,
    active: false,
    deactivatedAtMs: 0,
  };
  const spawnState = buildDeployableSpawnState(session, context);
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
      `[DeployableCyno] Launched deployable ${launchedItemID} but space spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN"}`,
    );
  }

  registerMobileCynoDeployableItem(updatedResult.data);
  log.info(
    `[DeployableCyno] char=${context.characterID} launched mobile cyno itemID=${launchedItemID} typeID=${sourceTypeID} fleet=${context.fleetID} system=${context.systemID}`,
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
  GROUP_MOBILE_CYNOSURAL_BEACON,
  TYPE_MOBILE_CYNOSURAL_BEACON,
  TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON,
  TYPE_COVERT_MOBILE_CYNOSURAL_BEACON,
  TYPE_ANCHORING,
  TYPE_CYNOSURAL_FIELD_THEORY,
  MOBILE_CYNO_ACTIVATION_DELAY_MS,
  MOBILE_CYNO_LIFETIME_MS,
  COVERT_MOBILE_CYNO_ACTIVATION_DELAY_MS,
  COVERT_MOBILE_CYNO_LIFETIME_MS,
  isMobileCynoDeployableType,
  launchMobileCynoDeployableFromShip,
  registerMobileCynoDeployableItem,
  clearMobileCynoDeployable,
  getMobileCynoStateFromItem,
  getMobileCynoDeployableProfile,
  hydrateMobileCynoDeployableEntityFromInventoryItem,
  _testing: {
    buildCustomInfoWithState,
    getStateFromCustomInfo,
    getDeploymentRestriction,
    getMissingSkillRequirement,
    getMobileCynoDeployableProfile,
    getSkillLevel,
    hydrateMobileCynoDeployableEntityFromInventoryItem,
    isActiveMobileCynoDeployableState,
    isAbyssalSession,
    validateDeployableCynoLaunch,
  },
};
