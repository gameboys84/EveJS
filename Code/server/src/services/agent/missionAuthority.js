const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  listAgents,
  listMissionTemplateIDsForAgent,
} = require(path.join(__dirname, "./agentAuthority"));

let cache = null;
const EPIC_ARC_MESSAGE_TYPES = Object.freeze([
  "messages.epicMission.journalText.chapterTitle",
  "messages.epicMission.journalText.inProgressMessage",
  "messages.epicMission.journalText.completedMessage",
]);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text.length > 0 ? text : fallback;
}

function normalizeMissionID(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = normalizeText(value, "");
  if (!text) {
    return fallback;
  }
  if (/^-?\d+$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  return text;
}

function normalizeMissionIDList(values) {
  const source = Array.isArray(values) ? values : [];
  const seen = new Set();
  const result = [];
  for (const value of source) {
    const missionID = normalizeMissionID(value, null);
    const key = missionID === null ? "" : String(missionID);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(missionID);
  }
  return result;
}

function normalizeIntegerList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))].sort((left, right) => left - right);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeOptionalMissionObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? cloneValue(value)
    : null;
}

function normalizeMissionRewardEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const hasRewardType =
    Object.prototype.hasOwnProperty.call(value, "rewardTypeID") ||
    Object.prototype.hasOwnProperty.call(value, "typeID");
  const hasRewardQuantity =
    Object.prototype.hasOwnProperty.call(value, "rewardQuantity") ||
    Object.prototype.hasOwnProperty.call(value, "quantity");
  if (!hasRewardType && !hasRewardQuantity) {
    return null;
  }
  return {
    rewardTypeID: toInt(value.rewardTypeID ?? value.typeID, 0) || null,
    rewardQuantity: toInt(value.rewardQuantity ?? value.quantity, 0) || null,
  };
}

function normalizeNullableInteger(value) {
  return value === undefined || value === null
    ? null
    : toInt(value, 0) || null;
}

function normalizeMissionRewards(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "reward") ||
    Object.prototype.hasOwnProperty.call(value, "bonusReward") ||
    Object.prototype.hasOwnProperty.call(value, "bonusTimeInterval")
  ) {
    return {
      reward: normalizeMissionRewardEntry(value.reward),
      bonusReward: normalizeMissionRewardEntry(value.bonusReward),
      bonusTimeInterval: normalizeNullableInteger(value.bonusTimeInterval),
    };
  }
  return cloneValue(value);
}

function normalizeLocalizedMessageEntry(value, fallbackMessageID = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const messageID = toInt(value.messageID ?? fallbackMessageID, 0) || null;
  const text = normalizeText(value.text, "");
  if (!messageID && !text) {
    return null;
  }
  return {
    messageID,
    text,
    metadata:
      Object.prototype.hasOwnProperty.call(value, "metadata")
        ? cloneValue(value.metadata)
        : null,
    tokens:
      Object.prototype.hasOwnProperty.call(value, "tokens")
        ? cloneValue(value.tokens)
        : null,
  };
}

function normalizeLocalizedMessageMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  for (const [messageKey, entry] of Object.entries(value)) {
    const normalizedEntry = normalizeLocalizedMessageEntry(entry, null);
    if (!normalizedEntry) {
      continue;
    }
    result[String(messageKey)] = normalizedEntry;
  }
  return result;
}

