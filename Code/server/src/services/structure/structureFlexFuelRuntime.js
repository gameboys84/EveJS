const path = require("path");

const { TABLE, readStaticTable } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));
const {
  listContainerItems,
  consumeInventoryItemQuantity,
} = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const { STRUCTURE_FUEL_BAY_FLAG } = require(path.join(
  __dirname,
  "../inventory/fuelBayInventory",
));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  findServiceProximityConflict,
  getServiceProximityCandidatesForSystem,
} = require(path.join(__dirname, "./structureServiceProximity"));
const {
  validateServiceModuleOnlineRequirements,
} = require(path.join(__dirname, "./structureServiceOnlineRequirements"));

const HOUR_MS = 60 * 60 * 1000;
const CYNO_JAMMER_ACTIVATION_DELAY_MS = 5 * 60 * 1000;
const GROUP_FUEL_BLOCK = 1136;
const ATTRIBUTE_BUILT_IN_SERVICE_MODULE = 2792;
const ATTRIBUTE_SERVICE_MODULE_FUEL_GROUP = 2108;
const ATTRIBUTE_SERVICE_MODULE_FUEL_AMOUNT = 2109;
const ATTRIBUTE_SERVICE_MODULE_ONLINE_FUEL_AMOUNT = 2110;
const ATTRIBUTE_CYNO_JAMMER_ACTIVATION_DELAY = 2794;

