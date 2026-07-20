const path = require("path");

const {
  listContainerItems,
  consumeInventoryItemQuantity,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  isFuelBayCompatibleItem,
  STRUCTURE_FUEL_BAY_FLAG,
} = require(path.join(__dirname, "../inventory/fuelBayInventory"));
const {
  applyModifierGroups,
  getAttributeIDByNames,
  getTypeAttributeMap,
  getTypeAttributeValue,
  getTypeEffectRecords,
  isEffectivelyOnlineModule,
  isShipFittingFlag,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  syncIndustryJobsForServiceStateTransition,
} = require(path.join(__dirname, "./structureIndustryJobs"));
const {
  MANAGED_SERVICE_IDS,
  SERVICE_IDS_BY_MODULE_TYPE_ID,
  getStructureServiceIDsForModuleType,
  isStructureServiceModuleType,
} = require(path.join(__dirname, "./structureServiceAuthority"));
const {
  validateServiceModuleOnlineRequirements,
} = require(path.join(__dirname, "./structureServiceOnlineRequirements"));
const {
  findServiceProximityConflict,
} = require(path.join(__dirname, "./structureServiceProximity"));

const STRUCTURE_SERVICE_SLOT_FLAGS = Object.freeze([164, 165, 166, 167, 168, 169, 170, 171]);
const DEFAULT_SERVICE_ONLINE_FUEL_HOURS = 72;
const SERVICE_FUEL_CYCLE_MS = 60 * 60 * 1000;
const STRUCTURE_ONLINE_MAX_SHIELD_DAMAGE_THRESHOLD = 0.995;
const ATTRIBUTE_SERVICE_MODULE_FUEL_AMOUNT =
  getAttributeIDByNames("serviceModuleFuelAmount", "Service Module Cycle Fuel Need") || 2109;
const ATTRIBUTE_SERVICE_MODULE_ONLINE_FUEL_AMOUNT =
  getAttributeIDByNames("serviceModuleFuelOnlineAmount", "Service Module Online Fuel Need") || 2110;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function isStructureServiceSlotFlag(flagID) {
  return STRUCTURE_SERVICE_SLOT_FLAGS.includes(toInt(flagID, 0));
}

function isStructureServiceModuleItem(item) {
  return Boolean(
    item &&
    isStructureServiceSlotFlag(item.flagID) &&
    isStructureServiceModuleType(item.typeID),
  );
}

function isStructureDamagedForServiceOnline(structureRecord) {
  const conditionState =
    structureRecord && structureRecord.conditionState && typeof structureRecord.conditionState === "object"
      ? structureRecord.conditionState
      : null;
  if (!conditionState) {
    return false;
  }
  const shieldCharge = Number(conditionState.shieldCharge);
  const armorDamage = Number(conditionState.armorDamage);
  const hullDamage = Number(conditionState.damage);
  return (
    (Number.isFinite(shieldCharge) && shieldCharge < STRUCTURE_ONLINE_MAX_SHIELD_DAMAGE_THRESHOLD) ||
    (Number.isFinite(armorDamage) && armorDamage > 0) ||
    (Number.isFinite(hullDamage) && hullDamage > 0)
  );
}

function getStructureServiceModuleProximityConflict(structure, moduleItem) {
  if (!structure || !moduleItem) {
    return null;
  }
  const candidates = structureState.listStructuresForSystem(
    structure.solarSystemID,
    { includeDestroyed: true, refresh: false },
  );
  for (const serviceID of getStructureServiceIDsForModuleType(moduleItem.typeID)) {
    const conflict = findServiceProximityConflict(structure, serviceID, candidates);
    if (conflict) {
      return conflict;
    }
  }
  return null;
}

function validateStructureServiceModuleOnlineRequirements(structure, moduleItem) {
  return validateServiceModuleOnlineRequirements(
    structure,
    moduleItem && moduleItem.typeID,
  );
}

