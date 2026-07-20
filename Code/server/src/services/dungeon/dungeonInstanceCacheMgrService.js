const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const targetIdRuntime = require(path.join(
  __dirname,
  "../exploration/signatures/targetIdRuntime",
));
const wormholeRuntimeState = require(path.join(
  __dirname,
  "../exploration/wormholes/wormholeRuntimeState",
));
const iceSystemAuthority = require(path.join(
  __dirname,
  "../mining/iceSystemAuthority",
));
const {
  buildDict,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const ARCHETYPES = Object.freeze({
  combatSites: 24,
  oreAnomaly: 27,
  iceBelt: 28,
  invasionSites: 65,
  homefrontSites: 70,
});

const ARCHETYPE_SETS = Object.freeze({
  combatAnomalies: new Set([ARCHETYPES.combatSites]),
  oreAnomalies: new Set([ARCHETYPES.oreAnomaly]),
  iceBelts: new Set([ARCHETYPES.iceBelt]),
  factionWarfare: new Set([33, 34, 35, 36, 68]),
  factionWarfareBattlefields: new Set([68]),
  homefrontOperations: new Set([ARCHETYPES.homefrontSites]),
  pirateInsurgencies: new Set([72, 73, 74, 75, 76, 77, 78, 79]),
  pirateInsurgencyIceHeists: new Set([74]),
  triglavianSites: new Set([ARCHETYPES.invasionSites]),
});

const BUILD_3396210_BULWARK_MINING_DUNGEON_IDS = Object.freeze(new Set([
  // Cradle of War Bulwark mining anomalies from the matching build-3396210
  // SDE dungeons.jsonl. dungeonAuthority does not currently contain these
  // newer reserve templates, so runtime data may surface them before authority
  // regeneration is fixed.
  14036, // Imperial Raspite Reserve
  14039, // State Polycrase Reserve
  14040, // Federal Moissanite Reserve
  14041, // Republic Kangite Reserve
  14245, // Small Imperial Raspite Reserve
  14246, // Small State Polycrase Reserve
  14247, // Small Federal Moissanite Reserve
  14249, // Small Republic Kangite Reserve
]));

const ACTIVE_STATES = Object.freeze(["seeded", "active", "paused"]);

let cachedBuckets = null;
let cachedEntryDicts = null;
let cachedCountDicts = null;
let cacheListenerRegistered = false;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function invalidateCache() {
  cachedBuckets = null;
  cachedEntryDicts = null;
  cachedCountDicts = null;
}

function normalizeLifecycleState(value) {
  return normalizeText(value, "").toLowerCase();
}

function positionsEqual(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    Number(left.x) === Number(right.x) &&
    Number(left.y) === Number(right.y) &&
    Number(left.z) === Number(right.z)
  );
}

function isSummaryEligible(summary, expectedSiteKind = "anomaly") {
  if (!summary || typeof summary !== "object") {
    return false;
  }
  if (normalizeText(summary.instanceScope, "shared").toLowerCase() !== "shared") {
    return false;
  }
  const siteKind = normalizeText(summary.siteKind, "").toLowerCase();
  const requiredSiteKind = normalizeText(expectedSiteKind, "").toLowerCase();
  if (requiredSiteKind && siteKind !== requiredSiteKind) {
    return false;
  }
  return ACTIVE_STATES.includes(normalizeLifecycleState(summary.lifecycleState));
}

function isCacheSummaryEligible(summary) {
  return isSummaryEligible(summary, "anomaly") || isSummaryEligible(summary, "signature");
}

