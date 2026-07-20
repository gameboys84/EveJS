const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getTypeName } = require(path.join(
  __dirname,
  "../../common/packetTypes",
));
const { decodeAddress } = require(path.join(
  __dirname,
  "../../common/machoAddress",
));

const DEFAULT_CAPTURE_PATH = path.resolve(
  process.cwd(),
  "server/logs/service-call-shapes.jsonl",
);
const SERVER_DATA_ROOT = path.resolve(
  process.cwd(),
  "server/src/gameStore/data",
);
const DEFAULT_MEMORY_LIMIT = 2000;
const MAX_SAMPLE_ITEMS = 3;
const MAX_DEPTH = 7;

let overrideOptions = null;
let memoryEntries = [];
let lastWriteError = null;

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function isTruthy(value) {
  const normalized = normalizeText(value, "").toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function hashText(value) {
  return crypto
    .createHash("sha256")
    .update(String(value == null ? "" : value))
    .digest("hex")
    .slice(0, 16);
}

function resolveOptions() {
  if (overrideOptions) {
    return {
      enabled: Boolean(overrideOptions.enabled),
      filePath:
        overrideOptions.filePath === null
          ? null
          : normalizeText(overrideOptions.filePath, DEFAULT_CAPTURE_PATH),
      memory: overrideOptions.memory !== false,
      memoryLimit: Math.max(
        0,
        Number.isFinite(Number(overrideOptions.memoryLimit))
          ? Math.trunc(Number(overrideOptions.memoryLimit))
          : DEFAULT_MEMORY_LIMIT,
      ),
    };
  }

  const envPath = normalizeText(process.env.EVEJS_SERVICE_CALL_SHAPE_CAPTURE_PATH, "");
  const enabled = isTruthy(process.env.EVEJS_SERVICE_CALL_SHAPE_CAPTURE);
  return {
    enabled,
    filePath: envPath || DEFAULT_CAPTURE_PATH,
    memory: false,
    memoryLimit: 0,
  };
}

function isEnabled() {
  return resolveOptions().enabled;
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isForbiddenOutputPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return resolvedPath === SERVER_DATA_ROOT || isPathInside(resolvedPath, SERVER_DATA_ROOT);
}

function appendMemoryEntry(entry, options) {
  if (!options.memory || options.memoryLimit <= 0) {
    return;
  }
  memoryEntries.push(entry);
  if (memoryEntries.length > options.memoryLimit) {
    memoryEntries = memoryEntries.slice(memoryEntries.length - options.memoryLimit);
  }
}

function appendFileEntry(entry, options) {
  if (!options.filePath) {
    return;
  }
  const resolvedPath = path.resolve(options.filePath);
  if (isForbiddenOutputPath(resolvedPath)) {
    lastWriteError = {
      code: "FORBIDDEN_OUTPUT_PATH",
      pathHash: hashText(resolvedPath),
    };
    return;
  }
  try {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.appendFileSync(resolvedPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    lastWriteError = {
      code: "WRITE_FAILED",
      name: error && error.name ? error.name : "Error",
      messageHash: hashText(error && error.message ? error.message : ""),
      messageLength: String(error && error.message ? error.message : "").length,
    };
  }
}

function mapEntries(entries = []) {
  return new Map(Array.isArray(entries) ? entries : []);
}

function unwrapToken(value) {
  if (value && typeof value === "object") {
    if (value.type === "token" || value.type === "wstring" || value.type === "rawstr") {
      return normalizeText(value.value, "");
    }
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapToken(value.value);
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function summarizeColumnList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (Array.isArray(entry)) {
        return normalizeText(entry[0], "");
      }
      return normalizeText(unwrapToken(entry), "");
    }).filter(Boolean);
  }
  if (value.type === "list" && Array.isArray(value.items)) {
    return summarizeColumnList(value.items);
  }
  return [];
}

