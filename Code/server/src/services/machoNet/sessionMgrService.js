const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));

const auditEvents = [];

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function normalizeSessionID(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSessionID).filter((entry) => entry !== null);
  }
  if (value && typeof value === "object" && Array.isArray(value.items)) {
    return normalizeSessionID(value.items);
  }
  return String(value);
}

function flattenSessionIDs(value) {
  const normalized = normalizeSessionID(value);
  if (Array.isArray(normalized)) {
    return normalized.flatMap(flattenSessionIDs);
  }
  return normalized === null ? [] : [normalized];
}

function recordAuditEvent(kind, args = [], session = null, details = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: Number(session && (session.characterID || session.charid)) || null,
    details: { ...details },
    timestamp: Date.now(),
  });
}

class SessionMgrService extends BaseService {
  constructor(options = {}) {
    super("sessionMgr");
    this.getSessions = options.getSessions || (() => sessionRegistry.getSessions());
  }

  Handle_RemoveSessionsFromServer(args, session) {
    const nodeID = Number(args && args[0]) || 0;
    const sessionIDs = flattenSessionIDs(args && args[1]);
    recordAuditEvent("remove_sessions_from_server_requested", args, session, {
      nodeID,
      sessionIDs,
      removedCount: 0,
    });
    return null;
  }

  Handle_GetSessionStatistics(args, session) {
    const sessions = Array.isArray(this.getSessions()) ? this.getSessions() : [];
    recordAuditEvent("session_statistics_requested", args, session, {
      sessionCount: sessions.length,
    });
    return {
      sessions: sessions.length,
      clientSessions: sessions.filter((entry) => entry && !entry.contextOnly).length,
      contextSessions: sessions.filter((entry) => entry && entry.contextOnly).length,
    };
  }
}

SessionMgrService._testing = {
  flattenSessionIDs,
  getAuditEvents() {
    return auditEvents.map((entry) => ({
      ...entry,
      details: { ...(entry.details || {}) },
    }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

module.exports = SessionMgrService;
