const path = require("path");

const worldData = require(path.join(__dirname, "../../worldData"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../../../services/skills/skillState"));
const {
  getAttributeIDByNames,
  getTypeAttributeMap,
  typeHasEffectName,
} = require(path.join(__dirname, "../../../services/fitting/liveFittingState"));
const {
  resolveTitanSuperweaponProfileByModuleTypeID,
} = require(path.join(__dirname, "../../../services/superweapons/superweaponCatalog"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "../liveModuleAttributes"));
const hostileModuleRuntime = require(path.join(__dirname, "../hostileModuleRuntime"));
const jammerModuleRuntime = require(path.join(__dirname, "../jammerModuleRuntime"));
const warpDisruptFieldGeneratorRuntime = require(path.join(
  __dirname,
  "../../../services/ship/warpDisruptFieldGeneratorRuntime",
));
const {
  getFuelStacksForShipStorage,
  getFuelQuantityFromStacks,
  consumeFuelFromShipStorage,
} = require(path.join(__dirname, "../sharedFuelRuntime"));
const {
  hasDamageableHealth,
  sumDamageVector,
} = require(path.join(__dirname, "../../combat/damage"));

function getStructureTethering() {
  return require(path.join(__dirname, "../../structureTethering"));
}

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE =
  getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_SIGNATURE_RADIUS =
  getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_MAX_TARGET_RANGE =
  getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION =
  getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_DAMAGE_DELAY_DURATION =
  getAttributeIDByNames("damageDelayDuration") || 561;
const ATTRIBUTE_CONSUMPTION_TYPE =
  getAttributeIDByNames("consumptionType") || 713;
const ATTRIBUTE_CONSUMPTION_QUANTITY =
  getAttributeIDByNames("consumptionQuantity") || 714;
const ATTRIBUTE_DOOMSDAY_NO_JUMP_OR_CLOAK_DURATION =
  getAttributeIDByNames("doomsdayNoJumpOrCloakDuration") || 2142;
const ATTRIBUTE_DOOMSDAY_IMMOBILITY_DURATION =
  getAttributeIDByNames("doomsdayImmobilityDuration") || 2141;
const ATTRIBUTE_DOOMSDAY_WARNING_DURATION =
  getAttributeIDByNames("doomsdayWarningDuration") || 2143;
const ATTRIBUTE_DOOMSDAY_DAMAGE_DURATION =
  getAttributeIDByNames("doomsdayDamageDuration") || 2144;
const ATTRIBUTE_DOOMSDAY_DAMAGE_CYCLE_TIME =
  getAttributeIDByNames("doomsdayDamageCycleTime") || 2145;
const ATTRIBUTE_DOOMSDAY_DAMAGE_RADIUS =
  getAttributeIDByNames("doomsdayDamageRadius") || 2146;
const ATTRIBUTE_DOOMSDAY_AOE_SHAPE =
  getAttributeIDByNames("doomsdayAOEShape") || 2147;
const ATTRIBUTE_DOOMSDAY_AOE_RANGE =
  getAttributeIDByNames("doomsdayAOERange") || 2279;
const ATTRIBUTE_DOOMSDAY_AOE_DURATION =
  getAttributeIDByNames("doomsdayAOEDuration") || 2280;
const ATTRIBUTE_DOOMSDAY_AOE_SIGNATURE_RADIUS =
  getAttributeIDByNames("doomsdayAOESignatureRadius") || 2281;
const ATTRIBUTE_DOOMSDAY_RANGE_IS_FIXED =
  getAttributeIDByNames("doomsdayRangeIsFixed") || 2149;
const ATTRIBUTE_IS_POINT_TARGETED =
  getAttributeIDByNames("isPointTargeted") || 2210;
const ATTRIBUTE_SPEED_FACTOR = getAttributeIDByNames("speedFactor") || 20;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_SIGNATURE_RADIUS_BONUS =
  getAttributeIDByNames("signatureRadiusBonus") || 554;
const ATTRIBUTE_TARGET_PAINTER_RESISTANCE =
  getAttributeIDByNames("targetPainterResistance") || 2114;
const ATTRIBUTE_STASIS_WEBIFIER_RESISTANCE =
  getAttributeIDByNames("stasisWebifierResistance") || 2115;
const ATTRIBUTE_ENERGY_NEUTRALIZER_AMOUNT =
  getAttributeIDByNames("energyNeutralizerAmount") || 97;
const ATTRIBUTE_ENERGY_WARFARE_RESISTANCE =
  getAttributeIDByNames("energyWarfareResistance") || 2045;
const ATTRIBUTE_MAX_TARGET_RANGE_BONUS =
  getAttributeIDByNames("maxTargetRangeBonus") || 309;
const ATTRIBUTE_SCAN_RESOLUTION_BONUS =
  getAttributeIDByNames("scanResolutionBonus") || 566;
const ATTRIBUTE_SENSOR_DAMPENER_RESISTANCE =
  getAttributeIDByNames("sensorDampenerResistance") || 2112;
const ATTRIBUTE_MAX_RANGE_BONUS = getAttributeIDByNames("maxRangeBonus") || 351;
const ATTRIBUTE_FALLOFF_BONUS = getAttributeIDByNames("falloffBonus") || 349;
const ATTRIBUTE_TRACKING_SPEED_BONUS =
  getAttributeIDByNames("trackingSpeedBonus") || 767;
const ATTRIBUTE_MISSILE_VELOCITY_BONUS =
  getAttributeIDByNames("missileVelocityBonus") || 547;
const ATTRIBUTE_EXPLOSION_DELAY_BONUS =
  getAttributeIDByNames("explosionDelayBonus") || 596;
const ATTRIBUTE_AOE_VELOCITY_BONUS =
  getAttributeIDByNames("aoeVelocityBonus") || 847;
const ATTRIBUTE_AOE_CLOUD_SIZE_BONUS =
  getAttributeIDByNames("aoeCloudSizeBonus") || 848;
const ATTRIBUTE_TRACKING_SPEED = getAttributeIDByNames("trackingSpeed") || 160;
const ATTRIBUTE_WEAPON_FALLOFF = getAttributeIDByNames("falloff") || 158;
const ATTRIBUTE_EXPLOSION_DELAY = getAttributeIDByNames("explosionDelay") || 281;
const ATTRIBUTE_AOE_VELOCITY = getAttributeIDByNames("aoeVelocity") || 653;
const ATTRIBUTE_AOE_CLOUD_SIZE = getAttributeIDByNames("aoeCloudSize") || 654;
const ATTRIBUTE_WEAPON_DISRUPTION_RESISTANCE =
  getAttributeIDByNames("weaponDisruptionResistance") || 2113;
const ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH_BONUS =
  getAttributeIDByNames("scanGravimetricStrengthBonus") || 238;
const ATTRIBUTE_SCAN_LADAR_STRENGTH_BONUS =
  getAttributeIDByNames("scanLadarStrengthBonus") || 239;
const ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH_BONUS =
  getAttributeIDByNames("scanMagnetometricStrengthBonus") || 240;
const ATTRIBUTE_SCAN_RADAR_STRENGTH_BONUS =
  getAttributeIDByNames("scanRadarStrengthBonus") || 241;
const ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_AMOUNT =
  getAttributeIDByNames("doomsdayEnergyNeutAmount") || 2148;
const ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_RADIUS =
  getAttributeIDByNames("doomsdayEnergyNeutRadius") || 2151;
const ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_SIGNATURE_RADIUS =
  getAttributeIDByNames("doomsdayEnergyNeutSignatureRadius") || 2152;
const ATTRIBUTE_LIGHTNING_WEAPON_TARGET_AMOUNT =
  getAttributeIDByNames("lightningWeaponTargetAmount") || 2104;
const ATTRIBUTE_LIGHTNING_WEAPON_TARGET_RANGE =
  getAttributeIDByNames("lightningWeaponTargetRange") || 2105;
const ATTRIBUTE_LIGHTNING_WEAPON_DAMAGE_LOSS_TARGET =
  getAttributeIDByNames("lightningWeaponDamageLossTarget") || 2106;
const ATTRIBUTE_ENTITY_SUPERWEAPON_DURATION =
  getAttributeIDByNames("entitySuperWeaponDuration") || 2009;
const ATTRIBUTE_ENTITY_SUPERWEAPON_EM_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponEmDamage") || 2010;
const ATTRIBUTE_ENTITY_SUPERWEAPON_KINETIC_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponKineticDamage") || 2011;
const ATTRIBUTE_ENTITY_SUPERWEAPON_THERMAL_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponThermalDamage") || 2012;
const ATTRIBUTE_ENTITY_SUPERWEAPON_EXPLOSIVE_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponExplosiveDamage") || 2013;
const ATTRIBUTE_ENTITY_SUPERWEAPON_MAX_RANGE =
  getAttributeIDByNames("entitySuperWeaponMaxRange") || 2046;
const ATTRIBUTE_ENTITY_SUPERWEAPON_FALLOFF =
  getAttributeIDByNames("entitySuperWeaponFallOff") || 2047;
const ATTRIBUTE_ENTITY_SUPERWEAPON_TRACKING_SPEED =
  getAttributeIDByNames("entitySuperWeaponTrackingSpeed") || 2048;
const ATTRIBUTE_ENTITY_SUPERWEAPON_OPTIMAL_SIGNATURE_RADIUS =
  getAttributeIDByNames("entitySuperWeaponOptimalSignatureRadius") || 2049;

const LOWSEC_SECURITY_THRESHOLD = 0.45;
const MODULAR_EFFECT_BEACON_TYPE_ID = 41233;
const MODULAR_EFFECT_BEACON_GROUP_ID = 1704;
const MODULAR_EFFECT_BEACON_CATEGORY_ID = 2;
const MODULAR_EFFECT_BEACON_RADIUS = 250;
const STRUCTURE_BURST_PROJECTOR_GROUP_ID = 1331;
const STRUCTURE_DOOMSDAY_WEAPON_GROUP_ID = 1333;
const STRUCTURE_DOOMSDAY_EFFECT_NAME = "lightningWeapon";
const STRUCTURE_DOOMSDAY_FX_GUID = "effects.Laser";
const DOOMSDAY_CONE_DOT_EFFECT_NAME = "doomsdayConeDOT";
const DOOMSDAY_CONE_DOT_FX_GUID = "";
const DOGMA_OP_POST_PERCENT = 6;
const SUPERWEAPON_BURST_PROJECTOR_AOE_PULSE_MS = 1_000;
const TRANSIENT_SUPERWEAPON_ENTITY_ID_BASE = 7_000_000_000_000_000;
const DEFAULT_SHOW_REFIRE_MS = 30_000;
const DEFAULT_SHOW_INITIAL_DELAY_MS = 4_000;
const DEFAULT_SHOW_APPROACH_RANGE = 60_000;
const DEFAULT_SHOW_VOLLEY_BATCH_SIZE = 4;
const DEFAULT_SHOW_VOLLEY_STEP_MS = 1_000;
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

const SUPERWEAPON_FX_META = Object.freeze({
  "effects.SuperWeaponAmarr": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponCaldari": Object.freeze({
    durationMs: 10_000,
    leadInMs: 0,
    startActive: false,
  }),
  "effects.SuperWeaponGallente": Object.freeze({
    durationMs: 10_000,
    leadInMs: 0,
    startActive: false,
  }),
  "effects.SuperWeaponMinmatar": Object.freeze({
    durationMs: 10_000,
    leadInMs: 3_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceAmarr": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceCaldari": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceGallente": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceMinmatar": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.TurboLaser": Object.freeze({
    durationMs: 12_000,
    leadInMs: 0,
    startActive: false,
  }),
});

const STRUCTURE_BURST_PROJECTOR_EFFECT_NAMES = Object.freeze([
  "doomsdayAOEBubble",
  "doomsdayAOEDamp",
  "doomsdayAOEECM",
  "doomsdayAOENeut",
  "doomsdayAOEPaint",
  "doomsdayAOETrack",
  "doomsdayAOEWeb",
]);

const STRUCTURE_BURST_PROJECTOR_HOSTILE_EFFECTS = Object.freeze({
  doomsdayAOENeut: Object.freeze({
    family: hostileModuleRuntime.HOSTILE_FAMILY_NEUT,
    jammingType: "ewEnergyNeut",
    strengthAttributeID: ATTRIBUTE_ENERGY_NEUTRALIZER_AMOUNT,
    resistanceAttributeID: ATTRIBUTE_ENERGY_WARFARE_RESISTANCE,
    signatureResolutionAttributeID: ATTRIBUTE_DOOMSDAY_AOE_SIGNATURE_RADIUS,
    stackingPenalized: false,
    affectsTargetDerivedState: false,
    instantPulse: true,
  }),
  doomsdayAOEDamp: Object.freeze({
    family: hostileModuleRuntime.HOSTILE_FAMILY_SENSOR_DAMP,
    jammingType: "ewRemoteSensorDamp",
    resistanceAttributeID: ATTRIBUTE_SENSOR_DAMPENER_RESISTANCE,
    stackingPenalized: true,
    affectsTargetDerivedState: true,
    moduleModifierSpecs: Object.freeze([
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_MAX_TARGET_RANGE_BONUS,
        modifiedAttributeID: ATTRIBUTE_MAX_TARGET_RANGE,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_SCAN_RESOLUTION_BONUS,
        modifiedAttributeID: ATTRIBUTE_SCAN_RESOLUTION,
        operation: DOGMA_OP_POST_PERCENT,
      }),
    ]),
  }),
  doomsdayAOEPaint: Object.freeze({
    family: hostileModuleRuntime.HOSTILE_FAMILY_PAINT,
    jammingType: "ewTargetPaint",
    strengthAttributeID: ATTRIBUTE_SIGNATURE_RADIUS_BONUS,
    modifierAttributeID: ATTRIBUTE_SIGNATURE_RADIUS,
    modifierOperation: DOGMA_OP_POST_PERCENT,
    resistanceAttributeID: ATTRIBUTE_TARGET_PAINTER_RESISTANCE,
    stackingPenalized: true,
    affectsTargetDerivedState: true,
  }),
  doomsdayAOETrack: Object.freeze({
    family: hostileModuleRuntime.HOSTILE_FAMILY_TRACKING_DISRUPT,
    jammingType: "ewTrackingDisrupt",
    strengthAttributeID: ATTRIBUTE_TRACKING_SPEED_BONUS,
    resistanceAttributeID: ATTRIBUTE_WEAPON_DISRUPTION_RESISTANCE,
    stackingPenalized: true,
    affectsTargetDerivedState: false,
    moduleModifierSpecs: Object.freeze([
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_MAX_RANGE_BONUS,
        modifiedAttributeID: ATTRIBUTE_MAX_RANGE,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_FALLOFF_BONUS,
        modifiedAttributeID: ATTRIBUTE_WEAPON_FALLOFF,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_TRACKING_SPEED_BONUS,
        modifiedAttributeID: ATTRIBUTE_TRACKING_SPEED,
        operation: DOGMA_OP_POST_PERCENT,
      }),
    ]),
    chargeModifierSpecs: Object.freeze([
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_MISSILE_VELOCITY_BONUS,
        modifiedAttributeID: ATTRIBUTE_MAX_VELOCITY,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_EXPLOSION_DELAY_BONUS,
        modifiedAttributeID: ATTRIBUTE_EXPLOSION_DELAY,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_AOE_VELOCITY_BONUS,
        modifiedAttributeID: ATTRIBUTE_AOE_VELOCITY,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_AOE_CLOUD_SIZE_BONUS,
        modifiedAttributeID: ATTRIBUTE_AOE_CLOUD_SIZE,
        operation: DOGMA_OP_POST_PERCENT,
      }),
    ]),
  }),
  doomsdayAOEWeb: Object.freeze({
    family: hostileModuleRuntime.HOSTILE_FAMILY_WEB,
    jammingType: "webify",
    strengthAttributeID: ATTRIBUTE_SPEED_FACTOR,
    modifierAttributeID: ATTRIBUTE_MAX_VELOCITY,
    modifierOperation: DOGMA_OP_POST_PERCENT,
    resistanceAttributeID: ATTRIBUTE_STASIS_WEBIFIER_RESISTANCE,
    stackingPenalized: true,
    affectsTargetDerivedState: true,
  }),
});

