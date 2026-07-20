const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const database = require(path.join(__dirname, "../../gameStore"));
const {
  buildList,
  buildKeyVal,
  normalizeText,
} = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  getAllFactionRecords,
} = require(path.join(__dirname, "../faction/factionState"));
const {
  listAgents,
} = require(path.join(__dirname, "../agent/agentAuthority"));
const {
  ensureAlliancesInitialized,
  ensureCorporationsInitialized,
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  ensureRuntimeInitialized,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getWarPermitStatusForOwner,
} = require(path.join(__dirname, "./warPermitState"));

const MATCH_BY = Object.freeze({
  PARTIAL_TERMS: 0,
  EXACT_TERMS: 1,
  EXACT_PHRASE: 2,
  EXACT_PHRASE_ONLY: 3,
});

const GROUP = Object.freeze({
  CHARACTER: 1,
  CORPORATION: 2,
  REGION: 3,
  CONSTELLATION: 4,
  SOLAR_SYSTEM: 5,
  ASTEROID_BELT: 9,
  STATION: 15,
  FACTION: 19,
  ALLIANCE: 32,
});

const TYPE = Object.freeze({
  CORPORATION: 2,
  REGION: 3,
  CONSTELLATION: 4,
  SOLAR_SYSTEM: 5,
  CHARACTER: 1373,
  FACTION: 30,
  ALLIANCE: 16159,
});

const MAX_LOOKUP_RESULTS = 500;

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeSearchString(value) {
  return normalizeText(value, "").trim().toLowerCase();
}

function collapseSearchString(value) {
  return normalizeSearchString(value).replace(/[^a-z0-9]+/g, "");
}

function tokenizeSearchString(value) {
  return normalizeSearchString(value)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);
}

function matchesSearch(name, search, exactMode = MATCH_BY.PARTIAL_TERMS) {
  const rawTarget = normalizeSearchString(name);
  const collapsedTarget = collapseSearchString(name);
  const rawSearch = normalizeSearchString(search);
  const collapsedSearch = collapseSearchString(search);
  if (!collapsedSearch) {
    return false;
  }

  switch (normalizeInteger(exactMode, MATCH_BY.PARTIAL_TERMS)) {
    case MATCH_BY.EXACT_TERMS:
    case MATCH_BY.EXACT_PHRASE:
    case MATCH_BY.EXACT_PHRASE_ONLY:
      return rawTarget === rawSearch || collapsedTarget === collapsedSearch;
    case MATCH_BY.PARTIAL_TERMS:
    default: {
      const terms = tokenizeSearchString(search);
      if (!terms.length) {
        return collapsedTarget.includes(collapsedSearch);
      }
      return terms.every((term) => collapsedTarget.includes(term));
    }
  }
}

function rankLookupEntry(entry, search) {
  const rawName = normalizeSearchString(entry && entry.name);
  const collapsedName = collapseSearchString(entry && entry.name);
  const rawSearch = normalizeSearchString(search);
  const collapsedSearch = collapseSearchString(search);
  if (rawName === rawSearch || collapsedName === collapsedSearch) {
    return 0;
  }
  if (rawName.startsWith(rawSearch) || collapsedName.startsWith(collapsedSearch)) {
    return 1;
  }
  return 2;
}

function sortLookupEntries(entries, search) {
  return [...entries].sort((left, right) => {
    const rankDelta = rankLookupEntry(left, search) - rankLookupEntry(right, search);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return String(left.name || "").localeCompare(String(right.name || "")) ||
      (normalizeInteger(left.id, 0) - normalizeInteger(right.id, 0));
  });
}

function filterLookupEntries(entries, search, exactMode = MATCH_BY.PARTIAL_TERMS) {
  return sortLookupEntries(
    entries.filter((entry) => matchesSearch(entry && entry.name, search, exactMode)),
    search,
  ).slice(0, MAX_LOOKUP_RESULTS);
}

