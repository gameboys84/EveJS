const path = require("path");

// Phase 0 / 0.C: agent/mission state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const {
  isRetiredMissionTemplateIdentifier,
} = require(path.join(__dirname, "../../config/productionMissionPolicy"));
const {
  isRetiredOrdinaryEncounterMissionForAgent,
} = require(path.join(__dirname, "./missionAuthority"));
const repo = createTableRepository("service:agent", { strict: true });

const MISSION_RUNTIME_TABLE = "missionRuntimeState";
const REPLAY_DELAY_MS = 4 * 60 * 60 * 1000;
const OFFER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const EPIC_ARC_REPLAY_DELAY_MS = 90 * 24 * 60 * 60 * 1000;
const BASIC_AGENT_TYPE_ID = 2;
const STORYLINE_THRESHOLD = 16;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  const normalized = Math.trunc(numericValue);
  return normalized > 0 ? normalized : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text.length > 0 ? text : fallback;
}

function normalizeMissionContentID(value, fallback = null) {
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

function isRetiredMissionIdentifier(value) {
  return isRetiredMissionTemplateIdentifier(value);
}

function isRetiredMissionRuntimeRecord(record = null) {
  if (!record || typeof record !== "object") {
    return false;
  }
  return [
    record.contentID,
    record.clientMissionID,
    record.missionID,
    record.missionTemplateID,
    record.dungeonTemplateID,
    record.generatedFromTemplateID,
    record.completedMissionID,
    record.lastContentID,
    record.lastMissionTemplateID,
  ].some(isRetiredMissionIdentifier);
}

function isRetiredActiveMissionRuntimeRecord(record = null, fallbackAgentID = 0) {
  if (isRetiredMissionRuntimeRecord(record)) {
    return true;
  }
  if (!record || typeof record !== "object") {
    return false;
  }
  const missionIdentifier = record.contentID ??
    record.clientMissionID ??
    record.missionID ??
    record.missionTemplateID;
  const agentID = toPositiveInteger(
    record.agentID,
    toPositiveInteger(fallbackAgentID, 0),
  );
  return isRetiredOrdinaryEncounterMissionForAgent(
    agentID,
    missionIdentifier,
    record,
  );
}

function cleanupRetiredMissionBookmarks(characterID, bookmarkIDs) {
  if (!(bookmarkIDs instanceof Set) || bookmarkIDs.size <= 0) {
    return;
  }
  const bookmarkRuntime = require(path.join(
    __dirname,
    "../bookmark/bookmarkRuntimeState",
  ));
  for (const bookmarkID of bookmarkIDs) {
    const bookmarkInfo = bookmarkRuntime.getBookmarkForCharacter(characterID, bookmarkID);
    if (!bookmarkInfo || !bookmarkInfo.folder) {
      continue;
    }
    try {
      bookmarkRuntime.deleteBookmarks(
        characterID,
        bookmarkInfo.folder.folderID,
        [bookmarkID],
      );
    } catch (_error) {
      // State migration must remain idempotent when a stale bookmark is already gone.
    }
  }
}

function normalizeOptionalInteger(value, fallback = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function currentFileTimeString() {
  return (BigInt(Date.now()) * 10000n + 116444736000000000n).toString();
}

function futureFileTimeString(deltaMs = 0) {
  const safeDeltaMs = Math.max(0, Number(deltaMs) || 0);
  return (
    BigInt(Date.now() + safeDeltaMs) * 10000n + 116444736000000000n
  ).toString();
}

function normalizeMissionStandingEvent(record, fallback = {}) {
  const source =
    record && typeof record === "object"
      ? record
      : {};
  return {
    corporation: toFiniteNumber(source.corporation, toFiniteNumber(fallback.corporation, 0)),
    faction: toFiniteNumber(source.faction, toFiniteNumber(fallback.faction, 0)),
    agent: toFiniteNumber(source.agent, toFiniteNumber(fallback.agent, 0)),
    eventTypeID: normalizeOptionalInteger(
      source.eventTypeID,
      normalizeOptionalInteger(fallback.eventTypeID, null),
    ),
    applySocial:
      Object.prototype.hasOwnProperty.call(source, "applySocial")
        ? toBoolean(source.applySocial, false)
        : toBoolean(fallback.applySocial, false),
    msg: normalizeText(source.msg, normalizeText(fallback.msg, "")),
    messageHeader: normalizeText(
      source.messageHeader,
      normalizeText(fallback.messageHeader, ""),
    ),
    messageBody: normalizeText(
      source.messageBody,
      normalizeText(fallback.messageBody, ""),
    ),
    int_1:
      Object.prototype.hasOwnProperty.call(source, "int_1")
        ? normalizeOptionalInteger(source.int_1, null)
        : normalizeOptionalInteger(fallback.int_1, null),
    int_2:
      Object.prototype.hasOwnProperty.call(source, "int_2")
        ? normalizeOptionalInteger(source.int_2, null)
        : normalizeOptionalInteger(fallback.int_2, null),
    int_3:
      Object.prototype.hasOwnProperty.call(source, "int_3")
        ? normalizeOptionalInteger(source.int_3, null)
        : normalizeOptionalInteger(fallback.int_3, null),
  };
}

function normalizeMissionRewards(record) {
  const source =
    record && typeof record === "object"
      ? record
      : {};
  const normalizeRewardItemList = (value) => (
    Array.isArray(value)
      ? value
        .map((entry) => (
          entry && typeof entry === "object"
            ? {
                typeID: toPositiveInteger(entry.typeID, 0),
                quantity: Math.max(0, Math.trunc(toFiniteNumber(entry.quantity, 0))),
                extra: entry.extra === undefined ? null : cloneValue(entry.extra),
              }
            : null
        ))
        .filter((entry) => entry && entry.typeID > 0 && entry.quantity > 0)
      : []
  );
  const rawStandings =
    source.rawStandings && typeof source.rawStandings === "object"
      ? {
          corporation: toFiniteNumber(source.rawStandings.corporation, 0),
          faction: toFiniteNumber(source.rawStandings.faction, 0),
          agent: toFiniteNumber(source.rawStandings.agent, 0),
        }
      : {
          corporation: 0,
          faction: 0,
          agent: 0,
        };
  const standingEvents =
    source.standingEvents && typeof source.standingEvents === "object"
      ? source.standingEvents
      : {};

  return {
    isk: Math.max(0, Math.round(toFiniteNumber(source.isk, 0))),
    bonusIsk: Math.max(0, Math.round(toFiniteNumber(source.bonusIsk, 0))),
    itemRewards: normalizeRewardItemList(source.itemRewards),
    bonusItemRewards: normalizeRewardItemList(source.bonusItemRewards),
    bonusTimeIntervalMinutes: Math.max(
      0,
      Math.round(toFiniteNumber(source.bonusTimeIntervalMinutes, 0)),
    ),
    loyaltyPoints: Math.max(0, Math.round(toFiniteNumber(source.loyaltyPoints, 0))),
    researchPoints: Math.max(0, Math.round(toFiniteNumber(source.researchPoints, 0))),
    rawStandings,
    standingEvents: {
      completed: normalizeMissionStandingEvent(standingEvents.completed, rawStandings),
      declined: normalizeMissionStandingEvent(
        standingEvents.declined || source.declinedRawStandings,
        {},
      ),
      failed: normalizeMissionStandingEvent(
        standingEvents.failed || source.failedRawStandings,
        {},
      ),
      offerExpired: normalizeMissionStandingEvent(
        standingEvents.offerExpired || source.offerExpiredRawStandings,
        {},
      ),
      bonus: normalizeMissionStandingEvent(
        standingEvents.bonus || source.bonusRawStandings,
        {},
      ),
    },
  };
}

function createDefaultState() {
  return {
    version: 1,
    nextMissionSequence: 1,
    charactersByID: {},
  };
}

function createDefaultCharacterState(characterID) {
  return {
    characterID: toPositiveInteger(characterID, 0),
    lastUpdatedAtMs: Date.now(),
    missionSelectionCursorByAgentID: {},
    missionsByAgentID: {},
    declineTimersByAgentID: {},
    completedCareerAgentIDs: {},
    epicArcProgress: createDefaultEpicArcProgress(),
    storylineProgress: createDefaultStorylineProgress(),
    history: [],
  };
}

function createDefaultEpicArcProgress() {
  return {
    version: 1,
    missionStatusByArcID: {},
    completedArcsByID: {},
  };
}

function createDefaultStorylineProgress() {
  return {
    version: 1,
    countersByFactionAndLevel: {},
    issuedMilestonesByCounterKey: {},
    pendingOffersByAgentID: {},
    declinedOffersByAgentID: {},
    expiredOffersByAgentID: {},
  };
}

function normalizeMissionRecord(record, agentID, fallbackMissionSequence) {
  if (
    !record ||
    typeof record !== "object" ||
    isRetiredActiveMissionRuntimeRecord(record, agentID)
  ) {
    return null;
  }

  const normalizedAgentID = toPositiveInteger(
    record.agentID ?? agentID,
    toPositiveInteger(agentID, 0),
  );
  if (!normalizedAgentID) {
    return null;
  }

  const missionSequence = toPositiveInteger(
    record.missionSequence,
    toPositiveInteger(fallbackMissionSequence, 0),
  );
  const contentID = normalizeMissionContentID(
    record.contentID ?? record.clientMissionID ?? record.missionTemplateID,
    null,
  );
  const missionTemplateID = normalizeText(
    record.missionTemplateID ||
      (typeof record.contentID === "string" ? record.contentID : ""),
    "",
  );
  if (!missionSequence || contentID === null || !missionTemplateID) {
    return null;
  }

  return {
    missionSequence,
    agentID: normalizedAgentID,
    contentID,
    missionTemplateID,
    missionContentTemplateID: normalizeText(record.missionContentTemplateID, ""),
    missionNameID: toPositiveInteger(record.missionNameID, 0),
    missionPoolKey: normalizeText(record.missionPoolKey, ""),
    missionKind: normalizeText(record.missionKind, "encounter"),
    missionTypeLabel: normalizeText(
      record.missionTypeLabel,
      "UI/Agents/MissionTypes/Encounter",
    ),
    missionTitle: normalizeText(record.missionTitle, String(contentID)),
    importantMission: toBoolean(record.importantMission, false),
    runtimeStatus: normalizeText(record.runtimeStatus, "offered"),
    placeholder: toBoolean(record.placeholder, true),
    objectiveMode: normalizeText(record.objectiveMode, "dungeon"),
    objectiveCompleted: toBoolean(record.objectiveCompleted, false),
    gmCompleted: toBoolean(record.gmCompleted, false),
    offeredAtFileTime: normalizeText(
      record.offeredAtFileTime,
      currentFileTimeString(),
    ),
    acceptedAtFileTime: record.acceptedAtFileTime
      ? normalizeText(record.acceptedAtFileTime, currentFileTimeString())
      : null,
    expiresAtFileTime: normalizeText(
      record.expiresAtFileTime,
      futureFileTimeString(OFFER_EXPIRY_MS),
    ),
    lastUpdatedAtMs: toFiniteNumber(record.lastUpdatedAtMs, Date.now()),
    dungeonTemplateID: normalizeText(record.dungeonTemplateID, ""),
    dungeonID: toPositiveInteger(record.dungeonID, 0) || null,
    dungeonInstanceID: toPositiveInteger(record.dungeonInstanceID, 0) || null,
    missionSiteID: toPositiveInteger(record.missionSiteID, 0) || null,
    missionSystemID: toPositiveInteger(record.missionSystemID, 0) || null,
    missionPosition:
      record.missionPosition && typeof record.missionPosition === "object"
        ? {
            x: toFiniteNumber(record.missionPosition.x, 0),
            y: toFiniteNumber(record.missionPosition.y, 0),
            z: toFiniteNumber(record.missionPosition.z, 0),
          }
        : null,
    bookmarkIDsByRole:
      record.bookmarkIDsByRole && typeof record.bookmarkIDsByRole === "object"
        ? Object.fromEntries(
            Object.entries(record.bookmarkIDsByRole)
              .map(([role, bookmarkID]) => [
                normalizeText(role, ""),
                toPositiveInteger(bookmarkID, 0) || null,
              ])
              .filter(([role, bookmarkID]) => role && bookmarkID),
          )
        : {},
    cargo:
      record.cargo && typeof record.cargo === "object"
        ? {
            typeID: toPositiveInteger(record.cargo.typeID, 0),
            quantity: Math.max(0, Math.trunc(toFiniteNumber(record.cargo.quantity, 0))),
            volume: Math.max(0, toFiniteNumber(record.cargo.volume, 0)),
            hasCargo: toBoolean(record.cargo.hasCargo, false),
            granted: toBoolean(record.cargo.granted, false),
          }
        : null,
    pickupLocation:
      record.pickupLocation && typeof record.pickupLocation === "object"
        ? cloneValue(record.pickupLocation)
        : null,
    dropoffLocation:
      record.dropoffLocation && typeof record.dropoffLocation === "object"
        ? cloneValue(record.dropoffLocation)
        : null,
    rewards: normalizeMissionRewards(record.rewards),
  };
}

function normalizeHistoryEntry(entry) {
  if (
    !entry ||
    typeof entry !== "object" ||
    isRetiredMissionRuntimeRecord(entry)
  ) {
    return null;
  }

  const agentID = toPositiveInteger(entry.agentID, 0);
  const missionSequence = toPositiveInteger(entry.missionSequence, 0);
  const contentID = normalizeMissionContentID(
    entry.contentID ?? entry.clientMissionID ?? entry.missionTemplateID,
    null,
  );
  const missionTemplateID = normalizeText(
    entry.missionTemplateID ||
      (typeof entry.contentID === "string" ? entry.contentID : ""),
    "",
  );
  if (!agentID || !missionSequence || contentID === null || !missionTemplateID) {
    return null;
  }

  return {
    missionSequence,
    agentID,
    contentID,
    missionTemplateID,
    runtimeStatus: normalizeText(entry.runtimeStatus, "completed"),
    completedAtFileTime: normalizeText(
      entry.completedAtFileTime,
      currentFileTimeString(),
    ),
    lastUpdatedAtMs: toFiniteNumber(entry.lastUpdatedAtMs, Date.now()),
  };
}

function normalizeEpicArcStatusRecord(record, fallbackMissionID = 0) {
  const source = record && typeof record === "object" ? record : {};
  const missionID = normalizeMissionContentID(
    source.missionID ?? source.contentID ?? fallbackMissionID,
    null,
  );
  if (
    missionID === null ||
    isRetiredMissionIdentifier(missionID) ||
    isRetiredActiveMissionRuntimeRecord({ ...source, missionID }, source.agentID)
  ) {
    return null;
  }

  return {
    missionID,
    acceptedDate: normalizeText(
      source.acceptedDate ?? source.acceptedAtFileTime,
      "",
    ),
    completedDate: normalizeText(
      source.completedDate ?? source.completedAtFileTime,
      "",
    ),
    quitDate: normalizeText(
      source.quitDate ?? source.declinedAtFileTime ?? source.quitAtFileTime,
      "",
    ),
    nameID: toPositiveInteger(source.nameID ?? source.missionNameID, 0) || null,
    agentID: toPositiveInteger(source.agentID, 0) || null,
    missionSequence: toPositiveInteger(source.missionSequence, 0) || null,
    missionTemplateID: normalizeText(source.missionTemplateID, ""),
    lastUpdatedAtMs: toFiniteNumber(source.lastUpdatedAtMs, 0) || null,
  };
}

function normalizeEpicArcCompletionRecord(record, fallbackArcID = 0) {
  const source = record && typeof record === "object" ? record : {};
  const epicArcID = toPositiveInteger(
    source.epicArcID ?? source.arcID ?? fallbackArcID,
    0,
  );
  if (!epicArcID || isRetiredMissionRuntimeRecord(source)) {
    return null;
  }

  return {
    epicArcID,
    completedMissionID: normalizeMissionContentID(source.completedMissionID, null),
    completedAtFileTime: normalizeText(source.completedAtFileTime, ""),
    replayUntilFileTime: normalizeText(source.replayUntilFileTime, ""),
    agentID: toPositiveInteger(source.agentID, 0) || null,
    missionSequence: toPositiveInteger(source.missionSequence, 0) || null,
    missionTemplateID: normalizeText(source.missionTemplateID, ""),
    lastUpdatedAtMs: toFiniteNumber(source.lastUpdatedAtMs, 0) || null,
  };
}

function normalizeEpicArcStatusMap(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [arcKey, missionMap] of Object.entries(source)) {
    const epicArcID = toPositiveInteger(arcKey, 0);
    if (!epicArcID || !missionMap || typeof missionMap !== "object") {
      continue;
    }
    const normalizedMissionMap = {};
    for (const [missionKey, statusRecord] of Object.entries(missionMap)) {
      const normalizedStatus = normalizeEpicArcStatusRecord(statusRecord, missionKey);
      if (!normalizedStatus) {
        continue;
      }
      normalizedMissionMap[String(normalizedStatus.missionID)] = normalizedStatus;
    }
    if (Object.keys(normalizedMissionMap).length > 0) {
      result[String(epicArcID)] = normalizedMissionMap;
    }
  }
  return result;
}

function normalizeEpicArcCompletionMap(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [arcKey, completionRecord] of Object.entries(source)) {
    const normalizedCompletion = normalizeEpicArcCompletionRecord(
      completionRecord,
      arcKey,
    );
    if (!normalizedCompletion) {
      continue;
    }
    result[String(normalizedCompletion.epicArcID)] = normalizedCompletion;
  }
  return result;
}

