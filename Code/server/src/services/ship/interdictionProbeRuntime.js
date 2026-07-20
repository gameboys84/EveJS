const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  createSpaceItemForOwner,
  getItemMetadata,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));

const CATEGORY_MODULE = 7;
const CATEGORY_CHARGE = 8;
const GROUP_INTERDICTION_SPHERE_LAUNCHER = 589;
const GROUP_WARP_DISRUPTION_PROBE = 548;

const ATTRIBUTE_REQUIRED_SKILL_1 = 182;
const ATTRIBUTE_REQUIRED_SKILL_2 = 183;
const ATTRIBUTE_REQUIRED_SKILL_1_LEVEL = 277;
const ATTRIBUTE_REQUIRED_SKILL_2_LEVEL = 278;
const ATTRIBUTE_WARP_SCRAMBLE_RANGE = 103;
const ATTRIBUTE_DISALLOW_IN_EMPIRE_SPACE = 1074;
const ATTRIBUTE_DISALLOW_IN_HAZARD_SYSTEM = 5561;

const TYPE_WARP_DISRUPT_PROBE = 22778;
const TYPE_SURGICAL_WARP_DISRUPT_PROBE = 34260;
const ZARZAKH_SOLAR_SYSTEM_ID = 30100000;
const CUSTOM_INFO_KEY = "evejsInterdictionProbe";

const CURRENT_SDE_PROBE_LIFETIME_MS_BY_TYPE_ID = Object.freeze({
  [TYPE_WARP_DISRUPT_PROBE]: 2 * 60 * 1000,
  [TYPE_SURGICAL_WARP_DISRUPT_PROBE]: 3 * 60 * 1000,
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

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function getTypeDogmaEntry(typeID) {
  const payload = readStaticTable(TABLE.TYPE_DOGMA) || {};
  const typesByTypeID = payload.typesByTypeID || {};
  return typesByTypeID[String(toInt(typeID, 0))] || null;
}

function getTypeDogmaAttributes(typeID) {
  const entry = getTypeDogmaEntry(typeID);
  return entry && entry.attributes && typeof entry.attributes === "object"
    ? entry.attributes
    : {};
}

function getTypeDogmaAttributeValue(typeID, attributeID, fallback = 0) {
  const attributes = getTypeDogmaAttributes(typeID);
  const key = String(toInt(attributeID, 0));
  if (Object.prototype.hasOwnProperty.call(attributes, key)) {
    return toReal(attributes[key], fallback);
  }
  return fallback;
}

function getTypeName(typeID) {
  const metadata = getItemMetadata(typeID) || {};
  return String(metadata.name || `type ${typeID}`);
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
    // Keep opaque legacy customInfo values instead of discarding them.
  }
  return {
    legacyCustomInfo: text,
  };
}

function buildCustomInfoWithState(customInfo, state) {
  const parsed = parseCustomInfo(customInfo);
  parsed[CUSTOM_INFO_KEY] = {
    ownerID: toInt(state.ownerID, 0),
    launcherCharacterID: toInt(state.launcherCharacterID, 0),
    sourceShipID: toInt(state.sourceShipID, 0),
    sourceModuleID: toInt(state.sourceModuleID, 0),
    solarSystemID: toInt(state.solarSystemID, 0),
    probeID: toInt(state.probeID, 0),
    launchedAtMs: toInt(state.launchedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active !== false,
    rangeMeters: toReal(state.rangeMeters, 0),
  };
  return JSON.stringify(parsed);
}

function getStateFromCustomInfo(customInfo) {
  const parsed = parseCustomInfo(customInfo);
  const state = parsed && parsed[CUSTOM_INFO_KEY];
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }
  return {
    ownerID: toInt(state.ownerID, 0),
    launcherCharacterID: toInt(state.launcherCharacterID, 0),
    sourceShipID: toInt(state.sourceShipID, 0),
    sourceModuleID: toInt(state.sourceModuleID, 0),
    solarSystemID: toInt(state.solarSystemID, 0),
    probeID: toInt(state.probeID, 0),
    launchedAtMs: toInt(state.launchedAtMs, 0),
    expiresAtMs: toInt(state.expiresAtMs, 0),
    active: state.active !== false,
    rangeMeters: toReal(state.rangeMeters, 0),
  };
}

function isInterdictionSphereLauncherType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_MODULE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_INTERDICTION_SPHERE_LAUNCHER
    ) || isInterdictionSphereLauncherType(toInt(typeIDOrItem.typeID, 0));
  }

  const typeID = toInt(typeIDOrItem, 0);
  if (typeID <= 0) {
    return false;
  }
  const metadata = getItemMetadata(typeID) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_MODULE &&
    toInt(metadata.groupID, 0) === GROUP_INTERDICTION_SPHERE_LAUNCHER
  );
}

