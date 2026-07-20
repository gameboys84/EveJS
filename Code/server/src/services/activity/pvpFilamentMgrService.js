const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const PVP_JUMP_ERROR = Object.freeze({
  EVENT_NOT_ACTIVE: 33,
});

const CHARACTER_STATISTIC_FIELDS = Object.freeze([
  ["rank", 0],
  ["wins", 0],
  ["losses", 0],
  ["draws", 0],
]);

const auditEvents = [];

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterID(session = null) {
  return toInt(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
    0,
  );
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

function buildEmptyEventDict() {
  return buildDict([]);
}

function buildErrorList(errors) {
  return buildList(
    (Array.isArray(errors) ? errors : [])
      .map(([code, args]) => [
        toInt(code, PVP_JUMP_ERROR.EVENT_NOT_ACTIVE),
        Array.isArray(args) ? args : [],
      ]),
  );
}

function throwPvpJumpError(errors) {
  throwWrappedUserError("PVPJumpError", {
    errors: buildErrorList(errors),
  });
}

function getMatchTypeID(args = []) {
  return toInt(args && args.length > 0 ? args[0] : 0, 0);
}

function getScheduleID(args = []) {
  return toInt(args && args.length > 1 ? args[1] : 0, 0);
}

function buildLeaderboardInfo(args = []) {
  return buildDict([
    ["matchTypeID", getMatchTypeID(args)],
    ["scheduleID", getScheduleID(args)],
    ["entries", buildList([])],
  ]);
}

function buildCharacterStatisticsInfo(args = []) {
  return buildDict([
    ["matchTypeID", getMatchTypeID(args)],
    ["scheduleID", getScheduleID(args)],
    ["statistics", buildDict(CHARACTER_STATISTIC_FIELDS)],
  ]);
}

function notify(session, notificationName, payload) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification(notificationName, "clientID", [payload]);
}

class PvpFilamentMgrService extends BaseService {
  constructor() {
    super("pvpFilamentMgr");
  }

  Handle_GetAllEvents(args, session) {
    recordAuditEvent("get_all_events", args, session);
    return buildEmptyEventDict();
  }

  Handle_GetActiveEvents(args, session) {
    recordAuditEvent("get_active_events", args, session);
    return buildEmptyEventDict();
  }

  Handle_GetMostRecentEvent(args, session) {
    recordAuditEvent("get_most_recent_event", args, session);
    return null;
  }

  Handle_GetNextEventDate(args, session) {
    recordAuditEvent("get_next_event_date", args, session);
    return null;
  }

  Handle_GetLeaderboard(args, session) {
    recordAuditEvent("get_leaderboard", args, session);
    notify(session, "OnPVPFilamentsLeaderboard", buildLeaderboardInfo(args));
    return null;
  }

  Handle_GetCharacterStatistics(args, session) {
    recordAuditEvent("get_character_statistics", args, session);
    notify(
      session,
      "OnPVPFilamentsCharacterStatistics",
      buildCharacterStatisticsInfo(args),
    );
    return null;
  }

  Handle_JoinPVPQueue(args, session) {
    recordAuditEvent("join_pvp_queue_rejected", args, session);
    log.debug("[PvpFilamentMgr] JoinPVPQueue rejected: no active Proving Grounds event");
    throwPvpJumpError([[PVP_JUMP_ERROR.EVENT_NOT_ACTIVE, []]]);
  }

  Handle_LeavePVPQueue(args, session) {
    recordAuditEvent("leave_pvp_queue", args, session);
    return null;
  }

  Handle_AbyssalPVPEndGateActivation(args, session) {
    recordAuditEvent("abyssal_pvp_end_gate_activation_rejected", args, session);
    log.debug(
      "[PvpFilamentMgr] AbyssalPVPEndGateActivation rejected: no active Proving Grounds origin trace",
    );
    throwWrappedUserError("DeniedTargetAttemptFailed");
  }
}

PvpFilamentMgrService._testing = {
  constants: {
    PVP_JUMP_ERROR,
  },
  buildCharacterStatisticsInfo,
  buildLeaderboardInfo,
  getAuditEvents() {
    return auditEvents.slice();
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

module.exports = PvpFilamentMgrService;