function normalizeMissionRecord(record = {}, missionID) {
  return {
    missionID: normalizeMissionID(record.missionID ?? missionID, missionID),
    contentTemplate: normalizeText(record.contentTemplate, ""),
    nameID: toInt(record.nameID, 0),
    contentTags: normalizeMissionIDList(record.contentTags),
    messages: normalizeObject(record.messages),
    localizedName: normalizeLocalizedMessageEntry(record.localizedName, record.nameID),
    localizedMessages: normalizeLocalizedMessageMap(record.localizedMessages),
    hasStandingRewards:
      Object.prototype.hasOwnProperty.call(record, "hasStandingRewards")
        ? record.hasStandingRewards === true
        : true,
    fixedLpRewardAlpha: toInt(record.fixedLpRewardAlpha, 0),
    fixedLpRewardOmega: toInt(record.fixedLpRewardOmega, 0),
    expirationTime: toInt(record.expirationTime, 0) || null,
    agentTypeID: toInt(record.agentTypeID, 0) || null,
    corporationID: toInt(record.corporationID, 0) || null,
    factionID: toInt(record.factionID, 0) || null,
    initialAgentGiftTypeID: toInt(record.initialAgentGiftTypeID, 0) || null,
    initialAgentGiftQuantity: toInt(record.initialAgentGiftQuantity, 0) || null,
    nodeGraphID: toInt(record.nodeGraphID, 0) || null,
    missionTemplateID: normalizeText(record.missionTemplateID, ""),
    dungeonTemplateID: normalizeText(record.dungeonTemplateID, ""),
    generatedFromTemplateID: normalizeText(record.generatedFromTemplateID, ""),
    generatedFromSource: normalizeText(record.generatedFromSource, ""),
    killMission: normalizeOptionalMissionObject(record.killMission),
    courierMission: normalizeOptionalMissionObject(record.courierMission),
    missionRewards: normalizeMissionRewards(record.missionRewards),
    clientObjectives: normalizeOptionalMissionObject(record.clientObjectives),
    extraStandings: normalizeOptionalMissionObject(record.extraStandings),
    remoteCompletable:
      Object.prototype.hasOwnProperty.call(record, "remoteCompletable")
        ? record.remoteCompletable === true
        : null,
    epicArcID: toInt(record.epicArcID, 0) || null,
    sourceAgentID: toInt(record.sourceAgentID, 0) || null,
    nextMissionIDs: normalizeMissionIDList(record.nextMissionIDs),
    nextAgentIDs: normalizeIntegerList(record.nextAgentIDs),
    targetAgentID: toInt(record.targetAgentID, 0) || null,
    missionKind: normalizeText(record.missionKind, "encounter"),
    missionFlavor: normalizeText(record.missionFlavor, "basic"),
    isEpicArc: record.isEpicArc === true,
    isHeraldry: record.isHeraldry === true,
    isResearch: record.isResearch === true,
    isStoryline: record.isStoryline === true,
    isGenericStoryline: record.isGenericStoryline === true,
    isAgentInteraction: record.isAgentInteraction === true,
    isTalkToAgent: record.isTalkToAgent === true,
  };
}

function normalizePayload(payload = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: normalizeText(payload.generatedAt, ""),
    source: normalizeObject(payload.source),
    counts: normalizeObject(payload.counts),
    missionsByID: normalizeObject(payload.missionsByID),
    indexes: normalizeObject(payload.indexes),
  };
}

function buildAgentPreferenceKeys(agentRecord = null) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "encounter")
    .toLowerCase();
  const missionTypeLabel = normalizeText(
    agentRecord && agentRecord.missionTypeLabel,
    "",
  ).toLowerCase();
  const agentTypeID = toInt(agentRecord && agentRecord.agentTypeID, 0);
  const importantMission = agentRecord && agentRecord.importantMission === true;
  const isResearch =
    missionKind === "research" ||
    missionTypeLabel.includes("research") ||
    agentTypeID === 4;

  if (isResearch) {
    return [
      "researchTrade",
      "researchCourier",
      "basicTrade",
      "basicCourier",
      "basicEncounter",
    ];
  }

  if (missionKind === "courier" || missionKind === "distribution") {
    return importantMission
      ? [
          "storylineCourier",
          "genericStorylineCourier",
          "basicCourier",
        ]
      : ["basicCourier"];
  }

  if (missionKind === "trade") {
    return importantMission
      ? [
          "storylineTrade",
          "genericStorylineTrade",
          "basicTrade",
        ]
      : ["basicTrade"];
  }

  if (missionKind === "mining") {
    return ["basicMining"];
  }

  return importantMission
    ? [
        "storylineEncounter",
        "genericStorylineEncounter",
        "basicEncounter",
      ]
    : ["basicEncounter"];
}

