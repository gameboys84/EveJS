const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const DEFAULT_MAX_SEASONAL_POINTS = 1;
const DEFAULT_MAX_ACTIVE_CHALLENGES = 0;
const DEFAULT_LOGGED_CHALLENGE_ID = 192491367;
const auditEvents = [];

function getCharacterID(session) {
  return Number(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
  ) || 0;
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, kwargs = null) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    kwargs: kwargs || null,
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

function buildEmptyChallengeDict() {
  return buildDict([]);
}

function buildNoActiveSeasonProgress(session) {
  const characterID = getCharacterID(session);
  return buildKeyVal([
    ["character_id", characterID || null],
    ["season_id", null],
    ["seasonal_points", 0],
    ["max_seasonal_points", DEFAULT_MAX_SEASONAL_POINTS],
    ["seasonal_goals", buildDict([])],
    ["next_seasonal_goal", null],
    ["last_seasonal_goal", null],
    ["challenges", buildEmptyChallengeDict()],
  ]);
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function sendChallengeProgressUpdate(session, challengeID, progress) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const normalizedChallengeID = normalizeInteger(
    challengeID,
    DEFAULT_LOGGED_CHALLENGE_ID,
  );
  if (normalizedChallengeID <= 0) {
    return false;
  }

  session.sendNotification("OnChallengeProgressUpdate", "charid", [
    normalizedChallengeID,
    Math.max(0, normalizeInteger(progress, 0)),
  ]);
  return true;
}

function sendChallengeRewardsGranted(session, challengeID) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const normalizedChallengeID = normalizeInteger(
    challengeID,
    DEFAULT_LOGGED_CHALLENGE_ID,
  );
  if (normalizedChallengeID <= 0) {
    return false;
  }

  session.sendNotification("OnChallengeRewardsGranted", "charid", [
    normalizedChallengeID,
  ]);
  return true;
}

class SeasonManagerService extends BaseService {
  constructor() {
    super("seasonManager");
  }

  Handle_get_season_data_for_character(args, session) {
    log.debug("[SeasonManager] get_season_data_for_character called");
    return null;
  }

  Handle_select_season(args, session) {
    recordAuditEvent("select_season", args, session);
    return null;
  }

  Handle_get_character_progress_by_character_id(args, session) {
    recordAuditEvent("get_character_progress_by_character_id", args, session);
    return buildNoActiveSeasonProgress(session);
  }

  Handle_get_challenge(args, session) {
    recordAuditEvent("get_challenge", args, session);
    return null;
  }

  Handle_get_max_active_challenges() {
    return DEFAULT_MAX_ACTIVE_CHALLENGES;
  }

  Handle_challenge_is_dormant(args, session) {
    recordAuditEvent("challenge_is_dormant", args, session);
    return true;
  }

  Handle_get_challenge_expiration_date(args, session) {
    recordAuditEvent("get_challenge_expiration_date", args, session);
    return null;
  }

  Handle_get_season_end_time() {
    return buildFiletimeLong(currentFileTime());
  }

  Handle_get_loot_table_by_typeID(args, session) {
    recordAuditEvent("get_loot_table_by_typeID", args, session);
    return buildList([]);
  }

  Handle_fill_up_and_return_challenges_for_character(args, session) {
    recordAuditEvent("fill_up_and_return_challenges_for_character", args, session);
    return buildEmptyChallengeDict();
  }

  Handle_claim_challenge_rewards(args, session) {
    recordAuditEvent("claim_challenge_rewards", args, session);
    sendChallengeRewardsGranted(session, args && args[0]);
    return false;
  }

  Handle_claim_goal_reward(args, session) {
    recordAuditEvent("claim_goal_reward", args, session);
    return false;
  }

  Handle_process_client_event(args, session, kwargs) {
    recordAuditEvent("process_client_event", args, session, kwargs);
    const progress =
      kwargs && Object.prototype.hasOwnProperty.call(kwargs, "amount")
        ? kwargs.amount
        : 0;
    sendChallengeProgressUpdate(session, DEFAULT_LOGGED_CHALLENGE_ID, progress);
    return null;
  }

  Handle_reload_fsd_data(args, session) {
    recordAuditEvent("reload_fsd_data", args, session);
    return false;
  }
}

SeasonManagerService._testing = {
  getAuditEvents() {
    return auditEvents.slice();
  },
  resetForTests() {
    auditEvents.length = 0;
  },
  constants: {
    DEFAULT_MAX_ACTIVE_CHALLENGES,
    DEFAULT_MAX_SEASONAL_POINTS,
    DEFAULT_LOGGED_CHALLENGE_ID,
  },
  sendChallengeProgressUpdate,
  sendChallengeRewardsGranted,
};

module.exports = SeasonManagerService;