function getWarpDisruptionRangeMeters(typeID) {
  return Math.max(0, getTypeDogmaAttributeValue(typeID, ATTRIBUTE_WARP_SCRAMBLE_RANGE, 0));
}

function getProbeLifetimeMs(typeID) {
  return Math.max(
    0,
    toInt(CURRENT_SDE_PROBE_LIFETIME_MS_BY_TYPE_ID[toInt(typeID, 0)], 0),
  );
}

function isWarpDisruptionProbeType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    const typeID = toInt(typeIDOrItem.typeID, 0);
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_CHARGE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_WARP_DISRUPTION_PROBE &&
      getWarpDisruptionRangeMeters(typeID) > 0 &&
      getProbeLifetimeMs(typeID) > 0
    );
  }

  const typeID = toInt(typeIDOrItem, 0);
  if (typeID <= 0) {
    return false;
  }
  const metadata = getItemMetadata(typeID) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_CHARGE &&
    toInt(metadata.groupID, 0) === GROUP_WARP_DISRUPTION_PROBE &&
    getWarpDisruptionRangeMeters(typeID) > 0 &&
    getProbeLifetimeMs(typeID) > 0
  );
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

function validateRequiredSkills(characterID, typeID) {
  const attributes = getTypeDogmaAttributes(typeID);
  const requirements = [
    [ATTRIBUTE_REQUIRED_SKILL_1, ATTRIBUTE_REQUIRED_SKILL_1_LEVEL],
    [ATTRIBUTE_REQUIRED_SKILL_2, ATTRIBUTE_REQUIRED_SKILL_2_LEVEL],
  ];
  for (const [skillAttributeID, levelAttributeID] of requirements) {
    const skillTypeID = toInt(attributes[String(skillAttributeID)], 0);
    const requiredLevel = toInt(attributes[String(levelAttributeID)], 0);
    if (skillTypeID <= 0 || requiredLevel <= 0) {
      continue;
    }
    const trainedLevel = getSkillLevel(characterID, skillTypeID);
    if (trainedLevel < requiredLevel) {
      return `${getTypeName(typeID)} launch requires ${getTypeName(skillTypeID)} ${requiredLevel}.`;
    }
  }
  return null;
}

function getSystemSecurity(systemID) {
  const system = worldData.getSolarSystemByID(systemID);
  if (!system) {
    return null;
  }
  return toReal(system.security ?? system.securityStatus, 0);
}

function getActivationRestriction(systemID, moduleTypeID, chargeTypeID) {
  const checkedTypeIDs = [moduleTypeID, chargeTypeID]
    .map((typeID) => toInt(typeID, 0))
    .filter((typeID) => typeID > 0);
  const disallowInEmpire = checkedTypeIDs.some((typeID) =>
    getTypeDogmaAttributeValue(typeID, ATTRIBUTE_DISALLOW_IN_EMPIRE_SPACE, 0) > 0
  );
  if (disallowInEmpire) {
    const security = getSystemSecurity(systemID);
    if (security === null) {
      return "Solar system data is unavailable for this launch.";
    }
    if (security > 0) {
      return "Warp Disrupt Probes cannot be launched in empire space.";
    }
  }

  const disallowInHazard = checkedTypeIDs.some((typeID) =>
    getTypeDogmaAttributeValue(typeID, ATTRIBUTE_DISALLOW_IN_HAZARD_SYSTEM, 0) > 0
  );
  if (disallowInHazard && toInt(systemID, 0) === ZARZAKH_SOLAR_SYSTEM_ID) {
    return "Warp Disrupt Probes cannot be launched in Zarzakh.";
  }

  return null;
}

