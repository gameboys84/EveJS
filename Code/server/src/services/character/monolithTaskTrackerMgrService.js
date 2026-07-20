const AchievementTrackerMgrService = require("./achievementTrackerMgrService");

class MonolithTaskTrackerMgrService extends AchievementTrackerMgrService {
  constructor() {
    super("monolithTaskTrackerMgr");
  }
}

module.exports = MonolithTaskTrackerMgrService;
