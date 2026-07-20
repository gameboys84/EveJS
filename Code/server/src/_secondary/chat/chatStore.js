const fs = require("fs");
const path = require("path");
const {
  getXmppConferenceDomain,
  getXmppConferenceDomainPattern,
} = require(path.join(__dirname, "../../services/chat/xmppConfig"));
const database = require(path.join(__dirname, "../../gameStore"));

const DATA_ROOT = path.resolve(
  process.env.EVEJS_CHAT_DATA_ROOT || path.join(__dirname, "../data/chat"),
);
const STATE_PATH = path.join(DATA_ROOT, "state.json");
const BACKLOG_DIR = path.join(DATA_ROOT, "backlog");
const DISCOVERY_PATH = path.join(DATA_ROOT, "staticContracts.json");
const CHAT_STATE_TABLE = "chatState";
const CHAT_DISCOVERY_TABLE = "chatStaticContracts";
const CHAT_BACKLOG_TABLE = "chatBacklog";
const STATE_VERSION = 1;
const DEFAULT_STATE = Object.freeze({
  version: STATE_VERSION,
  nextPlayerChannelID: 1000000,
  nextPrivateChannelID: 1,
  channels: {},
  privateChannelByPair: {},
});

let stateCache = null;
let discoveryCache = null;
let backlogStateCache = null;
const backlogCache = new Map();
let legacyStateImportChecked = false;
let legacyDiscoveryImportChecked = false;
let legacyBacklogImportChecked = false;
const INVALID_ROOM_NAMES = new Set([
  "[object object]",
]);
const LEGACY_ROOM_NAME_ALIASES = Object.freeze({
  system_evejs_elysian_chat: "player_900001",
  system_263328_900001: "player_900001",
});

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath),
  );
  return Boolean(
    relativePath &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath),
  );
}

function removeLegacyChatFiles() {
  if (!fs.existsSync(DATA_ROOT)) {
    return;
  }

  const sqlitePath = database._sqliteDbPath;
  if (!sqlitePath || !isPathInside(DATA_ROOT, sqlitePath)) {
    fs.rmSync(DATA_ROOT, {
      recursive: true,
      force: true,
    });
    return;
  }

  for (const legacyFilePath of [STATE_PATH, DISCOVERY_PATH]) {
    if (fs.existsSync(legacyFilePath)) {
      fs.unlinkSync(legacyFilePath);
    }
  }
  if (fs.existsSync(BACKLOG_DIR)) {
    fs.rmSync(BACKLOG_DIR, {
      recursive: true,
      force: true,
    });
  }
}

function ensureRuntimeTable(table) {
  database.ensureTable(table);
}

function readRuntimeTable(table, fallback = {}) {
  ensureRuntimeTable(table);
  const result = database.read(table, "/");
  if (result.success && result.data && typeof result.data === "object") {
    return cloneValue(result.data);
  }
  return cloneValue(fallback);
}

function writeRuntimeTable(table, value, options = {}) {
  ensureRuntimeTable(table);
  const result = database.write(table, "/", value, { force: true });
  if (!result.success) {
    return false;
  }
  if (options.flush === true) {
    const flushResult = database.flushTableSync(table);
    return Boolean(flushResult && flushResult.success);
  }
  return true;
}

function buildDefaultBacklogState() {
  return {
    version: STATE_VERSION,
    entriesByRoomName: {},
  };
}

function normalizeBacklogPayload(payload = {}) {
  const nextState = buildDefaultBacklogState();
  nextState.version = normalizePositiveInteger(payload && payload.version, STATE_VERSION);
  const entriesByRoomName =
    payload &&
    payload.entriesByRoomName &&
    typeof payload.entriesByRoomName === "object"
      ? payload.entriesByRoomName
      : {};

  for (const [roomName, entries] of Object.entries(entriesByRoomName)) {
    const normalizedRoomName = normalizeString(roomName, "").trim();
    if (!normalizedRoomName || !Array.isArray(entries)) {
      continue;
    }
    nextState.entriesByRoomName[normalizedRoomName] = entries
      .filter(Boolean)
      .map((entry) => cloneValue(entry));
  }
  return nextState;
}

function hasBacklogEntries(backlogState) {
  return Object.values((backlogState && backlogState.entriesByRoomName) || {})
    .some((entries) => Array.isArray(entries) && entries.length > 0);
}

