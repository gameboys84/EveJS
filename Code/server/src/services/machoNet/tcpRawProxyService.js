const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const { buildDict, normalizeText } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

const auditEvents = [];
let tunnelHost = "";
let tunnelPortsByNodeID = new Map();

function toInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
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

function defaultTunnelHost() {
  const configured = normalizeText(config.microservicesBindHost || "", "");
  if (configured && configured !== "0.0.0.0") {
    return configured;
  }
  return "127.0.0.1";
}

function buildPortDict() {
  return buildDict(
    [...tunnelPortsByNodeID.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([nodeID, port]) => [toInteger(nodeID, 0), toInteger(port, 0)]),
  );
}

class TcpRawProxyService extends BaseService {
  constructor() {
    super("tcpRawProxyService");
  }

  Handle_GetESPTunnelingAddressByNodeID(args, session) {
    const host = tunnelHost || defaultTunnelHost();
    recordAuditEvent("esp_tunneling_address_requested", args, session, {
      host,
      nodeCount: tunnelPortsByNodeID.size,
    });
    return [host, buildPortDict()];
  }

  Handle_GetTunnelsByType(args, session) {
    const tunnelType = normalizeText(args && args[0], "");
    recordAuditEvent("tunnels_by_type_requested", args, session, {
      tunnelType,
    });
    return [];
  }
}

TcpRawProxyService._testing = {
  getAuditEvents() {
    return auditEvents.map((entry) => ({
      ...entry,
      details: { ...(entry.details || {}) },
    }));
  },
  resetForTests() {
    auditEvents.length = 0;
    tunnelHost = "";
    tunnelPortsByNodeID = new Map();
  },
  setTunnelsForTests(host, portsByNodeID) {
    tunnelHost = normalizeText(host || "", "");
    tunnelPortsByNodeID = new Map(
      Object.entries(portsByNodeID || {})
        .map(([nodeID, port]) => [toInteger(nodeID, 0), toInteger(port, 0)])
        .filter(([nodeID, port]) => nodeID > 0 && port > 0),
    );
  },
};

module.exports = TcpRawProxyService;
