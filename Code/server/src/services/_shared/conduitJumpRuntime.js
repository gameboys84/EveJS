const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const hostileModuleRuntime = require(path.join(
  __dirname,
  "../../space/modules/hostileModuleRuntime",
));
const {
  jumpSessionToSolarSystem,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  getActiveShipRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildShipResourceState,
  getTypeDogmaAttributes,
  isEffectivelyOnlineModule,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  applyJumpTimersBestEffort,
  hasActiveJumpActivation,
  resolveJumpFatigueMultiplier,
} = require(path.join(__dirname, "./jumpTimerRuntime"));

const ATTRIBUTE_GROUP_JUMP_DRIVE_CONSUMPTION_AMOUNT = 3131;
const ATTRIBUTE_CONDUIT_JUMP_PASSENGER_COUNT = 3133;
const ATTRIBUTE_JUMP_CONDUIT_PASSENGER_REQUIRED_ATTRIBUTE_ID = 3321;
const ATTRIBUTE_BLACK_OPS_JUMP_CONDUIT_PASSENGER = 3322;
const ATTRIBUTE_INDUSTRIAL_JUMP_CONDUIT_PASSENGER = 3324;
const ATTRIBUTE_CARRIER_JUMP_CONDUIT_PASSENGER = 5682;
const EFFECT_INDUSTRIAL_CORE = 4575;
const EFFECT_INDUSTRIAL_COMPACT_CORE = 8119;
const CONDUIT_JUMP_RANGE_METERS = 10000;
const CATEGORY_SHIP = 6;
const CARRIER_CONDUIT_PASSENGER_GROUP_IDS = Object.freeze(new Set([
  25, // Frigate
  26, // Cruiser
  27, // Battleship
  237, // Corvette
  324, // Assault Frigate
  358, // Heavy Assault Cruiser
  419, // Combat Battlecruiser
  420, // Destroyer
  540, // Command Ship
  541, // Interdictor
  830, // Covert Ops
  831, // Interceptor
  832, // Logistics
  833, // Force Recon Ship
  834, // Stealth Bomber
  893, // Electronic Attack Ship
  894, // Heavy Interdiction Cruiser
  898, // Black Ops
  900, // Marauder
  906, // Combat Recon Ship
  963, // Strategic Cruiser
  1022, // Prototype Exploration Ship
  1201, // Attack Battlecruiser
  1283, // Expedition Frigate
  1305, // Tactical Destroyer
  1527, // Logistics Frigate
  1534, // Command Destroyer
  1972, // Flag Cruiser
]));

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeInt(value, fallback = 0) {
  const numeric = toFiniteNumber(value, fallback);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getSessionSolarSystemID(session) {
  return normalizePositiveInt(
    session && (session.solarsystemid2 || session.solarsystemid),
    0,
  );
}

function getResourceAttributes(resourceState) {
  return resourceState &&
    resourceState.attributes &&
    typeof resourceState.attributes === "object"
    ? resourceState.attributes
    : {};
}

function resolveFittedModuleRequiredPassengerAttributeID(resourceState) {
  const fittedItems = Array.isArray(resourceState && resourceState.fittedItems)
    ? resourceState.fittedItems
    : [];
  for (const item of fittedItems) {
    if (!isEffectivelyOnlineModule(item)) {
      continue;
    }
    const moduleAttributes = getTypeDogmaAttributes(item.typeID);
    const requiredAttributeID = normalizePositiveInt(
      moduleAttributes[ATTRIBUTE_JUMP_CONDUIT_PASSENGER_REQUIRED_ATTRIBUTE_ID],
      0,
    );
    if (requiredAttributeID > 0) {
      return requiredAttributeID;
    }
  }
  return 0;
}

function resolveRequiredPassengerAttributeID(resourceState, attributes) {
  const directRequiredAttributeID = normalizePositiveInt(
    attributes[ATTRIBUTE_JUMP_CONDUIT_PASSENGER_REQUIRED_ATTRIBUTE_ID],
    0,
  );
  if (directRequiredAttributeID > 0) {
    return directRequiredAttributeID;
  }

  // Black Ops and Rorqual conduit anchors carry fuel/count on the hull, while
  // current generated SDE exposes the passenger family on the fitted portal.
  return resolveFittedModuleRequiredPassengerAttributeID(resourceState);
}

function cloneVector(vector = {}) {
  return {
    x: toFiniteNumber(vector && vector.x, 0),
    y: toFiniteNumber(vector && vector.y, 0),
    z: toFiniteNumber(vector && vector.z, 0),
  };
}

function vectorDistance(left = {}, right = {}) {
  const dx = toFiniteNumber(left.x, 0) - toFiniteNumber(right.x, 0);
  const dy = toFiniteNumber(left.y, 0) - toFiniteNumber(right.y, 0);
  const dz = toFiniteNumber(left.z, 0) - toFiniteNumber(right.z, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getEntitySurfaceDistanceMeters(leftEntity, rightEntity) {
  if (!leftEntity || !rightEntity) {
    return Number.POSITIVE_INFINITY;
  }
  const centerDistance = vectorDistance(
    cloneVector(leftEntity.position),
    cloneVector(rightEntity.position),
  );
  const leftRadius = Math.max(0, toFiniteNumber(leftEntity.radius, 0));
  const rightRadius = Math.max(0, toFiniteNumber(rightEntity.radius, 0));
  return Math.max(0, centerDistance - leftRadius - rightRadius);
}

function resolveShipTypeRecord(shipItem) {
  const typeID = normalizePositiveInt(shipItem && shipItem.typeID, 0);
  return typeID > 0 ? resolveItemByTypeID(typeID) : null;
}

function isCarrierConduitPassengerShip(shipItem) {
  const typeRecord = resolveShipTypeRecord(shipItem);
  const categoryID = normalizePositiveInt(
    (shipItem && shipItem.categoryID) ?? (typeRecord && typeRecord.categoryID),
    0,
  );
  const groupID = normalizePositiveInt(
    (shipItem && shipItem.groupID) ?? (typeRecord && typeRecord.groupID),
    0,
  );
  return (
    categoryID === CATEGORY_SHIP &&
    CARRIER_CONDUIT_PASSENGER_GROUP_IDS.has(groupID)
  );
}

function hasRequiredPassengerAttribute(
  passengerAttributes,
  requiredPassengerAttributeID,
  passengerShip,
) {
  if (
    toFiniteNumber(
      passengerAttributes[requiredPassengerAttributeID],
      0,
    ) > 0
  ) {
    return true;
  }

  // Generated typeDogma currently exposes carrier anchor requirement 5682 but
  // no positive passenger rows; CCP Equinox notes define the ship classes.
  if (requiredPassengerAttributeID === ATTRIBUTE_CARRIER_JUMP_CONDUIT_PASSENGER) {
    return isCarrierConduitPassengerShip(passengerShip);
  }

  return false;
}

function isEntityCloakedForConduit(entity) {
  return Boolean(
    entity &&
      (
        entity.cloaked === true ||
        toFiniteNumber(entity.cloakMode, 0) > 0 ||
        toFiniteNumber(entity.cloakState, 0) > 0
      ),
  );
}

function isIndustrialCoreEffectState(effectState) {
  if (!effectState || toFiniteNumber(effectState.deactivatedAtMs, 0) > 0) {
    return false;
  }
  const effectID = normalizePositiveInt(effectState.effectID, 0);
  if (
    effectID === EFFECT_INDUSTRIAL_CORE ||
    effectID === EFFECT_INDUSTRIAL_COMPACT_CORE
  ) {
    return true;
  }
  const effectName = String(effectState.effectName || "").trim().toLowerCase();
  return (
    effectName.includes("industrial") &&
    effectName.includes("core")
  );
}

function hasActiveIndustrialCoreEffect(entity) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return false;
  }
  for (const effectState of entity.activeModuleEffects.values()) {
    if (isIndustrialCoreEffectState(effectState)) {
      return true;
    }
  }
  return false;
}

function getConduitBlockReason(session, entity) {
  if (!session || !entity) {
    return "not-in-space";
  }
  if (session._transitionState) {
    return "transition";
  }
  if (entity.destroyed === true || toFiniteNumber(entity.destroyedAt, 0) > 0) {
    return "destroyed";
  }
  if (isEntityCloakedForConduit(entity)) {
    return "cloaked";
  }
  if (hasActiveIndustrialCoreEffect(entity)) {
    return "industrial-core";
  }
  if (
    hostileModuleRuntime &&
    typeof hostileModuleRuntime.isEntityWarpScrambled === "function" &&
    hostileModuleRuntime.isEntityWarpScrambled(entity)
  ) {
    return "warp-scrambled";
  }
  return null;
}

function resolveConduitJumpActivation(resourceState, distanceLy) {
  const attributes = getResourceAttributes(resourceState);
  const passengerLimit = Math.max(
    0,
    normalizeInt(attributes[ATTRIBUTE_CONDUIT_JUMP_PASSENGER_COUNT], 0),
  );
  const fuelAmountPerLy = Math.max(
    0,
    toFiniteNumber(attributes[ATTRIBUTE_GROUP_JUMP_DRIVE_CONSUMPTION_AMOUNT], 0),
  );
  const requiredPassengerAttributeID = resolveRequiredPassengerAttributeID(
    resourceState,
    attributes,
  );
  if (
    requiredPassengerAttributeID <= 0 ||
    passengerLimit <= 0 ||
    fuelAmountPerLy <= 0
  ) {
    return {
      success: false,
      errorMsg: "NOT_CONDUIT_CAPABLE",
      requiredPassengerAttributeID,
      passengerLimit,
      fuelAmountPerLy,
      fuelQuantity: 0,
    };
  }
  return {
    success: true,
    errorMsg: null,
    requiredPassengerAttributeID,
    passengerLimit,
    fuelAmountPerLy,
    fuelQuantity: Math.max(
      0,
      Math.trunc(Math.max(0, toFiniteNumber(distanceLy, 0)) * fuelAmountPerLy),
    ),
  };
}

function buildConduitPassengerPlans(options = {}) {
  const {
    fleet = null,
    anchorSession = null,
    anchorEntity = null,
    destinationSolarSystemID = 0,
    requiredPassengerAttributeID = 0,
    passengerLimit = 0,
    buildSpawnState = null,
  } = options;
  const anchorCharacterID = normalizePositiveInt(
    anchorSession && anchorSession.characterID,
    0,
  );
  const anchorSolarSystemID = getSessionSolarSystemID(anchorSession);
  const anchorBlockReason = getConduitBlockReason(anchorSession, anchorEntity);
  if (anchorBlockReason) {
    return {
      success: false,
      errorMsg: "ANCHOR_BLOCKED",
      anchorBlockReason,
      plans: [],
      skipped: [],
    };
  }
  if (
    !fleet ||
    !(fleet.members instanceof Map) ||
    anchorCharacterID <= 0 ||
    anchorSolarSystemID <= 0 ||
    requiredPassengerAttributeID <= 0 ||
    passengerLimit <= 0
  ) {
    return {
      success: true,
      errorMsg: null,
      anchorBlockReason: null,
      plans: [],
      skipped: [],
    };
  }

  const plans = [];
  const skipped = [];
  for (const member of fleet.members.values()) {
    const characterID = normalizePositiveInt(member && member.charID, 0);
    if (characterID <= 0 || characterID === anchorCharacterID) {
      continue;
    }
    if (plans.length >= passengerLimit) {
      skipped.push({ characterID, reason: "passenger-limit" });
      continue;
    }
    if (
      member.memberOptOuts &&
      member.memberOptOuts.acceptsConduitJumps === false
    ) {
      skipped.push({ characterID, reason: "opt-out" });
      continue;
    }
    const passengerSession = sessionRegistry.findSessionByCharacterID(characterID);
    if (!passengerSession) {
      skipped.push({ characterID, reason: "offline" });
      continue;
    }
    if (hasActiveJumpActivation(characterID)) {
      skipped.push({ characterID, reason: "jump-activation" });
      continue;
    }
    if (getSessionSolarSystemID(passengerSession) !== anchorSolarSystemID) {
      skipped.push({ characterID, reason: "wrong-system" });
      continue;
    }

    const passengerShip = getActiveShipRecord(characterID);
    const passengerShipID = normalizePositiveInt(
      passengerShip && passengerShip.itemID,
      0,
    );
    if (passengerShipID <= 0) {
      skipped.push({ characterID, reason: "no-active-ship" });
      continue;
    }
    const passengerEntity = spaceRuntime.getEntity(
      passengerSession,
      passengerShipID,
    );
    if (!passengerEntity) {
      skipped.push({ characterID, reason: "not-in-space" });
      continue;
    }
    const blockReason = getConduitBlockReason(passengerSession, passengerEntity);
    if (blockReason) {
      skipped.push({ characterID, reason: blockReason });
      continue;
    }
    const rangeMeters = getEntitySurfaceDistanceMeters(
      passengerEntity,
      anchorEntity,
    );
    if (rangeMeters > CONDUIT_JUMP_RANGE_METERS) {
      skipped.push({ characterID, reason: "range", rangeMeters });
      continue;
    }

    const passengerResourceState = buildShipResourceState(
      characterID,
      passengerShip,
    );
    const passengerAttributes = getResourceAttributes(passengerResourceState);
    if (
      !hasRequiredPassengerAttribute(
        passengerAttributes,
        requiredPassengerAttributeID,
        passengerShip,
      )
    ) {
      skipped.push({
        characterID,
        reason: "ineligible-ship",
        requiredPassengerAttributeID,
      });
      continue;
    }

    const spawnStateOverride =
      typeof buildSpawnState === "function"
        ? buildSpawnState({
          passengerEntity,
          passengerSession,
          passengerShip,
        })
        : null;
    plans.push({
      characterID,
      passengerEntity,
      passengerSession,
      passengerShip,
      jumpFatigueMultiplier: resolveJumpFatigueMultiplier(passengerResourceState),
      rangeMeters,
      spawnStateOverride,
    });
  }

  return {
    success: true,
    errorMsg: null,
    anchorBlockReason: null,
    plans,
    skipped,
  };
}

function notifyGroupJumpedPassenger(
  session,
  anchorCharacterID,
  destinationSolarSystemID,
) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnGroupJumpedPassenger", "clientID", [
    normalizePositiveInt(anchorCharacterID, 0),
    normalizePositiveInt(destinationSolarSystemID, 0),
  ]);
}

