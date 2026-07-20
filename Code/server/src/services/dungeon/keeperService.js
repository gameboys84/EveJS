const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const dungeonUniverseSiteService = require(path.join(
  __dirname,
  "./dungeonUniverseSiteService",
));
const dungeonTrackingRuntime = require(path.join(
  __dirname,
  "./dungeonTrackingRuntime",
));
const operationSiteRuntime = require(path.join(
  __dirname,
  "./operationSiteRuntime",
));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  ITEM_FLAGS,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  matchesTypeList,
} = require(path.join(__dirname, "../inventory/typeListAuthority"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

const DEFAULT_ACCELERATION_GATE_ACTIVATION_RANGE_METERS = 2_500;
const ROOM_ENTRY_BASE_DISTANCE_METERS = 1_000_000;
const ROOM_ENTRY_DISTANCE_STEP_METERS = 400_000;
const ROOM_ENTRY_VERTICAL_STEP_METERS = 10_000;
const DUNGEON_KEYLOCK_UNLOCKED = 0;
const DUNGEON_KEYLOCK_PRIVATE = 1;
const DUNGEON_KEYLOCK_PUBLIC = 2;
const DUNGEON_KEYLOCK_TRIGGER = 3;
const ACCELERATION_GATE_BLACKLISTED_GROUP_IDS = new Set([
  29, // Capsule
  30, // Titan
  485, // Dreadnought
  513, // Freighter
  547, // Carrier
  659, // Supercarrier
  883, // Capital Industrial Ship
  902, // Jump Freighter
  1538, // Force Auxiliary
  4594, // Lancer Dreadnought
  5120, // Command Carrier
]);
const auditEvents = [];

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function isWarpingEntity(entity) {
  return Boolean(
    entity &&
      (
        entity.pendingWarp ||
        entity.warpState ||
        normalizeText(entity.mode, "").toUpperCase() === "WARP"
      ),
  );
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getCharacterID(session) {
  return Math.max(
    0,
    toInt(
      session && (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
      0,
    ),
  );
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, kwargs = null, extra = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    kwargs: kwargs || null,
    characterID: getCharacterID(session) || null,
    ...extra,
    timestamp: Date.now(),
  });
}

function clonePosition(value) {
  return {
    x: toFiniteNumber(value && value.x, 0),
    y: toFiniteNumber(value && value.y, 0),
    z: toFiniteNumber(value && value.z, 0),
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
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  return Math.sqrt((x * x) + (y * y) + (z * z));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (length <= 0.000001) {
    return clonePosition(fallback);
  }
  return scaleVector(vector, 1 / length);
}

function buildOperationSpawnpointKey(characterID, siteID) {
  return operationSiteRuntime.buildOperationSpawnpointKey(characterID, siteID);
}

function resolveOperationSiteArgs(args, session) {
  return operationSiteRuntime.resolveOperationSiteArgs(args, session);
}

function normalizeOperationSpawnpointRecord(record) {
  return operationSiteRuntime.normalizeOperationSpawnpointRecord(record);
}

function registerOperationSpawnpointRecord(record) {
  return operationSiteRuntime.registerOperationSpawnpointRecord(record);
}

function resolveOperationSpawnpointRecord(characterID, siteID) {
  return operationSiteRuntime.resolveOperationSpawnpointRecord(characterID, siteID);
}

function clearOperationSpawnpointRecords() {
  operationSiteRuntime.clearOperationSpawnpointRecords();
}

function resolveCurrentTrackedSiteID(scene, session) {
  const current = dungeonTrackingRuntime.resolveTrackedDungeonForSession(scene, session);
  const shipEntity = current && current.shipEntity;
  return Math.max(0, toInt(shipEntity && shipEntity.dungeonCurrentSiteID, 0));
}

function isSessionInOperationSite(session, record) {
  if (!record || record.isOperationSite === false) {
    return false;
  }
  if (session && (session.stationid || session.structureid)) {
    return false;
  }
  const scene = spaceRuntime.getSceneForSession(session);
  if (
    record.solarSystemID &&
    Math.max(0, toInt(scene && scene.systemID, toInt(session && session.solarsystemid2, 0))) !==
      record.solarSystemID
  ) {
    return false;
  }
  return resolveCurrentTrackedSiteID(scene, session) === record.siteID;
}

function resolveSceneEntity(scene, entityOrID) {
  if (!scene) {
    return null;
  }
  if (entityOrID && typeof entityOrID === "object") {
    return entityOrID;
  }
  const numericEntityID = Math.max(0, toInt(entityOrID, 0));
  if (numericEntityID <= 0) {
    return null;
  }
  if (typeof scene.getEntityByID === "function") {
    const entity = scene.getEntityByID(numericEntityID);
    if (entity) {
      return entity;
    }
  }
  if (scene.staticEntitiesByID && typeof scene.staticEntitiesByID.get === "function") {
    return scene.staticEntitiesByID.get(numericEntityID) || null;
  }
  return null;
}

function resolveOrderedRoomKeys(instance, template) {
  const sceneProfile =
    template &&
    template.siteSceneProfile &&
    typeof template.siteSceneProfile === "object"
      ? template.siteSceneProfile
      : {};
  const roomProfiles = Array.isArray(sceneProfile.roomProfiles)
    ? sceneProfile.roomProfiles
    : [];
  const roomKeys = roomProfiles
    .map((entry) => normalizeText(entry && entry.roomKey, ""))
    .filter(Boolean);
  if (roomKeys.length > 0) {
    return roomKeys;
  }
  const roomStatesByKey =
    instance &&
    instance.roomStatesByKey &&
    typeof instance.roomStatesByKey === "object"
      ? instance.roomStatesByKey
      : {};
  const dynamicRoomKeys = Object.keys(roomStatesByKey)
    .filter((roomKey) => roomKey && roomKey !== "room:entry")
    .sort((left, right) => (
      toInt(left.split(":").pop(), 0) - toInt(right.split(":").pop(), 0)
    ) || left.localeCompare(right));
  return ["room:entry", ...dynamicRoomKeys];
}

function resolveTemplateSceneProfile(template) {
  return (
    template &&
    template.siteSceneProfile &&
    typeof template.siteSceneProfile === "object"
      ? template.siteSceneProfile
      : {}
  );
}

function cloneRoomProfilePosition(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return {
      x: toFiniteNumber(value[0], 0),
      y: toFiniteNumber(value[1], 0),
      z: toFiniteNumber(value[2], 0),
    };
  }
  if (value && typeof value === "object") {
    return clonePosition(value);
  }
  return null;
}

function findTemplateRoomProfile(sceneProfile, roomKey) {
  const normalizedRoomKey = normalizeText(roomKey, "");
  if (!normalizedRoomKey || !Array.isArray(sceneProfile && sceneProfile.roomProfiles)) {
    return null;
  }
  return sceneProfile.roomProfiles.find((roomProfile) => (
    normalizeText(roomProfile && roomProfile.roomKey, "") === normalizedRoomKey
  )) || null;
}

function findTemplateGateProfile(sceneProfile, gateEntity) {
  if (!Array.isArray(sceneProfile && sceneProfile.gateProfiles)) {
    return null;
  }
  const gateKey = normalizeText(gateEntity && gateEntity.dungeonGateKey, "");
  const dungeonObjectID = Math.max(
    0,
    toInt(
      gateEntity && (
        gateEntity.dungeonObjectID ||
        gateEntity.dunObjectID
      ),
      0,
    ),
  );
  return sceneProfile.gateProfiles.find((gateProfile) => {
    if (!gateProfile || typeof gateProfile !== "object") {
      return false;
    }
    if (gateKey && normalizeText(gateProfile.gateKey, "") === gateKey) {
      return true;
    }
    const profileObjectID = Math.max(
      0,
      toInt(gateProfile.dunObjectID || gateProfile.fromObjectID, 0),
    );
    return dungeonObjectID > 0 && profileObjectID === dungeonObjectID;
  }) || null;
}

function resolveExactGateDestinationPoint(sitePosition, gateEntity, template, destinationRoomKey) {
  const sceneProfile = resolveTemplateSceneProfile(template);
  const gateProfile = findTemplateGateProfile(sceneProfile, gateEntity);
  const sourceRoomKey = normalizeText(
    gateEntity && gateEntity.dungeonGateSourceRoomKey,
    normalizeText(gateProfile && gateProfile.roomKey, ""),
  );
  const sourceRoom = findTemplateRoomProfile(sceneProfile, sourceRoomKey);
  const destinationRoom = findTemplateRoomProfile(sceneProfile, destinationRoomKey);
  const sourcePosition = cloneRoomProfilePosition(sourceRoom && sourceRoom.position);
  const destinationPosition = cloneRoomProfilePosition(destinationRoom && destinationRoom.position);
  if (!sourcePosition || !destinationPosition) {
    return null;
  }
  const roomOffset = subtractVectors(destinationPosition, sourcePosition);
  if (magnitude(roomOffset) <= 0.000001) {
    return null;
  }
  return addVectors(sitePosition, roomOffset);
}

function resolveGateDestinationPoint(siteEntity, gateEntity, instance, template, destinationRoomKey) {
  const sitePosition = clonePosition(
    (siteEntity && siteEntity.position) ||
    (gateEntity && gateEntity.position),
  );
  const exactDestinationPoint = resolveExactGateDestinationPoint(
    sitePosition,
    gateEntity,
    template,
    destinationRoomKey,
  );
  if (exactDestinationPoint) {
    return exactDestinationPoint;
  }
  const gatePosition = clonePosition(gateEntity && gateEntity.position);
  const orderedRoomKeys = resolveOrderedRoomKeys(instance, template);
  const roomIndex = Math.max(0, orderedRoomKeys.findIndex((roomKey) => roomKey === destinationRoomKey));
  const radialDirection = normalizeVector(
    subtractVectors(gatePosition, sitePosition),
    { x: 1, y: 0, z: 0 },
  );
  const baseDistance =
    ROOM_ENTRY_BASE_DISTANCE_METERS +
    (Math.max(0, roomIndex - 1) * ROOM_ENTRY_DISTANCE_STEP_METERS);
  return addVectors(sitePosition, {
    x: radialDirection.x * baseDistance,
    y: (roomIndex % 2 === 0 ? 1 : -1) * ROOM_ENTRY_VERTICAL_STEP_METERS * roomIndex,
    z: radialDirection.z * baseDistance,
  });
}

function resolveGateActivationRange(gateEntity) {
  return (
    toFiniteNumber(gateEntity && gateEntity.gateActivationRange, 0) ||
    DEFAULT_ACCELERATION_GATE_ACTIVATION_RANGE_METERS
  );
}

function resolveGateInteractionLimit(gateEntity, shipEntity) {
  return Math.max(
    DEFAULT_ACCELERATION_GATE_ACTIVATION_RANGE_METERS,
    toFiniteNumber(gateEntity && gateEntity.radius, 0) +
      toFiniteNumber(shipEntity && shipEntity.radius, 0) +
      resolveGateActivationRange(gateEntity),
  );
}

function normalizeIDSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Math.max(0, toInt(value, 0)))
      .filter((value) => value > 0),
  );
}

