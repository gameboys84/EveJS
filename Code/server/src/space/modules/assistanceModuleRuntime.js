const path = require("path");

const {
  getAttributeIDByNames,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "./liveModuleAttributes"));
const {
  getActiveImplantLocationModifierSources,
  getActiveImplantShipModifierEntries,
} = require(path.join(
  __dirname,
  "../../services/dogma/implants/activeImplantModifiers",
));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_FALLOFF_EFFECTIVENESS = getAttributeIDByNames("falloffEffectiveness") || 2044;
const ATTRIBUTE_SHIELD_BONUS = getAttributeIDByNames("shieldBonus") || 68;
const ATTRIBUTE_ARMOR_DAMAGE_AMOUNT = getAttributeIDByNames("armorDamageAmount") || 84;
const ATTRIBUTE_STRUCTURE_DAMAGE_AMOUNT = getAttributeIDByNames("structureDamageAmount") || 83;
const ATTRIBUTE_POWER_TRANSFER_AMOUNT = getAttributeIDByNames("powerTransferAmount") || 90;
const ATTRIBUTE_MAX_TARGET_RANGE_BONUS =
  getAttributeIDByNames("maxTargetRangeBonus") || 309;
const ATTRIBUTE_SCAN_RESOLUTION_BONUS =
  getAttributeIDByNames("scanResolutionBonus") || 566;
const ATTRIBUTE_MAX_RANGE_BONUS = getAttributeIDByNames("maxRangeBonus") || 351;
const ATTRIBUTE_FALLOFF_BONUS = getAttributeIDByNames("falloffBonus") || 349;
const ATTRIBUTE_TRACKING_SPEED_BONUS =
  getAttributeIDByNames("trackingSpeedBonus") || 767;
const ATTRIBUTE_TRACKING_SPEED = getAttributeIDByNames("trackingSpeed") || 160;
const ATTRIBUTE_WEAPON_FALLOFF = getAttributeIDByNames("falloff") || 158;
const ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH_PERCENT =
  getAttributeIDByNames("scanGravimetricStrengthPercent") || 1027;
const ATTRIBUTE_SCAN_LADAR_STRENGTH_PERCENT =
  getAttributeIDByNames("scanLadarStrengthPercent") || 1028;
const ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH_PERCENT =
  getAttributeIDByNames("scanMagnetometricStrengthPercent") || 1029;
const ATTRIBUTE_SCAN_RADAR_STRENGTH_PERCENT =
  getAttributeIDByNames("scanRadarStrengthPercent") || 1030;
const ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH =
  getAttributeIDByNames("scanGravimetricStrength") || 211;
const ATTRIBUTE_SCAN_LADAR_STRENGTH =
  getAttributeIDByNames("scanLadarStrength") || 209;
const ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH =
  getAttributeIDByNames("scanMagnetometricStrength") || 210;
const ATTRIBUTE_SCAN_RADAR_STRENGTH =
  getAttributeIDByNames("scanRadarStrength") || 208;
const ATTRIBUTE_REMOTE_REPAIR_IMPEDANCE =
  getAttributeIDByNames("remoteRepairImpedance") || 2116;
const ATTRIBUTE_REMOTE_RESISTANCE_ID = getAttributeIDByNames("remoteResistanceID") || 2138;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
const DOGMA_OP_POST_PERCENT = 6;
const PERSISTENT_SPECIAL_FX_WINDOW_MS = 12 * 60 * 60 * 1000;
const CATEGORY_STRUCTURE = 65;
const STRUCTURE_REMOTE_REPAIR_ERROR = "STRUCTURE_REMOTE_REPAIR_NOT_ALLOWED";
const REMOTE_REPAIR_FAMILIES = new Set([
  "remoteShield",
  "remoteArmor",
  "remoteHull",
]);
const ASSISTANCE_FAMILY_REMOTE_CAPACITOR = "remoteCapacitor";
const ASSISTANCE_FAMILY_REMOTE_SENSOR_BOOST = "remoteSensorBoost";
const ASSISTANCE_FAMILY_REMOTE_TRACKING = "remoteTracking";

