const path = require("path");

const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllianceCorporationIDs,
  getAllianceRecord,
  getCharacterIDsInCorporation,
} = require(path.join(__dirname, "./corporationState"));
const {
  normalizePositiveInteger,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));

const FILETIME_TICKS_PER_HOUR = 36000000000n;
const FILETIME_TICKS_PER_DAY = FILETIME_TICKS_PER_HOUR * 24n;
const WAR_SPOOLUP = FILETIME_TICKS_PER_DAY;
const MUTUAL_WAR_INVITE_EXPIRY = FILETIME_TICKS_PER_DAY * 7n;

function normalizeFiletimeBigInt(value, fallback = 0n) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  try {
    return BigInt(String(value));
  } catch (_error) {
    return fallback;
  }
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

function collectUniqueCharacterIDs(ownerIDs = []) {
  const recipients = new Set();
  for (const ownerID of ownerIDs) {
    for (const characterID of collectWarOwnerCharacterIDs(ownerID)) {
      recipients.add(characterID);
    }
  }
  return [...recipients].sort((left, right) => left - right);
}

function collectAllWarParticipantCharacterIDs(war) {
  return collectUniqueCharacterIDs([
    normalizePositiveInteger(war && war.declaredByID, null),
    normalizePositiveInteger(war && war.againstID, null),
    ...Object.keys((war && war.allies) || {}).map((allyID) =>
      normalizePositiveInteger(allyID, null),
    ),
  ]);
}

function createWarNotification(characterIDs, {
  typeID,
  senderID = 0,
  data = {},
  created = null,
  emitLive = true,
} = {}) {
  const normalizedTypeID = normalizePositiveInteger(typeID, null);
  if (!normalizedTypeID) {
    return [];
  }
  const results = [];
  for (const characterID of [...new Set(characterIDs || [])]) {
    const numericCharacterID = normalizePositiveInteger(characterID, null);
    if (!numericCharacterID) {
      continue;
    }
    results.push(createNotification(numericCharacterID, {
      typeID: normalizedTypeID,
      senderID: normalizePositiveInteger(senderID, 0) || 0,
      groupID: NOTIFICATION_GROUP.WAR,
      processed: false,
      data,
      created: created || undefined,
      emitLive,
    }));
  }
  return results;
}

function buildWarOwnersData(war, extraData = {}) {
  return {
    declaredByID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    againstID: normalizePositiveInteger(war && war.againstID, 0) || 0,
    ...extraData,
  };
}

function buildWarDeclarationData(war, structure = null, extraData = {}) {
  const declaredAt = normalizeFiletimeBigInt(war && war.timeDeclared, currentFileTime());
  const startedAt = normalizeFiletimeBigInt(war && war.timeStarted, declaredAt);
  const data = buildWarOwnersData(war, {
    cost: Number(extraData.cost || 0),
    hostileState: startedAt <= currentFileTime() ? 1 : 0,
    timeDeclared: declaredAt.toString(),
    timeStarted: startedAt.toString(),
    delayHours:
      startedAt > declaredAt
        ? Number((startedAt - declaredAt) / FILETIME_TICKS_PER_HOUR)
        : 0,
    ...extraData,
  });
  const structureID = normalizePositiveInteger(
    structure && (structure.structureID || structure.itemID),
    null,
  );
  if (structureID) {
    data.warHQ = String(
      (structure && (structure.itemName || structure.name)) ||
        `Structure ${structureID}`,
    );
    data.warHQ_IdType = [
      structureID,
      normalizePositiveInteger(structure && structure.typeID, 0) || 0,
    ];
  }
  return data;
}

function notifyModernWarDeclared(war, options = {}) {
  const recipients = collectAllWarParticipantCharacterIDs(war);
  return createWarNotification(recipients, {
    typeID: NOTIFICATION_TYPE.WAR_DECLARED,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: buildWarDeclarationData(war, options.structure || null, {
      cost: Number(options.cost || 0),
    }),
  });
}