function offlineServiceModuleForProximity(moduleItem, proximityConflict) {
  const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      online: false,
      serviceFuelNextCycleAt: null,
      serviceFuelRemainder: 0,
      proximityConflict,
    },
  }));
  return {
    success: false,
    errorMsg: "STRUCTURE_SERVICE_TOO_CLOSE",
    moduleItem: updateResult && updateResult.success ? updateResult.data : moduleItem,
    offlined: true,
    proximityConflict,
    changes: updateResult && updateResult.success
      ? [{ previousData: updateResult.previousData || moduleItem, item: updateResult.data }]
      : [],
  };
}

function offlineServiceModuleForMissingRequirement(moduleItem, errorMsg) {
  const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      online: false,
      serviceFuelNextCycleAt: null,
      serviceFuelRemainder: 0,
    },
  }));
  return {
    success: false,
    errorMsg,
    moduleItem: updateResult && updateResult.success ? updateResult.data : moduleItem,
    offlined: true,
    changes: updateResult && updateResult.success
      ? [{ previousData: updateResult.previousData || moduleItem, item: updateResult.data }]
      : [],
  };
}

function listFittedStructureServiceModules(structureID) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return [];
  }
  return listContainerItems(null, numericStructureID, null)
    .filter((item) => item && isShipFittingFlag(item.flagID))
    .filter(isStructureServiceModuleItem)
    .sort((left, right) => (
      toInt(left.flagID, 0) - toInt(right.flagID, 0) ||
      toInt(left.itemID, 0) - toInt(right.itemID, 0)
    ));
}

function listOnlineStructureServiceModules(structureID) {
  return listFittedStructureServiceModules(structureID)
    .filter((item) => isEffectivelyOnlineModule(item));
}

function getStructureServiceModuleCycleFuelNeed(typeID) {
  return Math.max(0, toInt(
    getTypeAttributeValue(typeID, "serviceModuleFuelAmount", "Service Module Cycle Fuel Need"),
    0,
  ));
}

function getStructureServiceModuleFuelGroupID(typeID) {
  return Math.max(0, toInt(
    getTypeAttributeValue(
      typeID,
      "serviceModuleFuelConsumptionGroup",
      "Service Module Fuel Need",
    ),
    0,
  ));
}

function getStructureServiceModuleOnlineFuelNeed(typeID) {
  const explicitOnlineFuel = toInt(
    getTypeAttributeValue(
      typeID,
      "serviceModuleFuelOnlineAmount",
      "Service Module Online Fuel Need",
    ),
    0,
  );
  if (explicitOnlineFuel > 0) {
    return explicitOnlineFuel;
  }
  return getStructureServiceModuleCycleFuelNeed(typeID) * DEFAULT_SERVICE_ONLINE_FUEL_HOURS;
}

function appendStructureLocationFuelModifierEntries(destination, sourceItem, moduleItem, options = {}) {
  if (!sourceItem || !moduleItem) {
    return;
  }
  const sourceAttributes = getTypeAttributeMap(sourceItem.typeID);
  const sourceEffects = getTypeEffectRecords(sourceItem.typeID);
  const sourceKind = String(options.sourceKind || "fittedModule");
  for (const effectRecord of sourceEffects) {
    for (const modifierInfo of effectRecord.modifierInfo || []) {
      if (
        !modifierInfo ||
        String(modifierInfo.domain || "") !== "structureID" ||
        String(modifierInfo.func || "") !== "LocationGroupModifier"
      ) {
        continue;
      }
      if (
        modifierInfo.groupID &&
        toInt(moduleItem.groupID, 0) !== toInt(modifierInfo.groupID, 0)
      ) {
        continue;
      }
      const value = toFiniteNumber(
        sourceAttributes[toInt(modifierInfo.modifyingAttributeID, 0)],
        NaN,
      );
      if (!Number.isFinite(value)) {
        continue;
      }
      destination.push({
        modifiedAttributeID: modifierInfo.modifiedAttributeID,
        operation: modifierInfo.operation,
        value,
        stackingPenalized: sourceKind === "fittedModule",
      });
    }
  }
}

