/**
 * browser stuff
 **/

const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));

const DEFAULT_BROWSER_HOME_PAGE = "about:blank";
const EMPTY_FLAGGED_SITES_HASH = "d751713988987e9331980363e24189ce";

class browserLockdownSvcService extends BaseService {
  constructor() {
    super("browserLockdownSvc");
  }

  Handle_GetDefaultHomePage(args, session) {
    void args;
    void session;
    return DEFAULT_BROWSER_HOME_PAGE;
  }

  Handle_IsBrowserInLockdown(args, session) {
    void args;
    void session;
    return false;
  }

  Handle_GetFlaggedSitesHash(args, session) {
    void args;
    void session;
    return EMPTY_FLAGGED_SITES_HASH;
  }

  Handle_GetFlaggedSitesList(args, session) {
    void args;
    void session;
    return [];
  }
}

module.exports = browserLockdownSvcService;
