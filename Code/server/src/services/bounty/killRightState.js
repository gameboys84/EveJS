const path = require("path");

// Phase 0 / 0.C: bounty domain state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:bounty", { strict: true });
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const TABLE_NAME = "killRights";
const FILETIME_UNIX_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const DEFAULT_KILL_RIGHT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const KILL_RIGHT_SUSPECT_TIMER_MS = 15 * 60 * 1000;

const ERROR = Object.freeze({
  NO_VALID_KILL_RIGHT: "NO_VALID_KILL_RIGHT",
  KILL_RIGHT_EXPIRED: "KILL_RIGHT_EXPIRED",
  KILL_RIGHT_NOT_FOR_SALE: "KILL_RIGHT_NOT_FOR_SALE",
  PAYMENT_FAILED: "PAYMENT_FAILED",
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.round(numeric * 100) / 100);
}

function filetimeFromMs(ms = Date.now()) {
  return (
    BigInt(Math.max(0, Math.trunc(Number(ms) || 0))) * FILETIME_TICKS_PER_MS +
    FILETIME_UNIX_EPOCH_OFFSET
  ).toString();
}

function filetimeToMs(value, fallback = 0) {
  try {
    const rawValue =
      value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")
        ? value.value
        : value;
    const filetime = BigInt(rawValue);
    if (filetime <= FILETIME_UNIX_EPOCH_OFFSET) {
      return fallback;
    }
    return Number((filetime - FILETIME_UNIX_EPOCH_OFFSET) / FILETIME_TICKS_PER_MS);
  } catch (error) {
    return fallback;
  }
}

function normalizeRestrictedTo(value) {
  if (value === null || value === undefined || value === "open") {
    return null;
  }
  const numericValue = toInteger(value, 0);
  return numericValue > 0 ? numericValue : null;
}

function emptyState() {
  return {
    nextKillRightID: 1,
    nextActivationID: 1,
    rights: {},
    activations: {},
  };
}

function normalizeKillRight(record = {}, fallbackID = 0) {
  const killRightID = toInteger(record.killRightID, toInteger(fallbackID, 0));
  const createdAt = String(record.createdAt || currentFileTime());
  const expiryTime = String(
    record.expiryTime ||
      filetimeFromMs(filetimeToMs(createdAt, Date.now()) + DEFAULT_KILL_RIGHT_EXPIRY_MS),
  );
  const price =
    record.price === null || record.price === undefined
      ? null
      : normalizeMoney(record.price, 0);

  return {
    killRightID,
    fromID: toInteger(record.fromID, 0),
    toID: toInteger(record.toID, 0),
    expiryTime,
    price,
    restrictedTo: normalizeRestrictedTo(record.restrictedTo),
    createdAt,
    soldAt: record.soldAt ? String(record.soldAt) : null,
    saleCancelledAt: record.saleCancelledAt ? String(record.saleCancelledAt) : null,
    usedAt: record.usedAt ? String(record.usedAt) : null,
    usedBy: toInteger(record.usedBy, 0) || null,
    expiredAt: record.expiredAt ? String(record.expiredAt) : null,
    revokedAt: record.revokedAt ? String(record.revokedAt) : null,
  };
}

function normalizeActivation(record = {}, fallbackID = 0) {
  const activationID = toInteger(record.activationID, toInteger(fallbackID, 0));
  return {
    activationID,
    killRightID: toInteger(record.killRightID, 0),
    fromID: toInteger(record.fromID, 0),
    toID: toInteger(record.toID, 0),
    activatorID: toInteger(record.activatorID, 0),
    activatedAt: String(record.activatedAt || currentFileTime()),
    expiresAt: String(record.expiresAt || filetimeFromMs(Date.now() + KILL_RIGHT_SUSPECT_TIMER_MS)),
    pricePaid: normalizeMoney(record.pricePaid, 0),
    activationKind: String(record.activationKind || "activate"),
  };
}

