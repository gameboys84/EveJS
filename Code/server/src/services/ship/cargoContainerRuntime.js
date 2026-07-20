const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  listContainerItems,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildShipResourceState,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

const MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS = 2500;

const CATEGORY_CELESTIAL = 2;
const GROUP_CARGO_CONTAINER = 12;
const GROUP_SECURE_CARGO_CONTAINER = 340;
const GROUP_AUDIT_LOG_SECURE_CONTAINER = 448;
const GROUP_FREIGHT_CONTAINER = 649;

const TYPE_CARGO_CONTAINER = 23;
const TYPE_HANGAR_CONTAINER = 41567;
const TYPE_PLANETARY_LAUNCH_CONTAINER = 2263;

const SCOOPABLE_CONTAINER_GROUP_IDS = new Set([
  GROUP_CARGO_CONTAINER,
  GROUP_SECURE_CARGO_CONTAINER,
  GROUP_AUDIT_LOG_SECURE_CONTAINER,
  GROUP_FREIGHT_CONTAINER,
]);

const NON_SCOOPABLE_CONTAINER_TYPE_IDS = new Set([
  TYPE_CARGO_CONTAINER,
  TYPE_HANGAR_CONTAINER,
  TYPE_PLANETARY_LAUNCH_CONTAINER,
]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toReal(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toReal(value && value.x, fallback.x),
    y: toReal(value && value.y, fallback.y),
    z: toReal(value && value.z, fallback.z),
  };
}

function getVectorDistance(left, right) {
  const l = normalizeVector(left);
  const r = normalizeVector(right);
  return Math.sqrt(
    ((l.x - r.x) ** 2) +
    ((l.y - r.y) ** 2) +
    ((l.z - r.z) ** 2),
  );
}

function getSessionContext(session) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  const shipID = toInt(
    session && session._space && session._space.shipID,
    toInt(session && (session.shipID || session.shipid || session.activeShipID), 0),
  );
  const systemID = toInt(
    session && session._space && session._space.systemID,
    toInt(session && (session.solarsystemid2 || session.solarsystemid), 0),
  );
  return {
    characterID,
    shipID,
    systemID,
  };
}

function getSyncInventoryItemForSession() {
  const characterState = require(path.join(__dirname, "../character/characterState"));
  return characterState.syncInventoryItemForSession;
}

function isCargoContainerType(item) {
  if (!item) {
    return false;
  }
  return (
    toInt(item.categoryID, 0) === CATEGORY_CELESTIAL &&
    SCOOPABLE_CONTAINER_GROUP_IDS.has(toInt(item.groupID, 0))
  );
}

function isNonScoopableContainerType(item) {
  return NON_SCOOPABLE_CONTAINER_TYPE_IDS.has(toInt(item && item.typeID, 0));
}

function isScoopableCargoContainerType(item) {
  return isCargoContainerType(item) && !isNonScoopableContainerType(item);
}

function isSecureCargoContainerType(item) {
  const groupID = toInt(item && item.groupID, 0);
  return (
    groupID === GROUP_SECURE_CARGO_CONTAINER ||
    groupID === GROUP_AUDIT_LOG_SECURE_CONTAINER
  );
}

