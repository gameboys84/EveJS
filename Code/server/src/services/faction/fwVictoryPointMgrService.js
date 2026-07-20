const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildObjectEx1,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const VICTORY_POINT_STATE_CLASS =
  "factionwarfare.victoryPointState.VictoryPointState";
const DEFAULT_VICTORY_POINT_THRESHOLD = 75000;

function normalizeSolarSystemID(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : null;
}

function resolveSolarSystemID(args, session) {
  return normalizeSolarSystemID(
    (Array.isArray(args) && args.length > 0 && args[0]) ||
      (session && (session.solarsystemid2 || session.solarsystemid)),
  ) || 0;
}

function normalizeVictoryPointState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return null;
  }

  const score = Math.max(0, normalizeNumber(
    rawState.score ?? rawState.vpScore ?? rawState._vpScore,
    0,
  ));
  const threshold = Math.max(1, normalizeNumber(
    rawState.threshold ?? rawState.vpThreshold ?? rawState._vpThreshold,
    DEFAULT_VICTORY_POINT_THRESHOLD,
  ));

  return {
    score,
    threshold,
  };
}

function buildVictoryPointStatePayload(rawState = {}) {
  const normalizedState = normalizeVictoryPointState(rawState) || {
    score: 0,
    threshold: DEFAULT_VICTORY_POINT_THRESHOLD,
  };

  return buildObjectEx1(VICTORY_POINT_STATE_CLASS, [
    normalizedState.score,
    normalizedState.threshold,
  ]);
}

function entriesFromStateSource(source) {
  if (!source || typeof source !== "object") {
    return [];
  }

  const entries = source instanceof Map
    ? [...source.entries()]
    : Object.entries(source);

  return entries
    .map(([solarSystemID, state]) => [
      normalizeSolarSystemID(solarSystemID),
      normalizeVictoryPointState(state),
    ])
    .filter(([solarSystemID, state]) => solarSystemID && state)
    .sort(([leftID], [rightID]) => leftID - rightID);
}

function getSessionStateSource(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return (
    session.fwVictoryPointStatesBySolarSystemID ||
    session.victoryPointStatesBySolarSystemID ||
    null
  );
}

class FwVictoryPointMgrService extends BaseService {
  constructor(options = {}) {
    super("fwVictoryPointMgr");
    this._stateBySolarSystemID = options.stateBySolarSystemID || null;
  }

  getStateEntries(session) {
    const mergedEntries = new Map();

    for (const [solarSystemID, state] of entriesFromStateSource(this._stateBySolarSystemID)) {
      mergedEntries.set(solarSystemID, state);
    }
    for (const [solarSystemID, state] of entriesFromStateSource(getSessionStateSource(session))) {
      mergedEntries.set(solarSystemID, state);
    }

    return [...mergedEntries.entries()].sort(([leftID], [rightID]) => leftID - rightID);
  }

  Handle_GetAllVictoryPointStates(args, session) {
    const stateEntries = this.getStateEntries(session);

    log.debug(
      `[FwVictoryPointMgr] GetAllVictoryPointStates -> ${stateEntries.length}`,
    );

    return buildDict(
      stateEntries.map(([solarSystemID, state]) => [
        solarSystemID,
        buildVictoryPointStatePayload(state),
      ]),
    );
  }

  Handle_GetLocalVictoryPointState(args, session) {
    const solarSystemID = resolveSolarSystemID(args, session);
    const state = this.getStateEntries(session)
      .find(([candidateSolarSystemID]) => candidateSolarSystemID === solarSystemID);

    log.debug(
      `[FwVictoryPointMgr] GetLocalVictoryPointState(${solarSystemID}) -> ${state ? "state" : "none"}`,
    );

    return [
      solarSystemID,
      state ? buildVictoryPointStatePayload(state[1]) : null,
    ];
  }
}

FwVictoryPointMgrService._testing = {
  VICTORY_POINT_STATE_CLASS,
  DEFAULT_VICTORY_POINT_THRESHOLD,
  buildVictoryPointStatePayload,
  normalizeVictoryPointState,
};

module.exports = FwVictoryPointMgrService;
