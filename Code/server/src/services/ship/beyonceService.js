const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  buildBoundObjectResponse,
  extractDictEntries,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const mobileAnalysisBeaconRuntime = require(path.join(__dirname, "./mobileAnalysisBeaconRuntime"));
const mobileMicroJumpUnitRuntime = require(path.join(__dirname, "./mobileMicroJumpUnitRuntime"));
const mobileSiphonUnitRuntime = require(path.join(__dirname, "./mobileSiphonUnitRuntime"));
const {
  jumpSessionViaStargate,
  jumpSessionToSolarSystem,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  consumeFuelFromShipStorage,
} = require(path.join(__dirname, "../../space/modules/sharedFuelRuntime"));
const {
  getActiveShipRecord,
  findCharacterShip,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildEffectiveItemAttributeMap,
  buildShipResourceState,
  getTypeDogmaAttributes,
  isEffectivelyOnlineModule,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  buildConduitPassengerPlans,
  executeConduitPassengerJumps,
  resolveConduitJumpActivation,
} = require(path.join(__dirname, "../_shared/conduitJumpRuntime"));
const {
  applyJumpTimersBestEffort,
  hasActiveJumpActivation,
  resolveJumpFatigueMultiplier,
} = require(path.join(__dirname, "../_shared/jumpTimerRuntime"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  flushPendingCommandSessionEffects,
} = require(path.join(__dirname, "../chat/commandSessionEffects"));
const {
  getCynoJammerOnlineSimTime,
  isSolarSystemCynoJammed,
} = require(path.join(__dirname, "../sovereignty/sovSuppressionState"));
const {
  TYPE_PHAROLUX_CYNO_BEACON,
} = require(path.join(__dirname, "../sovereignty/sovUpgradeSupport"));
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));
const {
  resolveFormationSettings,
  computeFleetWarpFormationPoints,
} = require(path.join(__dirname, "../../space/movement/warp/fleetWarpFormation"));
const structureState = require(path.join(__dirname, "../structure/structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "../structure/structureConstants"));
const planetRuntimeStore = require(path.join(__dirname, "../planet/planetRuntimeStore"));
const bookmarkRuntime = require(path.join(__dirname, "../bookmark/bookmarkRuntimeState"));
const bookmarkNotifications = require(path.join(__dirname, "../bookmark/bookmarkNotifications"));
const {
  buildBookmarkReplyTuple,
} = require(path.join(__dirname, "../bookmark/bookmarkPayloads"));
const {
  resolveLocationBookmarkTarget,
} = require(path.join(__dirname, "../bookmark/bookmarkTargetResolver"));
const {
  ROLEMASK_VIEW,
  normalizeRoleValue,
} = require(path.join(__dirname, "../account/accountRoleProfiles"));
const signatureRuntime = require(path.join(
  __dirname,
  "../exploration/signatures/signatureRuntime",
));
const dungeonRuntime = require(path.join(
  __dirname,
  "../dungeon/dungeonRuntime",
));
const operationSiteRuntime = require(path.join(
  __dirname,
  "../dungeon/operationSiteRuntime",
));
const USER_ERROR_LOCALIZATION_LABEL = 101;
const STARGATE_CLOSED_LABEL = "UI/GateIcons/GateClosed";
const STARGATE_TOO_FAR_LABEL = "UI/Menusvc/MenuHints/NotWithingMaxJumpDist";
const CRIMEWATCH_WARP_BLOCKED_MESSAGE = "Warp is disabled while the criminal timer is active.";
const SHIP_IMMOBILE_WARP_BLOCKED_MESSAGE =
  "Your ship cannot warp while an active module is preventing movement.";
const SHARED_BOOKMARK_DELAY_MS = 2 * 60 * 1000;
const DUNGEON_INSTANCE_WARP_SUBJECTS = Object.freeze(new Set([
  "epinstance",
  "externalDungeon",
]));
const WARP_SUBJECT_OPERATION_DUNGEON = "operationDungeon";
const LIGHT_YEAR_METERS = 9460730472580800;
const CYNO_BEACON_ARRIVAL_CLEARANCE_METERS = 12000;
const ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE = 866;
const ATTRIBUTE_JUMP_DRIVE_RANGE = 867;
const ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT = 868;
const ATTRIBUTE_JUMP_PORTAL_CONSUMPTION_MASS_FACTOR = 1001;
const ATTRIBUTE_JUMP_PORTAL_ADDITIONAL_CONSUMPTION = 2793;
const ATTRIBUTE_JUMP_PORTAL_PASSENGER_REQUIRED_ATTRIBUTE_ID = 3318;
const ATTRIBUTE_IS_TITAN_JUMP_PORTAL_PASSENGER = 3319;
const ATTRIBUTE_IS_BLACKOPS_JUMP_PORTAL_PASSENGER = 3320;
const ATTRIBUTE_IS_INDUSTRIAL_JUMP_PORTAL_PASSENGER = 3325;
const ATTRIBUTE_USES_COVERT_CYNO = 1252;
const ATTRIBUTE_USES_INDUSTRIAL_CYNO = 2826;
const ATTRIBUTE_MASS = 4;
const FLEET_BRIDGE_ACTIVATION_RANGE_METERS = 2500;
const MOVEMENT_COMMAND_THROTTLE_MS = 1000;
const EVE_TIME_TICKS_PER_MS = 10000;
const TYPE_JUMP_PORTAL_GENERATOR = 23953;
const TYPE_COVERT_JUMP_PORTAL_GENERATOR = 28652;
const TYPE_INDUSTRIAL_JUMP_PORTAL_GENERATOR = 63140;
const TYPE_CYNOSURAL_FIELD = 21094;
const TYPE_COVERT_CYNOSURAL_FIELD = 28650;
const TYPE_INDUSTRIAL_CYNOSURAL_FIELD = 52696;
const TYPE_MOBILE_CYNOSURAL_BEACON = 57319;
const TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON = 58906;
const TYPE_COVERT_MOBILE_CYNOSURAL_BEACON = 59630;
const TYPE_MOBILE_CYNOSURAL_FIELD = 59631;
const JUMP_PORTAL_EFFECT_STANDARD = "jumpPortalGeneration";
const JUMP_PORTAL_EFFECT_COVERT = "jumpPortalGenerationBO";
const MOBILE_CYNOSURAL_BEACON_TYPES = Object.freeze(new Set([
  TYPE_MOBILE_CYNOSURAL_BEACON,
  TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON,
  TYPE_COVERT_MOBILE_CYNOSURAL_BEACON,
]));
const JUMP_PORTAL_MASS_FACTOR_BY_TYPE_ID = Object.freeze({
  [TYPE_JUMP_PORTAL_GENERATOR]: 1.5e-9,
  [TYPE_COVERT_JUMP_PORTAL_GENERATOR]: 2e-7,
  [TYPE_INDUSTRIAL_JUMP_PORTAL_GENERATOR]: 1e-9,
});

function getKwargValue(kwargs, key) {
  const entries = extractDictEntries(kwargs);
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  if (match) {
    return match[1];
  }

  // Real client calls arrive as a marshaled dict ({ type: "dict", entries }),
  // handled above. Internal/test callers sometimes pass a plain object, so fall
  // back to a direct property lookup the same way machoNet's getKwarg does.
  if (
    kwargs &&
    typeof kwargs === "object" &&
    !Array.isArray(kwargs) &&
    Object.prototype.hasOwnProperty.call(kwargs, key)
  ) {
    return kwargs[key];
  }

  return null;
}

function buildDockingApproachUserErrorValues(dockingDebug = null) {
  const distance = Math.max(
    0,
    Math.round(Number(dockingDebug && dockingDebug.dockingDistance) || 0),
  );
  return { distance };
}

function getBookmarkSubfolderID(kwargs) {
  return normalizeNumber(getKwargValue(kwargs, "subfolderID"), 0) || null;
}

function extractDungeonInstanceID(rawTarget) {
  const numericTarget = normalizeNumber(rawTarget, 0);
  if (numericTarget > 0) {
    return Math.trunc(numericTarget);
  }

  if (!rawTarget || typeof rawTarget !== "object") {
    return 0;
  }

  const candidates = [];
  for (const key of [
    "instanceID",
    "dungeonInstanceID",
    "permanentID",
    "permanent_id",
    "permanent",
    "value",
    "_value",
  ]) {
    if (Object.prototype.hasOwnProperty.call(rawTarget, key)) {
      candidates.push(rawTarget[key]);
    }
  }

  if (
    (rawTarget.type === "objectex1" || rawTarget.type === "objectex2") &&
    Array.isArray(rawTarget.header)
  ) {
    const headerArgs = Array.isArray(rawTarget.header[1])
      ? rawTarget.header[1]
      : [];
    candidates.push(...headerArgs);
    if (
      rawTarget.header.length > 2 &&
      rawTarget.header[2] &&
      rawTarget.header[2].type === "dict" &&
      Array.isArray(rawTarget.header[2].entries)
    ) {
      for (const [, value] of rawTarget.header[2].entries) {
        candidates.push(value);
      }
    }
  }

  for (const candidate of candidates) {
    const numericCandidate = normalizeNumber(candidate, 0);
    if (numericCandidate > 0) {
      return Math.trunc(numericCandidate);
    }
  }

  return 0;
}

function filetimeToMs(filetimeStr) {
  if (filetimeStr == null) {
    return 0;
  }
  try {
    const EVE_EPOCH_OFFSET_MS = 11644473600000n;
    return Number(BigInt(filetimeStr) / 10000n - EVE_EPOCH_OFFSET_MS);
  } catch (_) {
    return 0;
  }
}

function isBookmarkDelayed(bookmark, charID) {
  if (!bookmark || !bookmark.creatorID) {
    return false;
  }
  if (Number(bookmark.creatorID) === Number(charID)) {
    return false;
  }

  const createdMs = filetimeToMs(bookmark.created);
  if (createdMs <= 0) {
    return false;
  }

  return Date.now() - createdMs < SHARED_BOOKMARK_DELAY_MS;
}

function resolveBookmarkAnyStore(session, bookmarkID) {
  const charID = session && session.characterID;
  const runtimeBookmark = bookmarkRuntime.getBookmarkForCharacter(charID, bookmarkID, {
    requireActive: true,
  });
  if (!runtimeBookmark) {
    return null;
  }
  const bookmark = runtimeBookmark.bookmark || runtimeBookmark;
  // Shared (group) folders hide freshly-created bookmarks from non-creators for
  // a short window so the author can correct mistakes before others warp to it.
  if (isBookmarkDelayed(bookmark, charID)) {
    log.info(
      `[Beyonce] Bookmark ${bookmarkID} is still in the shared delay window for char=${charID}`,
    );
    return null;
  }
  return bookmark;
}

function hasBeyonceViewRole(session) {
  if (!session || typeof session !== "object") {
    return false;
  }

  const roleMask = normalizeRoleValue(
    session.role ?? session.accountRole ?? session.accountRoles,
    0n,
  );
  return (roleMask & ROLEMASK_VIEW) !== 0n;
}

function resolveBookmarkAlignTarget(session, bookmarkID) {
  const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
  return normalizeNumber(bookmark && bookmark.itemID, 0);
}

function addBookmarkToFolder(charID, folderID, bookmarkOpts) {
  let created;
  try {
    created = bookmarkRuntime.createBookmark(charID, { ...bookmarkOpts, folderID });
  } catch (error) {
    if (error && error.bookmarkError) {
      throwWrappedUserError(error.bookmarkError);
    }
    throw error;
  }
  bookmarkNotifications.notifyBookmarksAdded(folderID, [created.bookmark], {
    excludeCharacterID: charID,
  });
  return buildBookmarkReplyTuple(created.bookmark);
}

function resolveBookmarkTargetForSession(session, bookmarkID, options = {}) {
  const bookmarkInfo = bookmarkRuntime.getBookmarkForCharacter(
    session && session.characterID,
    bookmarkID,
    options,
  );
  if (!bookmarkInfo) {
    return null;
  }
  const target = bookmarkRuntime.resolveBookmarkTarget(bookmarkID);
  return target ? { ...target, bookmarkInfo } : null;
}

function isDockedStructureObserverSession(session) {
  return Boolean(
    !session?._space &&
      Number(session && (session.structureID || session.structureid)) > 0 &&
      Number(session && (session.solarsystemid || session.solarsystemid2)) > 0,
  );
}

function bootstrapSessionBallpark(session, options = {}) {
  if (isDockedStructureObserverSession(session)) {
    return spaceRuntime.bootstrapDockedStructureView(session, options);
  }

  spaceRuntime.markBeyonceBound(session);
  return spaceRuntime.ensureInitialBallpark(session, options);
}

function prepareSessionBallpark(session) {
  if (
    isDockedStructureObserverSession(session)
  ) {
    return spaceRuntime.prepareDockedStructureView(session);
  }

  return bootstrapSessionBallpark(session, {
    allowDeferredJumpBootstrapVisuals: true,
  });
}

function getSessionSolarSystemID(session) {
  return normalizeNumber(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function getSessionCharacterID(session) {
  return operationSiteRuntime.getCharacterID(session);
}

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
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
  const scale = toFiniteNumber(scalar, 0);
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scale,
    y: toFiniteNumber(vector && vector.y, 0) * scale,
    z: toFiniteNumber(vector && vector.z, 0) * scale,
  };
}

function vectorMagnitude(vector) {
  return Math.sqrt(
    (toFiniteNumber(vector && vector.x, 0) ** 2) +
      (toFiniteNumber(vector && vector.y, 0) ** 2) +
      (toFiniteNumber(vector && vector.z, 0) ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const source = cloneVector(vector, fallback);
  const length = vectorMagnitude(source);
  if (length <= 0) {
    return cloneVector(fallback);
  }
  return {
    x: source.x / length,
    y: source.y / length,
    z: source.z / length,
  };
}

function throwCynoNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "The cynosural beacon cannot be used right now."),
  });
}

