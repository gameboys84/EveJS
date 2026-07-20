const path = require("path");

const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildPackedRow,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllianceCorporationIDs,
  getAllianceRecord,
  getCorporationInfoRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  CORP_ROLE_DIRECTOR,
  getAllianceRuntime,
  getCorporationDivisionNames,
  getCorporationMember,
  getCorporationRuntime,
  listCorporationMembers,
  normalizePositiveInteger,
  toRoleMaskBigInt,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getWarPermitStatusForOwner,
} = require(path.join(__dirname, "./warPermitState"));
const {
  getAllianceCapitalInfo: getSovereigntyAllianceCapitalInfo,
  getAlliancePrimeInfo: getSovereigntyAlliancePrimeInfo,
} = require(path.join(__dirname, "../sovereignty/sovState"));
const {
  getSessions,
  findSessionByCharacterID,
} = require(path.join(__dirname, "../chat/sessionRegistry"));

const OFFICE_TYPE_ID = 27;
const OFFICE_GROUP_ID = 16;
const OFFICE_CATEGORY_ID = 3;
const LOCATION_JUNKYARD = 10;
const FLAG_OFFICE_FOLDER = 2;
const FLAG_IMPOUNDED = 6;
const CORP_ROLE_PERSONNEL_MANAGER = 128n;
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
];
const INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS = [
  ["stacksize", { type: "token", value: "eve.common.script.sys.eveCfg.StackSize" }],
  ["singleton", { type: "token", value: "eve.common.script.sys.eveCfg.Singleton" }],
];

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function applyCharacterRecordToSession(session, characterID, options = {}) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.applyCharacterToSession === "function"
    ? characterState.applyCharacterToSession(session, characterID, options)
    : { success: false, errorMsg: "CHARACTER_STATE_UNAVAILABLE" };
}

const CORPORATION_HEADER = [
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

const CORPORATION_MEMBER_HEADER = [
  "characterID",
  "corporationID",
  "startDate",
  "title",
  "divisionID",
  "squadronID",
  "roles",
  "grantableRoles",
  "rolesAtHQ",
  "grantableRolesAtHQ",
  "rolesAtBase",
  "grantableRolesAtBase",
  "rolesAtOther",
  "grantableRolesAtOther",
  "baseID",
  "titleMask",
  "blockRoles",
  "accountKey",
  "isCEO",
  "lastOnline",
  "locationID",
  "shipTypeID",
];

const CORPORATION_APPLICATION_HEADER = [
  "applicationID",
  "corporationID",
  "characterID",
  "applicationText",
  "status",
  "applicationDateTime",
  "deleted",
  "responseText",
];
const CORPORATION_APPLICATION_DBROW_COLUMNS = [
  ["applicationID", 0x03],
  ["corporationID", 0x03],
  ["characterID", 0x03],
  ["applicationText", 0x82],
  ["status", 0x03],
  ["applicationDateTime", 0x40],
  ["deleted", 0x0b],
  ["responseText", 0x82],
];

const ALLIANCE_HEADER = [
  "allianceID",
  "allianceName",
  "shortName",
  "executorCorpID",
  "creatorCorpID",
  "creatorCharID",
  "warFactionID",
  "description",
  "url",
  "startDate",
  "memberCount",
  "dictatorial",
  "allowWar",
  "currentCapital",
  "currentPrimeHour",
  "newPrimeHour",
  "newPrimeHourValidAfter",
  "deleted",
];

const ALLIANCE_MEMBER_HEADER = [
  "corporationID",
  "allianceID",
  "chosenExecutorID",
  "startDate",
  "deleted",
];

const ALLIANCE_APPLICATION_HEADER = [
  "allianceID",
  "corporationID",
  "applicationText",
  "state",
  "applicationDateTime",
];

const ALLIANCE_RELATIONSHIP_HEADER = [
  "toID",
  "relationship",
];

function buildLong(value) {
  return {
    type: "long",
    value: toRoleMaskBigInt(value, 0n),
  };
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeValueForCompare(value) {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValueForCompare(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        normalizeValueForCompare(entryValue),
      ]),
    );
  }
  return value;
}

function areValuesEqual(left, right) {
  return JSON.stringify(normalizeValueForCompare(left)) ===
    JSON.stringify(normalizeValueForCompare(right));
}

