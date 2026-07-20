const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildList,
  extractList,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const MAX_AUDIT_EVENTS = 100;
const auditEvents = [];

function normalizeGroupIDs(args) {
  return extractList(args && args[0])
    .map((value) => normalizeNumber(value, 0))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function recordAuditEvent(kind, session, extra = {}) {
  auditEvents.push({
    kind,
    characterID: Number(session && (session.characterID || session.charid)) || 0,
    accountID: Number(session && (session.userid || session.userID)) || 0,
    recordedAt: new Date().toISOString(),
    ...extra,
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

class RewardMgrService extends BaseService {
  constructor() {
    super("rewardMgr");
  }

  Handle_GetDelayedRewardsByGroupIDs(args, session) {
    const rewardGroupIDs = normalizeGroupIDs(args);
    recordAuditEvent("get_delayed_rewards_empty", session, {
      rewardGroupIDs,
    });
    log.debug(
      `[RewardMgr] GetDelayedRewardsByGroupIDs groups=${rewardGroupIDs.length} -> empty dict`,
    );
    return buildDict([]);
  }

  Handle_GetRewardLPLogs(args, session) {
    recordAuditEvent("get_reward_lp_logs_empty", session);
    log.debug("[RewardMgr] GetRewardLPLogs -> empty list");
    return buildList([]);
  }
}

RewardMgrService._testing = {
  getAuditEvents() {
    return auditEvents.map((entry) => ({ ...entry }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

module.exports = RewardMgrService;