const STRUCTURE_BURST_PROJECTOR_JAMMER_EFFECTS = Object.freeze({
  doomsdayAOEECM: Object.freeze({
    family: jammerModuleRuntime.ECM_FAMILY,
    jammingType: jammerModuleRuntime.ECM_JAMMING_TYPE,
    strengthAttributeIDsBySensorType: Object.freeze({
      gravimetric: ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH_BONUS,
      ladar: ATTRIBUTE_SCAN_LADAR_STRENGTH_BONUS,
      magnetometric: ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH_BONUS,
      radar: ATTRIBUTE_SCAN_RADAR_STRENGTH_BONUS,
    }),
  }),
});

const STRUCTURE_BURST_PROJECTOR_WARP_DISRUPTION_EFFECTS = Object.freeze({
  doomsdayAOEBubble: Object.freeze({
    effectID: warpDisruptFieldGeneratorRuntime.EFFECT_WARP_DISRUPT_SPHERE,
    effectName: "warpDisruptSphere",
    source: "superweaponBurstProjector",
  }),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(toFiniteNumber(value, minimum), minimum), maximum);
}

function getEntityPassiveAttributeValue(entity, attributeID, fallback = 0) {
  const attributes =
    entity &&
    entity.passiveDerivedState &&
    entity.passiveDerivedState.attributes &&
    typeof entity.passiveDerivedState.attributes === "object"
      ? entity.passiveDerivedState.attributes
      : null;
  const numericAttributeID = toInt(attributeID, 0);
  if (attributes && Number.isFinite(Number(attributes[numericAttributeID]))) {
    return Number(attributes[numericAttributeID]);
  }
  return toFiniteNumber(fallback, 0);
}

function resolveTargetResistanceMultiplier(targetEntity, resistanceAttributeID) {
  if (toInt(resistanceAttributeID, 0) <= 0) {
    return 1;
  }
  const resistancePercent = clamp(
    getEntityPassiveAttributeValue(targetEntity, resistanceAttributeID, 0),
    0,
    100,
  );
  return roundNumber(1 - (resistancePercent / 100), 6);
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt(
    (resolved.x ** 2) +
    (resolved.y ** 2) +
    (resolved.z ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (length <= 1e-9) {
    return cloneVector(fallback);
  }
  return scaleVector(resolved, 1 / length);
}

function dotProduct(left, right) {
  return (
    toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.x, 0) +
    toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.y, 0) +
    toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.z, 0)
  );
}

function normalizeDamageVector(rawDamage = {}) {
  const source =
    rawDamage && typeof rawDamage === "object"
      ? rawDamage
      : {};
  return {
    em: Math.max(0, toFiniteNumber(source.em, 0)),
    thermal: Math.max(0, toFiniteNumber(source.thermal, 0)),
    kinetic: Math.max(0, toFiniteNumber(source.kinetic, 0)),
    explosive: Math.max(0, toFiniteNumber(source.explosive, 0)),
  };
}

function scaleDamageVector(rawDamage = {}, factor = 1) {
  const resolvedDamage = normalizeDamageVector(rawDamage);
  const resolvedFactor = clamp(factor, 0, 1);
  return {
    em: roundNumber(resolvedDamage.em * resolvedFactor, 6),
    thermal: roundNumber(resolvedDamage.thermal * resolvedFactor, 6),
    kinetic: roundNumber(resolvedDamage.kinetic * resolvedFactor, 6),
    explosive: roundNumber(resolvedDamage.explosive * resolvedFactor, 6),
  };
}

function normalizePointValue(value) {
  if (value && typeof value === "object" && typeof value.value === "number") {
    return Number(value.value);
  }
  return Number(value);
}

function normalizePointInput(point) {
  if (Array.isArray(point) && point.length >= 3) {
    return {
      x: toFiniteNumber(normalizePointValue(point[0]), 0),
      y: toFiniteNumber(normalizePointValue(point[1]), 0),
      z: toFiniteNumber(normalizePointValue(point[2]), 0),
    };
  }
  if (point && typeof point === "object") {
    return {
      x: toFiniteNumber(normalizePointValue(point.x), 0),
      y: toFiniteNumber(normalizePointValue(point.y), 0),
      z: toFiniteNumber(normalizePointValue(point.z), 0),
    };
  }
  return null;
}

function getSystemSecurity(systemID) {
  const system = worldData.getSolarSystemByID(toInt(systemID, 0));
  if (!system) {
    return 0;
  }
  const security = clamp(toFiniteNumber(system.security, 0), 0, 1);
  return security > 0 && security < 0.05 ? 0.05 : security;
}

function isLowSecuritySystem(systemID) {
  const security = getSystemSecurity(systemID);
  return security > 0 && security < LOWSEC_SECURITY_THRESHOLD;
}

function isStructureBurstProjector(moduleItem) {
  const typeID = toInt(moduleItem && moduleItem.typeID, 0);
  return (
    toInt(moduleItem && moduleItem.groupID, 0) === STRUCTURE_BURST_PROJECTOR_GROUP_ID &&
    STRUCTURE_BURST_PROJECTOR_EFFECT_NAMES.some((effectName) => (
      typeHasEffectName(typeID, effectName)
    ))
  );
}

function isStructureDoomsdayWeapon(moduleItem) {
  const typeID = toInt(moduleItem && moduleItem.typeID, 0);
  return (
    toInt(moduleItem && moduleItem.groupID, 0) === STRUCTURE_DOOMSDAY_WEAPON_GROUP_ID &&
    typeHasEffectName(typeID, STRUCTURE_DOOMSDAY_EFFECT_NAME)
  );
}

function isDoomsdayConeDotWeapon(moduleItem) {
  const typeID = toInt(moduleItem && moduleItem.typeID, 0);
  return typeID > 0 && typeHasEffectName(typeID, DOOMSDAY_CONE_DOT_EFFECT_NAME);
}

function resolveStructureBurstProjectorHostileDefinition(moduleItem) {
  const typeID = toInt(moduleItem && moduleItem.typeID, 0);
  if (typeID <= 0) {
    return null;
  }
  for (const [effectName, definition] of Object.entries(STRUCTURE_BURST_PROJECTOR_HOSTILE_EFFECTS)) {
    if (typeHasEffectName(typeID, effectName)) {
      return {
        effectName,
        ...definition,
      };
    }
  }
  return null;
}

function resolveStructureBurstProjectorJammerDefinition(moduleItem) {
  const typeID = toInt(moduleItem && moduleItem.typeID, 0);
  if (typeID <= 0) {
    return null;
  }
  for (const [effectName, definition] of Object.entries(STRUCTURE_BURST_PROJECTOR_JAMMER_EFFECTS)) {
    if (typeHasEffectName(typeID, effectName)) {
      return {
        effectName,
        ...definition,
      };
    }
  }
  return null;
}

function resolveStructureBurstProjectorWarpDisruptionDefinition(moduleItem) {
  const typeID = toInt(moduleItem && moduleItem.typeID, 0);
  if (typeID <= 0) {
    return null;
  }
  for (const [effectName, definition] of Object.entries(STRUCTURE_BURST_PROJECTOR_WARP_DISRUPTION_EFFECTS)) {
    if (typeHasEffectName(typeID, effectName)) {
      return {
        effectName,
        ...definition,
      };
    }
  }
  return null;
}

function resolveSupportedSuperweapon(moduleItem) {
  if (
    moduleItem &&
    moduleItem.npcSyntheticHullModule === true &&
    typeHasEffectName(
      toInt(moduleItem.typeID, 0),
      String(moduleItem.npcEffectName || "").trim() || "entitySuperWeapon",
    )
  ) {
    const normalizedEffectName = String(moduleItem.npcEffectName || "")
      .trim()
      .toLowerCase();
    if (normalizedEffectName === "entitysuperweapon") {
      return {
        family: "doomsday",
        fxGuid: "effects.TurboLaser",
        fuelTypeID: 0,
        fuelPerActivation: 0,
        profile: null,
        entitySuperweapon: true,
      };
    }
    if (normalizedEffectName === "entitysuperweaponlanceallraces") {
      return {
        family: "lance",
        fxGuid: "effects.SuperWeaponLanceAmarr",
        fuelTypeID: 0,
        fuelPerActivation: 0,
        profile: null,
        entitySuperweapon: true,
      };
    }
  }

  if (isStructureBurstProjector(moduleItem)) {
    return {
      family: "burstProjector",
      fxGuid: "",
      fuelTypeID: 0,
      fuelPerActivation: 0,
      profile: null,
      structureBurstProjector: true,
    };
  }

  if (isStructureDoomsdayWeapon(moduleItem)) {
    return {
      family: "doomsday",
      fxGuid: STRUCTURE_DOOMSDAY_FX_GUID,
      fuelTypeID: 0,
      fuelPerActivation: 0,
      profile: null,
      structureDoomsday: true,
    };
  }

  if (isDoomsdayConeDotWeapon(moduleItem)) {
    return {
      family: "lance",
      fxGuid: DOOMSDAY_CONE_DOT_FX_GUID,
      fuelTypeID: 0,
      fuelPerActivation: 0,
      profile: null,
      coneDotDoomsday: true,
    };
  }

  const profile = resolveTitanSuperweaponProfileByModuleTypeID(
    toInt(moduleItem && moduleItem.typeID, 0),
  );
  if (!profile) {
    return null;
  }

  if (toInt(moduleItem && moduleItem.typeID, 0) === toInt(profile.doomsdayTypeID, 0)) {
    return {
      family: "doomsday",
      fxGuid: profile.doomsdayFxGuid,
      fuelTypeID: profile.fuelTypeID,
      fuelPerActivation: profile.doomsdayFuelPerActivation,
      profile,
    };
  }

  if (toInt(moduleItem && moduleItem.typeID, 0) === toInt(profile.lanceTypeID, 0)) {
    return {
      family: "lance",
      fxGuid: profile.lanceFxGuid,
      fuelTypeID: profile.fuelTypeID,
      fuelPerActivation: profile.lanceFuelPerActivation,
      profile,
    };
  }

  return null;
}

function resolveSkillMap(entity, fallbackCharacterID = 0) {
  if (entity && entity.skillMap instanceof Map) {
    return entity.skillMap;
  }
  if (entity && entity.skillMap && typeof entity.skillMap === "object") {
    return new Map(entity.skillMap);
  }
  const characterID =
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    )
      ? toInt(
          entity.pilotCharacterID ??
            entity.characterID,
          fallbackCharacterID,
        )
      : fallbackCharacterID;
  return characterID > 0 ? getCachedCharacterSkillMap(characterID) : new Map();
}

