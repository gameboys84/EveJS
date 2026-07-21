"use strict";

const path = require("path");
const {
  isDisabledMissionIdentifier,
  isDisabledMissionSourceURL,
  isDisabledMissionTemplateIdentifier,
  isGeneratedMissionIdentifier,
  isRetiredMissionTemplateIdentifier,
  productionMissionPolicy,
} = require(path.join(
  __dirname,
  "..",
  "..",
  "server",
  "src",
  "config",
  "productionMissionPolicy",
));

const cleaningOverride = process.env.EVEJS_ENABLE_COMMUNITY_CONTENT_CLEANING;
const isCommunityContentCleaningEnabled = cleaningOverride === undefined
  || cleaningOverride === ""
  || cleaningOverride === "1"
  || cleaningOverride.toLowerCase() === "true";

const GENERATED_EVE_SURVIVAL_SOURCE = "eve-survival-generated";
const EVE_SURVIVAL_SOURCE_KEYS = new Set([
  "eve-survival",
  GENERATED_EVE_SURVIVAL_SOURCE,
]);
const GENERATED_MISSION_ID_MIN = productionMissionPolicy
  .generatedMissionIDRange.minInclusive;
const GENERATED_MISSION_ID_MAX_EXCLUSIVE = productionMissionPolicy
  .generatedMissionIDRange.maxExclusive;
const RETIRED_TEMPLATE_PREFIXES = productionMissionPolicy.retiredTemplatePrefixes;
const EVE_SURVIVAL_TEMPLATE_PREFIX = RETIRED_TEMPLATE_PREFIXES[0];
const BANNED_MISSION_IDS = new Set(
  productionMissionPolicy.disabledMissions.map(({ missionID }) => String(missionID)),
);
const BANNED_DUNGEON_TEMPLATE_IDS = new Set(
  productionMissionPolicy.disabledMissions
    .flatMap(({ templateIDs }) => templateIDs)
    .map((templateID) => templateID.toLowerCase()),
);
const BANNED_SOURCE_MISSION_IDS = new Set(
  productionMissionPolicy.disabledMissions.flatMap(({ missionID, templateIDs }) => [
    String(missionID).toLowerCase(),
    ...templateIDs.flatMap((templateID) => {
      const normalized = templateID.toLowerCase();
      const separatorIndex = normalized.indexOf(":");
      return separatorIndex >= 0
        ? [normalized, normalized.slice(separatorIndex + 1)]
        : [normalized];
    }),
  ]),
);
const GOLDEN_SECURITY_MISSIONS = productionMissionPolicy.goldenSecurityMissions.map(
  ({ missionID, dungeonID, agentLevel, templateID }) => ({
    missionID: String(missionID),
    dungeonID,
    agentLevel,
    templateID,
  }),
);

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizedText(value) {
  return String(value == null ? "" : value).trim();
}

function isEveSurvivalTemplateID(value) {
  const normalized = normalizedText(value).toLowerCase();
  return RETIRED_TEMPLATE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isEveSurvivalSourceName(value) {
  return EVE_SURVIVAL_SOURCE_KEYS.has(normalizedText(value).toLowerCase());
}

function isEveSurvivalSourceURL(value) {
  const normalized = normalizedText(value);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "eve-survival.org" || hostname === "www.eve-survival.org";
  } catch (_error) {
    return false;
  }
}

function listRecordSourceURLs(record) {
  return [
    record && record.sourceUrl,
    record && record.sourceURL,
    record && record.adminMetadata && record.adminMetadata.sourceUrl,
    record && record.adminMetadata && record.adminMetadata.sourceURL,
  ];
}

