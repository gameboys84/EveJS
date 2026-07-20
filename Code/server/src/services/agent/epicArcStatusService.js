const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  getAgentByID,
} = require(path.join(__dirname, "./agentAuthority"));
const missionAuthority = require(path.join(__dirname, "./missionAuthority"));
// Phase 0 / 0.C: agent/epic-arc state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:agent", { strict: true });
const {
  getEpicArcReplayBlock,
} = require(path.join(__dirname, "./missionRuntimeState"));

const AGENT_TYPE_EPIC_ARC = 10;
const MISSION_RUNTIME_TABLE = "missionRuntimeState";

let availabilityCache = null;

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  const normalized = Math.trunc(numericValue);
  return normalized > 0 ? normalized : fallback;
}

function normalizeMissionID(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return /^-?\d+$/.test(text) ? Number.parseInt(text, 10) : text;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isEpicMissionRecord(missionRecord) {
  return Boolean(
    missionRecord &&
    (
      missionRecord.isEpicArc === true ||
      missionRecord.missionFlavor === "epicArc" ||
      normalizePositiveInteger(missionRecord.epicArcID, 0) > 0
    ),
  );
}

function getMissionByRuntimeRecord(missionRecord) {
  const missionID = normalizeMissionID(
    missionRecord &&
      (missionRecord.contentID ??
        missionRecord.clientMissionID ??
        missionRecord.missionTemplateID),
  );
  return missionID === null ? null : missionAuthority.getMissionByID(missionID);
}

function getAllMissionRecords() {
  const payload = missionAuthority.getPayload();
  return Object.keys(payload.missionsByID || {})
    .map((missionID) => missionAuthority.getMissionByID(missionID))
    .filter(Boolean);
}

function buildAvailabilityCache() {
  const epicMissions = getAllMissionRecords().filter(isEpicMissionRecord);
  const missionsByArc = new Map();

  for (const missionRecord of epicMissions) {
    const arcKey = String(
      normalizePositiveInteger(missionRecord.epicArcID, 0) ||
        `mission:${missionRecord.missionID}`,
    );
    if (!missionsByArc.has(arcKey)) {
      missionsByArc.set(arcKey, []);
    }
    missionsByArc.get(arcKey).push(missionRecord);
  }

  const rootSourceAgentIDs = new Set();
  const rootAgentArcIDs = new Map();
  for (const missionRecords of missionsByArc.values()) {
    const childMissionIDs = new Set();
    for (const missionRecord of missionRecords) {
      for (const nextMissionID of missionRecord.nextMissionIDs || []) {
        childMissionIDs.add(String(nextMissionID));
      }
    }

    for (const missionRecord of missionRecords) {
      if (childMissionIDs.has(String(missionRecord.missionID))) {
        continue;
      }
      const sourceAgentID = normalizePositiveInteger(missionRecord.sourceAgentID, 0);
      if (sourceAgentID > 0) {
        rootSourceAgentIDs.add(sourceAgentID);
        if (!rootAgentArcIDs.has(sourceAgentID)) {
          rootAgentArcIDs.set(sourceAgentID, new Set());
        }
        rootAgentArcIDs.get(sourceAgentID).add(
          normalizePositiveInteger(missionRecord.epicArcID, 0),
        );
      }
    }
  }

  return {
    epicMissionCount: epicMissions.length,
    rootAgentArcIDs,
    rootSourceAgentIDs,
  };
}

function getAvailabilityCache() {
  if (!availabilityCache) {
    availabilityCache = buildAvailabilityCache();
  }
  return availabilityCache;
}

function clearAvailabilityCacheForTests() {
  availabilityCache = null;
}

function missionRecordReferencesAgent(missionRecord, agentID) {
  const normalizedAgentID = normalizePositiveInteger(agentID, 0);
  if (!normalizedAgentID) {
    return false;
  }

  const clientMissionRecord = getMissionByRuntimeRecord(missionRecord);
  if (!isEpicMissionRecord(clientMissionRecord)) {
    return false;
  }

  if (normalizePositiveInteger(missionRecord && missionRecord.agentID, 0) === normalizedAgentID) {
    return true;
  }
  if (normalizePositiveInteger(clientMissionRecord.sourceAgentID, 0) === normalizedAgentID) {
    return true;
  }
  if (normalizePositiveInteger(clientMissionRecord.targetAgentID, 0) === normalizedAgentID) {
    return true;
  }
  return (clientMissionRecord.nextAgentIDs || [])
    .some((nextAgentID) => normalizePositiveInteger(nextAgentID, 0) === normalizedAgentID);
}

function characterStateReferencesAgent(characterState, agentID) {
  if (!characterState || typeof characterState !== "object") {
    return false;
  }

  return Object.values(characterState.missionsByAgentID || {})
    .some((missionRecord) => missionRecordReferencesAgent(missionRecord, agentID));
}

function getExistingCharacterStateSnapshot(characterID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }
  const result = repo.read(
    MISSION_RUNTIME_TABLE,
    `/charactersByID/${normalizedCharacterID}`,
  );
  if (!result.success || !result.data || typeof result.data !== "object") {
    return null;
  }
  return cloneValue(result.data);
}

