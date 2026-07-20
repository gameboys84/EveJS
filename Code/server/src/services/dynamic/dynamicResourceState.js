const path = require("path");
const { randomUUID } = require("crypto");

const {
  buildDict,
  buildFiletimeLong,
  buildList,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  TABLE,
  readStaticRows,
  clearReferenceCache,
} = require(path.join(__dirname, "../_shared/referenceData"));

const TYPE_ENCOUNTER_SURVEILLANCE_SYSTEM = 55914;

const ESS_AUTOPAY_STATE_LONG = 0;
const ESS_AUTOPAY_STATE_MEDIUM = 1;
const ESS_AUTOPAY_STATE_SHORT = 2;

const ESS_RESERVE_WINDOW_STATE_INACTIVE = 0;
const ESS_RESERVE_WINDOW_STATE_EARLY = 1;
const ESS_RESERVE_WINDOW_STATE_BEST = 2;
const ESS_RESERVE_WINDOW_STATE_LATE = 3;

const UNLINKED_MANUAL = 0;

const FILETIME_TICKS_PER_SECOND = 10_000_000n;

const ESS_KEY_TYPE_IDS = Object.freeze({
  NW_15: 57714,
  NW_45: 57715,
  NE_15: 57716,
  NE_45: 57719,
  SE_15: 57717,
  SE_45: 57718,
  SW_15: 57720,
  SW_45: 57721,
});

const ESS_RESERVE_KEY_TOTAL_PULSES = Object.freeze({
  [ESS_KEY_TYPE_IDS.NW_15]: 15,
  [ESS_KEY_TYPE_IDS.NW_45]: 45,
  [ESS_KEY_TYPE_IDS.NE_15]: 15,
  [ESS_KEY_TYPE_IDS.NE_45]: 45,
  [ESS_KEY_TYPE_IDS.SE_15]: 15,
  [ESS_KEY_TYPE_IDS.SE_45]: 45,
  [ESS_KEY_TYPE_IDS.SW_15]: 15,
  [ESS_KEY_TYPE_IDS.SW_45]: 45,
});

const ESS_RESERVE_KEY_TYPES_BY_QUADRANT = Object.freeze({
  NE: Object.freeze([ESS_KEY_TYPE_IDS.NE_15, ESS_KEY_TYPE_IDS.NE_45]),
  NW: Object.freeze([ESS_KEY_TYPE_IDS.NW_15, ESS_KEY_TYPE_IDS.NW_45]),
  SE: Object.freeze([ESS_KEY_TYPE_IDS.SE_15, ESS_KEY_TYPE_IDS.SE_45]),
  SW: Object.freeze([ESS_KEY_TYPE_IDS.SW_15, ESS_KEY_TYPE_IDS.SW_45]),
});

// Region mappings follow the public reserve-key quadrants and source-jsonl
// mapRegions IDs for build 3396210. The keys themselves are source-backed SDE
// types; live availability still depends on authored/runtime content.
const REGION_QUADRANT_BY_ID = new Map([
  [10000053, "NE"], // Cobalt Edge
  [10000027, "NE"], // Etherium Reach
  [10000013, "NE"], // Malpais
  [10000040, "NE"], // Oasa
  [10000021, "NE"], // Outer Passage
  [10000066, "NE"], // Perrigen Falls
  [10000018, "NE"], // The Spire
  [10000007, "NE"], // Cache
  [10000055, "NW"], // Branch
  [10000035, "NW"], // Deklein
  [10000023, "NW"], // Pure Blind
  [10000045, "NW"], // Tenal
  [10000010, "NW"], // Tribute
  [10000051, "NW"], // Cloud Ring
  [10000046, "NW"], // Fade
  [10000058, "NW"], // Fountain
  [10000034, "NW"], // The Kalevala Expanse
  [10000003, "NW"], // Vale of the Silent
  [10000029, "SE"], // Geminate
  [10000005, "SE"], // Detorid
  [10000025, "SE"], // Immensea
  [10000009, "SE"], // Insmother
  [10000062, "SE"], // Omist
  [10000008, "SE"], // Scalding Pass
  [10000061, "SE"], // Tenerifis
  [10000006, "SE"], // Wicked Creek
  [10000056, "SW"], // Feythabolis
  [10000031, "SW"], // Impass
  [10000060, "SW"], // Delve
  [10000063, "SW"], // Period Basis
  [10000050, "SW"], // Querious
  [10000014, "SW"], // Catch
  [10000039, "SW"], // Esoteria
  [10000059, "SW"], // Paragon Soul
  [10000047, "SW"], // Providence
]);

