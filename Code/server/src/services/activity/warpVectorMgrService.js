const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { findItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));

const WARP_VECTOR_GROUP_ID = 4599;
const WARP_VECTOR_UNAVAILABLE_NOTIFY =
  "No verified warp vector destination is available.";

const auditEvents = [];
let itemResolver = findItemById;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterID(session = null) {
  return toInt(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
    0,
  );
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, details = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    details: { ...details },
    timestamp: Date.now(),
  });
}

function throwNotify(notify) {
  throwWrappedUserError("CustomNotify", {
    notify: String(notify || WARP_VECTOR_UNAVAILABLE_NOTIFY),
  });
}

function getItemGroupID(item) {
  const itemGroupID = toInt(item && item.groupID, 0);
  if (itemGroupID > 0) {
    return itemGroupID;
  }

  const type = resolveItemByTypeID(toInt(item && item.typeID, 0));
  return toInt(type && type.groupID, 0);
}

function getItemQuantity(item) {
  const quantity = Number(item && (item.stacksize ?? item.quantity));
  return Number.isFinite(quantity) ? Math.trunc(quantity) : 0;
}

function validateWarpVectorItem(itemID, session = null) {
  const normalizedItemID = toInt(itemID, 0);
  if (normalizedItemID <= 0) {
    return {
      item: null,
      reason: "missing-item",
      notify: "Warp vector item not found.",
    };
  }

  const item = itemResolver(normalizedItemID);
  if (!item) {
    return {
      item: null,
      reason: "missing-item",
      notify: "Warp vector item not found.",
    };
  }

  if (getItemGroupID(item) !== WARP_VECTOR_GROUP_ID) {
    return {
      item,
      reason: "invalid-item-type",
      notify: "The selected item is not warp vector data.",
    };
  }

  const characterID = getCharacterID(session);
  if (characterID > 0 && toInt(item.ownerID, 0) !== characterID) {
    return {
      item,
      reason: "invalid-owner",
      notify: "You do not own this warp vector data.",
    };
  }

  if (getItemQuantity(item) < 1) {
    return {
      item,
      reason: "empty-stack",
      notify: "Warp vector data is not available.",
    };
  }

  return {
    item,
    reason: null,
    notify: null,
  };
}

class WarpVectorMgrService extends BaseService {
  constructor() {
    super("warpVectorMgr");
  }

  Handle_UseVector(args, session) {
    const itemID = toInt(args && args[0], 0);
    const validation = validateWarpVectorItem(itemID, session);
    if (validation.reason) {
      recordAuditEvent("warp_vector_validation_rejected", args, session, {
        itemID,
        reason: validation.reason,
      });
      throwNotify(validation.notify);
    }

    const item = validation.item || {};
    recordAuditEvent("warp_vector_destination_unavailable", args, session, {
      itemID,
      typeID: toInt(item.typeID, 0),
    });
    log.debug(
      "[WarpVectorMgr] UseVector rejected: verified Operation Epiphany vector destinations are not available",
    );
    throwNotify(WARP_VECTOR_UNAVAILABLE_NOTIFY);
  }
}

WarpVectorMgrService._testing = {
  constants: {
    WARP_VECTOR_GROUP_ID,
    WARP_VECTOR_UNAVAILABLE_NOTIFY,
  },
  getAuditEvents() {
    return auditEvents.map((entry) => ({
      ...entry,
      details: { ...(entry.details || {}) },
    }));
  },
  resetForTests() {
    auditEvents.length = 0;
    itemResolver = findItemById;
  },
  setItemResolverForTests(resolver) {
    itemResolver = typeof resolver === "function" ? resolver : findItemById;
  },
  validateWarpVectorItem,
};

module.exports = WarpVectorMgrService;
