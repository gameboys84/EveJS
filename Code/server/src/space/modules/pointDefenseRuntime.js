const path = require("path");

const {
  getAttributeIDByNames,
  getTypeDogmaAttributes,
  isChargeCompatibleWithModule,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "./liveModuleAttributes"));
const {
  isHighSecuritySystem,
} = require(path.join(__dirname, "../../services/security/crimewatchState"));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_EMP_FIELD_RANGE = getAttributeIDByNames("empFieldRange") || 99;
const ATTRIBUTE_CHARGE_RATE = getAttributeIDByNames("chargeRate") || 56;
const ATTRIBUTE_DAMAGE_MULTIPLIER = getAttributeIDByNames("damageMultiplier") || 64;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;

const POINT_DEFENSE_EFFECT_NAME = "pointdefense";
const POINT_DEFENSE_HIGHSEC_ERROR = "MODULE_DISALLOWED_IN_HIGHSEC";

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

function isPointDefenseEffect(effectRecord) {
  return normalizeEffectName(effectRecord) === POINT_DEFENSE_EFFECT_NAME;
}

function isPointDefenseDisallowedInScene(scene) {
  return isHighSecuritySystem(scene && scene.system);
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

function buildPointDefenseDamageVector(chargeAttributes, damageMultiplier) {
  const multiplier = Math.max(0, toFiniteNumber(damageMultiplier, 1));
  return {
    em: roundNumber(toFiniteNumber(chargeAttributes[ATTRIBUTE_EM_DAMAGE], 0) * multiplier),
    thermal: roundNumber(
      toFiniteNumber(chargeAttributes[ATTRIBUTE_THERMAL_DAMAGE], 0) * multiplier,
    ),
    kinetic: roundNumber(
      toFiniteNumber(chargeAttributes[ATTRIBUTE_KINETIC_DAMAGE], 0) * multiplier,
    ),
    explosive: roundNumber(
      toFiniteNumber(chargeAttributes[ATTRIBUTE_EXPLOSIVE_DAMAGE], 0) * multiplier,
    ),
  };
}

function sumDamageVector(vector) {
  return (
    toFiniteNumber(vector && vector.em, 0) +
    toFiniteNumber(vector && vector.thermal, 0) +
    toFiniteNumber(vector && vector.kinetic, 0) +
    toFiniteNumber(vector && vector.explosive, 0)
  );
}

function resolvePointDefenseActivation({
  scene,
  entity,
  moduleItem,
  effectRecord,
  chargeItem = null,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
} = {}) {
  if (!isPointDefenseEffect(effectRecord)) {
    return { matched: false };
  }

  if (!scene || !entity || !moduleItem || !shipItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  if (isPointDefenseDisallowedInScene(scene)) {
    return {
      matched: true,
      success: false,
      errorMsg: POINT_DEFENSE_HIGHSEC_ERROR,
    };
  }

  if (!chargeItem || toInt(chargeItem.typeID, 0) <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  if (!isChargeCompatibleWithModule(moduleItem.typeID, chargeItem.typeID)) {
    return {
      matched: true,
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
  );
  const chargeAttributes =
    buildLiveModuleAttributeMap(
      shipItem,
      chargeItem,
      null,
      skillMap,
      fittedItems,
      activeModuleContexts,
    ) || getTypeDogmaAttributes(chargeItem.typeID);
  if (!moduleAttributes || !chargeAttributes) {
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
    1000,
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
  const chargesPerCycle = Math.max(
    1,
    toInt(moduleAttributes[ATTRIBUTE_CHARGE_RATE], 1),
  );
  const availableCharges = Math.max(
    0,
    toInt(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity), 0),
  );
  if (availableCharges < chargesPerCycle) {
    return {
      matched: true,
      success: false,
      errorMsg: "NO_AMMO",
    };
  }

  const rawDamage = buildPointDefenseDamageVector(
    chargeAttributes,
    toFiniteNumber(moduleAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER], 1) * chargesPerCycle,
  );
  if (sumDamageVector(rawDamage) <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const pointDefenseRangeMeters = Math.max(0, roundNumber(rangeResolution.value, 3));

  return {
    matched: true,
    success: true,
    data: {
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
        pointDefenseEffect: true,
        pointDefenseRangeMeters,
        pointDefenseChargeRate: chargesPerCycle,
        pointDefenseDamage: rawDamage,
        pointDefenseGraphicInfo: {
          candidateTypeListId: -1,
          hitRange: pointDefenseRangeMeters,
          trackTargets: false,
        },
        repeat: null,
      },
    },
  };
}

function executePointDefenseCycle({
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

  if (isPointDefenseDisallowedInScene(scene)) {
    return {
      success: false,
      errorMsg: POINT_DEFENSE_HIGHSEC_ERROR,
      stopReason: "security",
    };
  }

  const chargeItem =
    callbacks.getEntityRuntimeLoadedCharge &&
    callbacks.getEntityRuntimeLoadedCharge(entity, moduleItem);
  if (!chargeItem) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  const chargesPerCycle = Math.max(1, toInt(effectState.pointDefenseChargeRate, 1));
  const availableCharges = Math.max(
    0,
    toInt(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity), 0),
  );
  if (availableCharges < chargesPerCycle) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  const consumeResult =
    callbacks.consumeLoadedCharge &&
    callbacks.consumeLoadedCharge(entity, moduleItem, chargeItem, chargesPerCycle, nowMs);
  if (!consumeResult || consumeResult.success !== true) {
    return {
      success: false,
      errorMsg: consumeResult && consumeResult.errorMsg || "AMMO_UPDATE_FAILED",
      stopReason: consumeResult && consumeResult.stopReason || "ammo",
    };
  }

  const rangeMeters = Math.max(0, toFiniteNumber(effectState.pointDefenseRangeMeters, 0));
  const damageVector =
    effectState.pointDefenseDamage && typeof effectState.pointDefenseDamage === "object"
      ? effectState.pointDefenseDamage
      : {};
  const candidates =
    callbacks.listDamageableEntitiesInRange &&
    callbacks.listDamageableEntitiesInRange(entity, rangeMeters);
  const targets = Array.isArray(candidates) ? candidates : [];
  const damageResults = [];

  if (targets.length > 0 && callbacks.breakEntityStructureTether) {
    callbacks.breakEntityStructureTether(entity, {
      nowMs,
      reason: "POINT_DEFENSE_ACTIVATION",
    });
  }

  for (const targetEntity of targets) {
    if (!targetEntity || toInt(targetEntity.itemID, 0) === toInt(entity.itemID, 0)) {
      continue;
    }
    if (callbacks.applyPointDefenseDamage) {
      const damageResult = callbacks.applyPointDefenseDamage(
        entity,
        targetEntity,
        moduleItem,
        damageVector,
        nowMs,
      );
      damageResults.push({
        targetID: toInt(targetEntity.itemID, 0),
        damageResult,
      });
    }
  }

  return {
    success: true,
    data: {
      targets,
      damageResults,
      depleted:
        consumeResult.data &&
        consumeResult.data.depleted === true,
      stopReason:
        consumeResult.data &&
        consumeResult.data.depleted === true
          ? "ammo"
          : null,
    },
  };
}

module.exports = {
  isPointDefenseEffect,
  resolvePointDefenseActivation,
  executePointDefenseCycle,
};
