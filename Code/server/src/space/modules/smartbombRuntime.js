const path = require("path");

const {
  getAttributeIDByNames,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "./liveModuleAttributes"));
const {
  sumDamageVector,
} = require(path.join(__dirname, "../combat/damage"));

const GROUP_SMART_BOMB = 72;

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_EMP_FIELD_RANGE = getAttributeIDByNames("empFieldRange") || 99;
const ATTRIBUTE_DAMAGE_MULTIPLIER = getAttributeIDByNames("damageMultiplier") || 64;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim().toLowerCase();
}

function getPreferredAttributeValue(attributeMap, preferredAttributeIDs = [], fallback = 0) {
  if (!attributeMap || typeof attributeMap !== "object") {
    return {
      attributeID: 0,
      value: toFiniteNumber(fallback, 0),
    };
  }

  for (const attributeID of preferredAttributeIDs) {
    const numericAttributeID = toInt(attributeID, 0);
    if (
      numericAttributeID > 0 &&
      Object.prototype.hasOwnProperty.call(attributeMap, numericAttributeID)
    ) {
      return {
        attributeID: numericAttributeID,
        value: toFiniteNumber(attributeMap[numericAttributeID], fallback),
      };
    }
  }

  return {
    attributeID: 0,
    value: toFiniteNumber(fallback, 0),
  };
}

function isSmartbombEffect(effectRecord, moduleItem = null) {
  return (
    normalizeEffectName(effectRecord) === "empwave" ||
    toInt(moduleItem && moduleItem.groupID, 0) === GROUP_SMART_BOMB
  );
}

function buildSmartbombDamageVector(moduleAttributes) {
  const multiplier = Math.max(0, toFiniteNumber(
    moduleAttributes && moduleAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER],
    1,
  ));
  return {
    em: roundNumber(toFiniteNumber(moduleAttributes && moduleAttributes[ATTRIBUTE_EM_DAMAGE], 0) * multiplier),
    thermal: roundNumber(
      toFiniteNumber(moduleAttributes && moduleAttributes[ATTRIBUTE_THERMAL_DAMAGE], 0) * multiplier,
    ),
    kinetic: roundNumber(
      toFiniteNumber(moduleAttributes && moduleAttributes[ATTRIBUTE_KINETIC_DAMAGE], 0) * multiplier,
    ),
    explosive: roundNumber(
      toFiniteNumber(moduleAttributes && moduleAttributes[ATTRIBUTE_EXPLOSIVE_DAMAGE], 0) * multiplier,
    ),
  };
}

function resolveSmartbombActivation({
  entity,
  moduleItem,
  effectRecord,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
  additionalLocationModifierSources = null,
} = {}) {
  if (!isSmartbombEffect(effectRecord, moduleItem)) {
    return { matched: false };
  }

  if (!entity || !moduleItem || !shipItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    null,
    skillMap,
    fittedItems,
    activeModuleContexts,
    {
      additionalLocationModifierSources: Array.isArray(additionalLocationModifierSources)
        ? additionalLocationModifierSources
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

  const durationResolution = getPreferredAttributeValue(
    moduleAttributes,
    [
      effectRecord && effectRecord.durationAttributeID,
      ATTRIBUTE_DURATION,
    ],
    10000,
  );
  const dischargeResolution = getPreferredAttributeValue(
    moduleAttributes,
    [
      effectRecord && effectRecord.dischargeAttributeID,
      ATTRIBUTE_CAPACITOR_NEED,
    ],
    0,
  );
  const rangeResolution = getPreferredAttributeValue(
    moduleAttributes,
    [
      effectRecord && effectRecord.rangeAttributeID,
      ATTRIBUTE_EMP_FIELD_RANGE,
    ],
    0,
  );
  const damageVector = buildSmartbombDamageVector(moduleAttributes);
  if (sumDamageVector(damageVector) <= 0 || rangeResolution.value <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const smartbombRangeMeters = Math.max(0, roundNumber(rangeResolution.value, 3));

  return {
    matched: true,
    success: true,
    data: {
      offensiveActivation: true,
      runtimeAttrs: {
        capNeed: Math.max(0, roundNumber(dischargeResolution.value, 6)),
        durationMs: Math.max(1, roundNumber(durationResolution.value, 3)),
        durationAttributeID:
          durationResolution.attributeID > 0
            ? durationResolution.attributeID
            : ATTRIBUTE_DURATION,
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
      effectStatePatch: {
        smartbombEffect: true,
        smartbombRangeMeters,
        smartbombDamage: damageVector,
        smartbombGraphicInfo: {
          candidateTypeListId: -1,
          hitRange: smartbombRangeMeters,
          trackTargets: false,
        },
      },
    },
  };
}

function executeSmartbombCycle({
  scene,
  entity,
  moduleItem,
  effectState,
  nowMs,
  callbacks = {},
} = {}) {
  if (!scene || !entity || !moduleItem || !effectState) {
    return {
      success: false,
      stopReason: "module",
    };
  }

  const rangeMeters = Math.max(0, toFiniteNumber(effectState.smartbombRangeMeters, 0));
  const damageVector =
    effectState.smartbombDamage && typeof effectState.smartbombDamage === "object"
      ? effectState.smartbombDamage
      : {};
  const candidates =
    callbacks.listDamageableEntitiesInSmartbombRange &&
    callbacks.listDamageableEntitiesInSmartbombRange(entity, rangeMeters);
  const targets = Array.isArray(candidates) ? candidates : [];
  const damageResults = [];

  for (const targetEntity of targets) {
    if (!targetEntity || toInt(targetEntity.itemID, 0) === toInt(entity.itemID, 0)) {
      continue;
    }
    const damageResult = callbacks.applySmartbombDamage
      ? callbacks.applySmartbombDamage(
        entity,
        targetEntity,
        moduleItem,
        damageVector,
        nowMs,
      )
      : null;
    if (callbacks.recordOffensiveAggression && damageResult && damageResult.damageResult) {
      callbacks.recordOffensiveAggression(entity, targetEntity, nowMs);
    }
    damageResults.push({
      targetID: toInt(targetEntity.itemID, 0),
      damageResult,
    });
  }

  return {
    success: true,
    data: {
      targets,
      damageResults,
    },
  };
}

module.exports = {
  GROUP_SMART_BOMB,
  isSmartbombEffect,
  resolveSmartbombActivation,
  executeSmartbombCycle,
};
