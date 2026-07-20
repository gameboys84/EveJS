const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  ITEM_FLAGS,
  listContainerItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const {
  EVENT_STANDING_CONTRABAND_TRAFFICKING,
  applyStandingChanges,
} = require(path.join(__dirname, "../character/standingRuntime"));
const {
  applyDogmaModifierGroups,
  getActiveImplantCharacterModifierEntries,
} = require(path.join(__dirname, "../dogma/implants/activeImplantModifiers"));

const ATTRIBUTE_SMUGGLING_MODIFIER = 445;

const CONTRABAND_TYPE_RULES = Object.freeze([
  {
    typeID: 3713,
    factions: [
      { factionID: 500005, attackMinSec: 1.1, confiscateMinSec: 0.4, fineByValue: 4.5, standingLoss: 0.2 },
      { factionID: 500017, attackMinSec: 1.1, confiscateMinSec: 0.5, fineByValue: 1.5, standingLoss: 0.05 },
    ],
  },
  {
    typeID: 3721,
    factions: [
      { factionID: 500001, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 5.0, standingLoss: 0.2 },
      { factionID: 500002, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 10.0, standingLoss: 0.5 },
      { factionID: 500004, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 8.0, standingLoss: 0.3 },
      { factionID: 500005, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 5.0, standingLoss: 0.2 },
      { factionID: 500006, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 8.0, standingLoss: 0.0 },
      { factionID: 500009, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 4.0, standingLoss: 0.15 },
      { factionID: 500014, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 5.0, standingLoss: 0.2 },
      { factionID: 500015, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 9.0, standingLoss: 0.4 },
      { factionID: 500016, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 6.0, standingLoss: 0.3 },
      { factionID: 500017, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 8.0, standingLoss: 0.3 },
      { factionID: 500018, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 5.0, standingLoss: 0.2 },
    ],
  },
  {
    typeID: 3727,
    factions: [
      { factionID: 500003, attackMinSec: 1.1, confiscateMinSec: 0.6, fineByValue: 1.2, standingLoss: 0.05 },
      { factionID: 500005, attackMinSec: 1.1, confiscateMinSec: 0.5, fineByValue: 3.0, standingLoss: 0.1 },
      { factionID: 500007, attackMinSec: 1.1, confiscateMinSec: 0.6, fineByValue: 1.2, standingLoss: 0.05 },
      { factionID: 500008, attackMinSec: 1.1, confiscateMinSec: 0.5, fineByValue: 1.2, standingLoss: 0.05 },
      { factionID: 500017, attackMinSec: 1.1, confiscateMinSec: 0.4, fineByValue: 2.0, standingLoss: 0.05 },
    ],
  },
  {
    typeID: 3729,
    factions: [
      { factionID: 500001, attackMinSec: 1.1, confiscateMinSec: 0.4, fineByValue: 2.0, standingLoss: 0.1 },
      { factionID: 500002, attackMinSec: 1.1, confiscateMinSec: 0.8, fineByValue: 1.1, standingLoss: 0.05 },
      { factionID: 500004, attackMinSec: 1.1, confiscateMinSec: 0.4, fineByValue: 2.5, standingLoss: 0.15 },
      { factionID: 500005, attackMinSec: 1.1, confiscateMinSec: 0.7, fineByValue: 2.0, standingLoss: 0.05 },
      { factionID: 500006, attackMinSec: 1.1, confiscateMinSec: 0.4, fineByValue: 2.5, standingLoss: 0.0 },
      { factionID: 500009, attackMinSec: 1.1, confiscateMinSec: 0.2, fineByValue: 1.5, standingLoss: 0.05 },
      { factionID: 500014, attackMinSec: 1.1, confiscateMinSec: 1.1, fineByValue: 1.2, standingLoss: 0.05 },
      { factionID: 500015, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 1.1, standingLoss: 0.05 },
      { factionID: 500016, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 2.0, standingLoss: 0.1 },
      { factionID: 500017, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 2.5, standingLoss: 0.15 },
      { factionID: 500018, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 2.0, standingLoss: 0.05 },
    ],
  },
  {
    typeID: 9844,
    factions: [
      { factionID: 500001, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 5.0, standingLoss: 0.2 },
      { factionID: 500003, attackMinSec: 1.1, confiscateMinSec: 0.5, fineByValue: 3.0, standingLoss: 0.1 },
      { factionID: 500007, attackMinSec: 1.1, confiscateMinSec: 0.6, fineByValue: 1.5, standingLoss: 0.05 },
      { factionID: 500008, attackMinSec: 1.1, confiscateMinSec: 0.3, fineByValue: 4.0, standingLoss: 0.15 },
      { factionID: 500014, attackMinSec: 1.1, confiscateMinSec: 0.4, fineByValue: 1.1, standingLoss: 0.05 },
      { factionID: 500018, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 3.0, standingLoss: 0.1 },
    ],
  },
  {
    typeID: 11855,
    factions: [
      { factionID: 500004, attackMinSec: 1.1, confiscateMinSec: 0.8, fineByValue: 1.2, standingLoss: 0.05 },
      { factionID: 500009, attackMinSec: 1.1, confiscateMinSec: 0.3, fineByValue: 1.2, standingLoss: 0.05 },
      { factionID: 500014, attackMinSec: 1.1, confiscateMinSec: 0.2, fineByValue: 1.2, standingLoss: 0.05 },
      { factionID: 500016, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 1.2, standingLoss: 0.05 },
    ],
  },
  {
    typeID: 12478,
    factions: [
      { factionID: 500003, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 10.0, standingLoss: 0.3 },
      { factionID: 500007, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 10.0, standingLoss: 0.4 },
      { factionID: 500008, attackMinSec: 1.1, confiscateMinSec: -1.0, fineByValue: 7.0, standingLoss: 0.2 },
    ],
  },
  {
    typeID: 17796,
    factions: [
      { factionID: 500001, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
      { factionID: 500002, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
      { factionID: 500004, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
      { factionID: 500006, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
      { factionID: 500013, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
      { factionID: 500014, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
      { factionID: 500016, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
      { factionID: 500017, attackMinSec: 1.1, confiscateMinSec: 1.0, fineByValue: 0.0, standingLoss: 0.0 },
    ],
  },
]);

let rulesByTypeID = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getRuleMap() {
  if (rulesByTypeID) {
    return rulesByTypeID;
  }

  rulesByTypeID = new Map();
  for (const row of CONTRABAND_TYPE_RULES) {
    const typeID = toInt(row && row.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    const factions = new Map();
    for (const factionRule of Array.isArray(row.factions) ? row.factions : []) {
      const factionID = toInt(factionRule && factionRule.factionID, 0);
      if (factionID > 0) {
        factions.set(factionID, { ...factionRule, factionID });
      }
    }
    rulesByTypeID.set(typeID, {
      typeID,
      factions,
    });
  }
  return rulesByTypeID;
}

function getContrabandRuleForFaction(typeID, factionID) {
  const typeRule = getRuleMap().get(toInt(typeID, 0));
  if (!typeRule) {
    return null;
  }
  return typeRule.factions.get(toInt(factionID, 0)) || null;
}

function resolveCharacterSmugglingChance(characterID) {
  const attributes = {
    [ATTRIBUTE_SMUGGLING_MODIFIER]: 0,
  };
  applyDogmaModifierGroups(
    attributes,
    getActiveImplantCharacterModifierEntries(characterID).filter((entry) =>
      toInt(entry && entry.modifiedAttributeID, 0) === ATTRIBUTE_SMUGGLING_MODIFIER,
    ),
  );
  return Math.max(0, Math.min(1, toNumber(attributes[ATTRIBUTE_SMUGGLING_MODIFIER], 0)));
}

function getSystemInspectionAuthority(solarSystemID) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  const factionID = toInt(system && system.factionID, 0);
  const security = toNumber(
    system && (
      system.security ??
      system.securityStatus
    ),
    NaN,
  );
  if (!system || factionID <= 0 || !Number.isFinite(security)) {
    return null;
  }
  return {
    solarSystemID: toInt(system.solarSystemID ?? solarSystemID, 0),
    solarSystemName: String(system.solarSystemName || ""),
    factionID,
    security,
  };
}

function getItemQuantity(item) {
  const stackSize = toInt(item && item.stacksize, 0);
  if (stackSize > 0) {
    return stackSize;
  }
  const quantity = toInt(item && item.quantity, 0);
  return quantity > 0 ? quantity : 1;
}

function getItemBasePrice(typeID) {
  const typeRecord = resolveItemByTypeID(typeID);
  return Math.max(0, toNumber(typeRecord && typeRecord.basePrice, 0));
}

function listCargoItems(characterID, shipID) {
  const ownedCargo = listContainerItems(
    characterID,
    shipID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  if (ownedCargo.length > 0) {
    return ownedCargo;
  }
  return listContainerItems(null, shipID, ITEM_FLAGS.CARGO_HOLD);
}

function buildContrabandEntries(characterID, shipID, authority) {
  if (!authority) {
    return [];
  }

  const entries = [];
  const seenItemIDs = new Set();
  for (const item of listCargoItems(characterID, shipID)) {
    const itemID = toInt(item && item.itemID, 0);
    const typeID = toInt(item && item.typeID, 0);
    if (itemID <= 0 || typeID <= 0 || seenItemIDs.has(itemID)) {
      continue;
    }
    seenItemIDs.add(itemID);

    const rule = getContrabandRuleForFaction(typeID, authority.factionID);
    if (!rule) {
      continue;
    }
    const confiscateMinSec = toNumber(rule.confiscateMinSec, 1.1);
    if (authority.security < confiscateMinSec) {
      continue;
    }

    const quantity = getItemQuantity(item);
    const basePrice = getItemBasePrice(typeID);
    const fine = roundMoney(quantity * basePrice * Math.max(0, toNumber(rule.fineByValue, 0)));
    entries.push({
      item: cloneValue(item),
      itemID,
      typeID,
      quantity,
      basePrice,
      fineByValue: toNumber(rule.fineByValue, 0),
      fine,
      standingLoss: Math.max(0, toNumber(rule.standingLoss, 0)),
      confiscateMinSec,
      attackMinSec: toNumber(rule.attackMinSec, 1.1),
    });
  }

  return entries;
}

function getInspectionRoll(options = {}) {
  const explicitRoll = toNumber(
    options.roll ??
      options.detectionRoll,
    NaN,
  );
  if (Number.isFinite(explicitRoll)) {
    return Math.max(0, Math.min(1, explicitRoll));
  }
  const random = typeof options.random === "function" ? options.random : Math.random;
  return Math.max(0, Math.min(1, toNumber(random(), 1)));
}

function applyContrabandPenalties(characterID, authority, entries, options = {}) {
  const removedItems = [];
  const removedChanges = [];
  const removalErrors = [];
  for (const entry of entries) {
    const removeResult = removeInventoryItem(entry.itemID, { removeContents: true });
    if (removeResult && removeResult.success) {
      removedItems.push(...((removeResult.data && removeResult.data.removedItems) || []));
      removedChanges.push(...((removeResult.data && removeResult.data.changes) || []));
      continue;
    }
    removalErrors.push({
      itemID: entry.itemID,
      errorMsg: (removeResult && removeResult.errorMsg) || "REMOVE_ERROR",
    });
  }

  const totalFine = roundMoney(entries.reduce((sum, entry) => sum + entry.fine, 0));
  const wallet = getCharacterWallet(characterID);
  const chargedFine = wallet
    ? roundMoney(Math.min(Math.max(0, wallet.balance), totalFine))
    : 0;
  const unpaidFine = roundMoney(totalFine - chargedFine);
  const walletResult = chargedFine > 0
    ? adjustCharacterBalance(characterID, -chargedFine, {
        entryTypeID: JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT,
        referenceID: authority.factionID,
        ownerID2: authority.factionID,
        reason: "Contraband fine",
        description: `Contraband fine in ${authority.solarSystemName || authority.solarSystemID}`,
      })
    : null;

  const standingLoss = entries.reduce(
    (sum, entry) => sum + Math.max(0, toNumber(entry.standingLoss, 0)),
    0,
  );
  const standingResult = standingLoss > 0
    ? applyStandingChanges(
        characterID,
        [{
          ownerID: authority.factionID,
          rawChange: -standingLoss,
          applySocial: false,
          eventTypeID: EVENT_STANDING_CONTRABAND_TRAFFICKING,
          msg: "Contraband trafficking",
          int_1: authority.solarSystemID,
          int_2: entries.length === 1 ? entries[0].typeID : null,
          int_3: entries.reduce((sum, entry) => sum + entry.quantity, 0),
        }],
        { disableDerived: options.disableDerivedStandings !== false },
      )
    : null;

  return {
    removedItems,
    removedChanges,
    removalErrors,
    walletResult,
    standingResult,
    totalFine,
    chargedFine,
    unpaidFine,
    standingLoss,
  };
}

function inspectCharacterContraband(characterID, shipID, solarSystemID, options = {}) {
  const normalizedCharacterID = toInt(characterID, 0);
  const normalizedShipID = toInt(shipID, 0);
  if (normalizedCharacterID <= 0 || normalizedShipID <= 0) {
    return {
      success: false,
      errorMsg: "SHIP_REQUIRED",
    };
  }

  const authority = getSystemInspectionAuthority(solarSystemID);
  if (!authority) {
    return {
      success: true,
      data: {
        inspected: false,
        detected: false,
        evaded: false,
        reason: "NO_FACTION_AUTHORITY",
        contraband: [],
      },
    };
  }

  const contraband = buildContrabandEntries(
    normalizedCharacterID,
    normalizedShipID,
    authority,
  );
  if (!contraband.length) {
    return {
      success: true,
      data: {
        inspected: true,
        detected: false,
        evaded: false,
        authority,
        smugglingChance: resolveCharacterSmugglingChance(normalizedCharacterID),
        roll: null,
        contraband,
        totalFine: 0,
        standingLoss: 0,
      },
    };
  }

  const smugglingChance = resolveCharacterSmugglingChance(normalizedCharacterID);
  const roll = getInspectionRoll(options);
  const evaded = roll < smugglingChance;
  const totalFine = roundMoney(contraband.reduce((sum, entry) => sum + entry.fine, 0));
  const standingLoss = contraband.reduce((sum, entry) => sum + entry.standingLoss, 0);
  if (evaded) {
    return {
      success: true,
      data: {
        inspected: true,
        detected: false,
        evaded: true,
        authority,
        smugglingChance,
        roll,
        contraband,
        totalFine,
        standingLoss,
      },
    };
  }

  let penalties = null;
  if (options.applyPenalties !== false) {
    penalties = applyContrabandPenalties(
      normalizedCharacterID,
      authority,
      contraband,
      options,
    );
  }

  log.info(
    `[Contraband] char=${normalizedCharacterID} ship=${normalizedShipID} system=${authority.solarSystemID} faction=${authority.factionID} items=${contraband.length} fine=${totalFine} standingLoss=${standingLoss.toFixed(3)}`,
  );

  return {
    success: true,
    data: {
      inspected: true,
      detected: true,
      evaded: false,
      authority,
      smugglingChance,
      roll,
      contraband,
      totalFine,
      standingLoss,
      penalties,
    },
  };
}

module.exports = {
  ATTRIBUTE_SMUGGLING_MODIFIER,
  CONTRABAND_TYPE_RULES,
  getContrabandRuleForFaction,
  inspectCharacterContraband,
  resolveCharacterSmugglingChance,
};
