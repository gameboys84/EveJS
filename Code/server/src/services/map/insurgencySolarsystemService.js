const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  buildFiletimeLong,
  buildList,
  buildPythonSet,
} = require("../_shared/serviceHelpers");

const CAMPAIGN_CLIENT_SNAPSHOT_CLASS =
  "pirateinsurgency.campaignClientSnapshot.CampaignClientSnapshot";
const CAMPAIGN_STATE_ACTIVE = 3;
const FACTION_GURISTAS_PIRATES = 500010;
const FACTION_ANGEL_CARTEL = 500011;

const VISIBLE_CAMPAIGN_SNAPSHOTS = [
  {
    campaignID: 145,
    fsmState: CAMPAIGN_STATE_ACTIVE,
    stateExpiryTimestamp: "134245329960000000",
    warzoneID: 2,
    originSolarsystemID: 30045343,
    coveredSolarsystemIDs: [
      30003840,
      30045344,
      30003842,
      30045316,
      30045349,
      30045318,
      30045345,
      30045320,
      30045353,
      30045314,
      30003837,
      30003839,
      30045338,
      30045339,
      30045340,
      30045341,
      30045342,
      30045343,
    ],
    structureID: 1053927075378,
    piratePointsRequired: 20,
    antipiratePointsRequired: 5,
    piratePointsScored: 12,
    antipiratePointsScored: 1,
    pirateFactionID: FACTION_GURISTAS_PIRATES,
  },
  {
    campaignID: 146,
    fsmState: CAMPAIGN_STATE_ACTIVE,
    stateExpiryTimestamp: "134252617180000000",
    warzoneID: 1,
    originSolarsystemID: 30002975,
    coveredSolarsystemIDs: [
      30002976,
      30002977,
      30002978,
      30003067,
      30002975,
    ],
    structureID: 1054048106597,
    piratePointsRequired: 17,
    antipiratePointsRequired: 5,
    piratePointsScored: 0,
    antipiratePointsScored: 0,
    pirateFactionID: FACTION_ANGEL_CARTEL,
  },
];

function buildCampaignSnapshot(snapshot) {
  return {
    type: "objectex2",
    header: [
      [{ type: "token", value: CAMPAIGN_CLIENT_SNAPSHOT_CLASS }],
      {
        type: "dict",
        entries: [
          ["_antipiratePointsScored", snapshot.antipiratePointsScored],
          [
            "_stateExpiryTimestamp",
            buildFiletimeLong(snapshot.stateExpiryTimestamp),
          ],
          ["_pirateFactionID", snapshot.pirateFactionID],
          ["_warzoneID", snapshot.warzoneID],
          [
            "_coveredSolarsystemIDs",
            buildPythonSet(snapshot.coveredSolarsystemIDs),
          ],
          ["_campaignID", snapshot.campaignID],
          ["_piratePointsRequired", snapshot.piratePointsRequired],
          ["_piratePointsScored", snapshot.piratePointsScored],
          ["_structureID", snapshot.structureID],
          ["_fsmState", snapshot.fsmState],
          ["_originSolarsystemID", snapshot.originSolarsystemID],
          ["_antipiratePointsRequired", snapshot.antipiratePointsRequired],
        ],
      },
    ],
    list: [],
    dict: [],
  };
}

class InsurgencySolarsystemService extends BaseService {
  constructor() {
    super("insurgencySolarsystem");
  }

  Handle_GetAllVisibleCampaigns(args, session) {
    log.debug("[InsurgencySolarsystem] GetAllVisibleCampaigns called");
    return buildList(VISIBLE_CAMPAIGN_SNAPSHOTS.map(buildCampaignSnapshot));
  }

  Handle_GetLocalCampaignClientSnapshot(args, session) {
    log.debug("[InsurgencySolarsystem] GetLocalCampaignClientSnapshot called");
    const solarSystemID =
      Number(
        session && (session.solarsystemid2 || session.solarsystemid),
      ) || 0;

    // Decompiled V23.02 insurgencyCampaignSvc.py does:
    //   solarsystemID, campaignSnapshot =
    //       sm.RemoteSvc('insurgencySolarsystem').GetLocalCampaignClientSnapshot()
    //
    // For the no-active-campaign case, the safe contract is therefore:
    //   (currentSolarSystemID, None)
    //
    // Returning [] crashes with:
    //   ValueError: need more than 0 values to unpack
    return [solarSystemID, null];
  }
}

module.exports = InsurgencySolarsystemService;
module.exports._testing = {
  CAMPAIGN_CLIENT_SNAPSHOT_CLASS,
  VISIBLE_CAMPAIGN_SNAPSHOTS,
  buildCampaignSnapshot,
};
