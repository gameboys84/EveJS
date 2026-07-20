const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  extractDictEntries,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const auditEvents = [];
let editorFixtures = buildEmptyEditorFixtures();

function buildEmptyEditorFixtures() {
  return {
    dungeons: [],
    archetypes: [],
    factions: [],
    roomsByDungeonID: {},
    roomObjectPaletteData: buildDict([]),
  };
}

function getCharacterID(session) {
  return Number(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
  ) || 0;
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, kwargs = null) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    kwargs: kwargs || null,
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

function getKwarg(kwargs, key) {
  if (!kwargs) {
    return undefined;
  }

  if (kwargs.type === "dict") {
    const entry = extractDictEntries(kwargs)
      .find(([entryKey]) => entryKey === key);
    return entry ? entry[1] : undefined;
  }

  if (typeof kwargs === "object" && Object.prototype.hasOwnProperty.call(kwargs, key)) {
    return kwargs[key];
  }

  return undefined;
}

function toNullableInt(value) {
  if (value === null || value === undefined || value === "All") {
    return null;
  }
  const normalized = normalizeNumber(value, NaN);
  return Number.isFinite(normalized) ? Math.trunc(normalized) : null;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizePairList(values) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null;
      }
      return [entry[0], entry[1]];
    })
    .filter(Boolean);
}

function normalizeDungeon(entry) {
  const dungeonID = toNullableInt(entry && entry.dungeonID);
  if (!dungeonID) {
    return null;
  }

  return {
    dungeonID,
    dungeonNameID: toNullableInt(entry.dungeonNameID),
    dungeonName: normalizeText(entry.dungeonName, ""),
    factionID: toNullableInt(entry.factionID),
    archetypeID: toNullableInt(entry.archetypeID),
  };
}

function normalizeFixtures(rawFixtures = {}) {
  const fixtures = buildEmptyEditorFixtures();
  fixtures.dungeons = (Array.isArray(rawFixtures.dungeons) ? rawFixtures.dungeons : [])
    .map(normalizeDungeon)
    .filter(Boolean);
  fixtures.archetypes = normalizePairList(rawFixtures.archetypes);
  fixtures.factions = [
    ...new Set(
      (Array.isArray(rawFixtures.factions) ? rawFixtures.factions : [])
        .map((value) => toNullableInt(value))
        .filter((value) => value !== null),
    ),
  ].sort((left, right) => left - right);
  fixtures.roomsByDungeonID = {};
  const roomsByDungeonID =
    rawFixtures.roomsByDungeonID &&
    typeof rawFixtures.roomsByDungeonID === "object"
      ? rawFixtures.roomsByDungeonID
      : {};
  for (const [dungeonID, rooms] of Object.entries(roomsByDungeonID)) {
    const normalizedDungeonID = toNullableInt(dungeonID);
    if (normalizedDungeonID) {
      fixtures.roomsByDungeonID[normalizedDungeonID] = normalizePairList(rooms);
    }
  }
  fixtures.roomObjectPaletteData =
    rawFixtures.roomObjectPaletteData &&
    typeof rawFixtures.roomObjectPaletteData === "object"
      ? rawFixtures.roomObjectPaletteData
      : buildDict([]);
  return fixtures;
}

function buildDungeonRow(dungeon) {
  return buildKeyVal([
    ["dungeonID", dungeon.dungeonID],
    ["dungeonNameID", dungeon.dungeonNameID],
    ["dungeonName", dungeon.dungeonName],
    ["factionID", dungeon.factionID],
    ["archetypeID", dungeon.archetypeID],
  ]);
}

function extractDungeonFilters(args, kwargs) {
  return {
    dungeonID: toNullableInt(getKwarg(kwargs, "dungeonID") ?? (args && args[0])),
    archetypeID: toNullableInt(getKwarg(kwargs, "archetypeID")),
    factionID: toNullableInt(getKwarg(kwargs, "factionID")),
  };
}

class DungeonService extends BaseService {
  constructor() {
    super("dungeon");
  }

  Handle_DEGetDungeons(args, session, kwargs) {
    recordAuditEvent("DEGetDungeons", args, session, kwargs);
    const filters = extractDungeonFilters(args, kwargs);
    const rows = editorFixtures.dungeons.filter((dungeon) => {
      if (filters.dungeonID !== null && dungeon.dungeonID !== filters.dungeonID) {
        return false;
      }
      if (filters.archetypeID !== null && dungeon.archetypeID !== filters.archetypeID) {
        return false;
      }
      if (filters.factionID !== null && dungeon.factionID !== filters.factionID) {
        return false;
      }
      return true;
    });
    return buildList(rows.map(buildDungeonRow));
  }

  Handle_DEGetArchetypes(args, session, kwargs) {
    recordAuditEvent("DEGetArchetypes", args, session, kwargs);
    return buildList(editorFixtures.archetypes);
  }

  Handle_DEGetFactions(args, session, kwargs) {
    recordAuditEvent("DEGetFactions", args, session, kwargs);
    return buildList(editorFixtures.factions);
  }

  Handle_DEGetRooms(args, session, kwargs) {
    recordAuditEvent("DEGetRooms", args, session, kwargs);
    const dungeonID = toNullableInt(getKwarg(kwargs, "dungeonID") ?? (args && args[0]));
    return buildList(
      dungeonID && editorFixtures.roomsByDungeonID[dungeonID]
        ? editorFixtures.roomsByDungeonID[dungeonID]
        : [],
    );
  }

  Handle_DEGetRoomObjectPaletteData(args, session, kwargs) {
    recordAuditEvent("DEGetRoomObjectPaletteData", args, session, kwargs);
    return editorFixtures.roomObjectPaletteData;
  }
}

DungeonService._testing = {
  getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }));
  },
  resetForTests() {
    auditEvents.length = 0;
    editorFixtures = buildEmptyEditorFixtures();
  },
  setEditorFixtures(rawFixtures) {
    editorFixtures = normalizeFixtures(rawFixtures);
  },
};

module.exports = DungeonService;
