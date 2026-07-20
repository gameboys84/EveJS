const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../../_shared/referenceData"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  BOOSTER_GROUP_ID,
  applyBoosterSkillModifiersToAttributes,
} = require(path.join(__dirname, "../../skills/boosters/boosterSkillRuntime"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  applyClientTrainingSpeedScale,
} = require(path.join(__dirname, "../../skills/training/skillTrainingSpeed"));

const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;
const ATTRIBUTE_IMPLANT_SLOT = 331;
const ATTRIBUTE_BOOSTER_SLOT = 1087;
const REQUIRED_SKILL_ATTRIBUTE_IDS = Object.freeze([182, 183, 184, 1285, 1289, 1290]);
const DOGMA_OP_MOD_ADD = 2;
const DOGMA_OP_PRE_ASSIGNMENT = -1;
const DOGMA_OP_PRE_MUL = 0;
const DOGMA_OP_MOD_SUB = 3;
const DOGMA_OP_POST_MUL = 4;
const DOGMA_OP_POST_PERCENT = 6;
const DOGMA_OP_POST_ASSIGNMENT = 7;
const DOGMA_OP_POST_PERCENT_UNNERFED = 8;
const LOCATION_MODIFIER_FUNCS = new Set([
  "LocationModifier",
  "LocationGroupModifier",
  "LocationRequiredSkillModifier",
  "OwnerRequiredSkillModifier",
]);
const DIRECT_MODIFIER_FUNC = "ItemModifier";
const IMPLANT_MODIFIER_TYPE_BY_FUNC = Object.freeze({
  ItemModifier: "M",
  LocationModifier: "L",
  LocationGroupModifier: "LG",
  LocationRequiredSkillModifier: "LRS",
  OwnerRequiredSkillModifier: "ORS",
});

const CHARACTER_PRIMARY_ATTRIBUTE_IDS = Object.freeze([
  ATTRIBUTE_CHARISMA,
  ATTRIBUTE_INTELLIGENCE,
  ATTRIBUTE_MEMORY,
  ATTRIBUTE_PERCEPTION,
  ATTRIBUTE_WILLPOWER,
]);

let characterStateModule = null;
let typeDogmaPayload = null;

function getCharacterStateModule() {
  if (!characterStateModule) {
    characterStateModule = require(path.join(__dirname, "../../character/characterState"));
  }
  return characterStateModule;
}

function getTypeDogmaPayload() {
  if (!typeDogmaPayload) {
    typeDogmaPayload = readStaticTable(TABLE.TYPE_DOGMA);
  }
  return typeDogmaPayload || {};
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toBigInt(value, fallback = 0n) {
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
      return toBigInt(value.value, fallback);
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function cloneAttributeMap(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([attributeID, value]) => [
        toInt(attributeID, 0),
        toFiniteNumber(value, NaN),
      ])
      .filter(([attributeID, value]) => attributeID > 0 && Number.isFinite(value)),
  );
}

function getTypeMetadata(typeID) {
  return resolveItemByTypeID(toInt(typeID, 0)) || null;
}

function typeRequiresSkillType(typeEntry, skillTypeID) {
  const numericSkillTypeID = toInt(skillTypeID, 0);
  if (!typeEntry || numericSkillTypeID <= 0) {
    return false;
  }

  const attributes = typeEntry.attributes || {};
  return REQUIRED_SKILL_ATTRIBUTE_IDS.some((attributeID) =>
    toInt(attributes[String(attributeID)] ?? attributes[attributeID], 0) === numericSkillTypeID,
  );
}

function targetMatchesLocationModifier(target, modifierInfo, options = {}) {
  if (!target || !modifierInfo) {
    return false;
  }

  const allowedDomains = options.allowedDomains instanceof Set
    ? options.allowedDomains
    : new Set(["shipID", "charID"]);
  const domain = String(modifierInfo.domain || "");
  const func = String(modifierInfo.func || "");
  if (
    !allowedDomains.has(domain) ||
    (
      func !== "LocationRequiredSkillModifier" &&
      func !== "LocationGroupModifier" &&
      func !== "LocationModifier" &&
      func !== "OwnerRequiredSkillModifier"
    )
  ) {
    return false;
  }

  const requiredSkillTypeID = toInt(modifierInfo.skillTypeID, 0);
  if (
    requiredSkillTypeID > 0 &&
    !typeRequiresSkillType(target.typeEntry, requiredSkillTypeID)
  ) {
    return false;
  }

  const groupID = toInt(modifierInfo.groupID, 0);
  if (groupID > 0 && toInt(target.groupID, 0) !== groupID) {
    return false;
  }

  return true;
}

function appendLocationModifierEntriesForTarget(
  destination,
  sourceAttributes,
  sourceEffects,
  sourceKind,
  target,
  options = {},
) {
  for (const effectRecord of Array.isArray(sourceEffects) ? sourceEffects : []) {
    for (const modifierInfo of effectRecord.modifierInfo || []) {
      if (!targetMatchesLocationModifier(target, modifierInfo, options)) {
        continue;
      }

      const sourceAttributeID = toInt(modifierInfo.modifyingAttributeID, 0);
      const value = toFiniteNumber(
        sourceAttributes && (
          sourceAttributes[String(sourceAttributeID)] ??
          sourceAttributes[sourceAttributeID]
        ),
        NaN,
      );
      if (!Number.isFinite(value)) {
        continue;
      }

      destination.push({
        sourceKind,
        modifiedAttributeID: toInt(modifierInfo.modifiedAttributeID, 0),
        operation: toInt(modifierInfo.operation, 0),
        value,
        stackingPenalized: false,
      });
    }
  }
}

function applyDogmaModifierGroups(attributes, modifierEntries = []) {
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
    groups.get(key).push({ ...modifierEntry, value, operation });
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
        case DOGMA_OP_PRE_ASSIGNMENT:
        case DOGMA_OP_POST_ASSIGNMENT: {
          const lastEntry = entries[entries.length - 1] || null;
          if (lastEntry) {
            attributes[attributeID] = round6(lastEntry.value);
          }
          break;
        }
        case DOGMA_OP_PRE_MUL:
        case DOGMA_OP_POST_MUL: {
          const base = Number.isFinite(currentValue) ? currentValue : 1;
          const factor = entries.reduce(
            (product, entry) => product * toFiniteNumber(entry.value, 1),
            1,
          );
          attributes[attributeID] = round6(base * factor);
          break;
        }
        case DOGMA_OP_MOD_ADD: {
          const base = Number.isFinite(currentValue) ? currentValue : 0;
          attributes[attributeID] = round6(
            base + entries.reduce((sum, entry) => sum + toFiniteNumber(entry.value, 0), 0),
          );
          break;
        }
        case DOGMA_OP_MOD_SUB: {
          const base = Number.isFinite(currentValue) ? currentValue : 0;
          attributes[attributeID] = round6(
            base - entries.reduce((sum, entry) => sum + toFiniteNumber(entry.value, 0), 0),
          );
          break;
        }
        case DOGMA_OP_POST_PERCENT:
        case DOGMA_OP_POST_PERCENT_UNNERFED: {
          const base = Number.isFinite(currentValue) ? currentValue : 0;
          const factor = entries.reduce(
            (product, entry) => product * (1 + (toFiniteNumber(entry.value, 0) / 100)),
            1,
          );
          attributes[attributeID] = round6(base * factor);
          break;
        }
        case 5: {
          const base = Number.isFinite(currentValue) ? currentValue : 1;
          const factor = entries.reduce((product, entry) => {
            const divisor = toFiniteNumber(entry.value, NaN);
            return Number.isFinite(divisor) && Math.abs(divisor) > 1e-9
              ? product / divisor
              : product;
          }, 1);
          attributes[attributeID] = round6(base * factor);
          break;
        }
        default:
          break;
      }
    }
  }

  return attributes;
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