function getSessionContext(session) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
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
    ownerID: characterID,
    shipID,
    systemID,
  };
}

function validateInterdictionProbeLaunchContext(session, moduleItem, loadedCharge) {
  const context = getSessionContext(session);
  if (!session || !session._space || !context.characterID || !context.shipID || !context.systemID) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
      data: { context },
    };
  }
  if (!moduleItem || !isInterdictionSphereLauncherType(moduleItem)) {
    return {
      success: false,
      errorMsg: "INVALID_LAUNCHER",
      data: { context },
    };
  }
  if (toInt(moduleItem.locationID, 0) !== context.shipID) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_FOUND",
      data: { context },
    };
  }
  if (!loadedCharge) {
    return {
      success: false,
      errorMsg: "NO_CHARGES",
      data: { context },
    };
  }
  if (!isWarpDisruptionProbeType(loadedCharge)) {
    return {
      success: false,
      errorMsg: "INVALID_CHARGE",
      data: { context },
    };
  }
  const availableQuantity = Math.max(
    0,
    toInt(loadedCharge.stacksize ?? loadedCharge.quantity, 0),
  );
  if (availableQuantity < 1) {
    return {
      success: false,
      errorMsg: "NO_CHARGES",
      data: { context },
    };
  }

  const moduleTypeID = toInt(moduleItem.typeID, 0);
  const chargeTypeID = toInt(loadedCharge.typeID, 0);
  const skillRestriction = validateRequiredSkills(context.characterID, chargeTypeID);
  if (skillRestriction) {
    return {
      success: false,
      errorMsg: skillRestriction,
      data: { context },
    };
  }
  const activationRestriction = getActivationRestriction(
    context.systemID,
    moduleTypeID,
    chargeTypeID,
  );
  if (activationRestriction) {
    return {
      success: false,
      errorMsg: activationRestriction,
      data: { context },
    };
  }

  return {
    success: true,
    data: {
      context,
      rangeMeters: getWarpDisruptionRangeMeters(chargeTypeID),
      lifetimeMs: getProbeLifetimeMs(chargeTypeID),
    },
  };
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
    if (
      candidate &&
      typeof candidate === "object" &&
      Number.isFinite(Number(candidate.x)) &&
      Number.isFinite(Number(candidate.y)) &&
      Number.isFinite(Number(candidate.z))
    ) {
      return normalizeVector(candidate);
    }
  }
  return null;
}

function buildProbeSpawnState(session, context) {
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

  return {
    systemID: context.systemID,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  };
}

function hydrateInterdictionProbeEntityFromInventoryItem(entity, itemRecord) {
  if (!entity || !isWarpDisruptionProbeType(itemRecord)) {
    return entity;
  }

  const state = getStateFromCustomInfo(itemRecord.customInfo);
  if (!state) {
    return entity;
  }
  const now = Date.now();
  const rangeMeters = Math.max(
    0,
    toReal(state.rangeMeters, getWarpDisruptionRangeMeters(itemRecord.typeID)),
  );
  const active = state.active !== false &&
    (state.expiresAtMs <= 0 || state.expiresAtMs > now) &&
    rangeMeters > 0;

  entity.kind = "probe";
  entity.isFree = true;
  entity.mode = "STOP";
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.speedFraction = 0;
  entity.ownerID = toInt(state.ownerID, toInt(itemRecord.ownerID, entity.ownerID || 0));
  entity.sourceShipID = state.sourceShipID || entity.sourceShipID || 0;
  entity.sourceModuleID = state.sourceModuleID || entity.sourceModuleID || 0;
  entity.warpDisruptionStartTimeMs = state.launchedAtMs || toInt(itemRecord.createdAtMs, 0);
  entity.warpDisruptionRangeMeters = rangeMeters;
  entity.warpDisruptionActive = active;
  entity.expiresAtMs = state.expiresAtMs || toInt(itemRecord.expiresAtMs, 0) || null;
  entity.interdictionProbeState = state;
  entity.slimTypeID = toInt(itemRecord.typeID, entity.slimTypeID || 0);
  entity.slimGroupID = GROUP_WARP_DISRUPTION_PROBE;
  entity.slimCategoryID = CATEGORY_CHARGE;
  return entity;
}

