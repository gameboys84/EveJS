const path = require("path");

// Phase 0 / 0.C: solar-system interference state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:map", { strict: true });
const {
  currentFileTime,
  normalizeBigInt,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const SOLAR_SYSTEM_INTERFERENCE_STATE_TABLE = "solarSystemInterferenceState";
const SOLAR_SYSTEM_INTERFERENCE_STATE_VERSION = 1;

const DEFAULT_INTERFERENCE_DECREASE_PER_DECAY_TICK = 2800;
const DEFAULT_DECAY_TICK_PERIOD_SECONDS = 25200;
const DEFAULT_MAX_INTERFERENCE_LEVEL = 10000;
const DEFAULT_QUIESCENT_INTERFERENCE_LEVEL = 0;

const INTERFERENCE_BAND_NONE = "N";
const INTERFERENCE_BAND_LOW = "L";
const INTERFERENCE_BAND_MEDIUM = "M";
const INTERFERENCE_BAND_HIGH = "H";
const INTERFERENCE_BAND_MEDIUM_THRESHOLD = 0.33;
const INTERFERENCE_BAND_HIGH_THRESHOLD = 0.66;
const FILETIME_TICKS_PER_SECOND = 10_000_000n;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSolarSystemID(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function systemPath(solarSystemID) {
  return `/systems/${String(solarSystemID)}`;
}

function normalizeTimestamp(value, fallback = currentFileTime()) {
  return normalizeBigInt(value, fallback);
}

function normalizeStorageTimestamp(value) {
  return normalizeTimestamp(value).toString();
}

function normalizeInterferenceState(rawState = {}) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  let quiescentInterferenceLevel = normalizeNumber(
    source.quiescentInterferenceLevel ?? source._quiescentInterferenceLevel,
    DEFAULT_QUIESCENT_INTERFERENCE_LEVEL,
  );
  let maxInterferenceLevel = normalizeNumber(
    source.maxInterferenceLevel ?? source._maxInterferenceLevel,
    DEFAULT_MAX_INTERFERENCE_LEVEL,
  );
  if (maxInterferenceLevel <= quiescentInterferenceLevel) {
    maxInterferenceLevel = quiescentInterferenceLevel + 1;
  }

  const interferenceDecreasePerDecayTick = Math.max(
    Number.EPSILON,
    normalizeNumber(
      source.interferenceDecreasePerDecayTick ??
        source._interferenceDecreasePerDecayTick,
      DEFAULT_INTERFERENCE_DECREASE_PER_DECAY_TICK,
    ),
  );
  const decayTickPeriod = Math.max(
    Number.EPSILON,
    normalizeNumber(
      source.decayTickPeriod ?? source._decayTickPeriod,
      DEFAULT_DECAY_TICK_PERIOD_SECONDS,
    ),
  );
  const interferenceLevel = Math.max(
    quiescentInterferenceLevel,
    Math.min(
      maxInterferenceLevel,
      normalizeNumber(
        source.interferenceLevel ?? source._interferenceLevel,
        quiescentInterferenceLevel,
      ),
    ),
  );

  return {
    interferenceLevel,
    lastDecayTickTimestamp: normalizeTimestamp(
      source.lastDecayTickTimestamp ?? source._lastDecayTickTimestamp,
    ),
    interferenceDecreasePerDecayTick,
    decayTickPeriod,
    maxInterferenceLevel,
    quiescentInterferenceLevel,
  };
}

function normalizeStorageState(rawState = {}) {
  const state = normalizeInterferenceState(rawState);
  return {
    interferenceLevel: state.interferenceLevel,
    lastDecayTickTimestamp: normalizeStorageTimestamp(state.lastDecayTickTimestamp),
    interferenceDecreasePerDecayTick: state.interferenceDecreasePerDecayTick,
    decayTickPeriod: state.decayTickPeriod,
    maxInterferenceLevel: state.maxInterferenceLevel,
    quiescentInterferenceLevel: state.quiescentInterferenceLevel,
    updatedAtFiletime: currentFileTime().toString(),
  };
}

function buildQuietInterferenceState(filetime = currentFileTime()) {
  return {
    interferenceLevel: DEFAULT_QUIESCENT_INTERFERENCE_LEVEL,
    lastDecayTickTimestamp: normalizeTimestamp(filetime),
    interferenceDecreasePerDecayTick: DEFAULT_INTERFERENCE_DECREASE_PER_DECAY_TICK,
    decayTickPeriod: DEFAULT_DECAY_TICK_PERIOD_SECONDS,
    maxInterferenceLevel: DEFAULT_MAX_INTERFERENCE_LEVEL,
    quiescentInterferenceLevel: DEFAULT_QUIESCENT_INTERFERENCE_LEVEL,
  };
}

function calculateInterferenceStateAtFileTime(
  rawState = {},
  filetime = currentFileTime(),
) {
  const state = normalizeInterferenceState(rawState);
  if (state.interferenceLevel <= state.quiescentInterferenceLevel) {
    return state;
  }

  const targetFiletime = normalizeTimestamp(filetime);
  if (targetFiletime < state.lastDecayTickTimestamp) {
    return state;
  }

  const deltaTicks = targetFiletime - state.lastDecayTickTimestamp;
  const deltaSeconds = Number(deltaTicks) / Number(FILETIME_TICKS_PER_SECOND);
  const decayTicks = deltaSeconds / state.decayTickPeriod;
  const interferenceDecrease =
    decayTicks * state.interferenceDecreasePerDecayTick;

  return {
    ...state,
    interferenceLevel: Math.max(
      state.quiescentInterferenceLevel,
      state.interferenceLevel - interferenceDecrease,
    ),
    lastDecayTickTimestamp: targetFiletime,
  };
}

function getInterferenceBand(rawState = {}) {
  const state = normalizeInterferenceState(rawState);
  if (state.interferenceLevel <= state.quiescentInterferenceLevel) {
    return INTERFERENCE_BAND_NONE;
  }
  const normalisedInterferenceLevel =
    (state.interferenceLevel - state.quiescentInterferenceLevel) /
    (state.maxInterferenceLevel - state.quiescentInterferenceLevel);
  if (normalisedInterferenceLevel > INTERFERENCE_BAND_HIGH_THRESHOLD) {
    return INTERFERENCE_BAND_HIGH;
  }
  if (normalisedInterferenceLevel > INTERFERENCE_BAND_MEDIUM_THRESHOLD) {
    return INTERFERENCE_BAND_MEDIUM;
  }
  return INTERFERENCE_BAND_LOW;
}

function readSolarSystemInterferenceTable() {
  const result = repo.read(SOLAR_SYSTEM_INTERFERENCE_STATE_TABLE, "/");
  if (result.success && result.data && typeof result.data === "object") {
    return cloneValue({
      _meta: {
        version: SOLAR_SYSTEM_INTERFERENCE_STATE_VERSION,
        ...(result.data._meta && typeof result.data._meta === "object"
          ? result.data._meta
          : {}),
      },
      systems:
        result.data.systems && typeof result.data.systems === "object"
          ? result.data.systems
          : {},
    });
  }

  return {
    _meta: {
      version: SOLAR_SYSTEM_INTERFERENCE_STATE_VERSION,
    },
    systems: {},
  };
}

function getSolarSystemInterferenceState(solarSystemID) {
  const normalizedSolarSystemID = normalizeSolarSystemID(solarSystemID);
  if (!normalizedSolarSystemID) {
    return null;
  }

  const result = repo.read(
    SOLAR_SYSTEM_INTERFERENCE_STATE_TABLE,
    systemPath(normalizedSolarSystemID),
  );
  if (!result.success || !result.data || typeof result.data !== "object") {
    return null;
  }
  return cloneValue(result.data);
}

function writeSolarSystemInterferenceState(solarSystemID, rawState) {
  const normalizedSolarSystemID = normalizeSolarSystemID(solarSystemID);
  if (!normalizedSolarSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const writeMetaResult = repo.write(
    SOLAR_SYSTEM_INTERFERENCE_STATE_TABLE,
    "/_meta/version",
    SOLAR_SYSTEM_INTERFERENCE_STATE_VERSION,
  );
  if (!writeMetaResult || !writeMetaResult.success) {
    return {
      success: false,
      errorMsg: writeMetaResult && writeMetaResult.errorMsg
        ? writeMetaResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  const writeResult = repo.write(
    SOLAR_SYSTEM_INTERFERENCE_STATE_TABLE,
    systemPath(normalizedSolarSystemID),
    normalizeStorageState(rawState),
  );
  if (!writeResult || !writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  return {
    success: true,
  };
}

module.exports = {
  SOLAR_SYSTEM_INTERFERENCE_STATE_TABLE,
  DEFAULT_INTERFERENCE_DECREASE_PER_DECAY_TICK,
  DEFAULT_DECAY_TICK_PERIOD_SECONDS,
  DEFAULT_MAX_INTERFERENCE_LEVEL,
  DEFAULT_QUIESCENT_INTERFERENCE_LEVEL,
  INTERFERENCE_BAND_NONE,
  INTERFERENCE_BAND_LOW,
  INTERFERENCE_BAND_MEDIUM,
  INTERFERENCE_BAND_HIGH,
  buildQuietInterferenceState,
  calculateInterferenceStateAtFileTime,
  getInterferenceBand,
  readSolarSystemInterferenceTable,
  getSolarSystemInterferenceState,
  writeSolarSystemInterferenceState,
};
