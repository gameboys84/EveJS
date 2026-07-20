const path = require("path");

const { resolveItemByTypeID } = require(path.join(__dirname, "./itemTypeRegistry"));

const SPECIAL_SHIP_HOLD_DEFINITIONS = Object.freeze([
  {
    key: "fuel",
    flagID: 133,
    attributeNames: Object.freeze(["specialFuelBayCapacity"]),
    attributeIDs: Object.freeze([1549]),
    managedBy: "fuel",
  },
  {
    key: "generalMining",
    flagID: 134,
    attributeNames: Object.freeze(["generalMiningHoldCapacity"]),
    attributeIDs: Object.freeze([1556]),
    managedBy: "mining",
  },
  {
    key: "gas",
    flagID: 135,
    attributeNames: Object.freeze(["specialGasHoldCapacity"]),
    attributeIDs: Object.freeze([1557]),
    managedBy: "mining",
  },
  {
    key: "mineral",
    flagID: 136,
    attributeNames: Object.freeze(["specialMineralHoldCapacity"]),
    attributeIDs: Object.freeze([1558]),
    accepts: "mineral",
  },
  {
    key: "salvage",
    flagID: 137,
    attributeNames: Object.freeze(["specialSalvageHoldCapacity"]),
    attributeIDs: Object.freeze([1559]),
    accepts: "salvage",
  },
  {
    key: "ship",
    flagID: 138,
    attributeNames: Object.freeze(["specialShipHoldCapacity"]),
    attributeIDs: Object.freeze([1560]),
    accepts: "ship",
  },
  {
    key: "smallShip",
    flagID: 139,
    attributeNames: Object.freeze(["specialSmallShipHoldCapacity"]),
    attributeIDs: Object.freeze([1561]),
    accepts: "ship",
  },
  {
    key: "mediumShip",
    flagID: 140,
    attributeNames: Object.freeze(["specialMediumShipHoldCapacity"]),
    attributeIDs: Object.freeze([1562]),
    accepts: "ship",
  },
  {
    key: "largeShip",
    flagID: 141,
    attributeNames: Object.freeze(["specialLargeShipHoldCapacity"]),
    attributeIDs: Object.freeze([1563]),
    accepts: "ship",
  },
  {
    key: "industrialShip",
    flagID: 142,
    attributeNames: Object.freeze(["specialIndustrialShipHoldCapacity"]),
    attributeIDs: Object.freeze([1564]),
    accepts: "ship",
  },
  {
    key: "ammo",
    flagID: 143,
    attributeNames: Object.freeze(["specialAmmoHoldCapacity"]),
    attributeIDs: Object.freeze([1573]),
    accepts: "charge",
  },
  {
    key: "commandCenter",
    flagID: 148,
    attributeNames: Object.freeze(["specialCommandCenterHoldCapacity"]),
    attributeIDs: Object.freeze([1646]),
    accepts: "commandCenter",
  },
  {
    key: "planetaryCommodities",
    flagID: 149,
    attributeNames: Object.freeze(["specialPlanetaryCommoditiesHoldCapacity"]),
    attributeIDs: Object.freeze([1653]),
    accepts: "planetaryCommodity",
  },
  {
    key: "quafe",
    flagID: 154,
    attributeNames: Object.freeze(["specialQuafeHoldCapacity"]),
    attributeIDs: Object.freeze([1804]),
    accepts: "quafe",
  },
  {
    key: "corpse",
    flagID: 174,
    attributeNames: Object.freeze(["specialCorpseHoldCapacity"]),
    attributeIDs: Object.freeze([2467]),
    accepts: "corpse",
  },
  {
    key: "booster",
    flagID: 176,
    attributeNames: Object.freeze(["specialBoosterHoldCapacity"]),
    attributeIDs: Object.freeze([2657]),
    accepts: "booster",
  },
  {
    key: "subsystem",
    flagID: 177,
    attributeNames: Object.freeze(["specialSubsystemHoldCapacity"]),
    attributeIDs: Object.freeze([2675]),
    accepts: "subsystem",
  },
  {
    key: "ice",
    flagID: 181,
    attributeNames: Object.freeze(["specialIceHoldCapacity"]),
    attributeIDs: Object.freeze([3136]),
    managedBy: "mining",
  },
  {
    key: "asteroid",
    flagID: 182,
    attributeNames: Object.freeze(["specialAsteroidHoldCapacity"]),
    attributeIDs: Object.freeze([3227]),
    managedBy: "mining",
  },
  {
    key: "mobileDepot",
    flagID: 183,
    attributeNames: Object.freeze(["specialMobileDepotHoldCapacity"]),
    attributeIDs: Object.freeze([5325]),
    managedBy: "mobileDepot",
  },
  {
    key: "infrastructure",
    flagID: 185,
    attributeNames: Object.freeze(["specialColonyResourcesHoldCapacity"]),
    attributeIDs: Object.freeze([5646]),
    accepts: "infrastructure",
  },
  {
    key: "expedition",
    flagID: 188,
    attributeNames: Object.freeze(["specialExpeditionHoldCapacity"]),
    attributeIDs: Object.freeze([5944]),
    accepts: "expeditionCharge",
  },
]);

