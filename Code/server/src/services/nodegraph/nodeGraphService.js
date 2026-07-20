const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const auditEvents = [];
const subscriptions = new Set();

function getCharacterID(session) {
  return Number(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
  ) || 0;
}

function getSessionKey(session) {
  const characterID = getCharacterID(session);
  if (characterID) {
    return `character:${characterID}`;
  }

  if (session && session.clientID) {
    return `client:${session.clientID}`;
  }

  if (session && session.id) {
    return `session:${session.id}`;
  }

  return "anonymous";
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, kwargs = null) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    kwargs: kwargs || null,
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

class NodeGraphService extends BaseService {
  constructor() {
    super("node_graph");
  }

  Handle_process_client_graph_message(args, session, kwargs) {
    const messageKey = Array.isArray(args) ? args[2] : null;
    const kind = typeof messageKey === "string" && !messageKey.startsWith("client_")
      ? "client_graph_message_rejected"
      : "client_graph_message";

    recordAuditEvent(kind, args, session, kwargs);

    if (kind === "client_graph_message_rejected") {
      log.debug(`[NodeGraph] Ignoring client graph message with server/local key: ${messageKey}`);
    }

    return null;
  }

  Handle_process_client_blackboard_request(args, session, kwargs) {
    recordAuditEvent("client_blackboard_request_no_value", args, session, kwargs);
    return null;
  }

  Handle_qa_subscribe(args, session, kwargs) {
    subscriptions.add(getSessionKey(session));
    recordAuditEvent("qa_subscribe", args, session, kwargs);
    return buildDict([]);
  }

  Handle_qa_unsubscribe(args, session, kwargs) {
    subscriptions.delete(getSessionKey(session));
    recordAuditEvent("qa_unsubscribe", args, session, kwargs);
    return null;
  }

  Handle_qa_start_node_graph(args, session, kwargs) {
    recordAuditEvent("qa_start_node_graph_ignored", args, session, kwargs);
    log.debug("[NodeGraph] Ignoring QA server graph start request; server nodegraph runtime is not authored.");
    return null;
  }

  Handle_qa_stop_node_graph(args, session, kwargs) {
    recordAuditEvent("qa_stop_node_graph", args, session, kwargs);
    return null;
  }

  Handle_qa_start_node(args, session, kwargs) {
    recordAuditEvent("qa_start_node", args, session, kwargs);
    return null;
  }

  Handle_qa_stop_node(args, session, kwargs) {
    recordAuditEvent("qa_stop_node", args, session, kwargs);
    return null;
  }

  Handle_qa_stop_active_nodes(args, session, kwargs) {
    recordAuditEvent("qa_stop_active_nodes", args, session, kwargs);
    return null;
  }
}

NodeGraphService._testing = {
  getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }));
  },
  getSubscriptions() {
    return [...subscriptions].sort();
  },
  resetForTests() {
    auditEvents.length = 0;
    subscriptions.clear();
  },
};

module.exports = NodeGraphService;