const FLEX_FUEL_DEFINITIONS = Object.freeze({
  35840: Object.freeze({
    typeID: 35840,
    serviceID: STRUCTURE_SERVICE_ID.CYNO_BEACON,
    fallbackServiceModuleTypeID: 35912,
    fallbackHourlyAmount: 15,
    fallbackOnlineAmount: 1080,
  }),
  35841: Object.freeze({
    typeID: 35841,
    serviceID: STRUCTURE_SERVICE_ID.JUMP_BRIDGE,
    fallbackServiceModuleTypeID: 35913,
    fallbackHourlyAmount: 30,
    fallbackOnlineAmount: 2160,
  }),
  37534: Object.freeze({
    typeID: 37534,
    serviceID: STRUCTURE_SERVICE_ID.CYNO_JAMMER,
    fallbackServiceModuleTypeID: 35914,
    fallbackHourlyAmount: 40,
    fallbackOnlineAmount: 2880,
    fallbackCynoJammerActivationDelayMs: CYNO_JAMMER_ACTIVATION_DELAY_MS,
  }),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getDogmaAttributes(typeID) {
  const dogma = readStaticTable(TABLE.TYPE_DOGMA);
  const record =
    dogma &&
    dogma.typesByTypeID &&
    dogma.typesByTypeID[String(toPositiveInt(typeID, 0))];
  return record && record.attributes && typeof record.attributes === "object"
    ? record.attributes
    : {};
}

function getDogmaAttribute(typeID, attributeID, fallback = 0) {
  const attributes = getDogmaAttributes(typeID);
  const rawValue = attributes[String(attributeID)];
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getFlexFuelProfile(structureTypeID) {
  const definition = FLEX_FUEL_DEFINITIONS[String(toPositiveInt(structureTypeID, 0))];
  if (!definition) {
    return null;
  }

  const serviceModuleTypeID = toPositiveInt(
    getDogmaAttribute(
      definition.typeID,
      ATTRIBUTE_BUILT_IN_SERVICE_MODULE,
      definition.fallbackServiceModuleTypeID,
    ),
    definition.fallbackServiceModuleTypeID,
  );
  const hourlyAmount = Math.max(
    0,
    toInt(
      getDogmaAttribute(
        serviceModuleTypeID,
        ATTRIBUTE_SERVICE_MODULE_FUEL_AMOUNT,
        definition.fallbackHourlyAmount,
      ),
      definition.fallbackHourlyAmount,
    ),
  );
  const onlineAmount = Math.max(
    0,
    toInt(
      getDogmaAttribute(
        serviceModuleTypeID,
        ATTRIBUTE_SERVICE_MODULE_ONLINE_FUEL_AMOUNT,
        definition.fallbackOnlineAmount,
      ),
      definition.fallbackOnlineAmount,
    ),
  );
  const fuelGroupID = Math.max(
    0,
    toInt(
      getDogmaAttribute(
        serviceModuleTypeID,
        ATTRIBUTE_SERVICE_MODULE_FUEL_GROUP,
        GROUP_FUEL_BLOCK,
      ),
      GROUP_FUEL_BLOCK,
    ),
  );
  const cynoJammerActivationDelayMs =
    definition.serviceID === STRUCTURE_SERVICE_ID.CYNO_JAMMER
      ? Math.max(
          0,
          toInt(
            getDogmaAttribute(
              serviceModuleTypeID,
              ATTRIBUTE_CYNO_JAMMER_ACTIVATION_DELAY,
              definition.fallbackCynoJammerActivationDelayMs,
            ),
            definition.fallbackCynoJammerActivationDelayMs,
          ),
        )
      : null;
  return {
    ...definition,
    serviceModuleTypeID,
    hourlyAmount,
    onlineAmount,
    fuelGroupID,
    cynoJammerActivationDelayMs,
  };
}

function getStackQuantity(item) {
  if (!item) {
    return 0;
  }
  if (toInt(item.singleton, 0) === 1) {
    return 1;
  }
  return Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
}

function isFuelBlockItem(item) {
  const typeRecord = resolveItemByTypeID(item && item.typeID);
  return toPositiveInt(typeRecord && typeRecord.groupID, 0) === GROUP_FUEL_BLOCK;
}

function listFlexFuelBlockStacks(structureID) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return [];
  }
  return listContainerItems(null, numericStructureID, STRUCTURE_FUEL_BAY_FLAG)
    .filter((item) => item && isFuelBlockItem(item) && getStackQuantity(item) > 0)
    .sort((left, right) => toPositiveInt(left && left.itemID, 0) -
      toPositiveInt(right && right.itemID, 0));
}

function sumStackQuantity(items) {
  return (Array.isArray(items) ? items : [])
    .reduce((total, item) => total + getStackQuantity(item), 0);
}

function buildFuelAlertTypesAndQty(fuelStacks) {
  const quantitiesByTypeID = new Map();
  for (const item of Array.isArray(fuelStacks) ? fuelStacks : []) {
    const typeID = toPositiveInt(item && item.typeID, 0);
    const quantity = getStackQuantity(item);
    if (typeID <= 0 || quantity <= 0) {
      continue;
    }
    quantitiesByTypeID.set(typeID, (quantitiesByTypeID.get(typeID) || 0) + quantity);
  }
  return [...quantitiesByTypeID.entries()]
    .sort(([leftTypeID], [rightTypeID]) => leftTypeID - rightTypeID)
    .map(([typeID, quantity]) => [quantity, typeID]);
}

function consumeFlexFuelBlocks(structureID, quantity) {
  const requiredQuantity = Math.max(0, toInt(quantity, 0));
  const fuelStacks = listFlexFuelBlockStacks(structureID);
  const availableQuantity = sumStackQuantity(fuelStacks);
  if (requiredQuantity <= 0) {
    return {
      success: true,
      requiredQuantity: 0,
      consumedQuantity: 0,
      availableQuantity,
      changes: [],
    };
  }
  if (availableQuantity < requiredQuantity) {
    return {
      success: false,
      errorMsg: "NOT_ENOUGH_FUEL",
      requiredQuantity,
      consumedQuantity: 0,
      availableQuantity,
      fuelAlertTypesAndQty: buildFuelAlertTypesAndQty(fuelStacks),
      changes: [],
    };
  }

  const changes = [];
  let remaining = requiredQuantity;
  for (const fuelStack of fuelStacks) {
    if (remaining <= 0) {
      break;
    }
    const consumed = Math.min(remaining, getStackQuantity(fuelStack));
    const consumeResult = consumeInventoryItemQuantity(fuelStack.itemID, consumed);
    if (!consumeResult || consumeResult.success !== true) {
      return {
        success: false,
        errorMsg: consumeResult && consumeResult.errorMsg
          ? consumeResult.errorMsg
          : "FUEL_CONSUME_FAILED",
        requiredQuantity,
        consumedQuantity: requiredQuantity - remaining,
        availableQuantity,
        changes,
      };
    }
    changes.push(...((consumeResult.data && consumeResult.data.changes) || []));
    remaining -= consumed;
  }

  return {
    success: true,
    requiredQuantity,
    consumedQuantity: requiredQuantity,
    availableQuantity,
    changes,
  };
}

function isFlexServiceOnline(structure, profile) {
  return toInt(
    structure &&
      structure.serviceStates &&
      structure.serviceStates[String(profile.serviceID)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  ) === STRUCTURE_SERVICE_STATE.ONLINE;
}

function isStructureDamagedForFlexServiceOnline(structureRecord) {
  const conditionState =
    structureRecord &&
    structureRecord.conditionState &&
    typeof structureRecord.conditionState === "object"
      ? structureRecord.conditionState
      : null;
  if (!conditionState) {
    return false;
  }
  const shieldCharge = Number(conditionState.shieldCharge);
  const armorDamage = Number(conditionState.armorDamage);
  const hullDamage = Number(conditionState.damage);
  return (
    (Number.isFinite(shieldCharge) && shieldCharge < 0.995) ||
    (Number.isFinite(armorDamage) && armorDamage > 0) ||
    (Number.isFinite(hullDamage) && hullDamage > 0)
  );
}

function getStructureProximityCandidates(structure, options = {}) {
  const explicitCandidates =
    Array.isArray(options.structureProximityCandidates)
      ? options.structureProximityCandidates
      : Array.isArray(options.structures)
        ? options.structures
        : [];
  return getServiceProximityCandidatesForSystem(structure, explicitCandidates);
}

function getFlexServiceProximityConflict(structure, profile, options = {}) {
  if (!profile) {
    return null;
  }
  return findServiceProximityConflict(
    structure,
    profile.serviceID,
    getStructureProximityCandidates(structure, options),
  );
}

function isFlexCynoBeaconBlockedBySystemJam(structure, profile, options = {}) {
  if (
    !profile ||
    toPositiveInt(profile.serviceID, 0) !== STRUCTURE_SERVICE_ID.CYNO_BEACON
  ) {
    return false;
  }
  const solarSystemID = toPositiveInt(structure && structure.solarSystemID, 0);
  if (!solarSystemID) {
    return false;
  }
  const { isSolarSystemCynoJammed } = require(path.join(
    __dirname,
    "../sovereignty/sovSuppressionState",
  ));
  return isSolarSystemCynoJammed(solarSystemID, {
    nowMs: toInt(options.nowMs, Date.now()),
  });
}

function isOnlineTenebrexCynoJammer(candidate, profile) {
  return Boolean(
    profile &&
      toPositiveInt(profile.serviceID, 0) === STRUCTURE_SERVICE_ID.CYNO_JAMMER &&
      candidate &&
      toPositiveInt(candidate.typeID, 0) === toPositiveInt(profile.typeID, 0) &&
      toInt(candidate.destroyedAt, 0) <= 0 &&
      toInt(candidate.solarSystemID, 0) > 0 &&
      toInt(
        candidate.serviceStates &&
          candidate.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_JAMMER)],
        STRUCTURE_SERVICE_STATE.OFFLINE,
      ) === STRUCTURE_SERVICE_STATE.ONLINE
  );
}

