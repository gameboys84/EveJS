const path = require("path");

const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const DRONE_CATEGORY_ID = 18;
const FIGHTER_CATEGORY_ID = 87;
const FIGHTER_CLASS_LIGHT = "LIGHT";
const FIGHTER_CLASS_SUPPORT = "SUPPORT";
const FIGHTER_CLASS_HEAVY = "HEAVY";
const FIGHTER_CLASS_STANDUP_LIGHT = "STANDUP_LIGHT";
const FIGHTER_CLASS_STANDUP_SUPPORT = "STANDUP_SUPPORT";
const FIGHTER_CLASS_STANDUP_HEAVY = "STANDUP_HEAVY";
const FIGHTER_BROAD_CLASS_LIGHT = "light";
const FIGHTER_BROAD_CLASS_SUPPORT = "support";
const FIGHTER_BROAD_CLASS_HEAVY = "heavy";
const FIGHTER_SQUADRON_MAX_SIZE_ATTRIBUTE = "fighterSquadronMaxSize";
const FIGHTER_SQUADRON_SIZE_ATTRIBUTE = "fighterSquadronSize";
const FIGHTER_CLASS_DEFINITIONS = Object.freeze([
  Object.freeze({
    classID: FIGHTER_CLASS_LIGHT,
    broadClassID: FIGHTER_BROAD_CLASS_LIGHT,
    fighterAttribute: "fighterSquadronIsLight",
    slotAttribute: "fighterLightSlots",
  }),
  Object.freeze({
    classID: FIGHTER_CLASS_SUPPORT,
    broadClassID: FIGHTER_BROAD_CLASS_SUPPORT,
    fighterAttribute: "fighterSquadronIsSupport",
    slotAttribute: "fighterSupportSlots",
  }),
  Object.freeze({
    classID: FIGHTER_CLASS_HEAVY,
    broadClassID: FIGHTER_BROAD_CLASS_HEAVY,
    fighterAttribute: "fighterSquadronIsHeavy",
    slotAttribute: "fighterHeavySlots",
  }),
  Object.freeze({
    classID: FIGHTER_CLASS_STANDUP_LIGHT,
    broadClassID: FIGHTER_BROAD_CLASS_LIGHT,
    fighterAttribute: "fighterSquadronIsStandupLight",
    slotAttribute: "fighterStandupLightSlots",
  }),
  Object.freeze({
    classID: FIGHTER_CLASS_STANDUP_SUPPORT,
    broadClassID: FIGHTER_BROAD_CLASS_SUPPORT,
    fighterAttribute: "fighterSquadronIsStandupSupport",
    slotAttribute: "fighterStandupSupportSlots",
  }),
  Object.freeze({
    classID: FIGHTER_CLASS_STANDUP_HEAVY,
    broadClassID: FIGHTER_BROAD_CLASS_HEAVY,
    fighterAttribute: "fighterSquadronIsStandupHeavy",
    slotAttribute: "fighterStandupHeavySlots",
  }),
]);
const FIGHTER_TUBE_COUNT_ATTRIBUTE = "fighterTubes";

let cachedPublishedTypesByID = null;
let cachedPublishedGroupSummaries = null;

function normalizeTypeRecord(record = {}) {
  return {
    ...record,
    typeID: Number(record.typeID) || 0,
    groupID: Number(record.groupID) || 0,
    categoryID: Number(record.categoryID) || 0,
    published: record.published !== false,
    groupName: String(record.groupName || "").trim(),
    name: String(record.name || "").trim(),
  };
}

function getPublishedTypesByID() {
  if (cachedPublishedTypesByID) {
    return cachedPublishedTypesByID;
  }

  const publishedTypesByID = new Map();
  for (const rawType of readStaticRows(TABLE.ITEM_TYPES)) {
    const typeRecord = normalizeTypeRecord(rawType);
    if (!typeRecord.published || typeRecord.typeID <= 0) {
      continue;
    }

    publishedTypesByID.set(typeRecord.typeID, typeRecord);
  }

  cachedPublishedTypesByID = publishedTypesByID;
  return cachedPublishedTypesByID;
}

