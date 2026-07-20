const path = require("path");

const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  cloneValue,
  ensureRuntimeInitialized,
  normalizeBoolean,
  normalizePositiveInteger,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  notifyWarChanged,
} = require(path.join(__dirname, "./corporationNotifications"));
const {
  getAllianceCorporationIDs,
  getAllianceRecord,
  getCharacterIDsInCorporation,
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  BILL_TYPE_WAR,
  createBill,
  getBillRecord,
  listDueBills,
  markBillProcessed,
  tryAutoPayBill,
} = require(path.join(__dirname, "../account/billRuntimeState"));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const warNotificationCenter = require(path.join(
  __dirname,
  "./warNotificationCenter",
));

const FILETIME_TICKS_PER_HOUR = 36000000000n;
const FILETIME_TICKS_PER_DAY = FILETIME_TICKS_PER_HOUR * 24n;
const FILETIME_TICKS_PER_WEEK = FILETIME_TICKS_PER_DAY * 7n;
const WAR_SPOOLUP = 24n * FILETIME_TICKS_PER_HOUR;
const WAR_COOLDOWN = FILETIME_TICKS_PER_DAY;
const FORCED_PEACE_PERIOD = FILETIME_TICKS_PER_WEEK * 2n;
const COST_OF_WAR = 100000000;
const CONCORD_CORPORATION_ID = 1000125;
const PEACE_REASON_HQ_REMOVED = 1;
const PEACE_REASON_HQ_OWNER_LEFT_ALLIANCE = 2;
const PEACE_REASON_CORP_LEFT_ALLIANCE = 3;
const PEACE_REASON_UNPAID_BILL = 5;
const ENDED_WARHQ_GONE = 3;
const ENDED_CORP_DELETED = 5;
const ENDED_RETRACTED = 6;
const ENDED_HQ_OWNER_LEFT = 9;
const ENDED_UNPAID_BILL = 10;
const ENDED_LEFT_ALLIANCE = 12;
const ENDED_ALLIANCE_DELETED = 13;
const ENDED_WAR_HQ_SYSTEM_SECURITY_DROP = 15;
const WAR_NEGOTIATION_STATE_NEW = 0;
const WAR_NEGOTIATION_STATE_RETRACTED = 3;
const WAR_NEGOTIATION_EXPIRY = FILETIME_TICKS_PER_DAY;
const MUTUAL_WAR_INVITE_EXPIRY = FILETIME_TICKS_PER_DAY * 7n;
let warIndexesDirty = true;
let warIndexesCache = null;

function appendWarIndexEntry(indexMap, key, war) {
  if (!key) {
    return;
  }
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(war);
}

function markWarIndexesDirty() {
  warIndexesDirty = true;
  warIndexesCache = null;
}

function ensureWarIndexes() {
  if (!warIndexesDirty && warIndexesCache) {
    return warIndexesCache;
  }

  const runtimeTable = ensureRuntimeInitialized();
  const warsAsc = Object.values(runtimeTable.wars || {})
    .map((war) => cloneValue(war))
    .sort((left, right) => Number(left.warID) - Number(right.warID));
  const warsDesc = warsAsc.slice().sort((left, right) => Number(right.warID) - Number(left.warID));
  const byOwner = new Map();
  const byStructure = new Map();

  for (const war of warsAsc) {
    appendWarIndexEntry(byOwner, normalizePositiveInteger(war && war.declaredByID, null), war);
    appendWarIndexEntry(byOwner, normalizePositiveInteger(war && war.againstID, null), war);
    appendWarIndexEntry(byStructure, normalizePositiveInteger(war && war.warHQID, null), war);
    for (const allyID of Object.keys((war && war.allies) || {})) {
      appendWarIndexEntry(byOwner, normalizePositiveInteger(allyID, null), war);
    }
  }

  warIndexesCache = {
    warsAsc,
    warsDesc,
    byOwner,
    byStructure,
  };
  warIndexesDirty = false;
  return warIndexesCache;
}

function getWarRecord(warID) {
  const runtimeTable = ensureRuntimeInitialized();
  const record = runtimeTable.wars && runtimeTable.wars[String(warID)];
  return record ? cloneValue(record) : null;
}

function listAllWars() {
  return cloneValue(ensureWarIndexes().warsAsc);
}

function listAllWarsDescending() {
  return cloneValue(ensureWarIndexes().warsDesc);
}

function listWarsForOwner(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return [];
  }
  return cloneValue(ensureWarIndexes().byOwner.get(numericOwnerID) || []);
}

function listWarsForStructure(structureID) {
  const numericStructureID = normalizePositiveInteger(structureID, null);
  if (!numericStructureID) {
    return [];
  }
  return cloneValue(ensureWarIndexes().byStructure.get(numericStructureID) || []);
}

function msToFileTime(ms) {
  const numericMs = Number(ms);
  const effectiveMs = Number.isFinite(numericMs) ? Math.trunc(numericMs) : Date.now();
  return BigInt(effectiveMs) * 10000n + 116444736000000000n;
}

function normalizeFiletimeBigInt(value, fallback = 0n) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  try {
    return BigInt(String(value));
  } catch (error) {
    return fallback;
  }
}

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function getStructureStateService() {
  return require(path.join(__dirname, "../structure/structureState"));
}

function getWorldDataService() {
  return require(path.join(__dirname, "../../space/worldData"));
}

function normalizeNowFiletime(options = {}) {
  const explicitFiletime =
    options.nowFiletime !== undefined && options.nowFiletime !== null
      ? options.nowFiletime
      : options.nowFileTime;
  if (explicitFiletime !== undefined && explicitFiletime !== null) {
    return normalizeFiletimeBigInt(explicitFiletime, currentFileTime());
  }
  if (options.nowMs !== undefined) {
    return msToFileTime(options.nowMs);
  }
  return currentFileTime();
}

function isWarStartedAt(war, now) {
  return normalizeFiletimeBigInt(war && war.timeStarted, 0n) <= now;
}

function isWarFinishedAt(war, now) {
  const finishedAt = normalizeFiletimeBigInt(war && war.timeFinished, 0n);
  return finishedAt > 0n && finishedAt <= now;
}

