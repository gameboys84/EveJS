const path = require("path");
const crypto = require("crypto");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const database = require(path.join(__dirname, "../../gameStore"));
const { TABLE, readStaticTable } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));
const {
  buildDict,
  buildKeyVal,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  findItemById,
  consumeInventoryItemQuantity,
  grantItemToCharacterLocation,
  ITEM_FLAGS,
} = require(path.join(__dirname, "../inventory/itemStore"));
const { syncInventoryItemForSession } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  getTypeDogmaAttributes,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const CUSTOM_INFO_KEY = "evejsDynamicItem";
const MUTATION_QUANTITY = 1;

let cachedAuthority = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(normalizeNumber(unwrapMarshalValue(value), fallback));
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = normalizeNumber(unwrapMarshalValue(value), fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 1000000) / 1000000;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function getSessionCharacterID(session) {
  return toPositiveInt(
    session && (session.charid || session.characterID || session.userid),
    0,
  );
}

function normalizeAttributeDefinition(entry) {
  const attributeID = toPositiveInt(entry && entry.attributeID, 0);
  const min = toFiniteNumber(entry && entry.min, NaN);
  const max = toFiniteNumber(entry && entry.max, NaN);
  if (attributeID <= 0 || !Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  const result = { attributeID, min, max };
  if (Object.prototype.hasOwnProperty.call(entry || {}, "highIsGood")) {
    result.highIsGood = Boolean(entry.highIsGood);
  }
  return result;
}

function normalizeMapping(entry) {
  const resultingType = toPositiveInt(entry && entry.resultingType, 0);
  const applicableTypes = (Array.isArray(entry && entry.applicableTypes)
    ? entry.applicableTypes
    : [])
    .map((typeID) => toPositiveInt(typeID, 0))
    .filter((typeID) => typeID > 0);
  if (resultingType <= 0 || applicableTypes.length === 0) {
    return null;
  }
  return {
    resultingType,
    applicableTypes,
    applicableTypeSet: new Set(applicableTypes),
  };
}

function normalizeMutator(entry) {
  const mutatorTypeID = toPositiveInt(entry && entry.mutatorTypeID, 0);
  if (mutatorTypeID <= 0) {
    return null;
  }
  const attributes = (Array.isArray(entry && entry.attributeIDs)
    ? entry.attributeIDs
    : [])
    .map(normalizeAttributeDefinition)
    .filter(Boolean);
  const mappings = (Array.isArray(entry && entry.inputOutputMapping)
    ? entry.inputOutputMapping
    : [])
    .map(normalizeMapping)
    .filter(Boolean);
  if (attributes.length === 0 || mappings.length === 0) {
    return null;
  }
  return {
    mutatorTypeID,
    attributes,
    attributesByID: new Map(
      attributes.map((attribute) => [attribute.attributeID, attribute]),
    ),
    mappings,
  };
}

function loadAuthority() {
  if (cachedAuthority) {
    return cachedAuthority;
  }

  const payload = readStaticTable(TABLE.DYNAMIC_ITEM_ATTRIBUTES);
  const mutators = (Array.isArray(payload && payload.mutators)
    ? payload.mutators
    : [])
    .map(normalizeMutator)
    .filter(Boolean);
  const byMutatorTypeID = new Map();
  const dynamicResultTypes = new Set();

  for (const mutator of mutators) {
    byMutatorTypeID.set(mutator.mutatorTypeID, mutator);
    for (const mapping of mutator.mappings) {
      dynamicResultTypes.add(mapping.resultingType);
    }
  }

  cachedAuthority = {
    source: payload && typeof payload === "object" ? payload.source || {} : {},
    byMutatorTypeID,
    dynamicResultTypes,
  };
  return cachedAuthority;
}

function clearDynamicItemAuthorityCache() {
  cachedAuthority = null;
}

function getMutator(mutatorTypeID) {
  return loadAuthority().byMutatorTypeID.get(toPositiveInt(mutatorTypeID, 0)) || null;
}

function isKnownDynamicResultType(typeID) {
  return loadAuthority().dynamicResultTypes.has(toPositiveInt(typeID, 0));
}

function resolveMutationMapping(mutator, sourceTypeID) {
  const numericSourceTypeID = toPositiveInt(sourceTypeID, 0);
  if (!mutator || numericSourceTypeID <= 0) {
    return null;
  }
  return (
    mutator.mappings.find((mapping) =>
      mapping.applicableTypeSet.has(numericSourceTypeID),
    ) || null
  );
}

function parseCustomInfo(customInfo) {
  const raw = normalizeString(customInfo);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function stringifyCustomInfo(metadata) {
  return JSON.stringify({ [CUSTOM_INFO_KEY]: metadata });
}

function normalizeNumericObject(source = {}) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    const numericKey = toPositiveInt(key, 0);
    const numericValue = toFiniteNumber(value, NaN);
    if (numericKey > 0 && Number.isFinite(numericValue)) {
      result[String(numericKey)] = numericValue;
    }
  }
  return result;
}

