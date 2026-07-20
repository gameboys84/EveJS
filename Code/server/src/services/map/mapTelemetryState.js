const path = require("path");

// Phase 0 / 0.C: map telemetry state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:map", { strict: true });
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildFiletimeLong,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const TABLE = "mapTelemetry";
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const DEFAULT_JUMP_RETENTION_HOURS = 168;
const MAX_JUMP_EVENTS = 10000;

function toPositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : fallback;
}

function toInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultState() {
  return {
    _meta: {
      schemaVersion: 1,
    },
    visitsByCharacterID: {},
    jumpEvents: [],
  };
}

function normalizeFiletimeString(value, fallback = null) {
  try {
    if (typeof value === "bigint") {
      return value > 0n ? value.toString() : fallback;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const normalized = BigInt(Math.trunc(value));
      return normalized > 0n ? normalized.toString() : fallback;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const normalized = BigInt(value.trim());
      return normalized > 0n ? normalized.toString() : fallback;
    }
    if (value && typeof value === "object" && value.type === "long") {
      return normalizeFiletimeString(value.value, fallback);
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function filetimeFromMs(ms = Date.now()) {
  const normalizedMs = Math.max(0, Math.trunc(Number(ms) || 0));
  return (BigInt(normalizedMs) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET).toString();
}

function msFromFiletime(value, fallback = 0) {
  const normalized = normalizeFiletimeString(value, null);
  if (!normalized) {
    return fallback;
  }
  try {
    const filetime = BigInt(normalized);
    if (filetime <= FILETIME_EPOCH_OFFSET) {
      return fallback;
    }
    return Number((filetime - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MS);
  } catch (error) {
    return fallback;
  }
}

function currentFiletimeString() {
  return currentFileTime().toString();
}

function normalizeState(source) {
  if (!source || typeof source !== "object") {
    return defaultState();
  }

  const state = {
    ...defaultState(),
    ...clone(source),
  };

  if (!state._meta || typeof state._meta !== "object") {
    state._meta = { schemaVersion: 1 };
  }
  if (!state.visitsByCharacterID || typeof state.visitsByCharacterID !== "object") {
    state.visitsByCharacterID = {};
  }
  if (!Array.isArray(state.jumpEvents)) {
    state.jumpEvents = [];
  }

  return state;
}

function readState() {
  const result = repo.read(TABLE, "/");
  if (!result.success) {
    log.warn(`[MapTelemetry] Failed to read ${TABLE}: ${result.errorMsg || "READ_ERROR"}`);
    return defaultState();
  }
  return normalizeState(result.data);
}

function writeState(state) {
  const normalized = normalizeState(state);
  const result = repo.write(TABLE, "/", normalized);
  if (!result.success) {
    log.warn(`[MapTelemetry] Failed to write ${TABLE}: ${result.errorMsg || "WRITE_ERROR"}`);
  }
  return result.success;
}

function getCharacterID(sessionOrCharacterID) {
  if (sessionOrCharacterID && typeof sessionOrCharacterID === "object") {
    return toPositiveInteger(
      sessionOrCharacterID.characterID ||
        sessionOrCharacterID.charid ||
        sessionOrCharacterID.userid ||
        0,
      0,
    );
  }
  return toPositiveInteger(sessionOrCharacterID, 0);
}

function normalizeVisitEntry(entry, solarSystemID, nowMs, nowFiletime) {
  const visits = toPositiveInteger(entry && entry.visits, 0);
  const lastDateTime = normalizeFiletimeString(
    entry && entry.lastDateTime,
    nowFiletime,
  );
  return {
    solarSystemID,
    visits,
    lastDateTime,
    lastDateTimeMs: toPositiveInteger(
      entry && entry.lastDateTimeMs,
      msFromFiletime(lastDateTime, nowMs),
    ),
  };
}

function recordSolarSystemVisit(sessionOrCharacterID, solarSystemID, options = {}) {
  const characterID = getCharacterID(sessionOrCharacterID);
  const systemID = toPositiveInteger(solarSystemID, 0);
  if (characterID <= 0 || systemID <= 0) {
    return false;
  }

  const nowMs = toPositiveInteger(options.nowMs, Date.now());
  const nowFiletime = normalizeFiletimeString(options.filetime, filetimeFromMs(nowMs));
  const state = readState();
  const characterKey = String(characterID);
  const characterState = state.visitsByCharacterID[characterKey] &&
    typeof state.visitsByCharacterID[characterKey] === "object"
    ? state.visitsByCharacterID[characterKey]
    : {
        lastSolarSystemID: null,
        systems: {},
      };

  if (!characterState.systems || typeof characterState.systems !== "object") {
    characterState.systems = {};
  }

  const systemKey = String(systemID);
  const existing = normalizeVisitEntry(
    characterState.systems[systemKey],
    systemID,
    nowMs,
    nowFiletime,
  );
  const previousSystemID = toPositiveInteger(characterState.lastSolarSystemID, 0);
  const shouldIncrement = previousSystemID !== systemID || existing.visits <= 0;

  characterState.systems[systemKey] = {
    ...existing,
    visits: shouldIncrement ? existing.visits + 1 : existing.visits,
    lastDateTime: nowFiletime,
    lastDateTimeMs: nowMs,
  };
  characterState.lastSolarSystemID = systemID;
  state.visitsByCharacterID[characterKey] = characterState;
  return writeState(state);
}

function pruneJumpEvents(events, nowMs) {
  const cutoffMs = nowMs - DEFAULT_JUMP_RETENTION_HOURS * 60 * 60 * 1000;
  const pruned = (Array.isArray(events) ? events : [])
    .filter((event) => toPositiveInteger(event && event.atMs, 0) >= cutoffMs)
    .sort((left, right) => toPositiveInteger(left && left.atMs, 0) - toPositiveInteger(right && right.atMs, 0));
  if (pruned.length <= MAX_JUMP_EVENTS) {
    return pruned;
  }
  return pruned.slice(pruned.length - MAX_JUMP_EVENTS);
}

function recordSolarSystemJump(sessionOrCharacterID, details = {}) {
  const characterID = getCharacterID(sessionOrCharacterID);
  const fromSolarSystemID = toPositiveInteger(details.fromSolarSystemID, 0);
  const toSolarSystemID = toPositiveInteger(
    details.toSolarSystemID || details.solarSystemID,
    0,
  );
  if (characterID <= 0 || toSolarSystemID <= 0) {
    return false;
  }

  const nowMs = toPositiveInteger(details.nowMs, Date.now());
  const atFiletime = normalizeFiletimeString(details.filetime, filetimeFromMs(nowMs));
  const state = readState();
  state.jumpEvents = pruneJumpEvents(state.jumpEvents, nowMs);
  state.jumpEvents.push({
    atMs: nowMs,
    atFiletime,
    characterID,
    shipID: toPositiveInteger(details.shipID, null),
    fromSolarSystemID: fromSolarSystemID || null,
    toSolarSystemID,
    kind: String(details.kind || "stargate"),
    sourceID: toPositiveInteger(details.sourceID, null),
    destinationID: toPositiveInteger(details.destinationID, null),
  });
  return writeState(state);
}

function listSolarSystemVisitRows(characterID) {
  const numericCharacterID = getCharacterID(characterID);
  if (numericCharacterID <= 0) {
    return [];
  }

  const state = readState();
  const characterState = state.visitsByCharacterID[String(numericCharacterID)];
  if (!characterState || typeof characterState !== "object") {
    return [];
  }

  const systems = characterState.systems && typeof characterState.systems === "object"
    ? characterState.systems
    : {};

  return Object.values(systems)
    .map((entry) => {
      const solarSystemID = toPositiveInteger(entry && entry.solarSystemID, 0);
      const visits = toPositiveInteger(entry && entry.visits, 0);
      const lastDateTime = normalizeFiletimeString(
        entry && entry.lastDateTime,
        currentFiletimeString(),
      );
      if (solarSystemID <= 0 || visits <= 0) {
        return null;
      }
      return [
        buildFiletimeLong(lastDateTime),
        solarSystemID,
        visits,
      ];
    })
    .filter(Boolean)
    .sort((left, right) => toInteger(left[1], 0) - toInteger(right[1], 0));
}

function listJumpHistoryRows(hours = 1, nowMs = Date.now()) {
  const windowHours = Math.max(1, Math.min(24, toPositiveInteger(hours, 1)));
  const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;
  const state = readState();
  const counts = new Map();

  for (const event of state.jumpEvents || []) {
    const atMs = toPositiveInteger(event && event.atMs, 0);
    if (atMs < cutoffMs || atMs > nowMs + 60000) {
      continue;
    }
    const solarSystemID = toPositiveInteger(
      event && (event.toSolarSystemID || event.solarSystemID),
      0,
    );
    if (solarSystemID <= 0) {
      continue;
    }
    counts.set(solarSystemID, (counts.get(solarSystemID) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([solarSystemID, count]) => [solarSystemID, count, 0, 0]);
}

module.exports = {
  TABLE,
  filetimeFromMs,
  msFromFiletime,
  listJumpHistoryRows,
  listSolarSystemVisitRows,
  recordSolarSystemJump,
  recordSolarSystemVisit,
};