function normalizeEpicArcProgress(progress) {
  const source =
    progress && typeof progress === "object" && !Array.isArray(progress)
      ? progress
      : {};
  const normalized = createDefaultEpicArcProgress();
  normalized.version = toPositiveInteger(source.version, 0) || 1;
  normalized.missionStatusByArcID = normalizeEpicArcStatusMap(
    source.missionStatusByArcID,
  );
  normalized.completedArcsByID = normalizeEpicArcCompletionMap(
    source.completedArcsByID,
  );
  return normalized;
}

function ensureEpicArcProgress(characterState) {
  if (!characterState || typeof characterState !== "object") {
    return null;
  }
  characterState.epicArcProgress = normalizeEpicArcProgress(
    characterState.epicArcProgress,
  );
  return characterState.epicArcProgress;
}

function getStorylineCounterKey(factionID, missionLevel) {
  const normalizedFactionID = toPositiveInteger(factionID, 0);
  const normalizedMissionLevel = toPositiveInteger(missionLevel, 0);
  return normalizedFactionID && normalizedMissionLevel
    ? `${normalizedFactionID}:${normalizedMissionLevel}`
    : "";
}

function normalizeStorylineCounter(record, fallbackKey = "") {
  const source = record && typeof record === "object" ? record : {};
  const [fallbackFactionID, fallbackMissionLevel] = String(fallbackKey || "")
    .split(":")
    .map((entry) => toPositiveInteger(entry, 0));
  const factionID = toPositiveInteger(source.factionID, fallbackFactionID || 0);
  const missionLevel = toPositiveInteger(
    source.missionLevel ?? source.level,
    fallbackMissionLevel || 0,
  );
  const counterKey = getStorylineCounterKey(factionID, missionLevel);
  if (!counterKey) {
    return null;
  }

  const hasRetiredLastMission = isRetiredMissionIdentifier(source.lastContentID) ||
    isRetiredMissionIdentifier(source.lastMissionTemplateID);
  return {
    factionID,
    missionLevel,
    completedCount: Math.max(0, toPositiveInteger(source.completedCount, 0)),
    lastMissionSequence: toPositiveInteger(source.lastMissionSequence, 0) || null,
    lastAgentID: toPositiveInteger(source.lastAgentID, 0) || null,
    lastSolarSystemID: toPositiveInteger(source.lastSolarSystemID, 0) || null,
    lastContentID: hasRetiredLastMission
      ? null
      : normalizeMissionContentID(source.lastContentID, null),
    lastMissionTemplateID: hasRetiredLastMission
      ? ""
      : normalizeText(source.lastMissionTemplateID, ""),
    lastCompletedAtFileTime: normalizeText(source.lastCompletedAtFileTime, ""),
    lastUpdatedAtMs: toFiniteNumber(source.lastUpdatedAtMs, 0) || null,
  };
}

