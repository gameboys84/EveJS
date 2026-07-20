const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildList,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const DEFAULT_MATCH_LENGTH_SECONDS = 600;
const DEFAULT_OVERTIME_LENGTH_SECONDS = 300;
const DEFAULT_MAXIMUM_POINTS = 0;
const MAX_AUDIT_EVENTS = 200;
const auditEvents = [];

function toInteger(value, fallback = 0) {
  const numeric = Math.trunc(normalizeNumber(unwrapMarshalValue(value), fallback));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getSessionCharacterID(session) {
  return toInteger(
    session && (session.characterID || session.charid || session.characterId),
    0,
  );
}

function getSessionAccountID(session) {
  return toInteger(
    session && (session.userid || session.userID || session.accountID),
    0,
  );
}

function safeClone(value) {
  try {
    return value === undefined ? null : JSON.parse(JSON.stringify(unwrapMarshalValue(value)));
  } catch (error) {
    return null;
  }
}

function recordAuditEvent(kind, args = [], session = null, extra = {}) {
  const event = {
    eventID: auditEvents.length + 1,
    kind,
    characterID: getSessionCharacterID(session) || null,
    accountID: getSessionAccountID(session) || null,
    args: safeClone(args),
    recordedAt: new Date().toISOString(),
    ...extra,
  };
  auditEvents.push(event);
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
  return event;
}

function emptyDict() {
  return buildDict([]);
}

function emptyList() {
  return buildList([]);
}

function buildTournamentDetails() {
  return buildDict([
    ["allowedShipList", emptyList()],
    ["maximumPointsMatch", DEFAULT_MAXIMUM_POINTS],
    ["matchLength", DEFAULT_MATCH_LENGTH_SECONDS],
    ["overtimeLength", DEFAULT_OVERTIME_LENGTH_SECONDS],
    ["externalRulesetID", null],
  ]);
}

class TourneyMgrService extends BaseService {
  constructor() {
    super("tourneyMgr");
  }

  Handle_GetTourneySetup(args, session) {
    recordAuditEvent("get_tourney_setup_empty", args, session);
    return [emptyDict(), emptyDict(), emptyList()];
  }

  Handle_GetPotentialMatches(args, session) {
    recordAuditEvent("get_potential_matches_empty", args, session, {
      tournamentID: toInteger(args && args[0], 0),
    });
    return emptyDict();
  }

  Handle_GetAllCurrentSeriesMatchDetails(args, session) {
    recordAuditEvent("get_current_series_match_details_empty", args, session, {
      tournamentID: toInteger(args && args[0], 0),
    });
    return emptyDict();
  }

  Handle_QueryTournamentDetails(args, session) {
    recordAuditEvent("query_tournament_details_empty", args, session, {
      tournamentID: toInteger(args && args[0], 0),
    });
    return buildTournamentDetails();
  }

  Handle_QueryShipList(args, session) {
    recordAuditEvent("query_ship_list_empty", args, session, {
      tournamentID: toInteger(args && args[0], 0),
    });
    return buildDict([["allowedShipList", emptyList()]]);
  }

  Handle_BanShip(args, session) {
    recordAuditEvent("ban_ship_ack_without_tournament_state", args, session, {
      banID: toInteger(args && args[0], 0),
      shipTypeIDs: safeClone(args && args[1]) || [],
    });
    log.debug("[TourneyMgr] BanShip acknowledged without active tournament state");
    return null;
  }

  Handle_ExecuteMemberChange(args, session) {
    recordAuditEvent("execute_member_change_ack_without_tournament_state", args, session);
    log.debug("[TourneyMgr] ExecuteMemberChange acknowledged without active tournament state");
    return null;
  }
}

TourneyMgrService._testing = {
  constants: {
    DEFAULT_MATCH_LENGTH_SECONDS,
    DEFAULT_OVERTIME_LENGTH_SECONDS,
    DEFAULT_MAXIMUM_POINTS,
  },
  buildTournamentDetails,
  getAuditEvents() {
    return auditEvents.map((entry) => ({ ...entry }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

module.exports = TourneyMgrService;
