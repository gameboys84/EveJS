/**
 * Online Status Service (onlineStatus)
 *
 * Handles online status queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getSessionCharacterID,
  isCharacterOnline,
  listInitialOnlineStatusRows,
} = require(path.join(__dirname, "./onlineStatusRuntime"));

const ONLINE_STATUS_COLUMNS = ["contactID", "online"];

function normalizeCharacterID(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

class OnlineStatusService extends BaseService {
  constructor() {
    super("onlineStatus");
  }

  Handle_GetOnlineStatus(args, session) {
    const targetID = normalizeCharacterID(args && args[0]);
    const observerID = getSessionCharacterID(session);
    const online = isCharacterOnline(targetID, observerID);
    log.debug(
      `[OnlineStatus] GetOnlineStatus observer=${observerID || "none"} target=${targetID || "none"} -> ${online}`,
    );
    return online;
  }

  Handle_GetInitialState(args, session) {
    const observerID = getSessionCharacterID(session);
    const rows = listInitialOnlineStatusRows(observerID);
    log.debug(`[OnlineStatus] GetInitialState observer=${observerID || "none"} rows=${rows.length}`);
    return buildRowset(ONLINE_STATUS_COLUMNS, rows, "eve.common.script.sys.rowset.Rowset");
  }

  Handle_Prime(args, session) {
    return this.Handle_GetInitialState(args, session);
  }
}

module.exports = OnlineStatusService;
