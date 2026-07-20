const path = require("path");

const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  consumeInventoryItemQuantity,
  findItemById,
  ITEM_FLAGS,
} = require(path.join(__dirname, "../../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../../skills/skillState"));
const {
  getAttributeIDByNames,
  getRequiredSkillRequirements,
  getTypeDogmaRecord,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));
const {
  EVENT_CLONE_IMPLANT_INSTALLATION,
  EVENT_CLONE_IMPLANT_REMOVAL,
} = require(path.join(__dirname, "../../station/jumpCloneRules"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  getActiveImplants,
} = require(path.join(__dirname, "./activeImplantModifiers"));

const IMPLANT_CATEGORY_ID = 20;
const ATTRIBUTE_IMPLANTNESS = getAttributeIDByNames("implantness") || 331;

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

function getImplantTypeInfo(typeID) {
  const numericTypeID = toInt(typeID, 0);
  const itemType = resolveItemByTypeID(numericTypeID);
  const dogmaRecord = getTypeDogmaRecord(numericTypeID);
  if (
    numericTypeID <= 0 ||
    !itemType ||
    Number(itemType.categoryID) !== IMPLANT_CATEGORY_ID ||
    !dogmaRecord ||
    !dogmaRecord.attributes
  ) {
    return null;
  }

  const implantness = toInt(
    getTypeAttribute(dogmaRecord.attributes, ATTRIBUTE_IMPLANTNESS, 0),
    0,
  );
  if (implantness <= 0) {
    return null;
  }

  return {
    typeID: numericTypeID,
    name: String(itemType.name || ""),
    groupID: toInt(itemType.groupID, 0),
    categoryID: IMPLANT_CATEGORY_ID,
    implantness,
    slot: implantness,
    attributes: dogmaRecord.attributes,
    effects: Array.isArray(dogmaRecord.effects)
      ? dogmaRecord.effects.map((effectID) => toInt(effectID, 0)).filter(Boolean)
      : [],
  };
}

function getSkillLevel(skillRecord) {
  return Math.max(
    0,
    Math.min(
      5,
      toInt(
        skillRecord && (
          skillRecord.effectiveSkillLevel ??
          skillRecord.trainedSkillLevel ??
          skillRecord.skillLevel
        ),
        0,
      ),
    ),
  );
}

function getMissingSkillRequirement(characterID, typeID) {
  const skillMap = getCachedCharacterSkillMap(characterID);
  for (const requirement of getRequiredSkillRequirements(typeID)) {
    const requiredLevel = Math.max(1, toInt(requirement.level, 1));
    const skillLevel = getSkillLevel(skillMap.get(toInt(requirement.skillTypeID, 0)));
    if (skillLevel < requiredLevel) {
      return {
        skillTypeID: toInt(requirement.skillTypeID, 0),
        requiredLevel,
        trainedLevel: skillLevel,
      };
    }
  }
  return null;
}

function getSessionNumber(session, ...keys) {
  for (const key of keys) {
    const value = toInt(session && session[key], 0);
    if (value > 0) {
      return value;
    }
  }
  return 0;
}

function getPilotLocationIDs(session) {
  const values = [
    getSessionNumber(session, "structureid", "structureID", "structureId"),
    getSessionNumber(session, "stationid", "stationID", "stationId"),
    getSessionNumber(session, "shipid", "shipID", "activeShipID"),
    getSessionNumber(session, "solarsystemid", "solarsystemid2", "solarSystemID"),
    getSessionNumber(session, "locationid", "locationID", "locationId"),
  ].filter((value) => value > 0);
  return new Set(values);
}

function isItemInPilotLocation(item, session) {
  if (!item || !session) {
    return false;
  }

  const pilotLocationIDs = getPilotLocationIDs(session);
  if (pilotLocationIDs.size <= 0) {
    return false;
  }

  const activeShipID = getSessionNumber(session, "shipid", "shipID", "activeShipID");
  const visited = new Set();
  let current = item;

  for (let depth = 0; depth < 8 && current; depth += 1) {
    const locationID = toInt(current.locationID, 0);
    if (locationID <= 0 || visited.has(locationID)) {
      return false;
    }

    if (pilotLocationIDs.has(locationID)) {
      return !(
        locationID === activeShipID &&
        toInt(current.flagID, 0) === ITEM_FLAGS.SHIP_HANGAR
      );
    }

    visited.add(locationID);
    current = findItemById(locationID);
  }

  return false;
}

function normalizeExistingImplants(characterRecord) {
  return Array.isArray(characterRecord && characterRecord.implants)
    ? characterRecord.implants
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({ ...entry }))
    : [];
}

function appendCloneEvent(record, eventTypeID, data = {}) {
  const entries = Array.isArray(record.cloneEventLog)
    ? record.cloneEventLog.map((entry) => ({ ...entry }))
    : [];
  entries.unshift({
    eventTypeID,
    created: String(currentFileTime()),
    ...data,
  });
  record.cloneEventLog = entries.slice(0, 100);
}

function buildImplantRecord(item, typeInfo, options = {}) {
  const installedAt = String(
    typeof options.nowFileTime === "bigint"
      ? options.nowFileTime
      : currentFileTime(),
  );
  return {
    implantID: toInt(item.itemID, 0),
    itemID: toInt(item.itemID, 0),
    typeID: typeInfo.typeID,
    implantTypeID: typeInfo.typeID,
    name: typeInfo.name,
    slot: typeInfo.slot,
    implantness: typeInfo.implantness,
    installedAt,
  };
}

