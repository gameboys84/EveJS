const path = require("path");

const {
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  getStructureServiceIDsForModuleType,
  isStructureServiceModuleType,
} = require(path.join(__dirname, "./structureServiceAuthority"));

const STRUCTURE_SERVICE_SLOT_FLAGS = Object.freeze([164, 165, 166, 167, 168, 169, 170, 171]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function readServiceState(serviceStates, serviceID) {
  return toInt(
    serviceStates && serviceStates[String(serviceID)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  );
}

function isStructureServiceSlotFlag(flagID) {
  return STRUCTURE_SERVICE_SLOT_FLAGS.includes(toInt(flagID, 0));
}

function listBackedServiceIDsForStructure(structureID, excludedItemID = 0) {
  const numericStructureID = toInt(structureID, 0);
  if (numericStructureID <= 0) {
    return new Set();
  }
  const serviceIDs = new Set();
  for (const item of listContainerItems(null, numericStructureID, null)) {
    if (
      !item ||
      toInt(item.itemID, 0) === toInt(excludedItemID, 0) ||
      !isStructureServiceSlotFlag(item.flagID) ||
      !isStructureServiceModuleType(item.typeID)
    ) {
      continue;
    }
    for (const serviceID of getStructureServiceIDsForModuleType(item.typeID)) {
      serviceIDs.add(serviceID);
    }
  }
  return serviceIDs;
}

function listServiceStateTransitions(beforeServiceStates = {}, afterServiceStates = {}) {
  const serviceIDs = new Set([
    ...Object.keys(beforeServiceStates || {}),
    ...Object.keys(afterServiceStates || {}),
  ]);
  const onlineServiceIDs = [];
  const offlineServiceIDs = [];
  for (const serviceIDText of serviceIDs) {
    const serviceID = toInt(serviceIDText, 0);
    if (serviceID <= 0) {
      continue;
    }
    const beforeState = readServiceState(beforeServiceStates, serviceID);
    const afterState = readServiceState(afterServiceStates, serviceID);
    if (
      beforeState === STRUCTURE_SERVICE_STATE.ONLINE &&
      afterState !== STRUCTURE_SERVICE_STATE.ONLINE
    ) {
      offlineServiceIDs.push(serviceID);
    } else if (
      beforeState !== STRUCTURE_SERVICE_STATE.ONLINE &&
      afterState === STRUCTURE_SERVICE_STATE.ONLINE
    ) {
      onlineServiceIDs.push(serviceID);
    }
  }
  return {
    onlineServiceIDs,
    offlineServiceIDs,
  };
}

function syncIndustryJobsForServiceStateTransition(
  structureID,
  beforeServiceStates = {},
  afterServiceStates = {},
) {
  const transitions = listServiceStateTransitions(beforeServiceStates, afterServiceStates);
  const industryRuntime = require(path.join(__dirname, "../industry/industryRuntimeState"));
  const pauseResult =
    transitions.offlineServiceIDs.length > 0
      ? industryRuntime.pauseIndustryJobsForStructureServices(
          structureID,
          transitions.offlineServiceIDs,
        )
      : { success: true, data: { changedJobIDs: [] } };
  const resumeResult =
    transitions.onlineServiceIDs.length > 0
      ? industryRuntime.resumeIndustryJobsForStructureServices(
          structureID,
          transitions.onlineServiceIDs,
        )
      : { success: true, data: { changedJobIDs: [] } };

  return {
    success: pauseResult.success !== false && resumeResult.success !== false,
    offlineServiceIDs: transitions.offlineServiceIDs,
    onlineServiceIDs: transitions.onlineServiceIDs,
    pausedJobIDs: pauseResult.data && Array.isArray(pauseResult.data.changedJobIDs)
      ? pauseResult.data.changedJobIDs
      : [],
    resumedJobIDs: resumeResult.data && Array.isArray(resumeResult.data.changedJobIDs)
      ? resumeResult.data.changedJobIDs
      : [],
    pauseResult,
    resumeResult,
  };
}

function cancelIndustryJobsForRemovedServiceModule(
  structureID,
  moduleTypeID,
  options = {},
) {
  const removedServiceIDs = getStructureServiceIDsForModuleType(moduleTypeID);
  if (removedServiceIDs.length === 0) {
    return { success: true, data: { changedJobIDs: [] }, unbackedServiceIDs: [] };
  }
  const backedServiceIDs = listBackedServiceIDsForStructure(
    structureID,
    options.excludedItemID,
  );
  const unbackedServiceIDs = removedServiceIDs
    .map((serviceID) => toInt(serviceID, 0))
    .filter((serviceID) => serviceID > 0 && !backedServiceIDs.has(serviceID));
  if (unbackedServiceIDs.length === 0) {
    return { success: true, data: { changedJobIDs: [] }, unbackedServiceIDs };
  }
  const industryRuntime = require(path.join(__dirname, "../industry/industryRuntimeState"));
  const result = industryRuntime.cancelIndustryJobsForStructureServices(
    structureID,
    unbackedServiceIDs,
    options,
  );
  return {
    ...result,
    unbackedServiceIDs,
  };
}

function cancelIndustryJobsForStructureLifecycle(structureID, options = {}) {
  const industryRuntime = require(path.join(__dirname, "../industry/industryRuntimeState"));
  return industryRuntime.cancelIndustryJobsForStructure(structureID, options);
}

module.exports = {
  cancelIndustryJobsForStructureLifecycle,
  cancelIndustryJobsForRemovedServiceModule,
  listServiceStateTransitions,
  syncIndustryJobsForServiceStateTransition,
};
