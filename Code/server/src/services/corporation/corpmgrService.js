const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDbRowset,
  buildFiletimeLong,
  buildList,
  buildDict,
  buildRow,
  buildKeyVal,
  buildRowset,
  extractList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  NPC_STARTER_CORPORATION_ID,
  getCorporationPublicInfo,
} = require(path.join(__dirname, "./corporationState"));
const {
  getCorporationDivisionNames,
  getCorporationMember,
  getCorporationRuntime,
  toRoleMaskBigInt,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  buildAggressionSettingsPayload,
  readAggressionSettings,
} = require(path.join(__dirname, "./aggressionSettingsState"));
const {
  buildAssetItemCrowset,
  buildAssetItemRowset,
  buildAssetLocationCrowset,
  buildAssetSearchCrowset,
  buildLocationList,
  listAssetItemsForLocation,
  listAssetLocations,
  searchAssetLocations,
} = require(path.join(__dirname, "./corpAssetState"));
const {
  getCorporationWarPermitStatus,
} = require(path.join(__dirname, "./warPermitState"));
const CORPORATION_ROW_HEADER = [
  "corporationID",
  "corporationName",
  "ticker",
  "tickerName",
  "ceoID",
  "creatorID",
  "allianceID",
  "factionID",
  "warFactionID",
  "membership",
  "description",
  "url",
  "stationID",
  "deleted",
  "taxRate",
  "loyaltyPointTaxRate",
  "friendlyFire",
  "memberCount",
  "memberLimit",
  "shares",
  "allowWar",
  "allowedMemberRaceIDs",
  "corporationType",
  "minimumJoinStanding",
  "sendCharTerminationMessage",
  "createDate",
  "aggressionEnableAfter",
  "aggressionDisableAfter",
  "applicationsEnabled",
  "division1",
  "division2",
  "division3",
  "division4",
  "division5",
  "division6",
  "division7",
  "walletDivision1",
  "walletDivision2",
  "walletDivision3",
  "walletDivision4",
  "walletDivision5",
  "walletDivision6",
  "walletDivision7",
  "shape1",
  "shape2",
  "shape3",
  "color1",
  "color2",
  "color3",
  "typeface",
  "isRecruiting",
];
const ROWSET_NAME = "eve.common.script.sys.rowset.Rowset";
const CORP_ROLE_DIRECTOR = 1n;
const CORP_ROLE_AUDITOR = 4096n;
const AUDIT_LOG_EVENT_HEADER = [
  "eventID",
  "eventDateTime",
  "eventTypeID",
  "characterID",
  "corporationID",
];
const AUDIT_LOG_EVENT_DBROW_COLUMNS = [
  ["eventID", 0x14],
  ["eventDateTime", 0x40],
  ["eventTypeID", 0x02],
  ["characterID", 0x03],
  ["corporationID", 0x03],
];
const ROLE_HISTORY_HEADER = [
  "characterID",
  "corporationID",
  "changeTime",
  "grantable",
  "oldRoles",
  "newRoles",
  "issuerID",
];
const ROLE_HISTORY_DBROW_COLUMNS = [
  ["characterID", 0x03],
  ["corporationID", 0x03],
  ["changeTime", 0x40],
  ["grantable", 0x0b],
  ["oldRoles", 0x14],
  ["newRoles", 0x14],
  ["issuerID", 0x03],
];

function buildLong(value) {
  return {
    type: "long",
    value: toRoleMaskBigInt(value, 0n),
  };
}

