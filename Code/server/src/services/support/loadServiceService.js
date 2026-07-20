const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

let config = {
  pyStoneTasklets: 0,
  pyStonesPerSec: 0,
  pyStonesPerUnit: 0,
  netTasklets: 0,
  packetsP2S: 0,
  packetsS2P: 0,
  packetsS2S: 0,
};
let running = false;

function normalizeConfig(rawConfig) {
  const unwrapped = unwrapMarshalValue(rawConfig);
  if (!unwrapped || typeof unwrapped !== "object") {
    return {};
  }
  return unwrapped;
}

function buildStats() {
  return {
    cpu: {
      loopCount: 0,
      slowCount: 0,
      pyStonesPerSec: 0,
    },
    net: {
      loopCount: 0,
      slowCount: 0,
    },
  };
}

class LoadService extends BaseService {
  constructor() {
    super("loadService");
  }

  Handle_SetConfig(args) {
    const incoming = normalizeConfig(args && args[0]);
    config = {
      ...config,
      ...Object.fromEntries(
        Object.entries(incoming).filter(([, value]) => Number.isFinite(Number(value))),
      ),
    };
    log.debug("[LoadService] SetConfig accepted without starting load");
    return null;
  }

  Handle_GetTotalStats() {
    log.debug("[LoadService] GetTotalStats");
    return buildStats();
  }

  Handle_GetConfig() {
    return { ...config };
  }

  Handle_IsRunning() {
    return running;
  }

  Handle_StartLoad() {
    running = false;
    log.info("[LoadService] StartLoad acknowledged without generating emulator load");
    return null;
  }

  Handle_StopLoad() {
    running = false;
    return null;
  }

  Handle_Ping(args) {
    return args && args.length > 0 ? args[0] : buildDict([]);
  }
}

module.exports = LoadService;
module.exports._testing = {
  getConfig() {
    return { ...config };
  },
  getRunning() {
    return running;
  },
  resetForTests() {
    config = {
      pyStoneTasklets: 0,
      pyStonesPerSec: 0,
      pyStonesPerUnit: 0,
      netTasklets: 0,
      packetsP2S: 0,
      packetsS2P: 0,
      packetsS2S: 0,
    };
    running = false;
  },
};