function buildSuperweaponDogmaState(options = {}) {
  const {
    entity,
    shipItem,
    moduleItem,
    callbacks = {},
    supported = null,
  } = options;
  if (!entity || !shipItem || !moduleItem) {
    return null;
  }

  if (supported && supported.entitySuperweapon === true) {
    const attributeMap = getTypeAttributeMap(toInt(moduleItem && moduleItem.typeID, 0));
    if (!attributeMap) {
      return null;
    }

    const durationMs = Math.max(
      1,
      toFiniteNumber(
        attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_DURATION],
        1,
      ),
    );
    return {
      attributes: attributeMap,
      capNeed: 0,
      durationMs,
      durationAttributeID: ATTRIBUTE_ENTITY_SUPERWEAPON_DURATION,
      damageVector: normalizeDamageVector({
        em: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_EM_DAMAGE],
        thermal: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_THERMAL_DAMAGE],
        kinetic: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_KINETIC_DAMAGE],
        explosive: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_EXPLOSIVE_DAMAGE],
      }),
      signatureRadius: Math.max(
        1,
        toFiniteNumber(
          attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_OPTIMAL_SIGNATURE_RADIUS],
          1,
        ),
      ),
      maxRange: Math.max(
        0,
        toFiniteNumber(attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_MAX_RANGE], 0),
      ),
      falloff: Math.max(
        0,
        toFiniteNumber(attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_FALLOFF], 0),
      ),
      trackingSpeed: Math.max(
        0,
        toFiniteNumber(attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_TRACKING_SPEED], 0),
      ),
      damageDelayMs: Math.max(
        0,
        toFiniteNumber(
          attributeMap[ATTRIBUTE_DAMAGE_DELAY_DURATION],
          durationMs,
        ),
      ),
      fuelTypeID: 0,
      fuelPerActivation: 0,
      noJumpOrCloakDurationMs: 0,
      immobilityDurationMs: 0,
      warningDurationMs: 0,
      damageDurationMs: 0,
      damageCycleTimeMs: 1,
      damageRadius: 0,
      aoeShape: 0,
      rangeIsFixed: false,
      isPointTargeted: true,
      energyNeutAmount: 0,
      energyNeutRadius: 0,
      energyNeutSignatureRadius: 0,
    };
  }

  const characterID =
    callbacks.resolveCharacterID &&
    typeof callbacks.resolveCharacterID === "function"
      ? callbacks.resolveCharacterID(entity)
      : 0;
  const skillMap = resolveSkillMap(entity, characterID);
  const fittedItems =
    callbacks.getEntityRuntimeFittedItems &&
    typeof callbacks.getEntityRuntimeFittedItems === "function"
      ? callbacks.getEntityRuntimeFittedItems(entity)
      : [];
  const activeModuleContexts =
    callbacks.getEntityRuntimeActiveModuleContexts &&
    typeof callbacks.getEntityRuntimeActiveModuleContexts === "function"
      ? callbacks.getEntityRuntimeActiveModuleContexts(entity, {
          excludeModuleID: toInt(moduleItem && moduleItem.itemID, 0),
        })
      : [];
  const attributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    null,
    skillMap,
    fittedItems,
    activeModuleContexts,
  );
  if (!attributes) {
    return null;
  }

  if (supported && supported.structureBurstProjector === true) {
    const warningDurationMs = Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_WARNING_DURATION], 0),
    );
    const aoeDurationMs = Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_AOE_DURATION], 0),
    );
    const explicitDurationMs = Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DURATION], 0),
    );
    const durationMs = Math.max(
      1,
      explicitDurationMs || warningDurationMs + aoeDurationMs || 1,
    );
    const aoeRange = Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_AOE_RANGE], 0),
    );
    return {
      attributes,
      capNeed: Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_CAPACITOR_NEED], 0)),
      durationMs,
      durationAttributeID: ATTRIBUTE_DURATION,
      damageVector: normalizeDamageVector({
        em: attributes[ATTRIBUTE_EM_DAMAGE],
        thermal: attributes[ATTRIBUTE_THERMAL_DAMAGE],
        kinetic: attributes[ATTRIBUTE_KINETIC_DAMAGE],
        explosive: attributes[ATTRIBUTE_EXPLOSIVE_DAMAGE],
      }),
      signatureRadius: Math.max(
        1,
        toFiniteNumber(attributes[ATTRIBUTE_SIGNATURE_RADIUS], 1),
      ),
      maxRange: Math.max(
        0,
        toFiniteNumber(attributes[ATTRIBUTE_MAX_RANGE], 0),
      ),
      damageDelayMs: Math.max(
        0,
        toFiniteNumber(attributes[ATTRIBUTE_DAMAGE_DELAY_DURATION], 0),
      ),
      fuelTypeID: 0,
      fuelPerActivation: 0,
      noJumpOrCloakDurationMs: 0,
      immobilityDurationMs: 0,
      warningDurationMs,
      damageDurationMs: aoeDurationMs,
      damageCycleTimeMs: 1,
      damageRadius: aoeRange,
      aoeShape: toInt(attributes[ATTRIBUTE_DOOMSDAY_AOE_SHAPE], 0),
      aoeRange,
      aoeDurationMs,
      aoeSignatureRadius: Math.max(
        0,
        toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_AOE_SIGNATURE_RADIUS], 0),
      ),
      rangeIsFixed: toInt(attributes[ATTRIBUTE_DOOMSDAY_RANGE_IS_FIXED], 0) === 1,
      isPointTargeted: toInt(attributes[ATTRIBUTE_IS_POINT_TARGETED], 0) >= 1,
      energyNeutAmount: 0,
      energyNeutRadius: 0,
      energyNeutSignatureRadius: 0,
      burstProjectorHostileDefinition:
        resolveStructureBurstProjectorHostileDefinition(moduleItem),
      burstProjectorJammerDefinition:
        resolveStructureBurstProjectorJammerDefinition(moduleItem),
      burstProjectorWarpDisruptionDefinition:
        resolveStructureBurstProjectorWarpDisruptionDefinition(moduleItem),
    };
  }

  return {
    attributes,
    capNeed: Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_CAPACITOR_NEED], 0)),
    durationMs: Math.max(1, toFiniteNumber(attributes[ATTRIBUTE_DURATION], 1)),
    durationAttributeID: ATTRIBUTE_DURATION,
    damageVector: normalizeDamageVector({
      em: attributes[ATTRIBUTE_EM_DAMAGE],
      thermal: attributes[ATTRIBUTE_THERMAL_DAMAGE],
      kinetic: attributes[ATTRIBUTE_KINETIC_DAMAGE],
      explosive: attributes[ATTRIBUTE_EXPLOSIVE_DAMAGE],
    }),
    signatureRadius: Math.max(
      1,
      toFiniteNumber(attributes[ATTRIBUTE_SIGNATURE_RADIUS], 1),
    ),
    maxRange: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_MAX_RANGE], 0),
    ),
    damageDelayMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DAMAGE_DELAY_DURATION], 0),
    ),
    fuelTypeID: toInt(attributes[ATTRIBUTE_CONSUMPTION_TYPE], 0),
    fuelPerActivation: Math.max(
      0,
      toInt(attributes[ATTRIBUTE_CONSUMPTION_QUANTITY], 0),
    ),
    noJumpOrCloakDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_NO_JUMP_OR_CLOAK_DURATION], 0),
    ),
    immobilityDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_IMMOBILITY_DURATION], 0),
    ),
    warningDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_WARNING_DURATION], 0),
    ),
    damageDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_DURATION], 0),
    ),
    damageCycleTimeMs: Math.max(
      1,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_CYCLE_TIME], 1000),
    ),
    damageRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_RADIUS], 0),
    ),
    aoeShape: toInt(attributes[ATTRIBUTE_DOOMSDAY_AOE_SHAPE], 0),
    aoeRange: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_AOE_RANGE], 0),
    ),
    aoeDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_AOE_DURATION], 0),
    ),
    aoeSignatureRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_AOE_SIGNATURE_RADIUS], 0),
    ),
    rangeIsFixed: toInt(attributes[ATTRIBUTE_DOOMSDAY_RANGE_IS_FIXED], 0) === 1,
    isPointTargeted: toInt(attributes[ATTRIBUTE_IS_POINT_TARGETED], 0) >= 1,
    energyNeutAmount: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_AMOUNT], 0),
    ),
    energyNeutRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_RADIUS], 0),
    ),
    energyNeutSignatureRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_SIGNATURE_RADIUS], 0),
    ),
    lightningTargetAmount: Math.max(
      0,
      toInt(attributes[ATTRIBUTE_LIGHTNING_WEAPON_TARGET_AMOUNT], 0),
    ),
    lightningTargetRange: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_LIGHTNING_WEAPON_TARGET_RANGE], 0),
    ),
    lightningDamageLossTarget: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_LIGHTNING_WEAPON_DAMAGE_LOSS_TARGET], 0),
    ),
  };
}

function getCargoFuelStacks(entity, fuelTypeID, callbacks = {}) {
  return getFuelStacksForShipStorage(entity, fuelTypeID, callbacks);
}

function consumeSuperweaponFuel(entity, fuelTypeID, quantity, callbacks = {}) {
  return consumeFuelFromShipStorage(entity, fuelTypeID, quantity, callbacks);
}

function isSuperweaponMovementLocked(entity, nowMs = Date.now()) {
  return toFiniteNumber(entity && entity.superweaponImmobileUntilMs, 0) > toFiniteNumber(nowMs, 0);
}

function isSuperweaponJumpOrCloakLocked(entity, nowMs = Date.now()) {
  return toFiniteNumber(entity && entity.superweaponNoJumpOrCloakUntilMs, 0) > toFiniteNumber(nowMs, 0);
}