function buildChangeDict(beforeSnapshot, afterSnapshot, header = null) {
  const before = beforeSnapshot && typeof beforeSnapshot === "object"
    ? beforeSnapshot
    : null;
  const after = afterSnapshot && typeof afterSnapshot === "object"
    ? afterSnapshot
    : null;
  if (!before && !after) {
    return {
      type: "dict",
      entries: [],
    };
  }
  const columns = Array.isArray(header) && header.length > 0
    ? header
    : Array.from(
        new Set([
          ...Object.keys(before || {}),
          ...Object.keys(after || {}),
        ]),
      );
  const entries = [];
  for (const columnName of columns) {
    const oldValue = before ? before[columnName] : null;
    const newValue = after ? after[columnName] : null;
    if (before && after && areValuesEqual(oldValue, newValue)) {
      continue;
    }
    entries.push([columnName, [oldValue ?? null, newValue ?? null]]);
  }
  return {
    type: "dict",
    entries,
  };
}

function buildCorporationSnapshot(corporationID) {
  const info = getCorporationInfoRecord(corporationID);
  if (!info) {
    return null;
  }
  const runtime = getCorporationRuntime(corporationID) || {};
  const divisionNames = getCorporationDivisionNames(corporationID);
  return {
    corporationID: info.corporationID,
    corporationName: info.corporationName,
    ticker: info.ticker,
    tickerName: info.tickerName || info.ticker,
    ceoID: info.ceoID,
    creatorID: info.creatorID,
    allianceID: info.allianceID,
    factionID: info.factionID ?? null,
    warFactionID: info.warFactionID ?? info.factionID ?? null,
    membership: 1,
    description: info.description || "",
    url: info.url || "",
    stationID: info.stationID,
    deleted: info.deleted,
    taxRate: info.taxRate,
    loyaltyPointTaxRate: info.loyaltyPointTaxRate || 0.0,
    friendlyFire: info.friendlyFire || 0,
    memberCount: info.memberCount,
    memberLimit: info.memberLimit,
    shares: info.shares,
    allowWar: info.allowWar,
    allowedMemberRaceIDs: info.allowedMemberRaceIDs,
    corporationType: info.corporationType,
    minimumJoinStanding: info.minimumJoinStanding,
    sendCharTerminationMessage: info.sendCharTerminationMessage,
    createDate: info.createDate ? buildFiletimeLong(info.createDate) : null,
    aggressionEnableAfter: info.aggressionEnableAfter
      ? buildFiletimeLong(info.aggressionEnableAfter)
      : null,
    aggressionDisableAfter: info.aggressionDisableAfter
      ? buildFiletimeLong(info.aggressionDisableAfter)
      : null,
    applicationsEnabled: runtime.applicationsEnabled || 0,
    division1: divisionNames[1],
    division2: divisionNames[2],
    division3: divisionNames[3],
    division4: divisionNames[4],
    division5: divisionNames[5],
    division6: divisionNames[6],
    division7: divisionNames[7],
    walletDivision1: divisionNames[8],
    walletDivision2: divisionNames[9],
    walletDivision3: divisionNames[10],
    walletDivision4: divisionNames[11],
    walletDivision5: divisionNames[12],
    walletDivision6: divisionNames[13],
    walletDivision7: divisionNames[14],
    shape1: info.shape1 ?? null,
    shape2: info.shape2 ?? null,
    shape3: info.shape3 ?? null,
    color1: info.color1 ?? null,
    color2: info.color2 ?? null,
    color3: info.color3 ?? null,
    typeface: info.typeface ?? null,
    isRecruiting: runtime.applicationsEnabled === 0 ? 0 : 1,
  };
}