function throwIfJumpActivationActive(session) {
  if (hasActiveJumpActivation(session && session.characterID)) {
    throwCynoNotify(
      "You cannot use a jump drive, jump bridge, or jump portal while your jump activation cooldown is active.",
    );
  }
}

function getSolarSystemDistanceLy(sourceSolarSystemID, destinationSolarSystemID) {
  const sourceSystem = worldData.getSolarSystemByID(sourceSolarSystemID);
  const destinationSystem = worldData.getSolarSystemByID(destinationSolarSystemID);
  if (
    !sourceSystem ||
      !destinationSystem ||
      !sourceSystem.position ||
      !destinationSystem.position
  ) {
    return null;
  }

  const distanceMeters = vectorMagnitude(subtractVectors(
    sourceSystem.position,
    destinationSystem.position,
  ));
  return distanceMeters / LIGHT_YEAR_METERS;
}

function syncInventoryChanges(session, changes = []) {
  if (!session || typeof syncInventoryItemForSession !== "function") {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(session, change.item, change.previousData || {}, {
      emitCfgLocation: false,
    });
  }
}

function getResourceAttributes(resourceState) {
  return resourceState && resourceState.attributes && typeof resourceState.attributes === "object"
    ? resourceState.attributes
    : {};
}

function getEntitySurfaceDistanceMeters(leftEntity, rightEntity) {
  if (!leftEntity || !rightEntity) {
    return Number.POSITIVE_INFINITY;
  }
  const centerDistance = vectorMagnitude(subtractVectors(
    cloneVector(leftEntity.position),
    cloneVector(rightEntity.position),
  ));
  const leftRadius = Math.max(0, toFiniteNumber(leftEntity.radius, 0));
  const rightRadius = Math.max(0, toFiniteNumber(rightEntity.radius, 0));
  return Math.max(0, centerDistance - leftRadius - rightRadius);
}

function getRequiredPortalPassengerAttributeForField(fieldTypeID) {
  const normalizedFieldTypeID = normalizePositiveInt(fieldTypeID, TYPE_CYNOSURAL_FIELD);
  if (normalizedFieldTypeID === TYPE_COVERT_CYNOSURAL_FIELD) {
    return ATTRIBUTE_IS_BLACKOPS_JUMP_PORTAL_PASSENGER;
  }
  if (normalizedFieldTypeID === TYPE_INDUSTRIAL_CYNOSURAL_FIELD) {
    return ATTRIBUTE_IS_INDUSTRIAL_JUMP_PORTAL_PASSENGER;
  }
  return ATTRIBUTE_IS_TITAN_JUMP_PORTAL_PASSENGER;
}

function isMobileCynoBeaconDeployableType(typeID) {
  return MOBILE_CYNOSURAL_BEACON_TYPES.has(normalizePositiveInt(typeID, 0));
}

function typeHasDogmaFlag(typeID, attributeID) {
  const attributes = getTypeDogmaAttributes(normalizePositiveInt(typeID, 0));
  return toFiniteNumber(attributes && attributes[attributeID], 0) > 0;
}

function resolveKnownCynoAnchorFieldTypeID(typeID, fallback = 0) {
  const normalizedTypeID = normalizePositiveInt(typeID, 0);
  if (
    normalizedTypeID === TYPE_CYNOSURAL_FIELD ||
      normalizedTypeID === TYPE_COVERT_CYNOSURAL_FIELD ||
      normalizedTypeID === TYPE_INDUSTRIAL_CYNOSURAL_FIELD
  ) {
    return normalizedTypeID;
  }
  if (
    normalizedTypeID === TYPE_MOBILE_CYNOSURAL_BEACON ||
      normalizedTypeID === TYPE_HIGHSEC_AUTHORIZED_MOBILE_CYNOSURAL_BEACON
  ) {
    return TYPE_CYNOSURAL_FIELD;
  }
  if (normalizedTypeID === TYPE_COVERT_MOBILE_CYNOSURAL_BEACON) {
    return TYPE_COVERT_CYNOSURAL_FIELD;
  }
  if (normalizedTypeID === TYPE_MOBILE_CYNOSURAL_FIELD) {
    if (typeHasDogmaFlag(normalizedTypeID, ATTRIBUTE_USES_COVERT_CYNO)) {
      return TYPE_COVERT_CYNOSURAL_FIELD;
    }
    if (typeHasDogmaFlag(normalizedTypeID, ATTRIBUTE_USES_INDUSTRIAL_CYNO)) {
      return TYPE_INDUSTRIAL_CYNOSURAL_FIELD;
    }
    return TYPE_CYNOSURAL_FIELD;
  }
  return fallback;
}

function resolveDeployableBeaconFieldTypeID(deployableEntity, fieldEntity) {
  const deployableTypeID = normalizePositiveInt(deployableEntity && deployableEntity.typeID, 0);
  if (deployableTypeID > 0) {
    if (!isMobileCynoBeaconDeployableType(deployableTypeID)) {
      throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
    }
    return resolveKnownCynoAnchorFieldTypeID(deployableTypeID, TYPE_CYNOSURAL_FIELD);
  }

  const fieldTypeID = normalizePositiveInt(fieldEntity && fieldEntity.typeID, 0);
  const resolvedFieldTypeID = resolveKnownCynoAnchorFieldTypeID(fieldTypeID, 0);
  if (fieldTypeID > 0 && resolvedFieldTypeID <= 0) {
    throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
  }
  return resolvedFieldTypeID || TYPE_CYNOSURAL_FIELD;
}

function isDeployableCynoAnchorType(typeID) {
  const normalizedTypeID = normalizePositiveInt(typeID, 0);
  return (
    normalizedTypeID === TYPE_MOBILE_CYNOSURAL_FIELD ||
      isMobileCynoBeaconDeployableType(normalizedTypeID)
  );
}

function resolveJumpPortalMassFactor(moduleItem, moduleAttributes) {
  const dogmaValue = toFiniteNumber(
    moduleAttributes && moduleAttributes[ATTRIBUTE_JUMP_PORTAL_CONSUMPTION_MASS_FACTOR],
    0,
  );
  if (dogmaValue > 0) {
    return dogmaValue;
  }
  const typeID = normalizePositiveInt(moduleItem && moduleItem.typeID, 0);
  return Math.max(0, toFiniteNumber(JUMP_PORTAL_MASS_FACTOR_BY_TYPE_ID[typeID], 0));
}

function resolveBridgePortalModule(bridgeCharacterID, bridgeShip, fieldTypeID) {
  const bridgeResourceState = buildShipResourceState(bridgeCharacterID, bridgeShip);
  const requiredPassengerAttributeID =
    getRequiredPortalPassengerAttributeForField(fieldTypeID);
  const fittedItems = Array.isArray(bridgeResourceState.fittedItems)
    ? bridgeResourceState.fittedItems
    : [];
  for (const fittedItem of fittedItems) {
    if (!isEffectivelyOnlineModule(fittedItem)) {
      continue;
    }
    const moduleAttributes = buildEffectiveItemAttributeMap(fittedItem);
    const modulePassengerAttributeID = normalizePositiveInt(
      moduleAttributes[ATTRIBUTE_JUMP_PORTAL_PASSENGER_REQUIRED_ATTRIBUTE_ID],
      0,
    );
    if (modulePassengerAttributeID !== requiredPassengerAttributeID) {
      continue;
    }
    const portalMassFactor = resolveJumpPortalMassFactor(
      fittedItem,
      moduleAttributes,
    );
    if (portalMassFactor <= 0) {
      throwCynoNotify(
        "That jump portal generator is missing its portal fuel mass factor.",
      );
    }
    return {
      bridgeResourceState,
      moduleAttributes,
      portalMassFactor,
      portalModuleItem: fittedItem,
      requiredPassengerAttributeID,
      additionalConsumption: Math.max(
        0,
        toFiniteNumber(
          moduleAttributes[ATTRIBUTE_JUMP_PORTAL_ADDITIONAL_CONSUMPTION],
          0,
        ),
      ),
    };
  }
  throwCynoNotify(
    "Your ship is not fitted with an online jump portal generator for that cynosural field.",
  );
}

function getBridgePortalEffectName(portalModuleItem) {
  const typeID = normalizePositiveInt(portalModuleItem && portalModuleItem.typeID, 0);
  return typeID === TYPE_COVERT_JUMP_PORTAL_GENERATOR
    ? JUMP_PORTAL_EFFECT_COVERT
    : JUMP_PORTAL_EFFECT_STANDARD;
}

function resolveShipRadiusMeters(shipItem, shipEntity = null) {
  const directRadius = Math.max(
    0,
    toFiniteNumber(
      shipEntity && shipEntity.radius,
      toFiniteNumber(shipItem && (shipItem.radius || shipItem.spaceRadius), 0),
    ),
  );
  if (directRadius > 0) {
    return directRadius;
  }
  const movement = worldData.getMovementAttributesForType(
    normalizePositiveInt(shipItem && (shipItem.typeID || shipItem.shipTypeID), 0),
  );
  return Math.max(0, toFiniteNumber(movement && movement.radius, 0));
}