function readCharacters() {
  const result = database.read("characters", "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function listCharacterEntries() {
  // Player lookups are a LIKE scan over every character. Read the raw stored
  // fields directly instead of getCharacterRecord, which runs the full
  // normalization pipeline and re-writes the whole characters table to disk per
  // record on a cold cache. The row only needs name + owner identity fields.
  return Object.entries(readCharacters())
    .filter(([, record]) => record && typeof record === "object")
    .map(([characterID, record]) => {
      const id = normalizePositiveInteger(record.characterID || characterID, 0);
      return {
        id,
        name: record.characterName || `Character ${id}`,
        typeID: normalizePositiveInteger(record.typeID, TYPE.CHARACTER),
        groupID: GROUP.CHARACTER,
        gender: normalizeInteger(record.gender, 0),
        corporationID: normalizePositiveInteger(record.corporationID, 0),
        allianceID: normalizePositiveInteger(record.allianceID, 0),
        warFactionID: normalizePositiveInteger(
          record.warFactionID ?? record.militiaFactionID,
          0,
        ),
      };
    })
    .filter((entry) => entry.id > 0 && entry.name);
}

function listCorporationEntries({ includeNPC = true } = {}) {
  const table = ensureCorporationsInitialized();
  return Object.keys((table && table.records) || {})
    .map((corporationID) => getCorporationRecord(corporationID))
    .filter((record) => record && (includeNPC || record.isNPC !== true))
    .map((record) => ({
      id: normalizePositiveInteger(record.corporationID, 0),
      name: record.corporationName || `Corporation ${record.corporationID}`,
      typeID: TYPE.CORPORATION,
      groupID: GROUP.CORPORATION,
      gender: 0,
      tickerName: record.tickerName || null,
      factionID: normalizePositiveInteger(record.factionID, 0),
      isNPC: record.isNPC === true,
    }))
    .filter((entry) => entry.id > 0 && entry.name);
}

function listAllianceEntries() {
  const table = ensureAlliancesInitialized();
  return Object.keys((table && table.records) || {})
    .map((allianceID) => getAllianceRecord(allianceID))
    .filter(Boolean)
    .map((record) => ({
      id: normalizePositiveInteger(record.allianceID, 0),
      name: record.allianceName || `Alliance ${record.allianceID}`,
      typeID: TYPE.ALLIANCE,
      groupID: GROUP.ALLIANCE,
      gender: 0,
      tickerName: record.shortName || null,
      isNPC: record.isNPC === true,
    }))
    .filter((entry) => entry.id > 0 && entry.name);
}

function listFactionEntries() {
  return getAllFactionRecords()
    .map((record) => ({
      id: normalizePositiveInteger(record.factionID, 0),
      name: record.name || `Faction ${record.factionID}`,
      typeID: TYPE.FACTION,
      groupID: GROUP.FACTION,
      gender: 0,
      factionID: normalizePositiveInteger(record.factionID, 0),
      isNPC: true,
    }))
    .filter((entry) => entry.id > 0 && entry.name);
}

function listAgentEntries() {
  return listAgents()
    .map((record) => ({
      id: normalizePositiveInteger(record && record.agentID, 0),
      name: record && (record.ownerName || `Agent ${record.agentID}`),
      typeID: normalizePositiveInteger(record && record.ownerTypeID, TYPE.CHARACTER),
      groupID: GROUP.CHARACTER,
      gender: normalizeInteger(record && record.gender, 0),
      corporationID: normalizePositiveInteger(record && record.corporationID, 0),
      factionID: normalizePositiveInteger(record && record.factionID, 0),
      agentTypeID: normalizePositiveInteger(record && record.agentTypeID, 0),
      divisionID: normalizePositiveInteger(record && record.divisionID, 0),
      level: normalizeInteger(record && record.level, 0),
      stationID: normalizePositiveInteger(record && record.stationID, 0),
      solarSystemID: normalizePositiveInteger(record && record.solarSystemID, 0),
      isLocator: record && record.isLocator === true,
      isInSpace: record && record.isInSpace === true,
    }))
    .filter((entry) => entry.id > 0 && entry.name);
}

function buildOwnerRow(entry) {
  const rows = [
    ["ownerID", entry.id],
    ["ownerName", entry.name],
    ["typeID", entry.typeID],
    ["groupID", entry.groupID],
    ["gender", entry.gender || 0],
  ];
  for (const fieldName of [
    "characterID",
    "corporationID",
    "allianceID",
    "factionID",
    "tickerName",
    "isNPC",
  ]) {
    if (Object.prototype.hasOwnProperty.call(entry, fieldName)) {
      rows.push([fieldName, entry[fieldName]]);
    }
  }
  return buildKeyVal(rows);
}

function buildCharacterRow(entry) {
  return buildKeyVal([
    ["characterID", entry.id],
    ["characterName", entry.name],
    ["ownerID", entry.id],
    ["ownerName", entry.name],
    ["typeID", entry.typeID],
    ["groupID", GROUP.CHARACTER],
    ["corporationID", entry.corporationID || 0],
    ["allianceID", entry.allianceID || 0],
  ]);
}

function buildNPCCharacterRow(entry) {
  return buildKeyVal([
    ["characterID", entry.id],
    ["characterName", entry.name],
    ["ownerID", entry.id],
    ["ownerName", entry.name],
    ["typeID", entry.typeID],
    ["groupID", GROUP.CHARACTER],
    ["corporationID", entry.corporationID || 0],
    ["factionID", entry.factionID || 0],
    ["agentID", entry.id],
    ["agentName", entry.name],
    ["agentTypeID", entry.agentTypeID || 0],
    ["divisionID", entry.divisionID || 0],
    ["level", entry.level || 0],
    ["stationID", entry.stationID || 0],
    ["solarSystemID", entry.solarSystemID || 0],
    ["isLocator", entry.isLocator === true],
    ["isInSpace", entry.isInSpace === true],
  ]);
}

function buildCorporationRow(entry) {
  return buildKeyVal([
    ["corporationID", entry.id],
    ["corporationName", entry.name],
    ["ownerID", entry.id],
    ["ownerName", entry.name],
    ["typeID", TYPE.CORPORATION],
    ["groupID", GROUP.CORPORATION],
    ["tickerName", entry.tickerName || null],
    ["factionID", entry.factionID || 0],
    ["isNPC", entry.isNPC === true],
  ]);
}

function buildFactionRow(entry) {
  return buildKeyVal([
    ["factionID", entry.id],
    ["factionName", entry.name],
    ["ownerID", entry.id],
    ["ownerName", entry.name],
    ["typeID", TYPE.FACTION],
    ["groupID", GROUP.FACTION],
  ]);
}

function buildLocationRow(entry) {
  return buildKeyVal([
    ["itemID", entry.id],
    ["itemName", entry.name],
    ["typeID", entry.typeID],
    ["groupID", entry.groupID],
    ["solarSystemID", entry.solarSystemID || null],
    ["constellationID", entry.constellationID || null],
    ["regionID", entry.regionID || null],
  ]);
}

function uniqueByID(entries) {
  const seen = new Set();
  const output = [];
  for (const entry of entries) {
    if (!entry || !entry.id || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    output.push(entry);
  }
  return output;
}

function listLocationEntriesForGroup(groupID) {
  switch (normalizeInteger(groupID, 0)) {
    case GROUP.SOLAR_SYSTEM:
      return readStaticRows(TABLE.SOLAR_SYSTEMS).map((row) => ({
        id: normalizePositiveInteger(row && row.solarSystemID, 0),
        name: row && row.solarSystemName,
        typeID: TYPE.SOLAR_SYSTEM,
        groupID: GROUP.SOLAR_SYSTEM,
        solarSystemID: normalizePositiveInteger(row && row.solarSystemID, 0),
        constellationID: normalizePositiveInteger(row && row.constellationID, 0),
        regionID: normalizePositiveInteger(row && row.regionID, 0),
      }));
    case GROUP.STATION:
      return readStaticRows(TABLE.STATIONS).map((row) => ({
        id: normalizePositiveInteger(row && (row.stationID || row.itemID), 0),
        name: row && (row.stationName || row.itemName),
        typeID: normalizePositiveInteger(row && row.stationTypeID, 0),
        groupID: GROUP.STATION,
        solarSystemID: normalizePositiveInteger(row && row.solarSystemID, 0),
        constellationID: normalizePositiveInteger(row && row.constellationID, 0),
        regionID: normalizePositiveInteger(row && row.regionID, 0),
      }));
    case GROUP.ASTEROID_BELT:
      return readStaticRows(TABLE.ASTEROID_BELTS).map((row) => ({
        id: normalizePositiveInteger(row && row.itemID, 0),
        name: row && row.itemName,
        typeID: normalizePositiveInteger(row && row.typeID, 0),
        groupID: GROUP.ASTEROID_BELT,
        solarSystemID: normalizePositiveInteger(row && row.solarSystemID, 0),
        constellationID: normalizePositiveInteger(row && row.constellationID, 0),
        regionID: normalizePositiveInteger(row && row.regionID, 0),
      }));
    case GROUP.REGION:
      return uniqueByID(
        readStaticRows(TABLE.STATIONS).map((row) => ({
          id: normalizePositiveInteger(row && row.regionID, 0),
          name: row && row.regionName,
          typeID: TYPE.REGION,
          groupID: GROUP.REGION,
          regionID: normalizePositiveInteger(row && row.regionID, 0),
        })),
      );
    case GROUP.CONSTELLATION:
      return uniqueByID(
        readStaticRows(TABLE.STATIONS).map((row) => ({
          id: normalizePositiveInteger(row && row.constellationID, 0),
          name: row && row.constellationName,
          typeID: TYPE.CONSTELLATION,
          groupID: GROUP.CONSTELLATION,
          constellationID: normalizePositiveInteger(row && row.constellationID, 0),
          regionID: normalizePositiveInteger(row && row.regionID, 0),
        })),
      );
    default:
      return readStaticRows(TABLE.CELESTIALS)
        .filter((row) => normalizeInteger(row && row.groupID, 0) === normalizeInteger(groupID, 0))
        .map((row) => ({
          id: normalizePositiveInteger(row && row.itemID, 0),
          name: row && row.itemName,
          typeID: normalizePositiveInteger(row && row.typeID, 0),
          groupID: normalizeInteger(row && row.groupID, 0),
          solarSystemID: normalizePositiveInteger(row && row.solarSystemID, 0),
          constellationID: normalizePositiveInteger(row && row.constellationID, 0),
          regionID: normalizePositiveInteger(row && row.regionID, 0),
        }));
  }
}

function lookupLocations(groupID, search, exactMode = MATCH_BY.PARTIAL_TERMS) {
  const entries = listLocationEntriesForGroup(groupID)
    .filter((entry) => entry.id > 0 && entry.name);
  return buildList(
    filterLookupEntries(entries, search, exactMode).map((entry) => buildLocationRow(entry)),
  );
}

class LookupService extends BaseService {
  constructor() {
    super("lookupSvc");
  }

  Handle_LookupCharacters(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    return buildList(
      filterLookupEntries(listCharacterEntries(), search, exactMode)
        .map((entry) => buildCharacterRow(entry)),
    );
  }

  Handle_LookupEvePlayerCharacters(args) {
    return this.Handle_LookupCharacters(args);
  }

  Handle_LookupPlayerCharacters(args) {
    return this.Handle_LookupCharacters(args);
  }

  Handle_LookupAgents(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    return buildList(
      filterLookupEntries(listAgentEntries(), search, exactMode)
        .map((entry) => entry.id),
    );
  }

  Handle_LookupNPCCharacters(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    return buildList(
      filterLookupEntries(listAgentEntries(), search, exactMode)
        .map((entry) => buildNPCCharacterRow(entry)),
    );
  }

  Handle_LookupCorporations(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    return buildList(
      filterLookupEntries(listCorporationEntries({ includeNPC: true }), search, exactMode)
        .map((entry) => buildCorporationRow(entry)),
    );
  }

  Handle_LookupFactions(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    return buildList(
      filterLookupEntries(listFactionEntries(), search, exactMode)
        .map((entry) => buildFactionRow(entry)),
    );
  }

  Handle_LookupOwners(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    const owners = [
      ...listCharacterEntries().map((entry) => ({ ...entry, characterID: entry.id })),
      ...listCorporationEntries({ includeNPC: true }).map((entry) => ({
        ...entry,
        corporationID: entry.id,
      })),
      ...listAllianceEntries().map((entry) => ({ ...entry, allianceID: entry.id })),
      ...listFactionEntries().map((entry) => ({ ...entry, factionID: entry.id })),
    ];
    return buildList(
      filterLookupEntries(owners, search, exactMode).map((entry) => buildOwnerRow(entry)),
    );
  }

  Handle_LookupPCOwners(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    const owners = [
      ...listCharacterEntries().map((entry) => ({ ...entry, characterID: entry.id })),
      ...listCorporationEntries({ includeNPC: false }).map((entry) => ({
        ...entry,
        corporationID: entry.id,
      })),
      ...listAllianceEntries().map((entry) => ({ ...entry, allianceID: entry.id })),
    ];
    return buildList(
      filterLookupEntries(owners, search, exactMode).map((entry) => buildOwnerRow(entry)),
    );
  }

  Handle_LookupNoneNPCAccountOwners(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    const owners = [
      ...listCharacterEntries().map((entry) => ({ ...entry, characterID: entry.id })),
      ...listCorporationEntries({ includeNPC: false }).map((entry) => ({
        ...entry,
        corporationID: entry.id,
      })),
    ];
    return buildList(
      filterLookupEntries(owners, search, exactMode).map((entry) => buildOwnerRow(entry)),
    );
  }

  Handle_LookupLocationsByGroup(args) {
    const groupID = args && args.length > 0 ? args[0] : 0;
    const search = args && args.length > 1 ? args[1] : "";
    const exactMode = args && args.length > 2 ? args[2] : MATCH_BY.PARTIAL_TERMS;
    return lookupLocations(groupID, search, exactMode);
  }

  Handle_LookupKnownLocationsByGroup(args) {
    return this.Handle_LookupLocationsByGroup(args);
  }

  Handle_LookupStations(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    return lookupLocations(GROUP.STATION, search, exactMode);
  }

  Handle_LookupKnownLocations(args) {
    const search = args && args.length > 0 ? args[0] : "";
    const exactMode = args && args.length > 1 ? args[1] : MATCH_BY.PARTIAL_TERMS;
    const entries = [
      ...listLocationEntriesForGroup(GROUP.SOLAR_SYSTEM),
      ...listLocationEntriesForGroup(GROUP.STATION),
      ...listLocationEntriesForGroup(GROUP.ASTEROID_BELT),
    ].filter((entry) => entry.id > 0 && entry.name);
    return buildList(
      filterLookupEntries(entries, search, exactMode).map((entry) => buildLocationRow(entry)),
    );
  }

  Handle_LookupWarableCorporationsOrAlliances(args) {
    const search = (args && args.length > 0 ? String(args[0] || "") : "").toLowerCase();
    const exact = Boolean(args && args.length > 1 ? args[1] : false);
    // Match whitespace/punctuation-insensitively, consistent with the search
    // service: an exact search ignores spacing (e.g. "e l y s i a n" matches
    // "Elysian"), and a partial search matches the collapsed form too.
    const collapse = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const collapsedSearch = collapse(search);
    const ownerNameMatches = (ownerName) => {
      const name = String(ownerName || "").toLowerCase();
      if (exact) {
        return name === search || collapse(name) === collapsedSearch;
      }
      return name.includes(search) || collapse(name).includes(collapsedSearch);
    };
    const runtime = ensureRuntimeInitialized();
    const rows = [];
    for (const corporationID of Object.keys(runtime.corporations || {})) {
      const corporation = getCorporationRecord(corporationID);
      const matches = corporation && ownerNameMatches(corporation.corporationName);
      if (!corporation || !matches) {
        continue;
      }
      rows.push(
        buildKeyVal([
          ["ownerID", corporation.corporationID],
          ["ownerName", corporation.corporationName],
          ["typeID", 2],
          ["warPermit", getWarPermitStatusForOwner(corporation.corporationID)],
        ]),
      );
    }
    for (const allianceID of Object.keys(runtime.alliances || {})) {
      const alliance = getAllianceRecord(allianceID);
      const matches = alliance && ownerNameMatches(alliance.allianceName);
      if (!alliance || !matches) {
        continue;
      }
      rows.push(
        buildKeyVal([
          ["ownerID", alliance.allianceID],
          ["ownerName", alliance.allianceName],
          ["typeID", 16159],
          ["warPermit", getWarPermitStatusForOwner(alliance.allianceID)],
        ]),
      );
    }
    return buildList(rows);
  }
}

module.exports = LookupService;
