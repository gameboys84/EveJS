const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const {
  toMarshalValue,
} = require(path.join(__dirname, "./storeMarshal"));

const DEFAULT_KIRING_AID = 1;
const ANTI_ADDICTION_PASS_CODE = 201;
const MAX_AUDIT_EVENTS = 100;

const DEFAULT_SAFE_STATE_CONFIG = Object.freeze({
  eveGuardServerAddress: null,
  monochromeStyleEnabled: false,
  shouldKickCheater: false,
});

const safeStateConfig = { ...DEFAULT_SAFE_STATE_CONFIG };
const auditEvents = [];

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterID(session = null) {
  return Math.max(
    0,
    toInt(
      session && (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
      0,
    ),
  );
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, extra = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    ...extra,
    timestamp: Date.now(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function resetSafeStateConfig() {
  safeStateConfig.eveGuardServerAddress =
    DEFAULT_SAFE_STATE_CONFIG.eveGuardServerAddress;
  safeStateConfig.monochromeStyleEnabled =
    DEFAULT_SAFE_STATE_CONFIG.monochromeStyleEnabled;
  safeStateConfig.shouldKickCheater =
    DEFAULT_SAFE_STATE_CONFIG.shouldKickCheater;
}

function buildUrl(baseUrl, relativePath) {
  try {
    return new URL(relativePath, String(baseUrl || "http://127.0.0.1:26002/")).toString();
  } catch (error) {
    return `http://127.0.0.1:26002/${String(relativePath || "").replace(/^\/+/, "")}`;
  }
}

function buildKiringConfiguration() {
  const redirectBaseUrl =
    typeof config.microservicesRedirectUrl === "string" &&
    config.microservicesRedirectUrl.trim() !== ""
      ? config.microservicesRedirectUrl.trim()
      : "http://127.0.0.1:26002/";

  return {
    mode: 1,
    client_id: "evejs-local-kiring",
    endpoints: {
      mpay: buildUrl(redirectBaseUrl, "/kiring/mpay/"),
      billing: buildUrl(redirectBaseUrl, "/kiring/billing/"),
      redirect_uri: buildUrl(redirectBaseUrl, "/kiring/redirect/"),
    },
    channels: {
      login: "evejs_local",
      pay: "evejs_local",
      app: "evejs_local",
    },
  };
}

function buildEncodedAccount(deviceID = "evejs-local-device", token = "evejs-local-token") {
  const payload = {
    odi: String(deviceID || "evejs-local-device"),
    s: String(token || "evejs-local-token"),
  };
  return `${DEFAULT_KIRING_AID}-${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}`;
}

class KiringMgrService extends BaseService {
  constructor() {
    super("kiringMgr");
  }

  Handle_GetKiringConfiguration() {
    return toMarshalValue(buildKiringConfiguration());
  }

  Handle_PerformKiringServerSideAuthenticationFromCode(args) {
    const deviceID = String(args && args[1] ? args[1] : "evejs-local-device");
    const token = "evejs-local-token";
    return [
      DEFAULT_KIRING_AID,
      "evejs-local-user",
      token,
      buildEncodedAccount(deviceID, token),
      "EVE.JS Local",
    ];
  }

  Handle_GetSAuthAid() {
    return DEFAULT_KIRING_AID;
  }

  Handle_GetAntiAddictionCode() {
    return ANTI_ADDICTION_PASS_CODE;
  }

  Handle_GetEveGuardServerAddress(args, session) {
    const address = normalizeOptionalString(safeStateConfig.eveGuardServerAddress);
    recordAuditEvent("get_eve_guard_server_address", args, session, {
      hasOverride: address !== null,
    });
    return address;
  }

  Handle_IsMonochromeStyleEnabled(args, session) {
    const enabled = safeStateConfig.monochromeStyleEnabled === true;
    recordAuditEvent("is_monochrome_style_enabled", args, session, { enabled });
    return enabled;
  }

  Handle_ShouldKickCheater(args, session) {
    const shouldKick = safeStateConfig.shouldKickCheater === true;
    recordAuditEvent("should_kick_cheater", args, session, { shouldKick });
    return shouldKick;
  }

  Handle_PlaceKiringOrder() {
    return `evejs-kiring-${Date.now()}`;
  }

  Handle_ActivateRedeemingCode() {
    return true;
  }
}

KiringMgrService._testing = {
  getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }));
  },
  getSafeStateConfig() {
    return { ...safeStateConfig };
  },
  resetForTests() {
    auditEvents.length = 0;
    resetSafeStateConfig();
  },
  setSafeStateConfig(overrides = {}) {
    if (
      Object.prototype.hasOwnProperty.call(
        overrides,
        "eveGuardServerAddress",
      )
    ) {
      safeStateConfig.eveGuardServerAddress = normalizeOptionalString(
        overrides.eveGuardServerAddress,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        overrides,
        "monochromeStyleEnabled",
      )
    ) {
      safeStateConfig.monochromeStyleEnabled =
        overrides.monochromeStyleEnabled === true;
    }
    if (
      Object.prototype.hasOwnProperty.call(
        overrides,
        "shouldKickCheater",
      )
    ) {
      safeStateConfig.shouldKickCheater = overrides.shouldKickCheater === true;
    }
  },
};

module.exports = KiringMgrService;
