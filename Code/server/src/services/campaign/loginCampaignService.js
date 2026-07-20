/**
 * Login Campaign Services (loginCampaignManager, seasonalLoginCampaignManager)
 *
 * V23.02 client queries these during the character selection phase.
 * The seasonalLoginCampaignService.prime_campaign_data() iterates the result,
 * so we must return empty lists/dicts (not null).
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const MAX_AUDIT_EVENTS = 100;
const auditEvents = [];

function safeClone(value) {
  try {
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

function recordCampaignAuditEvent(kind, args, session) {
  auditEvents.push({
    kind,
    args: safeClone(args),
    characterID: Number(session && (session.characterID || session.charid)) || 0,
    accountID: Number(session && (session.userid || session.userID)) || 0,
    recordedAt: new Date().toISOString(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

const testing = {
  getAuditEvents() {
    return auditEvents.map((entry) => ({ ...entry }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

class LoginCampaignMgrService extends BaseService {
  constructor() {
    super("loginCampaignManager");
  }

  Handle_GetActiveCampaigns(args, session) {
    log.debug("[LoginCampaignMgr] GetActiveCampaigns");
    return { type: "list", items: [] };
  }

  Handle_GetCampaignData(args, session) {
    log.debug("[LoginCampaignMgr] GetCampaignData");
    return { type: "dict", entries: [] };
  }

  Handle_GetPlayerProgress(args, session) {
    log.debug("[LoginCampaignMgr] GetPlayerProgress");
    return { type: "dict", entries: [] };
  }

  Handle_get_client_campaign_state(args, session) {
    log.debug("[LoginCampaignMgr] get_client_campaign_state");
    // Client accesses result.item_progress — return None so can_claim_now checks None
    return null;
  }

  Handle_claim_reward(args, session) {
    recordCampaignAuditEvent("login_campaign_claim_reward_no_active_campaign", args, session);
    log.info("[LoginCampaignMgr] claim_reward -> no active campaign");
    return null;
  }
}

class SeasonalLoginCampaignMgrService extends BaseService {
  constructor() {
    super("seasonalLoginCampaignManager");
  }

  Handle_GetActiveCampaigns(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] GetActiveCampaigns");
    return { type: "list", items: [] };
  }

  Handle_GetCampaignData(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] GetCampaignData");
    return { type: "list", items: [] };
  }

  Handle_GetPlayerProgress(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] GetPlayerProgress");
    return { type: "dict", entries: [] };
  }

  Handle_get_active_campaign(args, session) {
    log.debug("[SeasonalLoginCampaignMgr] get_active_campaign");

    return [null, null, null, null];
  }

  Handle_claim_reward(args, session) {
    recordCampaignAuditEvent("seasonal_login_claim_reward_no_active_campaign", args, session);
    log.info("[SeasonalLoginCampaignMgr] claim_reward -> false");
    return false;
  }

  Handle_get_claim_history(args, session) {
    recordCampaignAuditEvent("seasonal_login_get_claim_history_empty", args, session);
    log.debug("[SeasonalLoginCampaignMgr] get_claim_history -> empty dict");
    return buildDict([]);
  }
}

LoginCampaignMgrService._testing = testing;
SeasonalLoginCampaignMgrService._testing = testing;

module.exports = { LoginCampaignMgrService, SeasonalLoginCampaignMgrService };