function resolveShipTypeContext(shipEntity) {
  const typeID = Math.max(0, toInt(
    shipEntity && (shipEntity.slimTypeID || shipEntity.typeID),
    0,
  ));
  const typeRecord = typeID > 0 ? resolveItemByTypeID(typeID) : null;
  return {
    typeID,
    groupID: Math.max(0, toInt(
      shipEntity && (shipEntity.slimGroupID || shipEntity.groupID),
      typeRecord && typeRecord.groupID,
    )),
    categoryID: Math.max(0, toInt(
      shipEntity && (shipEntity.slimCategoryID || shipEntity.categoryID),
      typeRecord && typeRecord.categoryID,
    )),
    raceID: Math.max(0, toInt(
      shipEntity && shipEntity.raceID,
      typeRecord && typeRecord.raceID,
    )),
  };
}

function resolveGateAllowedShipsList(gateEntity, gateState) {
  return Math.max(
    0,
    toInt(
      gateEntity && gateEntity.dungeonGateAllowedShipsList,
      gateState &&
        gateState.metadata &&
        gateState.metadata.allowedShipsList,
    ),
  );
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = normalizeLowerText(value, "");
  if (["true", "yes", "1", "consume", "consumed"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0", "keep", "kept"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeGateKeyLock(value) {
  const numeric = toInt(value, Number.NaN);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 3) {
    return numeric;
  }
  const normalized = normalizeLowerText(value, "");
  if (["unlocked", "none", "open", "0"].includes(normalized)) {
    return DUNGEON_KEYLOCK_UNLOCKED;
  }
  if (["private", "key", "keyitem", "key_item", "1"].includes(normalized)) {
    return DUNGEON_KEYLOCK_PRIVATE;
  }
  if (["public", "shared", "global", "2"].includes(normalized)) {
    return DUNGEON_KEYLOCK_PUBLIC;
  }
  if (["trigger", "objective", "script", "3"].includes(normalized)) {
    return DUNGEON_KEYLOCK_TRIGGER;
  }
  return null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function listGateRequirementSources(gateEntity, gateState) {
  const metadata = normalizeObject(gateState && gateState.metadata);
  const rawConnection = normalizeObject(metadata.rawConnection);
  return [
    normalizeObject(gateEntity),
    normalizeObject(gateState),
    metadata,
    rawConnection,
  ];
}

function resolveGateKeyLock(gateEntity, gateState) {
  for (const source of listGateRequirementSources(gateEntity, gateState)) {
    const keyLock = normalizeGateKeyLock(firstDefined(
      source.dungeonGateKeyLock,
      source.keyLock,
      source.keylock,
      source.keylockType,
      source.keyLockType,
      source.dungeonKeylock,
      source.dungeonKeyLock,
    ));
    if (keyLock !== null) {
      return keyLock;
    }
  }
  return null;
}

function normalizeRequiredItemEntry(value, defaults = {}) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    const typeID = Math.max(0, toInt(value, 0));
    return typeID > 0
      ? {
          typeID,
          quantity: Math.max(1, toInt(defaults.quantity, 1)),
          consume: normalizeBoolean(defaults.consume, false),
        }
      : null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const typeID = Math.max(0, toInt(firstDefined(
    value.typeID,
    value.itemTypeID,
    value.requiredTypeID,
    value.requiredItemTypeID,
    value.requiredKeyTypeID,
    value.keyTypeID,
    value.keyItemTypeID,
    value.passcardTypeID,
  ), 0));
  if (typeID <= 0) {
    return null;
  }
  return {
    typeID,
    quantity: Math.max(1, toInt(firstDefined(
      value.quantity,
      value.qty,
      value.amount,
      value.requiredQuantity,
      value.keyQuantity,
      value.passcardQuantity,
      defaults.quantity,
    ), 1)),
    consume: normalizeBoolean(firstDefined(
      value.consume,
      value.consumed,
      value.consumeKey,
      value.consumeItem,
      defaults.consume,
    ), false),
  };
}

function addRequiredItemFromValue(requirements, value, defaults = {}) {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      addRequiredItemFromValue(requirements, entry, defaults);
    }
    return;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const directEntry = normalizeRequiredItemEntry(value, defaults);
    if (directEntry) {
      requirements.push(directEntry);
      return;
    }
    for (const [typeID, quantity] of Object.entries(value)) {
      const entry = normalizeRequiredItemEntry(typeID, {
        ...defaults,
        quantity,
      });
      if (entry) {
        requirements.push(entry);
      }
    }
    return;
  }
  const entry = normalizeRequiredItemEntry(value, defaults);
  if (entry) {
    requirements.push(entry);
  }
}