function parseCustomInfo(customInfo) {
  if (!customInfo) {
    return {};
  }
  if (typeof customInfo === "object" && !Array.isArray(customInfo)) {
    return customInfo;
  }
  try {
    const parsed = JSON.parse(String(customInfo));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (_error) {
    return {};
  }
}

function firstTextValue(values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    const text = String(value);
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

function firstBooleanTrue(values) {
  return values.some((value) => value === true || value === 1 || value === "1");
}

function getSecureContainerState(item) {
  const info = parseCustomInfo(item && item.customInfo);
  const secure = info.secureContainer && typeof info.secureContainer === "object"
    ? info.secureContainer
    : {};
  const cargo = info.cargoContainer && typeof info.cargoContainer === "object"
    ? info.cargoContainer
    : {};
  const state = info.state && typeof info.state === "object" ? info.state : {};
  return {
    anchored: firstBooleanTrue([
      info.anchored,
      info.isAnchored,
      state.anchored,
      secure.anchored,
      cargo.anchored,
      info.anchorState === "anchored",
      secure.anchorState === "anchored",
      cargo.anchorState === "anchored",
    ]),
    password: firstTextValue([
      info.secureContainerPassword,
      info.containerPassword,
      info.scoopPassword,
      info.generalPassword,
      info.password,
      secure.password,
      secure.generalPassword,
      cargo.password,
      cargo.generalPassword,
      state.password,
    ]),
  };
}

function isSecureContainerPasswordSatisfied(item, providedPassword) {
  if (!isSecureCargoContainerType(item)) {
    return true;
  }

  const state = getSecureContainerState(item);
  if (!state.anchored || !state.password) {
    return true;
  }

  return String(providedPassword || "") === state.password;
}

function getItemMoveVolume(item) {
  return Math.max(0, toReal(item && item.volume, 0));
}

function getItemMoveQuantity(item) {
  return toInt(item && item.singleton, 0) === 1
    ? 1
    : Math.max(0, toInt(item && (item.stacksize ?? item.quantity), 0));
}

function getShipCargoCapacity(characterID, shipItem) {
  if (!shipItem) {
    return 0;
  }
  const resourceState = buildShipResourceState(characterID, shipItem);
  return Math.max(0, toReal(resourceState && resourceState.cargoCapacity, 0));
}

function getShipCargoUsedVolume(characterID, shipID, excludedItemID = 0) {
  const excludedID = toInt(excludedItemID, 0);
  return listContainerItems(characterID, shipID, ITEM_FLAGS.CARGO_HOLD)
    .reduce((sum, item) => {
      if (!item || toInt(item.itemID, 0) === excludedID) {
        return sum;
      }
      return sum + (getItemMoveVolume(item) * getItemMoveQuantity(item));
    }, 0);
}

function validateCargoDestination(item, context) {
  const shipItem = findItemById(context.shipID);
  const capacity = getShipCargoCapacity(context.characterID, shipItem);
  const used = getShipCargoUsedVolume(
    context.characterID,
    context.shipID,
    item && item.itemID,
  );
  if (used + getItemMoveVolume(item) > capacity + 1e-7) {
    return "NOT_ENOUGH_CARGO_SPACE";
  }
  return null;
}

function validateCargoContainerSpaceAccess(session, item, context) {
  if (!context.characterID || !context.shipID || !context.systemID) {
    return "INVALID_SESSION";
  }
  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (!isScoopableCargoContainerType(item)) {
    return "ITEM_NOT_SCOOPABLE_CONTAINER";
  }
  if (
    toInt(item.locationID, 0) !== context.systemID ||
    toInt(item.flagID, -1) !== 0 ||
    !item.spaceState
  ) {
    return "CONTAINER_NOT_IN_SPACE";
  }

  const scene = spaceRuntime.ensureScene(context.systemID);
  const shipEntity = spaceRuntime.getEntity(session, context.shipID);
  const containerEntity = scene && scene.getEntityByID(item.itemID);
  if (!containerEntity || containerEntity.kind !== "container") {
    return "CONTAINER_NOT_VISIBLE";
  }

  const shipPosition = shipEntity && shipEntity.position;
  const containerPosition =
    (containerEntity && containerEntity.position) ||
    (item.spaceState && item.spaceState.position);
  if (
    shipPosition &&
    containerPosition &&
    getVectorDistance(shipPosition, containerPosition) >
      MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS
  ) {
    return "TARGET_TOO_FAR";
  }

  return null;
}

function syncInventoryChange(session, item, previousData) {
  if (!session || !item) {
    return;
  }
  const syncInventoryItemForSession = getSyncInventoryItemForSession();
  if (typeof syncInventoryItemForSession !== "function") {
    return;
  }
  syncInventoryItemForSession(
    session,
    item,
    previousData || {},
    { emitCfgLocation: true },
  );
}

function transferContainedItemsToOwner(containerID, ownerID, seen = new Set()) {
  const normalizedContainerID = toInt(containerID, 0);
  const normalizedOwnerID = toInt(ownerID, 0);
  if (!normalizedContainerID || !normalizedOwnerID || seen.has(normalizedContainerID)) {
    return;
  }
  seen.add(normalizedContainerID);

  for (const child of listContainerItems(null, normalizedContainerID, null)) {
    if (!child) {
      continue;
    }
    const updateResult = updateInventoryItem(child.itemID, (currentItem) => ({
      ...currentItem,
      ownerID: normalizedOwnerID,
    }));
    if (!updateResult.success) {
      log.warn(
        `[CargoContainer] Failed to transfer contained item=${child.itemID} owner=${normalizedOwnerID}: ${updateResult.errorMsg}`,
      );
      continue;
    }
    if (isCargoContainerType(child)) {
      transferContainedItemsToOwner(child.itemID, normalizedOwnerID, seen);
    }
  }
}

function scoopCargoContainerToCargo(session, itemID, password = "") {
  const context = getSessionContext(session);
  const normalizedItemID = toInt(itemID, 0);
  const item = findItemById(normalizedItemID);
  const accessError = validateCargoContainerSpaceAccess(session, item, context);
  if (accessError) {
    return {
      success: false,
      errorMsg: accessError,
    };
  }

  if (!isSecureContainerPasswordSatisfied(item, password)) {
    return {
      success: false,
      errorMsg: "SECURE_CONTAINER_PASSWORD_REQUIRED",
    };
  }

  const destinationError = validateCargoDestination(item, context);
  if (destinationError) {
    return {
      success: false,
      errorMsg: destinationError,
    };
  }

  const removeResult = spaceRuntime.removeDynamicEntity(
    context.systemID,
    item.itemID,
  );
  if (!removeResult || !removeResult.success) {
    return {
      success: false,
      errorMsg: removeResult ? removeResult.errorMsg : "DYNAMIC_ENTITY_NOT_FOUND",
    };
  }

  const updateResult = updateInventoryItem(item.itemID, (currentItem) => ({
    ...currentItem,
    ownerID: context.characterID,
    locationID: context.shipID,
    flagID: ITEM_FLAGS.CARGO_HOLD,
    singleton: 1,
    expiresAtMs: null,
    spaceRadius: null,
    spaceState: null,
  }));
  if (!updateResult.success || !updateResult.data) {
    return updateResult;
  }

  transferContainedItemsToOwner(item.itemID, context.characterID);

  syncInventoryChange(
    session,
    updateResult.data,
    updateResult.previousData || item,
  );

  log.info(
    `[CargoContainer] char=${context.characterID} scooped container=${item.itemID} system=${context.systemID} ship=${context.shipID}`,
  );

  return {
    success: true,
    data: {
      itemID: item.itemID,
    },
  };
}

module.exports = {
  CATEGORY_CELESTIAL,
  GROUP_CARGO_CONTAINER,
  GROUP_SECURE_CARGO_CONTAINER,
  GROUP_AUDIT_LOG_SECURE_CONTAINER,
  GROUP_FREIGHT_CONTAINER,
  TYPE_CARGO_CONTAINER,
  TYPE_HANGAR_CONTAINER,
  TYPE_PLANETARY_LAUNCH_CONTAINER,
  MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS,
  isCargoContainerType,
  isNonScoopableContainerType,
  isScoopableCargoContainerType,
  isSecureCargoContainerType,
  getSecureContainerState,
  scoopCargoContainerToCargo,
  _testing: {
    parseCustomInfo,
    isSecureContainerPasswordSatisfied,
    transferContainedItemsToOwner,
  },
};
