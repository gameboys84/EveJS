const path = require("path");
const zlib = require("zlib");

const config = require(path.join(__dirname, "../../config"));
const {
  buildDict,
  currentFileTime,
  normalizeBigInt,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { marshalEncode } = require(path.join(
  __dirname,
  "../../network/tcp/utils/marshal",
));

const CACHE_MODE = "server";
const CRC_HQX_POLY = 0x1021;
const CRC_HQX_SEED_OFFSET = 170472;
const MAX_VERSIONS_PER_OBJECT = 4;
const COMPRESS_THRESHOLD_BYTES = 170;
const COMPRESS_LEVEL = 1;
const CACHED_METHOD_CALL_RESULT_NAMES = new Set([
  "carbon.common.script.net.objectCaching.CachedMethodCallResult",
  "objectCaching.CachedMethodCallResult",
]);

const cachedObjects = new Map();
const cachedMethodCalls = new Map();
const methodCallCachingDetails = new Map();

function buildRawString(value) {
  return {
    type: "rawstr",
    value: String(value ?? ""),
  };
}

function buildSignedLong(value, fallback = 0n) {
  return {
    type: "long",
    value: normalizeBigInt(value, fallback),
  };
}

function buildVersionTuple(version = null) {
  const normalizedVersion = normalizeObjectVersion(version);
  if (!normalizedVersion) {
    return null;
  }

  return [buildSignedLong(normalizedVersion[0]), normalizedVersion[1]];
}

function buildVersionList(version = null) {
  const normalizedVersion = normalizeObjectVersion(version);
  if (!normalizedVersion) {
    return null;
  }

  return {
    type: "list",
    items: [buildSignedLong(normalizedVersion[0]), normalizedVersion[1]],
  };
}

function buildCacheDetails({ versionCheck = "run", sessionInfo = null } = {}) {
  const entries = [[buildRawString("versionCheck"), buildRawString(versionCheck || "run")]];
  if (sessionInfo) {
    entries.push([buildRawString("sessionInfo"), buildRawString(sessionInfo)]);
  }
  return buildDict(entries);
}

function buildDetailsRecord({ versionCheck = "run", sessionInfo = null } = {}) {
  return {
    versionCheck: versionCheck || "run",
    sessionInfo: sessionInfo ? normalizeText(sessionInfo, "") : null,
  };
}

function buildMethodCacheKey({
  serviceName = "marketProxy",
  method,
  args = [],
  sessionInfoValue = undefined,
}) {
  const key = [
    buildRawString(serviceName || "marketProxy"),
    buildRawString(method || ""),
  ];
  if (sessionInfoValue !== undefined && sessionInfoValue !== null) {
    key.push(
      typeof sessionInfoValue === "string"
        ? buildRawString(sessionInfoValue)
        : sessionInfoValue,
    );
  }
  if (Array.isArray(args)) {
    key.push(
      ...args.map((entry) =>
        typeof entry === "string" ? buildRawString(entry) : entry,
      ),
    );
  }
  return key;
}

function buildMethodObjectId(methodCacheKey) {
  return [buildRawString("Method Call"), buildRawString(CACHE_MODE), methodCacheKey];
}

function computeCrcHqx(buffer, seed = 0) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let crc = seed & 0xffff;

  for (let index = 0; index < source.length; index += 1) {
    crc ^= source[index] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ CRC_HQX_POLY) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc;
}

function normalizeObjectVersion(value) {
  if (value && value.type === "list") {
    value = value.items;
  }

  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  return [
    normalizeBigInt(value[0], 0n),
    Number(value[1]) || 0,
  ];
}

function getDictEntry(dictObj, keyName) {
  if (!dictObj || dictObj.type !== "dict" || !Array.isArray(dictObj.entries)) {
    return undefined;
  }

  for (const [key, value] of dictObj.entries) {
    if (normalizeText(normalizeCacheIdentity(key), "") === keyName) {
      return value;
    }
  }
  return undefined;
}

function normalizeArgsArray(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.items)) {
    return value.items;
  }
  return [value];
}

function buildMethodDetailsKey(serviceName, method) {
  return JSON.stringify([
    normalizeText(normalizeCacheIdentity(serviceName), ""),
    normalizeText(normalizeCacheIdentity(method), ""),
  ]);
}

