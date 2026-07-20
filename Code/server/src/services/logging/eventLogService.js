const BaseService = require("../baseService");
const log = require("../../utils/logger");

const MAX_CLIENT_EVENTS = 250;
const MAX_AUDIT_PAYLOAD_ITEMS = 50;

const clientEvents = [];
const clientStatsEvents = [];

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterID(session) {
  return Math.max(
    0,
    toInt(
      session && (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
      0,
    ),
  );
}

function cloneValue(value, depth = 0) {
  if (Buffer.isBuffer(value)) {
    return {
      type: "buffer",
      byteLength: value.length,
    };
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (depth >= 3) {
    return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AUDIT_PAYLOAD_ITEMS)
      .map((entry) => cloneValue(entry, depth + 1));
  }
  if (value.type === "dict" && Array.isArray(value.entries)) {
    return {
      type: "dict",
      entries: value.entries
        .slice(0, MAX_AUDIT_PAYLOAD_ITEMS)
        .map(([key, entry]) => [cloneValue(key, depth + 1), cloneValue(entry, depth + 1)]),
    };
  }
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_AUDIT_PAYLOAD_ITEMS)) {
    result[key] = cloneValue(entry, depth + 1);
  }
  return result;
}

function normalizeColumnNames(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_AUDIT_PAYLOAD_ITEMS).map((entry) => cloneValue(entry));
}

function recordClientEvent(args = [], session = null) {
  const event = {
    category: args[0] == null ? "" : String(args[0]),
    columnNames: normalizeColumnNames(args[1]),
    eventName: args[2] == null ? "" : String(args[2]),
    values: Array.isArray(args) ? args.slice(3).map((entry) => cloneValue(entry)) : [],
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  };
  clientEvents.push(event);
  if (clientEvents.length > MAX_CLIENT_EVENTS) {
    clientEvents.splice(0, clientEvents.length - MAX_CLIENT_EVENTS);
  }
  return event;
}

function recordClientStats(args = [], session = null) {
  const event = {
    clientID: args[0] == null ? null : cloneValue(args[0]),
    locationID: args[1] == null ? null : cloneValue(args[1]),
    rows: cloneValue(Array.isArray(args[2]) ? args[2] : []),
    extra: cloneValue(args[3] == null ? [] : args[3]),
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  };
  clientStatsEvents.push(event);
  if (clientStatsEvents.length > MAX_CLIENT_EVENTS) {
    clientStatsEvents.splice(0, clientStatsEvents.length - MAX_CLIENT_EVENTS);
  }
  return event;
}

class EventLogService extends BaseService {
  constructor() {
    super("eventLog");
  }

  Handle_LogClientEvent(args, session) {
    const event = recordClientEvent(Array.isArray(args) ? args : [], session);
    log.debug(
      `[EventLog] LogClientEvent category=${event.category} event=${event.eventName}`,
    );
    return null;
  }

  Handle_LogClientStats(args, session) {
    const list = Array.isArray(args) ? args : [];
    const event = recordClientStats(list, session);
    log.debug(
      `[EventLog] LogClientStats location=${event.locationID || ""} rows=${Array.isArray(event.rows) ? event.rows.length : 0}`,
    );
    return null;
  }

  Handle_LogPlayerRequestedDisconnect(args, session) {
    log.debug("[EventLog] LogPlayerRequestedDisconnect called");
    return null;
  }
}

EventLogService._testing = {
  getClientEvents() {
    return clientEvents.slice();
  },
  getClientStatsEvents() {
    return clientStatsEvents.slice();
  },
  resetForTests() {
    clientEvents.length = 0;
    clientStatsEvents.length = 0;
  },
};

module.exports = EventLogService;