function normalizeStorylineOfferRecord(record, fallbackAgentID = 0) {
  const source = record && typeof record === "object" ? record : {};
  if (isRetiredMissionRuntimeRecord(source)) {
    return null;
  }
  const agentID = toPositiveInteger(source.agentID, toPositiveInteger(fallbackAgentID, 0));
  if (!agentID) {
    return null;
  }
  return {
    agentID,
    counterKey: normalizeText(source.counterKey, ""),
    factionID: toPositiveInteger(source.factionID, 0) || null,
    missionLevel: toPositiveInteger(source.missionLevel ?? source.level, 0) || null,
    missionSequence: toPositiveInteger(source.missionSequence, 0) || null,
    issuedCompletedCount: Math.max(0, toPositiveInteger(source.issuedCompletedCount, 0)),
    contentID: normalizeMissionContentID(source.contentID, null),
    missionTemplateID: normalizeText(source.missionTemplateID, ""),
    status: normalizeText(source.status, "pending"),
    offeredAtFileTime: normalizeText(source.offeredAtFileTime, ""),
    expiresAtFileTime: normalizeText(source.expiresAtFileTime, ""),
    declinedAtFileTime: normalizeText(source.declinedAtFileTime, ""),
    expiredAtFileTime: normalizeText(source.expiredAtFileTime, ""),
    closedAtFileTime: normalizeText(source.closedAtFileTime, ""),
    lastUpdatedAtMs: toFiniteNumber(source.lastUpdatedAtMs, 0) || null,
  };
}

