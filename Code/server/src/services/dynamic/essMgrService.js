const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const dynamicResourceState = require(path.join(
  __dirname,
  "./dynamicResourceState",
));
const { buildDict } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  matchesTypeList,
} = require(path.join(__dirname, "../inventory/typeListAuthority"));

const ESS_LINKABLE_TYPES_LIST = 231;
const ESS_MAX_LINK_DISTANCE_METERS = 10_000;

function getCharacterID(session = null) {
  return Number(session && (session.characterID || session.charid)) || 0;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toReal(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getSessionShipID(session = null) {
  return toInt(
    session && (
      (session._space && session._space.shipID) ||
      session.shipID ||
      session.shipid ||
      session.activeShipID
    ),
    0,
  );
}

function hasSpaceValidationContext(session = null) {
  return Boolean(session && session._space && getSessionShipID(session) > 0);
}

function getEntityPosition(entity = null) {
  const source =
    entity && entity.position ||
    entity && entity.spaceState && entity.spaceState.position ||
    null;
  if (
    !source ||
    !Number.isFinite(Number(source.x)) ||
    !Number.isFinite(Number(source.y)) ||
    !Number.isFinite(Number(source.z))
  ) {
    return null;
  }
  return {
    x: toReal(source.x, 0),
    y: toReal(source.y, 0),
    z: toReal(source.z, 0),
  };
}

function getDistance(left = null, right = null) {
  const leftPosition = getEntityPosition(left);
  const rightPosition = getEntityPosition(right);
  if (!leftPosition || !rightPosition) {
    return Infinity;
  }
  const dx = leftPosition.x - rightPosition.x;
  const dy = leftPosition.y - rightPosition.y;
  const dz = leftPosition.z - rightPosition.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function buildTypeContext(entity = null) {
  return {
    typeID: toInt(entity && entity.typeID, 0),
    groupID: toInt(entity && entity.groupID, 0),
    categoryID: toInt(entity && entity.categoryID, 0),
  };
}

function validateExistingBankLinks(state, characterID, bankName) {
  if (!state || !toInt(state.essID, 0)) {
    return "LINK_ERROR_SYSTEM_OFFLINE";
  }
  if (bankName === "main") {
    if (state.reserveLinkedCharacterIDs.has(characterID)) {
      return "LINK_ERROR_ALREADY_LINKED";
    }
    if (state.mainBankLink) {
      return state.mainBankLink.characterID === characterID
        ? "LINK_ERROR_ALREADY_LINKED"
        : "LINK_ERROR_LINK_OCCUPIED";
    }
  }
  if (bankName === "reserve") {
    if (state.mainBankLink && state.mainBankLink.characterID === characterID) {
      return "LINK_ERROR_ALREADY_LINKED";
    }
    if (state.reserveLinkedCharacterIDs.has(characterID)) {
      return "LINK_ERROR_ALREADY_LINKED";
    }
  }
  return null;
}

function validateEssLinkEligibility(session, state, bankName) {
  const characterID = getCharacterID(session);
  if (!characterID) {
    return "LINK_ERROR_NO_BALLPARK";
  }

  const existingLinkError = validateExistingBankLinks(state, characterID, bankName);
  if (existingLinkError) {
    return existingLinkError;
  }

  if (!hasSpaceValidationContext(session)) {
    return null;
  }

  const scene = spaceRuntime.getSceneForSession(session);
  if (!scene || typeof scene.getEntityByID !== "function") {
    return "LINK_ERROR_NO_BALLPARK";
  }

  const shipEntity = scene.getEntityByID(getSessionShipID(session));
  if (!shipEntity || shipEntity.kind !== "ship") {
    return "LINK_ERROR_INVALID_SHIP_TYPE";
  }
  if (!matchesTypeList(buildTypeContext(shipEntity), ESS_LINKABLE_TYPES_LIST)) {
    return "LINK_ERROR_INVALID_SHIP_TYPE";
  }

  const essEntity = scene.getEntityByID(state.essID);
  if (!essEntity) {
    return "LINK_ERROR_NOT_ON_GRID";
  }

  if (getDistance(shipEntity, essEntity) > ESS_MAX_LINK_DISTANCE_METERS) {
    return "LINK_ERROR_OUT_OF_RANGE";
  }
  return null;
}

function notify(session, name, payload) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification(name, "clientID", payload);
}

function notifyEssDataChanged(session, state) {
  if (!state) {
    return;
  }
  notify(session, "OnSystemESSDataChanged", [
    state.solarSystemID,
    dynamicResourceState.buildEssDataPayload(state),
  ]);
}

function buildMainBankDisconnectedPayload(state, link) {
  return buildDict([
    ["solarSystemID", state ? state.solarSystemID : 0],
    ["linkID", link ? link.linkID : ""],
    ["characterID", link ? link.characterID : 0],
    ["reason", dynamicResourceState.UNLINKED_MANUAL],
  ]);
}

function buildReserveBankDisconnectedPayload(state, characterID) {
  return buildDict([
    ["solarSystemID", state ? state.solarSystemID : 0],
    ["characterID", characterID || 0],
    ["reason", dynamicResourceState.UNLINKED_MANUAL],
  ]);
}

class EssMgrService extends BaseService {
  constructor() {
    super("essMgr");
  }

  Handle_GetDataForClientSolarSystem(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromArgsOrSession(
      args,
      session,
    );
    log.debug(`[EssMgr] GetDataForClientSolarSystem solarsystemid=${solarSystemID}`);
    return dynamicResourceState.buildEssDataPayload(
      dynamicResourceState.getSystemState(solarSystemID),
    );
  }

  Handle_IsClientLinkedToReserveBank(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromSession(session);
    const characterID = getCharacterID(session);
    return dynamicResourceState.isCharacterLinkedToReserveBank(
      solarSystemID,
      characterID,
    );
  }

  Handle_AttemptLinkToMainBank(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromSession(session);
    const characterID = getCharacterID(session);
    const state = dynamicResourceState.getSystemState(solarSystemID);
    const validationError = validateEssLinkEligibility(session, state, "main");
    if (validationError) {
      log.debug(
        `[EssMgr] AttemptLinkToMainBank rejected solarsystemid=${solarSystemID} characterID=${characterID} reason=${validationError}`,
      );
      return null;
    }
    const result = dynamicResourceState.attemptMainBankLink(
      solarSystemID,
      characterID,
    );
    log.debug(
      `[EssMgr] AttemptLinkToMainBank solarsystemid=${solarSystemID} characterID=${characterID} success=${result.success}`,
    );
    if (result.success) {
      notify(session, "OnESSMainBankLinkNotification", [solarSystemID]);
      notifyEssDataChanged(session, result.state);
    }
    return null;
  }

  Handle_AttemptLinkToReserveBank(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromSession(session);
    const characterID = getCharacterID(session);
    const state = dynamicResourceState.getSystemState(solarSystemID);
    const validationError = validateEssLinkEligibility(session, state, "reserve");
    if (validationError) {
      log.debug(
        `[EssMgr] AttemptLinkToReserveBank rejected solarsystemid=${solarSystemID} characterID=${characterID} reason=${validationError}`,
      );
      return null;
    }
    const result = dynamicResourceState.attemptReserveBankLink(
      solarSystemID,
      characterID,
    );
    log.debug(
      `[EssMgr] AttemptLinkToReserveBank solarsystemid=${solarSystemID} characterID=${characterID} success=${result.success}`,
    );
    if (result.success) {
      notify(session, "OnESSReserveBankLinkNotification", [solarSystemID]);
      notifyEssDataChanged(session, result.state);
    }
    return null;
  }

  Handle_RequestMainBankUnlink(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromSession(session);
    const result = dynamicResourceState.requestMainBankUnlink(solarSystemID);
    log.debug(
      `[EssMgr] RequestMainBankUnlink solarsystemid=${solarSystemID} success=${result.success}`,
    );
    if (result.success) {
      notify(session, "OnMainBankPlayerLinkDisconnected", [
        buildMainBankDisconnectedPayload(result.state, result.link),
      ]);
      notifyEssDataChanged(session, result.state);
    }
    return null;
  }

  Handle_RequestReserveBankUnlink(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromSession(session);
    const characterID = getCharacterID(session);
    const result = dynamicResourceState.requestReserveBankUnlink(
      solarSystemID,
      characterID,
    );
    log.debug(
      `[EssMgr] RequestReserveBankUnlink solarsystemid=${solarSystemID} characterID=${characterID} success=${result.success}`,
    );
    if (result.success) {
      notify(session, "OnReserveBankPlayerLinkDisconnected", [
        buildReserveBankDisconnectedPayload(result.state, characterID),
      ]);
      notifyEssDataChanged(session, result.state);
    }
    return null;
  }

  Handle_RequestUnlockReserveBank(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromSession(session);
    const keyTypeID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const result = dynamicResourceState.unlockReserveBank(
      solarSystemID,
      keyTypeID,
    );
    log.debug(
      `[EssMgr] RequestUnlockReserveBank solarsystemid=${solarSystemID} keyTypeID=${keyTypeID} success=${result.success}`,
    );
    if (result.success) {
      notifyEssDataChanged(session, result.state);
    }
    return null;
  }

  Handle_GetMainBankTheftsForClientSolarSystem(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromArgsOrSession(
      args,
      session,
    );
    const state = dynamicResourceState.getSystemState(solarSystemID);
    return dynamicResourceState.buildTheftHistoryPayload(
      state ? state.theftHistoryMain : [],
    );
  }

  Handle_GetReserveBankTheftsForClientSolarSystem(args, session) {
    const solarSystemID = dynamicResourceState.getSystemIDFromArgsOrSession(
      args,
      session,
    );
    const state = dynamicResourceState.getSystemState(solarSystemID);
    return dynamicResourceState.buildTheftHistoryPayload(
      state ? state.theftHistoryReserve : [],
    );
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[EssMgr] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = EssMgrService;
module.exports._testing = {
  ESS_LINKABLE_TYPES_LIST,
  ESS_MAX_LINK_DISTANCE_METERS,
  validateEssLinkEligibility,
};
