const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { buildList } = require(path.join(__dirname, "../_shared/serviceHelpers"));

const ABYSS_ERROR = Object.freeze({
  ENTRANCE_MISSING: 30,
  UNKNOWN_ERROR: 22,
});

const auditEvents = [];

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterID(session = null) {
  return toInt(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
    0,
  );
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

function buildErrorList(errors) {
  return buildList(
    (Array.isArray(errors) ? errors : [])
      .map(([code, args]) => [
        toInt(code, ABYSS_ERROR.UNKNOWN_ERROR),
        Array.isArray(args) ? args : [],
      ]),
  );
}

function throwAbyssError(errors) {
  throwWrappedUserError("AbyssError", {
    errors: buildErrorList(errors),
  });
}

function throwGateRejected() {
  throwWrappedUserError("DeniedTargetAttemptFailed");
}

class AbyssalMgrService extends BaseService {
  constructor() {
    super("abyssalMgr");
  }

  Handle_AbyssalEntranceDeployment(args, session) {
    recordAuditEvent("abyssal_entrance_deployment_rejected", args, session);
    log.debug(
      "[AbyssalMgr] AbyssalEntranceDeployment rejected: Abyssal content generation is not available",
    );
    throwAbyssError([[ABYSS_ERROR.UNKNOWN_ERROR, []]]);
  }

  Handle_AbyssalEntranceGateActivation(args, session) {
    recordAuditEvent("abyssal_entrance_gate_activation_rejected", args, session);
    log.debug(
      "[AbyssalMgr] AbyssalEntranceGateActivation rejected: no runtime Abyssal entrance trace exists",
    );
    throwAbyssError([[ABYSS_ERROR.ENTRANCE_MISSING, []]]);
  }

  Handle_AbyssalGateActivation(args, session) {
    recordAuditEvent("abyssal_gate_activation_rejected", args, session);
    log.debug(
      "[AbyssalMgr] AbyssalGateActivation rejected: no active Abyssal pocket runtime state exists",
    );
    throwGateRejected();
  }

  Handle_AbyssalEndGateActivation(args, session) {
    recordAuditEvent("abyssal_end_gate_activation_rejected", args, session);
    log.debug(
      "[AbyssalMgr] AbyssalEndGateActivation rejected: no active Abyssal origin trace exists",
    );
    throwGateRejected();
  }

  Handle_ClientIsReady(args, session) {
    recordAuditEvent("client_is_ready_without_content", args, session);
    return null;
  }
}

AbyssalMgrService._testing = {
  constants: {
    ABYSS_ERROR,
  },
  getAuditEvents() {
    return auditEvents.map((entry) => ({ ...entry }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

module.exports = AbyssalMgrService;
