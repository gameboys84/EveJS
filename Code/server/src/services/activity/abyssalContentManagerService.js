const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict, buildList } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

const MAX_REPETITIONS = 1000;

const auditEvents = [];
let reportProvider = null;

function toInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterID(session = null) {
  return toInteger(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
    0,
  );
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, details = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    details: { ...details },
    timestamp: Date.now(),
  });
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || "")).filter(Boolean);
}

function normalizeIntegerArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toInteger(entry, 0))
    .filter((entry) => entry > 0);
}

function normalizeNpc(entry = {}) {
  return {
    quantity: Math.max(0, toInteger(entry.quantity, 0)),
    type_id: Math.max(0, toInteger(entry.type_id ?? entry.typeID, 0)),
    behavior_name: String(entry.behavior_name ?? entry.behaviorName ?? ""),
    behavior_id: Math.max(0, toInteger(entry.behavior_id ?? entry.behaviorID, 0)),
    cost: Math.max(0, toInteger(entry.cost, 0)),
    total_cost: Math.max(0, toInteger(entry.total_cost ?? entry.totalCost, 0)),
    npc_tag_names: normalizeStringArray(entry.npc_tag_names ?? entry.npcTagNames),
    npc_tags: normalizeIntegerArray(entry.npc_tags ?? entry.npcTags),
  };
}

function normalizeSpawn(entry = {}) {
  const npcs = Array.isArray(entry.npcs) ? entry.npcs.map(normalizeNpc) : [];
  return {
    npc_fleet_type_name: String(entry.npc_fleet_type_name ?? entry.npcFleetTypeName ?? ""),
    npc_fleet_type_id: Math.max(0, toInteger(entry.npc_fleet_type_id ?? entry.npcFleetTypeID, 0)),
    group_behavior_name: String(entry.group_behavior_name ?? entry.groupBehaviorName ?? ""),
    group_behavior_id: Math.max(0, toInteger(entry.group_behavior_id ?? entry.groupBehaviorID, 0)),
    spawn_points: Math.max(0, toInteger(entry.spawn_points ?? entry.spawnPoints, 0)),
    spent_points: Math.max(0, toInteger(entry.spent_points ?? entry.spentPoints, 0)),
    remaining_points: Math.max(0, toInteger(entry.remaining_points ?? entry.remainingPoints, 0)),
    npc_fleet_spawn_tag_names: normalizeStringArray(
      entry.npc_fleet_spawn_tag_names ?? entry.npcFleetSpawnTagNames,
    ),
    npc_fleet_spawn_tags: normalizeIntegerArray(
      entry.npc_fleet_spawn_tags ?? entry.npcFleetSpawnTags,
    ),
    npcs,
  };
}

function buildEmptyReport(difficultyTier, spawnTableID, repetitions) {
  return {
    difficulty_tier: difficultyTier,
    spawn_table_id: spawnTableID,
    repetitions,
    average_spawn_points: 0,
    average_spent_points: 0,
    average_remaining_points: 0,
    average_number_of_npcs: 0,
    unsupported_tag_names: [],
    unsupported_tags: [],
    spawns: [],
  };
}

function normalizeReport(rawReport, difficultyTier, spawnTableID, repetitions) {
  const source = rawReport && typeof rawReport === "object" ? rawReport : {};
  const spawns = Array.isArray(source.spawns)
    ? source.spawns.map(normalizeSpawn)
    : [];

  return {
    difficulty_tier: toInteger(source.difficulty_tier ?? source.difficultyTier, difficultyTier),
    spawn_table_id: toInteger(source.spawn_table_id ?? source.spawnTableID, spawnTableID),
    repetitions: toInteger(source.repetitions, repetitions),
    average_spawn_points: Math.max(
      0,
      toInteger(source.average_spawn_points ?? source.averageSpawnPoints, 0),
    ),
    average_spent_points: Math.max(
      0,
      toInteger(source.average_spent_points ?? source.averageSpentPoints, 0),
    ),
    average_remaining_points: Math.max(
      0,
      toInteger(source.average_remaining_points ?? source.averageRemainingPoints, 0),
    ),
    average_number_of_npcs: Math.max(
      0,
      toInteger(source.average_number_of_npcs ?? source.averageNumberOfNpcs, 0),
    ),
    unsupported_tag_names: normalizeStringArray(
      source.unsupported_tag_names ?? source.unsupportedTagNames,
    ),
    unsupported_tags: normalizeIntegerArray(
      source.unsupported_tags ?? source.unsupportedTags,
    ),
    spawns,
  };
}