function notifyWarDeclaredV2(war, options = {}) {
  const againstID = normalizePositiveInteger(war && war.againstID, null);
  if (!againstID) {
    return [];
  }
  const typeID = getAllianceRecord(againstID)
    ? NOTIFICATION_TYPE.ALL_WAR_DECLARED_2
    : NOTIFICATION_TYPE.CORP_WAR_DECLARED_2;
  return createWarNotification(collectWarOwnerCharacterIDs(againstID), {
    typeID,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: buildWarDeclarationData(war, options.structure || null, {
      cost: Number(options.cost || 0),
    }),
  });
}

function notifyWarFightingLegal(war) {
  const againstID = normalizePositiveInteger(war && war.againstID, null);
  if (!againstID) {
    return [];
  }
  return createWarNotification(collectWarOwnerCharacterIDs(againstID), {
    typeID: NOTIFICATION_TYPE.CORP_WAR_FIGHTING_LEGAL,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: buildWarOwnersData(war, { cost: 0 }),
  });
}

function notifyMutualWarInviteSent({ fromOwnerID, toOwnerID, sentDate = null } = {}) {
  const sentAt = normalizeFiletimeBigInt(sentDate, currentFileTime());
  return createWarNotification(collectWarOwnerCharacterIDs(toOwnerID), {
    typeID: NOTIFICATION_TYPE.WAR_MUTUAL_WAR_INVITE_SENT,
    senderID: normalizePositiveInteger(fromOwnerID, 0) || 0,
    data: {
      declaredByID: normalizePositiveInteger(fromOwnerID, 0) || 0,
      againstID: normalizePositiveInteger(toOwnerID, 0) || 0,
      expireTimeStamp: (sentAt + MUTUAL_WAR_INVITE_EXPIRY).toString(),
    },
    created: sentAt.toString(),
  });
}

function notifyMutualWarInviteRejected({ fromOwnerID, toOwnerID } = {}) {
  return createWarNotification(collectWarOwnerCharacterIDs(fromOwnerID), {
    typeID: NOTIFICATION_TYPE.WAR_MUTUAL_WAR_INVITE_REJECTED,
    senderID: normalizePositiveInteger(toOwnerID, 0) || 0,
    data: {
      declaredByID: normalizePositiveInteger(fromOwnerID, 0) || 0,
      againstID: normalizePositiveInteger(toOwnerID, 0) || 0,
    },
  });
}

function notifyMutualWarInviteAccepted({ fromOwnerID, toOwnerID, time = null } = {}) {
  const acceptedAt = normalizeFiletimeBigInt(time, currentFileTime());
  return createWarNotification(collectUniqueCharacterIDs([fromOwnerID, toOwnerID]), {
    typeID: NOTIFICATION_TYPE.WAR_MUTUAL_WAR_INVITE_ACCEPTED,
    senderID: normalizePositiveInteger(toOwnerID, 0) || 0,
    data: {
      declaredByID: normalizePositiveInteger(fromOwnerID, 0) || 0,
      againstID: normalizePositiveInteger(toOwnerID, 0) || 0,
      time: acceptedAt.toString(),
    },
    created: acceptedAt.toString(),
  });
}

function notifyMadeWarMutual({ fromOwnerID, toOwnerID, characterID = null } = {}) {
  const charID = normalizePositiveInteger(characterID, 0) || 0;
  const results = [];
  results.push(...createWarNotification(collectWarOwnerCharacterIDs(fromOwnerID), {
    typeID: NOTIFICATION_TYPE.MADE_WAR_MUTUAL,
    senderID: charID || normalizePositiveInteger(toOwnerID, 0) || 0,
    data: {
      enemyID: normalizePositiveInteger(toOwnerID, 0) || 0,
      charID,
    },
  }));
  results.push(...createWarNotification(collectWarOwnerCharacterIDs(toOwnerID), {
    typeID: NOTIFICATION_TYPE.MADE_WAR_MUTUAL,
    senderID: charID || normalizePositiveInteger(fromOwnerID, 0) || 0,
    data: {
      enemyID: normalizePositiveInteger(fromOwnerID, 0) || 0,
      charID,
    },
  }));
  return results;
}

