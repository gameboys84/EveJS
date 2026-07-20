const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  listContainerItems,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getActiveShipRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getShipBaseAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  boardSpaceShip,
  ejectSession,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  maybeExpireEmptySpaceContainer,
} = require(path.join(__dirname, "./jettisonRuntime"));
const {
  validateShipServiceAccess,
} = require(path.join(__dirname, "./shipServiceAccess"));

const DEFAULT_LAUNCH_OFFSET_METERS = 275;
const MAX_CONFIGURE_DISTANCE_METERS = 5000;
const CATEGORY_SHIP = 6;
const CAPSULE_TYPE_ID = 670;
const GROUP_SHIP_MAINTENANCE_ARRAY = 363;
const GROUP_ASSEMBLY_ARRAY = 397;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback, { x: 1, y: 0, z: 0 });
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function addVectors(left, right) {
  const resolvedLeft = cloneVector(left);
  const resolvedRight = cloneVector(right);
  return {
    x: resolvedLeft.x + resolvedRight.x,
    y: resolvedLeft.y + resolvedRight.y,
    z: resolvedLeft.z + resolvedRight.z,
  };
}

function scaleVector(vector, scalar) {
  const resolved = cloneVector(vector);
  const resolvedScalar = toFiniteNumber(scalar, 0);
  return {
    x: resolved.x * resolvedScalar,
    y: resolved.y * resolvedScalar,
    z: resolved.z * resolvedScalar,
  };
}

function distanceBetween(left, right) {
  const resolvedLeft = cloneVector(left);
  const resolvedRight = cloneVector(right);
  return Math.sqrt(
    ((resolvedLeft.x - resolvedRight.x) ** 2) +
    ((resolvedLeft.y - resolvedRight.y) ** 2) +
    ((resolvedLeft.z - resolvedRight.z) ** 2),
  );
}

function surfaceDistanceBetweenEntities(left, right) {
  return Math.max(
    0,
    distanceBetween(left && left.position, right && right.position) -
      Math.max(0, toFiniteNumber(left && left.radius, 0)) -
      Math.max(0, toFiniteNumber(right && right.radius, 0)),
  );
}