function resolveGateRequiredItems(gateEntity, gateState) {
  const requirements = [];
  for (const source of listGateRequirementSources(gateEntity, gateState)) {
    const defaultQuantity = firstDefined(
      source.dungeonGateRequiredItemQuantity,
      source.requiredItemQuantity,
      source.requiredQuantity,
      source.keyQuantity,
      source.passcardQuantity,
      1,
    );
    const defaultConsume = firstDefined(
      source.dungeonGateConsumesRequiredItems,
      source.consumeRequiredItems,
      source.consumeRequiredItem,
      source.consumeKey,
      source.consumeItem,
      false,
    );
    for (const directTypeID of [
      source.dungeonGateRequiredItemTypeID,
      source.requiredItemTypeID,
      source.requiredKeyTypeID,
      source.keyTypeID,
      source.keyItemTypeID,
      source.passcardTypeID,
    ]) {
      addRequiredItemFromValue(requirements, directTypeID, {
        quantity: defaultQuantity,
        consume: defaultConsume,
      });
    }
    for (const itemList of [
      source.dungeonGateRequiredItems,
      source.requiredItems,
      source.requiredKeyItems,
      source.keyItems,
      source.requiredItemTypeIDs,
      source.requiredKeyTypeIDs,
      source.keyTypeIDs,
      source.passcardTypeIDs,
    ]) {
      addRequiredItemFromValue(requirements, itemList, {
        quantity: defaultQuantity,
        consume: defaultConsume,
      });
    }
  }

  const merged = new Map();
  for (const requirement of requirements) {
    const existing = merged.get(requirement.typeID) || {
      typeID: requirement.typeID,
      quantity: 0,
      consume: false,
    };
    existing.quantity = Math.max(existing.quantity, requirement.quantity);
    existing.consume = existing.consume || requirement.consume;
    merged.set(requirement.typeID, existing);
  }
  return Array.from(merged.values());
}