function doesSummaryTopologyChangeMatter(beforeSummary, afterSummary) {
  const beforeEligible = isCacheSummaryEligible(beforeSummary);
  const afterEligible = isCacheSummaryEligible(afterSummary);
  if (beforeEligible !== afterEligible) {
    return true;
  }
  if (!beforeEligible && !afterEligible) {
    return false;
  }
  return (
    toInt(beforeSummary && beforeSummary.solarSystemID, 0) !==
      toInt(afterSummary && afterSummary.solarSystemID, 0) ||
    normalizeText(beforeSummary && beforeSummary.siteKind, "").toLowerCase() !==
      normalizeText(afterSummary && afterSummary.siteKind, "").toLowerCase() ||
    toInt(beforeSummary && beforeSummary.archetypeID, 0) !==
      toInt(afterSummary && afterSummary.archetypeID, 0) ||
    toInt(beforeSummary && beforeSummary.sourceDungeonID, 0) !==
      toInt(afterSummary && afterSummary.sourceDungeonID, 0) ||
    toInt(beforeSummary && beforeSummary.factionID, 0) !==
      toInt(afterSummary && afterSummary.factionID, 0) ||
    toInt(beforeSummary && beforeSummary.difficulty, 0) !==
      toInt(afterSummary && afterSummary.difficulty, 0) ||
    toInt(beforeSummary && beforeSummary.entryObjectTypeID, 0) !==
      toInt(afterSummary && afterSummary.entryObjectTypeID, 0) ||
    toInt(beforeSummary && beforeSummary.dungeonNameID, 0) !==
      toInt(afterSummary && afterSummary.dungeonNameID, 0) ||
    getSummaryMetadataSiteID(beforeSummary) !== getSummaryMetadataSiteID(afterSummary) ||
    !positionsEqual(beforeSummary && beforeSummary.position, afterSummary && afterSummary.position)
  );
}

function ensureCacheListener() {
  if (cacheListenerRegistered) {
    return;
  }
  if (typeof dungeonRuntime.registerInstanceChangeListener === "function") {
    dungeonRuntime.registerInstanceChangeListener((change) => {
      const changeType = normalizeText(change && change.changeType, "").toLowerCase();
      if (changeType === "created" || changeType === "removed") {
        if (
          isCacheSummaryEligible(change && change.before) ||
          isCacheSummaryEligible(change && change.after)
        ) {
          invalidateCache();
        }
        return;
      }
      if (doesSummaryTopologyChangeMatter(change && change.before, change && change.after)) {
        invalidateCache();
      }
    });
  }
  cacheListenerRegistered = true;
}

function listActiveSharedInstanceSummaries(siteKind = "anomaly") {
  const summariesByID = new Map();
  for (const lifecycleState of ACTIVE_STATES) {
    const summaries = dungeonRuntime.listInstancesByLifecycle(lifecycleState) || [];
    for (const summary of summaries) {
      const instanceID = Math.max(0, toInt(summary && summary.instanceID, 0));
      if (instanceID <= 0 || summariesByID.has(instanceID)) {
        continue;
      }
      if (normalizeText(summary && summary.instanceScope, "shared").toLowerCase() !== "shared") {
        continue;
      }
      if (normalizeText(summary && summary.siteKind, "").toLowerCase() !== siteKind) {
        continue;
      }
      summariesByID.set(instanceID, summary);
    }
  }
  return [...summariesByID.values()];
}

function incrementSystemCount(countsBySystem, solarSystemID, incrementBy = 1) {
  const normalizedSystemID = Math.max(0, toInt(solarSystemID, 0));
  if (normalizedSystemID <= 0) {
    return;
  }
  countsBySystem.set(
    normalizedSystemID,
    Math.max(0, toInt(countsBySystem.get(normalizedSystemID), 0)) +
      Math.max(0, toInt(incrementBy, 0)),
  );
}

function buildCountDictFromMap(countsBySystem) {
  return buildDict(
    [...countsBySystem.entries()]
      .filter(([, count]) => Math.max(0, toInt(count, 0)) > 0)
      .sort((left, right) => left[0] - right[0])
      .map(([solarSystemID, count]) => [solarSystemID, Math.max(0, toInt(count, 0))]),
  );
}

