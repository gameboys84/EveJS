const path = require("path");

const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  getAllianceCorporationIDs,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  listCorporationMembers,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));

function toPositiveInteger(value) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function toPositiveAmount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

// Every BountyPlaced* notification renders the same two data fields and is
// delivered in the BOUNTIES group with the placer as the sender.
function deliverBountyPlaced(receiverID, typeID, placerID, amount) {
  return createNotification(receiverID, {
    typeID,
    senderID: placerID,
    groupID: NOTIFICATION_GROUP.BOUNTIES,
    processed: false,
    data: {
      bountyPlacerID: placerID,
      bounty: amount,
    },
  });
}

// Fan a corp/alliance bounty out to each member character, deduped, skipping the
// placer if they happen to be a member.
function notifyBountyPlacedOnMembers(typeID, characterIDs, bountyPlacerID, amount) {
  const numericPlacerID = toPositiveInteger(bountyPlacerID);
  const numericAmount = toPositiveAmount(amount);
  if (!numericPlacerID || numericAmount <= 0) {
    return [];
  }
  const delivered = [];
  const seen = new Set();
  for (const characterID of characterIDs) {
    const numericCharacterID = toPositiveInteger(characterID);
    if (
      !numericCharacterID ||
      numericCharacterID === numericPlacerID ||
      seen.has(numericCharacterID)
    ) {
      continue;
    }
    seen.add(numericCharacterID);
    const result = deliverBountyPlaced(
      numericCharacterID,
      typeID,
      numericPlacerID,
      numericAmount,
    );
    if (result && result.success) {
      delivered.push(numericCharacterID);
    }
  }
  return delivered;
}

// BountyPlacedChar (typeID 112): a player placed (or added to) a bounty on a
// character, so the target is notified ("BountyPlacedOnYou") of who placed it
// and how much. The client renders bountyPlacerID and bounty straight from the
// data, so those are the data fields and the placer is the sender.
function notifyBountyPlacedOnCharacter({ targetID, bountyPlacerID, amount } = {}) {
  const numericTargetID = toPositiveInteger(targetID);
  const numericPlacerID = toPositiveInteger(bountyPlacerID);
  const numericAmount = toPositiveAmount(amount);
  // A bounty placed on yourself (or with no resolvable placer/amount) produces
  // no notification.
  if (
    !numericTargetID ||
    !numericPlacerID ||
    numericAmount <= 0 ||
    numericTargetID === numericPlacerID
  ) {
    return null;
  }
  return deliverBountyPlaced(
    numericTargetID,
    NOTIFICATION_TYPE.BOUNTY_PLACED_CHAR,
    numericPlacerID,
    numericAmount,
  );
}

// BountyPlacedCorp (typeID 113): a bounty was placed on a corporation, so every
// member is told ("BountyPlacedOnCorporation"). Same data/sender as the char
// case, fanned out to the corp's members.
function notifyBountyPlacedOnCorporation({ targetID, bountyPlacerID, amount } = {}) {
  const numericTargetID = toPositiveInteger(targetID);
  if (!numericTargetID) {
    return [];
  }
  return notifyBountyPlacedOnMembers(
    NOTIFICATION_TYPE.BOUNTY_PLACED_CORP,
    listCorporationMembers(numericTargetID).map((member) => member && member.characterID),
    bountyPlacerID,
    amount,
  );
}

// BountyPlacedAlliance (typeID 114): a bounty was placed on an alliance, so
// every member of every member corporation is told
// ("BountyPlacedOnAlliance").
function notifyBountyPlacedOnAlliance({ targetID, bountyPlacerID, amount } = {}) {
  const numericTargetID = toPositiveInteger(targetID);
  if (!numericTargetID) {
    return [];
  }
  const characterIDs = [];
  for (const corporationID of getAllianceCorporationIDs(numericTargetID)) {
    for (const member of listCorporationMembers(corporationID)) {
      characterIDs.push(member && member.characterID);
    }
  }
  return notifyBountyPlacedOnMembers(
    NOTIFICATION_TYPE.BOUNTY_PLACED_ALLIANCE,
    characterIDs,
    bountyPlacerID,
    amount,
  );
}

module.exports = {
  notifyBountyPlacedOnAlliance,
  notifyBountyPlacedOnCharacter,
  notifyBountyPlacedOnCorporation,
};