function isWarActiveAt(war, now) {
  return Boolean(war && isWarStartedAt(war, now) && !isWarFinishedAt(war, now));
}

function isWarFinishedOrFinishing(war) {
  return Boolean(war && war.timeFinished);
}

function isAggressiveBillableWar(war) {
  return Boolean(
    war &&
      !normalizeBoolean(war.mutual, false) &&
      normalizePositiveInteger(war.declaredByID, null) &&
      normalizePositiveInteger(war.againstID, null),
  );
}

function createNextWarBill(war, baseDueFiletime) {
  const declaredByID = normalizePositiveInteger(war && war.declaredByID, null);
  const againstID = normalizePositiveInteger(war && war.againstID, null);
  const warID = normalizePositiveInteger(war && war.warID, null);
  if (!declaredByID || !againstID || !warID) {
    return null;
  }
  const dueDateTime = normalizeFiletimeBigInt(baseDueFiletime, currentFileTime()) +
    FILETIME_TICKS_PER_WEEK;
  return createBill({
    billTypeID: BILL_TYPE_WAR,
    amount: COST_OF_WAR,
    debtorID: declaredByID,
    creditorID: CONCORD_CORPORATION_ID,
    dueDateTime: dueDateTime.toString(),
    externalID: againstID,
    externalID2: warID,
  });
}

function getStructureOwnerCorporationID(structure) {
  return normalizePositiveInteger(
    structure && (structure.ownerCorpID || structure.ownerID),
    null,
  );
}

function isHighSecurityWarHQ(structure) {
  const worldData = getWorldDataService();
  const system = worldData.getSolarSystemByID(
    normalizePositiveInteger(structure && structure.solarSystemID, 0),
  );
  const security = Number(system && system.security);
  return Number.isFinite(security) && security >= 0.45;
}

function isDockableUpwellWarHQ(structure) {
  if (!structure || structure.destroyedAt) {
    return false;
  }
  const structureState = getStructureStateService();
  const typeRecord = structureState.getStructureTypeByID(structure.typeID);
  return Boolean(
    typeRecord &&
      normalizePositiveInteger(typeRecord.categoryID, 0) === 65 &&
      typeRecord.dockable === true,
  );
}

function ownerExists(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  return Boolean(
    numericOwnerID &&
      (getCorporationRecord(numericOwnerID) || getAllianceRecord(numericOwnerID)),
  );
}

function resolveWarHQStructure(war) {
  const warHQID = normalizePositiveInteger(war && war.warHQID, null);
  if (!warHQID) {
    return null;
  }
  try {
    return getStructureStateService().getStructureByID(warHQID, { refresh: false });
  } catch (_error) {
    return null;
  }
}

function ensurePeaceTreatyRuntime(runtimeTable) {
  runtimeTable.peaceTreaties =
    runtimeTable.peaceTreaties && typeof runtimeTable.peaceTreaties === "object"
      ? runtimeTable.peaceTreaties
      : {};
  runtimeTable._meta =
    runtimeTable._meta && typeof runtimeTable._meta === "object"
      ? runtimeTable._meta
      : {};
  runtimeTable._meta.nextTreatyID =
    normalizePositiveInteger(runtimeTable._meta.nextTreatyID, 1) || 1;
}

function hasPeaceTreaty(runtimeTable, warID, ownerID, otherOwnerID, reason) {
  return Object.values(runtimeTable.peaceTreaties || {}).some(
    (treaty) =>
      Number(treaty && treaty.warID) === Number(warID) &&
      Number(treaty && treaty.ownerID) === Number(ownerID) &&
      Number(treaty && treaty.otherOwnerID) === Number(otherOwnerID) &&
      Number(treaty && treaty.peaceReason) === Number(reason),
  );
}

function createPeaceTreatyRecord(runtimeTable, {
  warID,
  ownerID,
  otherOwnerID,
  peaceReason,
  now,
} = {}) {
  const numericWarID = normalizePositiveInteger(warID, null);
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  const numericOtherOwnerID = normalizePositiveInteger(otherOwnerID, null);
  if (!numericWarID || !numericOwnerID || !numericOtherOwnerID) {
    return;
  }
  ensurePeaceTreatyRuntime(runtimeTable);
  if (
    hasPeaceTreaty(
      runtimeTable,
      numericWarID,
      numericOwnerID,
      numericOtherOwnerID,
      peaceReason,
    )
  ) {
    return;
  }
  const treatyID = runtimeTable._meta.nextTreatyID;
  runtimeTable._meta.nextTreatyID += 1;
  runtimeTable.peaceTreaties[String(treatyID)] = {
    treatyID,
    warID: numericWarID,
    ownerID: numericOwnerID,
    otherOwnerID: numericOtherOwnerID,
    peaceReason,
    createdDate: now.toString(),
    expiryDate: (now + FORCED_PEACE_PERIOD).toString(),
  };
}

function collectWarOwnerCharacterIDs(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return [];
  }
  if (getAllianceRecord(numericOwnerID)) {
    return getAllianceCorporationIDs(numericOwnerID).flatMap((corporationID) =>
      getCharacterIDsInCorporation(corporationID),
    );
  }
  return getCharacterIDsInCorporation(numericOwnerID);
}

function collectWarNotificationRecipients(war) {
  const recipients = new Set();
  for (const ownerID of [
    normalizePositiveInteger(war && war.declaredByID, null),
    normalizePositiveInteger(war && war.againstID, null),
    ...Object.keys((war && war.allies) || {}).map((allyID) =>
      normalizePositiveInteger(allyID, null),
    ),
  ]) {
    for (const characterID of collectWarOwnerCharacterIDs(ownerID)) {
      recipients.add(characterID);
    }
  }
  return [...recipients].sort((left, right) => left - right);
}

function getStructureWarHQName(structure) {
  return String(
    (structure && (structure.itemName || structure.name)) ||
      `Structure ${normalizePositiveInteger(structure && structure.structureID, 0)}`,
  );
}

