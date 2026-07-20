const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  buildDict,
  buildFiletimeLong,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const typeListAuthority = require(path.join(
  __dirname,
  "../inventory/typeListAuthority",
));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  STRUCTURE_SETTING_ID,
} = require(path.join(__dirname, "./structureServiceAuthority"));
const {
  characterHasStructureSetting,
} = require(path.join(__dirname, "./structurePayloads"));
const MoonExtractionsService = require(path.join(
  __dirname,
  "./moonExtractionsService",
));

const TYPE_UPWELL_AUTO_MOON_MINER = 81826;
const TYPE_COLONY_REAGENT_LAVA = 81143;
const GROUP_FUEL_BLOCK = 1136;
const OUTPUT_MATERIAL_TYPE_LIST_ID = 611;
const GROUP_MOON_MATERIAL = 427;
const FLAG_MOON_MATERIAL_BAY = 186;
const ATTRIBUTE_OUTPUT_MOON_MATERIAL_BAY_CAPACITY = 5693;
const DEFAULT_OUTPUT_MOON_MATERIAL_BAY_CAPACITY = 500000;
const CORP_ROLE_STATION_MANAGER = 2048n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Math.trunc(normalizeNumber(value, fallback));
  return numeric > 0 ? numeric : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = Math.trunc(normalizeNumber(value, fallback));
  return numeric >= 0 ? numeric : fallback;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const numeric = normalizeNumber(value, fallback);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function fileTimeLongFromMs(valueMs) {
  const numericMs = normalizeNonNegativeInteger(valueMs, 0);
  if (!numericMs) {
    return null;
  }
  return buildFiletimeLong(
    BigInt(numericMs) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET,
  );
}

function getItemQuantity(item) {
  if (!item || typeof item !== "object") {
    return 0;
  }
  if (normalizeNumber(item.singleton, 0) === 1) {
    return 1;
  }
  return Math.max(
    0,
    normalizeNonNegativeInteger(item.stacksize, 0),
    normalizeNonNegativeInteger(item.quantity, 0),
  );
}

function getTypeContext(itemOrTypeID) {
  const typeID = normalizePositiveInteger(
    typeof itemOrTypeID === "object"
      ? itemOrTypeID.typeID || itemOrTypeID.itemTypeID
      : itemOrTypeID,
    0,
  );
  const type = resolveItemByTypeID(typeID) || {};
  const source = typeof itemOrTypeID === "object" && itemOrTypeID
    ? itemOrTypeID
    : {};
  return {
    typeID,
    groupID: normalizePositiveInteger(source.groupID, normalizePositiveInteger(type.groupID, 0)),
    categoryID: normalizePositiveInteger(
      source.categoryID,
      normalizePositiveInteger(type.categoryID, 0),
    ),
    volume: normalizeNonNegativeNumber(source.volume, normalizeNonNegativeNumber(type.volume, 0)),
  };
}

function sortNumericDictEntries(entries = []) {
  return entries.sort((left, right) => Number(left[0]) - Number(right[0]));
}

function buildNumericDictFromMap(amountsByTypeID) {
  return buildDict(sortNumericDictEntries(
    [...amountsByTypeID.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([typeID, amount]) => [Number(typeID), amount]),
  ));
}

function getTypeDogmaAttribute(typeID, attributeID, fallback = 0) {
  const payload = readStaticTable(TABLE.TYPE_DOGMA);
  const typeDogma = payload &&
    payload.typesByTypeID &&
    payload.typesByTypeID[String(typeID)];
  const value = typeDogma &&
    typeDogma.attributes &&
    typeDogma.attributes[String(attributeID)];
  return normalizeNumber(value, fallback);
}

function getOutputBayCapacityForStructure(structure) {
  const structureTypeID = normalizePositiveInteger(
    structure && structure.typeID,
    TYPE_UPWELL_AUTO_MOON_MINER,
  );
  return normalizeNonNegativeNumber(
    getTypeDogmaAttribute(
      structureTypeID,
      ATTRIBUTE_OUTPUT_MOON_MATERIAL_BAY_CAPACITY,
      DEFAULT_OUTPUT_MOON_MATERIAL_BAY_CAPACITY,
    ),
    DEFAULT_OUTPUT_MOON_MATERIAL_BAY_CAPACITY,
  );
}

function isFuelOrReagent(typeContext) {
  return (
    typeContext.groupID === GROUP_FUEL_BLOCK ||
    typeContext.typeID === TYPE_COLONY_REAGENT_LAVA
  );
}

function isAutoMoonMinerOutputMaterial(typeContext) {
  if (!typeContext || typeContext.typeID <= 0) {
    return false;
  }
  return (
    typeListAuthority.matchesTypeList(typeContext, OUTPUT_MATERIAL_TYPE_LIST_ID) ||
    typeContext.groupID === GROUP_MOON_MATERIAL
  );
}

