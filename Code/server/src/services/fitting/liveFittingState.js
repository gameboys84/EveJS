const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  ITEM_FLAGS,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  MINING_HOLD_DEFINITIONS,
} = require(path.join(__dirname, "../mining/miningConstants"));
const {
  FUEL_BAY_ATTRIBUTE_ID,
  FUEL_BAY_RESOURCE_KEY,
} = require(path.join(__dirname, "../inventory/fuelBayInventory"));
const {
  getActiveImplantLocationModifierSources,
  getActiveImplantShipModifierEntries,
} = require(path.join(__dirname, "../dogma/implants/activeImplantModifiers"));

const CHARGE_CATEGORY_ID = 8;
const STRUCTURE_CATEGORY_ID = 65;
const STRUCTURE_MODULE_CATEGORY_ID = 66;
const FIGHTER_CATEGORY_ID = 87;
const STRUCTURE_DOGMA_SKILL_TYPE_IDS = new Set([
  37796, // Structure Missile Systems
  37797, // Structure Doomsday Operation
  37798, // Structure Electronic Systems
  37799, // Structure Engineering Systems
]);
const HIDDEN_MODIFIERS_FLAG = ITEM_FLAGS.HIDDEN_MODIFIERS || 156;
const GROUP_SCAN_PROBE_LAUNCHER = 481;
const SLOT_FAMILY_FLAGS = Object.freeze({
  low: Object.freeze([11, 12, 13, 14, 15, 16, 17, 18]),
  med: Object.freeze([19, 20, 21, 22, 23, 24, 25, 26]),
  high: Object.freeze([27, 28, 29, 30, 31, 32, 33, 34]),
  rig: Object.freeze([92, 93, 94, 95, 96, 97, 98, 99]),
  subsystem: Object.freeze([125, 126, 127, 128, 129, 130, 131, 132]),
  service: Object.freeze([164, 165, 166, 167, 168, 169, 170, 171]),
});
const SHIP_FITTING_FLAG_RANGES = Object.freeze([
  Object.freeze([11, 34]),
  Object.freeze([92, 99]),
  Object.freeze([125, 132]),
  Object.freeze([164, 171]),
]);
const EFFECT_ID_FALLBACK = Object.freeze({
  loPower: 11,
  hiPower: 12,
  medPower: 13,
  online: 16,
  launcherFitted: 40,
  turretFitted: 42,
  rigSlot: 2663,
  subSystem: 3772,
  serviceSlot: 6306,
});
const ATTRIBUTE_ID_FALLBACK = Object.freeze({
  lowSlots: 12,
  medSlots: 13,
  hiSlots: 14,
  capacity: 38,
  maxSubSystems: 136,
  rigSlots: 1137,
  serviceSlots: 2056,
  isOnline: 1153,
  quantity: 20,
});
const DEFAULT_MODULE_STATE = Object.freeze({
  online: false,
  damage: 0.0,
  charge: 0.0,
  skillPoints: 0,
  armorDamage: 0.0,
  shieldCharge: 0.0,
  incapacitated: false,
});
const DYNAMIC_ITEM_CUSTOM_INFO_KEY = "evejsDynamicItem";

let cachedDogmaLookups = null;
let cachedNormalizedTypeAttributeMaps = null;
let cachedTypeEffectRecords = null;
let cachedSkillEffectiveAttributes = null;
let cachedSkillExplicitShipAttributeModifiers = null;
let cachedSkillFallbackShipEligibility = null;

function getShipStanceRuntime() {
  return require(path.join(__dirname, "../ship/shipStanceRuntime"));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function normalizeNumericAttributeMap(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([attributeID, value]) => [Number(attributeID), Number(value)])
      .filter(
        ([attributeID, value]) =>
          Number.isInteger(attributeID) && Number.isFinite(value),
      ),
  );
}

function isShipFittingFlag(flagID) {
  const numericFlagID = toInt(flagID, 0);
  return SHIP_FITTING_FLAG_RANGES.some(
    ([start, end]) => numericFlagID >= start && numericFlagID <= end,
  );
}

function isChargeItem(item) {
  return item && toInt(item.categoryID, 0) === CHARGE_CATEGORY_ID;
}

function isFittedChargeItem(item) {
  return Boolean(item) && isShipFittingFlag(item.flagID) && isChargeItem(item);
}

function isFittedModuleItem(item) {
  return Boolean(item) && isShipFittingFlag(item.flagID) && !isChargeItem(item);
}

function isHiddenModifierItem(item) {
  return Boolean(item) && toInt(item.flagID, 0) === HIDDEN_MODIFIERS_FLAG;
}

function normalizeModuleState(rawState) {
  const source =
    rawState && typeof rawState === "object" ? rawState : DEFAULT_MODULE_STATE;

  return {
    online: Boolean(source.online),
    damage: toFiniteNumber(source.damage, DEFAULT_MODULE_STATE.damage),
    charge: toFiniteNumber(source.charge, DEFAULT_MODULE_STATE.charge),
    skillPoints: toInt(source.skillPoints, DEFAULT_MODULE_STATE.skillPoints),
    armorDamage: toFiniteNumber(
      source.armorDamage,
      DEFAULT_MODULE_STATE.armorDamage,
    ),
    shieldCharge: toFiniteNumber(
      source.shieldCharge,
      DEFAULT_MODULE_STATE.shieldCharge,
    ),
    incapacitated: Boolean(source.incapacitated),
  };
}

function getItemModuleState(item) {
  return normalizeModuleState(item && item.moduleState);
}

function isModuleOnline(item) {
  return getItemModuleState(item).online;
}

function hasExplicitModuleOnlineState(item) {
  return Boolean(
    item &&
    item.moduleState &&
    typeof item.moduleState === "object" &&
    Object.prototype.hasOwnProperty.call(item.moduleState, "online"),
  );
}

function isEffectivelyOnlineModule(item) {
  if (!item || !isFittedModuleItem(item)) {
    return false;
  }

  if (!item.moduleState || typeof item.moduleState !== "object") {
    return true;
  }

  if (!hasExplicitModuleOnlineState(item)) {
    return true;
  }

  return isModuleOnline(item);
}

function buildNameIndex(entries = {}) {
  const byName = new Map();
  for (const entry of Object.values(entries || {})) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const candidate of [entry.name, entry.attributeName, entry.displayName]) {
      const normalized = String(candidate || "").trim().toLowerCase();
      if (!normalized) {
        continue;
      }

      const numericID = toInt(entry.effectID ?? entry.attributeID, 0);
      if (numericID > 0 && !byName.has(normalized)) {
        byName.set(normalized, numericID);
      }
    }
  }
  return byName;
}

function getDogmaLookups() {
  if (cachedDogmaLookups) {
    return cachedDogmaLookups;
  }

  const shipDogmaRoot = readStaticTable(TABLE.SHIP_DOGMA_ATTRIBUTES);
  const typeDogmaRoot = readStaticTable(TABLE.TYPE_DOGMA);
  const attributeTypesByID =
    (typeDogmaRoot && typeDogmaRoot.attributeTypesByID) ||
    (shipDogmaRoot && shipDogmaRoot.attributeTypesByID) ||
    {};
  const effectTypesByID =
    (typeDogmaRoot && typeDogmaRoot.effectTypesByID) || {};
  const attributeIDsByName = buildNameIndex(attributeTypesByID);
  const effectIDsByName = buildNameIndex(effectTypesByID);

  for (const [name, effectID] of Object.entries(EFFECT_ID_FALLBACK)) {
    const normalized = name.toLowerCase();
    if (!effectIDsByName.has(normalized)) {
      effectIDsByName.set(normalized, effectID);
    }
  }

  for (const [name, attributeID] of Object.entries(ATTRIBUTE_ID_FALLBACK)) {
    const normalized = name.toLowerCase();
    if (!attributeIDsByName.has(normalized)) {
      attributeIDsByName.set(normalized, attributeID);
    }
  }

  cachedDogmaLookups = {
    attributeIDsByName,
    effectIDsByName,
  };
  return cachedDogmaLookups;
}

function ensureNormalizedTypeAttributeMapCache() {
  if (!cachedNormalizedTypeAttributeMaps) {
    cachedNormalizedTypeAttributeMaps = new Map();
  }
  return cachedNormalizedTypeAttributeMaps;
}

function ensureTypeEffectRecordCache() {
  if (!cachedTypeEffectRecords) {
    cachedTypeEffectRecords = new Map();
  }
  return cachedTypeEffectRecords;
}

function ensureSkillEffectiveAttributeCache() {
  if (!cachedSkillEffectiveAttributes) {
    cachedSkillEffectiveAttributes = new Map();
  }
  return cachedSkillEffectiveAttributes;
}

function ensureSkillExplicitShipAttributeModifierCache() {
  if (!cachedSkillExplicitShipAttributeModifiers) {
    cachedSkillExplicitShipAttributeModifiers = new Map();
  }
  return cachedSkillExplicitShipAttributeModifiers;
}

function ensureSkillFallbackShipEligibilityCache() {
  if (!cachedSkillFallbackShipEligibility) {
    cachedSkillFallbackShipEligibility = new Map();
  }
  return cachedSkillFallbackShipEligibility;
}

function getAttributeIDByNames(...names) {
  const { attributeIDsByName } = getDogmaLookups();
  for (const name of names) {
    const normalized = String(name || "").trim().toLowerCase();
    if (attributeIDsByName.has(normalized)) {
      return attributeIDsByName.get(normalized);
    }
  }
  return null;
}

function getEffectIDByNames(...names) {
  const { effectIDsByName } = getDogmaLookups();
  for (const name of names) {
    const normalized = String(name || "").trim().toLowerCase();
    if (effectIDsByName.has(normalized)) {
      return effectIDsByName.get(normalized);
    }
  }
  return null;
}

function getTypeDogmaRoot() {
  return readStaticTable(TABLE.TYPE_DOGMA) || {};
}

function getTypeDogmaRecord(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return null;
  }

  const root = getTypeDogmaRoot();
  return (
    (root.typesByTypeID && root.typesByTypeID[String(numericTypeID)]) || null
  );
}

function getTypeDogmaAttributes(typeID) {
  const record = getTypeDogmaRecord(typeID);
  if (!record || !record.attributes || typeof record.attributes !== "object") {
    return {};
  }

  return record.attributes;
}

function getNormalizedTypeAttributeMap(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return Object.freeze({});
  }

  const cache = ensureNormalizedTypeAttributeMapCache();
  const cached = cache.get(numericTypeID);
  if (cached) {
    return cached;
  }

  const normalized = Object.freeze(
    normalizeNumericAttributeMap(getTypeDogmaAttributes(numericTypeID)),
  );
  cache.set(numericTypeID, normalized);
  return normalized;
}

function getTypeAttributeValue(typeID, ...names) {
  const attributes = getNormalizedTypeAttributeMap(typeID);
  for (const name of names) {
    const attributeID = getAttributeIDByNames(name);
    if (!attributeID || !attributes || attributes[attributeID] === undefined) {
      continue;
    }

    const numericValue = Number(attributes[attributeID]);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function getSkillAttributeValue(typeID, ...names) {
  const directValue = getTypeAttributeValue(typeID, ...names);
  if (directValue !== null && directValue !== undefined) {
    return directValue;
  }

  const fallback = SKILL_ATTRIBUTE_BONUS_FALLBACKS[toInt(typeID, 0)] || null;
  if (!fallback) {
    return null;
  }

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fallback, name)) {
      return fallback[name];
    }
  }

  return null;
}

function getTypeDogmaEffects(typeID) {
  const record = getTypeDogmaRecord(typeID);
  const effects = Array.isArray(record && record.effects) ? record.effects : [];
  return new Set(
    effects
      .map((effectID) => toInt(effectID, 0))
      .filter((effectID) => effectID > 0),
  );
}

function typeHasEffectName(typeID, effectName) {
  const effectID = getEffectIDByNames(effectName);
  if (!effectID) {
    return false;
  }
  return getTypeDogmaEffects(typeID).has(effectID);
}

function getRequiredSlotFamily(typeID) {
  if (typeHasEffectName(typeID, "hiPower")) {
    return "high";
  }
  if (typeHasEffectName(typeID, "medPower")) {
    return "med";
  }
  if (typeHasEffectName(typeID, "loPower")) {
    return "low";
  }
  if (typeHasEffectName(typeID, "rigSlot")) {
    return "rig";
  }
  if (typeHasEffectName(typeID, "subSystem")) {
    return "subsystem";
  }
  if (typeHasEffectName(typeID, "serviceSlot")) {
    return "service";
  }
  return null;
}

function readShipBaseAttributes(shipTypeID) {
  const numericTypeID = toInt(shipTypeID, 0);
  const shipDogmaRoot = readStaticTable(TABLE.SHIP_DOGMA_ATTRIBUTES);
  const entry =
    shipDogmaRoot &&
    shipDogmaRoot.shipAttributesByTypeID &&
    shipDogmaRoot.shipAttributesByTypeID[String(numericTypeID)];
  if (entry && typeof entry.attributes === "object") {
    return entry.attributes;
  }

  return getTypeDogmaAttributes(numericTypeID);
}