function summarizeDbRowDescriptor(value) {
  if (
    !value ||
    typeof value !== "object" ||
    (value.type !== "objectex1" && value.type !== "objectex2")
  ) {
    return null;
  }
  const header = Array.isArray(value.header) ? value.header : [];
  const descriptorName = unwrapToken(header[0]);
  if (descriptorName !== "blue.DBRowDescriptor") {
    return null;
  }
  const descriptorArgs = Array.isArray(header[1]) ? header[1] : [];
  const columns = Array.isArray(descriptorArgs[0])
    ? summarizeColumnList(descriptorArgs[0])
    : summarizeColumnList(descriptorArgs);
  return {
    kind: "dbrow-descriptor",
    name: descriptorName,
    columns,
    columnCount: columns.length,
  };
}

function summarizeRowsetObject(value, depth) {
  const args = value && value.args && value.args.type === "dict"
    ? mapEntries(value.args.entries)
    : new Map();
  const rowClass = unwrapToken(args.get("RowClass"));
  const header = args.get("header");
  const descriptor = summarizeDbRowDescriptor(header);
  const columns = summarizeColumnList(args.get("columns"));
  const headerColumns = descriptor
    ? descriptor.columns
    : summarizeColumnList(header);
  const lines = args.get("lines") || args.get("items");
  const lineCount =
    lines && lines.type === "list" && Array.isArray(lines.items)
      ? lines.items.length
      : 0;
  return {
    kind: "rowset",
    marshalType: "object",
    name: normalizeText(value && value.name, ""),
    rowClass: rowClass || null,
    columns: columns.length > 0 ? columns : headerColumns,
    columnCount: (columns.length > 0 ? columns : headerColumns).length,
    lineCount,
    descriptor,
    argShape: summarizeValue(value && value.args, depth + 1),
  };
}

function summarizeObject(value, depth) {
  const name = normalizeText(value && value.name, "");
  if (/rowset/i.test(name)) {
    return summarizeRowsetObject(value, depth);
  }
  const args = value && value.args && value.args.type === "dict"
    ? mapEntries(value.args.entries)
    : new Map();
  return {
    kind: "marshal-object",
    marshalType: "object",
    name,
    fieldKeys: [...args.keys()]
      .map((key) => normalizeText(key, ""))
      .filter(Boolean)
      .sort(),
    fieldCount: args.size,
  };
}

function summarizeObjectEx(value, depth) {
  const descriptor = summarizeDbRowDescriptor(value);
  if (descriptor) {
    return descriptor;
  }
  const header = Array.isArray(value && value.header) ? value.header : [];
  return {
    kind: "marshal-objectex",
    marshalType: value && value.type,
    name: unwrapToken(header[0]) || null,
    headerShape: summarizeValue(header, depth + 1),
    listShape: summarizeValue(value && value.list, depth + 1),
    dictShape: summarizeValue(value && value.dict, depth + 1),
  };
}

function summarizeDict(value, depth) {
  const entries = Array.isArray(value && value.entries) ? value.entries : [];
  const keyKinds = [...new Set(entries.map(([key]) => summarizeValue(key, depth + 1).kind))]
    .sort();
  const stringFieldKeys = entries
    .map(([key]) => (typeof key === "string" ? key : ""))
    .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .sort();
  return {
    kind: "marshal-dict",
    marshalType: "dict",
    entryCount: entries.length,
    keyKinds,
    fieldKeys: stringFieldKeys.slice(0, 30),
    fieldKeyCount: stringFieldKeys.length,
  };
}

function summarizeListLike(value, depth, kind, items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  return {
    kind,
    length: normalizedItems.length,
    sample: normalizedItems
      .slice(0, MAX_SAMPLE_ITEMS)
      .map((entry) => summarizeValue(entry, depth + 1)),
    truncated: normalizedItems.length > MAX_SAMPLE_ITEMS,
  };
}

