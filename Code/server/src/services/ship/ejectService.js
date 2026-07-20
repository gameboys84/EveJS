const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  launchShipOrContainerFromWreckOrContainer,
} = require(path.join(__dirname, "./ejectRuntime"));

class EjectService extends BaseService {
  constructor() {
    super("eject");
  }

  Handle_LaunchShipOrContainerFromWreckOrContainer(args, session) {
    const sourceLocationID = args && args.length > 0 ? args[0] : 0;
    const itemID = args && args.length > 1 ? args[1] : 0;
    const result = launchShipOrContainerFromWreckOrContainer(
      session,
      sourceLocationID,
      itemID,
    );
    if (!result || result.success !== true) {
      log.warn(
        `[Eject] LaunchShipOrContainerFromWreckOrContainer failed source=${sourceLocationID} item=${itemID}: ${result ? result.errorMsg : "UNKNOWN_ERROR"}`,
      );
    }
    return null;
  }
}

module.exports = EjectService;
