const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  listAgents,
  listMissionTemplateIDsForAgent,
} = require(path.join(__dirname, "./agentAuthority"));
const {
  isDisabledMissionIdentifier,
  isDisabledMissionSourceURL,
  isDisabledMissionTemplateIdentifier,
  isGeneratedMissionIdentifier,
  isRetiredMissionTemplateIdentifier,
  normalizeStableMissionIdentity,
  productionMissionPolicy,
} = require(path.join(__dirname, "../../config/productionMissionPolicy"));

let cache = null;
const EPIC_ARC_MESSAGE_TYPES = Object.freeze([
  "messages.epicMission.journalText.chapterTitle",
  "messages.epicMission.journalText.inProgressMessage",
  "messages.epicMission.journalText.completedMessage",
]);
const PERMANENTLY_DISABLED_MISSION_IDS = Object.freeze(
  productionMissionPolicy.disabledMissions.map(({ missionID }) => missionID),
);
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

function isPermanentlyDisabledMissionID(missionID) {
  return isDisabledMissionIdentifier(missionID);
}

function isPermanentlyDisabledMissionRecord(record = null, missionID = null) {
  if (
    isPermanentlyDisabledMissionID(missionID) ||
    isPermanentlyDisabledMissionID(record && record.missionID)
  ) {
    return true;
  }

  return [
    record && record.missionTemplateID,
    record && record.dungeonTemplateID,
    record && record.generatedFromTemplateID,
    record && record.sourceMissionID,
    record && record.adminMetadata && record.adminMetadata.sourceMissionID,
  ].some((templateID) => {
    const normalizedTemplateID = normalizeText(templateID, "").toLowerCase();
    return isDisabledMissionTemplateIdentifier(normalizedTemplateID) ||
      isDisabledMissionIdentifier(normalizedTemplateID);
  }) || [
    record && record.sourceUrl,
    record && record.sourceURL,
    record && record.adminMetadata && record.adminMetadata.sourceUrl,
    record && record.adminMetadata && record.adminMetadata.sourceURL,
  ].some(isDisabledMissionSourceURL);
}

function filterAvailableMissionIDs(values, availableMissionKeys) {
  return normalizeMissionIDList(values).filter((missionID) =>
    availableMissionKeys.has(String(missionID)));
}

function sanitizePayload(payload = {}) {
  const missionsByID = {};
  for (const [missionID, record] of Object.entries(payload.missionsByID || {})) {
    if (
      isPermanentlyDisabledMissionRecord(record, missionID) ||
      isGeneratedScrapedMissionRecord(record, missionID)
    ) {
      continue;
    }
    missionsByID[missionID] = record;
  }

  const availableMissionKeys = new Set(Object.keys(missionsByID));
  const indexes = {};
  for (const [indexName, rawIndex] of Object.entries(normalizeObject(payload.indexes))) {
    const index = normalizeObject(rawIndex);
    if (indexName === "preferredMissionIDs") {
      indexes[indexName] = Object.fromEntries(
        Object.entries(index).filter(([, missionID]) => {
          const normalizedMissionID = normalizeMissionID(missionID, null);
          return normalizedMissionID !== null &&
            availableMissionKeys.has(String(normalizedMissionID));
        }),
      );
      continue;
    }
    indexes[indexName] = Object.fromEntries(
      Object.entries(index).map(([key, missionIDs]) => [
        key,
        filterAvailableMissionIDs(missionIDs, availableMissionKeys),
      ]),
    );
  }

  const normalizedMissions = Object.entries(missionsByID).map(([missionID, record]) =>
    normalizeMissionRecord(record, normalizeMissionID(missionID, missionID)));
  const preferredMissionIDs = normalizeObject(indexes.preferredMissionIDs);

  return {
    ...payload,
    counts: {
      ...payload.counts,
      missionCount: normalizedMissions.length,
      missionKindCount: new Set(normalizedMissions.map((record) => record.missionKind)).size,
      missionFlavorCount: new Set(normalizedMissions.map((record) => record.missionFlavor)).size,
      missionTemplateCount: new Set(
        normalizedMissions.map((record) => record.contentTemplate).filter(Boolean),
      ).size,
      epicArcMissionCount: normalizedMissions.filter((record) => record.isEpicArc).length,
      preferredMissionCount: Object.keys(preferredMissionIDs).length,
      localizedMissionCount: normalizedMissions.filter((record) => record.localizedName).length,
      localizedMissionMessageCount: normalizedMissions.reduce(
        (count, record) => count + Object.keys(record.localizedMessages || {}).length,
        0,
      ),
      generatedEveSurvivalMissionCount: normalizedMissions.filter((record) =>
        record.generatedFromSource === "eve-survival-generated").length,
    },
    missionsByID,
    indexes,
  };
}

