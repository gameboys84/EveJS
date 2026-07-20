const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildClientJumpTimerTuple,
} = require(path.join(__dirname, "../_shared/jumpTimerRuntime"));

class JumpTimersService extends BaseService {
  constructor() {
    super("jumpTimers");
  }

  Handle_GetTimers(args, session) {
    const requestedCharacterID = Array.isArray(args) ? Number(args[0]) || 0 : 0;
    const sessionCharacterID = Number(session && session.characterID) || 0;
    const characterID =
      requestedCharacterID > 0 && requestedCharacterID === sessionCharacterID
        ? requestedCharacterID
        : sessionCharacterID;
    log.debug(`[JumpTimers] GetTimers called char=${characterID}`);
    return buildClientJumpTimerTuple(characterID);
  }
}

module.exports = JumpTimersService;