function notifyMutualWarExpired(war, options = {}) {
  return createWarNotification(collectAllWarParticipantCharacterIDs(war), {
    typeID: NOTIFICATION_TYPE.WAR_MUTUAL_WAR_EXPIRED,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: buildWarOwnersData(war, {
      numDays: Number(options.numDays || 7),
    }),
  });
}

function notifyWarAdopted(war, {
  allianceID,
  isAlly = false,
} = {}) {
  const numericAllianceID = normalizePositiveInteger(allianceID, null);
  if (!numericAllianceID) {
    return [];
  }
  const data = buildWarOwnersData(war, {
    allianceID: numericAllianceID,
  });
  if (isAlly) {
    data.isAlly = true;
  }
  return createWarNotification([
    ...collectAllWarParticipantCharacterIDs(war),
    ...collectWarOwnerCharacterIDs(numericAllianceID),
  ], {
    typeID: NOTIFICATION_TYPE.WAR_ADOPTED,
    senderID: numericAllianceID,
    data,
  });
}

function notifyMutualWarRetracted(war) {
  const modernResults = createWarNotification(collectAllWarParticipantCharacterIDs(war), {
    typeID: NOTIFICATION_TYPE.WAR_RETRACTED,
    senderID: normalizePositiveInteger(war && war.retractedBy, 0) ||
      normalizePositiveInteger(war && war.declaredByID, 0) ||
      0,
    data: buildWarOwnersData(war),
  });
  const charID = normalizePositiveInteger(war && war.retractedByCharacterID, 0) || 0;
  const declaredByID = normalizePositiveInteger(war && war.declaredByID, 0) || 0;
  const againstID = normalizePositiveInteger(war && war.againstID, 0) || 0;
  const legacyResults = [];
  legacyResults.push(...createWarNotification(collectWarOwnerCharacterIDs(declaredByID), {
    typeID: NOTIFICATION_TYPE.RETRACTS_WAR,
    senderID: charID || declaredByID,
    data: {
      enemyID: againstID,
      charID,
    },
  }));
  legacyResults.push(...createWarNotification(collectWarOwnerCharacterIDs(againstID), {
    typeID: NOTIFICATION_TYPE.RETRACTS_WAR,
    senderID: charID || declaredByID,
    data: {
      enemyID: declaredByID,
      charID,
    },
  }));
  return [...modernResults, ...legacyResults];
}

function notifyWarEndedHqSecurityDrop(war, structure, options = {}) {
  const structureID = normalizePositiveInteger(
    structure && (structure.structureID || structure.itemID),
    0,
  ) || 0;
  const endDate = options.endDate || war && war.timeFinished || currentFileTime();
  return createWarNotification(collectAllWarParticipantCharacterIDs(war), {
    typeID: NOTIFICATION_TYPE.WAR_ENDED_HQ_SECURITY_DROP,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: buildWarOwnersData(war, {
      endDate: String(endDate),
      warHQ: String(
        (structure && (structure.itemName || structure.name)) ||
          `Structure ${structureID}`,
      ),
      warHQ_IdType: [
        structureID,
        normalizePositiveInteger(structure && structure.typeID, 0) || 0,
      ],
    }),
  });
}

function notifyWarRetractedByConcord(war, options = {}) {
  return createWarNotification(collectAllWarParticipantCharacterIDs(war), {
    typeID: NOTIFICATION_TYPE.WAR_RETRACTED_BY_CONCORD,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: buildWarOwnersData(war, {
      endDate: String(options.endDate || war && war.timeFinished || currentFileTime()),
    }),
  });
}