function marshalNpc(entry = {}) {
  return buildDict([
    ["quantity", entry.quantity],
    ["type_id", entry.type_id],
    ["behavior_name", entry.behavior_name],
    ["behavior_id", entry.behavior_id],
    ["cost", entry.cost],
    ["total_cost", entry.total_cost],
    ["npc_tag_names", buildList(entry.npc_tag_names)],
    ["npc_tags", buildList(entry.npc_tags)],
  ]);
}

function marshalSpawn(entry = {}) {
  return buildDict([
    ["npc_fleet_type_name", entry.npc_fleet_type_name],
    ["npc_fleet_type_id", entry.npc_fleet_type_id],
    ["group_behavior_name", entry.group_behavior_name],
    ["group_behavior_id", entry.group_behavior_id],
    ["spawn_points", entry.spawn_points],
    ["spent_points", entry.spent_points],
    ["remaining_points", entry.remaining_points],
    ["npc_fleet_spawn_tag_names", buildList(entry.npc_fleet_spawn_tag_names)],
    ["npc_fleet_spawn_tags", buildList(entry.npc_fleet_spawn_tags)],
    ["npcs", buildList((entry.npcs || []).map(marshalNpc))],
  ]);
}

function marshalReport(report = {}) {
  return buildDict([
    ["difficulty_tier", report.difficulty_tier],
    ["spawn_table_id", report.spawn_table_id],
    ["repetitions", report.repetitions],
    ["average_spawn_points", report.average_spawn_points],
    ["average_spent_points", report.average_spent_points],
    ["average_remaining_points", report.average_remaining_points],
    ["average_number_of_npcs", report.average_number_of_npcs],
    ["unsupported_tag_names", buildList(report.unsupported_tag_names || [])],
    ["unsupported_tags", buildList(report.unsupported_tags || [])],
    ["spawns", buildList((report.spawns || []).map(marshalSpawn))],
  ]);
}

class AbyssalContentManagerService extends BaseService {
  constructor() {
    super("abyssal_content_manager");
  }

  Handle_generate_abyss_npc_spawn_report(args, session) {
    const difficultyTier = toInteger(args && args[0], 0);
    const spawnTableID = toInteger(args && args[1], 0);
    const repetitions = Math.min(
      MAX_REPETITIONS,
      Math.max(0, toInteger(args && args[2], 0)),
    );

    if (typeof reportProvider === "function") {
      const provided = reportProvider({
        difficultyTier,
        spawnTableID,
        repetitions,
        session,
      });
      const report = normalizeReport(
        provided,
        difficultyTier,
        spawnTableID,
        repetitions,
      );
      recordAuditEvent("abyssal_spawn_report_fixture_returned", args, session, {
        difficultyTier,
        spawnTableID,
        repetitions,
        spawnCount: report.spawns.length,
      });
      return marshalReport(report);
    }

    recordAuditEvent("abyssal_spawn_report_empty", args, session, {
      difficultyTier,
      spawnTableID,
      repetitions,
    });
    log.debug(
      "[AbyssalContentManager] Returning empty NPC spawn report: authored Abyssal spawn tables are unavailable",
    );
    return marshalReport(buildEmptyReport(difficultyTier, spawnTableID, repetitions));
  }
}

AbyssalContentManagerService._testing = {
  buildEmptyReport,
  marshalReport,
  getAuditEvents() {
    return auditEvents.map((entry) => ({
      ...entry,
      details: { ...(entry.details || {}) },
    }));
  },
  resetForTests() {
    auditEvents.length = 0;
    reportProvider = null;
  },
  setReportProviderForTests(provider) {
    reportProvider = typeof provider === "function" ? provider : null;
  },
};

module.exports = AbyssalContentManagerService;