function normalizeStorylineOfferMap(value, options = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [agentKey, record] of Object.entries(source)) {
    if (
      options.excludeRetiredActive === true &&
      isRetiredActiveMissionRuntimeRecord(record, agentKey)
    ) {
      continue;
    }
    if (options.excludeRetired === true && isRetiredMissionRuntimeRecord(record)) {
      continue;
    }
    const normalizedOffer = normalizeStorylineOfferRecord(record, agentKey);
    if (!normalizedOffer) {
      continue;
    }
    result[String(normalizedOffer.agentID)] = normalizedOffer;
  }
  return result;
}

function normalizeStorylineMilestoneMap(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [counterKey, record] of Object.entries(source)) {
    const normalizedCounterKey = normalizeText(counterKey, "");
    if (!normalizedCounterKey) {
      continue;
    }
    if (isRetiredMissionRuntimeRecord(record)) {
      continue;
    }
    if (record && typeof record === "object" && !Array.isArray(record)) {
      result[normalizedCounterKey] = {
        counterKey: normalizedCounterKey,
        issuedCompletedCount: Math.max(
          0,
          toPositiveInteger(record.issuedCompletedCount, 0),
        ),
        issuedAtFileTime: normalizeText(record.issuedAtFileTime, ""),
        agentID: toPositiveInteger(record.agentID, 0) || null,
        missionSequence: toPositiveInteger(record.missionSequence, 0) || null,
        contentID: normalizeMissionContentID(record.contentID, null),
        missionTemplateID: normalizeText(record.missionTemplateID, ""),
        lastUpdatedAtMs: toFiniteNumber(record.lastUpdatedAtMs, 0) || null,
      };
      continue;
    }
    const issuedCompletedCount = Math.max(0, toPositiveInteger(record, 0));
    if (issuedCompletedCount > 0) {
      result[normalizedCounterKey] = {
        counterKey: normalizedCounterKey,
        issuedCompletedCount,
        issuedAtFileTime: "",
        agentID: null,
        missionSequence: null,
        contentID: null,
        missionTemplateID: "",
        lastUpdatedAtMs: null,
      };
    }
  }
  return result;
}

function normalizeStorylineProgress(progress) {
  const source =
    progress && typeof progress === "object" && !Array.isArray(progress)
      ? progress
      : {};
  const normalized = createDefaultStorylineProgress();
  normalized.version = toPositiveInteger(source.version, 0) || 1;

  const counters =
    source.countersByFactionAndLevel &&
    typeof source.countersByFactionAndLevel === "object" &&
    !Array.isArray(source.countersByFactionAndLevel)
      ? source.countersByFactionAndLevel
      : {};
  for (const [counterKey, counter] of Object.entries(counters)) {
    const normalizedCounter = normalizeStorylineCounter(counter, counterKey);
    if (!normalizedCounter) {
      continue;
    }
    normalized.countersByFactionAndLevel[
      getStorylineCounterKey(normalizedCounter.factionID, normalizedCounter.missionLevel)
    ] = normalizedCounter;
  }

  normalized.issuedMilestonesByCounterKey = normalizeStorylineMilestoneMap(
    source.issuedMilestonesByCounterKey,
  );
  normalized.pendingOffersByAgentID = normalizeStorylineOfferMap(
    source.pendingOffersByAgentID,
    { excludeRetiredActive: true },
  );
  normalized.declinedOffersByAgentID = normalizeStorylineOfferMap(
    source.declinedOffersByAgentID,
    { excludeRetired: true },
  );
  normalized.expiredOffersByAgentID = normalizeStorylineOfferMap(
    source.expiredOffersByAgentID,
    { excludeRetired: true },
  );
  return normalized;
}

function ensureStorylineProgress(characterState) {
  if (!characterState || typeof characterState !== "object") {
    return null;
  }
  characterState.storylineProgress = normalizeStorylineProgress(
    characterState.storylineProgress,
  );
  return characterState.storylineProgress;
}

function isStorylineQualifyingNormalMission(agentRecord, missionRecord) {
  if (!agentRecord || !missionRecord) {
    return false;
  }
  return (
    toPositiveInteger(agentRecord.agentTypeID, 0) === BASIC_AGENT_TYPE_ID &&
    agentRecord.importantMission !== true &&
    missionRecord.importantMission !== true &&
    toPositiveInteger(agentRecord.factionID, 0) > 0 &&
    toPositiveInteger(agentRecord.level, 0) > 0
  );
}

