const path = require("path");

const {
  buildKeyVal,
  buildList,
  buildRowset,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const MAP_ROWSET = "eve.common.script.sys.rowset.Rowset";

const FACTION_SANSHA_NATION = 500019;
const INCURSION_STATE_ESTABLISHED = 2;
const TEMPLATE_CLASS_INCURSION = 2;
const SCENE_TYPE_STAGING = 4;

const INCURSION_SYSTEM_COLUMNS = Object.freeze([
  "locationID",
  "sceneType",
  "templateNameID",
]);

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const integerValue = Math.trunc(numericValue);
  return integerValue > 0 ? integerValue : fallback;
}

function normalizeIncursionState(value) {
  const state = Math.trunc(normalizeNumber(value, INCURSION_STATE_ESTABLISHED));
  return [0, 1, 2].includes(state) ? state : INCURSION_STATE_ESTABLISHED;
}

function normalizeInfluence(value) {
  const influence = normalizeNumber(value, 0);
  if (!Number.isFinite(influence)) {
    return 0;
  }
  return Math.max(0, Math.min(1, influence));
}

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return buildList([]);
  }
  return buildList(value);
}

function buildIncursionReportEntry(rawIncursion = {}) {
  const stagingSolarSystemID = normalizePositiveInteger(
    rawIncursion.stagingSolarSystemID || rawIncursion.solarSystemID,
    0,
  );

  return buildKeyVal([
    ["taleID", normalizePositiveInteger(rawIncursion.taleID, 0)],
    [
      "templateClassID",
      normalizePositiveInteger(rawIncursion.templateClassID, TEMPLATE_CLASS_INCURSION),
    ],
    ["templateNameID", normalizePositiveInteger(rawIncursion.templateNameID, 0)],
    ["stagingSolarSystemID", stagingSolarSystemID],
    [
      "aggressorFactionID",
      normalizePositiveInteger(rawIncursion.aggressorFactionID, FACTION_SANSHA_NATION),
    ],
    ["state", normalizeIncursionState(rawIncursion.state)],
    ["influence", normalizeInfluence(rawIncursion.influence)],
    ["hasFinalEncounter", Boolean(rawIncursion.hasFinalEncounter)],
    ["effects", normalizeList(rawIncursion.effects)],
    ["rewardGroupID", normalizePositiveInteger(rawIncursion.rewardGroupID, 0)],
    ["incursedSystems", normalizeList(rawIncursion.incursedSystems)],
    [
      "severity",
      normalizePositiveInteger(rawIncursion.severity || rawIncursion.sceneType, SCENE_TYPE_STAGING),
    ],
    ["hasChat", Boolean(rawIncursion.hasChat)],
    [
      "chatAnnouncementMessageId",
      normalizePositiveInteger(rawIncursion.chatAnnouncementMessageId, 0),
    ],
    ["musicState", rawIncursion.musicState || null],
  ]);
}

function buildIncursionGlobalReport(rawIncursions = []) {
  if (!Array.isArray(rawIncursions) || rawIncursions.length === 0) {
    return [];
  }
  return rawIncursions
    .filter((entry) => normalizePositiveInteger(
      entry && (entry.stagingSolarSystemID || entry.solarSystemID),
      0,
    ) > 0)
    .map((entry) => buildIncursionReportEntry(entry));
}

function normalizeIncursionSystemRow(rawSystem = {}, defaultTemplateNameID = 0) {
  if (typeof rawSystem === "number") {
    return [
      normalizePositiveInteger(rawSystem, 0),
      SCENE_TYPE_STAGING,
      normalizePositiveInteger(defaultTemplateNameID, 0),
    ];
  }

  return [
    normalizePositiveInteger(rawSystem.locationID || rawSystem.solarSystemID, 0),
    normalizePositiveInteger(rawSystem.sceneType, SCENE_TYPE_STAGING),
    normalizePositiveInteger(rawSystem.templateNameID, defaultTemplateNameID),
  ];
}

function deriveSystemRowsFromIncursion(rawIncursion = {}) {
  const defaultTemplateNameID = normalizePositiveInteger(rawIncursion.templateNameID, 0);
  const sourceSystems = Array.isArray(rawIncursion.systems)
    ? rawIncursion.systems
    : Array.isArray(rawIncursion.systemRows)
      ? rawIncursion.systemRows
      : [];

  return sourceSystems
    .map((entry) => normalizeIncursionSystemRow(entry, defaultTemplateNameID))
    .filter(([locationID]) => locationID > 0);
}

function buildSystemsInIncursionsRowset(rawIncursions = []) {
  const rows = [];
  for (const rawIncursion of Array.isArray(rawIncursions) ? rawIncursions : []) {
    rows.push(...deriveSystemRowsFromIncursion(rawIncursion));
  }

  return buildRowset(INCURSION_SYSTEM_COLUMNS, rows, MAP_ROWSET);
}

module.exports = {
  FACTION_SANSHA_NATION,
  INCURSION_STATE_ESTABLISHED,
  TEMPLATE_CLASS_INCURSION,
  SCENE_TYPE_STAGING,
  INCURSION_SYSTEM_COLUMNS,
  buildIncursionReportEntry,
  buildIncursionGlobalReport,
  buildSystemsInIncursionsRowset,
};
