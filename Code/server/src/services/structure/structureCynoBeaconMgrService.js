const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  jumpSessionToSolarSystem,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  consumeFuelFromShipStorage,
} = require(path.join(__dirname, "../../space/modules/sharedFuelRuntime"));
const {
  getActiveShipRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildEffectiveItemAttributeMap,
  buildShipResourceState,
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
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));
const {
  TYPE_PHAROLUX_CYNO_BEACON,
} = require(path.join(__dirname, "../sovereignty/sovUpgradeSupport"));
const {
  isSolarSystemCynoJammed,
} = require(path.join(__dirname, "../sovereignty/sovSuppressionState"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  characterHasStructureService,
} = require(path.join(__dirname, "./structurePayloads"));
const structureTetherRestrictionState = require(path.join(
  __dirname,
  "./structureTetherRestrictionState",
));

const LIGHT_YEAR_METERS = 9460730472580800;
const CYNO_BEACON_ARRIVAL_CLEARANCE_METERS = 12000;
const STRUCTURE_CYNO_TETHER_DELAY_MS = 30 * 1000;
const ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE = 866;
const ATTRIBUTE_JUMP_DRIVE_RANGE = 867;
const ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT = 868;
const ATTRIBUTE_JUMP_PORTAL_CONSUMPTION_MASS_FACTOR = 1001;
const ATTRIBUTE_JUMP_PORTAL_PASSENGER_REQUIRED_ATTRIBUTE_ID = 3318;
const ATTRIBUTE_IS_TITAN_JUMP_PORTAL_PASSENGER = 3319;
const TYPE_JUMP_PORTAL_GENERATOR = 23953;
const JUMP_PORTAL_EFFECT_STANDARD = "jumpPortalGeneration";
const JUMP_PORTAL_MASS_FACTOR_BY_TYPE_ID = Object.freeze({
  [TYPE_JUMP_PORTAL_GENERATOR]: 1.5e-9,
});

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

function scaleVector(vector, scalar) {
  const scale = toFiniteNumber(scalar, 0);
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scale,
    y: toFiniteNumber(vector && vector.y, 0) * scale,
    z: toFiniteNumber(vector && vector.z, 0) * scale,
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function magnitude(vector) {
  return Math.sqrt(
    (toFiniteNumber(vector && vector.x, 0) ** 2) +
      (toFiniteNumber(vector && vector.y, 0) ** 2) +
      (toFiniteNumber(vector && vector.z, 0) ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const source = cloneVector(vector, fallback);
  const length = magnitude(source);
  if (length <= 0) {
    return cloneVector(fallback);
  }
  return {
    x: source.x / length,
    y: source.y / length,
    z: source.z / length,
  };
}

function throwNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "The cynosural beacon cannot be used right now."),
  });
}

function throwIfJumpActivationActive(session) {
  if (hasActiveJumpActivation(session && session.characterID)) {
    throwNotify(
      "You cannot use a jump drive, jump bridge, or jump portal while your jump activation cooldown is active.",
    );
  }
}

function applyStructureCynoTetherDelay(session, nowMs = Date.now()) {
  const characterID = normalizePositiveInt(session && session.characterID, 0);
  if (characterID <= 0) {
    return null;
  }
  const now = Math.max(0, normalizeInt(nowMs, Date.now()));
  const nextDelayUntilMs = now + STRUCTURE_CYNO_TETHER_DELAY_MS;
  const current =
    structureTetherRestrictionState.getCharacterTetherRestrictionState(
      characterID,
      now,
    );
  if (
    current &&
    normalizeInt(current.tetherDelayUntilMs, 0) >= nextDelayUntilMs
  ) {
    return {
      success: true,
      data: {
        state: current,
        unchanged: true,
      },
    };
  }
  return structureTetherRestrictionState.setCharacterTetherDelay(
    characterID,
    STRUCTURE_CYNO_TETHER_DELAY_MS,
    {
      nowMs: now,
    },
  );
}

