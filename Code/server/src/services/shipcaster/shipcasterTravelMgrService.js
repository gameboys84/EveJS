const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const runtime = require(path.join(__dirname, "./shipcasterRuntime"));

function throwShipcasterUnavailable() {
  throwWrappedUserError("CustomNotify", {
    notify: "No active shipcaster destination is available.",
  });
}

class ShipcasterTravelMgrService extends BaseService {
  constructor() {
    super("shipcasterTravelMgr");
  }

  Handle_CmdJumpThroughShipcaster(args, session) {
    const shipcasterID = runtime.toInt(args && args[0], 0);
    const destinationSolarSystemID = runtime.toInt(args && args[1], 0);
    const landingPadID = runtime.toInt(args && args[2], 0);
    runtime.recordAuditEvent("shipcaster_jump_rejected", args, session, {
      shipcasterID,
      destinationSolarSystemID,
      landingPadID,
    });
    throwShipcasterUnavailable();
  }
}

ShipcasterTravelMgrService._testing = {
  ...runtime,
  throwShipcasterUnavailable,
};

module.exports = ShipcasterTravelMgrService;
