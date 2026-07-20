const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const RW_LP_CORPORATION_IDS = Object.freeze([
  1000283,
  1000284,
  1000285,
  1000286,
]);

const auditEvents = [];
const activeResourceWarSystemIDs = new Set();
const closestStationIDsBySystemID = new Map();
let defaultClosestStationIDsByCorpID = new Map();

function toInt(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function getCharacterID(session = null) {
  return toInt(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
    0,
  );
}

function getAccountID(session = null) {
  return toInt(
    session &&
      (
        session.userID ||
        session.userid ||
        session.accountID ||
        session.accountId
      ),
    0,
  );
}

function getSessionSolarSystemID(session = null) {
  return toInt(
    session &&
      (
        session.solarsystemid2 ||
        session.solarSystemID ||
        session.solarsystemid ||
        session.solarSystemId
      ),
    0,
  );
}

function getRequestedSolarSystemID(args = [], session = null) {
  const requestedValue = Array.isArray(args) && args.length > 0
    ? args[0]
    : null;
  return toInt(requestedValue, getSessionSolarSystemID(session));
}

function cloneArgs(args = []) {
  return Array.isArray(args)
    ? args.map((entry) => unwrapMarshalValue(entry))
    : [];
}

function recordAuditEvent(kind, args = [], session = null, extra = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    accountID: getAccountID(session) || null,
    timestamp: Date.now(),
    ...extra,
  });
}

function isResourceWarsCorporationID(corporationID) {
  return RW_LP_CORPORATION_IDS.includes(toInt(corporationID, 0));
}

function normalizeStationEntries(entries = []) {
  const sourceEntries =
    entries instanceof Map
      ? [...entries.entries()]
      : Array.isArray(entries)
        ? entries
        : entries && typeof entries === "object"
          ? Object.entries(entries)
          : [];

  return sourceEntries
    .map(([corporationID, stationID]) => [
      toInt(corporationID, 0),
      toInt(stationID, 0),
    ])
    .filter(([corporationID, stationID]) =>
      isResourceWarsCorporationID(corporationID) && stationID > 0,
    );
}

function buildClosestStationDict(stationIDsByCorpID) {
  const entries = normalizeStationEntries(stationIDsByCorpID)
    .sort(([leftCorpID], [rightCorpID]) => leftCorpID - rightCorpID);
  return buildDict(entries);
}

function setClosestStationMapForTests(systemIDOrEntries, maybeEntries) {
  if (maybeEntries === undefined) {
    defaultClosestStationIDsByCorpID = new Map(
      normalizeStationEntries(systemIDOrEntries),
    );
    return;
  }

  const solarSystemID = toInt(systemIDOrEntries, 0);
  if (solarSystemID <= 0) {
    return;
  }

  closestStationIDsBySystemID.set(
    solarSystemID,
    new Map(normalizeStationEntries(maybeEntries)),
  );
}

function setActiveSystemIDsForTests(systemIDs = []) {
  activeResourceWarSystemIDs.clear();
  for (const solarSystemID of Array.isArray(systemIDs) ? systemIDs : []) {
    const numericSolarSystemID = toInt(solarSystemID, 0);
    if (numericSolarSystemID > 0) {
      activeResourceWarSystemIDs.add(numericSolarSystemID);
    }
  }
}

class RWManagerService extends BaseService {
  constructor() {
    super("RWManager");
  }

  Handle_get_closest_rw_stations(args, session) {
    const requestedSolarSystemID = getRequestedSolarSystemID(args, session);
    recordAuditEvent("get_closest_rw_stations", args, session, {
      requestedSolarSystemID,
    });

    const stationIDsByCorpID =
      closestStationIDsBySystemID.get(requestedSolarSystemID) ||
      defaultClosestStationIDsByCorpID;

    return buildClosestStationDict(stationIDsByCorpID);
  }

  Handle_solarsystem_contains_rw_instances(args, session) {
    const requestedSolarSystemID = getRequestedSolarSystemID(args, session);
    const containsInstances = activeResourceWarSystemIDs.has(requestedSolarSystemID);
    recordAuditEvent("solarsystem_contains_rw_instances", args, session, {
      requestedSolarSystemID,
      containsInstances,
    });
    return containsInstances;
  }
}

RWManagerService._testing = {
  constants: {
    RW_LP_CORPORATION_IDS,
  },
  getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }));
  },
  resetForTests() {
    auditEvents.length = 0;
    activeResourceWarSystemIDs.clear();
    closestStationIDsBySystemID.clear();
    defaultClosestStationIDsByCorpID = new Map();
  },
  setActiveSystemIDsForTests,
  setClosestStationMapForTests,
};

module.exports = RWManagerService;