const DEFAULT_DYNAMIC_RESOURCE_SETTINGS = Object.freeze({
  minOutput: 1.0,
  maxOutput: 2.0,
  equilibriumValue: 1.5,
  timeIntervalSeconds: 86400,
  bountiesCut: 0.4,
  mainBankPayRatio: 0.975,
  autopaymentIntervalSeconds: 9900,
  bufferTimeSeconds: 360,
  reservePulseIntervalSeconds: 60,
  reserveBankMaxPayout: 0,
  reserveBankTimeAccessFactor: 3,
  reserveWindowAccessFactor: 1.5,
  reservePayoutExponentLead: 2,
  reservePayoutExponentTail: 2,
  reservePayoutPaddingValue: 0,
  earlyPayoutThresholdFactor: 2 / 3,
  latePayoutThresholdFactor: 1 / 3,
});

const stateBySolarSystemID = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.round(numeric * 100) / 100);
}

function cloneSet(value) {
  return new Set(
    Array.isArray(value)
      ? value.map((entry) => toPositiveInt(entry, 0)).filter(Boolean)
      : value instanceof Set
        ? Array.from(value).map((entry) => toPositiveInt(entry, 0)).filter(Boolean)
        : [],
  );
}

function filetimeAfterSeconds(seconds) {
  return currentFileTime() + BigInt(Math.max(0, toInt(seconds, 0))) * FILETIME_TICKS_PER_SECOND;
}

function getSystemIDFromSession(session = null) {
  return toPositiveInt(
    session && (session.solarsystemid2 || session.solarsystemid),
    0,
  );
}

function getSystemIDFromArgsOrSession(args = [], session = null) {
  return toPositiveInt(
    args && args.length > 0 ? args[0] : getSystemIDFromSession(session),
    0,
  );
}

function getStaticSolarSystem(solarSystemID) {
  const numericSolarSystemID = toPositiveInt(solarSystemID, 0);
  if (!numericSolarSystemID) {
    return null;
  }
  return readStaticRows(TABLE.SOLAR_SYSTEMS).find(
    (system) => toPositiveInt(system && system.solarSystemID, 0) === numericSolarSystemID,
  ) || null;
}

function isKnownNullsecSystem(solarSystemID) {
  const system = getStaticSolarSystem(solarSystemID);
  return Boolean(
    system &&
    toPositiveInt(system.solarSystemID, 0) < 31000000 &&
    toNumber(system.security, 1) < 0,
  );
}

function resolveRegionQuadrant(solarSystemID) {
  const system = getStaticSolarSystem(solarSystemID);
  const regionID = toPositiveInt(system && system.regionID, 0);
  return REGION_QUADRANT_BY_ID.get(regionID) || null;
}

function listReserveKeyTypeIDsForSystem(solarSystemID) {
  const quadrant = resolveRegionQuadrant(solarSystemID);
  return quadrant ? [...ESS_RESERVE_KEY_TYPES_BY_QUADRANT[quadrant]] : [];
}

function getReserveKeyTotalPulses(typeID) {
  return ESS_RESERVE_KEY_TOTAL_PULSES[toPositiveInt(typeID, 0)] || 0;
}

