const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildList,
  buildKeyVal,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const agentMissionRuntime = require(path.join(
  __dirname,
  "./agentMissionRuntime",
));

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function normalizeAgentIDs(value) {
  const source = Array.isArray(value)
    ? value
    : value && Array.isArray(value.items)
      ? value.items
      : [];
  return [...new Set(source
    .map((entry) => normalizePositiveInteger(entry, 0))
    .filter(Boolean))];
}

function buildTrackerOptions(session, agentID) {
  return {
    currentLocationID: normalizePositiveInteger(session && session.locationid, 0),
    currentStationID: normalizePositiveInteger(session && session.stationid, 0),
    inActiveDungeon: agentMissionRuntime.isSessionInActiveMissionDungeon(
      session,
      agentMissionRuntime.getMissionRecord(
        normalizePositiveInteger(session && session.characterID, 0),
        agentID,
      ),
    ),
  };
}

function buildMissionInfoList(value) {
  if (Array.isArray(value)) {
    return buildList(value);
  }
  if (value && value.type === "tuple" && Array.isArray(value.items)) {
    return buildList(value.items);
  }
  return value;
}

class MissionTrackerMgrService extends BaseService {
  constructor() {
    super("missionTrackerMgr");
  }

  Handle_UpdateAllMissions(args, session) {
    const characterID = normalizePositiveInteger(session && session.characterID, 0);
    const agentIDs = normalizeAgentIDs(args && args[0]);
    const updates = agentIDs.map((agentID) => buildKeyVal([
      ["agentID", agentID],
      ["info", buildMissionInfoList(
        agentMissionRuntime.getMissionInfoItems(
          characterID,
          agentID,
          buildTrackerOptions(session, agentID),
        ),
      )],
    ]));

    if (typeof session?.sendNotification === "function") {
      session.sendNotification("OnMissionsUpdated", "charid", [updates]);
    }
    return null;
  }

  Handle_GetMissionInfoItems(args, session) {
    const characterID = normalizePositiveInteger(session && session.characterID, 0);
    const agentID = normalizePositiveInteger(args && args[0], 0);
    return buildMissionInfoList(
      agentMissionRuntime.getMissionInfoItems(
        characterID,
        agentID,
        buildTrackerOptions(session, agentID),
      ),
    );
  }

  Handle_GetAllMissionObjectives(args, session) {
    const characterID = normalizePositiveInteger(session && session.characterID, 0);
    const agentID = normalizePositiveInteger(args && args[0], 0);
    return buildList(
      agentMissionRuntime.getAllMissionObjectives(
        characterID,
        agentID,
        buildTrackerOptions(session, agentID),
      ),
    );
  }

  Handle_IsInActiveDungeonID(args, session) {
    const characterID = normalizePositiveInteger(session && session.characterID, 0);
    const agentID = normalizePositiveInteger(args && args[0], 0);
    const missionRecord = agentMissionRuntime.getMissionRecord(characterID, agentID);
    return agentMissionRuntime.isSessionInActiveMissionDungeon(session, missionRecord);
  }
}

module.exports = MissionTrackerMgrService;