const ASSISTANCE_EFFECTS = Object.freeze({
  shipmoduleremotecapacitortransmitter: Object.freeze({
    family: ASSISTANCE_FAMILY_REMOTE_CAPACITOR,
    jammingType: "energyTransfer",
  }),
  shipmoduleremoteshieldbooster: Object.freeze({
    family: "remoteShield",
    jammingType: "shieldTransfer",
  }),
  shipmoduleremotearmorrepairer: Object.freeze({
    family: "remoteArmor",
    jammingType: "remoteArmorRepair",
  }),
  shipmoduleremotearmormutadaptiverepairer: Object.freeze({
    family: "remoteArmor",
    jammingType: "RemoteArmorMutadaptiveRepairer",
  }),
  shipmoduleremotehullrepairer: Object.freeze({
    family: "remoteHull",
    jammingType: "remoteHullRepair",
  }),
  npcbehaviorremotearmorrepairer: Object.freeze({
    family: "remoteArmor",
    jammingType: "remoteArmorRepair",
  }),
  remotesensorboostfalloff: Object.freeze({
    family: ASSISTANCE_FAMILY_REMOTE_SENSOR_BOOST,
    jammingType: "remoteSensorBoost",
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
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH_PERCENT,
        modifiedAttributeID: ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_SCAN_LADAR_STRENGTH_PERCENT,
        modifiedAttributeID: ATTRIBUTE_SCAN_LADAR_STRENGTH,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH_PERCENT,
        modifiedAttributeID: ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_SCAN_RADAR_STRENGTH_PERCENT,
        modifiedAttributeID: ATTRIBUTE_SCAN_RADAR_STRENGTH,
        operation: DOGMA_OP_POST_PERCENT,
      }),
    ]),
  }),
  shipmoduleremotetrackingcomputer: Object.freeze({
    family: ASSISTANCE_FAMILY_REMOTE_TRACKING,
    jammingType: "remoteTracking",
    stackingPenalized: true,
    affectsTargetDerivedState: false,
    weaponModuleModifierSpecs: Object.freeze([
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, toFiniteNumber(value, min)));
}

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim().toLowerCase();
}

function resolveAssistanceDefinition(effectRecord) {
  return ASSISTANCE_EFFECTS[normalizeEffectName(effectRecord)] || null;
}

function isStructureEntity(entity) {
  return Boolean(
    entity && (
      entity.kind === "structure" ||
      toInt(entity.categoryID, 0) === CATEGORY_STRUCTURE
    ),
  );
}

function isRemoteRepairFamily(value) {
  return REMOTE_REPAIR_FAMILIES.has(String(value || ""));
}

function isBlockedStructureRemoteRepair(effectData, targetEntity) {
  const family = effectData
    ? effectData.family || effectData.assistanceFamily
    : null;
  return (
    isStructureEntity(targetEntity) &&
    isRemoteRepairFamily(family)
  );
}

function getPreferredAttributeValue(moduleAttributes, attributeIDs, fallback = 0) {
  const resolvedAttributes =
    moduleAttributes && typeof moduleAttributes === "object"
      ? moduleAttributes
      : null;
  if (!resolvedAttributes) {
    return toFiniteNumber(fallback, 0);
  }

  for (const attributeID of Array.isArray(attributeIDs) ? attributeIDs : [attributeIDs]) {
    const numericAttributeID = toInt(attributeID, 0);
    if (numericAttributeID <= 0) {
      continue;
    }
    const numericValue = Number(resolvedAttributes[numericAttributeID]);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return toFiniteNumber(fallback, 0);
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

function resolveRemoteAssistanceMultiplier(targetEntity, resistanceAttributeID) {
  const normalizedResistanceAttributeID = toInt(resistanceAttributeID, 0);
  const targetResistanceAttributeID = normalizedResistanceAttributeID > 0
    ? normalizedResistanceAttributeID
    : ATTRIBUTE_REMOTE_REPAIR_IMPEDANCE;
  // Unit 108 is an inverse absolute percent: 1 applies fully, 0 is fully impeded.
  return roundNumber(clamp(
    getEntityPassiveAttributeValue(targetEntity, targetResistanceAttributeID, 1),
    0,
    1,
  ), 6);
}

function resolveAssistanceResistanceMultiplier(effectState, targetEntity) {
  const resistanceAttributeID = toInt(
    effectState && effectState.assistanceRemoteResistanceAttributeID,
    0,
  );
  if (resistanceAttributeID > 0) {
    return resolveRemoteAssistanceMultiplier(targetEntity, resistanceAttributeID);
  }
  const family = String(effectState && effectState.assistanceFamily || "");
  if (
    isRemoteRepairFamily(family) ||
    family === ASSISTANCE_FAMILY_REMOTE_CAPACITOR
  ) {
    return resolveRemoteAssistanceMultiplier(targetEntity, 0);
  }
  return 1;
}

function resolvePersistentRepeat(durationMs) {
  const cycleMs = Math.max(1, toFiniteNumber(durationMs, 1000));
  return Math.max(1, Math.ceil(PERSISTENT_SPECIAL_FX_WINDOW_MS / cycleMs));
}

function resolveAssistanceMultiplier(effectState, sourceEntity, targetEntity, callbacks = {}) {
  const surfaceDistance = Math.max(
    0,
    toFiniteNumber(
      callbacks.getEntitySurfaceDistance &&
        callbacks.getEntitySurfaceDistance(sourceEntity, targetEntity),
      0,
    ),
  );
  const optimalRangeMeters = Math.max(
    0,
    toFiniteNumber(effectState && effectState.assistanceMaxRangeMeters, 0),
  );
  const falloffMeters = Math.max(
    0,
    toFiniteNumber(effectState && effectState.assistanceFalloffMeters, 0),
  );

  if (surfaceDistance <= optimalRangeMeters + 1) {
    return {
      success: true,
      multiplier: 1,
      surfaceDistance,
    };
  }
  if (falloffMeters <= 0) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      stopReason: "target",
      surfaceDistance,
    };
  }

  const distanceIntoFalloff = surfaceDistance - optimalRangeMeters;
  if (distanceIntoFalloff > falloffMeters + 1) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      stopReason: "target",
      surfaceDistance,
    };
  }

  const normalizedDistance = distanceIntoFalloff / Math.max(falloffMeters, 1);
  return {
    success: true,
    multiplier: roundNumber(0.5 ** (normalizedDistance ** 2), 6),
    surfaceDistance,
  };
}