function clampPointToFixedRange(sourceEntity, point, maxRange) {
  const sourcePosition = cloneVector(sourceEntity && sourceEntity.position);
  const resolvedPoint = cloneVector(point, sourcePosition);
  const offset = subtractVectors(resolvedPoint, sourcePosition);
  const normalizedDirection = normalizeVector(
    magnitude(offset) > 1e-9 ? offset : sourceEntity && sourceEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  return addVectors(
    sourcePosition,
    scaleVector(normalizedDirection, Math.max(0, toFiniteNumber(maxRange, 0))),
  );
}

function allocateRuntimeEntityID(callbacks = {}, preferredItemID = null) {
  if (
    callbacks.allocateRuntimeEntityID &&
    typeof callbacks.allocateRuntimeEntityID === "function"
  ) {
    return toInt(callbacks.allocateRuntimeEntityID(preferredItemID), 0);
  }
  return 0;
}

function allocateSuperweaponBeaconID(scene, sourceEntity, nowMs, callbacks = {}) {
  const sourceComponent = Math.abs(toInt(sourceEntity && sourceEntity.itemID, 0)) % 1_000_000_000;
  const timeComponent = Math.abs(toInt(nowMs, 0)) % 1_000_000;
  const baseID =
    TRANSIENT_SUPERWEAPON_ENTITY_ID_BASE +
    (sourceComponent * 1_000_000) +
    timeComponent;

  for (let offset = 0; offset < 100; offset += 1) {
    const candidateID = allocateRuntimeEntityID(callbacks, baseID + offset);
    if (
      candidateID > 0 &&
      (!scene || typeof scene.getEntityByID !== "function" || !scene.getEntityByID(candidateID))
    ) {
      return candidateID;
    }
  }

  const fallbackID = allocateRuntimeEntityID(callbacks);
  return (
    fallbackID > 0 &&
    (!scene || typeof scene.getEntityByID !== "function" || !scene.getEntityByID(fallbackID))
  )
    ? fallbackID
    : 0;
}

function spawnLanceBeacon(scene, sourceEntity, targetPoint, nowMs, callbacks = {}) {
  const beaconID = allocateSuperweaponBeaconID(scene, sourceEntity, nowMs, callbacks);
  if (beaconID <= 0) {
    return null;
  }

  const sourcePosition = cloneVector(sourceEntity && sourceEntity.position);
  const resolvedTargetPoint = cloneVector(targetPoint, sourcePosition);
  const beaconEntity = {
    itemID: beaconID,
    kind: "container",
    typeID: MODULAR_EFFECT_BEACON_TYPE_ID,
    groupID: MODULAR_EFFECT_BEACON_GROUP_ID,
    categoryID: MODULAR_EFFECT_BEACON_CATEGORY_ID,
    slimTypeID: MODULAR_EFFECT_BEACON_TYPE_ID,
    slimGroupID: MODULAR_EFFECT_BEACON_GROUP_ID,
    slimCategoryID: MODULAR_EFFECT_BEACON_CATEGORY_ID,
    itemName: "Modular Effect Beacon",
    ownerID: toInt(sourceEntity && sourceEntity.ownerID, 0),
    systemID: toInt(scene && scene.systemID, 0),
    radius: MODULAR_EFFECT_BEACON_RADIUS,
    position: resolvedTargetPoint,
    velocity: { x: 0, y: 0, z: 0 },
    direction: normalizeVector(
      subtractVectors(resolvedTargetPoint, sourcePosition),
      sourceEntity && sourceEntity.direction,
    ),
    targetPoint: resolvedTargetPoint,
    mode: "STOP",
    speedFraction: 0,
    transient: true,
    createdAtMs: toFiniteNumber(nowMs, 0),
    expiresAtMs: toFiniteNumber(nowMs, 0) + 60_000,
    activityState: 1,
    component_activate: [true, null],
  };
  const spawnResult = scene.spawnDynamicEntity(beaconEntity, {
    broadcast: false,
  });
  if (!spawnResult || spawnResult.success !== true || !spawnResult.data) {
    return null;
  }
  return spawnResult.data.entity || beaconEntity;
}

function removeTransientEntity(scene, entityID, nowMs) {
  if (!scene || toInt(entityID, 0) <= 0) {
    return false;
  }
  const entity = scene.getEntityByID(entityID);
  if (!entity) {
    return false;
  }
  scene.unregisterDynamicEntity(entity, {
    nowMs,
  });
  return true;
}

function resolveSuperweaponFxMeta(guid) {
  return SUPERWEAPON_FX_META[String(guid || "")] || Object.freeze({
    durationMs: 10_000,
    leadInMs: 0,
    startActive: false,
  });
}

function resolveSuperweaponFxTargetID(effectState) {
  if (!effectState || effectState.superweaponEffect !== true) {
    return 0;
  }
  if (String(effectState.superweaponFamily || "").toLowerCase() === "lance") {
    return Math.max(
      0,
      toInt(
        effectState.superweaponFxTargetID,
        effectState.superweaponBeaconID,
      ),
    );
  }
  return Math.max(
    0,
    toInt(
      effectState.superweaponPrimaryTargetID,
      effectState.targetID,
    ),
  );
}

function resolveSuperweaponFxReplayWindowEndMs(effectState) {
  if (!effectState || effectState.superweaponEffect !== true) {
    return 0;
  }
  const activatedAtMs = Math.max(
    0,
    toFiniteNumber(
      effectState.superweaponActivatedAtMs,
      effectState.startedAtMs,
    ),
  );
  if (activatedAtMs <= 0) {
    return 0;
  }
  return activatedAtMs +
    Math.max(0, toFiniteNumber(effectState.superweaponFxLeadInMs, 0)) +
    Math.max(1, toFiniteNumber(effectState.superweaponFxDurationMs, 10_000));
}

function isSuperweaponFxReplayWindowActive(effectState, nowMs = Date.now()) {
  if (!effectState || effectState.superweaponEffect !== true || !effectState.guid) {
    return false;
  }
  if (toFiniteNumber(effectState.deactivatedAtMs, 0) > 0) {
    return false;
  }
  const activatedAtMs = Math.max(
    0,
    toFiniteNumber(
      effectState.superweaponActivatedAtMs,
      effectState.startedAtMs,
    ),
  );
  if (activatedAtMs <= 0 || activatedAtMs > toFiniteNumber(nowMs, 0) + 1) {
    return false;
  }
  return resolveSuperweaponFxReplayWindowEndMs(effectState) > toFiniteNumber(nowMs, 0);
}

function toFileTimeFromSimMs(value, fallback = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return BigInt(Math.trunc(numericValue)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function resolveSuperweaponFxStartFileTime(scene, whenMs = Date.now()) {
  if (
    scene &&
    typeof scene.toFileTimeFromSimMs === "function"
  ) {
    const fallback =
      typeof scene.getCurrentFileTime === "function"
        ? scene.getCurrentFileTime()
        : toFileTimeFromSimMs(whenMs);
    return scene.toFileTimeFromSimMs(whenMs, fallback);
  }
  return toFileTimeFromSimMs(whenMs);
}

function buildSuperweaponFreshAcquireFxOptions(effectState, nowMs = Date.now(), scene = null) {
  if (!isSuperweaponFxReplayWindowActive(effectState, nowMs)) {
    return null;
  }
  const activatedAtMs = Math.max(
    0,
    toFiniteNumber(
      effectState.superweaponActivatedAtMs,
      effectState.startedAtMs,
    ),
  );
  return {
    moduleID: effectState.moduleID,
    moduleTypeID: effectState.typeID,
    targetID: resolveSuperweaponFxTargetID(effectState) || null,
    isOffensive: true,
    start: true,
    active: effectState.superweaponFxStartActive === true,
    duration: Math.max(1, toInt(effectState.superweaponFxDurationMs, 10_000)),
    startTime: resolveSuperweaponFxStartFileTime(scene, activatedAtMs),
    timeFromStart: Math.max(0, toFiniteNumber(nowMs, activatedAtMs) - activatedAtMs),
  };
}

function getEntitySignatureRadius(entity) {
  return Math.max(
    0,
    toFiniteNumber(entity && entity.signatureRadius, 0),
  );
}

function resolveSignatureApplicationFactor(entity, weaponSignatureRadius) {
  const resolvedWeaponSignatureRadius = Math.max(0, toFiniteNumber(weaponSignatureRadius, 0));
  if (resolvedWeaponSignatureRadius <= 0) {
    return 1;
  }
  const targetSignatureRadius = getEntitySignatureRadius(entity);
  if (targetSignatureRadius <= 0) {
    return 0;
  }
  return clamp(targetSignatureRadius / resolvedWeaponSignatureRadius, 0, 1);
}

function collectPotentialCylinderTargets(scene) {
  const targets = [];
  if (!scene) {
    return targets;
  }

  if (scene.dynamicEntities instanceof Map) {
    for (const entity of scene.dynamicEntities.values()) {
      targets.push(entity);
    }
  }
  if (scene.staticEntitiesByID instanceof Map) {
    for (const entity of scene.staticEntitiesByID.values()) {
      targets.push(entity);
    }
  }
  return targets;
}

function collectPotentialBurstProjectorTargets(scene) {
  return collectPotentialCylinderTargets(scene).filter((entity) => (
    entity &&
    String(entity.kind || "") === "ship" &&
    hasDamageableHealth(entity)
  ));
}

function getDistanceBetweenEntities(leftEntity, rightEntity) {
  if (!leftEntity || !rightEntity || !leftEntity.position || !rightEntity.position) {
    return Number.POSITIVE_INFINITY;
  }
  return magnitude(subtractVectors(leftEntity.position, rightEntity.position));
}

function collectLightningChainTargets(scene, sourceEntity, primaryTargetEntity, effectState) {
  if (!scene || !primaryTargetEntity || !hasDamageableHealth(primaryTargetEntity)) {
    return [];
  }

  const maxTargetCount = Math.max(
    1,
    toInt(effectState && effectState.superweaponLightningTargetAmount, 1),
  );
  const jumpRange = Math.max(
    0,
    toFiniteNumber(effectState && effectState.superweaponLightningTargetRange, 0),
  );
  const sourceID = toInt(sourceEntity && sourceEntity.itemID, 0);
  const selectedTargets = [primaryTargetEntity];
  const selectedIDs = new Set([toInt(primaryTargetEntity.itemID, 0)]);

  if (maxTargetCount <= 1 || jumpRange <= 0) {
    return selectedTargets;
  }

  const candidates = collectPotentialCylinderTargets(scene)
    .filter((entity) => {
      const entityID = toInt(entity && entity.itemID, 0);
      return (
        entity &&
        entityID > 0 &&
        entityID !== sourceID &&
        !selectedIDs.has(entityID) &&
        hasDamageableHealth(entity)
      );
    });

  while (selectedTargets.length < maxTargetCount && candidates.length > 0) {
    const previousTarget = selectedTargets[selectedTargets.length - 1];
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestID = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const distance = getDistanceBetweenEntities(previousTarget, candidate);
      const candidateID = toInt(candidate && candidate.itemID, 0);
      if (
        distance <= jumpRange &&
        (
          bestIndex < 0 ||
          distance < bestDistance - 1e-6 ||
          (
            Math.abs(distance - bestDistance) <= 1e-6 &&
            candidateID > 0 &&
            (bestID <= 0 || candidateID < bestID)
          )
        )
      ) {
        bestIndex = index;
        bestDistance = distance;
        bestID = candidateID;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    const [nextTarget] = candidates.splice(bestIndex, 1);
    selectedTargets.push(nextTarget);
    selectedIDs.add(toInt(nextTarget && nextTarget.itemID, 0));
  }

  return selectedTargets;
}

function isEntityInsideSphere(center, radius, entity) {
  if (!entity || !entity.position) {
    return false;
  }
  const targetRadius = Math.max(0, toFiniteNumber(entity.radius, 0));
  return magnitude(subtractVectors(entity.position, center)) <=
    Math.max(0, toFiniteNumber(radius, 0)) + targetRadius;
}

function isEntityInsideCylinder(origin, direction, length, radius, entity) {
  if (!entity || !entity.position) {
    return false;
  }
  const sourcePosition = cloneVector(origin);
  const axis = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const offset = subtractVectors(entity.position, sourcePosition);
  const targetRadius = Math.max(0, toFiniteNumber(entity.radius, 0));
  const along = dotProduct(offset, axis);
  if (along < -targetRadius || along > Math.max(0, toFiniteNumber(length, 0)) + targetRadius) {
    return false;
  }
  const closestPoint = addVectors(
    sourcePosition,
    scaleVector(axis, clamp(along, 0, Math.max(0, toFiniteNumber(length, 0)))),
  );
  const radialDistance = magnitude(subtractVectors(entity.position, closestPoint));
  return radialDistance <= Math.max(0, toFiniteNumber(radius, 0)) + targetRadius;
}

function isEntityInsideCone(origin, direction, length, entity) {
  if (!entity || !entity.position) {
    return false;
  }
  const sourcePosition = cloneVector(origin);
  const axis = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const offset = subtractVectors(entity.position, sourcePosition);
  const targetRadius = Math.max(0, toFiniteNumber(entity.radius, 0));
  const along = dotProduct(offset, axis);
  const resolvedLength = Math.max(0, toFiniteNumber(length, 0));
  if (along < -targetRadius || along > resolvedLength + targetRadius) {
    return false;
  }
  const axisPoint = addVectors(sourcePosition, scaleVector(axis, along));
  const radialDistance = magnitude(subtractVectors(entity.position, axisPoint));
  // Client `ConeAreaIndication` scales the cone uniformly to the picked point
  // distance, so the cone radius grows linearly with distance from source.
  return radialDistance <= Math.max(0, along) + targetRadius;
}

function hasBurstProjectorHostileDefinition(effectState) {
  const hasStrengthOnlyEffect =
    String(effectState && effectState.superweaponBurstProjectorHostileFamily || "") ===
      hostileModuleRuntime.HOSTILE_FAMILY_NEUT &&
    Math.abs(toFiniteNumber(effectState && effectState.superweaponBurstProjectorStrengthValue, 0)) >
      1e-6;
  const hasDirectModifier =
    toInt(effectState && effectState.superweaponBurstProjectorModifierAttributeID, 0) > 0 &&
    toInt(effectState && effectState.superweaponBurstProjectorModifierOperation, -1) >= 0 &&
    Math.abs(toFiniteNumber(effectState && effectState.superweaponBurstProjectorStrengthValue, 0)) >
      1e-6;
  const hasModuleModifierEntries =
    Array.isArray(effectState && effectState.superweaponBurstProjectorModuleModifierEntries) &&
    effectState.superweaponBurstProjectorModuleModifierEntries.length > 0;
  const hasChargeModifierEntries =
    Array.isArray(effectState && effectState.superweaponBurstProjectorChargeModifierEntries) &&
    effectState.superweaponBurstProjectorChargeModifierEntries.length > 0;
  return Boolean(
    effectState &&
      String(effectState.superweaponBurstProjectorHostileFamily || "").trim() !== "" &&
      String(effectState.superweaponBurstProjectorJammingType || "").trim() !== "" &&
      (
        hasStrengthOnlyEffect ||
        hasDirectModifier ||
        hasModuleModifierEntries ||
        hasChargeModifierEntries
      )
  );
}

function hasBurstProjectorJammerDefinition(effectState) {
  return Boolean(
    effectState &&
      String(effectState.superweaponBurstProjectorJammerFamily || "").trim() !== "" &&
      String(effectState.superweaponBurstProjectorJammerJammingType || "").trim() !== "" &&
      toFiniteNumber(effectState.superweaponBurstProjectorJammerMaxStrength, 0) > 0
  );
}

function hasBurstProjectorWarpDisruptionDefinition(effectState) {
  return Boolean(
    effectState &&
      String(effectState.superweaponBurstProjectorWarpDisruptionEffectName || "").trim() !== "" &&
      toInt(effectState.superweaponBurstProjectorWarpDisruptionEffectID, 0) > 0 &&
      toFiniteNumber(effectState.superweaponBurstProjectorWarpDisruptionRange, 0) > 0
  );
}

function hasBurstProjectorDebuffDefinition(effectState) {
  return (
    hasBurstProjectorHostileDefinition(effectState) ||
    hasBurstProjectorJammerDefinition(effectState)
  );
}

function hasBurstProjectorEnergyNeutralizationDefinition(effectState) {
  return Boolean(
    effectState &&
      String(effectState.superweaponBurstProjectorHostileFamily || "") ===
        hostileModuleRuntime.HOSTILE_FAMILY_NEUT &&
      toFiniteNumber(effectState.superweaponBurstProjectorStrengthValue, 0) > 0
  );
}

function getBurstProjectorAOEWindowDurationMs(effectState) {
  const configuredDurationMs = Math.max(
    0,
    toFiniteNumber(
      effectState && effectState.superweaponAOEDurationMs,
      effectState && effectState.superweaponDamageDurationMs,
    ),
  );
  if (configuredDurationMs > 0) {
    return configuredDurationMs;
  }
  return hasBurstProjectorEnergyNeutralizationDefinition(effectState)
    ? SUPERWEAPON_BURST_PROJECTOR_AOE_PULSE_MS
    : 0;
}

function configureBurstProjectorWarpDisruptionBeacon(
  beaconEntity,
  sourceEntity,
  effectState,
  moduleItem,
) {
  if (
    !beaconEntity ||
    !sourceEntity ||
    !effectState ||
    !hasBurstProjectorWarpDisruptionDefinition(effectState)
  ) {
    return false;
  }

  const fieldRange = Math.max(
    0,
    toFiniteNumber(effectState.superweaponBurstProjectorWarpDisruptionRange, 0),
  );
  const windowStartMs = Math.max(
    0,
    toFiniteNumber(effectState.superweaponDamageWindowStartMs, 0),
  );
  const windowEndMs = Math.max(
    0,
    toFiniteNumber(effectState.superweaponDamageWindowEndMs, 0),
  );
  if (fieldRange <= 0 || windowStartMs <= 0 || windowEndMs <= windowStartMs) {
    return false;
  }

  beaconEntity.warpDisruptionStartTimeMs = windowStartMs;
  beaconEntity.warpDisruptionRangeMeters = fieldRange;
  beaconEntity.warpDisruptionActive = true;
  beaconEntity.warpDisruptionSource = String(
    effectState.superweaponBurstProjectorWarpDisruptionSource || "superweaponBurstProjector",
  );
  beaconEntity.sourceShipID = toInt(sourceEntity.itemID, 0);
  beaconEntity.sourceModuleID = toInt(effectState.moduleID, 0);
  beaconEntity.ownerID = toInt(
    sourceEntity.ownerID,
    toInt(sourceEntity.corporationID, 0),
  );

  if (!(beaconEntity.activeModuleEffects instanceof Map)) {
    beaconEntity.activeModuleEffects = new Map();
  }
  beaconEntity.activeModuleEffects.set(toInt(effectState.moduleID, 0), {
    moduleID: toInt(effectState.moduleID, 0),
    typeID: toInt(moduleItem && moduleItem.typeID, toInt(effectState.typeID, 0)),
    groupID: warpDisruptFieldGeneratorRuntime.GROUP_WARP_DISRUPT_FIELD_GENERATOR,
    effectID: toInt(effectState.superweaponBurstProjectorWarpDisruptionEffectID, 0),
    effectName: String(effectState.superweaponBurstProjectorWarpDisruptionEffectName || ""),
    chargeTypeID: 0,
    ownerID: beaconEntity.ownerID,
    sourceShipID: toInt(sourceEntity.itemID, 0),
    startedAtMs: windowStartMs,
    expiresAtMs: windowEndMs,
    deactivatedAtMs: 0,
    warpDisruptionSource: beaconEntity.warpDisruptionSource,
    genericAttributeOverrides: Object.freeze({
      [warpDisruptFieldGeneratorRuntime.ATTRIBUTE_WARP_SCRAMBLE_RANGE]: fieldRange,
    }),
  });
  effectState.superweaponBurstProjectorWarpDisruptionBeaconID =
    toInt(beaconEntity.itemID, 0);
  return true;
}

function buildBurstProjectorModifierEntries(attributeMap, modifierSpecs = [], stackingPenalized = false) {
  const entries = [];
  for (const modifierSpec of Array.isArray(modifierSpecs) ? modifierSpecs : []) {
    const sourceAttributeID = toInt(modifierSpec && modifierSpec.sourceAttributeID, 0);
    const modifiedAttributeID = toInt(modifierSpec && modifierSpec.modifiedAttributeID, 0);
    const operation = toInt(modifierSpec && modifierSpec.operation, -1);
    if (sourceAttributeID <= 0 || modifiedAttributeID <= 0 || operation < 0) {
      continue;
    }
    const value = toFiniteNumber(attributeMap && attributeMap[sourceAttributeID], NaN);
    if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
      continue;
    }
    entries.push(Object.freeze({
      modifiedAttributeID,
      operation,
      value: roundNumber(value, 6),
      stackingPenalized: stackingPenalized === true,
    }));
  }
  return Object.freeze(entries);
}

function buildBurstProjectorJammerStrengthBySensorType(attributeMap, definition) {
  const strengthAttributeIDsBySensorType =
    definition &&
    definition.strengthAttributeIDsBySensorType &&
    typeof definition.strengthAttributeIDsBySensorType === "object"
      ? definition.strengthAttributeIDsBySensorType
      : {};
  return Object.freeze({
    gravimetric: roundNumber(
      toFiniteNumber(attributeMap && attributeMap[strengthAttributeIDsBySensorType.gravimetric], 0),
      6,
    ),
    ladar: roundNumber(
      toFiniteNumber(attributeMap && attributeMap[strengthAttributeIDsBySensorType.ladar], 0),
      6,
    ),
    magnetometric: roundNumber(
      toFiniteNumber(attributeMap && attributeMap[strengthAttributeIDsBySensorType.magnetometric], 0),
      6,
    ),
    radar: roundNumber(
      toFiniteNumber(attributeMap && attributeMap[strengthAttributeIDsBySensorType.radar], 0),
      6,
    ),
  });
}

function buildBurstProjectorHostileEffectState(effectState, targetEntity, nowMs, durationMs) {
  return {
    ...effectState,
    targetID: toInt(targetEntity && targetEntity.itemID, 0),
    durationMs: Math.max(1, toInt(durationMs, 1)),
    nextCycleAtMs: toFiniteNumber(nowMs, Date.now()) + Math.max(1, toInt(durationMs, 1)),
    hostileModuleEffect: true,
    hostileFamily: String(effectState.superweaponBurstProjectorHostileFamily || ""),
    hostileJammingType: String(effectState.superweaponBurstProjectorJammingType || ""),
    hostileMaxRangeMeters: 0,
    hostileFalloffMeters: 0,
    hostileStrengthValue: roundNumber(
      toFiniteNumber(effectState.superweaponBurstProjectorStrengthValue, 0),
      6,
    ),
    hostileModifierAttributeID: Math.max(
      0,
      toInt(effectState.superweaponBurstProjectorModifierAttributeID, 0),
    ),
    hostileModifierOperation: toInt(
      effectState.superweaponBurstProjectorModifierOperation,
      -1,
    ),
    hostileModuleModifierEntries: Object.freeze(
      (Array.isArray(effectState.superweaponBurstProjectorModuleModifierEntries)
        ? effectState.superweaponBurstProjectorModuleModifierEntries
        : []
      ).map((entry) => Object.freeze({ ...entry })),
    ),
    hostileChargeModifierEntries: Object.freeze(
      (Array.isArray(effectState.superweaponBurstProjectorChargeModifierEntries)
        ? effectState.superweaponBurstProjectorChargeModifierEntries
        : []
      ).map((entry) => Object.freeze({ ...entry })),
    ),
    hostileResistanceAttributeID: Math.max(
      0,
      toInt(effectState.superweaponBurstProjectorResistanceAttributeID, 0),
    ),
    hostileWarpScrambleStrength: 0,
    hostileEnergySignatureResolution: Math.max(
      0,
      roundNumber(
        toFiniteNumber(effectState.superweaponBurstProjectorEnergySignatureResolution, 0),
        6,
      ),
    ),
    hostileNosOverride: false,
    hostileStackingPenalized: effectState.superweaponBurstProjectorStackingPenalized === true,
    hostileAffectsTargetDerivedState:
      effectState.superweaponBurstProjectorAffectsTargetDerivedState === true,
    hostileBlocksMicrowarpdrive: false,
    hostileBlocksMicroJumpDrive: false,
  };
}

function buildBurstProjectorJammerEffectState(effectState, targetEntity, nowMs, durationMs) {
  const resolvedDurationMs = Math.max(1, toInt(durationMs, 1));
  const jammerStrengthBySensorType = Object.freeze({
    ...(
      effectState &&
      effectState.superweaponBurstProjectorJammerStrengthBySensorType &&
      typeof effectState.superweaponBurstProjectorJammerStrengthBySensorType === "object"
        ? effectState.superweaponBurstProjectorJammerStrengthBySensorType
        : {}
    ),
  });
  return {
    ...effectState,
    targetID: toInt(targetEntity && targetEntity.itemID, 0),
    durationMs: resolvedDurationMs,
    jamDurationMs: resolvedDurationMs,
    nextCycleAtMs: toFiniteNumber(nowMs, Date.now()) + resolvedDurationMs,
    jammerModuleEffect: true,
    jammerBurstEffect: false,
    jammerFamily: String(effectState.superweaponBurstProjectorJammerFamily || ""),
    hostileJammingType: String(effectState.superweaponBurstProjectorJammerJammingType || ""),
    jammerMaxRangeMeters: 0,
    jammerFalloffMeters: 0,
    jammerBurstRadiusMeters: 0,
    jammerBreakLocksOnly: false,
    jammerStrengthBySensorType,
    jammerMaxStrength: roundNumber(
      toFiniteNumber(effectState.superweaponBurstProjectorJammerMaxStrength, 0),
      6,
    ),
  };
}

function buildNpcPseudoSession(entity) {
  return {
    characterID: toInt(
      entity && (
        entity.pilotCharacterID ??
        entity.characterID
      ),
      0,
    ),
    corporationID: toInt(entity && entity.corporationID, 0),
    allianceID: toInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toInt(entity && entity.systemID, 0),
      shipID: toInt(entity && entity.itemID, 0),
    },
  };
}

function getFittedModuleByTypeID(entity, typeID) {
  if (!entity || !Array.isArray(entity.fittedItems)) {
    return null;
  }
  return entity.fittedItems.find(
    (moduleItem) => toInt(moduleItem && moduleItem.typeID, 0) === toInt(typeID, 0),
  ) || null;
}

function hasActiveSuperweaponEffect(entity) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return false;
  }
  for (const effectState of entity.activeModuleEffects.values()) {
    if (effectState && effectState.superweaponEffect === true) {
      return true;
    }
  }
  return false;
}

