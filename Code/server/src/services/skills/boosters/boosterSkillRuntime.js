const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../../_shared/referenceData"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skillState"));

const BOOSTER_GROUP_ID = 303;
const ATTRIBUTE_SKILL_LEVEL = 280;

let typeDogmaPayload = null;

function getTypeDogmaPayload() {
  if (!typeDogmaPayload) {
    typeDogmaPayload = readStaticTable(TABLE.TYPE_DOGMA) || {};
  }
  return typeDogmaPayload;
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

function getTypeDogmaEntry(typeID) {
  const payload = getTypeDogmaPayload();
  const typesByTypeID =
    payload && payload.typesByTypeID && typeof payload.typesByTypeID === "object"
      ? payload.typesByTypeID
      : {};
  return typesByTypeID[String(typeID)] || typesByTypeID[typeID] || null;
}

function getEffectTypeDogmaEntry(effectID) {
  const payload = getTypeDogmaPayload();
  const effectTypesByID =
    payload && payload.effectTypesByID && typeof payload.effectTypesByID === "object"
      ? payload.effectTypesByID
      : {};
  return effectTypesByID[String(effectID)] || effectTypesByID[effectID] || null;
}

function cloneAttributeMap(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([attributeID, value]) => [Number(attributeID), toFiniteNumber(value, NaN)])
      .filter(([attributeID, value]) => Number.isInteger(attributeID) && Number.isFinite(value)),
  );
}

function applyDogmaModifier(attributes, attributeID, operation, value) {
  const numericAttributeID = toInt(attributeID, 0);
  const numericOperation = toInt(operation, -1);
  const numericValue = toFiniteNumber(value, NaN);
  if (numericAttributeID <= 0 || numericOperation < 0 || !Number.isFinite(numericValue)) {
    return;
  }

  const currentValue = toFiniteNumber(attributes[numericAttributeID], NaN);
  switch (numericOperation) {
    case 0:
    case 4: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 1;
      attributes[numericAttributeID] = round6(baseValue * numericValue);
      break;
    }
    case 2: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(baseValue + numericValue);
      break;
    }
    case 3: {
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
    case 6: {
      const baseValue = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(baseValue * (1 + numericValue / 100));
      break;
    }
    case 7:
    case 8: {
      attributes[numericAttributeID] = round6(numericValue);
      break;
    }
    default:
      break;
  }
}

function getTypeEffects(typeEntry) {
  return Array.isArray(typeEntry && typeEntry.effects)
    ? typeEntry.effects.map((effectID) => getEffectTypeDogmaEntry(effectID)).filter(Boolean)
    : [];
}

function getSkillLevel(skill) {
  return Math.max(
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
}

function buildSkillEffectiveAttributes(skill) {
  const skillTypeID = toInt(skill && skill.typeID, 0);
  const typeEntry = getTypeDogmaEntry(skillTypeID);
  const attributes = cloneAttributeMap(typeEntry && typeEntry.attributes);
  attributes[ATTRIBUTE_SKILL_LEVEL] = getSkillLevel(skill);

  for (const effectEntry of getTypeEffects(typeEntry)) {
    if (String(effectEntry && effectEntry.name || "").toLowerCase() === "skilleffect") {
      continue;
    }
    for (const modifier of effectEntry.modifierInfo || []) {
      if (
        !modifier ||
        modifier.domain !== "itemID" ||
        modifier.func !== "ItemModifier" ||
        toInt(modifier.modifiedAttributeID, 0) === ATTRIBUTE_SKILL_LEVEL
      ) {
        continue;
      }
      applyDogmaModifier(
        attributes,
        modifier.modifiedAttributeID,
        modifier.operation,
        attributes[toInt(modifier.modifyingAttributeID, 0)],
      );
    }
  }

  return attributes;
}

function resolveCharacterID(characterOrID) {
  if (characterOrID && typeof characterOrID === "object") {
    return toInt(characterOrID.characterID ?? characterOrID.charID ?? characterOrID.charid, 0);
  }
  return toInt(characterOrID, 0);
}

function getCharacterBoosterSkillModifierEntries(characterOrID) {
  const characterID = resolveCharacterID(characterOrID);
  if (characterID <= 0) {
    return [];
  }

  const entries = [];
  for (const skill of getCachedCharacterSkillMap(characterID).values()) {
    const typeEntry = getTypeDogmaEntry(skill && skill.typeID);
    if (!typeEntry) {
      continue;
    }
    const skillAttributes = buildSkillEffectiveAttributes(skill);
    for (const effectEntry of getTypeEffects(typeEntry)) {
      for (const modifier of effectEntry.modifierInfo || []) {
        if (
          !modifier ||
          modifier.domain !== "charID" ||
          modifier.func !== "LocationGroupModifier" ||
          toInt(modifier.groupID, 0) !== BOOSTER_GROUP_ID
        ) {
          continue;
        }

        const sourceAttributeID = toInt(modifier.modifyingAttributeID, 0);
        const value = toFiniteNumber(skillAttributes[sourceAttributeID], NaN);
        if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
          continue;
        }

        entries.push({
          sourceSkillTypeID: toInt(skill.typeID, 0),
          modifiedAttributeID: toInt(modifier.modifiedAttributeID, 0),
          sourceAttributeID,
          operation: toInt(modifier.operation, 0),
          value,
        });
      }
    }
  }
  return entries;
}

function applyBoosterSkillModifiersToAttributes(attributes, characterOrID) {
  const output = cloneAttributeMap(attributes);
  for (const modifier of getCharacterBoosterSkillModifierEntries(characterOrID)) {
    applyDogmaModifier(
      output,
      modifier.modifiedAttributeID,
      modifier.operation,
      modifier.value,
    );
  }
  return output;
}

module.exports = {
  BOOSTER_GROUP_ID,
  applyBoosterSkillModifiersToAttributes,
  buildSkillEffectiveAttributes,
  getCharacterBoosterSkillModifierEntries,
};