function buildStructureServiceModuleEffectiveAttributeMap(structureID, moduleItem) {
  const moduleTypeID = toPositiveInt(moduleItem && moduleItem.typeID, 0);
  const attributes = getTypeAttributeMap(moduleTypeID);
  if (!structureID || !moduleItem || moduleTypeID <= 0) {
    return attributes;
  }

  const structure = structureState.getStructureByID(structureID, { refresh: false });
  const modifierEntries = [];
  if (structure && toPositiveInt(structure.typeID, 0) > 0) {
    appendStructureLocationFuelModifierEntries(
      modifierEntries,
      { typeID: toPositiveInt(structure.typeID, 0) },
      moduleItem,
      { sourceKind: "structureHull" },
    );
  }
  for (const sourceItem of listContainerItems(null, structureID, null)) {
    if (!sourceItem || toInt(sourceItem.itemID, 0) === toInt(moduleItem.itemID, 0)) {
      continue;
    }
    if (!isShipFittingFlag(sourceItem.flagID)) {
      continue;
    }
    appendStructureLocationFuelModifierEntries(
      modifierEntries,
      sourceItem,
      moduleItem,
      { sourceKind: "fittedModule" },
    );
  }

  if (modifierEntries.length > 0) {
    applyModifierGroups(attributes, modifierEntries);
  }
  return attributes;
}

function getEffectiveStructureServiceModuleCycleFuelNeed(structureID, moduleItem) {
  const attributes = buildStructureServiceModuleEffectiveAttributeMap(structureID, moduleItem);
  return Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_SERVICE_MODULE_FUEL_AMOUNT], 0));
}

function getEffectiveStructureServiceModuleOnlineFuelNeed(structureID, moduleItem) {
  const attributes = buildStructureServiceModuleEffectiveAttributeMap(structureID, moduleItem);
  const explicitOnlineFuel = toFiniteNumber(
    attributes[ATTRIBUTE_SERVICE_MODULE_ONLINE_FUEL_AMOUNT],
    0,
  );
  if (explicitOnlineFuel > 0) {
    return Math.max(0, explicitOnlineFuel);
  }
  return getEffectiveStructureServiceModuleCycleFuelNeed(structureID, moduleItem) *
    DEFAULT_SERVICE_ONLINE_FUEL_HOURS;
}

function resolveWholeServiceFuelCharge(exactQuantity, existingRemainder = 0) {
  const total = Math.max(
    0,
    toFiniteNumber(exactQuantity, 0) + toFiniteNumber(existingRemainder, 0),
  );
  const wholeQuantity = Math.max(0, Math.floor(total + 1e-9));
  const nextRemainder = Math.max(0, total - wholeQuantity);
  return {
    wholeQuantity,
    nextRemainder: Number(nextRemainder.toFixed(6)),
    exactQuantity: Number(total.toFixed(6)),
  };
}

function resolveWholeOnlineFuelCharge(exactQuantity) {
  const normalizedQuantity = Math.max(0, toFiniteNumber(exactQuantity, 0));
  return Math.max(0, Math.ceil(normalizedQuantity - 1e-9));
}

function isStructureServiceFuelItem(item, moduleTypeID = null) {
  if (!item || !isFuelBayCompatibleItem(item)) {
    return false;
  }
  const fuelGroupID = getStructureServiceModuleFuelGroupID(moduleTypeID);
  if (fuelGroupID <= 0) {
    return true;
  }
  return toPositiveInt(item.groupID, 0) === fuelGroupID;
}