function notifyWarConcordInvalidates(war, options = {}) {
  const senderID = normalizePositiveInteger(war && war.declaredByID, 0) || 0;
  const modernResults = createWarNotification(collectAllWarParticipantCharacterIDs(war), {
    typeID: NOTIFICATION_TYPE.WAR_CONCORD_INVALIDATES,
    senderID,
    data: buildWarOwnersData(war, {
      timeStarted: String(war && war.timeStarted ? war.timeStarted : currentFileTime()),
    }),
    created: String(options.created || war && war.timeFinished || currentFileTime()),
  });
  const againstID = normalizePositiveInteger(war && war.againstID, null);
  if (!againstID) {
    return modernResults;
  }
  const legacyTypeID = getAllianceRecord(againstID)
    ? NOTIFICATION_TYPE.ALL_WAR_INVALIDATED
    : NOTIFICATION_TYPE.CORP_WAR_INVALIDATED;
  const legacyResults = createWarNotification(collectWarOwnerCharacterIDs(againstID), {
    typeID: legacyTypeID,
    senderID,
    data: buildWarOwnersData(war),
    created: String(options.created || war && war.timeFinished || currentFileTime()),
  });
  return [...modernResults, ...legacyResults];
}

function notifyWarInvalid(war, options = {}) {
  return createWarNotification(collectAllWarParticipantCharacterIDs(war), {
    typeID: NOTIFICATION_TYPE.WAR_INVALID,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: buildWarOwnersData(war, {
      endDate: String(options.endDate || war && war.timeFinished || currentFileTime()),
    }),
  });
}

function notifySurrenderOffered(negotiation, options = {}) {
  const recipients = collectWarOwnerCharacterIDs(negotiation && negotiation.ownerID2);
  const characterID = normalizePositiveInteger(options.characterID, 0) || 0;
  const results = createWarNotification(recipients, {
    typeID: NOTIFICATION_TYPE.WAR_SURRENDER_OFFER,
    senderID: characterID ||
      normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) ||
      0,
    data: {
      ownerID1: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      ownerID2: normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) || 0,
      iskValue: Number(negotiation && negotiation.iskValue || 0),
    },
  });
  results.push(...createWarNotification(recipients, {
    typeID: NOTIFICATION_TYPE.OFFERED_SURRENDER,
    senderID: characterID ||
      normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) ||
      0,
    data: {
      entityID: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      offeredID: normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) || 0,
      charID: characterID,
      iskValue: Number(negotiation && negotiation.iskValue || 0),
    },
  }));
  return results;
}

function notifySurrenderDeclined(negotiation, options = {}) {
  return createWarNotification(collectWarOwnerCharacterIDs(negotiation && negotiation.ownerID1), {
    typeID: NOTIFICATION_TYPE.WAR_SURRENDER_DECLINED,
    senderID: normalizePositiveInteger(options.characterID, 0) ||
      normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) ||
      0,
    data: {
      ownerID: normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) || 0,
      iskValue: Number(negotiation && negotiation.iskValue || 0),
    },
  });
}

function notifyAcceptedSurrender(negotiation, options = {}) {
  return createWarNotification(collectUniqueCharacterIDs([
    negotiation && negotiation.ownerID1,
    negotiation && negotiation.ownerID2,
  ]), {
    typeID: NOTIFICATION_TYPE.ACCEPTED_SURRENDER,
    senderID: normalizePositiveInteger(options.characterID, 0) ||
      normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) ||
      0,
    data: {
      entityID: normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) || 0,
      offeringID: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      charID: normalizePositiveInteger(options.characterID, 0) || 0,
      iskValue: Number(negotiation && negotiation.iskValue || 0),
    },
  });
}

