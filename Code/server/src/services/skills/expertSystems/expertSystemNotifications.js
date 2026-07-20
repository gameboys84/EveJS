const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../../chat/sessionRegistry"));
const { getCharacterSkillMap } = require(path.join(__dirname, "../skillState"));
const {
  emitSkillSessionState,
} = require(path.join(__dirname, "../training/skillQueueNotifications"));
const {
  diffProjectedSkillMaps,
} = require("./expertSystemProjection");
const {
  buildExpertSystemsPayload,
} = require("./expertSystemSerializer");
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../../notifications/notificationState"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getLiveSession(characterID, fallbackSession = null) {
  return (
    sessionRegistry.findSessionByCharacterID(toInt(characterID, 0)) ||
    fallbackSession ||
    null
  );
}

function emitExpertSystemsUpdated(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return false;
  }

  const session = getLiveSession(numericCharacterID, options.session || null);
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  session.sendNotification("OnExpertSystemsUpdated", "clientID", [
    buildExpertSystemsPayload(numericCharacterID),
    Boolean(options.expertSystemAdded),
    toInt(options.expertSystemTypeID, 0) || null,
  ]);

  const previousSkillMap =
    options.previousSkillMap instanceof Map ? options.previousSkillMap : null;
  if (previousSkillMap) {
    const nextSkillMap = getCharacterSkillMap(numericCharacterID);
    const diff = diffProjectedSkillMaps(previousSkillMap, nextSkillMap);
    if (
      diff.changedSkillRecords.length > 0 ||
      diff.removedSkillRecords.length > 0
    ) {
      emitSkillSessionState(
        session,
        numericCharacterID,
        diff.changedSkillRecords,
        {
          previousSkillMap,
          removedSkillRecords: diff.removedSkillRecords,
          emitSkillLevelsTrained: false,
        },
      );
    }
  }

  if (options.expired === true) {
    session.sendNotification("OnExpertSystemExpired", "clientID", [
      toInt(options.expertSystemTypeID, 0) || null,
    ]);
  }

  return true;
}

// ExpertSystemExpired (typeID 253): a character's expert system lapsed. Unlike
// the transient OnExpertSystemExpired event (which only reaches a live session),
// this persistent center row is created whenever an expert system expires —
// including while the character is offline. The client formatter passes the data
// dict straight through keyed on the expert-system typeID, and the row is grouped
// with the misc notifications.
function notifyExpertSystemExpired(characterID, expertSystemTypeID) {
  const numericCharacterID = toInt(characterID, 0);
  const numericTypeID = toInt(expertSystemTypeID, 0);
  if (numericCharacterID <= 0 || numericTypeID <= 0) {
    return null;
  }
  return createNotification(numericCharacterID, {
    typeID: NOTIFICATION_TYPE.EXPERT_SYSTEM_EXPIRED,
    senderID: 0,
    groupID: NOTIFICATION_GROUP.MISC,
    processed: false,
    data: { typeID: numericTypeID },
  });
}

module.exports = {
  emitExpertSystemsUpdated,
  getLiveSession,
  notifyExpertSystemExpired,
};