function createWarHQRemovedNotifications(war, structure, now) {
  const recipients = collectWarNotificationRecipients(war);
  if (recipients.length <= 0) {
    return;
  }
  const senderID = normalizePositiveInteger(war && war.declaredByID, 0) || 0;
  const data = {
    warID: normalizePositiveInteger(war && war.warID, 0) || 0,
    declaredByID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    againstID: normalizePositiveInteger(war && war.againstID, 0) || 0,
    timeDeclared: String(war && war.timeDeclared ? war.timeDeclared : now),
    timeStarted: String(war && war.timeStarted ? war.timeStarted : now),
    timeFinished: String(war && war.timeFinished ? war.timeFinished : now),
    warHQ: getStructureWarHQName(structure),
    warHQ_IdType: [
      normalizePositiveInteger(structure && structure.structureID, 0) || 0,
      normalizePositiveInteger(structure && structure.typeID, 0) || 0,
    ],
  };
  for (const characterID of recipients) {
    createNotification(characterID, {
      typeID: NOTIFICATION_TYPE.WAR_HQ_REMOVED_FROM_SPACE,
      senderID,
      groupID: NOTIFICATION_GROUP.WAR,
      processed: false,
      data,
      emitLive: false,
    });
  }
}

// Fan a war-lifecycle center row out to every member of the defending owner,
// picking the corp- vs alliance-defender notification type. The aggressor is the
// sender, and the data always carries the war owners (the client renders
// againstName/declaredByName from them); `extraData` adds type-specific fields.
function notifyWarDefenderMembers(war, corpTypeID, allianceTypeID, extraData = {}) {
  const againstID = normalizePositiveInteger(war && war.againstID, null);
  const declaredByID = normalizePositiveInteger(war && war.declaredByID, null);
  if (!againstID || !declaredByID) {
    return;
  }
  const recipients = collectWarOwnerCharacterIDs(againstID);
  if (!recipients.length) {
    return;
  }
  const typeID = getAllianceRecord(againstID) ? allianceTypeID : corpTypeID;
  const data = {
    declaredByID,
    againstID,
    ...extraData,
  };
  for (const characterID of recipients) {
    createNotification(characterID, {
      typeID,
      senderID: declaredByID,
      groupID: NOTIFICATION_GROUP.WAR,
      processed: false,
      data,
    });
  }
}

// CorpWarDeclaredMsg (27) / AllWarDeclaredMsg (5): war was declared, so every
// member of the defending owner is told who declared it. The ParamWarOwnersWithCost
// formatter renders a cost clause only when `cost` is truthy; the defender is
// informed at no cost, so cost is 0.
function createWarDeclaredNotifications(war) {
  notifyWarDefenderMembers(
    war,
    NOTIFICATION_TYPE.CORP_WAR_DECLARED,
    NOTIFICATION_TYPE.ALL_WAR_DECLARED,
    { cost: 0 },
  );
}

// DeclareWar (typeID 121): the aggressor side of a war declaration — every member
// of the declaring owner is told that one of their own (charID) declared war on
// the defender. Distinct from the defender's CorpWar/AllWarDeclaredMsg, so the two
// do not overlap. The client renders charName/entityName/defenderName from charID/
// entityID/defenderID. Only emitted when a declaring character is known (genuine
// corp/alliance declarations, not system- or vote-created wars).
function createWarDeclarationActorNotifications(war, declaredByCharacterID) {
  const declaredByID = normalizePositiveInteger(war && war.declaredByID, null);
  const againstID = normalizePositiveInteger(war && war.againstID, null);
  const charID = normalizePositiveInteger(declaredByCharacterID, null);
  if (!declaredByID || !againstID || !charID) {
    return;
  }
  const recipients = collectWarOwnerCharacterIDs(declaredByID);
  if (!recipients.length) {
    return;
  }
  const data = {
    defenderID: againstID,
    entityID: declaredByID,
    charID,
  };
  for (const characterID of recipients) {
    createNotification(characterID, {
      typeID: NOTIFICATION_TYPE.DECLARE_WAR,
      senderID: charID,
      groupID: NOTIFICATION_GROUP.WAR,
      processed: false,
      data,
    });
  }
}

// CorpWarSurrenderMsg (29) / AllWarSurrenderMsg (6): a surrender was accepted and
// the war ended. Uses the ParamWarOwners shape (no cost), same defender-side
// recipient as the declared/retracted notices.
function createWarSurrenderNotifications(war) {
  notifyWarDefenderMembers(
    war,
    NOTIFICATION_TYPE.CORP_WAR_SURRENDER,
    NOTIFICATION_TYPE.ALL_WAR_SURRENDER,
  );
}

function createWarRecord({
  declaredByID,
  againstID,
  warHQ = null,
  mutual = false,
  reward = 0,
  createdFromWarID = null,
  billID = null,
  openForAllies = false,
  timeDeclared = null,
  timeStarted = null,
  timeFinished = null,
  declaredByCharacterID = null,
} = {}) {
  const attackerID = normalizePositiveInteger(declaredByID, null);
  const defenderID = normalizePositiveInteger(againstID, null);
  if (!attackerID || !defenderID || attackerID === defenderID) {
    return null;
  }

  let nextWarID = null;
  const writeResult = updateRuntimeState((runtimeTable) => {
    nextWarID = normalizePositiveInteger(runtimeTable._meta.nextWarID, 1) || 1;
    runtimeTable._meta.nextWarID = nextWarID + 1;
    const declaredAt = timeDeclared ? BigInt(String(timeDeclared)) : currentFileTime();
    const startedAt =
      timeStarted !== null && timeStarted !== undefined
        ? BigInt(String(timeStarted))
        : normalizeBoolean(mutual, false)
          ? declaredAt
          : declaredAt + WAR_SPOOLUP;
    runtimeTable.wars[String(nextWarID)] = {
      warID: nextWarID,
      declaredByID: attackerID,
      againstID: defenderID,
      warHQID: normalizePositiveInteger(warHQ, null),
      timeDeclared: declaredAt.toString(),
      timeStarted: startedAt.toString(),
      timeFinished:
        timeFinished !== null && timeFinished !== undefined
          ? String(timeFinished)
          : null,
      retracted: null,
      retractedBy: null,
      billID: normalizePositiveInteger(billID, null),
      mutual: normalizeBoolean(mutual, false) ? 1 : 0,
      fightingLegalNotified: normalizeBoolean(mutual, false) ? 1 : 0,
      openForAllies: normalizeBoolean(openForAllies, false) ? 1 : 0,
      allies: {},
      createdFromWarID: normalizePositiveInteger(createdFromWarID, null),
      reward: Number(reward || 0),
    };
    return runtimeTable;
  });
  if (writeResult && writeResult.success) {
    markWarIndexesDirty();
  }
  const nextRecord = getWarRecord(nextWarID);
  if (nextRecord) {
    notifyWarChanged(null, cloneValue(nextRecord));
    createWarDeclaredNotifications(nextRecord);
    createWarDeclarationActorNotifications(nextRecord, declaredByCharacterID);
    if (!normalizeBoolean(nextRecord.mutual, false)) {
      const structure = resolveWarHQStructure(nextRecord);
      warNotificationCenter.notifyModernWarDeclared(nextRecord, { structure });
      warNotificationCenter.notifyWarDeclaredV2(nextRecord, { structure });
    }
  }
  return nextRecord;
}