function recordStorylineQualifyingCompletion(
  characterState,
  agentRecord,
  missionRecord,
  options = {},
) {
  if (!isStorylineQualifyingNormalMission(agentRecord, missionRecord)) {
    return {
      recorded: false,
      reason: "not-qualifying-normal-mission",
    };
  }

  const factionID = toPositiveInteger(agentRecord.factionID, 0);
  const missionLevel = toPositiveInteger(agentRecord.level, 0);
  const counterKey = getStorylineCounterKey(factionID, missionLevel);
  const storylineProgress = ensureStorylineProgress(characterState);
  if (!storylineProgress || !counterKey) {
    return {
      recorded: false,
      reason: "invalid-counter-key",
    };
  }

  const previousCounter = normalizeStorylineCounter(
    storylineProgress.countersByFactionAndLevel[counterKey],
    counterKey,
  ) || {
    factionID,
    missionLevel,
    completedCount: 0,
    lastMissionSequence: null,
    lastAgentID: null,
    lastSolarSystemID: null,
    lastContentID: null,
    lastMissionTemplateID: "",
    lastCompletedAtFileTime: "",
    lastUpdatedAtMs: null,
  };
  const completedCount = previousCounter.completedCount + 1;
  const completedAtFileTime = normalizeText(
    options.completedAtFileTime,
    currentFileTimeString(),
  );
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const updatedCounter = {
    factionID,
    missionLevel,
    completedCount,
    lastMissionSequence: toPositiveInteger(missionRecord.missionSequence, 0) || null,
    lastAgentID: toPositiveInteger(agentRecord.agentID, 0) || null,
    lastSolarSystemID: toPositiveInteger(agentRecord.solarSystemID, 0) || null,
    lastContentID: normalizeMissionContentID(missionRecord.contentID, null),
    lastMissionTemplateID: normalizeText(missionRecord.missionTemplateID, ""),
    lastCompletedAtFileTime: completedAtFileTime,
    lastUpdatedAtMs: nowMs,
  };
  storylineProgress.countersByFactionAndLevel[counterKey] = updatedCounter;

  const milestoneNumber = Math.floor(completedCount / STORYLINE_THRESHOLD);
  const reachedMilestone =
    completedCount > 0 && completedCount % STORYLINE_THRESHOLD === 0;

  return {
    recorded: true,
    counterKey,
    factionID,
    missionLevel,
    completedCount,
    milestoneNumber,
    reachedMilestone,
    nextMilestoneAt:
      reachedMilestone
        ? completedCount + STORYLINE_THRESHOLD
        : (milestoneNumber + 1) * STORYLINE_THRESHOLD,
    counter: cloneValue(updatedCounter),
  };
}

function getIssuedStorylineMilestoneRecord(characterState, counterKey) {
  const storylineProgress = ensureStorylineProgress(characterState);
  const normalizedCounterKey = normalizeText(counterKey, "");
  if (!storylineProgress || !normalizedCounterKey) {
    return null;
  }
  return storylineProgress.issuedMilestonesByCounterKey[normalizedCounterKey] || null;
}

function hasStorylineMilestoneBeenIssued(characterState, counterKey, completedCount) {
  const issuedRecord = getIssuedStorylineMilestoneRecord(characterState, counterKey);
  const normalizedCompletedCount = Math.max(0, toPositiveInteger(completedCount, 0));
  return Boolean(
    issuedRecord &&
      normalizedCompletedCount > 0 &&
      toPositiveInteger(issuedRecord.issuedCompletedCount, 0) >= normalizedCompletedCount,
  );
}

function markStorylineMilestoneIssued(characterState, milestoneRecord = {}, options = {}) {
  const storylineProgress = ensureStorylineProgress(characterState);
  const counterKey = normalizeText(
    milestoneRecord.counterKey ||
      getStorylineCounterKey(milestoneRecord.factionID, milestoneRecord.missionLevel),
    "",
  );
  if (!storylineProgress || !counterKey) {
    return {
      recorded: false,
      reason: "invalid-counter-key",
    };
  }

  const issuedCompletedCount = Math.max(
    0,
    toPositiveInteger(
      milestoneRecord.issuedCompletedCount ?? milestoneRecord.completedCount,
      0,
    ),
  );
  if (
    issuedCompletedCount <= 0 ||
    issuedCompletedCount % STORYLINE_THRESHOLD !== 0
  ) {
    return {
      recorded: false,
      reason: "not-storyline-milestone",
    };
  }

  const existingRecord = normalizeStorylineMilestoneMap({
    [counterKey]: storylineProgress.issuedMilestonesByCounterKey[counterKey],
  })[counterKey];
  if (
    existingRecord &&
    toPositiveInteger(existingRecord.issuedCompletedCount, 0) >= issuedCompletedCount
  ) {
    return {
      recorded: false,
      reason: "already-issued",
      milestone: cloneValue(existingRecord),
    };
  }

  const issuedRecord = {
    counterKey,
    issuedCompletedCount,
    issuedAtFileTime: normalizeText(
      milestoneRecord.issuedAtFileTime || options.issuedAtFileTime,
      currentFileTimeString(),
    ),
    agentID: toPositiveInteger(milestoneRecord.agentID, 0) || null,
    missionSequence: toPositiveInteger(milestoneRecord.missionSequence, 0) || null,
    contentID: normalizeMissionContentID(milestoneRecord.contentID, null),
    missionTemplateID: normalizeText(milestoneRecord.missionTemplateID, ""),
    lastUpdatedAtMs: toFiniteNumber(options.nowMs, Date.now()),
  };
  storylineProgress.issuedMilestonesByCounterKey[counterKey] = issuedRecord;
  return {
    recorded: true,
    counterKey,
    issuedCompletedCount,
    milestone: cloneValue(issuedRecord),
  };
}

function recordPendingStorylineOffer(characterState, offerRecord = {}, options = {}) {
  const storylineProgress = ensureStorylineProgress(characterState);
  if (!storylineProgress) {
    return {
      recorded: false,
      reason: "invalid-character-state",
    };
  }

  const pendingOfferRecord = {
    ...offerRecord,
    status: "pending",
    offeredAtFileTime:
      offerRecord.offeredAtFileTime ||
      options.offeredAtFileTime ||
      currentFileTimeString(),
    expiresAtFileTime:
      offerRecord.expiresAtFileTime ||
      options.expiresAtFileTime ||
      "",
    lastUpdatedAtMs: toFiniteNumber(options.nowMs, Date.now()),
  };
  if (isRetiredActiveMissionRuntimeRecord(pendingOfferRecord, offerRecord.agentID)) {
    return {
      recorded: false,
      reason: "retired-mission-record",
    };
  }
  const normalizedOffer = normalizeStorylineOfferRecord(pendingOfferRecord);
  if (!normalizedOffer) {
    return {
      recorded: false,
      reason: "invalid-offer-record",
    };
  }

  const agentKey = String(normalizedOffer.agentID);
  const existingOfferRecord = storylineProgress.pendingOffersByAgentID[agentKey];
  if (existingOfferRecord) {
    const existingOffer = normalizeStorylineOfferRecord(
      existingOfferRecord,
      normalizedOffer.agentID,
    );
    return {
      recorded: false,
      reason: "already-pending",
      offer: cloneValue(existingOffer),
    };
  }

  storylineProgress.pendingOffersByAgentID[agentKey] = normalizedOffer;
  return {
    recorded: true,
    agentID: normalizedOffer.agentID,
    offer: cloneValue(normalizedOffer),
  };
}

