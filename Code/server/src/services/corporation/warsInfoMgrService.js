const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDbRowset,
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  extractList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const {
  getWarRecord,
  listAllWars,
  listAllWarsDescending,
  listWarsForStructure,
  listWarsForOwner,
} = require(path.join(__dirname, "./warRuntimeState"));

const WARS_PER_PAGE = 50;
const WAR_HEADER = [
  "warID",
  "declaredByID",
  "againstID",
  "timeDeclared",
  "timeFinished",
  "retracted",
  "retractedBy",
  "timeStarted",
  "billID",
  "mutual",
  "createdFromWarID",
  "openForAllies",
  "canBeRetracted",
  "reasonEnded",
  "warHQ",
  "noOfAllies",
  "reasonStarted",
];
const WAR_DBROW_COLUMNS = [
  ["warID", 0x03],
  ["declaredByID", 0x03],
  ["againstID", 0x03],
  ["timeDeclared", 0x40],
  ["timeFinished", 0x40],
  ["retracted", 0x40],
  ["retractedBy", 0x03],
  ["timeStarted", 0x40],
  ["billID", 0x03],
  ["mutual", 0x0b],
  ["createdFromWarID", 0x03],
  ["openForAllies", 0x0b],
  ["canBeRetracted", 0x0b],
  ["reasonEnded", 0x11],
  ["warHQ", 0x14],
  ["noOfAllies", 0x03],
  ["reasonStarted", 0x11],
];

function buildAllyPayload(ally) {
  return buildKeyVal([
    ["allyID", Number(ally && ally.allyID ? ally.allyID : 0)],
    ["timeStarted", buildFiletimeLong(ally && ally.timeStarted ? ally.timeStarted : 0)],
    [
      "timeFinished",
      ally && ally.timeFinished ? buildFiletimeLong(ally.timeFinished) : null,
    ],
  ]);
}

function buildWarPayload(war) {
  return buildKeyVal([
    ["warID", Number(war.warID || 0)],
    ["declaredByID", Number(war.declaredByID || 0)],
    ["againstID", Number(war.againstID || 0)],
    ["warHQID", war.warHQID || null],
    ["warHQ", war.warHQID || null],
    ["timeDeclared", buildFiletimeLong(war.timeDeclared || 0)],
    ["timeStarted", buildFiletimeLong(war.timeStarted || 0)],
    ["timeFinished", war.timeFinished ? buildFiletimeLong(war.timeFinished) : null],
    ["retracted", war.retracted ? buildFiletimeLong(war.retracted) : null],
    ["retractedBy", war.retractedBy || null],
    ["billID", war.billID || null],
    ["mutual", Number(war.mutual || 0)],
    ["openForAllies", Number(war.openForAllies || 0)],
    ["createdFromWarID", war.createdFromWarID || null],
    ["reward", Number(war.reward || 0)],
    [
      "allies",
      buildDict(
        Object.entries(war.allies || {}).map(([allyID, ally]) => [
          Number(allyID),
          buildAllyPayload({
            allyID: Number(allyID),
            ...(ally || {}),
          }),
        ]),
      ),
    ],
  ]);
}

function buildWarRowset(wars = []) {
  return buildDbRowset(
    WAR_DBROW_COLUMNS,
    wars.map((war) => {
      const allies = Object.keys(war.allies || {}).length;
      return [
        Number(war.warID || 0),
        Number(war.declaredByID || 0),
        Number(war.againstID || 0),
        buildFiletimeLong(war.timeDeclared || 0),
        war.timeFinished ? buildFiletimeLong(war.timeFinished) : null,
        war.retracted ? buildFiletimeLong(war.retracted) : null,
        war.retractedBy || null,
        buildFiletimeLong(war.timeStarted || 0),
        war.billID || null,
        Number(war.mutual || 0),
        war.createdFromWarID || null,
        Number(war.openForAllies || 0),
        war.timeFinished || war.retracted ? 0 : 1,
        Number(war.reasonEnded || 0),
        war.warHQID || war.warHQ || null,
        allies,
        Number(war.reasonStarted || 0),
      ];
    }),
    "carbon.common.script.sys.crowset.CRowset",
  );
}

function extractOwnerIDs(rawValue) {
  return extractList(rawValue)
    .map((ownerID) => Number(ownerID) || 0)
    .filter(Boolean);
}

class WarsInfoMgrService extends BaseService {
  constructor() {
    super("warsInfoMgr");
  }

  Handle_GetWarsByOwnerID(args) {
    const ownerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    return buildCachedMethodCallResult(
      buildWarRowset(listWarsForOwner(ownerID)),
      {
        serviceName: "warsInfoMgr",
        method: "GetWarsByOwnerID",
        args: [ownerID],
        versionCheck: "15 minutes",
      },
    );
  }

  Handle_GetWarsByOwners(args) {
    const ownerIDs = extractOwnerIDs(args && args[0]);
    return buildDict(
      ownerIDs.map((ownerID) => [
        ownerID,
        buildDict(
          listWarsForOwner(ownerID).map((war) => [
            Number(war.warID),
            buildWarPayload(war),
          ]),
        ),
      ]),
    );
  }

  Handle_GetWarsRequiringAssistance(args, session) {
    const ownerID =
      (args && args.length > 0 ? Number(args[0]) || 0 : 0) ||
      (session &&
        ((session.allianceID || session.allianceid) ||
          (session.corporationID || session.corpid))) ||
      0;
    return buildList(
      listWarsForOwner(ownerID)
        .filter(
          (war) =>
            Number(war.againstID) === Number(ownerID) && Number(war.openForAllies || 0) === 1,
        )
        .map((war) => buildWarPayload(war)),
    );
  }

  Handle_GetTop50(args) {
    const maxWarID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const effectiveMaxWarID = maxWarID > 0 ? maxWarID : Number.MAX_SAFE_INTEGER;
    return buildCachedMethodCallResult(
      buildWarRowset(
        listAllWarsDescending()
        .filter((war) => Number(war.warID || 0) < effectiveMaxWarID)
        .slice(0, WARS_PER_PAGE),
      ),
      {
        serviceName: "warsInfoMgr",
        method: "GetTop50",
        args: [maxWarID],
        versionCheck: "15 minutes",
      },
    );
  }

  Handle_GetPublicWarInfo(args) {
    const warID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const war = getWarRecord(warID);
    return war ? buildWarPayload(war) : null;
  }

  Handle_GetWarsForStructure(args) {
    const structureID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    return buildList(
      listWarsForStructure(structureID)
        .sort((left, right) => Number(right.timeDeclared || 0) - Number(left.timeDeclared || 0))
        .map((war) => buildWarPayload(war)),
    );
  }
}

module.exports = WarsInfoMgrService;