function executeConduitPassengerJumps(options = {}) {
  const {
    plans = [],
    anchorCharacterID = 0,
    destinationSolarSystemID = 0,
    distanceLy = 0,
    logPrefix = "ConduitJump",
  } = options;
  const results = [];
  for (const plan of Array.isArray(plans) ? plans : []) {
    const passengerSession = plan && plan.passengerSession;
    const characterID = normalizePositiveInt(plan && plan.characterID, 0);
    const jumpResult = jumpSessionToSolarSystem(
      passengerSession,
      destinationSolarSystemID,
      {
        spawnStateOverride: plan.spawnStateOverride || null,
      },
    );
    if (!jumpResult.success) {
      log.warn(
        `[${logPrefix}] conduit passenger left behind ` +
          `char=${characterID} destination=${destinationSolarSystemID} ` +
          `error=${jumpResult.errorMsg || "UNKNOWN"}`,
      );
      results.push({
        characterID,
        success: false,
        errorMsg: jumpResult.errorMsg || "UNKNOWN",
      });
      continue;
    }
    applyJumpTimersBestEffort(passengerSession, {
      distanceLy,
      jumpFatigueMultiplier: plan.jumpFatigueMultiplier,
    });
    notifyGroupJumpedPassenger(
      passengerSession,
      anchorCharacterID,
      destinationSolarSystemID,
    );
    results.push({
      characterID,
      success: true,
      errorMsg: null,
    });
  }
  return {
    results,
    successCount: results.filter((entry) => entry.success === true).length,
    failureCount: results.filter((entry) => entry.success !== true).length,
  };
}

module.exports = {
  ATTRIBUTE_BLACK_OPS_JUMP_CONDUIT_PASSENGER,
  ATTRIBUTE_CARRIER_JUMP_CONDUIT_PASSENGER,
  ATTRIBUTE_CONDUIT_JUMP_PASSENGER_COUNT,
  ATTRIBUTE_GROUP_JUMP_DRIVE_CONSUMPTION_AMOUNT,
  ATTRIBUTE_INDUSTRIAL_JUMP_CONDUIT_PASSENGER,
  ATTRIBUTE_JUMP_CONDUIT_PASSENGER_REQUIRED_ATTRIBUTE_ID,
  EFFECT_INDUSTRIAL_COMPACT_CORE,
  EFFECT_INDUSTRIAL_CORE,
  CONDUIT_JUMP_RANGE_METERS,
  buildConduitPassengerPlans,
  executeConduitPassengerJumps,
  getConduitBlockReason,
  hasActiveIndustrialCoreEffect,
  resolveConduitJumpActivation,
};
