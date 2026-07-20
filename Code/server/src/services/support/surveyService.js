const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

const surveyEvents = [];
let activeSurveyID = null;

function toPositiveInteger(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const integer = Math.trunc(numeric);
  return integer > 0 ? integer : fallback;
}

function getSessionCharacterID(session) {
  return Number(session && (session.characterID || session.charid || session.clientID)) || 0;
}

function getSessionAccountID(session) {
  return Number(session && (session.userid || session.userID || session.accountID)) || 0;
}

function recordSurveyEvent(eventType, session = null, details = {}) {
  const event = {
    eventID: surveyEvents.length + 1,
    eventType,
    activeSurveyID,
    characterID: getSessionCharacterID(session),
    accountID: getSessionAccountID(session),
    recordedAt: new Date().toISOString(),
    details,
  };
  surveyEvents.push(event);
  log.debug(
    `[Survey] ${eventType} activeSurvey=${activeSurveyID || "none"} account=${event.accountID || "?"}`,
  );
  return event;
}

class SurveyService extends BaseService {
  constructor() {
    super("survey");
  }

  Handle_GetActiveSurveyID(args, session) {
    recordSurveyEvent("get_active_survey_id", session);
    return activeSurveyID;
  }

  Handle_PerformSurveyChecks(args, session) {
    recordSurveyEvent("perform_checks", session);
    return null;
  }

  Handle_ClaimSurveyRewards(args, session) {
    recordSurveyEvent("claim_rewards", session);
    return null;
  }
}

module.exports = SurveyService;
module.exports._testing = {
  getEvents() {
    return surveyEvents.map((event) => JSON.parse(JSON.stringify(event)));
  },
  resetForTests() {
    activeSurveyID = null;
    surveyEvents.length = 0;
  },
  setActiveSurveyID(value) {
    activeSurveyID = toPositiveInteger(value, null);
  },
};