function resolveImplantItemID(implant) {
  return toInt(
    implant && (
      implant.itemID ??
      implant.implantID ??
      implant.sourceItemID
    ),
    0,
  );
}

function validateImplantItem(characterID, itemID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const numericItemID = toInt(itemID, 0);
  if (numericCharacterID <= 0 || numericItemID <= 0) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }

  const characterRecord = getCharacterRecord(numericCharacterID);
  if (!characterRecord) {
    return { success: false, errorMsg: "CHARACTER_NOT_FOUND" };
  }

  const item = findItemById(numericItemID);
  if (!item) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }
  if (toInt(item.ownerID, 0) !== numericCharacterID) {
    return { success: false, errorMsg: "ITEM_NOT_OWNED" };
  }
  if (options.session && !isItemInPilotLocation(item, options.session)) {
    return { success: false, errorMsg: "ITEM_LOCATION_MISMATCH" };
  }

  const typeInfo = getImplantTypeInfo(item.typeID);
  if (!typeInfo) {
    return { success: false, errorMsg: "NOT_AN_IMPLANT" };
  }

  const occupiedSlot = getActiveImplants(characterRecord).find((implant) => (
    toInt(implant && implant.slot, 0) === typeInfo.slot
  ));
  if (occupiedSlot) {
    return { success: false, errorMsg: "IMPLANT_SLOT_OCCUPIED" };
  }

  const missingSkill = getMissingSkillRequirement(numericCharacterID, typeInfo.typeID);
  if (missingSkill) {
    return {
      success: false,
      errorMsg: "SKILL_REQUIRED",
      missingSkill,
    };
  }

  return {
    success: true,
    characterRecord,
    item,
    typeInfo,
  };
}

function findActiveImplantByItemID(characterID, itemID) {
  const numericCharacterID = toInt(characterID, 0);
  const numericItemID = toInt(itemID, 0);
  if (numericCharacterID <= 0 || numericItemID <= 0) {
    return {
      success: false,
      errorMsg: "IMPLANT_NOT_FOUND",
    };
  }

  const characterRecord = getCharacterRecord(numericCharacterID);
  if (!characterRecord) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const implant = normalizeExistingImplants(characterRecord).find((entry) => (
    resolveImplantItemID(entry) === numericItemID
  ));
  if (!implant) {
    return {
      success: false,
      errorMsg: "IMPLANT_NOT_FOUND",
    };
  }

  return {
    success: true,
    characterRecord,
    implant,
  };
}

function installImplantItem(characterID, itemID, options = {}) {
  const validation = validateImplantItem(characterID, itemID, options);
  if (!validation.success) {
    return validation;
  }

  const nowFileTime =
    typeof options.nowFileTime === "bigint" ? options.nowFileTime : currentFileTime();
  const implantRecord = buildImplantRecord(validation.item, validation.typeInfo, {
    nowFileTime,
  });

  const consumeResult = consumeInventoryItemQuantity(validation.item.itemID, 1, {
    removeContents: true,
  });
  if (!consumeResult.success) {
    return consumeResult;
  }

  const updateResult = updateCharacterRecord(characterID, (record) => {
    const implants = normalizeExistingImplants(record);
    record.implants = [...implants, implantRecord]
      .sort((left, right) => toInt(left.slot, 0) - toInt(right.slot, 0));
    appendCloneEvent(record, EVENT_CLONE_IMPLANT_INSTALLATION, {
      typeID: implantRecord.typeID,
      itemID: implantRecord.itemID,
      slot: implantRecord.slot,
    });
    return record;
  });
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      implant: implantRecord,
      inventoryChanges:
        consumeResult.data && Array.isArray(consumeResult.data.changes)
          ? consumeResult.data.changes
          : [],
    },
  };
}

function destroyImplantItem(characterID, itemID) {
  const validation = findActiveImplantByItemID(characterID, itemID);
  if (!validation.success) {
    return validation;
  }

  const numericItemID = toInt(itemID, 0);
  let removedImplant = null;
  const updateResult = updateCharacterRecord(characterID, (record) => {
    const nextImplants = [];
    for (const implant of normalizeExistingImplants(record)) {
      if (resolveImplantItemID(implant) === numericItemID && !removedImplant) {
        removedImplant = implant;
        continue;
      }
      nextImplants.push(implant);
    }
    record.implants = nextImplants;
    if (removedImplant) {
      appendCloneEvent(record, EVENT_CLONE_IMPLANT_REMOVAL, {
        typeID: toInt(removedImplant.typeID ?? removedImplant.implantTypeID, 0),
        itemID: numericItemID,
        slot: toInt(
          removedImplant.slot ??
            removedImplant.implantness ??
            removedImplant.implantSlot,
          0,
        ),
      });
    }
    return record;
  });
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      implant: removedImplant || validation.implant,
    },
  };
}

module.exports = {
  ATTRIBUTE_IMPLANTNESS,
  IMPLANT_CATEGORY_ID,
  destroyImplantItem,
  getImplantTypeInfo,
  installImplantItem,
  isItemInPilotLocation,
  validateImplantItem,
};