function summarizeValue(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    return { kind: "max-depth" };
  }
  if (value === null) {
    return { kind: "null" };
  }
  if (value === undefined) {
    return { kind: "undefined" };
  }
  if (typeof value === "string") {
    return {
      kind: "string",
      length: value.length,
    };
  }
  if (typeof value === "number") {
    return {
      kind: Number.isInteger(value) ? "integer" : "number",
      finite: Number.isFinite(value),
    };
  }
  if (typeof value === "bigint") {
    return { kind: "bigint" };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean" };
  }
  if (Buffer.isBuffer(value)) {
    return { kind: "buffer", byteLength: value.length };
  }
  if (Array.isArray(value)) {
    return summarizeListLike(value, depth, "array", value);
  }
  if (value instanceof Set) {
    return summarizeListLike([...value], depth, "set", [...value]);
  }
  if (value instanceof Map) {
    return {
      kind: "map",
      entryCount: value.size,
      sample: [...value.entries()]
        .slice(0, MAX_SAMPLE_ITEMS)
        .map(([key, entryValue]) => ({
          key: summarizeValue(key, depth + 1),
          value: summarizeValue(entryValue, depth + 1),
        })),
      truncated: value.size > MAX_SAMPLE_ITEMS,
    };
  }
  if (!value || typeof value !== "object") {
    return { kind: typeof value };
  }

  switch (value.type) {
    case "list":
      return summarizeListLike(value, depth, "marshal-list", value.items);
    case "tuple":
      return summarizeListLike(value, depth, "marshal-tuple", value.items);
    case "set":
      return summarizeListLike(value, depth, "marshal-set", value.items);
    case "dict":
      return summarizeDict(value, depth);
    case "object":
      return summarizeObject(value, depth);
    case "objectex1":
    case "objectex2":
      return summarizeObjectEx(value, depth);
    case "packedrow": {
      const columns = summarizeColumnList(value.columns);
      return {
        kind: "packedrow",
        marshalType: "packedrow",
        columns,
        columnCount: columns.length,
        descriptor: summarizeDbRowDescriptor(value.header),
      };
    }
    case "token":
    case "wstring":
    case "rawstr":
      return {
        kind: `marshal-${value.type}`,
        length: normalizeText(value.value, "").length,
      };
    case "long":
    case "int":
    case "float":
    case "double":
    case "real":
    case "varinteger":
    case "bool":
      return {
        kind: `marshal-${value.type}`,
        valueShape: summarizeValue(value.value, depth + 1),
      };
    default:
      return {
        kind: "object",
        keys: Object.keys(value).sort().slice(0, 30),
        keyCount: Object.keys(value).length,
      };
  }
}

function summarizeSession(session) {
  if (!session || typeof session !== "object") {
    return { kind: "none" };
  }
  return {
    kind: "session",
    hasCharacterID: Boolean(session.characterID || session.charid),
    hasUserID: Boolean(session.userID || session.userid),
    hasLocationID: Boolean(session.locationid || session.solarsystemid || session.solarsystemid2),
    hasStationID: Boolean(session.stationid),
    hasSocket: Boolean(session.socket),
  };
}

function summarizeTextIdentifier(value) {
  const normalized = normalizeText(value, "");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("N=")) {
    return {
      kind: "bound-object-id",
      length: normalized.length,
    };
  }
  return {
    kind: "name",
    value: normalized,
  };
}

function summarizeAddressIdentifier(value) {
  const normalized = normalizeText(value, "");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("N=")) {
    return {
      kind: "bound-object-id",
      length: normalized.length,
    };
  }
  return {
    kind: "name",
    value: normalized,
  };
}

function summarizeAddress(address) {
  if (!address || typeof address !== "object") {
    return { kind: "none" };
  }

  const summary = {
    kind: normalizeText(address.type, "unknown"),
    service: summarizeAddressIdentifier(address.service),
    hasNodeID: address.nodeID !== undefined && address.nodeID !== null,
    hasClientID: address.clientID !== undefined && address.clientID !== null,
    hasBroadcastID: address.broadcastID !== undefined && address.broadcastID !== null,
    hasCallID: address.callID !== undefined && address.callID !== null,
  };
  if (address.callID !== undefined && address.callID !== null) {
    summary.callID = Number.isFinite(Number(address.callID))
      ? Math.trunc(Number(address.callID))
      : null;
  }
  if (address.idtype !== undefined && address.idtype !== null) {
    summary.idtype = summarizeAddressIdentifier(address.idtype);
  }
  if (address.narrowTo !== undefined && address.narrowTo !== null) {
    summary.narrowToShape = summarizeValue(address.narrowTo, 0);
  }
  if (address.raw !== undefined) {
    summary.rawShape = summarizeValue(address.raw, 0);
  }
  return summary;
}