function getStructureFuelCandidateItems(structureID, moduleTypeID = null) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return [];
  }
  return listContainerItems(null, numericStructureID, STRUCTURE_FUEL_BAY_FLAG)
    .filter((item) => isStructureServiceFuelItem(item, moduleTypeID))
    .sort((left, right) => (
      toInt(left.itemID, 0) - toInt(right.itemID, 0)
    ));
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

function buildFuelAlertTypesAndQty(fuelItems) {
  const quantitiesByTypeID = new Map();
  for (const item of Array.isArray(fuelItems) ? fuelItems : []) {
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

function consumeStructureServiceFuelQuantity(structureID, moduleItem, requiredQuantity, options = {}) {
  const normalizedRequiredQuantity = Math.max(0, toInt(requiredQuantity, 0));
  const moduleTypeID = moduleItem && moduleItem.typeID;
  const fuelGroupID = getStructureServiceModuleFuelGroupID(moduleTypeID);
  if (normalizedRequiredQuantity <= 0) {
    return {
      success: true,
      requiredQuantity: 0,
      fuelGroupID,
      consumedQuantity: 0,
      changes: [],
    };
  }

  const fuelItems = getStructureFuelCandidateItems(structureID, moduleTypeID);
  const availableQuantity = fuelItems.reduce(
    (total, item) => total + getStackQuantity(item),
    0,
  );
  if (availableQuantity < normalizedRequiredQuantity) {
    return {
      success: false,
      errorMsg: "NOT_ENOUGH_FUEL",
      requiredQuantity: normalizedRequiredQuantity,
      fuelGroupID,
      availableQuantity,
      consumedQuantity: 0,
      fuelAlertTypesAndQty: buildFuelAlertTypesAndQty(fuelItems),
      changes: [],
    };
  }

  let remaining = normalizedRequiredQuantity;
  const changes = [];
  for (const item of fuelItems) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, getStackQuantity(item));
    const result = consumeInventoryItemQuantity(item.itemID, take, options);
    if (!result || result.success !== true) {
      return {
        success: false,
        errorMsg: result && result.errorMsg ? result.errorMsg : "FUEL_CONSUME_FAILED",
        requiredQuantity: normalizedRequiredQuantity,
        fuelGroupID,
        availableQuantity,
        consumedQuantity: normalizedRequiredQuantity - remaining,
        changes,
      };
    }
    changes.push(...((result.data && result.data.changes) || []));
    remaining -= take;
  }

  return {
    success: true,
    requiredQuantity: normalizedRequiredQuantity,
    fuelGroupID,
    availableQuantity,
    consumedQuantity: normalizedRequiredQuantity,
    changes,
  };
}

function consumeStructureServiceModuleOnlineFuel(structureID, moduleItem, options = {}) {
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  const requirementResult = validateStructureServiceModuleOnlineRequirements(
    structure,
    moduleItem,
  );
  if (!requirementResult.success) {
    return requirementResult;
  }
  const proximityConflict = getStructureServiceModuleProximityConflict(structure, moduleItem);
  if (proximityConflict) {
    return {
      success: false,
      errorMsg: "STRUCTURE_SERVICE_TOO_CLOSE",
      proximityConflict,
      changes: [],
    };
  }

  const requiredQuantity = resolveWholeOnlineFuelCharge(
    getEffectiveStructureServiceModuleOnlineFuelNeed(structureID, moduleItem),
  );
  const fuelResult = consumeStructureServiceFuelQuantity(
    structureID,
    moduleItem,
    requiredQuantity,
    options,
  );
  if (!fuelResult || fuelResult.success !== true) {
    return fuelResult;
  }

  const nowMs = toInt(options.nowMs, Date.now());
  const nextCycleAt = nowMs + SERVICE_FUEL_CYCLE_MS;
  const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      serviceFuelOnlineAt: nowMs,
      serviceFuelNextCycleAt: nextCycleAt,
      serviceFuelRemainder: 0,
    },
  }));
  return {
    ...fuelResult,
    moduleUpdate: updateResult && updateResult.success ? updateResult.data : null,
    moduleUpdateResult: updateResult,
  };
}

