const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

function normalizeText(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return normalizeText(value.value, fallback);
    }
    if (Object.prototype.hasOwnProperty.call(value, "token")) {
      return normalizeText(value.token, fallback);
    }
  }
  const text = String(value);
  return text.length > 0 ? text : fallback;
}

function resolveCharacterID(session) {
  const numericValue = Number(
    session && (session.charid || session.characterID || session.userid),
  );
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function resolveMapValue(source, characterID) {
  if (!source || !characterID) {
    return null;
  }
  if (source instanceof Map) {
    return source.get(characterID) || source.get(String(characterID)) || null;
  }
  if (typeof source === "object") {
    return source[characterID] || source[String(characterID)] || null;
  }
  return null;
}

function resolveSessionToken(session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  const characterID = resolveCharacterID(session);
  return (
    normalizeText(session.chatAuthenticationToken, null) ||
    normalizeText(session.xmppAuthenticationToken, null) ||
    normalizeText(
      resolveMapValue(session.chatAuthenticationTokensByCharacterID, characterID),
      null,
    ) ||
    normalizeText(
      resolveMapValue(session.xmppAuthenticationTokensByCharacterID, characterID),
      null,
    ) ||
    null
  );
}

class ChatAuthenticationService extends BaseService {
  constructor(options = {}) {
    super("chatAuthenticationService");
    this._tokenProvider = options.tokenProvider || null;
    this._tokenByCharacterID = options.tokenByCharacterID || null;
  }

  getAuthenticationToken(session) {
    const characterID = resolveCharacterID(session);
    const injectedToken = normalizeText(
      resolveMapValue(this._tokenByCharacterID, characterID),
      null,
    );
    if (injectedToken) {
      return injectedToken;
    }

    const sessionToken = resolveSessionToken(session);
    if (sessionToken) {
      return sessionToken;
    }

    if (typeof this._tokenProvider === "function") {
      return normalizeText(this._tokenProvider({ session, characterID }), null);
    }

    return null;
  }

  Handle_GetAuthenticationToken(args, session) {
    const characterID = resolveCharacterID(session);
    const token = this.getAuthenticationToken(session);

    log.debug(
      `[ChatAuthenticationService] GetAuthenticationToken char=${characterID || "unknown"} -> ${token ? "provided" : "local-fallback"}`,
    );

    return token || null;
  }
}

ChatAuthenticationService._testing = {
  normalizeText,
  resolveCharacterID,
  resolveSessionToken,
};

module.exports = ChatAuthenticationService;