function buildAssistanceModifierEntries(attributeMap, modifierSpecs = [], stackingPenalized = false) {
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

function buildTargetAssistanceStateKey(sourceBallID, moduleID, targetBallID) {
  return [
    toInt(sourceBallID, 0),
    toInt(moduleID, 0),
    toInt(targetBallID, 0),
  ].join(":");
}

function ensureTargetAssistanceState(targetEntity, create = false) {
  if (!targetEntity || typeof targetEntity !== "object") {
    return null;
  }
  if (!targetEntity.assistanceModuleState && create) {
    targetEntity.assistanceModuleState = {
      incomingEffects: new Map(),
      modifierEntries: Object.freeze([]),
      weaponModuleModifierEntries: Object.freeze([]),
      weaponChargeModifierEntries: Object.freeze([]),
      aggregateSignature: "",
    };
  }
  return (
    targetEntity.assistanceModuleState &&
    targetEntity.assistanceModuleState.incomingEffects instanceof Map
  )
    ? targetEntity.assistanceModuleState
    : null;
}

function hasAssistanceModifierEffect(effectState) {
  return Boolean(
    effectState &&
    (
      (
        Array.isArray(effectState.assistanceModifierEntries) &&
        effectState.assistanceModifierEntries.length > 0
      ) ||
      (
        Array.isArray(effectState.assistanceWeaponModuleModifierEntries) &&
        effectState.assistanceWeaponModuleModifierEntries.length > 0
      ) ||
      (
        Array.isArray(effectState.assistanceWeaponChargeModifierEntries) &&
        effectState.assistanceWeaponChargeModifierEntries.length > 0
      )
    )
  );
}

function buildAssistanceTargetRecord(sourceEntity, effectState, targetEntity, nowMs, rangeMultiplier) {
  return Object.freeze({
    key: buildTargetAssistanceStateKey(
      sourceEntity && sourceEntity.itemID,
      effectState && effectState.moduleID,
      targetEntity && targetEntity.itemID,
    ),
    sourceBallID: toInt(sourceEntity && sourceEntity.itemID, 0),
    moduleID: toInt(effectState && effectState.moduleID, 0),
    effectID: toInt(effectState && effectState.effectID, 0),
    moduleTypeID: toInt(effectState && effectState.typeID, 0),
    moduleGroupID: toInt(effectState && effectState.groupID, 0),
    chargeTypeID: toInt(effectState && effectState.chargeTypeID, 0),
    targetBallID: toInt(targetEntity && targetEntity.itemID, 0),
    family: String(effectState && effectState.assistanceFamily || ""),
    jammingType: String(effectState && effectState.assistanceJammingType || ""),
    startedAtMs: Math.max(0, toFiniteNumber(nowMs, Date.now())),
    expiresAtMs: Math.max(
      0,
      toFiniteNumber(nowMs, Date.now()) +
        Math.max(1, toFiniteNumber(effectState && effectState.durationMs, 1000)),
    ),
    rangeMultiplier: roundNumber(rangeMultiplier, 6),
    resistanceAttributeID: toInt(effectState && effectState.assistanceRemoteResistanceAttributeID, 0),
    modifierEntries: Object.freeze(
      (Array.isArray(effectState && effectState.assistanceModifierEntries)
        ? effectState.assistanceModifierEntries
        : []
      ).map((entry) => Object.freeze({ ...entry })),
    ),
    weaponModuleModifierEntries: Object.freeze(
      (Array.isArray(effectState && effectState.assistanceWeaponModuleModifierEntries)
        ? effectState.assistanceWeaponModuleModifierEntries
        : []
      ).map((entry) => Object.freeze({ ...entry })),
    ),
    weaponChargeModifierEntries: Object.freeze(
      (Array.isArray(effectState && effectState.assistanceWeaponChargeModifierEntries)
        ? effectState.assistanceWeaponChargeModifierEntries
        : []
      ).map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

function buildAggregateSignature(modifierEntries, weaponModuleModifierEntries, weaponChargeModifierEntries) {
  return JSON.stringify({
    entries: (Array.isArray(modifierEntries) ? modifierEntries : []).map((entry) => ({
      attribute: toInt(entry && entry.modifiedAttributeID, 0),
      operation: toInt(entry && entry.operation, 0),
      value: roundNumber(entry && entry.value, 6),
      stackingPenalized: entry && entry.stackingPenalized === true,
    })),
    weaponModuleEntries: (Array.isArray(weaponModuleModifierEntries) ? weaponModuleModifierEntries : []).map((entry) => ({
      attribute: toInt(entry && entry.modifiedAttributeID, 0),
      operation: toInt(entry && entry.operation, 0),
      value: roundNumber(entry && entry.value, 6),
      stackingPenalized: entry && entry.stackingPenalized === true,
    })),
    weaponChargeEntries: (Array.isArray(weaponChargeModifierEntries) ? weaponChargeModifierEntries : []).map((entry) => ({
      attribute: toInt(entry && entry.modifiedAttributeID, 0),
      operation: toInt(entry && entry.operation, 0),
      value: roundNumber(entry && entry.value, 6),
      stackingPenalized: entry && entry.stackingPenalized === true,
    })),
  });
}

function appendScaledModifierEntries(destination, entries, scaledMultiplier) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = roundNumber(
      toFiniteNumber(entry && entry.value, 0) * Math.max(scaledMultiplier, 0),
      6,
    );
    if (Math.abs(value) <= 1e-6) {
      continue;
    }
    destination.push({
      modifiedAttributeID: toInt(entry && entry.modifiedAttributeID, 0),
      operation: toInt(entry && entry.operation, -1),
      value,
      stackingPenalized: entry && entry.stackingPenalized === true,
    });
  }
}

function recomputeTargetAssistanceAggregateState(targetEntity) {
  const targetState = ensureTargetAssistanceState(targetEntity, false);
  if (!targetState) {
    return {
      changed: false,
      modifierEntries: [],
      weaponModuleModifierEntries: [],
      weaponChargeModifierEntries: [],
    };
  }

  const modifierEntries = [];
  const weaponModuleModifierEntries = [];
  const weaponChargeModifierEntries = [];
  for (const record of targetState.incomingEffects.values()) {
    if (!record) {
      continue;
    }
    const resistanceMultiplier = record.resistanceAttributeID > 0
      ? resolveRemoteAssistanceMultiplier(targetEntity, record.resistanceAttributeID)
      : 1;
    const scaledMultiplier =
      Math.max(record.rangeMultiplier, 0) *
      Math.max(resistanceMultiplier, 0);
    appendScaledModifierEntries(modifierEntries, record.modifierEntries, scaledMultiplier);
    appendScaledModifierEntries(
      weaponModuleModifierEntries,
      record.weaponModuleModifierEntries,
      scaledMultiplier,
    );
    appendScaledModifierEntries(
      weaponChargeModifierEntries,
      record.weaponChargeModifierEntries,
      scaledMultiplier,
    );
  }

  const nextSignature = buildAggregateSignature(
    modifierEntries,
    weaponModuleModifierEntries,
    weaponChargeModifierEntries,
  );
  const changed = nextSignature !== String(targetState.aggregateSignature || "");
  targetState.modifierEntries = Object.freeze(
    modifierEntries.map((entry) => Object.freeze({ ...entry })),
  );
  targetState.weaponModuleModifierEntries = Object.freeze(
    weaponModuleModifierEntries.map((entry) => Object.freeze({ ...entry })),
  );
  targetState.weaponChargeModifierEntries = Object.freeze(
    weaponChargeModifierEntries.map((entry) => Object.freeze({ ...entry })),
  );
  targetState.aggregateSignature = nextSignature;
  return {
    changed,
    modifierEntries: targetState.modifierEntries,
    weaponModuleModifierEntries: targetState.weaponModuleModifierEntries,
    weaponChargeModifierEntries: targetState.weaponChargeModifierEntries,
  };
}

function collectModifierEntriesForTarget(targetEntity) {
  const targetState = ensureTargetAssistanceState(targetEntity, false);
  if (!targetState || !Array.isArray(targetState.modifierEntries)) {
    return [];
  }
  return [...targetState.modifierEntries];
}

function collectWeaponModifierEntriesForTarget(targetEntity) {
  const targetState = ensureTargetAssistanceState(targetEntity, false);
  if (!targetState) {
    return {
      moduleEntries: [],
      chargeEntries: [],
    };
  }
  return {
    moduleEntries: Array.isArray(targetState.weaponModuleModifierEntries)
      ? [...targetState.weaponModuleModifierEntries]
      : [],
    chargeEntries: Array.isArray(targetState.weaponChargeModifierEntries)
      ? [...targetState.weaponChargeModifierEntries]
      : [],
  };
}

function upsertTargetAssistanceRecord(targetEntity, record) {
  const targetState = ensureTargetAssistanceState(targetEntity, true);
  const previousRecord = targetState.incomingEffects.get(record.key) || null;
  targetState.incomingEffects.set(record.key, record);
  return {
    changed:
      !previousRecord ||
      previousRecord.rangeMultiplier !== record.rangeMultiplier ||
      previousRecord.startedAtMs !== record.startedAtMs ||
      previousRecord.expiresAtMs !== record.expiresAtMs,
    previousRecord,
    record,
  };
}

function removeTargetAssistanceRecord(targetEntity, sourceEntity, effectState) {
  const targetState = ensureTargetAssistanceState(targetEntity, false);
  if (!targetState) {
    return null;
  }
  const key = buildTargetAssistanceStateKey(
    sourceEntity && sourceEntity.itemID,
    effectState && effectState.moduleID,
    targetEntity && targetEntity.itemID,
  );
  const existing = targetState.incomingEffects.get(key) || null;
  if (!existing) {
    return null;
  }
  targetState.incomingEffects.delete(key);
  return existing;
}

function refreshAssistanceModuleState({
  scene,
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  rangeMultiplier = 1,
} = {}) {
  if (!scene || !sourceEntity || !targetEntity || !effectState) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
      stopReason: "module",
    };
  }
  if (!hasAssistanceModifierEffect(effectState)) {
    return {
      success: true,
      data: {
        targetEntity,
        aggregateChanged: false,
        recordChanged: false,
        multiplier: Math.max(0, toFiniteNumber(rangeMultiplier, 0)),
      },
    };
  }

  const record = buildAssistanceTargetRecord(
    sourceEntity,
    effectState,
    targetEntity,
    nowMs,
    rangeMultiplier,
  );
  const upsertResult = upsertTargetAssistanceRecord(targetEntity, record);
  const aggregateResult = recomputeTargetAssistanceAggregateState(targetEntity);
  return {
    success: true,
    data: {
      targetEntity,
      record,
      recordChanged: upsertResult.changed,
      aggregateChanged: aggregateResult.changed,
      multiplier: Math.max(0, toFiniteNumber(rangeMultiplier, 0)),
    },
  };
}

function removeAssistanceModuleState({
  targetEntity,
  sourceEntity,
  effectState,
} = {}) {
  if (!targetEntity || !sourceEntity || !effectState) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }
  const removedRecord = removeTargetAssistanceRecord(targetEntity, sourceEntity, effectState);
  const aggregateResult = recomputeTargetAssistanceAggregateState(targetEntity);
  return {
    success: true,
    data: {
      removedRecord,
      targetEntity,
      aggregateChanged: aggregateResult.changed,
    },
  };
}

