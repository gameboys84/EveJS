const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedObject } = require(path.join(__dirname, "../../common/machoErrors"));
const {
  getCharacterRecord,
  resolveHomeStationInfo,
  updateCharacterRecord,
} = require(path.join(__dirname, "./characterState"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  buildList,
  buildObjectEx2,
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  getCorporationOffices,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  resolveCharacterCreationSchoolProfile,
} = require(path.join(__dirname, "./characterCreationData"));

const CHANGE_HOME_STATION_ERROR = "homestation.validation.ChangeHomeStationValidationError";
const REMOTE_CHANGE_NOT_EXPECTED_ERROR = "homestation.error.RemoteChangeNotExpectedError";
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MILLISECOND = 10000n;
const REMOTE_CHANGE_COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;
const CHANGE_HOME_STATION_VALIDATION = Object.freeze({
  UNHANDLED_EXCEPTION: 0,
  STATION_IN_WORMHOLE: 1,
  ALREADY_SET_AS_HOME_STATION: 2,
  REMOTE_COOLDOWN: 3,
  FAC_WAR_ENEMY_STATION: 4,
  INVALID_CANDIDATE: 5,
  TRIGLAVIAN_SYSTEM: 6,
});

function resolveStation(session, args) {
  const charID =
    args && args.length > 0 ? Number(args[0] || 0) : Number(session && session.characterID);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  const homeStationInfo = resolveHomeStationInfo(charData, session);

  return {
    station: getStationRecord(session, homeStationInfo.homeStationID),
    homeStationInfo,
  };
}

function buildHomeStationPayload(station, homeStationInfo = {}) {
  return buildObjectEx2("homestation.types.StationData", [
    ["is_fallback", Boolean(homeStationInfo.isFallback)],
    ["solar_system_id", Number(station.solarSystemID) || 0],
    ["id", Number(station.stationID) || 0],
    ["type_id", Number(station.stationTypeID) || 0],
  ]);
}

function resolveCharacterID(session) {
  return Number(session && (session.characterID || session.charid) || 0) || 0;
}

function resolveDockedStationID(session, charData = {}) {
  return Number(
    (session && (session.stationID || session.stationid)) ||
      charData.stationID ||
      0,
  ) || 0;
}

function resolveSchoolHQStationID(charData = {}, session = null) {
  const schoolID = Number(
    charData.schoolID ||
      (session && (session.schoolID || session.schoolid)) ||
      0,
  ) || 0;
  const schoolProfile = resolveCharacterCreationSchoolProfile(schoolID, {
    raceID: charData.raceID || (session && (session.raceID || session.raceid)),
    corporationID: charData.corporationID,
  });
  const startingStationID = Number(
    schoolProfile.startingStations && schoolProfile.startingStations[0],
  ) || 0;
  if (startingStationID && getStationRecord(session, startingStationID)) {
    return startingStationID;
  }
  const schoolCorporationID = Number(schoolProfile.corporationID) || 0;
  if (!schoolCorporationID) {
    return 0;
  }
  const schoolCorporation = getCorporationRecord(schoolCorporationID);
  return Number(schoolCorporation && schoolCorporation.stationID || 0) || 0;
}

function buildStationCandidatePayload(station, options = {}) {
  return buildObjectEx2("homestation.types.StationCandidateData", [
    ["errors", buildList(Array.isArray(options.errors) ? options.errors : [])],
    ["solar_system_id", Number(station.solarSystemID) || 0],
    ["type_id", Number(station.stationTypeID) || 0],
    ["is_current_station", options.isCurrentStation === true],
    ["is_school_hq", options.isSchoolHQ === true],
    ["id", Number(station.stationID) || 0],
  ]);
}

function getRemoteChangeFileTime(charData = {}) {
  return normalizeBigInt(charData.nextRemoteHomeStationChangeTime, 0n);
}

function hasActiveRemoteChangeCooldown(charData = {}, nowFileTime = currentFileTime()) {
  return getRemoteChangeFileTime(charData) > normalizeBigInt(nowFileTime, currentFileTime());
}

function addCandidateValidationErrors(errors, stationID, context = {}) {
  const nextErrors = Array.isArray(errors) ? [...errors] : [];
  if (Number(stationID) === Number(context.homeStationID || 0)) {
    nextErrors.push(CHANGE_HOME_STATION_VALIDATION.ALREADY_SET_AS_HOME_STATION);
  }
  if (
    nextErrors.length === 0 &&
    context.remoteCooldownActive === true &&
    isRemoteStationCandidate(stationID, context)
  ) {
    nextErrors.push(CHANGE_HOME_STATION_VALIDATION.REMOTE_COOLDOWN);
  }
  return nextErrors;
}

function isRemoteStationCandidate(stationID, context = {}) {
  return Number(stationID || 0) > 0 &&
    Number(stationID || 0) !== Number(context.currentStationID || 0) &&
    Number(stationID || 0) !== Number(context.schoolHQStationID || 0);
}

function collectHomeStationCandidates(session) {
  const charID = resolveCharacterID(session);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  const homeStationInfo = resolveHomeStationInfo(charData, session);
  const currentStationID = resolveDockedStationID(session, charData);
  const schoolHQStationID = resolveSchoolHQStationID(charData, session);
  const remoteCooldownActive = hasActiveRemoteChangeCooldown(charData);
  const corporationID = Number(
    charData.corporationID ||
      (session && (session.corporationID || session.corpid)) ||
      0,
  ) || 0;
  const officeStationIDs = getCorporationOffices(corporationID)
    .map((office) => Number(office && office.stationID || 0) || 0)
    .filter((stationID) => stationID > 0);

  const orderedStationIDs = [
    currentStationID,
    schoolHQStationID,
    ...officeStationIDs,
  ].filter((stationID, index, array) => (
    stationID > 0 && array.indexOf(stationID) === index
  ));

  return orderedStationIDs
    .map((stationID) => getStationRecord(session, stationID))
    .filter(Boolean)
    .map((station) => {
      const stationID = Number(station.stationID) || 0;
      const isCurrentStation = stationID === currentStationID;
      const isSchoolHQ = stationID === schoolHQStationID;
      return {
        station,
        isCurrentStation,
        isSchoolHQ,
        errors: addCandidateValidationErrors([], stationID, {
          currentStationID,
          schoolHQStationID,
          homeStationID: homeStationInfo.homeStationID,
          remoteCooldownActive,
        }),
      };
    });
}

function buildHomeStationCandidatePayloads(session) {
  return collectHomeStationCandidates(session).map((candidate) => (
    buildStationCandidatePayload(candidate.station, {
      isCurrentStation: candidate.isCurrentStation,
      isSchoolHQ: candidate.isSchoolHQ,
      errors: candidate.errors,
    })
  ));
}

function resolveAllowedHomeStationIDs(session) {
  return new Set(collectHomeStationCandidates(session).map((candidate) => (
    Number(candidate && candidate.station && candidate.station.stationID || 0) || 0
  )).filter((stationID) => stationID > 0));
}

function isRemoteHomeStationChange(stationID, session, charData = {}) {
  const currentStationID = resolveDockedStationID(session, charData);
  const schoolHQStationID = resolveSchoolHQStationID(charData, session);
  return isRemoteStationCandidate(stationID, {
    currentStationID,
    schoolHQStationID,
  });
}

function throwHomeStationValidation(errors = []) {
  throwWrappedObject(
    CHANGE_HOME_STATION_ERROR,
    [Array.isArray(errors) ? errors : []],
    {
      errors: Array.isArray(errors) ? errors : [],
    },
  );
}

function setSessionHomeStation(session, stationID) {
  if (!session || typeof session !== "object") {
    return;
  }
  const numericStationID = Number(stationID || 0) || 0;
  session.homeStationID = numericStationID;
  session.homestationid = numericStationID;
  session.cloneStationID = numericStationID;
  session.clonestationid = numericStationID;
  if (typeof session.sendNotification === "function") {
    session.sendNotification("OnHomeStationChanged", "charid", [numericStationID]);
  }
}

function fileTimeFromMs(milliseconds) {
  const normalizedMilliseconds = Number.isFinite(Number(milliseconds))
    ? Math.trunc(Number(milliseconds))
    : Date.now();
  return BigInt(normalizedMilliseconds) * FILETIME_TICKS_PER_MILLISECOND +
    FILETIME_EPOCH_OFFSET;
}

function msFromFileTime(fileTime) {
  const normalizedFileTime = normalizeBigInt(fileTime, 0n);
  if (normalizedFileTime <= FILETIME_EPOCH_OFFSET) {
    return 0;
  }
  return Number((normalizedFileTime - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MILLISECOND);
}

function buildPythonDatetimePickle(date) {
  const normalizedDate = date instanceof Date && Number.isFinite(date.getTime())
    ? date
    : new Date();
  const year = normalizedDate.getUTCFullYear();
  const month = normalizedDate.getUTCMonth() + 1;
  const day = normalizedDate.getUTCDate();
  const hour = normalizedDate.getUTCHours();
  const minute = normalizedDate.getUTCMinutes();
  const second = normalizedDate.getUTCSeconds();
  const microsecond = normalizedDate.getUTCMilliseconds() * 1000;
  const datetimeBytes = Buffer.from([
    (year >> 8) & 0xff,
    year & 0xff,
    month & 0xff,
    day & 0xff,
    hour & 0xff,
    minute & 0xff,
    second & 0xff,
    (microsecond >> 16) & 0xff,
    (microsecond >> 8) & 0xff,
    microsecond & 0xff,
  ]);
  const datetimeUnicodeBytes = Buffer.from(datetimeBytes.toString("latin1"), "utf8");
  const datetimeLength = Buffer.alloc(4);
  datetimeLength.writeUInt32LE(datetimeUnicodeBytes.length, 0);
  const encodingLength = Buffer.alloc(4);
  encodingLength.writeUInt32LE(6, 0);

  return Buffer.concat([
    Buffer.from([0x80, 0x02]),
    Buffer.from("cdatetime\ndatetime\nq\0c_codecs\nencode\nq\1X", "latin1"),
    datetimeLength,
    datetimeUnicodeBytes,
    Buffer.from("q\2X", "latin1"),
    encodingLength,
    Buffer.from("latin1q\3", "latin1"),
    Buffer.from([0x86]),
    Buffer.from("q\4Rq\5", "latin1"),
    Buffer.from([0x85]),
    Buffer.from("q\6Rq\7.", "latin1"),
  ]);
}

function buildPythonDatetimePayloadFromFileTime(fileTime) {
  const milliseconds = msFromFileTime(fileTime);
  if (!milliseconds) {
    return null;
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return {
    type: "cpicked",
    data: buildPythonDatetimePickle(date),
  };
}

function getNextRemoteChangeTime(session) {
  const charID = resolveCharacterID(session);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  if (!hasActiveRemoteChangeCooldown(charData)) {
    return null;
  }
  return buildPythonDatetimePayloadFromFileTime(getRemoteChangeFileTime(charData));
}

function resetRemoteChangeTime(session) {
  const charID = resolveCharacterID(session);
  if (!charID) {
    return null;
  }
  updateCharacterRecord(charID, (record) => {
    const nextRecord = { ...record };
    delete nextRecord.lastRemoteHomeStationChangeTime;
    delete nextRecord.nextRemoteHomeStationChangeTime;
    return nextRecord;
  });
  return null;
}

function setHomeStation(session, stationID, allowRemote = false) {
  const charID = resolveCharacterID(session);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  if (!charID || !charData || !Object.keys(charData).length) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.INVALID_CANDIDATE]);
  }

  const numericStationID = Number(stationID || 0) || 0;
  const station = getStationRecord(session, numericStationID);
  if (!numericStationID || !station) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.INVALID_CANDIDATE]);
  }

  const allowedStationIDs = resolveAllowedHomeStationIDs(session);
  if (!allowedStationIDs.has(numericStationID)) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.INVALID_CANDIDATE]);
  }

  const currentHomeStationID = Number(charData.homeStationID || charData.cloneStationID || 0) || 0;
  if (numericStationID === currentHomeStationID) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.ALREADY_SET_AS_HOME_STATION]);
  }

  const isRemoteChange = isRemoteHomeStationChange(numericStationID, session, charData);
  if (isRemoteChange && allowRemote !== true) {
    throwWrappedObject(REMOTE_CHANGE_NOT_EXPECTED_ERROR, [], { msg: "RemoteChangeNotExpectedError" });
  }

  if (isRemoteChange && hasActiveRemoteChangeCooldown(charData)) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.REMOTE_COOLDOWN]);
  }

  const changeFileTime = currentFileTime();
  const cooldownFileTime = fileTimeFromMs(
    msFromFileTime(changeFileTime) + REMOTE_CHANGE_COOLDOWN_MS,
  );
  const updateResult = updateCharacterRecord(charID, (record) => ({
    ...record,
    homeStationID: numericStationID,
    cloneStationID: numericStationID,
    ...(isRemoteChange
      ? {
          lastRemoteHomeStationChangeTime: changeFileTime.toString(),
          nextRemoteHomeStationChangeTime: cooldownFileTime.toString(),
        }
      : {}),
  }));
  if (!updateResult || updateResult.success !== true) {
    throwHomeStationValidation([CHANGE_HOME_STATION_VALIDATION.UNHANDLED_EXCEPTION]);
  }

  setSessionHomeStation(session, numericStationID);
  return null;
}