function buildCorporationMemberSnapshot(corporationID, characterID) {
  const member = getCorporationMember(corporationID, characterID);
  if (!member) {
    return null;
  }
  return {
    characterID: member.characterID,
    corporationID: member.corporationID,
    startDate: buildFiletimeLong(member.startDate),
    title: member.title || "",
    divisionID: member.divisionID || 0,
    squadronID: member.squadronID || 0,
    roles: buildLong(member.roles),
    grantableRoles: buildLong(member.grantableRoles),
    rolesAtHQ: buildLong(member.rolesAtHQ),
    grantableRolesAtHQ: buildLong(member.grantableRolesAtHQ),
    rolesAtBase: buildLong(member.rolesAtBase),
    grantableRolesAtBase: buildLong(member.grantableRolesAtBase),
    rolesAtOther: buildLong(member.rolesAtOther),
    grantableRolesAtOther: buildLong(member.grantableRolesAtOther),
    baseID: member.baseID || null,
    titleMask: member.titleMask || 0,
    blockRoles: member.blockRoles ? buildLong(member.blockRoles) : null,
    accountKey: member.accountKey || 1000,
    isCEO: member.isCEO ? 1 : 0,
    lastOnline: buildFiletimeLong(member.lastOnline),
    locationID: member.locationID || null,
    shipTypeID: member.shipTypeID || null,
  };
}

function buildCorporationApplicationRow(application = null) {
  if (!application) {
    return null;
  }
  const responseText = Object.prototype.hasOwnProperty.call(application, "responseText")
    ? application.responseText
    : application.customMessage
      ? application.customMessage
      : null;
  return buildPackedRow(CORPORATION_APPLICATION_DBROW_COLUMNS, {
    applicationID: Number(application.applicationID || 0),
    corporationID: Number(application.corporationID || 0),
    characterID: Number(application.characterID || 0),
    applicationText: application.applicationText || "",
    status: Number(application.status || 0),
    applicationDateTime: buildFiletimeLong(application.applicationDateTime || "0"),
    deleted: Boolean(application.deleted),
    responseText,
  });
}

function buildAllianceSummary(allianceID) {
  const allianceRecord = getAllianceRecord(allianceID);
  if (!allianceRecord) {
    return null;
  }
  const runtime = getAllianceRuntime(allianceID) || {};
  const sovPrimeInfo = getSovereigntyAlliancePrimeInfo(allianceID);
  const sovCapitalInfo = getSovereigntyAllianceCapitalInfo(allianceID);
  const executorCorporationID = normalizePositiveInteger(
    allianceRecord.executorCorporationID,
    null,
  );
  const executorCorporation = executorCorporationID
    ? getCorporationRecord(executorCorporationID)
    : null;
  const hasExplicitAllowWar =
    Object.prototype.hasOwnProperty.call(allianceRecord, "allowWar") &&
    allianceRecord.allowWar !== undefined &&
    allianceRecord.allowWar !== null;
  return {
    allianceID: allianceRecord.allianceID,
    allianceName: allianceRecord.allianceName || `Alliance ${allianceRecord.allianceID}`,
    shortName: allianceRecord.shortName || "ALLY",
    executorCorpID: executorCorporationID,
    creatorCorpID: normalizePositiveInteger(
      allianceRecord.creatorCorpID || allianceRecord.executorCorporationID,
      null,
    ),
    creatorCharID: normalizePositiveInteger(
      allianceRecord.creatorCharID || allianceRecord.creatorID,
      null,
    ),
    warFactionID: normalizePositiveInteger(
      allianceRecord.warFactionID,
      normalizePositiveInteger(executorCorporation && executorCorporation.factionID, null),
    ),
    description: allianceRecord.description || "",
    url: allianceRecord.url || "",
    startDate: buildFiletimeLong(allianceRecord.createdAt || 0n),
    memberCount: getAllianceCorporationIDs(allianceRecord.allianceID).reduce(
      (count, corporationID) => count + listCorporationMembers(corporationID).length,
      0,
    ),
    dictatorial: allianceRecord.dictatorial ? 1 : 0,
    allowWar: hasExplicitAllowWar
      ? allianceRecord.allowWar
        ? 1
        : 0
      : getWarPermitStatusForOwner(allianceRecord.allianceID),
    currentCapital: sovCapitalInfo.currentCapitalSystem || null,
    currentPrimeHour: sovPrimeInfo.currentPrimeHour || 0,
    newPrimeHour: sovPrimeInfo.newPrimeHour || 0,
    newPrimeHourValidAfter: buildFiletimeLong(sovPrimeInfo.newPrimeHourValidAfter || "0"),
    deleted: allianceRecord.deleted ? 1 : 0,
  };
}

