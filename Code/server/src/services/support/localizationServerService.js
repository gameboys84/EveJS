const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict } = require(path.join(__dirname, "../_shared/serviceHelpers"));

const localizationEvents = [];
let localizationQaWrapActive = false;

function recordEvent(eventType, details = {}, session = null) {
  const event = {
    eventID: localizationEvents.length + 1,
    eventType,
    characterID: Number(session && (session.characterID || session.charid || 0)) || 0,
    accountID: Number(session && (session.userid || session.userID || 0)) || 0,
    recordedAt: new Date().toISOString(),
    details,
  };
  localizationEvents.push(event);
  log.debug(`[LocalizationServer] ${eventType}`);
  return event;
}

class LocalizationServerService extends BaseService {
  constructor() {
    super("localizationServer");
  }

  Handle_UpdateLocalizationQAWrap(args, session) {
    localizationQaWrapActive = Boolean(args && args[0]);
    recordEvent("update_qa_wrap", { active: localizationQaWrapActive }, session);
    return null;
  }

  Handle_GetAllTextChanges(args, session) {
    const hashData = args && args[0];
    const hashCount =
      hashData && typeof hashData === "object" && Array.isArray(hashData.entries)
        ? hashData.entries.length
        : hashData && typeof hashData === "object"
          ? Object.keys(hashData).length
          : 0;
    recordEvent("get_all_text_changes", { hashCount }, session);
    return [buildDict([]), buildDict([]), buildDict([])];
  }

  Handle_ReloadFSDPickle(args, session) {
    recordEvent("reload_fsd_pickle", {}, session);
    return false;
  }
}

module.exports = LocalizationServerService;
module.exports._testing = {
  getEvents() {
    return localizationEvents.map((event) => JSON.parse(JSON.stringify(event)));
  },
  getLocalizationQAWrapActive() {
    return localizationQaWrapActive;
  },
  resetForTests() {
    localizationEvents.length = 0;
    localizationQaWrapActive = false;
  },
};
