const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  buildDict,
} = require("../_shared/serviceHelpers");
const {
  getCharacterRecord,
} = require("./characterState");

const GOLDEN_LOGIN_EVENT_COUNT_ENTRIES = [
  ["client_activateAutopilot", 1n],
  ["client_activateSalvager", 0],
  ["client_orbitHostileNPC", 0],
  ["client_spinCamera", 1n],
  ["client_loadBlueprint", 0],
  ["client_openCorpFinder", 1n],
  ["client_lockHostileNPC", 0],
  ["client_lockAsteroid", 1n],
  ["client_openAgency", 0],
  ["client_orbitAsteroid", 0],
  ["client_openMap", 0],
  ["client_mouseZoom_out", 2n],
  ["client_lootItems", 0],
  ["client_jumpToNextSystemInRoute", 1n],
  ["client_moveItemFromCargoToHangar", 0],
  ["client_lookAtOwnShip", 1n],
  ["client_setDestination", 1n],
  ["client_chatMessageSent", 1n],
  ["client_lookAtObject", 0],
  ["client_mouseZoom_in", 1n],
  ["client_activateGun", 0],
  ["client_unfitItem", 1n],
  ["client_launchProbes", 0],
  ["client_bookmarkWormhole", 0],
  ["client_reachPerfectScanResult", 0],
  ["client_approach", 1n],
  ["client_doubleClickInSpace", 1n],
];

const GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES = [
  [9, 134273341290000000n],
  [10, 134273362100000000n],
  [16, 134273340850000000n],
  [17, 134275738980000000n],
  [19, 134273338030000000n],
  [23, 134273885480000000n],
  [24, 134273340010000000n],
  [25, 134275807650000000n],
  [26, 134275807630000000n],
  [32, 134275740590000000n],
  [38, 134273353790000000n],
  [44, 134273340760000000n],
  [45, 134273341230000000n],
  [46, 134273342370000000n],
  [47, 134275773470000000n],
  [48, 134275740590000000n],
  [49, 134275755390000000n],
  [50, 134276054820000000n],
  [53, 134273364720000000n],
  [57, 134275751230000000n],
  [60, 134273341380000000n],
  [61, 134273340480000000n],
  [64, 134273331600000000n],
  [66, 134273331580000000n],
  [72, 134275770810000000n],
  [73, 134275750180000000n],
];

function cloneEntries(entries) {
  return Array.isArray(entries)
    ? entries.map(([key, value]) => [key, value])
    : [];
}

function normalizeDictEntries(source, fallbackEntries) {
  if (source && source.type === "dict" && Array.isArray(source.entries)) {
    return cloneEntries(source.entries);
  }
  if (source instanceof Map) {
    return Array.from(source.entries());
  }
  if (Array.isArray(source)) {
    return cloneEntries(source);
  }
  if (source && typeof source === "object") {
    return Object.entries(source).map(([key, value]) => {
      const numericKey = Number(key);
      return [
        Number.isFinite(numericKey) && String(numericKey) === key
          ? numericKey
          : key,
        value,
      ];
    });
  }
  return cloneEntries(fallbackEntries);
}

function resolveAchievementState(session) {
  const characterID =
    Number(session && (session.characterID || session.charID || session.charid)) || 0;
  const characterRecord = characterID ? getCharacterRecord(characterID) : null;
  return (
    (session && session.achievementState) ||
    (characterRecord && characterRecord.achievementState) ||
    null
  );
}

function extractOptionalBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0" || value === "") {
      return false;
    }
  }
  return null;
}

class AchievementTrackerMgrService extends BaseService {
  constructor(serviceName = "achievementTrackerMgr") {
    super(serviceName);
  }

  Handle_HasEverWarped(args, session) {
    void args;
    const characterID =
      Number(session && (session.characterID || session.charID || session.charid)) || 0;
    const explicitValue =
      extractOptionalBoolean(session && session.hasEverWarped) ??
      extractOptionalBoolean(session && session.everWarped) ??
      extractOptionalBoolean(
        session &&
          session.achievementState &&
          session.achievementState.hasEverWarped,
      );
    if (explicitValue !== null) {
      return explicitValue;
    }

    const characterRecord = characterID ? getCharacterRecord(characterID) : null;
    const persistedValue = extractOptionalBoolean(
      characterRecord &&
        characterRecord.achievementState &&
        characterRecord.achievementState.hasEverWarped,
    );
    return persistedValue ?? true;
  }

  Handle_GetCompletedAchievementsAndClientEventCount(args, session) {
    log.debug(
      "[AchievementTrackerMgr] GetCompletedAchievementsAndClientEventCount called",
    );
    const state = resolveAchievementState(session);
    const eventEntries = normalizeDictEntries(
      state && (state.eventDict || state.eventCounts || state.clientEventCounts),
      GOLDEN_LOGIN_EVENT_COUNT_ENTRIES,
    );
    const completedEntries = normalizeDictEntries(
      state && (state.completedDict || state.completedAchievements),
      GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES,
    );
    return buildDict([
      ["eventDict", buildDict(eventEntries)],
      ["completedDict", buildDict(completedEntries)],
    ]);
  }

  Handle_UpdateClientAchievmentsAndCounters(args, session) {
    log.debug(
      "[AchievementTrackerMgr] UpdateClientAchievmentsAndCounters called",
    );
    return null;
  }
}

AchievementTrackerMgrService._testing = {
  GOLDEN_LOGIN_EVENT_COUNT_ENTRIES,
  GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES,
};

module.exports = AchievementTrackerMgrService;