function getShipBaseAttributeValue(shipTypeID, ...names) {
  const attributes = readShipBaseAttributes(shipTypeID);
  for (const name of names) {
    const attributeID = getAttributeIDByNames(name);
    if (!attributeID || !attributes || attributes[String(attributeID)] === undefined) {
      continue;
    }

    const numericValue = Number(attributes[String(attributeID)]);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function getShipSlotCounts(shipTypeID) {
  const attributes = readShipBaseAttributes(shipTypeID);
  const lowSlotsID = getAttributeIDByNames("lowSlots");
  const medSlotsID = getAttributeIDByNames("medSlots");
  const hiSlotsID = getAttributeIDByNames("hiSlots");
  const rigSlotsID = getAttributeIDByNames("rigSlots");
  const maxSubSystemsID = getAttributeIDByNames("maxSubSystems");
  const serviceSlotsID = getAttributeIDByNames("serviceSlots");

  return {
    low: lowSlotsID ? toInt(attributes[String(lowSlotsID)], 0) : 0,
    med: medSlotsID ? toInt(attributes[String(medSlotsID)], 0) : 0,
    high: hiSlotsID ? toInt(attributes[String(hiSlotsID)], 0) : 0,
    rig: rigSlotsID ? toInt(attributes[String(rigSlotsID)], 0) : 0,
    subsystem: maxSubSystemsID ? toInt(attributes[String(maxSubSystemsID)], 0) : 0,
    service: serviceSlotsID ? toInt(attributes[String(serviceSlotsID)], 0) : 0,
  };
}

function getSlotFlagsForFamily(family, shipTypeID = null) {
  const baseFlags = SLOT_FAMILY_FLAGS[family];
  if (!Array.isArray(baseFlags)) {
    return [];
  }

  if (!shipTypeID) {
    return [...baseFlags];
  }

  const slotCounts = getShipSlotCounts(shipTypeID);
  const limit = toInt(slotCounts[family], 0);
  return limit > 0 ? baseFlags.slice(0, limit) : [...baseFlags];
}

function sortFittedItems(left, right) {
  const leftFlag = toInt(left && left.flagID, 0);
  const rightFlag = toInt(right && right.flagID, 0);
  if (leftFlag !== rightFlag) {
    return leftFlag - rightFlag;
  }
  return toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0);
}

function listFittedItems(charID, shipID) {
  return listContainerItems(charID, shipID, null)
    .filter((item) => isShipFittingFlag(item && item.flagID))
    .sort(sortFittedItems);
}

function listFittedItemsForLocation(shipID) {
  return listContainerItems(null, shipID, null)
    .filter((item) => isShipFittingFlag(item && item.flagID))
    .sort(sortFittedItems);
}

function buildVirtualHiddenModifierItem(shipItem, modifierTypeID, customInfo = "hiddenModifier") {
  const numericModifierTypeID = toInt(modifierTypeID, 0);
  const typeRecord = resolveItemByTypeID(numericModifierTypeID) || {};
  return {
    itemID: `virtual-hidden-modifier:${toInt(shipItem && shipItem.itemID, 0)}:${numericModifierTypeID}`,
    typeID: numericModifierTypeID,
    ownerID: toInt(shipItem && shipItem.ownerID, 0) || null,
    locationID: toInt(shipItem && shipItem.itemID, 0) || null,
    flagID: HIDDEN_MODIFIERS_FLAG,
    groupID: toInt(typeRecord.groupID, 0),
    categoryID: toInt(typeRecord.categoryID, 0),
    quantity: 1,
    singleton: 1,
    stacksize: 1,
    customInfo,
  };
}

function listHiddenModifierItems(ownerID, shipID, shipItem = null) {
  const numericShipID = toInt(shipID || shipItem && shipItem.itemID, 0);
  if (numericShipID <= 0) {
    return [];
  }

  const numericOwnerID = toInt(ownerID || shipItem && shipItem.ownerID, 0);
  const hiddenItems = listContainerItems(
    numericOwnerID > 0 ? numericOwnerID : null,
    numericShipID,
    HIDDEN_MODIFIERS_FLAG,
  )
    .filter((item) => item && toInt(item.typeID, 0) > 0)
    .sort(sortFittedItems);

  const shipStanceRuntime = getShipStanceRuntime();
  const stanceState = shipStanceRuntime.resolveCurrentShipStance(
    shipItem && typeof shipItem === "object"
      ? shipItem
      : numericShipID,
  );
  if (
    stanceState.supported === true &&
    toInt(stanceState.modifierTypeID, 0) > 0 &&
    !hiddenItems.some((item) => (
      shipStanceRuntime.ALL_STANCE_MODIFIER_TYPE_IDS.includes(toInt(item && item.typeID, 0))
    ))
  ) {
    hiddenItems.push(
      buildVirtualHiddenModifierItem(
        stanceState.shipItem || shipItem || {
          itemID: numericShipID,
          ownerID: numericOwnerID,
        },
        stanceState.modifierTypeID,
        `shipStance:${stanceState.stanceID}:default`,
      ),
    );
  }

  return hiddenItems;
}

function getPassiveModifierSourceItems(shipItem, fittedItems = [], options = {}) {
  const visibleSources = Array.isArray(fittedItems) ? fittedItems : [];
  const hiddenSources = Array.isArray(options.hiddenModifierItems)
    ? options.hiddenModifierItems
    : listHiddenModifierItems(
      toInt(shipItem && shipItem.ownerID, 0),
      toInt(shipItem && shipItem.itemID, 0),
      shipItem,
    );
  const byKey = new Map();
  for (const item of [...visibleSources, ...hiddenSources]) {
    if (!item || toInt(item.typeID, 0) <= 0) {
      continue;
    }
    const key = `${String(item.itemID)}:${toInt(item.typeID, 0)}:${toInt(item.flagID, 0)}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function getFittedModuleItems(charID, shipID) {
  return listFittedItems(charID, shipID).filter((item) => isFittedModuleItem(item));
}

function getLoadedChargeItems(charID, shipID) {
  return listFittedItems(charID, shipID).filter((item) => isFittedChargeItem(item));
}

function getFittedModuleByFlag(charID, shipID, flagID) {
  const numericFlagID = toInt(flagID, 0);
  return (
    getFittedModuleItems(charID, shipID).find(
      (item) => toInt(item.flagID, 0) === numericFlagID,
    ) || null
  );
}

function getLoadedChargeByFlag(charID, shipID, flagID) {
  const numericFlagID = toInt(flagID, 0);
  return (
    getLoadedChargeItems(charID, shipID).find(
      (item) => toInt(item.flagID, 0) === numericFlagID,
    ) || null
  );
}

function hasLoadedScanProbeLauncherCharge(charID, shipID) {
  return getLoadedChargeItems(charID, shipID).some((chargeItem) => {
    const moduleItem = getFittedModuleByFlag(charID, shipID, chargeItem.flagID);
    return Number(moduleItem && moduleItem.groupID) === GROUP_SCAN_PROBE_LAUNCHER;
  });
}

function getRequiredSkillRequirements(typeID) {
  const requirements = [];

  for (let index = 1; index <= 6; index += 1) {
    const requiredSkill = getTypeAttributeValue(typeID, `requiredSkill${index}`);
    const requiredLevel = getTypeAttributeValue(typeID, `requiredSkill${index}Level`);
    if (!Number.isInteger(requiredSkill) || requiredSkill <= 0) {
      continue;
    }

    requirements.push({
      skillTypeID: requiredSkill,
      level: Math.max(1, toInt(requiredLevel, 1)),
    });
  }

  return requirements;
}

function getShipRestrictionValues(typeID, prefix, maxCount, padWidth = 0) {
  const values = [];
  for (let index = 1; index <= maxCount; index += 1) {
    const suffix = padWidth > 0 ? String(index).padStart(padWidth, "0") : String(index);
    const value = getTypeAttributeValue(typeID, `${prefix}${suffix}`);
    if (Number.isInteger(value) && value > 0) {
      values.push(value);
    }
  }
  return values;
}

function validateShipTypeOrGroupRestriction(moduleTypeID, shipItem) {
  const allowedShipTypes = getShipRestrictionValues(
    moduleTypeID,
    "canFitShipType",
    12,
  );
  const allowedShipGroups = getShipRestrictionValues(
    moduleTypeID,
    "canFitShipGroup",
    20,
    2,
  );
  if (allowedShipTypes.length <= 0 && allowedShipGroups.length <= 0) {
    return { success: true };
  }

  const shipTypeID = toInt(shipItem && shipItem.typeID, 0);
  const shipGroupID = toInt(shipItem && shipItem.groupID, 0);
  const shipTypeAllowed =
    allowedShipTypes.length > 0 && allowedShipTypes.includes(shipTypeID);
  const shipGroupAllowed =
    allowedShipGroups.length > 0 && allowedShipGroups.includes(shipGroupID);
  if (shipTypeAllowed || shipGroupAllowed) {
    return { success: true };
  }

  if (allowedShipGroups.length > 0) {
    return {
      success: false,
      errorMsg: "INVALID_SHIP_GROUP",
      data: {
        allowedShipGroups,
        ...(allowedShipTypes.length > 0 ? { allowedShipTypes } : {}),
      },
    };
  }

  return {
    success: false,
    errorMsg: "INVALID_SHIP_TYPE",
    data: { allowedShipTypes },
  };
}

function getTypeCategoryID(typeID) {
  const typeRecord = resolveItemByTypeID(toInt(typeID, 0)) || null;
  return toInt(typeRecord && typeRecord.categoryID, 0);
}

function resolveItemCategoryID(item) {
  return toInt(item && item.categoryID, 0) || getTypeCategoryID(item && item.typeID);
}

function isStructureDogmaHost(shipItem) {
  return resolveItemCategoryID(shipItem) === STRUCTURE_CATEGORY_ID;
}

function filterStructureDogmaSkillMap(skillMap) {
  if (!(skillMap instanceof Map) || skillMap.size <= 0) {
    return new Map();
  }
  return new Map(
    [...skillMap.entries()].filter(([, skillRecord]) => (
      STRUCTURE_DOGMA_SKILL_TYPE_IDS.has(toInt(skillRecord && skillRecord.typeID, 0))
    )),
  );
}

function resolveDogmaSkillMapForHost(charID, shipItem, options = {}) {
  const baseSkillMap = options.skillMap instanceof Map
    ? options.skillMap
    : getCachedCharacterSkillMap(toInt(charID, 0));
  return isStructureDogmaHost(shipItem)
    ? filterStructureDogmaSkillMap(baseSkillMap)
    : baseSkillMap;
}

function validateHostFittingCategoryRestriction(hostItem, fittedItem) {
  const hostCategoryID = resolveItemCategoryID(hostItem);
  const fittedCategoryID = resolveItemCategoryID(fittedItem);

  if (hostCategoryID === STRUCTURE_CATEGORY_ID) {
    if (
      fittedCategoryID === STRUCTURE_MODULE_CATEGORY_ID ||
      fittedCategoryID === FIGHTER_CATEGORY_ID
    ) {
      return { success: true };
    }
    return {
      success: false,
      errorMsg: "MODULE_NOT_APPROPRIATE_FOR_CATEGORY",
      data: {
        hostCategoryID,
        fittedCategoryID,
      },
    };
  }

  if (fittedCategoryID === STRUCTURE_MODULE_CATEGORY_ID) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_APPROPRIATE_FOR_CATEGORY",
      data: {
        hostCategoryID,
        fittedCategoryID,
      },
    };
  }

  return { success: true };
}

function itemConsumesTurretHardpoint(item) {
  return typeHasEffectName(item && item.typeID, "turretFitted");
}

function itemConsumesLauncherHardpoint(item) {
  return typeHasEffectName(item && item.typeID, "launcherFitted");
}

function itemAppliesPassiveStats(item) {
  if (isHiddenModifierItem(item)) {
    return getPassiveModifierEffectRecords(item.typeID).length > 0;
  }
  return isPassiveModifierSource(item);
}

function countMatchingFittedItems(fittedItems, predicate, excludeItemID = null) {
  return (Array.isArray(fittedItems) ? fittedItems : []).filter((item) => {
    if (!item || !isFittedModuleItem(item)) {
      return false;
    }
    if (excludeItemID && toInt(item.itemID, 0) === excludeItemID) {
      return false;
    }
    return predicate(item);
  }).length;
}

const ATTRIBUTE_CPU_OUTPUT = getAttributeIDByNames("cpuOutput") || 48;
const ATTRIBUTE_POWER_OUTPUT = getAttributeIDByNames("powerOutput") || 11;
const ATTRIBUTE_CPU_LOAD = getAttributeIDByNames("cpuLoad") || 49;
const ATTRIBUTE_POWER_LOAD = getAttributeIDByNames("powerLoad") || 15;
const ATTRIBUTE_MODULE_CPU_NEED = getAttributeIDByNames("cpu") || 50;
const ATTRIBUTE_MODULE_POWER_NEED = getAttributeIDByNames("power") || 30;
const ATTRIBUTE_CAPACITY = getAttributeIDByNames("capacity") || 38;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_AGILITY = getAttributeIDByNames("agility") || 70;
const ATTRIBUTE_MASS = getAttributeIDByNames("mass") || 4;
const ATTRIBUTE_SPEED_FACTOR = getAttributeIDByNames("speedFactor") || 20;
const ATTRIBUTE_SPEED_BOOST_FACTOR =
  getAttributeIDByNames("speedBoostFactor") || 567;
const ATTRIBUTE_MASS_ADDITION = getAttributeIDByNames("massAddition") || 796;
const ATTRIBUTE_SIGNATURE_RADIUS_BONUS =
  getAttributeIDByNames("signatureRadiusBonus") || 554;
const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_MAX_LOCKED_TARGETS =
  getAttributeIDByNames("maxLockedTargets") || 192;
const ATTRIBUTE_SIGNATURE_RADIUS = getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_CLOAKING_TARGETING_DELAY =
  getAttributeIDByNames("cloakingTargetingDelay") || 560;
const PROPULSION_SKILL_ACCELERATION_CONTROL = 3452;
const PROPULSION_EFFECT_AFTERBURNER = "modulebonusafterburner";
const PROPULSION_EFFECT_MICROWARPDRIVE = "modulebonusmicrowarpdrive";
const ATTRIBUTE_SCAN_RESOLUTION =
  getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_CAPACITOR_CAPACITY =
  getAttributeIDByNames("capacitorCapacity") || 482;
const ATTRIBUTE_CAPACITOR_RECHARGE_RATE =
  getAttributeIDByNames("rechargerate", "capacitorRechargeRate") || 55;
const ATTRIBUTE_SHIELD_CAPACITY =
  getAttributeIDByNames("shieldCapacity") || 263;
const ATTRIBUTE_SHIELD_RECHARGE_RATE =
  getAttributeIDByNames("shieldRechargeRate") || 479;
const ATTRIBUTE_ARMOR_HP = getAttributeIDByNames("armorHP") || 265;
const ATTRIBUTE_STRUCTURE_HP = getAttributeIDByNames("hp", "structureHP") || 9;
const ATTRIBUTE_UPGRADE_CAPACITY =
  getAttributeIDByNames("upgradeCapacity") || 1132;
const ATTRIBUTE_UPGRADE_LOAD = getAttributeIDByNames("upgradeLoad") || 1154;
const ATTRIBUTE_TURRET_SLOTS_LEFT =
  getAttributeIDByNames("turretSlotsLeft") || 102;
const ATTRIBUTE_LAUNCHER_SLOTS_LEFT =
  getAttributeIDByNames("launcherSlotsLeft") || 101;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_SKILL_LEVEL = getAttributeIDByNames("skillLevel") || 280;
const ATTRIBUTE_DAMAGE_MULTIPLIER = getAttributeIDByNames("damageMultiplier") || 64;
const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS =
  getAttributeIDByNames("damageMultiplierBonus") || 292;
const ATTRIBUTE_ROF_BONUS = getAttributeIDByNames("rofBonus") || 293;
const MINING_HOLD_ATTRIBUTE_IDS = Object.freeze(
  MINING_HOLD_DEFINITIONS.map((definition) => ({
    resourceKey: definition.resourceKey,
    attributeID: getAttributeIDByNames(...definition.attributeNames) || 0,
  })).filter((entry) => entry.attributeID > 0),
);
const CHARACTER_TYPE_ID = 1373;
// These retail targeting skills grant +1 max locked target per level, but
// that bonus is not present in the simplified local skill/type data we read
// here. Keep targeting parity by filling in the missing attribute metadata.
const SKILL_ATTRIBUTE_BONUS_FALLBACKS = Object.freeze({
  3429: Object.freeze({ maxLockedTargetsBonus: 1 }), // Target Management
  3430: Object.freeze({ maxLockedTargetsBonus: 1 }), // Advanced Target Management
});
const PASSIVE_MODIFIER_EFFECT_CATEGORIES = new Set([0, 4]);
const DOGMA_OP_PRE_ASSIGNMENT = -1;
const DOGMA_OP_PRE_MUL = 0;
const DOGMA_OP_MOD_ADD = 2;
const DOGMA_OP_MOD_SUB = 3;
const DOGMA_OP_POST_MUL = 4;
const DOGMA_OP_POST_PERCENT = 6;
const DOGMA_OP_POST_ASSIGNMENT = 7;
const DOGMA_OP_POST_PERCENT_UNNERFED = 8;
const STACKING_DENOMINATORS = Object.freeze(
  Array.from({ length: 8 }, (_, index) => Math.exp((index / 2.67) ** 2)),
);
const DAMAGE_ATTRIBUTE_BY_SKILL_EFFECT_NAME = Object.freeze({
  missileemdmgbonus: ATTRIBUTE_EM_DAMAGE,
  missileexplosivedmgbonus: ATTRIBUTE_EXPLOSIVE_DAMAGE,
  missilekineticdmgbonus2: ATTRIBUTE_KINETIC_DAMAGE,
  missilethermaldmgbonus: ATTRIBUTE_THERMAL_DAMAGE,
});

function getAttributeTypeRecord(attributeID) {
  const numericAttributeID = toInt(attributeID, 0);
  if (numericAttributeID <= 0) {
    return null;
  }

  const root = getTypeDogmaRoot();
  return (
    (root.attributeTypesByID &&
      root.attributeTypesByID[String(numericAttributeID)]) ||
    null
  );
}

function isDogmaAttributeStackable(attributeID) {
  const attributeRecord = getAttributeTypeRecord(attributeID);
  return attributeRecord ? attributeRecord.stackable === true : false;
}

function shouldApplyStackingPenalty(modifiedAttributeID, stackingPenalized) {
  return stackingPenalized === true && !isDogmaAttributeStackable(modifiedAttributeID);
}

function getEffectTypeRecord(effectID) {
  const numericEffectID = toInt(effectID, 0);
  if (numericEffectID <= 0) {
    return null;
  }

  const root = getTypeDogmaRoot();
  return (
    (root.effectTypesByID && root.effectTypesByID[String(numericEffectID)]) ||
    null
  );
}

function getTypeEffectRecords(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return [];
  }

  const cache = ensureTypeEffectRecordCache();
  const cached = cache.get(numericTypeID);
  if (cached) {
    return cached;
  }

  const effectRecords = Object.freeze(
    [...getTypeDogmaEffects(numericTypeID)]
      .map((effectID) => getEffectTypeRecord(effectID))
      .filter(Boolean),
  );
  cache.set(numericTypeID, effectRecords);
  return effectRecords;
}

function getTypeAttributeMap(typeID) {
  return cloneAttributeMap(getNormalizedTypeAttributeMap(typeID));
}

function cloneAttributeMap(source = {}) {
  return Object.fromEntries(
    Object.entries(source || {}).map(([attributeID, value]) => [
      Number(attributeID),
      Number(value),
    ]),
  );
}

function parseDynamicItemCustomInfo(item) {
  if (!item || typeof item !== "object" || !item.customInfo) {
    return null;
  }
  try {
    const parsed = JSON.parse(String(item.customInfo || ""));
    const metadata = parsed && parsed[DYNAMIC_ITEM_CUSTOM_INFO_KEY];
    return metadata && typeof metadata === "object" ? metadata : null;
  } catch (error) {
    return null;
  }
}

function getDynamicItemSourceTypeID(item) {
  const metadata = parseDynamicItemCustomInfo(item);
  return toInt(metadata && metadata.sourceTypeID, 0);
}

function getDynamicItemAttributeOverrides(item) {
  const metadata = parseDynamicItemCustomInfo(item);
  const source = metadata && typeof metadata.attributes === "object"
    ? metadata.attributes
    : null;
  if (!source) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(source)
      .map(([attributeID, value]) => [
        toInt(attributeID, 0),
        toFiniteNumber(value, NaN),
      ])
      .filter(([attributeID, value]) => attributeID > 0 && Number.isFinite(value)),
  );
}

function getRequiredSkillTypeIDs(itemOrTypeID) {
  // requiredSkill1..6 are intrinsic TYPE attributes — dynamic (mutaplasmid)
  // overrides and other-item modifiers never change skill requirements — so read
  // the frozen, cached normalized type map directly. The previous object path
  // cloned a full effective attribute map per call, and this is invoked per skill
  // x per module by moduleRequiresSkillType during passive-modifier collection,
  // which made cloneAttributeMap ~50% of buildShipResourceState.
  const typeID =
    itemOrTypeID && typeof itemOrTypeID === "object"
      ? (getDynamicItemSourceTypeID(itemOrTypeID) || toInt(itemOrTypeID.typeID, 0))
      : toInt(itemOrTypeID, 0);
  const attributeMap = getNormalizedTypeAttributeMap(typeID);
  const requiredSkillTypeIDs = [];
  for (let index = 1; index <= 6; index += 1) {
    const requiredSkillTypeID = toInt(
      attributeMap[getAttributeIDByNames(`requiredSkill${index}`)],
      0,
    );
    if (requiredSkillTypeID > 0) {
      requiredSkillTypeIDs.push(requiredSkillTypeID);
    }
  }
  return requiredSkillTypeIDs;
}

function moduleRequiresSkillType(moduleItem, skillTypeID) {
  if (!moduleItem || !skillTypeID) {
    return false;
  }
  return getRequiredSkillTypeIDs(moduleItem).includes(toInt(skillTypeID, 0));
}

function getPassiveModifierEffectRecords(typeID) {
  return getTypeEffectRecords(typeID).filter((effectRecord) => (
    PASSIVE_MODIFIER_EFFECT_CATEGORIES.has(
      toInt(effectRecord && effectRecord.effectCategoryID, 0),
    ) &&
    Array.isArray(effectRecord && effectRecord.modifierInfo) &&
    effectRecord.modifierInfo.some(Boolean)
  ));
}

function isPassiveModifierSource(item) {
  if (!item || !isFittedModuleItem(item)) {
    return false;
  }

  const family = getRequiredSlotFamily(item.typeID);
  if (family === "rig" || family === "subsystem") {
    return true;
  }

  return (
    isEffectivelyOnlineModule(item) &&
    getPassiveModifierEffectRecords(item.typeID).length > 0
  );
}

function buildEffectiveItemAttributeMap(itemOrTypeID, otherItem = null) {
  const typeID =
    itemOrTypeID && typeof itemOrTypeID === "object"
      ? toInt(itemOrTypeID.typeID, 0)
      : toInt(itemOrTypeID, 0);
  const sourceTypeID =
    itemOrTypeID && typeof itemOrTypeID === "object"
      ? getDynamicItemSourceTypeID(itemOrTypeID)
      : 0;
  const attributes = getTypeAttributeMap(sourceTypeID || typeID);
  if (itemOrTypeID && typeof itemOrTypeID === "object") {
    Object.assign(attributes, getDynamicItemAttributeOverrides(itemOrTypeID));
  }
  applyOtherItemModifiersToAttributes(attributes, otherItem);
  return attributes;
}

function getEffectiveItemAttributeValue(itemOrTypeID, ...attributeNames) {
  const attributeID = getAttributeIDByNames(...attributeNames);
  if (!attributeID) {
    return undefined;
  }
  const attributeMap =
    itemOrTypeID && typeof itemOrTypeID === "object"
      ? buildEffectiveItemAttributeMap(itemOrTypeID)
      : getTypeAttributeMap(itemOrTypeID);
  return attributeMap[attributeID];
}

function applyOtherItemModifiersToAttributes(attributes, otherItem) {
  if (!attributes || !otherItem || toInt(otherItem.typeID, 0) <= 0) {
    return attributes;
  }

  const otherAttributes = buildEffectiveItemAttributeMap(otherItem);
  for (const effectRecord of getTypeEffectRecords(otherItem.typeID)) {
    for (const modifierInfo of effectRecord.modifierInfo || []) {
      if (
        !modifierInfo ||
        modifierInfo.func !== "ItemModifier" ||
        modifierInfo.domain !== "otherID"
      ) {
        continue;
      }

      applyDogmaModifier(
        attributes,
        modifierInfo.modifiedAttributeID,
        modifierInfo.operation,
        otherAttributes[toInt(modifierInfo.modifyingAttributeID, 0)],
      );
    }
  }

  return attributes;
}

function appendDirectModifierEntries(
  destination,
  sourceAttributes,
  sourceEffects,
  sourceKind,
  options = {},
) {
  const allowedDomains = options.allowedDomains instanceof Set
    ? options.allowedDomains
    : new Set(["shipID"]);
  const allowedFuncs = options.allowedFuncs instanceof Set
    ? options.allowedFuncs
    : new Set(["ItemModifier"]);
  const stackingPenalized = options.stackingPenalized !== undefined
    ? options.stackingPenalized === true
    : sourceKind === "fittedModule";

  for (const effectRecord of Array.isArray(sourceEffects) ? sourceEffects : []) {
    for (const modifierInfo of effectRecord.modifierInfo || []) {
      if (
        !modifierInfo ||
        !allowedFuncs.has(String(modifierInfo.func || "")) ||
        !allowedDomains.has(String(modifierInfo.domain || ""))
      ) {
        continue;
      }

      const value = toFiniteNumber(
        sourceAttributes && sourceAttributes[modifierInfo.modifyingAttributeID],
        NaN,
      );
      if (!Number.isFinite(value)) {
        continue;
      }

      destination.push({
        modifiedAttributeID: modifierInfo.modifiedAttributeID,
        operation: modifierInfo.operation,
        value,
        stackingPenalized: shouldApplyStackingPenalty(
          modifierInfo.modifiedAttributeID,
          stackingPenalized,
        ),
      });
    }
  }
}

function appendSelfItemModifierEntries(
  destination,
  sourceAttributes,
  sourceEffects,
  sourceKind,
) {
  appendDirectModifierEntries(
    destination,
    sourceAttributes,
    sourceEffects,
    sourceKind,
    {
      allowedDomains: new Set(["itemID"]),
      allowedFuncs: new Set(["ItemModifier"]),
      stackingPenalized: false,
    },
  );
}

function appendLocationModifierEntries(
  destination,
  sourceAttributes,
  sourceEffects,
  sourceKind,
  moduleItem,
  options = {},
) {
  const allowedDomains = options.allowedDomains instanceof Set
    ? options.allowedDomains
    : new Set(["shipID", "charID"]);
  const sourceTypeID = toInt(options.sourceTypeID, 0);
  for (const effectRecord of Array.isArray(sourceEffects) ? sourceEffects : []) {
    const normalizedEffectName = String(effectRecord && effectRecord.name || "")
      .trim()
      .toLowerCase();
    if (
      normalizedEffectName === "dronedmgbonus" &&
      sourceTypeID > 0 &&
      moduleRequiresSkillType(moduleItem, sourceTypeID)
    ) {
      const value = toFiniteNumber(
        sourceAttributes && sourceAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS],
        NaN,
      );
      if (Number.isFinite(value)) {
        destination.push({
          modifiedAttributeID: ATTRIBUTE_DAMAGE_MULTIPLIER,
          operation: DOGMA_OP_POST_PERCENT,
          value,
          stackingPenalized: false,
        });
      }
    }
    const missileDamageAttributeID =
      DAMAGE_ATTRIBUTE_BY_SKILL_EFFECT_NAME[normalizedEffectName] || 0;
    if (
      missileDamageAttributeID > 0 &&
      sourceTypeID > 0 &&
      moduleRequiresSkillType(moduleItem, sourceTypeID)
    ) {
      const value = toFiniteNumber(
        sourceAttributes && sourceAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS],
        NaN,
      );
      if (Number.isFinite(value)) {
        destination.push({
          modifiedAttributeID: missileDamageAttributeID,
          operation: DOGMA_OP_POST_PERCENT,
          value,
          stackingPenalized: false,
        });
      }
    }
    if (
      normalizedEffectName === "selfrof" &&
      sourceTypeID > 0 &&
      moduleRequiresSkillType(moduleItem, sourceTypeID) &&
      typeHasEffectName(moduleItem && moduleItem.typeID, "launcherFitted")
    ) {
      const value = toFiniteNumber(
        sourceAttributes && sourceAttributes[ATTRIBUTE_ROF_BONUS],
        NaN,
      );
      if (Number.isFinite(value)) {
        destination.push({
          modifiedAttributeID: ATTRIBUTE_SPEED,
          operation: DOGMA_OP_POST_PERCENT,
          value,
          stackingPenalized: false,
        });
      }
    }

    for (const modifierInfo of effectRecord.modifierInfo || []) {
      const func = String(modifierInfo.func || "");
      if (
        func !== "LocationRequiredSkillModifier" &&
        func !== "LocationGroupModifier" &&
        func !== "LocationModifier" &&
        func !== "OwnerRequiredSkillModifier"
      ) {
        continue;
      }

      const domain = String(modifierInfo.domain || "");
      if (!allowedDomains.has(domain)) {
        continue;
      }
      if (
        modifierInfo.skillTypeID &&
        !moduleRequiresSkillType(moduleItem, modifierInfo.skillTypeID)
      ) {
        continue;
      }
      if (
        modifierInfo.groupID &&
        toInt(moduleItem && moduleItem.groupID, 0) !== toInt(modifierInfo.groupID, 0)
      ) {
        continue;
      }

      const value = toFiniteNumber(
        sourceAttributes && sourceAttributes[modifierInfo.modifyingAttributeID],
        NaN,
      );
      if (!Number.isFinite(value)) {
        continue;
      }

      destination.push({
        modifiedAttributeID: modifierInfo.modifiedAttributeID,
        operation: modifierInfo.operation,
        value,
        stackingPenalized: shouldApplyStackingPenalty(
          modifierInfo.modifiedAttributeID,
          sourceKind === "fittedModule",
        ),
      });
    }
  }
}

function readShipBaseAttributeMap(shipTypeID, shipItem = null, shipMetadata = null) {
  const baseAttributes = Object.fromEntries(
    Object.entries(readShipBaseAttributes(shipTypeID))
      .map(([attributeID, value]) => [Number(attributeID), Number(value)])
      .filter(
        ([attributeID, value]) =>
          Number.isInteger(attributeID) && Number.isFinite(value),
      ),
  );

  const resolvedMetadata =
    shipMetadata || resolveItemByTypeID(toInt(shipTypeID, 0)) || null;
  const fallbackFields = [
    [ATTRIBUTE_CAPACITY, shipItem && shipItem.capacity, resolvedMetadata && resolvedMetadata.capacity],
    [ATTRIBUTE_MASS, shipItem && shipItem.mass, resolvedMetadata && resolvedMetadata.mass],
    [ATTRIBUTE_STRUCTURE_HP, shipItem && shipItem.hp, resolvedMetadata && resolvedMetadata.hp],
  ];
  for (const [attributeID, firstValue, secondValue] of fallbackFields) {
    if (baseAttributes[attributeID] !== undefined) {
      continue;
    }
    const resolvedValue = toFiniteNumber(firstValue, NaN);
    if (Number.isFinite(resolvedValue)) {
      baseAttributes[attributeID] = resolvedValue;
      continue;
    }
    const metadataValue = toFiniteNumber(secondValue, NaN);
    if (Number.isFinite(metadataValue)) {
      baseAttributes[attributeID] = metadataValue;
    }
  }

  return baseAttributes;
}

function applyPercentModifier(attributes, attributeID, percent) {
  const numericAttributeID = toInt(attributeID, 0);
  const baseValue = toFiniteNumber(attributes[numericAttributeID], NaN);
  const percentValue = toFiniteNumber(percent, NaN);
  if (
    numericAttributeID <= 0 ||
    !Number.isFinite(baseValue) ||
    !Number.isFinite(percentValue)
  ) {
    return;
  }

  attributes[numericAttributeID] = round6(baseValue * (1 + percentValue / 100));
}

function applyAdditiveModifier(attributes, attributeID, value) {
  const numericAttributeID = toInt(attributeID, 0);
  const baseValue = toFiniteNumber(attributes[numericAttributeID], NaN);
  const additiveValue = toFiniteNumber(value, NaN);
  if (
    numericAttributeID <= 0 ||
    !Number.isFinite(baseValue) ||
    !Number.isFinite(additiveValue)
  ) {
    return;
  }

  attributes[numericAttributeID] = round6(baseValue + additiveValue);
}

function applyDirectMultiplier(attributes, attributeID, multiplier) {
  const numericAttributeID = toInt(attributeID, 0);
  const baseValue = toFiniteNumber(attributes[numericAttributeID], NaN);
  const multiplierValue = toFiniteNumber(multiplier, NaN);
  if (
    numericAttributeID <= 0 ||
    !Number.isFinite(baseValue) ||
    !Number.isFinite(multiplierValue)
  ) {
    return;
  }

  attributes[numericAttributeID] = round6(baseValue * multiplierValue);
}

function applyDogmaModifier(attributes, attributeID, operation, value) {
  const numericAttributeID = toInt(attributeID, 0);
  const numericOperation = toInt(operation, -1);
  const numericValue = toFiniteNumber(value, NaN);
  if (
    numericAttributeID <= 0 ||
    (numericOperation < 0 && numericOperation !== DOGMA_OP_PRE_ASSIGNMENT) ||
    !Number.isFinite(numericValue)
  ) {
    return;
  }

  const currentValue = toFiniteNumber(attributes[numericAttributeID], NaN);
  switch (numericOperation) {
    case DOGMA_OP_PRE_ASSIGNMENT: {
      attributes[numericAttributeID] = round6(numericValue);
      break;
    }
    case DOGMA_OP_PRE_MUL:
    case DOGMA_OP_POST_MUL: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 1;
      attributes[numericAttributeID] = round6(baseValue * numericValue);
      break;
    }
    case DOGMA_OP_MOD_ADD: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(baseValue + numericValue);
      break;
    }
    case DOGMA_OP_MOD_SUB: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(baseValue - numericValue);
      break;
    }
    case 5: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 1;
      if (Math.abs(numericValue) > 1e-9) {
        attributes[numericAttributeID] = round6(baseValue / numericValue);
      }
      break;
    }
    case DOGMA_OP_POST_PERCENT: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(baseValue * (1 + numericValue / 100));
      break;
    }
    case DOGMA_OP_POST_ASSIGNMENT: {
      attributes[numericAttributeID] = round6(numericValue);
      break;
    }
    case DOGMA_OP_POST_PERCENT_UNNERFED: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(baseValue * (1 + numericValue / 100));
      break;
    }
    default:
      break;
  }
}

// Returns the FROZEN, cached effective-attribute map for a skill (no clone).
// READ-ONLY callers must not mutate it. The map is the dominant allocation in
// ship-resource/dogma builds: a maxed character runs hundreds of skills, and
// per-module passive-modifier collection re-walks all of them, so cloning the
// map on every lookup (skills x modules) was ~73% of buildShipResourceState
// (~195ms of 268ms on a real mining barge). buildSkillEffectiveAttributes keeps
// returning a mutable clone for external/unaudited callers.
function peekSkillEffectiveAttributes(skill) {
  const skillTypeID = toInt(skill && skill.typeID, 0);
  const level = Math.max(
    0,
    toInt(
      skill && (
        skill.effectiveSkillLevel ??
        skill.trainedSkillLevel ??
        skill.skillLevel
      ),
      0,
    ),
  );
  const cacheKey = `${skillTypeID}:${level}`;
  const cache = ensureSkillEffectiveAttributeCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const attributes = cloneAttributeMap(getNormalizedTypeAttributeMap(skillTypeID));
  attributes[ATTRIBUTE_SKILL_LEVEL] = level;

  for (const effect of getTypeDogmaEffects(skillTypeID)) {
    const effectRecord = getEffectTypeRecord(effect);
    if (!effectRecord || !Array.isArray(effectRecord.modifierInfo)) {
      continue;
    }
    if (String(effectRecord.name || "").toLowerCase() === "skilleffect") {
      continue;
    }

    for (const modifierInfo of effectRecord.modifierInfo) {
      if (
        !modifierInfo ||
        modifierInfo.domain !== "itemID" ||
        modifierInfo.func !== "ItemModifier" ||
        toInt(modifierInfo.modifiedAttributeID, 0) === ATTRIBUTE_SKILL_LEVEL
      ) {
        continue;
      }

      applyDogmaModifier(
        attributes,
        modifierInfo.modifiedAttributeID,
        modifierInfo.operation,
        attributes[toInt(modifierInfo.modifyingAttributeID, 0)],
      );
    }
  }

  const frozen = Object.freeze(attributes);
  cache.set(cacheKey, frozen);
  return frozen;
}

function buildSkillEffectiveAttributes(skill) {
  return cloneAttributeMap(peekSkillEffectiveAttributes(skill));
}

function applySkillDrivenShipAttributeModifiers(attributes, skillMap) {
  for (const skill of skillMap.values()) {
    const skillAttributes = peekSkillEffectiveAttributes(skill);
    const skillTypeID = toInt(skill && skill.typeID, 0);
    for (const effectID of getTypeDogmaEffects(skillTypeID)) {
      const effect = getEffectTypeRecord(effectID);
      if (!effect || !Array.isArray(effect.modifierInfo)) {
        continue;
      }

      for (const modifierInfo of effect.modifierInfo) {
        if (
          !modifierInfo ||
          modifierInfo.domain !== "shipID" ||
          modifierInfo.func !== "ItemModifier"
        ) {
          continue;
        }

        applyDogmaModifier(
          attributes,
          modifierInfo.modifiedAttributeID,
          modifierInfo.operation,
          skillAttributes[toInt(modifierInfo.modifyingAttributeID, 0)],
        );
      }
    }
  }
}

function getSkillExplicitShipAttributeModifierSet(skillTypeID) {
  const numericSkillTypeID = toInt(skillTypeID, 0);
  if (numericSkillTypeID <= 0) {
    return new Set();
  }

  const cache = ensureSkillExplicitShipAttributeModifierCache();
  const cached = cache.get(numericSkillTypeID);
  if (cached) {
    return cached;
  }

  const explicitAttributeIDs = new Set();
  for (const effectID of getTypeDogmaEffects(numericSkillTypeID)) {
    const effect = getEffectTypeRecord(effectID);
    if (!effect || !Array.isArray(effect.modifierInfo)) {
      continue;
    }

    for (const modifierInfo of effect.modifierInfo) {
      if (
        modifierInfo &&
        modifierInfo.domain === "shipID" &&
        modifierInfo.func === "ItemModifier"
      ) {
        const modifiedAttributeID = toInt(modifierInfo.modifiedAttributeID, 0);
        if (modifiedAttributeID > 0) {
          explicitAttributeIDs.add(modifiedAttributeID);
        }
      }
    }
  }

  cache.set(numericSkillTypeID, explicitAttributeIDs);
  return explicitAttributeIDs;
}

function skillHasExplicitShipAttributeModifier(skillTypeID, targetAttributeID) {
  const numericSkillTypeID = toInt(skillTypeID, 0);
  const numericTargetAttributeID = toInt(targetAttributeID, 0);
  if (numericSkillTypeID <= 0 || numericTargetAttributeID <= 0) {
    return false;
  }

  return getSkillExplicitShipAttributeModifierSet(numericSkillTypeID).has(
    numericTargetAttributeID,
  );
}

function skillSupportsFallbackShipAttributeModifier(skillTypeID) {
  const numericSkillTypeID = toInt(skillTypeID, 0);
  if (numericSkillTypeID <= 0) {
    return false;
  }

  const cache = ensureSkillFallbackShipEligibilityCache();
  if (cache.has(numericSkillTypeID)) {
    return cache.get(numericSkillTypeID) === true;
  }

  let supportsFallback = true;
  for (const effectID of getTypeDogmaEffects(numericSkillTypeID)) {
    const effect = getEffectTypeRecord(effectID);
    if (!effect || !Array.isArray(effect.modifierInfo)) {
      continue;
    }

    for (const modifierInfo of effect.modifierInfo) {
      if (
        !modifierInfo ||
        (modifierInfo.domain === "itemID" &&
          modifierInfo.func === "ItemModifier") ||
        (modifierInfo.domain === "shipID" &&
          modifierInfo.func === "ItemModifier")
      ) {
        continue;
      }

      supportsFallback = false;
      break;
    }

    if (!supportsFallback) {
      break;
    }
  }

  cache.set(numericSkillTypeID, supportsFallback);
  return supportsFallback;
}

function applySkillFallbackPercentModifier(
  attributes,
  skillTypeID,
  level,
  targetAttributeID,
  ...sourceAttributeNames
) {
  if (
    skillHasExplicitShipAttributeModifier(skillTypeID, targetAttributeID) ||
    !skillSupportsFallbackShipAttributeModifier(skillTypeID)
  ) {
    return;
  }

  applyPercentModifier(
    attributes,
    targetAttributeID,
    toFiniteNumber(getTypeAttributeValue(skillTypeID, ...sourceAttributeNames), 0) * level,
  );
}

function applyShipTypeSelfModifiers(attributes, shipTypeID) {
  for (const effectID of getTypeDogmaEffects(shipTypeID)) {
    const effect = getEffectTypeRecord(effectID);
    if (!effect || !Array.isArray(effect.modifierInfo)) {
      continue;
    }

    for (const modifierInfo of effect.modifierInfo) {
      if (
        !modifierInfo ||
        modifierInfo.domain !== "shipID" ||
        modifierInfo.func !== "ItemModifier"
      ) {
        continue;
      }

      applyDogmaModifier(
        attributes,
        modifierInfo.modifiedAttributeID,
        modifierInfo.operation,
        attributes[toInt(modifierInfo.modifyingAttributeID, 0)],
      );
    }
  }
}

function collectShipLocationModifierSourceAttributes(shipItem, skillMap = new Map()) {
  const shipTypeID = toInt(shipItem && shipItem.typeID, 0);
  const attributes = normalizeNumericAttributeMap(getTypeDogmaAttributes(shipTypeID));
  if (shipTypeID <= 0) {
    return attributes;
  }

  for (const skillRecord of skillMap.values()) {
    const effectiveSkillAttributes = peekSkillEffectiveAttributes(skillRecord);
    for (const effectRecord of getTypeEffectRecords(skillRecord.typeID)) {
      for (const modifierInfo of effectRecord.modifierInfo || []) {
        if (
          !modifierInfo ||
          modifierInfo.func !== "ItemModifier" ||
          modifierInfo.domain !== "shipID"
        ) {
          continue;
        }

        applyDogmaModifier(
          attributes,
          modifierInfo.modifiedAttributeID,
          modifierInfo.operation,
          effectiveSkillAttributes[toInt(modifierInfo.modifyingAttributeID, 0)],
        );
      }
    }
  }

  return attributes;
}

function buildPassiveModuleAttributeMap(
  shipItem,
  moduleItem,
  skillMap = new Map(),
  options = {},
) {
  const attributes = buildEffectiveItemAttributeMap(moduleItem);
  if (!moduleItem) {
    return attributes;
  }

  const modifierEntries = [];
  const resolvedSkillMap = skillMap instanceof Map ? skillMap : new Map();
  const additionalLocationModifierSources = Array.isArray(
    options.additionalLocationModifierSources,
  )
    ? options.additionalLocationModifierSources
    : [];
  const additionalShipAttributeModifierEntries = Array.isArray(
    options.additionalShipAttributeModifierEntries,
  )
    ? options.additionalShipAttributeModifierEntries
    : [];
  const locationModifierDomains = isStructureDogmaHost(shipItem)
    ? new Set(["structureID", "charID"])
    : new Set(["shipID", "charID"]);
  for (const skillRecord of resolvedSkillMap.values()) {
    appendLocationModifierEntries(
      modifierEntries,
      peekSkillEffectiveAttributes(skillRecord),
      getTypeEffectRecords(skillRecord.typeID),
      "skill",
      moduleItem,
      {
        allowedDomains: locationModifierDomains,
        sourceTypeID: skillRecord.typeID,
      },
    );
  }

  const shipTypeID = toInt(shipItem && shipItem.typeID, 0);
  if (shipTypeID > 0) {
    const shipLocationAttributes = collectShipLocationModifierSourceAttributes(
      shipItem,
      resolvedSkillMap,
    );
    if (additionalShipAttributeModifierEntries.length > 0) {
      applyModifierGroups(shipLocationAttributes, additionalShipAttributeModifierEntries);
    }
    appendLocationModifierEntries(
      modifierEntries,
      shipLocationAttributes,
      getTypeEffectRecords(shipTypeID),
      "ship",
      moduleItem,
      { allowedDomains: locationModifierDomains },
    );
  }

  for (const source of additionalLocationModifierSources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    appendLocationModifierEntries(
      modifierEntries,
      source.sourceAttributes,
      source.sourceEffects,
      String(source.sourceKind || "system"),
      moduleItem,
      { allowedDomains: locationModifierDomains },
    );
  }

  if (modifierEntries.length > 0) {
    applyModifierGroups(attributes, modifierEntries);
  }
  return attributes;
}

function buildEffectiveFittedModuleAttributeMap(
  shipItem,
  moduleItem,
  skillMap = new Map(),
  fittedItems = [],
  options = {},
) {
  const attributes = buildPassiveModuleAttributeMap(
    shipItem,
    moduleItem,
    skillMap,
    options,
  );
  if (!moduleItem) {
    return attributes;
  }

  const modifierEntries = [];
  for (const sourceItem of getPassiveModifierSourceItems(shipItem, fittedItems, options)) {
    if (
      !itemAppliesPassiveStats(sourceItem) ||
      toInt(sourceItem && sourceItem.itemID, 0) === toInt(moduleItem.itemID, 0)
    ) {
      continue;
    }

    const passiveSourceEffects = getPassiveModifierEffectRecords(sourceItem.typeID);
    if (passiveSourceEffects.length <= 0) {
      continue;
    }

    appendLocationModifierEntries(
      modifierEntries,
      buildPassiveModuleAttributeMap(shipItem, sourceItem, skillMap, options),
      passiveSourceEffects,
      "fittedModule",
      moduleItem,
    );
  }

  if (modifierEntries.length > 0) {
    applyModifierGroups(attributes, modifierEntries);
  }

  return attributes;
}

function getEffectiveModuleResourceLoad(
  shipItem,
  moduleItem,
  skillMap = new Map(),
  fittedItems = [],
  options = {},
) {
  const attributes = buildEffectiveFittedModuleAttributeMap(
    shipItem,
    moduleItem,
    skillMap,
    fittedItems,
    options,
  );

  return {
    cpuLoad: round6(
      toFiniteNumber(
        attributes[ATTRIBUTE_MODULE_CPU_NEED],
        getTypeAttributeValue(moduleItem && moduleItem.typeID, "cpuLoad", "cpu"),
      ),
    ),
    powerLoad: round6(
      toFiniteNumber(
        attributes[ATTRIBUTE_MODULE_POWER_NEED],
        getTypeAttributeValue(moduleItem && moduleItem.typeID, "powerLoad", "power"),
      ),
    ),
  };
}

function collectPassiveShipAttributeModifiers(fittedItems = [], options = {}) {
  const modifiers = [];
  const shipItem = options.shipItem || null;
  const skillMap = options.skillMap instanceof Map
    ? options.skillMap
    : new Map();

  for (const item of getPassiveModifierSourceItems(shipItem, fittedItems, options)) {
    if (!itemAppliesPassiveStats(item)) {
      continue;
    }

    const passiveSourceEffects = getPassiveModifierEffectRecords(item.typeID);
    if (passiveSourceEffects.length <= 0) {
      continue;
    }

    appendDirectModifierEntries(
      modifiers,
      buildPassiveModuleAttributeMap(shipItem, item, skillMap, options),
      passiveSourceEffects,
      "fittedModule",
    );
  }

  return modifiers;
}

function getSkillLevel(skillMap, skillTypeID) {
  const skill = skillMap instanceof Map ? skillMap.get(toInt(skillTypeID, 0)) : null;
  if (!skill) {
    return 0;
  }

  return Math.max(
    0,
    toInt(
      skill.effectiveSkillLevel ??
        skill.trainedSkillLevel ??
        skill.skillLevel,
      0,
    ),
  );
}

function resolveAssumedActivePropulsionEffectState(moduleItem, skillMap = new Map()) {
  if (!moduleItem || !isEffectivelyOnlineModule(moduleItem)) {
    return null;
  }

  let effectName = "";
  if (typeHasEffectName(moduleItem.typeID, PROPULSION_EFFECT_AFTERBURNER)) {
    effectName = PROPULSION_EFFECT_AFTERBURNER;
  } else if (typeHasEffectName(moduleItem.typeID, PROPULSION_EFFECT_MICROWARPDRIVE)) {
    effectName = PROPULSION_EFFECT_MICROWARPDRIVE;
  } else {
    return null;
  }

  const accelerationControlLevel = getSkillLevel(
    skillMap,
    PROPULSION_SKILL_ACCELERATION_CONTROL,
  );
  const moduleAttributes = buildEffectiveItemAttributeMap(moduleItem);
  const speedFactorBase = toFiniteNumber(
    moduleAttributes[ATTRIBUTE_SPEED_FACTOR],
    0,
  );
  const speedFactor =
    speedFactorBase * (1 + ((5 * accelerationControlLevel) / 100));
  const speedBoostFactor = toFiniteNumber(
    moduleAttributes[ATTRIBUTE_SPEED_BOOST_FACTOR],
    0,
  );
  if (!(speedBoostFactor > 0)) {
    return null;
  }

  return {
    effectName,
    speedFactor: round6(speedFactor),
    speedBoostFactor: round6(speedBoostFactor),
    massAddition: round6(
      toFiniteNumber(moduleAttributes[ATTRIBUTE_MASS_ADDITION], 0),
    ),
    signatureRadiusBonus: round6(
      toFiniteNumber(moduleAttributes[ATTRIBUTE_SIGNATURE_RADIUS_BONUS], 0),
    ),
  };
}

function applyAssumedActivePropulsionEffect(attributes, effectState) {
  if (!attributes || !effectState) {
    return;
  }

  const passiveMass = toFiniteNumber(attributes[ATTRIBUTE_MASS], NaN);
  const passiveMaxVelocity = toFiniteNumber(attributes[ATTRIBUTE_MAX_VELOCITY], NaN);
  if (!Number.isFinite(passiveMass) || !Number.isFinite(passiveMaxVelocity)) {
    return;
  }

  const massAfterAddition =
    passiveMass + toFiniteNumber(effectState.massAddition, 0);
  const speedMultiplier =
    1 +
    (0.01 *
      toFiniteNumber(effectState.speedFactor, 0) *
      toFiniteNumber(effectState.speedBoostFactor, 0) /
      Math.max(massAfterAddition, 1));

  attributes[ATTRIBUTE_MASS] = round6(massAfterAddition);
  attributes[ATTRIBUTE_MAX_VELOCITY] = round6(
    passiveMaxVelocity * Math.max(speedMultiplier, 0),
  );

  if (effectState.effectName === PROPULSION_EFFECT_MICROWARPDRIVE) {
    const passiveSignatureRadius = toFiniteNumber(
      attributes[ATTRIBUTE_SIGNATURE_RADIUS],
      NaN,
    );
    if (Number.isFinite(passiveSignatureRadius)) {
      attributes[ATTRIBUTE_SIGNATURE_RADIUS] = round6(
        passiveSignatureRadius *
          (1 + (toFiniteNumber(effectState.signatureRadiusBonus, 0) / 100)),
      );
    }
  }
}

function applyAssumedActiveShipModuleEffects(
  attributes,
  fittedItems = [],
  skillMap = new Map(),
) {
  const candidateModules = (Array.isArray(fittedItems) ? fittedItems : [])
    .filter((item) => resolveAssumedActivePropulsionEffectState(item, skillMap))
    .sort((left, right) => {
      const flagDiff = toInt(left && left.flagID, 0) - toInt(right && right.flagID, 0);
      if (flagDiff !== 0) {
        return flagDiff;
      }
      return toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0);
    });

  const propulsionModule = candidateModules[0] || null;
  if (!propulsionModule) {
    return;
  }

  applyAssumedActivePropulsionEffect(
    attributes,
    resolveAssumedActivePropulsionEffectState(propulsionModule, skillMap),
  );
}

function getStackedMultiplierFactor(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 1;
  }

  const factors = entries
    .map((entry) => (
      typeof entry === "number"
        ? toFiniteNumber(entry, NaN)
        : toFiniteNumber(entry && entry.factor, NaN)
    ))
    .filter((factor) => Number.isFinite(factor) && factor >= 0);
  if (factors.length === 0) {
    return 1;
  }

  const sortedFactors = [...factors].sort((left, right) => left - right);
  const splitPoint = sortedFactors.findIndex((factor) => factor > 1);
  const belowOrEqual = splitPoint === -1 ? sortedFactors : sortedFactors.slice(0, splitPoint);
  const above = splitPoint === -1 ? [] : sortedFactors.slice(splitPoint).reverse();
  let combined = 1;

  belowOrEqual.forEach((factor, index) => {
    const denominator = STACKING_DENOMINATORS[index];
    if (!denominator) {
      return;
    }
    combined *= ((factor - 1) * (1 / denominator)) + 1;
  });
  above.forEach((factor, index) => {
    const denominator = STACKING_DENOMINATORS[index];
    if (!denominator) {
      return;
    }
    combined *= ((factor - 1) * (1 / denominator)) + 1;
  });

  return combined;
}

function applyPassiveShipAttributeModifiers(attributes, modifiers) {
  return applyModifierGroups(attributes, modifiers);
}

function applyModifierGroups(attributes, modifierEntries = []) {
  const groups = new Map();
  for (const modifierEntry of modifierEntries) {
    if (!modifierEntry) {
      continue;
    }
    const attributeID = toInt(modifierEntry.modifiedAttributeID, 0);
    const operation = toInt(modifierEntry.operation, 0);
    const value = toFiniteNumber(modifierEntry.value, NaN);
    if (attributeID <= 0 || !Number.isFinite(value)) {
      continue;
    }
    const key = `${attributeID}:${operation}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(modifierEntry);
  }

  const operationOrder = [
    DOGMA_OP_PRE_ASSIGNMENT,
    DOGMA_OP_PRE_MUL,
    DOGMA_OP_MOD_ADD,
    DOGMA_OP_MOD_SUB,
    DOGMA_OP_POST_MUL,
    DOGMA_OP_POST_PERCENT,
    5,
    DOGMA_OP_POST_PERCENT_UNNERFED,
    DOGMA_OP_POST_ASSIGNMENT,
  ];
  for (const operation of operationOrder) {
    for (const [key, entries] of groups.entries()) {
      const [, rawOperation] = key.split(":");
      if (Number(rawOperation) !== operation) {
        continue;
      }

      const attributeID = toInt(entries[0] && entries[0].modifiedAttributeID, 0);
      const currentValue = toFiniteNumber(attributes[attributeID], NaN);
      if (attributeID <= 0) {
        continue;
      }

      switch (operation) {
        case DOGMA_OP_PRE_ASSIGNMENT: {
          const lastEntry = entries[entries.length - 1] || null;
          if (lastEntry) {
            attributes[attributeID] = round6(lastEntry.value);
          }
          break;
        }
        case DOGMA_OP_PRE_MUL:
        case DOGMA_OP_POST_MUL:
        case 5:
        case DOGMA_OP_POST_PERCENT:
        case DOGMA_OP_POST_PERCENT_UNNERFED: {
          const directFactors = [];
          const penalizedFactors = [];
          for (const entry of entries) {
            let factor = 1;
            if (
              operation === DOGMA_OP_POST_PERCENT ||
              operation === DOGMA_OP_POST_PERCENT_UNNERFED
            ) {
              factor = 1 + (toFiniteNumber(entry.value, 0) / 100);
            } else if (operation === 5) {
              const divisor = toFiniteNumber(entry.value, NaN);
              factor = Number.isFinite(divisor) && Math.abs(divisor) > 1e-9
                ? 1 / divisor
                : 1;
            } else {
              factor = toFiniteNumber(entry.value, 1);
            }
            if (!Number.isFinite(factor) || factor < 0) {
              continue;
            }
            if (
              operation !== DOGMA_OP_POST_PERCENT_UNNERFED &&
              entry.stackingPenalized
            ) {
              penalizedFactors.push(factor);
            } else {
              directFactors.push(factor);
            }
          }

          const base = Number.isFinite(currentValue)
            ? currentValue
            : (
              operation === DOGMA_OP_POST_PERCENT ||
              operation === DOGMA_OP_POST_PERCENT_UNNERFED
            )
              ? 0
              : 1;
          const directFactor = directFactors.reduce(
            (result, factor) => result * factor,
            1,
          );
          const penalizedFactor = getStackedMultiplierFactor(penalizedFactors);
          attributes[attributeID] = round6(base * directFactor * penalizedFactor);
          break;
        }
        case DOGMA_OP_MOD_ADD: {
          const base = Number.isFinite(currentValue) ? currentValue : 0;
          const totalAdd = entries.reduce(
            (sum, entry) => sum + toFiniteNumber(entry.value, 0),
            0,
          );
          attributes[attributeID] = round6(base + totalAdd);
          break;
        }
        case DOGMA_OP_MOD_SUB: {
          const base = Number.isFinite(currentValue) ? currentValue : 0;
          const totalSub = entries.reduce(
            (sum, entry) => sum + toFiniteNumber(entry.value, 0),
            0,
          );
          attributes[attributeID] = round6(base - totalSub);
          break;
        }
        case DOGMA_OP_POST_ASSIGNMENT: {
          const lastEntry = entries[entries.length - 1] || null;
          if (lastEntry) {
            attributes[attributeID] = round6(lastEntry.value);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return attributes;
}

function synchronizeShipResourceStateSummary(resourceState) {
  if (
    !resourceState ||
    !resourceState.attributes ||
    typeof resourceState.attributes !== "object"
  ) {
    return resourceState;
  }

  const attributes = resourceState.attributes;
  resourceState.cpuOutput = round6(toFiniteNumber(attributes[ATTRIBUTE_CPU_OUTPUT], 0));
  resourceState.powerOutput = round6(toFiniteNumber(attributes[ATTRIBUTE_POWER_OUTPUT], 0));
  resourceState.cargoCapacity = round6(toFiniteNumber(attributes[ATTRIBUTE_CAPACITY], 0));
  resourceState.maxVelocity = round6(toFiniteNumber(attributes[ATTRIBUTE_MAX_VELOCITY], 0));
  resourceState.agility = round6(toFiniteNumber(attributes[ATTRIBUTE_AGILITY], 0));
  resourceState.mass = round6(toFiniteNumber(attributes[ATTRIBUTE_MASS], 0));
  resourceState.maxTargetRange = round6(
    toFiniteNumber(attributes[ATTRIBUTE_MAX_TARGET_RANGE], 0),
  );
  resourceState.maxLockedTargets = round6(
    toFiniteNumber(attributes[ATTRIBUTE_MAX_LOCKED_TARGETS], 0),
  );
  resourceState.signatureRadius = round6(
    toFiniteNumber(attributes[ATTRIBUTE_SIGNATURE_RADIUS], 0),
  );
  resourceState.cloakingTargetingDelay = round6(
    toFiniteNumber(attributes[ATTRIBUTE_CLOAKING_TARGETING_DELAY], 0),
  );
  resourceState.scanResolution = round6(
    toFiniteNumber(attributes[ATTRIBUTE_SCAN_RESOLUTION], 0),
  );
  resourceState.capacitorCapacity = round6(
    toFiniteNumber(attributes[ATTRIBUTE_CAPACITOR_CAPACITY], 0),
  );
  resourceState.capacitorRechargeRate = round6(
    toFiniteNumber(attributes[ATTRIBUTE_CAPACITOR_RECHARGE_RATE], 0),
  );
  resourceState.shieldCapacity = round6(
    toFiniteNumber(attributes[ATTRIBUTE_SHIELD_CAPACITY], 0),
  );
  resourceState.shieldRechargeRate = round6(
    toFiniteNumber(attributes[ATTRIBUTE_SHIELD_RECHARGE_RATE], 0),
  );
  resourceState.armorHP = round6(toFiniteNumber(attributes[ATTRIBUTE_ARMOR_HP], 0));
  resourceState.structureHP = round6(
    toFiniteNumber(attributes[ATTRIBUTE_STRUCTURE_HP], 0),
  );
  resourceState.upgradeCapacity = round6(
    toFiniteNumber(attributes[ATTRIBUTE_UPGRADE_CAPACITY], 0),
  );
  resourceState[FUEL_BAY_RESOURCE_KEY] = round6(
    toFiniteNumber(attributes[FUEL_BAY_ATTRIBUTE_ID], 0),
  );
  for (const miningHold of MINING_HOLD_ATTRIBUTE_IDS) {
    resourceState[miningHold.resourceKey] = round6(
      toFiniteNumber(attributes[miningHold.attributeID], 0),
    );
  }
  return resourceState;
}

function applySkillFallbackAttributeBonuses(attributes, skillMap) {
  for (const skill of skillMap.values()) {
    const skillTypeID = toInt(skill && skill.typeID, 0);
    const level = Math.max(
      0,
      toInt(
        skill && (
          skill.effectiveSkillLevel ??
          skill.trainedSkillLevel ??
          skill.skillLevel
        ),
        0,
      ),
    );
    if (skillTypeID <= 0 || level <= 0) {
      continue;
    }

    applySkillFallbackPercentModifier(
      attributes,
      skillTypeID,
      level,
      ATTRIBUTE_CPU_OUTPUT,
      "cpuOutputBonus",
      "cpuOutputBonus2",
    );
    applySkillFallbackPercentModifier(
      attributes,
      skillTypeID,
      level,
      ATTRIBUTE_POWER_OUTPUT,
      "powerOutputBonus",
      "powerEngineeringOutputBonus",
    );
    applySkillFallbackPercentModifier(
      attributes,
      skillTypeID,
      level,
      ATTRIBUTE_MAX_VELOCITY,
      "maxVelocityBonus",
      "velocityBonus",
    );
    // Leave agility on the explicit dogma lane only. Generic fallback on the
    // raw `agilityBonus` attribute over-applies Advanced Spaceship Command and
    // Capital Ships to subcapital hulls, which is how normal fitting drifted
    // below ghost fitting on the same fit.
    applySkillFallbackPercentModifier(
      attributes,
      skillTypeID,
      level,
      ATTRIBUTE_MAX_TARGET_RANGE,
      "maxTargetRangeBonus",
    );
    applySkillFallbackPercentModifier(
      attributes,
      skillTypeID,
      level,
      ATTRIBUTE_SCAN_RESOLUTION,
      "scanResolutionBonus",
    );
    applySkillFallbackPercentModifier(
      attributes,
      skillTypeID,
      level,
      ATTRIBUTE_CLOAKING_TARGETING_DELAY,
      "cloakingTargetingDelayBonus",
    );
  }
}

function buildCharacterTargetingState(charID, options = {}) {
  const numericCharID = toInt(charID, 0);
  // getCachedCharacterSkillMap returns the SHARED, read-only skill map; this
  // removes the ~6ms getCharacterSkillMap deep clone (511 skills for a maxed pilot)
  // that validateAllTargetLocks -> getEntityTargetingStats ->
  // buildCharacterTargetingState paid EVERY tick for any locked entity (the
  // dominant scene-tick movement/destiny cost). Read-only here (verified).
  const skillMap = options.skillMap instanceof Map
    ? options.skillMap
    : numericCharID > 0
      ? getCachedCharacterSkillMap(numericCharID)
      : new Map();
  const baseAttributes = Object.fromEntries(
    Object.entries(getTypeDogmaAttributes(CHARACTER_TYPE_ID))
      .map(([attributeID, value]) => [Number(attributeID), Number(value)])
      .filter(
        ([attributeID, value]) =>
          Number.isInteger(attributeID) && Number.isFinite(value),
      ),
  );
  const sourceAttributes =
    options.characterAttributes && typeof options.characterAttributes === "object"
      ? options.characterAttributes
      : null;
  if (sourceAttributes) {
    for (const [attributeID, value] of Object.entries(sourceAttributes)) {
      const numericAttributeID = Number(attributeID);
      const numericValue = Number(value);
      if (!Number.isInteger(numericAttributeID) || !Number.isFinite(numericValue)) {
        continue;
      }
      baseAttributes[numericAttributeID] = numericValue;
    }
  }

  if (baseAttributes[ATTRIBUTE_MAX_LOCKED_TARGETS] === undefined) {
    baseAttributes[ATTRIBUTE_MAX_LOCKED_TARGETS] = 0;
  }

  for (const skill of skillMap.values()) {
    const skillTypeID = toInt(skill && skill.typeID, 0);
    const level = Math.max(
      0,
      toInt(
        skill && (
          skill.effectiveSkillLevel ??
          skill.trainedSkillLevel ??
          skill.skillLevel
        ),
        0,
      ),
    );
    if (skillTypeID <= 0 || level <= 0) {
      continue;
    }

    applyAdditiveModifier(
      baseAttributes,
      ATTRIBUTE_MAX_LOCKED_TARGETS,
      toFiniteNumber(getSkillAttributeValue(skillTypeID, "maxLockedTargetsBonus"), 0) * level,
    );
  }

  return {
    attributes: baseAttributes,
    maxLockedTargets: Math.max(
      0,
      Math.trunc(toFiniteNumber(baseAttributes[ATTRIBUTE_MAX_LOCKED_TARGETS], 0)),
    ),
  };
}

function buildShipResourceState(charID, shipItem, options = {}) {
  const numericCharID = toInt(charID, 0);
  const numericShipID = toInt(shipItem && shipItem.itemID, 0);
  const shipTypeID = toInt(shipItem && shipItem.typeID, 0);
  const shipMetadata = resolveItemByTypeID(shipTypeID) || null;
  const isStructureHost = isStructureDogmaHost(shipItem || shipMetadata);
  const fittedItems = Array.isArray(options.fittedItems)
    ? options.fittedItems
    : isStructureHost
      ? listFittedItemsForLocation(numericShipID)
      : listFittedItems(numericCharID, numericShipID);
  const skillMap = resolveDogmaSkillMapForHost(
    numericCharID,
    shipItem || shipMetadata,
    options,
  );
  const includeActiveImplantModifiers =
    !isStructureHost && options.includeActiveImplantModifiers !== false && numericCharID > 0;
  const implantShipAttributeModifierEntries = includeActiveImplantModifiers
    ? getActiveImplantShipModifierEntries(numericCharID)
    : [];
  const implantLocationModifierSources = includeActiveImplantModifiers
    ? getActiveImplantLocationModifierSources(numericCharID)
    : [];
  const additionalLocationModifierSources = [
    ...implantLocationModifierSources,
    ...(!isStructureHost && Array.isArray(options.additionalLocationModifierSources)
      ? options.additionalLocationModifierSources
      : []),
  ];
  const derivedAttributes = readShipBaseAttributeMap(
    shipTypeID,
    shipItem,
    shipMetadata,
  );
  const shipTypeAttributes = normalizeNumericAttributeMap(getTypeDogmaAttributes(shipTypeID));
  for (const [attributeID, value] of Object.entries(shipTypeAttributes)) {
    if (derivedAttributes[attributeID] === undefined) {
      derivedAttributes[attributeID] = value;
    }
  }
  const passiveAttributeModifierEntries =
    Array.isArray(options.passiveAttributeModifierEntries)
      ? options.passiveAttributeModifierEntries
      : collectPassiveShipAttributeModifiers(fittedItems, {
          shipItem,
          skillMap,
          hiddenModifierItems: options.hiddenModifierItems,
          additionalLocationModifierSources,
          additionalShipAttributeModifierEntries: implantShipAttributeModifierEntries,
        });
  const additionalAttributeModifierEntries = [
    ...implantShipAttributeModifierEntries,
    ...(Array.isArray(options.additionalAttributeModifierEntries)
      ? options.additionalAttributeModifierEntries
      : []),
  ];
  applySkillFallbackAttributeBonuses(derivedAttributes, skillMap);
  applySkillDrivenShipAttributeModifiers(derivedAttributes, skillMap);
  applyShipTypeSelfModifiers(derivedAttributes, shipTypeID);
  applyPassiveShipAttributeModifiers(
    derivedAttributes,
    [
      ...passiveAttributeModifierEntries,
      ...additionalAttributeModifierEntries,
    ],
  );
  if (options.assumeActiveShipModules === true) {
    applyAssumedActiveShipModuleEffects(
      derivedAttributes,
      fittedItems,
      skillMap,
    );
  }
  const turretHardpoints = toInt(
    getShipBaseAttributeValue(shipTypeID, "turretSlotsLeft"),
    0,
  );
  const launcherHardpoints = toInt(
    getShipBaseAttributeValue(shipTypeID, "launcherSlotsLeft"),
    0,
  );

  let cpuLoad = 0;
  let powerLoad = 0;
  let upgradeLoad = 0;

  for (const item of fittedItems) {
    if (!item || !isFittedModuleItem(item)) {
      continue;
    }

    if (isEffectivelyOnlineModule(item)) {
      const effectiveResourceLoad = getEffectiveModuleResourceLoad(
        shipItem,
        item,
        skillMap,
        fittedItems,
        {
          additionalLocationModifierSources,
          additionalShipAttributeModifierEntries: implantShipAttributeModifierEntries,
          ...(Array.isArray(options.hiddenModifierItems)
            ? { hiddenModifierItems: options.hiddenModifierItems }
            : {}),
        },
      );
      cpuLoad += effectiveResourceLoad.cpuLoad;
      powerLoad += effectiveResourceLoad.powerLoad;
    }

    if (!itemAppliesPassiveStats(item)) {
      continue;
    }
    upgradeLoad += toFiniteNumber(getEffectiveItemAttributeValue(item, "upgradeCost"), 0);
  }
  const usedTurrets = countMatchingFittedItems(fittedItems, itemConsumesTurretHardpoint);
  const usedLaunchers = countMatchingFittedItems(fittedItems, itemConsumesLauncherHardpoint);

  derivedAttributes[ATTRIBUTE_CPU_LOAD] = round6(cpuLoad);
  derivedAttributes[ATTRIBUTE_POWER_LOAD] = round6(powerLoad);
  derivedAttributes[ATTRIBUTE_UPGRADE_LOAD] = round6(upgradeLoad);
  if (derivedAttributes[ATTRIBUTE_UPGRADE_CAPACITY] === undefined) {
    derivedAttributes[ATTRIBUTE_UPGRADE_CAPACITY] = round6(
      toFiniteNumber(getShipBaseAttributeValue(shipTypeID, "upgradeCapacity"), 0),
    );
  }
  derivedAttributes[ATTRIBUTE_TURRET_SLOTS_LEFT] = Math.max(
    0,
    turretHardpoints - usedTurrets,
  );
  derivedAttributes[ATTRIBUTE_LAUNCHER_SLOTS_LEFT] = Math.max(
    0,
    launcherHardpoints - usedLaunchers,
  );

  const resourceState = {
    fittedItems,
    skillMap,
    attributes: derivedAttributes,
    cpuLoad: round6(cpuLoad),
    powerLoad: round6(powerLoad),
    upgradeLoad: round6(upgradeLoad),
    turretSlotsLeft: Math.max(0, turretHardpoints - usedTurrets),
    launcherSlotsLeft: Math.max(0, launcherHardpoints - usedLaunchers),
    baseTurretSlots: turretHardpoints,
    baseLauncherSlots: launcherHardpoints,
    passiveAttributeModifierEntries,
    appliedAttributeModifierEntries: [
      ...passiveAttributeModifierEntries,
      ...additionalAttributeModifierEntries,
    ],
  };

  return synchronizeShipResourceStateSummary(resourceState);
}

function calculateShipDerivedAttributes(charID, shipItem, options = {}) {
  const resourceState = buildShipResourceState(charID, shipItem, options);

  return {
    attributes: {
      ...resourceState.attributes,
    },
    resourceState,
  };
}

function validateFitForShip(charID, shipItem, item, targetFlagID, fittedItems = null) {
  const numericCharID = toInt(charID, 0);
  const numericTargetFlagID = toInt(targetFlagID, 0);
  if (numericCharID <= 0 || !shipItem || !item || numericTargetFlagID <= 0) {
    return { success: false, errorMsg: "INVALID_FIT_REQUEST" };
  }

  if (!isShipFittingFlag(numericTargetFlagID)) {
    return { success: false, errorMsg: "INVALID_FIT_FLAG" };
  }

  if (isChargeItem(item)) {
    return { success: false, errorMsg: "CHARGES_USE_LOAD_AMMO" };
  }

  const shipTypeID = toInt(shipItem.typeID, 0);
  const categoryRestriction = validateHostFittingCategoryRestriction(shipItem, item);
  if (!categoryRestriction.success) {
    return categoryRestriction;
  }

  const family = getRequiredSlotFamily(item.typeID);
  if (!family) {
    return { success: false, errorMsg: "TYPE_NOT_FITTABLE" };
  }

  const candidateFlags = getSlotFlagsForFamily(family, shipTypeID);
  if (!candidateFlags.includes(numericTargetFlagID)) {
    return { success: false, errorMsg: "INVALID_FIT_SLOT" };
  }

  const shipTypeRecord = resolveItemByTypeID(shipTypeID) || {};
  const currentFittedItems = Array.isArray(fittedItems)
    ? fittedItems
    : toInt(shipTypeRecord.categoryID, 0) === STRUCTURE_CATEGORY_ID
      ? listFittedItemsForLocation(toInt(shipItem.itemID, 0))
      : listFittedItems(numericCharID, toInt(shipItem.itemID, 0));
  const conflictingItem = currentFittedItems.find(
    (fittedItem) =>
      fittedItem &&
      isFittedModuleItem(fittedItem) &&
      toInt(fittedItem.flagID, 0) === numericTargetFlagID &&
      toInt(fittedItem.itemID, 0) !== toInt(item.itemID, 0) &&
      toInt(fittedItem.stacksize ?? 1, 1) > 0,
  );
  if (conflictingItem) {
    return { success: false, errorMsg: "SLOT_OCCUPIED" };
  }

  const skillMap = getCachedCharacterSkillMap(numericCharID);
  for (const requirement of getRequiredSkillRequirements(item.typeID)) {
    const skillRecord = skillMap.get(requirement.skillTypeID) || null;
    const trainedLevel = Math.max(
      0,
      toInt(
        skillRecord && (
          skillRecord.effectiveSkillLevel ??
          skillRecord.trainedSkillLevel ??
          skillRecord.skillLevel
        ),
        0,
      ),
    );
    if (trainedLevel < requirement.level) {
      return {
        success: false,
        errorMsg: "SKILL_REQUIRED",
        data: {
          skillTypeID: requirement.skillTypeID,
          requiredLevel: requirement.level,
          currentLevel: trainedLevel,
        },
      };
    }
  }

  const shipRestriction = validateShipTypeOrGroupRestriction(
    item.typeID,
    shipItem,
  );
  if (!shipRestriction.success) {
    return shipRestriction;
  }

  const maxTypeFitted = toInt(getEffectiveItemAttributeValue(item, "maxTypeFitted"), 0);
  if (maxTypeFitted > 0) {
    const moduleTypeID = toInt(item.typeID, 0);
    const existingTypeCount = countMatchingFittedItems(
      currentFittedItems,
      (fittedItem) => toInt(fittedItem.typeID, 0) === moduleTypeID,
      toInt(item.itemID, 0),
    );
    if (existingTypeCount >= maxTypeFitted) {
      return {
        success: false,
        errorMsg: "MAX_TYPE_FITTED",
        data: {
          maxTypeFitted,
          existingTypeCount,
          noOfModules: maxTypeFitted,
          noOfModulesFitted: existingTypeCount,
          shipTypeID,
          moduleTypeID,
        },
      };
    }
  }

  const maxGroupFitted = toInt(getEffectiveItemAttributeValue(item, "maxGroupFitted"), 0);
  if (maxGroupFitted > 0) {
    const moduleTypeID = toInt(item.typeID, 0);
    const moduleGroupID = toInt(item.groupID, 0);
    const moduleTypeRecord = resolveItemByTypeID(moduleTypeID);
    const existingGroupCount = countMatchingFittedItems(
      currentFittedItems,
      (fittedItem) => toInt(fittedItem.groupID, 0) === moduleGroupID,
      toInt(item.itemID, 0),
    );
    if (existingGroupCount >= maxGroupFitted) {
      return {
        success: false,
        errorMsg: "MAX_GROUP_FITTED",
        data: {
          maxGroupFitted,
          existingGroupCount,
          noOfModules: maxGroupFitted,
          noOfModulesFitted: existingGroupCount,
          shipTypeID,
          moduleTypeID,
          groupName:
            item.groupName ||
            (moduleTypeRecord && moduleTypeRecord.groupName) ||
            "",
        },
      };
    }
  }

  if (family === "rig") {
    const shipRigSize = toInt(getShipBaseAttributeValue(shipTypeID, "rigSize"), 0);
    const moduleRigSize = toInt(getTypeAttributeValue(item.typeID, "rigSize"), 0);
    if (shipRigSize > 0 && moduleRigSize > 0 && shipRigSize !== moduleRigSize) {
      return {
        success: false,
        errorMsg: "RIG_SIZE_MISMATCH",
        data: { shipRigSize, moduleRigSize },
      };
    }

    const shipUpgradeCapacity = toFiniteNumber(
      getShipBaseAttributeValue(shipTypeID, "upgradeCapacity"),
      0,
    );
    const currentUpgradeLoad = currentFittedItems
      .filter((fittedItem) => getRequiredSlotFamily(fittedItem && fittedItem.typeID) === "rig")
      .filter((fittedItem) => toInt(fittedItem.itemID, 0) !== toInt(item.itemID, 0))
      .reduce(
        (sum, fittedItem) =>
          sum + toFiniteNumber(getEffectiveItemAttributeValue(fittedItem, "upgradeCost"), 0),
        0,
      );
    const nextUpgradeLoad =
      currentUpgradeLoad + toFiniteNumber(getEffectiveItemAttributeValue(item, "upgradeCost"), 0);
    if (shipUpgradeCapacity > 0 && nextUpgradeLoad > shipUpgradeCapacity) {
      return {
        success: false,
        errorMsg: "INSUFFICIENT_CALIBRATION",
        data: {
          upgradeCapacity: shipUpgradeCapacity,
          upgradeLoad: nextUpgradeLoad,
        },
      };
    }
  }

  if (itemConsumesTurretHardpoint(item)) {
    const turretHardpoints = toInt(
      getShipBaseAttributeValue(shipTypeID, "turretSlotsLeft"),
      0,
    );
    const usedTurrets = countMatchingFittedItems(
      currentFittedItems,
      itemConsumesTurretHardpoint,
      toInt(item.itemID, 0),
    );
    if (usedTurrets >= turretHardpoints) {
      return {
        success: false,
        errorMsg: "NO_TURRET_HARDPOINTS",
        data: { turretHardpoints, usedTurrets },
      };
    }
  }

  if (itemConsumesLauncherHardpoint(item)) {
    const launcherHardpoints = toInt(
      getShipBaseAttributeValue(shipTypeID, "launcherSlotsLeft"),
      0,
    );
    const usedLaunchers = countMatchingFittedItems(
      currentFittedItems,
      itemConsumesLauncherHardpoint,
      toInt(item.itemID, 0),
    );
    if (usedLaunchers >= launcherHardpoints) {
      return {
        success: false,
        errorMsg: "NO_LAUNCHER_HARDPOINTS",
        data: { launcherHardpoints, usedLaunchers },
      };
    }
  }

  return {
    success: true,
    data: {
      family,
      targetFlagID: numericTargetFlagID,
    },
  };
}

const ONLINE_RESOURCE_EPSILON = 1e-6;

// Rigs, subsystems and service slots are always-on passives with no online
// toggle. Only modules carrying the `online` effect (hi/med/lo power) draw CPU
// and powergrid and can be left offline when the ship cannot supply them.
function moduleParticipatesInOnlineState(item) {
  return (
    Boolean(item) &&
    isFittedModuleItem(item) &&
    typeHasEffectName(item.typeID, "online")
  );
}

// Decide whether a freshly fitted module may come online given the ship's
// remaining CPU/powergrid. Mirrors the online gate already enforced on an
// explicit offline->online transition in dogmaService._setModuleOnlineState, so
// that fitting a module the ship cannot power results in it being fitted
// OFFLINE rather than silently left online over budget (EVE parity).
function resolveFitOnlineState(charID, shipItem, moduleItem, fittedItems, options = {}) {
  if (!moduleParticipatesInOnlineState(moduleItem)) {
    return { applies: false };
  }

  const moduleID = toInt(moduleItem && moduleItem.itemID, 0);
  const baselineItems = (Array.isArray(fittedItems) ? fittedItems : []).filter(
    (item) => toInt(item && item.itemID, 0) !== moduleID,
  );
  // Evaluate the candidate as if it were online so its load is included.
  const candidateOnline = {
    ...moduleItem,
    moduleState: { ...(moduleItem && moduleItem.moduleState), online: true },
  };
  const resourceState = buildShipResourceState(charID, shipItem, {
    ...(options.resourceStateOptions || {}),
    fittedItems: [...baselineItems, candidateOnline],
  });

  const cpuOverloaded =
    toFiniteNumber(resourceState.cpuLoad, 0) >
    toFiniteNumber(resourceState.cpuOutput, 0) + ONLINE_RESOURCE_EPSILON;
  if (cpuOverloaded) {
    return { applies: true, online: false, reason: "NOT_ENOUGH_CPU", resourceState };
  }

  const powerOverloaded =
    toFiniteNumber(resourceState.powerLoad, 0) >
    toFiniteNumber(resourceState.powerOutput, 0) + ONLINE_RESOURCE_EPSILON;
  if (powerOverloaded) {
    return { applies: true, online: false, reason: "NOT_ENOUGH_POWER", resourceState };
  }

  return { applies: true, online: true, resourceState };
}

function buildSlimModuleTuples(charID, shipID) {
  return getFittedModuleItems(charID, shipID).map((item) => [
    toInt(item.itemID, 0),
    toInt(item.typeID, 0),
    toInt(item.flagID, 0),
  ]);
}

function buildModuleStatusSnapshot(item) {
  const moduleState = getItemModuleState(item);
  return {
    itemID: toInt(item && item.itemID, 0),
    online: isEffectivelyOnlineModule(item),
    damage: moduleState.damage,
    charge: moduleState.charge,
    skillPoints: moduleState.skillPoints,
    armorDamage: moduleState.armorDamage,
    shieldCharge: moduleState.shieldCharge,
    incapacitated: moduleState.incapacitated,
  };
}

function buildChargeTupleItemID(shipID, flagID, typeID) {
  return [toInt(shipID, 0), toInt(flagID, 0), toInt(typeID, 0)];
}

function buildChargeSublocationData(charID, shipID) {
  return getLoadedChargeItems(charID, shipID)
    .map((item) => ({
      flagID: toInt(item.flagID, 0),
      itemID: buildChargeTupleItemID(shipID, item.flagID, item.typeID),
      quantity: Number(item.stacksize ?? item.quantity ?? 0) || 0,
      typeID: toInt(item.typeID, 0),
    }))
    .filter((entry) => entry.flagID > 0 && entry.typeID > 0);
}

function getModuleChargeCapacity(moduleTypeID, chargeTypeID) {
  const capacityAttributeID = getAttributeIDByNames("capacity");
  const moduleAttributes = getTypeDogmaAttributes(moduleTypeID);
  const chargeMetadata = resolveItemByTypeID(toInt(chargeTypeID, 0)) || null;
  const moduleMetadata = resolveItemByTypeID(toInt(moduleTypeID, 0)) || null;
  const rawCapacity =
    (capacityAttributeID &&
      toFiniteNumber(moduleAttributes[String(capacityAttributeID)], NaN)) ||
    toFiniteNumber(moduleMetadata && moduleMetadata.capacity, NaN);
  const chargeVolume = toFiniteNumber(chargeMetadata && chargeMetadata.volume, NaN);

  if (!Number.isFinite(rawCapacity) || rawCapacity <= 0) {
    return 1;
  }
  if (!Number.isFinite(chargeVolume) || chargeVolume <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(rawCapacity / chargeVolume));
}

function getModuleChargeGroupIDs(moduleTypeID) {
  const chargeGroupIDs = new Set();

  for (let index = 1; index <= 5; index += 1) {
    const chargeGroupID = getTypeAttributeValue(moduleTypeID, `chargeGroup${index}`);
    if (Number.isInteger(chargeGroupID) && chargeGroupID > 0) {
      chargeGroupIDs.add(chargeGroupID);
    }
  }

  return chargeGroupIDs;
}

function isChargeCompatibleWithModule(moduleTypeID, chargeTypeID) {
  const numericModuleTypeID = toInt(moduleTypeID, 0);
  const numericChargeTypeID = toInt(chargeTypeID, 0);
  if (numericModuleTypeID <= 0 || numericChargeTypeID <= 0) {
    return false;
  }

  const chargeMetadata = resolveItemByTypeID(numericChargeTypeID) || null;
  const chargeGroupID = toInt(chargeMetadata && chargeMetadata.groupID, 0);
  const moduleChargeGroups = getModuleChargeGroupIDs(numericModuleTypeID);
  if (chargeGroupID <= 0 || !moduleChargeGroups.has(chargeGroupID)) {
    return false;
  }

  const requiredChargeSize = getTypeAttributeValue(numericModuleTypeID, "chargeSize");
  const actualChargeSize = getTypeAttributeValue(numericChargeTypeID, "chargeSize");
  if (Number.isInteger(requiredChargeSize) && requiredChargeSize > 0) {
    return Number(actualChargeSize) === Number(requiredChargeSize);
  }

  return getModuleChargeCapacity(numericModuleTypeID, numericChargeTypeID) > 0;
}

function getTurretLikeModuleItems(charID, shipID) {
  return getFittedModuleItems(charID, shipID).filter(
    (item) =>
      typeHasEffectName(item.typeID, "turretFitted") ||
      typeHasEffectName(item.typeID, "launcherFitted"),
  );
}

function selectAutoFitFlagForType(shipItem, fittedItems, typeID) {
  const family = getRequiredSlotFamily(typeID);
  if (!family) {
    return null;
  }

  const shipTypeID = toInt(shipItem && shipItem.typeID, 0);
  const candidateFlags = getSlotFlagsForFamily(family, shipTypeID);
  const occupiedFlags = new Set(
    (Array.isArray(fittedItems) ? fittedItems : [])
      .filter((item) => isFittedModuleItem(item))
      .map((item) => toInt(item.flagID, 0))
      .filter((flagID) => flagID > 0),
  );

  return candidateFlags.find((flagID) => !occupiedFlags.has(flagID)) || null;
}

module.exports = {
  SLOT_FAMILY_FLAGS,
  DEFAULT_MODULE_STATE,
  normalizeModuleState,
  getItemModuleState,
  isModuleOnline,
  isEffectivelyOnlineModule,
  isShipFittingFlag,
  isHiddenModifierItem,
  isChargeItem,
  isFittedChargeItem,
  isFittedModuleItem,
  getAttributeIDByNames,
  getEffectIDByNames,
  getTypeDogmaRecord,
  getTypeDogmaAttributes,
  getTypeAttributeValue,
  getDynamicItemAttributeOverrides,
  getDynamicItemSourceTypeID,
  getShipBaseAttributeValue,
  getTypeDogmaEffects,
  getTypeEffectRecords,
  getPassiveModifierEffectRecords,
  getTypeAttributeMap,
  cloneAttributeMap,
  typeHasEffectName,
  getRequiredSlotFamily,
  getRequiredSkillRequirements,
  getShipSlotCounts,
  getSlotFlagsForFamily,
  listFittedItems,
  listFittedItemsForLocation,
  listHiddenModifierItems,
  getPassiveModifierSourceItems,
  getFittedModuleItems,
  getLoadedChargeItems,
  getFittedModuleByFlag,
  getLoadedChargeByFlag,
  hasLoadedScanProbeLauncherCharge,
  buildSlimModuleTuples,
  buildModuleStatusSnapshot,
  buildCharacterTargetingState,
  buildChargeTupleItemID,
  buildChargeSublocationData,
  isStructureDogmaHost,
  filterStructureDogmaSkillMap,
  resolveDogmaSkillMapForHost,
  getModuleChargeCapacity,
  getModuleChargeGroupIDs,
  getTurretLikeModuleItems,
  isPassiveModifierSource,
  appendDirectModifierEntries,
  appendSelfItemModifierEntries,
  appendLocationModifierEntries,
  buildEffectiveItemAttributeMap,
  buildSkillEffectiveAttributes,
  applySkillDrivenShipAttributeModifiers,
  applySkillFallbackAttributeBonuses,
  getEffectiveModuleResourceLoad,
  applyOtherItemModifiersToAttributes,
  applyModifierGroups,
  synchronizeShipResourceStateSummary,
  buildShipResourceState,
  calculateShipDerivedAttributes,
  isChargeCompatibleWithModule,
  validateFitForShip,
  resolveFitOnlineState,
  moduleParticipatesInOnlineState,
  validateShipTypeOrGroupRestriction,
  selectAutoFitFlagForType,
  getEffectTypeRecord,
};