function getSessionInfoValue(session, sessionInfo = null) {
  const key = normalizeText(sessionInfo, "");
  if (!session || !key) {
    return undefined;
  }

  const aliases = {
    charid: ["charid", "charID", "characterID"],
    corpid: ["corpid", "corpID", "corporationID"],
    regionid: ["regionid", "regionID"],
    solarsystemid2: ["solarsystemid2", "solarsystemid", "solarSystemID"],
    solarsystemid: ["solarsystemid", "solarsystemid2", "solarSystemID"],
    stationid: ["stationid", "stationID", "locationid", "locationID"],
    structureid: ["structureid", "structureID", "locationid", "locationID"],
    languageID: ["languageID", "languageid"],
  };
  const candidates = aliases[key] || [key];
  for (const candidate of candidates) {
    if (session[candidate] !== undefined && session[candidate] !== null) {
      return session[candidate];
    }
  }
  return undefined;
}

function getCachedMethodRecordKey({
  serviceName,
  method,
  args = [],
  sessionInfoValue = undefined,
}) {
  return serializeForCacheKey(buildMethodCacheKey({
    serviceName,
    method,
    args: normalizeArgsArray(args),
    sessionInfoValue,
  }));
}

function serializeForCacheKey(value) {
  return JSON.stringify(normalizeCacheIdentity(value));
}

function serializeVersionKey(version) {
  const normalizedVersion = normalizeObjectVersion(version);
  if (!normalizedVersion) {
    return "none";
  }
  return `${normalizedVersion[0].toString()}:${normalizedVersion[1]}`;
}

function maybeCompressPickle(rawPickle) {
  if (!Buffer.isBuffer(rawPickle) || rawPickle.length <= COMPRESS_THRESHOLD_BYTES) {
    return {
      pickle: rawPickle,
      compressed: 0,
    };
  }

  try {
    const compressedPickle = zlib.deflateSync(rawPickle, {
      level: COMPRESS_LEVEL,
    });
    if (compressedPickle.length < rawPickle.length) {
      return {
        pickle: compressedPickle,
        compressed: 1,
      };
    }
  } catch (error) {
    // Fall back to the raw marshal payload if compression fails.
  }

  return {
    pickle: rawPickle,
    compressed: 0,
  };
}

function buildUtilCachedObjectReference(record) {
  return {
    type: "object",
    name: buildRawString("carbon.common.script.net.cachedObject.CachedObject"),
    args: [
      record.objectId,
      record.nodeId,
      buildVersionTuple(record.objectVersion),
    ],
  };
}

function storeCachedObjectRecord(record) {
  if (!record || record.objectId === undefined || record.objectId === null) {
    return null;
  }

  const objectIdKey = serializeForCacheKey(record.objectId);
  let bucket = cachedObjects.get(objectIdKey);
  if (!bucket) {
    bucket = {
      currentVersionKey: null,
      records: new Map(),
    };
    cachedObjects.set(objectIdKey, bucket);
  }

  const versionKey = serializeVersionKey(record.objectVersion);
  bucket.records.set(versionKey, {
    objectId: record.objectId,
    nodeId: Number(record.nodeId) || config.proxyNodeId,
    objectVersion: normalizeObjectVersion(record.objectVersion),
    shared: record.shared !== false,
    pickle: Buffer.isBuffer(record.pickle)
      ? record.pickle
      : Buffer.from(record.pickle || []),
    compressed: record.compressed ? 1 : 0,
    usedAtMs: Date.now(),
  });
  bucket.currentVersionKey = versionKey;

  while (bucket.records.size > MAX_VERSIONS_PER_OBJECT) {
    const oldestKey = bucket.records.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    bucket.records.delete(oldestKey);
  }

  return bucket.records.get(versionKey) || null;
}

function buildCachedObjectResponse(record) {
  return {
    type: "object",
    name: buildRawString("carbon.common.script.net.objectCaching.CachedObject"),
    args: [
      buildVersionTuple(record.objectVersion),
      null,
      record.nodeId,
      record.shared ? 1 : 0,
      { type: "bytes", value: record.pickle },
      record.compressed ? 1 : 0,
      record.objectId,
    ],
  };
}