function tryAutoOnlineFittedStructureServiceModule(structureID, moduleItem, options = {}) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID || !isStructureServiceModuleItem(moduleItem)) {
    return {
      success: true,
      changed: false,
      changes: [],
      moduleItem,
    };
  }
  if (isEffectivelyOnlineModule(moduleItem)) {
    return {
      success: true,
      changed: false,
      changes: [],
      moduleItem,
    };
  }

  const structure = structureState.getStructureByID(numericStructureID, { refresh: false });
  if (!structure) {
    return {
      success: false,
      changed: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
      changes: [],
      moduleItem,
    };
  }
  if (isStructureDamagedForServiceOnline(structure)) {
    return {
      success: false,
      changed: false,
      errorMsg: "STRUCTURE_DAMAGED",
      changes: [],
      moduleItem,
    };
  }

  const fuelResult = consumeStructureServiceModuleOnlineFuel(
    numericStructureID,
    moduleItem,
    options,
  );
  if (!fuelResult || fuelResult.success !== true) {
    return {
      ...(fuelResult || {}),
      success: false,
      changed: false,
      moduleItem,
      changes: Array.isArray(fuelResult && fuelResult.changes) ? fuelResult.changes : [],
    };
  }

  const stampedModule = fuelResult.moduleUpdate || moduleItem;
  const onlineResult = updateInventoryItem(stampedModule.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      online: true,
    },
  }));
  if (!onlineResult || onlineResult.success !== true) {
    return {
      ...fuelResult,
      success: false,
      changed: false,
      errorMsg: onlineResult && onlineResult.errorMsg ? onlineResult.errorMsg : "MODULE_ONLINE_FAILED",
      moduleItem: stampedModule,
      changes: Array.isArray(fuelResult.changes) ? fuelResult.changes : [],
    };
  }

  const moduleStampChanges =
    fuelResult.moduleUpdateResult && fuelResult.moduleUpdateResult.success
      ? [{
          previousData: fuelResult.moduleUpdateResult.previousData || moduleItem,
          item: fuelResult.moduleUpdateResult.data,
        }]
      : [];
  return {
    ...fuelResult,
    success: true,
    changed: true,
    moduleItem: onlineResult.data,
    changes: [
      ...(Array.isArray(fuelResult.changes) ? fuelResult.changes : []),
      ...moduleStampChanges,
      { previousData: onlineResult.previousData || stampedModule, item: onlineResult.data },
    ],
  };
}

function ensureStructureServiceFuelCycleStamp(moduleItem, nowMs) {
  const nextCycleAt = toInt(
    moduleItem && moduleItem.moduleState && moduleItem.moduleState.serviceFuelNextCycleAt,
    0,
  );
  if (nextCycleAt > 0) {
    return {
      success: true,
      changed: false,
      moduleItem,
      changes: [],
    };
  }
  const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      serviceFuelOnlineAt: toInt(
        currentItem.moduleState && currentItem.moduleState.serviceFuelOnlineAt,
        nowMs,
      ),
      serviceFuelNextCycleAt: nowMs + SERVICE_FUEL_CYCLE_MS,
      serviceFuelRemainder: toFiniteNumber(
        currentItem.moduleState && currentItem.moduleState.serviceFuelRemainder,
        0,
      ),
    },
  }));
  return {
    success: updateResult && updateResult.success === true,
    changed: updateResult && updateResult.success === true,
    moduleItem: updateResult && updateResult.success ? updateResult.data : moduleItem,
    changes: updateResult && updateResult.success
      ? [{ previousData: updateResult.previousData || moduleItem, item: updateResult.data }]
      : [],
    errorMsg: updateResult && updateResult.errorMsg,
  };
}

