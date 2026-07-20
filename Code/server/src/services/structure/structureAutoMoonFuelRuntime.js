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
  STRUCTURE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "./structureConstants"));

const HOUR_MS = 60 * 60 * 1000;
const TYPE_UPWELL_AUTO_MOON_MINER = 81826;
const TYPE_STANDUP_METENOX_MOON_DRILL = 82941;
const TYPE_COLONY_REAGENT_LAVA = 81143;
const GROUP_FUEL_BLOCK = 1136;
const ATTRIBUTE_BUILT_IN_SERVICE_MODULE = 2792;
const ATTRIBUTE_SERVICE_MODULE_FUEL_GROUP = 2108;
const ATTRIBUTE_SERVICE_MODULE_FUEL_AMOUNT = 2109;
const ATTRIBUTE_SERVICE_MODULE_ONLINE_FUEL_AMOUNT = 2110;
const METENOX_MAGMATIC_GAS_PER_HOUR = 200;

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
  const rawValue = getDogmaAttributes(typeID)[String(attributeID)];
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getAutoMoonFuelProfile(structureTypeID) {
  if (toPositiveInt(structureTypeID, 0) !== TYPE_UPWELL_AUTO_MOON_MINER) {
    return null;
  }

  const serviceModuleTypeID = toPositiveInt(
    getDogmaAttribute(
      TYPE_UPWELL_AUTO_MOON_MINER,
      ATTRIBUTE_BUILT_IN_SERVICE_MODULE,
      TYPE_STANDUP_METENOX_MOON_DRILL,
    ),
    TYPE_STANDUP_METENOX_MOON_DRILL,
  );
  const hourlyFuelBlocks = Math.max(
    0,
    toInt(
      getDogmaAttribute(
        serviceModuleTypeID,
        ATTRIBUTE_SERVICE_MODULE_FUEL_AMOUNT,
        5,
      ),
      5,
    ),
  );
  const onlineFuelBlocks = Math.max(
    0,
    toInt(
      getDogmaAttribute(
        serviceModuleTypeID,
        ATTRIBUTE_SERVICE_MODULE_ONLINE_FUEL_AMOUNT,
        1000,
      ),
      1000,
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
  return {
    typeID: TYPE_UPWELL_AUTO_MOON_MINER,
    serviceID: STRUCTURE_SERVICE_ID.AUTOMOONMINING,
    serviceModuleTypeID,
    fuelGroupID,
    hourlyFuelBlocks,
    onlineFuelBlocks,
    hourlyMagmaticGas: METENOX_MAGMATIC_GAS_PER_HOUR,
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

function getItemGroupID(item) {
  const typeRecord = resolveItemByTypeID(item && item.typeID);
  return toPositiveInt(
    item && item.groupID,
    toPositiveInt(typeRecord && typeRecord.groupID, 0),
  );
}

function listStructureFuelStacks(structureID, predicate) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return [];
  }
  return listContainerItems(null, numericStructureID, STRUCTURE_FUEL_BAY_FLAG)
    .filter((item) => item && predicate(item) && getStackQuantity(item) > 0)
    .sort((left, right) => (
      toPositiveInt(left && left.itemID, 0) -
      toPositiveInt(right && right.itemID, 0)
    ));
}

function listMetenoxFuelBlockStacks(structureID, profile) {
  const fuelGroupID = toPositiveInt(profile && profile.fuelGroupID, GROUP_FUEL_BLOCK);
  return listStructureFuelStacks(
    structureID,
    (item) => getItemGroupID(item) === fuelGroupID,
  );
}

function listMetenoxMagmaticGasStacks(structureID) {
  return listStructureFuelStacks(
    structureID,
    (item) => toPositiveInt(item && item.typeID, 0) === TYPE_COLONY_REAGENT_LAVA,
  );
}

function sumStackQuantity(items) {
  return (Array.isArray(items) ? items : [])
    .reduce((total, item) => total + getStackQuantity(item), 0);
}

function buildFuelAlertTypesAndQty(...stackLists) {
  const quantitiesByTypeID = new Map();
  for (const item of stackLists.flat()) {
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

function consumeFromStacks(stacks, requiredQuantity) {
  let remaining = Math.max(0, toInt(requiredQuantity, 0));
  const changes = [];
  for (const stack of Array.isArray(stacks) ? stacks : []) {
    if (remaining <= 0) {
      break;
    }
    const consumed = Math.min(remaining, getStackQuantity(stack));
    const consumeResult = consumeInventoryItemQuantity(stack.itemID, consumed);
    if (!consumeResult || consumeResult.success !== true) {
      return {
        success: false,
        errorMsg: consumeResult && consumeResult.errorMsg
          ? consumeResult.errorMsg
          : "FUEL_CONSUME_FAILED",
        consumedQuantity: Math.max(0, toInt(requiredQuantity, 0)) - remaining,
        changes,
      };
    }
    changes.push(...((consumeResult.data && consumeResult.data.changes) || []));
    remaining -= consumed;
  }
  return {
    success: true,
    consumedQuantity: Math.max(0, toInt(requiredQuantity, 0)),
    changes,
  };
}

function consumeMetenoxFuel(structureID, profile, fuelBlockQuantity, magmaticGasQuantity) {
  const requiredFuelBlocks = Math.max(0, toInt(fuelBlockQuantity, 0));
  const requiredMagmaticGas = Math.max(0, toInt(magmaticGasQuantity, 0));
  const fuelBlockStacks = listMetenoxFuelBlockStacks(structureID, profile);
  const magmaticGasStacks = listMetenoxMagmaticGasStacks(structureID);
  const availableFuelBlocks = sumStackQuantity(fuelBlockStacks);
  const availableMagmaticGas = sumStackQuantity(magmaticGasStacks);
  if (
    availableFuelBlocks < requiredFuelBlocks ||
    availableMagmaticGas < requiredMagmaticGas
  ) {
    return {
      success: false,
      errorMsg: "NOT_ENOUGH_FUEL",
      requiredFuelBlocks,
      requiredMagmaticGas,
      availableFuelBlocks,
      availableMagmaticGas,
      consumedFuelBlocks: 0,
      consumedMagmaticGas: 0,
      fuelAlertTypesAndQty: buildFuelAlertTypesAndQty(fuelBlockStacks, magmaticGasStacks),
      changes: [],
    };
  }

  const changes = [];
  const fuelBlockResult = consumeFromStacks(fuelBlockStacks, requiredFuelBlocks);
  if (!fuelBlockResult.success) {
    return {
      ...fuelBlockResult,
      requiredFuelBlocks,
      requiredMagmaticGas,
      availableFuelBlocks,
      availableMagmaticGas,
      consumedFuelBlocks: fuelBlockResult.consumedQuantity || 0,
      consumedMagmaticGas: 0,
      changes,
    };
  }
  changes.push(...(fuelBlockResult.changes || []));

  const magmaticGasResult = consumeFromStacks(magmaticGasStacks, requiredMagmaticGas);
  if (!magmaticGasResult.success) {
    return {
      ...magmaticGasResult,
      requiredFuelBlocks,
      requiredMagmaticGas,
      availableFuelBlocks,
      availableMagmaticGas,
      consumedFuelBlocks: requiredFuelBlocks,
      consumedMagmaticGas: magmaticGasResult.consumedQuantity || 0,
      changes,
    };
  }
  changes.push(...(magmaticGasResult.changes || []));

  return {
    success: true,
    requiredFuelBlocks,
    requiredMagmaticGas,
    availableFuelBlocks,
    availableMagmaticGas,
    consumedFuelBlocks: requiredFuelBlocks,
    consumedMagmaticGas: requiredMagmaticGas,
    changes,
  };
}

function estimateFuelExpiresAt(structureID, profile, nextCycleAt) {
  const cycleAt = Math.max(0, toInt(nextCycleAt, 0));
  if (cycleAt <= 0) {
    return null;
  }

  const cycleCounts = [];
  if (toInt(profile.hourlyFuelBlocks, 0) > 0) {
    cycleCounts.push(Math.floor(
      sumStackQuantity(listMetenoxFuelBlockStacks(structureID, profile)) /
      Math.max(1, toInt(profile.hourlyFuelBlocks, 0)),
    ));
  }
  if (toInt(profile.hourlyMagmaticGas, 0) > 0) {
    cycleCounts.push(Math.floor(
      sumStackQuantity(listMetenoxMagmaticGasStacks(structureID)) /
      Math.max(1, toInt(profile.hourlyMagmaticGas, 0)),
    ));
  }
  if (cycleCounts.length <= 0) {
    return null;
  }
  const availableCycles = Math.min(...cycleCounts);
  return cycleAt + (Math.max(0, availableCycles - 1) * HOUR_MS);
}

function buildAutoMoonFuelState(profile, nextCycleAt, extra = {}) {
  return {
    serviceModuleTypeID: profile.serviceModuleTypeID,
    hourlyFuelBlocks: profile.hourlyFuelBlocks,
    hourlyMagmaticGas: profile.hourlyMagmaticGas,
    fuelGroupID: profile.fuelGroupID,
    nextCycleAt: toInt(nextCycleAt, 0) > 0 ? toInt(nextCycleAt, 0) : null,
    ...extra,
  };
}

function getPreviousAutoMoonFuelState(structure) {
  return structure &&
    structure.devFlags &&
    structure.devFlags.autoMoonFuelState &&
    typeof structure.devFlags.autoMoonFuelState === "object"
    ? structure.devFlags.autoMoonFuelState
    : null;
}

function getPreservedOfflineState(previousState) {
  if (!previousState || typeof previousState !== "object") {
    return {};
  }
  const preserved = { ...previousState };
  delete preserved.serviceModuleTypeID;
  delete preserved.hourlyFuelBlocks;
  delete preserved.hourlyMagmaticGas;
  delete preserved.fuelGroupID;
  delete preserved.nextCycleAt;
  return preserved;
}

function isAutoMoonMinerServiceOnline(structure, profile) {
  return toInt(
    structure &&
      structure.serviceStates &&
      structure.serviceStates[String(profile.serviceID)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  ) === STRUCTURE_SERVICE_STATE.ONLINE;
}

function isAutoMoonMinerReinforced(structure) {
  const stateID = toPositiveInt(structure && structure.state, 0);
  return (
    stateID === STRUCTURE_STATE.ARMOR_REINFORCE ||
    stateID === STRUCTURE_STATE.HULL_REINFORCE
  );
}

function isStructureDamagedForAutoMoonServiceOnline(structure) {
  const conditionState =
    structure &&
    structure.conditionState &&
    typeof structure.conditionState === "object"
      ? structure.conditionState
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

function buildOnlineAutoMoonFuelPatch(structure, profile, nowMs) {
  const normalizedNowMs = toInt(nowMs, Date.now());
  const nextCycleAt = normalizedNowMs + HOUR_MS;
  return {
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    fuelExpiresAt: estimateFuelExpiresAt(
      structure.structureID,
      profile,
      nextCycleAt,
    ),
    devFlags: {
      ...(structure.devFlags || {}),
      autoMoonFuelState: buildAutoMoonFuelState(profile, nextCycleAt, {
        lastOnlineAt: normalizedNowMs,
        onlineFuelBlocks: profile.onlineFuelBlocks,
        onlineFuelPaidAt: normalizedNowMs,
        starved: false,
        reinforced: false,
      }),
    },
  };
}

function buildOfflineAutoMoonFuelPatch(structure, profile, nowMs, extra = {}) {
  const previousState = getPreviousAutoMoonFuelState(structure);
  return {
    upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
    fuelExpiresAt: null,
    devFlags: {
      ...(structure.devFlags || {}),
      autoMoonFuelState: buildAutoMoonFuelState(profile, null, {
        ...getPreservedOfflineState(previousState),
        lastOfflineAt: toInt(nowMs, Date.now()),
        ...extra,
      }),
    },
  };
}

function prepareAutoMoonMinerServiceStateTransition(
  structure,
  serviceID,
  serviceState,
  options = {},
) {
  const profile = getAutoMoonFuelProfile(structure && structure.typeID);
  if (!profile || toPositiveInt(serviceID, 0) !== profile.serviceID) {
    return {
      success: true,
      patch: {},
      fuelResult: null,
    };
  }

  const nextOnline =
    toInt(serviceState, STRUCTURE_SERVICE_STATE.OFFLINE) ===
    STRUCTURE_SERVICE_STATE.ONLINE;
  const previousOnline = isAutoMoonMinerServiceOnline(structure, profile);
  const nowMs = toInt(options.nowMs, Date.now());
  if (!nextOnline) {
    return {
      success: true,
      patch: buildOfflineAutoMoonFuelPatch(structure, profile, nowMs),
      fuelResult: null,
    };
  }
  if (previousOnline || options.consumeAutoMoonOnlineFuel === false) {
    return {
      success: true,
      patch: previousOnline ? {} : buildOnlineAutoMoonFuelPatch(structure, profile, nowMs),
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
  if (isAutoMoonMinerReinforced(structure)) {
    return {
      success: false,
      errorMsg: "STRUCTURE_REINFORCED",
      fuelResult: null,
    };
  }
  if (isStructureDamagedForAutoMoonServiceOnline(structure)) {
    return {
      success: false,
      errorMsg: "STRUCTURE_DAMAGED",
      fuelResult: null,
    };
  }

  const fuelResult = consumeMetenoxFuel(
    structure.structureID,
    profile,
    profile.onlineFuelBlocks,
    0,
  );
  if (!fuelResult || fuelResult.success !== true) {
    return {
      success: false,
      errorMsg: fuelResult && fuelResult.errorMsg ? fuelResult.errorMsg : "NOT_ENOUGH_FUEL",
      fuelResult,
    };
  }
  return {
    success: true,
    patch: buildOnlineAutoMoonFuelPatch(structure, profile, nowMs),
    fuelResult,
  };
}

function clearOfflineAutoMoonFuelState(structure, profile, nowMs) {
  const previousState = getPreviousAutoMoonFuelState(structure);
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
      ...buildOfflineAutoMoonFuelPatch(structure, profile, nowMs),
    },
    changed: true,
    changes: [],
  };
}

function offlineAutoMoonService(structure, profile, nowMs, extra = {}) {
  const { fuelResult = null, ...stateExtra } = extra && typeof extra === "object"
    ? extra
    : {};
  const serviceStates = {
    ...(structure.serviceStates || {}),
    [String(profile.serviceID)]: STRUCTURE_SERVICE_STATE.OFFLINE,
  };
  return {
    structure: {
      ...structure,
      ...buildOfflineAutoMoonFuelPatch(structure, profile, nowMs, stateExtra),
      serviceStates,
    },
    changed: true,
    changes: fuelResult && Array.isArray(fuelResult.changes)
      ? fuelResult.changes
      : [],
    fuelResult,
  };
}

function applyAutoMoonMinerFuelCycle(structure, nowMs = Date.now()) {
  const profile = getAutoMoonFuelProfile(structure && structure.typeID);
  if (!profile) {
    return {
      structure,
      changed: false,
      changes: [],
    };
  }
  if (!isAutoMoonMinerServiceOnline(structure, profile) || structure.destroyedAt) {
    return clearOfflineAutoMoonFuelState(structure, profile, nowMs);
  }
  if (isAutoMoonMinerReinforced(structure)) {
    return offlineAutoMoonService(structure, profile, nowMs, {
      reinforced: true,
      starved: false,
    });
  }

  const currentState = getPreviousAutoMoonFuelState(structure) || {};
  let nextCycleAt = toInt(currentState.nextCycleAt, 0);
  if (nextCycleAt <= 0) {
    nextCycleAt = toInt(nowMs, Date.now()) + HOUR_MS;
    return {
      structure: {
        ...structure,
        fuelExpiresAt: estimateFuelExpiresAt(
          structure.structureID,
          profile,
          nextCycleAt,
        ),
        devFlags: {
          ...(structure.devFlags || {}),
          autoMoonFuelState: buildAutoMoonFuelState(profile, nextCycleAt, {
            lastOnlineAt: toInt(nowMs, Date.now()),
            starved: false,
            reinforced: false,
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
      profile,
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

  const cycleCount = Math.max(
    1,
    Math.floor((toInt(nowMs, Date.now()) - nextCycleAt) / HOUR_MS) + 1,
  );
  const fuelResult = consumeMetenoxFuel(
    structure.structureID,
    profile,
    profile.hourlyFuelBlocks * cycleCount,
    profile.hourlyMagmaticGas * cycleCount,
  );
  if (!fuelResult || fuelResult.success !== true) {
    return offlineAutoMoonService(structure, profile, nowMs, {
      lastFailedAt: toInt(nowMs, Date.now()),
      starved: true,
      fuelResult,
    });
  }

  const nextCycle = nextCycleAt + (cycleCount * HOUR_MS);
  return {
    structure: {
      ...structure,
      fuelExpiresAt: estimateFuelExpiresAt(
        structure.structureID,
        profile,
        nextCycle,
      ),
      devFlags: {
        ...(structure.devFlags || {}),
        autoMoonFuelState: buildAutoMoonFuelState(profile, nextCycle, {
          lastCycleAt: toInt(nowMs, Date.now()),
          starved: false,
          reinforced: false,
        }),
      },
    },
    changed: true,
    changes: fuelResult.changes || [],
    fuelResult,
  };
}

module.exports = {
  HOUR_MS,
  TYPE_UPWELL_AUTO_MOON_MINER,
  TYPE_STANDUP_METENOX_MOON_DRILL,
  TYPE_COLONY_REAGENT_LAVA,
  GROUP_FUEL_BLOCK,
  METENOX_MAGMATIC_GAS_PER_HOUR,
  applyAutoMoonMinerFuelCycle,
  consumeMetenoxFuel,
  getAutoMoonFuelProfile,
  listMetenoxFuelBlockStacks,
  listMetenoxMagmaticGasStacks,
  prepareAutoMoonMinerServiceStateTransition,
};