function normalizeState(rawState = {}) {
  const state = rawState && typeof rawState === "object"
    ? cloneValue(rawState)
    : {};
  const normalized = emptyState();
  normalized.nextKillRightID = Math.max(1, toInteger(state.nextKillRightID, 1));
  normalized.nextActivationID = Math.max(1, toInteger(state.nextActivationID, 1));

  const sourceRights =
    state.rights && typeof state.rights === "object"
      ? state.rights
      : state.killRights && typeof state.killRights === "object"
        ? state.killRights
        : {};
  for (const [killRightID, record] of Object.entries(sourceRights)) {
    const normalizedRecord = normalizeKillRight(record, killRightID);
    if (
      normalizedRecord.killRightID > 0 &&
      normalizedRecord.fromID > 0 &&
      normalizedRecord.toID > 0
    ) {
      normalized.rights[String(normalizedRecord.killRightID)] = normalizedRecord;
      normalized.nextKillRightID = Math.max(
        normalized.nextKillRightID,
        normalizedRecord.killRightID + 1,
      );
    }
  }

  const sourceActivations =
    state.activations && typeof state.activations === "object"
      ? state.activations
      : {};
  for (const [activationID, record] of Object.entries(sourceActivations)) {
    const normalizedActivation = normalizeActivation(record, activationID);
    if (
      normalizedActivation.activationID > 0 &&
      normalizedActivation.killRightID > 0 &&
      normalizedActivation.toID > 0 &&
      normalizedActivation.activatorID > 0
    ) {
      normalized.activations[String(normalizedActivation.activationID)] = normalizedActivation;
      normalized.nextActivationID = Math.max(
        normalized.nextActivationID,
        normalizedActivation.activationID + 1,
      );
    }
  }

  return normalized;
}

function readState() {
  const result = repo.read(TABLE_NAME, "/");
  if (!result.success) {
    return emptyState();
  }
  return normalizeState(result.data);
}

function writeState(state) {
  return repo.write(TABLE_NAME, "/", normalizeState(state));
}

function normalizeNowMs(nowMs = Date.now()) {
  return Math.max(0, toInteger(nowMs, Date.now()));
}

function isKillRightExpired(record, nowMs = Date.now()) {
  return filetimeToMs(record && record.expiryTime, 0) <= normalizeNowMs(nowMs);
}

function markExpiredRight(record, nowMs = Date.now()) {
  if (!record || record.usedAt || record.revokedAt || record.expiredAt) {
    return false;
  }
  if (!isKillRightExpired(record, nowMs)) {
    return false;
  }
  record.expiredAt = filetimeFromMs(nowMs);
  record.price = null;
  record.restrictedTo = null;
  return true;
}

function expireRightsInState(state, nowMs = Date.now()) {
  const normalizedNowMs = normalizeNowMs(nowMs);
  const expired = [];
  for (const record of Object.values(state && state.rights || {})) {
    if (markExpiredRight(record, normalizedNowMs)) {
      expired.push(cloneValue(record));
    }
  }
  return expired;
}

function isKillRightUsable(record, nowMs = Date.now()) {
  return Boolean(
    record &&
      record.killRightID > 0 &&
      record.fromID > 0 &&
      record.toID > 0 &&
      !record.usedAt &&
      !record.expiredAt &&
      !record.revokedAt &&
      !isKillRightExpired(record, nowMs),
  );
}

function getKillRight(killRightID) {
  const state = readState();
  const expired = expireRightsInState(state);
  if (expired.length > 0) {
    writeState(state);
  }
  const record = state.rights[String(toInteger(killRightID, 0))];
  return record ? cloneValue(record) : null;
}

function listActiveKillRights(nowMs = Date.now()) {
  const state = readState();
  const expired = expireRightsInState(state, nowMs);
  if (expired.length > 0) {
    writeState(state);
  }
  return Object.values(state.rights)
    .filter((record) => isKillRightUsable(record, nowMs))
    .sort((left, right) => left.killRightID - right.killRightID)
    .map((record) => cloneValue(record));
}

function expireKillRights(nowMs = Date.now()) {
  const state = readState();
  const expired = expireRightsInState(state, nowMs);
  if (expired.length === 0) {
    return {
      success: true,
      expired: [],
    };
  }
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    expired,
  };
}