function getAttributeDefaultValue(attributeID) {
  const payload = getTypeDogmaPayload();
  const attributeTypesByID =
    payload && payload.attributeTypesByID && typeof payload.attributeTypesByID === "object"
      ? payload.attributeTypesByID
      : {};
  const attributeRecord =
    attributeTypesByID[String(attributeID)] || attributeTypesByID[attributeID] || null;
  return toFiniteNumber(attributeRecord && attributeRecord.defaultValue, 0);
}

function getTypeEntryAttributeValue(typeEntry, attributeID) {
  return getAttributeMapValue(typeEntry && typeEntry.attributes, attributeID);
}

function getAttributeMapValue(attributes, attributeID) {
  const numericAttributeID = toInt(attributeID, 0);
  if (!attributes || typeof attributes !== "object" || numericAttributeID <= 0) {
    return getAttributeDefaultValue(numericAttributeID);
  }
  return toFiniteNumber(
    attributes[String(numericAttributeID)] ??
      attributes[numericAttributeID],
    getAttributeDefaultValue(numericAttributeID),
  );
}

function getEffectRecordsForTypeEntry(typeEntry) {
  if (!typeEntry || !Array.isArray(typeEntry.effects)) {
    return [];
  }
  return typeEntry.effects
    .map((effectID) => getEffectTypeDogmaEntry(effectID))
    .filter((effectEntry) => effectEntry && Array.isArray(effectEntry.modifierInfo));
}