function normalizeVisibilityState(value, discovered = false) {
  const normalized = normalizeText(value, "").toLowerCase();
  if (
    normalized === "visible" ||
    normalized === "hidden" ||
    normalized === "invisible"
  ) {
    return normalized;
  }
  return discovered === true ? "visible" : "hidden";
}

function isVisibleActiveWormholeEndpoint(pair, endpoint, nowMs) {
  if (!pair || !endpoint) {
    return false;
  }
  if (normalizeText(pair.state, "").toLowerCase() !== "active") {
    return false;
  }
  const expiresAtMs = Math.max(0, toInt(pair.expiresAtMs, 0));
  if (expiresAtMs > 0 && expiresAtMs < nowMs) {
    return false;
  }
  if (Math.max(0, toInt(endpoint.endpointID, 0)) <= 0) {
    return false;
  }
  if (Math.max(0, toInt(endpoint.systemID, 0)) <= 0) {
    return false;
  }
  return normalizeVisibilityState(endpoint.visibilityState, endpoint.discovered === true) === "visible";
}

function addVisibleWormholeSignatureCounts(countsBySystem, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const snapshot = wormholeRuntimeState.getStateSnapshot();
  for (const pair of Object.values(snapshot.pairsByID || {})) {
    for (const endpoint of [pair && pair.source, pair && pair.destination]) {
      if (isVisibleActiveWormholeEndpoint(pair, endpoint, nowMs)) {
        incrementSystemCount(countsBySystem, endpoint.systemID);
      }
    }
  }
}

function buildSignatureCountDict(options = {}) {
  ensureCacheListener();
  const countsBySystem = new Map();
  for (const summary of listActiveSharedInstanceSummaries("signature")) {
    incrementSystemCount(countsBySystem, summary && summary.solarSystemID);
  }
  addVisibleWormholeSignatureCounts(countsBySystem, options);
  return buildCountDictFromMap(countsBySystem);
}

function isBulwarkMiningSummary(summary) {
  if (!isSummaryEligible(summary, "anomaly")) {
    return false;
  }
  if (
    BUILD_3396210_BULWARK_MINING_DUNGEON_IDS.has(
      Math.max(0, toInt(summary && summary.sourceDungeonID, 0)),
    )
  ) {
    return true;
  }
  const metadata = summary && summary.metadata && typeof summary.metadata === "object"
    ? summary.metadata
    : {};
  const runtimeFlags = summary && summary.runtimeFlags && typeof summary.runtimeFlags === "object"
    ? summary.runtimeFlags
    : {};
  if (metadata.bulwarkMiningSite === true || runtimeFlags.bulwarkMiningSite === true) {
    return true;
  }
  const family = normalizeText(summary && summary.siteFamily, "").toLowerCase();
  const origin = normalizeText(summary && summary.siteOrigin, "").toLowerCase();
  return (
    (family.includes("bulwark") && family.includes("mining")) ||
    (origin.includes("bulwark") && origin.includes("mining"))
  );
}

function buildBulwarkMiningSiteCountDict() {
  ensureCacheListener();
  const countsBySystem = new Map();
  for (const summary of listActiveSharedInstanceSummaries("anomaly")) {
    if (isBulwarkMiningSummary(summary)) {
      incrementSystemCount(countsBySystem, summary && summary.solarSystemID);
    }
  }
  return buildCountDictFromMap(countsBySystem);
}

function getSummaryMetadataSiteID(summary) {
  const metadata = normalizeObject(summary && summary.metadata);
  return Math.max(
    0,
    toInt(
      metadata.siteID,
      toInt(metadata.anchorItemID, 0),
    ),
  );
}

