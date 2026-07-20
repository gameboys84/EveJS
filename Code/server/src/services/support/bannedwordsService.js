const path = require("path");
const crypto = require("crypto");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  buildDict,
  buildList,
  extractDictEntries,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const REGEX_TYPES = Object.freeze(["blocked", "intercepted"]);
const regexesByType = new Map(REGEX_TYPES.map((type) => [type, []]));
const wordChecks = [];

function toText(value, fallback = "") {
  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped === null || unwrapped === undefined) {
    return fallback;
  }
  if (Buffer.isBuffer(unwrapped)) {
    return unwrapped.toString("utf8");
  }
  return String(unwrapped);
}

function getKwargText(kwargs, key, fallback = "") {
  for (const [entryKey, entryValue] of extractDictEntries(kwargs)) {
    if (toText(entryKey) === key) {
      return toText(entryValue, fallback);
    }
  }
  return fallback;
}

function hashRegex(regex) {
  return crypto
    .createHash("sha1")
    .update(String(regex || ""), "utf8")
    .digest("hex");
}

function normalizeRegexEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const regex = toText(entry.regex, "").trim();
  if (!regex) {
    return null;
  }
  const hash = toText(entry.hash, "").trim() || hashRegex(regex);
  return { regex, hash };
}

function normalizeRegexType(value) {
  const regexType = toText(value, "blocked").trim();
  return REGEX_TYPES.includes(regexType) ? regexType : "blocked";
}

function buildRegexPayload(regexType) {
  const entries = regexesByType.get(normalizeRegexType(regexType)) || [];
  return buildList(
    entries.map((entry) => buildDict([
      ["regex", entry.regex],
      ["hash", entry.hash],
    ])),
  );
}

function getConfiguredRegexes(regexType) {
  return regexesByType.get(normalizeRegexType(regexType)) || [];
}

function recordWordCheck(kind, args = [], session = null) {
  const words = (Array.isArray(args) ? args : []).map((entry) => toText(entry, ""));
  const entry = {
    checkID: wordChecks.length + 1,
    kind,
    characterID: Number(session && (session.characterID || session.charid || 0)) || 0,
    accountID: Number(session && (session.userid || session.userID || 0)) || 0,
    words,
    checkedAt: new Date().toISOString(),
  };
  wordChecks.push(entry);
  log.debug(
    `[BannedWords] ${kind} check words=${words.length} char=${entry.characterID || "?"}`,
  );
  return entry;
}

function assertWordsAllowed(kind, args = [], kwargs = null, session = null) {
  recordWordCheck(kind, args, session);
  const errorName = getKwargText(
    kwargs,
    "err_message",
    kind === "search" ? "SearchStringContainsBannedWord" : "LocationNameInvalidBannedWord",
  );
  const regexType = kind === "search" ? "intercepted" : "blocked";
  const configured = getConfiguredRegexes(regexType);
  if (configured.length === 0) {
    return null;
  }

  for (const rawWord of Array.isArray(args) ? args : []) {
    const word = toText(rawWord, "");
    for (const entry of configured) {
      let pattern = null;
      try {
        pattern = new RegExp(entry.regex);
      } catch (error) {
        log.warn(`[BannedWords] Invalid local regex '${entry.regex}': ${error.message}`);
        continue;
      }
      if (pattern.test(word)) {
        throwWrappedUserError(errorName || "LocationNameInvalidBannedWord");
      }
    }
  }
  return null;
}

class BannedWordsService extends BaseService {
  constructor() {
    super("bannedwords");
  }

  Handle_fetch_regexes(args) {
    const regexType = normalizeRegexType(args && args[0]);
    log.debug(`[BannedWords] fetch_regexes type=${regexType}`);
    return buildRegexPayload(regexType);
  }

  Handle_check_words_allowed(args, session, kwargs) {
    return assertWordsAllowed("words", args, kwargs, session);
  }

  Handle_check_search_words_allowed(args, session, kwargs) {
    return assertWordsAllowed("search", args, kwargs, session);
  }
}

module.exports = BannedWordsService;
module.exports._testing = {
  REGEX_TYPES,
  getChecks() {
    return wordChecks.map((entry) => JSON.parse(JSON.stringify(entry)));
  },
  resetForTests() {
    for (const regexType of REGEX_TYPES) {
      regexesByType.set(regexType, []);
    }
    wordChecks.length = 0;
  },
  setRegexes(regexType, entries) {
    regexesByType.set(
      normalizeRegexType(regexType),
      (Array.isArray(entries) ? entries : [])
        .map(normalizeRegexEntry)
        .filter(Boolean),
    );
  },
};