function normalizeInteger(value, fallback = 0) {
  if (
    value &&
    typeof value === "object" &&
    (value.type === "long" || value.type === "int")
  ) {
    return normalizeInteger(value.value, fallback);
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function normalizeAuditTime(value, fallback = 0n) {
  try {
    if (value && typeof value === "object" && value.type === "long") {
      return normalizeAuditTime(value.value, fallback);
    }
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
  } catch (_error) {
    return fallback;
  }
  return fallback;
}

function getFirstPresent(record, keys = []) {
  if (!record || typeof record !== "object") {
    return undefined;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function normalizeRowsPerPage(value) {
  const rowsPerPage = normalizeInteger(value, 10);
  if (rowsPerPage <= 0) {
    return 10;
  }
  return Math.min(rowsPerPage, 100);
}

function isInAuditRange(timestamp, fromDate, toDate) {
  const eventTime = normalizeAuditTime(timestamp, 0n);
  const fromTime = normalizeAuditTime(fromDate, 0n);
  const toTime = normalizeAuditTime(toDate, 0n);
  if (fromTime > 0n && eventTime < fromTime) {
    return false;
  }
  if (toTime > 0n && eventTime >= toTime) {
    return false;
  }
  return true;
}

function buildEmptyAuditMemberPayload() {
  return [
    buildDbRowset(
      AUDIT_LOG_EVENT_DBROW_COLUMNS,
      [],
      "carbon.common.script.sys.crowset.CRowset",
    ),
    buildDbRowset(
      ROLE_HISTORY_DBROW_COLUMNS,
      [],
      "carbon.common.script.sys.crowset.CRowset",
    ),
  ];
}

function sessionHasAuditAccess(session, corporationID) {
  const sessionRoles = toRoleMaskBigInt(
    session && (session.corprole || session.rolesAtAll || session.corpRole),
    0n,
  );
  if (
    (sessionRoles & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (sessionRoles & CORP_ROLE_AUDITOR) === CORP_ROLE_AUDITOR
  ) {
    return true;
  }

  const characterID = normalizeInteger(
    session && (session.characterID || session.charid),
    0,
  );
  const member = characterID ? getCorporationMember(corporationID, characterID) : null;
  const memberRoles = toRoleMaskBigInt(member && member.roles, 0n);
  return (
    (memberRoles & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (memberRoles & CORP_ROLE_AUDITOR) === CORP_ROLE_AUDITOR
  );
}

function buildAuditEventRows(runtime, memberID, fromDate, toDate, rowsPerPage) {
  const rows = (Array.isArray(runtime && runtime.memberEventLog)
    ? runtime.memberEventLog
    : [])
    .filter((entry) => {
      const entryCharacterID = normalizeInteger(
        getFirstPresent(entry, ["charID", "characterID", "memberID"]),
        0,
      );
      const eventDateTime = getFirstPresent(entry, [
        "eventDateTime",
        "eventTime",
        "changeTime",
      ]);
      return (
        entryCharacterID === Number(memberID) &&
        isInAuditRange(eventDateTime, fromDate, toDate)
      );
    })
    .sort((left, right) =>
      normalizeAuditTime(
        getFirstPresent(right, ["eventDateTime", "eventTime", "changeTime"]),
        0n,
      ) >
      normalizeAuditTime(
        getFirstPresent(left, ["eventDateTime", "eventTime", "changeTime"]),
        0n,
      )
        ? 1
        : -1,
    )
    .slice(0, rowsPerPage)
    .map((entry) => [
      normalizeInteger(getFirstPresent(entry, ["eventID", "id", "event_id"]), 0),
      buildFiletimeLong(getFirstPresent(entry, ["eventDateTime", "eventTime", "changeTime"]) || 0n),
      normalizeInteger(getFirstPresent(entry, ["eventTypeID", "eventTypeId", "event_type_id"]), 0),
      normalizeInteger(getFirstPresent(entry, ["charID", "characterID", "memberID"]), 0),
      normalizeInteger(getFirstPresent(entry, ["corporationID", "corpID", "corpid"]), 0),
    ]);
  return buildDbRowset(
    AUDIT_LOG_EVENT_DBROW_COLUMNS,
    rows,
    "carbon.common.script.sys.crowset.CRowset",
  );
}

function buildRoleHistoryRows(runtime, memberID, fromDate, toDate, rowsPerPage) {
  const rows = (Array.isArray(runtime && runtime.roleHistory)
    ? runtime.roleHistory
    : [])
    .filter((entry) => {
      const entryCharacterID = normalizeInteger(
        getFirstPresent(entry, ["charID", "characterID", "memberID"]),
        0,
      );
      const changeTime = getFirstPresent(entry, ["changeTime", "changedAt"]);
      return (
        entryCharacterID === Number(memberID) &&
        isInAuditRange(changeTime, fromDate, toDate)
      );
    })
    .sort((left, right) =>
      normalizeAuditTime(getFirstPresent(right, ["changeTime", "changedAt"]), 0n) >
      normalizeAuditTime(getFirstPresent(left, ["changeTime", "changedAt"]), 0n)
        ? 1
        : -1,
    )
    .slice(0, rowsPerPage)
    .map((entry) => [
      normalizeInteger(getFirstPresent(entry, ["charID", "characterID", "memberID"]), 0),
      normalizeInteger(getFirstPresent(entry, ["corporationID", "corpID", "corpid"]), 0),
      buildFiletimeLong(getFirstPresent(entry, ["changeTime", "changedAt"]) || 0n),
      getFirstPresent(entry, ["grantable", "isGrantable"]) ? 1 : 0,
      buildLong(getFirstPresent(entry, ["oldRoles", "old_roles"]) || 0n),
      buildLong(getFirstPresent(entry, ["newRoles", "new_roles"]) || 0n),
      normalizeInteger(getFirstPresent(entry, ["issuerID", "issuerId", "issuer_id"]), -1),
    ]);
  return buildDbRowset(
    ROLE_HISTORY_DBROW_COLUMNS,
    rows,
    "carbon.common.script.sys.crowset.CRowset",
  );
}

function resolveCorporationInfo(corpID, session) {
  const numericCorpID = Number(corpID) || 0;
  const characterID =
    session && (session.characterID || session.charid) ? Number(session.characterID || session.charid) : 0;
  const charData = characterID ? getCharacterRecord(characterID) || {} : {};
  const publicInfo = getCorporationPublicInfo(numericCorpID);
  if (publicInfo) {
    return publicInfo;
  }
  return {
    corporationID: numericCorpID,
    corporationName:
      `Corporation ${numericCorpID}`,
    ticker: "CORP",
    tickerName: "CORP",
    ceoID: numericCorpID === Number(charData.corporationID || 0) ? characterID || null : null,
    creatorID: numericCorpID === Number(charData.corporationID || 0) ? characterID || null : null,
    allianceID:
      numericCorpID === Number(charData.corporationID || 0)
        ? charData.allianceID || (session ? session.allianceID || session.allianceid : null)
        : null,
    description: "",
    stationID: null,
    shares: 1000,
    deleted: 0,
    url: "",
    taxRate: 0.0,
    loyaltyPointTaxRate: 0.0,
    friendlyFire: 0,
    allowWar: getCorporationWarPermitStatus(numericCorpID),
    memberCount: 1,
    memberLimit: -1,
    allowedMemberRaceIDs: null,
    corporationType: 0,
    minimumJoinStanding: 0,
    sendCharTerminationMessage: 0,
    createDate: null,
    aggressionEnableAfter: null,
    aggressionDisableAfter: null,
  };
}

function buildCorporationRowPayload(info) {
  const corporationID = Number(info && info.corporationID) || 0;
  const runtime = getCorporationRuntime(corporationID) || {};
  const divisionNames = getCorporationDivisionNames(corporationID);
  return buildRow(CORPORATION_ROW_HEADER, [
    corporationID,
    info.corporationName || `Corporation ${corporationID}`,
    info.ticker || "CORP",
    info.tickerName || info.ticker || "CORP",
    info.ceoID ?? null,
    info.creatorID ?? null,
    info.allianceID ?? null,
    info.factionID ?? null,
    info.warFactionID ?? null,
    1,
    info.description || "",
    info.url || "",
    info.stationID ?? null,
    Number(info.deleted || 0),
    Number(info.taxRate || 0),
    Number(info.loyaltyPointTaxRate || 0),
    Number(info.friendlyFire || 0),
    Number(info.memberCount || 0),
    Number(info.memberLimit ?? -1),
    Number(info.shares || 0),
    info.allowWar ?? getCorporationWarPermitStatus(corporationID),
    info.allowedMemberRaceIDs ?? null,
    info.corporationType ?? 0,
    Number(info.minimumJoinStanding || 0),
    Number(info.sendCharTerminationMessage || 0),
    info.createDate ? buildFiletimeLong(info.createDate) : null,
    info.aggressionEnableAfter ? buildFiletimeLong(info.aggressionEnableAfter) : null,
    info.aggressionDisableAfter ? buildFiletimeLong(info.aggressionDisableAfter) : null,
    Number(runtime.applicationsEnabled || 0),
    divisionNames[1],
    divisionNames[2],
    divisionNames[3],
    divisionNames[4],
    divisionNames[5],
    divisionNames[6],
    divisionNames[7],
    divisionNames[8],
    divisionNames[9],
    divisionNames[10],
    divisionNames[11],
    divisionNames[12],
    divisionNames[13],
    divisionNames[14],
    info.shape1 ?? null,
    info.shape2 ?? null,
    info.shape3 ?? null,
    info.color1 ?? null,
    info.color2 ?? null,
    info.color3 ?? null,
    info.typeface ?? null,
    Number(runtime.applicationsEnabled === 0 ? 0 : 1),
  ]);
}

class CorpMgrService extends BaseService {
  constructor() {
    super("corpmgr");
  }

  Handle_GetPublicInfo(args, session) {
    const corpID = args && args.length > 0 ? args[0] : 0;
    const info = resolveCorporationInfo(corpID, session);
    const runtime = getCorporationRuntime(info.corporationID) || {};
    log.debug(`[CorpMgr] GetPublicInfo(${info.corporationID})`);
    return buildKeyVal([
      ["corporationID", info.corporationID],
      ["corporationName", info.corporationName],
      ["ticker", info.ticker],
      ["tickerName", info.tickerName || info.ticker],
      ["ceoID", info.ceoID],
      ["creatorID", info.creatorID],
      ["allianceID", info.allianceID],
      ["warFactionID", info.warFactionID ?? info.factionID ?? null],
      ["description", info.description],
      ["stationID", info.stationID],
      ["shares", info.shares],
      ["deleted", info.deleted],
      ["url", info.url],
      ["taxRate", info.taxRate],
      ["loyaltyPointTaxRate", info.loyaltyPointTaxRate || 0.0],
      ["friendlyFire", info.friendlyFire || 0],
      ["allowWar", info.allowWar ?? getCorporationWarPermitStatus(info.corporationID)],
      ["memberCount", info.memberCount],
      ["applicationsEnabled", Number(runtime.applicationsEnabled || 0)],
      ["isRecruiting", Number(runtime.applicationsEnabled === 0 ? 0 : 1)],
      ["shape1", info.shape1 ?? null],
      ["shape2", info.shape2 ?? null],
      ["shape3", info.shape3 ?? null],
      ["color1", info.color1 ?? null],
      ["color2", info.color2 ?? null],
      ["color3", info.color3 ?? null],
      ["typeface", info.typeface ?? null],
    ]);
  }

  Handle_GetCorporationIDForCharacter(args, session) {
    const charID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const charData = charID ? getCharacterRecord(charID) || {} : {};
    return charData.corporationID || (session ? session.corporationID || session.corpid : NPC_STARTER_CORPORATION_ID);
  }

  Handle_GetCorporations(args, session) {
    const corpID = args && args.length > 0 ? args[0] : 0;
    const info = resolveCorporationInfo(corpID, session);
    return info ? buildCorporationRowPayload(info) : null;
  }

  Handle_GetAggressionSettings(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const info = getCorporationPublicInfo(corporationID) || {};
    return buildAggressionSettingsPayload(
      readAggressionSettings(corporationID, {
        isNpcCorporation: Boolean(info.isNPC),
      }),
      {
        isNpcCorporation: Boolean(info.isNPC),
      },
    );
  }

  Handle_GetAggressionSettingsForCorps(args) {
    const corporationIDs = extractList(args && args[0]);
    return buildDict(
      corporationIDs.map((corporationID) => [
        corporationID,
        this.Handle_GetAggressionSettings([corporationID]),
      ]),
    );
  }

  Handle_AuditMember(args, session) {
    const memberID = normalizeInteger(args && args[0], 0);
    const fromDate = args && args.length > 1 ? args[1] : 0n;
    const toDate = args && args.length > 2 ? args[2] : 0n;
    const rowsPerPage = normalizeRowsPerPage(args && args.length > 3 ? args[3] : 10);
    const corporationID = normalizeInteger(
      session && (session.corporationID || session.corpid),
      0,
    );
    if (!memberID || !corporationID || !sessionHasAuditAccess(session, corporationID)) {
      log.debug(`[CorpMgr] AuditMember denied or empty memberID=${memberID}`);
      return buildEmptyAuditMemberPayload();
    }

    const runtime = getCorporationRuntime(corporationID) || {};
    log.debug(
      `[CorpMgr] AuditMember memberID=${memberID} corporationID=${corporationID} rowsPerPage=${rowsPerPage}`,
    );
    return [
      buildAuditEventRows(runtime, memberID, fromDate, toDate, rowsPerPage),
      buildRoleHistoryRows(runtime, memberID, fromDate, toDate, rowsPerPage),
    ];
  }

  Handle_GetAssetInventory(args, session) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const which = args && args.length > 1 ? String(args[1] || "") : "offices";
    const sessionCorporationID =
      (session && (session.corporationID || session.corpid)) || corporationID;
    const rowset = buildAssetLocationCrowset(
      listAssetLocations(corporationID, which),
      which,
    );
    return buildCachedMethodCallResult(rowset, {
      serviceName: "corpmgr",
      method: "GetAssetInventory",
      args: [corporationID, which],
      versionCheck: "5 minutes",
      sessionInfo: "corpid",
      sessionInfoValue: sessionCorporationID,
    });
  }

  Handle_GetAssetInventoryForLocation(args, session) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const locationID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const which = args && args.length > 2 ? String(args[2] || "") : "offices";
    const sessionCorporationID =
      (session && (session.corporationID || session.corpid)) || corporationID;
    return buildCachedMethodCallResult(
      buildAssetItemCrowset(
        listAssetItemsForLocation(corporationID, locationID, which),
      ),
      {
        serviceName: "corpmgr",
        method: "GetAssetInventoryForLocation",
        args: [corporationID, locationID, which],
        versionCheck: "5 minutes",
        sessionInfo: "corpid",
        sessionInfoValue: sessionCorporationID,
      },
    );
  }

  Handle_SearchAssets(args, session) {
    const corporationID = session ? session.corporationID || session.corpid || 0 : 0;
    const which = args && args.length > 0 ? String(args[0] || "") : "offices";
    const categoryID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const groupID = args && args.length > 2 ? Number(args[2]) || 0 : 0;
    const typeID = args && args.length > 3 ? Number(args[3]) || 0 : 0;
    const minimumQuantity = args && args.length > 4 ? Number(args[4]) || 0 : 0;
    const rowset = buildAssetSearchCrowset(
      searchAssetLocations(corporationID, which, {
        categoryID,
        groupID,
        typeID,
        minimumQuantity,
      }),
    );
    return buildCachedMethodCallResult(rowset, {
      serviceName: "corpmgr",
      method: "SearchAssets",
      args: [
        which,
        args && args.length > 1 ? args[1] : null,
        args && args.length > 2 ? args[2] : null,
        args && args.length > 3 ? args[3] : null,
        args && args.length > 4 ? args[4] : null,
      ],
      versionCheck: "5 minutes",
      sessionInfo: "corpid",
      sessionInfoValue: corporationID,
    });
  }
}

module.exports = CorpMgrService;