function resolveGateItemRequirement(gateEntity, gateState) {
  const requiredItems = resolveGateRequiredItems(gateEntity, gateState);
  const keyLock = resolveGateKeyLock(gateEntity, gateState);
  return {
    keyLock: keyLock === null && requiredItems.length > 0
      ? DUNGEON_KEYLOCK_PRIVATE
      : keyLock,
    requiredItems,
  };
}

function getCargoItemsForGateRequirement(session, shipEntity, options = {}) {
  if (Array.isArray(options.cargoItems)) {
    return options.cargoItems;
  }
  const shipID = Math.max(0, toInt(shipEntity && shipEntity.itemID, toInt(session && session.shipID, 0)));
  if (shipID <= 0) {
    return [];
  }
  const characterID = Math.max(0, toInt(session && (session.characterID || session.charid), 0));
  const ownedCargo = characterID > 0
    ? listContainerItems(characterID, shipID, ITEM_FLAGS.CARGO_HOLD)
    : [];
  return ownedCargo.length > 0
    ? ownedCargo
    : listContainerItems(null, shipID, ITEM_FLAGS.CARGO_HOLD);
}

function getCargoTypeQuantity(cargoItems, typeID) {
  const requiredTypeID = Math.max(0, toInt(typeID, 0));
  if (requiredTypeID <= 0) {
    return 0;
  }
  return (Array.isArray(cargoItems) ? cargoItems : [])
    .filter((item) => Math.max(0, toInt(item && item.typeID, 0)) === requiredTypeID)
    .reduce((sum, item) => {
      const singleton = Math.max(0, toInt(item && item.singleton, 0));
      return sum + (
        singleton === 1
          ? 1
          : Math.max(0, toInt(item && (item.stacksize ?? item.quantity), 0))
      );
    }, 0);
}