function buildAllianceMemberSnapshot(allianceID, corporationID) {
  const alliance = getAllianceRecord(allianceID);
  if (!alliance) {
    return null;
  }
  const memberCorporationIDs = new Set(getAllianceCorporationIDs(allianceID));
  if (!memberCorporationIDs.has(Number(corporationID))) {
    return null;
  }
  const runtime = getAllianceRuntime(allianceID) || {};
  const joinedAt =
    runtime.memberJoinedAtByCorporation &&
    runtime.memberJoinedAtByCorporation[String(corporationID)]
      ? runtime.memberJoinedAtByCorporation[String(corporationID)]
      : String(alliance.createdAt || currentFileTime());
  return {
    corporationID: Number(corporationID),
    allianceID,
    chosenExecutorID: normalizePositiveInteger(
      runtime.executorSupportByCorporation &&
        runtime.executorSupportByCorporation[String(corporationID)],
      null,
    ),
    startDate: buildFiletimeLong(joinedAt),
    deleted: 0,
  };
}

function buildAllianceApplicationSnapshot(allianceID, corporationID) {
  const runtime = getAllianceRuntime(allianceID) || {};
  const application =
    runtime.applications && runtime.applications[String(corporationID)]
      ? runtime.applications[String(corporationID)]
      : null;
  if (!application) {
    return null;
  }
  return {
    allianceID: Number(application.allianceID || allianceID),
    corporationID: Number(corporationID),
    applicationText: application.applicationText || "",
    state: Number(application.state || 0),
    applicationDateTime: buildFiletimeLong(application.applicationDateTime || "0"),
  };
}

function buildAllianceRelationshipSnapshot(allianceID, toID) {
  const runtime = getAllianceRuntime(allianceID) || {};
  if (
    !runtime.relationships ||
    !Object.prototype.hasOwnProperty.call(runtime.relationships, String(toID))
  ) {
    return null;
  }
  return {
    toID: Number(toID),
    relationship: Number(runtime.relationships[String(toID)] || 0),
  };
}

function buildWarPayload(war = null) {
  if (!war) {
    return null;
  }
  return buildKeyVal(Object.entries(buildWarSnapshot(war)));
}

function buildWarSnapshot(war = null) {
  if (!war) {
    return null;
  }
  return {
    warID: Number(war.warID || 0),
    declaredByID: Number(war.declaredByID || 0),
    againstID: Number(war.againstID || 0),
    warHQID: war.warHQID || null,
    warHQ: war.warHQID || null,
    timeDeclared: buildFiletimeLong(war.timeDeclared || 0),
    timeStarted: buildFiletimeLong(war.timeStarted || 0),
    timeFinished: war.timeFinished ? buildFiletimeLong(war.timeFinished) : null,
    retracted: war.retracted ? buildFiletimeLong(war.retracted) : null,
    retractedBy: war.retractedBy || null,
    billID: war.billID || null,
    mutual: Number(war.mutual || 0),
    openForAllies: Number(war.openForAllies || 0),
    createdFromWarID: war.createdFromWarID || null,
    reward: Number(war.reward || 0),
    allies: {
      type: "dict",
      entries: Object.entries(war.allies || {}).map(([allyID, ally]) => [
        Number(allyID),
        buildKeyVal([
          ["allyID", Number(allyID)],
          ["timeStarted", buildFiletimeLong(ally && ally.timeStarted ? ally.timeStarted : 0)],
          [
            "timeFinished",
            ally && ally.timeFinished
              ? buildFiletimeLong(ally.timeFinished)
              : null,
          ],
        ]),
      ]),
    },
  };
}

function buildWarOwnerIDs(war = null) {
  const ownerIDs = new Set();
  if (!war) {
    return [];
  }
  const declaredByID = normalizePositiveInteger(war.declaredByID, null);
  const againstID = normalizePositiveInteger(war.againstID, null);
  if (declaredByID) {
    ownerIDs.add(declaredByID);
  }
  if (againstID) {
    ownerIDs.add(againstID);
  }
  for (const allyID of Object.keys(war.allies || {})) {
    const numericAllyID = normalizePositiveInteger(allyID, null);
    if (numericAllyID) {
      ownerIDs.add(numericAllyID);
    }
  }
  return [...ownerIDs].sort((left, right) => left - right);
}

