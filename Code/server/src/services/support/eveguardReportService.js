const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

const heartbeatEvents = [];

function getSessionCharacterID(session) {
  return Number(session && (session.characterID || session.charid || session.clientID)) || 0;
}

function getSessionAccountID(session) {
  return Number(session && (session.userid || session.userID || session.accountID)) || 0;
}

function recordHeartbeat(eventType, session = null) {
  const event = {
    eventID: heartbeatEvents.length + 1,
    eventType,
    characterID: getSessionCharacterID(session),
    accountID: getSessionAccountID(session),
    recordedAt: new Date().toISOString(),
  };
  heartbeatEvents.push(event);
  log.debug(
    `[EveGuardReport] heartbeat ${eventType} account=${event.accountID || "?"} char=${event.characterID || "?"}`,
  );
  return null;
}

class EveGuardReportService extends BaseService {
  constructor() {
    super("eveguard_report");
  }

  Handle_heartbeat_started(args, session) {
    return recordHeartbeat("started", session);
  }

  Handle_heartbeat_stopped(args, session) {
    return recordHeartbeat("stopped", session);
  }
}

module.exports = EveGuardReportService;
module.exports._testing = {
  getEvents() {
    return heartbeatEvents.map((event) => JSON.parse(JSON.stringify(event)));
  },
  resetForTests() {
    heartbeatEvents.length = 0;
  },
};