function setEntityMotionTowardTarget(entity, targetEntity, callbacks = {}) {
  if (!entity || !targetEntity) {
    return false;
  }
  entity.mode = "FOLLOW";
  entity.targetEntityID = toInt(targetEntity.itemID, 0) || null;
  entity.followRange = DEFAULT_SHOW_APPROACH_RANGE;
  entity.speedFraction = 1;
  entity.targetPoint = cloneVector(targetEntity.position, entity.targetPoint || entity.position);
  entity.direction = normalizeVector(
    subtractVectors(targetEntity.position, entity.position),
    entity.direction,
  );
  if (
    callbacks.persistDynamicEntity &&
    typeof callbacks.persistDynamicEntity === "function"
  ) {
    callbacks.persistDynamicEntity(entity);
  }
  return true;
}

function applyCapacitorDrain(entity, drainAmount, whenMs, callbacks = {}) {
  const resolvedDrainAmount = Math.max(0, toFiniteNumber(drainAmount, 0));
  if (!entity || resolvedDrainAmount <= 0) {
    return false;
  }
  const currentCapacitor =
    callbacks.getEntityCapacitorAmount &&
    typeof callbacks.getEntityCapacitorAmount === "function"
      ? callbacks.getEntityCapacitorAmount(entity)
      : 0;
  const capacitorCapacity = Math.max(0, toFiniteNumber(entity.capacitorCapacity, 0));
  if (capacitorCapacity <= 0 || currentCapacitor <= 0) {
    return false;
  }
  const nextCapacitor = Math.max(0, currentCapacitor - resolvedDrainAmount);
  if (
    callbacks.setEntityCapacitorRatio &&
    typeof callbacks.setEntityCapacitorRatio === "function"
  ) {
    callbacks.setEntityCapacitorRatio(entity, nextCapacitor / capacitorCapacity);
  }
  if (
    callbacks.persistDynamicEntity &&
    typeof callbacks.persistDynamicEntity === "function"
  ) {
    callbacks.persistDynamicEntity(entity);
  }
  if (
    entity.session &&
    callbacks.notifyCapacitorChangeToSession &&
    typeof callbacks.notifyCapacitorChangeToSession === "function"
  ) {
    callbacks.notifyCapacitorChangeToSession(
      entity.session,
      entity,
      whenMs,
      currentCapacitor,
    );
  }
  return nextCapacitor < currentCapacitor - 1e-6;
}

function applySuperweaponDamage(scene, sourceEntity, targetEntity, damageVector, moduleItem, whenMs, callbacks = {}) {
  if (
    !scene ||
    !sourceEntity ||
    !targetEntity ||
    sumDamageVector(damageVector) <= 0 ||
    !callbacks.applyWeaponDamageToTarget ||
    typeof callbacks.applyWeaponDamageToTarget !== "function"
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      damageResult: null,
      destroyResult: null,
    };
  }

  const weaponDamageResult = callbacks.applyWeaponDamageToTarget(
    scene,
    sourceEntity,
    targetEntity,
    damageVector,
    whenMs,
    {
      alignLethalDamageToDestruction: true,
      damageSource: "superweapon_doomsday",
      superweaponFamily: "doomsday",
    },
  ) || {
    damageResult: null,
    destroyResult: null,
  };

  const appliedDamageAmount =
    callbacks.getAppliedDamageAmount &&
    typeof callbacks.getAppliedDamageAmount === "function"
      ? callbacks.getAppliedDamageAmount(weaponDamageResult.damageResult)
      : sumDamageVector(damageVector);
  if (
    appliedDamageAmount > 0 &&
    callbacks.noteKillmailDamage &&
    typeof callbacks.noteKillmailDamage === "function"
  ) {
    callbacks.noteKillmailDamage(sourceEntity, targetEntity, appliedDamageAmount, {
      whenMs,
      moduleItem,
    });
  }
  if (
    weaponDamageResult.destroyResult &&
    weaponDamageResult.destroyResult.success &&
    callbacks.recordKillmailFromDestruction &&
    typeof callbacks.recordKillmailFromDestruction === "function"
  ) {
    callbacks.recordKillmailFromDestruction(targetEntity, weaponDamageResult.destroyResult, {
      attackerEntity: sourceEntity,
      whenMs,
      moduleItem,
    });
  }

  if (
    callbacks.notifyWeaponDamageMessages &&
    typeof callbacks.notifyWeaponDamageMessages === "function"
  ) {
    callbacks.notifyWeaponDamageMessages(
      sourceEntity,
      targetEntity,
      moduleItem,
      damageVector,
      appliedDamageAmount,
      appliedDamageAmount > 0 ? 1 : 0,
    );
  }

  return {
    success: true,
    damageResult: weaponDamageResult.damageResult,
    destroyResult: weaponDamageResult.destroyResult,
    appliedDamageAmount,
  };
}

function prepareSuperweaponActivation(options = {}) {
  const {
    scene,
    entity,
    shipItem,
    moduleItem,
    callbacks = {},
    baseRuntimeAttributes = {},
    options: activationOptions = {},
  } = options;

  const supported = resolveSupportedSuperweapon(moduleItem);
  if (!supported) {
    return {
      matched: false,
      success: true,
    };
  }
  if (!scene || !entity || !shipItem || !moduleItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (entity.mode === "WARP" || entity.pendingWarp) {
    return {
      matched: true,
      success: false,
      errorMsg: "CANNOT_ACTIVATE_IN_WARP",
    };
  }
  if (isLowSecuritySystem(scene.systemID) && supported.family === "lance") {
    return {
      matched: true,
      success: false,
      errorMsg: "MODULE_RESTRICTED_IN_LOWSEC",
    };
  }

  const dogmaState = buildSuperweaponDogmaState({
    entity,
    shipItem,
    moduleItem,
    callbacks,
    supported,
  });
  if (!dogmaState) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  let targetEntity = null;
  let targetPoint = null;
  const requestedTargetID = toInt(activationOptions.targetID, 0);
  if (supported.family === "doomsday") {
    if (requestedTargetID <= 0) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_REQUIRED",
      };
    }
    targetEntity = scene.getEntityByID(requestedTargetID);
    if (!targetEntity || !hasDamageableHealth(targetEntity)) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }
    if (
      scene.isEntityLockedTarget &&
      typeof scene.isEntityLockedTarget === "function" &&
      !scene.isEntityLockedTarget(entity, requestedTargetID)
    ) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_NOT_LOCKED",
      };
    }
    if (getStructureTethering().isEntityStructureTethered(targetEntity)) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_TETHERED",
      };
    }
    const surfaceDistance =
      scene.getEntitySurfaceDistance &&
      typeof scene.getEntitySurfaceDistance === "function"
        ? scene.getEntitySurfaceDistance(entity, targetEntity)
        : magnitude(subtractVectors(targetEntity.position, entity.position));
    const maxTargetDistance = supported.entitySuperweapon === true
      ? dogmaState.maxRange + Math.max(0, toFiniteNumber(dogmaState.falloff, 0))
      : dogmaState.maxRange;
    if (maxTargetDistance > 0 && surfaceDistance > maxTargetDistance + 1) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_OUT_OF_RANGE",
      };
    }
  } else {
    targetPoint = normalizePointInput(activationOptions.targetPoint);
    if (!targetPoint && requestedTargetID > 0) {
      targetEntity = scene.getEntityByID(requestedTargetID) || null;
      if (targetEntity && targetEntity.position) {
        targetPoint = cloneVector(targetEntity.position);
      }
    }
    if (!targetPoint) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_POINT_REQUIRED",
      };
    }
    if (dogmaState.rangeIsFixed && dogmaState.maxRange > 0) {
      targetPoint = clampPointToFixedRange(
        entity,
        targetPoint,
        dogmaState.maxRange,
      );
    } else if (
      dogmaState.maxRange > 0 &&
      magnitude(subtractVectors(targetPoint, entity.position)) > dogmaState.maxRange + 1
    ) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_POINT_OUT_OF_RANGE",
      };
    }
  }

  const slashStartPoint = normalizePointInput(activationOptions.slashStartPoint);
  const slashEndPoint = normalizePointInput(activationOptions.slashEndPoint);

  const fuelTypeID = Math.max(
    0,
    toInt(dogmaState.fuelTypeID, supported.fuelTypeID),
  );
  const fuelPerActivation = Math.max(
    0,
    toInt(dogmaState.fuelPerActivation, supported.fuelPerActivation),
  );
  if (fuelTypeID > 0 && fuelPerActivation > 0) {
    const availableFuel = getFuelQuantityFromStacks(
      getCargoFuelStacks(entity, fuelTypeID, callbacks),
    );
    if (availableFuel < fuelPerActivation) {
      return {
        matched: true,
        success: false,
        errorMsg: "NO_FUEL",
      };
    }
  }

  const cycleOverrideMs = Math.max(
    0,
    toInt(entity && entity.superweaponCycleOverrideMs, 0),
  );
  const durationMs = cycleOverrideMs > 0
    ? cycleOverrideMs
    : dogmaState.durationMs;
  const fxMeta = resolveSuperweaponFxMeta(supported.fxGuid);
  const burstProjectorHostileDefinition =
    dogmaState.burstProjectorHostileDefinition &&
    typeof dogmaState.burstProjectorHostileDefinition === "object"
      ? dogmaState.burstProjectorHostileDefinition
      : null;
  const burstProjectorJammerDefinition =
    dogmaState.burstProjectorJammerDefinition &&
    typeof dogmaState.burstProjectorJammerDefinition === "object"
      ? dogmaState.burstProjectorJammerDefinition
      : null;
  const burstProjectorWarpDisruptionDefinition =
    dogmaState.burstProjectorWarpDisruptionDefinition &&
    typeof dogmaState.burstProjectorWarpDisruptionDefinition === "object"
      ? dogmaState.burstProjectorWarpDisruptionDefinition
      : null;
  const burstProjectorStackingPenalized =
    burstProjectorHostileDefinition &&
    burstProjectorHostileDefinition.stackingPenalized === true;
  const burstProjectorModuleModifierEntries = burstProjectorHostileDefinition
    ? buildBurstProjectorModifierEntries(
      dogmaState.attributes,
      burstProjectorHostileDefinition.moduleModifierSpecs,
      burstProjectorStackingPenalized,
    )
    : Object.freeze([]);
  const burstProjectorChargeModifierEntries = burstProjectorHostileDefinition
    ? buildBurstProjectorModifierEntries(
      dogmaState.attributes,
      burstProjectorHostileDefinition.chargeModifierSpecs,
      burstProjectorStackingPenalized,
    )
    : Object.freeze([]);
  const burstProjectorJammerStrengthBySensorType = burstProjectorJammerDefinition
    ? buildBurstProjectorJammerStrengthBySensorType(
      dogmaState.attributes,
      burstProjectorJammerDefinition,
    )
    : Object.freeze({});
  const burstProjectorJammerMaxStrength = Math.max(
    0,
    ...Object.values(burstProjectorJammerStrengthBySensorType)
      .map((value) => toFiniteNumber(value, 0)),
  );
  const activationCapNeed =
    supported.structureBurstProjector === true ||
    supported.structureDoomsday === true ||
    supported.coneDotDoomsday === true
      ? dogmaState.capNeed
      : 0;

  return {
    matched: true,
    success: true,
    targetEntity,
    offensiveActivation: true,
    runtimeAttributes: {
      ...baseRuntimeAttributes,
      capNeed: activationCapNeed,
      // Superweapons consume fuel on the dedicated execute path so NPC and
      // player activations use one authoritative fuel contract.
      fuelTypeID: 0,
      fuelPerActivation: 0,
      durationMs,
      durationAttributeID: dogmaState.durationAttributeID,
    },
    effectStatePatch: {
      capNeed: activationCapNeed,
      repeat: 1,
      guid: supported.fxGuid,
      superweaponEffect: true,
      autoDeactivateAtCycleEnd: true,
      suppressStartSpecialFx: true,
      suppressStopSpecialFx: true,
      specialFxIsOffensive: true,
      superweaponFamily: supported.family,
      superweaponStructureDoomsday: supported.structureDoomsday === true,
      superweaponConeDotDoomsday: supported.coneDotDoomsday === true,
      superweaponDamageVector: normalizeDamageVector(dogmaState.damageVector),
      superweaponWeaponSignatureRadius: dogmaState.signatureRadius,
      superweaponFuelTypeID: fuelTypeID,
      superweaponFuelPerActivation: fuelPerActivation,
      superweaponFxDurationMs: fxMeta.durationMs,
      superweaponFxLeadInMs: fxMeta.leadInMs,
      superweaponFxStartActive: fxMeta.startActive === true,
      superweaponMaxRange: dogmaState.maxRange,
      superweaponDamageDelayMs: dogmaState.damageDelayMs,
      superweaponDamageDurationMs: dogmaState.damageDurationMs,
      superweaponDamageCycleTimeMs: dogmaState.damageCycleTimeMs,
      superweaponDamageRadius: dogmaState.damageRadius,
      superweaponAOEShape: dogmaState.aoeShape,
      superweaponAOERange: dogmaState.aoeRange,
      superweaponAOEDurationMs: dogmaState.aoeDurationMs,
      superweaponAOESignatureRadius: dogmaState.aoeSignatureRadius,
      superweaponBurstProjectorHostileEffectName:
        burstProjectorHostileDefinition
          ? String(burstProjectorHostileDefinition.effectName || "")
          : "",
      superweaponBurstProjectorHostileFamily:
        burstProjectorHostileDefinition
          ? String(burstProjectorHostileDefinition.family || "")
          : "",
      superweaponBurstProjectorJammingType:
        burstProjectorHostileDefinition
          ? String(burstProjectorHostileDefinition.jammingType || "")
          : burstProjectorJammerDefinition
            ? String(burstProjectorJammerDefinition.jammingType || "")
            : "",
      superweaponBurstProjectorStrengthValue:
        burstProjectorHostileDefinition
          ? roundNumber(
            toFiniteNumber(
              dogmaState.attributes[burstProjectorHostileDefinition.strengthAttributeID],
              0,
            ),
            6,
          )
          : 0,
      superweaponBurstProjectorModifierAttributeID:
        burstProjectorHostileDefinition
          ? Math.max(0, toInt(burstProjectorHostileDefinition.modifierAttributeID, 0))
          : 0,
      superweaponBurstProjectorModifierOperation:
        burstProjectorHostileDefinition
          ? toInt(burstProjectorHostileDefinition.modifierOperation, -1)
          : -1,
      superweaponBurstProjectorModuleModifierEntries:
        burstProjectorModuleModifierEntries,
      superweaponBurstProjectorChargeModifierEntries:
        burstProjectorChargeModifierEntries,
      superweaponBurstProjectorResistanceAttributeID:
        burstProjectorHostileDefinition
          ? Math.max(0, toInt(burstProjectorHostileDefinition.resistanceAttributeID, 0))
          : 0,
      superweaponBurstProjectorEnergySignatureResolution:
        burstProjectorHostileDefinition
          ? Math.max(
            0,
            roundNumber(
              toFiniteNumber(
                dogmaState.attributes[
                  burstProjectorHostileDefinition.signatureResolutionAttributeID
                ],
                0,
              ),
              6,
            ),
          )
          : 0,
      superweaponBurstProjectorInstantPulse:
        burstProjectorHostileDefinition &&
        burstProjectorHostileDefinition.instantPulse === true,
      superweaponBurstProjectorStackingPenalized:
        burstProjectorHostileDefinition &&
        burstProjectorHostileDefinition.stackingPenalized === true,
      superweaponBurstProjectorAffectsTargetDerivedState:
        burstProjectorHostileDefinition &&
        burstProjectorHostileDefinition.affectsTargetDerivedState === true,
      superweaponBurstProjectorJammerEffectName:
        burstProjectorJammerDefinition
          ? String(burstProjectorJammerDefinition.effectName || "")
          : "",
      superweaponBurstProjectorJammerFamily:
        burstProjectorJammerDefinition
          ? String(burstProjectorJammerDefinition.family || "")
          : "",
      superweaponBurstProjectorJammerJammingType:
        burstProjectorJammerDefinition
          ? String(burstProjectorJammerDefinition.jammingType || "")
          : "",
      superweaponBurstProjectorJammerStrengthBySensorType:
        burstProjectorJammerStrengthBySensorType,
      superweaponBurstProjectorJammerMaxStrength:
        roundNumber(burstProjectorJammerMaxStrength, 6),
      superweaponBurstProjectorWarpDisruptionEffectName:
        burstProjectorWarpDisruptionDefinition
          ? String(burstProjectorWarpDisruptionDefinition.effectName || "")
          : "",
      superweaponBurstProjectorWarpDisruptionEffectID:
        burstProjectorWarpDisruptionDefinition
          ? toInt(burstProjectorWarpDisruptionDefinition.effectID, 0)
          : 0,
      superweaponBurstProjectorWarpDisruptionSource:
        burstProjectorWarpDisruptionDefinition
          ? String(burstProjectorWarpDisruptionDefinition.source || "")
          : "",
      superweaponBurstProjectorWarpDisruptionRange:
        burstProjectorWarpDisruptionDefinition
          ? Math.max(0, toFiniteNumber(dogmaState.aoeRange, 0))
          : 0,
      superweaponIsPointTargeted: dogmaState.isPointTargeted === true,
      superweaponWarningDurationMs: dogmaState.warningDurationMs,
      superweaponNoJumpOrCloakDurationMs: dogmaState.noJumpOrCloakDurationMs,
      superweaponImmobilityDurationMs: dogmaState.immobilityDurationMs,
      superweaponEnergyNeutAmount: dogmaState.energyNeutAmount,
      superweaponEnergyNeutRadius: dogmaState.energyNeutRadius,
      superweaponEnergyNeutSignatureRadius: dogmaState.energyNeutSignatureRadius,
      superweaponLightningTargetAmount: Math.max(
        0,
        toInt(dogmaState.lightningTargetAmount, 0),
      ),
      superweaponLightningTargetRange: Math.max(
        0,
        toFiniteNumber(dogmaState.lightningTargetRange, 0),
      ),
      superweaponLightningDamageLossTarget: Math.max(
        0,
        toFiniteNumber(dogmaState.lightningDamageLossTarget, 0),
      ),
      superweaponTargetPoint: targetPoint ? cloneVector(targetPoint) : null,
      superweaponSlashStartPoint: slashStartPoint ? cloneVector(slashStartPoint) : null,
      superweaponSlashEndPoint: slashEndPoint ? cloneVector(slashEndPoint) : null,
      superweaponPrimaryTargetID:
        supported.family === "doomsday"
          ? toInt(targetEntity && targetEntity.itemID, 0)
          : 0,
    },
  };
}

