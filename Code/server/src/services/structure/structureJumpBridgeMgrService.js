const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  jumpSessionToSolarSystem,
} = require(path.join(__dirname, "../../space/transitions"));
const mobileWarpDisruptorRuntime = require(path.join(__dirname, "../ship/mobileWarpDisruptorRuntime"));
const hostileModuleRuntime = require(path.join(__dirname, "../../space/modules/hostileModuleRuntime"));
const {
  ITEM_FLAGS,
  listContainerItems,
  updateInventoryItem,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  ACCOUNT_KEY,
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
  buildNotEnoughMoneyUserErrorValues,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const {
  CORPORATION_WALLET_KEY_START,
  adjustCorporationWalletDivisionBalance,
} = require(path.join(__dirname, "../corporation/corpWalletState"));
const {
  getActiveShipRecord,
} = require(path.join(__dirname, "../character/characterState"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  characterHasStructureService,
} = require(path.join(__dirname, "./structurePayloads"));
const {
  getProfileSettingValueForStructure,
} = require(path.join(__dirname, "./structureProfilesState"));
const {
  STRUCTURE_SETTING_ID,
} = require(path.join(__dirname, "./structureServiceAuthority"));
const {
  findServiceProximityConflict,
} = require(path.join(__dirname, "./structureServiceProximity"));
const {
  getCharacterTetherRestrictionState,
} = require(path.join(__dirname, "./structureTetherRestrictionState"));
const {
  TYPE_ANSIBLEX_JUMP_BRIDGE,
} = require(path.join(__dirname, "../sovereignty/sovUpgradeSupport"));

const ANSIBLEX_JUMP_RANGE_METERS = 2500;
const ANSIBLEX_ARRIVAL_CLEARANCE_METERS = 12000;
const MAX_ANSIBLEX_RANGE_LY = 5;
const MAX_ANSIBLEX_SHIP_MASS_KG = 1480000000;
const MAX_ANSIBLEX_ISK_PER_LIQUID_OZONE = 2000;
const LIGHT_YEAR_METERS = 9460730472580800;
const TYPE_LIQUID_OZONE = 16273;

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

function centerDistance(left, right) {
  return magnitude(subtractVectors(
    cloneVector(left && left.position),
    cloneVector(right && right.position),
  ));
}

function surfaceDistance(left, right) {
  return Math.max(
    0,
    centerDistance(left, right) -
      Math.max(0, toFiniteNumber(left && left.radius, 0)) -
      Math.max(0, toFiniteNumber(right && right.radius, 0)),
  );
}

function throwNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "The jump bridge cannot be used right now."),
  });
}

function throwNotEnoughMoney(requiredAmount, currentBalance) {
  throwWrappedUserError(
    "NotEnoughMoney",
    buildNotEnoughMoneyUserErrorValues(requiredAmount, currentBalance),
  );
}

function isAnsiblexStructure(structure) {
  return Boolean(
    structure &&
      normalizePositiveInt(structure.typeID, 0) === TYPE_ANSIBLEX_JUMP_BRIDGE &&
      !structure.destroyedAt
  );
}

