const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildBoundObjectResponse,
  buildList,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  adjustCharacterBalance,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const {
  adjustCharacterWalletLPBalance,
  getCharacterWalletLPBalance,
} = require(path.join(__dirname, "../corporation/lpWalletState"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const {
  STRUCTURE_SERVICE_ID,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  characterHasStructureService,
} = require(path.join(__dirname, "../structure/structurePayloads"));
const {
  HERALDRY_CORPORATION_ID,
  listHeraldryOffersForCharacter,
  takeHeraldryOfferForCharacter,
} = require("./evermarksStore");
const {
  hasStaticLpStoreOffers,
  getStaticLpStoreOfferRecord,
  listStaticLpStoreOffers,
} = require(path.join(__dirname, "../loyalty/lpStoreOfferCatalog"));
const {
  getDockedLocationID,
} = require(path.join(__dirname, "../structure/structureLocation"));

const ERROR_MESSAGES = Object.freeze({
  ALREADY_OWNED: "You already own that emblem.",
  AK_UNSUPPORTED: "That offer requires unsupported currency.",
  CHARACTER_NOT_FOUND: "Character data is unavailable for this purchase.",
  INSUFFICIENT_EVERMARKS: "You do not have enough EverMarks.",
  INSUFFICIENT_ISK: "You do not have enough ISK.",
  INSUFFICIENT_LP: "You do not have enough loyalty points.",
  INSUFFICIENT_REQUIRED_ITEMS: "You do not have the required items for that offer.",
  INVALID_CHARACTER: "Character data is unavailable for this purchase.",
  INVALID_QUANTITY: "Heraldry offers can only be purchased one at a time.",
  INVALID_STORE: "That LP store is not available.",
  ITEM_GRANT_FAILED: "LP store purchase delivery failed.",
  LICENSE_NOT_FOUND: "That Heraldry emblem could not be resolved.",
  LOYALTY_STORE_UNAVAILABLE: "That loyalty store service is not available.",
  OFFER_NOT_FOUND: "That offer is no longer available.",
  REQ_ITEMS_UNSUPPORTED: "That offer requires unsupported extra items.",
});

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function throwStoreError(errorMsg) {
  throwWrappedUserError("CustomNotify", {
    notify:
      ERROR_MESSAGES[String(errorMsg || "").toUpperCase()] ||
      "LP store purchase failed.",
  });
}

function getSessionStructureID(session) {
  for (const candidate of [
    session && session.structureID,
    session && session.structureid,
  ]) {
    const structureID = normalizePositiveInteger(candidate, 0);
    if (structureID) {
      return structureID;
    }
  }
  return 0;
}

function ensureStructureLoyaltyStoreAccess(session) {
  const structureID = getSessionStructureID(session);
  if (!structureID) {
    return;
  }

  const structure = structureState.getStructureByID(structureID, {
    refresh: false,
  });
  if (
    !structure ||
    !characterHasStructureService(
      session,
      structure,
      STRUCTURE_SERVICE_ID.LOYALTY_STORE,
    )
  ) {
    throwStoreError("LOYALTY_STORE_UNAVAILABLE");
  }
}

function resolveSessionCharacterID(session) {
  return normalizePositiveInteger(
    session && (session.characterID || session.charid),
    0,
  );
}

function normalizeStaticOfferQuantity(value, fallback = 1) {
  return normalizePositiveInteger(value, fallback);
}

function multiplyOfferAmount(value, numberOfOffers) {
  return Math.max(0, Math.trunc(Number(value) || 0)) * numberOfOffers;
}

function aggregateRequirementPairs(reqItems = [], numberOfOffers = 1) {
  const quantitiesByTypeID = new Map();
  for (const pair of Array.isArray(reqItems) ? reqItems : []) {
    const typeID = normalizePositiveInteger(Array.isArray(pair) ? pair[0] : 0, 0);
    const quantity = normalizePositiveInteger(Array.isArray(pair) ? pair[1] : 0, 0);
    if (!typeID || !quantity) {
      continue;
    }
    quantitiesByTypeID.set(
      typeID,
      (quantitiesByTypeID.get(typeID) || 0) + (quantity * numberOfOffers),
    );
  }
  return [...quantitiesByTypeID.entries()];
}

function getItemStackQuantity(item) {
  if (!item || typeof item !== "object") {
    return 0;
  }
  if (Number(item.singleton || 0) === 1) {
    return 1;
  }
  return Math.max(
    0,
    Math.trunc(Number(item.stacksize ?? item.quantity) || 0),
  );
}

function getItemStore() {
  return require(path.join(__dirname, "../inventory/itemStore"));
}

function hasRequiredItems(characterID, locationID, requirements = []) {
  if (requirements.length === 0) {
    return true;
  }

  const {
    ITEM_FLAGS,
    listContainerItems,
  } = getItemStore();
  const availableByTypeID = new Map();
  for (const item of listContainerItems(characterID, locationID, ITEM_FLAGS.HANGAR)) {
    const typeID = normalizePositiveInteger(item && item.typeID, 0);
    if (!typeID) {
      continue;
    }
    availableByTypeID.set(
      typeID,
      (availableByTypeID.get(typeID) || 0) + getItemStackQuantity(item),
    );
  }

  return requirements.every(
    ([typeID, quantity]) => (availableByTypeID.get(typeID) || 0) >= quantity,
  );
}

function refundRequiredItems(characterID, locationID, consumedRequirements = []) {
  const {
    ITEM_FLAGS,
    grantItemToCharacterLocation,
  } = getItemStore();
  for (const [typeID, quantity] of consumedRequirements) {
    grantItemToCharacterLocation(
      characterID,
      locationID,
      ITEM_FLAGS.HANGAR,
      typeID,
      quantity,
      { singleton: 0 },
    );
  }
}

function takeRequiredItems(characterID, locationID, requirements = []) {
  const {
    ITEM_FLAGS,
    takeItemTypeFromCharacterLocation,
  } = getItemStore();
  const changes = [];
  const consumedRequirements = [];
  for (const [typeID, quantity] of requirements) {
    const takeResult = takeItemTypeFromCharacterLocation(
      characterID,
      locationID,
      ITEM_FLAGS.HANGAR,
      typeID,
      quantity,
    );
    if (!takeResult || takeResult.success !== true) {
      refundRequiredItems(characterID, locationID, consumedRequirements);
      return {
        success: false,
        errorMsg: "INSUFFICIENT_REQUIRED_ITEMS",
      };
    }
    consumedRequirements.push([typeID, quantity]);
    changes.push(...((takeResult.data && takeResult.data.changes) || []));
  }
  return {
    success: true,
    data: {
      changes,
      consumedRequirements,
    },
  };
}

function rollbackStaticLpStorePurchase({
  characterID,
  corpID,
  locationID,
  lpCost = 0,
  iskCost = 0,
  consumedRequirements = [],
}) {
  if (lpCost > 0) {
    adjustCharacterWalletLPBalance(characterID, corpID, lpCost, {
      changeType: "lp_store_purchase_rollback",
    });
  }
  if (iskCost > 0) {
    adjustCharacterBalance(characterID, iskCost, {
      description: "LP store purchase rollback",
    });
  }
  refundRequiredItems(characterID, locationID, consumedRequirements);
}

function resolveInventoryNotificationItem(change) {
  if (!change || typeof change !== "object") {
    return null;
  }
  if (change.item && typeof change.item === "object") {
    return change.item;
  }
  if (change.removed === true && change.previousData) {
    const {
      buildRemovedItemNotificationState,
    } = getItemStore();
    return buildRemovedItemNotificationState(change.previousData);
  }
  return null;
}

function getSyncInventoryItemForSession() {
  const characterState = require(path.join(__dirname, "../character/characterState"));
  return typeof characterState.syncInventoryItemForSession === "function"
    ? characterState.syncInventoryItemForSession
    : null;
}

function getCharacterSessions(characterID, excludedSession = null) {
  const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
  const recipients = new Set();
  for (const candidateSession of sessionRegistry.getSessions()) {
    if (
      candidateSession &&
      candidateSession !== excludedSession &&
      resolveSessionCharacterID(candidateSession) === characterID &&
      typeof candidateSession.sendNotification === "function"
    ) {
      recipients.add(candidateSession);
    }
  }
  return [...recipients];
}

function syncInventoryChangesToSession(session, changes = []) {
  const syncInventoryItemForSession = getSyncInventoryItemForSession();
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    typeof syncInventoryItemForSession !== "function"
  ) {
    return;
  }

  for (const change of changes) {
    const notificationItem = resolveInventoryNotificationItem(change);
    if (!notificationItem) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      notificationItem,
      change.previousData || change.previousState || {},
      { emitCfgLocation: true },
    );
  }
}