function readLegacyBacklogFromDisk() {
  const nextState = buildDefaultBacklogState();
  if (!fs.existsSync(BACKLOG_DIR)) {
    return nextState;
  }

  for (const entry of fs.readdirSync(BACKLOG_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) {
      continue;
    }
    const roomName = normalizeString(entry.name.slice(0, -".jsonl".length), "").trim();
    if (!roomName) {
      continue;
    }
    const backlogPath = path.join(BACKLOG_DIR, entry.name);
    try {
      const entries = fs
        .readFileSync(backlogPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (error) {
            return null;
          }
        })
        .filter(Boolean);
      if (entries.length > 0) {
        nextState.entriesByRoomName[roomName] = entries;
      }
    } catch (error) {
      // Ignore unreadable legacy backlog files; the runtime table is authoritative.
    }
  }
  return nextState;
}

function loadBacklogFromStore() {
  const stored = normalizeBacklogPayload(
    readRuntimeTable(CHAT_BACKLOG_TABLE, buildDefaultBacklogState()),
  );

  if (!hasBacklogEntries(stored) && !legacyBacklogImportChecked) {
    legacyBacklogImportChecked = true;
    const legacy = readLegacyBacklogFromDisk();
    if (hasBacklogEntries(legacy)) {
      writeRuntimeTable(CHAT_BACKLOG_TABLE, legacy, { flush: true });
      return legacy;
    }
  }
  return stored;
}

function getBacklogState() {
  if (!backlogStateCache) {
    backlogStateCache = loadBacklogFromStore();
  }
  return backlogStateCache;
}

function getBacklogCacheEntry(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return [];
  }

  if (backlogCache.has(normalizedRoomName)) {
    return backlogCache.get(normalizedRoomName).map((entry) => cloneValue(entry));
  }

  const entries = getBacklogState().entriesByRoomName[normalizedRoomName] || [];
  backlogCache.set(normalizedRoomName, entries.map((entry) => cloneValue(entry)));
  return entries.map((entry) => cloneValue(entry));
}

function writeBacklogEntries(roomName, entries = []) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return false;
  }

  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .map((entry) => cloneValue(entry));
  const backlogState = getBacklogState();
  if (normalizedEntries.length === 0) {
    delete backlogState.entriesByRoomName[normalizedRoomName];
    backlogCache.delete(normalizedRoomName);
  } else {
    backlogState.entriesByRoomName[normalizedRoomName] = normalizedEntries;
    backlogCache.set(normalizedRoomName, normalizedEntries.map((entry) => cloneValue(entry)));
  }

  return writeRuntimeTable(CHAT_BACKLOG_TABLE, backlogState);
}

function unwrapMarshalScalar(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapMarshalScalar(value.value);
    }
    if (
      value.type === "object" &&
      Object.prototype.hasOwnProperty.call(value, "name")
    ) {
      return unwrapMarshalScalar(value.name);
    }
  }
  return value;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

function normalizeString(value, fallback = "") {
  const unwrappedValue = unwrapMarshalScalar(value);
  if (typeof unwrappedValue === "string") {
    return unwrappedValue;
  }
  if (unwrappedValue === null || unwrappedValue === undefined) {
    return fallback;
  }
  return String(unwrappedValue);
}

function normalizeRoomName(value) {
  let roomName = normalizeString(value, "").trim();
  if (!roomName) {
    return "";
  }

  if (getXmppConferenceDomainPattern().test(roomName)) {
    roomName = roomName.split("@")[0].trim();
  }

  const normalizedRoomName = roomName.toLowerCase();
  if (
    !roomName ||
    INVALID_ROOM_NAMES.has(normalizedRoomName) ||
    normalizedRoomName === String(getXmppConferenceDomain()).toLowerCase()
  ) {
    return "";
  }

  return resolveRoomNameAlias(roomName);
}

function resolveRoomNameAlias(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim().toLowerCase();
  if (!normalizedRoomName) {
    return "";
  }
  return LEGACY_ROOM_NAME_ALIASES[normalizedRoomName] || normalizeString(roomName, "").trim();
}

function normalizeDisplayName(value, fallback = "") {
  const displayName = normalizeString(value, fallback).trim();
  if (!displayName || displayName === "[object Object]") {
    return normalizeString(fallback, "").trim();
  }
  return displayName;
}

