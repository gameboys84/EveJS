const path = require("path");

const {
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ITEM_FLAGS,
  findShipItemById,
  grantItemToCharacterLocation,
  listContainerItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));

const SHIP_STANCE = Object.freeze({
  DEFENSE: 1,
  SPEED: 2,
  SNIPER: 3,
});

const DEFAULT_STANCE_ID = SHIP_STANCE.DEFENSE;
const STANCE_SWITCH_COOLDOWN_SECONDS = 10;

// Extracted from tools/ClientCodeGrabber/Latest/shipmode/data.py for build 3396210.
const SHIP_STANCE_MODIFIERS_BY_TYPE_ID = Object.freeze({
  34317: Object.freeze({
    [SHIP_STANCE.DEFENSE]: 34319,
    [SHIP_STANCE.SNIPER]: 34321,
    [SHIP_STANCE.SPEED]: 34323,
  }),
  34562: Object.freeze({
    [SHIP_STANCE.DEFENSE]: 34564,
    [SHIP_STANCE.SNIPER]: 34570,
    [SHIP_STANCE.SPEED]: 34566,
  }),
  34828: Object.freeze({
    [SHIP_STANCE.DEFENSE]: 35676,
    [SHIP_STANCE.SNIPER]: 35678,
    [SHIP_STANCE.SPEED]: 35677,
  }),
  35683: Object.freeze({
    [SHIP_STANCE.DEFENSE]: 35686,
    [SHIP_STANCE.SNIPER]: 35688,
    [SHIP_STANCE.SPEED]: 35687,
  }),
  89808: Object.freeze({
    [SHIP_STANCE.DEFENSE]: 90060,
    [SHIP_STANCE.SNIPER]: 90064,
    [SHIP_STANCE.SPEED]: 90062,
  }),
  89807: Object.freeze({
    [SHIP_STANCE.DEFENSE]: 90061,
    [SHIP_STANCE.SNIPER]: 90063,
    [SHIP_STANCE.SPEED]: 90065,
  }),
});

const ALL_STANCE_MODIFIER_TYPE_IDS = Object.freeze(
  [...new Set(
    Object.values(SHIP_STANCE_MODIFIERS_BY_TYPE_ID)
      .flatMap((mapping) => Object.values(mapping).map((typeID) => toInt(typeID, 0))),
  )].sort((left, right) => left - right),
);
const ALL_STANCE_MODIFIER_TYPE_ID_SET = new Set(ALL_STANCE_MODIFIER_TYPE_IDS);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getSessionCharacterID(session) {
  return toInt(
    session && (
      session.characterID ||
      session.charid ||
      session.charID
    ),
    0,
  );
}

function normalizeStanceID(value) {
  return toInt(value, 0);
}

function getShipStanceModifierMap(shipTypeID) {
  return SHIP_STANCE_MODIFIERS_BY_TYPE_ID[toInt(shipTypeID, 0)] || null;
}

function shipHasStances(shipTypeID) {
  return Boolean(getShipStanceModifierMap(shipTypeID));
}

function getModeTypeIDForStance(shipTypeID, stanceID) {
  const mapping = getShipStanceModifierMap(shipTypeID);
  return mapping ? toInt(mapping[normalizeStanceID(stanceID)], 0) : 0;
}

function getStanceIDForModeType(shipTypeID, modeTypeID) {
  const mapping = getShipStanceModifierMap(shipTypeID);
  const normalizedModeTypeID = toInt(modeTypeID, 0);
  if (!mapping || normalizedModeTypeID <= 0) {
    return 0;
  }

  for (const [stanceID, mappedModeTypeID] of Object.entries(mapping)) {
    if (toInt(mappedModeTypeID, 0) === normalizedModeTypeID) {
      return toInt(stanceID, 0);
    }
  }

  return 0;
}

function listShipStanceModifierItems(ownerID, shipID) {
  return listContainerItems(
    toInt(ownerID, 0) > 0 ? toInt(ownerID, 0) : null,
    toInt(shipID, 0),
    ITEM_FLAGS.HIDDEN_MODIFIERS,
  )
    .filter((item) => item && ALL_STANCE_MODIFIER_TYPE_ID_SET.has(toInt(item.typeID, 0)))
    .sort((left, right) => toInt(left.itemID, 0) - toInt(right.itemID, 0));
}

