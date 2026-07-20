/**
 * Map Service
 *
 * Handles map-related queries from the client.
 * The character selection screen calls GetSecurityModifiedSystems()
 * to display modified security status next to solar system names.
 */

const path = require("path");
const fs = require("fs");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildStationServiceMask,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  resolveSystemCostIndex,
} = require(path.join(__dirname, "../industry/industrySystemCostIndex"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const planetOrbitalState = require(path.join(
  __dirname,
  "../planet/planetOrbitalState",
));
const {
  listCurrentSovData,
  listRecentSovActivity,
} = require(path.join(__dirname, "../sovereignty/sovState"));
const {
  buildCurrentSovDataPayload,
  buildRecentSovActivityPayload,
} = require(path.join(__dirname, "../sovereignty/sovPayloads"));
const incursionRuntime = require(path.join(
  __dirname,
  "../incursion/incursionRuntime",
));
const {
  buildIncursionGlobalReport,
  buildSystemsInIncursionsRowset,
} = require(path.join(__dirname, "../incursion/incursionPayloads"));
const {
  getAllKillmailRecords,
} = require(path.join(__dirname, "../killmail/killmailState"));
const mapTelemetryState = require(path.join(__dirname, "./mapTelemetryState"));
const fleetHelpers = require(path.join(__dirname, "../fleets/fleetHelpers"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const {
  listIndustryJobsOverLast24Hours,
} = require(path.join(__dirname, "../industry/industryRuntimeState"));

const MAP_ROWSET = "eve.common.script.sys.rowset.Rowset";
const HISTORY_COLUMNS = Object.freeze(["solarSystemID", "value1", "value2", "value3"]);
const VISITS_COLUMNS = Object.freeze(["lastDateTime", "solarSystemID", "visits"]);
const MAP_HISTORY_STAT_JUMPS = 1;
const MAP_HISTORY_STAT_KILLS = 3;
const MAP_HISTORY_STAT_FACWAR_KILLS = 5;
const CAPSULE_TYPE_ID = 670;
const FACTION_CALDARI_STATE = 500001;
const FACTION_MINMATAR_REPUBLIC = 500002;
const FACTION_AMARR_EMPIRE = 500003;
const FACTION_GALLENTE_FEDERATION = 500004;
const FACTION_GURISTAS_PIRATES = 500010;
const FACTION_ANGEL_CARTEL = 500011;
const FW_FACTION_IDS = new Set([
  FACTION_CALDARI_STATE,
  FACTION_MINMATAR_REPUBLIC,
  FACTION_AMARR_EMPIRE,
  FACTION_GALLENTE_FEDERATION,
  FACTION_GURISTAS_PIRATES,
  FACTION_ANGEL_CARTEL,
]);
const TRIGLAVIAN_MINOR_VICTORY_SYSTEMS = Object.freeze([
  30003073, 30003076, 30003464, 30002575, 30003856, 30045331, 30004244,
  30001685, 30045338, 30045345, 30000163, 30001447, 30045354, 30000182,
  30002760, 30000205, 30001358, 30005330, 30002771, 30002645, 30001383,
  30002795, 30001390, 30001391, 30004981, 30001400, 30001401, 30002557,
]);
const EDENCOM_FORTRESS_SYSTEMS = Object.freeze([
  30004992, 30005251, 30000004, 30000005, 30004103, 30045322, 30002700,
  30005058, 30004141, 30002704, 30004248, 30004100, 30004250, 30003490,
  30002986, 30003883, 30003885, 30004150, 30003514, 30003515, 30000188,
  30005252, 30003392, 30002242, 30002243, 30003397, 30003398, 30005052,
  30005260, 30002251, 30002253, 30002385, 30002386, 30003539, 30003541,
  30002266, 30002651, 30003548, 30003553, 30002530, 30003556, 30003574,
  30002662, 30004305, 30000105, 30003050, 30004973, 30000113, 30004084,
  30003573, 30000118, 30002665, 30004090,
]);
const EDENCOM_MINOR_VICTORY_SYSTEMS = Object.freeze([
  30002048, 30003074, 30002051, 30003460, 30003078, 30003463, 30000012,
  30003854, 30005263, 30003088, 30003090, 30003587, 30003478, 30003480,
  30003481, 30003482, 30004254, 30000160, 30004257, 30003931, 30002724,
  30004263, 30005034, 30004231, 30004268, 30003570, 30004284, 30000048,
  30005308, 30004999, 30001718, 30002999, 30005222, 30000060, 30005066,
  30000062, 30002239, 30003904, 30001696, 30005074, 30002755, 30003908,
  30003894, 30004289, 30004295, 30005213, 30004108, 30002506, 30003788,
  30004301, 30003918, 30003829, 30002513, 30003794, 30002644, 30004302,
  30005334, 30003927, 30005255, 30005209, 30003919, 30003932, 30002397,
  30005086, 30001376, 30003809, 30005219, 30003558, 30000102, 30004256,
  30003900, 30000109, 30002241, 30003823, 30003824, 30003058, 30004978,
  30005236, 30003061, 30005267, 30002772, 30004287, 30001660, 30005284,
]);
const INDUSTRY_JOBS_COLUMNS = Object.freeze(["solarSystemID", "noOfJobs"]);
const CORP_MEMBER_COLUMNS = Object.freeze(["characterID", "locationID"]);
const AGENT_STANDING_COLUMNS = Object.freeze(["fromID", "rank"]);
const FW_LP_COLUMNS = Object.freeze(["solarSystemID", "loyaltyPoints"]);
const ROAMING_WEATHER_COLUMNS = Object.freeze(["locationID", "sceneType"]);
const SOLAR_SYSTEM_ITEM_COLUMNS = Object.freeze([
  "groupID",
  "typeID",
  "itemID",
  "itemName",
  "locationID",
  "orbitID",
  "connector",
  "x",
  "y",
  "z",
  "celestialIndex",
  "orbitIndex",
]);
let knownSpaceSystemIDsCache = null;
let itemTypeByIDCache = null;

function toPositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.trunc(numeric);
}

function buildEmptyRowset(columns) {
  return buildRowset(columns, [], MAP_ROWSET);
}

function getSessionCharacterID(session) {
  return Number(session && (session.characterID || session.charid || session.userid)) || 0;
}

function getItemTypeByID(typeID) {
  if (!itemTypeByIDCache) {
    itemTypeByIDCache = new Map();
    for (const row of readStaticRows(TABLE.ITEM_TYPES)) {
      const rowTypeID = toPositiveInteger(row && row.typeID, 0);
      if (rowTypeID) {
        itemTypeByIDCache.set(rowTypeID, row);
      }
    }
  }
  return itemTypeByIDCache.get(toPositiveInteger(typeID, 0)) || null;
}

function isKnownShipOrCapsuleType(typeID) {
  const numericTypeID = toPositiveInteger(typeID, 0);
  if (numericTypeID <= 0) {
    return false;
  }
  if (numericTypeID === CAPSULE_TYPE_ID) {
    return true;
  }
  const typeRecord = getItemTypeByID(numericTypeID);
  if (!typeRecord) {
    return true;
  }
  return toPositiveInteger(typeRecord.categoryID, 0) === 6;
}

function isFactionWarfareFactionID(factionID) {
  return FW_FACTION_IDS.has(toPositiveInteger(factionID, 0));
}

function listKillHistoryRows(hours, nowMs = Date.now()) {
  const windowHours = Math.max(1, Math.min(24, toPositiveInteger(hours, 1)));
  const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;
  const countsBySystemID = new Map();

  for (const record of getAllKillmailRecords()) {
    const solarSystemID = toPositiveInteger(record && record.solarSystemID, 0);
    const victimShipTypeID = toPositiveInteger(record && record.victimShipTypeID, 0);
    if (solarSystemID <= 0 || !isKnownShipOrCapsuleType(victimShipTypeID)) {
      continue;
    }

    const killTimeMs = mapTelemetryState.msFromFiletime(record && record.killTime, 0);
    if (killTimeMs <= 0 || killTimeMs < cutoffMs || killTimeMs > nowMs + 60000) {
      continue;
    }

    const current = countsBySystemID.get(solarSystemID) || {
      totalShipKills: 0,
      factionKills: 0,
      podKills: 0,
    };
    if (victimShipTypeID === CAPSULE_TYPE_ID) {
      current.podKills += 1;
    } else if (toPositiveInteger(record && record.victimCharacterID, 0) > 0) {
      current.totalShipKills += 1;
    } else {
      current.totalShipKills += 1;
      current.factionKills += 1;
    }
    countsBySystemID.set(solarSystemID, current);
  }

  return [...countsBySystemID.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([solarSystemID, counts]) => [
      solarSystemID,
      counts.totalShipKills,
      counts.factionKills,
      counts.podKills,
    ]);
}

function listFactionWarfareKillHistoryRows(hours, nowMs = Date.now()) {
  const windowHours = Math.max(1, Math.min(24, toPositiveInteger(hours, 1)));
  const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;
  const countsBySystemID = new Map();

  for (const record of getAllKillmailRecords()) {
    const solarSystemID = toPositiveInteger(record && record.solarSystemID, 0);
    const victimShipTypeID = toPositiveInteger(record && record.victimShipTypeID, 0);
    if (
      solarSystemID <= 0 ||
      victimShipTypeID === CAPSULE_TYPE_ID ||
      !isKnownShipOrCapsuleType(victimShipTypeID) ||
      !isFactionWarfareFactionID(record && record.victimFactionID)
    ) {
      continue;
    }

    const killTimeMs = mapTelemetryState.msFromFiletime(record && record.killTime, 0);
    if (killTimeMs <= 0 || killTimeMs < cutoffMs || killTimeMs > nowMs + 60000) {
      continue;
    }

    const current = countsBySystemID.get(solarSystemID) || {
      totalShipKills: 0,
      factionKills: 0,
    };
    current.totalShipKills += 1;
    if (toPositiveInteger(record && record.victimCharacterID, 0) <= 0) {
      current.factionKills += 1;
    }
    countsBySystemID.set(solarSystemID, current);
  }

  return [...countsBySystemID.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([solarSystemID, counts]) => [
      solarSystemID,
      counts.totalShipKills,
      counts.factionKills,
      0,
    ]);
}

function buildHistoryRows(statID, hours) {
  switch (statID) {
    case MAP_HISTORY_STAT_JUMPS:
      return mapTelemetryState.listJumpHistoryRows(hours);
    case MAP_HISTORY_STAT_KILLS:
      return listKillHistoryRows(hours);
    case MAP_HISTORY_STAT_FACWAR_KILLS:
      return listFactionWarfareKillHistoryRows(hours);
    default:
      return [];
  }
}

function getPosition(entry) {
  const position = entry && entry.position && typeof entry.position === "object"
    ? entry.position
    : {};
  return {
    x: toFiniteNumber(position.x, 0),
    y: toFiniteNumber(position.y, 0),
    z: toFiniteNumber(position.z, 0),
  };
}

function buildSolarSystemItemRow(entry) {
  const typeID = toPositiveInteger(
    (entry && (entry.typeID || entry.stationTypeID)) || 0,
    0,
  );
  const typeRecord = getItemTypeByID(typeID);
  const itemID = toPositiveInteger(
    (entry && (entry.itemID || entry.stationID || entry.structureID)) || 0,
    0,
  );
  const position = getPosition(entry);

  if (!itemID || !typeID) {
    return null;
  }

  return [
    toPositiveInteger(
      entry && entry.groupID,
      toPositiveInteger(typeRecord && typeRecord.groupID, 0),
    ),
    typeID,
    itemID,
    (entry && (entry.itemName || entry.stationName || entry.name)) || null,
    toPositiveInteger(entry && entry.solarSystemID, 0) || null,
    toPositiveInteger(entry && entry.orbitID, 0) || null,
    Boolean(entry && (entry.connector !== undefined ? entry.connector : entry.isBeacon)),
    position.x,
    position.y,
    position.z,
    toNullableInteger(entry && entry.celestialIndex),
    toNullableInteger(entry && entry.orbitIndex),
  ];
}

function compareSolarSystemItemRows(left, right) {
  return Number(left[2]) - Number(right[2]);
}

function buildPlanetOrbitalMapEntry(orbital) {
  const planet = worldData.getCelestialByID(orbital && orbital.planetID);
  return buildSolarSystemItemRow({
    itemID: orbital && orbital.itemID,
    typeID: orbital && orbital.typeID,
    groupID: orbital && orbital.groupID,
    itemName: orbital && orbital.itemName,
    solarSystemID: orbital && orbital.solarSystemID,
    orbitID: orbital && orbital.planetID,
    connector: false,
    position: planet && planet.position,
    celestialIndex: planet && planet.celestialIndex,
    orbitIndex: null,
  });
}

function buildSolarSystemItemRows(solarSystemID) {
  const numericSystemID = toPositiveInteger(solarSystemID, 0);
  if (!numericSystemID || !worldData.getSolarSystemByID(numericSystemID)) {
    return [];
  }

  const rows = [
    ...worldData.getCelestialsForSystem(numericSystemID).map(buildSolarSystemItemRow),
    ...worldData.getAsteroidBeltsForSystem(numericSystemID).map(buildSolarSystemItemRow),
    ...worldData.getStationsForSystem(numericSystemID).map(buildSolarSystemItemRow),
    ...worldData.getStargatesForSystem(numericSystemID).map(buildSolarSystemItemRow),
    ...worldData
      .getStructuresForSystem(numericSystemID)
      .map((structure) => structureState.buildStructureMapEntry(structure)),
    ...planetOrbitalState
      .listOrbitalsForSystem(numericSystemID)
      .map(buildPlanetOrbitalMapEntry),
    ...planetOrbitalState
      .listDefaultCustomsOfficesForSystem(numericSystemID)
      .map(buildPlanetOrbitalMapEntry),
  ];

  return rows.filter(Array.isArray).sort(compareSolarSystemItemRows);
}

function listKnownSpaceSystemIDs() {
  if (!knownSpaceSystemIDsCache) {
    knownSpaceSystemIDsCache = readStaticRows(TABLE.SOLAR_SYSTEMS)
      .map((system) => toPositiveInteger(system && system.solarSystemID, 0))
      .filter((solarSystemID) => solarSystemID > 0 && solarSystemID < 31000000)
      .sort((left, right) => left - right);
  }
  return [...knownSpaceSystemIDsCache];
}

function buildIndustryCostIndexDict(activityID) {
  return buildDict(
    listKnownSpaceSystemIDs().map((solarSystemID) => [
      solarSystemID,
      resolveSystemCostIndex(solarSystemID, activityID),
    ]),
  );
}

class MapService extends BaseService {
  constructor() {
    super("map");
  }

  /**
   * GetSecurityModifiedSystems — returns systems whose security has been
   * modified (e.g. by Triglavian invasions).
   *
   * Client does:
   *   modifiedSecuritySystems = mapSvc.GetSecurityModifiedSystems()
   *   try:
   *       indexedSystems = modifiedSecuritySystems.Index('solarSystemID')
   *       ...
   *   except AttributeError:
   *       pass
   *   return ''
   *
   * V23.02 does NOT have the dbutil C-extension module, so returning a
   * dbutil.CRowset token causes ImportError: No module named dbutil.
   * Instead we return a simple util.KeyVal — the client's AttributeError
   * guard catches the missing .Index() and gracefully returns ''.
   */
  Handle_GetSecurityModifiedSystems(args, session, kwargs) {
    log.debug("[MapService] GetSecurityModifiedSystems called");

    // V23.02 has NONE of: dbutil.CRowset, util.Rowset, util.IndexRowset.
    // The only working PyObject type is util.KeyVal, but it lacks .Index().
    //
    // Approach: set KeyVal's "Index" attribute to the util.Row CLASS via token.
    // util.Row is in the marshal string table (entry 80), so it's whitelisted.
    // We know `import util` succeeds (util.Rowset gave "'module' has no attr").
    //
    // When client calls: modifiedSecuritySystems.Index('solarSystemID')
    // it calls: util.Row('solarSystemID') → creates an empty Row object
    // Then: 30000142 in Row(...) → False (empty row, nothing matches)
    // So no security modifier text is applied — correct for no modified systems.
    return buildRowset(
      ["solarSystemID"],
      [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetTriglavianMinorVictorySystems(args, session, kwargs) {
    log.debug("[MapService] GetTriglavianMinorVictorySystems called");

    return buildList([...TRIGLAVIAN_MINOR_VICTORY_SYSTEMS]);
  }

  Handle_GetEdencomFortressSystems(args, session, kwargs) {
    log.debug("[MapService] GetEdencomFortressSystems called");

    return buildList([...EDENCOM_FORTRESS_SYSTEMS]);
  }

  Handle_GetEdencomMinorVictorySystems(args, session, kwargs) {
    log.debug("[MapService] GetEdencomMinorVictorySystems called");

    return buildList([...EDENCOM_MINOR_VICTORY_SYSTEMS]);
  }

  Handle_GetIncursionGlobalReport() {
    const incursions = incursionRuntime.listActiveIncursions();
    log.debug(`[MapService] GetIncursionGlobalReport count=${incursions.length}`);
    return buildIncursionGlobalReport(incursions);
  }

  GetIncursionGlobalReport() {
    return this.Handle_GetIncursionGlobalReport();
  }

  Handle_GetSystemsInIncursions() {
    const incursions = incursionRuntime.listActiveIncursions();
    log.debug(`[MapService] GetSystemsInIncursions count=${incursions.length}`);
    return buildSystemsInIncursionsRowset(incursions);
  }

  GetSystemsInIncursions() {
    return this.Handle_GetSystemsInIncursions();
  }

  Handle_GetHistory(args) {
    const statID = toPositiveInteger(args && args[0], 0);
    const hours = toPositiveInteger(args && args[1], 1);
    log.debug(`[MapService] GetHistory statID=${statID} hours=${hours}`);
    return buildCachedMethodCallResult(
      buildRowset(HISTORY_COLUMNS, buildHistoryRows(statID, hours), MAP_ROWSET),
      {
        serviceName: this.name,
        method: "GetHistory",
        args: [statID, hours],
        versionCheck: "1 minute",
      },
    );
  }

  Handle_GetSolarSystemVisits(args, session) {
    const characterID = getSessionCharacterID(session);
    const rows = mapTelemetryState.listSolarSystemVisitRows(characterID);
    log.debug(`[MapService] GetSolarSystemVisits characterID=${characterID} rows=${rows.length}`);
    return buildRowset(VISITS_COLUMNS, rows, MAP_ROWSET);
  }

  Handle_GetBeaconCount() {
    const beaconCounts = fleetHelpers.getActiveFleetBeaconCountsBySolarSystem();
    const entries = [...beaconCounts.entries()]
      .filter(([solarSystemID, count]) => solarSystemID > 0 && count > 0)
      .sort(([leftSystemID], [rightSystemID]) => leftSystemID - rightSystemID);
    log.debug(`[MapService] GetBeaconCount rows=${entries.length}`);
    return buildDict(entries);
  }

  Handle_GetDeadspaceAgentsMap(args) {
    const languageID = String((args && args[0]) || "").trim();
    log.debug(`[MapService] GetDeadspaceAgentsMap languageID=${languageID}`);
    return null;
  }

  Handle_GetDeadspaceComplexMap(args) {
    const languageID = String((args && args[0]) || "").trim();
    log.debug(`[MapService] GetDeadspaceComplexMap languageID=${languageID}`);
    return null;
  }

  Handle_GetIndustryJobsOverLast24Hours(args) {
    const activityID = toPositiveInteger(args && args[0], 0);
    const rows = listIndustryJobsOverLast24Hours(activityID);
    log.debug(`[MapService] GetIndustryJobsOverLast24Hours activityID=${activityID} rows=${rows.length}`);
    return buildRowset(INDUSTRY_JOBS_COLUMNS, rows, MAP_ROWSET);
  }

  Handle_GetIndustryCostModifier(args) {
    const activityID = toPositiveInteger(args && args[0], 0);
    log.debug(`[MapService] GetIndustryCostModifier activityID=${activityID}`);
    return buildIndustryCostIndexDict(activityID);
  }

  Handle_GetMyExtraMapInfo() {
    log.debug("[MapService] GetMyExtraMapInfo called");
    return buildEmptyRowset(CORP_MEMBER_COLUMNS);
  }

  Handle_GetMyExtraMapInfoAgents() {
    log.debug("[MapService] GetMyExtraMapInfoAgents called");
    return buildEmptyRowset(AGENT_STANDING_COLUMNS);
  }

  Handle_GetConstellationLPData(args) {
    const constellationID = toPositiveInteger(args && args[0], 0);
    log.debug(`[MapService] GetConstellationLPData constellationID=${constellationID}`);
    return buildEmptyRowset(FW_LP_COLUMNS);
  }

  Handle_GetAllRoamingWeatherSystems() {
    log.debug("[MapService] GetAllRoamingWeatherSystems called");
    return buildEmptyRowset(ROAMING_WEATHER_COLUMNS);
  }

  Handle_GetSolarsystemItems(args) {
    const solarSystemID = toPositiveInteger(args && args[0], 0);
    const rows = buildSolarSystemItemRows(solarSystemID);
    log.debug(
      `[MapService] GetSolarsystemItems solarSystemID=${solarSystemID} rows=${rows.length}`,
    );
    return buildRowset(SOLAR_SYSTEM_ITEM_COLUMNS, rows, MAP_ROWSET);
  }

  Handle_GetFacWarZoneInfo(args) {
    const factionID = toPositiveInteger(args && args[0], 0);
    log.debug(`[MapService] GetFacWarZoneInfo factionID=${factionID}`);
    return buildKeyVal([
      ["factionID", factionID || null],
      ["systemUpgradeLevel", buildDict([])],
    ]);
  }

  Handle_GetCurrentSovData(args, session) {
    const locationID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    log.debug(`[MapService] GetCurrentSovData(${locationID})`);
    return buildCurrentSovDataPayload(listCurrentSovData(locationID));
  }

  Handle_GetRecentSovActivity(args, session) {
    log.debug("[MapService] GetRecentSovActivity called");
    return buildRecentSovActivityPayload(listRecentSovActivity());
  }

  Handle_GetStationInfo(args, session) {
    const stations = [...worldData.ensureLoaded().stations].sort(
      (left, right) => Number(left.stationID) - Number(right.stationID),
    );
    const sharedServiceMask = buildStationServiceMask();

    const stationInfo = {
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          [
            "header",
            {
              type: "list",
              items: [
                "stationID",
                "solarSystemID",
                "operationID",
                "stationTypeID",
                "ownerID",
                "serviceMask",
                "constellationID",
                "regionID",
              ],
            },
          ],

          ["RowClass", { type: "token", value: "util.Row" }],

          [
            "lines",
            {
              type: "list",
              items: stations.map((station) => [
                Number(station.stationID) || null,
                Number(station.solarSystemID) || null,
                Number(station.operationID) || null,
                Number(station.stationTypeID) || null,
                Number(station.corporationID || station.ownerID) || null,
                sharedServiceMask,
                Number(station.constellationID) || null,
                Number(station.regionID) || null,
              ]),
            },
          ],
        ],
      },
    };
    return buildCachedMethodCallResult(stationInfo, {
      serviceName: this.name,
      method: "GetStationInfo",
      versionCheck: "run",
      proxyCache: true,
    });
  }

  Handle_GetStationCount(args, session) {
    const world = worldData.ensureLoaded();
    const stationCountBySystemID = new Map();

    for (const system of world.solarSystems) {
      stationCountBySystemID.set(Number(system.solarSystemID) || 0, 0);
    }

    for (const station of world.stations) {
      const solarSystemID = Number(station.solarSystemID) || 0;
      stationCountBySystemID.set(
        solarSystemID,
        (stationCountBySystemID.get(solarSystemID) || 0) + 1,
      );
    }

    return {
      type: "list",
      items: [...stationCountBySystemID.entries()].sort(
        (left, right) => left[0] - right[0],
      ),
    };
  }
}

module.exports = MapService;