function sumItemsByType(items = [], predicate = () => true) {
  const amounts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const typeContext = getTypeContext(item);
    if (!predicate(typeContext, item)) {
      continue;
    }
    const quantity = getItemQuantity(item);
    if (quantity <= 0) {
      continue;
    }
    const key = String(typeContext.typeID);
    amounts.set(key, (amounts.get(key) || 0) + quantity);
  }
  return amounts;
}

function getOutputBayUsedVolume(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const typeContext = getTypeContext(item);
    if (!isAutoMoonMinerOutputMaterial(typeContext)) {
      return sum;
    }
    return sum + typeContext.volume * getItemQuantity(item);
  }, 0);
}

function normalizeCycleOutput(profile) {
  const source =
    profile &&
    typeof profile === "object" &&
    profile.autoMoonMiningCycleOutput &&
    typeof profile.autoMoonMiningCycleOutput === "object"
      ? profile.autoMoonMiningCycleOutput
      : {};
  const amounts = new Map();
  for (const [rawTypeID, rawAmount] of Object.entries(source)) {
    const typeID = normalizePositiveInteger(rawTypeID, 0);
    const amount = normalizeNonNegativeInteger(rawAmount, 0);
    if (typeID <= 0 || amount <= 0) {
      continue;
    }
    const typeContext = getTypeContext(typeID);
    if (!isAutoMoonMinerOutputMaterial(typeContext)) {
      continue;
    }
    amounts.set(String(typeID), amount);
  }
  return amounts;
}

function resolveNextHarvestTime(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  const explicitNextHarvestMs = normalizeNonNegativeInteger(
    profile.nextHarvestTimeMs || profile.nextHarvestTime,
    0,
  );
  if (explicitNextHarvestMs > 0) {
    return fileTimeLongFromMs(explicitNextHarvestMs);
  }

  const lastHarvestMs = normalizeNonNegativeInteger(
    profile.lastHarvestTimeMs || profile.lastHarvestTime,
    0,
  );
  const cycleSeconds = normalizeNonNegativeInteger(
    profile.miningCycleTimeSeconds || profile.miningCycleTime,
    0,
  );
  if (lastHarvestMs > 0 && cycleSeconds > 0) {
    return fileTimeLongFromMs(lastHarvestMs + cycleSeconds * 1000);
  }
  return null;
}

function extractStructureID(args = [], session = {}) {
  return normalizePositiveInteger(
    Array.isArray(args) && args.length > 1
      ? args[1]
      : session.structureid || session.structureID || session.shipid,
    0,
  );
}

function getSessionCorpID(session) {
  return normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    0,
  );
}

function normalizeRoleBitfield(value) {
  if (typeof value === "bigint") {
    return value;
  }
  return BigInt(normalizeNonNegativeInteger(value, 0));
}

function hasStationManagerRole(session) {
  const roleValue = session && (
    session.corprole ||
    session.corpRole ||
    session.rolesAtAll ||
    0
  );
  return (
    normalizeRoleBitfield(roleValue) & CORP_ROLE_STATION_MANAGER
  ) === CORP_ROLE_STATION_MANAGER;
}