function resolveCurrentShipStance(shipOrID) {
  const shipItem =
    shipOrID && typeof shipOrID === "object"
      ? shipOrID
      : findShipItemById(shipOrID);
  if (!shipItem) {
    return {
      supported: false,
      shipItem: null,
      stanceID: 0,
      modifierTypeID: 0,
      modifierItems: [],
    };
  }

  const shipTypeID = toInt(shipItem.typeID, 0);
  const supported = shipHasStances(shipTypeID);
  if (!supported) {
    return {
      supported: false,
      shipItem,
      stanceID: 0,
      modifierTypeID: 0,
      modifierItems: [],
    };
  }

  const modifierItems = listShipStanceModifierItems(shipItem.ownerID, shipItem.itemID);
  for (const item of modifierItems) {
    const stanceID = getStanceIDForModeType(shipTypeID, item.typeID);
    if (stanceID > 0) {
      return {
        supported: true,
        shipItem,
        stanceID,
        modifierTypeID: toInt(item.typeID, 0),
        modifierItems,
      };
    }
  }

  return {
    supported: true,
    shipItem,
    stanceID: DEFAULT_STANCE_ID,
    modifierTypeID: getModeTypeIDForStance(shipTypeID, DEFAULT_STANCE_ID),
    modifierItems,
  };
}

function buildShipStanceSlimTuple(shipOrID, options = {}) {
  const state = resolveCurrentShipStance(shipOrID);
  if (!state.supported || state.stanceID <= 0) {
    return null;
  }

  const existing = Array.isArray(options.existingSlimValue)
    ? options.existingSlimValue
    : null;
  if (
    existing &&
    existing.length >= 3 &&
    toInt(existing[2], 0) === state.stanceID
  ) {
    return existing;
  }

  return [
    state.stanceID,
    options.fileTime === undefined || options.fileTime === null
      ? 0n
      : normalizeBigInt(options.fileTime, 0n),
    state.stanceID,
  ];
}

function sendNotification(session, name, idType, payload) {
  if (!session || !name) {
    return;
  }

  const normalizedPayload = Array.isArray(payload) ? payload : [payload];
  if (typeof session.sendNotification === "function") {
    session.sendNotification(name, idType || "clientID", normalizedPayload);
    return;
  }

  if (Array.isArray(session._notifications)) {
    session._notifications.push({
      name,
      idType: idType || "clientID",
      payload: normalizedPayload,
    });
  }
  if (Array.isArray(session.notifications)) {
    session.notifications.push({
      name,
      idType: idType || "clientID",
      payload: normalizedPayload,
    });
  }
}