function getEffectRecordsForBooster(booster, typeEntry) {
  const sideEffectIDs = new Set(
    (Array.isArray(booster && booster.sideEffectIDs)
      ? booster.sideEffectIDs
      : []
    ).map((effectID) => toInt(effectID, 0)).filter(Boolean),
  );

  return getEffectRecordsForTypeEntry(typeEntry).filter((effectEntry) => {
    const chanceAttributeID = toInt(
      effectEntry && effectEntry.fittingUsageChanceAttributeID,
      0,
    );
    return chanceAttributeID <= 0 || sideEffectIDs.has(toInt(effectEntry.effectID, 0));
  });
}

function getEffectiveBoosterSourceAttributes(booster, characterOrID, typeEntry = null) {
  const resolvedTypeEntry = typeEntry || booster.typeEntry || getTypeDogmaEntry(booster.typeID);
  const skillAttributes = applyBoosterSkillModifiersToAttributes(
    resolvedTypeEntry && resolvedTypeEntry.attributes,
    characterOrID,
  );
  return applyActiveImplantLocationModifiersToAttributes(
    skillAttributes,
    {
      typeID: booster.typeID,
      groupID: BOOSTER_GROUP_ID,
    },
    characterOrID,
    { includeBoosters: false },
  );
}

function resolveCharacterRecord(characterOrID) {
  if (characterOrID && typeof characterOrID === "object") {
    return characterOrID;
  }
  const characterID = toInt(characterOrID, 0);
  if (characterID <= 0) {
    return null;
  }
  const { getCharacterRecord } = getCharacterStateModule();
  return getCharacterRecord(characterID) || null;
}

function resolveImplantTypeID(implant) {
  return toInt(
    implant && (
      implant.typeID ??
      implant.implantTypeID ??
      implant.itemTypeID
    ),
    0,
  );
}

function resolveImplantSlot(implant, typeEntry = null) {
  return toInt(
    implant && (
      implant.slot ??
      implant.implantSlot ??
      implant.implantness
    ),
    toInt(
      typeEntry &&
        typeEntry.attributes &&
        (typeEntry.attributes[String(ATTRIBUTE_IMPLANT_SLOT)] ??
          typeEntry.attributes[ATTRIBUTE_IMPLANT_SLOT]),
      0,
    ),
  );
}

function resolveBoosterTypeID(booster) {
  return toInt(
    booster && (
      booster.boosterTypeID ??
      booster.typeID ??
      booster.itemTypeID
    ),
    0,
  );
}

