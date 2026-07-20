const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  extractDictEntries,
  normalizeNumber,
  normalizeText,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const MAX_AUDIT_EVENTS = 100;
const DEFAULT_SAFE_STATE_CONFIG = Object.freeze({
  underage: false,
  accruedSessions: [],
});

const safeStateConfig = {
  underage: DEFAULT_SAFE_STATE_CONFIG.underage,
  accruedSessions: DEFAULT_SAFE_STATE_CONFIG.accruedSessions.slice(),
};
const auditEvents = [];

function toInteger(value, fallback = 0) {
  const numericValue = normalizeNumber(unwrapMarshalValue(value), fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toText(value, fallback = "") {
  const unwrapped = unwrapMarshalValue(value);
  const text = normalizeText(unwrapped, fallback);
  return text === "" ? fallback : text;
}

function normalizeLanguageID(value) {
  const text = toText(value, "EN").trim();
  return text ? text : "EN";
}

// Broadcast presence leaves for a character that is logging out to character
// select (socket stays open). Lazy-required so the auth service does not pull
// chat/guest-list/space modules at load time.
function announceLogoutPresenceDeparture(session) {
  if (!session) {
    return;
  }
  try {
    const chatHub = require(path.join(__dirname, "../chat/chatHub"));
    if (getSessionCharacterID(session) > 0 && typeof chatHub.unregisterSession === "function") {
      chatHub.unregisterSession(session);
    }
  } catch (error) {
    log.warn(`[AuthSvc] Failed to announce local logout departure: ${error.message}`);
  }
  try {
    const {
      broadcastStationGuestLeft,
      broadcastStructureGuestLeft,
    } = require(path.join(__dirname, "../_shared/guestLists"));
    const stationID = toInteger(
      session.stationid || session.stationID || session.stationId,
      0,
    );
    const structureID = toInteger(
      session.structureid || session.structureID || session.structureId,
      0,
    );
    if (stationID > 0) {
      broadcastStationGuestLeft(session, stationID);
    } else if (structureID > 0) {
      broadcastStructureGuestLeft(session, structureID);
    }
  } catch (error) {
    log.warn(`[AuthSvc] Failed to announce logout departure: ${error.message}`);
  }
}

function getSessionAccountID(session) {
  return Math.max(
    0,
    toInteger(
      session && (
        session.userid ||
        session.userID ||
        session.userId ||
        session.accountID
      ),
      0,
    ),
  );
}

function getSessionCharacterID(session) {
  return Math.max(
    0,
    toInteger(
      session && (
        session.characterID ||
        session.charID ||
        session.charid ||
        session.characterId
      ),
      0,
    ),
  );
}

function getSessionClientID(session) {
  return Math.max(
    0,
    toInteger(session && (session.clientID || session.clientId), 0),
  );
}

function getSessionRole(session) {
  const rawRole =
    session && (
      session.role ||
      session.accountRole ||
      session.rolesAtAll ||
      0
    );
  try {
    if (typeof rawRole === "bigint") {
      return rawRole;
    }
    return BigInt(toInteger(rawRole, 0));
  } catch (error) {
    return 0n;
  }
}

function recordAuditEvent(kind, args = [], session = null, extra = {}) {
  auditEvents.push({
    kind,
    accountID: getSessionAccountID(session) || null,
    characterID: getSessionCharacterID(session) || null,
    args: Array.isArray(args) ? args.slice() : [],
    ...extra,
    recordedAt: new Date().toISOString(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

function normalizeAccruedSession(entry) {
  if (!Array.isArray(entry) || entry.length < 3) {
    return null;
  }
  const sessionID = toInteger(entry[0], 0);
  const startSeconds = toInteger(entry[1], 0);
  const endSeconds = toInteger(entry[2], startSeconds);
  if (sessionID <= 0 || startSeconds < 0 || endSeconds < 0) {
    return null;
  }
  return [sessionID, startSeconds, Math.max(startSeconds, endSeconds)];
}

function normalizeAccruedSessions(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeAccruedSession)
    .filter(Boolean);
}

function resetSafeStateConfig() {
  safeStateConfig.underage = DEFAULT_SAFE_STATE_CONFIG.underage;
  safeStateConfig.accruedSessions =
    DEFAULT_SAFE_STATE_CONFIG.accruedSessions.slice();
}

function extractPlainObject(value) {
  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    return unwrapped;
  }
  return {};
}

function getMappingValue(source, key, fallback = null) {
  if (!source) {
    return fallback;
  }

  for (const [entryKey, entryValue] of extractDictEntries(source)) {
    if (toText(entryKey, "") === key) {
      return unwrapMarshalValue(entryValue);
    }
  }

  const plainObject = extractPlainObject(source);
  if (Object.prototype.hasOwnProperty.call(plainObject, key)) {
    return plainObject[key];
  }
  return fallback;
}

function buildLoginInfo(session, request = null, loginArgs = []) {
  const userName =
    toText(session && session.userName, "") ||
    toText(session && session.username, "") ||
    toText(loginArgs[1], "");
  const address =
    toText(session && session.address, "") ||
    toText(loginArgs[5], "") ||
    toText(getMappingValue(request, "address", ""), "");
  const languageID =
    normalizeLanguageID(
      session && (
        session.languageID ||
        session.languageId ||
        session.languageid
      ),
    );
  const countryCode = toText(session && session.countryCode, "") || null;

  return buildDict([
    ["userid", getSessionAccountID(session)],
    ["userType", 30],
    ["role", { type: "long", value: getSessionRole(session) }],
    ["address", address || "127.0.0.1"],
    ["languageID", languageID],
    ["countryCode", countryCode],
    ["maxSessionTime", null],
    ["inDetention", null],
    ["userName", userName || null],
  ]);
}

function resolveComputerHash(session, request = null) {
  return (
    toText(getMappingValue(request, "computer_hash", ""), "") ||
    toText(getMappingValue(request, "computerHash", ""), "") ||
    toText(session && session.multiLoginComputerHash, "") ||
    toText(session && session.computerHash, "") ||
    ""
  );
}

class AuthenticationService extends BaseService {
  constructor() {
    super("authentication");
  }

  Handle_AmUnderage(args, session) {
    const underage = safeStateConfig.underage === true;
    recordAuditEvent("am_underage", args, session, {
      hasJwtToken: Boolean(args && args[0]),
      underage,
    });
    return underage;
  }

  Handle_AccruedTime(args, session) {
    recordAuditEvent("accrued_time", args, session, {
      sessionCount: safeStateConfig.accruedSessions.length,
    });
    return safeStateConfig.accruedSessions.map((entry) => entry.slice());
  }

  Handle_SetLanguageID(args, session) {
    const languageID = normalizeLanguageID(args && args[0]);
    if (session && typeof session === "object") {
      session.languageID = languageID;
      session.languageId = languageID;
      session.languageid = languageID;
      session.userLanguageID = languageID;
    }

    recordAuditEvent("set_language_id", args, session, { languageID });
    log.debug(
      `[authentication] SetLanguageID account=${getSessionAccountID(session) || "?"} language=${languageID}`,
    );
    return null;
  }

  Handle_Login(args, session, kwargs) {
    const request = args && args[7] ? args[7] : null;
    const computerHash = resolveComputerHash(session, request);
    if (session && computerHash) {
      session.multiLoginComputerHash = computerHash;
    }

    recordAuditEvent("login_safe_state", [], session, {
      sessionID: toInteger(args && args[0], 0) || null,
      userName: toText(args && args[1], null),
      clientID: toInteger(args && args[6], getSessionClientID(session)) || null,
      hasPassword: Boolean(args && args[2]),
      hasPasswordHash: Boolean(args && args[3]),
      hasSsoToken: getMappingValue(kwargs, "ssoToken", null) !== null,
      clientVersion: toText(
        getMappingValue(kwargs, "clientVersion", null),
        toText(getMappingValue(request, "boot_build", ""), ""),
      ) || null,
    });

    return [
      buildLoginInfo(session, request, args),
      null,
      computerHash || null,
    ];
  }

  Handle_Logout(args, session, kwargs) {
    recordAuditEvent("logout_safe_state", [], session, {
      sessionID: toInteger(args && args[0], 0) || null,
      ipaddress: toText(getMappingValue(kwargs, "ipaddress", null), null),
    });
    // Logging out to character select keeps the socket open, so the socket-close
    // cleanup (disconnectCharacterSession) does not run. Announce the character's
    // departure here so docked observers drop them immediately instead of keeping
    // a stale guest row until they re-dock.
    announceLogoutPresenceDeparture(session);
    return null;
  }
}

AuthenticationService._testing = {
  getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }));
  },
  getSafeStateConfig() {
    return {
      underage: safeStateConfig.underage,
      accruedSessions: safeStateConfig.accruedSessions.map((entry) => entry.slice()),
    };
  },
  resetForTests() {
    auditEvents.length = 0;
    resetSafeStateConfig();
  },
  setSafeStateConfig(overrides = {}) {
    if (Object.prototype.hasOwnProperty.call(overrides, "underage")) {
      safeStateConfig.underage = overrides.underage === true;
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "accruedSessions")) {
      safeStateConfig.accruedSessions = normalizeAccruedSessions(
        overrides.accruedSessions,
      );
    }
  },
};

module.exports = AuthenticationService;