function normalizeMainBankLink(link = null) {
  if (!link || typeof link !== "object") {
    return null;
  }
  const characterID = toPositiveInt(link.characterID, 0);
  if (!characterID) {
    return null;
  }
  return {
    linkID: String(link.linkID || randomUUID()),
    characterID,
    startedAt: link.startedAt || currentFileTime(),
    completesAt:
      link.completesAt ||
      filetimeAfterSeconds(DEFAULT_DYNAMIC_RESOURCE_SETTINGS.bufferTimeSeconds),
  };
}

function normalizeState(solarSystemID, source = {}) {
  const numericSolarSystemID = toPositiveInt(solarSystemID, 0);
  const essID = toPositiveInt(source.essID || source.essItemID, 0);
  return {
    solarSystemID: numericSolarSystemID,
    essID,
    beaconID: toPositiveInt(source.beaconID, essID || null),
    typeID: toPositiveInt(source.typeID, TYPE_ENCOUNTER_SURVEILLANCE_SYSTEM),
    currentOutput: toNumber(
      source.currentOutput,
      DEFAULT_DYNAMIC_RESOURCE_SETTINGS.equilibriumValue,
    ),
    mainValue: normalizeMoney(source.mainValue, 0),
    reserveValue: normalizeMoney(source.reserveValue, 0),
    mainBankLink: normalizeMainBankLink(source.mainBankLink),
    reserveBankLastPulseInitiated: source.reserveBankLastPulseInitiated || null,
    reserveBankPulsesTotal: Math.max(0, toInt(source.reserveBankPulsesTotal, 0)),
    reserveBankPulsesRemaining: Math.max(
      0,
      toInt(source.reserveBankPulsesRemaining, 0),
    ),
    reserveLinkedCharacterIDs: cloneSet(source.reserveLinkedCharacterIDs),
    theftHistoryMain: Array.isArray(source.theftHistoryMain)
      ? [...source.theftHistoryMain]
      : [],
    theftHistoryReserve: Array.isArray(source.theftHistoryReserve)
      ? [...source.theftHistoryReserve]
      : [],
  };
}

function setSystemState(solarSystemID, source = {}) {
  const numericSolarSystemID = toPositiveInt(solarSystemID, 0);
  if (!numericSolarSystemID) {
    return null;
  }
  const normalized = normalizeState(numericSolarSystemID, source);
  stateBySolarSystemID.set(numericSolarSystemID, normalized);
  return normalized;
}

function clearSystemState(solarSystemID) {
  stateBySolarSystemID.delete(toPositiveInt(solarSystemID, 0));
}

function getSystemState(solarSystemID) {
  return stateBySolarSystemID.get(toPositiveInt(solarSystemID, 0)) || null;
}

function listSystemStates() {
  return Array.from(stateBySolarSystemID.values())
    .filter((state) => state && toPositiveInt(state.solarSystemID, 0) > 0)
    .sort((left, right) => left.solarSystemID - right.solarSystemID);
}

function buildSettingsPayload() {
  return buildDict(Object.entries(DEFAULT_DYNAMIC_RESOURCE_SETTINGS));
}

function buildMainBankLinkPayload(link = null) {
  if (!link) {
    return null;
  }
  return buildDict([
    ["linkID", link.linkID],
    ["characterID", link.characterID],
    ["startedAt", buildFiletimeLong(link.startedAt)],
    ["completesAt", buildFiletimeLong(link.completesAt)],
  ]);
}