function formatRequiredItem(requirement) {
  const typeID = Math.max(0, toInt(requirement && requirement.typeID, 0));
  const typeRecord = typeID > 0 ? resolveItemByTypeID(typeID) : null;
  const itemName = normalizeText(
    typeRecord && (typeRecord.typeName || typeRecord.name || typeRecord.itemName),
    typeID > 0 ? `type ${typeID}` : "the required key item",
  );
  const quantity = Math.max(1, toInt(requirement && requirement.quantity, 1));
  return quantity > 1 ? `${itemName} x${quantity}` : itemName;
}

function assertGateItemRequirements(session, shipEntity, gateEntity, gateState, options = {}) {
  const requirement = resolveGateItemRequirement(gateEntity, gateState);
  if (requirement.requiredItems.length <= 0) {
    return requirement;
  }
  const cargoItems = getCargoItemsForGateRequirement(session, shipEntity, options);
  const missing = requirement.requiredItems.filter((entry) => (
    getCargoTypeQuantity(cargoItems, entry.typeID) < Math.max(1, toInt(entry.quantity, 1))
  ));
  if (missing.length > 0) {
    const requiredText = missing.map(formatRequiredItem).join(", ");
    throwWrappedUserError("CustomInfo", {
      info: `The acceleration gate requires ${requiredText}.`,
    });
  }
  return requirement;
}

