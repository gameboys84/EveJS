const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDbRowset,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  listPeaceTreatiesForOwner,
} = require(path.join(__dirname, "./warNegotiationRuntimeState"));

function buildTreatyPayload(treaty) {
  return buildKeyVal([
    ["treatyID", Number(treaty && treaty.treatyID ? treaty.treatyID : 0)],
    ["warID", Number(treaty && treaty.warID ? treaty.warID : 0)],
    ["ownerID", Number(treaty && treaty.ownerID ? treaty.ownerID : 0)],
    ["otherOwnerID", Number(treaty && treaty.otherOwnerID ? treaty.otherOwnerID : 0)],
    ["peaceReason", Number(treaty && treaty.peaceReason ? treaty.peaceReason : 0)],
    [
      "createdDate",
      treaty && treaty.createdDate ? buildFiletimeLong(treaty.createdDate) : null,
    ],
    [
      "expiryDate",
      treaty && treaty.expiryDate ? buildFiletimeLong(treaty.expiryDate) : null,
    ],
  ]);
}

const PEACE_TREATY_DBROW_COLUMNS = [
  ["otherOwnerID", 0x03],
  ["expiryDate", 0x40],
  ["peaceReason", 0x11],
  ["warID", 0x03],
  ["reasonEnded", 0x11],
  ["warHQ", 0x14],
];

function buildTreatyRowset(treaties = []) {
  return buildDbRowset(
    PEACE_TREATY_DBROW_COLUMNS,
    treaties.map((treaty) => [
      Number(treaty && treaty.otherOwnerID) || 0,
      treaty && treaty.expiryDate ? buildFiletimeLong(treaty.expiryDate) : null,
      Number(treaty && treaty.peaceReason) || 0,
      Number(treaty && treaty.warID) || 0,
      Number(treaty && treaty.reasonEnded) || 0,
      treaty && (treaty.warHQ || treaty.warHQID) ? Number(treaty.warHQ || treaty.warHQID) : null,
    ]),
    "carbon.common.script.sys.crowset.CRowset",
  );
}

class PeaceTreatyManagerService extends BaseService {
  constructor() {
    super("peaceTreatyMgr");
  }

  Handle_GetPeaceTreatiesForSession(args, session) {
    const ownerID =
      (session &&
        ((session.allianceID || session.allianceid) ||
          (session.corporationID || session.corpid))) ||
      0;
    const { outgoing, incoming } = listPeaceTreatiesForOwner(ownerID);
    return [
      buildTreatyRowset(outgoing),
      buildTreatyRowset(incoming),
    ];
  }
}

module.exports = PeaceTreatyManagerService;
