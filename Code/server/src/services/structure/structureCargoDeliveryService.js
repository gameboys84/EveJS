const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const { syncInventoryItemForSession } = require(path.join(
  __dirname,
  "../character/characterState",
));
const crimewatchState = require(path.join(__dirname, "../security/crimewatchState"));
const {
  ITEM_FLAGS,
  findItemById,
  transferItemToOwnerLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const structureState = require(path.join(__dirname, "./structureState"));

const CARGO_DEPOSIT_RANGE_METERS = 10000;
const TYPE_LIQUID_OZONE = 16273;
const TYPE_COLONY_REAGENT_LAVA = 81143;
const TYPE_UPWELL_AUTO_MOON_MINER = 81826;
const GROUP_FUEL_BLOCK = 1136;

const CARGO_HOLDS_VALID_FOR_DELIVERY_SERVICE = Object.freeze(new Set([
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.SHIP_HANGAR,
  ITEM_FLAGS.SPECIALIZED_FUEL_BAY,
  ITEM_FLAGS.GENERAL_MINING_HOLD,
  ITEM_FLAGS.SPECIALIZED_MINERAL_HOLD,
  ITEM_FLAGS.SPECIALIZED_SALVAGE_HOLD,
  ITEM_FLAGS.SPECIALIZED_SHIP_HOLD,
  ITEM_FLAGS.SPECIALIZED_SMALL_SHIP_HOLD,
  ITEM_FLAGS.SPECIALIZED_MEDIUM_SHIP_HOLD,
  ITEM_FLAGS.SPECIALIZED_LARGE_SHIP_HOLD,
  ITEM_FLAGS.SPECIALIZED_INDUSTRIAL_SHIP_HOLD,
  ITEM_FLAGS.SPECIALIZED_AMMO_HOLD,
  ITEM_FLAGS.SPECIALIZED_COMMAND_CENTER_HOLD,
  ITEM_FLAGS.SPECIALIZED_PLANETARY_COMMODITIES_HOLD,
  ITEM_FLAGS.SPECIALIZED_ASTEROID_HOLD,
  ITEM_FLAGS.SPECIALIZED_GAS_HOLD,
  ITEM_FLAGS.SPECIALIZED_ICE_HOLD,
  ITEM_FLAGS.QUAFE_BAY,
  ITEM_FLAGS.FLEET_HANGAR,
  ITEM_FLAGS.CORPSE_BAY,
  ITEM_FLAGS.BOOSTER_BAY,
  ITEM_FLAGS.SUBSYSTEM_BAY,
  ITEM_FLAGS.MOBILE_DEPOT_HOLD,
  ITEM_FLAGS.COLONY_RESOURCES_HOLD,
  ITEM_FLAGS.EXPEDITION_HOLD,
]));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clonePoint(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function distance(left, right) {
  const a = clonePoint(left);
  const b = clonePoint(right);
  return Math.sqrt(
    ((a.x - b.x) ** 2) +
    ((a.y - b.y) ** 2) +
    ((a.z - b.z) ** 2),
  );
}

function surfaceDistance(left, right) {
  return Math.max(
    0,
    distance(left && left.position, right && right.position) -
      Math.max(0, toFiniteNumber(left && left.radius, 0)) -
      Math.max(0, toFiniteNumber(right && right.radius, 0)),
  );
}

function throwNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "Cargo Deposit is not available right now."),
  });
}

function normalizeItemIDList(rawValue) {
  const unwrapped = unwrapMarshalValue(rawValue);
  const values = Array.isArray(unwrapped)
    ? unwrapped
    : unwrapped && typeof unwrapped === "object"
      ? Object.values(unwrapped)
      : [unwrapped];
  return [...new Set(
    values
      .map((value) => toPositiveInt(value, 0))
      .filter((value) => value > 0),
  )];
}

function getSessionCharacterID(session) {
  return toPositiveInt(
    session && (session.characterID || session.charID || session.charid),
    0,
  );
}

function getSessionShipID(session) {
  return toPositiveInt(
    session && (
      (session._space && session._space.shipID) ||
      session.shipID ||
      session.shipid ||
      session.activeShipID
    ),
    0,
  );
}