// CorpWarRetractedMsg (30) / AllWarRetractedMsg (7): a war was retracted by the
// aggressor, so every member of the defending owner is told. ParamWarOwners shape
// (no cost).
function createWarRetractedNotifications(war) {
  notifyWarDefenderMembers(
    war,
    NOTIFICATION_TYPE.CORP_WAR_RETRACTED,
    NOTIFICATION_TYPE.ALL_WAR_RETRACTED,
  );
}

function updateWarRecord(warID, updater) {
  const numericWarID = normalizePositiveInteger(warID, null);
  if (!numericWarID) {
    return null;
  }
  const previousRecord = getWarRecord(numericWarID);
  const writeResult = updateRuntimeState((runtimeTable) => {
    const currentRecord = runtimeTable.wars && runtimeTable.wars[String(numericWarID)];
    if (!currentRecord) {
      return runtimeTable;
    }
    const nextRecord =
      typeof updater === "function"
        ? updater(cloneValue(currentRecord)) || currentRecord
        : currentRecord;
    runtimeTable.wars[String(numericWarID)] = nextRecord;
    return runtimeTable;
  });
  if (writeResult && writeResult.success) {
    markWarIndexesDirty();
  }
  const nextRecord = getWarRecord(numericWarID);
  if (previousRecord || nextRecord) {
    notifyWarChanged(cloneValue(previousRecord), cloneValue(nextRecord));
  }
  // CorpWarRetractedMsg (30) / AllWarRetractedMsg (7): emit once, on the
  // transition into the retracted state.
  if (
    nextRecord &&
    nextRecord.retracted &&
    !(previousRecord && previousRecord.retracted)
  ) {
    createWarRetractedNotifications(nextRecord);
    if (normalizeBoolean(nextRecord.mutual, false)) {
      warNotificationCenter.notifyMutualWarRetracted(nextRecord);
    }
  }
  return nextRecord;
}

function endWarWithReason(warID, options = {}) {
  const numericWarID = normalizePositiveInteger(warID, null);
  if (!numericWarID) {
    return null;
  }
  const now = normalizeNowFiletime(options);
  const finishAt =
    options.finishAtFiletime !== undefined && options.finishAtFiletime !== null
      ? normalizeFiletimeBigInt(options.finishAtFiletime, now)
      : options.cooldown
        ? now + WAR_COOLDOWN
        : now;
  const peaceReason =
    options.peaceReason === null || options.peaceReason === undefined
      ? null
      : Number(options.peaceReason);
  let endReason =
    options.endReason === null || options.endReason === undefined
      ? null
      : Number(options.endReason);
  if (endReason === null && options.retracted) {
    endReason = ENDED_RETRACTED;
  }
  let changed = null;
  const writeResult = updateRuntimeState((runtimeTable) => {
    runtimeTable.wars =
      runtimeTable.wars && typeof runtimeTable.wars === "object"
        ? runtimeTable.wars
        : {};
    const war = runtimeTable.wars[String(numericWarID)];
    if (!war || war.timeFinished) {
      return runtimeTable;
    }
    const previousWar = cloneValue(war);
    war.timeFinished = finishAt.toString();
    if (endReason !== null) {
      war.endReason = endReason;
    }
    if (options.retracted) {
      war.retracted = now.toString();
      war.retractedBy = normalizePositiveInteger(options.retractedBy, null);
      war.retractedByCharacterID = normalizePositiveInteger(
        options.retractedByCharacterID,
        null,
      );
    }
    if (peaceReason !== null) {
      ensurePeaceTreatyRuntime(runtimeTable);
      createPeaceTreatyRecord(runtimeTable, {
        warID: war.warID,
        ownerID: war.declaredByID,
        otherOwnerID: war.againstID,
        peaceReason,
        now,
      });
      createPeaceTreatyRecord(runtimeTable, {
        warID: war.warID,
        ownerID: war.againstID,
        otherOwnerID: war.declaredByID,
        peaceReason,
        now,
      });
    }
    changed = {
      previousWar,
      nextWar: cloneValue(war),
    };
    return runtimeTable;
  });
  if (!writeResult || !writeResult.success || !changed) {
    return null;
  }
  markWarIndexesDirty();
  notifyWarChanged(changed.previousWar, changed.nextWar);
  if (changed.nextWar.retracted && !changed.previousWar.retracted) {
    createWarRetractedNotifications(changed.nextWar);
    if (normalizeBoolean(changed.nextWar.mutual, false)) {
      warNotificationCenter.notifyMutualWarRetracted(changed.nextWar);
    }
  }
  if (options.hqRemovedStructure) {
    createWarHQRemovedNotifications(changed.nextWar, options.hqRemovedStructure, now);
  }
  if (endReason === ENDED_WAR_HQ_SYSTEM_SECURITY_DROP) {
    warNotificationCenter.notifyWarEndedHqSecurityDrop(
      changed.nextWar,
      options.hqRemovedStructure || resolveWarHQStructure(changed.nextWar),
      { endDate: changed.nextWar.timeFinished },
    );
  } else if (endReason === ENDED_UNPAID_BILL) {
    warNotificationCenter.notifyWarRetractedByConcord(changed.nextWar, {
      endDate: changed.nextWar.timeFinished,
    });
  } else if (
    endReason === ENDED_CORP_DELETED ||
    endReason === ENDED_ALLIANCE_DELETED ||
    endReason === ENDED_HQ_OWNER_LEFT
  ) {
    warNotificationCenter.notifyWarConcordInvalidates(changed.nextWar, {
      created: changed.nextWar.timeFinished,
    });
    warNotificationCenter.notifyWarInvalid(changed.nextWar, {
      endDate: changed.nextWar.timeFinished,
    });
  }
  return cloneValue(changed.nextWar);
}