function resolveSourceCharacterID(entity) {
  return toInt(
    entity && (
      entity.characterID ??
      entity.pilotCharacterID ??
      (entity.session && (entity.session.characterID || entity.session.charid))
    ),
    0,
  );
}

function resolveAssistanceModuleActivation({
  scene,
  entity,
  moduleItem,
  effectRecord,
  chargeItem = null,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
  options = {},
  callbacks = {},
} = {}) {
  const definition = resolveAssistanceDefinition(effectRecord);
  if (!definition) {
    return { matched: false };
  }

  if (!scene || !entity || !moduleItem || !shipItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const normalizedTargetID = toInt(options.targetID, 0);
  if (normalizedTargetID <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_REQUIRED",
    };
  }

  const targetEntity = scene.getEntityByID(normalizedTargetID);
  if (isBlockedStructureRemoteRepair(definition, targetEntity)) {
    return {
      matched: true,
      success: false,
      errorMsg: STRUCTURE_REMOTE_REPAIR_ERROR,
      stopReason: "target",
    };
  }
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  if (
    !callbacks.isEntityLockedTarget ||
    callbacks.isEntityLockedTarget(entity, normalizedTargetID) !== true
  ) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_NOT_LOCKED",
    };
  }

  const characterID = resolveSourceCharacterID(entity);
  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
    {
      additionalLocationModifierSources:
        characterID > 0
          ? getActiveImplantLocationModifierSources(characterID)
          : [],
      additionalShipModifierEntries:
        characterID > 0
          ? getActiveImplantShipModifierEntries(characterID)
          : [],
    },
  );
  if (!moduleAttributes) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const preferredDurationAttributeID = (
    getPreferredAttributeValue(moduleAttributes, [
      effectRecord && effectRecord.durationAttributeID,
    ], 0) > 0
  )
    ? toInt(effectRecord && effectRecord.durationAttributeID, 0)
    : 0;
  const rawDurationMs = getPreferredAttributeValue(
    moduleAttributes,
    [
      preferredDurationAttributeID,
      ATTRIBUTE_DURATION,
      ATTRIBUTE_SPEED,
    ],
    1000,
  );
  const durationAttributeID =
    preferredDurationAttributeID > 0
      ? preferredDurationAttributeID
      : toFiniteNumber(moduleAttributes[ATTRIBUTE_DURATION], 0) > 0
        ? ATTRIBUTE_DURATION
      : ATTRIBUTE_SPEED;
  const modifierEntries = buildAssistanceModifierEntries(
    moduleAttributes,
    definition.moduleModifierSpecs,
    definition.stackingPenalized === true,
  );
  const weaponModuleModifierEntries = buildAssistanceModifierEntries(
    moduleAttributes,
    definition.weaponModuleModifierSpecs,
    definition.stackingPenalized === true,
  );
  const weaponChargeModifierEntries = buildAssistanceModifierEntries(
    moduleAttributes,
    definition.weaponChargeModifierSpecs,
    definition.stackingPenalized === true,
  );
  const effectStatePatch = {
    assistanceModuleEffect: true,
    assistanceFamily: definition.family,
    assistanceJammingType: String(definition.jammingType || ""),
    assistanceAffectsTargetDerivedState: definition.affectsTargetDerivedState === true,
    assistanceModifierEntries: modifierEntries,
    assistanceWeaponModuleModifierEntries: weaponModuleModifierEntries,
    assistanceWeaponChargeModifierEntries: weaponChargeModifierEntries,
    assistanceMaxRangeMeters: Math.max(
      0,
      roundNumber(getPreferredAttributeValue(
        moduleAttributes,
        [
          effectRecord && effectRecord.rangeAttributeID,
          ATTRIBUTE_MAX_RANGE,
        ],
        0,
      ), 3),
    ),
    assistanceFalloffMeters: Math.max(
      0,
      roundNumber(getPreferredAttributeValue(
        moduleAttributes,
        [
          effectRecord && effectRecord.falloffAttributeID,
          ATTRIBUTE_FALLOFF_EFFECTIVENESS,
        ],
        0,
      ), 3),
    ),
    assistanceShieldBonusAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_SHIELD_BONUS], 0), 6),
    ),
    assistanceArmorRepairAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_ARMOR_DAMAGE_AMOUNT], 0), 6),
    ),
    assistanceHullRepairAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_STRUCTURE_DAMAGE_AMOUNT], 0), 6),
    ),
    assistancePowerTransferAmount: Math.max(
      0,
      roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_POWER_TRANSFER_AMOUNT], 0), 6),
    ),
    assistanceRemoteResistanceAttributeID: Math.max(
      0,
      toInt(moduleAttributes[ATTRIBUTE_REMOTE_RESISTANCE_ID], 0),
    ),
    forceFreshAcquireSpecialFxReplay: true,
    repeat: resolvePersistentRepeat(rawDurationMs),
  };

  const rangeResult = resolveAssistanceMultiplier(
    effectStatePatch,
    entity,
    targetEntity,
    callbacks,
  );
  if (!rangeResult.success) {
    return {
      matched: true,
      success: false,
      errorMsg: rangeResult.errorMsg || "TARGET_OUT_OF_RANGE",
    };
  }

  return {
    matched: true,
    success: true,
    data: {
      targetEntity,
      runtimeAttrs: {
        capNeed: Math.max(
          0,
          roundNumber(getPreferredAttributeValue(
            moduleAttributes,
            [
              ATTRIBUTE_CAPACITOR_NEED,
              effectRecord && effectRecord.dischargeAttributeID,
            ],
            0,
          ), 6),
        ),
        durationMs: Math.max(1, roundNumber(rawDurationMs, 3)),
        durationAttributeID,
        reactivationDelayMs: Math.max(
          0,
          roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_REACTIVATION_DELAY], 0), 3),
        ),
        maxGroupActive: Math.max(0, toInt(moduleAttributes[ATTRIBUTE_MAX_GROUP_ACTIVE], 0)),
        weaponFamily: null,
        attributeOverrides: {
          ...moduleAttributes,
        },
      },
      effectStatePatch,
    },
  };
}