function unwrapPacketTuple(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && value.type === "object" && Array.isArray(value.args)) {
    return value.args;
  }
  return null;
}

function decodeAddressQuiet(value) {
  const tuple = unwrapPacketTuple(value);
  if (!Array.isArray(tuple) || tuple.length < 1 || typeof tuple[0] !== "number") {
    return { type: "unknown", raw: value };
  }
  return decodeAddress(value);
}

function getPacketObjectName(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? normalizeText(value.name, "") || null
    : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }
  return null;
}

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
}

function safeServiceName(value) {
  const normalized = normalizeText(value, "");
  if (!normalized || normalized.startsWith("N=")) {
    return null;
  }
  return normalized;
}

function summarizeError(error) {
  if (!error) {
    return null;
  }
  const message = normalizeText(error.message, "");
  return {
    kind: "error",
    name: normalizeText(error.name, "Error"),
    code: normalizeText(error.code, "") || null,
    messageLength: message.length,
  };
}

function buildEntry({
  service,
  method,
  handlerName = null,
  args = [],
  kwargs = null,
  session = null,
  result = undefined,
  error = null,
  elapsedMs = 0,
  unhandled = false,
} = {}) {
  return {
    captureKind: "service-call",
    timestamp: new Date().toISOString(),
    service: normalizeText(service, "?"),
    method: normalizeText(method, "?"),
    handlerName: handlerName ? normalizeText(handlerName, "") : null,
    success: !error,
    unhandled: Boolean(unhandled),
    elapsedMs: Math.max(0, Math.trunc(Number(elapsedMs) || 0)),
    sessionShape: summarizeSession(session),
    argShape: summarizeValue(Array.isArray(args) ? args : [], 0),
    kwargShape: summarizeValue(kwargs || null, 0),
    resultShape: error ? null : summarizeValue(result, 0),
    errorShape: summarizeError(error),
  };
}

function buildNotificationEntry({
  lane = "broadcast",
  notifyType = null,
  idType = null,
  service = null,
  method = null,
  objectID = null,
  payload = [],
  kwargs = null,
  session = null,
  innerBytes = null,
  innerMarshalMs = null,
} = {}) {
  return {
    captureKind: "notification",
    timestamp: new Date().toISOString(),
    lane: normalizeText(lane, "broadcast"),
    notifyType: notifyType ? normalizeText(notifyType, "") : null,
    idType: idType ? normalizeText(idType, "") : null,
    service: service ? normalizeText(service, "") : null,
    method: method ? normalizeText(method, "") : null,
    objectIDShape: objectID ? summarizeValue(objectID, 0) : null,
    innerBytes: Number.isFinite(Number(innerBytes))
      ? Math.max(0, Math.trunc(Number(innerBytes)))
      : null,
    innerMarshalMs: Number.isFinite(Number(innerMarshalMs))
      ? Math.max(0, Math.trunc(Number(innerMarshalMs)))
      : null,
    sessionShape: summarizeSession(session),
    payloadShape: summarizeValue(Array.isArray(payload) ? payload : [], 0),
    kwargShape: summarizeValue(kwargs || null, 0),
  };
}