function inspectSuperweaponActivationContract(options = {}) {
  const {
    scene,
    entity,
    moduleItem,
    callbacks = {},
    targetID = 0,
    targetPoint = null,
  } = options;
  if (!scene || !entity || !moduleItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const inspectionCallbacks = {
    getEntityRuntimeFittedItems(currentEntity) {
      return Array.isArray(currentEntity && currentEntity.fittedItems)
        ? currentEntity.fittedItems
        : [];
    },
    getEntityRuntimeActiveModuleContexts() {
      return [];
    },
    resolveCharacterID(currentEntity) {
      return toInt(
        currentEntity &&
          (
            currentEntity.pilotCharacterID ??
            currentEntity.characterID
          ),
        0,
      );
    },
    ...callbacks,
  };

  const activationResult = prepareSuperweaponActivation({
    scene,
    entity,
    shipItem: entity,
    moduleItem,
    callbacks: inspectionCallbacks,
    options: targetPoint
      ? { targetPoint }
      : { targetID },
  });
  if (!activationResult || activationResult.matched !== true || activationResult.success !== true) {
    return {
      success: false,
      errorMsg:
        activationResult && activationResult.matched === true
          ? activationResult.errorMsg || "UNSUPPORTED_MODULE"
          : "UNSUPPORTED_MODULE",
    };
  }

  const effectStatePatch = activationResult.effectStatePatch || {};
  return {
    success: true,
    data: {
      family: String(effectStatePatch.superweaponFamily || "").trim().toLowerCase(),
      structureDoomsday: effectStatePatch.superweaponStructureDoomsday === true,
      fxGuid: String(effectStatePatch.guid || ""),
      fuelTypeID: toInt(effectStatePatch.superweaponFuelTypeID, 0),
      fuelPerActivation: Math.max(0, toInt(effectStatePatch.superweaponFuelPerActivation, 0)),
      warningDurationMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponWarningDurationMs, 0)),
      damageDelayMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageDelayMs, 0)),
      damageDurationMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageDurationMs, 0)),
      damageCycleTimeMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageCycleTimeMs, 0)),
      damageRadius: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageRadius, 0)),
      aoeShape: toInt(effectStatePatch.superweaponAOEShape, 0),
      aoeRange: Math.max(0, toFiniteNumber(effectStatePatch.superweaponAOERange, 0)),
      aoeDurationMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponAOEDurationMs, 0)),
      aoeSignatureRadius: Math.max(
        0,
        toFiniteNumber(effectStatePatch.superweaponAOESignatureRadius, 0),
      ),
      isPointTargeted: effectStatePatch.superweaponIsPointTargeted === true,
      maxRange: Math.max(0, toFiniteNumber(effectStatePatch.superweaponMaxRange, 0)),
      primaryTargetID: toInt(effectStatePatch.superweaponPrimaryTargetID, 0),
      targetPoint: effectStatePatch.superweaponTargetPoint
        ? cloneVector(effectStatePatch.superweaponTargetPoint)
        : null,
      lightningTargetAmount: Math.max(
        0,
        toInt(effectStatePatch.superweaponLightningTargetAmount, 0),
      ),
      lightningTargetRange: Math.max(
        0,
        toFiniteNumber(effectStatePatch.superweaponLightningTargetRange, 0),
      ),
      lightningDamageLossTarget: Math.max(
        0,
        toFiniteNumber(effectStatePatch.superweaponLightningDamageLossTarget, 0),
      ),
    },
  };
}

function broadcastSuperweaponFx(
  scene,
  sourceEntity,
  effectState,
  targetID,
  nowMs,
  options = {},
) {
  if (!scene || !sourceEntity || !effectState || !effectState.guid) {
    return false;
  }
  const baseFxOptions = {
    moduleID: effectState.moduleID,
    moduleTypeID: effectState.typeID,
    targetID: toInt(targetID, 0) || null,
    isOffensive: true,
    start: true,
    active: effectState.superweaponFxStartActive === true,
    duration: Math.max(1, toInt(effectState.superweaponFxDurationMs, 10_000)),
    // `client/nofx.txt`: the doomsday start FX was arriving behind already
    // presented movement/stop history, so the client rewound right as the
    // one-shot fired. Keep the FX on Michelle's presented held-future lane.
    useCurrentStamp: true,
    minimumLeadFromCurrentHistory: 2,
    maximumLeadFromCurrentHistory: 2,
    maximumHistorySafeLeadOverride: 2,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead: 2,
    // CCP client treats long one-shot FX startTime as blue/FILETIME. Sending
    // raw milliseconds makes Leviathan/Ragnarok doomsdays look ancient and the
    // client silently drops them before the sequencer ever starts.
    startTime: resolveSuperweaponFxStartFileTime(scene, nowMs),
  };
  scene.broadcastSpecialFx(
    sourceEntity.itemID,
    effectState.guid,
    {
      ...baseFxOptions,
      ...(options && typeof options === "object" ? options : {}),
    },
    sourceEntity,
  );
  return true;
}

function broadcastLanceSuperweaponFxAfterBeaconAcquire(
  scene,
  sourceEntity,
  effectState,
  beaconEntity,
  nowMs,
) {
  if (
    !scene ||
    !sourceEntity ||
    !effectState ||
    effectState.superweaponEffect !== true ||
    !effectState.guid ||
    !beaconEntity
  ) {
    return {
      deliveredCount: 0,
    };
  }

  const beaconDeliveries = scene.broadcastAddBalls([beaconEntity], null, {
    freshAcquire: true,
    nowMs,
    bypassTickPresentationBatch: true,
  });
  if (!Array.isArray(beaconDeliveries) || beaconDeliveries.length === 0) {
    return {
      deliveredCount: 0,
    };
  }

  let deliveredCount = 0;
  for (const delivery of beaconDeliveries) {
    if (!delivery || !delivery.session) {
      continue;
    }
    const sourceCategoryID = toInt(sourceEntity && sourceEntity.categoryID, 0);
    const sourceSlimCategoryID = toInt(
      sourceEntity && sourceEntity.slimCategoryID,
      sourceCategoryID,
    );
    const useSourceShipModuleBinding = Boolean(
      sourceEntity &&
        sourceEntity.kind === "ship" &&
        (
          sourceEntity.nativeNpc === true ||
          sourceEntity.nativeNpcOccupied === true ||
          (
            sourceCategoryID > 0 &&
            sourceSlimCategoryID > 0 &&
            sourceSlimCategoryID !== sourceCategoryID
          )
        ),
    );
    const fxResult = scene.sendSpecialFxToSession(
      delivery.session,
      sourceEntity.itemID,
      effectState.guid,
      {
        moduleID: useSourceShipModuleBinding
          ? sourceEntity.itemID
          : effectState.moduleID,
        moduleTypeID: effectState.typeID,
        targetID: beaconEntity.itemID,
        isOffensive: true,
        start: true,
        active: effectState.superweaponFxStartActive === true,
        duration: Math.max(1, toInt(effectState.superweaponFxDurationMs, 10_000)),
        startTime: resolveSuperweaponFxStartFileTime(scene, nowMs),
        // Client parity: once the beacon acquire is delivered, keep the lance
        // start FX on that exact delivered lane so the ball already exists when
        // Michelle processes OnSpecialFX, without widening beyond +2.
        stampOverride:
          delivery.stamp !== null && delivery.stamp !== undefined
            ? (toInt(delivery.stamp, 0) >>> 0)
            : undefined,
        destinyAuthorityAllowPostHeldFuture: true,
      },
      beaconEntity,
    );
    if (fxResult && fxResult.delivered === true) {
      deliveredCount += 1;
    }
  }
  if (
    deliveredCount > 0 &&
    scene &&
    typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function"
  ) {
    scene.flushDirectDestinyNotificationBatchIfIdle();
  }

  return {
    deliveredCount,
  };
}