function getDynamicMetadata(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const customInfo = parseCustomInfo(item.customInfo);
  const metadata = customInfo[CUSTOM_INFO_KEY];
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const mutatorTypeID = toPositiveInt(metadata.mutatorTypeID, 0);
  const sourceTypeID = toPositiveInt(metadata.sourceTypeID, 0);
  if (mutatorTypeID <= 0 || sourceTypeID <= 0) {
    return null;
  }

  return {
    itemID: toPositiveInt(metadata.itemID, toPositiveInt(item.itemID, 0)),
    resultTypeID: toPositiveInt(metadata.resultTypeID, toPositiveInt(item.typeID, 0)),
    sourceTypeID,
    sourceItemID: toPositiveInt(metadata.sourceItemID, 0),
    mutatorTypeID,
    mutatorItemID: toPositiveInt(metadata.mutatorItemID, 0),
    characterID: toPositiveInt(metadata.characterID, 0),
    createdAtMs: toPositiveInt(metadata.createdAtMs, 0),
    modifiers: normalizeNumericObject(metadata.modifiers),
    attributes: normalizeNumericObject(metadata.attributes),
    baseAttributes: normalizeNumericObject(metadata.baseAttributes),
  };
}

function fallbackDynamicMetadataForItem(item) {
  const itemID = toPositiveInt(item && item.itemID, 0);
  const typeID = toPositiveInt(item && item.typeID, 0);
  if (itemID <= 0 || typeID <= 0 || !isKnownDynamicResultType(typeID)) {
    return null;
  }
  return {
    itemID,
    resultTypeID: typeID,
    sourceTypeID: typeID,
    sourceItemID: 0,
    mutatorTypeID: typeID,
    mutatorItemID: 0,
    characterID: toPositiveInt(item && item.ownerID, 0),
    createdAtMs: 0,
    modifiers: {},
    attributes: {},
    baseAttributes: {},
  };
}

function buildNumericDict(source = {}) {
  return buildDict(
    Object.entries(source || {})
      .map(([key, value]) => [toPositiveInt(key, 0), toFiniteNumber(value, 0)])
      .filter(([key]) => key > 0)
      .sort(([left], [right]) => left - right),
  );
}

function buildDynamicItemPayload(item, metadata) {
  const normalized = metadata || getDynamicMetadata(item) || fallbackDynamicMetadataForItem(item);
  if (!normalized) {
    return null;
  }

  return buildKeyVal([
    ["itemID", toPositiveInt(normalized.itemID, toPositiveInt(item && item.itemID, 0))],
    ["typeID", toPositiveInt(normalized.resultTypeID, toPositiveInt(item && item.typeID, 0))],
    ["sourceTypeID", toPositiveInt(normalized.sourceTypeID, 0)],
    ["sourceItemID", toPositiveInt(normalized.sourceItemID, 0)],
    ["mutatorTypeID", toPositiveInt(normalized.mutatorTypeID, 0)],
    ["mutatorItemID", toPositiveInt(normalized.mutatorItemID, 0)],
    ["characterID", toPositiveInt(normalized.characterID, 0)],
    ["createdAtMs", toPositiveInt(normalized.createdAtMs, 0)],
    ["attributes", buildNumericDict(normalized.attributes)],
    ["modifiers", buildNumericDict(normalized.modifiers)],
    ["baseAttributes", buildNumericDict(normalized.baseAttributes)],
  ]);
}