function isJumpBridgeServiceOnline(structure) {
  return normalizeInt(
    structure &&
      structure.serviceStates &&
      structure.serviceStates[String(STRUCTURE_SERVICE_ID.JUMP_BRIDGE)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  ) === STRUCTURE_SERVICE_STATE.ONLINE;
}

function hasJumpBridgeServiceProximityConflict(structure) {
  if (!structure) {
    return false;
  }
  return Boolean(findServiceProximityConflict(
    structure,
    STRUCTURE_SERVICE_ID.JUMP_BRIDGE,
    structureState.listStructuresForSystem(
      normalizePositiveInt(structure.solarSystemID, 0),
      { includeDestroyed: true, refresh: false },
    ),
  ));
}

function getStructureDestinationSolarSystemID(structure) {
  const devFlags =
    structure && structure.devFlags && typeof structure.devFlags === "object"
      ? structure.devFlags
      : {};
  return normalizePositiveInt(
    devFlags.destinationSolarsystemID ||
      devFlags.sovereigntyJumpBridgeDestinationSolarsystemID,
    0,
  );
}

function getStructureByID(structureID) {
  const numericStructureID = normalizePositiveInt(structureID, 0);
  return numericStructureID
    ? structureState.getStructureByID(numericStructureID, { refresh: false })
    : null;
}

function findReciprocalLinkedStructure(sourceStructure) {
  if (!isAnsiblexStructure(sourceStructure)) {
    return null;
  }

  const destinationSolarSystemID = getStructureDestinationSolarSystemID(sourceStructure);
  if (!destinationSolarSystemID) {
    return null;
  }

  return structureState.listStructures({
    includeDestroyed: false,
    refresh: false,
  }).find((candidate) => (
    isAnsiblexStructure(candidate) &&
      normalizePositiveInt(candidate.solarSystemID, 0) === destinationSolarSystemID &&
      getStructureDestinationSolarSystemID(candidate) ===
        normalizePositiveInt(sourceStructure.solarSystemID, 0)
  )) || null;
}

function resolveShipMassKg(shipItem, shipEntity = null) {
  const directMass = toFiniteNumber(
    shipEntity && shipEntity.mass,
    toFiniteNumber(shipItem && shipItem.mass, 0),
  );
  if (directMass > 0) {
    return directMass;
  }
  const movement = worldData.getMovementAttributesForType(
    normalizePositiveInt(shipItem && (shipItem.typeID || shipItem.shipTypeID), 0),
  );
  return Math.max(0, toFiniteNumber(movement && movement.mass, 0));
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

function calculateLiquidOzoneRequired(shipMassKg, distanceLy) {
  const mass = Math.max(0, toFiniteNumber(shipMassKg, 0));
  const ly = Math.max(0, toFiniteNumber(distanceLy, 0));
  return Math.max(50, Math.ceil((mass * ly * 0.000003) + 50));
}

function normalizeJumpBridgeIskPerLiquidOzone(value) {
  const numeric = toFiniteNumber(value, 0);
  return Math.max(0, Math.min(MAX_ANSIBLEX_ISK_PER_LIQUID_OZONE, numeric));
}

function normalizeMoney(value) {
  const numeric = toFiniteNumber(value, 0);
  return Math.round(numeric * 100) / 100;
}

function getStructureOwnerCorpID(structure) {
  return normalizePositiveInt(structure && (structure.ownerCorpID || structure.ownerID), 0);
}

function getJumpBridgeIskPerLiquidOzone(structure, session) {
  return normalizeJumpBridgeIskPerLiquidOzone(
    getProfileSettingValueForStructure(
      structure,
      STRUCTURE_SETTING_ID.JUMP_BRIDGE_ACTIVATION,
      {
        session,
        defaultValue: 0,
      },
    ),
  );
}

function calculateJumpBridgeActivationFee(structure, session, liquidOzoneRequired) {
  const ozone = Math.max(0, normalizeInt(liquidOzoneRequired, 0));
  if (ozone <= 0) {
    return 0;
  }
  return normalizeMoney(ozone * getJumpBridgeIskPerLiquidOzone(structure, session));
}

function ensureCharacterCanPayJumpBridgeFee(session, amount) {
  const normalizedAmount = normalizeMoney(amount);
  if (!(normalizedAmount > 0)) {
    return;
  }

  const characterID = normalizePositiveInt(session && session.characterID, 0);
  const wallet = getCharacterWallet(characterID);
  const balance = normalizeMoney(wallet && wallet.balance);
  if (!wallet || balance + 0.0001 < normalizedAmount) {
    throwNotEnoughMoney(normalizedAmount, balance);
  }
}

function chargeJumpBridgeActivationFee(session, structure, amount) {
  const normalizedAmount = normalizeMoney(amount);
  if (!(normalizedAmount > 0)) {
    return null;
  }

  const characterID = normalizePositiveInt(session && session.characterID, 0);
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  const ownerCorpID = getStructureOwnerCorpID(structure);
  const description = `Ansiblex activation fee at ${structureID}`;
  const debitResult = adjustCharacterBalance(characterID, -normalizedAmount, {
    accountKey: ACCOUNT_KEY.CASH,
    description,
    entryTypeID: JOURNAL_ENTRY_TYPE.STRUCTURE_GATE_JUMP,
    ownerID1: characterID,
    ownerID2: ownerCorpID,
    referenceID: structureID,
  });
  if (!debitResult.success) {
    if (debitResult.errorMsg === "INSUFFICIENT_FUNDS") {
      const wallet = getCharacterWallet(characterID);
      throwNotEnoughMoney(normalizedAmount, wallet ? wallet.balance : 0);
    }
    throwNotify("Failed to pay the jump bridge activation fee.");
  }

  let creditResult = null;
  if (ownerCorpID > 0) {
    creditResult = adjustCorporationWalletDivisionBalance(
      ownerCorpID,
      CORPORATION_WALLET_KEY_START,
      normalizedAmount,
      {
        description,
        entryTypeID: JOURNAL_ENTRY_TYPE.STRUCTURE_GATE_JUMP,
        ownerID1: characterID,
        ownerID2: ownerCorpID,
        referenceID: structureID,
      },
    );
    if (!creditResult || creditResult.success !== true) {
      log.warn(
        `[StructureJumpBridgeMgr] failed to credit activation fee ownerCorp=${ownerCorpID} structure=${structureID}: ${creditResult && creditResult.errorMsg ? creditResult.errorMsg : "UNKNOWN"}`,
      );
    }
  }

  return {
    amount: normalizedAmount,
    debitResult,
    creditResult,
  };
}

function getStackQuantity(item) {
  if (!item) {
    return 0;
  }
  if (normalizeInt(item.singleton, 0) === 1) {
    return 1;
  }
  return Math.max(0, normalizeInt(item.stacksize ?? item.quantity, 0));
}

function listStructureLiquidOzoneStacks(structure) {
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  if (!structureID) {
    return [];
  }
  return listContainerItems(null, structureID, ITEM_FLAGS.STRUCTURE_FUEL_BAY)
    .filter((item) => (
      normalizePositiveInt(item && item.typeID, 0) === TYPE_LIQUID_OZONE &&
        getStackQuantity(item) > 0
    ))
    .sort((left, right) => normalizePositiveInt(left && left.itemID, 0) -
      normalizePositiveInt(right && right.itemID, 0));
}

function sumLiquidOzoneStacks(stacks) {
  return (Array.isArray(stacks) ? stacks : [])
    .reduce((total, stack) => total + getStackQuantity(stack), 0);
}

function synchronizeStructureLiquidOzoneCounter(structureID, nextQuantity) {
  return structureState.updateStructureRecord(structureID, (current) => ({
    ...current,
    liquidOzoneQty: Math.max(0, normalizeInt(nextQuantity, 0)),
  }));
}

function consumeStructureLiquidOzone(structure, quantity) {
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  const requiredQuantity = Math.max(0, normalizeInt(quantity, 0));
  if (!structureID || requiredQuantity <= 0) {
    return {
      success: true,
      consumedQuantity: 0,
      previousQuantity: 0,
      remainingQuantity: 0,
      changes: [],
      usedInventoryFuel: false,
    };
  }

  const fuelStacks = listStructureLiquidOzoneStacks(structure);
  const inventoryQuantity = sumLiquidOzoneStacks(fuelStacks);
  if (fuelStacks.length === 0) {
    const previousQuantity = Math.max(0, normalizeInt(structure && structure.liquidOzoneQty, 0));
    if (previousQuantity < requiredQuantity) {
      return {
        success: false,
        errorMsg: "NO_FUEL",
        previousQuantity,
        remainingQuantity: previousQuantity,
        changes: [],
        usedInventoryFuel: false,
      };
    }

    const nextQuantity = Math.max(0, previousQuantity - requiredQuantity);
    const updateResult = synchronizeStructureLiquidOzoneCounter(structureID, nextQuantity);
    if (!updateResult.success) {
      return {
        success: false,
        errorMsg: updateResult.errorMsg || "WRITE_ERROR",
        previousQuantity,
        remainingQuantity: previousQuantity,
        changes: [],
        usedInventoryFuel: false,
      };
    }

    return {
      success: true,
      consumedQuantity: requiredQuantity,
      previousQuantity,
      remainingQuantity: nextQuantity,
      changes: [],
      usedInventoryFuel: false,
    };
  }

  if (inventoryQuantity < requiredQuantity) {
    synchronizeStructureLiquidOzoneCounter(structureID, inventoryQuantity);
    return {
      success: false,
      errorMsg: "NO_FUEL",
      previousQuantity: inventoryQuantity,
      remainingQuantity: inventoryQuantity,
      changes: [],
      usedInventoryFuel: true,
    };
  }

  const changes = [];
  let remainingToConsume = requiredQuantity;
  for (const stack of fuelStacks) {
    if (remainingToConsume <= 0) {
      break;
    }
    const stackQuantity = getStackQuantity(stack);
    if (stackQuantity <= 0) {
      continue;
    }
    const consumedFromStack = Math.min(stackQuantity, remainingToConsume);
    const nextStackQuantity = stackQuantity - consumedFromStack;
    const itemID = normalizePositiveInt(stack && stack.itemID, 0);
    const writeResult = nextStackQuantity > 0
      ? updateInventoryItem(itemID, (currentItem) => ({
          ...currentItem,
          quantity: nextStackQuantity,
          stacksize: nextStackQuantity,
        }))
      : removeInventoryItem(itemID, { removeContents: false });
    if (!writeResult.success) {
      return {
        success: false,
        errorMsg: writeResult.errorMsg || "WRITE_ERROR",
        previousQuantity: inventoryQuantity,
        remainingQuantity: inventoryQuantity - (requiredQuantity - remainingToConsume),
        changes,
        usedInventoryFuel: true,
      };
    }

    if (writeResult.data && Array.isArray(writeResult.data.changes)) {
      changes.push(...writeResult.data.changes);
    } else if (writeResult.data || writeResult.previousData) {
      changes.push({
        removed: false,
        previousData: writeResult.previousData || null,
        item: writeResult.data || null,
      });
    }
    remainingToConsume -= consumedFromStack;
  }

  const remainingQuantity = Math.max(0, inventoryQuantity - requiredQuantity);
  const counterResult = synchronizeStructureLiquidOzoneCounter(structureID, remainingQuantity);
  if (!counterResult.success) {
    return {
      success: false,
      errorMsg: counterResult.errorMsg || "WRITE_ERROR",
      previousQuantity: inventoryQuantity,
      remainingQuantity,
      changes,
      usedInventoryFuel: true,
    };
  }

  return {
    success: true,
    consumedQuantity: requiredQuantity,
    previousQuantity: inventoryQuantity,
    remainingQuantity,
    changes,
    usedInventoryFuel: true,
  };
}

function buildStructureArrivalSpawnState(destinationStructure, shipItem) {
  const anchorPosition = cloneVector(destinationStructure && destinationStructure.position);
  const direction = normalizeVector(
    magnitude(anchorPosition) > 0 ? anchorPosition : { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  const offset =
    Math.max(0, toFiniteNumber(destinationStructure && destinationStructure.radius, 0)) +
    resolveShipRadiusMeters(shipItem) +
    ANSIBLEX_ARRIVAL_CLEARANCE_METERS;
  return {
    anchorType: "structureJumpBridge",
    anchorID: normalizePositiveInt(destinationStructure && destinationStructure.structureID, 0),
    anchorName:
      String(
        (destinationStructure && (destinationStructure.itemName || destinationStructure.name)) ||
          "Ansiblex Jump Bridge",
      ),
    direction,
    position: addVectors(anchorPosition, scaleVector(direction, offset)),
  };
}

function isCharacterWarpDisrupted(session, shipEntity = null) {
  if (shipEntity && hostileModuleRuntime.isEntityWarpScrambled(shipEntity)) {
    return true;
  }
  const restrictionState = getCharacterTetherRestrictionState(
    session && session.characterID,
  );
  return Boolean(restrictionState && restrictionState.warpScrambled === true);
}

function findWarpDisruptionFieldForShip(systemID, shipEntity = null) {
  if (!shipEntity || !shipEntity.position) {
    return null;
  }
  const scene =
    spaceRuntime &&
    spaceRuntime.scenes instanceof Map
      ? spaceRuntime.scenes.get(normalizePositiveInt(systemID, 0)) || null
      : null;
  return mobileWarpDisruptorRuntime.findActiveWarpDisruptorForPosition(
    systemID,
    shipEntity.position,
    { scene },
  );
}

class StructureJumpBridgeMgrService extends BaseService {
  constructor() {
    super("structureJumpBridgeMgr");
  }

  Handle_GetJbStructureDestination(args) {
    const sourceStructure = getStructureByID(Array.isArray(args) ? args[0] : null);
    if (!isAnsiblexStructure(sourceStructure)) {
      return null;
    }
    return getStructureDestinationSolarSystemID(sourceStructure) || null;
  }

  Handle_GetLinkedStructure(args) {
    const sourceStructure = getStructureByID(Array.isArray(args) ? args[0] : null);
    const linkedStructure = findReciprocalLinkedStructure(sourceStructure);
    if (!linkedStructure) {
      return null;
    }
    return [
      normalizePositiveInt(linkedStructure.structureID, 0),
      normalizePositiveInt(linkedStructure.solarSystemID, 0),
    ];
  }

  Handle_CmdJumpThroughStructureStargate(args, session) {
    const structureID = normalizePositiveInt(Array.isArray(args) ? args[0] : null, 0);
    const sourceStructure = getStructureByID(structureID);
    if (!isAnsiblexStructure(sourceStructure)) {
      throwNotify("That jump bridge is no longer available.");
    }
    if (!session || !session.characterID || !session._space) {
      throwNotify("You must be in space to use a jump bridge.");
    }
    if (
      normalizePositiveInt(sourceStructure.solarSystemID, 0) !==
      normalizePositiveInt(session._space.systemID || session.solarsystemid2 || session.solarsystemid, 0)
    ) {
      throwNotify("You are not in the same solar system as that jump bridge.");
    }
    if (!isJumpBridgeServiceOnline(sourceStructure)) {
      throwNotify("That jump bridge service is offline.");
    }
    if (hasJumpBridgeServiceProximityConflict(sourceStructure)) {
      throwNotify("That jump bridge service is offline.");
    }
    if (!characterHasStructureService(session, sourceStructure, STRUCTURE_SERVICE_ID.JUMP_BRIDGE)) {
      throwWrappedUserError("ActivateJumpBridgeDenied");
    }

    const destinationStructure = findReciprocalLinkedStructure(sourceStructure);
    if (!destinationStructure) {
      throwNotify("That jump bridge is not linked to a reciprocal destination.");
    }
    if (!isJumpBridgeServiceOnline(destinationStructure)) {
      throwNotify("The destination jump bridge service is offline.");
    }
    if (hasJumpBridgeServiceProximityConflict(destinationStructure)) {
      throwNotify("The destination jump bridge service is offline.");
    }

    const activeShip = getActiveShipRecord(session.characterID);
    if (!activeShip) {
      throwNotify("You need an active ship to use a jump bridge.");
    }

    const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
    const sourceEntity = spaceRuntime.getEntity(session, sourceStructure.structureID);
    if (shipEntity && sourceEntity) {
      const jumpDistance = surfaceDistance(shipEntity, sourceEntity);
      if (jumpDistance > ANSIBLEX_JUMP_RANGE_METERS) {
        throwNotify("You are too far away from the jump bridge.");
      }
    }
    if (isCharacterWarpDisrupted(session, shipEntity)) {
      throwNotify("You cannot use an Ansiblex while warp disrupted.");
    }
    if (findWarpDisruptionFieldForShip(sourceStructure.solarSystemID, shipEntity)) {
      throwNotify("You cannot use an Ansiblex while inside a warp disruption field.");
    }

    const sourceSolarSystemID = normalizePositiveInt(sourceStructure.solarSystemID, 0);
    const destinationSolarSystemID = normalizePositiveInt(destinationStructure.solarSystemID, 0);
    const distanceLy = getSolarSystemDistanceLy(sourceSolarSystemID, destinationSolarSystemID);
    if (distanceLy !== null && distanceLy > MAX_ANSIBLEX_RANGE_LY + 0.000001) {
      throwNotify("That jump bridge connection is beyond the maximum Ansiblex range.");
    }

    const shipMassKg = resolveShipMassKg(activeShip, shipEntity);
    if (shipMassKg > MAX_ANSIBLEX_SHIP_MASS_KG) {
      throwNotify("Your ship is too massive to use an Ansiblex jump bridge.");
    }

    const liquidOzoneRequired = calculateLiquidOzoneRequired(
      shipMassKg,
      distanceLy === null ? 0 : distanceLy,
    );
    const activationFee = calculateJumpBridgeActivationFee(
      sourceStructure,
      session,
      liquidOzoneRequired,
    );
    ensureCharacterCanPayJumpBridgeFee(session, activationFee);

    const fuelResult = consumeStructureLiquidOzone(sourceStructure, liquidOzoneRequired);
    if (!fuelResult.success) {
      if (fuelResult.errorMsg === "NO_FUEL") {
        throwNotify("That jump bridge does not have enough Liquid Ozone.");
      }
      throwNotify("Failed to consume jump bridge fuel.");
    }
    chargeJumpBridgeActivationFee(session, sourceStructure, activationFee);

    const jumpResult = jumpSessionToSolarSystem(session, destinationSolarSystemID, {
      spawnStateOverride: buildStructureArrivalSpawnState(destinationStructure, activeShip),
      stargateJumpCloak: true,
    });
    if (!jumpResult.success) {
      log.warn(
        `[StructureJumpBridgeMgr] jump failed char=${session.characterID} structure=${structureID}: ${jumpResult.errorMsg}`,
      );
      throwNotify("The jump bridge session change failed.");
    }

    log.info(
      `[StructureJumpBridgeMgr] char=${session.characterID} jumped source=${sourceStructure.structureID} destination=${destinationStructure.structureID} ozone=${liquidOzoneRequired} fee=${activationFee}`,
    );
    return jumpResult.data.boundResult || true;
  }
}

StructureJumpBridgeMgrService._testing = {
  ANSIBLEX_JUMP_RANGE_METERS,
  MAX_ANSIBLEX_RANGE_LY,
  MAX_ANSIBLEX_SHIP_MASS_KG,
  MAX_ANSIBLEX_ISK_PER_LIQUID_OZONE,
  calculateLiquidOzoneRequired,
  calculateJumpBridgeActivationFee,
  getSolarSystemDistanceLy,
  findReciprocalLinkedStructure,
  consumeStructureLiquidOzone,
  listStructureLiquidOzoneStacks,
};

module.exports = StructureJumpBridgeMgrService;