function normalizeUniqueIntegerList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizePositiveInteger(value, 0))
      .filter((value) => value > 0),
  )].sort((left, right) => left - right);
}

function normalizeModerationMap(entries = {}) {
  const nextEntries = {};
  if (!entries || typeof entries !== "object") {
    return nextEntries;
  }

  for (const [rawCharacterID, entry] of Object.entries(entries)) {
    const characterID = normalizePositiveInteger(rawCharacterID, 0);
    if (!characterID) {
      continue;
    }

    nextEntries[String(characterID)] = {
      characterID,
      untilMs: Math.max(0, Number(entry && entry.untilMs) || 0),
      reason: normalizeString(entry && entry.reason, ""),
      byCharacterID: normalizePositiveInteger(entry && entry.byCharacterID, 0),
      createdAtMs: Math.max(0, Number(entry && entry.createdAtMs) || 0),
    };
  }

  return nextEntries;
}

function normalizeChannelRecord(record = {}) {
  const roomName = normalizeRoomName(record.roomName);
  if (!roomName) {
    return null;
  }

  const type = normalizeString(record.type, "system").trim().toLowerCase() || "system";
  const scope = normalizeString(record.scope, type).trim().toLowerCase() || type;
  const nowMs = Date.now();
  const ownerCharacterID = normalizePositiveInteger(record.ownerCharacterID, 0);
  const passwordRequired = Boolean(record.passwordRequired);
  const password = passwordRequired ? normalizeString(record.password, "") : "";
  const operatorCharacterIDs = normalizeUniqueIntegerList(record.operatorCharacterIDs);
  return {
    roomName,
    type,
    scope,
    entityID: normalizePositiveInteger(record.entityID, 0),
    displayName: normalizeDisplayName(record.displayName, roomName),
    motd: normalizeString(record.motd, ""),
    topic: normalizeString(record.topic, ""),
    ownerCharacterID,
    password,
    passwordRequired,
    static: record.static !== false,
    verifiedContract: record.verifiedContract === true,
    contractSource: normalizeString(record.contractSource, "runtime"),
    memberless: Boolean(record.memberless),
    temporary: Boolean(record.temporary),
    destroyWhenEmpty: Boolean(record.destroyWhenEmpty),
    inviteOnly: Boolean(record.inviteOnly),
    persistBacklog: record.persistBacklog !== false,
    backlogLimit: Math.max(0, Number(record.backlogLimit) || 100),
    createdAtMs: Math.max(0, Number(record.createdAtMs) || nowMs),
    updatedAtMs: Math.max(0, Number(record.updatedAtMs) || nowMs),
    inviteToken: normalizeString(record.inviteToken, ""),
    invitedCharacters: normalizeUniqueIntegerList(record.invitedCharacters),
    adminCharacterIDs: normalizeUniqueIntegerList(record.adminCharacterIDs),
    operatorCharacterIDs:
      type === "player" && ownerCharacterID > 0
        ? normalizeUniqueIntegerList([
            ...operatorCharacterIDs,
            ownerCharacterID,
          ])
        : operatorCharacterIDs,
    allowCharacterIDs: normalizeUniqueIntegerList(record.allowCharacterIDs),
    denyCharacterIDs: normalizeUniqueIntegerList(record.denyCharacterIDs),
    allowCorporationIDs: normalizeUniqueIntegerList(record.allowCorporationIDs),
    denyCorporationIDs: normalizeUniqueIntegerList(record.denyCorporationIDs),
    allowAllianceIDs: normalizeUniqueIntegerList(record.allowAllianceIDs),
    denyAllianceIDs: normalizeUniqueIntegerList(record.denyAllianceIDs),
    allowedParticipantCharacterIDs: normalizeUniqueIntegerList(
      record.allowedParticipantCharacterIDs,
    ),
    metadata:
      record.metadata && typeof record.metadata === "object"
        ? cloneValue(record.metadata)
        : {},
    mutedCharacters: normalizeModerationMap(record.mutedCharacters),
    bannedCharacters: normalizeModerationMap(record.bannedCharacters),
  };
}

function buildDefaultState() {
  return cloneValue(DEFAULT_STATE);
}