function getSessionSolarSystemID(session) {
  return toPositiveInt(
    session && (
      (session._space && session._space.systemID) ||
      session.solarsystemid2 ||
      session.solarsystemid
    ),
    0,
  );
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

function isCloaked(entity) {
  return Boolean(
    entity &&
      (entity.cloaked === true || toInt(entity.cloakMode, 0) > 0),
  );
}

function isWarping(entity) {
  return Boolean(
    entity &&
      (
        entity.pendingWarp ||
        entity.warpState ||
        String(entity.mode || "").toUpperCase() === "WARP"
      ),
  );
}

function hasActiveWeaponTimer(characterID, now = Date.now()) {
  const state = crimewatchState.getCharacterCrimewatchState(characterID, now);
  return Boolean(
    state &&
      toFiniteNumber(state.weaponTimerExpiresAtMs, 0) > now,
  );
}

function resolveShipEntity(session, shipID, shipItem) {
  const entity = spaceRuntime.getEntity(session, shipID);
  if (entity) {
    return entity;
  }

  const spaceState = shipItem && shipItem.spaceState;
  if (!spaceState || typeof spaceState !== "object") {
    return null;
  }
  return {
    id: shipID,
    itemID: shipID,
    kind: "ship",
    position: clonePoint(spaceState.position),
    radius: Math.max(0, toFiniteNumber(shipItem.radius || shipItem.spaceRadius, 0)),
    mode: spaceState.mode || "STOP",
    warpState: spaceState.warpState || null,
    pendingWarp: spaceState.pendingWarp || null,
  };
}

function resolveStructureEntity(session, structure) {
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  const entity = structureID ? spaceRuntime.getEntity(session, structureID) : null;
  if (entity) {
    return entity;
  }
  return {
    id: structureID,
    itemID: structureID,
    kind: "structure",
    position: clonePoint(structure && structure.position),
    radius: Math.max(0, toFiniteNumber(structure && structure.radius, 0)),
  };
}

function isFuelBlockType(typeID) {
  const typeRecord = resolveItemByTypeID(typeID);
  return toPositiveInt(typeRecord && typeRecord.groupID, 0) === GROUP_FUEL_BLOCK;
}

function isAllowedFlexFuelType(typeID, structureTypeID) {
  const normalizedTypeID = toPositiveInt(typeID, 0);
  if (!normalizedTypeID) {
    return false;
  }
  if (isFuelBlockType(normalizedTypeID)) {
    return true;
  }
  if (toPositiveInt(structureTypeID, 0) === TYPE_UPWELL_AUTO_MOON_MINER) {
    return normalizedTypeID === TYPE_COLONY_REAGENT_LAVA;
  }
  return normalizedTypeID === TYPE_LIQUID_OZONE;
}

function syncInventoryChanges(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(session, change.item, change.previousData || {}, {
      emitCfgLocation: false,
    });
  }
}

function incrementFlexLiquidOzone(structureID, quantity) {
  const normalizedQuantity = Math.max(0, toInt(quantity, 0));
  if (!structureID || normalizedQuantity <= 0) {
    return;
  }
  const updateResult = structureState.updateStructureRecord(structureID, (current) => ({
    ...current,
    liquidOzoneQty:
      Math.max(0, toInt(current && current.liquidOzoneQty, 0)) +
      normalizedQuantity,
  }));
  if (!updateResult.success) {
    throwNotify("Cargo Deposit could not update the structure fuel state.");
  }
}

