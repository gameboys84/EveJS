const BaseService = require("../baseService");
const log = require("../../utils/logger");

const MAX_LOG_STRING_EVENTS = 250;
const logStringEvents = [];

function getCharacterID(session) {
  return (
    session &&
    (session.characterID || session.charid || session.characterId || session.userid)
  ) || null;
}

function recordLogString(args = [], session = null) {
  const event = {
    message: args[0] == null ? "" : String(args[0]),
    args: Array.isArray(args) ? args.slice(0, 8) : [],
    characterID: getCharacterID(session),
    timestamp: Date.now(),
  };
  logStringEvents.push(event);
  if (logStringEvents.length > MAX_LOG_STRING_EVENTS) {
    logStringEvents.splice(0, logStringEvents.length - MAX_LOG_STRING_EVENTS);
  }
  return event;
}

class ClientStatLoggerService extends BaseService {
  constructor() {
    super("clientStatLogger");
  }

  Handle_LogString(args, session) {
    const list = Array.isArray(args) ? args : [];
    const event = recordLogString(list, session);
    log.debug(`[ClientStatLogger] LogString ${JSON.stringify(event.message)}`);
    return null;
  }
}

ClientStatLoggerService._testing = {
  getLogStringEvents() {
    return logStringEvents.slice();
  },
  resetForTests() {
    logStringEvents.length = 0;
  },
};

module.exports = ClientStatLoggerService;