function transitionPendingStorylineOffer(
  characterState,
  agentID,
  status,
  options = {},
) {
  const normalizedAgentID = toPositiveInteger(agentID, 0);
  const normalizedStatus = normalizeText(status, "");
  if (!normalizedAgentID || !["declined", "expired"].includes(normalizedStatus)) {
    return {
      transitioned: false,
      reason: "invalid-transition",
    };
  }

  const storylineProgress = ensureStorylineProgress(characterState);
  const pendingOfferRecord =
    storylineProgress &&
    storylineProgress.pendingOffersByAgentID[String(normalizedAgentID)];
  if (!storylineProgress || !pendingOfferRecord) {
    return {
      transitioned: false,
      reason: "pending-offer-not-found",
    };
  }
  const pendingOffer = normalizeStorylineOfferRecord(
    pendingOfferRecord,
    normalizedAgentID,
  );

  delete storylineProgress.pendingOffersByAgentID[String(normalizedAgentID)];
  const closedAtFileTime = normalizeText(
    options.closedAtFileTime,
    currentFileTimeString(),
  );
  const transitionedOffer = normalizeStorylineOfferRecord({
    ...pendingOffer,
    status: normalizedStatus,
    closedAtFileTime,
    declinedAtFileTime:
      normalizedStatus === "declined"
        ? closedAtFileTime
        : pendingOffer.declinedAtFileTime,
    expiredAtFileTime:
      normalizedStatus === "expired"
        ? closedAtFileTime
        : pendingOffer.expiredAtFileTime,
    lastUpdatedAtMs: toFiniteNumber(options.nowMs, Date.now()),
  }, normalizedAgentID);

  const targetMap =
    normalizedStatus === "declined"
      ? storylineProgress.declinedOffersByAgentID
      : storylineProgress.expiredOffersByAgentID;
  targetMap[String(normalizedAgentID)] = transitionedOffer;
  return {
    transitioned: true,
    agentID: normalizedAgentID,
    status: normalizedStatus,
    offer: cloneValue(transitionedOffer),
  };
}

function expirePendingStorylineOffers(characterState, options = {}) {
  const storylineProgress = ensureStorylineProgress(characterState);
  if (!storylineProgress) {
    return [];
  }

  const nowFileTime = normalizeText(
    options.nowFileTime || options.closedAtFileTime,
    currentFileTimeString(),
  );
  let nowBigInt;
  try {
    nowBigInt = BigInt(nowFileTime);
  } catch (_error) {
    return [];
  }

  const expiredOffers = [];
  for (const [agentKey, offerRecord] of Object.entries(
    storylineProgress.pendingOffersByAgentID,
  )) {
    const normalizedOffer = normalizeStorylineOfferRecord(offerRecord, agentKey);
    if (!normalizedOffer || !normalizedOffer.expiresAtFileTime) {
      continue;
    }
    let expiresBigInt;
    try {
      expiresBigInt = BigInt(normalizedOffer.expiresAtFileTime);
    } catch (_error) {
      continue;
    }
    if (expiresBigInt > nowBigInt) {
      continue;
    }
    const transitionResult = transitionPendingStorylineOffer(
      characterState,
      normalizedOffer.agentID,
      "expired",
      {
        closedAtFileTime: nowFileTime,
        nowMs: options.nowMs,
      },
    );
    if (transitionResult.transitioned) {
      expiredOffers.push(transitionResult.offer);
    }
  }
  return expiredOffers;
}