function isGeneratedEveSurvivalMission(missionID, record) {
  const numericMissionIDs = [
    toInt(missionID, 0),
    toInt(record && record.missionID, 0),
  ];
  return (
    isEveSurvivalSourceName(record && record.generatedFromSource) ||
    isEveSurvivalSourceName(record && record.source) ||
    isEveSurvivalSourceName(record && record.provider) ||
    isEveSurvivalSourceName(record && record.sourceProvider) ||
    listRecordSourceURLs(record).some(isEveSurvivalSourceURL) ||
    isEveSurvivalTemplateID(record && record.generatedFromTemplateID) ||
    isEveSurvivalTemplateID(record && record.missionTemplateID) ||
    isEveSurvivalTemplateID(record && record.dungeonTemplateID) ||
    isGeneratedMissionIdentifier(missionID) ||
    isGeneratedMissionIdentifier(record && record.missionID) ||
    numericMissionIDs.some(isGeneratedMissionIdentifier)
  );
}

function isBannedMissionRecord(missionID, record) {
  return isDisabledMissionIdentifier(missionID) ||
    isDisabledMissionIdentifier(record && record.missionID) ||
    isDisabledMissionIdentifier(record && record.sourceMissionID) ||
    BANNED_SOURCE_MISSION_IDS.has(
      normalizedText(record && record.sourceMissionID).toLowerCase(),
    ) ||
    [
      record && record.missionTemplateID,
      record && record.dungeonTemplateID,
      record && record.generatedFromTemplateID,
    ].some((templateID) => isDisabledMissionTemplateIdentifier(templateID) ||
      isDisabledMissionIdentifier(templateID)) ||
    [
      record && record.sourceUrl,
      record && record.sourceURL,
      record && record.adminMetadata && record.adminMetadata.sourceUrl,
      record && record.adminMetadata && record.adminMetadata.sourceURL,
    ].some(isDisabledMissionSourceURL);
}

function isEveSurvivalTemplateRecord(templateID, record) {
  return isEveSurvivalTemplateID(templateID) ||
    isDisabledMissionSourceURL(templateID) ||
    isEveSurvivalSourceName(record && record.source) ||
    isEveSurvivalSourceName(record && record.provider) ||
    isEveSurvivalSourceName(record && record.sourceProvider) ||
    listRecordSourceURLs(record).some(isEveSurvivalSourceURL) ||
    isEveSurvivalTemplateID(record && record.templateID) ||
    isEveSurvivalTemplateID(record && record.sourceMissionID) ||
    isDisabledMissionTemplateIdentifier(templateID) ||
    isDisabledMissionTemplateIdentifier(record && record.templateID) ||
    isDisabledMissionIdentifier(record && record.sourceMissionID) ||
    isDisabledMissionIdentifier(record && record.missionID) ||
    BANNED_SOURCE_MISSION_IDS.has(
      normalizedText(record && record.sourceMissionID).toLowerCase(),
    ) || [
      record && record.sourceUrl,
      record && record.sourceURL,
      record && record.adminMetadata && record.adminMetadata.sourceUrl,
      record && record.adminMetadata && record.adminMetadata.sourceURL,
    ].some(isDisabledMissionSourceURL);
}

function compareMissionIDs(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right));
}

function addMissionIndexValue(indexes, indexName, key, missionID) {
  const normalizedKey = normalizedText(key);
  if (!normalizedKey) return;
  indexes[indexName][normalizedKey] = indexes[indexName][normalizedKey] || [];
  indexes[indexName][normalizedKey].push(missionID);
}

function retainedMissionIDList(values, retainedMissionIDs) {
  return [...new Set((Array.isArray(values) ? values : []).filter((missionID) => (
    retainedMissionIDs.has(String(missionID))
  )))].sort(compareMissionIDs);
}

