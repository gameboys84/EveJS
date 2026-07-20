const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const log = require(path.join(__dirname, "../../utils/logger"));

const TABLE = Object.freeze({
  ITEM_TYPES: "itemTypes",
  CLIENT_TYPE_LISTS: "clientTypeLists",
  CLIENT_ENTITY_STANDINGS: "clientEntityStandings",
  MAP_TAGS_AUTHORITY: "mapTagsAuthority",
  FIGHTER_ABILITIES: "fighterAbilities",
  DYNAMIC_ITEM_ATTRIBUTES: "dynamicItemAttributes",
  TYPE_DOGMA: "typeDogma",
  SHIP_TYPES: "shipTypes",
  SHIP_DOGMA_ATTRIBUTES: "shipDogmaAttributes",
  SKILL_TYPES: "skillTypes",
  SOVEREIGNTY_STATIC: "sovereigntyStatic",
  PLANET_SCHEMATICS: "planetSchematics",
  CHARACTER_CREATION_RACES: "characterCreationRaces",
  CHARACTER_CREATION_BLOODLINES: "characterCreationBloodlines",
  CHARACTER_CREATION_SCHOOLS: "characterCreationSchools",
  SOLAR_SYSTEMS: "solarSystems",
  STATIONS: "stations",
  STATION_TYPES: "stationTypes",
  STARGATE_TYPES: "stargateTypes",
  CELESTIALS: "celestials",
  CERTIFICATES: "certificates",
  MAP_NAMES: "mapNames",
  ASTEROID_BELTS: "asteroidBelts",
  ASTEROID_FIELD_STYLES: "asteroidFieldStyles",
  STARGATES: "stargates",
  MOVEMENT_ATTRIBUTES: "movementAttributes",
  EXPLORATION_AUTHORITY: "explorationAuthority",
  EXPLORATION_WORMHOLE_STATIC: "explorationWormholeStatic",
  DUNGEON_AUTHORITY: "dungeonAuthority",
  AGENT_AUTHORITY: "agentAuthority",
  MISSION_AUTHORITY: "missionAuthority",
  NPC_STANDINGS_AUTHORITY: "npcStandingsAuthority",
  STATION_STANDINGS_RESTRICTIONS: "stationStandingsRestrictions",
});

const ROW_KEY = Object.freeze({
  [TABLE.ITEM_TYPES]: "types",
  [TABLE.CLIENT_TYPE_LISTS]: "typeLists",
  [TABLE.CLIENT_ENTITY_STANDINGS]: "types",
  [TABLE.SHIP_TYPES]: "ships",
  [TABLE.SKILL_TYPES]: "skills",
  [TABLE.CHARACTER_CREATION_RACES]: "races",
  [TABLE.CHARACTER_CREATION_BLOODLINES]: "bloodlines",
  [TABLE.CHARACTER_CREATION_SCHOOLS]: "schools",
  [TABLE.SOLAR_SYSTEMS]: "solarSystems",
  [TABLE.STATIONS]: "stations",
  [TABLE.STATION_TYPES]: "stationTypes",
  [TABLE.STARGATE_TYPES]: "stargateTypes",
  [TABLE.CELESTIALS]: "celestials",
  [TABLE.ASTEROID_BELTS]: "belts",
  [TABLE.ASTEROID_FIELD_STYLES]: "fieldStyles",
  [TABLE.STARGATES]: "stargates",
  [TABLE.PLANET_SCHEMATICS]: "schematics",
  [TABLE.MOVEMENT_ATTRIBUTES]: "attributes",
  [TABLE.EXPLORATION_WORMHOLE_STATIC]: "systems",
});

const cache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function localName(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    if (typeof value.en === "string") {
      return value.en;
    }
    const first = Object.values(value).find((candidate) => typeof candidate === "string");
    if (first) {
      return first;
    }
  }
  return fallback;
}

function nullableDogmaInt(row, key) {
  return row && row[key] != null ? toInt(row[key], 0) : null;
}