function isActiveInterdictionProbeState(state, nowMs = Date.now()) {
  if (!state || state.active === false) {
    return false;
  }
  if (state.expiresAtMs > 0 && state.expiresAtMs <= nowMs) {
    return false;
  }
  return state.rangeMeters > 0;
}

function getInterdictionProbeStateFromSource(source) {
  if (!source || !isWarpDisruptionProbeType(source)) {
    return null;
  }
  const itemState = getStateFromCustomInfo(source.customInfo);
  if (itemState) {
    return itemState;
  }
  if (source.interdictionProbeState && typeof source.interdictionProbeState === "object") {
    return {
      ...source.interdictionProbeState,
      rangeMeters: toReal(
        source.interdictionProbeState.rangeMeters,
        toReal(source.warpDisruptionRangeMeters, getWarpDisruptionRangeMeters(source.typeID)),
      ),
    };
  }
  if (source.warpDisruptionActive !== false && source.warpDisruptionStartTimeMs) {
    return {
      ownerID: toInt(source.ownerID, 0),
      launcherCharacterID: toInt(source.ownerID, 0),
      sourceShipID: toInt(source.sourceShipID, 0),
      sourceModuleID: toInt(source.sourceModuleID, 0),
      solarSystemID: toInt(source.systemID || source.locationID, 0),
      probeID: toInt(source.itemID, 0),
      launchedAtMs: toInt(source.warpDisruptionStartTimeMs, 0),
      expiresAtMs: toInt(source.expiresAtMs, 0),
      active: true,
      rangeMeters: toReal(source.warpDisruptionRangeMeters, getWarpDisruptionRangeMeters(source.typeID)),
    };
  }
  return null;
}

function buildActiveWarpDisruptorCandidate(source, options = {}) {
  if (!source || !isWarpDisruptionProbeType(source)) {
    return null;
  }
  const now = toInt(options.nowMs, Date.now());
  const state = getInterdictionProbeStateFromSource(source);
  if (!isActiveInterdictionProbeState(state, now)) {
    return null;
  }
  const position = getObjectPosition(source);
  const rangeMeters = Math.max(
    0,
    toReal(state.rangeMeters, getWarpDisruptionRangeMeters(source.typeID)),
  );
  if (!position || rangeMeters <= 0) {
    return null;
  }
  return {
    disruptorID: toInt(state.probeID, toInt(source.itemID, 0)),
    typeID: toInt(source.typeID, 0),
    ownerID: toInt(state.ownerID, toInt(source.ownerID, 0)),
    sourceShipID: toInt(state.sourceShipID, 0),
    sourceModuleID: toInt(state.sourceModuleID, 0),
    position,
    rangeMeters,
    source: "interdictionProbe",
  };
}

function removeInterdictionProbe(itemID, systemID = 0, reason = "removed") {
  const normalizedItemID = toInt(itemID, 0);
  if (!normalizedItemID) {
    return false;
  }
  const normalizedSystemID = toInt(systemID, 0);
  if (normalizedSystemID > 0) {
    const destroyResult = getSpaceRuntime().destroyDynamicInventoryEntity(
      normalizedSystemID,
      normalizedItemID,
    );
    if (destroyResult && destroyResult.success) {
      return true;
    }
  }
  const removeResult = removeInventoryItem(normalizedItemID, { removeContents: true });
  if (!removeResult.success) {
    log.warn(
      `[InterdictionProbe] Failed to remove probe itemID=${normalizedItemID} reason=${reason} error=${removeResult.errorMsg}`,
    );
  }
  return removeResult.success === true;
}