function rebuildMissionIndexes(payload) {
  const retainedMissionIDs = new Set(Object.keys(payload.missionsByID || {}));
  const previousIndexes = payload.indexes || {};
  const indexes = {
    missionKindToMissionIDs: {},
    missionFlavorToMissionIDs: {},
    missionTemplateToMissionIDs: {},
    agentIDToMissionIDs: {},
    preferredMissionIDs: {},
  };

  for (const [missionID, record] of Object.entries(payload.missionsByID || {})) {
    const normalizedMissionID = toInt(record && record.missionID, toInt(missionID, 0));
    addMissionIndexValue(indexes, "missionKindToMissionIDs", record && record.missionKind, normalizedMissionID);
    addMissionIndexValue(indexes, "missionFlavorToMissionIDs", record && record.missionFlavor, normalizedMissionID);
    addMissionIndexValue(indexes, "missionTemplateToMissionIDs", record && record.contentTemplate, normalizedMissionID);
    addMissionIndexValue(indexes, "missionTemplateToMissionIDs", record && record.missionTemplateID, normalizedMissionID);
    addMissionIndexValue(indexes, "missionTemplateToMissionIDs", record && record.dungeonTemplateID, normalizedMissionID);
  }

  for (const indexName of [
    "missionKindToMissionIDs",
    "missionFlavorToMissionIDs",
    "missionTemplateToMissionIDs",
  ]) {
    for (const key of Object.keys(indexes[indexName])) {
      indexes[indexName][key] = [...new Set(indexes[indexName][key])].sort(compareMissionIDs);
    }
  }

  for (const [agentID, missionIDs] of Object.entries(previousIndexes.agentIDToMissionIDs || {})) {
    const retained = retainedMissionIDList(missionIDs, retainedMissionIDs);
    if (retained.length > 0) indexes.agentIDToMissionIDs[agentID] = retained;
  }

  for (const [name, missionID] of Object.entries(previousIndexes.preferredMissionIDs || {})) {
    if (retainedMissionIDs.has(String(missionID))) {
      indexes.preferredMissionIDs[name] = missionID;
    }
  }

  return indexes;
}

function rebuildMissionCounts(payload) {
  const missions = Object.values(payload.missionsByID || {});
  return {
    ...(payload.counts || {}),
    missionCount: missions.length,
    missionKindCount: new Set(missions.map((record) => normalizedText(record && record.missionKind))).size,
    missionFlavorCount: new Set(missions.map((record) => normalizedText(record && record.missionFlavor))).size,
    missionTemplateCount: new Set(missions.map((record) => normalizedText(record && record.contentTemplate))).size,
    epicArcMissionCount: missions.filter((record) => record && record.isEpicArc === true).length,
    preferredMissionCount: Object.keys(payload.indexes && payload.indexes.preferredMissionIDs || {}).length,
    localizedMissionCount: missions.filter((record) => normalizedText(record && record.localizedName && record.localizedName.text)).length,
    localizedMissionMessageCount: missions.reduce((total, record) => (
      total + Object.keys(record && record.localizedMessages || {}).length
    ), 0),
    generatedEveSurvivalMissionCount: missions.filter((record) => (
      normalizedText(record && record.generatedFromSource).toLowerCase() ===
        GENERATED_EVE_SURVIVAL_SOURCE
    )).length,
  };
}

