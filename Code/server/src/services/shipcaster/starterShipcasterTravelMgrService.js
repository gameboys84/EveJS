const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const runtime = require(path.join(__dirname, "./shipcasterRuntime"));

function throwStarterShipcasterUnavailable() {
  throwWrappedUserError("CustomNotify", {
    notify: "No starter shipcaster destination is available.",
  });
}

class StarterShipcasterTravelMgrService extends BaseService {
  constructor() {
    super("starterShipcasterTravelMgr");
  }

  Handle_CanCharacterJump(args, session) {
    const canJump = runtime.canCharacterUseStarterShipcaster(session);
    runtime.recordAuditEvent("starter_shipcaster_can_character_jump", args, session, {
      canJump,
    });
    return canJump;
  }

  Handle_CmdJumpThroughStarterShipcaster(args, session) {
    const shipcasterID = runtime.toInt(args && args[0], 0);
    runtime.recordAuditEvent("starter_shipcaster_jump_rejected", args, session, {
      shipcasterID,
    });
    throwStarterShipcasterUnavailable();
  }
}

StarterShipcasterTravelMgrService._testing = {
  ...runtime,
  throwStarterShipcasterUnavailable,
};

module.exports = StarterShipcasterTravelMgrService;
