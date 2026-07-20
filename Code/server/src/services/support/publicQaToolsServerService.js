const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

const qaToolEvents = [];

function toText(value, fallback = "") {
  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped === null || unwrapped === undefined) {
    return fallback;
  }
  if (Buffer.isBuffer(unwrapped)) {
    return unwrapped.toString("utf8");
  }
  return String(unwrapped);
}

function recordQaToolEvent(eventType, args = [], session = null) {
  const event = {
    eventID: qaToolEvents.length + 1,
    eventType,
    characterID: Number(session && (session.characterID || session.charid || 0)) || 0,
    accountID: Number(session && (session.userid || session.userID || 0)) || 0,
    recordedAt: new Date().toISOString(),
    args: (Array.isArray(args) ? args : []).map((entry) => toText(entry, "")),
  };
  qaToolEvents.push(event);
  log.info(`[PublicQaToolsServer] ${eventType} acknowledged without side effects`);
  return event;
}

class PublicQaToolsServerService extends BaseService {
  constructor() {
    super("publicQaToolsServer");
  }

  Handle_MoveMeTo(args, session) {
    recordQaToolEvent("move_me_to", args, session);
    return null;
  }

  Handle_SlashCmd(args, session) {
    recordQaToolEvent("slash_cmd", args, session);
    return null;
  }

  Handle_CanGiveItemForMultifit(args, session) {
    recordQaToolEvent("can_give_item_for_multifit", args, session);
    return false;
  }
}

module.exports = PublicQaToolsServerService;
module.exports._testing = {
  getEvents() {
    return qaToolEvents.map((event) => JSON.parse(JSON.stringify(event)));
  },
  resetForTests() {
    qaToolEvents.length = 0;
  },
};
