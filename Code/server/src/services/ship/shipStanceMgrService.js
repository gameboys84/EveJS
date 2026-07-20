const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const shipStanceRuntime = require(path.join(__dirname, "./shipStanceRuntime"));

const ERROR_NOTIFY = Object.freeze({
  CHARACTER_NOT_FOUND: "Select a character before changing ship stance.",
  SHIP_NOT_FOUND: "Ship stance can only be changed for a valid ship.",
  SHIP_NOT_OWNED: "You can only change stance on your own ship.",
  SHIP_STANCE_UNSUPPORTED: "That ship does not support tactical modes.",
  SHIP_STANCE_INVALID: "That tactical mode is not available for this ship.",
  ITEM_CREATE_FAILED: "Could not update ship stance state.",
});

function throwStanceError(errorMsg) {
  throwWrappedUserError("CustomNotify", {
    notify: ERROR_NOTIFY[errorMsg] || ERROR_NOTIFY.ITEM_CREATE_FAILED,
  });
}

class ShipStanceMgrService extends BaseService {
  constructor() {
    super("shipStanceMgr");
  }

  Handle_SetShipStance(args, session) {
    const shipID = shipStanceRuntime.toInt(args && args[0], 0);
    const stanceID = shipStanceRuntime.toInt(args && args[1], 0);
    const result = shipStanceRuntime.setShipStance(
      shipID,
      stanceID,
      session,
    );

    if (!result || result.success !== true) {
      throwStanceError(result && result.errorMsg);
    }

    return result.oldStanceID;
  }
}

ShipStanceMgrService._testing = {
  ...shipStanceRuntime,
  ERROR_NOTIFY,
  throwStanceError,
};

module.exports = ShipStanceMgrService;