function findOnlineTenebrexCynoJammerConflict(structure, profile, options = {}) {
  if (
    !profile ||
    toPositiveInt(profile.serviceID, 0) !== STRUCTURE_SERVICE_ID.CYNO_JAMMER
  ) {
    return null;
  }
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  const solarSystemID = toPositiveInt(structure && structure.solarSystemID, 0);
  if (!structureID || !solarSystemID) {
    return null;
  }
  const candidates = getStructureProximityCandidates(structure, options);
  return candidates
    .filter((candidate) => (
      toPositiveInt(candidate && candidate.structureID, 0) !== structureID &&
      toPositiveInt(candidate && candidate.solarSystemID, 0) === solarSystemID &&
      isOnlineTenebrexCynoJammer(candidate, profile)
    ))
    .sort((left, right) => (
      toPositiveInt(left && left.structureID, 0) -
      toPositiveInt(right && right.structureID, 0)
    ))[0] || null;
}

function findLowerOnlineTenebrexCynoJammerConflict(structure, profile, options = {}) {
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  const conflict = findOnlineTenebrexCynoJammerConflict(structure, profile, options);
  if (
    !conflict ||
    toPositiveInt(conflict && conflict.structureID, 0) >= structureID
  ) {
    return null;
  }
  return conflict;
}