function normalizeStatePayload(parsed = {}) {
  const nextState = buildDefaultState();
  nextState.version = normalizePositiveInteger(parsed && parsed.version, STATE_VERSION);
  nextState.nextPlayerChannelID = Math.max(
    1000000,
    normalizePositiveInteger(parsed && parsed.nextPlayerChannelID, 1000000),
  );
  nextState.nextPrivateChannelID = Math.max(
    1,
    normalizePositiveInteger(parsed && parsed.nextPrivateChannelID, 1),
  );

  const channels = parsed && parsed.channels && typeof parsed.channels === "object"
    ? parsed.channels
    : {};
  for (const [roomName, rawRecord] of Object.entries(channels)) {
    const normalized = normalizeChannelRecord({
      ...rawRecord,
      roomName,
    });
    if (!normalized) {
      continue;
    }
    nextState.channels[normalized.roomName] = normalized;
  }

  const privateChannelByPair =
    parsed &&
    parsed.privateChannelByPair &&
    typeof parsed.privateChannelByPair === "object"
      ? parsed.privateChannelByPair
      : {};
  for (const [pairKey, roomName] of Object.entries(privateChannelByPair)) {
    const normalizedRoomName = normalizeString(roomName, "").trim();
    if (!normalizedRoomName) {
      continue;
    }
    nextState.privateChannelByPair[normalizeString(pairKey, "")] =
      normalizedRoomName;
  }

  return nextState;
}

function hasRuntimeState(state) {
  return Boolean(
    state &&
      (
        Object.keys(state.channels || {}).length > 0 ||
        Object.keys(state.privateChannelByPair || {}).length > 0 ||
        Number(state.nextPlayerChannelID) > DEFAULT_STATE.nextPlayerChannelID ||
        Number(state.nextPrivateChannelID) > DEFAULT_STATE.nextPrivateChannelID
      ),
  );
}