function resolveBoosterID(booster) {
  return toInt(
    booster && (
      booster.boosterID ??
      booster.itemID ??
      booster.sourceItemID
    ),
    0,
  );
}

function resolveBoosterSlot(booster, typeEntry = null) {
  return toInt(
    booster && (
      booster.slot ??
      booster.boosterness
    ),
    toInt(
      typeEntry &&
        typeEntry.attributes &&
        (
          typeEntry.attributes[String(ATTRIBUTE_BOOSTER_SLOT)] ??
          typeEntry.attributes[ATTRIBUTE_BOOSTER_SLOT]
        ),
      0,
    ),
  );
}

function normalizeBrainDomain(domain) {
  switch (String(domain || "")) {
    case "charID":
      return "character";
    case "shipID":
      return "ship";
    case "structureID":
      return "structure";
    default:
      return null;
  }
}

function buildModifierExtras(modifierInfo) {
  const func = String(modifierInfo && modifierInfo.func || "");
  if (func === "LocationGroupModifier") {
    const groupID = toInt(modifierInfo && modifierInfo.groupID, 0);
    return groupID > 0 ? [groupID] : null;
  }
  if (
    func === "LocationRequiredSkillModifier" ||
    func === "OwnerRequiredSkillModifier"
  ) {
    const skillTypeID = toInt(modifierInfo && modifierInfo.skillTypeID, 0);
    return skillTypeID > 0 ? [skillTypeID] : null;
  }
  if (func === "ItemModifier" || func === "LocationModifier") {
    return [];
  }
  return null;
}

function appendDogmaModifierEntries(entries, source, options = {}) {
  const allowedDomains = options.allowedDomains instanceof Set
    ? options.allowedDomains
    : null;
  const allowedFuncs = options.allowedFuncs instanceof Set
    ? options.allowedFuncs
    : null;
  const typeEntry = source.typeEntry || getTypeDogmaEntry(source.typeID);
  const sourceAttributes = source.sourceAttributes || (typeEntry && typeEntry.attributes);
  const sourceEffects = Array.isArray(source.sourceEffects)
    ? source.sourceEffects
    : getEffectRecordsForTypeEntry(typeEntry);

  if (!typeEntry || !typeEntry.attributes || source.typeID <= 0) {
    return;
  }

  for (const effectEntry of sourceEffects) {
    for (const modifier of effectEntry.modifierInfo || []) {
      if (!modifier) {
        continue;
      }

      const domain = String(modifier.domain || "");
      const func = String(modifier.func || "");
      if (
        (allowedDomains && !allowedDomains.has(domain)) ||
        (allowedFuncs && !allowedFuncs.has(func))
      ) {
        continue;
      }

      const modifierType = IMPLANT_MODIFIER_TYPE_BY_FUNC[func] || null;
      const normalizedDomain = normalizeBrainDomain(domain);
      const sourceAttributeID = toInt(modifier.modifyingAttributeID, 0);
      const targetAttributeID = toInt(modifier.modifiedAttributeID, 0);
      const operation = toInt(modifier.operation, 0);
      const extras = buildModifierExtras(modifier);
      if (
        !modifierType ||
        !normalizedDomain ||
        sourceAttributeID <= 0 ||
        targetAttributeID <= 0 ||
        extras === null
      ) {
        continue;
      }

      const value = getAttributeMapValue(sourceAttributes, sourceAttributeID);
      if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
        continue;
      }

      entries.push({
        sourceKind: source.sourceKind,
        sourceTypeID: source.typeID,
        skillTypeID: source.typeID,
        requiredSkillTypeID: toInt(modifier.skillTypeID, 0),
        groupID: toInt(modifier.groupID, 0),
        sourceAttributeID,
        targetAttributeID,
        modifiedAttributeID: targetAttributeID,
        operation,
        value,
        implantSlot: source.sourceKind === "implant" ? source.slot : 0,
        boosterSlot: source.sourceKind === "booster" ? source.slot : 0,
        boosterID: source.sourceKind === "booster" ? source.boosterID : 0,
        domain,
        normalizedDomain,
        func,
        modifierType,
        extras,
      });
    }
  }
}

