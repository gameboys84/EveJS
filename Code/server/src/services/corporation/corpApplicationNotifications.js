const path = require("path");

const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  getCorporationInfoRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  CORP_ROLE_DIRECTOR,
  listCorporationMembers,
  normalizePositiveInteger,
  normalizeText,
  toRoleMaskBigInt,
} = require(path.join(__dirname, "./corporationRuntimeState"));

// Personnel managers (corpRolePersonnelManager) and directors process membership
// applications, so they receive the "new application" notification alongside the CEO.
const CORP_ROLE_PERSONNEL_MANAGER = 128n;

function buildApplicationNotificationData(corporationID, characterID, extra = {}) {
  return {
    charID: normalizePositiveInteger(characterID, 0) || 0,
    corpID: normalizePositiveInteger(corporationID, 0) || 0,
    ...extra,
  };
}

function memberCanProcessApplications(member) {
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

// CEO plus any member holding the director or personnel-manager role.
function resolveApplicationRecipientIDs(corporationID) {
  const recipientIDs = new Set();
  const info = getCorporationInfoRecord(corporationID);
  const ceoID = normalizePositiveInteger(info && info.ceoID, null);
  if (ceoID) {
    recipientIDs.add(ceoID);
  }
  for (const member of listCorporationMembers(corporationID)) {
    const characterID = normalizePositiveInteger(member && member.characterID, null);
    if (!characterID || !memberCanProcessApplications(member)) {
      continue;
    }
    recipientIDs.add(characterID);
  }
  return [...recipientIDs];
}

function deliverCorpAppNotification(characterID, typeID, senderID, data) {
  return createNotification(characterID, {
    typeID,
    senderID: normalizePositiveInteger(senderID, 0) || 0,
    groupID: NOTIFICATION_GROUP.CORP,
    processed: false,
    data,
  });
}

// Fan a single application-lifecycle event out to every recruiter (CEO/director/
// personnel manager) of the corporation, with the applicant as the sender and
// excluded from the recipients. Shared by every recruiter-facing application
// notification (new/withdraw/accept-by-character/reject-by-character).
function notifyApplicationRecruiters(corporationID, characterID, typeID, applicationText = "") {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCorporationID || !numericCharacterID) {
    return [];
  }
  const data = buildApplicationNotificationData(numericCorporationID, numericCharacterID, {
    applicationText: normalizeText(applicationText, ""),
  });
  const delivered = [];
  for (const recipientID of resolveApplicationRecipientIDs(numericCorporationID)) {
    if (recipientID === numericCharacterID) {
      continue;
    }
    const result = deliverCorpAppNotification(
      recipientID,
      typeID,
      numericCharacterID,
      data,
    );
    if (result && result.success) {
      delivered.push(recipientID);
    }
  }
  return delivered;
}

// CorpAppNewMsg (typeID 16): a character applied to the corporation, so each
// recruiter (CEO/director/personnel manager) is notified of the new application.
function notifyCorporationApplicationReceived(corporationID, characterID, applicationText = "") {
  return notifyApplicationRecruiters(
    corporationID,
    characterID,
    NOTIFICATION_TYPE.CORP_APP_NEW,
    applicationText,
  );
}

// CharAppWithdrawMsg (typeID 130): the applicant withdrew a still-pending
// application, so each recruiter who could have processed it is notified that it
// is gone.
function notifyCorporationApplicationWithdrawn(corporationID, characterID, applicationText = "") {
  return notifyApplicationRecruiters(
    corporationID,
    characterID,
    NOTIFICATION_TYPE.CHAR_APP_WITHDRAW,
    applicationText,
  );
}

// CharAppAcceptMsg (typeID 128): the character accepted the corporation's
// invitation (and is joining), so each recruiter is notified of the acceptance.
function notifyCorporationApplicationAcceptedByCharacter(corporationID, characterID, applicationText = "") {
  return notifyApplicationRecruiters(
    corporationID,
    characterID,
    NOTIFICATION_TYPE.CHAR_APP_ACCEPT,
    applicationText,
  );
}

// CharAppRejectMsg (typeID 129): the character declined the corporation's
// invitation, so each recruiter is notified of the rejection.
function notifyCorporationApplicationRejectedByCharacter(corporationID, characterID, applicationText = "") {
  return notifyApplicationRecruiters(
    corporationID,
    characterID,
    NOTIFICATION_TYPE.CHAR_APP_REJECT,
    applicationText,
  );
}

// CorpAppAcceptMsg (typeID 18): the corporation approved the applicant's request.
function notifyCorporationApplicationAccepted(corporationID, characterID, applicationText = "") {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCorporationID || !numericCharacterID) {
    return null;
  }
  return deliverCorpAppNotification(
    numericCharacterID,
    NOTIFICATION_TYPE.CORP_APP_ACCEPT,
    numericCorporationID,
    buildApplicationNotificationData(numericCorporationID, numericCharacterID, {
      applicationText: normalizeText(applicationText, ""),
    }),
  );
}

// CorpAppRejectMsg (typeID 17) / CorpAppRejectCustomMsg (typeID 142): the
// corporation declined the applicant. A non-empty custom message switches the
// client to the custom-rejection template.
function notifyCorporationApplicationRejected(
  corporationID,
  characterID,
  applicationText = "",
  customMessage = "",
) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCorporationID || !numericCharacterID) {
    return null;
  }
  const normalizedCustomMessage = normalizeText(customMessage, "");
  const extra = { applicationText: normalizeText(applicationText, "") };
  if (normalizedCustomMessage) {
    extra.customMessage = normalizedCustomMessage;
  }
  return deliverCorpAppNotification(
    numericCharacterID,
    normalizedCustomMessage
      ? NOTIFICATION_TYPE.CORP_APP_REJECT_CUSTOM
      : NOTIFICATION_TYPE.CORP_APP_REJECT,
    numericCorporationID,
    buildApplicationNotificationData(numericCorporationID, numericCharacterID, extra),
  );
}

// CorpAppInvitedMsg (typeID 139): the corporation invited the character to join.
function notifyCorporationApplicationInvited(corporationID, characterID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCorporationID || !numericCharacterID) {
    return null;
  }
  return deliverCorpAppNotification(
    numericCharacterID,
    NOTIFICATION_TYPE.CORP_APP_INVITED,
    numericCorporationID,
    buildApplicationNotificationData(numericCorporationID, numericCharacterID),
  );
}

module.exports = {
  notifyCorporationApplicationAccepted,
  notifyCorporationApplicationAcceptedByCharacter,
  notifyCorporationApplicationInvited,
  notifyCorporationApplicationReceived,
  notifyCorporationApplicationRejected,
  notifyCorporationApplicationRejectedByCharacter,
  notifyCorporationApplicationWithdrawn,
  resolveApplicationRecipientIDs,
};