function addMissionTemplateIndex(missionTemplateToMissionIDs, templateID, missionID) {
  const normalizedTemplateID = normalizeText(templateID, "");
  const normalizedMissionID = normalizeMissionID(missionID, null);
  if (!normalizedTemplateID || normalizedMissionID === null) {
    return;
  }
  const current = missionTemplateToMissionIDs.get(normalizedTemplateID) || [];
  const key = String(normalizedMissionID);
  if (!current.some((entry) => String(entry) === key)) {
    current.push(normalizedMissionID);
  }
  missionTemplateToMissionIDs.set(normalizedTemplateID, current);
}

function buildCache() {
  const payload = normalizePayload(readStaticTable(TABLE.MISSION_AUTHORITY));
  const missionsByID = new Map();
  const epicArcMessageMaps = Object.fromEntries(
    EPIC_ARC_MESSAGE_TYPES.map((messageType) => [messageType, {}]),
  );
  for (const [missionID, record] of Object.entries(payload.missionsByID || {})) {
    const normalizedMission = normalizeMissionRecord(record, normalizeMissionID(missionID, missionID));
    const missionKey = String(normalizedMission.missionID);
    missionsByID.set(missionKey, normalizedMission);
    if (normalizedMission.isEpicArc || normalizedMission.missionFlavor === "epicArc") {
      for (const messageType of EPIC_ARC_MESSAGE_TYPES) {
        const messageID = toInt(normalizedMission.messages[messageType], 0);
        if (messageID > 0) {
          epicArcMessageMaps[messageType][missionKey] = messageID;
        }
      }
    }
  }

  const missionTemplateToMissionIDs = new Map();
  const agentIDToMissionIDs = new Map();
  const preferredMissionIDs = new Map();

  const indexPayload = normalizeObject(payload.indexes);
  for (const [templateID, missionIDs] of Object.entries(
    normalizeObject(indexPayload.missionTemplateToMissionIDs),
  )) {
    missionTemplateToMissionIDs.set(
      templateID,
      normalizeMissionIDList(missionIDs),
    );
  }

  for (const missionRecord of missionsByID.values()) {
    addMissionTemplateIndex(
      missionTemplateToMissionIDs,
      missionRecord.dungeonTemplateID || missionRecord.missionTemplateID,
      missionRecord.missionID,
    );
  }

  for (const [agentID, missionIDs] of Object.entries(
    normalizeObject(indexPayload.agentIDToMissionIDs),
  )) {
    agentIDToMissionIDs.set(
      String(toInt(agentID, 0)),
      normalizeMissionIDList(missionIDs),
    );
  }

  for (const [preferenceKey, missionID] of Object.entries(
    normalizeObject(indexPayload.preferredMissionIDs),
  )) {
    const normalizedMissionID = normalizeMissionID(missionID, null);
    if (normalizedMissionID === null) {
      continue;
    }
    preferredMissionIDs.set(preferenceKey, normalizedMissionID);
  }

  return {
    payload,
    missionsByID,
    missionTemplateToMissionIDs,
    agentIDToMissionIDs,
    preferredMissionIDs,
    epicArcMessageMaps,
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function getPayload() {
  return cloneValue(ensureCache().payload);
}

function getMissionByID(missionID) {
  const record = ensureCache().missionsByID.get(String(normalizeMissionID(missionID, missionID)));
  return record ? cloneValue(record) : null;
}

function listMissionIDsByTemplate(contentTemplateID) {
  const templateID = normalizeText(contentTemplateID, "");
  if (!templateID) {
    return [];
  }
  const missionIDs = ensureCache().missionTemplateToMissionIDs.get(templateID);
  return missionIDs ? cloneValue(missionIDs) : [];
}

function getPreferredMissionID(preferenceKey) {
  const missionID = ensureCache().preferredMissionIDs.get(normalizeText(preferenceKey, ""));
  return missionID === undefined ? null : cloneValue(missionID);
}

// For now, agents only offer missions backed by verified Level-1 templates where that pool is known to
// include unsupported content. Keyed by killMission.dungeonID so missionAuthority contentIDs stay retail.
const SUPPORTED_LEVEL_ONE_MINING_DUNGEON_IDS = new Set([2449, 2450, 2451, 2454, 2456]);
const SUPPORTED_LEVEL_ONE_ENCOUNTER_DUNGEON_IDS = new Set([283, 875, 1940, 3030]);
const SUPPORTED_LEVEL_ONE_CLIENT_DUNGEON_IDS = new Set([
  ...SUPPORTED_LEVEL_ONE_MINING_DUNGEON_IDS,
  ...SUPPORTED_LEVEL_ONE_ENCOUNTER_DUNGEON_IDS,
]);

function isSupportedLevelOneClientDungeonID(dungeonID) {
  return SUPPORTED_LEVEL_ONE_CLIENT_DUNGEON_IDS.has(toInt(dungeonID, 0));
}

function isGeneratedScrapedMissionRecord(record) {
  return normalizeText(record && record.generatedFromTemplateID, "").startsWith("eve-survival:") ||
    normalizeText(record && record.dungeonTemplateID, "").startsWith("eve-survival:");
}

function supportedDungeonIDsForAgent(agentRecord) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "").toLowerCase();
  if (missionKind === "mining") {
    return SUPPORTED_LEVEL_ONE_MINING_DUNGEON_IDS;
  }
  if (missionKind === "encounter" && toInt(agentRecord && agentRecord.level, 0) === 1) {
    return SUPPORTED_LEVEL_ONE_ENCOUNTER_DUNGEON_IDS;
  }
  return null;
}

