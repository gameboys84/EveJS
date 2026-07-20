const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const SubscriptionMgrService = require(path.join(
  __dirname,
  "../subscription/subscriptionMgrService",
));

const CLONE_STATE_ALPHA = 0;
const CLONE_STATE_OMEGA = 1;
const MAX_AUDIT_EVENTS = 100;
const auditEvents = [];

function toPositiveInteger(value) {
  const numericValue = Number(value || 0);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : 0;
}

function normalizeComputerHash(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim().toLowerCase();
  }
  return String(value).trim().toLowerCase();
}

function normalizeCloneGrade(value) {
  const numericValue = Number(value);
  return numericValue === CLONE_STATE_ALPHA
    ? CLONE_STATE_ALPHA
    : CLONE_STATE_OMEGA;
}

function getAccountID(session) {
  return toPositiveInteger(
    session && (session.userid || session.userID || session.accountID),
  );
}

function getCharacterID(session) {
  return toPositiveInteger(
    session && (session.characterID || session.charID || session.charid),
  );
}

function envEnforcesAlphaMultiLogin() {
  const rawValue = process.env.EVE_ENFORCE_ALPHA_MULTILOGIN;
  if (!rawValue) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(
    String(rawValue).trim().toLowerCase(),
  );
}

function recordAuditEvent(event) {
  auditEvents.push({
    ...event,
    recordedAt: new Date().toISOString(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

class MultiLoginBlockerService extends BaseService {
  constructor(options = {}) {
    super("multiLoginBlocker");
    this.subscriptionService =
      options.subscriptionService || new SubscriptionMgrService();
    this.cloneGradeProvider =
      typeof options.cloneGradeProvider === "function"
        ? options.cloneGradeProvider
        : null;
    this.getSessions =
      typeof options.getSessions === "function"
        ? options.getSessions
        : () => sessionRegistry.getSessions();
    this.enforceAlphaMultiLogin =
      typeof options.enforceAlphaMultiLogin === "boolean"
        ? options.enforceAlphaMultiLogin
        : envEnforcesAlphaMultiLogin();
  }

  _resolveCloneGrade(session) {
    if (session) {
      for (const key of ["multiLoginCloneGrade", "cloneGrade", "cloneState"]) {
        if (session[key] !== undefined && session[key] !== null) {
          return normalizeCloneGrade(session[key]);
        }
      }
    }

    if (this.cloneGradeProvider) {
      return normalizeCloneGrade(this.cloneGradeProvider(session));
    }

    try {
      return normalizeCloneGrade(
        this.subscriptionService.Handle_GetCloneGrade([], session),
      );
    } catch (error) {
      log.warn(
        `[multiLoginBlocker] Clone-grade lookup failed, defaulting to Omega allow-state: ${error.message}`,
      );
      return CLONE_STATE_OMEGA;
    }
  }

  _findAlphaConflict(session, computerHash, cloneGrade) {
    if (!computerHash) {
      return null;
    }

    const accountID = getAccountID(session);
    const sessions = this.getSessions();
    const activeSessions = Array.isArray(sessions) ? sessions : [];
    for (const otherSession of activeSessions) {
      if (!otherSession || otherSession === session) {
        continue;
      }

      const otherAccountID = getAccountID(otherSession);
      if (accountID > 0 && otherAccountID === accountID) {
        continue;
      }

      const otherComputerHash = normalizeComputerHash(
        otherSession.multiLoginComputerHash ||
          otherSession.computerHash ||
          otherSession.computerhash,
      );
      if (!otherComputerHash || otherComputerHash !== computerHash) {
        continue;
      }

      const otherCloneGrade = this._resolveCloneGrade(otherSession);
      if (
        cloneGrade === CLONE_STATE_ALPHA ||
        otherCloneGrade === CLONE_STATE_ALPHA
      ) {
        return {
          session: otherSession,
          accountID: otherAccountID,
          characterID: getCharacterID(otherSession),
          cloneGrade: otherCloneGrade,
          computerHash: otherComputerHash,
        };
      }
    }

    return null;
  }

  Handle_Login(args, session) {
    const computerHash = normalizeComputerHash(args && args[0]);
    if (session && computerHash) {
      session.multiLoginComputerHash = computerHash;
    }

    const cloneGrade = this._resolveCloneGrade(session);
    const conflict = this.enforceAlphaMultiLogin
      ? this._findAlphaConflict(session, computerHash, cloneGrade)
      : null;
    const allowed = conflict === null;
    const reason = !this.enforceAlphaMultiLogin
      ? "alpha_policy_not_enforced_default_allow"
      : !computerHash
        ? "missing_computer_hash_default_allow"
        : allowed
          ? "no_alpha_conflict"
          : "alpha_multi_login_restricted";

    recordAuditEvent({
      kind: "login_check",
      allowed,
      reason,
      computerHash,
      cloneGrade,
      characterID: getCharacterID(session),
      accountID: getAccountID(session),
      conflictingAccountID: conflict ? conflict.accountID : 0,
      conflictingCharacterID: conflict ? conflict.characterID : 0,
      conflictingCloneGrade: conflict ? conflict.cloneGrade : null,
    });

    if (!allowed) {
      log.info(
        `[multiLoginBlocker] blocked account=${getAccountID(session)} cloneGrade=${cloneGrade} conflictAccount=${conflict.accountID}`,
      );
      return false;
    }

    log.debug(
      `[multiLoginBlocker] Login allow account=${getAccountID(session)} cloneGrade=${cloneGrade} reason=${reason}`,
    );
    return true;
  }
}

MultiLoginBlockerService._testing = {
  CLONE_STATE_ALPHA,
  CLONE_STATE_OMEGA,
  getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
  normalizeComputerHash,
};

module.exports = MultiLoginBlockerService;