function endWarsForLostWarHQ(structure, options = {}) {
  const structureID = normalizePositiveInteger(
    structure && structure.structureID,
    null,
  );
  if (!structureID) {
    return [];
  }
  const now = options.nowFiletime
    ? normalizeFiletimeBigInt(options.nowFiletime, currentFileTime())
    : options.nowMs !== undefined
      ? msToFileTime(options.nowMs)
      : currentFileTime();
  const cooldownEnd = now + WAR_COOLDOWN;
  const changedWars = [];
  const writeResult = updateRuntimeState((runtimeTable) => {
    runtimeTable.wars =
      runtimeTable.wars && typeof runtimeTable.wars === "object"
        ? runtimeTable.wars
        : {};
    ensurePeaceTreatyRuntime(runtimeTable);
    for (const war of Object.values(runtimeTable.wars)) {
      if (
        !war ||
        normalizePositiveInteger(war.warHQID, null) !== structureID ||
        normalizeBoolean(war.mutual, false) ||
        war.timeFinished
      ) {
        continue;
      }
      const previousWar = cloneValue(war);
      war.timeFinished = cooldownEnd.toString();
      war.endReason = ENDED_WARHQ_GONE;
      createPeaceTreatyRecord(runtimeTable, {
        warID: war.warID,
        ownerID: war.declaredByID,
        otherOwnerID: war.againstID,
        peaceReason: PEACE_REASON_HQ_REMOVED,
        now,
      });
      createPeaceTreatyRecord(runtimeTable, {
        warID: war.warID,
        ownerID: war.againstID,
        otherOwnerID: war.declaredByID,
        peaceReason: PEACE_REASON_HQ_REMOVED,
        now,
      });
      changedWars.push({
        previousWar,
        nextWar: cloneValue(war),
      });
    }
    return runtimeTable;
  });
  if (!writeResult || !writeResult.success || changedWars.length <= 0) {
    return [];
  }
  markWarIndexesDirty();
  for (const { previousWar, nextWar } of changedWars) {
    notifyWarChanged(previousWar, nextWar);
    createWarHQRemovedNotifications(nextWar, structure, now);
  }
  return changedWars.map(({ nextWar }) => cloneValue(nextWar));
}

function findWarForBill(bill) {
  const billID = normalizePositiveInteger(bill && bill.billID, null);
  if (!billID) {
    return null;
  }
  const warID = normalizePositiveInteger(bill && bill.externalID2, null);
  const directWar = warID ? getWarRecord(warID) : null;
  if (directWar && Number(directWar.billID) === billID) {
    return directWar;
  }
  return listAllWars().find((war) => Number(war && war.billID) === billID) || null;
}

function renewPaidWarBill(war, bill) {
  const nextBill = createNextWarBill(war, bill && bill.dueDateTime);
  updateWarRecord(war.warID, (record) => ({
    ...record,
    billID: nextBill ? nextBill.billID : null,
  }));
  markBillProcessed(bill.billID, "renewed", {
    renewedBillID: nextBill ? nextBill.billID : 0,
  });
  return {
    billID: bill.billID,
    warID: war.warID,
    action: "renewed",
    renewedBillID: nextBill ? nextBill.billID : 0,
  };
}

function defaultUnpaidWarBill(war, bill, now) {
  const endedWar = endWarWithReason(war.warID, {
    nowFiletime: now,
    endReason: ENDED_UNPAID_BILL,
    peaceReason: PEACE_REASON_UNPAID_BILL,
  });
  markBillProcessed(bill.billID, "defaulted");
  return {
    billID: bill.billID,
    warID: war.warID,
    action: endedWar ? "defaulted" : "blocked",
  };
}

function processDueWarBills(options = {}) {
  const now = normalizeNowFiletime(options);
  const dueBills = listDueBills({
    nowFileTime: now,
    billTypeID: BILL_TYPE_WAR,
  });
  const processed = [];

  for (const dueBill of dueBills) {
    const war = findWarForBill(dueBill);
    if (!war) {
      markBillProcessed(dueBill.billID, "orphaned");
      processed.push({
        billID: dueBill.billID,
        action: "orphaned",
      });
      continue;
    }

    if (
      !isAggressiveBillableWar(war) ||
      isWarFinishedOrFinishing(war) ||
      Number(war.billID) !== Number(dueBill.billID)
    ) {
      markBillProcessed(dueBill.billID, "inactive");
      processed.push({
        billID: dueBill.billID,
        warID: war.warID,
        action: "inactive",
      });
      continue;
    }

    let bill = dueBill;
    if (!bill.paid) {
      tryAutoPayBill(bill.billID);
      bill = getBillRecord(bill.billID) || dueBill;
    }

    if (bill.paid) {
      processed.push(renewPaidWarBill(war, bill));
      continue;
    }

    processed.push(defaultUnpaidWarBill(war, bill, now));
  }

  return {
    processedCount: processed.length,
    processed,
  };
}

function expireMutualWarInvites(now) {
  let removedCount = 0;
  updateRuntimeState((runtimeTable) => {
    runtimeTable.mutualWarInvites =
      runtimeTable.mutualWarInvites &&
      typeof runtimeTable.mutualWarInvites === "object"
        ? runtimeTable.mutualWarInvites
        : {};
    for (const [key, invite] of Object.entries(runtimeTable.mutualWarInvites)) {
      const sentDate = normalizeFiletimeBigInt(invite && invite.sentDate, 0n);
      if (sentDate > 0n && sentDate + MUTUAL_WAR_INVITE_EXPIRY <= now) {
        warNotificationCenter.notifyMutualWarExpired({
          declaredByID: normalizePositiveInteger(invite && invite.fromOwnerID, 0) || 0,
          againstID: normalizePositiveInteger(invite && invite.toOwnerID, 0) || 0,
        }, { numDays: 7 });
        delete runtimeTable.mutualWarInvites[key];
        removedCount += 1;
      }
    }
    return runtimeTable;
  });
  return removedCount;
}