function computeSignedAdler32(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;

  for (let index = 0; index < source.length; index += 1) {
    a = (a + source[index]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }

  const unsignedValue = (((b << 16) | a) >>> 0);
  return unsignedValue > 0x7fffffff
    ? unsignedValue - 0x100000000
    : unsignedValue;
}

function buildCachedMethodCallResult(result, options = {}) {
  const {
    serviceName = "marketProxy",
    method,
    args = [],
    versionCheck = "run",
    sessionInfo = null,
    sessionInfoValue = undefined,
    proxyCache = false,
  } = options;
  const details = buildCacheDetails({ versionCheck, sessionInfo });
  const rawPickle = marshalEncode(result);
  const version = [
    buildSignedLong(currentFileTime()),
    computeSignedAdler32(rawPickle),
  ];
  const detailsRecord = buildDetailsRecord({ versionCheck, sessionInfo });
  const cacheRecordKey = getCachedMethodRecordKey({
    serviceName,
    method,
    args,
    sessionInfoValue,
  });

  methodCallCachingDetails.set(
    buildMethodDetailsKey(serviceName, method),
    detailsRecord,
  );
  cachedMethodCalls.set(cacheRecordKey, {
    serviceName: normalizeText(serviceName, "marketProxy"),
    method: normalizeText(method, ""),
    args: normalizeArgsArray(args),
    sessionInfoValue,
    details: detailsRecord,
    version: normalizeObjectVersion(version),
    usedAtMs: Date.now(),
  });

  if (proxyCache) {
    const methodCacheKey = buildMethodCacheKey({
      serviceName,
      method,
      args: normalizeArgsArray(args),
      sessionInfoValue,
    });
    const objectId = buildMethodObjectId(methodCacheKey);
    const compressedRecord = maybeCompressPickle(rawPickle);
    const objectVersion = [
      buildSignedLong(currentFileTime()),
      computeCrcHqx(
        compressedRecord.pickle,
        (Number(config.machoVersion) || 0) +
          (Number(config.eveBirthday) || CRC_HQX_SEED_OFFSET),
      ),
    ];
    const cachedObjectRecord = storeCachedObjectRecord({
      objectId,
      nodeId: config.proxyNodeId,
      objectVersion,
      shared: true,
      pickle: compressedRecord.pickle,
      compressed: compressedRecord.compressed,
    });

    return {
      type: "object",
      name: buildRawString(
        "carbon.common.script.net.objectCaching.CachedMethodCallResult",
      ),
      args: [
        details,
        buildUtilCachedObjectReference(cachedObjectRecord),
        null,
      ],
    };
  }

  return {
    type: "object",
    name: buildRawString(
      "carbon.common.script.net.objectCaching.CachedMethodCallResult",
    ),
    args: [
      details,
      { type: "substream", value: result },
      buildVersionList(version),
    ],
  };
}

function getCachedMethodCallVersion({
  serviceName,
  method,
  args = [],
  session = null,
} = {}) {
  const details = methodCallCachingDetails.get(
    buildMethodDetailsKey(serviceName, method),
  ) || null;
  if (!details) {
    return 0;
  }

  const sessionInfoValue = details.sessionInfo
    ? getSessionInfoValue(session, details.sessionInfo)
    : undefined;
  const record = cachedMethodCalls.get(getCachedMethodRecordKey({
    serviceName,
    method,
    args,
    sessionInfoValue,
  })) || null;
  if (!record || !record.version) {
    return 0;
  }

  record.usedAtMs = Date.now();
  return Number(record.version[1]) || 0;
}

function invalidateCachedMethodCall({
  serviceName,
  method,
  args = [],
  session = null,
} = {}) {
  const details = methodCallCachingDetails.get(
    buildMethodDetailsKey(serviceName, method),
  ) || null;
  let deleted = 0;
  const normalizedArgs = normalizeArgsArray(args);
  const candidateValues = [undefined];
  if (details && details.sessionInfo) {
    candidateValues.push(getSessionInfoValue(session, details.sessionInfo));
  }

  for (const sessionInfoValue of candidateValues) {
    const recordKey = getCachedMethodRecordKey({
      serviceName,
      method,
      args: normalizedArgs,
      sessionInfoValue,
    });
    if (cachedMethodCalls.delete(recordKey)) {
      deleted += 1;
    }
  }

  return deleted;
}

function invalidateCachedMethodCalls(methodCalls = [], session = null) {
  let deleted = 0;
  for (const methodCall of normalizeArgsArray(methodCalls)) {
    if (!Array.isArray(methodCall) || methodCall.length < 2) {
      continue;
    }
    deleted += invalidateCachedMethodCall({
      serviceName: methodCall[0],
      method: methodCall[1],
      args: normalizeArgsArray(methodCall[2]),
      session,
    });
  }
  return deleted;
}

function invalidateCachedObjects(objectIds = []) {
  let deleted = 0;
  for (const objectId of normalizeArgsArray(objectIds)) {
    const fullKey = serializeForCacheKey(objectId);
    if (cachedMethodCalls.delete(fullKey)) {
      deleted += 1;
    }

    const keySource = Array.isArray(objectId) && objectId.length > 0
      ? objectId[0]
      : objectId;
    const objectKey = serializeForCacheKey(keySource);
    if (cachedObjects.delete(objectKey)) {
      deleted += 1;
    }
    if (cachedMethodCalls.delete(objectKey)) {
      deleted += 1;
    }
  }
  return deleted;
}

function getCachedObject(objectId) {
  const bucket = cachedObjects.get(serializeForCacheKey(objectId));
  if (!bucket || !bucket.currentVersionKey) {
    return null;
  }
  const record = bucket.records.get(bucket.currentVersionKey) || null;
  return record && record.cachedObject !== undefined ? record.cachedObject : null;
}

function getCachedObjectVersion(objectId) {
  const bucket = cachedObjects.get(serializeForCacheKey(objectId));
  if (!bucket || !bucket.currentVersionKey) {
    return 0;
  }
  const record = bucket.records.get(bucket.currentVersionKey) || null;
  const version = record ? normalizeObjectVersion(record.objectVersion) : null;
  return version ? buildVersionTuple(version) : 0;
}

function isCachedMethodCallResult(value) {
  if (!value || typeof value !== "object" || value.type !== "object") {
    return false;
  }

  return CACHED_METHOD_CALL_RESULT_NAMES.has(
    normalizeText(normalizeCacheIdentity(value.name), ""),
  );
}

function getCachedMethodCallResultVersion(value) {
  if (!isCachedMethodCallResult(value) || !Array.isArray(value.args)) {
    return null;
  }

  return normalizeObjectVersion(value.args[2]);
}

function getMachoVersionFromKwargs(kwargs) {
  const machoVersion = getDictEntry(kwargs, "machoVersion");
  if (machoVersion === 1 || machoVersion === null || machoVersion === undefined) {
    return null;
  }
  return normalizeObjectVersion(machoVersion);
}

function shouldReturnCacheOkForCachedMethodCall(result, kwargs) {
  const localVersion = getCachedMethodCallResultVersion(result);
  const remoteVersion = getMachoVersionFromKwargs(kwargs);
  if (!localVersion || !remoteVersion) {
    return false;
  }

  // Target client CacheOK comparison checks the result checksum, not the
  // wallclock component of the version tuple.
  return Number(localVersion[1]) === Number(remoteVersion[1]);
}

function getCachableObjectResponse(shared, objectId, objectVersion, nodeId) {
  const objectIdKey = serializeForCacheKey(objectId);
  const bucket = cachedObjects.get(objectIdKey);
  if (!bucket) {
    return null;
  }

  const requestedVersionKey = serializeVersionKey(objectVersion);
  let record = bucket.records.get(requestedVersionKey);
  if (!record && bucket.currentVersionKey) {
    record = bucket.records.get(bucket.currentVersionKey) || null;
  }
  if (!record) {
    return null;
  }

  return buildCachedObjectResponse({
    ...record,
    shared: Boolean(shared),
    nodeId: Number(nodeId) || record.nodeId,
  });
}

function describeObjectId(objectId) {
  try {
    if (!Array.isArray(objectId) || objectId.length < 3) {
      return normalizeText(normalizeCacheIdentity(objectId), "unknown");
    }
    const methodCall = Array.isArray(objectId[2]) ? objectId[2] : [];
    return `${normalizeText(normalizeCacheIdentity(methodCall[0]), "unknown")}::${normalizeText(normalizeCacheIdentity(methodCall[1]), "unknown")}`;
  } catch (error) {
    return "unknown";
  }
}

function normalizeCacheIdentity(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCacheIdentity(entry));
  }
  if (typeof value === "object") {
    if (value.type === "rawstr" || value.type === "wstring" || value.type === "token") {
      return normalizeText(value.value, "");
    }
    if (value.type === "long" || value.type === "int") {
      return normalizeBigInt(value.value, 0n).toString();
    }
    if (value.type === "dict" && Array.isArray(value.entries)) {
      return value.entries.map(([key, entryValue]) => [
        normalizeCacheIdentity(key),
        normalizeCacheIdentity(entryValue),
      ]);
    }
  }
  return normalizeText(value, "");
}

module.exports = {
  buildCachedMethodCallResult,
  getCachedMethodCallVersion,
  getCachableObjectResponse,
  getCachedObject,
  getCachedObjectVersion,
  getCachedMethodCallResultVersion,
  getMachoVersionFromKwargs,
  invalidateCachedMethodCall,
  invalidateCachedMethodCalls,
  invalidateCachedObjects,
  isCachedMethodCallResult,
  shouldReturnCacheOkForCachedMethodCall,
  __testHooks: {
    buildMethodCacheKey,
    buildMethodObjectId,
    computeSignedAdler32,
    computeCrcHqx,
    describeObjectId,
    normalizeObjectVersion,
  },
};