function findActiveKillRightBetween(fromID, toID, nowMs = Date.now()) {
  const numericFromID = toInteger(fromID, 0);
  const numericToID = toInteger(toID, 0);
  if (numericFromID <= 0 || numericToID <= 0) {
    return null;
  }
  const state = readState();
  const record = Object.values(state.rights)
    .filter((candidate) => (
      candidate.fromID === numericFromID &&
      candidate.toID === numericToID &&
      isKillRightUsable(candidate, nowMs)
    ))
    .sort((left, right) => left.killRightID - right.killRightID)[0];
  return record ? cloneValue(record) : null;
}

function createKillRight({
  fromID,
  toID,
  expiryTime = null,
  expiryMs = DEFAULT_KILL_RIGHT_EXPIRY_MS,
  nowMs = Date.now(),
} = {}) {
  const numericFromID = toInteger(fromID, 0);
  const numericToID = toInteger(toID, 0);
  if (numericFromID <= 0 || numericToID <= 0 || numericFromID === numericToID) {
    return {
      success: false,
      errorMsg: ERROR.NO_VALID_KILL_RIGHT,
    };
  }

  const state = readState();
  const killRightID = state.nextKillRightID;
  const createdAt = filetimeFromMs(nowMs);
  const record = normalizeKillRight({
    killRightID,
    fromID: numericFromID,
    toID: numericToID,
    expiryTime: expiryTime || filetimeFromMs(nowMs + Math.max(0, toInteger(expiryMs, expiryMs))),
    createdAt,
  });
  state.nextKillRightID = killRightID + 1;
  state.rights[String(killRightID)] = record;
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    data: cloneValue(record),
  };
}

function createKillRightForCriminalAggression({
  fromID,
  toID,
  expiryTime = null,
  expiryMs = DEFAULT_KILL_RIGHT_EXPIRY_MS,
  nowMs = Date.now(),
} = {}) {
  const numericFromID = toInteger(fromID, 0);
  const numericToID = toInteger(toID, 0);
  if (numericFromID <= 0 || numericToID <= 0 || numericFromID === numericToID) {
    return {
      success: false,
      errorMsg: ERROR.NO_VALID_KILL_RIGHT,
    };
  }

  const state = readState();
  const existingRecord = Object.values(state.rights)
    .filter((record) => (
      record.fromID === numericFromID &&
      record.toID === numericToID &&
      isKillRightUsable(record, nowMs)
    ))
    .sort((left, right) => left.killRightID - right.killRightID)[0];
  if (existingRecord) {
    return {
      success: true,
      created: false,
      data: cloneValue(existingRecord),
    };
  }

  const killRightID = state.nextKillRightID;
  const createdAt = filetimeFromMs(nowMs);
  const record = normalizeKillRight({
    killRightID,
    fromID: numericFromID,
    toID: numericToID,
    expiryTime: expiryTime || filetimeFromMs(nowMs + Math.max(0, toInteger(expiryMs, expiryMs))),
    createdAt,
  });
  state.nextKillRightID = killRightID + 1;
  state.rights[String(killRightID)] = record;
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    created: true,
    data: cloneValue(record),
  };
}

function listMyKillRights(characterID, nowMs = Date.now()) {
  const numericCharacterID = toInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }
  return listActiveKillRights(nowMs).filter(
    (record) => record.fromID === numericCharacterID || record.toID === numericCharacterID,
  );
}

function hasSaleAccess(record, validOwnerIDs = []) {
  if (!record || record.price === null || record.price === undefined) {
    return false;
  }
  if (record.restrictedTo === null || record.restrictedTo === undefined) {
    return true;
  }
  const validSet = new Set(
    (Array.isArray(validOwnerIDs) ? validOwnerIDs : [])
      .map((value) => toInteger(value, 0))
      .filter((value) => value > 0),
  );
  return validSet.has(toInteger(record.restrictedTo, 0));
}

function listAvailableKillRightsOnCharacters(toIDs = [], validOwnerIDs = [], nowMs = Date.now()) {
  const targetIDs = new Set(
    (Array.isArray(toIDs) ? toIDs : [toIDs])
      .map((value) => toInteger(value, 0))
      .filter((value) => value > 0),
  );
  if (targetIDs.size === 0) {
    return [];
  }
  return listActiveKillRights(nowMs).filter(
    (record) => targetIDs.has(record.toID) && hasSaleAccess(record, validOwnerIDs),
  );
}