function sanitizeMissionAuthority(payload) {
  if (isCommunityContentCleaningEnabled === false) {
    return {
      beforeMissionCount: Object.keys(payload.missionsByID || {}).length,
      afterMissionCount: Object.keys(payload.missionsByID || {}).length,
      removedGeneratedMissionCount: 0,
      removedBannedMissionCount: 0,
      removedSourceMetadataCount: 0,
      rebuiltIndexes: false,
      rebuiltCounts: false,
    };
  }
  const missionsByID = payload.missionsByID || {};
  const beforeMissionCount = Object.keys(missionsByID).length;
  let removedGeneratedMissionCount = 0;
  let removedBannedMissionCount = 0;

  for (const [missionID, record] of Object.entries(missionsByID)) {
    if (isGeneratedEveSurvivalMission(missionID, record)) {
      delete missionsByID[missionID];
      removedGeneratedMissionCount += 1;
      continue;
    }
    if (isBannedMissionRecord(missionID, record)) {
      delete missionsByID[missionID];
      removedBannedMissionCount += 1;
    }
  }

  let removedSourceMetadataCount = 0;
  if (payload.source && payload.source.generatedEveSurvivalMissionAuthority) {
    delete payload.source.generatedEveSurvivalMissionAuthority;
    removedSourceMetadataCount = 1;
  }

  const previousIndexes = JSON.stringify(payload.indexes || {});
  const previousCounts = JSON.stringify(payload.counts || {});
  payload.indexes = rebuildMissionIndexes(payload);
  payload.counts = rebuildMissionCounts(payload);

  return {
    beforeMissionCount,
    afterMissionCount: Object.keys(missionsByID).length,
    removedGeneratedMissionCount,
    removedBannedMissionCount,
    removedSourceMetadataCount,
    rebuiltIndexes: previousIndexes !== JSON.stringify(payload.indexes),
    rebuiltCounts: previousCounts !== JSON.stringify(payload.counts),
  };
}

function filterDungeonIndex(index, retainedTemplateIDs) {
  const filtered = {};
  let removedReferenceCount = 0;

  for (const [key, value] of Object.entries(index || {})) {
    if (Array.isArray(value)) {
      const retained = value.filter((templateID) => retainedTemplateIDs.has(String(templateID)));
      removedReferenceCount += value.length - retained.length;
      if (retained.length > 0) filtered[key] = retained;
      continue;
    }
    if (typeof value === "string") {
      if (retainedTemplateIDs.has(value)) filtered[key] = value;
      else removedReferenceCount += 1;
      continue;
    }
    filtered[key] = value;
  }

  return { filtered, removedReferenceCount };
}

function setCount(payload, countName, value) {
  payload.counts = payload.counts || {};
  if (payload.counts[countName] === value) return 0;
  payload.counts[countName] = value;
  return 1;
}

function sanitizeDungeonAuthority(payload) {
  if (isCommunityContentCleaningEnabled === false) {
    return {
      beforeTemplateCount: Object.keys(payload.templatesByID || {}).length,
      afterTemplateCount: Object.keys(payload.templatesByID || {}).length,
      removedEveSurvivalTemplateCount: 0,
      removedBannedTemplateCount: 0,
      removedIndexReferenceCount: 0,
      metadataChangeCount: 0,
    };
  }
  const templatesByID = payload.templatesByID || {};
  const beforeTemplateCount = Object.keys(templatesByID).length;
  let removedEveSurvivalTemplateCount = 0;
  let removedBannedTemplateCount = 0;

  for (const [templateID, template] of Object.entries(templatesByID)) {
    if (!isEveSurvivalTemplateRecord(templateID, template)) continue;
    if (
      BANNED_DUNGEON_TEMPLATE_IDS.has(normalizedText(templateID).toLowerCase()) ||
      BANNED_DUNGEON_TEMPLATE_IDS.has(
        normalizedText(template && template.templateID).toLowerCase(),
      )
    ) {
      removedBannedTemplateCount += 1;
    }
    delete templatesByID[templateID];
    removedEveSurvivalTemplateCount += 1;
  }

  const retainedTemplateIDs = new Set(Object.keys(templatesByID));
  let removedIndexReferenceCount = 0;
  const indexes = {};
  for (const [indexName, index] of Object.entries(payload.indexes || {})) {
    const result = filterDungeonIndex(index, retainedTemplateIDs);
    indexes[indexName] = result.filtered;
    removedIndexReferenceCount += result.removedReferenceCount;
  }
  payload.indexes = indexes;

  let metadataChangeCount = 0;
  if (payload.source && payload.source.eveSurvival) {
    delete payload.source.eveSurvival;
    metadataChangeCount += 1;
  }
  if (payload.meta && Array.isArray(payload.meta.enabledSources)) {
    const retainedSources = payload.meta.enabledSources.filter((source) => source !== "eve-survival");
    metadataChangeCount += payload.meta.enabledSources.length - retainedSources.length;
    payload.meta.enabledSources = retainedSources;
  }
  if (payload.coverage && payload.coverage.totalTemplatesByFamily) {
    const retainedMissionTemplateCount = Object.values(templatesByID).filter((template) => (
      normalizedText(template && template.siteFamily) === "mission"
    )).length;
    if (retainedMissionTemplateCount > 0) {
      if (payload.coverage.totalTemplatesByFamily.mission !== retainedMissionTemplateCount) {
        payload.coverage.totalTemplatesByFamily.mission = retainedMissionTemplateCount;
        metadataChangeCount += 1;
      }
    } else if (Object.prototype.hasOwnProperty.call(
      payload.coverage.totalTemplatesByFamily,
      "mission",
    )) {
      delete payload.coverage.totalTemplatesByFamily.mission;
      metadataChangeCount += 1;
    }
  }

  const sceneProfileCount = Object.values(templatesByID).filter((template) => (
    template && template.siteSceneProfile != null
  )).length;
  metadataChangeCount += setCount(payload, "eveSurvivalMissionCount", 0);
  metadataChangeCount += setCount(payload, "templateCount", retainedTemplateIDs.size);
  metadataChangeCount += setCount(payload, "sceneProfileCount", sceneProfileCount);

  return {
    beforeTemplateCount,
    afterTemplateCount: retainedTemplateIDs.size,
    removedEveSurvivalTemplateCount,
    removedBannedTemplateCount,
    removedIndexReferenceCount,
    metadataChangeCount,
  };
}

