const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

let hijackMode = {
  enabled: false,
  error: null,
  latency: null,
};

function normalizeOptionalValue(value) {
  const unwrapped = unwrapMarshalValue(value);
  return unwrapped === undefined ? null : unwrapped;
}

class ServiceGatewayMgrService extends BaseService {
  constructor() {
    super("serviceGatewayMgr");
  }

  Handle_qa_is_hijack_mode_enabled() {
    log.debug(`[ServiceGatewayMgr] qa_is_hijack_mode_enabled=${hijackMode.enabled}`);
    return hijackMode.enabled;
  }

  Handle_qa_enable_hijack_mode(args) {
    hijackMode = {
      enabled: true,
      error: normalizeOptionalValue(args && args[0]),
      latency: normalizeOptionalValue(args && args[1]),
    };
    log.debug("[ServiceGatewayMgr] qa hijack mode enabled");
    return null;
  }

  Handle_qa_disable_hijack_mode() {
    hijackMode = {
      enabled: false,
      error: null,
      latency: null,
    };
    log.debug("[ServiceGatewayMgr] qa hijack mode disabled");
    return null;
  }
}

module.exports = ServiceGatewayMgrService;
module.exports._testing = {
  getHijackMode() {
    return { ...hijackMode };
  },
  resetForTests() {
    hijackMode = {
      enabled: false,
      error: null,
      latency: null,
    };
  },
};
