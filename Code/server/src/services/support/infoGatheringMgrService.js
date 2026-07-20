const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const infoEvents = [];

class InfoGatheringMgrService extends BaseService {
  constructor() {
    super("infoGatheringMgr");
  }

  Handle_GetStateAndConfig(args, session) {
    log.debug("[InfoGatheringMgr] GetStateAndConfig");
    infoEvents.push({
      eventID: infoEvents.length + 1,
      eventType: "get_state_and_config",
      characterID: Number(session && (session.characterID || session.charid || 0)) || 0,
      accountID: Number(session && (session.userid || session.userID || 0)) || 0,
      recordedAt: new Date().toISOString(),
      details: {},
    });
    return buildKeyVal([
      ["isEnabled", 0],
      ["infoTypes", buildList([])],
      ["clientWorkerInterval", 0],
      ["infoTypesOncePerRun", buildList([])],
      ["infoTypeAggregates", buildDict([])],
      ["infoTypeParameters", buildDict([])],
    ]);
  }

  Handle_LogInfoEventsFromClient(args, session) {
    const events = args && args[0];
    const eventCount =
      events && typeof events === "object" && Array.isArray(events.entries)
        ? events.entries.length
        : events && typeof events === "object"
          ? Object.keys(events).length
          : 0;
    log.debug(`[InfoGatheringMgr] LogInfoEventsFromClient count=${eventCount}`);
    infoEvents.push({
      eventID: infoEvents.length + 1,
      eventType: "log_info_events_from_client",
      characterID: Number(session && (session.characterID || session.charid || 0)) || 0,
      accountID: Number(session && (session.userid || session.userID || 0)) || 0,
      recordedAt: new Date().toISOString(),
      details: { eventCount },
    });
    return buildDict([]);
  }
}

module.exports = InfoGatheringMgrService;
module.exports._testing = {
  getEvents() {
    return infoEvents.map((event) => JSON.parse(JSON.stringify(event)));
  },
  resetForTests() {
    infoEvents.length = 0;
  },
};