function filterUnsupportedLevelOneAgentMissions(agentRecord, missionIDs) {
  const supportedDungeonIDs = supportedDungeonIDsForAgent(agentRecord);
  if (!supportedDungeonIDs) {
    return missionIDs;
  }
  return missionIDs.filter((missionID) => {
    const record = getMissionByID(missionID);
    if (isGeneratedScrapedMissionRecord(record)) {
      return true;
    }
    const dungeonID = toInt(record && record.killMission && record.killMission.dungeonID, 0);
    return supportedDungeonIDs.has(dungeonID);
  });
}

function isSupportedLevelOneClientMissionForAgent(agentRecord, missionID) {
  const supportedDungeonIDs = supportedDungeonIDsForAgent(agentRecord);
  if (!supportedDungeonIDs) {
    return false;
  }
  const record = getMissionByID(missionID);
  const dungeonID = toInt(record && record.killMission && record.killMission.dungeonID, 0);
  return supportedDungeonIDs.has(dungeonID);
}

function uniqueMissionIDs(missionIDs) {
  const seen = new Set();
  const result = [];
  for (const missionID of Array.isArray(missionIDs) ? missionIDs : []) {
    const normalizedMissionID = normalizeMissionID(missionID, null);
    const key = normalizedMissionID === null ? "" : String(normalizedMissionID);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalizedMissionID);
  }
  return result;
}

function listTemplateBoundMissionIDsForAgent(agentRecord = null) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "").toLowerCase();
  if (missionKind !== "encounter") {
    return [];
  }
  const agentID = toInt(agentRecord && agentRecord.agentID, 0);
  if (agentID <= 0) {
    return [];
  }
  const missionIDs = [];
  for (const templateID of listMissionTemplateIDsForAgent(agentID)) {
    for (const missionID of listMissionIDsByTemplate(templateID)) {
      const record = getMissionByID(missionID);
      if (isGeneratedScrapedMissionRecord(record)) {
        missionIDs.push(missionID);
      }
    }
  }
  return uniqueMissionIDs(missionIDs);
}

