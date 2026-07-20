const path = require("path");
const crypto = require("crypto");
const YAML = require("yaml");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
// Phase 0 / 0.C: shared-settings state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:settings", { strict: true });
const {
  buildKeyVal,
  normalizeNumber,
  normalizeText,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const TABLE = "sharedSettings";
const ROOT_PATH = "/";

const SHARED_SETTING_ITEMS = 2;
const SHARED_SETTING_BROADCAST = 3;
const ALLOWED_SETTING_TYPES = new Set([
  SHARED_SETTING_ITEMS,
  SHARED_SETTING_BROADCAST,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildHashValue(payloadString) {
  return crypto.createHash("sha1").update(payloadString).digest("hex");
}

function buildEntryKey(settingTypeID, hashvalue, sqID) {
  return `${settingTypeID}::${hashvalue}::${sqID}`;
}

function normalizeSettingTypeID(value) {
  const settingTypeID = Math.trunc(normalizeNumber(value, 0));
  return ALLOWED_SETTING_TYPES.has(settingTypeID) ? settingTypeID : null;
}

function buildPayloadString(rawPayload) {
  const unwrapped = unwrapMarshalValue(rawPayload);
  if (typeof unwrapped === "string") {
    const normalizedString = normalizeText(unwrapped, "");
    return normalizedString.trim() ? normalizedString : null;
  }

  if (!isPlainObject(unwrapped)) {
    return null;
  }

  const payloadKeys = Object.keys(unwrapped).sort();
  if (payloadKeys.length === 0) {
    return null;
  }

  const deterministicList = payloadKeys.map((key) => [key, unwrapped[key]]);
  return YAML.stringify(deterministicList);
}

function rebuildHashIndex(entries) {
  const hashIndex = {};
  for (const entry of Object.values(entries || {})) {
    if (!entry || !entry.hashvalue || !entry.sqID || !entry.settingTypeID) {
      continue;
    }
    const settingTypeID = normalizeSettingTypeID(entry.settingTypeID);
    if (!settingTypeID) {
      continue;
    }
    const hashKey = `${settingTypeID}::${entry.hashvalue}`;
    if (!Array.isArray(hashIndex[hashKey])) {
      hashIndex[hashKey] = [];
    }
    hashIndex[hashKey].push(entry.sqID);
  }
  for (const hashKey of Object.keys(hashIndex)) {
    hashIndex[hashKey].sort((left, right) => left - right);
  }
  return hashIndex;
}

function ensureStateShape(state) {
  const nextState = state && typeof state === "object" ? state : {};

  nextState.nextSqID = Math.max(1, normalizeNumber(nextState.nextSqID, 1));
  if (!isPlainObject(nextState.entries)) {
    nextState.entries = {};
  }
  if (!isPlainObject(nextState.hashIndex)) {
    nextState.hashIndex = rebuildHashIndex(nextState.entries);
  }

  let highestSqID = 0;
  const repairedEntries = {};
  for (const rawEntry of Object.values(nextState.entries)) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const settingTypeID = normalizeSettingTypeID(rawEntry.settingTypeID);
    const sqID = Math.max(0, normalizeNumber(rawEntry.sqID, 0));
    const payload = normalizeText(rawEntry.payload, "");
    const hashvalue = normalizeText(rawEntry.hashvalue, "") || buildHashValue(payload);
    if (!settingTypeID || sqID <= 0 || !payload.trim()) {
      continue;
    }

    highestSqID = Math.max(highestSqID, sqID);
    repairedEntries[buildEntryKey(settingTypeID, hashvalue, sqID)] = {
      ...rawEntry,
      settingTypeID,
      hashvalue,
      sqID,
      payload,
    };
  }

  nextState.entries = repairedEntries;
  nextState.hashIndex = rebuildHashIndex(repairedEntries);
  nextState.nextSqID = Math.max(nextState.nextSqID, highestSqID + 1);
  return nextState;
}

function buildInitialState() {
  return {
    nextSqID: 1,
    entries: {},
    hashIndex: {},
  };
}

function parseSettingKey(rawValue) {
  const unwrapped = unwrapMarshalValue(rawValue);

  if (Array.isArray(unwrapped) && unwrapped.length >= 3) {
    return {
      hashvalue: normalizeText(unwrapped[0], "").trim(),
      sqID: Math.max(0, normalizeNumber(unwrapped[1], 0)),
      settingTypeID: normalizeSettingTypeID(unwrapped[2]),
    };
  }

  if (isPlainObject(unwrapped)) {
    return {
      hashvalue: normalizeText(unwrapped.hashvalue, "").trim(),
      sqID: Math.max(0, normalizeNumber(unwrapped.sqID, 0)),
      settingTypeID: normalizeSettingTypeID(unwrapped.settingTypeID),
    };
  }

  return {
    hashvalue: "",
    sqID: 0,
    settingTypeID: null,
  };
}

class SharedSettingsMgrService extends BaseService {
  constructor() {
    super("sharedSettingsMgr");
    this._state = null;
  }

  _getState() {
    if (this._state) {
      return this._state;
    }

    const existing = repo.read(TABLE, ROOT_PATH);
    if (existing.success && existing.data && typeof existing.data === "object") {
      this._state = ensureStateShape(existing.data);
      return this._state;
    }

    this._state = buildInitialState();
    repo.write(TABLE, ROOT_PATH, this._state);
    return this._state;
  }

  _persistState() {
    repo.write(TABLE, ROOT_PATH, this._state);
    return this._state;
  }

  _buildSettingKeyVal(entry) {
    return buildKeyVal([
      ["hashvalue", entry.hashvalue],
      ["sqID", entry.sqID],
      ["settingTypeID", entry.settingTypeID],
    ]);
  }

  _findExistingEntry(settingTypeID, hashvalue, payloadString) {
    const state = this._getState();
    const hashKey = `${settingTypeID}::${hashvalue}`;
    const sqIDs = Array.isArray(state.hashIndex[hashKey])
      ? state.hashIndex[hashKey]
      : [];

    for (const sqID of sqIDs) {
      const entry = state.entries[buildEntryKey(settingTypeID, hashvalue, sqID)];
      if (entry && entry.payload === payloadString) {
        return entry;
      }
    }

    return null;
  }

  _storePayloadString(settingTypeID, payloadString, options = {}) {
    const normalizedSettingTypeID = normalizeSettingTypeID(settingTypeID);
    const normalizedPayloadString = normalizeText(payloadString, "");
    if (!normalizedSettingTypeID || !normalizedPayloadString.trim()) {
      return null;
    }

    const hashvalue = buildHashValue(normalizedPayloadString);
    const existingEntry = this._findExistingEntry(
      normalizedSettingTypeID,
      hashvalue,
      normalizedPayloadString,
    );
    if (existingEntry) {
      return existingEntry;
    }

    const state = this._getState();
    const sqID = state.nextSqID;
    state.nextSqID += 1;

    const entry = {
      settingTypeID: normalizedSettingTypeID,
      hashvalue,
      sqID,
      payload: normalizedPayloadString,
      ownerID: Math.max(0, normalizeNumber(options.ownerID, 0)),
      createdAt: Date.now(),
    };
    state.entries[buildEntryKey(normalizedSettingTypeID, hashvalue, sqID)] = entry;

    const hashKey = `${normalizedSettingTypeID}::${hashvalue}`;
    if (!Array.isArray(state.hashIndex[hashKey])) {
      state.hashIndex[hashKey] = [];
    }
    state.hashIndex[hashKey].push(sqID);
    this._persistState();

    log.info(
      `[SharedSettingsMgr] Stored shared setting type=${normalizedSettingTypeID} hash=${hashvalue} sqID=${sqID}`,
    );

    return entry;
  }

  Handle_StoreSettingLinkAndGetID(args = [], session) {
    const settingTypeID = args[0];
    const payloadString = buildPayloadString(args[1]);
    const storedEntry = this._storePayloadString(settingTypeID, payloadString, {
      ownerID: session && (session.characterID || session.userid || 0),
    });

    if (!storedEntry) {
      log.debug("[SharedSettingsMgr] StoreSettingLinkAndGetID received invalid payload");
      return null;
    }

    return this._buildSettingKeyVal(storedEntry);
  }

  Handle_GetStoredSharedSetting(args = []) {
    const state = this._getState();
    const key = parseSettingKey(args[0]);
    if (!key.hashvalue || !key.sqID || !key.settingTypeID) {
      return null;
    }

    const entry =
      state.entries &&
      state.entries[buildEntryKey(key.settingTypeID, key.hashvalue, key.sqID)];
    if (!entry || entry.hashvalue !== key.hashvalue) {
      return null;
    }

    return entry.payload || null;
  }
}

SharedSettingsMgrService._testing = {
  TABLE,
  SHARED_SETTING_ITEMS,
  SHARED_SETTING_BROADCAST,
  buildPayloadString,
  parseSettingKey,
};

module.exports = SharedSettingsMgrService;
