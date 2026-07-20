const BaseService = require("../baseService");
const log = require("../../utils/logger");

class MilestoneMgrService extends BaseService {
  constructor() {
    super("milestoneMgr");
  }

  Handle_ProcessCharacterLogon(args, session) {
    log.debug("[MilestoneMgr] ProcessCharacterLogon called");
    return null;
  }

  Handle_ClaimRewards(args, session) {
    const milestoneID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const characterID = Number(
      session && (session.characterID || session.charid || session.userid),
    ) || 0;
    log.debug(
      `[MilestoneMgr] ClaimRewards milestone=${milestoneID} char=${characterID}`,
    );
    return null;
  }
}

module.exports = MilestoneMgrService;