function readLegacyStateFromDisk() {
  if (!fs.existsSync(STATE_PATH)) {
    return buildDefaultState();
  }

  try {
    return normalizeStatePayload(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  } catch (error) {
    return buildDefaultState();
  }
}

function loadStateFromStore() {
  const stored = normalizeStatePayload(
    readRuntimeTable(CHAT_STATE_TABLE, buildDefaultState()),
  );

  if (!hasRuntimeState(stored) && !legacyStateImportChecked) {
    legacyStateImportChecked = true;
    const legacy = readLegacyStateFromDisk();
    if (hasRuntimeState(legacy)) {
      writeRuntimeTable(CHAT_STATE_TABLE, legacy, { flush: true });
      return legacy;
    }
  }
  return stored;
}

function getState() {
  if (!stateCache) {
    stateCache = loadStateFromStore();
  }
  return stateCache;
}

function flushStateNow() {
  return writeRuntimeTable(CHAT_STATE_TABLE, getState(), { flush: true });
}

function scheduleStateWrite() {
  writeRuntimeTable(CHAT_STATE_TABLE, getState());
}

function buildDefaultDiscovery() {
  return {
    version: STATE_VERSION,
    observations: {},
  };
}

function normalizeDiscoveryPayload(parsed = {}) {
  const nextDiscovery = buildDefaultDiscovery();
  nextDiscovery.version = normalizePositiveInteger(parsed && parsed.version, STATE_VERSION);
  const observations =
    parsed && parsed.observations && typeof parsed.observations === "object"
      ? parsed.observations
      : {};
  for (const [roomName, entries] of Object.entries(observations)) {
    const normalizedRoomName = normalizeString(roomName, "").trim();
    if (!normalizedRoomName || !Array.isArray(entries)) {
      continue;
    }
    nextDiscovery.observations[normalizedRoomName] = entries
      .filter(Boolean)
      .map((entry) => cloneValue(entry));
  }
  return nextDiscovery;
}

function hasDiscoveryObservations(discovery) {
  return Object.values((discovery && discovery.observations) || {})
    .some((entries) => Array.isArray(entries) && entries.length > 0);
}

function readLegacyDiscoveryFromDisk() {
  if (!fs.existsSync(DISCOVERY_PATH)) {
    return buildDefaultDiscovery();
  }

  try {
    return normalizeDiscoveryPayload(JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8")));
  } catch (error) {
    return buildDefaultDiscovery();
  }
}

function loadDiscoveryFromStore() {
  const stored = normalizeDiscoveryPayload(
    readRuntimeTable(CHAT_DISCOVERY_TABLE, buildDefaultDiscovery()),
  );

  if (!hasDiscoveryObservations(stored) && !legacyDiscoveryImportChecked) {
    legacyDiscoveryImportChecked = true;
    const legacy = readLegacyDiscoveryFromDisk();
    if (hasDiscoveryObservations(legacy)) {
      writeRuntimeTable(CHAT_DISCOVERY_TABLE, legacy, { flush: true });
      return legacy;
    }
  }
  return stored;
}

function getDiscovery() {
  if (!discoveryCache) {
    discoveryCache = loadDiscoveryFromStore();
  }
  return discoveryCache;
}

function flushDiscoveryNow() {
  return writeRuntimeTable(CHAT_DISCOVERY_TABLE, getDiscovery(), { flush: true });
}

function scheduleDiscoveryWrite() {
  writeRuntimeTable(CHAT_DISCOVERY_TABLE, getDiscovery());
}

function getChannelRecord(roomName) {
  const record = getState().channels[normalizeString(roomName, "").trim()];
  return record ? cloneValue(record) : null;
}

function setChannelRecord(record) {
  const normalized = normalizeChannelRecord(record);
  if (!normalized) {
    return null;
  }
  normalized.updatedAtMs = Date.now();
  getState().channels[normalized.roomName] = normalized;
  scheduleStateWrite();
  return cloneValue(normalized);
}

function updateChannelRecord(roomName, mutator) {
  const current = getChannelRecord(roomName) || normalizeChannelRecord({ roomName });
  const nextRecord = mutator ? mutator(cloneValue(current)) : current;
  return setChannelRecord({
    ...nextRecord,
    roomName: normalizeString(roomName, "").trim(),
  });
}

function deleteChannelRecord(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(getState().channels, normalizedRoomName)) {
    return false;
  }

  delete getState().channels[normalizedRoomName];
  for (const [pairKey, mappedRoomName] of Object.entries(getState().privateChannelByPair)) {
    if (mappedRoomName === normalizedRoomName) {
      delete getState().privateChannelByPair[pairKey];
    }
  }
  scheduleStateWrite();
  return true;
}

function listChannelRecords() {
  return Object.values(getState().channels).map((record) => cloneValue(record));
}

function getBacklogPath(roomName) {
  const safeFileName = normalizeString(roomName, "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .slice(0, 200);
  return path.join(BACKLOG_DIR, `${safeFileName || "channel"}.jsonl`);
}

function appendBacklogEntry(roomName, entry, options = {}) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return false;
  }

  const limit = Math.max(0, Number(options.limit) || 0);
  const nextEntry = {
    roomName: normalizedRoomName,
    createdAtMs: Date.now(),
    ...cloneValue(entry),
  };
  const nextEntries = getBacklogCacheEntry(normalizedRoomName);
  nextEntries.push(nextEntry);
  const trimmedEntries =
    limit > 0 ? nextEntries.slice(-limit) : nextEntries;
  writeBacklogEntries(normalizedRoomName, trimmedEntries);
  return true;
}

function listBacklogEntries(roomName, limit = 50, options = {}) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return [];
  }

  const sinceMs = Math.max(0, Number(options.sinceMs) || 0);
  const afterCreatedAtMs = Math.max(0, Number(options.afterCreatedAtMs) || 0);
  const entries = getBacklogCacheEntry(normalizedRoomName).filter((entry) => {
    const createdAtMs = Math.max(0, Number(entry && entry.createdAtMs) || 0);
    if (sinceMs > 0 && createdAtMs < sinceMs) {
      return false;
    }
    if (afterCreatedAtMs > 0 && createdAtMs <= afterCreatedAtMs) {
      return false;
    }
    return true;
  });
  return entries.slice(-Math.max(0, Number(limit) || 0));
}

function clearBacklogEntries(roomName) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return;
  }
  writeBacklogEntries(normalizedRoomName, []);
}

function flushBacklogNow() {
  return writeRuntimeTable(CHAT_BACKLOG_TABLE, getBacklogState(), { flush: true });
}

function allocatePlayerChannelID() {
  const state = getState();
  const nextValue = Math.max(1000000, Number(state.nextPlayerChannelID) || 1000000);
  state.nextPlayerChannelID = nextValue + 1;
  scheduleStateWrite();
  return nextValue;
}