function notifyStaticLpStoreInventoryChanges(session, characterID, changes = []) {
  const normalizedChanges = Array.isArray(changes) ? changes : [];
  if (normalizedChanges.length === 0) {
    return;
  }

  for (const recipientSession of getCharacterSessions(characterID, session)) {
    syncInventoryChangesToSession(recipientSession, normalizedChanges);
  }

  if (
    !session ||
    resolveSessionCharacterID(session) !== characterID ||
    typeof session.sendNotification !== "function"
  ) {
    return;
  }

  syncInventoryChangesToSession(session, normalizedChanges);
}

function takeStaticOfferForCharacter(session, corpID, offerID, numberOfOffers = 1) {
  const characterID = resolveSessionCharacterID(session);
  const normalizedCorpID = normalizePositiveInteger(corpID, 0);
  const normalizedOfferID = normalizePositiveInteger(offerID, 0);
  const normalizedNumberOfOffers = normalizeStaticOfferQuantity(numberOfOffers, 1);
  if (!characterID) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER",
    };
  }
  if (!normalizedCorpID || !hasStaticLpStoreOffers(normalizedCorpID)) {
    return {
      success: false,
      errorMsg: "INVALID_STORE",
    };
  }

  const offer = getStaticLpStoreOfferRecord(normalizedCorpID, normalizedOfferID);
  if (!offer || normalizePositiveInteger(offer.typeID, 0) <= 0) {
    return {
      success: false,
      errorMsg: "OFFER_NOT_FOUND",
    };
  }
  if (normalizePositiveInteger(offer.akCost, 0) > 0) {
    return {
      success: false,
      errorMsg: "AK_UNSUPPORTED",
    };
  }

  const locationID = normalizePositiveInteger(getDockedLocationID(session), 0);
  if (!locationID) {
    return {
      success: false,
      errorMsg: "INVALID_STORE",
    };
  }

  const lpCost = multiplyOfferAmount(offer.lpCost, normalizedNumberOfOffers);
  const iskCost = multiplyOfferAmount(offer.iskCost, normalizedNumberOfOffers);
  const grantedQuantity =
    normalizeStaticOfferQuantity(offer.qty, 1) * normalizedNumberOfOffers;
  const requirements = aggregateRequirementPairs(
    offer.reqItems,
    normalizedNumberOfOffers,
  );

  if (getCharacterWalletLPBalance(characterID, normalizedCorpID) < lpCost) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_LP",
    };
  }
  const wallet = getCharacterWallet(characterID);
  if (!wallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }
  if (Number(wallet.balance || 0) < iskCost) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ISK",
    };
  }
  if (!hasRequiredItems(characterID, locationID, requirements)) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_REQUIRED_ITEMS",
    };
  }

  if (lpCost > 0) {
    const lpResult = adjustCharacterWalletLPBalance(
      characterID,
      normalizedCorpID,
      -lpCost,
      { changeType: "lp_store_purchase" },
    );
    if (!lpResult.success) {
      return lpResult;
    }
  }

  if (iskCost > 0) {
    const iskResult = adjustCharacterBalance(characterID, -iskCost, {
      description: `LP store purchase: offer ${normalizedOfferID}`,
      ownerID1: normalizedCorpID,
      ownerID2: characterID,
      referenceID: normalizedOfferID,
    });
    if (!iskResult.success) {
      rollbackStaticLpStorePurchase({
        characterID,
        corpID: normalizedCorpID,
        locationID,
        lpCost,
      });
      return iskResult;
    }
  }

  const takeResult = takeRequiredItems(characterID, locationID, requirements);
  if (!takeResult.success) {
    rollbackStaticLpStorePurchase({
      characterID,
      corpID: normalizedCorpID,
      locationID,
      lpCost,
      iskCost,
    });
    return takeResult;
  }

  const {
    ITEM_FLAGS,
    grantItemToCharacterLocation,
  } = getItemStore();
  const grantResult = grantItemToCharacterLocation(
    characterID,
    locationID,
    ITEM_FLAGS.HANGAR,
    offer.typeID,
    grantedQuantity,
  );
  if (!grantResult || grantResult.success !== true) {
    rollbackStaticLpStorePurchase({
      characterID,
      corpID: normalizedCorpID,
      locationID,
      lpCost,
      iskCost,
      consumedRequirements: takeResult.data.consumedRequirements,
    });
    return {
      success: false,
      errorMsg: "ITEM_GRANT_FAILED",
    };
  }

  const inventoryChanges = [
    ...((takeResult.data && takeResult.data.changes) || []),
    ...((grantResult.data && grantResult.data.changes) || []),
  ];
  notifyStaticLpStoreInventoryChanges(session, characterID, inventoryChanges);

  return {
    success: true,
    data: {
      offer,
      quantity: grantedQuantity,
      lpCost,
      iskCost,
      requirements,
      inventoryChanges,
    },
  };
}