function buildFleetCynoArrivalSpawnState(fieldEntity, shipItem, shipEntity = null, options = {}) {
  const anchorPosition = cloneVector(fieldEntity && fieldEntity.position);
  const direction = normalizeVector(
    vectorMagnitude(anchorPosition) > 0 ? anchorPosition : { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  const offset =
    Math.max(0, toFiniteNumber(fieldEntity && fieldEntity.radius, 0)) +
    resolveShipRadiusMeters(shipItem, shipEntity) +
    CYNO_BEACON_ARRIVAL_CLEARANCE_METERS;
  return {
    anchorType: options.anchorType || "fleetModuleCynoBeacon",
    anchorID: normalizePositiveInt(
      fieldEntity && (fieldEntity.itemID || fieldEntity.structureID),
      0,
    ),
    anchorName: String(
      (fieldEntity && (fieldEntity.itemName || fieldEntity.name)) ||
        options.fallbackName ||
        "Cynosural Field",
    ),
    direction,
    position: addVectors(anchorPosition, scaleVector(direction, offset)),
  };
}

function fieldTypeRequiresCovertCompatibility(fieldTypeID) {
  return normalizePositiveInt(fieldTypeID, 0) === TYPE_COVERT_CYNOSURAL_FIELD;
}

function fieldTypeRequiresIndustrialCompatibility(fieldTypeID) {
  return normalizePositiveInt(fieldTypeID, 0) === TYPE_INDUSTRIAL_CYNOSURAL_FIELD;
}

function resolveActiveShipAndJumpDriveForCyno(session, destinationSolarSystemID, fieldTypeID) {
  const characterID = normalizePositiveInt(session && session.characterID, 0);
  const activeShip = getActiveShipRecord(characterID);
  if (!activeShip) {
    throwCynoNotify("You need an active ship to use a cynosural beacon.");
  }

  const resourceState = buildShipResourceState(characterID, activeShip);
  const attributes =
    resourceState && resourceState.attributes && typeof resourceState.attributes === "object"
      ? resourceState.attributes
      : {};
  const jumpRangeLy = toFiniteNumber(attributes[ATTRIBUTE_JUMP_DRIVE_RANGE], 0);
  const fuelTypeID = normalizePositiveInt(
    attributes[ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE],
    0,
  );
  const fuelAmountPerLy = toFiniteNumber(
    attributes[ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT],
    0,
  );

  if (jumpRangeLy <= 0 || fuelTypeID <= 0 || fuelAmountPerLy <= 0) {
    throwCynoNotify("Your ship is not capable of jumping to a cynosural beacon.");
  }
  if (
    fieldTypeRequiresCovertCompatibility(fieldTypeID) &&
      toFiniteNumber(attributes[ATTRIBUTE_USES_COVERT_CYNO], 0) <= 0
  ) {
    throwCynoNotify("Your ship cannot jump to covert cynosural fields.");
  }
  if (
    fieldTypeRequiresIndustrialCompatibility(fieldTypeID) &&
      toFiniteNumber(attributes[ATTRIBUTE_USES_INDUSTRIAL_CYNO], 0) <= 0
  ) {
    throwCynoNotify("Your ship cannot jump to industrial cynosural fields.");
  }

  const sourceSolarSystemID = getSessionSolarSystemID(session);
  const distanceLy = getSolarSystemDistanceLy(sourceSolarSystemID, destinationSolarSystemID);
  if (distanceLy === null) {
    throwCynoNotify("The distance to that cynosural beacon could not be calculated.");
  }
  if (distanceLy <= 0) {
    throwCynoNotify("You are already in that solar system.");
  }
  if (distanceLy > jumpRangeLy + 0.000001) {
    throwCynoNotify("That cynosural beacon is outside your jump range.");
  }

  return {
    activeShip,
    distanceLy,
    fuelTypeID,
    fuelQuantity: Math.max(0, Math.trunc(distanceLy * fuelAmountPerLy)),
    jumpRangeLy,
    resourceState,
  };
}

function consumeJumpFuel(session, activeShip, shipEntity, fuelTypeID, fuelQuantity) {
  const quantity = normalizeInt(fuelQuantity, 0);
  if (quantity <= 0) {
    return {
      consumedQuantity: 0,
      changes: [],
    };
  }

  const fuelEntity = shipEntity || {
    kind: "ship",
    itemID: normalizePositiveInt(activeShip && activeShip.itemID, 0),
  };
  const fuelResult = consumeFuelFromShipStorage(
    fuelEntity,
    fuelTypeID,
    quantity,
    {
      resolveCharacterID: () => normalizePositiveInt(session && session.characterID, 0),
    },
  );
  if (!fuelResult.success) {
    throwCynoNotify("Your ship does not have enough jump fuel.");
  }
  syncInventoryChanges(session, fuelResult.changes);
  return fuelResult;
}

function calculateBridgeFuelQuantity({
  distanceLy,
  passengerMass,
  portalMassFactor,
  fuelAmountPerLy,
  additionalConsumption,
}) {
  const rawQuantity =
    Math.max(0, toFiniteNumber(distanceLy, 0)) *
    Math.max(0, toFiniteNumber(passengerMass, 0)) *
    Math.max(0, toFiniteNumber(portalMassFactor, 0)) *
    Math.max(0, toFiniteNumber(fuelAmountPerLy, 0)) +
    Math.max(0, toFiniteNumber(additionalConsumption, 0));
  return Math.max(0, Math.ceil(rawQuantity));
}

function consumeBridgeFuel(bridgeCharacterID, bridgeShip, bridgeEntity, fuelTypeID, fuelQuantity) {
  const quantity = normalizeInt(fuelQuantity, 0);
  if (quantity <= 0) {
    return {
      consumedQuantity: 0,
      changes: [],
    };
  }

  const fuelEntity = bridgeEntity || {
    kind: "ship",
    itemID: normalizePositiveInt(bridgeShip && bridgeShip.itemID, 0),
  };
  const fuelResult = consumeFuelFromShipStorage(
    fuelEntity,
    fuelTypeID,
    quantity,
    {
      resolveCharacterID: () => normalizePositiveInt(bridgeCharacterID, 0),
    },
  );
  if (!fuelResult.success) {
    throwCynoNotify("The bridge ship does not have enough jump portal fuel.");
  }
  const bridgeSession = sessionRegistry.findSessionByCharacterID(bridgeCharacterID);
  if (bridgeSession) {
    syncInventoryChanges(bridgeSession, fuelResult.changes);
  }
  return fuelResult;
}

function ensureFleetMembership(session) {
  const fleetID = normalizePositiveInt(session && session.fleetid, 0);
  if (fleetID <= 0) {
    throwWrappedUserError("FleetNotInFleet");
  }
  const fleet = fleetRuntime.getFleetByID(fleetID);
  if (!fleet || !(fleet.members instanceof Map)) {
    throwWrappedUserError("FleetNotInFleet");
  }
  const characterID = normalizePositiveInt(session && session.characterID, 0);
  if (characterID <= 0 || !fleet.members.has(characterID)) {
    throwWrappedUserError("FleetNotInFleet");
  }
  return fleet;
}

function getSceneEntityBySystemID(systemID, entityID) {
  const numericSystemID = normalizePositiveInt(systemID, 0);
  const numericEntityID = normalizePositiveInt(entityID, 0);
  if (
    numericSystemID <= 0 ||
      numericEntityID <= 0 ||
      !(spaceRuntime.scenes instanceof Map)
  ) {
    return null;
  }
  const scene = spaceRuntime.scenes.get(numericSystemID);
  return scene && typeof scene.getEntityByID === "function"
    ? scene.getEntityByID(numericEntityID)
    : null;
}

function getStructureByID(structureID) {
  const numericStructureID = normalizePositiveInt(structureID, 0);
  return numericStructureID > 0
    ? structureState.getStructureByID(numericStructureID, { refresh: false })
    : null;
}

function isPharoluxStructure(structure) {
  return Boolean(
    structure &&
      normalizePositiveInt(structure.typeID, 0) === TYPE_PHAROLUX_CYNO_BEACON &&
      !structure.destroyedAt,
  );
}

function isStructureCynoBeaconServiceOnline(structure) {
  return normalizeInt(
    structure &&
      structure.serviceStates &&
      structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_BEACON)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  ) === STRUCTURE_SERVICE_STATE.ONLINE;
}

function buildStructureCynoAnchorEntity(structure, fallbackEntity = null) {
  return {
    ...(fallbackEntity && typeof fallbackEntity === "object" ? fallbackEntity : {}),
    itemID: normalizePositiveInt(
      structure && (structure.structureID || structure.itemID),
      normalizePositiveInt(fallbackEntity && fallbackEntity.itemID, 0),
    ),
    structureID: normalizePositiveInt(
      structure && (structure.structureID || structure.itemID),
      normalizePositiveInt(fallbackEntity && fallbackEntity.structureID, 0),
    ),
    typeID: normalizePositiveInt(
      structure && structure.typeID,
      normalizePositiveInt(fallbackEntity && fallbackEntity.typeID, TYPE_PHAROLUX_CYNO_BEACON),
    ),
    itemName:
      (structure && (structure.itemName || structure.name)) ||
      (fallbackEntity && (fallbackEntity.itemName || fallbackEntity.name)) ||
      "Pharolux Cyno Beacon",
    name:
      (structure && (structure.name || structure.itemName)) ||
      (fallbackEntity && (fallbackEntity.name || fallbackEntity.itemName)) ||
      "Pharolux Cyno Beacon",
    position: cloneVector(
      (structure && structure.position) ||
        (fallbackEntity && fallbackEntity.position),
    ),
    radius: Math.max(
      0,
      toFiniteNumber(
        structure && structure.radius,
        toFiniteNumber(fallbackEntity && fallbackEntity.radius, 0),
      ),
    ),
  };
}

function resolveFleetBridgeDestination(destinationSolarSystemID, beaconID) {
  const destinationEntity = getSceneEntityBySystemID(destinationSolarSystemID, beaconID);
  const entityTypeID = normalizePositiveInt(destinationEntity && destinationEntity.typeID, 0);
  const entityFieldTypeID = resolveKnownCynoAnchorFieldTypeID(entityTypeID, 0);
  if (entityFieldTypeID > 0) {
    if (
      isSolarSystemCynoJammed(destinationSolarSystemID) &&
        entityFieldTypeID !== TYPE_COVERT_CYNOSURAL_FIELD
    ) {
      throwCynoNotify("That solar system is cynosural jammed.");
    }
    const isDeployableAnchor = isDeployableCynoAnchorType(entityTypeID);
    return {
      anchorEntity: destinationEntity,
      anchorFallbackName: isDeployableAnchor
        ? "Mobile Cynosural Beacon"
        : "Cynosural Field",
      anchorType: isDeployableAnchor
        ? "fleetDeployableCynoBeacon"
        : "fleetModuleCynoBeacon",
      fieldTypeID: entityFieldTypeID,
      kind: isDeployableAnchor
        ? "fleetDeployableCynoBeacon"
        : "fleetModuleCynoBeacon",
    };
  }

  const structure = getStructureByID(beaconID);
  if (isPharoluxStructure(structure)) {
    const structureSolarSystemID = normalizePositiveInt(structure.solarSystemID, 0);
    if (
      structureSolarSystemID !== normalizePositiveInt(destinationSolarSystemID, 0)
    ) {
      throwCynoNotify("That fleet bridge is no longer available.");
    }
    if (!isStructureCynoBeaconServiceOnline(structure)) {
      throwCynoNotify("That cynosural beacon service is offline.");
    }
    if (isSolarSystemCynoJammed(destinationSolarSystemID)) {
      throwCynoNotify("That solar system is cynosural jammed.");
    }
    return {
      anchorEntity: buildStructureCynoAnchorEntity(structure, destinationEntity),
      anchorFallbackName: "Pharolux Cyno Beacon",
      anchorType: "structureCynoBeacon",
      fieldTypeID: TYPE_CYNOSURAL_FIELD,
      kind: "structureCynoBeacon",
      structure,
    };
  }

  throwCynoNotify("That fleet bridge is no longer available.");
}

function resolveFleetModuleBeacon(args, session) {
  const beaconOwnerCharID = normalizePositiveInt(Array.isArray(args) ? args[0] : null, 0);
  const requestedBeaconID = normalizePositiveInt(Array.isArray(args) ? args[1] : null, 0);
  const requestedSolarSystemID = normalizePositiveInt(Array.isArray(args) ? args[2] : null, 0);
  const fleet = ensureFleetMembership(session);
  const entry = fleet.activeModuleBeacons instanceof Map
    ? fleet.activeModuleBeacons.get(beaconOwnerCharID)
    : null;
  if (!Array.isArray(entry)) {
    throwCynoNotify("That fleet cynosural beacon is no longer available.");
  }

  const destinationSolarSystemID = normalizePositiveInt(entry[0], 0);
  const beaconID = normalizePositiveInt(entry[1], 0);
  const fieldTypeID = normalizePositiveInt(entry[2], TYPE_CYNOSURAL_FIELD);
  if (
    requestedSolarSystemID > 0 &&
      requestedSolarSystemID !== destinationSolarSystemID
  ) {
    throwCynoNotify("That fleet cynosural beacon is not in the requested solar system.");
  }
  if (requestedBeaconID > 0 && requestedBeaconID !== beaconID) {
    throwCynoNotify("That fleet cynosural beacon is no longer available.");
  }
  if (destinationSolarSystemID <= 0 || beaconID <= 0) {
    throwCynoNotify("That fleet cynosural beacon is no longer available.");
  }
  if (destinationSolarSystemID === getSessionSolarSystemID(session)) {
    throwCynoNotify("You are already in that solar system.");
  }
  if (
    isSolarSystemCynoJammed(destinationSolarSystemID) &&
      fieldTypeID !== TYPE_COVERT_CYNOSURAL_FIELD
  ) {
    throwCynoNotify("That solar system is cynosural jammed.");
  }

  const fieldEntity = getSceneEntityBySystemID(destinationSolarSystemID, beaconID);
  if (!fieldEntity) {
    throwCynoNotify("That fleet cynosural beacon is no longer available.");
  }
  const entityTypeID = normalizePositiveInt(fieldEntity.typeID, fieldTypeID);
  if (entityTypeID !== fieldTypeID) {
    throwCynoNotify("That fleet cynosural beacon is no longer available.");
  }

  return {
    beaconID,
    beaconOwnerCharID,
    destinationSolarSystemID,
    fieldEntity,
    fieldTypeID,
    fleet,
  };
}

function resolveFleetDeployableBeacon(args, session) {
  const deployableID = normalizePositiveInt(Array.isArray(args) ? args[0] : null, 0);
  const requestedSolarSystemID = normalizePositiveInt(Array.isArray(args) ? args[1] : null, 0);
  const requestedBeaconID = normalizePositiveInt(Array.isArray(args) ? args[2] : null, 0);
  if (deployableID <= 0) {
    throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
  }

  const fleet = ensureFleetMembership(session);
  const entry = fleet.activeDeployableBeacons instanceof Map
    ? fleet.activeDeployableBeacons.get(deployableID)
    : null;
  if (!Array.isArray(entry)) {
    throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
  }

  const destinationSolarSystemID = normalizePositiveInt(entry[0], 0);
  const beaconID = normalizePositiveInt(entry[1], 0);
  const ownerID = normalizePositiveInt(entry[2], 0);
  if (
    requestedSolarSystemID > 0 &&
      requestedSolarSystemID !== destinationSolarSystemID
  ) {
    throwCynoNotify("That fleet deployable cynosural beacon is not in the requested solar system.");
  }
  if (requestedBeaconID > 0 && requestedBeaconID !== beaconID) {
    throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
  }
  if (destinationSolarSystemID <= 0 || beaconID <= 0) {
    throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
  }
  if (destinationSolarSystemID === getSessionSolarSystemID(session)) {
    throwCynoNotify("You are already in that solar system.");
  }

  const deployableEntity = getSceneEntityBySystemID(destinationSolarSystemID, deployableID);
  const fieldEntity = getSceneEntityBySystemID(destinationSolarSystemID, beaconID);
  if (!deployableEntity && !fieldEntity) {
    throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
  }
  const anchorEntity = fieldEntity || deployableEntity;
  const anchorTypeID = normalizePositiveInt(anchorEntity && anchorEntity.typeID, 0);
  if (
    anchorTypeID > 0 &&
      resolveKnownCynoAnchorFieldTypeID(anchorTypeID, 0) <= 0
  ) {
    throwCynoNotify("That fleet deployable cynosural beacon is no longer available.");
  }

  const fieldTypeID = resolveDeployableBeaconFieldTypeID(
    deployableEntity,
    fieldEntity || deployableEntity,
  );
  if (
    isSolarSystemCynoJammed(destinationSolarSystemID) &&
      fieldTypeID !== TYPE_COVERT_CYNOSURAL_FIELD
  ) {
    throwCynoNotify("That solar system is cynosural jammed.");
  }

  return {
    beaconID,
    deployableEntity,
    deployableID,
    destinationSolarSystemID,
    fieldEntity: anchorEntity,
    fieldTypeID,
    fleet,
    ownerID,
  };
}

function resolveFleetBridgePassengerJump(args, session) {
  const otherCharID = normalizePositiveInt(Array.isArray(args) ? args[0] : null, 0);
  const otherShipID = normalizePositiveInt(Array.isArray(args) ? args[1] : null, 0);
  const requestedBeaconID = normalizePositiveInt(Array.isArray(args) ? args[2] : null, 0);
  const requestedSolarSystemID = normalizePositiveInt(Array.isArray(args) ? args[3] : null, 0);
  if (otherCharID <= 0 || otherShipID <= 0) {
    throwCynoNotify("That fleet bridge is no longer available.");
  }

  const fleet = ensureFleetMembership(session);
  const bridgeMember = fleet.members instanceof Map
    ? fleet.members.get(otherCharID)
    : null;
  if (!bridgeMember) {
    throwWrappedUserError("FleetNotInFleet");
  }

  const bridge = fleetRuntime.getActiveBridgeForCharacter(
    session && session.characterID,
    otherShipID,
  );
  const destinationSolarSystemID = normalizePositiveInt(
    Array.isArray(bridge) ? bridge[0] : null,
    0,
  );
  const beaconID = normalizePositiveInt(Array.isArray(bridge) ? bridge[1] : null, 0);
  if (
    !bridge ||
      destinationSolarSystemID <= 0 ||
      beaconID <= 0 ||
      (requestedSolarSystemID > 0 && requestedSolarSystemID !== destinationSolarSystemID) ||
      (requestedBeaconID > 0 && requestedBeaconID !== beaconID)
  ) {
    throwCynoNotify("That fleet bridge is no longer available.");
  }

  const bridgeDestination = resolveFleetBridgeDestination(
    destinationSolarSystemID,
    beaconID,
  );
  const fieldEntity = bridgeDestination.anchorEntity;
  const fieldTypeID = bridgeDestination.fieldTypeID;

  const bridgeEntity = spaceRuntime.getEntity(session, otherShipID);
  if (!bridgeEntity) {
    throwCynoNotify("That fleet bridge is no longer available.");
  }
  const bridgeOwnerID = normalizePositiveInt(
    bridgeEntity.ownerID || bridgeEntity.charID || otherCharID,
    otherCharID,
  );
  if (bridgeOwnerID !== otherCharID) {
    throwCynoNotify("That fleet bridge is no longer available.");
  }
  const bridgeMemberShipID = normalizePositiveInt(bridgeMember.shipID, 0);
  if (bridgeMemberShipID > 0 && bridgeMemberShipID !== otherShipID) {
    throwCynoNotify("That fleet bridge is no longer available.");
  }

  const passengerShip = getActiveShipRecord(session && session.characterID);
  const passengerShipID = normalizePositiveInt(passengerShip && passengerShip.itemID, 0);
  if (passengerShipID <= 0) {
    throwCynoNotify("You need an active ship to use a fleet bridge.");
  }
  if (passengerShipID === otherShipID) {
    throwCynoNotify("You cannot jump through your own fleet bridge.");
  }
  const passengerEntity = spaceRuntime.getEntity(session, passengerShipID);
  if (!passengerEntity) {
    throwCynoNotify("You need to be in space to use a fleet bridge.");
  }
  const bridgeDistanceMeters = getEntitySurfaceDistanceMeters(
    passengerEntity,
    bridgeEntity,
  );
  if (bridgeDistanceMeters > FLEET_BRIDGE_ACTIVATION_RANGE_METERS) {
    throwCynoNotify("You are too far away from the fleet bridge.");
  }

  const bridgeShip = findCharacterShip(otherCharID, otherShipID);
  if (!bridgeShip) {
    throwCynoNotify("That fleet bridge is no longer available.");
  }
  const portal = resolveBridgePortalModule(otherCharID, bridgeShip, fieldTypeID);
  const passengerResourceState = buildShipResourceState(
    session && session.characterID,
    passengerShip,
  );
  const passengerAttributes = getResourceAttributes(passengerResourceState);
  if (toFiniteNumber(passengerAttributes[portal.requiredPassengerAttributeID], 0) <= 0) {
    throwCynoNotify("Your ship cannot use that jump portal.");
  }

  const sourceSolarSystemID = getSessionSolarSystemID(session);
  const distanceLy = getSolarSystemDistanceLy(sourceSolarSystemID, destinationSolarSystemID);
  if (distanceLy === null) {
    throwCynoNotify("The distance to that fleet bridge could not be calculated.");
  }
  if (distanceLy <= 0) {
    throwCynoNotify("You are already in that solar system.");
  }

  const bridgeAttributes = getResourceAttributes(portal.bridgeResourceState);
  const fuelTypeID = normalizePositiveInt(
    bridgeAttributes[ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE],
    0,
  );
  const fuelAmountPerLy = toFiniteNumber(
    bridgeAttributes[ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT],
    0,
  );
  if (fuelTypeID <= 0 || fuelAmountPerLy <= 0) {
    throwCynoNotify("The bridge ship does not have valid jump portal fuel data.");
  }

  const passengerMass = Math.max(
    0,
    toFiniteNumber(passengerAttributes[ATTRIBUTE_MASS], 0),
    toFiniteNumber(passengerEntity.mass, 0),
    toFiniteNumber(passengerShip.mass, 0),
  );
  if (passengerMass <= 0) {
    throwCynoNotify("Your ship mass could not be calculated for the jump portal.");
  }

  return {
    beaconID,
    bridgeDistanceMeters,
    bridgeEntity,
    bridgeOwnerCharID: otherCharID,
    bridgeShip,
    destinationSolarSystemID,
    distanceLy,
    fieldEntity,
    fieldTypeID,
    bridgeDestination,
    fuelAmountPerLy,
    fuelQuantity: calculateBridgeFuelQuantity({
      distanceLy,
      passengerMass,
      portalMassFactor: portal.portalMassFactor,
      fuelAmountPerLy,
      additionalConsumption: portal.additionalConsumption,
    }),
    fuelTypeID,
    jumpFatigueMultiplier: resolveJumpFatigueMultiplier(passengerResourceState),
    passengerEntity,
    passengerMass,
    passengerShip,
    portal,
  };
}

function notifyGroupJumpAnchor(session, destinationSolarSystemID, numPassengers = 0) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnGroupJumpAnchorActivated", "clientID", [
    normalizePositiveInt(destinationSolarSystemID, 0),
    Math.max(0, normalizeInt(numPassengers, 0)),
  ]);
}