function notifyAllyOfferCreated(negotiation, options = {}) {
  const characterID = normalizePositiveInteger(options.characterID, 0) || 0;
  const senderID = characterID ||
    normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) ||
    0;
  const results = createWarNotification(collectWarOwnerCharacterIDs(negotiation && negotiation.ownerID2), {
    typeID: NOTIFICATION_TYPE.MERC_OFFERED_NEGOTIATION,
    senderID,
    data: {
      mercID: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      defenderID: normalizePositiveInteger(negotiation && negotiation.againstID, 0) || 0,
      aggressorID: normalizePositiveInteger(negotiation && negotiation.declaredByID, 0) || 0,
      iskValue: Number(negotiation && negotiation.iskValue || 0),
    },
  });
  results.push(...createWarNotification(collectWarOwnerCharacterIDs(negotiation && negotiation.ownerID1), {
    typeID: NOTIFICATION_TYPE.OFFERED_TO_ALLY,
    senderID,
    data: {
      defenderID: normalizePositiveInteger(negotiation && negotiation.againstID, 0) || 0,
      enemyID: normalizePositiveInteger(negotiation && negotiation.declaredByID, 0) || 0,
      charID: characterID,
      iskValue: Number(negotiation && negotiation.iskValue || 0),
    },
  }));
  return results;
}

function notifyAllyOfferRetracted(negotiation, options = {}) {
  const characterID = normalizePositiveInteger(options.characterID, 0) || 0;
  const senderID = characterID ||
    normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) ||
    0;
  const results = createWarNotification(collectWarOwnerCharacterIDs(negotiation && negotiation.ownerID2), {
    typeID: NOTIFICATION_TYPE.MERC_OFFER_RETRACTED,
    senderID,
    data: {
      mercID: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      defenderID: normalizePositiveInteger(negotiation && negotiation.againstID, 0) || 0,
      aggressorID: normalizePositiveInteger(negotiation && negotiation.declaredByID, 0) || 0,
    },
  });
  results.push(...createWarNotification(collectWarOwnerCharacterIDs(negotiation && negotiation.ownerID1), {
    typeID: NOTIFICATION_TYPE.OFFER_TO_ALLY_RETRACTED,
    senderID,
    data: {
      allyID: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      defenderID: normalizePositiveInteger(negotiation && negotiation.againstID, 0) || 0,
      enemyID: normalizePositiveInteger(negotiation && negotiation.declaredByID, 0) || 0,
      charID: characterID,
    },
  }));
  return results;
}

function notifyAllyOfferDeclined(negotiation, options = {}) {
  return createWarNotification(collectWarOwnerCharacterIDs(negotiation && negotiation.ownerID1), {
    typeID: NOTIFICATION_TYPE.WAR_ALLY_OFFER_DECLINED,
    senderID: normalizePositiveInteger(options.characterID, 0) ||
      normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) ||
      0,
    data: {
      defenderID: normalizePositiveInteger(negotiation && negotiation.againstID, 0) || 0,
      aggressorID: normalizePositiveInteger(negotiation && negotiation.declaredByID, 0) || 0,
      allyID: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      charID: normalizePositiveInteger(options.characterID, 0) || 0,
    },
  });
}

function notifyAllyAccepted(negotiation, options = {}) {
  const time = normalizeFiletimeBigInt(options.time, currentFileTime());
  return createWarNotification(collectUniqueCharacterIDs([
    negotiation && negotiation.ownerID1,
    negotiation && negotiation.ownerID2,
    negotiation && negotiation.declaredByID,
  ]), {
    typeID: NOTIFICATION_TYPE.ACCEPTED_ALLY,
    senderID: normalizePositiveInteger(options.characterID, 0) ||
      normalizePositiveInteger(negotiation && negotiation.ownerID2, 0) ||
      0,
    data: {
      allyID: normalizePositiveInteger(negotiation && negotiation.ownerID1, 0) || 0,
      enemyID: normalizePositiveInteger(negotiation && negotiation.declaredByID, 0) || 0,
      charID: normalizePositiveInteger(options.characterID, 0) || 0,
      iskValue: Number(negotiation && negotiation.iskValue || 0),
      time: time.toString(),
    },
    created: time.toString(),
  });
}

