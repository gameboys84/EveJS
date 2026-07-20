const path = require("path");

const {
  buildList,
  buildObjectEx1,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const LANDING_PAD_DATA_CLASS = "shipcaster.landingPadData.LandingPadData";

const FACTION_CALDARI_STATE = 500001;
const FACTION_MINMATAR_REPUBLIC = 500002;
const FACTION_AMARR_EMPIRE = 500003;
const FACTION_GALLENTE_FEDERATION = 500004;
const FACTION_ANGEL_CARTEL = 500011;
const FACTION_GURISTAS_PIRATES = 500010;

const KNOWN_SHIPCASTER_FACTION_IDS = Object.freeze([
  FACTION_AMARR_EMPIRE,
  FACTION_CALDARI_STATE,
  FACTION_GALLENTE_FEDERATION,
  FACTION_MINMATAR_REPUBLIC,
  FACTION_ANGEL_CARTEL,
  FACTION_GURISTAS_PIRATES,
]);

const auditEvents = [];
const landingPadsByItemID = new Map();
const factionsWithShipcaster = new Set();
const starterEligibleCharacterIDs = new Set();

function toInt(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return !["", "0", "false", "no"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
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

function getAccountID(session = null) {
  return toInt(
    session &&
      (
        session.userID ||
        session.userid ||
        session.accountID ||
        session.accountId
      ),
    0,
  );
}

function cloneArgs(args = []) {
  return Array.isArray(args)
    ? args.map((entry) => unwrapMarshalValue(entry))
    : [];
}

function recordAuditEvent(kind, args = [], session = null, extra = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    accountID: getAccountID(session) || null,
    timestamp: Date.now(),
    ...extra,
  });
}

function normalizeFactionID(value) {
  const factionID = toInt(value, 0);
  return KNOWN_SHIPCASTER_FACTION_IDS.includes(factionID) ? factionID : null;
}

function normalizeLandingPad(rawLandingPad = {}) {
  if (!rawLandingPad || typeof rawLandingPad !== "object") {
    return null;
  }

  const itemID = toInt(rawLandingPad.itemID || rawLandingPad._itemID, 0);
  const solarSystemID = toInt(
    rawLandingPad.solarSystemID ||
      rawLandingPad.solarsystemID ||
      rawLandingPad._solarSystemID,
    0,
  );
  const factionID = normalizeFactionID(
    rawLandingPad.factionID || rawLandingPad._factionID,
  );

  if (itemID <= 0 || solarSystemID <= 0 || !factionID) {
    return null;
  }

  return {
    itemID,
    solarSystemID,
    factionID,
    isBuilt: normalizeBoolean(rawLandingPad.isBuilt ?? rawLandingPad._isBuilt, false),
    linkTimestamp:
      rawLandingPad.linkTimestamp ??
      rawLandingPad._linkTimestamp ??
      null,
    isDisrupted: normalizeBoolean(
      rawLandingPad.isDisrupted ?? rawLandingPad._isDisrupted,
      false,
    ),
  };
}

function buildLandingPadDataPayload(landingPad) {
  const normalizedLandingPad = normalizeLandingPad(landingPad);
  if (!normalizedLandingPad) {
    return null;
  }

  return buildObjectEx1(LANDING_PAD_DATA_CLASS, [
    normalizedLandingPad.itemID,
    normalizedLandingPad.solarSystemID,
    normalizedLandingPad.factionID,
    normalizedLandingPad.isBuilt,
    normalizedLandingPad.linkTimestamp,
    normalizedLandingPad.isDisrupted,
  ]);
}

function listLandingPads(factionID = null) {
  const normalizedFactionID = factionID ? normalizeFactionID(factionID) : null;
  return [...landingPadsByItemID.values()]
    .filter((landingPad) =>
      !normalizedFactionID || landingPad.factionID === normalizedFactionID,
    )
    .sort((left, right) =>
      left.factionID - right.factionID ||
        left.solarSystemID - right.solarSystemID ||
        left.itemID - right.itemID,
    );
}

function buildLandingPadListPayload(landingPads = []) {
  return buildList(
    landingPads
      .map(buildLandingPadDataPayload)
      .filter(Boolean),
  );
}

function buildFactionListPayload() {
  return buildList([...factionsWithShipcaster].sort((left, right) => left - right));
}

function seedLandingPadsForTests(landingPads = []) {
  landingPadsByItemID.clear();
  for (const landingPad of Array.isArray(landingPads) ? landingPads : []) {
    const normalizedLandingPad = normalizeLandingPad(landingPad);
    if (normalizedLandingPad) {
      landingPadsByItemID.set(normalizedLandingPad.itemID, normalizedLandingPad);
    }
  }
}

function seedFactionsWithShipcasterForTests(factionIDs = []) {
  factionsWithShipcaster.clear();
  for (const factionID of Array.isArray(factionIDs) ? factionIDs : []) {
    const normalizedFactionID = normalizeFactionID(factionID);
    if (normalizedFactionID) {
      factionsWithShipcaster.add(normalizedFactionID);
    }
  }
}

function seedStarterEligibleCharactersForTests(characterIDs = []) {
  starterEligibleCharacterIDs.clear();
  for (const characterID of Array.isArray(characterIDs) ? characterIDs : []) {
    const normalizedCharacterID = toInt(characterID, 0);
    if (normalizedCharacterID > 0) {
      starterEligibleCharacterIDs.add(normalizedCharacterID);
    }
  }
}

function canCharacterUseStarterShipcaster(session = null) {
  const characterID = getCharacterID(session);
  return characterID > 0 && starterEligibleCharacterIDs.has(characterID);
}

function resetForTests() {
  auditEvents.length = 0;
  landingPadsByItemID.clear();
  factionsWithShipcaster.clear();
  starterEligibleCharacterIDs.clear();
}

module.exports = {
  constants: {
    LANDING_PAD_DATA_CLASS,
    FACTION_CALDARI_STATE,
    FACTION_MINMATAR_REPUBLIC,
    FACTION_AMARR_EMPIRE,
    FACTION_GALLENTE_FEDERATION,
    FACTION_ANGEL_CARTEL,
    FACTION_GURISTAS_PIRATES,
    KNOWN_SHIPCASTER_FACTION_IDS,
  },
  buildFactionListPayload,
  buildLandingPadDataPayload,
  buildLandingPadListPayload,
  canCharacterUseStarterShipcaster,
  getAccountID,
  getAuditEvents() {
    return auditEvents.map((entry) => ({ ...entry }));
  },
  getCharacterID,
  listLandingPads,
  normalizeFactionID,
  recordAuditEvent,
  resetForTests,
  seedFactionsWithShipcasterForTests,
  seedLandingPadsForTests,
  seedStarterEligibleCharactersForTests,
  toInt,
};