function throwConduitAnchorFailure(planResult) {
  const reason = String(planResult && planResult.anchorBlockReason || "");
  if (reason === "cloaked") {
    throwCynoNotify("Your ship cannot perform a conduit jump while cloaked.");
  }
  if (reason === "warp-scrambled") {
    throwCynoNotify("Your ship cannot perform a conduit jump while warp disrupted.");
  }
  if (reason === "transition") {
    throwCynoNotify("Your ship cannot perform a conduit jump while already in transition.");
  }
  if (reason === "industrial-core") {
    throwCynoNotify("Your ship cannot perform a conduit jump while its Industrial Core is active.");
  }
  throwCynoNotify("Your ship cannot perform a conduit jump.");
}

function resolveOperationDungeonWarpPoint(session, siteID) {
  const numericSiteID = normalizeNumber(siteID, 0);
  if (numericSiteID <= 0) {
    return null;
  }

  const record = operationSiteRuntime.resolveOperationSpawnpointRecord(
    getSessionCharacterID(session),
    numericSiteID,
  );
  if (!record || !record.solarSystemID) {
    return null;
  }

  const sessionSystemID = getSessionSolarSystemID(session);
  if (
    sessionSystemID > 0 &&
    Number(record.solarSystemID) > 0 &&
    sessionSystemID !== Number(record.solarSystemID)
  ) {
    return null;
  }

  return {
    x: normalizeNumber(record.position && record.position.x, 0),
    y: normalizeNumber(record.position && record.position.y, 0),
    z: normalizeNumber(record.position && record.position.z, 0),
  };
}

function buildScanSiteWarpPoint(site) {
  if (site && site.actualPosition && typeof site.actualPosition === "object") {
    return {
      x: normalizeNumber(site.actualPosition.x, 0),
      y: normalizeNumber(site.actualPosition.y, 0),
      z: normalizeNumber(site.actualPosition.z, 0),
    };
  }

  if (Array.isArray(site && site.position)) {
    return {
      x: normalizeNumber(site.position[0], 0),
      y: normalizeNumber(site.position[1], 0),
      z: normalizeNumber(site.position[2], 0),
    };
  }

  return null;
}

function ensureUniverseSiteContentsMaterialized(scene, siteOrEntity, options = {}) {
  if (!scene) {
    return null;
  }
  try {
    const dungeonUniverseSiteService = require(path.join(
      __dirname,
      "../dungeon/dungeonUniverseSiteService",
    ));
    return dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, siteOrEntity, options);
  } catch (error) {
    log.warn(
      `[Beyonce] Failed to materialize universe site contents in system=${normalizeNumber(scene && scene.systemID, 0)}: ${error.message}`,
    );
    return null;
  }
}

function maybeMaterializeMissionBookmarkTarget(session, bookmarkTarget) {
  const metadata =
    bookmarkTarget &&
    bookmarkTarget.metadata &&
    typeof bookmarkTarget.metadata === "object"
      ? bookmarkTarget.metadata
      : (
        bookmarkTarget &&
        bookmarkTarget.bookmarkInfo &&
        bookmarkTarget.bookmarkInfo.bookmark &&
        bookmarkTarget.bookmarkInfo.bookmark.metadata &&
        typeof bookmarkTarget.bookmarkInfo.bookmark.metadata === "object"
      )
        ? bookmarkTarget.bookmarkInfo.bookmark.metadata
        : {};
  const missionInstanceID = normalizeNumber(metadata.missionInstanceID, 0);
  if (missionInstanceID <= 0) {
    return null;
  }
  const scene = spaceRuntime.getSceneForSession(session);
  return ensureUniverseSiteContentsMaterialized(scene, {
    instanceID: missionInstanceID,
  }, {
    spawnEncounters: true,
    broadcast: true,
    session,
  });
}

function isActiveUniverseSiteInstance(instance) {
  const lifecycleState = String(instance && instance.lifecycleState || "")
    .trim()
    .toLowerCase();
  const siteKind = String(instance && instance.siteKind || "")
    .trim()
    .toLowerCase();
  return Boolean(
    instance &&
    instance.runtimeFlags &&
    instance.runtimeFlags.universeSeeded === true &&
    instance.runtimeFlags.generatedMining !== true &&
    (siteKind === "anomaly" || siteKind === "signature") &&
    (lifecycleState === "seeded" || lifecycleState === "active" || lifecycleState === "paused"),
  );
}

function maybeMaterializeUniverseSiteInstanceTarget(session, instanceID) {
  const numericInstanceID = normalizeNumber(instanceID, 0);
  if (numericInstanceID <= 0) {
    return null;
  }

  const scene = spaceRuntime.getSceneForSession(session);
  if (!scene) {
    return null;
  }

  const instance = dungeonRuntime.getInstance(numericInstanceID);
  if (!isActiveUniverseSiteInstance(instance)) {
    return null;
  }

  const sessionSystemID = getSessionSolarSystemID(session);
  const instanceSystemID = normalizeNumber(instance && instance.solarSystemID, 0);
  if (sessionSystemID > 0 && instanceSystemID > 0 && sessionSystemID !== instanceSystemID) {
    return null;
  }

  const materialized = ensureUniverseSiteContentsMaterialized(scene, {
    instanceID: numericInstanceID,
  }, {
    spawnEncounters: true,
    broadcast: true,
    session,
  });
  if (!materialized || materialized.success !== true) {
    return null;
  }

  const siteID = normalizeNumber(
    materialized.data && materialized.data.siteID,
    normalizeNumber(instance && instance.metadata && instance.metadata.siteID, 0),
  );
  if (siteID <= 0) {
    return null;
  }

  const entity =
    scene && typeof scene.getEntityByID === "function"
      ? scene.getEntityByID(siteID)
      : null;
  if (!entity) {
    return null;
  }

  return {
    entityID: siteID,
    instanceID: numericInstanceID,
    materialized,
  };
}

function resolveScanWarpTarget(session, targetID) {
  const systemID = getSessionSolarSystemID(session);
  if (systemID <= 0) {
    return null;
  }

  const site = signatureRuntime.resolveSiteByTargetID(systemID, targetID, {
    loadScene: true,
  });
  if (!site) {
    return null;
  }
  const scene = spaceRuntime.getSceneForSession(session);
  ensureUniverseSiteContentsMaterialized(scene, site, {
    spawnEncounters: true,
    broadcast: true,
    session,
  });

  const entityID = normalizeNumber(
    site.itemID || site.endpointID || site.siteID,
    0,
  );
  if (entityID > 0) {
    const entity =
      scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(entityID)
        : null;
    if (entity) {
      return {
        kind: "entity",
        entityID,
        site,
      };
    }
  }

  const point = buildScanSiteWarpPoint(site);
  if (point) {
    return {
      kind: "point",
      point,
      site,
    };
  }

  return null;
}