function notifyAllyJoinedWar(war, allyID, options = {}) {
  const startTime = String(options.startTime || currentFileTime());
  const data = {
    allyID: normalizePositiveInteger(allyID, 0) || 0,
    defenderID: normalizePositiveInteger(war && war.againstID, 0) || 0,
    aggressorID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    startTime,
  };
  const senderID = normalizePositiveInteger(allyID, 0) || 0;
  const results = [];
  results.push(...createWarNotification(collectWarOwnerCharacterIDs(war && war.againstID), {
    typeID: NOTIFICATION_TYPE.ALLY_JOINED_WAR_DEFENDER,
    senderID,
    data,
  }));
  results.push(...createWarNotification(collectWarOwnerCharacterIDs(war && war.declaredByID), {
    typeID: NOTIFICATION_TYPE.ALLY_JOINED_WAR_AGGRESSOR,
    senderID,
    data,
  }));
  results.push(...createWarNotification(collectWarOwnerCharacterIDs(allyID), {
    typeID: NOTIFICATION_TYPE.ALLY_JOINED_WAR_ALLY,
    senderID,
    data,
  }));
  return results;
}

function notifyAllyContractCancelled(war, allyID, ally) {
  return createWarNotification(collectUniqueCharacterIDs([
    war && war.declaredByID,
    war && war.againstID,
    allyID,
  ]), {
    typeID: NOTIFICATION_TYPE.ALLY_CONTRACT_CANCELLED,
    senderID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
    data: {
      defenderID: normalizePositiveInteger(war && war.againstID, 0) || 0,
      aggressorID: normalizePositiveInteger(war && war.declaredByID, 0) || 0,
      timeFinished: String((ally && ally.timeFinished) || currentFileTime()),
    },
  });
}

function notifyWarInherited(war, {
  allianceID,
  quitterID,
  opponentID,
  isAlly = false,
} = {}) {
  return createWarNotification(collectAllWarParticipantCharacterIDs(war), {
    typeID: isAlly
      ? NOTIFICATION_TYPE.WAR_ALLY_INHERITED
      : NOTIFICATION_TYPE.WAR_INHERITED,
    senderID: normalizePositiveInteger(allianceID, 0) || 0,
    data: buildWarOwnersData(war, {
      allianceID: normalizePositiveInteger(allianceID, 0) || 0,
      quitterID: normalizePositiveInteger(quitterID, 0) || 0,
      opponentID: normalizePositiveInteger(opponentID, 0) || 0,
    }),
  });
}

function notifyCorporationJoinedAllianceAtWar({ allianceID, corporationID } = {}) {
  return createWarNotification(collectWarOwnerCharacterIDs(allianceID), {
    typeID: NOTIFICATION_TYPE.ALL_WAR_CORP_JOINED_ALLIANCE,
    senderID: normalizePositiveInteger(corporationID, 0) || 0,
    data: {
      allianceID: normalizePositiveInteger(allianceID, 0) || 0,
      corpID: normalizePositiveInteger(corporationID, 0) || 0,
    },
  });
}

module.exports = {
  MUTUAL_WAR_INVITE_EXPIRY,
  WAR_SPOOLUP,
  buildWarDeclarationData,
  buildWarOwnersData,
  collectAllWarParticipantCharacterIDs,
  collectWarOwnerCharacterIDs,
  notifyAcceptedSurrender,
  notifyAllyAccepted,
  notifyAllyContractCancelled,
  notifyAllyJoinedWar,
  notifyAllyOfferCreated,
  notifyAllyOfferDeclined,
  notifyAllyOfferRetracted,
  notifyCorporationJoinedAllianceAtWar,
  notifyWarConcordInvalidates,
  notifyWarAdopted,
  notifyModernWarDeclared,
  notifyMadeWarMutual,
  notifyMutualWarExpired,
  notifyMutualWarInviteAccepted,
  notifyMutualWarInviteRejected,
  notifyMutualWarInviteSent,
  notifyMutualWarRetracted,
  notifySurrenderDeclined,
  notifySurrenderOffered,
  notifyWarDeclaredV2,
  notifyWarEndedHqSecurityDrop,
  notifyWarFightingLegal,
  notifyWarInherited,
  notifyWarInvalid,
  notifyWarRetractedByConcord,
};
