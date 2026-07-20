const path = require("path");

const {
  getItemMetadata,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const worldData = require(path.join(__dirname, "../../space/worldData"));

const CATEGORY_MODULE = 7;
const CATEGORY_CHARGE = 8;
const GROUP_WARP_DISRUPT_FIELD_GENERATOR = 899;
const GROUP_WARP_DISRUPTION_SCRIPT = 908;
const EFFECT_WARP_DISRUPT_SPHERE = 3380;
const EFFECT_SHIP_MODULE_FOCUSED_WARP_SCRAMBLING_SCRIPT = 6848;
const EFFECT_SHIP_MODULE_FOCUSED_WARP_DISRUPTION_SCRIPT = 6849;
const TYPE_FOCUSED_WARP_DISRUPTION_SCRIPT = 29003;
const TYPE_FOCUSED_WARP_SCRAMBLING_SCRIPT = 45010;
const ATTRIBUTE_WARP_SCRAMBLE_RANGE = 103;
const ATTRIBUTE_DISALLOW_IN_EMPIRE_SPACE = 1074;
const ATTRIBUTE_DISALLOW_IN_HAZARD_SYSTEM = 5561;
const ZARZAKH_SOLAR_SYSTEM_ID = 30100000;

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

function isWarpDisruptFieldGeneratorType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_MODULE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_WARP_DISRUPT_FIELD_GENERATOR
    ) || isWarpDisruptFieldGeneratorType(toInt(typeIDOrItem.typeID, 0));
  }

  const typeID = toInt(typeIDOrItem, 0);
  if (typeID <= 0) {
    return false;
  }
  const metadata = getItemMetadata(typeID) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_MODULE &&
    toInt(metadata.groupID, 0) === GROUP_WARP_DISRUPT_FIELD_GENERATOR
  );
}

function isWarpDisruptionScriptType(typeIDOrItem) {
  if (typeIDOrItem && typeof typeIDOrItem === "object") {
    return (
      toInt(typeIDOrItem.categoryID, 0) === CATEGORY_CHARGE &&
      toInt(typeIDOrItem.groupID, 0) === GROUP_WARP_DISRUPTION_SCRIPT
    ) || isWarpDisruptionScriptType(toInt(typeIDOrItem.typeID, 0));
  }

  const typeID = toInt(typeIDOrItem, 0);
  if (typeID <= 0) {
    return false;
  }
  const metadata = getItemMetadata(typeID) || {};
  return (
    toInt(metadata.categoryID, 0) === CATEGORY_CHARGE &&
    toInt(metadata.groupID, 0) === GROUP_WARP_DISRUPTION_SCRIPT
  );
}

function getFocusedWarpDisruptionScriptMode(typeIDOrItem) {
  const typeID = toInt(
    typeIDOrItem && typeof typeIDOrItem === "object"
      ? typeIDOrItem.typeID
      : typeIDOrItem,
    0,
  );
  switch (typeID) {
    case TYPE_FOCUSED_WARP_DISRUPTION_SCRIPT:
      return "disrupt";
    case TYPE_FOCUSED_WARP_SCRAMBLING_SCRIPT:
      return "scram";
    default:
      return null;
  }
}

function isSupportedFocusedWarpDisruptionScriptType(typeIDOrItem) {
  return Boolean(getFocusedWarpDisruptionScriptMode(typeIDOrItem));
}

function normalizeEffectName(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/^effects\./, "")
    .replace(/^dogmaxp\./, "");
}

function isWarpDisruptFieldGeneratorActivation(moduleItem, effectName = "") {
  if (!isWarpDisruptFieldGeneratorType(moduleItem)) {
    return false;
  }
  const normalized = normalizeEffectName(effectName);
  return normalized !== "online";
}

function getWarpDisruptionRangeMeters(typeID, effectState = null) {
  const overrides =
    effectState &&
    effectState.genericAttributeOverrides &&
    typeof effectState.genericAttributeOverrides === "object"
      ? effectState.genericAttributeOverrides
      : null;
  const overriddenRange = overrides
    ? toReal(
      overrides[String(ATTRIBUTE_WARP_SCRAMBLE_RANGE)] ??
        overrides[ATTRIBUTE_WARP_SCRAMBLE_RANGE],
      0,
    )
    : 0;
  if (overriddenRange > 0) {
    return overriddenRange;
  }
  return Math.max(0, getTypeDogmaAttributeValue(
    typeID,
    ATTRIBUTE_WARP_SCRAMBLE_RANGE,
    0,
  ));
}

function getSystemSecurity(systemID) {
  const system = worldData.getSolarSystemByID(systemID);
  if (!system) {
    return null;
  }
  return toReal(system.security ?? system.securityStatus, 0);
}

