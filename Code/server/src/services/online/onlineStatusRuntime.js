const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

function normalizeCharacterID(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function getSessionCharacterID(session) {
  return normalizeCharacterID(
    session &&
      (session.characterID ||
        session.charID ||
        session.charid ||
        session.userid),
  );
}

function getPersonalContact(record, contactID) {
  const normalizedContactID = normalizeCharacterID(contactID);
  if (!record || !normalizedContactID) {
    return null;
  }
  const contacts =
    record.personalContacts && typeof record.personalContacts === "object"
      ? record.personalContacts
      : {};
  return contacts[String(normalizedContactID)] || null;
}

function isWatchlistContact(observerID, targetID) {
  const observerRecord = getCharacterRecord(observerID);
  const contact = getPersonalContact(observerRecord, targetID);
  return Boolean(contact && contact.inWatchlist);
}

function canObserveOnlineStatus(observerID, targetID) {
  const normalizedObserverID = normalizeCharacterID(observerID);
  const normalizedTargetID = normalizeCharacterID(targetID);
  if (!normalizedObserverID || !normalizedTargetID) {
    return false;
  }
  if (normalizedObserverID === normalizedTargetID) {
    return true;
  }

  return (
    isWatchlistContact(normalizedObserverID, normalizedTargetID) &&
    isWatchlistContact(normalizedTargetID, normalizedObserverID)
  );
}

function isCharacterOnline(targetID, observerID = null) {
  const normalizedTargetID = normalizeCharacterID(targetID);
  if (!normalizedTargetID) {
    return false;
  }
  const normalizedObserverID = normalizeCharacterID(observerID);
  if (
    normalizedObserverID &&
    !canObserveOnlineStatus(normalizedObserverID, normalizedTargetID)
  ) {
    return false;
  }

  return Boolean(sessionRegistry.findSessionByCharacterID(normalizedTargetID));
}

function listInitialOnlineStatusRows(observerID) {
  const normalizedObserverID = normalizeCharacterID(observerID);
  const observerRecord = getCharacterRecord(normalizedObserverID) || {};
  const contacts =
    observerRecord.personalContacts &&
    typeof observerRecord.personalContacts === "object"
      ? observerRecord.personalContacts
      : {};
  const rows = [];

  for (const [rawContactID, contact] of Object.entries(contacts)) {
    const contactID = normalizeCharacterID(
      contact && contact.contactID !== undefined ? contact.contactID : rawContactID,
    );
    if (!contactID || !contact || !contact.inWatchlist) {
      continue;
    }
    rows.push([
      contactID,
      isCharacterOnline(contactID, normalizedObserverID),
    ]);
  }

  return rows.sort((left, right) => Number(left[0]) - Number(right[0]));
}

function notifyCharacterOnlineState(characterID, online, options = {}) {
  const normalizedCharacterID = normalizeCharacterID(characterID);
  if (!normalizedCharacterID) {
    return 0;
  }
  const excludedSession = options.excludeSession || null;
  const notificationName = online ? "OnContactLoggedOn" : "OnContactLoggedOff";
  let sent = 0;

  for (const session of sessionRegistry.getSessions()) {
    if (session === excludedSession) {
      continue;
    }
    const observerID = getSessionCharacterID(session);
    if (!canObserveOnlineStatus(observerID, normalizedCharacterID)) {
      continue;
    }
    if (typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification(notificationName, "clientID", [normalizedCharacterID]);
    sent += 1;
  }

  return sent;
}

module.exports = {
  canObserveOnlineStatus,
  getSessionCharacterID,
  isCharacterOnline,
  listInitialOnlineStatusRows,
  notifyCharacterOnlineState,
};
