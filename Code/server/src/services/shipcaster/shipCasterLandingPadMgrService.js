const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const runtime = require(path.join(__dirname, "./shipcasterRuntime"));

class ShipCasterLandingPadMgrService extends BaseService {
  constructor() {
    super("shipCasterLandingPadMgr");
  }

  Handle_GetFactionLandingPads(args, session) {
    const factionID = runtime.toInt(
      Array.isArray(args) && args.length > 0 ? args[0] : 0,
      0,
    );
    runtime.recordAuditEvent("get_faction_landing_pads", args, session, {
      factionID,
    });
    return runtime.buildLandingPadListPayload(runtime.listLandingPads(factionID));
  }

  Handle_GetAllLandingPads(args, session) {
    runtime.recordAuditEvent("get_all_landing_pads", args, session);
    return runtime.buildLandingPadListPayload(runtime.listLandingPads());
  }
}

ShipCasterLandingPadMgrService._testing = runtime;

module.exports = ShipCasterLandingPadMgrService;
