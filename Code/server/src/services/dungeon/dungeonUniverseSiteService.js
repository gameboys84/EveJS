const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const BaseService = require(path.join(__dirname, "../baseService"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const dungeonTrackingRuntime = require(path.join(__dirname, "./dungeonTrackingRuntime"));
const explorationAuthority = require(path.join(__dirname, "../exploration/explorationAuthority"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  grantItemsToOwnerLocation,
  findItemById,
  listContainerItems,
  ITEM_FLAGS,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));

const COSMIC_SIGNATURE_TYPE_ID = 19_728;
const COSMIC_SIGNATURE_GROUP_ID = 502;
const COSMIC_ANOMALY_TYPE_ID = 28_356;
const COSMIC_ANOMALY_GROUP_ID = 885;
const SITE_CONTENT_CONTAINER_ID_BASE = 6_200_000_000_000;
const SITE_CONTENT_HAZARD_ID_BASE = 6_300_000_000_000;
const SITE_CONTENT_ENVIRONMENT_ID_BASE = 6_400_000_000_000;
const SITE_CONTENT_GATE_ID_BASE = 6_450_000_000_000;
const SITE_CONTENT_OBJECTIVE_ID_BASE = 6_500_000_000_000;
const SITE_CONTENT_KILLABLE_STRUCTURE_ID_BASE = 6_700_000_000_000;
const SITE_CONTENT_ENCOUNTER_OFFSET_METERS = 25_000;
const SITE_CONTENT_REWARD_OFFSET_METERS = 16_000;
const SITE_CONTENT_CONTAINER_RING_METERS = 12_500;
const SITE_CONTENT_CONTAINER_JITTER_METERS = 3_500;
// Default trigger range for proximity-spawned encounters when a plan omits proximityRangeMeters.
const SITE_CONTENT_PROXIMITY_DEFAULT_RANGE_METERS = 7_500;
const SITE_CONTENT_MAX_CONTAINER_COUNT = 24;
// Mission mining rocks: special mineable asteroids placed in the deadspace site (Plan C).
// NOTE: must be unique vs the other SITE_CONTENT_*_ID_BASE values. It previously aliased
// SITE_CONTENT_ENVIRONMENT_ID_BASE (6.4e12), so on a site that also spawned environment props the rock's
// itemID collided with an already-spawned prop and was skipped as "already present" (no asteroid).
const SITE_CONTENT_MINING_ROCK_ID_BASE = 6_600_000_000_000;
// Renderable asteroid SHELL types (categoryID 2, real 3D model/graphicID) - the in-space ball MUST present
// one of these. The mission ore (Banidine 28617 etc.) is categoryID 25 with graphicID 0 / no model; putting
// it directly in the renderable ball fields makes the retail client crash to desktop building a modelless
// asteroid. So the shell goes in the ball/typeID fields and the ore only in slim*/miningYield* (same split
// belt asteroids use in buildSystemOreAsteroidEntity).
const MINING_ROCK_SHELL_TYPE_IDS = Object.freeze([
  64063, 64064, 64065, 64066, 64067, 64068, 64069, 64070,
  64071, 64072, 64073, 64074, 64075, 64076, 64077,
]);
const SITE_CONTENT_MAX_MINING_ROCK_COUNT = 64;
const SITE_CONTENT_MAX_ENCOUNTER_NPCS = 8;
const SITE_CONTENT_MAX_EXACT_ENCOUNTER_NPCS = 96;
const SITE_CONTENT_MAX_HAZARD_COUNT = 6;
const SITE_CONTENT_MAX_ENVIRONMENT_PROPS = 8;
const SITE_CONTENT_MAX_EXACT_ENVIRONMENT_PROPS = 96;
const SITE_CONTENT_MAX_GATE_COUNT = 6;
const SITE_CONTENT_MAX_OBJECTIVE_MARKERS = 6;
const SITE_CONTENT_MAX_LOOT_ENTRIES = 4;
const SITE_CONTENT_MAX_TRIGGER_NOTIFICATIONS = 16;
const SITE_CONTENT_BEHAVIOR_TICK_INTERVAL_MS = 1_000;
const CLEARED_ANOMALY_ROTATION_DELAY_MS = 0;
const SITE_CONTENT_OWNER_ID = 1;
const SITE_CONTENT_SAFE_SLIM_CATEGORY_ID = 2;
const DEFAULT_ACCELERATION_GATE_ACTIVATION_RANGE_METERS = 2_500;
const DATA_RELIC_SITE_FAMILIES = new Set(["data", "relic"]);
const DATA_RELIC_CONTAINER_ANALYZERS = new Set(["data", "relic"]);
const HACKING_STATE_HACKED = 2;
const SITE_NAME_LOOKUP_PATH = path.join(
  __dirname,
  "../../../../tools/SignalAtlas/data/siteNameLookup.json",
);

let runtimeSyncStarted = false;
let registeredListener = null;
let siteBehaviorTicker = null;
let cachedGenericContainerType = undefined;
let cachedSiteNameLookup = undefined;
const cachedContainerTypeRecordByName = new Map();
const cachedGenericTypeRecordByName = new Map();
const cachedLootTypeRecordByName = new Map();

function buildSafeSitePropSlimOverrides(typeRecord = null) {
  const rawCategoryID = Math.max(0, toInt(typeRecord && typeRecord.categoryID, 0));
  if (![11, 23].includes(rawCategoryID)) {
    return {};
  }
  return {
    // These deadspace/ambient props use entity/starbase categories in CCP data,
    // but the packaged client's bracket/state paths then expect POS/entity
    // metadata we do not send for passive site dressing. Keep the real
    // type/graphic for rendering, but advertise a safe slim category.
    slimCategoryID: SITE_CONTENT_SAFE_SLIM_CATEGORY_ID,
  };
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function normalizeSlimNullableValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === "none" || normalized.toLowerCase() === "null") {
    return null;
  }
  return value;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMaybeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function uniqueSorted(values) {
  return [...new Set(normalizeArray(values).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right)));
}

function normalizeIDList(value) {
  return [...new Set(
    normalizeArray(value)
      .map((entry) => Math.max(0, toInt(entry, 0)))
      .filter((entry) => entry > 0),
  )].sort((left, right) => left - right);
}

function resolveGateDungeonObjectID(gateProfile, gateState, gateKey) {
  const explicitObjectID = Math.max(
    0,
    toInt(
      gateProfile && (gateProfile.dungeonObjectID || gateProfile.dunObjectID || gateProfile.fromObjectID),
      0,
    ),
  );
  if (explicitObjectID > 0) {
    return explicitObjectID;
  }

  const metadata = normalizeObject(gateState && gateState.metadata);
  const metadataObjectID = Math.max(
    0,
    toInt(metadata.dungeonObjectID || metadata.dunObjectID || metadata.fromObjectID, 0),
  );
  if (metadataObjectID > 0) {
    return metadataObjectID;
  }

  const gateKeyMatch = String(gateKey || "").match(/(\d+)$/);
  return gateKeyMatch ? Math.max(0, toInt(gateKeyMatch[1], 0)) : 0;
}

function resolveGateActivationRangeMeters(gateProfile, typeID) {
  const explicitRange = toFiniteNumber(
    gateProfile && (gateProfile.gateActivationRange || gateProfile.activationRange || gateProfile.proximityRange),
    0,
  );
  if (explicitRange > 0) {
    return explicitRange;
  }

  return (
    toFiniteNumber(
      getTypeAttributeValue(typeID, "proximityRange", "Activation proximity"),
      0,
    ) ||
    DEFAULT_ACCELERATION_GATE_ACTIVATION_RANGE_METERS
  );
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function resolveGateRequirementMetadata(gateProfile, gateState) {
  const metadata = normalizeObject(gateState && gateState.metadata);
  const rawConnection = normalizeObject(metadata.rawConnection);
  return {
    keyLock: firstDefined(
      gateProfile && gateProfile.keyLock,
      gateProfile && gateProfile.keylock,
      gateProfile && gateProfile.keyLockType,
      gateState && gateState.keyLock,
      gateState && gateState.keylock,
      metadata.keyLock,
      metadata.keylock,
      metadata.keyLockType,
      rawConnection.keyLock,
      rawConnection.keylock,
      rawConnection.keyLockType,
    ),
    requiredItems: firstDefined(
      gateProfile && gateProfile.requiredItems,
      gateProfile && gateProfile.requiredKeyItems,
      gateProfile && gateProfile.requiredItemTypeIDs,
      gateProfile && gateProfile.requiredKeyTypeIDs,
      gateProfile && gateProfile.keyTypeIDs,
      gateProfile && gateProfile.passcardTypeIDs,
      gateState && gateState.requiredItems,
      metadata.requiredItems,
      metadata.requiredKeyItems,
      metadata.requiredItemTypeIDs,
      metadata.requiredKeyTypeIDs,
      rawConnection.requiredItems,
      rawConnection.requiredKeyItems,
      rawConnection.requiredItemTypeIDs,
      rawConnection.requiredKeyTypeIDs,
    ),
    requiredItemTypeID: Math.max(
      0,
      toInt(
        firstDefined(
          gateProfile && gateProfile.requiredItemTypeID,
          gateProfile && gateProfile.requiredKeyTypeID,
          gateProfile && gateProfile.keyTypeID,
          gateProfile && gateProfile.keyItemTypeID,
          gateProfile && gateProfile.passcardTypeID,
          gateState && gateState.requiredItemTypeID,
          metadata.requiredItemTypeID,
          metadata.requiredKeyTypeID,
          rawConnection.requiredItemTypeID,
          rawConnection.requiredKeyTypeID,
          rawConnection.keyTypeID,
          rawConnection.passcardTypeID,
        ),
        0,
      ),
    ) || null,
    requiredItemQuantity: Math.max(
      0,
      toInt(
        firstDefined(
          gateProfile && gateProfile.requiredItemQuantity,
          gateProfile && gateProfile.requiredQuantity,
          gateProfile && gateProfile.keyQuantity,
          gateProfile && gateProfile.passcardQuantity,
          gateState && gateState.requiredItemQuantity,
          metadata.requiredItemQuantity,
          metadata.requiredQuantity,
          rawConnection.requiredItemQuantity,
          rawConnection.requiredQuantity,
          rawConnection.keyQuantity,
          rawConnection.passcardQuantity,
        ),
        0,
      ),
    ) || null,
  };
}

function clonePosition(value) {
  return {
    x: toFiniteNumber(value && value.x, 0),
    y: toFiniteNumber(value && value.y, 0),
    z: toFiniteNumber(value && value.z, 0),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function hashText(value) {
  const normalized = normalizeText(value, "");
  let state = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    state = Math.imul(state ^ normalized.charCodeAt(index), 0x45d9f3b);
    state ^= state >>> 16;
  }
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function getNpcSpawnService() {
  return require(path.join(__dirname, "../../space/npc/npcService"));
}

function getScanMgrService() {
  return require(path.join(__dirname, "../exploration/scanMgrService"));
}

function getSiteNameLookup() {
  if (cachedSiteNameLookup !== undefined) {
    return cachedSiteNameLookup;
  }
  try {
    if (!fs.existsSync(SITE_NAME_LOOKUP_PATH)) {
      cachedSiteNameLookup = null;
      return cachedSiteNameLookup;
    }
    cachedSiteNameLookup = JSON.parse(fs.readFileSync(SITE_NAME_LOOKUP_PATH, "utf8"));
    return cachedSiteNameLookup;
  } catch (error) {
    cachedSiteNameLookup = null;
    return cachedSiteNameLookup;
  }
}

function resolveSiteFamilyLabel(family) {
  switch (normalizeLowerText(family, "unknown")) {
    case "combat":
      return "Combat";
    case "combat_hacking":
      return "Combat Hacking";
    case "data":
      return "Data";
    case "relic":
      return "Relic";
    case "ore":
      return "Ore";
    case "gas":
      return "Gas";
    case "ghost":
      return "Ghost";
    default:
      return "Site";
  }
}

function resolveFallbackStrengthAttribute(family) {
  switch (normalizeLowerText(family, "")) {
    case "ghost":
    case "combat_hacking":
      return explorationAuthority.getScanStrengthAttribute("data") || 208;
    default:
      return explorationAuthority.getScanStrengthAttribute(family) || 0;
  }
}

function resolveContainerRoleLabel(role) {
  switch (normalizeLowerText(role, "container")) {
    case "data":
      return "Data Cache";
    case "relic":
      return "Relic Cache";
    case "research":
      return "Research Cache";
    case "covert_research":
      return "Covert Research Cache";
    default:
      return "Site Container";
  }
}

function resolveHazardLabel(hazard) {
  switch (normalizeLowerText(hazard, "hazard")) {
    case "ghost_site_timer":
      return "Ghost Site Timer Beacon";
    case "ghost_site_explosion":
      return "Ghost Site Blast Zone";
    case "ghost_site_npc_response":
      return "Ghost Site Response Beacon";
    case "reservoir_sleeper_response_timer":
      return "Reservoir Sleeper Response Timer";
    default:
      return "Site Hazard Beacon";
  }
}

function splitLabelTail(value) {
  const normalized = normalizeText(value, "");
  if (!normalized) {
    return "";
  }
  const lastSegment = normalized.split("/").pop();
  return lastSegment || normalized;
}

function humanizeIdentifier(value, fallback = "") {
  const tail = splitLabelTail(value);
  const normalized = String(tail || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function resolveTypeRecordName(typeRecord, fallback = "") {
  return normalizeText(
    typeRecord && (typeRecord.name || typeRecord.typeName || typeRecord.slimName),
    fallback,
  );
}

function resolveLocalizedTemplateName(template) {
  if (normalizeText(template && template.resolvedName, "")) {
    return normalizeText(template && template.resolvedName, "");
  }
  const lookup = getSiteNameLookup();
  if (!lookup || typeof lookup !== "object") {
    return "";
  }
  const templateNamesByID =
    lookup && lookup.templateNamesByID && typeof lookup.templateNamesByID === "object"
      ? lookup.templateNamesByID
      : {};
  const dungeonNamesByMessageID =
    lookup && lookup.dungeonNamesByMessageID && typeof lookup.dungeonNamesByMessageID === "object"
      ? lookup.dungeonNamesByMessageID
      : {};
  const templateID = normalizeText(template && template.templateID, "");
  if (templateID && normalizeText(templateNamesByID[templateID], "")) {
    return normalizeText(templateNamesByID[templateID], "");
  }
  const dungeonNameID = Math.max(0, toInt(template && template.dungeonNameID, 0));
  if (dungeonNameID > 0 && normalizeText(dungeonNamesByMessageID[String(dungeonNameID)], "")) {
    return normalizeText(dungeonNamesByMessageID[String(dungeonNameID)], "");
  }
  return "";
}

function resolveGenericContainerTypeRecord() {
  if (cachedGenericContainerType !== undefined) {
    return cachedGenericContainerType;
  }
  const lookup = resolveItemByName("Cargo Container");
  cachedGenericContainerType = lookup && lookup.success && lookup.match
    ? lookup.match
    : null;
  return cachedGenericContainerType;
}

function resolveContainerTypeRecordByName(candidateNames) {
  for (const rawCandidate of normalizeArray(candidateNames)) {
    const candidate = normalizeText(rawCandidate, "");
    if (!candidate) {
      continue;
    }
    if (cachedContainerTypeRecordByName.has(candidate)) {
      return cachedContainerTypeRecordByName.get(candidate);
    }
    const lookup = resolveItemByName(candidate);
    const match = lookup && lookup.success && lookup.match
      ? lookup.match
      : null;
    cachedContainerTypeRecordByName.set(candidate, match);
    if (match) {
      return match;
    }
  }
  return null;
}

function listGenericTypeNameAliases(candidate) {
  const normalized = normalizeLowerText(candidate, "");
  const aliases = [];
  if (/\bstarbase\b.*\bstasis\b.*\btower\b/.test(normalized) || /^stasis\s+tower$/.test(normalized)) {
    aliases.push("Stasis Webification Battery");
  }
  return aliases;
}

function resolveGenericTypeRecordByName(candidateNames) {
  for (const rawCandidate of normalizeArray(candidateNames)) {
    const candidate = normalizeText(rawCandidate, "");
    if (!candidate) {
      continue;
    }
    if (cachedGenericTypeRecordByName.has(candidate)) {
      return cachedGenericTypeRecordByName.get(candidate);
    }
    let match = null;
    for (const lookupName of [candidate, ...listGenericTypeNameAliases(candidate)]) {
      const lookup = resolveItemByName(lookupName);
      match = lookup && lookup.success && lookup.match
        ? lookup.match
        : null;
      if (match) {
        break;
      }
    }
    cachedGenericTypeRecordByName.set(candidate, match);
    if (match) {
      return match;
    }
  }
  return null;
}

function resolveLootTypeRecordByName(candidateName) {
  const normalizedCandidate = normalizeText(candidateName, "");
  if (!normalizedCandidate) {
    return null;
  }
  if (cachedLootTypeRecordByName.has(normalizedCandidate)) {
    return cachedLootTypeRecordByName.get(normalizedCandidate);
  }
  const lookup = resolveItemByName(normalizedCandidate);
  const match = lookup && lookup.success && lookup.match
    ? lookup.match
    : null;
  cachedLootTypeRecordByName.set(normalizedCandidate, match);
  return match;
}

function resolveTypeHealthState(typeID) {
  const normalizedTypeID = Math.max(0, toInt(typeID, 0));
  if (normalizedTypeID <= 0) {
    return {
      shieldCapacity: 0,
      armorHP: 0,
      structureHP: 0,
      conditionState: {
        shieldCharge: 0,
        armorDamage: 0,
        damage: 0,
      },
    };
  }
  const shieldCapacity = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(normalizedTypeID, "shieldCapacity"), 0),
  );
  const armorHP = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(normalizedTypeID, "armorHP"), 0),
  );
  const structureHP = Math.max(
    0,
    toFiniteNumber(
      getTypeAttributeValue(normalizedTypeID, "hp", "structureHP"),
      0,
    ),
  );
  return {
    shieldCapacity,
    armorHP,
    structureHP,
    conditionState: {
      shieldCharge: shieldCapacity > 0 ? 1 : 0,
      armorDamage: 0,
      damage: 0,
    },
  };
}

function chooseDeterministicEntry(entries, seed) {
  const normalizedEntries = normalizeArray(entries).filter(Boolean);
  if (normalizedEntries.length <= 0) {
    return null;
  }
  const index = hashText(seed) % normalizedEntries.length;
  return normalizedEntries[index] || normalizedEntries[0] || null;
}

function resolveDeterministicQuantity(seed, minimum, maximum) {
  const normalizedMinimum = Math.max(1, toInt(minimum, 1));
  const normalizedMaximum = Math.max(normalizedMinimum, toInt(maximum, normalizedMinimum));
  if (normalizedMaximum <= normalizedMinimum) {
    return normalizedMinimum;
  }
  return normalizedMinimum + (hashText(seed) % ((normalizedMaximum - normalizedMinimum) + 1));
}

function mergeLootGrantEntries(entries) {
  const mergedByTypeID = new Map();
  for (const entry of normalizeArray(entries).filter(Boolean)) {
    const itemType = entry && entry.itemType ? entry.itemType : null;
    const typeID = Math.max(0, toInt(itemType && itemType.typeID, 0));
    if (typeID <= 0) {
      continue;
    }
    const quantity = Math.max(1, toInt(entry && entry.quantity, 1));
    if (!mergedByTypeID.has(typeID)) {
      mergedByTypeID.set(typeID, {
        itemType,
        quantity,
        options: cloneValue(entry && entry.options),
      });
      continue;
    }
    mergedByTypeID.get(typeID).quantity += quantity;
  }
  return [...mergedByTypeID.values()];
}

function resolveLootProfileDefinition(populationHints, profileKey) {
  const normalizedProfileKey = normalizeText(profileKey, "");
  if (!normalizedProfileKey) {
    return null;
  }
  return normalizeArray(populationHints && populationHints.lootProfiles)
    .find((profile) => normalizeText(profile && profile.key, "") === normalizedProfileKey) || null;
}

function resolveContainerLootTags(containerEntity, populationHints) {
  const explicitTags = normalizeArray(
    containerEntity &&
    (
      containerEntity.dungeonSiteContentLootTags ||
      containerEntity.lootTags
    ),
  )
    .map((tag) => normalizeLowerText(tag, ""))
    .filter(Boolean);
  if (explicitTags.length > 0) {
    return explicitTags;
  }
  const profile = resolveLootProfileDefinition(
    populationHints,
    normalizeText(
      containerEntity &&
      (
        containerEntity.dungeonSiteContentLootProfile ||
        containerEntity.lootProfile
      ),
      "",
    ),
  );
  return normalizeArray(profile && profile.tags)
    .map((tag) => normalizeLowerText(tag, ""))
    .filter(Boolean);
}

function resolveBoosterFamilyFromText(value) {
  const normalized = normalizeText(value, "").toLowerCase();
  const knownFamilies = [
    "Mindflood",
    "Exile",
    "Crash",
    "X-Instinct",
    "Sooth Sayer",
    "Blue Pill",
    "Drop",
    "Frentix",
  ];
  return knownFamilies.find((family) => normalized.includes(family.toLowerCase())) || "";
}

function resolvePreferredLootItem(candidateNames, seed) {
  const resolved = normalizeArray(candidateNames)
    .map((candidate) => resolveLootTypeRecordByName(candidate))
    .filter(Boolean);
  return chooseDeterministicEntry(resolved, seed);
}

function buildLootGrantEntry(itemType, quantity = 1, options = {}) {
  if (!itemType || Math.max(0, toInt(itemType.typeID, 0)) <= 0) {
    return null;
  }
  return {
    itemType,
    quantity: Math.max(1, toInt(quantity, 1)),
    options: cloneValue(options),
  };
}

function buildLootEntryFromNames(candidateNames, seed, minimum = 1, maximum = minimum, options = {}) {
  const itemType = resolvePreferredLootItem(candidateNames, seed);
  if (!itemType) {
    return null;
  }
  return buildLootGrantEntry(
    itemType,
    resolveDeterministicQuantity(seed, minimum, maximum),
    options,
  );
}

function buildBoosterLootGrantEntries(seed, tags, context = {}) {
  const siteLabel = normalizeText(
    context &&
    (
      context.template && context.template.resolvedName ||
      context.siteEntity && context.siteEntity.itemName
    ),
    "",
  );
  const preferredFamily = resolveBoosterFamilyFromText(siteLabel);
  const knownFamilies = [
    "Crash",
    "Exile",
    "Mindflood",
    "X-Instinct",
    "Sooth Sayer",
    "Blue Pill",
    "Drop",
    "Frentix",
  ];
  const orderedFamilies = uniqueSorted([
    preferredFamily,
    ...knownFamilies,
  ].filter(Boolean));
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "booster_bpc":
        entries.push(buildLootEntryFromNames(
          orderedFamilies.flatMap((family) => [
            `Standard ${family} Booster Blueprint`,
            `Improved ${family} Booster Blueprint`,
            `Strong ${family} Booster Blueprint`,
          ]),
          `${seed}:booster_bpc`,
        ));
        break;
      case "reaction_formula":
        entries.push(buildLootEntryFromNames(
          orderedFamilies.map((family) => `Standard ${family} Booster Reaction Formula`),
          `${seed}:reaction_formula`,
        ));
        break;
      case "skillbook":
        entries.push(buildLootEntryFromNames(
          [
            "Biology",
            "Drug Manufacturing",
            "Neurotoxin Recovery",
            "Neurotoxin Control",
          ],
          `${seed}:skillbook`,
        ));
        break;
      case "booster_commodity":
        entries.push(buildLootEntryFromNames(
          orderedFamilies.flatMap((family) => [
            `Standard ${family} Booster`,
            `Improved ${family} Booster`,
            `Synth ${family} Booster`,
          ]),
          `${seed}:booster_commodity`,
          1,
          2,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildSleeperLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "blue_loot":
        entries.push(buildLootEntryFromNames(
          [
            "Neural Network Analyzer",
            "Sleeper Data Library",
            "Sleeper Drone AI Nexus",
          ],
          `${seed}:blue_loot`,
          1,
          3,
        ));
        break;
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Melted Nanoribbons",
            "Intact Armor Plates",
            "Tripped Power Circuit",
            "Burned Logic Circuit",
            "Charred Micro Circuit",
          ],
          `${seed}:salvage`,
          2,
          6,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildPirateDataLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "datacore":
        entries.push(buildLootEntryFromNames(
          [
            "Datacore - Electronic Engineering",
            "Datacore - Mechanical Engineering",
            "Datacore - Laser Physics",
            "Datacore - Rocket Science",
            "Datacore - Quantum Physics",
          ],
          `${seed}:datacore`,
          2,
          6,
        ));
        break;
      case "decryptor":
        entries.push(buildLootEntryFromNames(
          [
            "Accelerant Decryptor",
            "Attainment Decryptor",
            "Optimized Attainment Decryptor",
            "Process Decryptor",
            "Symmetry Decryptor",
          ],
          `${seed}:decryptor`,
        ));
        break;
      case "data_material":
        entries.push(buildLootEntryFromNames(
          [
            "Esoteric Data Interface",
          ],
          `${seed}:data_material`,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildPirateRelicLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Burned Logic Circuit",
            "Charred Micro Circuit",
            "Contaminated Nanite Compound",
            "Fried Interface Circuit",
            "Tripped Power Circuit",
          ],
          `${seed}:salvage`,
          2,
          7,
        ));
        break;
      case "relic_component":
        entries.push(buildLootEntryFromNames(
          [
            "Alloyed Tritanium Bar",
            "Armor Plates",
            "Intact Armor Plates",
            "Melted Nanoribbons",
          ],
          `${seed}:relic_component`,
          1,
          3,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildGhostResearchLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "datacore":
        entries.push(buildLootEntryFromNames(
          [
            "Datacore - Electronic Engineering",
            "Datacore - Quantum Physics",
            "Datacore - Mechanical Engineering",
          ],
          `${seed}:datacore`,
          2,
          5,
        ));
        break;
      case "decryptor":
        entries.push(buildLootEntryFromNames(
          [
            "Accelerant Decryptor",
            "Attainment Decryptor",
            "Optimized Attainment Decryptor",
            "Process Decryptor",
            "Symmetry Decryptor",
          ],
          `${seed}:decryptor`,
        ));
        break;
      case "research_component":
        entries.push(buildLootEntryFromNames(
          [
            "Esoteric Data Interface",
            "Neural Network Analyzer",
          ],
          `${seed}:research_component`,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildGenericDataLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "datacore":
        entries.push(buildLootEntryFromNames(
          [
            "Datacore - Electronic Engineering",
            "Datacore - Mechanical Engineering",
            "Datacore - Laser Physics",
            "Datacore - Gallentean Starship Engineering",
            "Datacore - Minmatar Starship Engineering",
          ],
          `${seed}:generic_datacore`,
          1,
          4,
        ));
        break;
      case "decryptor":
        entries.push(buildLootEntryFromNames(
          [
            "Accelerant Decryptor",
            "Attainment Decryptor",
            "Optimized Attainment Decryptor",
            "Process Decryptor",
            "Symmetry Decryptor",
          ],
          `${seed}:generic_decryptor`,
        ));
        break;
      case "data_material":
        entries.push(buildLootEntryFromNames(
          [
            "Esoteric Data Interface",
            "Occult Data Interface",
            "Incognito Data Interface",
            "Engagement Plan Data Chip",
          ],
          `${seed}:generic_data_material`,
          1,
          2,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildGenericRelicLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Burned Logic Circuit",
            "Charred Micro Circuit",
            "Fried Interface Circuit",
            "Tripped Power Circuit",
            "Contaminated Nanite Compound",
          ],
          `${seed}:generic_salvage`,
          2,
          7,
        ));
        break;
      case "relic_component":
        entries.push(buildLootEntryFromNames(
          [
            "Alloyed Tritanium Bar",
            "Armor Plates",
            "Intact Armor Plates",
            "Melted Nanoribbons",
            "Power Circuit",
          ],
          `${seed}:generic_relic_component`,
          1,
          3,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function resolveCombatLootFlavor(context = {}) {
  const label = normalizeLowerText(
    context &&
    (
      context.template && context.template.resolvedName ||
      context.siteEntity && context.siteEntity.itemName
    ),
    "",
  );
  if (label.includes("angel") || label.includes("cartel")) {
    return "angel";
  }
  if (label.includes("blood")) {
    return "blood";
  }
  if (label.includes("guristas") || label.includes("pith")) {
    return "guristas";
  }
  if (label.includes("sansha")) {
    return "sansha";
  }
  if (label.includes("serpentis")) {
    return "serpentis";
  }
  if (label.includes("drone")) {
    return "drone";
  }
  return "generic";
}

function buildCombatLootGrantEntries(seed, tags, context = {}, options = {}) {
  const flavor = resolveCombatLootFlavor(context);
  const flavorModules = {
    angel: ["Domination Gyrostabilizer", "Domination 10MN Afterburner"],
    blood: ["Dark Blood Heat Sink", "Dark Blood Cap Recharger"],
    guristas: ["Dread Guristas Ballistic Control System", "Dread Guristas 250mm Railgun"],
    sansha: ["True Sansha Heat Sink", "True Sansha Cap Recharger"],
    serpentis: ["Shadow Serpentis Magnetic Field Stabilizer", "Shadow Serpentis 10MN Afterburner"],
    drone: ["Drone Transceiver", "Drone Link Augmentor I"],
    generic: ["Domination Gyrostabilizer", "Dread Guristas Ballistic Control System", "True Sansha Heat Sink"],
  };
  const flavorTagItems = {
    angel: ["Domination Platinum Tag", "Domination EMP L"],
    blood: ["Dark Blood Brass Tag", "Dark Blood Gamma L"],
    guristas: ["Dread Guristas Brass Tag", "Dread Guristas Antimatter Charge L"],
    sansha: ["True Sansha Brass Tag", "True Sansha Heat Sink"],
    serpentis: ["Shadow Serpentis Bronze Tag", "Shadow Serpentis Magnetic Field Stabilizer"],
    drone: ["Drone Transceiver", "Charred Micro Circuit"],
    generic: ["Domination Platinum Tag", "Dread Guristas Brass Tag"],
  };
  const overseerTierCandidates = options.overseerTierCandidates && options.overseerTierCandidates.length > 0
    ? options.overseerTierCandidates
    : [
      "4th Tier Overseer's Personal Effects",
      "5th Tier Overseer's Personal Effects",
      "6th Tier Overseer's Personal Effects",
      "7th Tier Overseer's Personal Effects",
      "8th Tier Overseer's Personal Effects",
    ];
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "faction_module":
        entries.push(buildLootEntryFromNames(
          flavorModules[flavor] || flavorModules.generic,
          `${seed}:combat_module`,
        ));
        break;
      case "faction_ammo":
      case "pirate_tag":
        entries.push(buildLootEntryFromNames(
          flavorTagItems[flavor] || flavorTagItems.generic,
          `${seed}:combat_tag:${tag}`,
          1,
          2,
        ));
        break;
      case "overseer_effect":
        entries.push(buildLootEntryFromNames(
          overseerTierCandidates,
          `${seed}:overseer_effect`,
        ));
        break;
      case "drone_component":
        entries.push(buildLootEntryFromNames(
          [
            "Drone Transceiver",
            "Drone Parasitic Rovers",
            "Drone Cerebral Fragment",
          ],
          `${seed}:drone_component`,
          1,
          2,
        ));
        break;
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Burned Logic Circuit",
            "Charred Micro Circuit",
            "Fried Interface Circuit",
            "Tripped Power Circuit",
          ],
          `${seed}:combat_salvage`,
          2,
          5,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildLootGrantEntriesForContainer(containerEntity, populationHints, context = {}) {
  const profileKey = normalizeText(
    containerEntity &&
    (
      containerEntity.dungeonSiteContentLootProfile ||
      containerEntity.lootProfile
    ),
    "",
  );
  if (!profileKey) {
    return [];
  }
  const tags = resolveContainerLootTags(containerEntity, populationHints);
  const seedBase = normalizeText(
    containerEntity && containerEntity.dungeonSiteContentKey,
    `${profileKey}:${normalizeText(containerEntity && containerEntity.itemName, "container")}`,
  );
  switch (profileKey) {
    case "booster_site_loot":
      return buildBoosterLootGrantEntries(seedBase, tags, context);
    case "sleeper_blue_loot":
      return buildSleeperLootGrantEntries(seedBase, tags);
    case "generic_data_loot":
      return buildGenericDataLootGrantEntries(seedBase, tags);
    case "generic_relic_loot":
      return buildGenericRelicLootGrantEntries(seedBase, tags);
    case "generic_combat_hacking_loot":
      return buildBoosterLootGrantEntries(seedBase, tags, context);
    case "pirate_data_loot":
      return buildPirateDataLootGrantEntries(seedBase, tags);
    case "pirate_relic_loot":
      return buildPirateRelicLootGrantEntries(seedBase, tags);
    case "ghost_research_loot":
      return buildGhostResearchLootGrantEntries(seedBase, tags);
    case "pirate_combat_loot":
      return buildCombatLootGrantEntries(seedBase, tags, context, {
        overseerTierCandidates: [
          "2nd Tier Overseer's Personal Effects",
          "3rd Tier Overseer's Personal Effects",
          "4th Tier Overseer's Personal Effects",
          "5th Tier Overseer's Personal Effects",
        ],
      });
    case "combat_overseer_loot":
      return buildCombatLootGrantEntries(seedBase, tags, context, {
        overseerTierCandidates: [
          "6th Tier Overseer's Personal Effects",
          "7th Tier Overseer's Personal Effects",
          "8th Tier Overseer's Personal Effects",
          "9th Tier Overseer's Personal Effects",
          "10th Tier Overseer's Personal Effects",
        ],
      });
    default:
      return [];
  }
}

function resolveContainerTypeRecord(containerSpec) {
  const explicitTypeID = Math.max(0, toInt(containerSpec && containerSpec.typeID, 0));
  if (explicitTypeID > 0) {
    const explicitType = resolveItemByTypeID(explicitTypeID);
    if (explicitType) {
      return explicitType;
    }
  }
  const namedType = resolveContainerTypeRecordByName(containerSpec && containerSpec.typeNameCandidates);
  if (namedType) {
    return namedType;
  }
  return resolveGenericContainerTypeRecord();
}

function resolveContainerDisplayName(containerSpec, typeRecord, ordinal) {
  const explicitLabel = normalizeText(containerSpec && containerSpec.label, "");
  if (explicitLabel) {
    return explicitLabel;
  }
  const baseLabel = explicitLabel || resolveTypeRecordName(typeRecord, "");
  const fallbackLabel = resolveContainerRoleLabel(containerSpec && containerSpec.role);
  const displayLabel = baseLabel || fallbackLabel || "Site Container";
  return ordinal > 1 ? `${displayLabel} ${ordinal}` : displayLabel;
}

function buildMissionRoomKey(room = null, index = 0) {
  const roomID = normalizeText(room && room.roomId, "");
  if (roomID) {
    return `room:${roomID}`;
  }
  return index <= 0 ? "room:entry" : `room:mission_${index + 1}`;
}

function parseMissionGroupNumber(group = null, fallback = 0) {
  const candidates = [
    normalizeText(group && group.title, ""),
    normalizeText(group && group.groupId, ""),
    normalizeText(group && group.key, ""),
  ];
  for (const candidate of candidates) {
    const match = candidate.match(/\bgroup[_\s:-]*(\d{1,2})\b/i);
    if (match) {
      return Math.max(1, toInt(match[1], fallback));
    }
  }
  return Math.max(1, toInt(fallback, 1));
}

function buildMissionGroupTimingText(group = null) {
  return [
    normalizeText(group && group.title, ""),
    ...normalizeArray(group && group.notes)
      .map((note) => normalizeText(note, ""))
      .filter(Boolean),
  ].join(" ");
}

function parseMissionSameWaveGroupNumber(group = null) {
  const text = buildMissionGroupTimingText(group);
  const patterns = [
    /\bsame\s+time\s+as\s+group\s*(\d{1,2})\b/i,
    /\bspawns?\s+(?:at\s+)?(?:the\s+)?same\s+time\s+as\s+group\s*(\d{1,2})\b/i,
    /\bspawns?\s+with\s+group\s*(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Math.max(1, toInt(match[1], 0));
    }
  }
  return 0;
}

function normalizeMissionSpawnCount(entry = null) {
  const count = normalizeObject(entry && entry.count);
  return Math.max(
    1,
    Math.min(
      SITE_CONTENT_MAX_ENCOUNTER_NPCS,
      toInt(count.max, toInt(count.min, 1)),
    ),
  );
}

function resolveBoundedContentLimit(value, fallback, hardMaximum) {
  const explicit = Math.max(0, toInt(value, 0));
  const selected = explicit > 0 ? explicit : fallback;
  return Math.max(0, Math.min(Math.max(0, toInt(hardMaximum, fallback)), selected));
}

function resolveExactEnvironmentPropLimit(populationHints, candidateCount) {
  const caps = normalizeObject(populationHints && populationHints.exactContentCaps);
  const limit = resolveBoundedContentLimit(
    caps.environmentProps ||
      caps.exactEnvironmentProps ||
      (populationHints && populationHints.maxExactEnvironmentProps),
    SITE_CONTENT_MAX_EXACT_ENVIRONMENT_PROPS,
    SITE_CONTENT_MAX_EXACT_ENVIRONMENT_PROPS,
  );
  return Math.min(Math.max(0, toInt(candidateCount, 0)), limit);
}

function resolveEncounterSpawnEntryLimit(encounterPlan) {
  const explicitLimit = Math.max(0, toInt(
    encounterPlan && (
      encounterPlan.maxSpawnEntries ||
      encounterPlan.maxExactSpawnEntries ||
      encounterPlan.maxEncounterNpcs
    ),
    0,
  ));
  const defaultLimit = encounterPlan && encounterPlan.exact === true
    ? SITE_CONTENT_MAX_EXACT_ENCOUNTER_NPCS
    : SITE_CONTENT_MAX_ENCOUNTER_NPCS;
  return Math.max(
    1,
    resolveBoundedContentLimit(
      explicitLimit,
      defaultLimit,
      SITE_CONTENT_MAX_EXACT_ENCOUNTER_NPCS,
    ),
  );
}

function normalizeEncounterTriggerMessages(entry) {
  return normalizeMaybeArray(
    (entry && (entry.triggerMessages || entry.triggerMessage || entry.dungeonTriggerMessages)) || [],
  )
    .map((message) => {
      if (Array.isArray(message)) {
        return {
          messageType: Math.max(0, toInt(message[0], 0)),
          messageID: Math.max(0, toInt(message[1], 0)),
          idType: normalizeText(message[2], "charid"),
        };
      }
      if (!(message && typeof message === "object")) {
        return null;
      }
      return {
        messageType: Math.max(0, toInt(
          message.messageType || message.type || message.notificationType,
          0,
        )),
        messageID: Math.max(0, toInt(
          message.messageID || message.messageId || message.id || message.labelID,
          0,
        )),
        idType: normalizeText(message.idType || message.channel, "charid"),
      };
    })
    .filter((message) => message && message.messageType > 0 && message.messageID > 0)
    .slice(0, SITE_CONTENT_MAX_TRIGGER_NOTIFICATIONS);
}

function normalizeEncounterTriggerAudio(entry) {
  return normalizeMaybeArray(
    (entry && (entry.triggerAudio || entry.triggerAudios || entry.dungeonTriggerAudio)) || [],
  )
    .map((audioEntry) => {
      if (typeof audioEntry === "string") {
        return {
          dungeonID: null,
          audio: normalizeText(audioEntry, ""),
          idType: "shipid",
        };
      }
      if (Array.isArray(audioEntry)) {
        return {
          dungeonID: Math.max(0, toInt(audioEntry[0], 0)) || null,
          audio: normalizeText(audioEntry[1], ""),
          idType: normalizeText(audioEntry[2], "shipid"),
        };
      }
      if (!(audioEntry && typeof audioEntry === "object")) {
        return null;
      }
      return {
        dungeonID: Math.max(0, toInt(
          audioEntry.dungeonID || audioEntry.sourceDungeonID || audioEntry.dungeonId,
          0,
        )) || null,
        audio: normalizeText(audioEntry.audio || audioEntry.sound || audioEntry.event, ""),
        idType: normalizeText(audioEntry.idType || audioEntry.channel, "shipid"),
      };
    })
    .filter((audioEntry) => audioEntry && audioEntry.audio)
    .slice(0, SITE_CONTENT_MAX_TRIGGER_NOTIFICATIONS);
}

const LEGACY_MISSION_NPC_FACTION_MAPPINGS = Object.freeze([
  Object.freeze({
    factionKey: "blood",
    profilePrefix: "parity_blood_raider_pulse_",
    patterns: [
      /\bcorpii\b/i,
      /\bcorpior\b/i,
      /\bcorpum\b/i,
      /\bcorpatis\b/i,
      /\bcorpus\b/i,
      /\bblood raider\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "sansha",
    profilePrefix: "parity_sansha_pulse_",
    patterns: [
      /\bcentii\b/i,
      /\bcentior\b/i,
      /\bcentum\b/i,
      /\bcentus\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "serpentis",
    profilePrefix: "parity_serpentis_blaster_",
    patterns: [
      /\bcoreli\b/i,
      /\bcorelior\b/i,
      /\bcorelum\b/i,
      /\bcorelatis\b/i,
      /\bcore grand admiral\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "angel",
    profilePrefix: "parity_angel_autocannon_",
    patterns: [
      /\bgistii\b/i,
      /\bgistior\b/i,
      /\bgistum\b/i,
      /\bgistatis\b/i,
      /\bgist(?:\s|$)/i,
      /\bangel cartel\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "guristas",
    profilePrefix: "parity_guristas_missile_",
    patterns: [
      /\bpithi\b/i,
      /\bpithior\b/i,
      /\bpithium\b/i,
      /\bpithum\b/i,
      /\bpithatis\b/i,
      /\bpithathis\b/i,
      /\bpith(?:\s|$)/i,
    ],
  }),
]);

function resolveMissionSpawnHullClass(entry = null) {
  const text = [
    normalizeText(entry && entry.label, ""),
    normalizeText(entry && entry.raw, ""),
    ...normalizeArray(entry && entry.candidateNames)
      .map((value) => normalizeText(value, ""))
      .filter(Boolean),
  ]
    .join(" ")
    .toLowerCase();

  if (!text) {
    return "";
  }
  if (/\belite frigates?\b/.test(text)) {
    return "frigate";
  }
  if (/\bfrigates?\b/.test(text)) {
    return "frigate";
  }
  if (/\bdestroyers?\b/.test(text)) {
    return "destroyer";
  }
  if (/\bcruisers?\b/.test(text)) {
    return "cruiser";
  }
  if (/\bbattlecruisers?\b/.test(text)) {
    return "battlecruiser";
  }
  if (/\bbattleships?\b/.test(text)) {
    return "battleship";
  }
  return "";
}

function isLikelyNamedMissionNpcCandidate(candidate = "") {
  const normalized = normalizeText(candidate, "").toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    /\btrue\b/.test(normalized) ||
    /\bshadow\b/.test(normalized) ||
    /\bdread\b/.test(normalized) ||
    /\bdomination\b/.test(normalized) ||
    /\bdark blood\b/.test(normalized) ||
    /\bofficer\b/.test(normalized)
  );
}

function resolveLegacyMissionNpcSpawnQuery(entry = null) {
  const candidateNames = normalizeArray(entry && entry.candidateNames)
    .map((name) => normalizeText(name, ""))
    .filter(Boolean);
  if (candidateNames.some((candidate) => isLikelyNamedMissionNpcCandidate(candidate))) {
    return "";
  }

  const hullClass = resolveMissionSpawnHullClass(entry);
  if (!hullClass) {
    return "";
  }

  const searchText = [
    normalizeText(entry && entry.label, ""),
    normalizeText(entry && entry.raw, ""),
    ...candidateNames,
  ]
    .join(" ")
    .toLowerCase();

  for (const mapping of LEGACY_MISSION_NPC_FACTION_MAPPINGS) {
    if (mapping.patterns.some((pattern) => pattern.test(searchText))) {
      return `${mapping.profilePrefix}${hullClass}`;
    }
  }

  return "";
}

function resolveMissionTemplateFactionKey(template = null) {
  const searchText = [
    normalizeText(template && template.faction, ""),
    normalizeText(template && template.enemyFaction, ""),
    normalizeText(template && template.npcFaction, ""),
  ]
    .join(" ")
    .toLowerCase();
  if (/\bguristas?\b|\bpithi|\bpith\b/.test(searchText)) {
    return "guristas";
  }
  if (/\bblood\b|\bcorpi/.test(searchText)) {
    return "blood";
  }
  if (/\bsansha\b|\bcenti/.test(searchText)) {
    return "sansha";
  }
  if (/\bserpentis\b|\bcoreli/.test(searchText)) {
    return "serpentis";
  }
  if (/\bangel\b|\bgist/.test(searchText)) {
    return "angel";
  }
  return "";
}

function resolveMissionFallbackSpawnQuery(template = null, entry = null) {
  const factionKey = resolveMissionTemplateFactionKey(template);
  const hullClass = resolveMissionSpawnHullClass(entry);
  if (factionKey && hullClass) {
    const factionMapping = LEGACY_MISSION_NPC_FACTION_MAPPINGS
      .find((mapping) => mapping.factionKey === factionKey);
    if (factionMapping) {
      return `${factionMapping.profilePrefix}${hullClass}`;
    }
  }
  return "generic_hostile";
}

// Shared NPC profile-resolution index, built ONCE from the rats catalog (5k+ profiles, each carrying a
// shipTypeID + name + aliases). Lets a mission spawn entry be matched to its EXACT profile by ship typeID
// (imported-log/pack path) or ship name (scrape path), so both paths spawn the correct hull/faction off
// the template data instead of a coarse faction guess. Memoized only once the catalog is populated, so an
// early-startup empty read is retried rather than cached.
let cachedNpcProfileResolutionIndex = null;
function getNpcProfileResolutionIndex() {
  if (cachedNpcProfileResolutionIndex) {
    return cachedNpcProfileResolutionIndex;
  }
  const byShipTypeID = new Map();
  const byName = new Map();
  let profiles = [];
  try {
    profiles = getNpcSpawnService().listNpcProfiles() || [];
  } catch (error) {
    profiles = [];
  }
  for (const profile of profiles) {
    const profileID = normalizeText(profile && profile.profileID, "");
    if (!profileID) {
      continue;
    }
    const shipTypeID = toInt(profile && profile.shipTypeID, 0);
    if (shipTypeID > 0 && !byShipTypeID.has(shipTypeID)) {
      byShipTypeID.set(shipTypeID, profileID);
    }
    for (const token of [profile && profile.name, ...normalizeArray(profile && profile.aliases), profileID]) {
      const normalizedToken = normalizeLowerText(token, "");
      if (normalizedToken && !byName.has(normalizedToken)) {
        byName.set(normalizedToken, profileID);
      }
    }
  }
  const index = { byShipTypeID, byName };
  if (profiles.length > 0) {
    cachedNpcProfileResolutionIndex = index;
  }
  return index;
}

// Resolve a single mission spawn entry to the most specific NPC profile query its own template identity
// supports, in priority order: explicit profile override -> exact ship typeID -> exact ship name -> legacy
// faction+hull mapping -> the caller's fallback (e.g. the encounter's group-level baseProfileID/spawnQuery).
// Drives BOTH the scrape path (candidateNames/label) and the imported-log path (per-NPC typeID).
function resolveSpawnIdentityProfileQuery(entry, fallbackQuery = "") {
  if (!entry || typeof entry !== "object") {
    return fallbackQuery;
  }
  const explicit = normalizeText(entry.spawnQuery, "") || normalizeText(entry.profileID, "");
  if (explicit) {
    return explicit;
  }
  const index = getNpcProfileResolutionIndex();
  const shipTypeID = toInt(entry.typeID, 0) || toInt(entry.shipTypeID, 0);
  if (shipTypeID > 0 && index.byShipTypeID.has(shipTypeID)) {
    return index.byShipTypeID.get(shipTypeID);
  }
  for (const candidate of [entry.label, entry.name, ...normalizeArray(entry.candidateNames)]) {
    const normalizedCandidate = normalizeLowerText(candidate, "");
    if (normalizedCandidate && index.byName.has(normalizedCandidate)) {
      return index.byName.get(normalizedCandidate);
    }
  }
  const legacyQuery = resolveLegacyMissionNpcSpawnQuery(entry);
  if (legacyQuery) {
    return legacyQuery;
  }
  return fallbackQuery;
}

function normalizeMissionSpawnQuery(entry = null) {
  const candidateNames = normalizeArray(entry && entry.candidateNames)
    .map((name) => normalizeText(name, ""))
    .filter(Boolean);
  const label = normalizeText(entry && entry.label, "");
  const raw = normalizeText(entry && entry.raw, "");
  // Scrape path: a known pirate faction + hull class maps to a clean parity profile; otherwise the raw
  // ship name flows through to live NPC selection, which resolves it to the exact catalog profile by name
  // (so unmapped factions — e.g. Rogue Drones — still spawn correctly off the template's ship names).
  const legacyMissionSpawnQuery = resolveLegacyMissionNpcSpawnQuery(entry);
  if (legacyMissionSpawnQuery) {
    return legacyMissionSpawnQuery;
  }
  const candidates = [
    ...candidateNames,
    label,
    raw,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (!/\bfrigates?\b|\bcruisers?\b|\bbattlecruisers?\b|\bbattleships?\b|\belite frigates?\b/i.test(candidate)) {
      return candidate;
    }
  }
  const fallbackCandidate = candidates[0] || "";
  return fallbackCandidate.replace(/\b(Fighters|Frigates|Cruisers|Battlecruisers|Battleships)\b$/, (match) => (
    match.endsWith("s") ? match.slice(0, -1) : match
  ));
}

function buildMissionDerivedObjectiveMarkers(template) {
  const objectiveHints = normalizeArray(template && template.objectiveHints)
    .map((entry) => normalizeText(entry && (entry.label || entry.text || entry.raw || entry), ""))
    .filter(Boolean);
  const advisory = normalizeObject(template && template.advisory);
  const markers = objectiveHints.map((label, index) => ({
    role: index <= 0 ? "objective" : "task",
    label,
    analyzer: /\bhack|analyzer|databank|mainframe\b/i.test(label)
      ? "data"
      : /\bsalvage|relic|archaeolog/i.test(label)
        ? "relic"
        : null,
  }));
  if (markers.length <= 0) {
    markers.push({ role: "objective", label: "Complete mission objectives" });
  }
  if (normalizeText(advisory.webScramble, "")) {
    markers.push({ role: "task", label: "Watch for tackle ships" });
  }
  return markers;
}

function buildMissionDerivedEnvironmentProps(template) {
  const rooms = normalizeArray(template && template.rooms);
  const candidates = [];
  for (const room of rooms) {
    const entries = [
      ...normalizeArray(room && room.spawnEntries),
      ...normalizeArray(room && room.groups).flatMap((group) => normalizeArray(group && group.spawnEntries)),
    ];
    for (const entry of entries) {
      if (normalizeLowerText(entry && entry.entityKind, "") !== "structure") {
        continue;
      }
      const typeNameCandidates = [
        ...normalizeArray(entry && entry.candidateNames)
          .map((name) => normalizeText(name, ""))
          .filter(Boolean),
        normalizeText(entry && entry.label, ""),
      ].filter(Boolean);
      if (typeNameCandidates.length <= 0) {
        continue;
      }
      candidates.push({
        typeNameCandidates: [...new Set(typeNameCandidates)],
        label: normalizeText(entry && entry.label, "") || null,
      });
    }
  }
  return candidates;
}

function buildMissionDerivedEncounterPlans(template) {
  const rooms = normalizeArray(template && template.rooms);
  const encounterPlans = [];
  let waveIndex = 1;

  // Rooms reached through an acceleration gate spawn their encounters on gate activation
  // (on_room_active), not on warp-in (on_load) — this is what gives mission sites the retail
  // "warp in to an empty gate, activate, then fight the pocket" flow.
  const gateDestinationRoomKeys = new Set(
    normalizeArray(template && template.siteSceneProfile && template.siteSceneProfile.gateProfiles)
      .map((gateProfile) => normalizeText(gateProfile && gateProfile.destinationRoomKey, ""))
      .filter(Boolean),
  );

  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex];
    const roomKey = buildMissionRoomKey(room, roomIndex);
    const roomIsBehindGate = gateDestinationRoomKeys.has(roomKey);
    // Fallback trigger ladder for scraped missions: first group enters through the room trigger;
    // later groups chain on wave_cleared unless the scrape says they spawn with an earlier group.
    const roomTrigger = roomIsBehindGate
      ? "on_room_active"
      : (roomIndex === 0 ? "on_load" : "wave_cleared");
    const groups = normalizeArray(room && room.groups);
    const groupedEntries = groups.length > 0
      ? groups.map((group, index) => ({
          key: normalizeText(group && group.groupId, "") || `group_${index + 1}`,
          title: normalizeText(group && group.title, ""),
          groupNumber: parseMissionGroupNumber(group, index + 1),
          notes: normalizeArray(group && group.notes),
          spawnEntries: normalizeArray(group && group.spawnEntries),
        }))
      : [{
          key: "room",
          title: normalizeText(room && room.title, "Room"),
          groupNumber: 1,
          notes: normalizeArray(room && room.notes),
          spawnEntries: normalizeArray(room && room.spawnEntries),
        }];

    const waveIndexByGroupNumber = new Map();
    const triggerByWaveIndex = new Map();
    let hasSpawnedGroupInRoom = false;
    for (const group of groupedEntries) {
      const npcEntries = normalizeArray(group && group.spawnEntries)
        .filter((entry) => normalizeLowerText(entry && entry.entityKind, "") === "npc");
      if (npcEntries.length <= 0) {
        continue;
      }
      const sameWaveGroupNumber = parseMissionSameWaveGroupNumber(group);
      const referencedWaveIndex = sameWaveGroupNumber > 0
        ? waveIndexByGroupNumber.get(sameWaveGroupNumber)
        : 0;
      const groupWaveIndex = referencedWaveIndex || waveIndex;
      const trigger = referencedWaveIndex
        ? normalizeText(triggerByWaveIndex.get(groupWaveIndex), roomTrigger)
        : (hasSpawnedGroupInRoom ? "wave_cleared" : roomTrigger);
      waveIndexByGroupNumber.set(group.groupNumber, groupWaveIndex);
      triggerByWaveIndex.set(groupWaveIndex, trigger);
      if (!referencedWaveIndex) {
        waveIndex += 1;
      }
      hasSpawnedGroupInRoom = true;
      for (let entryIndex = 0; entryIndex < npcEntries.length; entryIndex += 1) {
        const entry = npcEntries[entryIndex];
        const spawnQuery = normalizeMissionSpawnQuery(entry) || "npc_hostiles";
        encounterPlans.push({
          key: normalizeText(
            `${roomKey}:${normalizeText(group && group.key, "group")}:${entryIndex + 1}`,
            `mission_wave_${groupWaveIndex}_${entryIndex + 1}`,
          ).toLowerCase().replace(/[^a-z0-9:._-]+/g, "_"),
          label: normalizeText(entry && entry.label, "") || `Encounter Wave ${groupWaveIndex}`,
          supported: true,
          spawnQuery,
          fallbackSpawnQuery: resolveMissionFallbackSpawnQuery(template, entry),
          amount: normalizeMissionSpawnCount(entry),
          deadspace: true,
          trigger,
          waveIndex: groupWaveIndex,
          roomKey,
          notes: normalizeArray(group && group.notes)
            .map((note) => normalizeText(note, ""))
            .filter(Boolean),
          sourceGroupID: normalizeText(group && group.key, "") || null,
          sourceGroupTitle: normalizeText(group && group.title, "") || null,
        });
      }
    }
  }

  return encounterPlans;
}

function buildDerivedMissionPopulationHints(template) {
  if (normalizeLowerText(template && template.siteFamily, "") !== "mission") {
    return null;
  }
  const encounters = buildMissionDerivedEncounterPlans(template);
  const environmentProps = buildMissionDerivedEnvironmentProps(template);
  const objectiveMarkers = buildMissionDerivedObjectiveMarkers(template);
  return {
    source: "mission_runtime_derived",
    roomCount: normalizeArray(template && template.rooms).length,
    encounter:
      encounters.length === 1
        ? cloneValue(encounters[0])
        : null,
    encounters,
    environmentProps,
    objectiveMarkers,
  };
}

function mergeDerivedMissionPopulationHints(baseHints, derivedHints) {
  if (!derivedHints) {
    return baseHints ? cloneValue(baseHints) : null;
  }
  const merged = {
    ...(baseHints ? cloneValue(baseHints) : {}),
    source: normalizeText(
      baseHints && baseHints.source,
      normalizeText(derivedHints && derivedHints.source, "mission_runtime_derived"),
    ),
    roomCount: Math.max(
      toInt(baseHints && baseHints.roomCount, 0),
      toInt(derivedHints && derivedHints.roomCount, 0),
    ),
    encounter:
      normalizeObject(baseHints && baseHints.encounter).supported !== undefined
        ? cloneValue(baseHints.encounter)
        : cloneValue(derivedHints.encounter),
    encounters: [
      ...normalizeArray(baseHints && baseHints.encounters),
      ...normalizeArray(derivedHints && derivedHints.encounters),
    ],
    environmentProps: [
      ...normalizeArray(baseHints && baseHints.environmentProps),
      ...normalizeArray(derivedHints && derivedHints.environmentProps),
    ],
    objectiveMarkers: [
      ...normalizeArray(baseHints && baseHints.objectiveMarkers),
      ...normalizeArray(derivedHints && derivedHints.objectiveMarkers),
    ],
  };
  return merged;
}

function resolvePopulationHints(instance, template) {
  const spawnHints =
    instance &&
    instance.spawnState &&
    typeof instance.spawnState === "object" &&
    instance.spawnState.populationHints &&
    typeof instance.spawnState.populationHints === "object"
      ? instance.spawnState.populationHints
      : null;
  if (spawnHints) {
    return cloneValue(spawnHints);
  }
  const templateHints =
    template &&
    template.populationHints &&
    typeof template.populationHints === "object"
      ? template.populationHints
      : null;
  const baseHints = templateHints ? cloneValue(templateHints) : null;
  if (normalizeLowerText(template && template.siteFamily, "") !== "mission") {
    return baseHints;
  }
  return mergeDerivedMissionPopulationHints(baseHints, buildDerivedMissionPopulationHints(template));
}

function resolveEncounterPlans(populationHints) {
  const explicitPlans = normalizeArray(populationHints && populationHints.encounters)
    .filter((entry) => entry && typeof entry === "object");
  const fallbackPlan =
    populationHints &&
    populationHints.encounter &&
    typeof populationHints.encounter === "object"
      ? [populationHints.encounter]
      : [];
  const normalizedPlans = (explicitPlans.length > 0 ? explicitPlans : fallbackPlan)
    .map((entry, index) => {
      // Log-sourced ("TQ pack") encounters describe their NPCs as baseProfileID + an explicit
      // spawnEntries[] (per-NPC typeID/position/AI); simpler authored data only carries
      // spawnQuery + amount. Fall back across both so either shape survives the plan filter below.
      const spawnEntries = normalizeArray(entry && entry.spawnEntries)
        .filter((spawnEntry) => spawnEntry && typeof spawnEntry === "object");
      const spawnQuery =
        normalizeText(entry && entry.spawnQuery, "") ||
        normalizeText(entry && entry.baseProfileID, "") ||
        normalizeText(entry && entry.profileID, "");
      const amount =
        Math.max(0, toInt(entry && entry.amount, 0)) ||
        spawnEntries.length ||
        Math.max(0, toInt(entry && entry.count, 0));
      return {
        key: normalizeText(entry && entry.key, "") || `encounter_${index + 1}`,
        label: normalizeText(entry && entry.label, "") || `Encounter ${index + 1}`,
        supported: entry && entry.supported !== false,
        spawnQuery,
        amount,
        spawnEntries,
        exact: entry && entry.exact === true,
        fallbackSpawnQuery: normalizeText(entry && entry.fallbackSpawnQuery, "") || null,
        maxSpawnEntries: Math.max(0, toInt(
          entry && (entry.maxSpawnEntries || entry.maxExactSpawnEntries || entry.maxEncounterNpcs),
          0,
        )) || null,
        deadspace: entry && entry.deadspace === true,
        trigger: normalizeLowerText(entry && entry.trigger, "on_load"),
        triggerMessages: normalizeEncounterTriggerMessages(entry),
        triggerAudio: normalizeEncounterTriggerAudio(entry),
        proximityTargetKey: normalizeText(entry && entry.proximityTargetKey, "") || null,
        proximityRangeMeters:
          Math.max(0, toFiniteNumber(entry && entry.proximityRangeMeters, 0)) || null,
        countdownSeconds: Math.max(0, toInt(entry && entry.countdownSeconds, 0)) || null,
        delaySeconds: Math.max(0, toInt(entry && entry.delaySeconds, 0)) || null,
        waveIndex: Math.max(1, toInt(entry && entry.waveIndex, index + 1)),
        prerequisiteKey: normalizeText(entry && entry.prerequisiteKey, "") || null,
        lootProfile: normalizeText(entry && entry.lootProfile, "") || null,
        lootTags: normalizeArray(entry && entry.lootTags)
          .map((tag) => normalizeLowerText(tag, ""))
          .filter(Boolean),
        notes: normalizeArray(entry && entry.notes)
          .map((note) => normalizeText(note, ""))
          .filter(Boolean),
        roomKey: normalizeText(entry && entry.roomKey, "") || null,
        sourceGroupID: normalizeText(entry && entry.sourceGroupID, "") || null,
        sourceGroupTitle: normalizeText(entry && entry.sourceGroupTitle, "") || null,
        objective: entry && entry.objective === true,
        completionRole: normalizeLowerText(entry && entry.completionRole, "") || null,
      };
    })
    .filter((entry) => entry.spawnQuery && entry.amount > 0);
  return normalizedPlans;
}

function listOrderedInstanceRoomKeys(instance) {
  const roomStatesByKey =
    instance &&
    instance.roomStatesByKey &&
    typeof instance.roomStatesByKey === "object"
      ? instance.roomStatesByKey
      : {};
  const dynamicRoomKeys = Object.keys(roomStatesByKey)
    .filter((roomKey) => roomKey && roomKey !== "room:entry")
    .sort((left, right) => toInt(left.split(":").pop(), 0) - toInt(right.split(":").pop(), 0));
  return ["room:entry", ...dynamicRoomKeys];
}

function listOrderedInstanceGateKeys(instance) {
  const gateStatesByKey =
    instance &&
    instance.gateStatesByKey &&
    typeof instance.gateStatesByKey === "object"
      ? instance.gateStatesByKey
      : {};
  return Object.keys(gateStatesByKey)
    .sort((left, right) => {
      const leftState = gateStatesByKey[left] || {};
      const rightState = gateStatesByKey[right] || {};
      return (
        toInt(leftState && leftState.metadata && leftState.metadata.connectionIndex, 0) -
        toInt(rightState && rightState.metadata && rightState.metadata.connectionIndex, 0)
      ) || left.localeCompare(right);
    });
}

function resolveEncounterRoomKey(instance, populationHints, encounterPlan) {
  const explicitRoomKey = normalizeText(encounterPlan && encounterPlan.roomKey, "");
  if (explicitRoomKey) {
    return explicitRoomKey;
  }
  const orderedRoomKeys = listOrderedInstanceRoomKeys(instance);
  if (orderedRoomKeys.length <= 1) {
    return "room:entry";
  }
  const orderedPlans = resolveEncounterPlans(populationHints)
    .sort((left, right) => (
      Math.max(1, toInt(left && left.waveIndex, 1)) - Math.max(1, toInt(right && right.waveIndex, 1))
    ) || normalizeText(left && left.key, "").localeCompare(normalizeText(right && right.key, "")));
  const planKey = normalizeText(encounterPlan && encounterPlan.key, "");
  const planIndex = Math.max(0, orderedPlans.findIndex((plan) => normalizeText(plan && plan.key, "") === planKey));
  const roomIndex = Math.min(
    orderedRoomKeys.length - 1,
    Math.floor((planIndex * orderedRoomKeys.length) / Math.max(1, orderedPlans.length)),
  );
  return orderedRoomKeys[roomIndex] || "room:entry";
}

function groupEncounterPlansByRoom(instance, populationHints) {
  const grouped = {};
  const orderedPlans = resolveEncounterPlans(populationHints)
    .sort((left, right) => (
      Math.max(1, toInt(left && left.waveIndex, 1)) - Math.max(1, toInt(right && right.waveIndex, 1))
    ) || normalizeText(left && left.key, "").localeCompare(normalizeText(right && right.key, "")));
  for (const plan of orderedPlans) {
    const roomKey = resolveEncounterRoomKey(instance, populationHints, plan);
    if (!grouped[roomKey]) {
      grouped[roomKey] = [];
    }
    grouped[roomKey].push(plan);
  }
  return grouped;
}

function getEncounterStateByKey(instance, planKey) {
  return normalizeObject(
    instance &&
    instance.spawnState &&
    instance.spawnState.encounterStatesByKey &&
    instance.spawnState.encounterStatesByKey[planKey],
  );
}

function isEncounterPlanSettled(instance, plan) {
  const state = getEncounterStateByKey(instance, plan && plan.key);
  const spawnedAtMs = Math.max(0, toInt(state && state.spawnedAtMs, 0));
  if (spawnedAtMs <= 0) {
    return false;
  }
  return (
    Math.max(0, toInt(state && state.completedAtMs, 0)) > 0 ||
    normalizeIDList(state && state.remainingEntityIDs).length <= 0
  );
}

function normalizeCompletionHints(populationHints) {
  const completion =
    populationHints &&
    populationHints.completion &&
    typeof populationHints.completion === "object"
      ? populationHints.completion
      : {};
  return {
    ...cloneValue(completion),
    // Objective metadata (used by non-kill objective modes: investigate/hack/mine/etc.). The
    // interaction/mining handlers report explicit progress; until then, encounter-clear is the
    // fallback. completeOnEncounterClear defaults true and is only disabled when explicitly false.
    objectiveMode: normalizeLowerText(
      completion.objectiveMode || (populationHints && populationHints.objectiveMode),
      "",
    ) || null,
    completeOnEncounterClear:
      completion.completeObjectiveOnEncounterClear === false ||
      (populationHints && populationHints.completeObjectiveOnEncounterClear === false)
        ? false
        : true,
    mode: normalizeLowerText(
      completion.mode || completion.completionMode,
      "",
    ) || null,
    encounterKeys: normalizeArray(
      completion.encounterKeys ||
      completion.encounterKey ||
      completion.groupKeys ||
      completion.groupKey ||
      completion.objectiveEncounterKeys ||
      completion.objectiveEncounterKey,
    )
      .map((entry) => normalizeText(entry, ""))
      .filter(Boolean),
    objectiveTargets: normalizeArray(
      completion.objectiveTargets ||
      completion.objectiveTarget ||
      completion.destroyTargets ||
      completion.destroyTarget ||
      completion.targetObjects ||
      completion.targetObject,
    )
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        key: normalizeText(entry.key, "") || null,
        label: normalizeText(entry.label || entry.name, "") || null,
        typeID: Math.max(0, toInt(entry.typeID, 0)) || null,
        dunObjectID: Math.max(0, toInt(entry.dunObjectID, 0)) || null,
        dunObjectNameID: Math.max(0, toInt(entry.dunObjectNameID, 0)) || null,
        nameID: Math.max(0, toInt(entry.nameID, 0)) || null,
      }))
      .filter((entry) => (
        entry.key ||
        entry.label ||
        entry.typeID ||
        entry.dunObjectID ||
        entry.dunObjectNameID ||
        entry.nameID
      )),
  };
}

function entityOrSpawnEntryMatchesObjectiveTarget(candidate, target) {
  if (!candidate || !target) {
    return false;
  }
  const targetKey = normalizeText(target.key, "");
  if (
    targetKey &&
    normalizeText(candidate.key || candidate.dungeonSiteContentKey || candidate.dungeonObjectiveTargetKey, "") === targetKey
  ) {
    return true;
  }
  const targetDunObjectID = Math.max(0, toInt(target.dunObjectID, 0));
  if (
    targetDunObjectID > 0 &&
    Math.max(0, toInt(candidate.dunObjectID, 0)) === targetDunObjectID
  ) {
    return true;
  }
  const targetNameID = Math.max(0, toInt(target.nameID || target.dunObjectNameID, 0));
  if (
    targetNameID > 0 &&
    (
      Math.max(0, toInt(candidate.nameID, 0)) === targetNameID ||
      Math.max(0, toInt(candidate.dunObjectNameID, 0)) === targetNameID
    )
  ) {
    return true;
  }
  const targetTypeID = Math.max(0, toInt(target.typeID, 0));
  if (
    targetTypeID > 0 &&
    Math.max(0, toInt(candidate.typeID, 0)) === targetTypeID
  ) {
    const targetLabel = normalizeLowerText(target.label, "");
    if (!targetLabel) {
      return true;
    }
    const candidateLabel = normalizeLowerText(candidate.label || candidate.name || candidate.itemName || candidate.slimName, "");
    if (candidateLabel && candidateLabel === targetLabel) {
      return true;
    }
  }
  return false;
}

function isObjectiveTargetSpawnEntry(spawnEntry, encounterPlan, completion) {
  if (!spawnEntry || typeof spawnEntry !== "object") {
    return false;
  }
  if (
    spawnEntry.objective === true ||
    spawnEntry.objectiveTarget === true ||
    spawnEntry.blocksObjectiveProgress === true
  ) {
    return true;
  }
  const completionRole = normalizeLowerText(
    (spawnEntry && spawnEntry.completionRole) ||
      (encounterPlan && encounterPlan.completionRole),
    "",
  );
  if (completionRole === "objective") {
    return true;
  }
  return normalizeArray(completion && completion.objectiveTargets)
    .some((target) => entityOrSpawnEntryMatchesObjectiveTarget(spawnEntry, target));
}

function resolveCompletionEncounterKeys(completion, plans) {
  const explicitKeys = new Set(
    normalizeArray(completion && completion.encounterKeys)
      .map((entry) => normalizeText(entry, ""))
      .filter(Boolean),
  );
  for (const plan of plans) {
    const planKey = normalizeText(plan && plan.key, "");
    if (!planKey) {
      continue;
    }
    if (
      plan.objective === true ||
      normalizeLowerText(plan && plan.completionRole, "") === "objective"
    ) {
      explicitKeys.add(planKey);
    }
  }
  return [...explicitKeys];
}

function isSiteObjectiveExplicitlySatisfied(instance) {
  return Math.max(0, toInt(instance && instance.objectiveSatisfiedAtMs, 0)) > 0 ||
    Math.max(0, toInt(instance && instance.metadata && instance.metadata.objectiveSatisfiedAtMs, 0)) > 0;
}

function isEncounterCompletionSatisfied(instance, plans, populationHints) {
  if (!instance || !Array.isArray(plans) || plans.length <= 0) {
    return false;
  }
  const completion = normalizeCompletionHints(populationHints);
  // Explicit objective satisfaction (set by interactable/mining objective handlers, B2/C) completes
  // the site regardless of remaining encounters — the hook for non-kill objective modes. Until those
  // report progress, encounter-clear is the fallback unless the author disabled it.
  if (isSiteObjectiveExplicitlySatisfied(instance)) {
    return true;
  }
  if (completion.completeOnEncounterClear === false) {
    return false;
  }
  const mode = normalizeLowerText(completion && completion.mode, "");
  if (
    mode === "objective_target_destroyed" ||
    mode === "objective_targets_destroyed" ||
    mode === "destroy_objective_target" ||
    mode === "destroy_objective_targets"
  ) {
    return false;
  }
  const completionKeys = resolveCompletionEncounterKeys(completion, plans);
  if (
    completionKeys.length > 0 ||
    mode === "encounter_group_cleared" ||
    mode === "encounter_groups_cleared" ||
    mode === "objective_group_cleared"
  ) {
    const targetKeys = completionKeys.length > 0
      ? completionKeys
      : plans.map((plan) => normalizeText(plan && plan.key, "")).filter(Boolean);
    return targetKeys.every((planKey) => {
      const plan = plans.find((entry) => normalizeText(entry && entry.key, "") === planKey);
      return plan && isEncounterPlanSettled(instance, plan);
    });
  }
  return plans.every((plan) => isEncounterPlanSettled(instance, plan));
}

function areSortedNumberListsEqual(left, right) {
  const normalizedLeft = normalizeIDList(left);
  const normalizedRight = normalizeIDList(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) {
      return false;
    }
  }
  return true;
}

function upsertEncounterState(instanceID, planKey, patch = {}, options = {}) {
  const existing = dungeonRuntime.getInstance(instanceID);
  if (!existing) {
    return null;
  }
  const encounterStatesByKey = normalizeObject(
    existing.spawnState && existing.spawnState.encounterStatesByKey,
  );
  return dungeonRuntime.mergeSpawnState(instanceID, {
    encounterStatesByKey: {
      ...encounterStatesByKey,
      [planKey]: {
        ...normalizeObject(encounterStatesByKey[planKey]),
        ...(patch && typeof patch === "object" ? cloneValue(patch) : {}),
        key: planKey,
      },
    },
  }, options);
}

function resolveEncounterPrerequisiteKeys(plans, encounterPlan) {
  const explicitKey = normalizeText(encounterPlan && encounterPlan.prerequisiteKey, "");
  if (explicitKey) {
    return [explicitKey];
  }
  const currentWaveIndex = Math.max(1, toInt(encounterPlan && encounterPlan.waveIndex, 1));
  let prerequisiteWaveIndex = 0;
  for (const plan of normalizeArray(plans)) {
    if (!plan || !normalizeText(plan.key, "")) {
      continue;
    }
    if (normalizeText(plan.key, "") === normalizeText(encounterPlan && encounterPlan.key, "")) {
      continue;
    }
    const planWaveIndex = Math.max(1, toInt(plan.waveIndex, 1));
    if (planWaveIndex < currentWaveIndex && planWaveIndex > prerequisiteWaveIndex) {
      prerequisiteWaveIndex = planWaveIndex;
    }
  }
  if (prerequisiteWaveIndex <= 0) {
    return [];
  }
  const priorPlans = normalizeArray(plans)
    .filter((plan) => (
      plan &&
      normalizeText(plan.key, "") &&
      normalizeText(plan.key, "") !== normalizeText(encounterPlan && encounterPlan.key, "") &&
      Math.max(1, toInt(plan.waveIndex, 1)) === prerequisiteWaveIndex
    ))
    .sort((left, right) => (
      Math.max(1, toInt(left && left.waveIndex, 1)) - Math.max(1, toInt(right && right.waveIndex, 1)) ||
      normalizeText(left && left.key, "").localeCompare(normalizeText(right && right.key, ""))
    ));
  return priorPlans
    .map((plan) => normalizeText(plan && plan.key, ""))
    .filter(Boolean);
}

function encounterPlanHasNpcProgressEntries(encounterPlan) {
  const spawnEntries = normalizeArray(encounterPlan && encounterPlan.spawnEntries)
    .filter((entry) => entry && typeof entry === "object");
  if (spawnEntries.length <= 0) {
    return true;
  }
  return spawnEntries.some((entry) => !isKillableStructureSpawnEntry(entry));
}

function listAliveEncounterEntityIDs(scene, encounterState, encounterPlan = null) {
  const nonBlockingEntityIDs = new Set(normalizeIDList(
    encounterState && encounterState.nonBlockingEntityIDs,
  ));
  const hasNpcProgressEntries = encounterPlanHasNpcProgressEntries(encounterPlan);
  const seededEntityIDs = normalizeIDList(
    encounterState &&
    (
      encounterState.remainingEntityIDs ||
      encounterState.spawnedEntityIDs
    ),
  )
    .filter((entityID) => !nonBlockingEntityIDs.has(entityID));
  if (!scene) {
    return seededEntityIDs;
  }
  return seededEntityIDs.filter((entityID) => {
    if (scene.dynamicEntities instanceof Map && scene.dynamicEntities.has(entityID)) {
      return true;
    }
    const staticEntity = scene.staticEntitiesByID instanceof Map
      ? scene.staticEntitiesByID.get(entityID)
      : null;
    if (!staticEntity) {
      return false;
    }
    if (staticEntity.dungeonEncounterBlocksProgress === false) {
      return false;
    }
    if (
      hasNpcProgressEntries &&
      staticEntity.dungeonMaterializedKillableStructure === true &&
      !Object.prototype.hasOwnProperty.call(staticEntity, "dungeonEncounterBlocksProgress")
    ) {
      return false;
    }
    const conditionState = normalizeObject(staticEntity && staticEntity.conditionState);
    return toFiniteNumber(conditionState.damage, 0) < 1;
  });
}

function syncEncounterStateProgress(scene, instance, plans, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let completedCount = 0;
  let updatedCount = 0;
  for (const plan of normalizeArray(plans)) {
    const planKey = normalizeText(plan && plan.key, "");
    if (!planKey) {
      continue;
    }
    const encounterState = getEncounterStateByKey(instance, planKey);
    const spawnedAtMs = Math.max(0, toInt(encounterState && encounterState.spawnedAtMs, 0));
    if (spawnedAtMs <= 0) {
      continue;
    }
    const completedAtMs = Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0));
    const aliveEntityIDs = listAliveEncounterEntityIDs(scene, encounterState, plan);
    const patch = {};
    if (!areSortedNumberListsEqual(encounterState && encounterState.remainingEntityIDs, aliveEntityIDs)) {
      patch.remainingEntityIDs = aliveEntityIDs;
    }
    if (aliveEntityIDs.length <= 0 && completedAtMs <= 0) {
      patch.completedAtMs = nowMs;
      completedCount += 1;
    }
    if (Object.keys(patch).length <= 0) {
      continue;
    }
    upsertEncounterState(instance.instanceID, planKey, patch, { nowMs });
    updatedCount += 1;
  }
  return {
    completedCount,
    updatedCount,
  };
}

function rehydrateMissingEncounterStates(scene, instance, populationHints, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let workingInstance = instance;
  let resetCount = 0;
  for (const plan of resolveEncounterPlans(populationHints)) {
    const planKey = normalizeText(plan && plan.key, "");
    if (!planKey) {
      continue;
    }
    const encounterState = getEncounterStateByKey(workingInstance, planKey);
    const spawnedAtMs = Math.max(0, toInt(encounterState && encounterState.spawnedAtMs, 0));
    const completedAtMs = Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0));
    if (spawnedAtMs <= 0 || completedAtMs > 0) {
      continue;
    }
    const aliveEntityIDs = listAliveEncounterEntityIDs(scene, encounterState, plan);
    if (aliveEntityIDs.length > 0) {
      if (!areSortedNumberListsEqual(encounterState && encounterState.remainingEntityIDs, aliveEntityIDs)) {
        workingInstance = upsertEncounterState(workingInstance.instanceID, planKey, {
          remainingEntityIDs: aliveEntityIDs,
        }, { nowMs });
      }
      continue;
    }
    workingInstance = upsertEncounterState(workingInstance.instanceID, planKey, {
      spawnedAtMs: 0,
      spawnCount: 0,
      spawnedEntityIDs: [],
      remainingEntityIDs: [],
      lastRehydratedAtMs: nowMs,
    }, { nowMs });
    resetCount += 1;
  }
  return {
    instance: workingInstance,
    resetCount,
  };
}

function resolveObjectiveLabel(objective, objectiveType) {
  return humanizeIdentifier(
    objective && objective.title,
    humanizeIdentifier(
      objectiveType && objectiveType.title,
      humanizeIdentifier(objective && objective.key, "Objective"),
    ),
  );
}

function resolveObjectiveTaskLabel(task, taskType) {
  return humanizeIdentifier(
    taskType && taskType.title,
    humanizeIdentifier(task && task.key, "Task"),
  );
}

function normalizeObjectiveMarkerHintEntries(entries) {
  const normalized = [];
  const seen = new Set();
  for (const entry of normalizeArray(entries)) {
    if (!(entry && typeof entry === "object")) {
      continue;
    }
    const role = normalizeLowerText(entry.role, "");
    const label = normalizeText(entry.label, "");
    if (!role || !label) {
      continue;
    }
    const analyzer = normalizeLowerText(entry.analyzer, "") || null;
    const icon = normalizeText(entry.icon, "") || null;
    const key = normalizeText(entry.key, "") ||
      label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const dedupeKey = `${role}:${label}:${analyzer || ""}:${icon || ""}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push({
      role,
      label,
      objectiveKey: key,
      objectiveTypeID: null,
      objectiveTaskTypeID: null,
      icon,
      analyzer,
    });
  }
  return normalized;
}

function buildFallbackPopulationObjectiveMarkers(populationHints, template) {
  const family = normalizeLowerText(template && template.siteFamily, "unknown");
  const containers = normalizeArray(populationHints && populationHints.containers)
    .filter((entry) => entry && typeof entry === "object");
  const hazards = normalizeArray(populationHints && populationHints.hazards);
  const encounters = resolveEncounterPlans(populationHints);
  const resources =
    populationHints && populationHints.resources && typeof populationHints.resources === "object"
      ? populationHints.resources
      : {};
  const markers = [];
  switch (family) {
    case "data":
      markers.push(
        { role: "objective", label: "Hack research caches", analyzer: "data" },
        { role: "task", label: "Recover site intelligence", analyzer: "data" },
      );
      break;
    case "relic":
      markers.push(
        { role: "objective", label: "Recover archaeology caches", analyzer: "relic" },
        { role: "task", label: "Salvage relic materials", analyzer: "relic" },
      );
      break;
    case "ghost":
      markers.push(
        { role: "objective", label: "Hack covert research caches", analyzer: "data" },
        { role: "task", label: "Beat the response timer", analyzer: "data" },
      );
      break;
    case "combat":
      markers.push({ role: "objective", label: "Eliminate hostile defenders" });
      break;
    case "combat_hacking":
      markers.push(
        { role: "objective", label: "Hack the facility network", analyzer: "data" },
        { role: "task", label: "Defeat security reinforcements" },
      );
      break;
    case "gas":
      markers.push({ role: "objective", label: "Harvest gas clouds" });
      break;
    case "ore":
      markers.push({ role: "objective", label: "Mine resource deposits" });
      break;
    default:
      break;
  }
  if (
    encounters.length > 0 &&
    family !== "combat"
  ) {
    markers.push({ role: "task", label: "Neutralize site defenders" });
  }
  if (hazards.some((entry) => normalizeLowerText(entry && entry.kind || entry, "").includes("ghost_site"))) {
    markers.push({ role: "task", label: "Avoid cache detonation", analyzer: "data" });
  }
  if (containers.some((entry) => normalizeLowerText(entry && entry.analyzer, "") === "data")) {
    markers.push({ role: "task", label: "Open data containers", analyzer: "data" });
  }
  if (containers.some((entry) => normalizeLowerText(entry && entry.analyzer, "") === "relic")) {
    markers.push({ role: "task", label: "Open relic containers", analyzer: "relic" });
  }
  if (normalizeArray(resources.gasTypeIDs).length > 0 && family !== "gas") {
    markers.push({ role: "task", label: "Harvest gas resources" });
  }
  if (
    normalizeArray(resources.oreTypeIDs).length > 0 ||
    normalizeArray(resources.iceTypeIDs).length > 0
  ) {
    markers.push({ role: "task", label: "Extract mineable resources" });
  }
  return normalizeObjectiveMarkerHintEntries(markers);
}

function resolvePopulationObjectiveMarkers(populationHints, template) {
  const explicitMarkers = normalizeObjectiveMarkerHintEntries(
    populationHints && populationHints.objectiveMarkers,
  );
  if (explicitMarkers.length > 0) {
    return explicitMarkers;
  }
  return buildFallbackPopulationObjectiveMarkers(populationHints, template);
}

function buildContentOffset(seed, index, total, options = {}) {
  const baseDistance = Math.max(
    2500,
    toFiniteNumber(options.baseDistanceMeters, SITE_CONTENT_CONTAINER_RING_METERS),
  );
  const jitterMeters = Math.max(
    0,
    toFiniteNumber(options.jitterMeters, SITE_CONTENT_CONTAINER_JITTER_METERS),
  );
  const count = Math.max(1, toInt(total, 1));
  const angleBase = ((index % count) / count) * Math.PI * 2;
  const angleJitter = ((hashText(`${seed}:angle:${index}`) % 2001) - 1000) / 1000 * 0.18;
  const distance = baseDistance +
    ((((hashText(`${seed}:distance:${index}`) % 2001) - 1000) / 1000) * jitterMeters);
  const vertical = ((((hashText(`${seed}:vertical:${index}`) % 2001) - 1000) / 1000) * 1200);
  const angle = angleBase + angleJitter;
  return {
    x: Math.cos(angle) * distance,
    y: vertical,
    z: Math.sin(angle) * distance,
  };
}

function isManagedUniverseSiteInstance(instance) {
  return Boolean(
    instance &&
    instance.runtimeFlags &&
    instance.runtimeFlags.universeSeeded === true &&
    instance.runtimeFlags.generatedMining !== true &&
    (
      normalizeLowerText(instance.siteKind, "signature") === "signature" ||
      normalizeLowerText(instance.siteKind, "signature") === "anomaly"
    ),
  );
}

function isManagedMissionSiteInstance(instance) {
  return Boolean(
    instance &&
    instance.runtimeFlags &&
    instance.runtimeFlags.missionRuntime === true,
  );
}

function isMissionLikeSiteInstance(instance, template = null) {
  const runtimeFlags = normalizeObject(instance && instance.runtimeFlags);
  const metadata = normalizeObject(instance && instance.metadata);
  return (
    runtimeFlags.missionRuntime === true ||
    metadata.missionRuntime === true ||
    normalizeLowerText(instance && instance.siteFamily, "") === "mission" ||
    normalizeLowerText(template && template.siteFamily, "") === "mission"
  );
}

function isManagedMaterializedSiteInstance(instance) {
  return isManagedUniverseSiteInstance(instance) || isManagedMissionSiteInstance(instance);
}

function resolveEntityLabel(instance, template) {
  const metadata = instance && instance.metadata && typeof instance.metadata === "object"
    ? instance.metadata
    : {};
  const spawnState = instance && instance.spawnState && typeof instance.spawnState === "object"
    ? instance.spawnState
    : {};
  return normalizeText(
    metadata.label,
    normalizeText(
      resolveLocalizedTemplateName(template),
      normalizeText(
      spawnState.label,
      `${resolveSiteFamilyLabel(instance && instance.siteFamily)} Site ${
        Math.max(0, toInt(template && template.sourceDungeonID, 0)) ||
        Math.max(0, toInt(template && template.dungeonNameID, 0)) ||
        Math.max(0, toInt(instance && instance.instanceID, 0))
      }`,
      ),
    ),
  );
}

function buildSiteEntity(instance) {
  if (!isManagedMaterializedSiteInstance(instance)) {
    return null;
  }
  const template = dungeonAuthority.getTemplateByID(instance.templateID);
  const siteKind = normalizeLowerText(instance && instance.siteKind, "signature");
  const entryObjectTypeID = Math.max(
    0,
    toInt(
      instance && instance.entryObjectTypeID,
      template && template.entryObjectTypeID,
    ),
  ) || (siteKind === "anomaly" ? COSMIC_ANOMALY_TYPE_ID : COSMIC_SIGNATURE_TYPE_ID);
  const typeRecord = resolveItemByTypeID(entryObjectTypeID) || null;
  const family = normalizeLowerText(instance && instance.siteFamily, "unknown");
  const label = resolveEntityLabel(instance, template);
  const position = clonePosition(instance && instance.position);
  const strengthAttributeID = resolveFallbackStrengthAttribute(family);
  const groupID = siteKind === "anomaly" ? COSMIC_ANOMALY_GROUP_ID : COSMIC_SIGNATURE_GROUP_ID;
  const populationHints = resolvePopulationHints(instance, template);
  const encounterPlans = resolveEncounterPlans(populationHints);

  if (isManagedMissionSiteInstance(instance)) {
    return {
      kind: "missionSite",
      itemID: Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0)) ||
        Math.max(0, toInt(instance && instance.instanceID, 0)),
      typeID: toInt(typeRecord && typeRecord.typeID, entryObjectTypeID),
      groupID: toInt(typeRecord && typeRecord.groupID, groupID) || groupID,
      categoryID: toInt(typeRecord && typeRecord.categoryID, 16) || 16,
      graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: label,
      slimName: label,
      position,
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(1_000, toFiniteNumber(typeRecord && typeRecord.radius, 2_000)),
      staticVisibilityScope: "bubble",
      dungeonID: toInt(instance && instance.sourceDungeonID, 0) || null,
      dungeonNameID: toInt(instance && instance.dungeonNameID, 0) || null,
      archetypeID: toInt(instance && instance.archetypeID, 0) || null,
      factionID: toInt(instance && instance.factionID, 0) || null,
      entryObjectTypeID,
      dungeonEncounterPlanCount: encounterPlans.length,
      dungeonLootProfiles: normalizeArray(populationHints && populationHints.lootProfiles),
    };
  }

  return {
    kind: siteKind === "anomaly" ? "universeAnomalySite" : "universeSignatureSite",
    signalTrackerUniverseSeededSite: true,
    signalTrackerSiteKind: siteKind,
    signalTrackerSiteFamily: family,
    signalTrackerSiteTemplateID: normalizeText(instance && instance.templateID, "") || null,
    signalTrackerSiteLabel: label,
    signalTrackerSiteDifficulty: Math.max(1, toInt(instance && instance.difficulty, 1)),
    signalTrackerSiteGroupID: groupID,
    signalTrackerSiteTypeID: toInt(typeRecord && typeRecord.typeID, entryObjectTypeID),
    signalTrackerEntryObjectTypeID: entryObjectTypeID,
    signalTrackerStrengthAttributeID: strengthAttributeID > 0 ? strengthAttributeID : null,
    signalTrackerAllowedTypes: [],
    signalTrackerAnomalySite: siteKind === "anomaly",
    signalTrackerAnomalySiteFamily: siteKind === "anomaly" ? family : undefined,
    signalTrackerSignatureSite: siteKind === "signature",
    signalTrackerSignatureSiteFamily: siteKind === "signature" ? family : undefined,
    dungeonSiteInstanceID: Math.max(0, toInt(instance && instance.instanceID, 0)) || null,
    dungeonSiteID: Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0)) ||
      Math.max(0, toInt(instance && instance.instanceID, 0)) ||
      null,
    itemID: Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0)) ||
      Math.max(0, toInt(instance && instance.instanceID, 0)),
    typeID: toInt(typeRecord && typeRecord.typeID, entryObjectTypeID),
    groupID: toInt(typeRecord && typeRecord.groupID, groupID) || groupID,
    categoryID: toInt(typeRecord && typeRecord.categoryID, 16) || 16,
    graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
    ownerID: 1,
    itemName: label,
    slimName: label,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(1_000, toFiniteNumber(typeRecord && typeRecord.radius, 2_000)),
    staticVisibilityScope: "bubble",
    dungeonID: toInt(instance && instance.sourceDungeonID, 0) || null,
    dungeonNameID: toInt(instance && instance.dungeonNameID, 0) || null,
    archetypeID: toInt(instance && instance.archetypeID, 0) || null,
    factionID: toInt(instance && instance.factionID, 0) || null,
    entryObjectTypeID,
    dungeonEncounterPlanCount: encounterPlans.length,
    dungeonLootProfiles: normalizeArray(populationHints && populationHints.lootProfiles),
  };
}

function buildStableUniverseSiteEntitySignature(entity) {
  if (!entity || typeof entity !== "object") {
    return "";
  }
  return JSON.stringify({
    kind: normalizeText(entity.kind, ""),
    signalTrackerUniverseSeededSite: entity.signalTrackerUniverseSeededSite === true,
    signalTrackerSiteKind: normalizeLowerText(entity.signalTrackerSiteKind, ""),
    signalTrackerSiteFamily: normalizeLowerText(entity.signalTrackerSiteFamily, ""),
    signalTrackerSiteTemplateID: normalizeText(entity.signalTrackerSiteTemplateID, ""),
    signalTrackerSiteLabel: normalizeText(entity.signalTrackerSiteLabel, ""),
    signalTrackerSiteDifficulty: Math.max(1, toInt(entity.signalTrackerSiteDifficulty, 1)),
    signalTrackerSiteGroupID: Math.max(0, toInt(entity.signalTrackerSiteGroupID, 0)),
    signalTrackerSiteTypeID: Math.max(0, toInt(entity.signalTrackerSiteTypeID, 0)),
    signalTrackerEntryObjectTypeID: Math.max(0, toInt(entity.signalTrackerEntryObjectTypeID, 0)),
    signalTrackerStrengthAttributeID: Math.max(0, toInt(entity.signalTrackerStrengthAttributeID, 0)) || null,
    signalTrackerAllowedTypes: normalizeArray(entity.signalTrackerAllowedTypes),
    signalTrackerAnomalySite: entity.signalTrackerAnomalySite === true,
    signalTrackerAnomalySiteFamily: normalizeLowerText(entity.signalTrackerAnomalySiteFamily, ""),
    signalTrackerSignatureSite: entity.signalTrackerSignatureSite === true,
    signalTrackerSignatureSiteFamily: normalizeLowerText(entity.signalTrackerSignatureSiteFamily, ""),
    itemID: Math.max(0, toInt(entity.itemID, 0)),
    typeID: Math.max(0, toInt(entity.typeID, 0)),
    groupID: Math.max(0, toInt(entity.groupID, 0)),
    categoryID: Math.max(0, toInt(entity.categoryID, 0)),
    graphicID: Math.max(0, toInt(entity.graphicID, 0)) || null,
    ownerID: Math.max(0, toInt(entity.ownerID, 0)),
    itemName: normalizeText(entity.itemName, ""),
    slimName: normalizeText(entity.slimName, ""),
    position: clonePosition(entity.position),
    velocity: clonePosition(entity.velocity),
    direction: clonePosition(entity.direction),
    radius: Math.max(0, toFiniteNumber(entity.radius, 0)),
    staticVisibilityScope: normalizeLowerText(entity.staticVisibilityScope, ""),
    dungeonID: Math.max(0, toInt(entity.dungeonID, 0)) || null,
    dungeonNameID: Math.max(0, toInt(entity.dungeonNameID, 0)) || null,
    archetypeID: Math.max(0, toInt(entity.archetypeID, 0)) || null,
    factionID: Math.max(0, toInt(entity.factionID, 0)) || null,
    entryObjectTypeID: Math.max(0, toInt(entity.entryObjectTypeID, 0)) || null,
    dungeonEncounterPlanCount: Math.max(0, toInt(entity.dungeonEncounterPlanCount, 0)),
    dungeonLootProfiles: normalizeArray(entity.dungeonLootProfiles),
  });
}

function listMaterializedUniverseSiteEntities(scene) {
  return (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => entity && entity.signalTrackerUniverseSeededSite === true);
}

function ensureSceneMaterializedSiteSet(scene) {
  if (!scene) {
    return new Set();
  }
  if (!(scene._dungeonUniverseMaterializedSiteIDs instanceof Set)) {
    scene._dungeonUniverseMaterializedSiteIDs = new Set();
  }
  return scene._dungeonUniverseMaterializedSiteIDs;
}

function ensureSceneMaterializedSiteInstanceMap(scene) {
  if (!scene) {
    return new Map();
  }
  if (!(scene._dungeonUniverseMaterializedInstanceIDsBySiteID instanceof Map)) {
    scene._dungeonUniverseMaterializedInstanceIDsBySiteID = new Map();
  }
  return scene._dungeonUniverseMaterializedInstanceIDsBySiteID;
}

function markSceneSiteMaterialized(scene, siteID, instanceID = null) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0 || !scene) {
    return false;
  }
  ensureSceneMaterializedSiteSet(scene).add(numericSiteID);
  const numericInstanceID = Math.max(0, toInt(instanceID, 0));
  if (numericInstanceID > 0) {
    ensureSceneMaterializedSiteInstanceMap(scene).set(numericSiteID, numericInstanceID);
  }
  return true;
}

function unmarkSceneSiteMaterialized(scene, siteID) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0 || !scene) {
    return false;
  }
  ensureSceneMaterializedSiteInstanceMap(scene).delete(numericSiteID);
  return ensureSceneMaterializedSiteSet(scene).delete(numericSiteID);
}

function isSceneSiteMaterialized(scene, siteID) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0 || !scene) {
    return false;
  }
  return ensureSceneMaterializedSiteSet(scene).has(numericSiteID);
}

function isActiveLifecycleState(value) {
  const normalized = normalizeLowerText(value, "");
  return normalized === "seeded" || normalized === "active" || normalized === "paused";
}

function isActiveManagedMaterializedSiteInstance(instance) {
  return isManagedMaterializedSiteInstance(instance) && isActiveLifecycleState(instance.lifecycleState);
}

function resolveManagedUniverseSiteInstance(scene, instanceOrSite, options = {}) {
  const systemID = Math.max(0, toInt(options.systemID, toInt(scene && scene.systemID, 0)));
  if (systemID <= 0) {
    return null;
  }

  if (instanceOrSite && typeof instanceOrSite === "object") {
    const candidateInstanceID = Math.max(0, toInt(instanceOrSite.instanceID, 0));
    if (candidateInstanceID > 0) {
      const directInstance = dungeonRuntime.getInstance(candidateInstanceID);
      if (
        directInstance &&
        isManagedMaterializedSiteInstance(directInstance) &&
        Math.max(0, toInt(directInstance.solarSystemID, 0)) === systemID
      ) {
        return directInstance;
      }
    }
    if (isManagedMaterializedSiteInstance(instanceOrSite)) {
      const candidateSystemID = Math.max(0, toInt(instanceOrSite.solarSystemID, 0));
      if (!candidateSystemID || candidateSystemID === systemID) {
        return instanceOrSite;
      }
    }
  }

  const numericSiteID = Math.max(
    0,
    toInt(
      options.siteID,
      instanceOrSite && (
        instanceOrSite.siteID ||
        instanceOrSite.itemID ||
        (instanceOrSite.metadata && instanceOrSite.metadata.siteID)
      ),
    ),
  );
  if (numericSiteID <= 0) {
    return null;
  }

  const trackedInstanceID = Math.max(
    0,
    toInt(ensureSceneMaterializedSiteInstanceMap(scene).get(numericSiteID), 0),
  );
  if (trackedInstanceID > 0) {
    const trackedInstance = dungeonRuntime.getInstance(trackedInstanceID);
    if (
      trackedInstance &&
      isManagedMaterializedSiteInstance(trackedInstance) &&
      Math.max(0, toInt(trackedInstance && trackedInstance.solarSystemID, 0)) === systemID
    ) {
      return trackedInstance;
    }
    ensureSceneMaterializedSiteInstanceMap(scene).delete(numericSiteID);
  }

  return dungeonRuntime.listActiveInstancesBySystem(systemID, {
    full: true,
  }).find((instance) => (
    isManagedMaterializedSiteInstance(instance) &&
    Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0)) === numericSiteID
  )) || null;
}

function listMaterializedUniverseSiteContentEntities(scene, options = {}) {
  const numericSiteID = Math.max(0, toInt(options.siteID, 0));
  const numericInstanceID = Math.max(0, toInt(options.instanceID, 0));
  const staticEntities = Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [];
  const dynamicEntities = scene && scene.dynamicEntities instanceof Map
    ? [...scene.dynamicEntities.values()]
    : [];
  return [...staticEntities, ...dynamicEntities]
    .filter((entity) => entity && entity.dungeonMaterializedSiteContent === true)
    .filter((entity) => (
      (!numericSiteID || toInt(entity && entity.dungeonSiteID, 0) === numericSiteID) &&
      (!numericInstanceID || toInt(entity && entity.dungeonSiteInstanceID, 0) === numericInstanceID)
    ));
}

function listMaterializedUniverseSiteStaticContentEntities(scene, options = {}) {
  return listMaterializedUniverseSiteContentEntities(scene, options)
    .filter((entity) => (
      entity &&
      scene &&
      scene.staticEntitiesByID instanceof Map &&
      scene.staticEntitiesByID.has(toInt(entity && entity.itemID, 0))
    ));
}

function forceResyncSiteStaticContentForSession(scene, session, instanceOrSite, options = {}) {
  if (
    !scene ||
    !session ||
    !session._space ||
    typeof scene.syncStaticVisibilityForSession !== "function"
  ) {
    return false;
  }

  let instance = resolveManagedUniverseSiteInstance(scene, instanceOrSite, options);
  if (!instance) {
    return false;
  }
  instance = dungeonRuntime.ensureTemplateRuntimeState(
    Math.max(0, toInt(instance && instance.instanceID, 0)),
    {
      nowMs: options.nowMs,
    },
  ) || instance;

  const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
  if (siteID <= 0) {
    return false;
  }

  const staticContentEntities = listMaterializedUniverseSiteStaticContentEntities(scene, {
    siteID,
    instanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
  });
  if (staticContentEntities.length <= 0) {
    return false;
  }

  const visibleStaticIDs =
    session._space.visibleBubbleScopedStaticEntityIDs instanceof Set
      ? new Set(session._space.visibleBubbleScopedStaticEntityIDs)
      : new Set();
  let missingCount = 0;
  for (const entity of staticContentEntities) {
    const entityID = Math.max(0, toInt(entity && entity.itemID, 0));
    if (entityID > 0 && !visibleStaticIDs.has(entityID)) {
      visibleStaticIDs.delete(entityID);
      missingCount += 1;
    }
  }
  if (missingCount <= 0) {
    return false;
  }
  session._space.visibleBubbleScopedStaticEntityIDs = visibleStaticIDs;
  scene.syncStaticVisibilityForSession(
    session,
    options.nowMs === undefined || options.nowMs === null
      ? undefined
      : options.nowMs,
    options,
  );
  return true;
}

function getContentEntityRefsByKey(instance) {
  return normalizeObject(
    instance &&
    instance.spawnState &&
    instance.spawnState.contentEntityRefsByKey,
  );
}

function upsertContentEntityRef(instanceID, contentKey, patch = {}, options = {}) {
  const normalizedContentKey = normalizeText(contentKey, "");
  if (!normalizedContentKey) {
    return null;
  }
  const existing = dungeonRuntime.getInstance(instanceID);
  if (!existing) {
    return null;
  }
  const contentEntityRefsByKey = getContentEntityRefsByKey(existing);
  return dungeonRuntime.mergeSpawnState(instanceID, {
    contentEntityRefsByKey: {
      ...contentEntityRefsByKey,
      [normalizedContentKey]: {
        ...normalizeObject(contentEntityRefsByKey[normalizedContentKey]),
        ...(patch && typeof patch === "object" ? cloneValue(patch) : {}),
        contentKey: normalizedContentKey,
      },
    },
  }, options);
}

function annotateMaterializedContainerEntity(entity, containerEntity) {
  if (!entity || !containerEntity) {
    return entity;
  }
  entity.dungeonMaterializedSiteContent = true;
  entity.dungeonMaterializedContainer = true;
  entity.dungeonSiteID = toInt(containerEntity && containerEntity.dungeonSiteID, 0);
  entity.dungeonSiteInstanceID = toInt(containerEntity && containerEntity.dungeonSiteInstanceID, 0);
  entity.dungeonSiteContentKey = normalizeText(containerEntity && containerEntity.dungeonSiteContentKey, "");
  entity.dungeonSiteContentRole = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentRole, "container");
  entity.dungeonSiteContentAnalyzer = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentAnalyzer, "") || null;
  entity.dungeonSiteContentBonus = containerEntity && containerEntity.dungeonSiteContentBonus === true;
  entity.dungeonSiteContentFailureExplodes = containerEntity && containerEntity.dungeonSiteContentFailureExplodes === true;
  entity.dungeonSiteContentPersistsAfterResponse = containerEntity && containerEntity.dungeonSiteContentPersistsAfterResponse === true;
  entity.dungeonSiteContentTrigger = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentTrigger, "") || null;
  entity.dungeonSiteContentLootProfile = normalizeText(containerEntity && containerEntity.dungeonSiteContentLootProfile, "") || null;
  entity.dungeonSiteContentLootTags = cloneValue(containerEntity && containerEntity.dungeonSiteContentLootTags) || [];
  entity.dungeonSiteContentHackingDifficulty = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentHackingDifficulty, "") || null;
  entity.dungeonLootEntryCount = listContainerItems(null, entity.itemID).length;
  return entity;
}

function destroyMaterializedContentEntity(scene, entity, options = {}) {
  if (!scene || !entity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }
  const spaceRuntime = getSpaceRuntime();
  if (entity.dungeonMaterializedContainer === true && scene.dynamicEntities instanceof Map && scene.dynamicEntities.has(Number(entity.itemID))) {
    return spaceRuntime.destroyDynamicInventoryEntity(scene.systemID, entity.itemID, {
      removeContents: true,
      ...options,
    });
  }
  if (entity.dungeonMaterializedContainer === true && findItemById(Number(entity.itemID))) {
    return removeInventoryItem(Number(entity.itemID), {
      removeContents: true,
    });
  }
  return scene.removeStaticEntity(toInt(entity && entity.itemID, 0), {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
    nowMs: options.nowMs,
  });
}

// Mining missions (Plan C): build the special mineable asteroids declared by a template's
// populationHints.miningRocks ([{ typeID/oreTypeID/objectiveTypeID, count, quantity }]). They are
// kind:"asteroid" entities (so the existing mining systems target them); materializeSiteContents
// registers each one's ore quantity in miningRuntimeState. Gated on miningRocks, so combat sites
// are unaffected.
function buildMiningRockEntities(instance, siteEntity, populationHints) {
  if (!populationHints || !Array.isArray(populationHints.miningRocks)) {
    return [];
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const rockSpecs = populationHints.miningRocks
    .filter((rock) => rock && typeof rock === "object")
    .flatMap((rock) => {
      const count = Math.max(0, Math.min(SITE_CONTENT_MAX_MINING_ROCK_COUNT, toInt(rock.count, 1)));
      const oreTypeID = Math.max(0, toInt(rock.typeID || rock.oreTypeID || rock.objectiveTypeID, 0));
      const quantity = Math.max(1, toInt(rock.quantity || rock.remainingQuantity || rock.quantityPerRock, 1_000));
      // Honor an explicit per-rock positionOffset (log-sourced exact retail placement, e.g. the single
      // special mission asteroid); absent it, the rock is placed procedurally in a ring (the fallback).
      const positionOffset = (rock.positionOffset && typeof rock.positionOffset === "object")
        ? rock.positionOffset
        : null;
      // Exact dungeon-object id from the TQ log (so the client renders the ore-type asteroid as a dungeon
      // object instead of crashing on a modelless stand-alone asteroid). Only the first rock carries it.
      const dunObjectID = Math.max(0, toInt(rock.dunObjectID, 0));
      const dunRotation = Array.isArray(rock.dunRotation) && rock.dunRotation.length === 3
        ? rock.dunRotation.map((value) => toFiniteNumber(value, 0))
        : null;
      const ownerID = Math.max(
        0,
        toInt(
          rock.ownerID,
          toInt(
            populationHints.miningRockOwnerID ||
              populationHints.ownerID ||
              populationHints.missionOwnerID,
            0,
          ),
        ),
      ) || 500021;
      return Array.from({ length: count }, (_unused, index) => ({
        oreTypeID,
        quantity,
        ordinal: index + 1,
        positionOffset,
        dunObjectID: index === 0 ? dunObjectID : 0,
        dunRotation: index === 0 ? dunRotation : null,
        ownerID,
        dunObjectNameID: Object.prototype.hasOwnProperty.call(rock, "dunObjectNameID")
          ? Math.max(0, toInt(rock.dunObjectNameID, 0)) || null
          : null,
        nameID: Object.prototype.hasOwnProperty.call(rock, "nameID")
          ? Math.max(0, toInt(rock.nameID, 0)) || null
          : null,
        objectiveTargetGroup: Object.prototype.hasOwnProperty.call(rock, "objectiveTargetGroup")
          ? normalizeSlimNullableValue(rock.objectiveTargetGroup)
          : null,
      }));
    })
    .filter((rock) => rock.oreTypeID > 0)
    .slice(0, SITE_CONTENT_MAX_MINING_ROCK_COUNT);
  const total = rockSpecs.length;
  if (total <= 0) {
    return [];
  }
  return rockSpecs.map((rock, index) => {
    const oreRecord = resolveItemByTypeID(rock.oreTypeID) || {};
    const itemID = SITE_CONTENT_MINING_ROCK_ID_BASE + (siteID * 100) + index + 1;
    // RENDER SPLIT (mirrors belt asteroids in buildSystemOreAsteroidEntity - the only asteroid spawn proven
    // to render without crashing): the in-space BALL must present a renderable asteroid SHELL (real 3D
    // model + graphicID). The mission ore (Banidine 28617 etc.) is categoryID 25 with graphicID 0 and NO
    // model - putting it in the ball makes the retail client crash ON APPROACH inside _trinity_dx11
    // (INTEGER DIVIDE BY ZERO building a modelless asteroid). So the shell goes in typeID/groupID/
    // categoryID/graphicID; the ORE rides only in slim*/miningYield* (overview + mining still show the ore,
    // matching the golden slimItem). Log-authored owner/objective fields keep the golden dungeon-object identity.
    const shellTypeID = MINING_ROCK_SHELL_TYPE_IDS[
      (Math.abs(toInt(rock.oreTypeID, 0)) + index) % MINING_ROCK_SHELL_TYPE_IDS.length
    ];
    const shellRecord = resolveItemByTypeID(shellTypeID) || {};
    const shellGraphicID = toInt(shellRecord.graphicID, 0) || null;
    const dunObjectID = Math.max(0, toInt(rock.dunObjectID, 0)) ||
      (800000 + (siteID % 100000) + index + 1);
    const contentOffset = (rock.positionOffset && typeof rock.positionOffset === "object")
      ? clonePosition(rock.positionOffset)
      : buildContentOffset(`${siteID}:miningrock`, index, total, {
        baseDistanceMeters: SITE_CONTENT_CONTAINER_RING_METERS,
        jitterMeters: 6_000,
      });
    return {
      kind: "asteroid",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedMiningRock: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonSiteContentKey: `mining_rock:${rock.oreTypeID}:${rock.ordinal}`,
      itemID,
      // Renderable SHELL in the ball fields (has a model/graphicID -> trinity can build it).
      typeID: toInt(shellRecord.typeID, shellTypeID) || shellTypeID,
      groupID: toInt(shellRecord.groupID, 0) || null,
      categoryID: toInt(shellRecord.categoryID, SITE_CONTENT_SAFE_SLIM_CATEGORY_ID) || SITE_CONTENT_SAFE_SLIM_CATEGORY_ID,
      graphicID: shellGraphicID,
      visualTypeID: toInt(shellRecord.typeID, shellTypeID) || shellTypeID,
      // The ORE type only in slim*/miningYield* -> overview + mining read the ore, golden slimItem match.
      slimTypeID: rock.oreTypeID,
      slimGroupID: toInt(oreRecord.groupID, 0) || null,
      slimCategoryID: toInt(oreRecord.categoryID, 25) || 25,
      slimGraphicID: null,
      suppressSlimGraphicID: true,
      suppressSlimName: true,
      ownerID: Math.max(0, toInt(rock.ownerID, 0)) || 500021,
      dunObjectID,
      dunObjectNameID: Math.max(0, toInt(rock.dunObjectNameID, 0)) || null,
      nameID: Math.max(0, toInt(rock.nameID, 0)) || undefined,
      objectiveTargetGroup: normalizeSlimNullableValue(rock.objectiveTargetGroup),
      dunPosition: [contentOffset.x, contentOffset.y, contentOffset.z],
      dunRotation: Array.isArray(rock.dunRotation) ? rock.dunRotation : undefined,
      itemName: "",
      slimName: "",
      miningYieldTypeID: rock.oreTypeID,
      miningYieldKind: "ore",
      miningRemainingQuantity: rock.quantity,
      miningOriginalQuantity: rock.quantity,
      miningUnitVolume: Math.max(0.000001, toFiniteNumber(oreRecord.volume, 1)),
      position: addVectors(clonePosition(siteEntity && siteEntity.position), contentOffset),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(500, toFiniteNumber(shellRecord.radius, toFiniteNumber(oreRecord.radius, 0))) || 900,
      staticVisibilityScope: "bubble",
    };
  });
}

function listMiningObjectiveRockDescriptors(instance, populationHints) {
  const siteID = Math.max(
    0,
    toInt(
      instance && instance.metadata && instance.metadata.siteID,
      instance && instance.siteID,
    ),
  );
  if (!siteID || !populationHints || !Array.isArray(populationHints.miningRocks)) {
    return [];
  }
  const rockSpecs = populationHints.miningRocks
    .filter((rock) => rock && typeof rock === "object")
    .flatMap((rock) => {
      const count = Math.max(0, Math.min(SITE_CONTENT_MAX_MINING_ROCK_COUNT, toInt(rock.count, 1)));
      const oreTypeID = Math.max(0, toInt(rock.typeID || rock.oreTypeID || rock.objectiveTypeID, 0));
      const quantity = Math.max(1, toInt(rock.quantity || rock.remainingQuantity || rock.quantityPerRock, 1_000));
      return Array.from({ length: count }, () => ({
        oreTypeID,
        quantity,
      }));
    })
    .filter((rock) => rock.oreTypeID > 0)
    .slice(0, SITE_CONTENT_MAX_MINING_ROCK_COUNT);
  return rockSpecs.map((rock, index) => ({
    ...rock,
    entityID: SITE_CONTENT_MINING_ROCK_ID_BASE + (siteID * 100) + index + 1,
  }));
}

function buildContainerEntities(instance, siteEntity, populationHints) {
  if (!populationHints || !Array.isArray(populationHints.containers)) {
    return [];
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const containerSpecs = populationHints.containers
    .filter((container) => container && typeof container === "object")
    .flatMap((container) => {
      const count = Math.max(
        0,
        Math.min(
          SITE_CONTENT_MAX_CONTAINER_COUNT,
          toInt(container && container.count, 0),
        ),
      );
      return Array.from({ length: count }, (_, index) => ({
        role: normalizeLowerText(container && container.role, "container"),
        analyzer: normalizeLowerText(container && container.analyzer, "") || null,
        typeID: Math.max(0, toInt(container && container.typeID, 0)) || null,
        typeNameCandidates: normalizeArray(container && container.typeNameCandidates),
        label: normalizeText(container && container.label, "") || null,
        bonus: container && container.bonus === true,
        persistsAfterResponse: container && container.persistsAfterResponse === true,
        failureExplodes: container && container.failureExplodes === true,
        trigger: normalizeLowerText(container && container.trigger, "") || null,
        lootProfile: normalizeText(container && container.lootProfile, "") || null,
        lootTags: normalizeArray(container && container.lootTags)
          .map((tag) => normalizeLowerText(tag, ""))
          .filter(Boolean),
        hackingDifficulty: normalizeLowerText(container && container.hackingDifficulty, "") || null,
        ordinal: index + 1,
      }));
    })
    .slice(0, SITE_CONTENT_MAX_CONTAINER_COUNT);
  const total = containerSpecs.length;
  if (total <= 0) {
    return [];
  }

  return containerSpecs.map((container, index) => {
    const typeRecord = resolveContainerTypeRecord(container);
    const displayName = resolveContainerDisplayName(container, typeRecord, container.ordinal);
    const contentKey = normalizeText(
      `container:${container.role}:${container.ordinal}:${displayName}`,
      `container:${index + 1}`,
    ).toLowerCase();
    return {
      kind: "container",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedContainer: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonSiteContentKey: contentKey,
      dungeonSiteContentRole: container.role,
      dungeonSiteContentAnalyzer: container.analyzer,
      dungeonSiteContentBonus: container.bonus === true,
      dungeonSiteContentFailureExplodes: container.failureExplodes === true,
      dungeonSiteContentPersistsAfterResponse: container.persistsAfterResponse === true,
      dungeonSiteContentTrigger: container.trigger || null,
      dungeonSiteContentLootProfile: container.lootProfile,
      dungeonSiteContentLootTags: container.lootTags,
      dungeonSiteContentHackingDifficulty: container.hackingDifficulty,
      itemID: SITE_CONTENT_CONTAINER_ID_BASE + (siteID * 100) + index + 1,
      typeID: toInt(typeRecord && typeRecord.typeID, 23) || 23,
      groupID: toInt(typeRecord && typeRecord.groupID, 12) || 12,
      categoryID: toInt(typeRecord && typeRecord.categoryID, 2) || 2,
      graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: displayName,
      slimName: displayName,
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(`${siteID}:${container.role}`, index, total),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(200, toFiniteNumber(typeRecord && typeRecord.radius, 14)),
      staticVisibilityScope: "bubble",
    };
  });
}

function buildEncounterRewardContainerEntity(instance, siteEntity, encounterPlan, encounterState, populationHints) {
  if (!instance || !siteEntity || !encounterPlan) {
    return null;
  }
  const rewardProfile = normalizeText(encounterPlan && encounterPlan.lootProfile, "");
  if (!rewardProfile) {
    return null;
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const rewardIndex = Math.max(1, toInt(encounterPlan && encounterPlan.waveIndex, 1));
  const totalPlans = Math.max(1, resolveEncounterPlans(populationHints).length);
  const label = rewardProfile === "combat_overseer_loot"
    ? "Overseer Cache"
    : `${normalizeText(encounterPlan && encounterPlan.label, "Encounter")} Reward Cache`;
  const typeRecord = resolveGenericContainerTypeRecord() || resolveItemByTypeID(23) || {};
  return {
    kind: "container",
    dungeonMaterializedSiteContent: true,
    dungeonMaterializedContainer: true,
    dungeonSiteID: siteID,
    dungeonSiteInstanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
    dungeonSiteContentKey: `encounter_reward:${normalizeText(encounterPlan && encounterPlan.key, `wave_${rewardIndex}`)}`.toLowerCase(),
    dungeonSiteContentRole: "encounter_reward",
    dungeonSiteContentAnalyzer: null,
    dungeonSiteContentBonus: true,
    dungeonSiteContentFailureExplodes: false,
    dungeonSiteContentPersistsAfterResponse: true,
    dungeonSiteContentTrigger: normalizeLowerText(encounterPlan && encounterPlan.trigger, "") || null,
    dungeonSiteContentLootProfile: rewardProfile,
    dungeonSiteContentLootTags: cloneValue(encounterPlan && encounterPlan.lootTags) || [],
    dungeonSiteContentHackingDifficulty: null,
    itemID: SITE_CONTENT_CONTAINER_ID_BASE + (siteID * 100) + 50 + rewardIndex,
    typeID: toInt(typeRecord && typeRecord.typeID, 23) || 23,
    groupID: toInt(typeRecord && typeRecord.groupID, 12) || 12,
    categoryID: toInt(typeRecord && typeRecord.categoryID, 2) || 2,
    graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
    ownerID: 1,
    itemName: label,
    slimName: label,
    position: addVectors(
      clonePosition(siteEntity && siteEntity.position),
      buildContentOffset(
        `${siteID}:encounter_reward:${normalizeText(encounterPlan && encounterPlan.key, rewardIndex)}`,
        rewardIndex - 1,
        totalPlans,
        {
          baseDistanceMeters: SITE_CONTENT_REWARD_OFFSET_METERS,
          jitterMeters: 4_500,
        },
      ),
    ),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(200, toFiniteNumber(typeRecord && typeRecord.radius, 14)),
    staticVisibilityScope: "bubble",
    dungeonEncounterCompletedAtMs: Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0)) || null,
  };
}

function materializeEncounterRewardContainers(scene, instance, siteEntity, template, populationHints, options = {}) {
  if (!scene || !instance || !siteEntity) {
    return 0;
  }
  if (normalizeLowerText(instance && instance.siteKind, "") === "anomaly") {
    return 0;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let createdCount = 0;
  for (const plan of resolveEncounterPlans(populationHints)) {
    if (!normalizeText(plan && plan.lootProfile, "")) {
      continue;
    }
    const encounterState = getEncounterStateByKey(instance, plan.key);
    if (Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0)) <= 0) {
      continue;
    }
    if (Math.max(0, toInt(encounterState && encounterState.rewardMaterializedAtMs, 0)) > 0) {
      continue;
    }
    const rewardContainer = buildEncounterRewardContainerEntity(
      instance,
      siteEntity,
      plan,
      encounterState,
      populationHints,
    );
    if (!rewardContainer) {
      continue;
    }
    const created = materializeContainerEntity(
      scene,
      instance,
      siteEntity,
      template,
      populationHints,
      rewardContainer,
      { nowMs },
    );
    if (!created) {
      continue;
    }
    upsertEncounterState(instance.instanceID, plan.key, {
      rewardMaterializedAtMs: nowMs,
    }, { nowMs });
    createdCount += 1;
  }
  return createdCount;
}

function maybeCompleteClearedEncounterSite(instance, populationHints, options = {}) {
  if (!instance) {
    return false;
  }
  if (normalizeLowerText(instance && instance.siteKind, "") !== "anomaly") {
    return false;
  }
  if (normalizeLowerText(instance && instance.lifecycleState, "") !== "active") {
    return false;
  }
  const plans = resolveEncounterPlans(populationHints);
  if (plans.length <= 0) {
    return false;
  }
  const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
  let latestCompletionAtMs = 0;
  for (const plan of plans) {
    const state = getEncounterStateByKey(latestInstance, plan.key);
    if (Math.max(0, toInt(state && state.spawnedAtMs, 0)) <= 0) {
      return false;
    }
    const remainingEntityIDs = normalizeIDList(state && state.remainingEntityIDs);
    if (remainingEntityIDs.length > 0) {
      return false;
    }
    const completedAtMs = Math.max(0, toInt(state && state.completedAtMs, 0));
    if (completedAtMs <= 0) {
      return false;
    }
    latestCompletionAtMs = Math.max(latestCompletionAtMs, completedAtMs);
  }
  const objectiveCompletedAtMs = Math.max(
    0,
    toInt(latestInstance && latestInstance.objectiveState && latestInstance.objectiveState.completedAtMs, 0),
  );
  const completionAtMs = Math.max(
    latestCompletionAtMs,
    objectiveCompletedAtMs,
    Math.max(0, toInt(options.nowMs, Date.now())),
  );
  const updated = dungeonRuntime.setLifecycleState(latestInstance.instanceID, "completed", {
    nowMs: Math.max(0, toInt(options.nowMs, Date.now())),
    completedAtMs: completionAtMs,
    expiresAtMs: completionAtMs + CLEARED_ANOMALY_ROTATION_DELAY_MS,
    lifecycleReason: "encounters_cleared",
  });
  if (options.scene) {
    dungeonTrackingRuntime.notifyDungeonCompletedForScene(options.scene, updated, {
      nowMs: completionAtMs,
    });
  }
  return true;
}

function isDataRelicUniverseSignatureInstance(instance) {
  return Boolean(
    instance &&
    normalizeLowerText(instance.siteKind, "signature") === "signature" &&
    DATA_RELIC_SITE_FAMILIES.has(normalizeLowerText(instance.siteFamily, "")),
  );
}

function isDataRelicMaterializedContainer(entity) {
  return Boolean(
    entity &&
    entity.dungeonMaterializedContainer === true &&
    entity.dungeonMaterializedSiteContent === true &&
    DATA_RELIC_CONTAINER_ANALYZERS.has(
      normalizeLowerText(entity.dungeonSiteContentAnalyzer, ""),
    )
  );
}

function getContainerLootCount(entity) {
  return listContainerItems(null, Math.max(0, toInt(entity && entity.itemID, 0))).length;
}

function resolveMaterializedContainerCompletionContext(scene, source = null, options = {}) {
  if (!scene) {
    return null;
  }
  const sourceEntity = source && typeof source === "object" ? source : null;
  const containerID = Math.max(
    0,
    toInt(
      options.containerID,
      sourceEntity && sourceEntity.itemID,
    ),
  );
  const liveSourceEntity =
    sourceEntity ||
    (
      containerID > 0 && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(containerID)
        : null
    ) ||
    (
      containerID > 0 && scene.dynamicEntities instanceof Map
        ? scene.dynamicEntities.get(containerID)
        : null
    ) ||
    (
      containerID > 0 && scene.staticEntitiesByID instanceof Map
        ? scene.staticEntitiesByID.get(containerID)
        : null
    ) ||
    null;
  const instanceID = Math.max(
    0,
    toInt(
      options.instanceID,
      liveSourceEntity && liveSourceEntity.dungeonSiteInstanceID,
    ),
  );
  const siteID = Math.max(
    0,
    toInt(
      options.siteID,
      liveSourceEntity && liveSourceEntity.dungeonSiteID,
    ),
  );
  const instance =
    (instanceID > 0 ? dungeonRuntime.getInstance(instanceID) : null) ||
    resolveManagedUniverseSiteInstance(scene, liveSourceEntity || { itemID: siteID }, {
      siteID,
      systemID: scene.systemID,
    });

  if (!instance) {
    return null;
  }

  return {
    sourceEntity: liveSourceEntity,
    sourceWasDataRelicContainer: isDataRelicMaterializedContainer(liveSourceEntity),
    instance,
    instanceID: Math.max(0, toInt(instance && instance.instanceID, instanceID)),
    siteID: Math.max(
      0,
      toInt(
        siteID,
        instance && instance.metadata && instance.metadata.siteID,
      ),
    ),
  };
}

function maybeCompleteMaterializedDataRelicSite(scene, source = null, options = {}) {
  const context = resolveMaterializedContainerCompletionContext(scene, source, options);
  if (!context || !isDataRelicUniverseSignatureInstance(context.instance)) {
    return {
      success: false,
      completed: false,
      reason: "not_data_relic_signature",
    };
  }

  const lifecycleState = normalizeLowerText(context.instance.lifecycleState, "");
  if (!isActiveLifecycleState(lifecycleState)) {
    return {
      success: true,
      completed: lifecycleState === "completed",
      reason: "inactive_lifecycle",
      instance: context.instance,
    };
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const broadcast = options.broadcast === true;
  const excludedSession = options.excludedSession || null;
  const containers = listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: context.instanceID,
    siteID: context.siteID,
  }).filter(isDataRelicMaterializedContainer);

  if (containers.length <= 0 && context.sourceWasDataRelicContainer !== true) {
    return {
      success: true,
      completed: false,
      reason: "no_materialized_containers",
      instance: context.instance,
    };
  }

  let removedEmptyContainers = 0;
  let unfinishedCount = 0;

  for (const entity of containers) {
    const state = Math.max(0, toInt(entity && entity.dungeonSiteContentHackingState, 0));
    const lootCount = getContainerLootCount(entity);
    if (state !== HACKING_STATE_HACKED || lootCount > 0) {
      unfinishedCount += 1;
      continue;
    }
    const removeResult = destroyMaterializedContentEntity(scene, entity, {
      broadcast,
      excludedSession,
      nowMs,
    });
    if (removeResult && removeResult.success === true) {
      removedEmptyContainers += 1;
    } else {
      unfinishedCount += 1;
    }
  }

  if (unfinishedCount > 0) {
    return {
      success: true,
      completed: false,
      reason: "containers_unfinished",
      instance: dungeonRuntime.getInstance(context.instanceID) || context.instance,
      removedEmptyContainers,
      unfinishedCount,
    };
  }

  const remainingContainers = listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: context.instanceID,
    siteID: context.siteID,
  }).filter(isDataRelicMaterializedContainer);
  if (remainingContainers.length > 0) {
    return {
      success: true,
      completed: false,
      reason: "containers_still_materialized",
      instance: dungeonRuntime.getInstance(context.instanceID) || context.instance,
      removedEmptyContainers,
      unfinishedCount: remainingContainers.length,
    };
  }

  const updated = dungeonRuntime.setLifecycleState(context.instanceID, "completed", {
    nowMs,
    completedAtMs: nowMs,
    expiresAtMs: nowMs + CLEARED_ANOMALY_ROTATION_DELAY_MS,
    lifecycleReason: "containers_cleared",
  });
  const dungeonCompletionNotifiedCount = dungeonTrackingRuntime.notifyDungeonCompletedForScene(
    scene,
    updated,
    { nowMs },
  );
  if (options.notifyTracker !== false) {
    notifyTrackerDelta(Math.max(0, toInt(scene && scene.systemID, 0)), "signature", {
      scene,
      refresh: false,
    });
  }

  return {
    success: true,
    completed: true,
    reason: "containers_cleared",
    instance: updated,
    removedEmptyContainers,
    dungeonCompletionNotifiedCount,
  };
}

function maybeCompleteMaterializedDataRelicSiteForContainerID(scene, containerID, options = {}) {
  return maybeCompleteMaterializedDataRelicSite(scene, null, {
    ...options,
    containerID,
  });
}

function materializeContainerEntity(scene, instance, siteEntity, template, populationHints, containerEntity, options = {}) {
  if (!scene || !instance || !containerEntity) {
    return false;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const contentKey = normalizeText(containerEntity && containerEntity.dungeonSiteContentKey, "");
  const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
  const existingRef = normalizeObject(getContentEntityRefsByKey(latestInstance)[contentKey]);
  let itemID = Math.max(0, toInt(existingRef && existingRef.itemID, 0));
  let createdItem = false;

  if (!(itemID > 0 && findItemById(itemID))) {
    itemID = 0;
  }

  if (itemID <= 0) {
    const containerType = resolveItemByTypeID(toInt(containerEntity && containerEntity.typeID, 0)) ||
      resolveContainerTypeRecord(containerEntity);
    if (!containerType) {
      return false;
    }
    const createResult = grantItemsToOwnerLocation(
      SITE_CONTENT_OWNER_ID,
      scene.systemID,
      0,
      [{
        itemType: containerType,
        quantity: 1,
        options: {
          singleton: 1,
          itemName: normalizeText(containerEntity && containerEntity.itemName, resolveTypeRecordName(containerType, "Site Container")),
          createdAtMs: nowMs,
          spaceRadius: Math.max(100, toFiniteNumber(containerEntity && containerEntity.radius, 0)) || null,
          spaceState: {
            systemID: scene.systemID,
            position: clonePosition(containerEntity && containerEntity.position),
            velocity: { x: 0, y: 0, z: 0 },
            direction: { x: 1, y: 0, z: 0 },
            mode: "STOP",
          },
        },
      }],
    );
    if (!createResult || !createResult.success || !createResult.data || !Array.isArray(createResult.data.items)) {
      return false;
    }
    itemID = Math.max(0, toInt(createResult.data.items[0] && createResult.data.items[0].itemID, 0));
    createdItem = itemID > 0;
  }

  if (itemID <= 0) {
    return false;
  }

  const runtime = getSpaceRuntime();
  const lootSeeded = existingRef.lootSeeded === true;
  if (!lootSeeded) {
    const lootEntries = buildLootGrantEntriesForContainer(containerEntity, populationHints, {
      instance,
      siteEntity,
      template,
    });
    if (lootEntries.length > 0) {
      grantItemsToOwnerLocation(
        SITE_CONTENT_OWNER_ID,
        itemID,
        ITEM_FLAGS.CARGO_HOLD,
        lootEntries,
      );
    }
  }

  const spawnResult = runtime.spawnDynamicInventoryEntity(scene.systemID, itemID, {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
  });
  if (!spawnResult || !spawnResult.success) {
    return false;
  }
  const liveEntity = scene.getEntityByID(itemID) || (spawnResult.data && spawnResult.data.entity) || null;
  if (!liveEntity) {
    return false;
  }
  annotateMaterializedContainerEntity(liveEntity, {
    ...containerEntity,
    itemID,
  });
  upsertContentEntityRef(instance.instanceID, contentKey, {
    itemID,
    lootSeeded: lootSeeded || listContainerItems(null, itemID).length > 0,
    lastMaterializedAtMs: nowMs,
    createdAtMs: createdItem ? nowMs : Math.max(0, toInt(existingRef && existingRef.createdAtMs, 0)) || null,
  }, { nowMs });
  return true;
}

function broadcastStaticSiteContentBatch(scene, entities, options = {}) {
  if (
    !scene ||
    !Array.isArray(entities) ||
    entities.length <= 0 ||
    options.broadcast !== true ||
    typeof scene.broadcastAddBalls !== "function"
  ) {
    return 0;
  }
  const filtered = entities.filter(Boolean);
  if (filtered.length <= 0) {
    return 0;
  }
  scene.broadcastAddBalls(filtered, options.excludedSession || null);
  return filtered.length;
}

function buildHazardEntities(instance, siteEntity, populationHints) {
  if (!populationHints || !Array.isArray(populationHints.hazards)) {
    return [];
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const hazards = [...new Set(
    populationHints.hazards
      .map((entry) => {
        if (entry && typeof entry === "object") {
          return JSON.stringify({
            kind: normalizeLowerText(entry.kind, ""),
            label: normalizeText(entry.label, ""),
            visibleCountdownSeconds: Math.max(0, toInt(entry.visibleCountdownSeconds, 0)),
            hiddenTimerMinSeconds: Math.max(0, toInt(entry.hiddenTimerMinSeconds, 0)),
            hiddenTimerMaxSeconds: Math.max(0, toInt(entry.hiddenTimerMaxSeconds, 0)),
            failureTriggersExplosion: entry.failureTriggersExplosion === true,
          });
        }
        return JSON.stringify({
          kind: normalizeLowerText(entry, ""),
        });
      })
      .filter((entry) => entry !== JSON.stringify({ kind: "" })),
  )]
    .map((entry) => {
      try {
        return JSON.parse(entry);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, SITE_CONTENT_MAX_HAZARD_COUNT);
  const total = hazards.length;
  if (total <= 0) {
    return [];
  }

  return hazards.map((hazard, index) => {
    const hazardKind = normalizeLowerText(hazard && hazard.kind, "");
    const hazardLabel = normalizeText(hazard && hazard.label, "") || resolveHazardLabel(hazardKind);
    return {
      kind: "siteHazardBeacon",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedHazard: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonSiteContentHazard: hazardKind,
      dungeonHazardVisibleCountdownSeconds: Math.max(0, toInt(hazard && hazard.visibleCountdownSeconds, 0)) || null,
      dungeonHazardHiddenTimerMinSeconds: Math.max(0, toInt(hazard && hazard.hiddenTimerMinSeconds, 0)) || null,
      dungeonHazardHiddenTimerMaxSeconds: Math.max(0, toInt(hazard && hazard.hiddenTimerMaxSeconds, 0)) || null,
      dungeonHazardFailureTriggersExplosion: hazard && hazard.failureTriggersExplosion === true,
      itemID: SITE_CONTENT_HAZARD_ID_BASE + (siteID * 100) + index + 1,
      typeID: toInt(siteEntity && siteEntity.typeID, COSMIC_SIGNATURE_TYPE_ID) || COSMIC_SIGNATURE_TYPE_ID,
      groupID: toInt(siteEntity && siteEntity.groupID, COSMIC_SIGNATURE_GROUP_ID) || COSMIC_SIGNATURE_GROUP_ID,
      categoryID: toInt(siteEntity && siteEntity.categoryID, 16) || 16,
      graphicID: toInt(siteEntity && siteEntity.graphicID, 0) || null,
      ownerID: 1,
      itemName: hazardLabel,
      slimName: hazardLabel,
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(
          `${siteID}:${hazardKind}`,
          index,
          total,
          {
            baseDistanceMeters: SITE_CONTENT_ENCOUNTER_OFFSET_METERS + 5_000,
            jitterMeters: 6_000,
          },
        ),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(2_500, Math.round(toFiniteNumber(siteEntity && siteEntity.radius, 2_000) * 0.75)),
      staticVisibilityScope: "bubble",
    };
  });
}

function resolveSiteSceneProfile(template) {
  return normalizeObject(
    template &&
    template.siteSceneProfile &&
    typeof template.siteSceneProfile === "object"
      ? template.siteSceneProfile
      : null,
  );
}

function buildGateEntities(instance, siteEntity, template) {
  if (!isMissionLikeSiteInstance(instance, template)) {
    return [];
  }
  const sceneProfile = resolveSiteSceneProfile(template);
  const rawGateProfiles = normalizeArray(sceneProfile && sceneProfile.gateProfiles)
    .filter((entry) => entry && typeof entry === "object");
  if (rawGateProfiles.length <= 0) {
    return [];
  }
  const gateStatesByKey =
    instance &&
    instance.gateStatesByKey &&
    typeof instance.gateStatesByKey === "object"
      ? instance.gateStatesByKey
      : {};
  const dedupedGateProfiles = [];
  const seenEntryGateKeys = new Set();
  for (const gateProfile of rawGateProfiles) {
    const gateKey = normalizeText(gateProfile && gateProfile.gateKey, "");
    const gateState = normalizeObject(gateStatesByKey[gateKey]);
    const destinationRoomKey = normalizeText(
      gateProfile && gateProfile.destinationRoomKey,
      normalizeText(gateState && gateState.destinationRoomKey, ""),
    );
    const label = normalizeText(gateProfile && gateProfile.label, "");
    const allowedShipsList = Math.max(
      0,
      toInt(
        gateProfile && gateProfile.allowedShipsList,
        gateState && gateState.metadata && gateState.metadata.allowedShipsList,
      ),
    );
    if (destinationRoomKey === "room:entry" && !label) {
      const dedupeKey = `${destinationRoomKey}:${allowedShipsList}`;
      if (seenEntryGateKeys.has(dedupeKey)) {
        continue;
      }
      seenEntryGateKeys.add(dedupeKey);
    }
    dedupedGateProfiles.push(gateProfile);
  }
  const gateProfiles = dedupedGateProfiles.slice(0, SITE_CONTENT_MAX_GATE_COUNT);
  if (gateProfiles.length <= 0) {
    return [];
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  return gateProfiles.map((gateProfile, index) => {
    const explicitTypeID = Math.max(0, toInt(gateProfile && gateProfile.typeID, 0));
    const typeRecord = (
      explicitTypeID > 0
        ? resolveItemByTypeID(explicitTypeID)
        : resolveGenericTypeRecordByName(gateProfile && gateProfile.typeNameCandidates)
    ) || resolveItemByTypeID(17_831) || {};
    const gateKey = normalizeText(gateProfile && gateProfile.gateKey, `gate:${index + 1}`);
    const gateState = normalizeObject(gateStatesByKey[gateKey]);
    const label = normalizeText(
      gateProfile && gateProfile.label,
      resolveTypeRecordName(typeRecord, "Acceleration Gate"),
    ) || "Acceleration Gate";
    const gateTypeID = Math.max(0, toInt(typeRecord && typeRecord.typeID, explicitTypeID || 17_831)) || 17_831;
    const dungeonObjectID = resolveGateDungeonObjectID(gateProfile, gateState, gateKey);
    const gateActivationRange = resolveGateActivationRangeMeters(gateProfile, gateTypeID);
    const requirementMetadata = resolveGateRequirementMetadata(gateProfile, gateState);
    const exactOffset = gateProfile && gateProfile.positionOffset && typeof gateProfile.positionOffset === "object"
      ? clonePosition(gateProfile.positionOffset)
      : null;
    const contentOffset = exactOffset || buildContentOffset(
      `${siteID}:gate:${gateKey}`,
      index,
      gateProfiles.length,
      {
        baseDistanceMeters: 22_000,
        jitterMeters: 7_000,
      },
    );
    const dunRotation = Array.isArray(gateProfile && gateProfile.dunRotation) &&
      gateProfile.dunRotation.length === 3
      ? gateProfile.dunRotation.map((value) => toFiniteNumber(value, 0))
      : null;
    const suppressSlimName = gateProfile && gateProfile.suppressSlimName === true;
    const suppressSlimGraphicID = gateProfile && gateProfile.suppressSlimGraphicID === true;
    const slimLabel = suppressSlimName ? "" : label;
    return {
      kind: "siteAccelerationGate",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedGate: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonGateKey: gateKey,
      dungeonObjectID: dungeonObjectID || null,
      dunObjectID: dungeonObjectID || null,
      dungeonGateDestinationRoomKey: normalizeText(
        gateProfile && gateProfile.destinationRoomKey,
        normalizeText(gateState && gateState.destinationRoomKey, "") || null,
      ) || null,
      dungeonGateState: normalizeLowerText(gateState && gateState.state, "locked"),
      dungeonGateAllowedShipsList: Math.max(
        0,
        toInt(
          gateProfile && gateProfile.allowedShipsList,
          gateState && gateState.metadata && gateState.metadata.allowedShipsList,
        ),
      ) || null,
      dungeonGateKeyLock: requirementMetadata.keyLock ?? null,
      dungeonGateRequiredItems: requirementMetadata.requiredItems ?? null,
      dungeonGateRequiredItemTypeID: requirementMetadata.requiredItemTypeID,
      dungeonGateRequiredItemQuantity: requirementMetadata.requiredItemQuantity,
      gateActivationRange,
      dunMusicUrl: normalizeText(gateProfile && gateProfile.dunMusicUrl, "") || null,
      itemID: SITE_CONTENT_GATE_ID_BASE + (siteID * 100) + index + 1,
      typeID: gateTypeID,
      groupID: Math.max(0, toInt(typeRecord && typeRecord.groupID, 366)) || 366,
      categoryID: Math.max(0, toInt(typeRecord && typeRecord.categoryID, 2)) || 2,
      graphicID: suppressSlimGraphicID ? null : toInt(typeRecord && typeRecord.graphicID, 0) || null,
      slimGraphicID: suppressSlimGraphicID ? null : undefined,
      suppressSlimGraphicID,
      ownerID: Math.max(0, toInt(gateProfile && gateProfile.ownerID, 0)) || 1,
      itemName: slimLabel,
      slimName: slimLabel,
      suppressSlimName,
      dunObjectNameID: Object.prototype.hasOwnProperty.call(gateProfile || {}, "dunObjectNameID")
        ? gateProfile.dunObjectNameID
        : undefined,
      nameID: Object.prototype.hasOwnProperty.call(gateProfile || {}, "nameID")
        ? gateProfile.nameID
        : undefined,
      objectiveTargetGroup: Object.prototype.hasOwnProperty.call(gateProfile || {}, "objectiveTargetGroup")
        ? gateProfile.objectiveTargetGroup
        : undefined,
      dunPosition: exactOffset ? [contentOffset.x, contentOffset.y, contentOffset.z] : undefined,
      dunRotation: Array.isArray(dunRotation) ? dunRotation : undefined,
      position: addVectors(clonePosition(siteEntity && siteEntity.position), contentOffset),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(2_500, toFiniteNumber(typeRecord && typeRecord.radius, 12_000)),
      staticVisibilityScope: "bubble",
    };
  });
}

function buildEnvironmentEntities(instance, siteEntity, template, populationHints) {
  const sceneProfile = resolveSiteSceneProfile(template);
  const environmentTemplates =
    template &&
    template.environmentTemplates &&
    typeof template.environmentTemplates === "object"
      ? template.environmentTemplates
      : null;
  const resolvedTemplateCatalog =
    environmentTemplates &&
    environmentTemplates.resolvedTemplateCatalog &&
    typeof environmentTemplates.resolvedTemplateCatalog === "object"
      ? environmentTemplates.resolvedTemplateCatalog
      : {};
  const entryObjectEnvironmentMapping =
    environmentTemplates &&
    environmentTemplates.entryObjectEnvironmentMapping &&
    typeof environmentTemplates.entryObjectEnvironmentMapping === "object"
      ? environmentTemplates.entryObjectEnvironmentMapping
      : null;

  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const candidates = [];
  const pushDefinitionCandidates = (environmentTemplateID, definition, source) => {
    const anchorTypeIDs = Array.isArray(definition && definition.anchorTypeIDs)
      ? definition.anchorTypeIDs
      : [];
    const subEnvironmentTypeIDs = Array.isArray(definition && definition.subEnvironmentTypeIDs)
      ? definition.subEnvironmentTypeIDs
      : [];
    for (const typeID of [...anchorTypeIDs, ...subEnvironmentTypeIDs.slice(0, 12)]) {
      const normalizedTypeID = Math.max(0, toInt(typeID, 0));
      if (normalizedTypeID <= 0) {
        continue;
      }
      const typeRecord = resolveItemByTypeID(normalizedTypeID);
      if (!typeRecord || !resolveTypeRecordName(typeRecord, "")) {
        continue;
      }
      candidates.push({
        typeID: normalizedTypeID,
        typeRecord,
        environmentTemplateID: Math.max(0, toInt(environmentTemplateID, 0)) || null,
        source: anchorTypeIDs.includes(normalizedTypeID)
          ? `${source}:anchorType`
          : `${source}:subEnvironmentType`,
        explicitLabel: null,
      });
    }
  };
  for (const [environmentTemplateID, definition] of Object.entries(resolvedTemplateCatalog)) {
    pushDefinitionCandidates(environmentTemplateID, definition, "catalog");
  }
  const mappedTemplateRefs = [
    ...(entryObjectEnvironmentMapping && entryObjectEnvironmentMapping.baseEnvironment
      ? [entryObjectEnvironmentMapping.baseEnvironment]
      : []),
    ...Object.values(
      entryObjectEnvironmentMapping && entryObjectEnvironmentMapping.overridesByMaterialSetID
        ? entryObjectEnvironmentMapping.overridesByMaterialSetID
        : {},
    ),
  ];
  for (const templateRef of mappedTemplateRefs) {
    const environmentTemplateID = Math.max(0, toInt(templateRef && templateRef.templateID, 0)) || null;
    const explicitDefinition = normalizeObject(templateRef && templateRef.definition);
    const definition = Object.keys(explicitDefinition).length > 0
      ? explicitDefinition
      : normalizeObject(environmentTemplateID ? resolvedTemplateCatalog[String(environmentTemplateID)] : null);
    if (Object.keys(definition).length <= 0) {
      continue;
    }
    pushDefinitionCandidates(environmentTemplateID, definition, "entryObjectMapping");
  }

  const rawHintedEnvironmentProps = normalizeArray(populationHints && populationHints.environmentProps)
    .filter((entry) => entry && typeof entry === "object");
  const hasExactHintedEnvironmentProps = rawHintedEnvironmentProps
    .some((entry) => entry && entry.exact === true);
  const hintedEnvironmentProps = hasExactHintedEnvironmentProps
    ? rawHintedEnvironmentProps.filter((entry) => entry && entry.exact === true)
    : rawHintedEnvironmentProps;
  if (hasExactHintedEnvironmentProps) {
    candidates.length = 0;
  }
  const sceneProfileStructures = (hasExactHintedEnvironmentProps ? [] : normalizeArray(sceneProfile && sceneProfile.structureProfiles))
    .filter((entry) => entry && typeof entry === "object");
  if (
    Object.keys(resolvedTemplateCatalog).length <= 0 &&
    mappedTemplateRefs.length <= 0 &&
    hintedEnvironmentProps.length <= 0 &&
    sceneProfileStructures.length <= 0
  ) {
    return [];
  }
  for (const structureProfile of sceneProfileStructures) {
    const explicitTypeID = Math.max(0, toInt(structureProfile && structureProfile.typeID, 0));
    const typeRecord = (
      explicitTypeID > 0
        ? resolveItemByTypeID(explicitTypeID)
        : resolveGenericTypeRecordByName(structureProfile && structureProfile.typeNameCandidates)
    );
    if (!typeRecord) {
      continue;
    }
    candidates.push({
      typeID: Math.max(0, toInt(typeRecord && typeRecord.typeID, explicitTypeID)) || explicitTypeID,
      typeRecord,
      environmentTemplateID: null,
      source: normalizeText(structureProfile && structureProfile.source, "sceneProfile"),
      explicitLabel: normalizeText(structureProfile && structureProfile.label, "") || null,
    });
  }
  for (const environmentProp of hintedEnvironmentProps) {
    const explicitTypeID = Math.max(0, toInt(environmentProp && environmentProp.typeID, 0));
    const typeRecord = (
      explicitTypeID > 0
        ? resolveItemByTypeID(explicitTypeID)
        : resolveGenericTypeRecordByName(environmentProp && environmentProp.typeNameCandidates)
    );
    if (!typeRecord) {
      continue;
    }
    const exact = environmentProp && environmentProp.exact === true;
    const positionOffset = environmentProp && environmentProp.positionOffset && typeof environmentProp.positionOffset === "object"
      ? clonePosition(environmentProp.positionOffset)
      : null;
    const dunRotation = Array.isArray(environmentProp && environmentProp.dunRotation) &&
      environmentProp.dunRotation.length === 3
      ? environmentProp.dunRotation.map((value) => toFiniteNumber(value, 0))
      : null;
    candidates.push({
      typeID: Math.max(0, toInt(typeRecord && typeRecord.typeID, explicitTypeID)) || explicitTypeID,
      typeRecord,
      environmentTemplateID: null,
      source: exact ? "populationHint:exact" : "populationHint",
      explicitLabel: normalizeText(environmentProp && environmentProp.label, "") || null,
      exact,
      exactKey: normalizeText(environmentProp && environmentProp.key, ""),
      positionOffset,
      dunObjectID: Math.max(0, toInt(environmentProp && environmentProp.dunObjectID, 0)),
      dunObjectNameID: Object.prototype.hasOwnProperty.call(environmentProp, "dunObjectNameID")
        ? environmentProp.dunObjectNameID
        : exact ? null : undefined,
      nameID: Object.prototype.hasOwnProperty.call(environmentProp, "nameID")
        ? environmentProp.nameID
        : exact ? null : undefined,
      objectiveTargetGroup: Object.prototype.hasOwnProperty.call(environmentProp, "objectiveTargetGroup")
        ? environmentProp.objectiveTargetGroup
        : exact ? null : undefined,
      dunRotation,
      ownerID: Math.max(0, toInt(environmentProp && environmentProp.ownerID, 0)) || null,
      suppressSlimName: environmentProp && (environmentProp.suppressSlimName === true || exact),
      suppressSlimGraphicID: environmentProp && (environmentProp.suppressSlimGraphicID === true || exact),
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const key = candidate.exact
      ? `exact:${normalizeText(candidate.exactKey, "")}:${candidate.dunObjectID || 0}:${candidate.typeID}:${candidateIndex}`
      : `${candidate.typeID}:${normalizeText(candidate.explicitLabel, "")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  const maxEnvironmentProps = deduped.some((candidate) => candidate && candidate.exact)
    ? resolveExactEnvironmentPropLimit(populationHints, deduped.length)
    : SITE_CONTENT_MAX_ENVIRONMENT_PROPS;
  const selected = deduped.slice(0, maxEnvironmentProps);
  if (selected.length <= 0) {
    return [];
  }

  return selected.map((candidate, index) => {
    const resolvedTypeID =
      toInt(candidate.typeRecord && candidate.typeRecord.typeID, candidate.typeID) || candidate.typeID;
    const healthState = resolveTypeHealthState(resolvedTypeID);
    const exactOffset = candidate.exact && candidate.positionOffset
      ? candidate.positionOffset
      : null;
    const contentOffset = exactOffset || buildContentOffset(
      `${siteID}:environment:${candidate.typeID}`,
      index,
      selected.length,
      {
        baseDistanceMeters: 18_000,
        jitterMeters: 9_000,
      },
    );
    const suppressSlimName = candidate.suppressSlimName === true;
    const slimLabel = suppressSlimName
      ? ""
      : normalizeText(candidate.explicitLabel, "") || resolveTypeRecordName(candidate.typeRecord, "Environment Feature");
    return {
      kind: "siteEnvironmentProp",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedEnvironment: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonEnvironmentTemplateID: candidate.environmentTemplateID,
      dungeonEnvironmentSource: candidate.source,
      itemID: SITE_CONTENT_ENVIRONMENT_ID_BASE + (siteID * 100) + index + 1,
      typeID: resolvedTypeID,
      groupID: toInt(candidate.typeRecord && candidate.typeRecord.groupID, 0) || 0,
      categoryID: toInt(candidate.typeRecord && candidate.typeRecord.categoryID, 0) || 0,
      graphicID: toInt(candidate.typeRecord && candidate.typeRecord.graphicID, 0) || null,
      ownerID: Math.max(0, toInt(candidate.ownerID, 0)) || SITE_CONTENT_OWNER_ID,
      itemName: slimLabel,
      slimName: slimLabel,
      ...buildSafeSitePropSlimOverrides(candidate.typeRecord),
      slimGraphicID: candidate.suppressSlimGraphicID === true ? null : undefined,
      suppressSlimGraphicID: candidate.suppressSlimGraphicID === true,
      suppressSlimName,
      dunObjectID: Math.max(0, toInt(candidate.dunObjectID, 0)) || undefined,
      ...(candidate.dunObjectNameID !== undefined ? { dunObjectNameID: candidate.dunObjectNameID } : {}),
      ...(candidate.nameID !== undefined ? { nameID: candidate.nameID } : {}),
      ...(candidate.objectiveTargetGroup !== undefined ? { objectiveTargetGroup: candidate.objectiveTargetGroup } : {}),
      dunPosition: candidate.exact ? [contentOffset.x, contentOffset.y, contentOffset.z] : undefined,
      dunRotation: Array.isArray(candidate.dunRotation) ? candidate.dunRotation : undefined,
      position: addVectors(clonePosition(siteEntity && siteEntity.position), contentOffset),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(500, toFiniteNumber(candidate.typeRecord && candidate.typeRecord.radius, 1_500)),
      shieldCapacity: healthState.shieldCapacity,
      armorHP: healthState.armorHP,
      structureHP: healthState.structureHP,
      conditionState: cloneValue(healthState.conditionState),
      staticVisibilityScope: "bubble",
    };
  });
}

function buildObjectiveEntities(instance, siteEntity, template, populationHints = null) {
  const objectiveMetadata =
    template &&
    template.objectiveMetadata &&
    typeof template.objectiveMetadata === "object"
      ? template.objectiveMetadata
      : null;
  const objectiveChain =
    objectiveMetadata &&
    objectiveMetadata.objectiveChain &&
    typeof objectiveMetadata.objectiveChain === "object"
      ? objectiveMetadata.objectiveChain
      : null;
  const objectiveTypesByID =
    objectiveMetadata &&
    objectiveMetadata.objectiveTypesByID &&
    typeof objectiveMetadata.objectiveTypesByID === "object"
      ? objectiveMetadata.objectiveTypesByID
      : {};
  const objectiveTaskTypesByID =
    objectiveMetadata &&
    objectiveMetadata.objectiveTaskTypesByID &&
    typeof objectiveMetadata.objectiveTaskTypesByID === "object"
      ? objectiveMetadata.objectiveTaskTypesByID
      : {};
  const objectives = Array.isArray(objectiveChain && objectiveChain.objectives)
    ? objectiveChain.objectives
    : [];
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const markers = [];
  if (objectives.length > 0) {
    const currentObjectiveKey = normalizeText(
      instance &&
      instance.objectiveState &&
      instance.objectiveState.currentObjectiveKey,
      "",
    );
    const selectedObjective = objectives.find((objective) => (
      currentObjectiveKey && normalizeText(objective && objective.key, "") === currentObjectiveKey
    )) ||
      objectives.find((objective) => objective && (objective.startActive === 1 || objective.startActive === true)) ||
      objectives[0] ||
      null;
    if (selectedObjective) {
      const selectedObjectiveType = normalizeObject(
        objectiveTypesByID[String(toInt(selectedObjective && selectedObjective.objectiveType, 0))],
      );
      markers.push({
        role: "objective",
        label: resolveObjectiveLabel(selectedObjective, selectedObjectiveType),
        objectiveKey: normalizeText(selectedObjective && selectedObjective.key, "") || null,
        objectiveTypeID: Math.max(0, toInt(selectedObjective && selectedObjective.objectiveType, 0)) || null,
        objectiveTaskTypeID: null,
        icon: null,
        analyzer: null,
      });

      for (const task of normalizeArray(selectedObjectiveType.tasks)) {
        if (!(task && (task.startActive === 1 || task.startActive === true))) {
          continue;
        }
        const taskTypeID = Math.max(0, toInt(task && task.taskType, 0)) || null;
        const taskType = normalizeObject(taskTypeID ? objectiveTaskTypesByID[String(taskTypeID)] : null);
        markers.push({
          role: "task",
          label: resolveObjectiveTaskLabel(task, taskType),
          objectiveKey: normalizeText(task && task.key, "") || null,
          objectiveTypeID: Math.max(0, toInt(selectedObjective && selectedObjective.objectiveType, 0)) || null,
          objectiveTaskTypeID: taskTypeID,
          icon: normalizeText(taskType && taskType.icon, "") || null,
          analyzer:
            normalizeLowerText(taskType && taskType.icon, "") === "hacking"
              ? "data"
              : null,
        });
      }
    }
  }
  markers.push(...resolvePopulationObjectiveMarkers(populationHints, template));

  const total = Math.min(SITE_CONTENT_MAX_OBJECTIVE_MARKERS, markers.length);
  if (total <= 0) {
    return [];
  }
  const genericContainerType = resolveGenericContainerTypeRecord();
  const fallbackTypeRecord = resolveItemByTypeID(toInt(siteEntity && siteEntity.typeID, COSMIC_SIGNATURE_TYPE_ID));
  return markers.slice(0, total).map((marker, index) => {
    const typeRecord =
      marker.analyzer && genericContainerType
        ? genericContainerType
        : (fallbackTypeRecord || genericContainerType || {});
    return {
      kind: "siteObjectiveMarker",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedObjective: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonObjectiveRole: marker.role,
      dungeonObjectiveKey: marker.objectiveKey,
      dungeonObjectiveTypeID: marker.objectiveTypeID,
      dungeonObjectiveTaskTypeID: marker.objectiveTaskTypeID,
      dungeonObjectiveIcon: marker.icon,
      itemID: SITE_CONTENT_OBJECTIVE_ID_BASE + (siteID * 100) + index + 1,
      typeID: toInt(typeRecord && typeRecord.typeID, COSMIC_SIGNATURE_TYPE_ID) || COSMIC_SIGNATURE_TYPE_ID,
      groupID: toInt(typeRecord && typeRecord.groupID, COSMIC_SIGNATURE_GROUP_ID) || COSMIC_SIGNATURE_GROUP_ID,
      categoryID: toInt(typeRecord && typeRecord.categoryID, 16) || 16,
      graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: marker.label,
      slimName: marker.label,
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(
          `${siteID}:objective:${marker.objectiveKey || index}`,
          index,
          total,
          {
            baseDistanceMeters: 8_500,
            jitterMeters: 2_500,
          },
        ),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(250, toFiniteNumber(typeRecord && typeRecord.radius, 800)),
      staticVisibilityScope: "bubble",
    };
  });
}

function listEncounterNotificationSessions(scene, options = {}) {
  const sessions = [];
  const seen = new Set();
  const pushSession = (session) => {
    if (!session || typeof session.sendNotification !== "function" || seen.has(session)) {
      return;
    }
    seen.add(session);
    sessions.push(session);
  };

  pushSession(options.session);
  if (!scene || !scene.sessions) {
    return sessions;
  }
  if (scene.sessions instanceof Map) {
    for (const session of scene.sessions.values()) {
      pushSession(session);
    }
    return sessions;
  }
  if (Array.isArray(scene.sessions)) {
    for (const session of scene.sessions) {
      pushSession(session);
    }
    return sessions;
  }
  if (typeof scene.sessions === "object") {
    for (const session of Object.values(scene.sessions)) {
      pushSession(session);
    }
  }
  return sessions;
}

function resolveTriggerAudioDungeonID(instance, audioEntry) {
  const explicitDungeonID = Math.max(0, toInt(audioEntry && audioEntry.dungeonID, 0));
  if (explicitDungeonID > 0) {
    return explicitDungeonID;
  }
  const metadataDungeonID = Math.max(0, toInt(
    instance && instance.metadata && (
      instance.metadata.sourceDungeonID ||
      instance.metadata.dungeonID ||
      instance.metadata.clientDungeonID
    ),
    0,
  ));
  if (metadataDungeonID > 0) {
    return metadataDungeonID;
  }
  const templateID = normalizeText(instance && instance.templateID, "");
  const match = /^client-dungeon:(\d+)$/i.exec(templateID);
  return match ? Math.max(0, toInt(match[1], 0)) : 0;
}

function sendEncounterTriggerNotifications(scene, instance, encounterPlan, options = {}) {
  const planKey = normalizeText(encounterPlan && encounterPlan.key, "");
  if (!planKey) {
    return {
      messagesSent: 0,
      audioSent: 0,
    };
  }
  const triggerMessages = normalizeArray(encounterPlan && encounterPlan.triggerMessages);
  const triggerAudio = normalizeArray(encounterPlan && encounterPlan.triggerAudio);
  if (triggerMessages.length <= 0 && triggerAudio.length <= 0) {
    return {
      messagesSent: 0,
      audioSent: 0,
    };
  }

  const state = getEncounterStateByKey(instance, planKey);
  if (Math.max(0, toInt(state && state.triggerNotificationsSentAtMs, 0)) > 0) {
    return {
      messagesSent: 0,
      audioSent: 0,
    };
  }
  const sessions = listEncounterNotificationSessions(scene, options);
  if (sessions.length <= 0) {
    return {
      messagesSent: 0,
      audioSent: 0,
    };
  }

  let messagesSent = 0;
  let audioSent = 0;
  for (const session of sessions) {
    for (const message of triggerMessages) {
      try {
        session.sendNotification(
          "OnDungeonTriggerMessage",
          normalizeText(message && message.idType, "charid"),
          [
            Math.max(0, toInt(message && message.messageType, 0)),
            Math.max(0, toInt(message && message.messageID, 0)),
          ],
        );
        messagesSent += 1;
      } catch (_error) {
        // Notification delivery is best-effort; encounter materialization must continue.
      }
    }
    for (const audioEntry of triggerAudio) {
      try {
        session.sendNotification(
          "OnDungeonTriggerAudio",
          normalizeText(audioEntry && audioEntry.idType, "shipid"),
          [
            resolveTriggerAudioDungeonID(instance, audioEntry),
            normalizeText(audioEntry && audioEntry.audio, ""),
          ],
        );
        audioSent += 1;
      } catch (_error) {
        // Notification delivery is best-effort; encounter materialization must continue.
      }
    }
  }

  if (messagesSent > 0 || audioSent > 0) {
    upsertEncounterState(instance.instanceID, planKey, {
      triggerNotificationsSentAtMs: Math.max(0, toInt(options.nowMs, Date.now())),
      triggerNotifications: {
        messages: cloneValue(triggerMessages),
        audio: cloneValue(triggerAudio),
      },
    }, { nowMs: options.nowMs });
  }
  return {
    messagesSent,
    audioSent,
  };
}

function sendCompletionTriggerNotifications(scene, instance, populationHints, options = {}) {
  const triggerMessages = normalizeMaybeArray(populationHints && populationHints.completionTriggerMessages);
  const triggerAudio = normalizeMaybeArray(populationHints && populationHints.completionTriggerAudio);
  if (triggerMessages.length <= 0 && triggerAudio.length <= 0) {
    return {
      messagesSent: 0,
      audioSent: 0,
    };
  }

  const objectiveState = normalizeObject(instance && instance.objectiveState);
  const objectiveMetadata = normalizeObject(objectiveState && objectiveState.metadata);
  if (Math.max(0, toInt(objectiveMetadata.completionTriggerNotificationsSentAtMs, 0)) > 0) {
    return {
      messagesSent: 0,
      audioSent: 0,
    };
  }

  const sessions = listEncounterNotificationSessions(scene, options);
  if (sessions.length <= 0) {
    return {
      messagesSent: 0,
      audioSent: 0,
    };
  }

  let messagesSent = 0;
  let audioSent = 0;
  for (const session of sessions) {
    for (const message of triggerMessages) {
      try {
        session.sendNotification(
          "OnDungeonTriggerMessage",
          normalizeText(message && message.idType, "charid"),
          [
            Math.max(0, toInt(message && message.messageType, 0)),
            Math.max(0, toInt(message && message.messageID, 0)),
          ],
        );
        messagesSent += 1;
      } catch (_error) {
        // Notification delivery is best-effort; objective completion must continue.
      }
    }
    for (const audioEntry of triggerAudio) {
      try {
        session.sendNotification(
          "OnDungeonTriggerAudio",
          normalizeText(audioEntry && audioEntry.idType, "shipid"),
          [
            resolveTriggerAudioDungeonID(instance, audioEntry),
            normalizeText(audioEntry && audioEntry.audio, ""),
          ],
        );
        audioSent += 1;
      } catch (_error) {
        // Notification delivery is best-effort; objective completion must continue.
      }
    }
  }

  if (messagesSent > 0 || audioSent > 0) {
    const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
    dungeonRuntime.mergeObjectiveState(instance.instanceID, {
      metadata: {
        ...cloneValue(objectiveMetadata),
        completionTriggerNotificationsSentAtMs: nowMs,
        completionTriggerNotifications: {
          messages: cloneValue(triggerMessages),
          audio: cloneValue(triggerAudio),
        },
      },
    }, { nowMs });
  }
  return {
    messagesSent,
    audioSent,
  };
}

function isKillableStructureSpawnEntry(entry) {
  const entityKind = normalizeLowerText(
    entry && (entry.entityKind || entry.kind || entry.spawnKind || entry.role),
    "",
  ).replace(/[^a-z0-9]+/g, "");
  return Boolean(
    entry &&
      (
        entry.killableStructure === true ||
        entityKind === "killablestructure" ||
        entityKind === "combatstructure" ||
        entityKind === "dungeonstructure"
      )
  );
}

function shouldKillableStructureBlockEncounterProgress(spawnEntry, encounterPlan, context = {}) {
  if (Object.prototype.hasOwnProperty.call(spawnEntry || {}, "blocksEncounterProgress")) {
    return spawnEntry.blocksEncounterProgress !== false;
  }
  if (Object.prototype.hasOwnProperty.call(spawnEntry || {}, "blocksWaveProgress")) {
    return spawnEntry.blocksWaveProgress !== false;
  }
  return context.hasNpcEntries !== true;
}

function allocateKillableStructureEntityID(scene, siteID) {
  const base = SITE_CONTENT_KILLABLE_STRUCTURE_ID_BASE + (Math.max(0, toInt(siteID, 0)) * 100);
  for (let slot = 1; slot <= 99; slot += 1) {
    const candidateID = base + slot;
    if (
      !(scene && scene.staticEntitiesByID instanceof Map && scene.staticEntitiesByID.has(candidateID)) &&
      !(scene && scene.dynamicEntities instanceof Map && scene.dynamicEntities.has(candidateID))
    ) {
      return candidateID;
    }
  }
  return base + 99;
}

function buildKillableStructureEntity(instance, siteEntity, encounterPlan, spawnEntry, context = {}) {
  const typeID = Math.max(0, toInt(spawnEntry && spawnEntry.typeID, 0));
  if (typeID <= 0) {
    return null;
  }
  const typeRecord = resolveItemByTypeID(typeID);
  if (!typeRecord) {
    return null;
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const itemID = Math.max(0, toInt(context.itemID, 0));
  if (siteID <= 0 || instanceID <= 0 || itemID <= 0) {
    return null;
  }
  const total = Math.max(1, toInt(context.total, 1));
  const index = Math.max(0, toInt(context.index, 0));
  const anchorPosition = clonePosition(
    context.anchorPosition && typeof context.anchorPosition === "object"
      ? context.anchorPosition
      : (siteEntity && siteEntity.position),
  );
  const exactOffset = spawnEntry && spawnEntry.positionOffset && typeof spawnEntry.positionOffset === "object"
    ? clonePosition(spawnEntry.positionOffset)
    : null;
  const contentOffset = exactOffset || buildContentOffset(
    `${siteID}:killable_structure:${normalizeText(encounterPlan && encounterPlan.key, "encounter")}`,
    index,
    total,
    {
      baseDistanceMeters: SITE_CONTENT_ENCOUNTER_OFFSET_METERS,
      jitterMeters: 6_000,
    },
  );
  const dunRotation = Array.isArray(spawnEntry && spawnEntry.dunRotation) &&
    spawnEntry.dunRotation.length === 3
    ? spawnEntry.dunRotation.map((value) => toFiniteNumber(value, 0))
    : null;
  const healthState = resolveTypeHealthState(typeID);
  const label =
    normalizeText(spawnEntry && spawnEntry.label, "") ||
    normalizeText(spawnEntry && spawnEntry.name, "") ||
    resolveTypeRecordName(typeRecord, "Mission Structure");
  const suppressSlimName = spawnEntry && spawnEntry.suppressSlimName === true;
  const slimLabel = suppressSlimName ? "" : label;
  return {
    kind: "siteKillableStructure",
    runtimeKind: "missionCombatStructure",
    dungeonMaterializedSiteContent: true,
    dungeonMaterializedKillableStructure: true,
    dungeonSiteID: siteID,
    dungeonSiteInstanceID: instanceID,
    dungeonEncounterKey: normalizeText(encounterPlan && encounterPlan.key, "") || null,
    dungeonSiteContentKey:
      normalizeText(spawnEntry && spawnEntry.key, "") ||
      `killable_structure:${normalizeText(encounterPlan && encounterPlan.key, "encounter")}:${index + 1}`,
    itemID,
    typeID: toInt(typeRecord && typeRecord.typeID, typeID) || typeID,
    groupID: toInt(typeRecord && typeRecord.groupID, 0) || 0,
    categoryID: toInt(typeRecord && typeRecord.categoryID, 0) || 0,
    graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
    ownerID: Math.max(0, toInt(spawnEntry && spawnEntry.ownerID, 0)) || SITE_CONTENT_OWNER_ID,
    itemName: slimLabel,
    slimName: slimLabel,
    suppressSlimName,
    dunObjectID: Math.max(0, toInt(spawnEntry && spawnEntry.dunObjectID, 0)) || undefined,
    ...(Object.prototype.hasOwnProperty.call(spawnEntry || {}, "dunObjectNameID")
      ? { dunObjectNameID: spawnEntry.dunObjectNameID }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(spawnEntry || {}, "nameID")
      ? { nameID: spawnEntry.nameID }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(spawnEntry || {}, "objectiveTargetGroup")
      ? { objectiveTargetGroup: spawnEntry.objectiveTargetGroup }
      : {}),
    dunPosition: [contentOffset.x, contentOffset.y, contentOffset.z],
    dunRotation: dunRotation || undefined,
    position: addVectors(anchorPosition, contentOffset),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(250, toFiniteNumber(typeRecord && typeRecord.radius, 1_000)),
    shieldCapacity: healthState.shieldCapacity,
    armorHP: healthState.armorHP,
    structureHP: healthState.structureHP,
    conditionState: cloneValue(healthState.conditionState),
    staticVisibilityScope: "bubble",
  };
}

function spawnEncounterKillableStructures(scene, instance, siteEntity, encounterPlan, spawnEntries, options = {}) {
  const structures = [];
  const total = Math.max(1, normalizeArray(spawnEntries).length);
  for (let index = 0; index < total; index += 1) {
    const spawnEntry = spawnEntries[index];
    const entity = buildKillableStructureEntity(instance, siteEntity, encounterPlan, spawnEntry, {
      itemID: allocateKillableStructureEntityID(scene, siteEntity && siteEntity.itemID),
      anchorPosition: options.anchorPosition,
      index,
      total,
    });
    if (!entity) {
      continue;
    }
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    if (!scene.addStaticEntity(entity)) {
      continue;
    }
    structures.push({
      entity,
      spawnEntry,
    });
  }
  if (
    structures.length > 0 &&
    options.broadcast !== false &&
    scene &&
    typeof scene.broadcastAddBalls === "function"
  ) {
    scene.broadcastAddBalls(
      structures.map((entry) => entry.entity),
      options.excludedSession || null,
    );
  }
  return structures;
}

function armDeferredEncounterPlans(instance, populationHints, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let armedCount = 0;
  for (const plan of resolveEncounterPlans(populationHints)) {
    // Both visible_countdown (UI timer) and timer (silent delay) arm at site load and fire after
    // their elapsed time; arm them here so the tick can spawn them when due.
    if (plan.trigger !== "visible_countdown" && plan.trigger !== "timer") {
      continue;
    }
    const existingState = getEncounterStateByKey(instance, plan.key);
    if (Math.max(0, toInt(existingState && existingState.armedAtMs, 0)) > 0) {
      continue;
    }
    if (Math.max(0, toInt(existingState && existingState.spawnedAtMs, 0)) > 0) {
      continue;
    }
    upsertEncounterState(instance.instanceID, plan.key, {
      armedAtMs: nowMs,
      countdownSeconds: plan.countdownSeconds,
      delaySeconds: plan.delaySeconds,
      trigger: plan.trigger,
      waveIndex: plan.waveIndex,
      prerequisiteKey: plan.prerequisiteKey,
      lootProfile: plan.lootProfile,
      lootTags: plan.lootTags,
    }, { nowMs });
    armedCount += 1;
  }
  return armedCount;
}

function spawnEncounterPlan(scene, instance, siteEntity, encounterPlan, options = {}) {
  if (!scene || !instance || !siteEntity || !encounterPlan || encounterPlan.supported !== true) {
    return 0;
  }
  const planKey = normalizeText(encounterPlan.key, "");
  if (!planKey) {
    return 0;
  }
  const existingState = getEncounterStateByKey(instance, planKey);
  if (Math.max(0, toInt(existingState && existingState.spawnedAtMs, 0)) > 0) {
    return 0;
  }

  if (!(scene._dungeonUniverseEncounterKeys instanceof Set)) {
    scene._dungeonUniverseEncounterKeys = new Set();
  }
  const encounterKey = `instance:${Math.max(0, toInt(instance && instance.instanceID, 0))}:${planKey}`;
  if (scene._dungeonUniverseEncounterKeys.has(encounterKey)) {
    return 0;
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  // Anchor encounter spawns to the room's position when the trigger supplies one (e.g. an
  // acceleration gate's destination point), so gate-triggered ("on_room_active") rooms spawn their
  // NPCs where the player lands — not back at the site/landing beacon.
  const encounterAnchorPosition = clonePosition(
    (options.roomPosition && typeof options.roomPosition === "object")
      ? options.roomPosition
      : (siteEntity && siteEntity.position),
  );
  // Imported-log/pack encounters carry explicit per-NPC spawnEntries — each with its own ship typeID
  // (and, for log packs, an exact positionOffset). Spawn each NPC as its EXACT profile, resolved from the
  // entry's own identity (typeID/name) rather than the encounter's group-level baseProfileID (which is a
  // coarse, sometimes-wrong faction guess in decoded packs), at its exact position when given, else a
  // procedural offset. The encounter's group-level spawnQuery is only the per-entry last-resort fallback.
  // The scrape path carries no per-NPC spawnEntries on the plan, so it uses the procedural batch below,
  // whose spawnQuery is already the exact profile (resolved upstream in normalizeMissionSpawnQuery).
  const encounterFallbackQuery = normalizeText(encounterPlan.spawnQuery, "npc_hostiles");
  const explicitSpawnEntries = normalizeArray(encounterPlan.spawnEntries)
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, resolveEncounterSpawnEntryLimit(encounterPlan));
  const structureSpawnEntries = explicitSpawnEntries.filter(isKillableStructureSpawnEntry);
  const identitySpawnEntries = explicitSpawnEntries.filter((entry) => !isKillableStructureSpawnEntry(entry));
  const hasNpcEntries = identitySpawnEntries.length > 0 || explicitSpawnEntries.length <= 0;
  const needsNpcSpawnService = hasNpcEntries;
  const npcSpawnService = needsNpcSpawnService ? getNpcSpawnService() : null;
  const populationHints = resolvePopulationHints(instance, dungeonAuthority.getTemplateByID(instance.templateID));
  const completion = normalizeCompletionHints(populationHints);
  if (
    needsNpcSpawnService &&
    (!npcSpawnService || typeof npcSpawnService.spawnNpcBatchInSystem !== "function")
  ) {
    return 0;
  }
  const aggregatedSpawns = [];
  let lastSpawnFailure = null;
  if (identitySpawnEntries.length > 0) {
    for (let entryIndex = 0; entryIndex < identitySpawnEntries.length; entryIndex += 1) {
      const entry = identitySpawnEntries[entryIndex];
      const entryPosition = (entry.positionOffset && typeof entry.positionOffset === "object")
        ? addVectors(encounterAnchorPosition, entry.positionOffset)
        : addVectors(
            encounterAnchorPosition,
            buildContentOffset(
              `${encounterKey}:entry:${entryIndex}`,
              entryIndex,
              identitySpawnEntries.length,
              {
                baseDistanceMeters: SITE_CONTENT_ENCOUNTER_OFFSET_METERS,
                jitterMeters: 8_000,
              },
            ),
          );
      const singleSpawn = npcSpawnService.spawnNpcBatchInSystem(scene.systemID, {
        profileQuery: resolveSpawnIdentityProfileQuery(entry, encounterFallbackQuery),
        amount: 1,
        transient: true,
        position: encounterAnchorPosition,
        spawnStateOverride: { position: entryPosition },
        ownerIDOverride: Math.max(0, toInt(entry && entry.ownerID, 0)) || undefined,
        slimNameOverride: Object.prototype.hasOwnProperty.call(entry || {}, "slimName")
          ? entry.slimName
          : undefined,
        suppressSlimName: entry && entry.suppressSlimName === true,
        nameIDOverride: Math.max(0, toInt(entry && entry.nameID, 0)) || undefined,
        anchorName: `${normalizeText(siteEntity && siteEntity.itemName, "Site")} ${normalizeText(entry.label || encounterPlan.label, "Encounter")}`,
        runtimeKind: "nativeCombat",
      });
      if (singleSpawn && singleSpawn.success && singleSpawn.data && Array.isArray(singleSpawn.data.spawned)) {
        aggregatedSpawns.push(...singleSpawn.data.spawned);
      } else if (singleSpawn) {
        lastSpawnFailure = singleSpawn;
      }
    }
  } else if (explicitSpawnEntries.length <= 0) {
    const proceduralSpawnResult = npcSpawnService.spawnNpcBatchInSystem(scene.systemID, {
      profileQuery: encounterFallbackQuery,
      amount: Math.max(
        1,
        Math.min(
          resolveEncounterSpawnEntryLimit(encounterPlan),
          toInt(encounterPlan.amount, 3),
        ),
      ),
      transient: true,
      position: addVectors(
        encounterAnchorPosition,
        buildContentOffset(
          `${encounterKey}:encounter`,
          Math.max(0, toInt(encounterPlan.waveIndex, 1)) - 1,
          Math.max(1, toInt(options.totalPlans, 1)),
          {
            baseDistanceMeters: SITE_CONTENT_ENCOUNTER_OFFSET_METERS,
            jitterMeters: 8_000,
          },
        ),
      ),
      anchorName: `${normalizeText(siteEntity && siteEntity.itemName, "Site")} ${normalizeText(encounterPlan.label, "Encounter")}`,
      spreadMeters: 8_000,
      formationSpacingMeters: 2_500,
      runtimeKind: "nativeCombat",
    });
    if (
      proceduralSpawnResult &&
      proceduralSpawnResult.success &&
      proceduralSpawnResult.data &&
      Array.isArray(proceduralSpawnResult.data.spawned)
    ) {
      aggregatedSpawns.push(...proceduralSpawnResult.data.spawned);
    } else if (proceduralSpawnResult) {
      lastSpawnFailure = proceduralSpawnResult;
    }
    const fallbackSpawnQuery = normalizeText(encounterPlan.fallbackSpawnQuery, "");
    if (
      aggregatedSpawns.length <= 0 &&
      fallbackSpawnQuery &&
      normalizeLowerText(fallbackSpawnQuery, "") !== normalizeLowerText(encounterFallbackQuery, "")
    ) {
      const fallbackSpawnResult = npcSpawnService.spawnNpcBatchInSystem(scene.systemID, {
        profileQuery: fallbackSpawnQuery,
        amount: Math.max(
          1,
          Math.min(
            resolveEncounterSpawnEntryLimit(encounterPlan),
            toInt(encounterPlan.amount, 3),
          ),
        ),
        transient: true,
        position: addVectors(
          encounterAnchorPosition,
          buildContentOffset(
            `${encounterKey}:encounter:fallback`,
            Math.max(0, toInt(encounterPlan.waveIndex, 1)) - 1,
            Math.max(1, toInt(options.totalPlans, 1)),
            {
              baseDistanceMeters: SITE_CONTENT_ENCOUNTER_OFFSET_METERS,
              jitterMeters: 8_000,
            },
          ),
        ),
        anchorName: `${normalizeText(siteEntity && siteEntity.itemName, "Site")} ${normalizeText(encounterPlan.label, "Encounter")}`,
        spreadMeters: 8_000,
        formationSpacingMeters: 2_500,
        runtimeKind: "nativeCombat",
      });
      if (
        fallbackSpawnResult &&
        fallbackSpawnResult.success &&
        fallbackSpawnResult.data &&
        Array.isArray(fallbackSpawnResult.data.spawned)
      ) {
        aggregatedSpawns.push(...fallbackSpawnResult.data.spawned);
      } else if (fallbackSpawnResult) {
        lastSpawnFailure = fallbackSpawnResult;
      }
    }
  }
  if (structureSpawnEntries.length > 0) {
    const structureSpawns = spawnEncounterKillableStructures(
      scene,
      instance,
      siteEntity,
      encounterPlan,
      structureSpawnEntries,
      {
        anchorPosition: encounterAnchorPosition,
        broadcast: options.broadcast,
        excludedSession: options.excludedSession || null,
      },
    )
      .map((entry) => ({
        ...entry,
        encounterProgressBlocker: shouldKillableStructureBlockEncounterProgress(
          entry && entry.spawnEntry,
          encounterPlan,
          {
            hasNpcEntries,
          },
        ),
        objectiveProgressBlocker: isObjectiveTargetSpawnEntry(
          entry && entry.spawnEntry,
          encounterPlan,
          completion,
        ),
      }));
    for (const entry of structureSpawns) {
      if (entry && entry.entity) {
        entry.entity.dungeonEncounterBlocksProgress = entry.encounterProgressBlocker !== false;
        entry.entity.dungeonObjectiveProgressTarget = entry.objectiveProgressBlocker === true;
        if (entry.objectiveProgressBlocker === true && entry.spawnEntry) {
          entry.entity.dungeonObjectiveTargetKey =
            normalizeText(entry.spawnEntry.key, "") ||
            normalizeText(entry.spawnEntry.label, "") ||
            null;
        }
      }
    }
    aggregatedSpawns.push(...structureSpawns);
  }
  const spawnResult = aggregatedSpawns.length > 0
    ? { success: true, data: { spawned: aggregatedSpawns } }
    : (lastSpawnFailure || { success: false, errorMsg: "ENCOUNTER_SPAWN_FAILED" });
  if (
    !spawnResult ||
    !spawnResult.success ||
    !spawnResult.data ||
    !Array.isArray(spawnResult.data.spawned) ||
    spawnResult.data.spawned.length <= 0
  ) {
    upsertEncounterState(instance.instanceID, planKey, {
      lastAttemptAtMs: nowMs,
    }, { nowMs });
    return 0;
  }

  scene._dungeonUniverseEncounterKeys.add(encounterKey);
  const spawnedEntityIDs = normalizeIDList(
    spawnResult.data.spawned
      .map((entry) => toInt(entry && entry.entity && entry.entity.itemID, 0))
      .filter((entry) => entry > 0),
  );
  const remainingEntityIDs = normalizeIDList(
    spawnResult.data.spawned
      .filter((entry) => !(entry && entry.encounterProgressBlocker === false))
      .map((entry) => toInt(entry && entry.entity && entry.entity.itemID, 0))
      .filter((entry) => entry > 0),
  );
  const objectiveBlockingEntityIDs = normalizeIDList(
    spawnResult.data.spawned
      .filter((entry) => entry && entry.objectiveProgressBlocker === true)
      .map((entry) => toInt(entry && entry.entity && entry.entity.itemID, 0))
      .filter((entry) => entry > 0),
  );
  const plans = resolveEncounterPlans(populationHints);
  const currentRoomKey = resolveEncounterRoomKey(
    dungeonRuntime.getInstance(instance.instanceID) || instance,
    { encounters: plans },
    encounterPlan,
  );
  try {
    dungeonRuntime.activateRoom(instance.instanceID, currentRoomKey, {
      nowMs,
      stage: currentRoomKey === "room:entry" ? "entry" : "pocket",
    });
  } catch (error) {
    // Some site templates have no explicit room progression beyond the entry state.
  }
  const totalWaves = Math.max(
    1,
    plans.reduce((highest, plan) => Math.max(highest, toInt(plan && plan.waveIndex, 1)), 1),
  );
  if (
    instance &&
    instance.objectiveState &&
    ["seeded", "in_progress"].includes(normalizeLowerText(instance.objectiveState.state, ""))
  ) {
    const existingCounters =
      instance.objectiveState && instance.objectiveState.counters && typeof instance.objectiveState.counters === "object"
        ? instance.objectiveState.counters
        : {};
    const existingMetadata =
      instance.objectiveState && instance.objectiveState.metadata && typeof instance.objectiveState.metadata === "object"
        ? instance.objectiveState.metadata
        : {};
    dungeonRuntime.advanceObjective(instance.instanceID, {
      state: "in_progress",
      counters: {
        ...cloneValue(existingCounters),
        current_wave: Math.max(1, toInt(encounterPlan.waveIndex, 1)),
        total_waves: totalWaves,
      },
      metadata: {
        ...cloneValue(existingMetadata),
        currentRoomKey,
        currentWave: Math.max(1, toInt(encounterPlan.waveIndex, 1)),
        totalWaves,
      },
    }, { nowMs });
  }
  upsertEncounterState(instance.instanceID, planKey, {
    armedAtMs: Math.max(0, toInt(existingState && existingState.armedAtMs, 0)) || nowMs,
    spawnedAtMs: nowMs,
    spawnCount: spawnResult.data.spawned.length,
    spawnedEntityIDs,
    remainingEntityIDs,
    nonBlockingEntityIDs: spawnedEntityIDs.filter((entityID) => !remainingEntityIDs.includes(entityID)),
    objectiveBlockingEntityIDs,
    nonObjectiveEntityIDs: spawnedEntityIDs.filter((entityID) => !objectiveBlockingEntityIDs.includes(entityID)),
    trigger: normalizeText(options.trigger, encounterPlan.trigger),
    waveIndex: encounterPlan.waveIndex,
    prerequisiteKey: encounterPlan.prerequisiteKey || null,
    lootProfile: encounterPlan.lootProfile,
    lootTags: encounterPlan.lootTags,
    roomKey: currentRoomKey,
    label: encounterPlan.label,
    notes: encounterPlan.notes,
  }, { nowMs });
  sendEncounterTriggerNotifications(scene, instance, encounterPlan, {
    ...options,
    nowMs,
  });
  return spawnResult.data.spawned.length;
}

function processEncounterPlansForTrigger(scene, instance, siteEntity, populationHints, trigger, options = {}) {
  const normalizedTrigger = normalizeLowerText(trigger, "");
  if (!normalizedTrigger) {
    return 0;
  }
  const triggerRoomKey = normalizeText(
    options.roomKey || options.currentRoomKey || options.destinationRoomKey,
    "",
  );
  const plans = resolveEncounterPlans(populationHints);
  const triggeredPlans = plans
    .filter((plan) => {
      if (plan.trigger !== normalizedTrigger) {
        return false;
      }
      if (!triggerRoomKey) {
        return true;
      }
      return resolveEncounterRoomKey(instance, populationHints, plan) === triggerRoomKey;
    });
  if (triggeredPlans.length <= 0) {
    return 0;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let encountersSpawned = 0;
  for (const plan of triggeredPlans) {
    if (normalizedTrigger === "visible_countdown") {
      const state = getEncounterStateByKey(instance, plan.key);
      const armedAtMs = Math.max(0, toInt(state && state.armedAtMs, 0));
      if (armedAtMs <= 0) {
        continue;
      }
      const countdownMs = Math.max(0, toInt(plan.countdownSeconds, 0)) * 1000;
      if (countdownMs > 0 && nowMs < armedAtMs + countdownMs) {
        continue;
      }
    }
    if (normalizedTrigger === "timer") {
      // Silent delayed spawn: fire once delaySeconds have elapsed since the encounter was armed
      // (site load). delaySeconds<=0 fires on the next tick (immediate reinforcement).
      const state = getEncounterStateByKey(instance, plan.key);
      const armedAtMs = Math.max(0, toInt(state && state.armedAtMs, 0));
      if (armedAtMs <= 0) {
        continue;
      }
      const delayMs = Math.max(0, toInt(plan.delaySeconds, 0)) * 1000;
      if (delayMs > 0 && nowMs < armedAtMs + delayMs) {
        continue;
      }
    }
    if (normalizedTrigger === "wave_cleared" || normalizedTrigger === "battleships_destroyed") {
      const prerequisiteKeys = resolveEncounterPrerequisiteKeys(plans, plan);
      if (prerequisiteKeys.length <= 0) {
        continue;
      }
      let prerequisiteBlocked = false;
      for (const prerequisiteKey of prerequisiteKeys) {
        const prerequisiteState = getEncounterStateByKey(instance, prerequisiteKey);
        const prerequisiteSpawnedAtMs = Math.max(0, toInt(prerequisiteState && prerequisiteState.spawnedAtMs, 0));
        if (prerequisiteSpawnedAtMs <= 0) {
          prerequisiteBlocked = true;
          break;
        }
        const prerequisitePlan = plans.find((entry) => normalizeText(entry && entry.key, "") === prerequisiteKey) || null;
        const aliveEntityIDs = listAliveEncounterEntityIDs(scene, prerequisiteState, prerequisitePlan);
        if (aliveEntityIDs.length > 0) {
          if (!areSortedNumberListsEqual(prerequisiteState && prerequisiteState.remainingEntityIDs, aliveEntityIDs)) {
            upsertEncounterState(instance.instanceID, prerequisiteKey, {
              remainingEntityIDs: aliveEntityIDs,
            }, { nowMs });
          }
          prerequisiteBlocked = true;
          break;
        }
        if (Math.max(0, toInt(prerequisiteState && prerequisiteState.completedAtMs, 0)) <= 0) {
          upsertEncounterState(instance.instanceID, prerequisiteKey, {
            remainingEntityIDs: [],
            completedAtMs: nowMs,
            completionTrigger: normalizedTrigger,
          }, { nowMs });
        }
      }
      if (prerequisiteBlocked) {
        continue;
      }
    }
    encountersSpawned += spawnEncounterPlan(scene, instance, siteEntity, plan, {
      ...options,
      nowMs,
      trigger: normalizedTrigger,
      totalPlans: plans.length,
    });
  }
  return encountersSpawned;
}

function hasDueVisibleCountdownTrigger(instance, populationHints, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  for (const plan of resolveEncounterPlans(populationHints)) {
    if (normalizeLowerText(plan && plan.trigger, "") !== "visible_countdown") {
      continue;
    }
    const state = getEncounterStateByKey(instance, plan.key);
    const armedAtMs = Math.max(0, toInt(state && state.armedAtMs, 0));
    const triggeredAtMs = Math.max(0, toInt(state && state.triggeredEffectsAtMs, 0));
    if (armedAtMs <= 0 || triggeredAtMs > 0) {
      continue;
    }
    const countdownMs = Math.max(0, toInt(plan && plan.countdownSeconds, 0)) * 1000;
    if (countdownMs <= 0 || nowMs >= armedAtMs + countdownMs) {
      return true;
    }
  }
  return false;
}

function maybeAdvanceEncounterDrivenProgression(instance, populationHints, options = {}) {
  if (!instance) {
    return {
      roomsCompleted: 0,
      gatesUnlocked: 0,
      roomsActivated: 0,
    };
  }
  const plans = resolveEncounterPlans(populationHints)
    .filter((plan) => plan.supported === true);
  if (plans.length <= 0) {
    return {
      roomsCompleted: 0,
      gatesUnlocked: 0,
      roomsActivated: 0,
    };
  }
  const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
  const groupedPlans = groupEncounterPlansByRoom(latestInstance, populationHints);
  const orderedRoomKeys = listOrderedInstanceRoomKeys(latestInstance);
  const orderedGateKeys = listOrderedInstanceGateKeys(latestInstance);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let roomsCompleted = 0;
  let gatesUnlocked = 0;
  let roomsActivated = 0;
  let settledPlanCount = 0;

  const settledPlansByKey = {};
  for (const plan of plans) {
    const settled = isEncounterPlanSettled(latestInstance, plan);
    settledPlansByKey[plan.key] = settled;
    if (settled) {
      settledPlanCount += 1;
    }
  }
  const completionSatisfied = isEncounterCompletionSatisfied(latestInstance, plans, populationHints);

  let workingInstance = latestInstance;
  orderedRoomKeys.forEach((roomKey, roomIndex) => {
    const roomPlans = normalizeArray(groupedPlans[roomKey]);
    if (roomPlans.length <= 0) {
      return;
    }
    const roomState = workingInstance.roomStatesByKey && workingInstance.roomStatesByKey[roomKey];
    const roomSettled = roomPlans.every((plan) => settledPlansByKey[plan.key] === true);
    if (!roomSettled) {
      return;
    }
    if (roomState && normalizeLowerText(roomState.state, "") !== "completed") {
      workingInstance = dungeonRuntime.completeRoom(workingInstance.instanceID, roomKey, {
        nowMs,
        stage: roomKey === "room:entry" ? "entry" : "pocket",
      });
      roomsCompleted += 1;
    }
    const nextRoomKey = orderedRoomKeys[roomIndex + 1] || null;
    if (!nextRoomKey) {
      return;
    }
    const nextRoomState = workingInstance.roomStatesByKey && workingInstance.roomStatesByKey[nextRoomKey];
    const gateKey = orderedGateKeys.find((candidateGateKey) => {
      const gateState = workingInstance.gateStatesByKey && workingInstance.gateStatesByKey[candidateGateKey];
      return normalizeText(gateState && gateState.destinationRoomKey, "") === nextRoomKey;
    }) || orderedGateKeys[roomIndex] || null;
    if (gateKey) {
      const gateState = workingInstance.gateStatesByKey && workingInstance.gateStatesByKey[gateKey];
      if (normalizeLowerText(gateState && gateState.state, "") === "locked") {
        workingInstance = dungeonRuntime.unlockGate(workingInstance.instanceID, gateKey, {
          nowMs,
          destinationRoomKey: nextRoomKey,
        });
        gatesUnlocked += 1;
      }
    }
    if (nextRoomState && normalizeLowerText(nextRoomState.state, "") === "pending") {
      workingInstance = dungeonRuntime.activateRoom(workingInstance.instanceID, nextRoomKey, {
        nowMs,
        stage: roomIndex + 1 >= orderedRoomKeys.length - 1 ? "final_pocket" : "pocket",
      });
      roomsActivated += 1;
    }
  });

  const refreshedInstance = dungeonRuntime.getInstance(instance.instanceID) || workingInstance;
  if (refreshedInstance && refreshedInstance.objectiveState) {
    const existingCounters =
      refreshedInstance.objectiveState.counters && typeof refreshedInstance.objectiveState.counters === "object"
        ? refreshedInstance.objectiveState.counters
        : {};
    const existingMetadata =
      refreshedInstance.objectiveState.metadata && typeof refreshedInstance.objectiveState.metadata === "object"
        ? refreshedInstance.objectiveState.metadata
        : {};
    const nextPatch = {
      state: completionSatisfied ? "completed" : "in_progress",
      counters: {
        ...cloneValue(existingCounters),
        current_wave: Math.max(0, settledPlanCount),
        total_waves: Math.max(1, plans.length),
        rooms_completed: Object.values(refreshedInstance.roomStatesByKey || {})
          .filter((roomState) => normalizeLowerText(roomState && roomState.state, "") === "completed")
          .length,
      },
      metadata: {
        ...cloneValue(existingMetadata),
        currentWave: Math.max(0, settledPlanCount),
        totalWaves: Math.max(1, plans.length),
        completionEncounterKeys: resolveCompletionEncounterKeys(
          normalizeCompletionHints(populationHints),
          plans,
        ),
      },
    };
    const currentComparableObjectiveState = {
      state: normalizeLowerText(refreshedInstance.objectiveState.state, "pending"),
      counters: cloneValue(existingCounters),
      metadata: {
        ...cloneValue(existingMetadata),
      },
      completedAtMs: Math.max(
        0,
        toInt(refreshedInstance.objectiveState.completedAtMs, 0),
      ),
    };
    delete currentComparableObjectiveState.metadata.lastAdvancedAtMs;
    delete currentComparableObjectiveState.metadata.lastProgressionAtMs;
    const nextComparableObjectiveState = {
      state: normalizeLowerText(nextPatch.state, "pending"),
      counters: cloneValue(nextPatch.counters),
      metadata: {
        ...cloneValue(nextPatch.metadata),
      },
      completedAtMs: Math.max(
        0,
        toInt(refreshedInstance.objectiveState.completedAtMs, 0),
      ),
    };
    if (completionSatisfied) {
      const existingCompletedAtMs = Math.max(
        0,
        toInt(refreshedInstance.objectiveState.completedAtMs, 0),
      );
      const nextCompletedAtMs = existingCompletedAtMs > 0 ? existingCompletedAtMs : nowMs;
      nextComparableObjectiveState.completedAtMs = nextCompletedAtMs;
      nextPatch.completedAtMs = nextCompletedAtMs;
    }
    if (
      !isDeepStrictEqual(
        currentComparableObjectiveState,
        nextComparableObjectiveState,
      )
    ) {
      nextPatch.metadata.lastProgressionAtMs = nowMs;
      dungeonRuntime.advanceObjective(refreshedInstance.instanceID, nextPatch, {
        nowMs,
      });
    }
    if (completionSatisfied) {
      sendCompletionTriggerNotifications(
        options.scene || null,
        dungeonRuntime.getInstance(refreshedInstance.instanceID) || refreshedInstance,
        populationHints,
        {
          nowMs,
          session: options.session || null,
        },
      );
    }
  }
  return {
    roomsCompleted,
    gatesUnlocked,
    roomsActivated,
  };
}

function applyTriggeredSiteEffects(scene, instance, siteEntity, populationHints, trigger, options = {}) {
  const normalizedTrigger = normalizeLowerText(trigger, "");
  if (!scene || !instance || !normalizedTrigger) {
    return {
      removedContainers: 0,
      triggeredHazards: 0,
    };
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const contentEntities = listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
  });
  let removedContainers = 0;
  let triggeredHazards = 0;

  if (normalizedTrigger === "hack_failure") {
    for (const entity of contentEntities) {
      if (!entity || entity.dungeonMaterializedContainer !== true) {
        continue;
      }
      if (entity.dungeonSiteContentFailureExplodes !== true) {
        continue;
      }
      const removed = destroyMaterializedContentEntity(scene, entity, {
        broadcast: false,
        nowMs,
      });
      if (removed && removed.success) {
        removedContainers += 1;
      }
    }
  }

  if (normalizedTrigger === "visible_countdown") {
    for (const entity of contentEntities) {
      if (!entity || entity.dungeonMaterializedContainer !== true) {
        continue;
      }
      if (entity.dungeonSiteContentPersistsAfterResponse === true) {
        continue;
      }
      const removed = destroyMaterializedContentEntity(scene, entity, {
        broadcast: false,
        nowMs,
      });
      if (removed && removed.success) {
        removedContainers += 1;
      }
    }
  }

  for (const entity of contentEntities) {
    if (!entity || entity.dungeonMaterializedHazard !== true) {
      continue;
    }
    const shouldTrigger = (
      (normalizedTrigger === "hack_failure" && entity.dungeonHazardFailureTriggersExplosion === true) ||
      (normalizedTrigger === "visible_countdown" && Number(entity.dungeonHazardVisibleCountdownSeconds || 0) > 0)
    );
    if (!shouldTrigger) {
      continue;
    }
    if (normalizeLowerText(entity.dungeonHazardState, "") === "triggered") {
      continue;
    }
    entity.dungeonHazardState = "triggered";
    entity.dungeonHazardTriggeredAtMs = nowMs;
    triggeredHazards += 1;
  }

  if (removedContainers > 0 || triggeredHazards > 0) {
    dungeonRuntime.mergeHazardState(instance.instanceID, {
      lastTrigger: normalizedTrigger,
      lastTriggeredAtMs: nowMs,
      removedContainers,
      triggeredHazards,
      responseTriggered:
        normalizedTrigger === "visible_countdown" || normalizedTrigger === "hack_failure",
    }, { nowMs });
  }

  return {
    removedContainers,
    triggeredHazards,
  };
}

// Resolve the world position a proximity encounter watches. Prefer the named objective/environment
// object (proximityTargetKey); fall back to the site beacon center (the warp-in point) so proximity
// missions still trigger sensibly even when the exact target object isn't separately materialized.
function resolveProximityTargetPosition(siteEntity, populationHints, targetKey) {
  const siteCenter = siteEntity && siteEntity.position ? clonePosition(siteEntity.position) : null;
  const key = normalizeText(targetKey, "");
  if (key && siteCenter) {
    const candidates = [
      ...normalizeArray(populationHints && populationHints.objectiveMarkers),
      ...normalizeArray(populationHints && populationHints.environmentProps),
    ];
    const marker = candidates.find((candidate) => normalizeText(candidate && candidate.key, "") === key);
    if (marker) {
      if (marker.position && typeof marker.position === "object") {
        return clonePosition(marker.position);
      }
      if (marker.positionOffset && typeof marker.positionOffset === "object") {
        return addVectors(siteCenter, marker.positionOffset);
      }
    }
  }
  return siteCenter;
}

function anyPlayerShipWithinRange(scene, position, rangeMeters) {
  if (!position || !scene || !(scene.dynamicEntities instanceof Map)) {
    return false;
  }
  const range = Math.max(1, toFiniteNumber(rangeMeters, 1));
  const rangeSquared = range * range;
  for (const entity of scene.dynamicEntities.values()) {
    if (!entity || entity.kind !== "ship") {
      continue;
    }
    if (toInt(entity.charID, 0) <= 0 && toInt(entity.characterID, 0) <= 0) {
      continue;
    }
    const entityPosition = entity.position;
    if (!entityPosition) {
      continue;
    }
    const dx = toFiniteNumber(entityPosition.x, 0) - position.x;
    const dy = toFiniteNumber(entityPosition.y, 0) - position.y;
    const dz = toFiniteNumber(entityPosition.z, 0) - position.z;
    if ((dx * dx) + (dy * dy) + (dz * dz) <= rangeSquared) {
      return true;
    }
  }
  return false;
}

// Spawn proximity-triggered encounters when a player ship comes within range of the encounter's
// target object. Mirrors the gate (on_room_active) / wave_cleared trigger handling but is evaluated
// continuously from tickSceneSiteBehaviors since there is no explicit player action to hook.
function processProximityEncounterTriggers(scene, instance, siteEntity, populationHints, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const proximityPlans = resolveEncounterPlans(populationHints)
    .filter((plan) => normalizeLowerText(plan && plan.trigger, "") === "proximity")
    .sort((left, right) => Math.max(1, toInt(left.waveIndex, 1)) - Math.max(1, toInt(right.waveIndex, 1)));
  if (proximityPlans.length <= 0) {
    return 0;
  }
  let encountersSpawned = 0;
  for (const plan of proximityPlans) {
    const existingState = getEncounterStateByKey(instance, plan.key);
    if (Math.max(0, toInt(existingState && existingState.spawnedAtMs, 0)) > 0) {
      continue;
    }
    // Stagger reinforcement waves: a higher-waveIndex wave for the same target spawns only once
    // every lower wave is spawned AND cleared (no alive entities). Same-waveIndex groups spawn
    // together; wave 1 has no lower wave so it fires as soon as the player is in range.
    const planWaveIndex = Math.max(1, toInt(plan.waveIndex, 1));
    const planTargetKey = normalizeText(plan.proximityTargetKey, "");
    const blockedByEarlierWave = proximityPlans.some((other) => {
      if (other === plan || normalizeText(other.proximityTargetKey, "") !== planTargetKey) {
        return false;
      }
      if (Math.max(1, toInt(other.waveIndex, 1)) >= planWaveIndex) {
        return false;
      }
      const otherState = getEncounterStateByKey(instance, other.key);
      if (Math.max(0, toInt(otherState && otherState.spawnedAtMs, 0)) <= 0) {
        return true;
      }
      return listAliveEncounterEntityIDs(scene, otherState, other).length > 0;
    });
    if (blockedByEarlierWave) {
      continue;
    }
    const targetPosition = resolveProximityTargetPosition(siteEntity, populationHints, plan.proximityTargetKey);
    if (!targetPosition) {
      continue;
    }
    const rangeMeters =
      Math.max(0, toFiniteNumber(plan.proximityRangeMeters, 0)) ||
      SITE_CONTENT_PROXIMITY_DEFAULT_RANGE_METERS;
    if (!anyPlayerShipWithinRange(scene, targetPosition, rangeMeters)) {
      continue;
    }
    encountersSpawned += spawnEncounterPlan(scene, instance, siteEntity, plan, {
      ...options,
      nowMs,
      trigger: "proximity",
      totalPlans: proximityPlans.length,
      roomPosition: targetPosition,
    });
  }
  return encountersSpawned;
}

// Mining objective (Plan C2): complete the site once objectiveQuantity ore has been extracted from
// its mission rocks (sum of each rock's initial quantity minus its current miningRuntimeState
// remaining). Reports into the B1/B2 completion hook (markInstanceObjectiveSatisfied). Gated on a
// positive populationHints.objectiveQuantity, so non-mining sites are unaffected.
function processMiningObjective(scene, instance, populationHints, options = {}) {
  const objectiveQuantity = Math.max(0, toInt(populationHints && populationHints.objectiveQuantity, 0));
  if (objectiveQuantity <= 0 || isSiteObjectiveExplicitlySatisfied(instance)) {
    return 0;
  }
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  if (!instanceID || !scene) {
    return 0;
  }
  let miningRuntimeState = null;
  try {
    miningRuntimeState = require(path.join(__dirname, "../mining/miningRuntimeState"));
  } catch (_error) {
    return 0;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let extracted = 0;
  let rockCount = 0;
  const liveRocksByID = new Map();
  for (const entity of listMaterializedUniverseSiteContentEntities(scene, { instanceID })) {
    if (!entity || entity.dungeonMaterializedMiningRock !== true) {
      continue;
    }
    if (Math.max(0, toInt(entity.dungeonSiteInstanceID, 0)) !== instanceID) {
      continue;
    }
    const entityID = Math.max(0, toInt(entity.itemID, 0));
    if (entityID > 0) {
      liveRocksByID.set(entityID, entity);
    }
  }
  const descriptorsByID = new Map();
  for (const descriptor of listMiningObjectiveRockDescriptors(instance, populationHints)) {
    const entityID = Math.max(0, toInt(descriptor && descriptor.entityID, 0));
    if (entityID > 0) {
      descriptorsByID.set(entityID, descriptor);
    }
  }
  for (const [entityID, entity] of liveRocksByID.entries()) {
    if (!descriptorsByID.has(entityID)) {
      descriptorsByID.set(entityID, {
        entityID,
        quantity: Math.max(
          0,
          toInt(entity.miningOriginalQuantity, 0),
          toInt(entity.originalQuantity, 0),
          toInt(entity.mineableQuantity, 0),
          toInt(entity.resourceQuantity, 0),
          toInt(entity.miningRemainingQuantity, 0),
        ),
      });
    }
  }
  for (const descriptor of descriptorsByID.values()) {
    const entityID = Math.max(0, toInt(descriptor && descriptor.entityID, 0));
    if (entityID <= 0) {
      continue;
    }
    const entity = liveRocksByID.get(entityID) || null;
    rockCount += 1;
    let state = null;
    if (typeof miningRuntimeState.getMineableState === "function") {
      state = miningRuntimeState.getMineableState(scene, entityID);
    }
    const initial = Math.max(
      0,
      toInt(state && state.originalQuantity, 0),
      toInt(descriptor && descriptor.quantity, 0),
      toInt(entity && entity.miningOriginalQuantity, 0),
      toInt(entity && entity.originalQuantity, 0),
      toInt(entity && entity.mineableQuantity, 0),
      toInt(entity && entity.resourceQuantity, 0),
      toInt(entity && entity.miningRemainingQuantity, 0),
    );
    const remaining = Math.max(
      0,
      toInt(state && state.remainingQuantity, initial),
    );
    extracted += Math.max(0, initial - remaining);
  }
  if (rockCount > 0 && extracted >= objectiveQuantity) {
    try {
      dungeonRuntime.markInstanceObjectiveSatisfied(instanceID, {
        reason: "mining_quantity_reached",
        nowMs,
      });
      return 1;
    } catch (_error) {
      return 0;
    }
  }
  return 0;
}

function maybeAdvanceExplicitlySatisfiedObjective(instance, options = {}) {
  if (!instance || !isSiteObjectiveExplicitlySatisfied(instance)) {
    return false;
  }
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  if (!instanceID) {
    return false;
  }
  const refreshedInstance = dungeonRuntime.getInstance(instanceID) || instance;
  const objectiveState =
    refreshedInstance &&
    refreshedInstance.objectiveState &&
    typeof refreshedInstance.objectiveState === "object"
      ? refreshedInstance.objectiveState
      : {};
  if (
    normalizeLowerText(objectiveState.state, "") === "completed" &&
    Math.max(0, toInt(objectiveState.completedAtMs, 0)) > 0
  ) {
    return false;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const satisfiedAtMs = Math.max(
    0,
    toInt(refreshedInstance && refreshedInstance.objectiveSatisfiedAtMs, 0),
    toInt(refreshedInstance && refreshedInstance.metadata && refreshedInstance.metadata.objectiveSatisfiedAtMs, 0),
    nowMs,
  );
  const existingMetadata =
    objectiveState.metadata &&
    typeof objectiveState.metadata === "object" &&
    !Array.isArray(objectiveState.metadata)
      ? objectiveState.metadata
      : {};
  const existingCounters =
    objectiveState.counters &&
    typeof objectiveState.counters === "object" &&
    !Array.isArray(objectiveState.counters)
      ? objectiveState.counters
      : {};
  dungeonRuntime.advanceObjective(instanceID, {
    state: "completed",
    completedAtMs: satisfiedAtMs,
    counters: cloneValue(existingCounters),
    metadata: {
      ...cloneValue(existingMetadata),
      objectiveSatisfiedAtMs: satisfiedAtMs,
      objectiveSatisfiedReason:
        normalizeText(refreshedInstance && refreshedInstance.objectiveSatisfiedReason, "") ||
        normalizeText(existingMetadata.objectiveSatisfiedReason, "") ||
        null,
    },
  }, { nowMs });
  return true;
}

function isDungeonInstanceObjectiveCompleted(instance) {
  const objectiveState = normalizeObject(instance && instance.objectiveState);
  return (
    normalizeLowerText(objectiveState.state, "") === "completed" ||
    Math.max(0, toInt(objectiveState.completedAtMs, 0)) > 0
  );
}

function syncAgentMissionForCompletedDungeonObjective(instance, options = {}) {
  if (!instance || !isDungeonInstanceObjectiveCompleted(instance)) {
    return null;
  }
  const metadata = normalizeObject(instance && instance.metadata);
  const runtimeFlags = normalizeObject(instance && instance.runtimeFlags);
  if (metadata.missionRuntime !== true && runtimeFlags.missionRuntime !== true) {
    return null;
  }
  try {
    const agentMissionRuntime = require(path.join(__dirname, "../agent/agentMissionRuntime"));
    if (
      agentMissionRuntime &&
      typeof agentMissionRuntime.syncMissionRecordForDungeonInstance === "function"
    ) {
      return agentMissionRuntime.syncMissionRecordForDungeonInstance(instance, {
        notifyTracker: true,
        notifyMissionChange: false,
        nowMs: options.nowMs,
      });
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function tickSceneSiteBehaviors(scene, options = {}) {
  if (!scene) {
    return {
      armedCount: 0,
      encountersSpawned: 0,
      encounterCompletions: 0,
      gatesUnlocked: 0,
      rewardContainersSpawned: 0,
    };
  }
  const materializedSiteIDs = [...ensureSceneMaterializedSiteSet(scene)];
  if (materializedSiteIDs.length <= 0) {
    return {
      armedCount: 0,
      encountersSpawned: 0,
      encounterCompletions: 0,
      gatesUnlocked: 0,
      rewardContainersSpawned: 0,
    };
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let armedCount = 0;
  let encountersSpawned = 0;
  let encounterCompletions = 0;
  let gatesUnlocked = 0;
  let rewardContainersSpawned = 0;
  const instances = materializedSiteIDs
    .map((siteID) => resolveManagedUniverseSiteInstance(scene, null, { siteID }))
    .filter((instance) => isManagedMaterializedSiteInstance(instance));

  for (const instance of instances) {
    const template = dungeonAuthority.getTemplateByID(instance.templateID);
    const populationHints = resolvePopulationHints(instance, template);
    // Mining objective runs before the encounter-plan gate so pure-mining sites (no NPCs) progress.
    processMiningObjective(scene, instance, populationHints, { nowMs });
    const refreshedForObjective =
      dungeonRuntime.getInstance(instance.instanceID) || instance;
    maybeAdvanceExplicitlySatisfiedObjective(refreshedForObjective, { nowMs });
    syncAgentMissionForCompletedDungeonObjective(
      dungeonRuntime.getInstance(instance.instanceID) || refreshedForObjective,
      { nowMs },
    );
    const plans = resolveEncounterPlans(populationHints);
    if (plans.length <= 0) {
      continue;
    }
    const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
    const siteEntity = (
      scene.staticEntitiesByID &&
      scene.staticEntitiesByID.get(siteID)
    ) || buildSiteEntity(instance);
    if (!siteEntity) {
      continue;
    }
    if (!isSceneSiteMaterialized(scene, siteID)) {
      continue;
    }
    const progressResult = syncEncounterStateProgress(scene, instance, plans, { nowMs });
    encounterCompletions += Math.max(0, toInt(progressResult && progressResult.completedCount, 0));
    armedCount += armDeferredEncounterPlans(instance, populationHints, { nowMs });
    // Proximity-triggered encounters (e.g. "investigate the drone" ambushes) have no player action
    // to hook, so evaluate the player's distance to the target object every tick.
    encountersSpawned += processProximityEncounterTriggers(scene, instance, siteEntity, populationHints, { nowMs });
    // Timer encounters: silent delayed reinforcements (delaySeconds after site load).
    encountersSpawned += processEncounterPlansForTrigger(scene, instance, siteEntity, populationHints, "timer", { nowMs });
    const visibleCountdownDue = hasDueVisibleCountdownTrigger(instance, populationHints, { nowMs });
    const visibleCountdownEncounters = processEncounterPlansForTrigger(
      scene,
      instance,
      siteEntity,
      populationHints,
      "visible_countdown",
      { nowMs },
    );
    encountersSpawned += visibleCountdownEncounters;
    if (visibleCountdownDue) {
      applyTriggeredSiteEffects(
        scene,
        instance,
        siteEntity,
        populationHints,
        "visible_countdown",
        { nowMs },
      );
      for (const plan of resolveEncounterPlans(populationHints)) {
        if (normalizeLowerText(plan && plan.trigger, "") !== "visible_countdown") {
          continue;
        }
        upsertEncounterState(instance.instanceID, plan.key, {
          triggeredEffectsAtMs: nowMs,
        }, { nowMs });
      }
    }
    const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
    syncEncounterStateProgress(scene, latestInstance, plans, { nowMs });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      latestInstance,
      siteEntity,
      populationHints,
      "wave_cleared",
      { nowMs },
    );
    const afterWaveClear = dungeonRuntime.getInstance(instance.instanceID) || latestInstance;
    syncEncounterStateProgress(scene, afterWaveClear, plans, { nowMs });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      afterWaveClear,
      siteEntity,
      populationHints,
      "battleships_destroyed",
      { nowMs },
    );
    const refreshedForRewards = dungeonRuntime.getInstance(instance.instanceID) || afterWaveClear;
    syncEncounterStateProgress(scene, refreshedForRewards, plans, { nowMs });
    rewardContainersSpawned += materializeEncounterRewardContainers(
      scene,
      refreshedForRewards,
      siteEntity,
      template,
      populationHints,
      { nowMs },
    );
    const refreshedForProgression = dungeonRuntime.getInstance(instance.instanceID) || refreshedForRewards;
    const progressionResult = maybeAdvanceEncounterDrivenProgression(
      refreshedForProgression,
      populationHints,
      { nowMs, scene },
    );
    maybeCompleteClearedEncounterSite(
      dungeonRuntime.getInstance(instance.instanceID) || refreshedForRewards,
      populationHints,
      { nowMs, scene },
    );
    syncAgentMissionForCompletedDungeonObjective(
      dungeonRuntime.getInstance(instance.instanceID) || refreshedForProgression,
      { nowMs },
    );
    gatesUnlocked += Math.max(0, toInt(progressionResult && progressionResult.gatesUnlocked, 0));
  }

  return {
    armedCount,
    encountersSpawned,
    encounterCompletions,
    gatesUnlocked,
    rewardContainersSpawned,
  };
}

function encounterStateReferencesEntityID(encounterState, entityID) {
  const numericEntityID = Math.max(0, toInt(entityID, 0));
  if (numericEntityID <= 0) {
    return false;
  }
  return (
    normalizeIDList(encounterState && encounterState.spawnedEntityIDs).includes(numericEntityID) ||
    normalizeIDList(encounterState && encounterState.remainingEntityIDs).includes(numericEntityID)
  );
}

function instanceReferencesEncounterEntityID(instance, entityID) {
  const encounterStatesByKey = normalizeObject(
    instance && instance.spawnState && instance.spawnState.encounterStatesByKey,
  );
  return Object.values(encounterStatesByKey)
    .some((encounterState) => encounterStateReferencesEntityID(encounterState, entityID));
}

function destroyedEntityMatchesObjectiveTarget(instance, destroyedEntity, populationHints) {
  if (!instance || !destroyedEntity) {
    return false;
  }
  if (destroyedEntity.dungeonObjectiveProgressTarget === true) {
    return true;
  }
  const completion = normalizeCompletionHints(populationHints);
  if (normalizeArray(completion && completion.objectiveTargets).length <= 0) {
    return false;
  }
  return completion.objectiveTargets
    .some((target) => entityOrSpawnEntryMatchesObjectiveTarget(destroyedEntity, target));
}

function markDestroyedObjectiveTargets(matchingInstances, destroyedEntity, options = {}) {
  const entityID = Math.max(0, toInt(destroyedEntity && destroyedEntity.itemID, 0));
  if (entityID <= 0 || !destroyedEntity) {
    return 0;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let markedCount = 0;
  for (const instance of normalizeArray(matchingInstances)) {
    if (!instance || isSiteObjectiveExplicitlySatisfied(instance)) {
      continue;
    }
    const template = dungeonAuthority.getTemplateByID(instance.templateID);
    const populationHints = resolvePopulationHints(instance, template);
    if (!destroyedEntityMatchesObjectiveTarget(instance, destroyedEntity, populationHints)) {
      continue;
    }
    dungeonRuntime.markInstanceObjectiveSatisfied(instance.instanceID, {
      nowMs,
      reason: "objective_target_destroyed",
    });
    markedCount += 1;
  }
  return markedCount;
}

function handleEncounterEntityDestroyed(scene, entityOrID, options = {}) {
  const entityID = Math.max(
    0,
    toInt(
      entityOrID && typeof entityOrID === "object"
        ? entityOrID.itemID || entityOrID.entityID
        : entityOrID,
      0,
    ),
  );
  const destroyedEntity = entityOrID && typeof entityOrID === "object"
    ? entityOrID
    : null;
  if (!scene || entityID <= 0) {
    return {
      success: false,
      errorMsg: "ENCOUNTER_ENTITY_NOT_FOUND",
    };
  }

  const systemID = Math.max(0, toInt(scene && scene.systemID, 0));
  if (systemID <= 0) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const matchingInstances = dungeonRuntime.listActiveInstancesBySystem(systemID, {
    full: true,
  })
    .filter((instance) => (
      isManagedMaterializedSiteInstance(instance) &&
      instanceReferencesEncounterEntityID(instance, entityID)
    ));
  if (matchingInstances.length <= 0) {
    return {
      success: true,
      data: {
        entityID,
        matchedInstanceIDs: [],
        progression: {
          armedCount: 0,
          encountersSpawned: 0,
          encounterCompletions: 0,
          gatesUnlocked: 0,
          rewardContainersSpawned: 0,
        },
      },
    };
  }

  for (const instance of matchingInstances) {
    const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
    if (siteID > 0) {
      markSceneSiteMaterialized(scene, siteID, instance.instanceID);
    }
  }

  const objectiveTargetsSatisfied = markDestroyedObjectiveTargets(
    matchingInstances,
    destroyedEntity || { itemID: entityID },
    {
      nowMs: options.nowMs,
    },
  );
  const progression = tickSceneSiteBehaviors(scene, {
    nowMs: options.nowMs,
    session: options.session || null,
  });
  return {
    success: true,
    data: {
      entityID,
      matchedInstanceIDs: matchingInstances.map((instance) => Math.max(0, toInt(instance && instance.instanceID, 0))),
      objectiveTargetsSatisfied,
      progression,
    },
  };
}

function triggerSiteEncounter(scene, instanceOrID, trigger, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_REQUIRED",
    };
  }
  const instance = typeof instanceOrID === "object"
    ? instanceOrID
    : dungeonRuntime.getInstance(Math.max(0, toInt(instanceOrID, 0)));
  if (!instance) {
    return {
      success: false,
      errorMsg: "INSTANCE_NOT_FOUND",
    };
  }
  const template = dungeonAuthority.getTemplateByID(instance.templateID);
  const populationHints = resolvePopulationHints(instance, template);
  const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
  const siteEntity = (
    scene.staticEntitiesByID &&
    scene.staticEntitiesByID.get(siteID)
  ) || buildSiteEntity(instance);
  const triggeredEffects = applyTriggeredSiteEffects(
    scene,
    instance,
    siteEntity,
    populationHints,
    trigger,
    options,
  );
  const encountersSpawned = processEncounterPlansForTrigger(
    scene,
    instance,
    siteEntity,
    populationHints,
    trigger,
    options,
  );
  return {
    success: true,
    data: {
      encountersSpawned,
      removedContainers: Math.max(0, toInt(triggeredEffects && triggeredEffects.removedContainers, 0)),
      triggeredHazards: Math.max(0, toInt(triggeredEffects && triggeredEffects.triggeredHazards, 0)),
    },
  };
}

function materializeSiteContents(scene, instance, siteEntity, template, options = {}) {
  if (!scene || !siteEntity || !instance) {
    return {
      containersSpawned: 0,
      hazardsSpawned: 0,
      environmentPropsSpawned: 0,
      gatesSpawned: 0,
      objectivesSpawned: 0,
      encountersSpawned: 0,
    };
  }
  const materializedSiteID = Math.max(
    0,
    toInt(
      siteEntity && siteEntity.itemID,
      instance && instance.metadata && instance.metadata.siteID,
    ),
  );
  if (materializedSiteID > 0) {
    markSceneSiteMaterialized(scene, materializedSiteID, instance.instanceID);
  }
  let workingInstance = dungeonRuntime.ensureTemplateRuntimeState(
    Math.max(0, toInt(instance && instance.instanceID, 0)),
    {
      nowMs: options.nowMs,
    },
  ) || instance;
  const populationHints = resolvePopulationHints(workingInstance, template);
  const rehydrated = rehydrateMissingEncounterStates(scene, workingInstance, populationHints, {
    nowMs: options.nowMs,
  });
  workingInstance = rehydrated.instance || workingInstance;
  const contentEntities = buildContainerEntities(workingInstance, siteEntity, populationHints);
  const staticBroadcastEntities = [];
  let containersSpawned = 0;
  for (const entity of contentEntities) {
    const created = materializeContainerEntity(
      scene,
      workingInstance,
      siteEntity,
      template,
      populationHints,
      entity,
      {
        nowMs: options.nowMs,
        broadcast: options.broadcast === true,
        excludedSession: options.excludedSession || null,
      },
    );
    if (created) {
      containersSpawned += 1;
    }
  }
  const hazardEntities = buildHazardEntities(workingInstance, siteEntity, populationHints);
  let hazardsSpawned = 0;
  for (const entity of hazardEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      hazardsSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }
  const gateEntities = buildGateEntities(workingInstance, siteEntity, template);
  let gatesSpawned = 0;
  for (const entity of gateEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      gatesSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }
  const environmentEntities = buildEnvironmentEntities(workingInstance, siteEntity, template, populationHints);
  let environmentPropsSpawned = 0;
  for (const entity of environmentEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      environmentPropsSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }
  // Mining missions: spawn the special mineable asteroids and register each one's ore quantity so
  // the existing mining systems can harvest them (Plan C). Best-effort and gated on miningRocks.
  const miningRockEntities = buildMiningRockEntities(workingInstance, siteEntity, populationHints);
  let miningRocksSpawned = 0;
  if (miningRockEntities.length > 0) {
    let miningRuntimeState = null;
    try {
      miningRuntimeState = require(path.join(__dirname, "../mining/miningRuntimeState"));
    } catch (_error) {
      miningRuntimeState = null;
    }
    for (const entity of miningRockEntities) {
      if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
        continue;
      }
      scene.addStaticEntity(entity);
      if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
        miningRocksSpawned += 1;
        staticBroadcastEntities.push(entity);
        if (miningRuntimeState && typeof miningRuntimeState.updateMineableState === "function") {
          try {
            miningRuntimeState.updateMineableState(scene, entity, {
              entityID: entity.itemID,
              visualTypeID: entity.visualTypeID || entity.typeID,
              yieldTypeID: entity.miningYieldTypeID,
              yieldKind: "ore",
              unitVolume: entity.miningUnitVolume,
              originalQuantity: entity.miningOriginalQuantity || entity.miningRemainingQuantity,
              remainingQuantity: entity.miningRemainingQuantity,
              originalRadius: entity.radius,
            });
          } catch (_error) {
            // Mineable registration is best-effort; the rock still renders if it fails.
          }
        }
      }
    }
  }
  const objectiveEntities = buildObjectiveEntities(workingInstance, siteEntity, template, populationHints);
  let objectivesSpawned = 0;
  for (const entity of objectiveEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      objectivesSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }

  broadcastStaticSiteContentBatch(scene, staticBroadcastEntities, options);

  let encountersSpawned = 0;
  armDeferredEncounterPlans(workingInstance, populationHints, {
    nowMs: options.nowMs,
  });
  if (options.spawnEncounters !== false) {
    const onLoadEncountersSpawned = processEncounterPlansForTrigger(
      scene,
      workingInstance,
      siteEntity,
      populationHints,
      "on_load",
      {
        nowMs: options.nowMs,
        session: options.session || null,
      },
    );
    encountersSpawned += onLoadEncountersSpawned;
    if (onLoadEncountersSpawned <= 0) {
    const refreshedInstance =
      dungeonRuntime.getInstance(Math.max(0, toInt(workingInstance && workingInstance.instanceID, 0))) ||
      workingInstance;
    syncEncounterStateProgress(scene, refreshedInstance, resolveEncounterPlans(populationHints), {
      nowMs: options.nowMs,
    });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      refreshedInstance,
      siteEntity,
      populationHints,
      "wave_cleared",
      {
        nowMs: options.nowMs,
        session: options.session || null,
      },
    );
    const afterWaveClear =
      dungeonRuntime.getInstance(Math.max(0, toInt(workingInstance && workingInstance.instanceID, 0))) ||
      refreshedInstance;
    syncEncounterStateProgress(scene, afterWaveClear, resolveEncounterPlans(populationHints), {
      nowMs: options.nowMs,
    });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      afterWaveClear,
      siteEntity,
      populationHints,
      "battleships_destroyed",
      {
        nowMs: options.nowMs,
        session: options.session || null,
      },
    );
    }
  }

  return {
    containersSpawned,
    hazardsSpawned,
    environmentPropsSpawned,
    miningRocksSpawned,
    gatesSpawned,
    objectivesSpawned,
    encountersSpawned,
  };
}

function ensureSiteContentsMaterialized(scene, instanceOrSite, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const instance = resolveManagedUniverseSiteInstance(scene, instanceOrSite, options);
  if (!instance) {
    return {
      success: false,
      errorMsg: "INSTANCE_NOT_FOUND",
    };
  }

  const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
  if (siteID <= 0) {
    return {
      success: false,
      errorMsg: "SITE_NOT_FOUND",
    };
  }

  let siteEntity = (
    scene.staticEntitiesByID &&
    scene.staticEntitiesByID.get(siteID)
  ) || null;
  if (!siteEntity) {
    upsertSceneEntity(scene, instance, {
      broadcast: options.broadcast === true,
      excludedSession: options.excludedSession || null,
      nowMs: options.nowMs,
    });
    siteEntity = (
      scene.staticEntitiesByID &&
      scene.staticEntitiesByID.get(siteID)
    ) || buildSiteEntity(instance);
  }
  if (!siteEntity) {
    return {
      success: false,
      errorMsg: "SITE_ENTITY_NOT_FOUND",
    };
  }

  const alreadyMaterialized = isSceneSiteMaterialized(scene, siteID);

  const template = dungeonAuthority.getTemplateByID(instance.templateID);
  const contentSummary = materializeSiteContents(scene, instance, siteEntity, template, {
    spawnEncounters: options.spawnEncounters !== false,
    nowMs: options.nowMs,
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
    session: options.session || null,
  });
  markSceneSiteMaterialized(scene, siteID, instance.instanceID);
  if (options.session && options.markCurrentDungeonRoom !== false) {
    dungeonTrackingRuntime.enterDungeonRoomForSession(scene, options.session, instance, "room:entry", {
      nowMs: options.nowMs,
      roomPosition: siteEntity.position,
      siteID,
    });
  }
  if (options.session) {
    forceResyncSiteStaticContentForSession(scene, options.session, instance, {
      nowMs: options.nowMs,
      stampOverride: options.stampOverride,
    });
  }
  // Diagnostic: how many mining-rock entities are actually present in the scene for this instance (vs only
  // spawned-this-call, which is 0 once cached), and the nearest rock's distance from the site beacon - so a
  // warp can tell whether the asteroid exists at all vs. a render/distance problem.
  const instanceIDForCount = Math.max(0, toInt(instance.instanceID, 0));
  let miningRockEntityCount = 0;
  let firstRockDistanceMeters = null;
  if (scene.staticEntitiesByID instanceof Map) {
    for (const entity of scene.staticEntitiesByID.values()) {
      if (
        entity &&
        entity.dungeonMaterializedMiningRock === true &&
        Math.max(0, toInt(entity.dungeonSiteInstanceID, 0)) === instanceIDForCount
      ) {
        miningRockEntityCount += 1;
        if (firstRockDistanceMeters === null && entity.position && siteEntity.position) {
          const dx = toFiniteNumber(entity.position.x, 0) - toFiniteNumber(siteEntity.position.x, 0);
          const dy = toFiniteNumber(entity.position.y, 0) - toFiniteNumber(siteEntity.position.y, 0);
          const dz = toFiniteNumber(entity.position.z, 0) - toFiniteNumber(siteEntity.position.z, 0);
          firstRockDistanceMeters = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
      }
    }
  }
  return {
    success: true,
    data: {
      instanceID: instanceIDForCount,
      siteID,
      alreadyMaterialized,
      contentSummary,
      miningRockEntityCount,
      firstRockDistanceMeters,
    },
  };
}

function upsertSceneEntity(scene, instance, options = {}) {
  const entity = buildSiteEntity(instance);
  if (!scene || !entity) {
    return false;
  }
  const existing = scene.staticEntitiesByID && scene.staticEntitiesByID.get(Number(entity.itemID));
  if (!existing) {
    if (!scene.addStaticEntity(entity)) {
      return false;
    }
    if (options.broadcast === true) {
      scene.broadcastAddBalls([entity], options.excludedSession || null);
    }
    return true;
  }

  const nextSignature = buildStableUniverseSiteEntitySignature(entity);
  const previousSignature = buildStableUniverseSiteEntitySignature(existing);
  if (previousSignature === nextSignature) {
    return false;
  }

  scene.removeStaticEntity(entity.itemID, {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
    nowMs: options.nowMs,
  });
  if (!scene.addStaticEntity(entity)) {
    return false;
  }
  if (options.broadcast === true) {
    scene.broadcastAddBalls([entity], options.excludedSession || null);
  }
  return true;
}

function removeSceneEntity(scene, siteID, options = {}) {
  if (!scene) {
    return false;
  }
  const removeResult = scene.removeStaticEntity(siteID, {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
    nowMs: options.nowMs,
  });
  return Boolean(removeResult && removeResult.success === true);
}

function removeSceneSiteContent(scene, siteID, options = {}) {
  if (!scene) {
    return 0;
  }
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0) {
    return 0;
  }
  const contentEntities = listMaterializedUniverseSiteContentEntities(scene, {
    siteID: numericSiteID,
  });
  let removedCount = 0;
  for (const entity of contentEntities) {
    const removeResult = destroyMaterializedContentEntity(scene, entity, {
      broadcast: options.broadcast === true,
      excludedSession: options.excludedSession || null,
      nowMs: options.nowMs,
    });
    if (removeResult && removeResult.success === true) {
      removedCount += 1;
    }
  }
  unmarkSceneSiteMaterialized(scene, numericSiteID);
  return removedCount;
}

function notifyTrackerDelta(systemID, siteKind, options = {}) {
  const scanMgrService = getScanMgrService();
  if (siteKind === "anomaly") {
    scanMgrService.notifyAnomalyDeltaForSystem(systemID, options);
    return;
  }
  scanMgrService.notifySignatureDeltaForSystem(systemID, options);
}

function handleRuntimeChange(change) {
  const previous = change && change.before ? change.before : null;
  const next = change && change.after ? change.after : null;
  const runtime = getSpaceRuntime();
  const previousSystemID = Math.max(0, toInt(change && change.previousSolarSystemID, 0));
  const nextSystemID = Math.max(0, toInt(change && change.solarSystemID, 0));

  const previousWasVisible = isActiveManagedMaterializedSiteInstance(previous);
  const nextIsVisible = isActiveManagedMaterializedSiteInstance(next);

  if (
    previousSystemID > 0 &&
    previousWasVisible &&
    (!nextIsVisible || nextSystemID !== previousSystemID)
  ) {
    const previousScene = runtime.scenes.get(previousSystemID) || null;
    if (previousScene) {
      const previousSiteID = Math.max(0, toInt(previous && previous.metadata && previous.metadata.siteID, 0));
      removeSceneSiteContent(
        previousScene,
        previousSiteID,
        {
          broadcast: true,
        },
      );
      const removed = isManagedUniverseSiteInstance(previous)
        ? removeSceneEntity(
            previousScene,
            previousSiteID,
            {
              broadcast: true,
            },
          )
        : true;
      if ((removed || previousSiteID > 0) && isManagedUniverseSiteInstance(previous)) {
        notifyTrackerDelta(previousSystemID, normalizeLowerText(previous && previous.siteKind, "signature"), {
          scene: previousScene,
          refresh: false,
        });
      }
    }
  }

  if (nextSystemID > 0 && nextIsVisible) {
    const nextScene = runtime.scenes.get(nextSystemID) || null;
    if (nextScene) {
      const nextSiteID = Math.max(0, toInt(next && next.metadata && next.metadata.siteID, 0));
      const changed = upsertSceneEntity(nextScene, next, {
        broadcast: true,
      });
      if (changed && isSceneSiteMaterialized(nextScene, nextSiteID)) {
        removeSceneSiteContent(nextScene, nextSiteID, {
          broadcast: true,
        });
      }
      if (changed && isManagedUniverseSiteInstance(next)) {
        notifyTrackerDelta(nextSystemID, normalizeLowerText(next && next.siteKind, "signature"), {
          scene: nextScene,
          refresh: false,
        });
      }
    }
  }
}

function startRuntimeSync() {
  if (runtimeSyncStarted) {
    return true;
  }
  registeredListener = handleRuntimeChange;
  dungeonRuntime.registerInstanceChangeListener(registeredListener);
  if (!siteBehaviorTicker) {
    siteBehaviorTicker = setInterval(() => {
      const runtime = getSpaceRuntime();
      for (const scene of runtime && runtime.scenes instanceof Map ? runtime.scenes.values() : []) {
        if (ensureSceneMaterializedSiteSet(scene).size <= 0) {
          continue;
        }
        tickSceneSiteBehaviors(scene, {
          nowMs: Date.now(),
        });
      }
    }, SITE_CONTENT_BEHAVIOR_TICK_INTERVAL_MS);
    if (typeof siteBehaviorTicker.unref === "function") {
      siteBehaviorTicker.unref();
    }
  }
  runtimeSyncStarted = true;
  return true;
}

function stopRuntimeSync() {
  if (!runtimeSyncStarted || !registeredListener) {
    return false;
  }
  dungeonRuntime.unregisterInstanceChangeListener(registeredListener);
  if (siteBehaviorTicker) {
    clearInterval(siteBehaviorTicker);
    siteBehaviorTicker = null;
  }
  runtimeSyncStarted = false;
  registeredListener = null;
  return true;
}

function handleSceneCreated(scene, options = {}) {
  if (!scene || (scene._universeDungeonSitesInitialized === true && options.force !== true)) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  scene._universeDungeonSitesInitialized = true;
  const spawned = [];
  const contentSummary = {
    containersSpawned: 0,
    hazardsSpawned: 0,
    environmentPropsSpawned: 0,
    gatesSpawned: 0,
    objectivesSpawned: 0,
    encountersSpawned: 0,
  };
  const instances = dungeonRuntime.listActiveInstancesBySystem(toInt(scene && scene.systemID, 0), {
    full: true,
  })
    .filter((instance) => isManagedMaterializedSiteInstance(instance));
  for (const instance of instances) {
    const entity = buildSiteEntity(instance);
    if (!entity) {
      continue;
    }
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  return {
    success: true,
    data: {
      spawned,
      contentSummary,
    },
  };
}

class DungeonUniverseSiteService extends BaseService {
  constructor() {
    super("dungeonUniverseSite");
  }
}

DungeonUniverseSiteService.buildSiteEntity = buildSiteEntity;
DungeonUniverseSiteService.ensureSiteContentsMaterialized = ensureSiteContentsMaterialized;
DungeonUniverseSiteService.handleSceneCreated = handleSceneCreated;
DungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities =
  listMaterializedUniverseSiteContentEntities;
DungeonUniverseSiteService.listMaterializedUniverseSiteEntities = listMaterializedUniverseSiteEntities;
DungeonUniverseSiteService.destroyMaterializedContentEntity =
  destroyMaterializedContentEntity;
DungeonUniverseSiteService.maybeCompleteMaterializedDataRelicSite =
  maybeCompleteMaterializedDataRelicSite;
DungeonUniverseSiteService.maybeCompleteMaterializedDataRelicSiteForContainerID =
  maybeCompleteMaterializedDataRelicSiteForContainerID;
DungeonUniverseSiteService.startRuntimeSync = startRuntimeSync;
DungeonUniverseSiteService.stopRuntimeSync = stopRuntimeSync;
DungeonUniverseSiteService.tickSceneSiteBehaviors = tickSceneSiteBehaviors;
DungeonUniverseSiteService.triggerSiteEncounter = triggerSiteEncounter;
DungeonUniverseSiteService.handleEncounterEntityDestroyed = handleEncounterEntityDestroyed;
DungeonUniverseSiteService._testing = {
  applyTriggeredSiteEffects,
  buildGateEntities,
  buildEnvironmentEntities,
  buildContainerEntities,
  buildMiningRockEntities,
  destroyMaterializedContentEntity,
  buildHazardEntities,
  buildObjectiveEntities,
  ensureSiteContentsMaterialized,
  forceResyncSiteStaticContentForSession,
  tickSceneSiteBehaviors,
  triggerSiteEncounter,
  handleEncounterEntityDestroyed,
  handleRuntimeChange,
  isManagedUniverseSiteInstance,
  isSceneSiteMaterialized,
  materializeSiteContents,
  resolveManagedUniverseSiteInstance,
  resolveEncounterPlans,
  resolveSpawnIdentityProfileQuery,
  normalizeMissionSpawnQuery,
  resolveLocalizedTemplateName,
  resolveFallbackStrengthAttribute,
  resolvePopulationHints,
  buildStableUniverseSiteEntitySignature,
  maybeCompleteMaterializedDataRelicSite,
  maybeCompleteMaterializedDataRelicSiteForContainerID,
  maybeCompleteClearedEncounterSite,
};

module.exports = DungeonUniverseSiteService;