function isRootEpicArcAgent(agentID) {
  return getAvailabilityCache().rootSourceAgentIDs.has(
    normalizePositiveInteger(agentID, 0),
  );
}

function isRootEpicArcReplayBlocked(agentID, characterState) {
  const normalizedAgentID = normalizePositiveInteger(agentID, 0);
  if (!normalizedAgentID || !characterState) {
    return false;
  }
  const rootArcIDs = getAvailabilityCache().rootAgentArcIDs.get(normalizedAgentID);
  if (!rootArcIDs || rootArcIDs.size <= 0) {
    return false;
  }
  for (const epicArcID of rootArcIDs) {
    if (getEpicArcReplayBlock(characterState, epicArcID)) {
      return true;
    }
  }
  return false;
}

function agentHasEpicMissionsForCharacter(agentID, characterID = 0, options = {}) {
  const normalizedAgentID = normalizePositiveInteger(agentID, 0);
  if (!normalizedAgentID) {
    return false;
  }

  const agentRecord = getAgentByID(normalizedAgentID);
  if (!agentRecord || normalizePositiveInteger(agentRecord.agentTypeID, 0) !== AGENT_TYPE_EPIC_ARC) {
    return false;
  }

  const characterState = Object.prototype.hasOwnProperty.call(options, "characterState")
    ? options.characterState
    : normalizePositiveInteger(characterID, 0) > 0
      ? getExistingCharacterStateSnapshot(characterID)
      : null;
  if (characterStateReferencesAgent(characterState, normalizedAgentID)) {
    return true;
  }

  return (
    isRootEpicArcAgent(normalizedAgentID) &&
    !isRootEpicArcReplayBlocked(normalizedAgentID, characterState)
  );
}

class EpicArcStatusService extends BaseService {
  constructor() {
    super("epicArcStatus");
  }

  Handle_AgentHasEpicMissionsForCharacter(args, session) {
    return agentHasEpicMissionsForCharacter(
      args && args[0],
      normalizePositiveInteger(session && session.characterID, 0),
    );
  }
}

EpicArcStatusService._testing = {
  AGENT_TYPE_EPIC_ARC,
  agentHasEpicMissionsForCharacter,
  characterStateReferencesAgent,
  clearAvailabilityCacheForTests,
  getExistingCharacterStateSnapshot,
  getAvailabilitySnapshot() {
    const cache = getAvailabilityCache();
    return {
      epicMissionCount: cache.epicMissionCount,
      rootSourceAgentIDs: [...cache.rootSourceAgentIDs].sort((left, right) => left - right),
    };
  },
  isRootEpicArcAgent,
  isRootEpicArcReplayBlocked,
  missionRecordReferencesAgent,
};

module.exports = EpicArcStatusService;