function buildEssDataPayload(state = null) {
  if (!state || !toPositiveInt(state.essID, 0)) {
    return null;
  }
  return buildDict([
    ["essID", state.essID],
    ["beaconID", state.beaconID || state.essID],
    ["typeID", state.typeID || TYPE_ENCOUNTER_SURVEILLANCE_SYSTEM],
    ["solarSystemID", state.solarSystemID],
    ["currentOutput", state.currentOutput],
    ["mainValue", state.mainValue],
    ["reserveValue", state.reserveValue],
    ["mainBankLink", buildMainBankLinkPayload(state.mainBankLink)],
    [
      "reserveBankLastPulseInitiated",
      state.reserveBankLastPulseInitiated
        ? buildFiletimeLong(state.reserveBankLastPulseInitiated)
        : null,
    ],
    ["reserveBankPulsesRemaining", state.reserveBankPulsesRemaining],
    ["reserveBankPulsesTotal", state.reserveBankPulsesTotal],
    ["reserveBankActiveLinks", state.reserveLinkedCharacterIDs.size],
  ]);
}

function buildAgencySystemPayload(state) {
  return buildDict([
    ["currentOutput", state.currentOutput],
    ["mainValue", state.mainValue],
    ["reserveValue", state.reserveValue],
    ["vaultOpen", state.reserveBankPulsesRemaining > 0],
  ]);
}

function buildAgencyDataPayload() {
  return buildDict(
    listSystemStates()
      .filter((state) => toPositiveInt(state.essID, 0) > 0)
      .map((state) => [state.solarSystemID, buildAgencySystemPayload(state)]),
  );
}

function buildDbsMapDataPayload() {
  return buildDict(
    listSystemStates()
      .filter((state) => toNumber(state.currentOutput, 0) > 0)
      .map((state) => [state.solarSystemID, state.currentOutput]),
  );
}

function deriveReserveWindowState(state = null) {
  if (!state || state.reserveBankPulsesRemaining <= 0 || state.reserveBankPulsesTotal <= 0) {
    return ESS_RESERVE_WINDOW_STATE_INACTIVE;
  }
  const currentPulse =
    state.reserveBankPulsesTotal - state.reserveBankPulsesRemaining + 1;
  const windowSize =
    state.reserveBankPulsesTotal /
    DEFAULT_DYNAMIC_RESOURCE_SETTINGS.reserveWindowAccessFactor;
  if (currentPulse < windowSize) {
    return ESS_RESERVE_WINDOW_STATE_EARLY;
  }
  if (currentPulse === Math.round(windowSize)) {
    return ESS_RESERVE_WINDOW_STATE_BEST;
  }
  return ESS_RESERVE_WINDOW_STATE_LATE;
}

function deriveAutopaymentWindowState(state = null) {
  if (!state || state.mainValue <= 0) {
    return ESS_AUTOPAY_STATE_LONG;
  }
  if (state.mainBankLink) {
    return ESS_AUTOPAY_STATE_SHORT;
  }
  return ESS_AUTOPAY_STATE_MEDIUM;
}

function buildEssSystemDetailsPayload(solarSystemID) {
  const state = getSystemState(solarSystemID);
  const reserveWindowState = deriveReserveWindowState(state);
  return buildDict([
    ["autopaymentWindowState", deriveAutopaymentWindowState(state)],
    ["activeLinks", state ? state.reserveLinkedCharacterIDs.size + (state.mainBankLink ? 1 : 0) : 0],
    ["totalPulses", state ? state.reserveBankPulsesTotal : 0],
    ["reserveTimeWindowState", reserveWindowState],
    [
      "reserveTimeChosen",
      state && reserveWindowState !== ESS_RESERVE_WINDOW_STATE_INACTIVE
        ? state.reserveBankPulsesTotal * 60
        : 0,
    ],
  ]);
}

function buildReserveKeyTypeIDListPayload(solarSystemID) {
  return buildList(listReserveKeyTypeIDsForSystem(solarSystemID));
}

function buildTheftHistoryPayload(entries = []) {
  return buildList(entries);
}