function getImplantDogmaModifierEntries(characterOrID, options = {}) {
  const entries = [];

  for (const implant of getActiveImplantSourceStates(characterOrID)) {
    appendDogmaModifierEntries(entries, {
      sourceKind: "implant",
      typeID: implant.typeID,
      slot: implant.slot,
      typeEntry: implant.typeEntry,
      sourceAttributes: implant.sourceAttributes,
      sourceEffects: implant.sourceEffects,
    }, options);
  }

  for (const booster of getActiveBoosters(characterOrID)) {
    const typeEntry = booster.typeEntry || getTypeDogmaEntry(booster.typeID);
    const sourceAttributes = getEffectiveBoosterSourceAttributes(
      booster,
      characterOrID,
      typeEntry,
    );
    appendDogmaModifierEntries(entries, {
      sourceKind: "booster",
      typeID: booster.typeID,
      slot: booster.slot,
      boosterID: booster.boosterID,
      typeEntry,
      sourceAttributes,
      sourceEffects: getEffectRecordsForBooster(booster, typeEntry),
    }, options);
  }

  return entries;
}

function compareImplantBrainEffectDefinitions(left, right) {
  return (
    toInt(left && left.skillTypeID, 0) - toInt(right && right.skillTypeID, 0) ||
    String(left && left.domain || "").localeCompare(String(right && right.domain || "")) ||
    String(left && left.modifierType || "").localeCompare(
      String(right && right.modifierType || ""),
    ) ||
    toInt(left && left.targetAttributeID, 0) -
      toInt(right && right.targetAttributeID, 0) ||
    toInt(left && left.operation, 0) - toInt(right && right.operation, 0) ||
    JSON.stringify(Array.isArray(left && left.extras) ? left.extras : []).localeCompare(
      JSON.stringify(Array.isArray(right && right.extras) ? right.extras : []),
    ) ||
    toFiniteNumber(left && left.value, 0) - toFiniteNumber(right && right.value, 0)
  );
}

function getImplantBrainEffectDefinitions(characterOrID) {
  const definitions = {
    characterEffects: [],
    shipEffects: [],
    structureEffects: [],
  };

  for (const entry of getImplantDogmaModifierEntries(characterOrID)) {
    const definition = {
      domain: entry.normalizedDomain,
      skillTypeID: entry.sourceTypeID,
      skills: [entry.sourceTypeID],
      targetAttributeID: entry.targetAttributeID,
      operation: entry.operation,
      modifierType: entry.modifierType,
      extras: Array.isArray(entry.extras) ? entry.extras : [],
      value: round6(entry.value),
    };

    switch (entry.normalizedDomain) {
      case "character":
        definitions.characterEffects.push(definition);
        break;
      case "ship":
        definitions.shipEffects.push(definition);
        break;
      case "structure":
        definitions.structureEffects.push(definition);
        break;
      default:
        break;
    }
  }

  definitions.characterEffects.sort(compareImplantBrainEffectDefinitions);
  definitions.shipEffects.sort(compareImplantBrainEffectDefinitions);
  definitions.structureEffects.sort(compareImplantBrainEffectDefinitions);
  return definitions;
}

function getActiveImplants(characterOrID) {
  const record = resolveCharacterRecord(characterOrID);
  if (!record || !Array.isArray(record.implants)) {
    return [];
  }

  const bySlot = new Map();
  const unslotted = [];
  for (const implant of record.implants) {
    const typeID = resolveImplantTypeID(implant);
    if (typeID <= 0) {
      continue;
    }
    const typeEntry = getTypeDogmaEntry(typeID);
    const slot = resolveImplantSlot(implant, typeEntry);
    const itemType = getTypeMetadata(typeID);
    const normalized = {
      ...(implant && typeof implant === "object" ? implant : {}),
      typeID,
      slot,
      typeEntry,
      groupID: toInt(itemType && itemType.groupID, 0),
      groupName: String(itemType && itemType.groupName || ""),
    };
    if (slot > 0) {
      bySlot.set(slot, normalized);
    } else {
      unslotted.push(normalized);
    }
  }

  return [
    ...[...bySlot.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, implant]) => implant),
    ...unslotted,
  ];
}