function resolveFleetMemberWarpTarget(session, targetCharacterID) {
  const sourceCharacterID = normalizeNumber(
    session && (session.characterID || session.charID || session.charid),
    0,
  );
  const numericTargetCharacterID = normalizeNumber(targetCharacterID, 0);
  if (sourceCharacterID <= 0 || numericTargetCharacterID <= 0) {
    return null;
  }

  const fleet = fleetRuntime.getFleetForCharacter(sourceCharacterID);
  if (!fleet || !fleetRuntime.getMemberRecord(fleet, numericTargetCharacterID)) {
    return null;
  }

  const targetSession = sessionRegistry.findSessionByCharacterID(
    numericTargetCharacterID,
  );
  if (!targetSession) {
    return null;
  }

  const sourceSystemID = normalizeNumber(
    session && (session.solarsystemid2 || session.solarsystemid),
    0,
  );
  const targetSystemID = normalizeNumber(
    targetSession.solarsystemid2 || targetSession.solarsystemid,
    0,
  );
  if (
    sourceSystemID > 0 &&
    targetSystemID > 0 &&
    sourceSystemID !== targetSystemID
  ) {
    return null;
  }

  const targetScene = spaceRuntime.getSceneForSession(targetSession);
  const targetShipEntity =
    targetScene && typeof targetScene.getShipEntityForSession === "function"
      ? targetScene.getShipEntityForSession(targetSession)
      : null;
  const targetShipID = normalizeNumber(
    targetShipEntity && targetShipEntity.itemID,
    normalizeNumber(targetSession.shipID || targetSession.shipid, 0),
  );
  if (targetShipID > 0) {
    return {
      kind: "entity",
      entityID: targetShipID,
    };
  }
  if (
    targetShipEntity &&
    targetShipEntity.position &&
    typeof targetShipEntity.position === "object"
  ) {
    return {
      kind: "point",
      point: targetShipEntity.position,
    };
  }

  return null;
}

class BeyonceService extends BaseService {
  constructor() {
    super("beyonce");
    this.reuseBoundObjectForSession = true;
  }

  _getMovementThrottleNowMs() {
    const overrideNowMs = Number(this._movementThrottleNowMs);
    return Number.isFinite(overrideNowMs) && overrideNowMs >= 0
      ? overrideNowMs
      : Date.now();
  }

