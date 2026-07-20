const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { buildList } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { findItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));

const RANDOM_JUMP_KEY_GROUP_IDS = Object.freeze({
  RANDOM_JUMP_KEYS: 4041,
  TRIGLAVIAN_JUMP_KEYS: 4087,
});

const RANDOM_JUMP_ERROR = Object.freeze({
  INVALID_KEY_TYPE: 2,
  INVALID_OWNER: 3,
  KEY_NOT_FOUND: 6,
  INVALID_KEY_AMOUNT: 11,
  UNKNOWN_ERROR: 22,
});

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

function buildErrorList(errors) {
  return buildList(
    (Array.isArray(errors) ? errors : [])
      .map(([code, args]) => [
        toInt(code, RANDOM_JUMP_ERROR.UNKNOWN_ERROR),
        Array.isArray(args) ? args : [],
      ]),
  );
}

function throwRandomJumpError(errors) {
  throwWrappedUserError("RandomJumpError", {
    errors: buildErrorList(errors),
  });
}

function getItemQuantity(item) {
  const quantity = Number(item && (item.stacksize ?? item.quantity));
  return Number.isFinite(quantity) ? Math.trunc(quantity) : 0;
}

function getItemGroupID(item) {
  const itemGroupID = toInt(item && item.groupID, 0);
  if (itemGroupID > 0) {
    return itemGroupID;
  }

  const type = resolveItemByTypeID(toInt(item && item.typeID, 0));
  return toInt(type && type.groupID, 0);
}

function isRandomJumpKeyGroup(groupID) {
  return Object.values(RANDOM_JUMP_KEY_GROUP_IDS).includes(toInt(groupID, 0));
}

function buildCharacterArg(session = null) {
  const characterID = getCharacterID(session);
  return characterID > 0 ? [characterID] : [];
}

function buildValidationErrors(itemID, session = null) {
  const normalizedItemID = toInt(itemID, 0);
  if (normalizedItemID <= 0) {
    return [[RANDOM_JUMP_ERROR.KEY_NOT_FOUND, []]];
  }

  const item = itemResolver(normalizedItemID);
  if (!item) {
    return [[RANDOM_JUMP_ERROR.KEY_NOT_FOUND, []]];
  }

  const characterID = getCharacterID(session);
  const errors = [];

  if (!isRandomJumpKeyGroup(getItemGroupID(item))) {
    errors.push([RANDOM_JUMP_ERROR.INVALID_KEY_TYPE, buildCharacterArg(session)]);
  }

  if (characterID > 0 && toInt(item.ownerID, 0) !== characterID) {
    errors.push([RANDOM_JUMP_ERROR.INVALID_OWNER, [characterID]]);
  }

  if (getItemQuantity(item) < 1) {
    errors.push([RANDOM_JUMP_ERROR.INVALID_KEY_AMOUNT, []]);
  }

  return errors;
}

class RandomJumpMgrService extends BaseService {
  constructor() {
    super("randomJumpMgr");
  }

  Handle_ActivateRandomJumpFilament(args, session) {
    const itemID = toInt(args && args[0], 0);
    const validationErrors = buildValidationErrors(itemID, session);
    if (validationErrors.length > 0) {
      recordAuditEvent("random_jump_filament_validation_rejected", args, session, {
        itemID,
        errors: validationErrors,
      });
      throwRandomJumpError(validationErrors);
    }

    recordAuditEvent("random_jump_filament_trace_unavailable", args, session, {
      itemID,
    });
    log.debug(
      "[RandomJumpMgr] ActivateRandomJumpFilament rejected: filament trace and destination runtime are not available",
    );
    throwRandomJumpError([[RANDOM_JUMP_ERROR.UNKNOWN_ERROR, []]]);
  }
}

RandomJumpMgrService._testing = {
  constants: {
    RANDOM_JUMP_ERROR,
    RANDOM_JUMP_KEY_GROUP_IDS,
  },
  buildErrorList,
  buildValidationErrors,
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
};

module.exports = RandomJumpMgrService;