function buildImplantSourceState(implant) {
  const typeEntry = implant.typeEntry || getTypeDogmaEntry(implant.typeID);
  const itemType = getTypeMetadata(implant.typeID);
  return {
    ...implant,
    typeEntry,
    groupID: toInt(implant.groupID ?? itemType?.groupID, 0),
    groupName: String(implant.groupName || itemType?.groupName || ""),
    sourceAttributes: cloneAttributeMap(typeEntry && typeEntry.attributes),
    sourceEffects: getEffectRecordsForTypeEntry(typeEntry),
  };
}

function getActiveImplantSourceStates(characterOrID) {
  const sources = getActiveImplants(characterOrID).map(buildImplantSourceState);
  if (sources.length <= 0) {
    return sources;
  }

  for (const target of sources) {
    const modifierEntries = [];
    for (const source of sources) {
      appendLocationModifierEntriesForTarget(
        modifierEntries,
        source.sourceAttributes,
        source.sourceEffects,
        "implant",
        target,
        { allowedDomains: new Set(["charID"]) },
      );
    }
    applyDogmaModifierGroups(target.sourceAttributes, modifierEntries);
  }

  return sources;
}

function getActiveBoosters(characterOrID) {
  const record = resolveCharacterRecord(characterOrID);
  if (!record || !Array.isArray(record.boosters)) {
    return [];
  }

  const now = currentFileTime();
  const bySlot = new Map();
  const unslotted = [];
  for (const booster of record.boosters) {
    const typeID = resolveBoosterTypeID(booster);
    if (typeID <= 0) {
      continue;
    }
    const expiryTime = toBigInt(booster && booster.expiryTime, 0n);
    if (expiryTime <= now) {
      continue;
    }
    const typeEntry = getTypeDogmaEntry(typeID);
    const slot = resolveBoosterSlot(booster, typeEntry);
    const normalized = {
      ...(booster && typeof booster === "object" ? booster : {}),
      typeID,
      boosterTypeID: typeID,
      boosterID: resolveBoosterID(booster),
      slot,
      typeEntry,
      sideEffectIDs: Array.isArray(booster && booster.sideEffectIDs)
        ? booster.sideEffectIDs.map((effectID) => toInt(effectID, 0)).filter(Boolean)
        : [],
    };
    if (slot > 0) {
      bySlot.set(slot, normalized);
    } else {
      unslotted.push(normalized);
    }
  }

  return [
    ...[...bySlot.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, booster]) => booster),
    ...unslotted,
  ];
}

function getImplantModifierEntries(characterOrID) {
  return getImplantDogmaModifierEntries(characterOrID, {
    allowedDomains: new Set(["charID"]),
    allowedFuncs: new Set([DIRECT_MODIFIER_FUNC]),
  });
}

function getActiveImplantDirectModifierEntries(characterOrID, options = {}) {
  const allowedDomains = options.allowedDomains instanceof Set
    ? options.allowedDomains
    : new Set(["shipID"]);
  const allowedFuncs = options.allowedFuncs instanceof Set
    ? options.allowedFuncs
    : new Set([DIRECT_MODIFIER_FUNC]);

  return getImplantDogmaModifierEntries(characterOrID, {
    allowedDomains,
    allowedFuncs,
  }).map((entry) => ({
    sourceKind: entry.sourceKind || "implant",
    sourceTypeID: entry.sourceTypeID,
    implantSlot: entry.implantSlot,
    boosterSlot: entry.boosterSlot,
    boosterID: entry.boosterID,
    modifiedAttributeID: entry.targetAttributeID,
    operation: entry.operation,
    value: entry.value,
    stackingPenalized: false,
  }));
}

