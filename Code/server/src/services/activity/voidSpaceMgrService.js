const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { buildList } = require(path.join(__dirname, "../_shared/serviceHelpers"));

const VOID_SPACE_JUMP_ERROR = Object.freeze({
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
        toInt(code, VOID_SPACE_JUMP_ERROR.UNKNOWN_ERROR),
        Array.isArray(args) ? args : [],
      ]),
  );
}

function throwVoidSpaceJumpError(errors) {
  throwWrappedUserError("VoidSpaceJumpError", {
    errors: buildErrorList(errors),
  });
}

function throwGateRejected() {
  throwWrappedUserError("DeniedTargetAttemptFailed");
}

class VoidSpaceMgrService extends BaseService {
  constructor() {
    super("voidSpaceMgr");
  }

  Handle_VoidSpacePlayerJump(args, session) {
    recordAuditEvent("void_space_player_jump_rejected", args, session);
    log.debug(
      "[VoidSpaceMgr] VoidSpacePlayerJump rejected: Void Space encounter runtime is not available",
    );
    throwVoidSpaceJumpError([[VOID_SPACE_JUMP_ERROR.UNKNOWN_ERROR, []]]);
  }

  Handle_VoidSpaceEndGateActivation(args, session) {
    recordAuditEvent("void_space_end_gate_activation_rejected", args, session);
    log.debug(
      "[VoidSpaceMgr] VoidSpaceEndGateActivation rejected: no active Void Space origin state exists",
    );
    throwGateRejected();
  }

  Handle_ClientIsReady(args, session) {
    recordAuditEvent("client_is_ready_without_content", args, session);
    return null;
  }
}

VoidSpaceMgrService._testing = {
  constants: {
    VOID_SPACE_JUMP_ERROR,
  },
  getAuditEvents() {
    return auditEvents.map((entry) => ({ ...entry }));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};

module.exports = VoidSpaceMgrService;
