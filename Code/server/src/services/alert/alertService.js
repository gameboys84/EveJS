/**
 * Alert Service
 *
 * Handles client alert calls like crash reports (BeanCount).
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { strVal } = require(
  path.join(__dirname, "../../network/tcp/utils/marshal"),
);

const MAX_AUDIT_EVENTS = 100;
const MAX_AUDIT_PAYLOAD_ITEMS = 25;

// Decoded client traces can be several KB. Keep the whole thing when we can; if
// it is enormous, preserve the head AND the tail, because the exception
// type/message is the final line of a Python traceback (after every frame) and
// is the piece we actually need.
const MAX_TRACE_CHARS = 20000;
const TRACE_TAIL_CHARS = 2000;

const auditEvents = [];
const beanCountsByErrorID = new Map();

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

function normalizeDictEntries(value) {
  if (!value) {
    return [];
  }
  if (value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  if (value instanceof Map) {
    return Array.from(value.entries());
  }
  if (typeof value === "object" && !Buffer.isBuffer(value) && !Array.isArray(value)) {
    return Object.entries(value);
  }
  return [];
}

function asSequence(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }
  return null;
}

// Pulls the human-readable fields out of a SendClientStackTraceAlert payload.
// Client call is SendClientStackTraceAlert(stackID, stackTrace, mode, nextErrorKeyHash):
//   stackID    -> (adler32Hash, stackKeyString); the key arrives as a Buffer
//   stackTrace -> the full trace; arrives as a Buffer (PyLongString)
//   mode       -> 'error' | 'Error' | 'Warning' | 'Info' | ...
// Python str values unmarshal to Node Buffers, so every text field needs
// decoding (strVal handles Buffer/string/wstring/token uniformly).
function decodeStackTraceArgs(args) {
  const list = Array.isArray(args) ? args : [];
  let stackHash = null;
  let stackKey = null;
  const stackSeq = asSequence(list[0]);
  if (stackSeq) {
    stackHash = typeof stackSeq[0] === "number" ? stackSeq[0] : null;
    stackKey = stackSeq.length > 1 ? strVal(stackSeq[1]) : null;
  }
  const trace = list.length > 1 ? strVal(list[1]) : "";
  const mode = list.length > 2 ? strVal(list[2]) : null;
  return { stackHash, stackKey, mode, trace };
}

function clampTrace(trace) {
  if (typeof trace !== "string") {
    return "";
  }
  if (trace.length <= MAX_TRACE_CHARS) {
    return trace;
  }
  const head = trace.slice(0, MAX_TRACE_CHARS - TRACE_TAIL_CHARS);
  const tail = trace.slice(-TRACE_TAIL_CHARS);
  return `${head}\n…[${trace.length - MAX_TRACE_CHARS} chars omitted]…\n${tail}`;
}

function recordAuditEvent(kind, args = [], session = null, extra = {}) {
  auditEvents.push({
    kind,
    characterID: getCharacterID(session) || null,
    args: cloneValue(Array.isArray(args) ? args : []),
    ...extra,
    timestamp: Date.now(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

function recordBeanCounts(beans) {
  let entryCount = 0;
  for (const [errorID, value] of normalizeDictEntries(beans)) {
    const key = String(errorID);
    const tuple = Array.isArray(value) ? value : [];
    const count = Math.max(0, toInt(tuple[0], 0));
    const latestTime = Math.max(0, toInt(tuple[1], 0));
    const current = beanCountsByErrorID.get(key) || {
      count: 0,
      latestTime: 0,
    };
    beanCountsByErrorID.set(key, {
      count: current.count + count,
      latestTime: Math.max(current.latestTime, latestTime),
    });
    entryCount += 1;
  }
  return entryCount;
}

class AlertService extends BaseService {
  constructor() {
    super("alert");
  }

  Handle_BeanCount(args, session) {
    recordAuditEvent("bean_count", args, session);
    log.debug("[AlertService] BeanCount (crash report)");
    // Client unpacks: (nextErrorKeyHash, nodeID) = result
    return [null, null];
  }

  Handle_BeanDelivery(args, session) {
    const beans = args && args.length > 0 ? args[0] : null;
    const entryCount = recordBeanCounts(beans);
    recordAuditEvent("bean_delivery", args, session, { entryCount });
    log.debug(`[AlertService] BeanDelivery entries=${entryCount}`);
    return null;
  }

  Handle_GroupBeanDelivery(args, session) {
    const payload = args && args.length > 0 ? args[0] : null;
    const nodeID = args && args.length > 1 ? args[1] : null;
    const isCompressed = Buffer.isBuffer(payload);
    const entryCount = isCompressed ? 0 : normalizeDictEntries(payload).length;
    recordAuditEvent("group_bean_delivery", args, session, {
      byteLength: isCompressed ? payload.length : null,
      entryCount,
      nodeID: nodeID || null,
    });
    log.debug(
      `[AlertService] GroupBeanDelivery entries=${entryCount} compressed=${isCompressed}`,
    );
    return null;
  }

  Handle_GetLogModeForError(args, session) {
    const errorIDs = args && args.length > 0 ? args[0] : null;
    recordAuditEvent("get_log_mode_for_error", args, session, {
      requestedCount: normalizeDictEntries(errorIDs).length,
    });
    return [buildDict([]), buildList([])];
  }

  Handle_SendClientStackTraceAlert(args, session) {
    recordAuditEvent("send_client_stack_trace_alert", args, session);
    const { stackHash, stackKey, mode, trace } = decodeStackTraceArgs(args);
    const charID = session && session.characterID;
    log.warn(
      `[AlertService] SendClientStackTraceAlert char=${charID} ` +
        `mode=${mode || "?"} key=${stackKey || stackHash || "?"}\n` +
        clampTrace(trace),
    );
    return null;
  }
}

AlertService._testing = {
  getAuditEvents() {
    return auditEvents.slice();
  },
  getBeanCounts() {
    return new Map(beanCountsByErrorID);
  },
  resetForTests() {
    auditEvents.length = 0;
    beanCountsByErrorID.clear();
  },
};

module.exports = AlertService;
