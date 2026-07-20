const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const {
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  REPROCESSING_FACILITY_STATE_TABLE,
} = require("./reprocessingConstants");
const {
  getReprocessingRigProfile,
} = require("./reprocessingStaticData");

let cachedState = null;

const RIG_SLOT_FLAGS = Object.freeze([92, 93, 94, 95, 96, 97, 98, 99]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function buildDefaultPayload() {
  return {
    _meta: {
      version: 1,
      generatedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    },
    facilities: {},
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRigTypeIDs(rigTypeIDs = []) {
  return [...new Set(
    (Array.isArray(rigTypeIDs) ? rigTypeIDs : [])
      .map((value) => toInt(value, 0))
      .filter((typeID) => typeID > 0 && getReprocessingRigProfile(typeID)),
  )].sort((left, right) => left - right);
}

function buildFacilityRecord(facilityID, record = {}) {
  return {
    facilityID: toInt(facilityID, 0),
    rigTypeIDs: normalizeRigTypeIDs(record.rigTypeIDs),
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : new Date().toISOString(),
  };
}

function readTable() {
  const result = database.read(REPROCESSING_FACILITY_STATE_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return buildDefaultPayload();
  }
  return cloneValue(result.data);
}

function writeTable(payload) {
  const nextPayload =
    payload && typeof payload === "object"
      ? payload
      : buildDefaultPayload();
  nextPayload._meta = {
    ...(nextPayload._meta || {}),
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
  };
  return Boolean(
    database.write(REPROCESSING_FACILITY_STATE_TABLE, "/", nextPayload).success,
  );
}

function ensureCache() {
  if (cachedState) {
    return cachedState;
  }

  const payload = readTable();
  const facilitiesByID = new Map();
  const facilities =
    payload.facilities && typeof payload.facilities === "object"
      ? payload.facilities
      : {};
  for (const [facilityID, record] of Object.entries(facilities)) {
    const numericFacilityID = toInt(facilityID, 0);
    if (numericFacilityID <= 0) {
      continue;
    }
    facilitiesByID.set(
      numericFacilityID,
      buildFacilityRecord(numericFacilityID, record),
    );
  }

  cachedState = {
    payload,
    facilitiesByID,
  };
  return cachedState;
}

function getReprocessingFacilityConfig(facilityID) {
  const numericFacilityID = toInt(facilityID, 0);
  if (numericFacilityID <= 0) {
    return buildFacilityRecord(0);
  }
  return (
    ensureCache().facilitiesByID.get(numericFacilityID) ||
    buildFacilityRecord(numericFacilityID)
  );
}

function getReprocessingFacilityRigTypeIDs(facilityID) {
  const numericFacilityID = toInt(facilityID, 0);
  if (numericFacilityID <= 0) {
    return [];
  }

  const fittedRigTypeIDs = listContainerItems(null, numericFacilityID, null)
    .filter((item) => item && RIG_SLOT_FLAGS.includes(toInt(item.flagID, 0)))
    .map((item) => toInt(item.typeID, 0))
    .filter((typeID) => typeID > 0 && getReprocessingRigProfile(typeID));

  const configuredRigTypeIDs =
    getReprocessingFacilityConfig(numericFacilityID).rigTypeIDs || [];
  return normalizeRigTypeIDs([
    ...fittedRigTypeIDs,
    ...configuredRigTypeIDs,
  ]);
}

function setReprocessingFacilityRigTypeIDs(facilityID, rigTypeIDs = []) {
  const numericFacilityID = toInt(facilityID, 0);
  if (numericFacilityID <= 0) {
    return {
      success: false,
      errorMsg: "FACILITY_NOT_FOUND",
    };
  }

  const nextRecord = buildFacilityRecord(numericFacilityID, {
    rigTypeIDs,
    updatedAt: new Date().toISOString(),
  });
  const payload = readTable();
  payload.facilities =
    payload.facilities && typeof payload.facilities === "object"
      ? payload.facilities
      : {};
  payload.facilities[String(numericFacilityID)] = nextRecord;
  if (!writeTable(payload)) {
    return {
      success: false,
      errorMsg: "PERSIST_FAILED",
    };
  }

  cachedState = null;
  return {
    success: true,
    data: nextRecord,
  };
}

function clearReprocessingFacilityRigTypeIDs(facilityID) {
  return setReprocessingFacilityRigTypeIDs(facilityID, []);
}

function resetReprocessingFacilityStateCacheForTests() {
  cachedState = null;
}

module.exports = {
  clearReprocessingFacilityRigTypeIDs,
  getReprocessingFacilityConfig,
  getReprocessingFacilityRigTypeIDs,
  resetReprocessingFacilityStateCacheForTests,
  setReprocessingFacilityRigTypeIDs,
};