function getActivationRestriction(systemID, moduleItem, loadedCharge = null) {
  if (!isWarpDisruptFieldGeneratorType(moduleItem)) {
    return "INVALID_WARP_DISRUPT_FIELD_GENERATOR";
  }
  if (loadedCharge) {
    if (!isWarpDisruptionScriptType(loadedCharge)) {
      return "INVALID_WARP_DISRUPT_FIELD_GENERATOR_CHARGE";
    }
    if (!isSupportedFocusedWarpDisruptionScriptType(loadedCharge)) {
      return "WARP_DISRUPT_FIELD_GENERATOR_SCRIPT_UNSUPPORTED";
    }
    return null;
  }

  const moduleTypeID = toInt(moduleItem.typeID, 0);
  if (
    getTypeDogmaAttributeValue(
      moduleTypeID,
      ATTRIBUTE_DISALLOW_IN_EMPIRE_SPACE,
      0,
    ) > 0
  ) {
    const security = getSystemSecurity(systemID);
    if (security === null) {
      return "SOLAR_SYSTEM_DATA_UNAVAILABLE";
    }
    if (security > 0) {
      return "WARP_DISRUPTION_FIELD_DISALLOWED_IN_EMPIRE";
    }
  }
  if (
    toInt(systemID, 0) === ZARZAKH_SOLAR_SYSTEM_ID &&
    getTypeDogmaAttributeValue(
      moduleTypeID,
      ATTRIBUTE_DISALLOW_IN_HAZARD_SYSTEM,
      0,
    ) > 0
  ) {
    return "WARP_DISRUPTION_FIELD_DISALLOWED_IN_ZARZAKH";
  }

  if (getWarpDisruptionRangeMeters(moduleTypeID) <= 0) {
    return "WARP_DISRUPTION_FIELD_RANGE_UNAVAILABLE";
  }
  return null;
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

function isActiveWarpDisruptSphereEffect(effectState, options = {}) {
  if (!effectState || typeof effectState !== "object") {
    return false;
  }
  const now = toInt(options.nowMs, Date.now());
  const startedAtMs = toInt(effectState.startedAtMs, 0);
  if (startedAtMs > 0 && startedAtMs > now) {
    return false;
  }
  const expiresAtMs = toInt(effectState.expiresAtMs, 0);
  if (expiresAtMs > 0 && expiresAtMs <= now) {
    return false;
  }
  if (toReal(effectState.deactivatedAtMs, 0) > 0) {
    return false;
  }
  if (toInt(effectState.chargeTypeID, 0) > 0) {
    return false;
  }
  if (toInt(effectState.groupID, 0) === GROUP_WARP_DISRUPT_FIELD_GENERATOR) {
    return true;
  }
  if (toInt(effectState.effectID, 0) === EFFECT_WARP_DISRUPT_SPHERE) {
    return true;
  }
  return normalizeEffectName(effectState.effectName) === "warpdisruptsphere";
}

function listActiveWarpDisruptSphereEffects(entity, options = {}) {
  if (
    !entity ||
    !entity.activeModuleEffects ||
    typeof entity.activeModuleEffects.values !== "function"
  ) {
    return [];
  }
  return [...entity.activeModuleEffects.values()]
    .filter((effectState) => isActiveWarpDisruptSphereEffect(effectState, options));
}

function buildActiveWarpDisruptorCandidate(entity, options = {}) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  const position = getObjectPosition(entity);
  if (!position) {
    return null;
  }

  let bestEffect = null;
  let bestRangeMeters = 0;
  for (const effectState of listActiveWarpDisruptSphereEffects(entity, options)) {
    const rangeMeters = getWarpDisruptionRangeMeters(effectState.typeID, effectState);
    if (rangeMeters > bestRangeMeters) {
      bestEffect = effectState;
      bestRangeMeters = rangeMeters;
    }
  }
  if (!bestEffect || bestRangeMeters <= 0) {
    return null;
  }

  return {
    disruptorID: toInt(entity.itemID, 0),
    moduleID: toInt(bestEffect.moduleID, 0),
    typeID: toInt(bestEffect.typeID, 0),
    ownerID: toInt(
      bestEffect.ownerID,
      toInt(
        entity.ownerID,
        toInt(entity.characterID || entity.pilotCharacterID, 0),
      ),
    ),
    sourceShipID: toInt(
      bestEffect.sourceShipID,
      toInt(entity.sourceShipID, toInt(entity.itemID, 0)),
    ),
    sourceModuleID: toInt(bestEffect.moduleID, 0),
    position,
    rangeMeters: bestRangeMeters,
    source: String(bestEffect.warpDisruptionSource || "warpDisruptFieldGenerator"),
  };
}

module.exports = {
  GROUP_WARP_DISRUPT_FIELD_GENERATOR,
  GROUP_WARP_DISRUPTION_SCRIPT,
  EFFECT_WARP_DISRUPT_SPHERE,
  EFFECT_SHIP_MODULE_FOCUSED_WARP_SCRAMBLING_SCRIPT,
  EFFECT_SHIP_MODULE_FOCUSED_WARP_DISRUPTION_SCRIPT,
  TYPE_FOCUSED_WARP_DISRUPTION_SCRIPT,
  TYPE_FOCUSED_WARP_SCRAMBLING_SCRIPT,
  ATTRIBUTE_WARP_SCRAMBLE_RANGE,
  isWarpDisruptFieldGeneratorType,
  isWarpDisruptionScriptType,
  getFocusedWarpDisruptionScriptMode,
  isSupportedFocusedWarpDisruptionScriptType,
  isWarpDisruptFieldGeneratorActivation,
  getWarpDisruptionRangeMeters,
  getActivationRestriction,
  buildActiveWarpDisruptorCandidate,
  _testing: {
    getTypeDogmaAttributeValue,
    normalizeEffectName,
    isActiveWarpDisruptSphereEffect,
    listActiveWarpDisruptSphereEffects,
  },
};