function expireWarNegotiations(now) {
  let retractedCount = 0;
  updateRuntimeState((runtimeTable) => {
    runtimeTable.warNegotiations =
      runtimeTable.warNegotiations &&
      typeof runtimeTable.warNegotiations === "object"
        ? runtimeTable.warNegotiations
        : {};
    for (const negotiation of Object.values(runtimeTable.warNegotiations)) {
      if (
        !negotiation ||
        Number(negotiation.negotiationState) !== WAR_NEGOTIATION_STATE_NEW
      ) {
        continue;
      }
      const createdDateTime = normalizeFiletimeBigInt(
        negotiation.createdDateTime,
        0n,
      );
      if (createdDateTime > 0n && createdDateTime + WAR_NEGOTIATION_EXPIRY <= now) {
        negotiation.negotiationState = WAR_NEGOTIATION_STATE_RETRACTED;
        negotiation.timeRetracted = now.toString();
        retractedCount += 1;
      }
    }
    return runtimeTable;
  });
  return retractedCount;
}

function expirePeaceTreaties(now) {
  let removedCount = 0;
  updateRuntimeState((runtimeTable) => {
    runtimeTable.peaceTreaties =
      runtimeTable.peaceTreaties && typeof runtimeTable.peaceTreaties === "object"
        ? runtimeTable.peaceTreaties
        : {};
    for (const [key, treaty] of Object.entries(runtimeTable.peaceTreaties)) {
      const expiryDate = normalizeFiletimeBigInt(treaty && treaty.expiryDate, 0n);
      if (expiryDate > 0n && expiryDate <= now) {
        delete runtimeTable.peaceTreaties[key];
        removedCount += 1;
      }
    }
    return runtimeTable;
  });
  return removedCount;
}

function expireWarAllies(now) {
  const changedWars = [];
  const writeResult = updateRuntimeState((runtimeTable) => {
    runtimeTable.wars =
      runtimeTable.wars && typeof runtimeTable.wars === "object"
        ? runtimeTable.wars
        : {};
    for (const war of Object.values(runtimeTable.wars)) {
      if (!war || !war.allies || typeof war.allies !== "object") {
        continue;
      }
      const previousWar = cloneValue(war);
      let changed = false;
      for (const [allyID, ally] of Object.entries(war.allies)) {
        const timeFinished = normalizeFiletimeBigInt(
          ally && ally.timeFinished,
          0n,
        );
        if (timeFinished > 0n && timeFinished <= now) {
          warNotificationCenter.notifyAllyContractCancelled(war, allyID, ally);
          delete war.allies[allyID];
          changed = true;
        }
      }
      if (changed) {
        changedWars.push({
          previousWar,
          nextWar: cloneValue(war),
        });
      }
    }
    return runtimeTable;
  });
  if (!writeResult || !writeResult.success || changedWars.length <= 0) {
    return 0;
  }
  markWarIndexesDirty();
  for (const { previousWar, nextWar } of changedWars) {
    notifyWarChanged(previousWar, nextWar);
  }
  return changedWars.length;
}

function notifyWarsEnteringFightingLegal(now) {
  const changedWars = [];
  const writeResult = updateRuntimeState((runtimeTable) => {
    runtimeTable.wars =
      runtimeTable.wars && typeof runtimeTable.wars === "object"
        ? runtimeTable.wars
        : {};
    for (const war of Object.values(runtimeTable.wars)) {
      if (
        !war ||
        normalizeBoolean(war.mutual, false) ||
        war.fightingLegalNotified ||
        !isWarStartedAt(war, now) ||
        isWarFinishedAt(war, now)
      ) {
        continue;
      }
      war.fightingLegalNotified = 1;
      changedWars.push(cloneValue(war));
    }
    return runtimeTable;
  });
  if (!writeResult || !writeResult.success || changedWars.length <= 0) {
    return 0;
  }
  for (const war of changedWars) {
    warNotificationCenter.notifyWarFightingLegal(war);
  }
  return changedWars.length;
}

function inferDeletedOwnerEndReason(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, 0);
  return numericOwnerID >= 99000000 ? ENDED_ALLIANCE_DELETED : ENDED_CORP_DELETED;
}

function resolveWarHQEndReason(war, structure) {
  if (!structure || structure.destroyedAt || !isDockableUpwellWarHQ(structure)) {
    return {
      endReason: ENDED_WARHQ_GONE,
      peaceReason: PEACE_REASON_HQ_REMOVED,
      cooldown: true,
      hqRemovedStructure: structure || null,
    };
  }

  if (!isHighSecurityWarHQ(structure)) {
    return {
      endReason: ENDED_WAR_HQ_SYSTEM_SECURITY_DROP,
      peaceReason: PEACE_REASON_HQ_REMOVED,
      cooldown: true,
      hqRemovedStructure: structure,
    };
  }

  const declaredByID = normalizePositiveInteger(war && war.declaredByID, null);
  const ownerCorporationID = getStructureOwnerCorporationID(structure);
  const declaredByAlliance = getAllianceRecord(declaredByID);
  if (declaredByAlliance) {
    const ownerCorporation = getCorporationRecord(ownerCorporationID);
    if (
      !ownerCorporation ||
      Number(ownerCorporation.allianceID || 0) !== Number(declaredByID)
    ) {
      return {
        endReason: ENDED_HQ_OWNER_LEFT,
        peaceReason: PEACE_REASON_HQ_OWNER_LEFT_ALLIANCE,
        cooldown: true,
      };
    }
    return null;
  }

  if (ownerCorporationID !== declaredByID) {
    return {
      endReason: ENDED_HQ_OWNER_LEFT,
      peaceReason: PEACE_REASON_HQ_REMOVED,
      cooldown: true,
    };
  }

  return null;
}