function isResearchAgentRecord(agentRecord = null) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "encounter")
    .toLowerCase();
  const missionTypeLabel = normalizeText(
    agentRecord && agentRecord.missionTypeLabel,
    "",
  ).toLowerCase();
  const agentTypeID = toInt(agentRecord && agentRecord.agentTypeID, 0);
  return (
    missionKind === "research" ||
    missionTypeLabel.includes("research") ||
    agentTypeID === 4
  );
}

function buildAgentPreferenceKeys(agentRecord = null) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "encounter")
    .toLowerCase();
  const importantMission = agentRecord && agentRecord.importantMission === true;

  if (isResearchAgentRecord(agentRecord)) {
    return [
      "researchTrade",
      "researchCourier",
      "basicTrade",
      "basicCourier",
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
  const payload = sanitizePayload(
    normalizePayload(readStaticTable(TABLE.MISSION_AUTHORITY)),
  );
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
    preferredCandidateIDsBySignature: new Map(),
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

function listDisabledMissionIDs() {
  return cloneValue(PERMANENTLY_DISABLED_MISSION_IDS);
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

// Ordinary Security agents are intentionally deny-by-default. A dungeon ID is not
// sufficient here: generated missions at other levels can reuse the same dungeon.
const GOLDEN_SECURITY_MISSIONS = productionMissionPolicy.goldenSecurityMissions;
const GOLDEN_SECURITY_MISSION_BY_ID = new Map(
  GOLDEN_SECURITY_MISSIONS.map((mission) => [String(mission.missionID), mission]),
);
const SUPPORTED_LEVEL_ONE_MINING_DUNGEON_IDS = new Set([2449, 2450, 2451, 2454, 2456]);
const SUPPORTED_GOLDEN_SECURITY_DUNGEON_IDS = new Set(
  GOLDEN_SECURITY_MISSIONS.map(({ dungeonID }) => dungeonID),
);
const SUPPORTED_CLIENT_DUNGEON_IDS = new Set([
  ...SUPPORTED_LEVEL_ONE_MINING_DUNGEON_IDS,
  ...SUPPORTED_GOLDEN_SECURITY_DUNGEON_IDS,
]);

function isSupportedLevelOneClientDungeonID(dungeonID) {
  return SUPPORTED_CLIENT_DUNGEON_IDS.has(toInt(dungeonID, 0));
}

function isGeneratedScrapedMissionRecord(record, fallbackMissionID = null) {
  const missionIdentifiers = [
    record && record.missionID,
    fallbackMissionID,
    record && record.missionTemplateID,
    record && record.dungeonTemplateID,
    record && record.generatedFromTemplateID,
  ];
  return missionIdentifiers.some(isGeneratedMissionIdentifier) ||
    normalizeText(record && record.generatedFromSource, "").toLowerCase() === "eve-survival-generated" ||
    [
      record && record.generatedFromTemplateID,
      record && record.missionTemplateID,
      record && record.dungeonTemplateID,
    ].some(isRetiredMissionTemplateIdentifier);
}

function isScriptedStorylineMissionRecord(record = null) {
  return Boolean(
    record && (record.isStoryline === true || record.isGenericStoryline === true),
  );
}

function hasAgentSpecificMissionIDs(agentRecord = null) {
  const agentID = toInt(agentRecord && agentRecord.agentID, 0);
  const missionIDs = agentID > 0
    ? ensureCache().agentIDToMissionIDs.get(String(agentID))
    : null;
  return Array.isArray(missionIDs) && missionIDs.length > 0;
}

function isAgentSpecificMissionIDForAgent(agentID, missionID) {
  const normalizedAgentID = toInt(agentID, 0);
  const normalizedMissionID = normalizeStableMissionIdentity(missionID);
  const missionIDs = normalizedAgentID > 0
    ? ensureCache().agentIDToMissionIDs.get(String(normalizedAgentID))
    : null;
  return Boolean(
    normalizedMissionID &&
      Array.isArray(missionIDs) &&
      missionIDs.some((candidateMissionID) => String(candidateMissionID) === normalizedMissionID),
  );
}

function isScriptedMissionRecord(record = null) {
  return Boolean(
    record && (
      record.isEpicArc === true ||
      record.isHeraldry === true ||
      record.isResearch === true ||
      record.isStoryline === true ||
      record.isGenericStoryline === true ||
      record.isAgentInteraction === true ||
      record.isTalkToAgent === true
    ),
  );
}

function isExplicitStorylineAgent(agentRecord = null) {
  return Boolean(
    agentRecord && agentRecord.importantMission === true ||
      normalizeText(agentRecord && agentRecord.missionTypeLabel, "")
        .toLowerCase()
        .includes("storyline"),
  );
}

function isOrdinarySecurityAgent(agentRecord = null) {
  return normalizeText(agentRecord && agentRecord.missionKind, "").toLowerCase() === "encounter" &&
    !isExplicitStorylineAgent(agentRecord) &&
    !hasAgentSpecificMissionIDs(agentRecord);
}

function isGoldenSecurityMissionRecord(record = null, agentLevel = 0) {
  const missionID = normalizeMissionID(record && record.missionID, null);
  if (missionID === null) {
    return false;
  }
  const goldenMission = GOLDEN_SECURITY_MISSION_BY_ID.get(String(missionID));
  const actualDungeonID = toInt(
    record && record.killMission && record.killMission.dungeonID,
    0,
  );
  return Boolean(
    goldenMission &&
      goldenMission.agentLevel === toInt(agentLevel, 0) &&
      actualDungeonID === goldenMission.dungeonID,
  );
}

function isExactConfiguredGoldenMissionRecord(record = null, runtimeRecord = null) {
  const missionID = normalizeMissionID(record && record.missionID, null);
  const goldenMission = missionID === null
    ? null
    : GOLDEN_SECURITY_MISSION_BY_ID.get(String(missionID));
  const canonicalDungeonID = toInt(
    record && record.killMission && record.killMission.dungeonID,
    0,
  );
  if (!goldenMission || canonicalDungeonID !== goldenMission.dungeonID) {
    return false;
  }
  if (!runtimeRecord || typeof runtimeRecord !== "object") {
    return true;
  }
  const runtimeDungeonID = toInt(runtimeRecord.dungeonID, 0);
  if (runtimeDungeonID > 0 && runtimeDungeonID !== goldenMission.dungeonID) {
    return false;
  }
  const runtimeDungeonTemplateID = normalizeText(runtimeRecord.dungeonTemplateID, "");
  if (
    runtimeDungeonTemplateID &&
    runtimeDungeonTemplateID.toLowerCase() !== goldenMission.templateID.toLowerCase()
  ) {
    return false;
  }
  const presentationTemplateID = normalizeText(runtimeRecord.missionTemplateID, "");
  if (
    presentationTemplateID.toLowerCase().startsWith("client-dungeon:") &&
    presentationTemplateID.toLowerCase() !== goldenMission.templateID.toLowerCase()
  ) {
    return false;
  }
  return true;
}

function isRetiredOrdinaryEncounterMissionForAgent(
  agentID,
  missionIdentifier,
  runtimeRecord = null,
) {
  const normalizedMissionID = normalizeStableMissionIdentity(missionIdentifier);
  if (!normalizedMissionID) {
    return false;
  }
  const missionRecord = getMissionByID(normalizedMissionID);
  if (
    !missionRecord ||
    normalizeText(missionRecord.missionKind, "").toLowerCase() !== "encounter"
  ) {
    return false;
  }
  if (isExactConfiguredGoldenMissionRecord(missionRecord, runtimeRecord)) {
    return false;
  }
  if (
    isScriptedMissionRecord(missionRecord) ||
    isAgentSpecificMissionIDForAgent(agentID, normalizedMissionID)
  ) {
    return false;
  }
  return true;
}

function isMissionOfferAllowedForAgent(agentRecord = null, missionRecord = null) {
  if (!missionRecord || isPermanentlyDisabledMissionRecord(missionRecord)) {
    return false;
  }
  if (
    isOrdinarySecurityAgent(agentRecord) &&
    !isGoldenSecurityMissionRecord(
      missionRecord,
      toInt(agentRecord && agentRecord.level, 0),
    )
  ) {
    return false;
  }
  const missionKey = String(normalizeMissionID(missionRecord.missionID, null));
  return listMissionIDsForAgent(agentRecord).some((missionID) =>
    String(missionID) === missionKey);
}

function listGoldenSecurityMissionIDsForAgent(agentRecord = null) {
  const agentLevel = toInt(agentRecord && agentRecord.level, 0);
  return GOLDEN_SECURITY_MISSIONS
    .filter((mission) => mission.agentLevel === agentLevel)
    .map((mission) => mission.missionID)
    .filter((missionID) => isGoldenSecurityMissionRecord(
      getMissionByID(missionID),
      agentLevel,
    ));
}

function supportedDungeonIDsForAgent(agentRecord) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "").toLowerCase();
  if (missionKind === "mining") {
    return SUPPORTED_LEVEL_ONE_MINING_DUNGEON_IDS;
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
    const dungeonID = toInt(record && record.killMission && record.killMission.dungeonID, 0);
    return supportedDungeonIDs.has(dungeonID);
  });
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
  const preferenceKeys = buildAgentPreferenceKeys(agentRecord);
  const preferenceSignature = preferenceKeys.join("\u0000");
  const authorityCache = ensureCache();
  const cachedMissionIDs = authorityCache.preferredCandidateIDsBySignature.get(
    preferenceSignature,
  );
  if (cachedMissionIDs) {
    return cloneValue(cachedMissionIDs);
  }
  const candidateMissionIDs = [];
  const seen = new Set();
  for (const preferenceKey of preferenceKeys) {
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
  authorityCache.preferredCandidateIDsBySignature.set(
    preferenceSignature,
    cloneValue(candidateMissionIDs),
  );
  return candidateMissionIDs;
}

function listMissionIDsForAgent(agentRecord = null) {
  const normalizedAgentID = toInt(agentRecord && agentRecord.agentID, 0);
  const agentSpecificMissionIDs = ensureCache().agentIDToMissionIDs.get(String(normalizedAgentID));
  if (agentSpecificMissionIDs && agentSpecificMissionIDs.length > 0) {
    return cloneValue(agentSpecificMissionIDs);
  }

  if (isOrdinarySecurityAgent(agentRecord)) {
    return listGoldenSecurityMissionIDsForAgent(agentRecord);
  }

  const templateBoundMissionIDs = listTemplateBoundMissionIDsForAgent(agentRecord);
  const preferredMissionIDs = listPreferredMissionCandidateIDs(agentRecord);
  if (isResearchAgentRecord(agentRecord)) {
    return uniqueMissionIDs(preferredMissionIDs).filter((missionID) => {
      const missionRecord = getMissionByID(missionID);
      return missionRecord &&
        normalizeText(missionRecord.missionKind, "").toLowerCase() !== "encounter";
    });
  }
  if (isExplicitStorylineAgent(agentRecord)) {
    const storylineCandidateIDs = uniqueMissionIDs([
      ...templateBoundMissionIDs,
      ...preferredMissionIDs,
    ]);
    const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "").toLowerCase();
    return missionKind === "encounter"
      ? storylineCandidateIDs.filter((missionID) =>
        isScriptedStorylineMissionRecord(getMissionByID(missionID)))
      : storylineCandidateIDs;
  }
  if (templateBoundMissionIDs.length > 0) {
    return filterUnsupportedLevelOneAgentMissions(
      agentRecord,
      uniqueMissionIDs([...templateBoundMissionIDs, ...preferredMissionIDs]),
    );
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
  getAgentIDToMissionIDs,
  getEpicArcMessageMaps,
  getMissionArcInfo,
  getMissionByID,
  getPayload,
  getPreferredMissionID,
  isAgentSpecificMissionIDForAgent,
  isExactConfiguredGoldenMissionRecord,
  isGeneratedScrapedMissionRecord,
  isMissionOfferAllowedForAgent,
  isOrdinarySecurityAgent,
  isPermanentlyDisabledMissionID,
  isPermanentlyDisabledMissionRecord,
  isResearchAgentRecord,
  isRetiredOrdinaryEncounterMissionForAgent,
  isScriptedMissionRecord,
  isSupportedLevelOneClientDungeonID,
  listDisabledMissionIDs,
  listMissionIDsByTemplate,
  listMissionIDsForAgent,
  pickMissionForAgent,
};

function getAgentIDToMissionIDs(agentID) {
  const cache = ensureCache();
  const specific = cache.agentIDToMissionIDs.get(String(agentID));
  return specific && specific.length > 0 ? cloneValue(specific) : [];
}