function executeSuperweaponActivation(options = {}) {
  const {
    scene,
    entity,
    moduleItem,
    effectState,
    nowMs = Date.now(),
    callbacks = {},
  } = options;

  if (!scene || !entity || !moduleItem || !effectState || effectState.superweaponEffect !== true) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_FOUND",
    };
  }

  if (
    callbacks.breakEntityStructureTether &&
    typeof callbacks.breakEntityStructureTether === "function"
  ) {
    callbacks.breakEntityStructureTether(scene, entity, {
      nowMs,
      reason: "SUPERWEAPON_ACTIVATION",
    });
  }

  const consumeFuelResult = consumeSuperweaponFuel(
    entity,
    effectState.superweaponFuelTypeID,
    effectState.superweaponFuelPerActivation,
    callbacks,
  );
  if (!consumeFuelResult.success) {
    return consumeFuelResult;
  }

  if (
    callbacks.stopShipEntity &&
    typeof callbacks.stopShipEntity === "function"
  ) {
    callbacks.stopShipEntity(entity, {
      reason: "superweapon",
      allowSessionlessWarpAbort: true,
    });
  }

  entity.superweaponImmobileUntilMs = Math.max(
    toFiniteNumber(entity.superweaponImmobileUntilMs, 0),
    nowMs + Math.max(0, toFiniteNumber(effectState.superweaponImmobilityDurationMs, 0)),
  );
  entity.superweaponNoJumpOrCloakUntilMs = Math.max(
    toFiniteNumber(entity.superweaponNoJumpOrCloakUntilMs, 0),
    nowMs + Math.max(0, toFiniteNumber(effectState.superweaponNoJumpOrCloakDurationMs, 0)),
  );
  if (
    callbacks.persistDynamicEntity &&
    typeof callbacks.persistDynamicEntity === "function"
  ) {
    callbacks.persistDynamicEntity(entity);
  }

  effectState.superweaponActivatedAtMs = nowMs;
  if (effectState.superweaponFamily === "doomsday") {
    effectState.superweaponDamageApplied = false;
    effectState.superweaponDamageAtMs = nowMs + Math.max(
      0,
      toFiniteNumber(effectState.superweaponDamageDelayMs, 0),
    );
  broadcastSuperweaponFx(
    scene,
    entity,
    effectState,
    effectState.superweaponPrimaryTargetID,
      nowMs,
    );
    return {
      success: true,
      data: {
        specialFxHandled: true,
      },
    };
  }

  if (effectState.superweaponFamily === "burstProjector") {
    const targetPoint = cloneVector(
      effectState.superweaponTargetPoint,
      cloneVector(entity.position),
    );
    const sourcePosition = cloneVector(entity.position);
    const direction = normalizeVector(
      subtractVectors(targetPoint, sourcePosition),
      entity.direction,
    );
    const beaconEntity = spawnLanceBeacon(scene, entity, targetPoint, nowMs, callbacks);
    if (!beaconEntity) {
      return {
        success: false,
        errorMsg: "TARGET_POINT_REQUIRED",
      };
    }

    effectState.superweaponSourcePosition = sourcePosition;
    effectState.superweaponDirection = direction;
    effectState.superweaponFxTargetID = beaconEntity.itemID;
    effectState.superweaponBeaconID = beaconEntity.itemID;
    const aoeWindowDurationMs = getBurstProjectorAOEWindowDurationMs(effectState);
    effectState.superweaponBeaconExpireAtMs =
      nowMs +
      Math.max(0, toFiniteNumber(effectState.superweaponWarningDurationMs, 0)) +
      aoeWindowDurationMs +
      1_000;
    effectState.superweaponDamageWindowStartMs =
      nowMs + Math.max(0, toFiniteNumber(effectState.superweaponWarningDurationMs, 0));
    effectState.superweaponDamageWindowEndMs =
      effectState.superweaponDamageWindowStartMs + aoeWindowDurationMs;
    effectState.superweaponLastProcessedPulse = -1;
    configureBurstProjectorWarpDisruptionBeacon(
      beaconEntity,
      entity,
      effectState,
      moduleItem,
    );

    if (effectState.guid) {
      broadcastLanceSuperweaponFxAfterBeaconAcquire(
        scene,
        entity,
        effectState,
        beaconEntity,
        nowMs,
      );
    } else if (scene && typeof scene.broadcastAddBalls === "function") {
      scene.broadcastAddBalls([beaconEntity], null, {
        freshAcquire: true,
        nowMs,
        bypassTickPresentationBatch: true,
      });
      if (typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function") {
        scene.flushDirectDestinyNotificationBatchIfIdle();
      }
    }

    return {
      success: true,
      data: {
        specialFxHandled: true,
        beaconEntity,
      },
    };
  }

  const targetPoint = cloneVector(
    effectState.superweaponTargetPoint,
    clampPointToFixedRange(
      entity,
      addVectors(entity.position, scaleVector(entity.direction, effectState.superweaponMaxRange)),
      effectState.superweaponMaxRange,
    ),
  );
  const sourcePosition = cloneVector(entity.position);
  const direction = normalizeVector(
    subtractVectors(targetPoint, sourcePosition),
    entity.direction,
  );
  const beaconEntity = spawnLanceBeacon(scene, entity, targetPoint, nowMs, callbacks);
  if (!beaconEntity) {
    return {
      success: false,
      errorMsg: "TARGET_POINT_REQUIRED",
    };
  }

  effectState.superweaponSourcePosition = sourcePosition;
  effectState.superweaponDirection = direction;
  effectState.superweaponFxTargetID = beaconEntity.itemID;
  effectState.superweaponBeaconID = beaconEntity.itemID;
  effectState.superweaponBeaconExpireAtMs =
    nowMs +
    Math.max(0, toFiniteNumber(effectState.superweaponFxLeadInMs, 0)) +
    Math.max(1, toFiniteNumber(effectState.superweaponFxDurationMs, 10_000)) +
    1_000;
  effectState.superweaponDamageWindowStartMs =
    nowMs + Math.max(0, toFiniteNumber(effectState.superweaponWarningDurationMs, 0));
  effectState.superweaponDamageWindowEndMs =
    effectState.superweaponDamageWindowStartMs +
    Math.max(0, toFiniteNumber(effectState.superweaponDamageDurationMs, 0));
  effectState.superweaponLastProcessedPulse = -1;

  if (effectState.guid) {
    // CCP parity: lances attach their primary FX to the modular-effect beacon,
    // and the client requires that target ball to already exist in ballpark
    // before the OnSpecialFX trigger is processed.
    broadcastLanceSuperweaponFxAfterBeaconAcquire(
      scene,
      entity,
      effectState,
      beaconEntity,
      nowMs,
    );
  } else if (scene && typeof scene.broadcastAddBalls === "function") {
    scene.broadcastAddBalls([beaconEntity], null, {
      freshAcquire: true,
      nowMs,
      bypassTickPresentationBatch: true,
    });
    if (typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function") {
      scene.flushDirectDestinyNotificationBatchIfIdle();
    }
  }

  return {
    success: true,
    data: {
      specialFxHandled: true,
      beaconEntity,
    },
  };
}

function finalizeSuperweaponDeactivation(options = {}) {
  const {
    scene,
    entity,
    effectState,
    nowMs = Date.now(),
    callbacks = {},
  } = options;

  if (!scene || !effectState || effectState.superweaponEffect !== true) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_ACTIVE",
    };
  }

  if (toInt(effectState.superweaponBeaconID, 0) > 0) {
    removeTransientEntity(scene, effectState.superweaponBeaconID, nowMs);
    effectState.superweaponBeaconID = 0;
  }
  if (effectState.superweaponFamily === "burstProjector" && entity) {
    cleanupBurstProjectorHostileDebuffs(scene, entity, effectState, nowMs, callbacks);
  }

  return {
    success: true,
  };
}

function tickDoomsdayEffect(scene, sourceEntity, effectState, moduleItem, nowMs, callbacks = {}) {
  if (!scene || !sourceEntity || !effectState || effectState.superweaponDamageApplied === true) {
    return;
  }
  if (toFiniteNumber(effectState.superweaponDamageAtMs, 0) > toFiniteNumber(nowMs, 0)) {
    return;
  }

  effectState.superweaponDamageApplied = true;
  const targetEntity = scene.getEntityByID(toInt(effectState.superweaponPrimaryTargetID, 0));
  if (!targetEntity || !hasDamageableHealth(targetEntity)) {
    return;
  }
  const damageLossPerJump = Math.max(
    0,
    toFiniteNumber(effectState.superweaponLightningDamageLossTarget, 0),
  );
  const chainTargets = collectLightningChainTargets(
    scene,
    sourceEntity,
    targetEntity,
    effectState,
  );
  for (let index = 0; index < chainTargets.length; index += 1) {
    const chainTarget = chainTargets[index];
    const damageMultiplier = index <= 0
      ? 1
      : Math.pow(damageLossPerJump, index);
    if (damageMultiplier <= 0) {
      continue;
    }
    applySuperweaponDamage(
      scene,
      sourceEntity,
      chainTarget,
      scaleDamageVector(effectState.superweaponDamageVector, damageMultiplier),
      moduleItem,
      nowMs,
      callbacks,
    );
  }
}

function tickLanceEffect(scene, sourceEntity, effectState, moduleItem, nowMs, callbacks = {}) {
  if (!scene || !sourceEntity || !effectState) {
    return;
  }

  if (
    toInt(effectState.superweaponBeaconID, 0) > 0 &&
    toFiniteNumber(effectState.superweaponBeaconExpireAtMs, 0) > 0 &&
    toFiniteNumber(nowMs, 0) >= toFiniteNumber(effectState.superweaponBeaconExpireAtMs, 0)
  ) {
    removeTransientEntity(scene, effectState.superweaponBeaconID, nowMs);
    effectState.superweaponBeaconID = 0;
  }

  const windowStart = toFiniteNumber(effectState.superweaponDamageWindowStartMs, 0);
  const windowEnd = toFiniteNumber(effectState.superweaponDamageWindowEndMs, 0);
  if (windowStart <= 0 || windowEnd <= 0 || nowMs < windowStart || windowStart >= windowEnd) {
    return;
  }

  const pulseDurationMs = Math.max(1, toFiniteNumber(effectState.superweaponDamageCycleTimeMs, 1000));
  const elapsed = Math.min(nowMs, windowEnd) - windowStart;
  const latestPulseIndex = Math.floor(elapsed / pulseDurationMs);
  const previousPulseIndex = toInt(effectState.superweaponLastProcessedPulse, -1);
  if (latestPulseIndex <= previousPulseIndex) {
    return;
  }

  const sourcePosition = cloneVector(
    effectState.superweaponSourcePosition,
    sourceEntity.position,
  );
  const direction = normalizeVector(
    effectState.superweaponDirection,
    sourceEntity.direction,
  );
  const length = Math.max(0, toFiniteNumber(effectState.superweaponMaxRange, 0));
  const damageRadius = Math.max(0, toFiniteNumber(effectState.superweaponDamageRadius, 0));
  const aoeShape = toInt(effectState.superweaponAOEShape, 0);

  for (let pulseIndex = previousPulseIndex + 1; pulseIndex <= latestPulseIndex; pulseIndex += 1) {
    const pulseTimeMs = Math.min(windowEnd, windowStart + (pulseIndex * pulseDurationMs));
    for (const targetEntity of collectPotentialCylinderTargets(scene)) {
      const isInsideDamageArea = aoeShape === 3
        ? isEntityInsideCone(
          sourcePosition,
          direction,
          length,
          targetEntity,
        )
        : isEntityInsideCylinder(
          sourcePosition,
          direction,
          length,
          damageRadius,
          targetEntity,
        );
      if (
        !targetEntity ||
        toInt(targetEntity.itemID, 0) === toInt(sourceEntity.itemID, 0) ||
        !hasDamageableHealth(targetEntity) ||
        !isInsideDamageArea
      ) {
        continue;
      }

      const damageApplication = resolveSignatureApplicationFactor(
        targetEntity,
        effectState.superweaponWeaponSignatureRadius,
      );
      if (damageApplication > 0) {
        applySuperweaponDamage(
          scene,
          sourceEntity,
          targetEntity,
          scaleDamageVector(effectState.superweaponDamageVector, damageApplication),
          moduleItem,
          pulseTimeMs,
          callbacks,
        );
      }

      const neutRadius = Math.max(
        damageRadius,
        toFiniteNumber(effectState.superweaponEnergyNeutRadius, 0),
      );
      if (
        toFiniteNumber(effectState.superweaponEnergyNeutAmount, 0) > 0 &&
        isEntityInsideCylinder(
          sourcePosition,
          direction,
          length,
          neutRadius,
          targetEntity,
        )
      ) {
        const neutApplication = resolveSignatureApplicationFactor(
          targetEntity,
          effectState.superweaponEnergyNeutSignatureRadius,
        );
        applyCapacitorDrain(
          targetEntity,
          toFiniteNumber(effectState.superweaponEnergyNeutAmount, 0) * neutApplication,
          pulseTimeMs,
          callbacks,
        );
      }
    }
  }

  effectState.superweaponLastProcessedPulse = latestPulseIndex;
}

function getBurstProjectorAffectedTargetIDs(effectState) {
  return new Set(
    (Array.isArray(effectState && effectState.superweaponBurstProjectorAffectedTargetIDs)
      ? effectState.superweaponBurstProjectorAffectedTargetIDs
      : []
    )
      .map((targetID) => toInt(targetID, 0))
      .filter((targetID) => targetID > 0),
  );
}

function setBurstProjectorAffectedTargetIDs(effectState, targetIDs) {
  effectState.superweaponBurstProjectorAffectedTargetIDs = [...targetIDs]
    .map((targetID) => toInt(targetID, 0))
    .filter((targetID) => targetID > 0);
}

function applyBurstProjectorHostileDebuff(
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  durationMs,
  callbacks = {},
) {
  if (
    !sourceEntity ||
    !targetEntity ||
    !hasBurstProjectorHostileDefinition(effectState) ||
    !callbacks.applySuperweaponHostileModuleState ||
    typeof callbacks.applySuperweaponHostileModuleState !== "function"
  ) {
    return false;
  }
  const targetEffectState = buildBurstProjectorHostileEffectState(
    effectState,
    targetEntity,
    nowMs,
    durationMs,
  );
  const result = callbacks.applySuperweaponHostileModuleState(
    sourceEntity,
    targetEntity,
    targetEffectState,
    nowMs,
    {
      durationMs,
    },
  );
  return Boolean(result && result.success === true);
}

function removeBurstProjectorHostileDebuff(
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  callbacks = {},
) {
  if (
    !sourceEntity ||
    !targetEntity ||
    !hasBurstProjectorHostileDefinition(effectState) ||
    !callbacks.removeSuperweaponHostileModuleState ||
    typeof callbacks.removeSuperweaponHostileModuleState !== "function"
  ) {
    return false;
  }
  const targetEffectState = buildBurstProjectorHostileEffectState(
    effectState,
    targetEntity,
    nowMs,
    1,
  );
  const result = callbacks.removeSuperweaponHostileModuleState(
    sourceEntity,
    targetEntity,
    targetEffectState,
    nowMs,
  );
  return Boolean(result && result.success === true);
}

function applyBurstProjectorJammerDebuff(
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  durationMs,
  callbacks = {},
) {
  if (
    !sourceEntity ||
    !targetEntity ||
    !hasBurstProjectorJammerDefinition(effectState) ||
    !callbacks.applySuperweaponJammerModuleState ||
    typeof callbacks.applySuperweaponJammerModuleState !== "function"
  ) {
    return false;
  }
  const targetEffectState = buildBurstProjectorJammerEffectState(
    effectState,
    targetEntity,
    nowMs,
    durationMs,
  );
  const result = callbacks.applySuperweaponJammerModuleState(
    sourceEntity,
    targetEntity,
    targetEffectState,
    nowMs,
    {
      durationMs,
    },
  );
  return Boolean(
    result &&
      result.success === true &&
      result.data &&
      result.data.jamApplied === true
  );
}

function removeBurstProjectorJammerDebuff(
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  callbacks = {},
) {
  if (
    !sourceEntity ||
    !targetEntity ||
    !hasBurstProjectorJammerDefinition(effectState) ||
    !callbacks.removeSuperweaponJammerModuleState ||
    typeof callbacks.removeSuperweaponJammerModuleState !== "function"
  ) {
    return false;
  }
  const targetEffectState = buildBurstProjectorJammerEffectState(
    effectState,
    targetEntity,
    nowMs,
    1,
  );
  const result = callbacks.removeSuperweaponJammerModuleState(
    sourceEntity,
    targetEntity,
    targetEffectState,
    nowMs,
  );
  return Boolean(result && result.success === true);
}

function resolveBurstProjectorEnergyNeutralizationMultiplier(effectState, targetEntity) {
  const resistanceMultiplier = resolveTargetResistanceMultiplier(
    targetEntity,
    effectState && effectState.superweaponBurstProjectorResistanceAttributeID,
  );
  const signatureResolution = Math.max(
    0,
    toFiniteNumber(effectState && effectState.superweaponBurstProjectorEnergySignatureResolution, 0),
  );
  const targetSignatureRadius = Math.max(
    0,
    toFiniteNumber(targetEntity && targetEntity.signatureRadius, 0),
  );
  const signatureMultiplier =
    signatureResolution > 0 && targetSignatureRadius > 0
      ? Math.min(1, targetSignatureRadius / signatureResolution)
      : 1;
  return roundNumber(
    Math.max(resistanceMultiplier, 0) * Math.max(signatureMultiplier, 0),
    6,
  );
}