function normalizeDogmaModifier(row) {
  const record = {};
  if (row && row.domain != null) {
    record.domain = String(row.domain);
  }
  if (row && row.modifiedAttributeID != null) {
    record.modifiedAttributeID = toInt(row.modifiedAttributeID, 0);
  }
  if (row && row.operation != null) {
    record.operation = toInt(row.operation, 0);
  }
  if (row && row.modifyingAttributeID != null) {
    record.modifyingAttributeID = toInt(row.modifyingAttributeID, 0);
  }
  if (row && row.func != null) {
    record.func = String(row.func);
  }
  if (row && row.groupID != null) {
    record.groupID = toInt(row.groupID, 0);
  }
  if (row && row.skillTypeID != null) {
    record.skillTypeID = toInt(row.skillTypeID, 0);
  }
  if (row && row.effectID != null) {
    record.effectID = toInt(row.effectID, 0);
  }
  return record;
}

function normalizeDogmaAttributeType(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const attributeID = toInt(row.attributeID ?? row._key, 0);
  if (attributeID <= 0) {
    return null;
  }
  return {
    attributeID,
    attributeName: localName(row.attributeName ?? row.displayName, row.name || ""),
    description: localName(row.description),
    iconID: row.iconID == null ? null : toInt(row.iconID, 0),
    defaultValue: toFiniteNumber(row.defaultValue, 0),
    published: row.published === true,
    displayName: localName(row.displayName),
    unitID: row.unitID == null ? null : toInt(row.unitID, 0),
    stackable: row.stackable === true,
    highIsGood: row.highIsGood === true,
    categoryID: toInt(row.categoryID ?? row.attributeCategoryID, 0),
    name: row.name || "",
    dataType: toInt(row.dataType, 0),
    displayWhenZero: row.displayWhenZero === true,
  };
}

function normalizeDogmaEffectType(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const effectID = toInt(row.effectID ?? row._key, 0);
  if (effectID <= 0) {
    return null;
  }
  return {
    effectID,
    name: row.name || "",
    displayName: localName(row.displayName),
    description: localName(row.description),
    guid: row.guid || "",
    effectCategoryID: toInt(row.effectCategoryID, 0),
    iconID: nullableDogmaInt(row, "iconID"),
    dischargeAttributeID: nullableDogmaInt(row, "dischargeAttributeID"),
    durationAttributeID: nullableDogmaInt(row, "durationAttributeID"),
    distribution: nullableDogmaInt(row, "distribution"),
    rangeAttributeID: nullableDogmaInt(row, "rangeAttributeID"),
    falloffAttributeID: nullableDogmaInt(row, "falloffAttributeID"),
    trackingSpeedAttributeID: nullableDogmaInt(row, "trackingSpeedAttributeID"),
    resistanceAttributeID: nullableDogmaInt(row, "resistanceAttributeID"),
    fittingUsageChanceAttributeID: nullableDogmaInt(row, "fittingUsageChanceAttributeID"),
    npcUsageChanceAttributeID: nullableDogmaInt(row, "npcUsageChanceAttributeID"),
    npcActivationChanceAttributeID: nullableDogmaInt(row, "npcActivationChanceAttributeID"),
    published: row.published === true,
    isOffensive: row.isOffensive === true,
    isAssistance: row.isAssistance === true,
    isWarpSafe: row.isWarpSafe === true,
    disallowAutoRepeat: row.disallowAutoRepeat === true,
    electronicChance: row.electronicChance === true,
    propulsionChance: row.propulsionChance === true,
    rangeChance: row.rangeChance === true,
    modifierInfo: (Array.isArray(row.modifierInfo) ? row.modifierInfo : [])
      .map(normalizeDogmaModifier),
  };
}

function normalizeDogmaAttributeValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(5)) : value;
}