function buildOnlineFlexFuelPatch(structure, profile, nowMs) {
  const normalizedNowMs = toInt(nowMs, Date.now());
  const nextCycleAt = normalizedNowMs + HOUR_MS;
  const onlineState = {
    lastOnlineAt: normalizedNowMs,
    onlineAmount: profile.onlineAmount,
    onlineFuelPaidAt: normalizedNowMs,
    starved: false,
  };
  if (toPositiveInt(profile.serviceID, 0) === STRUCTURE_SERVICE_ID.CYNO_JAMMER) {
    onlineState.cynoJamActivatesAt =
      normalizedNowMs +
      Math.max(0, toInt(
        profile.cynoJammerActivationDelayMs,
        CYNO_JAMMER_ACTIVATION_DELAY_MS,
      ));
  }
  return {
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    fuelExpiresAt: estimateFuelExpiresAt(
      structure.structureID,
      profile.hourlyAmount,
      nextCycleAt,
    ),
    devFlags: {
      ...(structure.devFlags || {}),
      flexFuelState: buildFlexFuelState(profile, nextCycleAt, onlineState),
    },
  };
}

function buildOfflineFlexFuelPatch(structure, profile, nowMs) {
  const previousState =
    structure &&
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : null;
  return {
    upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
    fuelExpiresAt: null,
    devFlags: {
      ...(structure.devFlags || {}),
      flexFuelState: buildFlexFuelState(profile, null, {
        ...getPreservedOfflineState(previousState),
        lastOfflineAt: toInt(nowMs, Date.now()),
      }),
    },
  };
}

function prepareFlexServiceStateTransition(structure, serviceID, serviceState, options = {}) {
  const profile = getFlexFuelProfile(structure && structure.typeID);
  if (!profile || toPositiveInt(serviceID, 0) !== toPositiveInt(profile.serviceID, 0)) {
    return {
      success: true,
      patch: {},
      fuelResult: null,
    };
  }

  const nextOnline =
    toInt(serviceState, STRUCTURE_SERVICE_STATE.OFFLINE) === STRUCTURE_SERVICE_STATE.ONLINE;
  const previousOnline = isFlexServiceOnline(structure, profile);
  const nowMs = toInt(options.nowMs, Date.now());
  if (!nextOnline) {
    return {
      success: true,
      patch: buildOfflineFlexFuelPatch(structure, profile, nowMs),
      fuelResult: null,
    };
  }
  const requirementResult = validateServiceModuleOnlineRequirements(
    structure,
    profile.serviceModuleTypeID,
  );
  if (!requirementResult.success) {
    return {
      success: false,
      errorMsg: requirementResult.errorMsg,
      fuelResult: null,
      requiredUpgradeTypeID: requirementResult.requiredUpgradeTypeID,
    };
  }
  if (isFlexCynoBeaconBlockedBySystemJam(structure, profile, { nowMs })) {
    return {
      success: false,
      errorMsg: "STRUCTURE_CYNO_BEACON_SYSTEM_JAMMED",
      fuelResult: null,
    };
  }
  const onlineJammerConflict = previousOnline
    ? null
    : findOnlineTenebrexCynoJammerConflict(structure, profile, options);
  if (onlineJammerConflict) {
    return {
      success: false,
      errorMsg: "STRUCTURE_CYNO_JAMMER_ALREADY_ONLINE",
      fuelResult: null,
      onlineJammerConflict: {
        structureID: toPositiveInt(onlineJammerConflict.structureID, 0),
      },
    };
  }
  const proximityConflict = getFlexServiceProximityConflict(structure, profile, options);
  if (!previousOnline && proximityConflict) {
    return {
      success: false,
      errorMsg: "STRUCTURE_SERVICE_TOO_CLOSE",
      fuelResult: null,
      proximityConflict,
    };
  }
  if (previousOnline || options.consumeFlexOnlineFuel === false) {
    return {
      success: true,
      patch: previousOnline ? {} : buildOnlineFlexFuelPatch(structure, profile, nowMs),
      fuelResult: null,
    };
  }
  if (structure && structure.destroyedAt) {
    return {
      success: false,
      errorMsg: "STRUCTURE_DESTROYED",
      fuelResult: null,
    };
  }
  if (isStructureDamagedForFlexServiceOnline(structure)) {
    return {
      success: false,
      errorMsg: "STRUCTURE_DAMAGED",
      fuelResult: null,
    };
  }

  const requiredQuantity = Math.max(0, toInt(profile.onlineAmount, 0));
  const fuelResult = consumeFlexFuelBlocks(structure.structureID, requiredQuantity);
  if (!fuelResult || fuelResult.success !== true) {
    return {
      success: false,
      errorMsg: fuelResult && fuelResult.errorMsg ? fuelResult.errorMsg : "NOT_ENOUGH_FUEL",
      fuelResult,
    };
  }
  return {
    success: true,
    patch: buildOnlineFlexFuelPatch(structure, profile, nowMs),
    fuelResult,
  };
}