function getPublishedTypeRecord(typeID) {
  const numericTypeID = Number(typeID) || 0;
  if (numericTypeID <= 0) {
    return null;
  }

  return getPublishedTypesByID().get(numericTypeID) || null;
}

function hasCategory(item, categoryID) {
  if (!item || typeof item !== "object") {
    return false;
  }

  const explicitCategoryID = Number(item.categoryID) || 0;
  if (explicitCategoryID > 0) {
    return explicitCategoryID === Number(categoryID);
  }

  const typeRecord = getPublishedTypeRecord(item.typeID);
  return Boolean(typeRecord && typeRecord.categoryID === Number(categoryID));
}

function isDroneTypeID(typeID) {
  const typeRecord = getPublishedTypeRecord(typeID);
  return Boolean(typeRecord && typeRecord.categoryID === DRONE_CATEGORY_ID);
}

function isFighterTypeID(typeID) {
  const typeRecord = getPublishedTypeRecord(typeID);
  return Boolean(typeRecord && typeRecord.categoryID === FIGHTER_CATEGORY_ID);
}

function isDroneItemRecord(item) {
  return hasCategory(item, DRONE_CATEGORY_ID);
}

function isFighterItemRecord(item) {
  return hasCategory(item, FIGHTER_CATEGORY_ID);
}

function isFighterTubeFlag(flagID) {
  const numericFlagID = Number(flagID) || 0;
  return FIGHTER_TUBE_FLAGS.includes(numericFlagID);
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(numeric));
}

function getFighterClassDefinitionForTypeID(typeID) {
  const numericTypeID = Number(typeID) || 0;
  if (numericTypeID <= 0) {
    return null;
  }

  return FIGHTER_CLASS_DEFINITIONS.find(
    (definition) =>
      Number(getTypeAttributeValue(numericTypeID, definition.fighterAttribute)) > 0,
  ) || null;
}

function getFighterClassForTypeID(typeID) {
  const definition = getFighterClassDefinitionForTypeID(typeID);
  return definition ? definition.classID : null;
}

function getFighterBroadClassForTypeID(typeID) {
  const definition = getFighterClassDefinitionForTypeID(typeID);
  return definition ? definition.broadClassID : null;
}

function getFighterTubeLimitForHostTypeID(hostTypeID) {
  return toPositiveInt(getTypeAttributeValue(hostTypeID, FIGHTER_TUBE_COUNT_ATTRIBUTE), 0);
}

function getFighterTubeOrdinal(flagID) {
  const index = FIGHTER_TUBE_FLAGS.indexOf(Number(flagID) || 0);
  return index >= 0 ? index + 1 : 0;
}

function getFighterSquadronSizeForTypeID(typeID) {
  const numericTypeID = Number(typeID) || 0;
  if (numericTypeID <= 0) {
    return 0;
  }

  const maxSize = toPositiveInt(
    getTypeAttributeValue(numericTypeID, FIGHTER_SQUADRON_MAX_SIZE_ATTRIBUTE),
    0,
  );
  if (maxSize > 0) {
    return maxSize;
  }

  return toPositiveInt(
    getTypeAttributeValue(numericTypeID, FIGHTER_SQUADRON_SIZE_ATTRIBUTE),
    0,
  );
}

function getFighterSlotLimitForClass(hostTypeID, fighterClassID) {
  const definition = FIGHTER_CLASS_DEFINITIONS.find(
    (candidate) => candidate.classID === fighterClassID,
  );
  if (!definition) {
    return 0;
  }

  return toPositiveInt(getTypeAttributeValue(hostTypeID, definition.slotAttribute), 0);
}

function countFighterTubeBroadClasses(occupiedTubeItems = []) {
  const counts = {
    [FIGHTER_BROAD_CLASS_LIGHT]: 0,
    [FIGHTER_BROAD_CLASS_SUPPORT]: 0,
    [FIGHTER_BROAD_CLASS_HEAVY]: 0,
  };

  for (const item of Array.isArray(occupiedTubeItems) ? occupiedTubeItems : []) {
    if (!isFighterItemRecord(item)) {
      continue;
    }

    const broadClassID = getFighterBroadClassForTypeID(item.typeID);
    if (!broadClassID) {
      continue;
    }

    counts[broadClassID] = (counts[broadClassID] || 0) + 1;
  }

  return counts;
}