class HomeStationServiceBase extends BaseService {
  constructor(name) {
    super(name);
  }

  Handle_get_home_station(args, session) {
    const { station, homeStationInfo } = resolveStation(session, args);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_getHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_get_home_station_candidates(args, session) {
    return buildHomeStationCandidatePayloads(session);
  }

  Handle_getHomeStationCandidates(args, session) {
    return this.Handle_get_home_station_candidates(args, session);
  }

  Handle_get_next_remote_change_time(args, session) {
    return getNextRemoteChangeTime(session);
  }

  Handle_getNextRemoteChangeTime(args, session) {
    return this.Handle_get_next_remote_change_time(args, session);
  }

  Handle_set_home_station(args, session) {
    return setHomeStation(
      session,
      args && args.length > 0 ? args[0] : null,
      args && args.length > 1 ? args[1] === true : false,
    );
  }

  Handle_setHomeStation(args, session) {
    return this.Handle_set_home_station(args, session);
  }

  Handle_reset_remote_change_time(args, session) {
    return resetRemoteChangeTime(session);
  }

  Handle_resetRemoteChangeTime(args, session) {
    return this.Handle_reset_remote_change_time(args, session);
  }

  Handle_ResetRemoteChangeTime(args, session) {
    return this.Handle_reset_remote_change_time(args, session);
  }
}

class HomeStationService extends HomeStationServiceBase {
  constructor() {
    super("home_station");
  }
}

class HomestationService extends HomeStationServiceBase {
  constructor() {
    super("homestation");
  }
}

class HomeStationCamelService extends HomeStationServiceBase {
  constructor() {
    super("homeStation");
  }
}

module.exports = {
  HomeStationService,
  HomestationService,
  HomeStationCamelService,
};