function ensureCharacterState(state, characterID) {
  const normalizedCharacterID = toPositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }

  if (
    !state.charactersByID[String(normalizedCharacterID)] ||
    typeof state.charactersByID[String(normalizedCharacterID)] !== "object"
  ) {
    state.charactersByID[String(normalizedCharacterID)] =
      createDefaultCharacterState(normalizedCharacterID);
  }

  const characterState = state.charactersByID[String(normalizedCharacterID)];
  characterState.characterID = normalizedCharacterID;
  characterState.lastUpdatedAtMs = Date.now();
  const retiredMissionAgentIDs = new Set();
  const retiredMissionBookmarkIDs = new Set();
  const collectRetiredMissionAgentID = (record, fallbackAgentID = 0, forceRetired = false) => {
    if (!forceRetired && !isRetiredMissionRuntimeRecord(record)) {
      return;
    }
    const agentID = toPositiveInteger(
      record && (record.agentID ?? record.lastAgentID),
      toPositiveInteger(fallbackAgentID, 0),
    );
    if (agentID > 0) {
      retiredMissionAgentIDs.add(agentID);
    }
  };
  for (const [agentKey, missionRecord] of Object.entries(
    characterState.missionsByAgentID || {},
  )) {
    const isRetiredActiveMission = isRetiredActiveMissionRuntimeRecord(
      missionRecord,
      agentKey,
    );
    if (isRetiredActiveMission) {
      for (const bookmarkID of Object.values(
        missionRecord &&
          missionRecord.bookmarkIDsByRole &&
          typeof missionRecord.bookmarkIDsByRole === "object"
          ? missionRecord.bookmarkIDsByRole
          : {},
      )) {
        const normalizedBookmarkID = toPositiveInteger(bookmarkID, 0);
        if (normalizedBookmarkID > 0) {
          retiredMissionBookmarkIDs.add(normalizedBookmarkID);
        }
      }
    }
    collectRetiredMissionAgentID(missionRecord, agentKey, isRetiredActiveMission);
  }
  for (const historyEntry of Array.isArray(characterState.history) ? characterState.history : []) {
    collectRetiredMissionAgentID(historyEntry);
  }
  const storylineProgress = characterState.storylineProgress;
  for (const mapName of [
    "pendingOffersByAgentID",
    "declinedOffersByAgentID",
    "expiredOffersByAgentID",
  ]) {
    const offerMap = storylineProgress && storylineProgress[mapName];
    for (const [agentKey, offerRecord] of Object.entries(
      offerMap && typeof offerMap === "object" ? offerMap : {},
    )) {
      collectRetiredMissionAgentID(
        offerRecord,
        agentKey,
        mapName === "pendingOffersByAgentID" &&
          isRetiredActiveMissionRuntimeRecord(offerRecord, agentKey),
      );
    }
  }
  const issuedMilestones = storylineProgress &&
    storylineProgress.issuedMilestonesByCounterKey;
  for (const milestoneRecord of Object.values(
    issuedMilestones && typeof issuedMilestones === "object" ? issuedMilestones : {},
  )) {
    collectRetiredMissionAgentID(milestoneRecord);
  }
  const storylineCounters = storylineProgress &&
    storylineProgress.countersByFactionAndLevel;
  for (const counterRecord of Object.values(
    storylineCounters && typeof storylineCounters === "object" ? storylineCounters : {},
  )) {
    collectRetiredMissionAgentID(counterRecord);
  }
  const epicArcProgress = characterState.epicArcProgress;
  const missionStatusByArcID = epicArcProgress && epicArcProgress.missionStatusByArcID;
  for (const missionMap of Object.values(
    missionStatusByArcID && typeof missionStatusByArcID === "object"
      ? missionStatusByArcID
      : {},
  )) {
    for (const [missionKey, statusRecord] of Object.entries(
      missionMap && typeof missionMap === "object" ? missionMap : {},
    )) {
      collectRetiredMissionAgentID(
        statusRecord,
        0,
        isRetiredActiveMissionRuntimeRecord(
          {
            ...statusRecord,
            missionID: (statusRecord && statusRecord.missionID) ?? missionKey,
          },
          statusRecord && statusRecord.agentID,
        ),
      );
    }
  }
  const completedArcsByID = epicArcProgress && epicArcProgress.completedArcsByID;
  for (const completionRecord of Object.values(
    completedArcsByID && typeof completedArcsByID === "object"
      ? completedArcsByID
      : {},
  )) {
    collectRetiredMissionAgentID(completionRecord);
  }
  cleanupRetiredMissionBookmarks(normalizedCharacterID, retiredMissionBookmarkIDs);

  if (
    !characterState.missionSelectionCursorByAgentID ||
    typeof characterState.missionSelectionCursorByAgentID !== "object"
  ) {
    characterState.missionSelectionCursorByAgentID = {};
  }
  if (
    !characterState.missionsByAgentID ||
    typeof characterState.missionsByAgentID !== "object"
  ) {
    characterState.missionsByAgentID = {};
  }
  if (
    !characterState.declineTimersByAgentID ||
    typeof characterState.declineTimersByAgentID !== "object"
  ) {
    characterState.declineTimersByAgentID = {};
  }
  if (
    !characterState.completedCareerAgentIDs ||
    typeof characterState.completedCareerAgentIDs !== "object"
  ) {
    characterState.completedCareerAgentIDs = {};
  }
  ensureEpicArcProgress(characterState);
  ensureStorylineProgress(characterState);
  if (!Array.isArray(characterState.history)) {
    characterState.history = [];
  }

  for (const [agentKey, missionRecord] of Object.entries(characterState.missionsByAgentID)) {
    const normalizedMissionRecord = normalizeMissionRecord(
      missionRecord,
      agentKey,
      state.nextMissionSequence,
    );
    if (!normalizedMissionRecord) {
      delete characterState.missionsByAgentID[agentKey];
      continue;
    }
    characterState.missionsByAgentID[String(normalizedMissionRecord.agentID)] =
      normalizedMissionRecord;
    if (String(normalizedMissionRecord.agentID) !== String(agentKey)) {
      delete characterState.missionsByAgentID[agentKey];
    }
    state.nextMissionSequence = Math.max(
      toPositiveInteger(state.nextMissionSequence, 1),
      normalizedMissionRecord.missionSequence + 1,
    );
  }

  for (const agentID of retiredMissionAgentIDs) {
    delete characterState.missionSelectionCursorByAgentID[String(agentID)];
    delete characterState.declineTimersByAgentID[String(agentID)];
  }

  const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
  for (const [agentKey, replayUntilFileTime] of Object.entries(
    characterState.declineTimersByAgentID,
  )) {
    const normalizedAgentID = toPositiveInteger(agentKey, 0);
    if (!normalizedAgentID) {
      delete characterState.declineTimersByAgentID[agentKey];
      continue;
    }
    const normalizedReplayUntilFileTime = normalizeText(replayUntilFileTime, "");
    if (!normalizedReplayUntilFileTime) {
      delete characterState.declineTimersByAgentID[agentKey];
      continue;
    }
    try {
      if (BigInt(normalizedReplayUntilFileTime) <= now) {
        delete characterState.declineTimersByAgentID[agentKey];
        continue;
      }
    } catch (error) {
      delete characterState.declineTimersByAgentID[agentKey];
      continue;
    }
    characterState.declineTimersByAgentID[String(normalizedAgentID)] =
      normalizedReplayUntilFileTime;
    if (String(normalizedAgentID) !== String(agentKey)) {
      delete characterState.declineTimersByAgentID[agentKey];
    }
  }

  for (const [agentKey, completed] of Object.entries(
    characterState.completedCareerAgentIDs,
  )) {
    const normalizedAgentID = toPositiveInteger(agentKey, 0);
    if (!normalizedAgentID || completed !== true) {
      delete characterState.completedCareerAgentIDs[agentKey];
      continue;
    }
    characterState.completedCareerAgentIDs[String(normalizedAgentID)] = true;
    if (String(normalizedAgentID) !== String(agentKey)) {
      delete characterState.completedCareerAgentIDs[agentKey];
    }
  }

  characterState.history = characterState.history
    .map((entry) => normalizeHistoryEntry(entry))
    .filter(Boolean)
    .sort((left, right) => right.missionSequence - left.missionSequence)
    .slice(0, 128);

  return characterState;
}

function getMutableState() {
  const result = repo.read(MISSION_RUNTIME_TABLE, "/");
  let state =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;

  if (!state) {
    state = createDefaultState();
    repo.write(MISSION_RUNTIME_TABLE, "/", state);
    return state;
  }

  let mutated = false;
  if (toPositiveInteger(state.version, 0) !== 1) {
    state.version = 1;
    mutated = true;
  }
  if (toPositiveInteger(state.nextMissionSequence, 0) <= 0) {
    state.nextMissionSequence = 1;
    mutated = true;
  }
  if (!state.charactersByID || typeof state.charactersByID !== "object") {
    state.charactersByID = {};
    mutated = true;
  }

  for (const characterID of Object.keys(state.charactersByID)) {
    const before = JSON.stringify(state.charactersByID[characterID]);
    ensureCharacterState(state, characterID);
    if (JSON.stringify(state.charactersByID[characterID]) !== before) {
      mutated = true;
    }
  }

  if (mutated) {
    repo.write(MISSION_RUNTIME_TABLE, "/", state);
  }
  return state;
}