function canLoadFighterTypeIntoHostTube(
  hostTypeID,
  fighterTypeID,
  tubeFlagID,
  occupiedTubeItems = [],
) {
  const tubeLimit = getFighterTubeLimitForHostTypeID(hostTypeID);
  const tubeOrdinal = getFighterTubeOrdinal(tubeFlagID);
  if (tubeLimit <= 0 || tubeOrdinal <= 0 || tubeOrdinal > tubeLimit) {
    return false;
  }

  const fighterClassID = getFighterClassForTypeID(fighterTypeID);
  const broadClassID = getFighterBroadClassForTypeID(fighterTypeID);
  if (!fighterClassID || !broadClassID) {
    return false;
  }

  const classLimit = getFighterSlotLimitForClass(hostTypeID, fighterClassID);
  if (classLimit <= 0) {
    return false;
  }

  const occupiedFighters = (Array.isArray(occupiedTubeItems) ? occupiedTubeItems : [])
    .filter((item) => item && isFighterItemRecord(item));
  if (occupiedFighters.length >= tubeLimit) {
    return false;
  }

  const broadClassCounts = countFighterTubeBroadClasses(occupiedFighters);
  return (broadClassCounts[broadClassID] || 0) < classLimit;
}

function buildInventorySquadronSize(item) {
  if (!item || typeof item !== "object") {
    return 0;
  }

  if (Number(item.singleton) === 1) {
    return 1;
  }

  return Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
}

function summarizePublishedTypesByCategory(categoryID) {
  if (!cachedPublishedGroupSummaries) {
    cachedPublishedGroupSummaries = new Map();
  }

  const numericCategoryID = Number(categoryID) || 0;
  if (cachedPublishedGroupSummaries.has(numericCategoryID)) {
    return cachedPublishedGroupSummaries.get(numericCategoryID);
  }

  const groupsByID = new Map();
  for (const typeRecord of getPublishedTypesByID().values()) {
    if (typeRecord.categoryID !== numericCategoryID) {
      continue;
    }

    const groupID = Number(typeRecord.groupID) || 0;
    if (!groupsByID.has(groupID)) {
      groupsByID.set(groupID, {
        groupID,
        groupName: typeRecord.groupName,
        count: 0,
      });
    }

    groupsByID.get(groupID).count += 1;
  }

  const summary = [...groupsByID.values()].sort(
    (left, right) => left.groupID - right.groupID,
  );
  cachedPublishedGroupSummaries.set(numericCategoryID, summary);
  return summary;
}

module.exports = {
  DRONE_CATEGORY_ID,
  FIGHTER_CATEGORY_ID,
  FIGHTER_BAY_FLAG: ITEM_FLAGS.FIGHTER_BAY,
  FIGHTER_TUBE_FLAGS,
  FIGHTER_CLASS_HEAVY,
  FIGHTER_CLASS_LIGHT,
  FIGHTER_CLASS_STANDUP_HEAVY,
  FIGHTER_CLASS_STANDUP_LIGHT,
  FIGHTER_CLASS_STANDUP_SUPPORT,
  FIGHTER_CLASS_SUPPORT,
  canLoadFighterTypeIntoHostTube,
  getPublishedTypeRecord,
  getFighterBroadClassForTypeID,
  getFighterClassForTypeID,
  getFighterSlotLimitForClass,
  getFighterSquadronSizeForTypeID,
  getFighterTubeLimitForHostTypeID,
  getFighterTubeOrdinal,
  isDroneItemRecord,
  isFighterItemRecord,
  isDroneTypeID,
  isFighterTypeID,
  isFighterTubeFlag,
  buildInventorySquadronSize,
  summarizePublishedTypesByCategory,
};