function sanitizeAgentAuthority(payload) {
  if (isCommunityContentCleaningEnabled === false) {
    const templateCount = Object.values(payload.missionPoolsByKindAndLevel || {}).flat().length
      + Object.values(payload.agentsByID || {}).reduce((sum, agent) => {
        return sum + (Array.isArray(agent && agent.missionTemplateIDs) ? agent.missionTemplateIDs.length : 0);
      }, 0);
    return {
      removedPoolReferenceCount: 0,
      removedAgentReferenceCount: 0,
      changedAgentCount: 0,
      metadataChangeCount: 0,
      retainedTemplateCount: templateCount,
    };
  }
  let removedPoolReferenceCount = 0;
  const missionPoolsByKindAndLevel = {};
  for (const [poolKey, templateIDs] of Object.entries(payload.missionPoolsByKindAndLevel || {})) {
    const retained = (Array.isArray(templateIDs) ? templateIDs : []).filter((templateID) => (
      !isRetiredMissionTemplateIdentifier(templateID)
    ));
    removedPoolReferenceCount += (Array.isArray(templateIDs) ? templateIDs.length : 0) - retained.length;
    if (retained.length > 0) missionPoolsByKindAndLevel[poolKey] = retained;
  }
  payload.missionPoolsByKindAndLevel = missionPoolsByKindAndLevel;

  let removedAgentReferenceCount = 0;
  let changedAgentCount = 0;
  for (const agent of Object.values(payload.agentsByID || {})) {
    const previous = Array.isArray(agent && agent.missionTemplateIDs) ? agent.missionTemplateIDs : [];
    const retained = previous.filter((templateID) =>
      !isRetiredMissionTemplateIdentifier(templateID));
    if (retained.length !== previous.length) {
      agent.missionTemplateIDs = retained;
      removedAgentReferenceCount += previous.length - retained.length;
      changedAgentCount += 1;
    }
  }

  const retainedTemplateIDs = new Set([
    ...Object.values(missionPoolsByKindAndLevel).flat(),
    ...Object.values(payload.agentsByID || {}).flatMap((agent) => (
      Array.isArray(agent && agent.missionTemplateIDs) ? agent.missionTemplateIDs : []
    )),
  ]);
  let metadataChangeCount = 0;
  metadataChangeCount += setCount(
    payload,
    "missionPoolCount",
    Object.keys(missionPoolsByKindAndLevel).length,
  );
  metadataChangeCount += setCount(payload, "missionTemplateCount", retainedTemplateIDs.size);

  return {
    removedPoolReferenceCount,
    removedAgentReferenceCount,
    changedAgentCount,
    metadataChangeCount,
  };
}

