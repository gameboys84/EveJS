const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildKeyVal,
  buildList,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  listSkyhooksByCorporation,
} = require(path.join(__dirname, "./sovModernState"));

const TYPE_ORBITAL_SKYHOOK = 81080;
const SKYHOOK_STATE_UNKNOWN = 0;
const SKYHOOK_STATE_SHIELD_VULNERABLE = 210;
const SKYHOOK_CLIENT_STATE_IDS = new Set([210, 211, 212, 213, 214]);

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Math.trunc(normalizeNumber(value, fallback));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveSessionCorporationID(session) {
  return normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    0,
  );
}

function resolveSessionAllianceID(session) {
  return normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    0,
  );
}

function resolveSessionSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function resolveSkyhookClientState(skyhook) {
  const explicitState = normalizePositiveInteger(
    skyhook && (skyhook.state || skyhook.skyhookState || skyhook.structureState),
    0,
  );
  if (SKYHOOK_CLIENT_STATE_IDS.has(explicitState)) {
    return explicitState;
  }
  if (skyhook && skyhook.active === false) {
    return SKYHOOK_STATE_UNKNOWN;
  }
  return SKYHOOK_STATE_SHIELD_VULNERABLE;
}

function buildSkyhookSummaryRow(skyhook) {
  const skyhookID = normalizePositiveInteger(skyhook && skyhook.skyhookID, 0);
  const solarSystemID = normalizePositiveInteger(skyhook && skyhook.solarSystemID, 0);
  const planetID = normalizePositiveInteger(skyhook && skyhook.planetID, 0);
  const corporationID = normalizePositiveInteger(skyhook && skyhook.corporationID, 0);
  const allianceID = normalizePositiveInteger(skyhook && skyhook.allianceID, 0);
  return buildKeyVal([
    ["skyhookID", skyhookID],
    ["itemID", skyhookID],
    ["solarSystemID", solarSystemID],
    ["planetID", planetID],
    ["typeID", TYPE_ORBITAL_SKYHOOK],
    ["state", resolveSkyhookClientState(skyhook)],
    ["corporationID", corporationID],
    ["ownerCorpID", corporationID],
    ["allianceID", allianceID],
  ]);
}

function sortSkyhookSummaries(left, right) {
  return (
    normalizePositiveInteger(left && left.solarSystemID, 0) -
      normalizePositiveInteger(right && right.solarSystemID, 0) ||
    normalizePositiveInteger(left && left.planetID, 0) -
      normalizePositiveInteger(right && right.planetID, 0) ||
    normalizePositiveInteger(left && left.skyhookID, 0) -
      normalizePositiveInteger(right && right.skyhookID, 0)
  );
}

class ColonyResourcesMgrService extends BaseService {
  constructor(options = {}) {
    super("colonyResourcesMgr");
    this.skyhookProvider =
      options.skyhookProvider || ((corporationID, session) => {
        const result = listSkyhooksByCorporation(corporationID, {
          corporationID,
          allianceID: resolveSessionAllianceID(session),
          solarSystemID: resolveSessionSolarSystemID(session),
        });
        return result && result.ok ? result.skyhooks || [] : [];
      });
  }

  Handle_GetMyCorporationSkyhooks(args, session) {
    const corporationID = resolveSessionCorporationID(session);
    if (!corporationID) {
      return buildList([]);
    }

    const skyhooks = this.skyhookProvider(corporationID, session);
    const rows = (Array.isArray(skyhooks) ? skyhooks : [])
      .filter((skyhook) => normalizePositiveInteger(skyhook && skyhook.skyhookID, 0))
      .sort(sortSkyhookSummaries)
      .map(buildSkyhookSummaryRow);

    return buildList(rows);
  }
}

ColonyResourcesMgrService._testing = {
  TYPE_ORBITAL_SKYHOOK,
  SKYHOOK_STATE_UNKNOWN,
  SKYHOOK_STATE_SHIELD_VULNERABLE,
  buildSkyhookSummaryRow,
  resolveSkyhookClientState,
};

module.exports = ColonyResourcesMgrService;