function resolveServiceModuleLastFuelConsumptionAt(moduleItem, nextCycleAt, nowMs) {
  const moduleState =
    moduleItem && moduleItem.moduleState && typeof moduleItem.moduleState === "object"
      ? moduleItem.moduleState
      : {};
  const candidates = [
    toPositiveInt(moduleState.serviceFuelLastCycleAt, 0),
    toPositiveInt(moduleState.serviceFuelOnlineAt, 0),
    toPositiveInt(nextCycleAt, 0) > SERVICE_FUEL_CYCLE_MS
      ? toPositiveInt(nextCycleAt, 0) - SERVICE_FUEL_CYCLE_MS
      : 0,
  ].filter((value) => value > 0);
  return candidates.length > 0
    ? Math.max(...candidates)
    : toPositiveInt(nowMs, Date.now());
}

function consumeStructureServiceModuleCycleFuel(structureID, moduleItem, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  const requirementResult = validateStructureServiceModuleOnlineRequirements(
    structure,
    moduleItem,
  );
  if (!requirementResult.success) {
    return offlineServiceModuleForMissingRequirement(
      moduleItem,
      requirementResult.errorMsg,
    );
  }
  const proximityConflict = getStructureServiceModuleProximityConflict(structure, moduleItem);
  if (proximityConflict) {
    return offlineServiceModuleForProximity(moduleItem, proximityConflict);
  }

  const stampResult = ensureStructureServiceFuelCycleStamp(moduleItem, nowMs);
  if (!stampResult || stampResult.success !== true) {
    return stampResult || { success: false, errorMsg: "FUEL_CYCLE_STAMP_FAILED" };
  }
  const stampedModule = stampResult.moduleItem || moduleItem;
  const nextCycleAt = toInt(
    stampedModule && stampedModule.moduleState && stampedModule.moduleState.serviceFuelNextCycleAt,
    0,
  );
  if (nextCycleAt <= 0 || nowMs < nextCycleAt) {
    return {
      success: true,
      moduleItem: stampedModule,
      cycleCount: 0,
      changes: stampResult.changes || [],
    };
  }

  const cycleFuelNeed = getEffectiveStructureServiceModuleCycleFuelNeed(
    structureID,
    stampedModule,
  );
  if (cycleFuelNeed <= 0) {
    return {
      success: true,
      moduleItem: stampedModule,
      cycleCount: 0,
      changes: stampResult.changes || [],
    };
  }

  const cycleCount = Math.max(1, Math.floor((nowMs - nextCycleAt) / SERVICE_FUEL_CYCLE_MS) + 1);
  const fuelCharge = resolveWholeServiceFuelCharge(
    cycleFuelNeed * cycleCount,
    stampedModule && stampedModule.moduleState && stampedModule.moduleState.serviceFuelRemainder,
  );
  const fuelResult = consumeStructureServiceFuelQuantity(
    structureID,
    stampedModule,
    fuelCharge.wholeQuantity,
    options,
  );
  if (!fuelResult || fuelResult.success !== true) {
    const abandonAnchorAt = resolveServiceModuleLastFuelConsumptionAt(
      stampedModule,
      nextCycleAt,
      nowMs,
    );
    const offlineResult = updateInventoryItem(stampedModule.itemID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        online: false,
        serviceFuelNextCycleAt: null,
        serviceFuelRemainder: 0,
      },
    }));
    return {
      ...(fuelResult || {}),
      success: false,
      errorMsg: fuelResult && fuelResult.errorMsg ? fuelResult.errorMsg : "NOT_ENOUGH_FUEL",
      moduleItem: offlineResult && offlineResult.success ? offlineResult.data : stampedModule,
      offlined: true,
      abandonAnchorAt,
      cycleCount,
      changes: [
        ...(stampResult.changes || []),
        ...((fuelResult && fuelResult.changes) || []),
        ...(offlineResult && offlineResult.success
          ? [{ previousData: offlineResult.previousData || stampedModule, item: offlineResult.data }]
          : []),
      ],
    };
  }

  const updateResult = updateInventoryItem(stampedModule.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      serviceFuelLastCycleAt: nowMs,
      serviceFuelNextCycleAt: nextCycleAt + (cycleCount * SERVICE_FUEL_CYCLE_MS),
      serviceFuelRemainder: fuelCharge.nextRemainder,
    },
  }));
  return {
    ...fuelResult,
    success: true,
    moduleItem: updateResult && updateResult.success ? updateResult.data : stampedModule,
    cycleCount,
    changes: [
      ...(stampResult.changes || []),
      ...(fuelResult.changes || []),
      ...(updateResult && updateResult.success
        ? [{ previousData: updateResult.previousData || stampedModule, item: updateResult.data }]
        : []),
    ],
  };
}