function buildNormalizedConditionState(targetEntity, callbacks = {}) {
  return callbacks.normalizeShipConditionState
    ? callbacks.normalizeShipConditionState(targetEntity && targetEntity.conditionState)
    : {
        ...((targetEntity && targetEntity.conditionState) || {}),
      };
}

function commitHealthRepair({
  scene,
  targetEntity,
  previousConditionState,
  callbacks = {},
  nowMs,
} = {}) {
  const healthResult =
    callbacks.buildShipHealthTransitionResult &&
    callbacks.buildShipHealthTransitionResult(targetEntity, previousConditionState);
  if (targetEntity.session && healthResult && callbacks.notifyShipHealthAttributesToSession) {
    callbacks.notifyShipHealthAttributesToSession(
      targetEntity.session,
      targetEntity,
      healthResult,
      nowMs,
    );
  }
  if (callbacks.broadcastDamageStateChange) {
    callbacks.broadcastDamageStateChange(scene, targetEntity, nowMs);
  }
  if (callbacks.persistDynamicEntity) {
    callbacks.persistDynamicEntity(targetEntity);
  }
}

function executeAssistanceModuleCycle({
  scene,
  session,
  entity,
  effectState,
  nowMs,
  callbacks = {},
} = {}) {
  if (!scene || !entity || !effectState) {
    return {
      success: false,
      stopReason: "module",
    };
  }

  const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
  if (isBlockedStructureRemoteRepair(effectState, targetEntity)) {
    return {
      success: false,
      errorMsg: STRUCTURE_REMOTE_REPAIR_ERROR,
      stopReason: "target",
    };
  }
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      stopReason: "target",
    };
  }

  if (
    !callbacks.isEntityLockedTarget ||
    callbacks.isEntityLockedTarget(entity, effectState.targetID) !== true
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_LOCKED",
      stopReason: "target",
    };
  }

  const multiplierResult = resolveAssistanceMultiplier(
    effectState,
    entity,
    targetEntity,
    callbacks,
  );
  if (!multiplierResult.success) {
    return multiplierResult;
  }

  const resistanceMultiplier = resolveAssistanceResistanceMultiplier(
    effectState,
    targetEntity,
  );
  const assistanceMultiplier = roundNumber(
    Math.max(multiplierResult.multiplier, 0) * Math.max(resistanceMultiplier, 0),
    6,
  );
  const refreshResult = refreshAssistanceModuleState({
    scene,
    sourceEntity: entity,
    targetEntity,
    effectState,
    nowMs,
    rangeMultiplier: multiplierResult.multiplier,
  });
  if (!refreshResult.success) {
    return refreshResult;
  }
  const aggregateChanged = Boolean(
    refreshResult.data && refreshResult.data.aggregateChanged === true,
  );

  if (effectState.assistanceFamily === "remoteShield") {
    const shieldCapacity = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.shieldCapacity, 0),
    );
    const shieldBonusAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistanceShieldBonusAmount, 0),
    ) * Math.max(assistanceMultiplier, 0);
    const previousConditionState = buildNormalizedConditionState(targetEntity, callbacks);

    if (shieldCapacity > 0 && shieldBonusAmount > 0) {
      const currentShieldRatio = toFiniteNumber(
        previousConditionState && previousConditionState.shieldCharge,
        toFiniteNumber(targetEntity && targetEntity.capacitorChargeRatio, 0),
      );
      const nextShieldRatio = Math.min(1, currentShieldRatio + (shieldBonusAmount / shieldCapacity));
      targetEntity.conditionState = callbacks.normalizeShipConditionState
        ? callbacks.normalizeShipConditionState({
            ...previousConditionState,
            shieldCharge: nextShieldRatio,
          })
        : {
            ...previousConditionState,
            shieldCharge: nextShieldRatio,
          };
    }

    commitHealthRepair({
      scene,
      targetEntity,
      previousConditionState,
      callbacks,
      nowMs,
    });

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: assistanceMultiplier,
        appliedAmount: roundNumber(shieldBonusAmount, 6),
        aggregateChanged,
      },
    };
  }

  if (effectState.assistanceFamily === "remoteCapacitor") {
    const capacitorCapacity = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.capacitorCapacity, 0),
    );
    const capacitorBonusAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistancePowerTransferAmount, 0),
    ) * Math.max(assistanceMultiplier, 0);
    let appliedAmount = 0;
    if (capacitorCapacity > 0 && capacitorBonusAmount > 0) {
      const previousChargeAmount = callbacks.getEntityCapacitorAmount
        ? callbacks.getEntityCapacitorAmount(targetEntity)
        : 0;
      const nextChargeAmount = Math.min(
        capacitorCapacity,
        previousChargeAmount + capacitorBonusAmount,
      );
      appliedAmount = Math.max(0, nextChargeAmount - previousChargeAmount);
      if (callbacks.setEntityCapacitorRatio) {
        callbacks.setEntityCapacitorRatio(
          targetEntity,
          nextChargeAmount / capacitorCapacity,
        );
      }
      if (callbacks.persistDynamicEntity) {
        callbacks.persistDynamicEntity(targetEntity);
      }
      if (
        targetEntity.session &&
        callbacks.notifyCapacitorChangeToSession
      ) {
        callbacks.notifyCapacitorChangeToSession(
          targetEntity.session,
          targetEntity,
          nowMs,
          previousChargeAmount,
        );
      }
    }

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: assistanceMultiplier,
        appliedAmount: roundNumber(appliedAmount, 6),
        aggregateChanged,
      },
    };
  }

  if (effectState.assistanceFamily === "remoteArmor") {
    const armorHP = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.armorHP, 0),
    );
    const armorRepairAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistanceArmorRepairAmount, 0),
    ) * Math.max(assistanceMultiplier, 0);
    const previousConditionState = buildNormalizedConditionState(targetEntity, callbacks);

    if (armorHP > 0 && armorRepairAmount > 0) {
      const currentArmorDamageRatio = clamp(
        toFiniteNumber(previousConditionState && previousConditionState.armorDamage, 0),
        0,
        1,
      );
      const nextArmorDamageRatio = Math.max(
        0,
        currentArmorDamageRatio - (armorRepairAmount / armorHP),
      );
      targetEntity.conditionState = callbacks.normalizeShipConditionState
        ? callbacks.normalizeShipConditionState({
            ...previousConditionState,
            armorDamage: nextArmorDamageRatio,
          })
        : {
            ...previousConditionState,
            armorDamage: nextArmorDamageRatio,
          };
    }

    commitHealthRepair({
      scene,
      targetEntity,
      previousConditionState,
      callbacks,
      nowMs,
    });

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: assistanceMultiplier,
        appliedAmount: roundNumber(armorRepairAmount, 6),
        aggregateChanged,
      },
    };
  }

  if (effectState.assistanceFamily === "remoteHull") {
    const structureHP = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.structureHP, 0),
    );
    const hullRepairAmount = Math.max(
      0,
      toFiniteNumber(effectState.assistanceHullRepairAmount, 0),
    ) * Math.max(assistanceMultiplier, 0);
    const previousConditionState = buildNormalizedConditionState(targetEntity, callbacks);

    if (structureHP > 0 && hullRepairAmount > 0) {
      const currentStructureDamageRatio = clamp(
        toFiniteNumber(previousConditionState && previousConditionState.damage, 0),
        0,
        1,
      );
      const nextStructureDamageRatio = Math.max(
        0,
        currentStructureDamageRatio - (hullRepairAmount / structureHP),
      );
      targetEntity.conditionState = callbacks.normalizeShipConditionState
        ? callbacks.normalizeShipConditionState({
            ...previousConditionState,
            damage: nextStructureDamageRatio,
          })
        : {
            ...previousConditionState,
            damage: nextStructureDamageRatio,
          };
    }

    commitHealthRepair({
      scene,
      targetEntity,
      previousConditionState,
      callbacks,
      nowMs,
    });

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: assistanceMultiplier,
        appliedAmount: roundNumber(hullRepairAmount, 6),
        aggregateChanged,
      },
    };
  }

  if (hasAssistanceModifierEffect(effectState)) {
    return {
      success: true,
      data: {
        targetEntity,
        multiplier: assistanceMultiplier,
        appliedAmount: 0,
        aggregateChanged,
      },
    };
  }

  return {
    success: false,
    stopReason: "module",
  };
}

module.exports = {
  resolveAssistanceDefinition,
  resolveAssistanceModuleActivation,
  executeAssistanceModuleCycle,
  removeAssistanceModuleState,
  recomputeTargetAssistanceAggregateState,
  collectModifierEntriesForTarget,
  collectWeaponModifierEntriesForTarget,
};
