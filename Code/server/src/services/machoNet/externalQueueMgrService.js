const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));

const MAX_AUDIT_EVENTS = 500;
const auditEvents = [];

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, details = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    nodeID: details.nodeID || null,
    characterID: Number(session && (session.characterID || session.charid)) || null,
    details: { ...details },
    timestamp: Date.now(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

class ExternalQueueMgrService extends BaseService {
  constructor() {
    super("externalQueueMgr");
  }

  Handle_PublishProxyEvent(args, session) {
    recordAuditEvent("proxy_event_published", args, session, {
      nodeID: Number(args && args[0]) || null,
      proxyName: args && args[1] ? String(args[1]) : "",
      proxyIPv4: Number(args && args[2]) || 0,
      espIPv4: Number(args && args[3]) || 0,
      metricsPort: Number(args && args[4]) || 0,
      processID: Number(args && args[6]) || 0,
    });
    return null;
  }

  Handle_PublishEvent(args, session) {
    recordAuditEvent("event_published", args, session);
    return null;
  }

  Handle_PublishEventPayload(args, session) {
    recordAuditEvent("event_payload_published", args, session);
    return null;
  }
}

ExternalQueueMgrService._testing = {
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

module.exports = ExternalQueueMgrService;