function sellKillRight(killRightID, ownerID, price, restrictedTo = null, options = {}) {
  const state = readState();
  const numericKillRightID = toInteger(killRightID, 0);
  const numericOwnerID = toInteger(ownerID, 0);
  const nowMs = normalizeNowMs(options.nowMs);
  const record = state.rights[String(numericKillRightID)];
  if (!record || record.fromID !== numericOwnerID || record.usedAt || record.revokedAt) {
    return {
      success: false,
      errorMsg: ERROR.NO_VALID_KILL_RIGHT,
    };
  }
  if (record.expiredAt) {
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }
  if (isKillRightExpired(record, nowMs)) {
    markExpiredRight(record, nowMs);
    writeState(state);
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }

  const updatedRecord = normalizeKillRight({
    ...record,
    price: normalizeMoney(price, 0),
    restrictedTo: normalizeRestrictedTo(restrictedTo),
    soldAt: filetimeFromMs(nowMs),
    saleCancelledAt: null,
  });
  state.rights[String(numericKillRightID)] = updatedRecord;
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    data: cloneValue(updatedRecord),
  };
}

function cancelSellKillRight(killRightID, ownerID, toID = null, options = {}) {
  const state = readState();
  const numericKillRightID = toInteger(killRightID, 0);
  const numericOwnerID = toInteger(ownerID, 0);
  const numericToID = toInteger(toID, 0);
  const nowMs = normalizeNowMs(options.nowMs);
  const record = state.rights[String(numericKillRightID)];
  if (
    !record ||
    record.fromID !== numericOwnerID ||
    record.usedAt ||
    record.revokedAt ||
    (numericToID > 0 && record.toID !== numericToID)
  ) {
    return {
      success: false,
      errorMsg: ERROR.NO_VALID_KILL_RIGHT,
    };
  }
  if (record.expiredAt) {
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }
  if (isKillRightExpired(record, nowMs)) {
    markExpiredRight(record, nowMs);
    writeState(state);
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }

  const updatedRecord = normalizeKillRight({
    ...record,
    price: null,
    restrictedTo: null,
    saleCancelledAt: filetimeFromMs(nowMs),
  });
  state.rights[String(numericKillRightID)] = updatedRecord;
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    data: cloneValue(updatedRecord),
  };
}

function appendActivation(state, record, activatorID, options = {}) {
  const nowMs = normalizeNowMs(options.nowMs);
  const activationID = state.nextActivationID;
  const activation = normalizeActivation({
    activationID,
    killRightID: record.killRightID,
    fromID: record.fromID,
    toID: record.toID,
    activatorID,
    activatedAt: filetimeFromMs(nowMs),
    expiresAt: filetimeFromMs(nowMs + KILL_RIGHT_SUSPECT_TIMER_MS),
    pricePaid: normalizeMoney(options.pricePaid, 0),
    activationKind: options.activationKind || "activate",
  });
  state.nextActivationID = activationID + 1;
  state.activations[String(activationID)] = activation;
  return activation;
}

function activateOwnedKillRight(killRightID, activatorID, options = {}) {
  const state = readState();
  const numericKillRightID = toInteger(killRightID, 0);
  const numericActivatorID = toInteger(activatorID, 0);
  const nowMs = normalizeNowMs(options.nowMs);
  const record = state.rights[String(numericKillRightID)];
  if (!record || record.fromID !== numericActivatorID || record.usedAt || record.revokedAt) {
    return {
      success: false,
      errorMsg: ERROR.NO_VALID_KILL_RIGHT,
    };
  }
  if (record.expiredAt) {
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }
  if (isKillRightExpired(record, nowMs)) {
    markExpiredRight(record, nowMs);
    writeState(state);
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }

  const activation = appendActivation(state, record, numericActivatorID, {
    nowMs,
    pricePaid: 0,
    activationKind: "activate",
  });
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    data: {
      killRight: cloneValue(record),
      activation: cloneValue(activation),
    },
  };
}