function assertShipMayUseGate(shipEntity, gateEntity, gateState) {
  const shipContext = resolveShipTypeContext(shipEntity);
  const allowedShipTypeIDs = normalizeIDSet(gateState && gateState.allowedShipTypeIDs);
  const allowedShipGroupIDs = normalizeIDSet(gateState && gateState.allowedShipGroupIDs);
  const allowedShipsList = resolveGateAllowedShipsList(gateEntity, gateState);
  const allowedRaces = normalizeIDSet(
    gateState && gateState.metadata && gateState.metadata.allowedRaces,
  );
  const hasExplicitTypeOrGroupRestriction =
    allowedShipTypeIDs.size > 0 ||
    allowedShipGroupIDs.size > 0;
  const hasNonDefaultRestriction =
    hasExplicitTypeOrGroupRestriction ||
    allowedShipsList > 0 ||
    allowedRaces.size > 0;

  if (
    hasExplicitTypeOrGroupRestriction &&
    !allowedShipTypeIDs.has(shipContext.typeID) &&
    !allowedShipGroupIDs.has(shipContext.groupID)
  ) {
    throwWrappedUserError("DunShipCannotWarp");
  }

  if (allowedShipsList > 0 && !matchesTypeList(shipContext, allowedShipsList)) {
    throwWrappedUserError("DunShipCannotWarp");
  }

  if (allowedRaces.size > 0 && !allowedRaces.has(shipContext.raceID)) {
    throwWrappedUserError("DunShipCannotWarp");
  }

  if (
    !hasNonDefaultRestriction &&
    ACCELERATION_GATE_BLACKLISTED_GROUP_IDS.has(shipContext.groupID)
  ) {
    throwWrappedUserError("DunBlacklistCannotWarp");
  }
}