function getSessionCharacterID(session) {
  return normalizePositiveInteger(
    session && (session.characterID || session.charid),
    null,
  );
}

function getSessionCorporationID(session) {
  return normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    null,
  );
}

function sendNotificationToAllSessions(notifyType, idType, payloadTuple = []) {
  for (const session of getSessions()) {
    try {
      session.sendNotification(notifyType, idType, payloadTuple);
    } catch (error) {
      // Keep parity notifications non-fatal on the write path.
    }
  }
}

function sendNotificationToCharacterIDs(
  characterIDs,
  notifyType,
  idType,
  payloadTuple = [],
) {
  const recipients = new Set(
    (Array.isArray(characterIDs) ? characterIDs : [characterIDs])
      .map((characterID) => normalizePositiveInteger(characterID, null))
      .filter((characterID) => characterID !== null),
  );
  if (recipients.size <= 0) {
    return;
  }
  for (const session of getSessions()) {
    if (!recipients.has(getSessionCharacterID(session))) {
      continue;
    }
    try {
      session.sendNotification(notifyType, idType, payloadTuple);
    } catch (error) {
      // Keep parity notifications non-fatal on the write path.
    }
  }
}

function sendNotificationToCorporationSessions(
  corporationID,
  notifyType,
  idType,
  payloadTuple = [],
) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericCorporationID) {
    return;
  }
  for (const session of getSessions()) {
    if (Number(getSessionCorporationID(session)) !== Number(numericCorporationID)) {
      continue;
    }
    try {
      session.sendNotification(notifyType, idType, payloadTuple);
    } catch (error) {
      // Keep parity notifications non-fatal on the write path.
    }
  }
}

