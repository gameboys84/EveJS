const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const SubscriptionMgrService = require(path.join(
  __dirname,
  "../subscription/subscriptionMgrService",
));

const MAX_AUDIT_EVENTS = 100;
const auditEvents = [];

function recordAuditEvent(kind, session) {
  auditEvents.push({
    kind,
    characterID: Number(session && (session.characterID || session.charid)) || 0,
    accountID: Number(session && (session.userid || session.userID)) || 0,
    recordedAt: new Date().toISOString(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

class LoginRewardFacilitiesService extends BaseService {
  constructor() {
    super("loginRewardFacilities");
  }

  Handle_get_my_clone_grade(args, session) {
    recordAuditEvent("get_my_clone_grade", session);
    const cloneGrade = new SubscriptionMgrService().Handle_GetCloneGrade(args, session);
    log.debug(`[LoginRewardFacilities] get_my_clone_grade -> ${cloneGrade}`);
    return cloneGrade;
  }
}

LoginRewardFacilitiesService._testing = {
  getAuditEvents() {
    return auditEvents.map((entry) => ({ ...entry }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

module.exports = LoginRewardFacilitiesService;