function normalizeTypeDogmaRecord(rawRecord, fallbackTypeID) {
  if (!rawRecord || typeof rawRecord !== "object") {
    return null;
  }

  const typeID = toInt(rawRecord.typeID ?? rawRecord._key ?? fallbackTypeID, 0);
  if (typeID <= 0) {
    return null;
  }

  const attributes = {};
  if (rawRecord.attributes && typeof rawRecord.attributes === "object") {
    for (const [attributeID, value] of Object.entries(rawRecord.attributes)) {
      const numericAttributeID = toInt(attributeID, 0);
      if (numericAttributeID > 0) {
        attributes[String(numericAttributeID)] = normalizeDogmaAttributeValue(value);
      }
    }
  } else if (Array.isArray(rawRecord.dogmaAttributes)) {
    for (const entry of rawRecord.dogmaAttributes) {
      const attributeID = toInt(entry && entry.attributeID, 0);
      if (attributeID > 0) {
        attributes[String(attributeID)] = normalizeDogmaAttributeValue(entry.value);
      }
    }
  }

  const effects = Array.isArray(rawRecord.effects)
    ? rawRecord.effects
    : Array.isArray(rawRecord.dogmaEffects)
      ? rawRecord.dogmaEffects.map((entry) => entry && entry.effectID)
      : [];
  const normalizedEffects = effects
    .map((effectID) => toInt(effectID, 0))
    .filter((effectID) => effectID > 0);

  return {
    ...rawRecord,
    typeID,
    typeName: rawRecord.typeName || rawRecord.name || "",
    attributeCount: Object.keys(attributes).length,
    effectCount: normalizedEffects.length,
    attributes,
    effects: normalizedEffects,
  };
}

function normalizeTypeDogmaPayload(payload) {
  const normalizedAttributeTypes = {};
  for (const [attributeID, row] of Object.entries(payload.attributeTypesByID || {})) {
    const record = normalizeDogmaAttributeType(row);
    if (record) {
      normalizedAttributeTypes[String(record.attributeID || attributeID)] = record;
    }
  }

  const normalizedEffectTypes = {};
  for (const [effectID, row] of Object.entries(payload.effectTypesByID || {})) {
    const record = normalizeDogmaEffectType(row);
    if (record) {
      normalizedEffectTypes[String(record.effectID || effectID)] = record;
    }
  }

  const normalizedTypes = {};
  let totalAttributes = 0;
  let totalEffects = 0;
  for (const [typeID, row] of Object.entries(payload.typesByTypeID || {})) {
    const record = normalizeTypeDogmaRecord(row, typeID);
    if (!record) {
      continue;
    }
    normalizedTypes[String(record.typeID)] = record;
    totalAttributes += record.attributeCount;
    totalEffects += record.effectCount;
  }

  return {
    ...payload,
    attributeTypesByID: normalizedAttributeTypes,
    effectTypesByID: normalizedEffectTypes,
    typesByTypeID: normalizedTypes,
    counts: {
      ...(payload.counts || {}),
      types: Object.keys(normalizedTypes).length,
      attributeTypes: Object.keys(normalizedAttributeTypes).length,
      effectTypes: Object.keys(normalizedEffectTypes).length,
      totalAttributes,
      totalEffects,
    },
  };
}

function normalizePayload(tableName, payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  if (tableName === TABLE.TYPE_DOGMA) {
    return normalizeTypeDogmaPayload(payload);
  }

  return payload;
}

function readStaticTable(tableName) {
  if (cache.has(tableName)) {
    return cache.get(tableName);
  }

  if (
    typeof database.tableExists === "function" &&
    !database.tableExists(tableName)
  ) {
    log.info(
      `[ReferenceData] Static table ${tableName} not available; using empty fallback`,
    );
    const fallback = {};
    cache.set(tableName, fallback);
    return fallback;
  }

  const result = database.read(tableName, "/");
  if (!result.success) {
    log.warn(
      `[ReferenceData] Failed to load table ${tableName}: ${result.errorMsg || "READ_ERROR"}`,
    );
    const fallback = {};
    cache.set(tableName, fallback);
    return fallback;
  }

  const payload = normalizePayload(tableName, result.data);
  cache.set(tableName, payload);
  return payload;
}

function readStaticRows(tableName) {
  const payload = readStaticTable(tableName);
  const rowKey = ROW_KEY[tableName];
  if (!rowKey) {
    return [];
  }

  const rows = payload[rowKey];
  if (Array.isArray(rows)) {
    return rows;
  }
  if (rows && typeof rows === "object") {
    return Object.entries(rows).map(([key, value]) => (
      value && typeof value === "object"
        ? { _key: key, ...value }
        : { _key: key, value }
    ));
  }
  return [];
}

function clearReferenceCache(tableNames = null) {
  if (!tableNames) {
    cache.clear();
    return;
  }

  const targets = Array.isArray(tableNames) ? tableNames : [tableNames];
  for (const tableName of targets) {
    cache.delete(tableName);
  }
}

module.exports = {
  TABLE,
  readStaticTable,
  readStaticRows,
  clearReferenceCache,
};