  _normalizeMovementThrottlePart(value) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return String(Math.round(numericValue * 1000) / 1000);
    }
    return String(value || "");
  }

  _buildMovementThrottleKey(commandName, parts = []) {
    return [
      String(commandName || "movement"),
      ...parts.map((part) => this._normalizeMovementThrottlePart(part)),
    ].join(":");
  }

  _throwThrottleGeneric(remainingMs) {
    throwWrappedUserError("ThrottleGeneric", {
      remainingTime: Math.max(
        1,
        Math.ceil(Math.max(0, Number(remainingMs) || 0) * EVE_TIME_TICKS_PER_MS),
      ),
    });
  }

  _enforceMovementCommandThrottle(session, commandName, parts = []) {
    if (!session || typeof session !== "object") {
      return;
    }
    const nowMs = this._getMovementThrottleNowMs();
    const key = this._buildMovementThrottleKey(commandName, parts);
    if (!(session._beyonceMovementCommandThrottle instanceof Map)) {
      session._beyonceMovementCommandThrottle = new Map();
    }
    const throttleState = session._beyonceMovementCommandThrottle;
    const expiresAtMs = Number(throttleState.get(key)) || 0;
    if (expiresAtMs > nowMs) {
      this._throwThrottleGeneric(expiresAtMs - nowMs);
    }

    throttleState.set(key, nowMs + MOVEMENT_COMMAND_THROTTLE_MS);
    if (throttleState.size > 64) {
      for (const [entryKey, entryExpiresAtMs] of throttleState.entries()) {
        if ((Number(entryExpiresAtMs) || 0) <= nowMs) {
          throttleState.delete(entryKey);
        }
      }
    }
  }

  _throwStargateJumpUserError(errorMsg = "") {
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
      case "SHIP_ID_MISMATCH":
      case "WRONG_SOLAR_SYSTEM":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "STARGATE_NOT_FOUND":
      case "STARGATE_DESTINATION_MISMATCH":
        throwWrappedUserError("TargetingAttemptCancelled");
        break;
      case "TOO_FAR_FROM_STARGATE":
        throwWrappedUserError("CustomInfo", {
          info: [USER_ERROR_LOCALIZATION_LABEL, STARGATE_TOO_FAR_LABEL],
        });
        break;
      case "STARGATE_NOT_ACTIVE":
        throwWrappedUserError("CustomInfo", {
          info: [USER_ERROR_LOCALIZATION_LABEL, STARGATE_CLOSED_LABEL],
        });
        break;
      case "STARGATE_JUMP_IN_PROGRESS":
        throwWrappedUserError("CustomInfo", {
          info: "Stargate jump already in progress.",
        });
        break;
      case "STARGATE_JUMP_BLOCKED_BY_SCRIPTED_HIC":
        throwWrappedUserError("CustomInfo", {
          info: "Capital ships cannot use stargates while affected by a focused Heavy Interdictor disruption script.",
        });
        break;
      default:
        throwWrappedUserError("CustomInfo", {
          info: "The stargate jump could not be completed.",
        });
        break;
    }
  }

  _throwWarpFailureUserError(errorMsg = "") {
    switch (String(errorMsg || "").trim()) {
      case "CRIMINAL_TIMER_ACTIVE":
        throwWrappedUserError("CustomInfo", {
          info: CRIMEWATCH_WARP_BLOCKED_MESSAGE,
        });
        break;
      case "WARP_DISRUPTED_BY_BUBBLE":
        throwWrappedUserError("WarpDisrupted");
        break;
      case "WARP_SCRAMBLED":
        throwWrappedUserError("CustomNotify", {
          notify: "You cannot warp because you are warp scrambled.",
        });
        break;
      case "SHIP_IMMOBILE":
        throwWrappedUserError("CustomNotify", {
          notify: SHIP_IMMOBILE_WARP_BLOCKED_MESSAGE,
        });
        break;
      default:
        break;
    }
  }

  Handle_GetFormations(args, session) {
    // Docked structure exterior view is a view toggle, not a fresh space login.
    // The stock client may return to hangar without re-fetching hangar state,
    // so prepare a fresh exterior observer cache here and send the real
    // ballpark bootstrap only once Michelle completes MachoBindObject.
    const startedAtMs = Date.now();
    const prepared = prepareSessionBallpark(session);
    const elapsedMs = Date.now() - startedAtMs;
    if (
      typeof spaceRuntime.recordSessionJumpTimingTrace === "function"
    ) {
      spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-get-formations", {
        elapsedMs,
        prepared: prepared === true,
      });
    }
    if (elapsedMs >= 100) {
      log.info(`[Beyonce] GetFormations prepareSessionBallpark took ${elapsedMs}ms`);
    }

    const formations = [
      [
        "Diamond",
        [
          [100.0, 0.0, 0.0],
          [0.0, 100.0, 0.0],
          [-100.0, 0.0, 0.0],
          [0.0, -100.0, 0.0],
        ],
      ],
      [
        "Arrow",
        [
          [100.0, 0.0, -50.0],
          [50.0, 0.0, 0.0],
          [-100.0, 0.0, -50.0],
          [-50.0, 0.0, 0.0],
        ],
      ],
    ];
    return buildCachedMethodCallResult(formations, {
      serviceName: this.name,
      method: "GetFormations",
      versionCheck: "run",
      proxyCache: true,
    });
  }

  Handle_AdminGetBubbleID(args, session) {
    const itemID = normalizeNumber(args && args[0], 0);
    if (itemID <= 0) {
      return null;
    }

    if (!hasBeyonceViewRole(session)) {
      log.warn(
        `[Beyonce] AdminGetBubbleID denied for non-view session userId=${session && session.userid}`,
      );
      return null;
    }

    const bubbleID = spaceRuntime.getBubbleIDForEntity(session, itemID);
    log.debug(
      `[Beyonce] AdminGetBubbleID item=${itemID} -> ${bubbleID == null ? "null" : bubbleID}`,
    );
    return bubbleID;
  }

  Handle_GetCapacityOfSiphon(args, session) {
    void session;
    const itemID = normalizeNumber(args && args[0], 0);
    return mobileSiphonUnitRuntime.buildSiphonCapacityKeyVal(itemID);
  }

  Handle_UpdateStateRequest(args, session) {
    if (isDockedStructureObserverSession(session)) {
      const startedAtMs = Date.now();
      bootstrapSessionBallpark(session, {
        allowDeferredJumpBootstrapVisuals: true,
      });
      const elapsedMs = Date.now() - startedAtMs;
      if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
        spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-update-state-request", {
          elapsedMs,
          dockedStructureObserver: true,
        });
      }
      return null;
    }

    spaceRuntime.markBeyonceBound(session);
    const scene = spaceRuntime.getSceneForSession(session);
    const egoEntity = scene && scene.getShipEntityForSession(session);
    if (
      scene &&
      egoEntity &&
      session &&
      session._space &&
      session._space.initialStateSent
    ) {
      scene.sendStateRefresh(session, egoEntity);
      if (typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function") {
        scene.flushDirectDestinyNotificationBatchIfIdle();
      }
      return null;
    }

    const startedAtMs = Date.now();
    bootstrapSessionBallpark(session, {
      allowDeferredJumpBootstrapVisuals: true,
    });
    const elapsedMs = Date.now() - startedAtMs;
    if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
      spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-update-state-request", {
        elapsedMs,
        dockedStructureObserver: false,
      });
    }
    if (elapsedMs >= 100) {
      log.info(`[Beyonce] UpdateStateRequest bootstrap took ${elapsedMs}ms`);
    }
    return null;
  }

  Handle_GetCynoJammerState(args, session) {
    return getCynoJammerOnlineSimTime(getSessionSolarSystemID(session));
  }

  _jumpToFleetModuleBeacon(args, session, options = {}) {
    const {
      beaconID,
      beaconOwnerCharID,
      destinationSolarSystemID,
      fieldEntity,
      fieldTypeID,
    } = resolveFleetModuleBeacon(args, session);
    const {
      activeShip,
      distanceLy,
      fuelTypeID,
      fuelQuantity,
      resourceState,
    } = resolveActiveShipAndJumpDriveForCyno(
      session,
      destinationSolarSystemID,
      fieldTypeID,
    );
    const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
    throwIfJumpActivationActive(session);
    let consumedFuelQuantity = fuelQuantity;
    let conduitPlan = null;
    let conduitActivation = null;
    if (options.groupAnchor === true) {
      conduitActivation = resolveConduitJumpActivation(
        resourceState,
        distanceLy,
      );
      if (!conduitActivation.success) {
        throwCynoNotify("Your ship is not capable of performing a conduit jump.");
      }
      consumedFuelQuantity = conduitActivation.fuelQuantity;
      conduitPlan = buildConduitPassengerPlans({
        fleet: ensureFleetMembership(session),
        anchorSession: session,
        anchorEntity: shipEntity,
        destinationSolarSystemID,
        requiredPassengerAttributeID:
          conduitActivation.requiredPassengerAttributeID,
        passengerLimit: conduitActivation.passengerLimit,
        buildSpawnState: ({ passengerEntity, passengerShip }) =>
          buildFleetCynoArrivalSpawnState(
            fieldEntity,
            passengerShip,
            passengerEntity,
          ),
      });
      if (!conduitPlan.success) {
        throwConduitAnchorFailure(conduitPlan);
      }
    }
    const fuelResult = consumeJumpFuel(
      session,
      activeShip,
      shipEntity,
      fuelTypeID,
      consumedFuelQuantity,
    );
    const jumpResult = jumpSessionToSolarSystem(session, destinationSolarSystemID, {
      spawnStateOverride: buildFleetCynoArrivalSpawnState(
        fieldEntity,
        activeShip,
        shipEntity,
      ),
    });
    if (!jumpResult.success) {
      log.warn(
        `[Beyonce] fleet module cyno jump failed char=${session && session.characterID} ` +
          `beaconOwner=${beaconOwnerCharID} beacon=${beaconID}: ${jumpResult.errorMsg}`,
      );
      throwCynoNotify("The fleet cynosural beacon session change failed.");
    }
    applyJumpTimersBestEffort(session, {
      distanceLy,
      jumpFatigueMultiplier: resolveJumpFatigueMultiplier(resourceState),
    });

    let conduitPassengerResult = null;
    if (options.groupAnchor === true) {
      conduitPassengerResult = executeConduitPassengerJumps({
        plans: conduitPlan && Array.isArray(conduitPlan.plans)
          ? conduitPlan.plans
          : [],
        anchorCharacterID: session && session.characterID,
        destinationSolarSystemID,
        distanceLy,
        logPrefix: "Beyonce",
      });
      notifyGroupJumpAnchor(
        session,
        destinationSolarSystemID,
        conduitPassengerResult.successCount,
      );
    }

    log.info(
      `[Beyonce] char=${session && session.characterID} jumped fleetModuleCyno ` +
        `beaconOwner=${beaconOwnerCharID} beacon=${beaconID} type=${fieldTypeID} ` +
        `destination=${destinationSolarSystemID} fuelType=${fuelTypeID} ` +
        `fuel=${fuelResult.consumedQuantity || 0} distanceLy=${distanceLy.toFixed(6)} ` +
        `conduitPassengers=${conduitPassengerResult ? conduitPassengerResult.successCount : 0} ` +
        `conduitLimit=${conduitActivation ? conduitActivation.passengerLimit : 0}`,
    );
    return jumpResult.data.boundResult || true;
  }

  _jumpToFleetDeployableBeacon(args, session, options = {}) {
    const {
      beaconID,
      deployableID,
      destinationSolarSystemID,
      fieldEntity,
      fieldTypeID,
      fleet,
      ownerID,
    } = resolveFleetDeployableBeacon(args, session);
    const {
      activeShip,
      distanceLy,
      fuelTypeID,
      fuelQuantity,
      resourceState,
    } = resolveActiveShipAndJumpDriveForCyno(
      session,
      destinationSolarSystemID,
      fieldTypeID,
    );
    const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
    throwIfJumpActivationActive(session);
    let consumedFuelQuantity = fuelQuantity;
    let conduitPlan = null;
    let conduitActivation = null;
    const spawnOptions = {
      anchorType: "fleetDeployableCynoBeacon",
      fallbackName: "Mobile Cynosural Beacon",
    };
    if (options.groupAnchor === true) {
      conduitActivation = resolveConduitJumpActivation(
        resourceState,
        distanceLy,
      );
      if (!conduitActivation.success) {
        throwCynoNotify("Your ship is not capable of performing a conduit jump.");
      }
      consumedFuelQuantity = conduitActivation.fuelQuantity;
      conduitPlan = buildConduitPassengerPlans({
        fleet,
        anchorSession: session,
        anchorEntity: shipEntity,
        destinationSolarSystemID,
        requiredPassengerAttributeID:
          conduitActivation.requiredPassengerAttributeID,
        passengerLimit: conduitActivation.passengerLimit,
        buildSpawnState: ({ passengerEntity, passengerShip }) =>
          buildFleetCynoArrivalSpawnState(
            fieldEntity,
            passengerShip,
            passengerEntity,
            spawnOptions,
          ),
      });
      if (!conduitPlan.success) {
        throwConduitAnchorFailure(conduitPlan);
      }
    }
    const fuelResult = consumeJumpFuel(
      session,
      activeShip,
      shipEntity,
      fuelTypeID,
      consumedFuelQuantity,
    );
    const jumpResult = jumpSessionToSolarSystem(session, destinationSolarSystemID, {
      spawnStateOverride: buildFleetCynoArrivalSpawnState(
        fieldEntity,
        activeShip,
        shipEntity,
        spawnOptions,
      ),
    });
    if (!jumpResult.success) {
      log.warn(
        `[Beyonce] fleet deployable cyno jump failed char=${session && session.characterID} ` +
          `deployable=${deployableID} beacon=${beaconID}: ${jumpResult.errorMsg}`,
      );
      throwCynoNotify("The fleet deployable cynosural beacon session change failed.");
    }
    applyJumpTimersBestEffort(session, {
      distanceLy,
      jumpFatigueMultiplier: resolveJumpFatigueMultiplier(resourceState),
    });

    let conduitPassengerResult = null;
    if (options.groupAnchor === true) {
      conduitPassengerResult = executeConduitPassengerJumps({
        plans: conduitPlan && Array.isArray(conduitPlan.plans)
          ? conduitPlan.plans
          : [],
        anchorCharacterID: session && session.characterID,
        destinationSolarSystemID,
        distanceLy,
        logPrefix: "Beyonce",
      });
      notifyGroupJumpAnchor(
        session,
        destinationSolarSystemID,
        conduitPassengerResult.successCount,
      );
    }

    log.info(
      `[Beyonce] char=${session && session.characterID} jumped fleetDeployableCyno ` +
        `deployable=${deployableID} beacon=${beaconID} owner=${ownerID} type=${fieldTypeID} ` +
        `destination=${destinationSolarSystemID} fuelType=${fuelTypeID} ` +
        `fuel=${fuelResult.consumedQuantity || 0} distanceLy=${distanceLy.toFixed(6)} ` +
        `conduitPassengers=${conduitPassengerResult ? conduitPassengerResult.successCount : 0} ` +
        `conduitLimit=${conduitActivation ? conduitActivation.passengerLimit : 0}`,
    );
    return jumpResult.data.boundResult || true;
  }

  Handle_CmdJumpToFleetModuleBeacon(args, session) {
    return this._jumpToFleetModuleBeacon(args, session);
  }

  Handle_CmdGroupJumpToFleetModuleBeacon(args, session) {
    return this._jumpToFleetModuleBeacon(args, session, {
      groupAnchor: true,
    });
  }

  Handle_CmdBridgeToFleetModuleBeacon(args, session) {
    const {
      beaconID,
      beaconOwnerCharID,
      destinationSolarSystemID,
      fieldTypeID,
    } = resolveFleetModuleBeacon(args, session);
    const {
      activeShip,
      distanceLy,
      fuelTypeID,
      fuelQuantity,
    } = resolveActiveShipAndJumpDriveForCyno(
      session,
      destinationSolarSystemID,
      fieldTypeID,
    );
    const portal = resolveBridgePortalModule(
      session && session.characterID,
      activeShip,
      fieldTypeID,
    );
    const activationResult = spaceRuntime.activateGenericModule(
      session,
      portal.portalModuleItem,
      getBridgePortalEffectName(portal.portalModuleItem),
      {
        repeat: 1,
      },
    );
    if (!activationResult.success) {
      if (activationResult.errorMsg === "NOT_ENOUGH_CAPACITOR") {
        throwCynoNotify("The bridge ship does not have enough capacitor to activate the jump portal.");
      }
      if (activationResult.errorMsg === "NO_FUEL") {
        throwCynoNotify("The bridge ship does not have enough jump portal activation fuel.");
      }
      if (activationResult.errorMsg === "MODULE_ALREADY_ACTIVE") {
        throwCynoNotify("That jump portal generator is already active.");
      }
      throwCynoNotify("The jump portal generator could not be activated.");
    }
    const effectState =
      activationResult.data && activationResult.data.effectState
        ? activationResult.data.effectState
        : null;
    if (effectState) {
      effectState.autoDeactivateAtCycleEnd = true;
      effectState.jumpPortalBridgeMode = {
        fleetID: session && session.fleetid,
        shipID: activeShip.itemID,
        solarsystemID: destinationSolarSystemID,
        itemID: beaconID,
      };
    }
    fleetRuntime.setBridgeMode(
      session.fleetid,
      activeShip.itemID,
      destinationSolarSystemID,
      beaconID,
      true,
    );
    notifyGroupJumpAnchor(session, destinationSolarSystemID, 0);
    log.info(
      `[Beyonce] char=${session && session.characterID} opened fleet module bridge ` +
        `ship=${activeShip.itemID} beaconOwner=${beaconOwnerCharID} beacon=${beaconID} ` +
        `destination=${destinationSolarSystemID} portalModule=${portal.portalModuleItem.itemID} ` +
        `portalType=${portal.portalModuleItem.typeID} fuelType=${fuelTypeID} ` +
        `portalEffect=${effectState ? effectState.effectName : getBridgePortalEffectName(portal.portalModuleItem)} ` +
        `activationCap=${effectState ? effectState.capNeed || 0 : 0} ` +
        `activationFuelType=${effectState ? effectState.fuelTypeID || 0 : 0} ` +
        `activationFuel=${effectState ? effectState.fuelPerActivation || 0 : 0} ` +
        `passengerFuelEstimate=${fuelQuantity} distanceLy=${distanceLy.toFixed(6)}`,
    );
    return true;
  }

  Handle_CmdJumpThroughFleet(args, session) {
    const bridgeJump = resolveFleetBridgePassengerJump(args, session);
    throwIfJumpActivationActive(session);
    const fuelResult = consumeBridgeFuel(
      bridgeJump.bridgeOwnerCharID,
      bridgeJump.bridgeShip,
      bridgeJump.bridgeEntity,
      bridgeJump.fuelTypeID,
      bridgeJump.fuelQuantity,
    );
    const jumpResult = jumpSessionToSolarSystem(
      session,
      bridgeJump.destinationSolarSystemID,
      {
        spawnStateOverride: buildFleetCynoArrivalSpawnState(
          bridgeJump.fieldEntity,
          bridgeJump.passengerShip,
          bridgeJump.passengerEntity,
          {
            anchorType: bridgeJump.bridgeDestination.anchorType,
            fallbackName: bridgeJump.bridgeDestination.anchorFallbackName,
          },
        ),
      },
    );
    if (!jumpResult.success) {
      log.warn(
        `[Beyonce] fleet bridge passenger jump failed char=${session && session.characterID} ` +
          `bridgeChar=${bridgeJump.bridgeOwnerCharID} beacon=${bridgeJump.beaconID}: ` +
          jumpResult.errorMsg,
      );
      throwCynoNotify("The fleet bridge session change failed.");
    }
    applyJumpTimersBestEffort(session, {
      distanceLy: bridgeJump.distanceLy,
      jumpFatigueMultiplier: bridgeJump.jumpFatigueMultiplier,
    });
    log.info(
      `[Beyonce] char=${session && session.characterID} jumped through fleet bridge ` +
        `bridgeChar=${bridgeJump.bridgeOwnerCharID} bridgeShip=${bridgeJump.bridgeShip.itemID} ` +
        `beacon=${bridgeJump.beaconID} target=${bridgeJump.bridgeDestination.kind} ` +
        `type=${bridgeJump.fieldTypeID} ` +
        `destination=${bridgeJump.destinationSolarSystemID} fuelType=${bridgeJump.fuelTypeID} ` +
        `fuel=${fuelResult.consumedQuantity || 0} passengerMass=${bridgeJump.passengerMass} ` +
        `rangeMeters=${bridgeJump.bridgeDistanceMeters.toFixed(2)} ` +
        `distanceLy=${bridgeJump.distanceLy.toFixed(6)}`,
    );
    return jumpResult.data.boundResult || true;
  }

  Handle_CmdJumpToFleetDeployableBeacon(args, session) {
    return this._jumpToFleetDeployableBeacon(args, session);
  }

  Handle_CmdGroupJumpToFleetDeployableBeacon(args, session) {
    return this._jumpToFleetDeployableBeacon(args, session, {
      groupAnchor: true,
    });
  }

  Handle_CmdBridgeToFleetDeployableBeacon(args, session) {
    const {
      beaconID,
      deployableEntity,
      deployableID,
      destinationSolarSystemID,
      fieldTypeID,
      ownerID,
    } = resolveFleetDeployableBeacon(args, session);
    const {
      activeShip,
      distanceLy,
      fuelTypeID,
      fuelQuantity,
    } = resolveActiveShipAndJumpDriveForCyno(
      session,
      destinationSolarSystemID,
      fieldTypeID,
    );
    const portal = resolveBridgePortalModule(
      session && session.characterID,
      activeShip,
      fieldTypeID,
    );
    const activationResult = spaceRuntime.activateGenericModule(
      session,
      portal.portalModuleItem,
      getBridgePortalEffectName(portal.portalModuleItem),
      {
        repeat: 1,
      },
    );
    if (!activationResult.success) {
      if (activationResult.errorMsg === "NOT_ENOUGH_CAPACITOR") {
        throwCynoNotify("The bridge ship does not have enough capacitor to activate the jump portal.");
      }
      if (activationResult.errorMsg === "NO_FUEL") {
        throwCynoNotify("The bridge ship does not have enough jump portal activation fuel.");
      }
      if (activationResult.errorMsg === "MODULE_ALREADY_ACTIVE") {
        throwCynoNotify("That jump portal generator is already active.");
      }
      throwCynoNotify("The jump portal generator could not be activated.");
    }
    const bridgeItemID = deployableEntity ? deployableID : beaconID;
    const effectState =
      activationResult.data && activationResult.data.effectState
        ? activationResult.data.effectState
        : null;
    if (effectState) {
      effectState.autoDeactivateAtCycleEnd = true;
      effectState.jumpPortalBridgeMode = {
        fleetID: session && session.fleetid,
        shipID: activeShip.itemID,
        solarsystemID: destinationSolarSystemID,
        itemID: bridgeItemID,
      };
    }
    fleetRuntime.setBridgeMode(
      session.fleetid,
      activeShip.itemID,
      destinationSolarSystemID,
      bridgeItemID,
      true,
    );
    notifyGroupJumpAnchor(session, destinationSolarSystemID, 0);
    log.info(
      `[Beyonce] char=${session && session.characterID} opened fleet deployable bridge ` +
        `ship=${activeShip.itemID} deployable=${deployableID} beacon=${beaconID} ` +
        `bridgeItem=${bridgeItemID} owner=${ownerID} destination=${destinationSolarSystemID} ` +
        `portalModule=${portal.portalModuleItem.itemID} portalType=${portal.portalModuleItem.typeID} ` +
        `fuelType=${fuelTypeID} ` +
        `portalEffect=${effectState ? effectState.effectName : getBridgePortalEffectName(portal.portalModuleItem)} ` +
        `activationCap=${effectState ? effectState.capNeed || 0 : 0} ` +
        `activationFuelType=${effectState ? effectState.fuelTypeID || 0 : 0} ` +
        `activationFuel=${effectState ? effectState.fuelPerActivation || 0 : 0} ` +
        `passengerFuelEstimate=${fuelQuantity} distanceLy=${distanceLy.toFixed(6)}`,
    );
    return true;
  }

  Handle_CallComponentFromClient(args, session) {
    const itemID = normalizeNumber(args && args[0], 0);
    const componentName = normalizeText(args && args[1], "");
    const methodName = normalizeText(args && args[2], "");

    if (
      componentName === "microJumpDriver" &&
      methodName === "StartMicroJumpDriveForShip"
    ) {
      const result = mobileMicroJumpUnitRuntime.startMobileMicroJumpDriveForShip(
        session,
        itemID,
      );
      if (!result || result.success !== true) {
        log.info(
          `[Beyonce] CallComponentFromClient rejected component=${componentName} method=${methodName} item=${itemID} char=${session && session.characterID} reason=${result ? result.errorMsg : "UNKNOWN"}`,
        );
      }
      return null;
    }

    if (
      componentName === "linkWithShip" &&
      (methodName === "InitiateLink" || methodName === "InitiateLinkQuick")
    ) {
      const result = mobileAnalysisBeaconRuntime.initiateMobileAnalysisBeaconLink(
        session,
        itemID,
        { quick: methodName === "InitiateLinkQuick" },
      );
      if (!result || result.success !== true) {
        log.info(
          `[Beyonce] CallComponentFromClient rejected component=${componentName} method=${methodName} item=${itemID} char=${session && session.characterID} reason=${result ? result.errorMsg : "UNKNOWN"}`,
        );
      }
      return null;
    }

    log.info(
      `[Beyonce] Unsupported CallComponentFromClient component=${componentName} method=${methodName} item=${itemID} char=${session && session.characterID}`,
    );
    return null;
  }

  Handle_CmdGotoDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);
    this._enforceMovementCommandThrottle(session, "CmdGotoDirection", [x, y, z]);

    log.info(
      `[Beyonce] CmdGotoDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z }, {
      commandSource: "CmdGotoDirection",
      ownerLocallyPredictsHeading: false,
    });
    return null;
  }

  Handle_CmdSteerDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);
    this._enforceMovementCommandThrottle(session, "CmdSteerDirection", [x, y, z]);

    log.info(
      `[Beyonce] CmdSteerDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z }, {
      commandSource: "CmdSteerDirection",
      ownerLocallyPredictsHeading: true,
    });
    return null;
  }

  Handle_CmdGotoPoint(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);
    this._enforceMovementCommandThrottle(session, "CmdGotoPoint", [x, y, z]);

    log.info(
      `[Beyonce] CmdGotoPoint char=${session && session.characterID} point=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoPoint(session, { x, y, z });
    return null;
  }

  Handle_CmdGotoBookmark(args, session) {
    const bookmarkID = normalizeNumber(args && args[0], 0);
    const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
    log.info(
      `[Beyonce] CmdGotoBookmark char=${session && session.characterID} bookmark=${bookmarkID}`,
    );
    if (!bookmark) {
      throwWrappedUserError("BookmarkNotAvailable");
    }

    const targetID = normalizeNumber(bookmark.itemID, 0);
    if (targetID > 0) {
      const scene = spaceRuntime.getSceneForSession(session);
      const entity =
        scene && typeof scene.getEntityByID === "function"
          ? scene.getEntityByID(targetID)
          : null;
      if (entity) {
        spaceRuntime.followBall(session, targetID, 0);
        return null;
      }
    }

    const point = {
      x: normalizeNumber(bookmark.x, 0),
      y: normalizeNumber(bookmark.y, 0),
      z: normalizeNumber(bookmark.z, 0),
    };
    if (point.x !== 0 || point.y !== 0 || point.z !== 0) {
      spaceRuntime.gotoPoint(session, point, {
        commandSource: "CmdGotoBookmark",
      });
      return null;
    }

    throwWrappedUserError("BookmarkNotAvailable");
  }

  Handle_CmdAlignTo(args, session, kwargs) {
    const positionalTargetID = normalizeNumber(args && args[0], 0);
    const kwargTargetID = normalizeNumber(getKwargValue(kwargs, "dstID"), 0);
    const bookmarkID = normalizeNumber(getKwargValue(kwargs, "bookmarkID"), 0);
    const targetID =
      positionalTargetID ||
      kwargTargetID ||
      resolveBookmarkAlignTarget(session, bookmarkID);
    log.info(
      `[Beyonce] CmdAlignTo char=${session && session.characterID} target=${targetID} bookmark=${bookmarkID}`,
    );

    if (targetID > 0) {
      spaceRuntime.alignTo(session, targetID);
      return null;
    }

    if (bookmarkID > 0) {
      const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
      if (bookmark) {
        const point = {
          x: normalizeNumber(bookmark.x, 0),
          y: normalizeNumber(bookmark.y, 0),
          z: normalizeNumber(bookmark.z, 0),
        };
        if (point.x !== 0 || point.y !== 0 || point.z !== 0) {
          spaceRuntime.gotoPoint(session, point, {
            commandSource: "CmdAlignToBookmark",
          });
          return null;
        }
      }
    }

    spaceRuntime.alignTo(session, targetID);
    return null;
  }

  Handle_CmdFollowBall(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    this._enforceMovementCommandThrottle(session, "CmdFollowBall", [targetID, range]);
    log.info(
      `[Beyonce] CmdFollowBall char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    if (targetID > 0 && range <= 50) {
      const dockingDebug = spaceRuntime.getDockingDebugState(session, targetID);
      if (dockingDebug) {
        log.info(`[Beyonce] CmdFollowBall dockingState=${JSON.stringify(dockingDebug)}`);
      }
    }

    spaceRuntime.followBall(session, targetID, range);
    return null;
  }

  Handle_CmdOrbit(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    this._enforceMovementCommandThrottle(session, "CmdOrbit", [targetID, range]);
    log.info(
      `[Beyonce] CmdOrbit char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    spaceRuntime.orbit(session, targetID, range);
    return null;
  }

  Handle_CmdSetSpeedFraction(args, session) {
    const fraction = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdSetSpeedFraction char=${session && session.characterID} fraction=${fraction}`,
    );
    spaceRuntime.setSpeedFraction(session, fraction);
    return null;
  }

  Handle_CmdStop(args, session) {
    this._enforceMovementCommandThrottle(session, "CmdStop");
    log.info(`[Beyonce] CmdStop char=${session && session.characterID}`);
    const activeWarp = this._isSessionShipInActiveWarp(session);
    spaceRuntime.stop(session);
    if (activeWarp) {
      this._notifyShipInWarpRemoteMessage(session);
    }
    return null;
  }

  Handle_CmdAbandonLoot(args, session) {
    const itemIDs =
      args && Array.isArray(args[0])
        ? args[0]
        : args && args[0] !== null && args[0] !== undefined
          ? [args[0]]
          : [];
    log.info(
      `[Beyonce] CmdAbandonLoot char=${session && session.characterID} count=${itemIDs.length}`,
    );
    spaceRuntime.abandonInventoryLootForSession(session, itemIDs);
    return null;
  }

  Handle_CmdFleetTagTarget(args, session) {
    const itemID = normalizeNumber(args && args[0], 0);
    const tag = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Beyonce] CmdFleetTagTarget char=${session && session.characterID} item=${itemID} tag=${tag === null || tag === undefined ? "<clear>" : String(tag)}`,
    );
    fleetRuntime.setFleetTargetTag(session, itemID, tag);
    return null;
  }

  Handle_CmdWarpToStuff(args, session, kwargs) {
    const warpType = String(args && args[0] ? args[0] : "");
    const rawTarget = args && args.length > 1 ? args[1] : null;
    const numericTarget = normalizeNumber(rawTarget, 0);
    const minimumRange = normalizeNumber(getKwargValue(kwargs, "minRange"), 0);
    // The client sets fleet=True for "Warp Fleet/Wing/Squad" commands
    // (movementFunctions.WarpFleet -> michelle.CmdWarpToStuff(..., fleet=True)).
    const fleetWarpRequested = Boolean(getKwargValue(kwargs, "fleet"));

    log.info(
      `[Beyonce] CmdWarpToStuff char=${session && session.characterID} type=${warpType} target=${numericTarget || rawTarget} minRange=${minimumRange}${fleetWarpRequested ? " fleet=1" : ""}`,
    );

    let result = null;
    if (warpType === "scan" && rawTarget !== null && rawTarget !== undefined) {
      const scanTarget = resolveScanWarpTarget(session, rawTarget);
      if (scanTarget && scanTarget.kind === "entity") {
        result = spaceRuntime.warpToEntity(session, scanTarget.entityID, {
          minimumRange,
        });
      } else if (scanTarget && scanTarget.kind === "point") {
        result = spaceRuntime.warpToPoint(session, scanTarget.point, {
          minimumRange,
          stopDistance: minimumRange,
        });
      } else if (numericTarget > 0) {
        result = spaceRuntime.warpToEntity(session, numericTarget, { minimumRange });
      } else {
        result = {
          success: false,
          errorMsg: "SCAN_TARGET_NOT_FOUND",
        };
      }
    } else if (warpType === "launch" && numericTarget > 0) {
      const launch = planetRuntimeStore.getLaunch(
        numericTarget,
        session && session.characterID,
      );
      if (launch) {
        const launchItemID = normalizeNumber(launch.itemID || launch.launchID, 0);
        if (launchItemID > 0) {
          result = spaceRuntime.warpToEntity(session, launchItemID, { minimumRange });
        }
        if (!result || !result.success) {
          result = spaceRuntime.warpToPoint(session, {
            x: normalizeNumber(launch.x, 0),
            y: normalizeNumber(launch.y, 0),
            z: normalizeNumber(launch.z, 0),
          }, {
            minimumRange,
            stopDistance: minimumRange,
          });
        }
      } else {
        result = spaceRuntime.warpToEntity(session, numericTarget, { minimumRange });
      }
    } else if (warpType === WARP_SUBJECT_OPERATION_DUNGEON) {
      const operationPoint = resolveOperationDungeonWarpPoint(session, numericTarget);
      if (operationPoint) {
        result = spaceRuntime.warpToPoint(session, operationPoint, {
          minimumRange,
          stopDistance: minimumRange,
        });
      } else {
        result = {
          success: false,
          errorMsg: "OPERATION_SITE_NOT_FOUND",
        };
      }
    } else if (DUNGEON_INSTANCE_WARP_SUBJECTS.has(warpType)) {
      const dungeonInstanceID = extractDungeonInstanceID(rawTarget);
      const materializedInstanceTarget = maybeMaterializeUniverseSiteInstanceTarget(
        session,
        dungeonInstanceID,
      );
      if (materializedInstanceTarget) {
        result = spaceRuntime.warpToEntity(
          session,
          materializedInstanceTarget.entityID,
          { minimumRange },
        );
      } else {
        result = {
          success: false,
          errorMsg: "DUNGEON_INSTANCE_NOT_FOUND",
        };
      }
    } else if (warpType === "char" && numericTarget > 0) {
      const fleetMemberTarget = resolveFleetMemberWarpTarget(session, numericTarget);
      if (fleetMemberTarget && fleetMemberTarget.kind === "entity") {
        result = spaceRuntime.warpToEntity(
          session,
          fleetMemberTarget.entityID,
          { minimumRange },
        );
      } else if (fleetMemberTarget && fleetMemberTarget.kind === "point") {
        result = spaceRuntime.warpToPoint(session, fleetMemberTarget.point, {
          minimumRange,
          stopDistance: minimumRange,
        });
      } else {
        result = {
          success: false,
          errorMsg: "FLEET_MEMBER_WARP_TARGET_NOT_FOUND",
        };
      }
    } else if ((warpType === "item" || !warpType) && numericTarget > 0) {
      const scene = spaceRuntime.getSceneForSession(session);
      const entity =
        scene && typeof scene.getEntityByID === "function"
          ? scene.getEntityByID(numericTarget)
          : null;
      if (
        entity &&
        (
          entity.signalTrackerUniverseSeededSite === true ||
          String(entity.kind || "").trim() === "missionSite"
        )
      ) {
        ensureUniverseSiteContentsMaterialized(scene, {
          siteID: numericTarget,
        }, {
          spawnEncounters: true,
          broadcast: true,
          session,
        });
      }
      const materializedInstanceTarget = entity
        ? null
        : maybeMaterializeUniverseSiteInstanceTarget(session, numericTarget);
      result = spaceRuntime.warpToEntity(
        session,
        materializedInstanceTarget
          ? materializedInstanceTarget.entityID
          : numericTarget,
        { minimumRange },
      );
    } else if (warpType === "bookmark" && numericTarget > 0) {
      const bookmark = resolveBookmarkAnyStore(session, numericTarget);
      if (!bookmark) {
        throwWrappedUserError("BookmarkNotAvailable");
      }

      const bookmarkItemID = normalizeNumber(bookmark.itemID, 0);
      if (bookmarkItemID > 0) {
        result = spaceRuntime.warpToEntity(session, bookmarkItemID, { minimumRange });
        if ((!result || !result.success) &&
          (
            normalizeNumber(bookmark.x, 0) !== 0 ||
            normalizeNumber(bookmark.y, 0) !== 0 ||
            normalizeNumber(bookmark.z, 0) !== 0
          )
        ) {
          result = spaceRuntime.warpToPoint(session, {
            x: normalizeNumber(bookmark.x, 0),
            y: normalizeNumber(bookmark.y, 0),
            z: normalizeNumber(bookmark.z, 0),
          }, {
            minimumRange,
          });
        }
      } else {
        result = spaceRuntime.warpToPoint(session, {
          x: normalizeNumber(bookmark.x, 0),
          y: normalizeNumber(bookmark.y, 0),
          z: normalizeNumber(bookmark.z, 0),
        }, {
          minimumRange,
        });
      }
    } else if (
      rawTarget &&
      typeof rawTarget === "object" &&
      rawTarget.x !== undefined &&
      rawTarget.y !== undefined &&
      rawTarget.z !== undefined
    ) {
      result = spaceRuntime.warpToPoint(session, rawTarget, { minimumRange });
    } else {
      result = {
        success: false,
        errorMsg: "UNSUPPORTED_WARP_TARGET",
      };
    }

    if (!result || !result.success) {
      log.warn(
        `[Beyonce] CmdWarpToStuff failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
      this._throwWarpFailureUserError(result && result.errorMsg);
    } else if (fleetWarpRequested) {
      this._warpFleetFollowers(session, result, {
        minimumRange,
        formationSettings: getKwargValue(kwargs, "fleetFormationSettings"),
      });
    }

    return null;
  }

  // Pull the issuing commander's fleet/wing/squad along on a fleet warp. The
  // commander has already been warped through the normal path; this warps every
  // subordinate member who is in the same solar system and accepts fleet warp to
  // the same destination, each computing their own warp-in for their own ship.
  _warpFleetFollowers(commanderSession, leaderResult, options = {}) {
    const commanderCharID = normalizeNumber(
      commanderSession &&
        (commanderSession.characterID || commanderSession.charID),
      0,
    );
    if (commanderCharID <= 0) {
      return 0;
    }

    const pendingWarp =
      leaderResult && leaderResult.data && typeof leaderResult.data === "object"
        ? leaderResult.data
        : null;
    const targetEntityID = pendingWarp
      ? normalizeNumber(pendingWarp.targetEntityID, 0)
      : 0;
    const rawDestination =
      pendingWarp &&
      pendingWarp.rawDestination &&
      typeof pendingWarp.rawDestination === "object"
        ? pendingWarp.rawDestination
        : null;
    const stopDistance = pendingWarp
      ? normalizeNumber(pendingWarp.stopDistance, 0)
      : 0;
    if (targetEntityID <= 0 && !rawDestination) {
      return 0;
    }

    const minimumRange = normalizeNumber(options.minimumRange, 0);
    const commanderSystemID = normalizeNumber(
      commanderSession &&
        (commanderSession.solarsystemid2 || commanderSession.solarsystemid),
      0,
    );

    let followers = [];
    try {
      followers = fleetRuntime.collectFleetWarpFollowers(commanderCharID) || [];
    } catch (error) {
      log.warn(
        `[Beyonce] Fleet warp follower lookup failed for char=${commanderCharID}: ${error.message}`,
      );
      return 0;
    }

    // Members sharing the commander's grid are the ones a fleet warp pulls.
    const eligibleFollowers = followers.filter((follower) => {
      const followerSession = follower && follower.session;
      if (!followerSession) {
        return false;
      }
      const followerSystemID = normalizeNumber(
        followerSession.solarsystemid2 || followerSession.solarsystemid,
        0,
      );
      return !(
        commanderSystemID > 0 &&
        followerSystemID > 0 &&
        followerSystemID !== commanderSystemID
      );
    });

    const formationPoints = this._resolveFleetWarpFormationPoints(
      commanderSession,
      eligibleFollowers,
      { pendingWarp, formationSettings: options.formationSettings },
    );

    let warpedCount = 0;
    for (const follower of eligibleFollowers) {
      const followerSession = follower.session;
      const formationPoint = formationPoints.get(
        normalizeNumber(follower.characterID, 0),
      );

      let followerResult = null;
      if (formationPoint) {
        // Formation warp positions each member at a computed offset point, so
        // the per-ship stop distance is replaced by the formation slot.
        followerResult = spaceRuntime.warpToPoint(followerSession, formationPoint, {
          stopDistance: 0,
        });
      } else if (targetEntityID > 0) {
        followerResult = spaceRuntime.warpToEntity(
          followerSession,
          targetEntityID,
          { minimumRange },
        );
      } else if (rawDestination) {
        followerResult = spaceRuntime.warpToPoint(followerSession, rawDestination, {
          minimumRange,
          stopDistance,
        });
      }

      if (followerResult && followerResult.success) {
        warpedCount += 1;
        this._notifyFleetWarpRemoteMessage(followerSession, targetEntityID);
      }
    }

    if (warpedCount > 0) {
      log.info(
        `[Beyonce] Fleet warp pulled ${warpedCount} member(s) for commander char=${commanderCharID}` +
          `${formationPoints.size > 0 ? ` in formation` : ""}`,
      );
    }
    return warpedCount;
  }

  // Resolve a per-follower formation landing point from the client's
  // fleetFormationSettings. Returns an empty Map for POINT / no settings (the
  // caller then falls back to the normal stack-on-target warp).
  _resolveFleetWarpFormationPoints(commanderSession, followers, context = {}) {
    const empty = new Map();
    const settings = resolveFormationSettings(context.formationSettings);
    const pendingWarp = context.pendingWarp || null;
    const anchorPoint =
      pendingWarp &&
      pendingWarp.targetPoint &&
      typeof pendingWarp.targetPoint === "object"
        ? pendingWarp.targetPoint
        : pendingWarp && pendingWarp.rawDestination;
    if (!settings || !anchorPoint || followers.length === 0) {
      return empty;
    }

    const scene = spaceRuntime.getSceneForSession(commanderSession);
    const getShipEntity =
      scene && typeof scene.getShipEntityForSession === "function"
        ? (targetSession) => scene.getShipEntityForSession(targetSession)
        : null;

    const commanderEntity = getShipEntity ? getShipEntity(commanderSession) : null;
    const commanderPosition = commanderEntity && commanderEntity.position;
    const warpDirection = commanderPosition
      ? {
          x: normalizeNumber(anchorPoint.x, 0) - normalizeNumber(commanderPosition.x, 0),
          y: normalizeNumber(anchorPoint.y, 0) - normalizeNumber(commanderPosition.y, 0),
          z: normalizeNumber(anchorPoint.z, 0) - normalizeNumber(commanderPosition.z, 0),
        }
      : null;

    // Stable slot order so a member always lands in the same formation slot.
    const orderedFollowers = followers
      .map((follower) => {
        const followerEntity = getShipEntity
          ? getShipEntity(follower.session)
          : null;
        return {
          characterID: normalizeNumber(follower.characterID, 0),
          position: followerEntity && followerEntity.position,
        };
      })
      .sort((left, right) => left.characterID - right.characterID);

    return computeFleetWarpFormationPoints({
      anchorPoint,
      warpDirection,
      anchorPosition: commanderPosition,
      formationType: settings.formationType,
      spacingMeters: settings.spacingMeters,
      sizeMeters: settings.sizeMeters,
      followers: orderedFollowers,
    });
  }

  // Tell a pulled member's client a fleet warp is in progress so it cancels its
  // local autopilot navigation and updates the warp-destination cache
  // (spaceMgr/autopilot OnRemoteMessage('FleetWarp') handlers in the client).
  _notifyFleetWarpRemoteMessage(session, celestialID) {
    if (!session || typeof session.sendNotification !== "function") {
      return;
    }
    const warpInfoDict = {
      type: "dict",
      entries:
        normalizeNumber(celestialID, 0) > 0
          ? [["celestialID", normalizeNumber(celestialID, 0)]]
          : [],
    };
    try {
      session.sendNotification("OnRemoteMessage", "clientID", [
        "FleetWarp",
        warpInfoDict,
      ]);
    } catch (error) {
      log.warn(
        `[Beyonce] Fleet warp remote message failed for char=${session && session.characterID}: ${error.message}`,
      );
    }
  }

  _notifyShipInWarpRemoteMessage(session) {
    if (!session || typeof session.sendNotification !== "function") {
      return false;
    }
    try {
      session.sendNotification("OnRemoteMessage", "clientID", [
        "ShipInWarp",
        null,
      ]);
      return true;
    } catch (error) {
      log.warn(
        `[Beyonce] ShipInWarp remote message failed for char=${session && session.characterID}: ${error.message}`,
      );
      return false;
    }
  }

  _isSessionShipInActiveWarp(session) {
    const scene = spaceRuntime.getSceneForSession(session);
    const entity =
      scene && typeof scene.getShipEntityForSession === "function"
        ? scene.getShipEntityForSession(session)
        : null;
    return Boolean(
      entity &&
      entity.mode === "WARP" &&
      entity.warpState &&
      !entity.pendingWarp,
    );
  }

  Handle_CmdWarpToStuffAutopilot(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdWarpToStuffAutopilot char=${session && session.characterID} target=${targetID}`,
    );
    const result = spaceRuntime.warpToEntity(session, targetID, { minimumRange: 10000 });
    if (!result || !result.success) {
      log.warn(
        `[Beyonce] CmdWarpToStuffAutopilot failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
      this._throwWarpFailureUserError(result && result.errorMsg);
    }
    return null;
  }

  Handle_CmdDock(args, session) {
    const stationID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdDock char=${session && session.characterID} station=${stationID}`,
    );
    const dockingDebug = spaceRuntime.getDockingDebugState(session, stationID);
    if (dockingDebug) {
      log.info(`[Beyonce] CmdDock state=${JSON.stringify(dockingDebug)}`);
    }

    if (!spaceRuntime.canDockAtStation(session, stationID)) {
      log.info(
        `[Beyonce] CmdDock converting to docking approach for char=${session && session.characterID} station=${stationID}`,
      );
      const followed = spaceRuntime.followBall(session, stationID, 2500, {
        dockingTargetID: stationID,
      });
      if (!followed) {
        log.info(
          `[Beyonce] CmdDock keeping existing docking approach for char=${session && session.characterID} station=${stationID}`,
        );
      }
      throwWrappedUserError(
        "DockingApproach",
        buildDockingApproachUserErrorValues(dockingDebug),
      );
    }

    const result = spaceRuntime.acceptDocking(session, stationID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdDock failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      return null;
    }

    return result.data.acceptedAtFileTime || null;
  }

  Handle_CmdStargateJump(args, session) {
    const fromStargateID = normalizeNumber(args && args[0], 0);
    const toStargateID = normalizeNumber(args && args[1], 0);
    const requestedShipID =
      args && args.length > 2 ? normalizeNumber(args[2], 0) : 0;
    const activeShipID = normalizeNumber(
      session && (
        session.shipID ||
        session.shipid ||
        session.activeShipID ||
        (session._space && session._space.shipID)
      ),
      0,
    );
    log.info(
      `[Beyonce] CmdStargateJump char=${session && session.characterID} from=${fromStargateID} to=${toStargateID} ship=${requestedShipID || activeShipID || 0}`,
    );
    if (
      requestedShipID > 0 &&
      activeShipID > 0 &&
      requestedShipID !== activeShipID
    ) {
      log.warn(
        `[Beyonce] CmdStargateJump rejected ship mismatch char=${session && session.characterID} requested=${requestedShipID} active=${activeShipID}`,
      );
      this._throwStargateJumpUserError("SHIP_ID_MISMATCH");
    }

    const result = jumpSessionViaStargate(session, fromStargateID, toStargateID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdStargateJump failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      this._throwStargateJumpUserError(result.errorMsg);
    }

    return result.data.boundResult || null;
  }

  Handle_BookmarkLocation(args, session, kwargs) {
    const charID = session && session.characterID;
    const itemID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const comment = normalizeText(args && args[3], "");
    const expiryMode = normalizeNumber(args && args[4], 0);
    const subfolderID = getBookmarkSubfolderID(kwargs);
    const scene = spaceRuntime.getSceneForSession(session);
    const target = resolveLocationBookmarkTarget(itemID, session, scene);

    if (!target) {
      throwWrappedUserError("BookmarkNotAvailable");
    }

    return addBookmarkToFolder(charID, folderID, {
      folderID,
      memo: name,
      note: comment,
      expiryMode,
      subfolderID,
      creatorID: charID,
      ...target,
    });
  }

  Handle_BookmarkScanResult(args, session, kwargs) {
    const charID = session && session.characterID;
    const locationID = normalizeNumber(args && args[0], 0);
    const name = normalizeText(args && args[1], "");
    const comment = normalizeText(args && args[2], "");
    const resultID = normalizeNumber(args && args[3], 0);
    const folderID = normalizeNumber(args && args[4], 0);
    const expiryMode = normalizeNumber(args && args[5], 0);
    const subfolderID = getBookmarkSubfolderID(kwargs);
    const target = bookmarkRuntime.resolveScanBookmarkTarget(locationID, resultID);
    if (!target) {
      throwWrappedUserError("BookmarkNotAvailable");
    }

    return addBookmarkToFolder(charID, folderID, {
      folderID,
      memo: name,
      note: comment,
      expiryMode,
      subfolderID,
      creatorID: charID,
      ...target,
    });
  }

  Handle_MachoResolveObject(args, session) {
    const bindParameter = args && args[0];
    void bindParameter;
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const startedAtMs = Date.now();
    const response = buildBoundObjectResponse(this, args, session, kwargs);
    const responseBuiltMs = Date.now() - startedAtMs;
    const dockedStructureObserverSession = isDockedStructureObserverSession(session);
    // Space login is race-sensitive: if the bind reply reaches the client
    // before the first AddBalls2/SetState bootstrap, the inflight HUD can open
    // against an empty ego-ball state and only recover later via Michelle's
    // missing-module redraw path.
    const bootstrapStartedAtMs = Date.now();
    const bootstrapResult = bootstrapSessionBallpark(session, {
      force: dockedStructureObserverSession,
      reset: Boolean(
        dockedStructureObserverSession &&
          session &&
          session._structureViewSpace &&
          session._structureViewSpace.pendingBallparkBind === true
      ),
    });
    const bootstrapElapsedMs = Date.now() - bootstrapStartedAtMs;
    if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
      spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-bind", {
        responseBuiltMs,
        bootstrapElapsedMs,
        dockedStructureObserver: dockedStructureObserverSession,
        bootstrapResult: bootstrapResult === true,
      });
    }
    if (responseBuiltMs >= 100 || bootstrapElapsedMs >= 100) {
      log.info(
        `[Beyonce] MachoBindObject responseBuiltMs=${responseBuiltMs} ` +
        `bootstrapMs=${bootstrapElapsedMs} dockedStructureObserver=${dockedStructureObserverSession ? 1 : 0}`,
      );
    }
    return response;
  }

  afterCallResponse(methodName, session) {
    if (methodName === "MachoBindObject") {
      flushPendingCommandSessionEffects(session);
      return;
    }

    if (methodName === "CmdStargateJump") {
      flushPendingCommandSessionEffects(session);
    }
  }
}

module.exports = BeyonceService;