const definitionsByFlag = new Map(
  SPECIAL_SHIP_HOLD_DEFINITIONS.map((definition) => [
    definition.flagID,
    definition,
  ]),
);

const SPECIAL_SHIP_HOLD_FLAGS = Object.freeze(
  SPECIAL_SHIP_HOLD_DEFINITIONS.map((definition) => definition.flagID),
);

const GENERIC_SPECIAL_SHIP_HOLD_FLAGS = Object.freeze(
  SPECIAL_SHIP_HOLD_DEFINITIONS
    .filter((definition) => !definition.managedBy)
    .map((definition) => definition.flagID),
);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveTypeRecord(itemOrTypeID) {
  if (!itemOrTypeID) {
    return null;
  }

  if (typeof itemOrTypeID === "object") {
    const typeID = toInt(itemOrTypeID.typeID || itemOrTypeID.itemTypeID, 0);
    const resolvedType = typeID > 0 ? resolveItemByTypeID(typeID) : null;
    return resolvedType
      ? { ...resolvedType, ...itemOrTypeID }
      : itemOrTypeID;
  }

  const typeID = toInt(itemOrTypeID, 0);
  return typeID > 0 ? resolveItemByTypeID(typeID) : null;
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function groupNameContains(typeRecord, pattern) {
  return normalizedText(typeRecord && typeRecord.groupName).includes(pattern);
}

function itemNameContains(typeRecord, pattern) {
  return normalizedText(typeRecord && typeRecord.name).includes(pattern);
}

function categoryID(typeRecord) {
  return toInt(typeRecord && typeRecord.categoryID, 0);
}

function groupID(typeRecord) {
  return toInt(typeRecord && typeRecord.groupID, 0);
}

const INFRASTRUCTURE_HOLD_ALLOWED_CATEGORY_IDS = Object.freeze(new Set([
  22, // Deployable
  39, // Infrastructure Upgrades
  40, // Sovereignty Structure
  42, // Planetary Resources
  43, // Planetary Commodities
  46, // Orbital
  65, // Structure
  66, // Structure Module
]));

const INFRASTRUCTURE_HOLD_ALLOWED_GROUP_IDS = Object.freeze(new Set([
  423, // Ice Product
  427, // Moon Materials
  1027, // Command Pins
  1136, // Fuel Block
  1546, // Structure Missile
  1547, // Structure Flak Missile
  1548, // Structure Area Missile
  1549, // Structure ECM Script
  1551, // Structure Warp Disruptor Script
  4186, // Structure Area Denial Ammunition
  4729, // Colony Reagents
  4777, // Structure Light Fighter
  4778, // Structure Support Fighter
  4779, // Structure Heavy Fighter
]));

const INFRASTRUCTURE_HOLD_ALLOWED_TYPE_IDS = Object.freeze(new Set([
  3645, // Water
  3683, // Oxygen
]));

function getSpecialShipHoldDefinition(flagID) {
  return definitionsByFlag.get(toInt(flagID, 0)) || null;
}

function isSpecialShipHoldFlag(flagID) {
  return definitionsByFlag.has(toInt(flagID, 0));
}

function isGenericSpecialShipHoldFlag(flagID) {
  const definition = getSpecialShipHoldDefinition(flagID);
  return Boolean(definition && !definition.managedBy);
}

function isSpecialShipHoldItemAllowed(itemOrTypeID, flagID) {
  const definition = getSpecialShipHoldDefinition(flagID);
  if (!definition || definition.managedBy) {
    return null;
  }

  const typeRecord = resolveTypeRecord(itemOrTypeID);
  if (!typeRecord) {
    return false;
  }

  switch (definition.accepts) {
    case "mineral":
      return groupID(typeRecord) === 18 || groupNameContains(typeRecord, "mineral");
    case "salvage":
      return groupNameContains(typeRecord, "salvage");
    case "ship":
      return categoryID(typeRecord) === 6;
    case "charge":
      return categoryID(typeRecord) === 8;
    case "commandCenter":
      return groupID(typeRecord) === 1027 || categoryID(typeRecord) === 41;
    case "planetaryCommodity":
      return categoryID(typeRecord) === 42 || categoryID(typeRecord) === 43;
    case "quafe":
      return itemNameContains(typeRecord, "quafe");
    case "corpse":
      return groupID(typeRecord) === 14 || itemNameContains(typeRecord, "corpse");
    case "booster":
      return groupID(typeRecord) === 303 || groupNameContains(typeRecord, "booster");
    case "subsystem":
      return categoryID(typeRecord) === 32 || groupNameContains(typeRecord, "subsystem");
    case "infrastructure":
      return (
        INFRASTRUCTURE_HOLD_ALLOWED_CATEGORY_IDS.has(categoryID(typeRecord)) ||
        INFRASTRUCTURE_HOLD_ALLOWED_GROUP_IDS.has(groupID(typeRecord)) ||
        INFRASTRUCTURE_HOLD_ALLOWED_TYPE_IDS.has(toInt(typeRecord.typeID, 0))
      );
    case "expeditionCharge":
      return groupID(typeRecord) === 4905 || groupNameContains(typeRecord, "expedition command burst charge");
    default:
      return true;
  }
}

function getSpecialShipHoldCapacity(
  resourceState,
  shipTypeID,
  flagID,
  getBaseAttributeValue = null,
) {
  const definition = getSpecialShipHoldDefinition(flagID);
  if (!definition) {
    return 0;
  }

  const attributes =
    resourceState && resourceState.attributes && typeof resourceState.attributes === "object"
      ? resourceState.attributes
      : null;
  if (attributes) {
    for (const attributeID of definition.attributeIDs || []) {
      const value = toFiniteNumber(
        attributes[attributeID] ?? attributes[String(attributeID)],
        NaN,
      );
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  if (typeof getBaseAttributeValue === "function") {
    return toFiniteNumber(
      getBaseAttributeValue(shipTypeID, ...(definition.attributeNames || [])),
      0,
    );
  }

  return 0;
}

module.exports = {
  SPECIAL_SHIP_HOLD_DEFINITIONS,
  SPECIAL_SHIP_HOLD_FLAGS,
  GENERIC_SPECIAL_SHIP_HOLD_FLAGS,
  getSpecialShipHoldDefinition,
  isSpecialShipHoldFlag,
  isGenericSpecialShipHoldFlag,
  isSpecialShipHoldItemAllowed,
  getSpecialShipHoldCapacity,
};
