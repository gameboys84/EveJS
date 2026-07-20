const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const {
  buildObservedTalesDict,
} = require(path.join(__dirname, "./observedTaleData"));

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

function resolveSessionSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        session.solarsystemid2 ||
        session.solarsystemid ||
        session.locationid
      ),
    0,
  );
}

function sendTaleData(
  session,
  solarSystemID = null,
  talesByID = null,
) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const targetSystemID =
    normalizePositiveInteger(solarSystemID, 0) ||
    resolveSessionSolarSystemID(session);
  if (!targetSystemID) {
    return false;
  }

  session.sendNotification("OnTaleData", "charid", [
    targetSystemID,
    talesByID || buildObservedTalesDict(targetSystemID),
  ]);
  return true;
}

function sendSolarSystemTaleData(session, solarSystemID = null, taleIDs = null) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const targetSystemID =
    normalizePositiveInteger(solarSystemID, 0) ||
    resolveSessionSolarSystemID(session);
  if (!targetSystemID) {
    return false;
  }

  session.sendNotification("OnTaleData", "solarsystemid2", [
    targetSystemID,
    buildObservedTalesDict(targetSystemID, taleIDs),
  ]);
  return true;
}

class TaleMgrService extends BaseService {
  constructor() {
    super("taleMgr");
  }

  Handle_GetGlobalWorldEventTales(args, session) {
    sendTaleData(session);
    return buildCachedMethodCallResult([], {
      serviceName: this.name,
      method: "GetGlobalWorldEventTales",
      versionCheck: "15 minutes",
      proxyCache: true,
    });
  }

  GetGlobalWorldEventTales(args = [], session = null) {
    return this.Handle_GetGlobalWorldEventTales(args, session);
  }

  Handle_get_active_tales_by_template(args, session) {
    const templateID = normalizePositiveInteger(args && args[0], 0);
    if (!templateID) {
      return [];
    }
    sendTaleData(session);
    return [];
  }

  get_active_tales_by_template(args, session = null) {
    const templateID = Array.isArray(args) ? args[0] : args;
    return this.Handle_get_active_tales_by_template([templateID], session);
  }
}

TaleMgrService._testing = {
  sendTaleData,
  sendSolarSystemTaleData,
};

module.exports = TaleMgrService;