function applyBurstProjectorEnergyNeutralization(
  targetEntity,
  effectState,
  nowMs,
  callbacks = {},
) {
  if (!targetEntity || !hasBurstProjectorEnergyNeutralizationDefinition(effectState)) {
    return false;
  }
  const drainMultiplier = resolveBurstProjectorEnergyNeutralizationMultiplier(
    effectState,
    targetEntity,
  );
  const drainAmount =
    Math.max(0, toFiniteNumber(effectState.superweaponBurstProjectorStrengthValue, 0)) *
    Math.max(0, drainMultiplier);
  return applyCapacitorDrain(targetEntity, drainAmount, nowMs, callbacks);
}

function applyBurstProjectorDebuff(
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  durationMs,
  callbacks = {},
) {
  const hostileApplied = applyBurstProjectorHostileDebuff(
    sourceEntity,
    targetEntity,
    effectState,
    nowMs,
    durationMs,
    callbacks,
  );
  const jammerApplied = applyBurstProjectorJammerDebuff(
    sourceEntity,
    targetEntity,
    effectState,
    nowMs,
    durationMs,
    callbacks,
  );
  return hostileApplied || jammerApplied;
}

function removeBurstProjectorDebuff(
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  callbacks = {},
) {
  const hostileRemoved = removeBurstProjectorHostileDebuff(
    sourceEntity,
    targetEntity,
    effectState,
    nowMs,
    callbacks,
  );
  const jammerRemoved = removeBurstProjectorJammerDebuff(
    sourceEntity,
    targetEntity,
    effectState,
    nowMs,
    callbacks,
  );
  return hostileRemoved || jammerRemoved;
}

function cleanupBurstProjectorHostileDebuffs(
  scene,
  sourceEntity,
  effectState,
  nowMs,
  callbacks = {},
) {
  const affectedTargetIDs = getBurstProjectorAffectedTargetIDs(effectState);
  if (affectedTargetIDs.size <= 0) {
    return;
  }
  for (const targetID of affectedTargetIDs) {
    const targetEntity = scene && typeof scene.getEntityByID === "function"
      ? scene.getEntityByID(targetID)
      : null;
    if (targetEntity) {
      removeBurstProjectorDebuff(
        sourceEntity,
        targetEntity,
        effectState,
        nowMs,
        callbacks,
      );
    }
  }
  setBurstProjectorAffectedTargetIDs(effectState, []);
}

function tickBurstProjectorHostileDebuffs(
  scene,
  sourceEntity,
  effectState,
  nowMs,
  callbacks = {},
) {
  if (
    !scene ||
    !sourceEntity ||
    !hasBurstProjectorDebuffDefinition(effectState) ||
    toInt(effectState.superweaponAOEShape, 0) !== 4
  ) {
    return;
  }

  const windowStart = toFiniteNumber(effectState.superweaponDamageWindowStartMs, 0);
  const windowEnd = toFiniteNumber(effectState.superweaponDamageWindowEndMs, 0);
  if (windowStart <= 0 || windowEnd <= 0 || windowStart >= windowEnd) {
    return;
  }
  if (nowMs < windowStart) {
    return;
  }
  if (nowMs >= windowEnd) {
    const instantPulsePending =
      effectState.superweaponBurstProjectorInstantPulse === true &&
      toInt(effectState.superweaponLastProcessedPulse, -1) < 0;
    if (!instantPulsePending) {
      cleanupBurstProjectorHostileDebuffs(scene, sourceEntity, effectState, nowMs, callbacks);
      effectState.superweaponBurstProjectorDebuffCleanedUp = true;
      return;
    }
  }

  const pulseIndex = Math.floor(
    (toFiniteNumber(nowMs, 0) - windowStart) /
      SUPERWEAPON_BURST_PROJECTOR_AOE_PULSE_MS,
  );
  if (pulseIndex <= toInt(effectState.superweaponLastProcessedPulse, -1)) {
    return;
  }
  effectState.superweaponLastProcessedPulse = pulseIndex;

  const center = cloneVector(
    effectState.superweaponTargetPoint,
    sourceEntity.position,
  );
  const radius = Math.max(0, toFiniteNumber(effectState.superweaponAOERange, 0));
  const affectedTargetIDs = getBurstProjectorAffectedTargetIDs(effectState);
  const currentTargetIDs = new Set();
  const remainingDurationMs = Math.max(1, windowEnd - toFiniteNumber(nowMs, 0));

  for (const targetEntity of collectPotentialBurstProjectorTargets(scene)) {
    if (
      !targetEntity ||
      toInt(targetEntity.itemID, 0) === toInt(sourceEntity.itemID, 0) ||
      !isEntityInsideSphere(center, radius, targetEntity)
    ) {
      continue;
    }
    const targetID = toInt(targetEntity.itemID, 0);
    if (!affectedTargetIDs.has(targetID)) {
      const applied = applyBurstProjectorDebuff(
        sourceEntity,
        targetEntity,
        effectState,
        nowMs,
        remainingDurationMs,
        callbacks,
      );
      if (!applied) {
        continue;
      }
    }
    applyBurstProjectorEnergyNeutralization(
      targetEntity,
      effectState,
      nowMs,
      callbacks,
    );
    currentTargetIDs.add(targetID);
  }

  for (const targetID of affectedTargetIDs) {
    if (currentTargetIDs.has(targetID)) {
      continue;
    }
    const targetEntity = scene.getEntityByID(targetID);
    if (targetEntity) {
      removeBurstProjectorDebuff(
        sourceEntity,
        targetEntity,
        effectState,
        nowMs,
        callbacks,
      );
    }
  }

  setBurstProjectorAffectedTargetIDs(effectState, currentTargetIDs);
}

function tickBurstProjectorEffect(scene, sourceEntity, effectState, moduleItem, nowMs, callbacks = {}) {
  void moduleItem;

  if (!scene || !effectState) {
    return;
  }

  tickBurstProjectorHostileDebuffs(
    scene,
    sourceEntity,
    effectState,
    nowMs,
    callbacks,
  );

  if (
    toInt(effectState.superweaponBeaconID, 0) > 0 &&
    toFiniteNumber(effectState.superweaponBeaconExpireAtMs, 0) > 0 &&
    toFiniteNumber(nowMs, 0) >= toFiniteNumber(effectState.superweaponBeaconExpireAtMs, 0)
  ) {
    removeTransientEntity(scene, effectState.superweaponBeaconID, nowMs);
    effectState.superweaponBeaconID = 0;
  }
}

function tickShowController(scene, controller, nowMs, callbacks = {}) {
  if (!scene || !controller || controller.active !== true) {
    return;
  }

  const fleetA = controller.fleetA
    .map((entry) => ({
      ...entry,
      entity: scene.getEntityByID(toInt(entry && entry.entityID, 0)),
    }))
    .filter((entry) => entry.entity && hasDamageableHealth(entry.entity));
  const fleetB = controller.fleetB
    .map((entry) => ({
      ...entry,
      entity: scene.getEntityByID(toInt(entry && entry.entityID, 0)),
    }))
    .filter((entry) => entry.entity && hasDamageableHealth(entry.entity));

  controller.fleetA = fleetA.map((entry) => ({
    entityID: entry.entityID,
    profile: entry.profile,
    nextFamily: entry.nextFamily,
  }));
  controller.fleetB = fleetB.map((entry) => ({
    entityID: entry.entityID,
    profile: entry.profile,
    nextFamily: entry.nextFamily,
  }));

  if (fleetA.length === 0 || fleetB.length === 0) {
    controller.active = false;
    controller.pendingVolley = [];
    return;
  }

  const pickRandom =
    typeof controller.random === "function"
      ? controller.random
      : Math.random;
  const chooseTarget = (list) => {
    const boundedRandom = Math.min(0.999999, Math.max(0, Number(pickRandom()) || 0));
    return list[Math.floor(boundedRandom * list.length)] || list[0] || null;
  };

  const buildVolleyQueue = () => {
    const queueA = fleetA
      .map((source) => ({
        source,
        targetEntry: chooseTarget(fleetB),
      }))
      .filter((entry) => entry.targetEntry && entry.targetEntry.entity);
    const queueB = fleetB
      .map((source) => ({
        source,
        targetEntry: chooseTarget(fleetA),
      }))
      .filter((entry) => entry.targetEntry && entry.targetEntry.entity);
    const queue = [];
    const pairCount = Math.max(queueA.length, queueB.length);
    for (let index = 0; index < pairCount; index += 1) {
      if (queueA[index]) {
        queue.push(queueA[index]);
      }
      if (queueB[index]) {
        queue.push(queueB[index]);
      }
    }
    return queue;
  };

  for (const source of [...fleetA, ...fleetB]) {
    const targetFleet = fleetA.includes(source) ? fleetB : fleetA;
    const desiredTarget = chooseTarget(targetFleet);
    if (
      !desiredTarget ||
      !desiredTarget.entity ||
      isSuperweaponMovementLocked(source.entity, nowMs) ||
      hasActiveSuperweaponEffect(source.entity)
    ) {
      continue;
    }
    setEntityMotionTowardTarget(source.entity, desiredTarget.entity, callbacks);
  }

  if (toFiniteNumber(controller.nextVolleyAtMs, 0) > toFiniteNumber(nowMs, 0)) {
    return;
  }

  const fireVolley = (source, targetEntry) => {
    const profile = source.profile;
    const sourceEntity = source.entity;
    const targetEntity = targetEntry && targetEntry.entity;
    if (!profile || !sourceEntity || !targetEntity) {
      return false;
    }

    if (
      scene.finalizeTargetLock &&
      typeof scene.finalizeTargetLock === "function"
    ) {
      scene.finalizeTargetLock(sourceEntity, targetEntity, {
        nowMs,
      });
    }

    const nextFamily = String(source.nextFamily || "doomsday").toLowerCase();
    const preferredModule = nextFamily === "lance"
      ? getFittedModuleByTypeID(sourceEntity, profile.lanceTypeID)
      : getFittedModuleByTypeID(sourceEntity, profile.doomsdayTypeID);
    const fallbackModule = nextFamily === "lance"
      ? getFittedModuleByTypeID(sourceEntity, profile.doomsdayTypeID)
      : getFittedModuleByTypeID(sourceEntity, profile.lanceTypeID);
    const moduleItem = preferredModule || fallbackModule;
    if (!moduleItem) {
      return false;
    }

    const pseudoSession = buildNpcPseudoSession(sourceEntity);
    const activationOptions =
      toInt(moduleItem.typeID, 0) === toInt(profile.lanceTypeID, 0)
        ? {
            targetPoint: cloneVector(targetEntity.position),
            repeat: 1,
          }
        : {
            targetID: targetEntity.itemID,
            repeat: 1,
          };
    const activationResult = scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      null,
      activationOptions,
    );
    if (!activationResult || activationResult.success !== true) {
      return false;
    }
    const firedFamily =
      toInt(moduleItem.typeID, 0) === toInt(profile.lanceTypeID, 0)
        ? "lance"
        : "doomsday";
    source.nextFamily =
      preferredModule && fallbackModule
        ? firedFamily === "lance"
          ? "doomsday"
          : "lance"
        : firedFamily;
    return true;
  };

  if (!Array.isArray(controller.pendingVolley) || controller.pendingVolley.length === 0) {
    if (toFiniteNumber(controller.nextVolleyAtMs, 0) > toFiniteNumber(nowMs, 0)) {
      return;
    }
    controller.pendingVolley = buildVolleyQueue();
    controller.nextVolleyStepAtMs = toFiniteNumber(nowMs, 0);
  }

  if (toFiniteNumber(controller.nextVolleyStepAtMs, 0) > toFiniteNumber(nowMs, 0)) {
    return;
  }

  const batchSize = Math.max(
    1,
    toInt(controller.volleyBatchSize, DEFAULT_SHOW_VOLLEY_BATCH_SIZE),
  );
  const volleyStepMs = Math.max(
    1,
    toInt(controller.volleyStepMs, DEFAULT_SHOW_VOLLEY_STEP_MS),
  );
  const batch = controller.pendingVolley.splice(0, batchSize);
  for (const entry of batch) {
    fireVolley(entry.source, entry.targetEntry);
  }

  if (controller.pendingVolley.length > 0) {
    controller.nextVolleyStepAtMs = nowMs + volleyStepMs;
    return;
  }

  controller.nextVolleyStepAtMs = 0;
  controller.nextVolleyAtMs = nowMs + Math.max(
    1,
    toInt(controller.refireMs, DEFAULT_SHOW_REFIRE_MS),
  );
}

function registerSuperTitanShowController(scene, options = {}) {
  if (!scene) {
    return null;
  }
  const nowMs =
    scene.getCurrentSimTimeMs &&
    typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : Date.now();
  scene.superTitanShowController = {
    active: true,
    fleetA: Array.isArray(options.fleetA) ? options.fleetA.map((entry) => ({ ...entry })) : [],
    fleetB: Array.isArray(options.fleetB) ? options.fleetB.map((entry) => ({ ...entry })) : [],
    random: typeof options.random === "function" ? options.random : Math.random,
    refireMs: Math.max(1, toInt(options.refireMs, DEFAULT_SHOW_REFIRE_MS)),
    volleyBatchSize: Math.max(
      1,
      toInt(options.volleyBatchSize, DEFAULT_SHOW_VOLLEY_BATCH_SIZE),
    ),
    volleyStepMs: Math.max(
      1,
      toInt(options.volleyStepMs, DEFAULT_SHOW_VOLLEY_STEP_MS),
    ),
    pendingVolley: [],
    nextVolleyStepAtMs: 0,
    nextVolleyAtMs: nowMs + Math.max(
      0,
      toInt(options.initialDelayMs, DEFAULT_SHOW_INITIAL_DELAY_MS),
    ),
  };
  return scene.superTitanShowController;
}

function tickScene(scene, nowMs, callbacks = {}) {
  if (!scene) {
    return;
  }

  if (scene.dynamicEntities instanceof Map) {
    for (const entity of scene.dynamicEntities.values()) {
      if (!entity || !(entity.activeModuleEffects instanceof Map)) {
        continue;
      }
      for (const effectState of entity.activeModuleEffects.values()) {
        if (!effectState || effectState.superweaponEffect !== true) {
          continue;
        }
        const moduleItem =
          callbacks.getEntityRuntimeModuleItem &&
          typeof callbacks.getEntityRuntimeModuleItem === "function"
            ? callbacks.getEntityRuntimeModuleItem(
                entity,
                effectState.moduleID,
                effectState.moduleFlagID,
              )
            : null;
        if (!moduleItem) {
          continue;
        }
        if (effectState.superweaponFamily === "doomsday") {
          tickDoomsdayEffect(scene, entity, effectState, moduleItem, nowMs, callbacks);
        } else if (effectState.superweaponFamily === "lance") {
          tickLanceEffect(scene, entity, effectState, moduleItem, nowMs, callbacks);
        } else if (effectState.superweaponFamily === "burstProjector") {
          tickBurstProjectorEffect(scene, entity, effectState, moduleItem, nowMs, callbacks);
        }
      }
    }
  }

  tickShowController(scene, scene.superTitanShowController, nowMs, callbacks);
}

module.exports = {
  broadcastSuperweaponFxForTesting: broadcastSuperweaponFx,
  buildSuperweaponFreshAcquireFxOptions,
  buildNpcPseudoSession,
  inspectSuperweaponActivationContract,
  isSuperweaponFxReplayWindowActive,
  isSuperweaponMovementLocked,
  isSuperweaponJumpOrCloakLocked,
  prepareSuperweaponActivation,
  executeSuperweaponActivation,
  finalizeSuperweaponDeactivation,
  registerSuperTitanShowController,
  tickScene,
};
