const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../../_shared/referenceData"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildFiletimeLong,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  consumeInventoryItemQuantity,
  findItemById,
} = require(path.join(__dirname, "../../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  getAttributeIDByNames,
  getTypeDogmaRecord,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));
const {
  applyBoosterSkillModifiersToAttributes,
} = require(path.join(__dirname, "./boosterSkillRuntime"));
const {
  applyActiveImplantLocationModifiersToAttributes,
} = require(path.join(__dirname, "../../dogma/implants/activeImplantModifiers"));

const BOOSTER_GROUP_ID = 303;
const BOOSTER_CATEGORY_ID = 20;
const WINDOWS_EPOCH_OFFSET = 116444736000000000n;

const ATTRIBUTE_BOOSTER_DURATION =
  getAttributeIDByNames("boosterDuration") || 330;
const ATTRIBUTE_BOOSTERNESS =
  getAttributeIDByNames("boosterness") || 1087;
const ATTRIBUTE_LAST_INJECTION =
  getAttributeIDByNames("boosterLastInjectionDatetime") || 2422;
const ATTRIBUTE_MAX_CHAR_AGE_HOURS =
  getAttributeIDByNames("boosterMaxCharAgeHours") || 1647;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number.parseInt(String(value), 10);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getTypeAttribute(attributes, attributeID, fallback = null) {
  if (!attributes || typeof attributes !== "object") {
    return fallback;
  }
  if (Object.prototype.hasOwnProperty.call(attributes, String(attributeID))) {
    return attributes[String(attributeID)];
  }
  if (Object.prototype.hasOwnProperty.call(attributes, attributeID)) {
    return attributes[attributeID];
  }
  return fallback;
}

function msToFileTime(ms = Date.now()) {
  return BigInt(Math.trunc(toNumber(ms, Date.now()))) * 10000n + WINDOWS_EPOCH_OFFSET;
}