function resolveStructureUpkeepAfterServiceSync(currentUpkeepState, hasOnlineServiceModule) {
  if (hasOnlineServiceModule) {
    return STRUCTURE_UPKEEP_STATE.FULL_POWER;
  }
  const normalizedCurrent = toInt(currentUpkeepState, 0);
  if (normalizedCurrent === STRUCTURE_UPKEEP_STATE.ABANDONED) {
    return STRUCTURE_UPKEEP_STATE.ABANDONED;
  }
  return STRUCTURE_UPKEEP_STATE.LOW_POWER;
}

function syncStructureServiceModuleState(structureID, options = {}) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const beforeStructure = structureState.getStructureByID(numericStructureID, { refresh: false });
  const rawOnlineModules = listOnlineStructureServiceModules(numericStructureID);
  const onlineModules = [];
  const fuelCycleChanges = [];
  const offlinedModuleIDs = [];
  const fuelStarvationAbandonAnchors = [];
  const fuelAlertTypesByTypeID = new Map();
  const applyFuelCycles = options.applyFuelCycles !== false;
  for (const moduleItem of rawOnlineModules) {
    if (!applyFuelCycles) {
      onlineModules.push(moduleItem);
      continue;
    }
    const fuelCycleResult = consumeStructureServiceModuleCycleFuel(
      numericStructureID,
      moduleItem,
      options,
    );
    fuelCycleChanges.push(...((fuelCycleResult && fuelCycleResult.changes) || []));
    if (fuelCycleResult && fuelCycleResult.success === true) {
      onlineModules.push(fuelCycleResult.moduleItem || moduleItem);
    } else {
      offlinedModuleIDs.push(toPositiveInt(moduleItem.itemID, 0));
      for (const entry of (fuelCycleResult && fuelCycleResult.fuelAlertTypesAndQty) || []) {
        if (!Array.isArray(entry) || entry.length < 2) {
          continue;
        }
        const quantity = toPositiveInt(entry[0], 0);
        const typeID = toPositiveInt(entry[1], 0);
        if (quantity > 0 && typeID > 0) {
          fuelAlertTypesByTypeID.set(
            typeID,
            Math.max(quantity, fuelAlertTypesByTypeID.get(typeID) || 0),
          );
        }
      }
      const abandonAnchorAt = toPositiveInt(
        fuelCycleResult && fuelCycleResult.abandonAnchorAt,
        0,
      );
      if (abandonAnchorAt > 0) {
        fuelStarvationAbandonAnchors.push(abandonAnchorAt);
      }
    }
  }
  const onlineServiceIDs = new Set();
  for (const moduleItem of onlineModules) {
    for (const serviceID of getStructureServiceIDsForModuleType(moduleItem.typeID)) {
      onlineServiceIDs.add(serviceID);
    }
  }

  const updateResult = structureState.updateStructureRecord(numericStructureID, (current) => {
    const nextServiceStates = {
      ...(current.serviceStates || {}),
    };
    for (const serviceID of MANAGED_SERVICE_IDS) {
      if (Object.prototype.hasOwnProperty.call(nextServiceStates, String(serviceID))) {
        nextServiceStates[String(serviceID)] = onlineServiceIDs.has(serviceID)
          ? STRUCTURE_SERVICE_STATE.ONLINE
          : STRUCTURE_SERVICE_STATE.OFFLINE;
      }
    }
    const hasOnlineServiceModule = onlineModules.length > 0;
    const upkeepState = resolveStructureUpkeepAfterServiceSync(
      current.upkeepState,
      hasOnlineServiceModule,
    );
    const currentAbandonAt = toPositiveInt(current.abandonAt, 0) || null;
    let abandonAt = hasOnlineServiceModule ? null : currentAbandonAt;
    let abandonmentWarningAbandonAt = current.abandonmentWarningAbandonAt || null;
    let abandonmentWarningRecipients = Array.isArray(current.abandonmentWarningRecipients)
      ? current.abandonmentWarningRecipients
      : [];
    if (hasOnlineServiceModule) {
      abandonmentWarningAbandonAt = null;
      abandonmentWarningRecipients = [];
    } else if (
      !abandonAt &&
      upkeepState !== STRUCTURE_UPKEEP_STATE.ABANDONED &&
      fuelStarvationAbandonAnchors.length > 0
    ) {
      abandonAt = structureState.resolveStructureAbandonAtFromFuelAnchor(
        Math.max(...fuelStarvationAbandonAnchors),
      );
      abandonmentWarningAbandonAt = null;
      abandonmentWarningRecipients = [];
    }
    return {
      ...current,
      serviceStates: nextServiceStates,
      upkeepState,
      abandonAt,
      abandonmentWarningAbandonAt,
      abandonmentWarningRecipients,
    };
  });
  if (updateResult && updateResult.success === true && fuelAlertTypesByTypeID.size > 0) {
    structureState.createStructureFuelAlertNotifications(
      updateResult.data,
      [...fuelAlertTypesByTypeID.entries()]
        .sort(([leftTypeID], [rightTypeID]) => leftTypeID - rightTypeID)
        .map(([typeID, quantity]) => [quantity, typeID]),
    );
  }
  return {
    ...updateResult,
    fuelCycleChanges,
    offlinedModuleIDs,
    industryJobSync: updateResult && updateResult.success
      ? syncIndustryJobsForServiceStateTransition(
          numericStructureID,
          beforeStructure && beforeStructure.serviceStates,
          updateResult.data && updateResult.data.serviceStates,
        )
      : null,
  };
}