function offlineFlexServiceForCynoJam(structure, profile, nowMs) {
  const serviceStates = {
    ...(structure.serviceStates || {}),
    [String(profile.serviceID)]: STRUCTURE_SERVICE_STATE.OFFLINE,
  };
  const previousState =
    structure &&
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : null;
  return {
    structure: {
      ...structure,
      serviceStates,
      upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
      fuelExpiresAt: null,
      devFlags: {
        ...(structure.devFlags || {}),
        flexFuelState: buildFlexFuelState(profile, null, {
          ...getPreservedOfflineState(previousState),
          lastFailedAt: toInt(nowMs, Date.now()),
          cynoJammed: true,
        }),
      },
    },
    changed: true,
    changes: [],
  };
}

function offlineFlexServiceForOnlineJammerConflict(structure, profile, nowMs, conflict) {
  const serviceStates = {
    ...(structure.serviceStates || {}),
    [String(profile.serviceID)]: STRUCTURE_SERVICE_STATE.OFFLINE,
  };
  const previousState =
    structure &&
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : null;
  return {
    structure: {
      ...structure,
      serviceStates,
      upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
      fuelExpiresAt: null,
      devFlags: {
        ...(structure.devFlags || {}),
        flexFuelState: buildFlexFuelState(profile, null, {
          ...getPreservedOfflineState(previousState),
          lastFailedAt: toInt(nowMs, Date.now()),
          duplicateOnlineJammer: true,
          conflictingStructureID: toPositiveInt(conflict && conflict.structureID, 0) || null,
        }),
      },
    },
    changed: true,
    changes: [],
  };
}

function estimateFuelExpiresAt(structureID, hourlyAmount, nextCycleAt) {
  const hourly = Math.max(0, toInt(hourlyAmount, 0));
  const cycleAt = Math.max(0, toInt(nextCycleAt, 0));
  if (hourly <= 0 || cycleAt <= 0) {
    return null;
  }
  const availableCycles = Math.floor(sumStackQuantity(listFlexFuelBlockStacks(structureID)) / hourly);
  return cycleAt + (Math.max(0, availableCycles - 1) * HOUR_MS);
}

function buildFlexFuelState(profile, nextCycleAt, extra = {}) {
  return {
    serviceModuleTypeID: profile.serviceModuleTypeID,
    hourlyAmount: profile.hourlyAmount,
    fuelGroupID: profile.fuelGroupID,
    nextCycleAt: toInt(nextCycleAt, 0) > 0 ? toInt(nextCycleAt, 0) : null,
    ...extra,
  };
}