function endWarsForDeletedOwners(now) {
  let endedCount = 0;
  for (const war of listAllWars()) {
    if (!isAggressiveBillableWar(war) || isWarFinishedOrFinishing(war)) {
      continue;
    }
    const declaredByID = normalizePositiveInteger(war.declaredByID, null);
    const againstID = normalizePositiveInteger(war.againstID, null);
    if (!ownerExists(declaredByID)) {
      if (
        endWarWithReason(war.warID, {
          nowFiletime: now,
          endReason: inferDeletedOwnerEndReason(declaredByID),
        })
      ) {
        endedCount += 1;
      }
      continue;
    }
    if (!ownerExists(againstID)) {
      if (
        endWarWithReason(war.warID, {
          nowFiletime: now,
          endReason: inferDeletedOwnerEndReason(againstID),
        })
      ) {
        endedCount += 1;
      }
    }
  }
  return endedCount;
}

function endWarsForInvalidWarHQs(now) {
  const structureState = getStructureStateService();
  let endedCount = 0;
  for (const war of listAllWars()) {
    if (!isAggressiveBillableWar(war) || isWarFinishedOrFinishing(war)) {
      continue;
    }
    const warHQID = normalizePositiveInteger(war.warHQID, null);
    if (!warHQID) {
      continue;
    }
    const structure = structureState.getStructureByID(warHQID, { refresh: false });
    const endState = resolveWarHQEndReason(war, structure);
    if (!endState) {
      continue;
    }
    const endedWar = endWarWithReason(war.warID, {
      nowFiletime: now,
      endReason: endState.endReason,
      peaceReason: endState.peaceReason,
      cooldown: endState.cooldown,
      hqRemovedStructure: endState.hqRemovedStructure,
    });
    if (endedWar) {
      endedCount += 1;
    }
  }
  return endedCount;
}

function createLeavingCorporationPeaceTreaties(corporationID, allianceID, now) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericCorporationID || !numericAllianceID) {
    return 0;
  }
  let createdCount = 0;
  updateRuntimeState((runtimeTable) => {
    runtimeTable.wars =
      runtimeTable.wars && typeof runtimeTable.wars === "object"
        ? runtimeTable.wars
        : {};
    ensurePeaceTreatyRuntime(runtimeTable);
    for (const war of Object.values(runtimeTable.wars)) {
      if (!isAggressiveBillableWar(war) || isWarFinishedOrFinishing(war)) {
        continue;
      }
      let counterpartyID = null;
      if (Number(war.declaredByID) === numericAllianceID) {
        counterpartyID = normalizePositiveInteger(war.againstID, null);
      } else if (Number(war.againstID) === numericAllianceID) {
        counterpartyID = normalizePositiveInteger(war.declaredByID, null);
      }
      if (!counterpartyID) {
        continue;
      }
      const beforeCount = Object.keys(runtimeTable.peaceTreaties || {}).length;
      createPeaceTreatyRecord(runtimeTable, {
        warID: war.warID,
        ownerID: numericCorporationID,
        otherOwnerID: counterpartyID,
        peaceReason: PEACE_REASON_CORP_LEFT_ALLIANCE,
        now,
      });
      createPeaceTreatyRecord(runtimeTable, {
        warID: war.warID,
        ownerID: counterpartyID,
        otherOwnerID: numericCorporationID,
        peaceReason: PEACE_REASON_CORP_LEFT_ALLIANCE,
        now,
      });
      createdCount += Math.max(
        0,
        Object.keys(runtimeTable.peaceTreaties || {}).length - beforeCount,
      );
    }
    return runtimeTable;
  });
  return createdCount;
}

function handleCorporationLeftAlliance({
  corporationID,
  allianceID,
  nowFiletime = currentFileTime(),
} = {}) {
  const now = normalizeFiletimeBigInt(nowFiletime, currentFileTime());
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericCorporationID || !numericAllianceID) {
    return {
      endedCount: 0,
      treatyCount: 0,
      inheritedAllyCount: 0,
    };
  }

  let endedCount = 0;
  let inheritedAllyCount = 0;
  for (const war of listAllWars()) {
    const allianceAlly = war && war.allies && war.allies[String(numericAllianceID)];
    if (
      !isWarFinishedOrFinishing(war) &&
      isAllyActiveAt(allianceAlly, now)
    ) {
      warNotificationCenter.notifyWarInherited(war, {
        allianceID: numericAllianceID,
        quitterID: numericCorporationID,
        opponentID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
        isAlly: true,
      });
      inheritedAllyCount += 1;
    }

    const createdFromWarID = normalizePositiveInteger(war && war.createdFromWarID, null);
    if (
      createdFromWarID &&
      isAggressiveBillableWar(war) &&
      !isWarFinishedOrFinishing(war) &&
      (Number(war.declaredByID) === numericCorporationID ||
        Number(war.againstID) === numericCorporationID)
    ) {
      if (
        endWarWithReason(war.warID, {
          nowFiletime: now,
          endReason: ENDED_LEFT_ALLIANCE,
          peaceReason: PEACE_REASON_CORP_LEFT_ALLIANCE,
        })
      ) {
        warNotificationCenter.notifyWarInherited(war, {
          allianceID: numericAllianceID,
          quitterID: numericCorporationID,
          opponentID:
            Number(war.declaredByID) === numericCorporationID
              ? normalizePositiveInteger(war.againstID, 0) || 0
              : normalizePositiveInteger(war.declaredByID, 0) || 0,
        });
        endedCount += 1;
      }
      continue;
    }

    if (
      !isAggressiveBillableWar(war) ||
      isWarFinishedOrFinishing(war) ||
      Number(war.declaredByID) !== numericAllianceID
    ) {
      continue;
    }
    const warHQID = normalizePositiveInteger(war.warHQID, null);
    if (!warHQID) {
      continue;
    }
    const structure = getStructureStateService().getStructureByID(warHQID, {
      refresh: false,
    });
    if (getStructureOwnerCorporationID(structure) !== numericCorporationID) {
      continue;
    }
    if (
      endWarWithReason(war.warID, {
        nowFiletime: now,
        endReason: ENDED_HQ_OWNER_LEFT,
        peaceReason: PEACE_REASON_HQ_OWNER_LEFT_ALLIANCE,
        cooldown: true,
      })
    ) {
      endedCount += 1;
    }
  }

  return {
    endedCount,
    inheritedAllyCount,
    treatyCount: createLeavingCorporationPeaceTreaties(
      numericCorporationID,
      numericAllianceID,
      now,
    ),
  };
}