function sanitizeAuthorityTable(tableName, payload) {
  if (tableName === "missionAuthority") return sanitizeMissionAuthority(payload);
  if (tableName === "dungeonAuthority") return sanitizeDungeonAuthority(payload);
  if (tableName === "agentAuthority") return sanitizeAgentAuthority(payload);
  return null;
}

function policyViolationCount(tableName, payload) {
  if (tableName === "missionAuthority") {
    const prohibitedMissionCount = Object.entries(payload.missionsByID || {}).filter(([missionID, record]) => (
      isBannedMissionRecord(missionID, record) ||
      isGeneratedEveSurvivalMission(missionID, record)
    )).length;
    const brokenGoldenMissionCount = GOLDEN_SECURITY_MISSIONS.filter(({ missionID, dungeonID }) => {
      const record = payload.missionsByID && payload.missionsByID[missionID];
      return !record || toInt(record.missionID, 0) !== toInt(missionID, 0) ||
        toInt(record.killMission && record.killMission.dungeonID, 0) !== dungeonID;
    }).length;
    return prohibitedMissionCount + brokenGoldenMissionCount;
  }
  if (tableName === "dungeonAuthority") {
    const prohibitedTemplateCount = Object.entries(payload.templatesByID || {})
      .filter(([templateID, template]) => isEveSurvivalTemplateRecord(templateID, template)).length;
    const brokenGoldenTemplateCount = GOLDEN_SECURITY_MISSIONS.filter(({
      missionID,
      dungeonID,
      templateID,
    }) => {
      const template = payload.templatesByID && payload.templatesByID[templateID];
      return !template || template.source !== "client" ||
        toInt(template.sourceDungeonID, 0) !== dungeonID ||
        normalizedText(template.populationHints && template.populationHints.source) !==
          "golden_log_combat_mission" ||
        toInt(template.populationHints && template.populationHints.missionID, 0) !==
          toInt(missionID, 0);
    }).length;
    return prohibitedTemplateCount + brokenGoldenTemplateCount;
  }
  if (tableName === "agentAuthority") {
    const poolViolations = Object.values(payload.missionPoolsByKindAndLevel || {}).flat()
      .filter(isRetiredMissionTemplateIdentifier).length;
    const agentViolations = Object.values(payload.agentsByID || {}).reduce((total, agent) => (
      total + (Array.isArray(agent && agent.missionTemplateIDs)
        ? agent.missionTemplateIDs.filter(isRetiredMissionTemplateIdentifier).length
        : 0)
    ), 0);
    return poolViolations + agentViolations;
  }
  return 0;
}

module.exports = {
  GENERATED_EVE_SURVIVAL_SOURCE,
  GENERATED_MISSION_ID_MIN,
  GENERATED_MISSION_ID_MAX_EXCLUSIVE,
  EVE_SURVIVAL_TEMPLATE_PREFIX,
  BANNED_MISSION_IDS,
  BANNED_DUNGEON_TEMPLATE_IDS,
  BANNED_SOURCE_MISSION_IDS,
  GOLDEN_SECURITY_MISSIONS,
  isBannedMissionRecord,
  isEveSurvivalTemplateID,
  isEveSurvivalSourceName,
  isEveSurvivalSourceURL,
  isEveSurvivalTemplateRecord,
  isGeneratedEveSurvivalMission,
  sanitizeMissionAuthority,
  sanitizeDungeonAuthority,
  sanitizeAgentAuthority,
  sanitizeAuthorityTable,
  policyViolationCount,
};