function attemptMainBankLink(solarSystemID, characterID) {
  const state = getSystemState(solarSystemID);
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!state || !state.essID || !normalizedCharacterID) {
    return { success: false, state };
  }
  state.mainBankLink = {
    linkID: randomUUID(),
    characterID: normalizedCharacterID,
    startedAt: currentFileTime(),
    completesAt: filetimeAfterSeconds(DEFAULT_DYNAMIC_RESOURCE_SETTINGS.bufferTimeSeconds),
  };
  return { success: true, state };
}

function requestMainBankUnlink(solarSystemID) {
  const state = getSystemState(solarSystemID);
  if (!state || !state.mainBankLink) {
    return { success: false, state, link: null };
  }
  const link = state.mainBankLink;
  state.mainBankLink = null;
  return { success: true, state, link };
}

function unlockReserveBank(solarSystemID, keyTypeID) {
  const state = getSystemState(solarSystemID);
  const pulses = getReserveKeyTotalPulses(keyTypeID);
  if (!state || !state.essID || pulses <= 0) {
    return { success: false, state, pulses: 0 };
  }
  state.reserveBankPulsesTotal = pulses;
  state.reserveBankPulsesRemaining = pulses;
  state.reserveBankLastPulseInitiated = currentFileTime();
  return { success: true, state, pulses };
}

function attemptReserveBankLink(solarSystemID, characterID) {
  const state = getSystemState(solarSystemID);
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (
    !state ||
    !state.essID ||
    state.reserveBankPulsesRemaining <= 0 ||
    !normalizedCharacterID
  ) {
    return { success: false, state };
  }
  state.reserveLinkedCharacterIDs.add(normalizedCharacterID);
  return { success: true, state };
}

function requestReserveBankUnlink(solarSystemID, characterID = 0) {
  const state = getSystemState(solarSystemID);
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!state || !normalizedCharacterID) {
    return { success: false, state };
  }
  const wasLinked = state.reserveLinkedCharacterIDs.delete(normalizedCharacterID);
  return { success: wasLinked, state };
}

function isCharacterLinkedToReserveBank(solarSystemID, characterID) {
  const state = getSystemState(solarSystemID);
  return Boolean(
    state &&
    state.reserveLinkedCharacterIDs.has(toPositiveInt(characterID, 0)),
  );
}

function resetForTests() {
  stateBySolarSystemID.clear();
  clearReferenceCache(TABLE.SOLAR_SYSTEMS);
}

module.exports = {
  TYPE_ENCOUNTER_SURVEILLANCE_SYSTEM,
  ESS_AUTOPAY_STATE_LONG,
  ESS_AUTOPAY_STATE_MEDIUM,
  ESS_AUTOPAY_STATE_SHORT,
  ESS_RESERVE_WINDOW_STATE_INACTIVE,
  ESS_RESERVE_WINDOW_STATE_EARLY,
  ESS_RESERVE_WINDOW_STATE_BEST,
  ESS_RESERVE_WINDOW_STATE_LATE,
  UNLINKED_MANUAL,
  DEFAULT_DYNAMIC_RESOURCE_SETTINGS,
  ESS_KEY_TYPE_IDS,
  ESS_RESERVE_KEY_TOTAL_PULSES,
  getSystemIDFromArgsOrSession,
  getSystemIDFromSession,
  getStaticSolarSystem,
  isKnownNullsecSystem,
  listReserveKeyTypeIDsForSystem,
  setSystemState,
  clearSystemState,
  getSystemState,
  listSystemStates,
  buildSettingsPayload,
  buildEssDataPayload,
  buildAgencyDataPayload,
  buildDbsMapDataPayload,
  buildEssSystemDetailsPayload,
  buildReserveKeyTypeIDListPayload,
  buildTheftHistoryPayload,
  attemptMainBankLink,
  requestMainBankUnlink,
  unlockReserveBank,
  attemptReserveBankLink,
  requestReserveBankUnlink,
  isCharacterLinkedToReserveBank,
  _testing: {
    resetForTests,
    filetimeAfterSeconds,
    deriveAutopaymentWindowState,
    deriveReserveWindowState,
  },
};