function allocatePrivateChannelID() {
  const state = getState();
  const nextValue = Math.max(1, Number(state.nextPrivateChannelID) || 1);
  state.nextPrivateChannelID = nextValue + 1;
  scheduleStateWrite();
  return nextValue;
}

function normalizePrivatePairKey(leftCharacterID, rightCharacterID) {
  const members = [
    normalizePositiveInteger(leftCharacterID, 0),
    normalizePositiveInteger(rightCharacterID, 0),
  ].filter((value) => value > 0);
  if (members.length !== 2) {
    return "";
  }
  members.sort((left, right) => left - right);
  return members.join(":");
}

function getPrivateChannelByPair(leftCharacterID, rightCharacterID) {
  const pairKey = normalizePrivatePairKey(leftCharacterID, rightCharacterID);
  if (!pairKey) {
    return null;
  }
  return normalizeString(getState().privateChannelByPair[pairKey], "").trim() || null;
}

function setPrivateChannelByPair(leftCharacterID, rightCharacterID, roomName) {
  const pairKey = normalizePrivatePairKey(leftCharacterID, rightCharacterID);
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!pairKey || !normalizedRoomName) {
    return null;
  }

  getState().privateChannelByPair[pairKey] = normalizedRoomName;
  scheduleStateWrite();
  return normalizedRoomName;
}

function recordStaticContractObservation(roomName, observation = {}) {
  const normalizedRoomName = normalizeString(roomName, "").trim();
  if (!normalizedRoomName) {
    return null;
  }

  const discovery = getDiscovery();
  if (!Array.isArray(discovery.observations[normalizedRoomName])) {
    discovery.observations[normalizedRoomName] = [];
  }

  discovery.observations[normalizedRoomName].push({
    observedAtMs: Date.now(),
    ...cloneValue(observation),
  });
  scheduleDiscoveryWrite();
  return cloneValue(discovery.observations[normalizedRoomName]);
}

function getPaths() {
  return {
    storage: "sqlite",
    sqlitePath: database._sqliteDbPath,
    tables: {
      state: CHAT_STATE_TABLE,
      discovery: CHAT_DISCOVERY_TABLE,
      backlog: CHAT_BACKLOG_TABLE,
    },
    legacyDataRoot: DATA_ROOT,
    legacyStatePath: STATE_PATH,
    legacyBacklogDir: BACKLOG_DIR,
    legacyDiscoveryPath: DISCOVERY_PATH,
  };
}

function reloadFromDisk() {
  stateCache = null;
  discoveryCache = null;
  backlogStateCache = null;
  backlogCache.clear();

  return {
    state: cloneValue(getState()),
    discovery: cloneValue(getDiscovery()),
    backlog: cloneValue(getBacklogState()),
  };
}

function resetAll(options = {}) {
  if (options.removeFiles === true) {
    removeLegacyChatFiles();
  }

  stateCache = buildDefaultState();
  discoveryCache = {
    version: STATE_VERSION,
    observations: {},
  };
  backlogStateCache = buildDefaultBacklogState();
  backlogCache.clear();
  legacyStateImportChecked = true;
  legacyDiscoveryImportChecked = true;
  legacyBacklogImportChecked = true;

  writeRuntimeTable(CHAT_STATE_TABLE, stateCache);
  writeRuntimeTable(CHAT_DISCOVERY_TABLE, discoveryCache);
  writeRuntimeTable(CHAT_BACKLOG_TABLE, backlogStateCache);

  if (options.flush === true) {
    flushStateNow();
    flushDiscoveryNow();
    flushBacklogNow();
  }

  return {
    state: cloneValue(stateCache),
    discovery: cloneValue(discoveryCache),
    backlog: cloneValue(backlogStateCache),
  };
}

module.exports = {
  allocatePlayerChannelID,
  allocatePrivateChannelID,
  appendBacklogEntry,
  clearBacklogEntries,
  flushBacklogNow,
  deleteChannelRecord,
  flushDiscoveryNow,
  flushStateNow,
  getBacklogPath,
  getChannelRecord,
  getDiscovery,
  getPaths,
  getPrivateChannelByPair,
  getState,
  reloadFromDisk,
  listBacklogEntries,
  listChannelRecords,
  normalizePositiveInteger,
  normalizePrivatePairKey,
  recordStaticContractObservation,
  resolveRoomNameAlias,
  resetAll,
  setChannelRecord,
  setPrivateChannelByPair,
  updateChannelRecord,
};