function syncInventoryChangesToSession(session, changes = []) {
  if (!session || !Array.isArray(changes)) {
    return;
  }

  for (const change of changes) {
    const item = change && change.item;
    if (!item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      item,
      change.previousState || change.previousData || {},
      { emitCfgLocation: false },
    );
  }
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function getTransitionFileTime(spaceRuntime, session) {
  if (
    spaceRuntime &&
    typeof spaceRuntime.getSimulationFileTimeForSession === "function"
  ) {
    return normalizeBigInt(
      spaceRuntime.getSimulationFileTimeForSession(session, currentFileTime()),
      currentFileTime(),
    );
  }

  return currentFileTime();
}

function broadcastShipStanceSlimChange(spaceRuntime, session, shipID, tuple) {
  if (!spaceRuntime || !session || !Array.isArray(tuple)) {
    return false;
  }

  const scene =
    typeof spaceRuntime.getSceneForSession === "function"
      ? spaceRuntime.getSceneForSession(session)
      : null;
  const entity =
    scene && typeof scene.getEntityByID === "function"
      ? scene.getEntityByID(toInt(shipID, 0))
      : null;
  if (!scene || !entity || entity.kind !== "ship") {
    return false;
  }

  entity.shipStance = tuple;
  if (typeof scene.broadcastSlimItemChanges === "function") {
    scene.broadcastSlimItemChanges([entity]);
    return true;
  }

  return false;
}

function replaceShipStanceModifierItem(shipItem, targetStanceID) {
  const targetModifierTypeID = getModeTypeIDForStance(shipItem.typeID, targetStanceID);
  const previousState = resolveCurrentShipStance(shipItem);
  const changes = [];

  for (const item of previousState.modifierItems) {
    const removeResult = removeInventoryItem(item.itemID, { removeContents: true });
    if (removeResult && removeResult.success) {
      changes.push(...((removeResult.data && removeResult.data.changes) || []));
    }
  }

  const createResult = grantItemToCharacterLocation(
    shipItem.ownerID,
    shipItem.itemID,
    ITEM_FLAGS.HIDDEN_MODIFIERS,
    { typeID: targetModifierTypeID },
    1,
    {
      singleton: 1,
      customInfo: `shipStance:${targetStanceID}`,
    },
  );
  if (!createResult || createResult.success !== true) {
    return {
      success: false,
      errorMsg: createResult && createResult.errorMsg || "ITEM_CREATE_FAILED",
      changes,
      previousState,
      targetModifierTypeID,
    };
  }

  changes.push(...((createResult.data && createResult.data.changes) || []));
  return {
    success: true,
    changes,
    previousState,
    targetModifierTypeID,
    item: createResult.data && createResult.data.items
      ? createResult.data.items[0] || null
      : null,
  };
}

function setShipStance(shipID, stanceID, session, options = {}) {
  const numericShipID = toInt(shipID, 0);
  const targetStanceID = normalizeStanceID(stanceID);
  const shipItem = findShipItemById(numericShipID);
  const characterID = getSessionCharacterID(session);

  if (characterID <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (toInt(shipItem.ownerID, 0) !== characterID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_OWNED",
    };
  }
  if (!shipHasStances(shipItem.typeID)) {
    return {
      success: false,
      errorMsg: "SHIP_STANCE_UNSUPPORTED",
    };
  }
  if (!getModeTypeIDForStance(shipItem.typeID, targetStanceID)) {
    return {
      success: false,
      errorMsg: "SHIP_STANCE_INVALID",
    };
  }

  const currentState = resolveCurrentShipStance(shipItem);
  const targetModifierTypeID = getModeTypeIDForStance(shipItem.typeID, targetStanceID);
  const hasExactlyTargetModifier =
    currentState.modifierItems.length === 1 &&
    toInt(currentState.modifierItems[0].typeID, 0) === targetModifierTypeID;
  const changed = currentState.stanceID !== targetStanceID;

  if (!changed && hasExactlyTargetModifier) {
    return {
      success: true,
      changed: false,
      shipID: numericShipID,
      oldStanceID: currentState.stanceID,
      newStanceID: targetStanceID,
      modifierTypeID: targetModifierTypeID,
      changes: [],
    };
  }

  const replaceResult = replaceShipStanceModifierItem(shipItem, targetStanceID);
  if (!replaceResult.success) {
    return {
      success: false,
      errorMsg: replaceResult.errorMsg,
      changes: replaceResult.changes || [],
    };
  }

  syncInventoryChangesToSession(session, replaceResult.changes);

  if (!changed) {
    return {
      success: true,
      changed: false,
      shipID: numericShipID,
      oldStanceID: currentState.stanceID,
      newStanceID: targetStanceID,
      modifierTypeID: targetModifierTypeID,
      changes: replaceResult.changes,
    };
  }

  const spaceRuntime = options.spaceRuntime || getSpaceRuntime();
  const transitionFileTime = getTransitionFileTime(spaceRuntime, session);
  const slimTuple = [
    currentState.stanceID,
    transitionFileTime,
    targetStanceID,
  ];
  sendNotification(session, "OnStanceActive", "charid", [
    numericShipID,
    targetStanceID,
  ]);
  const slimBroadcasted = broadcastShipStanceSlimChange(
    spaceRuntime,
    session,
    numericShipID,
    slimTuple,
  );

  return {
    success: true,
    changed: true,
    shipID: numericShipID,
    oldStanceID: currentState.stanceID,
    newStanceID: targetStanceID,
    modifierTypeID: targetModifierTypeID,
    transitionFileTime,
    slimTuple,
    slimBroadcasted,
    changes: replaceResult.changes,
  };
}

module.exports = {
  SHIP_STANCE,
  DEFAULT_STANCE_ID,
  STANCE_SWITCH_COOLDOWN_SECONDS,
  HIDDEN_MODIFIERS_FLAG: ITEM_FLAGS.HIDDEN_MODIFIERS,
  SHIP_STANCE_MODIFIERS_BY_TYPE_ID,
  ALL_STANCE_MODIFIER_TYPE_IDS,
  toInt,
  getSessionCharacterID,
  getShipStanceModifierMap,
  getModeTypeIDForStance,
  getStanceIDForModeType,
  shipHasStances,
  listShipStanceModifierItems,
  resolveCurrentShipStance,
  buildShipStanceSlimTuple,
  setShipStance,
  syncInventoryChangesToSession,
};