function getActiveImplantShipModifierEntries(characterOrID) {
  return getActiveImplantDirectModifierEntries(characterOrID, {
    allowedDomains: new Set(["shipID"]),
    allowedFuncs: new Set([DIRECT_MODIFIER_FUNC]),
  });
}

function getActiveImplantCharacterModifierEntries(characterOrID) {
  return getActiveImplantDirectModifierEntries(characterOrID, {
    allowedDomains: new Set(["charID"]),
    allowedFuncs: new Set([DIRECT_MODIFIER_FUNC]),
  });
}

function getActiveImplantLocationModifierSources(characterOrID, options = {}) {
  const sources = [];
  for (const implant of getActiveImplantSourceStates(characterOrID)) {
    if (!implant.typeEntry || !implant.sourceAttributes) {
      continue;
    }

    const sourceEffects = implant.sourceEffects.filter((effectEntry) =>
      (effectEntry.modifierInfo || []).some((modifierInfo) => {
        const domain = String(modifierInfo && modifierInfo.domain || "");
        const func = String(modifierInfo && modifierInfo.func || "");
        return (
          (domain === "shipID" || domain === "charID") &&
          LOCATION_MODIFIER_FUNCS.has(func)
        );
      }),
    );
    if (sourceEffects.length <= 0) {
      continue;
    }

    sources.push({
      sourceKind: "implant",
      sourceTypeID: implant.typeID,
      implantSlot: implant.slot,
      sourceAttributes: implant.sourceAttributes,
      sourceEffects,
    });
  }

  if (options.includeBoosters === false) {
    return sources;
  }

  for (const booster of getActiveBoosters(characterOrID)) {
    const typeEntry = booster.typeEntry || getTypeDogmaEntry(booster.typeID);
    if (!typeEntry || !typeEntry.attributes) {
      continue;
    }
    const sourceAttributes = getEffectiveBoosterSourceAttributes(
      booster,
      characterOrID,
      typeEntry,
    );

    const activeEffects = getEffectRecordsForBooster(booster, typeEntry);
    const sourceEffects = activeEffects.filter((effectEntry) =>
      (effectEntry.modifierInfo || []).some((modifierInfo) => {
        const domain = String(modifierInfo && modifierInfo.domain || "");
        const func = String(modifierInfo && modifierInfo.func || "");
        return (
          (domain === "shipID" || domain === "charID") &&
          LOCATION_MODIFIER_FUNCS.has(func)
        );
      }),
    );
    if (sourceEffects.length <= 0) {
      continue;
    }

    sources.push({
      sourceKind: "booster",
      sourceTypeID: booster.typeID,
      boosterSlot: booster.slot,
      boosterID: booster.boosterID,
      sourceAttributes,
      sourceEffects,
    });
  }
  return sources;
}

function applyActiveImplantLocationModifiersToAttributes(
  attributes,
  targetItem,
  characterOrID,
  options = {},
) {
  const output = cloneAttributeMap(attributes);
  const typeID = toInt(targetItem && targetItem.typeID, 0);
  if (typeID <= 0) {
    return output;
  }

  const targetTypeEntry = getTypeDogmaEntry(typeID);
  const targetMetadata = getTypeMetadata(typeID);
  const target = {
    ...targetItem,
    typeID,
    typeEntry: targetTypeEntry,
    groupID: toInt(targetItem && targetItem.groupID, toInt(targetMetadata && targetMetadata.groupID, 0)),
  };
  const modifierEntries = [];
  for (const source of getActiveImplantLocationModifierSources(characterOrID, options)) {
    appendLocationModifierEntriesForTarget(
      modifierEntries,
      source.sourceAttributes,
      source.sourceEffects,
      source.sourceKind || "implant",
      target,
    );
  }
  applyDogmaModifierGroups(output, modifierEntries);
  return output;
}