function activateAccelerationGateForSession(session, gateEntityOrID, options = {}) {
  const scene = spaceRuntime.getSceneForSession(session);
  if (!scene) {
    throwWrappedUserError("DeniedShipChanged");
  }

  const gateEntity = resolveSceneEntity(scene, gateEntityOrID);
  if (!(gateEntity && gateEntity.dungeonMaterializedGate === true)) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  const shipEntity =
    typeof scene.getShipEntityForSession === "function"
      ? scene.getShipEntityForSession(session)
      : null;
  if (!shipEntity) {
    throwWrappedUserError("DeniedShipChanged");
  }
  if (isWarpingEntity(shipEntity)) {
    throwWrappedUserError("ShipInWarp");
  }

  const separation = magnitude(subtractVectors(shipEntity.position, gateEntity.position));
  if (separation > resolveGateInteractionLimit(gateEntity, shipEntity)) {
    throwWrappedUserError("TargetTooFar");
  }

  const instanceID = Math.max(0, toInt(gateEntity.dungeonSiteInstanceID, 0));
  const siteID = Math.max(0, toInt(gateEntity.dungeonSiteID, 0));
  const gateKey = normalizeText(gateEntity.dungeonGateKey, "");
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  if (instanceID <= 0 || siteID <= 0 || !gateKey) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, {
    instanceID,
    siteID,
  }, {
    broadcast: true,
    spawnEncounters: true,
    session,
    markCurrentDungeonRoom: true,
    nowMs,
  });

  let instance = dungeonRuntime.ensureTemplateRuntimeState(instanceID, { nowMs });
  if (!instance) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }
  let gateState =
    instance.gateStatesByKey &&
    typeof instance.gateStatesByKey === "object"
      ? instance.gateStatesByKey[gateKey]
      : null;
  if (!gateState) {
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }

  const itemRequirement = resolveGateItemRequirement(gateEntity, gateState);
  const lockedByState = normalizeLowerText(gateState.state, "locked") === "locked";
  if (lockedByState && itemRequirement.requiredItems.length <= 0) {
    throwWrappedUserError("CustomInfo", {
      info: "The acceleration gate is locked.",
    });
  }
  assertGateItemRequirements(session, shipEntity, gateEntity, gateState, options);
  if (
    lockedByState &&
    itemRequirement.keyLock === DUNGEON_KEYLOCK_PUBLIC &&
    typeof dungeonRuntime.unlockGate === "function"
  ) {
    instance = dungeonRuntime.unlockGate(instance.instanceID, gateKey, {
      nowMs,
    });
    gateState =
      instance &&
      instance.gateStatesByKey &&
      typeof instance.gateStatesByKey === "object"
        ? instance.gateStatesByKey[gateKey] || gateState
        : gateState;
  }
  assertShipMayUseGate(shipEntity, gateEntity, gateState);

  const destinationRoomKey =
    normalizeText(
      gateEntity.dungeonGateDestinationRoomKey,
      normalizeText(gateState.destinationRoomKey, ""),
    ) || null;
  const siteEntity = resolveSceneEntity(scene, siteID);
  const template = dungeonAuthority.getTemplateByID(instance.templateID) || null;
  const destinationPoint = resolveGateDestinationPoint(
    siteEntity,
    gateEntity,
    instance,
    template,
    destinationRoomKey,
  );
  const teleportDirection = normalizeVector(
    subtractVectors(destinationPoint, gateEntity.position),
    shipEntity.direction || { x: 1, y: 0, z: 0 },
  );
  // Warp the pilot to the destination room through the standard pilot warp path so the client
  // plays the real "warp drive active" sequence (WarpTo destiny + OnSpecialFX effects.Warping),
  // matching retail acceleration gates (observed in TQ logs as a genuine short warp, not a
  // teleport). Fall back to the forced sessionless warp if the pilot warp can't run (e.g. the
  // destination is within minimum warp distance), preserving the previously working behavior.
  let warpResult = null;
  let pilotWarpError = "";
  if (
    typeof spaceRuntime.warpToPoint === "function" &&
    typeof scene.warpToPoint === "function"
  ) {
    try {
      warpResult = spaceRuntime.warpToPoint(session, destinationPoint, {
        minimumRange: 0,
        stopDistance: 0,
      });
    } catch (error) {
      pilotWarpError = normalizeText(error && error.message, "THREW");
      log.warn(
        `[Keeper] ActivateAccelerationGate pilot warp threw char=${getCharacterID(session)} gate=${gateKey} instance=${instanceID} ` +
          `destinationRoom=${destinationRoomKey || "room:entry"} error=${pilotWarpError}`,
      );
      warpResult = null;
    }
  }
  if (!warpResult || warpResult.success !== true) {
    pilotWarpError = pilotWarpError || normalizeText(warpResult && warpResult.errorMsg, "");
    warpResult = spaceRuntime.warpDynamicEntityToPoint(
      scene.systemID,
      shipEntity,
      destinationPoint,
      {
        direction: teleportDirection,
        forceImmediateStart: true,
      },
    );
    if (!warpResult || warpResult.success !== true) {
      log.warn(
        `[Keeper] ActivateAccelerationGate movement failed char=${getCharacterID(session)} gate=${gateKey} instance=${instanceID} ` +
          `destinationRoom=${destinationRoomKey || "room:entry"} pilotWarp=${pilotWarpError || "not-attempted"} ` +
          `fallback=${normalizeText(warpResult && warpResult.errorMsg, "UNKNOWN_ERROR")}`,
      );
      throwWrappedUserError("DeniedTargetAttemptFailed");
    }
    const forceStartResult = spaceRuntime.forceStartPendingWarp(scene.systemID, shipEntity, {
      clearVisibilitySuppression: true,
    });
    if (!forceStartResult || forceStartResult.success !== true) {
      log.warn(
        `[Keeper] ActivateAccelerationGate force-start failed char=${getCharacterID(session)} gate=${gateKey} instance=${instanceID} ` +
          `destinationRoom=${destinationRoomKey || "room:entry"} error=${normalizeText(forceStartResult && forceStartResult.errorMsg, "UNKNOWN_ERROR")}`,
      );
      throwWrappedUserError("DeniedTargetAttemptFailed");
    }
  }

  if (
    destinationRoomKey &&
    instance.roomStatesByKey &&
    instance.roomStatesByKey[destinationRoomKey] &&
    normalizeLowerText(instance.roomStatesByKey[destinationRoomKey].state, "pending") === "pending"
  ) {
    instance = dungeonRuntime.activateRoom(instance.instanceID, destinationRoomKey, {
      nowMs,
      stage: destinationRoomKey === "room:entry" ? "entry" : "pocket",
    });
  }

  instance = dungeonRuntime.recordGateUse(instance.instanceID, gateKey, {
    nowMs,
    destinationRoomKey,
  });

  dungeonTrackingRuntime.enterDungeonRoomForSession(
    scene,
    session,
    instance,
    destinationRoomKey || "room:entry",
    {
      forceNotify: true,
      nowMs,
      roomPosition: destinationPoint,
      siteID,
    },
  );

  if (destinationRoomKey && typeof dungeonUniverseSiteService.triggerSiteEncounter === "function") {
    dungeonUniverseSiteService.triggerSiteEncounter(scene, instance, "on_room_active", {
      nowMs,
      roomKey: destinationRoomKey,
      // Spawn the destination room's encounters where the gate drops the player, not at the
      // landing beacon, so the player arrives among the rats instead of 1000km away from them.
      roomPosition: destinationPoint,
      session,
    });
  }

  if (typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function") {
    scene.flushDirectDestinyNotificationBatchIfIdle();
  }

  log.info(
    `[Keeper] ActivateAccelerationGate char=${session && session.characterID} gate=${gateKey} instance=${instanceID} destinationRoom=${destinationRoomKey || "room:entry"}`,
  );
  return null;
}