function launchInterdictionProbeFromModule(session, moduleItem, loadedCharge, options = {}) {
  const validation = validateInterdictionProbeLaunchContext(session, moduleItem, loadedCharge);
  if (validation.success !== true) {
    return validation;
  }

  const context = validation.data.context;
  const spawnState = buildProbeSpawnState(session, context);
  if (!spawnState) {
    return {
      success: false,
      errorMsg: "INTERDICTION_PROBE_POSITION_UNAVAILABLE",
    };
  }

  const now = toInt(options.nowMs, Date.now());
  const chargeTypeID = toInt(loadedCharge.typeID, 0);
  const lifetimeMs = validation.data.lifetimeMs;
  const rangeMeters = validation.data.rangeMeters;
  const state = {
    ownerID: context.ownerID,
    launcherCharacterID: context.characterID,
    sourceShipID: context.shipID,
    sourceModuleID: toInt(moduleItem.itemID, 0),
    solarSystemID: context.systemID,
    probeID: 0,
    launchedAtMs: now,
    expiresAtMs: now + lifetimeMs,
    active: true,
    rangeMeters,
  };

  const createResult = createSpaceItemForOwner(
    context.ownerID,
    context.systemID,
    chargeTypeID,
    {
      customInfo: buildCustomInfoWithState("", state),
      createdAtMs: now,
      expiresAtMs: state.expiresAtMs,
      position: spawnState.position,
      velocity: spawnState.velocity,
      direction: spawnState.direction,
      targetPoint: spawnState.targetPoint,
      mode: spawnState.mode,
      speedFraction: spawnState.speedFraction,
      spaceRadius: Math.max(1, toReal((getItemMetadata(chargeTypeID) || {}).radius, 1)),
    },
  );
  if (!createResult.success || !createResult.data) {
    return {
      success: false,
      errorMsg: createResult.errorMsg || "INTERDICTION_PROBE_CREATE_FAILED",
    };
  }

  const probeItem = createResult.data;
  const probeID = toInt(probeItem.itemID, 0);
  state.probeID = probeID;
  const updateResult = updateInventoryItem(probeID, (currentItem) => ({
    ...currentItem,
    customInfo: buildCustomInfoWithState(currentItem.customInfo, state),
  }));
  const spawnedItem = updateResult.success && updateResult.data ? updateResult.data : probeItem;
  const spawnResult = getSpaceRuntime().spawnDynamicInventoryEntity(context.systemID, probeID);
  if (!spawnResult || !spawnResult.success) {
    removeInterdictionProbe(probeID, context.systemID, "spawn-failed");
    return {
      success: false,
      errorMsg: spawnResult && spawnResult.errorMsg
        ? spawnResult.errorMsg
        : "INTERDICTION_PROBE_SPAWN_FAILED",
    };
  }

  log.info(
    `[InterdictionProbe] char=${context.characterID} launched probe itemID=${probeID} ` +
    `system=${context.systemID} range=${rangeMeters} expiresAtMs=${state.expiresAtMs}`,
  );

  return {
    success: true,
    data: {
      itemID: probeID,
      sourceModuleID: toInt(moduleItem.itemID, 0),
      chargeTypeID,
      state,
      item: spawnedItem,
    },
  };
}

module.exports = {
  CATEGORY_CHARGE,
  GROUP_INTERDICTION_SPHERE_LAUNCHER,
  GROUP_WARP_DISRUPTION_PROBE,
  TYPE_WARP_DISRUPT_PROBE,
  TYPE_SURGICAL_WARP_DISRUPT_PROBE,
  CURRENT_SDE_PROBE_LIFETIME_MS_BY_TYPE_ID,
  isInterdictionSphereLauncherType,
  isWarpDisruptionProbeType,
  getWarpDisruptionRangeMeters,
  getProbeLifetimeMs,
  validateInterdictionProbeLaunchContext,
  launchInterdictionProbeFromModule,
  removeInterdictionProbe,
  hydrateInterdictionProbeEntityFromInventoryItem,
  getInterdictionProbeStateFromSource,
  buildActiveWarpDisruptorCandidate,
  _testing: {
    buildCustomInfoWithState,
    getStateFromCustomInfo,
    buildProbeSpawnState,
    getActivationRestriction,
    validateRequiredSkills,
  },
};