function buildLaunchStateNearSource(sourceEntity, offsetMeters = DEFAULT_LAUNCH_OFFSET_METERS) {
  const direction = normalizeVector(
    sourceEntity && sourceEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const sourceRadius = Math.max(0, toFiniteNumber(sourceEntity && sourceEntity.radius, 0));
  const offset = Math.max(
    50,
    sourceRadius + Math.max(50, toFiniteNumber(offsetMeters, DEFAULT_LAUNCH_OFFSET_METERS)),
  );
  const position = addVectors(
    cloneVector(sourceEntity && sourceEntity.position),
    scaleVector(direction, offset),
  );
  return {
    systemID: toInt(sourceEntity && sourceEntity.systemID, 0),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  };
}

function isSourceSpaceContainerEntity(entity) {
  return Boolean(
    entity &&
    (entity.kind === "container" || entity.kind === "wreck"),
  );
}

function isShipMaintenanceArraySource(item) {
  const groupID = toInt(item && item.groupID, 0);
  return groupID === GROUP_SHIP_MAINTENANCE_ARRAY || groupID === GROUP_ASSEMBLY_ARRAY;
}

function isShipMaintenanceBaySource(item) {
  if (toInt(item && item.categoryID, 0) !== CATEGORY_SHIP) {
    return false;
  }

  const hasMaintenanceBay = toFiniteNumber(
    getShipBaseAttributeValue(item.typeID, "hasShipMaintenanceBay"),
    0,
  );
  const bayCapacity = toFiniteNumber(
    getShipBaseAttributeValue(item.typeID, "shipMaintenanceBayCapacity"),
    0,
  );
  return hasMaintenanceBay > 0 || bayCapacity > 0;
}

function getShipMaintenanceBayCapacity(sourceItem) {
  return Math.max(
    0,
    toFiniteNumber(
      getShipBaseAttributeValue(sourceItem && sourceItem.typeID, "shipMaintenanceBayCapacity"),
      0,
    ),
  );
}

function getMaintenanceSourceCapacity(sourceItem, sourceIsShipBay) {
  if (!sourceItem) {
    return 0;
  }

  if (sourceIsShipBay) {
    return getShipMaintenanceBayCapacity(sourceItem);
  }

  const metadata = resolveItemByTypeID(sourceItem.typeID) || {};
  return Math.max(
    0,
    toFiniteNumber(
      sourceItem.capacity,
      toFiniteNumber(metadata.capacity, 0),
    ),
  );
}

function getItemVolume(item) {
  if (!item) {
    return 0;
  }
  const metadata = resolveItemByTypeID(item.typeID) || {};
  const volume = Math.max(
    0,
    toFiniteNumber(item.volume, toFiniteNumber(metadata.volume, 0)),
  );
  const stackSize =
    toInt(item.singleton, 0) === 1
      ? 1
      : Math.max(1, toInt(item.stacksize ?? item.quantity, 1));
  return volume * stackSize;
}

function getMaintenanceSourceUsedVolume(sourceID, excludedItemID = 0) {
  const excludedID = toInt(excludedItemID, 0);
  return listContainerItems(null, sourceID).reduce((sum, item) => {
    if (!item || toInt(item.itemID, 0) === excludedID) {
      return sum;
    }
    return sum + getItemVolume(item);
  }, 0);
}

function canStoreShipInMaintenanceSource(context, shipItem, excludedItemID = 0) {
  const capacity = getMaintenanceSourceCapacity(
    context && context.sourceItem,
    context && context.sourceIsShipBay,
  );
  if (capacity <= 0) {
    return true;
  }

  const used = getMaintenanceSourceUsedVolume(
    context.sourceID,
    excludedItemID,
  );
  return used + getItemVolume(shipItem) <= capacity + 0.0001;
}

function isMaintenanceSourceInCurrentSystem(sourceItem, systemID) {
  return Boolean(
    sourceItem &&
    toInt(sourceItem.locationID, 0) === systemID &&
    toInt(sourceItem.flagID, -1) === 0 &&
    sourceItem.spaceState,
  );
}

function buildFallbackSourceEntity(sourceItem, systemID) {
  if (!sourceItem || !sourceItem.spaceState) {
    return null;
  }

  const metadata = resolveItemByTypeID(sourceItem.typeID) || {};
  return {
    kind: toInt(sourceItem.categoryID, 0) === CATEGORY_SHIP ? "ship" : "structure",
    itemID: toInt(sourceItem.itemID, 0),
    typeID: toInt(sourceItem.typeID, 0),
    groupID: toInt(sourceItem.groupID, toInt(metadata.groupID, 0)),
    categoryID: toInt(sourceItem.categoryID, toInt(metadata.categoryID, 0)),
    systemID,
    position: cloneVector(sourceItem.spaceState.position),
    direction: normalizeVector(sourceItem.spaceState.direction, { x: 1, y: 0, z: 0 }),
    radius: Math.max(
      0,
      toFiniteNumber(sourceItem.radius, toFiniteNumber(metadata.radius, 0)),
    ),
  };
}

function resolveMaintenanceSourceContext(session, sourceLocationID, options = {}) {
  const characterID = toInt(session && session.characterID, 0);
  const systemID = toInt(
    session && session._space && session._space.systemID,
    toInt(session && (session.solarsystemid2 || session.solarsystemid), 0),
  );
  const sourceID = toInt(sourceLocationID, 0);
  if (!characterID || !systemID || !sourceID) {
    return {
      success: false,
      errorMsg: "INVALID_SESSION_OR_ITEM",
    };
  }

  const currentShip = getActiveShipRecord(characterID) || null;
  if (
    options.rejectActiveSource === true &&
    currentShip &&
    toInt(currentShip.itemID, 0) === sourceID
  ) {
    return {
      success: false,
      errorMsg: "SOURCE_IS_ACTIVE_SHIP",
    };
  }

  const sourceItem = findItemById(sourceID);
  if (!isMaintenanceSourceInCurrentSystem(sourceItem, systemID)) {
    return {
      success: false,
      errorMsg: "SOURCE_MAINTENANCE_CONTAINER_NOT_IN_SPACE",
    };
  }

  const sourceIsShipBay = isShipMaintenanceBaySource(sourceItem);
  const sourceIsPosMaintenanceArray = isShipMaintenanceArraySource(sourceItem);
  if (!sourceIsShipBay && !sourceIsPosMaintenanceArray) {
    return {
      success: false,
      errorMsg: "SOURCE_NOT_SHIP_MAINTENANCE_CONTAINER",
    };
  }

  if (sourceIsShipBay) {
    const serviceAccess = validateShipServiceAccess(
      session,
      sourceItem,
      ITEM_FLAGS.SHIP_HANGAR,
    );
    if (!serviceAccess.success) {
      return serviceAccess;
    }
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const sourceEntity =
    (scene && scene.getEntityByID(sourceID)) ||
    buildFallbackSourceEntity(sourceItem, systemID);
  if (!scene || !sourceEntity) {
    return {
      success: false,
      errorMsg: "SOURCE_MAINTENANCE_CONTAINER_NOT_VISIBLE",
    };
  }

  const activeEntity =
    currentShip && scene
      ? scene.getEntityByID(toInt(currentShip.itemID, 0))
      : null;
  if (options.requireActiveRange === true) {
    if (!activeEntity) {
      return {
        success: false,
        errorMsg: "ACTIVE_SHIP_ENTITY_NOT_FOUND",
      };
    }
    const distanceMeters = surfaceDistanceBetweenEntities(activeEntity, sourceEntity);
    if (distanceMeters > MAX_CONFIGURE_DISTANCE_METERS) {
      return {
        success: false,
        errorMsg: "SOURCE_MAINTENANCE_CONTAINER_TOO_FAR",
        data: {
          distanceMeters,
          maxDistanceMeters: MAX_CONFIGURE_DISTANCE_METERS,
        },
      };
    }
  }

  return {
    success: true,
    data: {
      characterID,
      systemID,
      sourceID,
      sourceItem,
      sourceEntity,
      sourceIsShipBay,
      sourceIsPosMaintenanceArray,
      scene,
      currentShip,
      activeEntity,
    },
  };
}

function validateShipForMaintenanceSource(context, itemID) {
  const targetItemID = toInt(itemID, 0);
  const containedItem = findItemById(targetItemID);
  if (!containedItem || toInt(containedItem.locationID, 0) !== context.sourceID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_IN_SOURCE_CONTAINER",
    };
  }

  if (toInt(containedItem.categoryID, 0) !== CATEGORY_SHIP) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_SHIP",
    };
  }

  if (toInt(containedItem.singleton, 0) !== 1) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_ASSEMBLED",
    };
  }

  if (
    context.sourceIsShipBay &&
    toInt(containedItem.flagID, 0) !== ITEM_FLAGS.SHIP_HANGAR
  ) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_IN_SHIP_MAINTENANCE_BAY",
    };
  }

  return {
    success: true,
    data: containedItem,
  };
}