function fileTimeToMs(value) {
  const fileTime = normalizeFileTime(value, 0n);
  if (fileTime <= 0n) {
    return null;
  }
  const ms = Number((fileTime - WINDOWS_EPOCH_OFFSET) / 10000n);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeFileTime(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
    if (value && typeof value === "object" && value.type === "long") {
      return normalizeFileTime(value.value, fallback);
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function getDogmaRoot() {
  return readStaticTable(TABLE.TYPE_DOGMA) || {};
}

function getEffectType(effectID) {
  const root = getDogmaRoot();
  return root.effectTypesByID && root.effectTypesByID[String(effectID)]
    ? root.effectTypesByID[String(effectID)]
    : null;
}

function isBoosterType(typeID) {
  const itemType = resolveItemByTypeID(typeID);
  if (!itemType) {
    return false;
  }
  return (
    Number(itemType.groupID) === BOOSTER_GROUP_ID ||
    Number(itemType.categoryID) === BOOSTER_CATEGORY_ID
  );
}

function normalizeChance(value) {
  const numeric = toNumber(value, 0);
  if (numeric <= 0) {
    return 0;
  }
  if (numeric > 1 && numeric <= 100) {
    return Math.min(1, numeric / 100);
  }
  return Math.min(1, numeric);
}

function getRandomFraction(options = {}) {
  const random = typeof options.random === "function"
    ? Number(options.random())
    : Math.random();
  return Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0;
}

function getBoosterTypeInfo(typeID) {
  const numericTypeID = toInt(typeID, 0);
  const record = getTypeDogmaRecord(numericTypeID);
  if (numericTypeID <= 0 || !record || !record.attributes) {
    return null;
  }

  const attributes = record.attributes;
  const durationMs = toInt(
    getTypeAttribute(attributes, ATTRIBUTE_BOOSTER_DURATION, 0),
    0,
  );
  const boosterness = toInt(
    getTypeAttribute(attributes, ATTRIBUTE_BOOSTERNESS, 0),
    0,
  );
  const maxCharAgeHours = toNumber(
    getTypeAttribute(attributes, ATTRIBUTE_MAX_CHAR_AGE_HOURS, 0),
    0,
  );

  if (!isBoosterType(numericTypeID) || (durationMs <= 0 && maxCharAgeHours <= 0)) {
    return null;
  }

  return {
    typeID: numericTypeID,
    durationMs,
    boosterness,
    maxCharAgeHours,
    lastInjectionLimitMs: parseLimitDate(
      getTypeAttribute(attributes, ATTRIBUTE_LAST_INJECTION, null),
    ),
    attributes,
    effects: Array.isArray(record.effects) ? record.effects.map((effectID) => toInt(effectID, 0)).filter(Boolean) : [],
  };
}

function getBoosterSideEffectIDs(typeInfo, options = {}) {
  if (!typeInfo || !Array.isArray(typeInfo.effects)) {
    return [];
  }

  const sideEffectIDs = [];
  for (const effectID of typeInfo.effects) {
    const effect = getEffectType(effectID);
    const chanceAttributeID = toInt(effect && effect.fittingUsageChanceAttributeID, 0);
    if (chanceAttributeID <= 0) {
      continue;
    }

    const chance = normalizeChance(getTypeAttribute(
      options.effectiveAttributes || typeInfo.attributes,
      chanceAttributeID,
      0,
    ));
    if (chance <= 0) {
      continue;
    }

    if (getRandomFraction(options) < chance) {
      sideEffectIDs.push(effectID);
    }
  }
  return sideEffectIDs;
}

function parseLimitDate(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (value && typeof value === "object" && value.type === "long") {
    return parseLimitDate(value.value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    if (value > 100000000000000) {
      return fileTimeToMs(value);
    }
    if (value > 1000000000000) {
      return Math.trunc(value);
    }
    if (value > 1000 && value < 1000000) {
      return Math.trunc(value * 86400000);
    }
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return parseLimitDate(Number(trimmed));
  }

  const dotDate = trimmed.match(
    /^(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dotDate) {
    return Date.UTC(
      Number(dotDate[1]),
      Number(dotDate[2]) - 1,
      Number(dotDate[3]),
      Number(dotDate[4] || 0),
      Number(dotDate[5] || 0),
      Number(dotDate[6] || 0),
    );
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getCharacterCreatedAtMs(characterRecord) {
  if (!characterRecord || typeof characterRecord !== "object") {
    return null;
  }
  return (
    fileTimeToMs(characterRecord.createDateTime) ??
    fileTimeToMs(characterRecord.startDateTime) ??
    parseLimitDate(characterRecord.createdAt) ??
    parseLimitDate(characterRecord.createdDate)
  );
}

function getBoosterAgeLimitRemainingMs(typeInfo, characterRecord, nowMs) {
  const maxCharAgeHours = toNumber(typeInfo && typeInfo.maxCharAgeHours, 0);
  if (maxCharAgeHours <= 0) {
    return null;
  }
  const createdAtMs = getCharacterCreatedAtMs(characterRecord);
  if (createdAtMs === null) {
    return null;
  }
  return Math.max(0, Math.trunc(
    createdAtMs + maxCharAgeHours * 60 * 60 * 1000 - nowMs,
  ));
}

function resolveBoosterDurationMs(typeInfo, characterRecord, nowMs, effectiveAttributes = null) {
  if (!typeInfo) {
    return 0;
  }
  const baseDurationMs = Math.max(
    0,
    toInt(
      getTypeAttribute(
        effectiveAttributes || typeInfo.attributes,
        ATTRIBUTE_BOOSTER_DURATION,
        typeInfo.durationMs,
      ),
      typeInfo.durationMs,
    ),
  );
  const remainingAgeMs = getBoosterAgeLimitRemainingMs(typeInfo, characterRecord, nowMs);
  if (remainingAgeMs === null) {
    return baseDurationMs;
  }
  if (baseDurationMs <= 0) {
    return remainingAgeMs;
  }
  return Math.min(baseDurationMs, remainingAgeMs);
}

function normalizeBoosterRecord(record, options = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const boosterTypeID = toInt(record.boosterTypeID ?? record.typeID, 0);
  const typeInfo = getBoosterTypeInfo(boosterTypeID);
  if (!typeInfo) {
    return null;
  }

  const nowFileTime = normalizeFileTime(options.nowFileTime, msToFileTime());
  const expiryTime = normalizeFileTime(record.expiryTime, 0n);
  if (expiryTime <= nowFileTime) {
    return null;
  }

  const boosterID = toInt(record.boosterID ?? record.itemID ?? record.sourceItemID, boosterTypeID);
  return {
    boosterID,
    itemID: boosterID,
    typeID: boosterTypeID,
    boosterTypeID,
    boosterness: toInt(record.boosterness ?? record.slot, typeInfo.boosterness),
    slot: toInt(record.slot ?? record.boosterness, typeInfo.boosterness),
    boosterDuration: toInt(record.boosterDuration, typeInfo.durationMs),
    startTime: String(normalizeFileTime(record.startTime, expiryTime - BigInt(typeInfo.durationMs) * 10000n)),
    expiryTime: String(expiryTime),
    sideEffectIDs: Array.isArray(record.sideEffectIDs)
      ? record.sideEffectIDs.map((effectID) => toInt(effectID, 0)).filter(Boolean)
      : [],
  };
}

function normalizeActiveBoosters(boosters, options = {}) {
  const active = [];
  for (const record of Array.isArray(boosters) ? boosters : []) {
    const normalized = normalizeBoosterRecord(record, options);
    if (normalized) {
      active.push(normalized);
    }
  }
  return active.sort((left, right) => {
    const leftSlot = toInt(left.boosterness, 0);
    const rightSlot = toInt(right.boosterness, 0);
    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }
    return toInt(left.boosterTypeID, 0) - toInt(right.boosterTypeID, 0);
  });
}

function getActiveBoostersForCharacter(characterID, options = {}) {
  const charData = getCharacterRecord(characterID);
  if (!charData) {
    return [];
  }
  return normalizeActiveBoosters(charData.boosters, options);
}

function buildBoosterPayload(record) {
  return buildKeyVal([
    ["boosterID", Number(record.boosterID)],
    ["itemID", Number(record.itemID)],
    ["typeID", Number(record.typeID)],
    ["boosterTypeID", Number(record.boosterTypeID)],
    ["boosterness", Number(record.boosterness)],
    ["slot", Number(record.slot)],
    ["boosterDuration", Number(record.boosterDuration)],
    ["startTime", buildFiletimeLong(record.startTime)],
    ["expiryTime", buildFiletimeLong(record.expiryTime)],
    ["sideEffectIDs", buildList(record.sideEffectIDs || [])],
  ]);
}

function buildCharacterBoostersDict(characterID, options = {}) {
  const boosters = getActiveBoostersForCharacter(characterID, options);
  return buildDict(
    boosters.map((record) => [
      Number(record.boosterTypeID),
      buildBoosterPayload(record),
    ]),
  );
}

function validateBoosterItem(characterID, itemID, locationID = null, options = {}) {
  const item = findItemById(itemID);
  if (!item) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }
  if (Number(item.ownerID) !== Number(characterID)) {
    return { success: false, errorMsg: "ITEM_NOT_OWNED" };
  }
  if (
    locationID !== null &&
    locationID !== undefined &&
    Number(locationID) > 0 &&
    Number(item.locationID) !== Number(locationID)
  ) {
    return { success: false, errorMsg: "ITEM_LOCATION_MISMATCH" };
  }

  const typeInfo = getBoosterTypeInfo(item.typeID);
  if (!typeInfo) {
    return { success: false, errorMsg: "NOT_A_CONSUMABLE_BOOSTER" };
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  if (typeInfo.lastInjectionLimitMs !== null && nowMs > typeInfo.lastInjectionLimitMs) {
    return { success: false, errorMsg: "BOOSTER_EXPIRED" };
  }

  const maxCharAgeHours = toNumber(typeInfo.maxCharAgeHours, 0);
  let characterRecord = null;
  if (maxCharAgeHours > 0) {
    characterRecord = getCharacterRecord(characterID);
    const createdAtMs = getCharacterCreatedAtMs(characterRecord);
    if (createdAtMs === null) {
      return { success: false, errorMsg: "BOOSTER_CHARACTER_AGE_UNKNOWN" };
    }
    if (nowMs - createdAtMs >= maxCharAgeHours * 60 * 60 * 1000) {
      return { success: false, errorMsg: "BOOSTER_CHARACTER_TOO_OLD" };
    }
  }

  return {
    success: true,
    item,
    typeInfo,
    characterRecord,
  };
}

function useBoosterItem(characterID, itemID, locationID = null, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const numericItemID = toInt(itemID, 0);
  if (numericCharacterID <= 0 || numericItemID <= 0) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const validation = validateBoosterItem(numericCharacterID, numericItemID, locationID, {
    nowMs,
  });
  if (!validation.success) {
    return validation;
  }

  const nowFileTime = msToFileTime(nowMs);
  const skillModifiedAttributes = applyBoosterSkillModifiersToAttributes(
    validation.typeInfo.attributes,
    numericCharacterID,
  );
  const effectiveAttributes = applyActiveImplantLocationModifiersToAttributes(
    skillModifiedAttributes,
    {
      typeID: validation.typeInfo.typeID,
      groupID: BOOSTER_GROUP_ID,
    },
    numericCharacterID,
    { includeBoosters: false },
  );
  const boosterDurationMs = resolveBoosterDurationMs(
    validation.typeInfo,
    validation.characterRecord || getCharacterRecord(numericCharacterID),
    nowMs,
    effectiveAttributes,
  );
  if (boosterDurationMs <= 0) {
    return { success: false, errorMsg: "NOT_A_CONSUMABLE_BOOSTER" };
  }
  const existingBoosters = getActiveBoostersForCharacter(numericCharacterID, { nowFileTime });
  const occupiedSlot = existingBoosters.find((record) => (
    validation.typeInfo.boosterness > 0 &&
    Number(record.boosterness) === Number(validation.typeInfo.boosterness)
  ));
  if (occupiedSlot) {
    return {
      success: false,
      errorMsg: "BOOSTER_SLOT_OCCUPIED",
    };
  }

  const consumeResult = consumeInventoryItemQuantity(numericItemID, 1, {
    removeContents: true,
  });
  if (!consumeResult.success) {
    return consumeResult;
  }

  const record = {
    boosterID: numericItemID,
    itemID: numericItemID,
    typeID: validation.typeInfo.typeID,
    boosterTypeID: validation.typeInfo.typeID,
    boosterness: validation.typeInfo.boosterness,
    slot: validation.typeInfo.boosterness,
    boosterDuration: boosterDurationMs,
    startTime: String(nowFileTime),
    expiryTime: String(nowFileTime + BigInt(boosterDurationMs) * 10000n),
    sideEffectIDs: getBoosterSideEffectIDs(validation.typeInfo, {
      ...options,
      effectiveAttributes,
    }),
  };

  const updateResult = updateCharacterRecord(numericCharacterID, (charData) => {
    const active = normalizeActiveBoosters(charData.boosters, { nowFileTime });
    charData.boosters = [...active, record];
    return charData;
  });
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      booster: record,
      inventoryChanges: (
        consumeResult.data && Array.isArray(consumeResult.data.changes)
          ? consumeResult.data.changes
          : []
      ),
    },
  };
}

module.exports = {
  BOOSTER_CATEGORY_ID,
  BOOSTER_GROUP_ID,
  buildCharacterBoostersDict,
  buildBoosterPayload,
  getActiveBoostersForCharacter,
  getBoosterTypeInfo,
  normalizeActiveBoosters,
  useBoosterItem,
};