function getPreservedOfflineState(previousState) {
  if (!previousState || typeof previousState !== "object") {
    return {};
  }
  const preserved = { ...previousState };
  delete preserved.serviceModuleTypeID;
  delete preserved.hourlyAmount;
  delete preserved.fuelGroupID;
  delete preserved.nextCycleAt;
  return preserved;
}

function clearOfflineFlexFuelState(structure, profile, nowMs) {
  const previousState =
    structure &&
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : null;
  if (!previousState && !structure.fuelExpiresAt) {
    return {
      structure,
      changed: false,
      changes: [],
    };
  }
  if (
    previousState &&
    toInt(previousState.nextCycleAt, 0) <= 0 &&
    !structure.fuelExpiresAt
  ) {
    return {
      structure,
      changed: false,
      changes: [],
    };
  }
  return {
    structure: {
      ...structure,
      fuelExpiresAt: null,
      devFlags: {
        ...(structure.devFlags || {}),
        flexFuelState: buildFlexFuelState(profile, null, {
          ...getPreservedOfflineState(previousState),
          lastOfflineAt: toInt(nowMs, Date.now()),
        }),
      },
    },
    changed: true,
    changes: [],
  };
}

function offlineFlexServiceForFuel(structure, profile, nowMs, fuelResult) {
  const serviceStates = {
    ...(structure.serviceStates || {}),
    [String(profile.serviceID)]: STRUCTURE_SERVICE_STATE.OFFLINE,
  };
  return {
    structure: {
      ...structure,
      serviceStates,
      upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
      fuelExpiresAt: null,
      devFlags: {
        ...(structure.devFlags || {}),
        flexFuelState: buildFlexFuelState(profile, null, {
          lastFailedAt: toInt(nowMs, Date.now()),
          starved: true,
        }),
      },
    },
    changed: true,
    changes: fuelResult && Array.isArray(fuelResult.changes) ? fuelResult.changes : [],
    fuelResult,
  };
}

function offlineFlexServiceForMissingRequirement(structure, profile, nowMs, requirementResult) {
  const serviceStates = {
    ...(structure.serviceStates || {}),
    [String(profile.serviceID)]: STRUCTURE_SERVICE_STATE.OFFLINE,
  };
  const previousState =
    structure &&
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : null;
  return {
    structure: {
      ...structure,
      serviceStates,
      upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
      fuelExpiresAt: null,
      devFlags: {
        ...(structure.devFlags || {}),
        flexFuelState: buildFlexFuelState(profile, null, {
          ...getPreservedOfflineState(previousState),
          lastFailedAt: toInt(nowMs, Date.now()),
          missingRequirement: true,
          requiredUpgradeTypeID: requirementResult.requiredUpgradeTypeID || null,
        }),
      },
    },
    changed: true,
    changes: [],
    requirementResult,
  };
}

function offlineFlexServiceForProximity(structure, profile, nowMs, proximityConflict) {
  const serviceStates = {
    ...(structure.serviceStates || {}),
    [String(profile.serviceID)]: STRUCTURE_SERVICE_STATE.OFFLINE,
  };
  const previousState =
    structure &&
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : null;
  return {
    structure: {
      ...structure,
      serviceStates,
      upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
      fuelExpiresAt: null,
      devFlags: {
        ...(structure.devFlags || {}),
        flexFuelState: buildFlexFuelState(profile, null, {
          ...getPreservedOfflineState(previousState),
          lastFailedAt: toInt(nowMs, Date.now()),
          tooClose: true,
          proximityConflict,
        }),
      },
    },
    changed: true,
    changes: [],
    proximityConflict,
  };
}