function isGeneratedIceSummary(summary) {
  const siteFamily = normalizeText(summary && summary.siteFamily, "").toLowerCase();
  const siteOrigin = normalizeText(summary && summary.siteOrigin, "").toLowerCase();
  const metadata = normalizeObject(summary && summary.metadata);
  const runtimeFlags = normalizeObject(summary && summary.runtimeFlags);
  const providerID = normalizeText(metadata.providerID, "").toLowerCase();
  return (
    siteFamily === "ice" &&
    (
      siteOrigin === "generatedmining" ||
      providerID === "generatedmining" ||
      runtimeFlags.generatedMining === true
    )
  );
}

function isAuthorityBackedIceBeltSummary(summary, hydrated) {
  if (!summary || !hydrated) {
    return false;
  }
  const authorityRow = iceSystemAuthority.getIceSystemAuthorityRow(hydrated.solarSystemID);
  if (!authorityRow) {
    return false;
  }
  const expectedSourceDungeonID = Math.max(0, toInt(authorityRow.sourceDungeonID, 0));
  if (expectedSourceDungeonID <= 0) {
    return false;
  }
  return expectedSourceDungeonID === Math.max(0, toInt(hydrated.dungeonID, 0));
}

function buildPositionPayload(position) {
  if (!position || typeof position !== "object") {
    return null;
  }
  return buildList([
    Number(position.x) || 0,
    Number(position.y) || 0,
    Number(position.z) || 0,
  ]);
}

function hydrateSummary(summary) {
  const template = dungeonAuthority.getTemplateByID(
    normalizeText(summary && summary.templateID, ""),
  );
  const position =
    summary && summary.position && typeof summary.position === "object"
      ? {
          x: Number(summary.position.x) || 0,
          y: Number(summary.position.y) || 0,
          z: Number(summary.position.z) || 0,
        }
      : null;
  const generatedIce = isGeneratedIceSummary(summary);
  const instanceID = Math.max(0, toInt(summary && summary.instanceID, 0));
  const solarSystemID = Math.max(0, toInt(summary && summary.solarSystemID, 0));
  const siteID = generatedIce
    ? getSummaryMetadataSiteID(summary) || instanceID
    : instanceID;
  const targetID =
    generatedIce && siteID > 0 && solarSystemID > 0
      ? targetIdRuntime.encodeTargetID("mining-anomaly", solarSystemID, siteID)
      : null;
  return {
    instanceID,
    siteID,
    targetID,
    solarSystemID,
    dungeonID:
      Math.max(0, toInt(summary && summary.sourceDungeonID, 0)) ||
      Math.max(0, toInt(template && template.sourceDungeonID, 0)),
    archetypeID:
      Math.max(0, toInt(summary && summary.archetypeID, 0)) ||
      Math.max(0, toInt(template && template.archetypeID, 0)),
    factionID:
      Math.max(0, toInt(summary && summary.factionID, 0)) ||
      Math.max(0, toInt(template && template.factionID, 0)) ||
      null,
    difficulty:
      Math.max(0, toInt(summary && summary.difficulty, 0)) ||
      Math.max(0, toInt(template && template.difficulty, 0)) ||
      1,
    entryObjectTypeID:
      Math.max(0, toInt(summary && summary.entryObjectTypeID, 0)) ||
      Math.max(0, toInt(template && template.entryObjectTypeID, 0)) ||
      null,
    dungeonNameID:
      Math.max(0, toInt(summary && summary.dungeonNameID, 0)) ||
      Math.max(0, toInt(template && template.dungeonNameID, 0)) ||
      null,
    position,
    positionPayload: position ? buildPositionPayload(position) : null,
  };
}

function buildDungeonEntry(record) {
  const entries = [
    ["dungeonID", record.dungeonID],
    ["instanceID", record.instanceID],
    ["siteID", record.siteID || record.instanceID],
    ["archetypeID", record.archetypeID || null],
    ["factionID", record.factionID || null],
    ["difficulty", record.difficulty || 1],
    ["entryObjectTypeID", record.entryObjectTypeID || null],
    ["dungeonNameID", record.dungeonNameID || null],
  ];
  if (record.positionPayload) {
    entries.push(["position", record.positionPayload]);
  }
  return buildKeyVal(entries);
}