function chooseModifier({ mutatorItemID, sourceItemID, attributeID, randomValue = null }) {
  if (Number.isFinite(Number(randomValue))) {
    return Math.max(0, Math.min(1, Number(randomValue)));
  }
  const randomBytes = crypto.randomBytes(6);
  const randomInteger = randomBytes.readUIntBE(0, 6);
  const denominator = 2 ** 48 - 1;
  return randomInteger / denominator;
}

function buildMutationMetadata({
  mutator,
  mapping,
  mutatorItem,
  sourceItem,
  resultItemID = 0,
  characterID = 0,
  now = Date.now(),
  rollProvider = null,
}) {
  const sourceAttributes = getTypeDogmaAttributes(sourceItem.typeID);
  const attributes = {};
  const modifiers = {};
  const baseAttributes = {};

  for (const definition of mutator.attributes) {
    const attributeID = definition.attributeID;
    const baseValue = toFiniteNumber(sourceAttributes[String(attributeID)], NaN);
    if (!Number.isFinite(baseValue)) {
      continue;
    }
    const rawRoll = typeof rollProvider === "function"
      ? rollProvider({
        mutatorTypeID: mutator.mutatorTypeID,
        mutatorItemID: mutatorItem.itemID,
        sourceTypeID: sourceItem.typeID,
        sourceItemID: sourceItem.itemID,
        attributeID,
      })
      : null;
    const modifier = chooseModifier({
      mutatorItemID: mutatorItem.itemID,
      sourceItemID: sourceItem.itemID,
      attributeID,
      randomValue: rawRoll,
    });
    const multiplier = modifier * (definition.max - definition.min) + definition.min;
    modifiers[String(attributeID)] = round6(modifier);
    baseAttributes[String(attributeID)] = round6(baseValue);
    attributes[String(attributeID)] = round6(baseValue * multiplier);
  }

  return {
    itemID: toPositiveInt(resultItemID, 0),
    resultTypeID: mapping.resultingType,
    sourceTypeID: sourceItem.typeID,
    sourceItemID: sourceItem.itemID,
    mutatorTypeID: mutator.mutatorTypeID,
    mutatorItemID: mutatorItem.itemID,
    characterID,
    createdAtMs: Math.trunc(now),
    modifiers,
    attributes,
    baseAttributes,
  };
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

function throwNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "Dynamic item operation failed."),
  });
}

function validateCraftInputs(mutatorItem, sourceItem, session) {
  const characterID = getSessionCharacterID(session);
  if (characterID <= 0) {
    throwNotify("You need an active character to mutate an item.");
  }
  if (!mutatorItem || !sourceItem) {
    throwNotify("The selected mutaplasmid or source item could not be found.");
  }
  if (
    toPositiveInt(mutatorItem.ownerID, 0) !== characterID ||
    toPositiveInt(sourceItem.ownerID, 0) !== characterID
  ) {
    throwNotify("You can only mutate items owned by the active character.");
  }
  if (toPositiveInt(mutatorItem.itemID, 0) === toPositiveInt(sourceItem.itemID, 0)) {
    throwNotify("The mutaplasmid and source item must be different inventory items.");
  }
  const mutator = getMutator(mutatorItem.typeID);
  if (!mutator) {
    throwNotify("That item is not a supported mutaplasmid.");
  }
  const mapping = resolveMutationMapping(mutator, sourceItem.typeID);
  if (!mapping) {
    throwNotify("That mutaplasmid cannot mutate the selected source item.");
  }
  return { mutator, mapping, characterID };
}

class DynamicItemService extends BaseService {
  constructor() {
    super("dynamicItemService");
  }

  Handle_GetDynamicItemInfo(args = []) {
    const itemID = toPositiveInt(args[0], 0);
    if (itemID <= 0) {
      return null;
    }
    const item = findItemById(itemID);
    if (!item) {
      return null;
    }
    return buildDynamicItemPayload(item);
  }