function applyFlexServiceFuelCycle(structure, nowMs = Date.now(), options = {}) {
  const profile = getFlexFuelProfile(structure && structure.typeID);
  if (!profile) {
    return {
      structure,
      changed: false,
      changes: [],
    };
  }
  if (!isFlexServiceOnline(structure, profile) || structure.destroyedAt) {
    return clearOfflineFlexFuelState(structure, profile, nowMs);
  }
  const requirementResult = validateServiceModuleOnlineRequirements(
    structure,
    profile.serviceModuleTypeID,
  );
  if (!requirementResult.success) {
    return offlineFlexServiceForMissingRequirement(
      structure,
      profile,
      nowMs,
      requirementResult,
    );
  }
  if (isFlexCynoBeaconBlockedBySystemJam(structure, profile, { nowMs })) {
    return offlineFlexServiceForCynoJam(structure, profile, nowMs);
  }
  const onlineJammerConflict = findLowerOnlineTenebrexCynoJammerConflict(
    structure,
    profile,
    options,
  );
  if (onlineJammerConflict) {
    return offlineFlexServiceForOnlineJammerConflict(
      structure,
      profile,
      nowMs,
      onlineJammerConflict,
    );
  }
  const proximityConflict = getFlexServiceProximityConflict(structure, profile, options);
  if (proximityConflict) {
    return offlineFlexServiceForProximity(structure, profile, nowMs, proximityConflict);
  }
  if (profile.hourlyAmount <= 0) {
    return {
      structure,
      changed: false,
      changes: [],
    };
  }

  const currentState =
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : {};
  let nextCycleAt = toInt(currentState.nextCycleAt, 0);
  if (nextCycleAt <= 0) {
    nextCycleAt = toInt(nowMs, Date.now()) + HOUR_MS;
    return {
      structure: {
        ...structure,
        fuelExpiresAt: estimateFuelExpiresAt(
          structure.structureID,
          profile.hourlyAmount,
          nextCycleAt,
        ),
        devFlags: {
          ...(structure.devFlags || {}),
          flexFuelState: buildFlexFuelState(profile, nextCycleAt, {
            lastOnlineAt: toInt(nowMs, Date.now()),
          }),
        },
      },
      changed: true,
      changes: [],
    };
  }

  if (toInt(nowMs, Date.now()) < nextCycleAt) {
    const fuelExpiresAt = estimateFuelExpiresAt(
      structure.structureID,
      profile.hourlyAmount,
      nextCycleAt,
    );
    if (toInt(structure.fuelExpiresAt, 0) === toInt(fuelExpiresAt, 0)) {
      return {
        structure,
        changed: false,
        changes: [],
      };
    }
    return {
      structure: {
        ...structure,
        fuelExpiresAt,
      },
      changed: true,
      changes: [],
    };
  }

  const cycleCount = Math.max(1, Math.floor((toInt(nowMs, Date.now()) - nextCycleAt) / HOUR_MS) + 1);
  const requiredQuantity = profile.hourlyAmount * cycleCount;
  const fuelResult = consumeFlexFuelBlocks(structure.structureID, requiredQuantity);
  if (!fuelResult || fuelResult.success !== true) {
    return offlineFlexServiceForFuel(structure, profile, nowMs, fuelResult);
  }

  const nextCycle = nextCycleAt + (cycleCount * HOUR_MS);
  return {
    structure: {
      ...structure,
      fuelExpiresAt: estimateFuelExpiresAt(
        structure.structureID,
        profile.hourlyAmount,
        nextCycle,
      ),
      devFlags: {
        ...(structure.devFlags || {}),
        flexFuelState: buildFlexFuelState(profile, nextCycle, {
          lastCycleAt: toInt(nowMs, Date.now()),
          starved: false,
        }),
      },
    },
    changed: true,
    changes: fuelResult.changes || [],
    fuelResult,
  };
}

module.exports = {
  GROUP_FUEL_BLOCK,
  HOUR_MS,
  CYNO_JAMMER_ACTIVATION_DELAY_MS,
  FLEX_FUEL_DEFINITIONS,
  applyFlexServiceFuelCycle,
  consumeFlexFuelBlocks,
  getFlexFuelProfile,
  listFlexFuelBlockStacks,
  prepareFlexServiceStateTransition,
};