function validateCargoDepositAccess(session, shipID, structure) {
  const characterID = getSessionCharacterID(session);
  if (!characterID) {
    throwNotify("You need an active character to use Cargo Deposit.");
  }
  if (!session || !session._space) {
    throwNotify("You must be in space to use Cargo Deposit.");
  }

  const sessionShipID = getSessionShipID(session);
  if (!shipID || !sessionShipID || shipID !== sessionShipID) {
    throwNotify("Cargo Deposit is only available for your active ship.");
  }

  if (!structure || structure.destroyedAt) {
    throwNotify("That structure is no longer available.");
  }

  const systemID = getSessionSolarSystemID(session);
  if (
    toPositiveInt(structure.solarSystemID, 0) !== systemID
  ) {
    throwNotify("You are not in the same solar system as that structure.");
  }

  const now = Date.now();
  if (crimewatchState.isCriminallyFlagged(characterID, now)) {
    throwNotify("Cargo Deposit cannot be used while you have a criminal timer.");
  }
  if (hasActiveWeaponTimer(characterID, now)) {
    throwNotify("Cargo Deposit cannot be used while you have an active weapons timer.");
  }

  const shipItem = findItemById(shipID);
  const shipEntity = resolveShipEntity(session, shipID, shipItem);
  if (!shipItem || !shipEntity) {
    throwNotify("Cargo Deposit could not find your active ship in space.");
  }
  if (isCloaked(shipEntity)) {
    throwNotify("Cargo Deposit cannot be used while cloaked.");
  }
  if (isWarping(shipEntity)) {
    throwNotify("Cargo Deposit cannot be used while warping.");
  }

  const structureEntity = resolveStructureEntity(session, structure);
  if (surfaceDistance(shipEntity, structureEntity) > CARGO_DEPOSIT_RANGE_METERS) {
    throwNotify("You are too far away to use Cargo Deposit.");
  }

  return {
    characterID,
    shipItem,
    shipEntity,
    structureEntity,
  };
}

function validateDepositableItem(item, context) {
  const characterID = context.characterID;
  const shipID = context.shipID;
  const structure = context.structure;

  if (!item) {
    return "ITEM_NOT_FOUND";
  }
  if (toPositiveInt(item.ownerID, 0) !== characterID) {
    return "ITEM_NOT_OWNED";
  }
  if (toPositiveInt(item.locationID, 0) !== shipID) {
    return "ITEM_NOT_IN_SHIP";
  }
  if (!CARGO_HOLDS_VALID_FOR_DELIVERY_SERVICE.has(toInt(item.flagID, 0))) {
    return "ITEM_FLAG_NOT_ALLOWED";
  }
  if (
    structure.dockable !== true &&
      !isAllowedFlexFuelType(item.typeID, structure.typeID)
  ) {
    return "ITEM_TYPE_NOT_ALLOWED";
  }
  return null;
}

class StructureCargoDeliveryService extends BaseService {
  constructor() {
    super("structureCargoDelivery");
  }

  Handle_DropOffItems(args, session) {
    const itemIDs = normalizeItemIDList(Array.isArray(args) ? args[0] : null);
    const shipID = toPositiveInt(Array.isArray(args) ? unwrapMarshalValue(args[1]) : null, 0);
    const structureID = toPositiveInt(Array.isArray(args) ? unwrapMarshalValue(args[2]) : null, 0);
    const structure = structureID
      ? structureState.getStructureByID(structureID, { refresh: false })
      : null;

    const access = validateCargoDepositAccess(session, shipID, structure);
    const movedItemIDs = [];

    for (const itemID of itemIDs) {
      const item = findItemById(itemID);
      const validationError = validateDepositableItem(item, {
        characterID: access.characterID,
        shipID,
        structure,
      });
      if (validationError) {
        continue;
      }

      const destinationOwnerID =
        structure.dockable === true
          ? access.characterID
          : toPositiveInt(structure.ownerCorpID || structure.ownerID, access.characterID);
      const destinationFlagID =
        structure.dockable === true
          ? ITEM_FLAGS.DELIVERIES
          : ITEM_FLAGS.STRUCTURE_FUEL_BAY;
      const movedQuantity = getStackQuantity(item);
      const moveResult = transferItemToOwnerLocation(
        item.itemID,
        destinationOwnerID,
        structure.structureID,
        destinationFlagID,
      );
      if (!moveResult.success) {
        continue;
      }

      syncInventoryChanges(session, moveResult.data && moveResult.data.changes);
      if (
        structure.dockable !== true &&
          toPositiveInt(item.typeID, 0) === TYPE_LIQUID_OZONE
      ) {
        incrementFlexLiquidOzone(structure.structureID, movedQuantity);
      }
      movedItemIDs.push(item.itemID);
    }

    return movedItemIDs;
  }
}

module.exports = StructureCargoDeliveryService;
module.exports._testing = {
  CARGO_DEPOSIT_RANGE_METERS,
  CARGO_HOLDS_VALID_FOR_DELIVERY_SERVICE,
  isAllowedFlexFuelType,
};