function buildPacketEntry({
  direction = "unknown",
  rawDecoded = null,
  packet = null,
  context = null,
  session = null,
  encodedBytes = null,
  encrypted = null,
} = {}) {
  const rawTuple = unwrapPacketTuple(rawDecoded);
  const source = packet && packet.source
    ? packet.source
    : rawTuple && rawTuple.length > 1
      ? decodeAddressQuiet(rawTuple[1])
      : null;
  const dest = packet && packet.dest
    ? packet.dest
    : rawTuple && rawTuple.length > 2
      ? decodeAddressQuiet(rawTuple[2])
      : null;
  const packetType = firstFiniteNumber(
    packet && packet.type,
    rawTuple && rawTuple[0],
  );
  const packetTypeName =
    normalizeText(packet && packet.typeName, "") ||
    (packetType !== null ? getTypeName(packetType) : null);
  const service = safeServiceName(
    context && context.service !== undefined
      ? context.service
      : packet && packet.service
        ? packet.service
        : dest && dest.service,
  );
  const target = summarizeTextIdentifier(
    context && context.service !== undefined
      ? context.service
      : packet && packet.service
        ? packet.service
        : dest && dest.service,
  );
  const callID = firstFiniteNumber(
    context && context.callID,
    source && source.callID,
    dest && dest.callID,
  );

  return {
    captureKind: "packet",
    timestamp: new Date().toISOString(),
    direction: normalizeText(direction, "unknown"),
    contextKind: context && context.kind ? normalizeText(context.kind, "") : null,
    packetType,
    packetTypeName,
    packetObjectName: getPacketObjectName(rawDecoded),
    rawTupleLength: rawTuple ? rawTuple.length : null,
    fullMachoTuple: rawTuple ? rawTuple.length === 14 : null,
    callID,
    service,
    method: context && context.method ? normalizeText(context.method, "") : null,
    targetShape: target,
    sourceShape: summarizeAddress(source),
    destShape: summarizeAddress(dest),
    sessionShape: summarizeSession(session),
    payloadShape: summarizeValue(
      packet && packet.payload !== undefined
        ? packet.payload
        : rawTuple && rawTuple.length > 4
          ? rawTuple[4]
          : null,
      0,
    ),
    namedPayloadShape: summarizeValue(
      packet && packet.namedPayload !== undefined
        ? packet.namedPayload
        : rawTuple && rawTuple.length > 5
          ? rawTuple[5]
          : null,
      0,
    ),
    oobShape: summarizeValue(
      packet && packet.oob !== undefined
        ? packet.oob
        : rawTuple && rawTuple.length > 6
          ? rawTuple[6]
          : null,
      0,
    ),
    encodedBytes: optionalNonNegativeInteger(encodedBytes),
    encrypted: encrypted === null || encrypted === undefined ? null : encrypted === true,
  };
}

function captureServiceCall(payload) {
  const options = resolveOptions();
  if (!options.enabled) {
    return null;
  }
  const entry = buildEntry(payload);
  appendMemoryEntry(entry, options);
  appendFileEntry(entry, options);
  return entry;
}

function captureNotificationShape(payload) {
  const options = resolveOptions();
  if (!options.enabled) {
    return null;
  }
  const entry = buildNotificationEntry(payload);
  appendMemoryEntry(entry, options);
  appendFileEntry(entry, options);
  return entry;
}

function capturePacketShape(payload) {
  const options = resolveOptions();
  if (!options.enabled) {
    return null;
  }
  const entry = buildPacketEntry(payload);
  appendMemoryEntry(entry, options);
  appendFileEntry(entry, options);
  return entry;
}

function configureForTests(options = {}) {
  overrideOptions = {
    enabled: Boolean(options.enabled),
    filePath: Object.prototype.hasOwnProperty.call(options, "filePath")
      ? options.filePath
      : null,
    memory: options.memory !== false,
    memoryLimit: options.memoryLimit,
  };
  memoryEntries = [];
  lastWriteError = null;
}

function resetForTests() {
  overrideOptions = null;
  memoryEntries = [];
  lastWriteError = null;
}

function getCapturedEntries() {
  return memoryEntries.map((entry) => JSON.parse(JSON.stringify(entry)));
}

function getLastWriteError() {
  return lastWriteError ? { ...lastWriteError } : null;
}

module.exports = {
  captureNotificationShape,
  capturePacketShape,
  captureServiceCall,
  configureForTests,
  getCapturedEntries,
  getLastWriteError,
  isEnabled,
  resetForTests,
  summarizeValue,
  _testing: {
    DEFAULT_CAPTURE_PATH,
    SERVER_DATA_ROOT,
    buildEntry,
    buildNotificationEntry,
    buildPacketEntry,
    hashText,
    isForbiddenOutputPath,
  },
};
