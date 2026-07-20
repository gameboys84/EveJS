const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getItemKillCountNPC,
  getItemKillCountPlayer,
} = require(path.join(__dirname, "./shipKillCounterState"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));

class ShipKillCounterService extends BaseService {
  constructor() {
    super("shipKillCounter");
  }

  Handle_GetItemKillCountPlayer(args, session, kwargs) {
    const itemID = args && args.length > 0 ? args[0] : null;
    const count = getItemKillCountPlayer(itemID);
    log.debug(`[ShipKillCounter] GetItemKillCountPlayer(itemID=${itemID}) -> ${count}`);
    return buildCachedMethodCallResult(count, {
      serviceName: this.name,
      method: "GetItemKillCountPlayer",
      args: [itemID],
      versionCheck: "5 minutes",
      sessionInfo: "charid",
      sessionInfoValue: session && (session.charid || session.charID || session.characterID),
    });
  }

  Handle_GetItemKillCountNPC(args, session, kwargs) {
    const itemID = args && args.length > 0 ? args[0] : null;
    const count = getItemKillCountNPC(itemID);
    log.debug(`[ShipKillCounter] GetItemKillCountNPC(itemID=${itemID}) -> ${count}`);
    return count;
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[ShipKillCounter] Unhandled method fallback: ${method}`);
    return 0;
  }
}

module.exports = ShipKillCounterService;