module.exports = {
  DEFAULT_SERVICE_ONLINE_FUEL_HOURS,
  MANAGED_SERVICE_IDS,
  SERVICE_IDS_BY_MODULE_TYPE_ID,
  SERVICE_FUEL_CYCLE_MS,
  STRUCTURE_FUEL_BAY_FLAG,
  STRUCTURE_SERVICE_SLOT_FLAGS,
  consumeStructureServiceFuelQuantity,
  consumeStructureServiceModuleCycleFuel,
  consumeStructureServiceModuleOnlineFuel,
  getStructureFuelCandidateItems,
  buildStructureServiceModuleEffectiveAttributeMap,
  getStructureServiceIDsForModuleType,
  getEffectiveStructureServiceModuleCycleFuelNeed,
  getEffectiveStructureServiceModuleOnlineFuelNeed,
  getStructureServiceModuleCycleFuelNeed,
  getStructureServiceModuleFuelGroupID,
  getStructureServiceModuleOnlineFuelNeed,
  isStructureServiceModuleItem,
  isStructureServiceModuleType,
  isStructureServiceFuelItem,
  isStructureServiceSlotFlag,
  isStructureDamagedForServiceOnline,
  listFittedStructureServiceModules,
  listOnlineStructureServiceModules,
  syncStructureServiceModuleState,
  tryAutoOnlineFittedStructureServiceModule,
};