function buildDungeonEntryWithTarget(record) {
  const entries = [
    ["dungeonID", record.dungeonID],
    ["instanceID", record.instanceID],
    ["siteID", record.siteID || record.instanceID],
    ["archetypeID", record.archetypeID || null],
    ["factionID", record.factionID || null],
    ["difficulty", record.difficulty || 1],
    ["entryObjectTypeID", record.entryObjectTypeID || null],
    ["dungeonNameID", record.dungeonNameID || null],
  ];
  if (record.targetID) {
    entries.push(["targetID", record.targetID]);
  }
  if (record.positionPayload) {
    entries.push(["position", record.positionPayload]);
  }
  return buildKeyVal(entries);
}

function buildGroupedBuckets() {
  const groupedEntries = new Map(
    Object.keys(ARCHETYPE_SETS).map((key) => [key, new Map()]),
  );
  const groupedCounts = new Map(
    Object.keys(ARCHETYPE_SETS).map((key) => [key, new Map()]),
  );

  for (const summary of listActiveSharedInstanceSummaries()) {
    const hydrated = hydrateSummary(summary);
    if (hydrated.instanceID <= 0 || hydrated.solarSystemID <= 0 || hydrated.dungeonID <= 0) {
      continue;
    }

    for (const [bucketKey, archetypeSet] of Object.entries(ARCHETYPE_SETS)) {
      if (!archetypeSet.has(hydrated.archetypeID)) {
        continue;
      }
      if (bucketKey === "iceBelts" && !isAuthorityBackedIceBeltSummary(summary, hydrated)) {
        continue;
      }
      const entriesBySystem = groupedEntries.get(bucketKey);
      const countsBySystem = groupedCounts.get(bucketKey);
      if (!entriesBySystem.has(hydrated.solarSystemID)) {
        entriesBySystem.set(hydrated.solarSystemID, []);
      }
      entriesBySystem.get(hydrated.solarSystemID).push(hydrated);
      countsBySystem.set(
        hydrated.solarSystemID,
        (countsBySystem.get(hydrated.solarSystemID) || 0) + 1,
      );
    }
  }

  for (const entriesBySystem of groupedEntries.values()) {
    for (const records of entriesBySystem.values()) {
      records.sort((left, right) => (
        left.instanceID - right.instanceID ||
        left.dungeonID - right.dungeonID
      ));
    }
  }

  return {
    entries: groupedEntries,
    counts: groupedCounts,
  };
}

function getBuckets() {
  ensureCacheListener();
  if (!cachedBuckets) {
    cachedBuckets = buildGroupedBuckets();
  }
  return cachedBuckets;
}

function buildGroupedEntryDict(bucketKey) {
  ensureCacheListener();
  if (!cachedEntryDicts) {
    cachedEntryDicts = new Map();
  }
  if (cachedEntryDicts.has(bucketKey)) {
    return cachedEntryDicts.get(bucketKey);
  }
  const buckets = getBuckets().entries.get(bucketKey) || new Map();
  const dict = buildDict(
    [...buckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([solarSystemID, records]) => [
        solarSystemID,
        buildList(records.map((record) => buildDungeonEntry(record))),
      ]),
  );
  cachedEntryDicts.set(bucketKey, dict);
  return dict;
}

function buildGroupedEntryDictWithTarget(bucketKey) {
  ensureCacheListener();
  if (!cachedEntryDicts) {
    cachedEntryDicts = new Map();
  }
  const cacheKey = `${bucketKey}:target`;
  if (cachedEntryDicts.has(cacheKey)) {
    return cachedEntryDicts.get(cacheKey);
  }
  const buckets = getBuckets().entries.get(bucketKey) || new Map();
  const dict = buildDict(
    [...buckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([solarSystemID, records]) => [
        solarSystemID,
        buildList(records.map((record) => buildDungeonEntryWithTarget(record))),
      ]),
  );
  cachedEntryDicts.set(cacheKey, dict);
  return dict;
}

