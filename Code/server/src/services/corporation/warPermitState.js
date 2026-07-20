const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));

function getCorporationState() {
  return require(path.join(__dirname, "./corporationState"));
}

function getNotificationState() {
  return require(path.join(__dirname, "../notifications/notificationState"));
}

function normalizeOwnerID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function getCorporationWarPermitStatus(corporationID) {
  const numericCorporationID = normalizeOwnerID(corporationID);
  if (!numericCorporationID) {
    return 0;
  }

  const { getCorporationRecord } = getCorporationState();
  const corporation = getCorporationRecord(numericCorporationID);
  if (!corporation) {
    return 0;
  }

  if (
    Object.prototype.hasOwnProperty.call(corporation, "allowWar") &&
    corporation.allowWar !== undefined &&
    corporation.allowWar !== null
  ) {
    return corporation.allowWar ? 1 : 0;
  }

  return corporation.isNPC ? 0 : 1;
}

function getWarPermitStatusForOwner(ownerID) {
  const numericOwnerID = normalizeOwnerID(ownerID);
  if (!numericOwnerID) {
    return 0;
  }

  const {
    getAllianceRecord,
    getCorporationRecord,
  } = getCorporationState();
  if (getCorporationRecord(numericOwnerID)) {
    return getCorporationWarPermitStatus(numericOwnerID);
  }

  const alliance = getAllianceRecord(numericOwnerID);
  if (!alliance) {
    return 0;
  }

  return getCorporationWarPermitStatus(alliance.executorCorporationID);
}

function notifyWarPermitStatusChanged(corporationID, allowWar) {
  const numericCorporationID = normalizeOwnerID(corporationID);
  if (!numericCorporationID) {
    return [];
  }
  const {
    getCharacterIDsInCorporation,
  } = getCorporationState();
  const typeID = allowWar
    ? NOTIFICATION_TYPE.CORP_BECAME_WAR_ELIGIBLE
    : NOTIFICATION_TYPE.CORP_NOT_LONGER_WAR_ELIGIBLE;
  const {
    createNotification,
  } = getNotificationState();
  const results = [];
  for (const characterID of getCharacterIDsInCorporation(numericCorporationID)) {
    results.push(createNotification(characterID, {
      typeID,
      senderID: numericCorporationID,
      groupID: NOTIFICATION_GROUP.WAR,
      processed: false,
      data: {},
    }));
  }
  for (const session of sessionRegistry.getSessions()) {
    if (
      Number(session && (session.corporationID || session.corpid)) !==
      numericCorporationID
    ) {
      continue;
    }
    if (typeof session.sendNotification === "function") {
      session.sendNotification("OnAllowWarUpdated", "clientID", [
        numericCorporationID,
        allowWar ? 1 : 0,
      ]);
    }
  }
  return results;
}

function setCorporationWarPermitStatus(corporationID, allowWar) {
  const numericCorporationID = normalizeOwnerID(corporationID);
  if (!numericCorporationID) {
    return {
      success: false,
      errorMsg: "CORPORATION_ID_REQUIRED",
    };
  }
  const corporationState = getCorporationState();
  const corporation = corporationState.getCorporationRecord(numericCorporationID);
  if (!corporation) {
    return {
      success: false,
      errorMsg: "CORPORATION_NOT_FOUND",
    };
  }
  const previousStatus = getCorporationWarPermitStatus(numericCorporationID);
  const nextAllowWar = Boolean(allowWar);
  const result = corporationState.setCorporationRecord({
    ...corporation,
    allowWar: nextAllowWar,
  });
  if (!result || !result.success) {
    return result;
  }
  const nextStatus = getCorporationWarPermitStatus(numericCorporationID);
  if (Number(previousStatus) !== Number(nextStatus)) {
    notifyWarPermitStatusChanged(numericCorporationID, nextStatus === 1);
  }
  return {
    success: true,
    data: {
      corporationID: numericCorporationID,
      allowWar: nextStatus,
    },
  };
}

module.exports = {
  getCorporationWarPermitStatus,
  getWarPermitStatusForOwner,
  notifyWarPermitStatusChanged,
  setCorporationWarPermitStatus,
};