function applyActiveImplantAttributeBonuses(attributes, characterOrID) {
  const output = { ...(attributes || {}) };
  for (const entry of getImplantModifierEntries(characterOrID)) {
    const targetAttributeID = toInt(entry.targetAttributeID, 0);
    if (
      !CHARACTER_PRIMARY_ATTRIBUTE_IDS.includes(targetAttributeID) ||
      toInt(entry.operation, 0) !== DOGMA_OP_MOD_ADD
    ) {
      continue;
    }
    output[targetAttributeID] =
      toFiniteNumber(output[targetAttributeID], 0) +
      toFiniteNumber(entry.value, 0);
  }
  return output;
}

function buildImplantAttributeChangePayloads(session, characterID = null) {
  const numericCharacterID = toInt(
    characterID ?? session?.characterID ?? session?.charid,
    0,
  );
  if (numericCharacterID <= 0) {
    return [];
  }

  const record = resolveCharacterRecord(numericCharacterID) || {};
  const source =
    record.characterAttributes && typeof record.characterAttributes === "object"
      ? record.characterAttributes
      : {};
  const baseAttributes = {
    [ATTRIBUTE_CHARISMA]: toFiniteNumber(
      source[ATTRIBUTE_CHARISMA] ?? source.charisma,
      20,
    ),
    [ATTRIBUTE_INTELLIGENCE]: toFiniteNumber(
      source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence,
      20,
    ),
    [ATTRIBUTE_MEMORY]: toFiniteNumber(
      source[ATTRIBUTE_MEMORY] ?? source.memory,
      20,
    ),
    [ATTRIBUTE_PERCEPTION]: toFiniteNumber(
      source[ATTRIBUTE_PERCEPTION] ?? source.perception,
      20,
    ),
    [ATTRIBUTE_WILLPOWER]: toFiniteNumber(
      source[ATTRIBUTE_WILLPOWER] ?? source.willpower,
      20,
    ),
  };
  // Match the godma/GetAttributes paths: scale the learning attributes by
  // skillTrainingSpeed so live attribute-change notifications stay consistent
  // with the accelerated training rate the server accrues at.
  const attributes = applyClientTrainingSpeedScale(
    applyActiveImplantAttributeBonuses(
      baseAttributes,
      record.characterID ? record : numericCharacterID,
    ),
  );
  const changes = [];
  const when =
    session && session._space && typeof session._space.simFileTime === "bigint"
      ? session._space.simFileTime
      : currentFileTime();

  for (const attributeID of CHARACTER_PRIMARY_ATTRIBUTE_IDS) {
    const value = toFiniteNumber(attributes[attributeID], 0);
    changes.push([
      // TQ parity: singular inner tuple tag + trailing time.
      "OnModuleAttributeChange",
      numericCharacterID,
      numericCharacterID,
      attributeID,
      when,
      value,
      null,
      when,
    ]);
  }
  return changes;
}

function syncImplantCharacterModifiers(session, characterID = null) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const changes = buildImplantAttributeChangePayloads(session, characterID);
  if (changes.length <= 0) {
    return false;
  }

  session.sendNotification("OnModuleAttributeChanges", "clientID", [{
    type: "list",
    items: changes,
  }]);
  return true;
}

module.exports = {
  ATTRIBUTE_CHARISMA,
  ATTRIBUTE_INTELLIGENCE,
  ATTRIBUTE_MEMORY,
  ATTRIBUTE_PERCEPTION,
  ATTRIBUTE_WILLPOWER,
  CHARACTER_PRIMARY_ATTRIBUTE_IDS,
  applyActiveImplantLocationModifiersToAttributes,
  applyActiveImplantAttributeBonuses,
  applyDogmaModifierGroups,
  getActiveBoosters,
  getActiveImplantCharacterModifierEntries,
  getActiveImplantDirectModifierEntries,
  getActiveImplantLocationModifierSources,
  getActiveImplantSourceStates,
  getActiveImplantShipModifierEntries,
  buildImplantAttributeChangePayloads,
  getActiveImplants,
  getImplantBrainEffectDefinitions,
  getImplantDogmaModifierEntries,
  getImplantModifierEntries,
  syncImplantCharacterModifiers,
};