function persistState(state) {
  return repo.write(MISSION_RUNTIME_TABLE, "/", state);
}

function getStateSnapshot() {
  return cloneValue(getMutableState());
}

function getCharacterStateSnapshot(characterID) {
  const state = getMutableState();
  const characterState = ensureCharacterState(state, characterID);
  return characterState ? cloneValue(characterState) : null;
}

function mutateState(mutator) {
  const state = getMutableState();
  const result = typeof mutator === "function" ? mutator(state) : state;
  const writeResult = persistState(state);
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_FAILED",
    };
  }
  return {
    success: true,
    data: cloneValue(result),
  };
}

function mutateCharacterState(characterID, mutator) {
  return mutateState((state) => {
    const characterState = ensureCharacterState(state, characterID);
    if (!characterState) {
      return null;
    }
    characterState.lastUpdatedAtMs = Date.now();
    return typeof mutator === "function"
      ? mutator(characterState, state)
      : characterState;
  });
}

function resetCharacterState(characterID) {
  return mutateState((state) => {
    delete state.charactersByID[String(toPositiveInteger(characterID, 0))];
    return true;
  });
}

function getEpicArcStatusRecord(characterState, epicArcID, missionID) {
  const epicArcProgress = ensureEpicArcProgress(characterState);
  const normalizedArcID = toPositiveInteger(epicArcID, 0);
  const normalizedMissionID = normalizeMissionContentID(missionID, null);
  if (!epicArcProgress || !normalizedArcID || normalizedMissionID === null) {
    return null;
  }
  const statusRecord =
    epicArcProgress.missionStatusByArcID[String(normalizedArcID)] &&
    epicArcProgress.missionStatusByArcID[String(normalizedArcID)][String(normalizedMissionID)];
  return statusRecord ? cloneValue(statusRecord) : null;
}

function recordEpicArcMissionStatus(characterState, statusRecord = {}, options = {}) {
  const source =
    statusRecord && typeof statusRecord === "object" && !Array.isArray(statusRecord)
      ? statusRecord
      : {};
  const epicArcProgress = ensureEpicArcProgress(characterState);
  const epicArcID = toPositiveInteger(source.epicArcID, 0);
  const missionID = normalizeMissionContentID(source.missionID, null);
  if (!epicArcProgress || !epicArcID || missionID === null) {
    return {
      recorded: false,
      reason: "invalid-epic-arc-status",
    };
  }

  const arcKey = String(epicArcID);
  const missionKey = String(missionID);
  const existingStatus =
    epicArcProgress.missionStatusByArcID[arcKey] &&
    epicArcProgress.missionStatusByArcID[arcKey][missionKey];
  const normalizedStatus = normalizeEpicArcStatusRecord({
    ...(existingStatus || {}),
    ...source,
    missionID,
    lastUpdatedAtMs: toFiniteNumber(options.nowMs, Date.now()),
  }, missionID);
  if (!normalizedStatus) {
    return {
      recorded: false,
      reason: "retired-mission-record",
    };
  }

  if (!epicArcProgress.missionStatusByArcID[arcKey]) {
    epicArcProgress.missionStatusByArcID[arcKey] = {};
  }
  epicArcProgress.missionStatusByArcID[arcKey][missionKey] = normalizedStatus;
  return {
    recorded: true,
    epicArcID,
    missionID,
    status: cloneValue(normalizedStatus),
  };
}

function recordEpicArcCompletion(characterState, completionRecord = {}, options = {}) {
  const epicArcProgress = ensureEpicArcProgress(characterState);
  const epicArcID = toPositiveInteger(completionRecord.epicArcID, 0);
  if (!epicArcProgress || !epicArcID) {
    return {
      recorded: false,
      reason: "invalid-epic-arc-completion",
    };
  }

  const completedAtFileTime = normalizeText(
    completionRecord.completedAtFileTime,
    currentFileTimeString(),
  );
  const replayUntilFileTime = normalizeText(
    completionRecord.replayUntilFileTime,
    futureFileTimeString(EPIC_ARC_REPLAY_DELAY_MS),
  );
  const normalizedCompletion = normalizeEpicArcCompletionRecord({
    ...completionRecord,
    epicArcID,
    completedAtFileTime,
    replayUntilFileTime,
    lastUpdatedAtMs: toFiniteNumber(options.nowMs, Date.now()),
  }, epicArcID);
  if (!normalizedCompletion) {
    return {
      recorded: false,
      reason: "retired-mission-record",
    };
  }
  epicArcProgress.completedArcsByID[String(epicArcID)] = normalizedCompletion;
  return {
    recorded: true,
    epicArcID,
    completion: cloneValue(normalizedCompletion),
  };
}

function getEpicArcReplayBlock(characterState, epicArcID, options = {}) {
  const epicArcProgress = ensureEpicArcProgress(characterState);
  const normalizedArcID = toPositiveInteger(epicArcID, 0);
  if (!epicArcProgress || !normalizedArcID) {
    return null;
  }

  const completion = normalizeEpicArcCompletionRecord(
    epicArcProgress.completedArcsByID[String(normalizedArcID)],
    normalizedArcID,
  );
  if (!completion || !completion.replayUntilFileTime) {
    return null;
  }

  let replayUntil;
  let nowFileTime;
  try {
    replayUntil = BigInt(completion.replayUntilFileTime);
    nowFileTime = BigInt(
      normalizeText(options.nowFileTime, currentFileTimeString()),
    );
  } catch (_error) {
    return null;
  }

  if (replayUntil <= nowFileTime) {
    return null;
  }
  return {
    ...cloneValue(completion),
    remainingFileTimeTicks: (replayUntil - nowFileTime).toString(),
  };
}

module.exports = {
  EPIC_ARC_REPLAY_DELAY_MS,
  OFFER_EXPIRY_MS,
  REPLAY_DELAY_MS,
  STORYLINE_THRESHOLD,
  currentFileTimeString,
  createDefaultEpicArcProgress,
  createDefaultStorylineProgress,
  expirePendingStorylineOffers,
  futureFileTimeString,
  getCharacterStateSnapshot,
  getEpicArcReplayBlock,
  getEpicArcStatusRecord,
  getIssuedStorylineMilestoneRecord,
  getMutableState,
  getStateSnapshot,
  getStorylineCounterKey,
  hasStorylineMilestoneBeenIssued,
  isStorylineQualifyingNormalMission,
  markStorylineMilestoneIssued,
  mutateCharacterState,
  mutateState,
  normalizeEpicArcProgress,
  normalizeStorylineProgress,
  recordEpicArcCompletion,
  recordEpicArcMissionStatus,
  recordPendingStorylineOffer,
  recordStorylineQualifyingCompletion,
  resetCharacterState,
  transitionPendingStorylineOffer,
};
