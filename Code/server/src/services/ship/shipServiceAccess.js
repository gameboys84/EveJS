const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const { ITEM_FLAGS } = require(path.join(__dirname, "../inventory/itemStore"));
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function firstBooleanValue(values, fallback = false) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return Boolean(value);
    }
  }
  return Boolean(fallback);
}

function normalizeShipConfiguration(rawConfiguration = {}) {
  const raw = rawConfiguration && typeof rawConfiguration === "object"
    ? rawConfiguration
    : {};
  const smbFleetAccess = firstBooleanValue([
    raw.SMB_AllowFleetAccess,
    raw.allowFleetSMBUsage,
    raw.FleetHangar_AllowFleetAccess,
  ]);
  const smbCorpAccess = firstBooleanValue([
    raw.SMB_AllowCorpAccess,
    raw.allowCorpSMBUsage,
    raw.FleetHangar_AllowCorpAccess,
  ]);
  const fleetHangarFleetAccess = firstBooleanValue([
    raw.FleetHangar_AllowFleetAccess,
    raw.allowFleetHangarUsage,
    raw.SMB_AllowFleetAccess,
    raw.allowFleetSMBUsage,
  ]);
  const fleetHangarCorpAccess = firstBooleanValue([
    raw.FleetHangar_AllowCorpAccess,
    raw.allowCorpFleetHangarUsage,
    raw.SMB_AllowCorpAccess,
    raw.allowCorpSMBUsage,
  ]);

  return {
    allowFleetSMBUsage: smbFleetAccess,
    allowCorpSMBUsage: smbCorpAccess,
    SMB_AllowFleetAccess: smbFleetAccess,
    SMB_AllowCorpAccess: smbCorpAccess,
    FleetHangar_AllowFleetAccess: fleetHangarFleetAccess,
    FleetHangar_AllowCorpAccess: fleetHangarCorpAccess,
  };
}

function isShipServiceFlag(flagID) {
  const numericFlagID = toInt(flagID, 0);
  return (
    numericFlagID === ITEM_FLAGS.SHIP_HANGAR ||
    numericFlagID === ITEM_FLAGS.FLEET_HANGAR
  );
}

function getSessionCharacterID(session) {
  return toInt(
    session && (
      session.characterID ??
      session.charid
    ),
    0,
  );
}

function getSessionCorporationID(session) {
  return toInt(
    session && (
      session.corporationID ??
      session.corpid
    ),
    0,
  );
}

function getOwnerCorporationID(ownerID) {
  const numericOwnerID = toInt(ownerID, 0);
  if (numericOwnerID <= 0) {
    return 0;
  }

  const characterResult = database.read("characters", `/${numericOwnerID}`);
  const ownerCharacter =
    characterResult &&
    characterResult.success &&
    characterResult.data &&
    typeof characterResult.data === "object"
      ? characterResult.data
      : null;
  return toInt(
    ownerCharacter && (
      ownerCharacter.corporationID ??
      ownerCharacter.corpid
    ),
    numericOwnerID,
  );
}

function isPilotInSameFleetAsOwner(session, ownerID) {
  const characterID = getSessionCharacterID(session);
  const numericOwnerID = toInt(ownerID, 0);
  if (characterID <= 0 || numericOwnerID <= 0 || characterID === numericOwnerID) {
    return characterID > 0 && characterID === numericOwnerID;
  }

  const callerFleet = fleetRuntime.getFleetForCharacter(characterID);
  return Boolean(
    callerFleet &&
    fleetRuntime.getMemberRecord(callerFleet, numericOwnerID),
  );
}

function canUseShipServiceFlag(session, shipItem, serviceFlag) {
  if (!shipItem || !isShipServiceFlag(serviceFlag)) {
    return true;
  }

  const characterID = getSessionCharacterID(session);
  const ownerID = toInt(shipItem.ownerID, 0);
  if (characterID <= 0 || ownerID <= 0) {
    return false;
  }

  if (characterID === ownerID) {
    return true;
  }

  const callerCorporationID = getSessionCorporationID(session);
  const ownerCorporationID = getOwnerCorporationID(ownerID);
  const inSameCorp =
    callerCorporationID > 0 &&
    ownerCorporationID > 0 &&
    callerCorporationID === ownerCorporationID;
  const inSameFleet = isPilotInSameFleetAsOwner(session, ownerID);
  if (!inSameCorp && !inSameFleet) {
    return false;
  }

  const config = normalizeShipConfiguration(shipItem.shipConfiguration || {});
  const numericFlagID = toInt(serviceFlag, 0);
  if (numericFlagID === ITEM_FLAGS.FLEET_HANGAR) {
    return (
      (config.FleetHangar_AllowCorpAccess && inSameCorp) ||
      (config.FleetHangar_AllowFleetAccess && inSameFleet)
    );
  }
  if (numericFlagID === ITEM_FLAGS.SHIP_HANGAR) {
    return (
      (config.SMB_AllowCorpAccess && inSameCorp) ||
      (config.SMB_AllowFleetAccess && inSameFleet)
    );
  }

  return false;
}

function validateShipServiceAccess(session, shipItem, serviceFlag) {
  if (canUseShipServiceFlag(session, shipItem, serviceFlag)) {
    return { success: true };
  }

  return {
    success: false,
    errorMsg: "SHIP_SERVICE_ACCESS_DENIED",
  };
}

module.exports = {
  normalizeShipConfiguration,
  isShipServiceFlag,
  canUseShipServiceFlag,
  validateShipServiceAccess,
};