function handleCorporationJoinedAlliance({
  corporationID,
  allianceID,
  nowFiletime = currentFileTime(),
} = {}) {
  const now = normalizeFiletimeBigInt(nowFiletime, currentFileTime());
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericCorporationID || !numericAllianceID) {
    return { notified: false, adoptedCount: 0 };
  }
  const hasLiveAllianceWar = listWarsForOwner(numericAllianceID).some(
    (war) => war && !isWarFinishedAt(war, now),
  );
  let notified = false;
  if (hasLiveAllianceWar) {
    warNotificationCenter.notifyCorporationJoinedAllianceAtWar({
      allianceID: numericAllianceID,
      corporationID: numericCorporationID,
    });
    notified = true;
  }
  let adoptedCount = 0;
  for (const war of listAllWars()) {
    if (!war || isWarFinishedAt(war, now)) {
      continue;
    }
    const principalWar =
      Number(war.declaredByID) === numericCorporationID ||
      Number(war.againstID) === numericCorporationID;
    const allyWar = isAllyActiveAt(
      war.allies && war.allies[String(numericCorporationID)],
      now,
    );
    if (!principalWar && !allyWar) {
      continue;
    }
    warNotificationCenter.notifyWarAdopted(war, {
      allianceID: numericAllianceID,
      isAlly: allyWar && !principalWar,
    });
    adoptedCount += 1;
  }
  return { notified, adoptedCount };
}

function processWarLifecycle(options = {}) {
  const now = normalizeNowFiletime(options);
  const billing = processDueWarBills({ nowFileTime: now });
  return {
    billing,
    expiredMutualInvites: expireMutualWarInvites(now),
    expiredNegotiations: expireWarNegotiations(now),
    expiredPeaceTreaties: expirePeaceTreaties(now),
    expiredAllyWars: expireWarAllies(now),
    fightingLegalWars: notifyWarsEnteringFightingLegal(now),
    deletedOwnerWars: endWarsForDeletedOwners(now),
    invalidWarHQWars: endWarsForInvalidWarHQs(now),
  };
}

function resolveCharacterWarEntityIDs(characterID) {
  const characterState = getCharacterStateService();
  const character =
    characterState && typeof characterState.getCharacterRecord === "function"
      ? characterState.getCharacterRecord(characterID)
      : null;
  const entityIDs = new Set();
  const corporationID = normalizePositiveInteger(
    character && character.corporationID,
    null,
  );
  const allianceID = normalizePositiveInteger(
    character && character.allianceID,
    null,
  );
  if (corporationID) {
    entityIDs.add(corporationID);
  }
  if (allianceID) {
    entityIDs.add(allianceID);
  }
  return entityIDs;
}

function isAllyActiveAt(ally, now) {
  if (!ally) {
    return false;
  }
  const timeStarted = normalizeFiletimeBigInt(ally.timeStarted, 0n);
  const timeFinished = normalizeFiletimeBigInt(ally.timeFinished, 0n);
  return timeStarted <= now && (timeFinished === 0n || timeFinished > now);
}

function findActiveWarBetweenWarEntities(leftEntityIDs, rightEntityIDs, options = {}) {
  const now = normalizeNowFiletime(options);
  const left = leftEntityIDs instanceof Set ? leftEntityIDs : new Set(leftEntityIDs || []);
  const right = rightEntityIDs instanceof Set ? rightEntityIDs : new Set(rightEntityIDs || []);
  if (left.size <= 0 || right.size <= 0) {
    return null;
  }

  for (const war of listAllWars()) {
    if (!isWarActiveAt(war, now)) {
      continue;
    }
    const declaredByID = normalizePositiveInteger(war.declaredByID, null);
    const againstID = normalizePositiveInteger(war.againstID, null);
    const leftIsAggressor = left.has(declaredByID);
    const rightIsAggressor = right.has(declaredByID);
    const leftIsDefender = left.has(againstID);
    const rightIsDefender = right.has(againstID);
    if (
      (leftIsAggressor && rightIsDefender) ||
      (leftIsDefender && rightIsAggressor)
    ) {
      return {
        warID: war.warID,
        war: cloneValue(war),
        relationship: "declared-war",
      };
    }

    const activeAllyIDs = Object.entries(war.allies || {})
      .filter(([, ally]) => isAllyActiveAt(ally, now))
      .map(([allyID]) => normalizePositiveInteger(allyID, null))
      .filter(Boolean);
    const leftIsAlly = activeAllyIDs.some((allyID) => left.has(allyID));
    const rightIsAlly = activeAllyIDs.some((allyID) => right.has(allyID));
    if (
      (leftIsAggressor && rightIsAlly) ||
      (rightIsAggressor && leftIsAlly)
    ) {
      return {
        warID: war.warID,
        war: cloneValue(war),
        relationship: "ally-war",
      };
    }
  }

  return null;
}

function findActiveWarBetweenCharacters(attackerCharacterID, targetCharacterID, options = {}) {
  const attackerID = normalizePositiveInteger(attackerCharacterID, null);
  const targetID = normalizePositiveInteger(targetCharacterID, null);
  if (!attackerID || !targetID || attackerID === targetID) {
    return null;
  }
  return findActiveWarBetweenWarEntities(
    resolveCharacterWarEntityIDs(attackerID),
    resolveCharacterWarEntityIDs(targetID),
    options,
  );
}

function areCharactersLegalWarOpponents(attackerCharacterID, targetCharacterID, options = {}) {
  return Boolean(
    findActiveWarBetweenCharacters(attackerCharacterID, targetCharacterID, options),
  );
}

module.exports = {
  areCharactersLegalWarOpponents,
  createWarRecord,
  createWarSurrenderNotifications,
  endWarWithReason,
  endWarsForLostWarHQ,
  findActiveWarBetweenCharacters,
  getWarRecord,
  handleCorporationJoinedAlliance,
  handleCorporationLeftAlliance,
  listAllWars,
  listAllWarsDescending,
  listWarsForStructure,
  listWarsForOwner,
  processDueWarBills,
  processWarLifecycle,
  updateWarRecord,
  _testing: {
    FILETIME_TICKS_PER_WEEK,
    resetWarIndexes: markWarIndexesDirty,
  },
};