class LPStoreMgrService extends BaseService {
  constructor() {
    super("LPStoreMgr");
  }

  Handle_MachoResolveObject() {
    log.debug("[LPStoreMgr] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[LPStoreMgr] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetAvailableOffersFromCorp(args, session) {
    log.debug("[LPStoreMgr] GetAvailableOffersFromCorp");
    ensureStructureLoyaltyStoreAccess(session);
    const corpID = Array.isArray(args) && args.length > 0
      ? normalizePositiveInteger(args[0], HERALDRY_CORPORATION_ID)
      : HERALDRY_CORPORATION_ID;
    let offers;
    if (corpID === HERALDRY_CORPORATION_ID) {
      offers = listHeraldryOffersForCharacter(
        session && session.characterID,
        corpID,
      );
    } else if (hasStaticLpStoreOffers(corpID)) {
      offers = listStaticLpStoreOffers(corpID);
    } else {
      offers = listHeraldryOffersForCharacter(
        session && session.characterID,
        corpID,
      );
    }
    return buildList(offers);
  }

  Handle_TakeOfferForCharacter(args, session) {
    log.debug("[LPStoreMgr] TakeOfferForCharacter");
    ensureStructureLoyaltyStoreAccess(session);
    const corpID = Array.isArray(args) && args.length > 0 ? args[0] : HERALDRY_CORPORATION_ID;
    const offerID = Array.isArray(args) && args.length > 1 ? args[1] : 0;
    const numberOfOffers = Array.isArray(args) && args.length > 2 ? args[2] : 1;
    const normalizedCorpID = normalizePositiveInteger(corpID, HERALDRY_CORPORATION_ID);
    const result = normalizedCorpID === HERALDRY_CORPORATION_ID
      ? takeHeraldryOfferForCharacter(
        session,
        normalizedCorpID,
        offerID,
        numberOfOffers,
      )
      : takeStaticOfferForCharacter(
        session,
        normalizedCorpID,
        offerID,
        numberOfOffers,
      );
    if (!result.success) {
      throwStoreError(result.errorMsg);
    }
    return true;
  }

  Handle_TakeOfferForCorporation(args, session) {
    log.debug("[LPStoreMgr] TakeOfferForCorporation");
    ensureStructureLoyaltyStoreAccess(session);
    const corpID = Array.isArray(args) && args.length > 0
      ? normalizePositiveInteger(args[0], 0)
      : 0;
    if (corpID === HERALDRY_CORPORATION_ID) {
      throwStoreError("INVALID_STORE");
    }
    return null;
  }
}

module.exports = LPStoreMgrService;
