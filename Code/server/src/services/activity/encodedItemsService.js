const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { findItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
));
const { matchesTypeList } = require(path.join(
  __dirname,
  "../inventory/typeListAuthority",
));

const CORRUPTED_TRINARY_FRAGMENT_TYPE_LIST_ID = 492;
const MIN_FAKE_ITEM_ID = 9000000000000000000;
const RESOURCE_URL_KEYS = Object.freeze([
  "evejsEncodedItemUrl",
  "encodedItemUrl",
]);
const RESOURCE_EXTENSIONS = Object.freeze([".png", ".webm"]);

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

function getCorporationID(session = null) {
  return toInt(
    session &&
      (
        session.corporationID ||
        session.corpid ||
        session.corpID
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

function getItemQuantity(item) {
  const quantity = Number(item && (item.stacksize ?? item.quantity));
  return Number.isFinite(quantity) ? Math.trunc(quantity) : 0;
}

function isFakeItemID(itemID) {
  return Number(itemID) > MIN_FAKE_ITEM_ID;
}

function ownsDecodableItem(item, session = null) {
  const ownerID = toInt(item && item.ownerID, 0);
  const characterID = getCharacterID(session);
  const corporationID = getCorporationID(session);

  if (ownerID <= 0 || (characterID <= 0 && corporationID <= 0)) {
    return true;
  }

  return ownerID === characterID || ownerID === corporationID;
}

function parseCustomInfo(customInfo) {
  if (!customInfo) {
    return {};
  }
  if (typeof customInfo === "object" && !Array.isArray(customInfo)) {
    return customInfo;
  }

  try {
    const parsed = JSON.parse(String(customInfo));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function isSupportedResourceUrl(url) {
  const normalized = typeof url === "string" ? url.trim() : "";
  if (!normalized) {
    return false;
  }

  return RESOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function resolveResourceUrl(item) {
  const customInfo = parseCustomInfo(item && item.customInfo);
  for (const key of RESOURCE_URL_KEYS) {
    const value = customInfo[key];
    if (typeof value === "string") {
      return value.trim();
    }
  }
  return "";
}

function validateDecodableItem(itemID, session = null) {
  const normalizedItemID = toInt(itemID, 0);
  if (normalizedItemID <= 0 || isFakeItemID(normalizedItemID)) {
    return {
      item: null,
      reason: "missing-item",
    };
  }

  const item = itemResolver(normalizedItemID);
  if (!item) {
    return {
      item: null,
      reason: "missing-item",
    };
  }

  if (!matchesTypeList(item, CORRUPTED_TRINARY_FRAGMENT_TYPE_LIST_ID)) {
    return {
      item,
      reason: "invalid-item-type",
    };
  }

  if (!ownsDecodableItem(item, session)) {
    return {
      item,
      reason: "invalid-owner",
    };
  }

  if (getItemQuantity(item) < 1) {
    return {
      item,
      reason: "empty-stack",
    };
  }

  return {
    item,
    reason: null,
  };
}

class EncodedItemsService extends BaseService {
  constructor() {
    super("encodedItems");
  }

  Handle_DecodeItem(args, session) {
    const itemID = toInt(args && args[0], 0);
    const validation = validateDecodableItem(itemID, session);
    if (validation.reason) {
      recordAuditEvent("encoded_item_decode_rejected", args, session, {
        itemID,
        reason: validation.reason,
      });
      return null;
    }

    const item = validation.item || {};
    const resourceUrl = resolveResourceUrl(item);
    if (!isSupportedResourceUrl(resourceUrl)) {
      recordAuditEvent("encoded_item_decode_no_resource", args, session, {
        itemID,
        typeID: toInt(item.typeID, 0),
        reason: resourceUrl ? "invalid-resource-url" : "no-verified-resource-url",
      });
      log.debug(
        "[EncodedItems] DecodeItem returned null: no verified .png/.webm resource URL is available",
      );
      return null;
    }

    recordAuditEvent("encoded_item_decode_url_returned", args, session, {
      itemID,
      typeID: toInt(item.typeID, 0),
      resourceUrl,
    });
    return resourceUrl;
  }
}

EncodedItemsService._testing = {
  constants: {
    CORRUPTED_TRINARY_FRAGMENT_TYPE_LIST_ID,
    MIN_FAKE_ITEM_ID,
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
  validateDecodableItem,
  resolveResourceUrl,
};

module.exports = EncodedItemsService;