function applyStructureCynoTetherDelayToSuccessfulPassengers(
  conduitPlan,
  conduitPassengerResult,
  nowMs = Date.now(),
) {
  const successfulCharacterIDs = new Set(
    (Array.isArray(conduitPassengerResult && conduitPassengerResult.results)
      ? conduitPassengerResult.results
      : [])
      .filter((entry) => entry && entry.success === true)
      .map((entry) => normalizePositiveInt(entry.characterID, 0))
      .filter((characterID) => characterID > 0),
  );
  if (successfulCharacterIDs.size <= 0) {
    return;
  }
  const plans = Array.isArray(conduitPlan && conduitPlan.plans)
    ? conduitPlan.plans
    : [];
  for (const plan of plans) {
    const characterID = normalizePositiveInt(plan && plan.characterID, 0);
    if (!successfulCharacterIDs.has(characterID)) {
      continue;
    }
    applyStructureCynoTetherDelay(plan.passengerSession, nowMs);
  }
}

function getCurrentSolarSystemID(session) {
  return normalizePositiveInt(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function getStructureByID(structureID) {
  const numericStructureID = normalizePositiveInt(structureID, 0);
  return numericStructureID
    ? structureState.getStructureByID(numericStructureID, { refresh: false })
    : null;
}

function isPharoluxStructure(structure) {
  return Boolean(
    structure &&
      normalizePositiveInt(structure.typeID, 0) === TYPE_PHAROLUX_CYNO_BEACON &&
      !structure.destroyedAt
  );
}

function isCynoBeaconServiceOnline(structure) {
  return normalizeInt(
    structure &&
      structure.serviceStates &&
      structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_BEACON)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  ) === STRUCTURE_SERVICE_STATE.ONLINE;
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
  const distanceMeters = magnitude(subtractVectors(
    sourceSystem.position,
    destinationSystem.position,
  ));
  return distanceMeters / LIGHT_YEAR_METERS;
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

function buildCynoBeaconArrivalSpawnState(destinationStructure, shipItem, shipEntity = null) {
  const anchorPosition = cloneVector(destinationStructure && destinationStructure.position);
  const direction = normalizeVector(
    magnitude(anchorPosition) > 0 ? anchorPosition : { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  const offset =
    Math.max(0, toFiniteNumber(destinationStructure && destinationStructure.radius, 0)) +
    resolveShipRadiusMeters(shipItem, shipEntity) +
    CYNO_BEACON_ARRIVAL_CLEARANCE_METERS;
  return {
    anchorType: "structureCynoBeacon",
    anchorID: normalizePositiveInt(destinationStructure && destinationStructure.structureID, 0),
    anchorName:
      String(
        (destinationStructure && (destinationStructure.itemName || destinationStructure.name)) ||
          "Pharolux Cyno Beacon",
      ),
    direction,
    position: addVectors(anchorPosition, scaleVector(direction, offset)),
  };
}

function resolveActiveShipAndJumpDrive(session, destinationSolarSystemID) {
  const characterID = normalizePositiveInt(session && session.characterID, 0);
  const activeShip = getActiveShipRecord(characterID);
  if (!activeShip) {
    throwNotify("You need an active ship to use a cynosural beacon.");
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
    throwNotify("Your ship is not capable of jumping to a cynosural beacon.");
  }

  const sourceSolarSystemID = getCurrentSolarSystemID(session);
  const distanceLy = getSolarSystemDistanceLy(sourceSolarSystemID, destinationSolarSystemID);
  if (distanceLy === null) {
    throwNotify("The distance to that cynosural beacon could not be calculated.");
  }
  if (distanceLy <= 0) {
    throwNotify("You are already in that solar system.");
  }
  if (distanceLy > jumpRangeLy + 0.000001) {
    throwNotify("That cynosural beacon is outside your jump range.");
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

function resolveStandardBridgePortalModule(characterID, activeShip) {
  const resourceState = buildShipResourceState(characterID, activeShip);
  const fittedItems = Array.isArray(resourceState.fittedItems)
    ? resourceState.fittedItems
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
    if (modulePassengerAttributeID !== ATTRIBUTE_IS_TITAN_JUMP_PORTAL_PASSENGER) {
      continue;
    }
    if (resolveJumpPortalMassFactor(fittedItem, moduleAttributes) <= 0) {
      throwNotify(
        "That jump portal generator is missing its portal fuel mass factor.",
      );
    }
    return {
      moduleAttributes,
      portalModuleItem: fittedItem,
    };
  }
  throwNotify(
    "Your ship is not fitted with an online jump portal generator for that cynosural beacon.",
  );
}

function resolveUsableBeacon(args, session) {
  const structureID = normalizePositiveInt(Array.isArray(args) ? args[0] : null, 0);
  const requestedSolarSystemID = normalizePositiveInt(Array.isArray(args) ? args[1] : null, 0);
  const structure = getStructureByID(structureID);
  if (!isPharoluxStructure(structure)) {
    throwNotify("That cynosural beacon is no longer available.");
  }

  const destinationSolarSystemID = normalizePositiveInt(structure.solarSystemID, 0);
  if (
    requestedSolarSystemID > 0 &&
      destinationSolarSystemID !== requestedSolarSystemID
  ) {
    throwNotify("That cynosural beacon is not in the requested solar system.");
  }
  if (!session || !session.characterID || !session._space) {
    throwNotify("You must be in space to use a cynosural beacon.");
  }
  if (destinationSolarSystemID === getCurrentSolarSystemID(session)) {
    throwNotify("You are already in that solar system.");
  }
  if (!isCynoBeaconServiceOnline(structure)) {
    throwNotify("That cynosural beacon service is offline.");
  }
  if (isSolarSystemCynoJammed(destinationSolarSystemID)) {
    throwNotify("That solar system is cynosural jammed.");
  }
  if (!characterHasStructureService(session, structure, STRUCTURE_SERVICE_ID.CYNO_BEACON)) {
    throwNotify("You do not have access to use that cynosural beacon.");
  }

  return {
    destinationSolarSystemID,
    structure,
    structureID,
  };
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
    throwNotify("Your ship does not have enough jump fuel.");
  }
  syncInventoryChanges(session, fuelResult.changes);
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
    throwNotify("Your ship cannot perform a conduit jump while cloaked.");
  }
  if (reason === "warp-scrambled") {
    throwNotify("Your ship cannot perform a conduit jump while warp disrupted.");
  }
  if (reason === "transition") {
    throwNotify("Your ship cannot perform a conduit jump while already in transition.");
  }
  if (reason === "industrial-core") {
    throwNotify("Your ship cannot perform a conduit jump while its Industrial Core is active.");
  }
  throwNotify("Your ship cannot perform a conduit jump.");
}

class StructureCynoBeaconMgrService extends BaseService {
  constructor() {
    super("structureCynoBeaconMgr");
  }

  _jumpToBeacon(args, session, options = {}) {
    const {
      destinationSolarSystemID,
      structure,
      structureID,
    } = resolveUsableBeacon(args, session);
    const {
      activeShip,
      distanceLy,
      fuelTypeID,
      fuelQuantity,
      resourceState,
    } = resolveActiveShipAndJumpDrive(session, destinationSolarSystemID);
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
        throwNotify("Your ship is not capable of performing a conduit jump.");
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
          buildCynoBeaconArrivalSpawnState(
            structure,
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
      spawnStateOverride: buildCynoBeaconArrivalSpawnState(
        structure,
        activeShip,
        shipEntity,
      ),
    });
    if (!jumpResult.success) {
      log.warn(
        `[StructureCynoBeaconMgr] jump failed char=${session.characterID} structure=${structureID}: ${jumpResult.errorMsg}`,
      );
      throwNotify("The cynosural beacon session change failed.");
    }
    const tetherDelayNowMs = Date.now();
    applyStructureCynoTetherDelay(session, tetherDelayNowMs);
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
        logPrefix: "StructureCynoBeaconMgr",
      });
      notifyGroupJumpAnchor(
        session,
        destinationSolarSystemID,
        conduitPassengerResult.successCount,
      );
      applyStructureCynoTetherDelayToSuccessfulPassengers(
        conduitPlan,
        conduitPassengerResult,
        tetherDelayNowMs,
      );
    }

    log.info(
      `[StructureCynoBeaconMgr] char=${session.characterID} jumped structure=${structureID} ` +
        `destination=${destinationSolarSystemID} fuelType=${fuelTypeID} ` +
        `fuel=${fuelResult.consumedQuantity || 0} distanceLy=${distanceLy.toFixed(6)} ` +
        `conduitPassengers=${conduitPassengerResult ? conduitPassengerResult.successCount : 0} ` +
        `conduitLimit=${conduitActivation ? conduitActivation.passengerLimit : 0}`,
    );
    return jumpResult.data.boundResult || true;
  }

  Handle_CmdJumpToStructureBeacon(args, session) {
    return this._jumpToBeacon(args, session);
  }

  Handle_CmdGroupJumpToStructureBeacon(args, session) {
    ensureFleetMembership(session);
    return this._jumpToBeacon(args, session, {
      groupAnchor: true,
    });
  }

  Handle_CmdBridgeToStructureBeacon(args, session) {
    ensureFleetMembership(session);
    const {
      destinationSolarSystemID,
      structure,
      structureID,
    } = resolveUsableBeacon(args, session);
    const {
      activeShip,
      distanceLy,
      fuelTypeID,
      fuelQuantity,
    } = resolveActiveShipAndJumpDrive(session, destinationSolarSystemID);
    const portalModule = resolveStandardBridgePortalModule(
      session && session.characterID,
      activeShip,
    );
    const activationResult = spaceRuntime.activateGenericModule(
      session,
      portalModule.portalModuleItem,
      JUMP_PORTAL_EFFECT_STANDARD,
      {
        repeat: 1,
      },
    );
    if (!activationResult.success) {
      if (activationResult.errorMsg === "NOT_ENOUGH_CAPACITOR") {
        throwNotify("The bridge ship does not have enough capacitor to activate the jump portal.");
      }
      if (activationResult.errorMsg === "NO_FUEL") {
        throwNotify("The bridge ship does not have enough jump portal activation fuel.");
      }
      if (activationResult.errorMsg === "MODULE_ALREADY_ACTIVE") {
        throwNotify("That jump portal generator is already active.");
      }
      throwNotify("The jump portal generator could not be activated.");
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
        itemID: structureID,
      };
    }

    fleetRuntime.setBridgeMode(
      session.fleetid,
      activeShip.itemID,
      destinationSolarSystemID,
      structureID,
      true,
    );
    notifyGroupJumpAnchor(session, destinationSolarSystemID, 0);
    log.info(
      `[StructureCynoBeaconMgr] char=${session.characterID} opened bridge ` +
        `ship=${activeShip.itemID} structure=${structureID} destination=${destinationSolarSystemID} ` +
        `portalModule=${portalModule.portalModuleItem.itemID} ` +
        `portalType=${portalModule.portalModuleItem.typeID} ` +
        `portalEffect=${effectState ? effectState.effectName : JUMP_PORTAL_EFFECT_STANDARD} ` +
        `activationCap=${effectState ? effectState.capNeed || 0 : 0} ` +
        `activationFuelType=${effectState ? effectState.fuelTypeID || 0 : 0} ` +
        `activationFuel=${effectState ? effectState.fuelPerActivation || 0 : 0} ` +
        `fuelType=${fuelTypeID} passengerFuelEstimate=${fuelQuantity} ` +
        `distanceLy=${distanceLy.toFixed(6)}`,
    );
    return true;
  }
}

StructureCynoBeaconMgrService._testing = {
  ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT,
  ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE,
  ATTRIBUTE_JUMP_DRIVE_RANGE,
  CYNO_BEACON_ARRIVAL_CLEARANCE_METERS,
  STRUCTURE_CYNO_TETHER_DELAY_MS,
  buildCynoBeaconArrivalSpawnState,
  getSolarSystemDistanceLy,
};

module.exports = StructureCynoBeaconMgrService;