function buildGroupedCountDict(bucketKey) {
  ensureCacheListener();
  if (!cachedCountDicts) {
    cachedCountDicts = new Map();
  }
  if (cachedCountDicts.has(bucketKey)) {
    return cachedCountDicts.get(bucketKey);
  }
  const counts = getBuckets().counts.get(bucketKey) || new Map();
  const dict = buildDict(
    [...counts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([solarSystemID, count]) => [solarSystemID, Math.max(0, toInt(count, 0))]),
  );
  cachedCountDicts.set(bucketKey, dict);
  return dict;
}

class DungeonInstanceCacheMgrService extends BaseService {
  constructor() {
    super("dungeonInstanceCacheMgr");
  }

  Handle_GetCombatAnomalyInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetCombatAnomalyInstances");
    return buildGroupedEntryDict("combatAnomalies");
  }

  Handle_GetCombatAnomaliesCount() {
    log.debug("[DungeonInstanceCacheMgr] GetCombatAnomaliesCount");
    return buildGroupedCountDict("combatAnomalies");
  }

  Handle_GetSignatureInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetSignatureInstances");
    return buildSignatureCountDict();
  }

  Handle_GetIceBeltInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetIceBeltInstances");
    return buildGroupedEntryDictWithTarget("iceBelts");
  }

  Handle_GetIceBeltsCount() {
    log.debug("[DungeonInstanceCacheMgr] GetIceBeltsCount");
    return buildGroupedCountDict("iceBelts");
  }

  Handle_GetOreAnomalyInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetOreAnomalyInstances");
    return buildGroupedEntryDict("oreAnomalies");
  }

  Handle_GetOreAnomaliesCount() {
    log.debug("[DungeonInstanceCacheMgr] GetOreAnomaliesCount");
    return buildGroupedCountDict("oreAnomalies");
  }

  Handle_GetOreAnomaliesCountInRange() {
    log.debug("[DungeonInstanceCacheMgr] GetOreAnomaliesCountInRange");
    return buildGroupedCountDict("oreAnomalies");
  }

  Handle_GetBulwarkMiningSiteCounts() {
    log.debug("[DungeonInstanceCacheMgr] GetBulwarkMiningSiteCounts");
    return buildBulwarkMiningSiteCountDict();
  }

  Handle_GetFactionWarfareInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetFactionWarfareInstances");
    return buildGroupedEntryDict("factionWarfare");
  }

  Handle_GetFactionWarfareBattlefieldInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetFactionWarfareBattlefieldInstances");
    return buildGroupedEntryDict("factionWarfareBattlefields");
  }

  Handle_GetHomefrontSiteInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetHomefrontSiteInstances");
    return buildGroupedEntryDict("homefrontOperations");
  }

  Handle_GetPirateInsurgencyInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetPirateInsurgencyInstances");
    return buildGroupedEntryDict("pirateInsurgencies");
  }

  Handle_GetPirateInsurgencyIceHeistInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetPirateInsurgencyIceHeistInstances");
    return buildGroupedEntryDict("pirateInsurgencyIceHeists");
  }

  Handle_GetTriglavianSiteInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetTriglavianSiteInstances");
    return buildGroupedEntryDict("triglavianSites");
  }
}

DungeonInstanceCacheMgrService._testing = {
  ARCHETYPE_SETS,
  BUILD_3396210_BULWARK_MINING_DUNGEON_IDS,
  buildGroupedBuckets,
  buildSignatureCountDict,
  buildBulwarkMiningSiteCountDict,
  hydrateSummary,
  invalidateCache,
  isAuthorityBackedIceBeltSummary,
  isGeneratedIceSummary,
  isBulwarkMiningSummary,
};

module.exports = DungeonInstanceCacheMgrService;