function listPreferredMissionCandidateIDs(agentRecord = null) {
  const candidateMissionIDs = [];
  const seen = new Set();
  for (const preferenceKey of buildAgentPreferenceKeys(agentRecord)) {
    const missionID = getPreferredMissionID(preferenceKey);
    if (missionID !== null && missionID !== undefined) {
      const preferredTemplateMission = getMissionByID(missionID);
      if (preferredTemplateMission && preferredTemplateMission.contentTemplate) {
        for (const templateMissionID of listMissionIDsByTemplate(
          preferredTemplateMission.contentTemplate,
        )) {
          const key = String(templateMissionID);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          candidateMissionIDs.push(templateMissionID);
        }
        continue;
      }
    }

    const fallbackMissionID = ensureCache().preferredMissionIDs.get(preferenceKey);
    if (fallbackMissionID !== undefined && fallbackMissionID !== null) {
      const key = String(fallbackMissionID);
      if (!seen.has(key)) {
        seen.add(key);
        candidateMissionIDs.push(fallbackMissionID);
      }
    }
  }
  return candidateMissionIDs;
}

function listMissionIDsForAgent(agentRecord = null) {
  const normalizedAgentID = toInt(agentRecord && agentRecord.agentID, 0);
  const agentSpecificMissionIDs = ensureCache().agentIDToMissionIDs.get(String(normalizedAgentID));
  if (agentSpecificMissionIDs && agentSpecificMissionIDs.length > 0) {
    const filteredAgentSpecificMissionIDs = filterUnsupportedLevelOneAgentMissions(
      agentRecord,
      cloneValue(agentSpecificMissionIDs),
    );
    if (filteredAgentSpecificMissionIDs.length > 0) {
      return filteredAgentSpecificMissionIDs;
    }
  }

  const templateBoundMissionIDs = filterUnsupportedLevelOneAgentMissions(
    agentRecord,
    listTemplateBoundMissionIDsForAgent(agentRecord),
  );
  const preferredMissionIDs = listPreferredMissionCandidateIDs(agentRecord);
  if (templateBoundMissionIDs.length > 0) {
    return uniqueMissionIDs([
      ...templateBoundMissionIDs,
      ...preferredMissionIDs.filter((missionID) =>
        isSupportedLevelOneClientMissionForAgent(agentRecord, missionID)),
    ]);
  }
  return filterUnsupportedLevelOneAgentMissions(agentRecord, preferredMissionIDs);
}

function pickMissionForAgent(agentRecord = null, selectionIndex = 0) {
  const missionIDs = listMissionIDsForAgent(agentRecord);
  if (!missionIDs.length) {
    return null;
  }

  const poolKey = normalizeText(agentRecord && agentRecord.missionPoolKey, "");
  const poolAgentOffset = poolKey
    ? listAgents()
      .filter((candidate) => normalizeText(candidate && candidate.missionPoolKey, "") === poolKey)
      .sort((left, right) => (
        toInt(left && left.agentID, 0) - toInt(right && right.agentID, 0)
      ))
      .findIndex((candidate) => toInt(candidate && candidate.agentID, 0) === toInt(agentRecord && agentRecord.agentID, 0))
    : -1;
  const index = Math.max(0, toInt(selectionIndex, 0)) + Math.max(0, poolAgentOffset);
  return getMissionByID(missionIDs[index % missionIDs.length]);
}

function getEpicArcMessageMaps() {
  return cloneValue(ensureCache().epicArcMessageMaps);
}

function getMissionArcInfo(missionID) {
  const missionRecord = getMissionByID(missionID);
  if (!missionRecord) {
    return null;
  }
  return {
    epicArcID: missionRecord.epicArcID,
    sourceAgentID: missionRecord.sourceAgentID,
    nextMissionIDs: cloneValue(missionRecord.nextMissionIDs || []),
    nextAgentIDs: cloneValue(missionRecord.nextAgentIDs || []),
    targetAgentID: missionRecord.targetAgentID,
  };
}

module.exports = {
  buildAgentPreferenceKeys,
  clearCache,
  getEpicArcMessageMaps,
  getMissionArcInfo,
  getMissionByID,
  getPayload,
  getPreferredMissionID,
  isSupportedLevelOneClientDungeonID,
  listMissionIDsByTemplate,
  listMissionIDsForAgent,
  pickMissionForAgent,
};
