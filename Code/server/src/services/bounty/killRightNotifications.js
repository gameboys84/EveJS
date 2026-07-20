const path = require("path");

const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));

function toPositiveInteger(value) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function toNonNegativeAmount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

// KillRightEarned (typeID 117): criminal aggression granted the victim a kill
// right against the aggressor, so the victim ("KillRightEarned") is told. The
// client renders only charName from charID (the aggressor), so charID is the
// sole data field and the aggressor is the sender. Kill-right notifications live
// in the MISC group.
function notifyKillRightEarned({ ownerID, targetID } = {}) {
  const numericOwnerID = toPositiveInteger(ownerID);
  const numericTargetID = toPositiveInteger(targetID);
  if (!numericOwnerID || !numericTargetID || numericOwnerID === numericTargetID) {
    return null;
  }
  return createNotification(numericOwnerID, {
    typeID: NOTIFICATION_TYPE.KILL_RIGHT_EARNED,
    senderID: numericTargetID,
    groupID: NOTIFICATION_GROUP.MISC,
    processed: false,
    data: {
      charID: numericTargetID,
    },
  });
}

// KillRightUsed (typeID 118): a third party (a buyer of the kill right) used the
// owner's kill right against the target, so the owner ("KillRightUsed") is told.
// The client renders only charName from charID (the target the right was against),
// so charID is the sole data field and the target is the sender. Kill-right
// notifications live in the MISC group.
function notifyKillRightUsed({ ownerID, targetID } = {}) {
  const numericOwnerID = toPositiveInteger(ownerID);
  const numericTargetID = toPositiveInteger(targetID);
  if (!numericOwnerID || !numericTargetID || numericOwnerID === numericTargetID) {
    return null;
  }
  return createNotification(numericOwnerID, {
    typeID: NOTIFICATION_TYPE.KILL_RIGHT_USED,
    senderID: numericTargetID,
    groupID: NOTIFICATION_GROUP.MISC,
    processed: false,
    data: {
      charID: numericTargetID,
    },
  });
}

// KillRightAvailable (115) / KillRightAvailableOpen (116): the owner listed a
// kill right for sale, so the *target* is told (CCP confirms the target of a
// kill right is notified when it goes up for sale, so they can buy it back). A
// restricted sale (toEntityID set) uses 115 and carries the entity it is offered
// to; an open sale uses 116. The client renders charName from charID (the owner,
// the other party) and the price, so charID/price are the data fields, the owner
// is the sender, and the row is in the MISC group.
function notifyKillRightAvailable({ targetID, ownerID, price, toEntityID } = {}) {
  const numericTargetID = toPositiveInteger(targetID);
  const numericOwnerID = toPositiveInteger(ownerID);
  if (!numericTargetID || !numericOwnerID || numericTargetID === numericOwnerID) {
    return null;
  }
  const numericToEntityID = toPositiveInteger(toEntityID);
  const isRestricted = numericToEntityID > 0;
  const data = {
    charID: numericOwnerID,
    price: toNonNegativeAmount(price),
  };
  if (isRestricted) {
    data.toEntityID = numericToEntityID;
  }
  return createNotification(numericTargetID, {
    typeID: isRestricted
      ? NOTIFICATION_TYPE.KILL_RIGHT_AVAILABLE
      : NOTIFICATION_TYPE.KILL_RIGHT_AVAILABLE_OPEN,
    senderID: numericOwnerID,
    groupID: NOTIFICATION_GROUP.MISC,
    processed: false,
    data,
  });
}

// KillRightUnavailable (119) / KillRightUnavailableOpen (120): the owner withdrew
// a kill right that had been listed for sale, so the target is told it is no
// longer available (to buy back). A previously-restricted sale uses 119 and
// carries toEntityID; a previously-open sale uses 120. As with the available
// pair, the client renders charName from charID (the owner), so charID (and
// toEntityID when restricted) are the data fields, the owner is the sender, and
// the row is in the MISC group.
function notifyKillRightUnavailable({ targetID, ownerID, toEntityID } = {}) {
  const numericTargetID = toPositiveInteger(targetID);
  const numericOwnerID = toPositiveInteger(ownerID);
  if (!numericTargetID || !numericOwnerID || numericTargetID === numericOwnerID) {
    return null;
  }
  const numericToEntityID = toPositiveInteger(toEntityID);
  const isRestricted = numericToEntityID > 0;
  const data = { charID: numericOwnerID };
  if (isRestricted) {
    data.toEntityID = numericToEntityID;
  }
  return createNotification(numericTargetID, {
    typeID: isRestricted
      ? NOTIFICATION_TYPE.KILL_RIGHT_UNAVAILABLE
      : NOTIFICATION_TYPE.KILL_RIGHT_UNAVAILABLE_OPEN,
    senderID: numericOwnerID,
    groupID: NOTIFICATION_GROUP.MISC,
    processed: false,
    data,
  });
}

module.exports = {
  notifyKillRightAvailable,
  notifyKillRightEarned,
  notifyKillRightUnavailable,
  notifyKillRightUsed,
};