  Handle_CreateDynamicItem(args = [], session = null) {
    const mutatorID = toPositiveInt(args[0], 0);
    const sourceID = toPositiveInt(args[1], 0);
    const mutatorItem = findItemById(mutatorID);
    const sourceItem = findItemById(sourceID);
    const { mutator, mapping, characterID } = validateCraftInputs(
      mutatorItem,
      sourceItem,
      session,
    );
    const metadata = buildMutationMetadata({
      mutator,
      mapping,
      mutatorItem,
      sourceItem,
      characterID,
    });

    const mutatorConsumeResult = consumeInventoryItemQuantity(
      mutatorItem.itemID,
      MUTATION_QUANTITY,
      { removeContents: true },
    );
    if (!mutatorConsumeResult || mutatorConsumeResult.success !== true) {
      throwNotify("The selected mutaplasmid could not be consumed.");
    }

    const sourceConsumeResult = consumeInventoryItemQuantity(
      sourceItem.itemID,
      MUTATION_QUANTITY,
      { removeContents: true },
    );
    if (!sourceConsumeResult || sourceConsumeResult.success !== true) {
      log.error(
        `[DynamicItemService] Source consumption failed after mutator consumption mutator=${mutatorItem.itemID} source=${sourceItem.itemID}: ${sourceConsumeResult && sourceConsumeResult.errorMsg}`,
      );
      throwNotify("The selected source item could not be consumed.");
    }

    const resultGrant = grantItemToCharacterLocation(
      characterID,
      mutatorItem.locationID || sourceItem.locationID || characterID,
      mutatorItem.flagID || sourceItem.flagID || ITEM_FLAGS.HANGAR,
      mapping.resultingType,
      MUTATION_QUANTITY,
      {
        singleton: 1,
        customInfo: stringifyCustomInfo(metadata),
      },
    );
    if (!resultGrant || resultGrant.success !== true) {
      log.error(
        `[DynamicItemService] Result grant failed after consuming inputs mutator=${mutatorItem.itemID} source=${sourceItem.itemID}: ${resultGrant && resultGrant.errorMsg}`,
      );
      throwNotify("The mutated item could not be created.");
    }

    const resultItem = resultGrant.data && Array.isArray(resultGrant.data.items)
      ? resultGrant.data.items[0] || null
      : null;
    const resultItemID = toPositiveInt(resultItem && resultItem.itemID, 0);
    if (resultItemID > 0) {
      metadata.itemID = resultItemID;
      const updatedCustomInfo = stringifyCustomInfo(metadata);
      // Phase 0: persist the item's customInfo through its owner (itemStore).
      const updateResult = require("../inventory/itemStore").writeItemCustomInfo(
        resultItemID,
        updatedCustomInfo,
        { force: true },
      );
      if (!updateResult || updateResult.success !== true) {
        log.warn(
          `[DynamicItemService] Unable to backfill result itemID into customInfo for ${resultItemID}`,
        );
      }
      if (resultItem) {
        resultItem.customInfo = updatedCustomInfo;
      }
      for (const change of (resultGrant.data && resultGrant.data.changes) || []) {
        if (
          change &&
          change.item &&
          toPositiveInt(change.item.itemID, 0) === resultItemID
        ) {
          change.item.customInfo = updatedCustomInfo;
        }
      }
    }

    syncInventoryChanges(session, [
      ...((mutatorConsumeResult.data && mutatorConsumeResult.data.changes) || []),
      ...((sourceConsumeResult.data && sourceConsumeResult.data.changes) || []),
      ...((resultGrant.data && resultGrant.data.changes) || []),
    ]);

    return resultItemID || null;
  }
}

DynamicItemService._testing = {
  CUSTOM_INFO_KEY,
  clearDynamicItemAuthorityCache,
  loadAuthority,
  getMutator,
  isKnownDynamicResultType,
  resolveMutationMapping,
  getDynamicMetadata,
  buildDynamicItemPayload,
  buildMutationMetadata,
  stringifyCustomInfo,
};

module.exports = DynamicItemService;