function buyKillRight(killRightID, buyerID, validOwnerIDs = [], expectedPrice = null, options = {}) {
  const state = readState();
  const numericKillRightID = toInteger(killRightID, 0);
  const numericBuyerID = toInteger(buyerID, 0);
  const nowMs = normalizeNowMs(options.nowMs);
  const record = state.rights[String(numericKillRightID)];
  if (!record || record.usedAt || record.revokedAt) {
    return {
      success: false,
      errorMsg: ERROR.NO_VALID_KILL_RIGHT,
    };
  }
  if (record.expiredAt) {
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }
  if (isKillRightExpired(record, nowMs)) {
    markExpiredRight(record, nowMs);
    writeState(state);
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }
  if (!hasSaleAccess(record, validOwnerIDs)) {
    return {
      success: false,
      errorMsg: record.price === null ? ERROR.KILL_RIGHT_NOT_FOR_SALE : ERROR.NO_VALID_KILL_RIGHT,
    };
  }

  const normalizedExpectedPrice =
    expectedPrice === null || expectedPrice === undefined
      ? record.price
      : normalizeMoney(expectedPrice, 0);
  if (record.price !== normalizedExpectedPrice) {
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_NOT_FOR_SALE,
    };
  }

  if (typeof options.paymentCallback === "function" && record.price > 0) {
    const paymentResult = options.paymentCallback(cloneValue(record));
    if (!paymentResult || !paymentResult.success) {
      return {
        success: false,
        errorMsg: ERROR.PAYMENT_FAILED,
        paymentErrorMsg: paymentResult && paymentResult.errorMsg,
      };
    }
  }

  const activation = appendActivation(state, record, numericBuyerID, {
    nowMs,
    pricePaid: record.price,
    activationKind: "buy",
  });
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    data: {
      killRight: cloneValue(record),
      activation: cloneValue(activation),
    },
  };
}

function markKillRightUsed(killRightID, usedBy = null, options = {}) {
  const state = readState();
  const numericKillRightID = toInteger(killRightID, 0);
  const record = state.rights[String(numericKillRightID)];
  if (!record || record.usedAt || record.revokedAt) {
    return {
      success: false,
      errorMsg: ERROR.NO_VALID_KILL_RIGHT,
    };
  }
  const nowMs = normalizeNowMs(options.nowMs);
  if (record.expiredAt) {
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }
  if (isKillRightExpired(record, nowMs)) {
    markExpiredRight(record, nowMs);
    writeState(state);
    return {
      success: false,
      errorMsg: ERROR.KILL_RIGHT_EXPIRED,
    };
  }
  const updatedRecord = normalizeKillRight({
    ...record,
    usedAt: filetimeFromMs(nowMs),
    usedBy: toInteger(usedBy, 0) || null,
  });
  state.rights[String(numericKillRightID)] = updatedRecord;
  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }
  return {
    success: true,
    data: cloneValue(updatedRecord),
  };
}

function readActiveActivationsForTarget(toID, nowMs = Date.now()) {
  const targetID = toInteger(toID, 0);
  if (targetID <= 0) {
    return [];
  }
  const state = readState();
  const expired = expireRightsInState(state, nowMs);
  if (expired.length > 0) {
    writeState(state);
  }
  return Object.values(state.activations)
    .filter((activation) => (
      activation.toID === targetID &&
      isKillRightUsable(state.rights[String(activation.killRightID)], nowMs) &&
      filetimeToMs(activation.expiresAt, 0) > nowMs
    ))
    .sort((left, right) => left.activationID - right.activationID)
    .map((activation) => cloneValue(activation));
}

function resetStateForTests() {
  writeState(emptyState());
}

module.exports = {
  DEFAULT_KILL_RIGHT_EXPIRY_MS,
  ERROR,
  KILL_RIGHT_SUSPECT_TIMER_MS,
  activateOwnedKillRight,
  buyKillRight,
  cancelSellKillRight,
  createKillRight,
  createKillRightForCriminalAggression,
  expireKillRights,
  filetimeFromMs,
  findActiveKillRightBetween,
  getKillRight,
  isKillRightExpired,
  listActiveKillRights,
  listAvailableKillRightsOnCharacters,
  listMyKillRights,
  markKillRightUsed,
  readActiveActivationsForTarget,
  readState,
  sellKillRight,
  writeState,
  _testing: {
    emptyState,
    filetimeToMs,
    normalizeState,
    resetStateForTests,
  },
};