class KeeperService extends BaseService {
  constructor() {
    super("keeper");
  }

  Handle_GetCurrentDungeonForCharacter(args, session) {
    const scene = spaceRuntime.getSceneForSession(session);
    return dungeonTrackingRuntime.resolveCurrentDungeonInfoForSession(scene, session);
  }

  Handle_ActivateAccelerationGate(args, session) {
    const gateEntityID = args && args.length > 0 ? args[0] : null;
    return activateAccelerationGateForSession(session, gateEntityID);
  }

  Handle_GetLevelEditor(args, session, kwargs) {
    recordAuditEvent("get_level_editor_disabled", args, session, kwargs);
    log.debug("[Keeper] GetLevelEditor requested; level editor runtime is not enabled");
    return null;
  }

  Handle_GetOperationSpawnpointSolarSystem(args, session, kwargs) {
    const { characterID, siteID } = resolveOperationSiteArgs(args, session);
    const record = resolveOperationSpawnpointRecord(characterID, siteID);
    recordAuditEvent("get_operation_spawnpoint_solar_system", args, session, kwargs, {
      requestedCharacterID: characterID || null,
      siteID: siteID || null,
      found: Boolean(record && record.solarSystemID),
    });
    return record && record.solarSystemID ? record.solarSystemID : null;
  }

  Handle_GetOperationSpawnpointPosition(args, session, kwargs) {
    const { characterID, siteID } = resolveOperationSiteArgs(args, session);
    const record = resolveOperationSpawnpointRecord(characterID, siteID);
    recordAuditEvent("get_operation_spawnpoint_position", args, session, kwargs, {
      requestedCharacterID: characterID || null,
      siteID: siteID || null,
      found: Boolean(record && record.solarSystemID),
    });
    if (!record || !record.solarSystemID) {
      return [null, null, 0, 0, 0];
    }
    return [
      record.solarSystemID,
      record.spawnID,
      record.position.x,
      record.position.y,
      record.position.z,
    ];
  }

  Handle_IsOperationSite(args, session, kwargs) {
    const { characterID, siteID } = resolveOperationSiteArgs(args, session);
    const record = resolveOperationSpawnpointRecord(characterID, siteID);
    const inSite = isSessionInOperationSite(session, record);
    recordAuditEvent("is_operation_site", args, session, kwargs, {
      requestedCharacterID: characterID || null,
      siteID: siteID || null,
      found: Boolean(record),
      inSite,
    });
    return inSite;
  }
}

KeeperService._testing = {
  assertGateItemRequirements,
  activateAccelerationGateForSession,
  clearOperationSpawnpointRecords,
  getAuditEvents() {
    return auditEvents.slice();
  },
  registerOperationSpawnpointRecord,
  resetSafeStateForTests() {
    auditEvents.length = 0;
    clearOperationSpawnpointRecords();
  },
  resolveGateItemRequirement,
  resolveGateDestinationPoint,
  resolveOrderedRoomKeys,
  resolveOperationSpawnpointRecord,
  resolveCurrentDungeonInfoForSession:
    dungeonTrackingRuntime.resolveCurrentDungeonInfoForSession,
};

module.exports = KeeperService;