function corporationMemberCanProcessApplications(member) {
  if (!member) {
    return false;
  }
  if (member.isCEO) {
    return true;
  }
  const roleMask = toRoleMaskBigInt(member.roles, 0n);
  return (
    (roleMask & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (roleMask & CORP_ROLE_PERSONNEL_MANAGER) === CORP_ROLE_PERSONNEL_MANAGER
  );
}

function resolveApplicationChangeRecipientIDs(corporationID, applicantID) {
  const recipientIDs = new Set();
  const numericApplicantID = normalizePositiveInteger(applicantID, null);
  if (numericApplicantID) {
    recipientIDs.add(numericApplicantID);
  }

  const info = getCorporationInfoRecord(corporationID);
  const ceoID = normalizePositiveInteger(info && info.ceoID, null);
  if (ceoID) {
    recipientIDs.add(ceoID);
  }

  for (const member of listCorporationMembers(corporationID)) {
    const characterID = normalizePositiveInteger(member && member.characterID, null);
    if (!characterID || !corporationMemberCanProcessApplications(member)) {
      continue;
    }
    recipientIDs.add(characterID);
  }
  return [...recipientIDs];
}

function refreshCharacterSession(characterID, options = {}) {
  const session = findSessionByCharacterID(characterID);
  if (!session) {
    return;
  }
  try {
    applyCharacterRecordToSession(session, Number(characterID), {
      selectionEvent: false,
      emitNotifications: true,
      includeRoleChanges: true,
      logSelection: false,
      inventoryBootstrap: false,
      ...(options && typeof options === "object" ? options : {}),
    });
  } catch (error) {
    // Session refresh is best-effort only.
  }
}

function notifyCorporationChanged(corporationID, previousSnapshot = null) {
  const nextSnapshot = buildCorporationSnapshot(corporationID);
  const change = buildChangeDict(previousSnapshot, nextSnapshot, CORPORATION_HEADER);
  if (change.entries.length <= 0) {
    return;
  }
  sendNotificationToAllSessions("OnCorporationChanged", "ownerid", [
    Number(corporationID),
    change,
  ]);
}

function notifyCorporationMemberChanged(
  corporationID,
  characterID,
  previousSnapshot = null,
  options = {},
) {
  const nextSnapshot = Object.prototype.hasOwnProperty.call(options, "nextSnapshot")
    ? options.nextSnapshot
    : buildCorporationMemberSnapshot(corporationID, characterID);
  const change = buildChangeDict(
    previousSnapshot,
    nextSnapshot,
    options.header || CORPORATION_MEMBER_HEADER,
  );
  if (change.entries.length <= 0) {
    return;
  }
  const payloadTuple = [
    Number(corporationID),
    Number(characterID),
    change,
  ];
  const idTypes = new Set(
    Array.isArray(options.idTypes) && options.idTypes.length > 0
      ? options.idTypes
      : ["corpid"],
  );
  for (const idType of idTypes) {
    if (idType === "clientID") {
      sendNotificationToCharacterIDs(
        options.clientCharacterIDs || [characterID],
        "OnCorporationMemberChanged",
        idType,
        payloadTuple,
      );
    } else if (options.targeted === true && idType === "corpid") {
      sendNotificationToCorporationSessions(
        corporationID,
        "OnCorporationMemberChanged",
        idType,
        payloadTuple,
      );
    } else {
      sendNotificationToAllSessions(
        "OnCorporationMemberChanged",
        idType,
        payloadTuple,
      );
    }
  }
  if (options.refreshSession !== false) {
    refreshCharacterSession(characterID, options.refreshSessionOptions);
  }
}

function notifyCorporationApplicationChanged(
  corporationID,
  applicantID,
  applicationID,
  applicationRow = null,
) {
  sendNotificationToCharacterIDs(
    resolveApplicationChangeRecipientIDs(corporationID, applicantID),
    "OnCorporationApplicationChanged",
    "clientID",
    [
      Number(corporationID),
      Number(applicantID),
      Number(applicationID),
      applicationRow || null,
    ],
  );
}

function notifyCorporationWelcomeMailChanged(characterID, changeDate = null) {
  sendNotificationToAllSessions("OnCorporationWelcomeMailChanged", "ownerid", [
    Number(characterID || 0),
    buildFiletimeLong(changeDate || currentFileTime()),
  ]);
}

function notifyCorporationRecruitmentAdChanged() {
  sendNotificationToAllSessions("OnCorporationRecruitmentAdChanged", "ownerid", []);
}

function notifyAllianceChanged(allianceID, previousSnapshot = null) {
  const nextSnapshot = buildAllianceSummary(allianceID);
  const change = buildChangeDict(previousSnapshot, nextSnapshot, ALLIANCE_HEADER);
  if (change.entries.length <= 0) {
    return;
  }
  sendNotificationToAllSessions("OnAllianceChanged", "ownerid", [
    Number(allianceID),
    change,
  ]);
}

function notifyAllianceMemberChanged(allianceID, corporationID, previousSnapshot = null) {
  const nextSnapshot = buildAllianceMemberSnapshot(allianceID, corporationID);
  const change = buildChangeDict(
    previousSnapshot,
    nextSnapshot,
    ALLIANCE_MEMBER_HEADER,
  );
  if (change.entries.length <= 0) {
    return;
  }
  sendNotificationToAllSessions("OnAllianceMemberChanged", "ownerid", [
    Number(allianceID),
    Number(corporationID),
    change,
  ]);
}

function notifyAllianceApplicationChanged(allianceID, corporationID, previousSnapshot = null) {
  const nextSnapshot = buildAllianceApplicationSnapshot(allianceID, corporationID);
  const change = buildChangeDict(
    previousSnapshot,
    nextSnapshot,
    ALLIANCE_APPLICATION_HEADER,
  );
  if (change.entries.length <= 0) {
    return;
  }
  sendNotificationToAllSessions("OnAllianceApplicationChanged", "ownerid", [
    Number(allianceID),
    Number(corporationID),
    change,
  ]);
}

function notifyAllianceRelationshipChanged(allianceID, toID, previousSnapshot = null) {
  const nextSnapshot = buildAllianceRelationshipSnapshot(allianceID, toID);
  const change = buildChangeDict(
    previousSnapshot,
    nextSnapshot,
    ALLIANCE_RELATIONSHIP_HEADER,
  );
  if (change.entries.length <= 0) {
    return;
  }
  sendNotificationToAllSessions("OnAllianceRelationshipChanged", "ownerid", [
    Number(allianceID),
    Number(toID),
    change,
  ]);
}

function notifyWarChanged(previousWar = null, nextWar = null) {
  const war = nextWar || previousWar;
  if (!war) {
    return;
  }
  const previousSnapshot = buildWarSnapshot(previousWar);
  const nextSnapshot = buildWarSnapshot(nextWar);
  const ownerIDs = buildWarOwnerIDs(war);
  const change = buildChangeDict(
    previousSnapshot,
    nextSnapshot,
    null,
  );
  if (change.entries.length <= 0) {
    return;
  }
  sendNotificationToAllSessions("OnWarChanged", "ownerid", [
    buildWarPayload(war),
    ownerIDs,
    change,
  ]);
}

function resolveOfficeNotificationItemID(officeOrID) {
  if (officeOrID && typeof officeOrID === "object") {
    return normalizePositiveInteger(
      officeOrID.itemID,
      normalizePositiveInteger(officeOrID.officeID, 0),
    );
  }
  return normalizePositiveInteger(officeOrID, 0);
}

function buildOfficeJunkyardItemRow(corporationID, office) {
  return buildPackedRow(
    INVENTORY_ROW_DESCRIPTOR_COLUMNS,
    {
      itemID: resolveOfficeNotificationItemID(office),
      typeID: OFFICE_TYPE_ID,
      ownerID: Number(corporationID) || 0,
      locationID: LOCATION_JUNKYARD,
      flagID: FLAG_IMPOUNDED,
      quantity: -1,
      groupID: OFFICE_GROUP_ID,
      categoryID: OFFICE_CATEGORY_ID,
      customInfo: null,
      stacksize: 1,
      singleton: 1,
    },
    INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS,
  );
}

function notifyOfficeUnrentItemChange(corporationID, office) {
  const stationID = normalizePositiveInteger(office && office.stationID, 0);
  const officeItemID = resolveOfficeNotificationItemID(office);
  if (!stationID || !officeItemID) {
    return;
  }
  sendNotificationToAllSessions("OnItemsChanged", "*stationid&corpid", [
    buildList([buildOfficeJunkyardItemRow(corporationID, office)]),
    {
      type: "dict",
      entries: [
        [3, stationID],
        [4, FLAG_OFFICE_FOLDER],
      ],
    },
    null,
  ]);
}

function notifyOfficeRentalChange(corporationID, officeOrID) {
  const payload = [
    Number(corporationID),
    Number(resolveOfficeNotificationItemID(officeOrID) || 0),
  ];
  sendNotificationToAllSessions("OnOfficeRentalChange", "stationid", payload);
  sendNotificationToAllSessions("OnOfficeRentalChange", "corpid", payload);
}

function notifyOfficeBillRefresh(corporationID) {
  sendNotificationToCorporationSessions(
    corporationID,
    "OnBillReceived",
    "*corpid&corprole",
    [],
  );
}

function notifyLockedItemChange(itemID, ownerID, locationID, isLocked) {
  sendNotificationToAllSessions("OnLockedItemChangeUI", "ownerid", [
    Number(itemID || 0),
    Number(ownerID || 0),
    Number(locationID || 0),
  ]);
}

module.exports = {
  ALLIANCE_APPLICATION_HEADER,
  ALLIANCE_HEADER,
  ALLIANCE_MEMBER_HEADER,
  ALLIANCE_RELATIONSHIP_HEADER,
  CORPORATION_APPLICATION_HEADER,
  CORPORATION_APPLICATION_DBROW_COLUMNS,
  CORPORATION_HEADER,
  CORPORATION_MEMBER_HEADER,
  buildAllianceApplicationSnapshot,
  buildAllianceMemberSnapshot,
  buildAllianceRelationshipSnapshot,
  buildAllianceSummary,
  buildChangeDict,
  buildCorporationApplicationRow,
  buildCorporationMemberSnapshot,
  buildCorporationSnapshot,
  buildWarPayload,
  buildWarSnapshot,
  notifyAllianceApplicationChanged,
  notifyAllianceChanged,
  notifyAllianceMemberChanged,
  notifyAllianceRelationshipChanged,
  notifyCorporationApplicationChanged,
  notifyCorporationChanged,
  notifyCorporationMemberChanged,
  notifyCorporationRecruitmentAdChanged,
  notifyCorporationWelcomeMailChanged,
  notifyLockedItemChange,
  notifyOfficeBillRefresh,
  notifyOfficeRentalChange,
  notifyOfficeUnrentItemChange,
  notifyWarChanged,
  refreshCharacterSession,
};