function hasAutoMoonMinerOwnerStationManagerAccess(session, structure) {
  const ownerCorpID = normalizePositiveInteger(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
  return (
    ownerCorpID > 0 &&
    getSessionCorpID(session) === ownerCorpID &&
    hasStationManagerRole(session)
  );
}

function getStructureDisplayName(structure, structureID) {
  return (
    structure &&
    (structure.itemName || structure.name || structure.structureName)
  ) || `Structure ${normalizePositiveInteger(structureID, 0)}`;
}

function isAutoMoonMinerReinforced(structure) {
  const stateID = normalizePositiveInteger(structure && structure.state, 0);
  return (
    stateID === STRUCTURE_STATE.ARMOR_REINFORCE ||
    stateID === STRUCTURE_STATE.HULL_REINFORCE
  );
}

function ensureCanAccessAutoMoonMiner(session, structure, structureID) {
  const hasAccess = Boolean(structure) && (
    hasAutoMoonMinerOwnerStationManagerAccess(session, structure) ||
    characterHasStructureSetting(
      session,
      structure,
      STRUCTURE_SETTING_ID.AUTOMOONMINING,
    )
  );
  if (
    !hasAccess ||
    isAutoMoonMinerReinforced(structure)
  ) {
    throwWrappedUserError("AccessToAutoMoonMinerDenied", {
      structureName: getStructureDisplayName(structure, structureID),
    });
  }
}

class AutoMoonMiningService extends BaseService {
  constructor(options = {}) {
    super("autoMoonMining");
    this._resourceProfileProvider =
      options.resourceProfileProvider ||
      ((structureID) =>
        MoonExtractionsService.readResourceProfileForStructure(structureID));
    this._structureProvider =
      options.structureProvider ||
      ((structureID) =>
        structureState.getStructureByID(structureID, { refresh: false }));
    this._containerItemProvider =
      options.containerItemProvider ||
      ((structureID, flagID) =>
        itemStore.listContainerItems(null, structureID, flagID));
  }

  _getResourceProfile(structureID) {
    try {
      return this._resourceProfileProvider(structureID) || null;
    } catch (error) {
      log.warn(
        `[AutoMoonMining] Failed to resolve resource profile for structure ${structureID}: ${error.message}`,
      );
      return null;
    }
  }

  _getStructure(structureID) {
    try {
      return this._structureProvider(structureID) || null;
    } catch (error) {
      log.warn(
        `[AutoMoonMining] Failed to resolve structure ${structureID}: ${error.message}`,
      );
      return null;
    }
  }

  _getContainerItems(structureID, flagID) {
    try {
      return this._containerItemProvider(structureID, flagID) || [];
    } catch (error) {
      log.warn(
        `[AutoMoonMining] Failed to list structure ${structureID} flag ${flagID}: ${error.message}`,
      );
      return [];
    }
  }

  _resolveContext(structureID, session) {
    const structure = this._getStructure(structureID);
    ensureCanAccessAutoMoonMiner(session, structure, structureID);
    const profile = this._getResourceProfile(structureID);
    const moonID = normalizePositiveInteger(profile && profile.moonID, 0);
    if (!moonID) {
      throwWrappedUserError("CustomInfo", {
        info: "Auto moon miner details require a seeded moon resource profile.",
      });
    }
    return {
      structure,
      profile,
      moonID,
    };
  }

  _buildAvailableFuelPayload(structureID) {
    return buildNumericDictFromMap(
      sumItemsByType(
        this._getContainerItems(structureID, itemStore.ITEM_FLAGS.STRUCTURE_FUEL_BAY),
        (typeContext) => isFuelOrReagent(typeContext),
      ),
    );
  }

  _buildOutputMaterialsPayload(structureID) {
    return buildNumericDictFromMap(
      sumItemsByType(
        this._getContainerItems(structureID, FLAG_MOON_MATERIAL_BAY),
        (typeContext) => isAutoMoonMinerOutputMaterial(typeContext),
      ),
    );
  }

  _getRemainingOutputBayCapacity(structure, structureID) {
    const capacity = getOutputBayCapacityForStructure(structure);
    const used = getOutputBayUsedVolume(
      this._getContainerItems(structureID, FLAG_MOON_MATERIAL_BAY),
    );
    return Math.max(0, capacity - used);
  }

  Handle_RequestMiningDetails(args = [], session) {
    const structureID = extractStructureID(args, session);
    if (!structureID) {
      throwWrappedUserError("CustomInfo", {
        info: "Auto moon miner details require a structure ID.",
      });
    }

    const context = this._resolveContext(structureID, session);
    return buildDict([
      ["moonID", context.moonID],
      ["nextHarvestTime", resolveNextHarvestTime(context.profile)],
      ["availableFuel", this._buildAvailableFuelPayload(structureID)],
      ["outputMaterials", this._buildOutputMaterialsPayload(structureID)],
      [
        "remainingOutputBayCapacity",
        this._getRemainingOutputBayCapacity(context.structure, structureID),
      ],
    ]);
  }

  Handle_RequestMiningCycleOutput(args = [], session) {
    const structureID = extractStructureID(args, session);
    if (!structureID) {
      return buildDict([]);
    }

    const structure = this._getStructure(structureID);
    ensureCanAccessAutoMoonMiner(session, structure, structureID);
    const profile = this._getResourceProfile(structureID);
    return buildNumericDictFromMap(normalizeCycleOutput(profile));
  }
}

AutoMoonMiningService._testing = {
  TYPE_UPWELL_AUTO_MOON_MINER,
  TYPE_COLONY_REAGENT_LAVA,
  GROUP_FUEL_BLOCK,
  GROUP_MOON_MATERIAL,
  OUTPUT_MATERIAL_TYPE_LIST_ID,
  FLAG_MOON_MATERIAL_BAY,
  ATTRIBUTE_OUTPUT_MOON_MATERIAL_BAY_CAPACITY,
  DEFAULT_OUTPUT_MOON_MATERIAL_BAY_CAPACITY,
  getItemQuantity,
  getTypeContext,
  isAutoMoonMinerOutputMaterial,
  normalizeCycleOutput,
  resolveNextHarvestTime,
  isAutoMoonMinerReinforced,
  hasStationManagerRole,
  hasAutoMoonMinerOwnerStationManagerAccess,
};

module.exports = AutoMoonMiningService;