function isLaunchableContainerType(item, metadata) {
  const groupName = String(
    metadata && metadata.groupName || item && item.groupName || "",
  ).trim().toLowerCase();
  return (
    groupName.includes("container") ||
    groupName === "spawn container"
  );
}

function isLaunchableContainedItem(item) {
  if (!item) {
    return false;
  }

  if (toInt(item.categoryID, 0) === CATEGORY_SHIP) {
    return toInt(item.singleton, 0) === 1;
  }

  const stackSize = toInt(item.stacksize ?? item.quantity, 1);
  if (stackSize > 1) {
    return false;
  }

  return isLaunchableContainerType(item, resolveItemByTypeID(item.typeID));
}

function syncUpdatedItem(session, updateResult) {
  if (!session || !updateResult || updateResult.success !== true) {
    return;
  }

  syncInventoryItemForSession(
    session,
    updateResult.data,
    updateResult.previousData || {},
    { emitCfgLocation: true },
  );
}

function launchShipOrContainerFromWreckOrContainer(session, sourceLocationID, itemID) {
  const characterID = toInt(session && session.characterID, 0);
  const systemID = toInt(
    session && session._space && session._space.systemID,
    toInt(session && (session.solarsystemid2 || session.solarsystemid), 0),
  );
  const sourceID = toInt(sourceLocationID, 0);
  const targetItemID = toInt(itemID, 0);
  if (!characterID || !systemID || !sourceID || !targetItemID) {
    return {
      success: false,
      errorMsg: "INVALID_SESSION_OR_ITEM",
    };
  }

  const sourceItem = findItemById(sourceID);
  if (
    !sourceItem ||
    toInt(sourceItem.locationID, 0) !== systemID ||
    toInt(sourceItem.flagID, -1) !== 0 ||
    !sourceItem.spaceState
  ) {
    return {
      success: false,
      errorMsg: "SOURCE_CONTAINER_NOT_IN_SPACE",
    };
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const sourceEntity = scene && scene.getEntityByID(sourceID);
  if (!scene || !isSourceSpaceContainerEntity(sourceEntity)) {
    return {
      success: false,
      errorMsg: "SOURCE_CONTAINER_NOT_VISIBLE",
    };
  }

  const containedItem = findItemById(targetItemID);
  if (!containedItem || toInt(containedItem.locationID, 0) !== sourceID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_IN_SOURCE_CONTAINER",
    };
  }

  if (!isLaunchableContainedItem(containedItem)) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_LAUNCHABLE",
    };
  }

  const launchState = buildLaunchStateNearSource(sourceEntity);
  const updateResult = updateInventoryItem(targetItemID, (currentItem) => ({
    ...currentItem,
    locationID: systemID,
    flagID: 0,
    singleton:
      toInt(currentItem.categoryID, 0) === CATEGORY_SHIP
        ? 1
        : currentItem.singleton,
    spaceState: launchState,
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  syncUpdatedItem(session, updateResult);

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(systemID, targetItemID);
  if (!spawnResult || spawnResult.success !== true) {
    log.warn(
      `[EjectRuntime] Launched item=${targetItemID} from source=${sourceID} but dynamic spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN_ERROR"}`,
    );
    return {
      success: false,
      errorMsg: spawnResult && spawnResult.errorMsg || "SPACE_SPAWN_FAILED",
    };
  }

  maybeExpireEmptySpaceContainer(session, sourceID);

  return {
    success: true,
    data: {
      sourceID,
      itemID: targetItemID,
      systemID,
      entity: spawnResult.data && spawnResult.data.entity || null,
    },
  };
}

function launchShipFromMaintenanceContainer(session, sourceLocationID, itemID, options = {}) {
  const contextResult = resolveMaintenanceSourceContext(
    session,
    sourceLocationID,
    options,
  );
  if (!contextResult.success) {
    return contextResult;
  }
  const context = contextResult.data;
  const targetItemID = toInt(itemID, 0);
  if (!targetItemID) {
    return {
      success: false,
      errorMsg: "INVALID_SESSION_OR_ITEM",
    };
  }

  const containedResult = validateShipForMaintenanceSource(context, targetItemID);
  if (!containedResult.success) {
    return containedResult;
  }

  const launchAnchorEntity = options.launchAnchorEntity || context.sourceEntity;
  const launchState = buildLaunchStateNearSource(launchAnchorEntity);
  const updateResult = updateInventoryItem(targetItemID, (currentItem) => ({
    ...currentItem,
    locationID: context.systemID,
    flagID: 0,
    singleton: 1,
    spaceState: launchState,
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  syncUpdatedItem(session, updateResult);

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(context.systemID, targetItemID);
  if (!spawnResult || spawnResult.success !== true) {
    log.warn(
      `[EjectRuntime] Launched maintenance ship=${targetItemID} from source=${context.sourceID} but dynamic spawn failed: ${spawnResult ? spawnResult.errorMsg : "UNKNOWN_ERROR"}`,
    );
    return {
      success: false,
      errorMsg: spawnResult && spawnResult.errorMsg || "SPACE_SPAWN_FAILED",
    };
  }

  return {
    success: true,
    data: {
      sourceID: context.sourceID,
      itemID: targetItemID,
      systemID: context.systemID,
      entity: spawnResult.data && spawnResult.data.entity || null,
      context,
    },
  };
}

function storeShipRecordInMaintenanceSource(session, shipItem, context, options = {}) {
  const shipID = toInt(shipItem && shipItem.itemID, 0);
  if (!shipID || !context || !context.sourceID) {
    return {
      success: false,
      errorMsg: "INVALID_SESSION_OR_ITEM",
    };
  }
  if (toInt(shipItem.categoryID, 0) !== CATEGORY_SHIP) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_SHIP",
    };
  }
  if (toInt(shipItem.singleton, 0) !== 1) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_ASSEMBLED",
    };
  }
  if (!canStoreShipInMaintenanceSource(context, shipItem)) {
    return {
      success: false,
      errorMsg: "SHIP_MAINTENANCE_BAY_FULL",
    };
  }

  const destinationFlagID = context.sourceIsShipBay ? ITEM_FLAGS.SHIP_HANGAR : 0;
  const updateResult = updateInventoryItem(shipID, (currentItem) => ({
    ...currentItem,
    locationID: context.sourceID,
    flagID: destinationFlagID,
    singleton: 1,
    spaceState: null,
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  if (options.removeEntity !== false) {
    const removeResult = spaceRuntime.removeDynamicEntity(
      context.systemID,
      shipID,
      {
        forceVisibleSessions: session ? [session] : [],
      },
    );
    if (
      removeResult &&
      removeResult.success === false &&
      removeResult.errorMsg !== "DYNAMIC_ENTITY_NOT_FOUND"
    ) {
      log.warn(
        `[EjectRuntime] Stored maintenance ship=${shipID} in source=${context.sourceID} but dynamic removal failed: ${removeResult.errorMsg}`,
      );
    }
  }

  syncUpdatedItem(session, updateResult);
  return {
    success: true,
    data: {
      sourceID: context.sourceID,
      itemID: shipID,
      storedItem: updateResult.data,
    },
  };
}

function boardStoredShipFromMaintenanceContainer(session, sourceLocationID, itemID) {
  const contextResult = resolveMaintenanceSourceContext(session, sourceLocationID, {
    rejectActiveSource: true,
    requireActiveRange: true,
  });
  if (!contextResult.success) {
    return contextResult;
  }
  const context = contextResult.data;
  const currentShip = context.currentShip;
  const targetShipID = toInt(itemID, 0);
  const targetResult = validateShipForMaintenanceSource(context, targetShipID);
  if (!targetResult.success) {
    return targetResult;
  }

  if (
    currentShip &&
    toInt(currentShip.typeID, 0) !== CAPSULE_TYPE_ID &&
    !canStoreShipInMaintenanceSource(context, currentShip, targetShipID)
  ) {
    return {
      success: false,
      errorMsg: "SHIP_MAINTENANCE_BAY_FULL",
    };
  }

  const launchResult = launchShipFromMaintenanceContainer(
    session,
    sourceLocationID,
    targetShipID,
    {
      launchAnchorEntity: context.activeEntity || context.sourceEntity,
    },
  );
  if (!launchResult.success) {
    return launchResult;
  }

  const boardResult = boardSpaceShip(session, targetShipID);
  if (!boardResult.success) {
    return boardResult;
  }

  let storeResult = null;
  if (currentShip && toInt(currentShip.typeID, 0) !== CAPSULE_TYPE_ID) {
    storeResult = storeShipRecordInMaintenanceSource(
      session,
      currentShip,
      context,
      { removeEntity: true },
    );
    if (!storeResult.success) {
      log.warn(
        `[EjectRuntime] BoardStoredShip boarded ship=${targetShipID} but failed to store previous ship=${currentShip.itemID}: ${storeResult.errorMsg}`,
      );
    }
  }

  return {
    success: true,
    data: {
      sourceID: context.sourceID,
      itemID: targetShipID,
      launchResult: launchResult.data || null,
      boardResult: boardResult.data || null,
      storeResult: storeResult && storeResult.success ? storeResult.data : null,
    },
  };
}

function storeActiveShipInMaintenanceContainer(session, sourceLocationID) {
  const contextResult = resolveMaintenanceSourceContext(session, sourceLocationID, {
    rejectActiveSource: true,
    requireActiveRange: true,
  });
  if (!contextResult.success) {
    return contextResult;
  }
  const context = contextResult.data;
  const currentShip = context.currentShip;
  if (!currentShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (toInt(currentShip.typeID, 0) === CAPSULE_TYPE_ID) {
    return {
      success: false,
      errorMsg: "CANNOT_STORE_CAPSULE",
    };
  }
  if (!canStoreShipInMaintenanceSource(context, currentShip)) {
    return {
      success: false,
      errorMsg: "SHIP_MAINTENANCE_BAY_FULL",
    };
  }

  const ejectResult = ejectSession(session);
  if (!ejectResult.success) {
    return ejectResult;
  }

  const storeResult = storeShipRecordInMaintenanceSource(
    session,
    currentShip,
    context,
    { removeEntity: true },
  );
  if (!storeResult.success) {
    return storeResult;
  }

  return {
    success: true,
    data: {
      sourceID: context.sourceID,
      storedShipID: currentShip.itemID,
      capsule:
        ejectResult.data && ejectResult.data.capsule
          ? ejectResult.data.capsule
          : null,
      storeResult: storeResult.data || null,
    },
  };
}

module.exports = {
  launchShipOrContainerFromWreckOrContainer,
  launchShipFromMaintenanceContainer,
  boardStoredShipFromMaintenanceContainer,
  storeActiveShipInMaintenanceContainer,
  _testing: {
    buildLaunchStateNearSource,
    isLaunchableContainedItem,
  },
};
