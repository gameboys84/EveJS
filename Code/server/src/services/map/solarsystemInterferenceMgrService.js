const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildFiletimeLong,
  buildObjectEx1,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const solarSystemInterferenceState = require(path.join(
  __dirname,
  "solarSystemInterferenceState",
));

const STATE_CLASS_NAME =
  "solarsysteminterference.solarsystemInterferenceState.SolarsystemInterferenceState";

function resolveSolarSystemID(session) {
  const numericValue = Number(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
  );
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function buildInterferenceStatePayload(rawState = {}) {
  const state = solarSystemInterferenceState.calculateInterferenceStateAtFileTime(
    rawState,
    currentFileTime(),
  );
  return buildObjectEx1(STATE_CLASS_NAME, [
    state.interferenceLevel,
    buildFiletimeLong(state.lastDecayTickTimestamp),
    state.interferenceDecreasePerDecayTick,
    state.decayTickPeriod,
    state.maxInterferenceLevel,
    state.quiescentInterferenceLevel,
  ]);
}

class SolarSystemInterferenceMgrService extends BaseService {
  constructor() {
    super("solarsystemInterferenceMgr");
  }

  Handle_GetLocalInterferenceState(args, session) {
    const solarSystemID = resolveSolarSystemID(session);
    const state =
      solarSystemInterferenceState.getSolarSystemInterferenceState(solarSystemID) ||
      solarSystemInterferenceState.buildQuietInterferenceState();

    log.debug(
      `[SolarSystemInterferenceMgr] GetLocalInterferenceState system=${solarSystemID || "unknown"} level=${state.interferenceLevel}`,
    );
    return buildInterferenceStatePayload(state);
  }

  Handle_GetAllInterferenceBands() {
    const table = solarSystemInterferenceState.readSolarSystemInterferenceTable();
    const entries = [];
    for (const [solarSystemID, rawState] of Object.entries(table.systems || {})) {
      const state = solarSystemInterferenceState.calculateInterferenceStateAtFileTime(
        rawState,
        currentFileTime(),
      );
      const band = solarSystemInterferenceState.getInterferenceBand(state);
      if (band !== solarSystemInterferenceState.INTERFERENCE_BAND_NONE) {
        entries.push([Number(solarSystemID), band]);
      }
    }

    log.debug(
      `[SolarSystemInterferenceMgr] GetAllInterferenceBands -> ${entries.length} active`,
    );
    return buildDict(entries);
  }
}

SolarSystemInterferenceMgrService._testing = {
  buildInterferenceStatePayload,
  resolveSolarSystemID,
};

module.exports = SolarSystemInterferenceMgrService;
