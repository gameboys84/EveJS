const path = require("path");

const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  listCorporationMembers,
  normalizePositiveInteger,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  CUSTOM_CORPORATION_ID_START,
} = require(path.join(__dirname, "./corporationState"));
const {
  resolveApplicationRecipientIDs,
} = require(path.join(__dirname, "./corpApplicationNotifications"));

// Fan a corporation-wide center notification out to every current member, with
// the corporation as the sender. An optional acting character (the member who
// triggered the change) is excluded, matching the convention that an actor is
// not notified of their own action.
function notifyCorporationMembers(corporationID, typeID, data, options = {}) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericTypeID = normalizePositiveInteger(typeID, null);
  if (!numericCorporationID || !numericTypeID) {
    return [];
  }
  const excludedCharacterID = normalizePositiveInteger(options.excludeCharacterID, null);
  const delivered = [];
  for (const member of listCorporationMembers(numericCorporationID)) {
    const characterID = normalizePositiveInteger(member && member.characterID, null);
    if (!characterID || characterID === excludedCharacterID) {
      continue;
    }
    const result = createNotification(characterID, {
      typeID: numericTypeID,
      senderID: numericCorporationID,
      groupID: NOTIFICATION_GROUP.CORP,
      processed: false,
      data,
    });
    if (result && result.success) {
      delivered.push(characterID);
    }
  }
  return delivered;
}

// CorpNewCEOMsg (typeID 22): the corporation's CEO stepped down and a new CEO
// took over; every remaining member is told. The client's notification template
// renders only the corporation name (from corpID), so corpID is the sole data
// field. The resigning CEO who triggered the change is excluded.
function notifyCorporationNewCeo(corporationID, options = {}) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericCorporationID) {
    return [];
  }
  return notifyCorporationMembers(
    numericCorporationID,
    NOTIFICATION_TYPE.CORP_NEW_CEO,
    { corpID: numericCorporationID },
    { excludeCharacterID: options.excludeCharacterID },
  );
}

// CorpTaxChangeMsg (typeID 19): the corporation's tax rate changed; every member
// is told. The client template renders the corporation name (from corpID) and
// the tax currency (defaulting to ISK), so corpID is the sole required data
// field. The CEO who changed the rate is excluded from the fan-out.
function notifyCorporationTaxRateChanged(corporationID, options = {}) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericCorporationID) {
    return [];
  }
  return notifyCorporationMembers(
    numericCorporationID,
    NOTIFICATION_TYPE.CORP_TAX_CHANGE,
    { corpID: numericCorporationID },
    { excludeCharacterID: options.excludeCharacterID },
  );
}

// CorpKicked (typeID 92): the character was removed (kicked) from the
// corporation, so they are told. The client template renders only the
// corporation name (from corpID), matching CharLeftCorpMsg/CorpTaxChangeMsg, so
// corpID is the sole data field and the corporation is the sender.
function notifyCorporationMemberKicked(corporationID, characterID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCorporationID || !numericCharacterID) {
    return null;
  }
  return createNotification(numericCharacterID, {
    typeID: NOTIFICATION_TYPE.CORP_KICKED,
    senderID: numericCorporationID,
    groupID: NOTIFICATION_GROUP.CORP,
    processed: false,
    data: { corpID: numericCorporationID },
  });
}

// CharLeftCorpMsg (typeID 21): a character left a corporation, so the corp's
// recruiters (CEO + directors + personnel managers — the same audience told when
// a character applies) are notified. The client renders the corporation name from
// corpID and the departing character from the sender, so the data is
// { charID, corpID } and the departing character is the sender. Only player
// corporations have leadership to notify; departures from NPC corporations
// (whose IDs fall below the custom-corporation range) are skipped.
function notifyCorporationMemberLeft(corporationID, characterID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCorporationID || !numericCharacterID) {
    return [];
  }
  if (numericCorporationID < CUSTOM_CORPORATION_ID_START) {
    return [];
  }
  const data = {
    charID: numericCharacterID,
    corpID: numericCorporationID,
  };
  const delivered = [];
  for (const recipientID of resolveApplicationRecipientIDs(numericCorporationID)) {
    if (recipientID === numericCharacterID) {
      continue;
    }
    const result = createNotification(recipientID, {
      typeID: NOTIFICATION_TYPE.CHAR_LEFT_CORP,
      senderID: numericCharacterID,
      groupID: NOTIFICATION_GROUP.CORP,
      processed: false,
      data,
    });
    if (result && result.success) {
      delivered.push(recipientID);
    }
  }
  return delivered;
}

// CorpDividendMsg (typeID 23): a corporation paid a dividend to a character
// recipient. The client formatter (ParamFmtCorpDividendNotification) renders the
// corporation name from corpID and selects the member vs shareholder body via the
// `isMembers` flag, so the data is { corpID, isMembers, amount }; the corporation
// is the sender and the row lives in the CORP group.
function notifyCorporationDividendPaid(corporationID, characterID, amount, isMembers) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCorporationID || !numericCharacterID) {
    return null;
  }
  return createNotification(numericCharacterID, {
    typeID: NOTIFICATION_TYPE.CORP_DIVIDEND,
    senderID: numericCorporationID,
    groupID: NOTIFICATION_GROUP.CORP,
    processed: false,
    data: {
      corpID: numericCorporationID,
      isMembers: isMembers ? 1 : 0,
      amount: Number(amount) || 0,
    },
  });
}

// CorpVoteCEORevokedMsg (typeID 26): a corporation vote removed the standing CEO,
// so the deposed CEO is told. The client renders only the corporation name (from
// corpID), so corpID is the sole data field and the corporation is the sender;
// the row lives in the CORP group.
function notifyCorporationCeoRevoked(corporationID, revokedCeoCharacterID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCeoID = normalizePositiveInteger(revokedCeoCharacterID, null);
  if (!numericCorporationID || !numericCeoID) {
    return null;
  }
  return createNotification(numericCeoID, {
    typeID: NOTIFICATION_TYPE.CORP_VOTE_CEO_REVOKED,
    senderID: numericCorporationID,
    groupID: NOTIFICATION_GROUP.CORP,
    processed: false,
    data: { corpID: numericCorporationID },
  });
}

module.exports = {
  notifyCorporationCeoRevoked,
  notifyCorporationDividendPaid,
  notifyCorporationMemberKicked,
  notifyCorporationMemberLeft,
  notifyCorporationMembers,
  notifyCorporationNewCeo,
  notifyCorporationTaxRateChanged,
};
