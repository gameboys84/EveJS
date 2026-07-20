const path = require("path");
const fs = require("fs");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const AGENTS_IN_SPACE_JSONL_PATH = path.join(
  REPO_ROOT,
  "tools",
  "DataSync",
  "source_json",
  "eve-online-static-data-3396210-jsonl",
  "agentsInSpace.jsonl",
);

let cache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizePayload(payload = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: String(payload.generatedAt || "").trim(),
    source: normalizeObject(payload.source),
    counts: normalizeObject(payload.counts),
    missionPoolsByKindAndLevel: normalizeObject(payload.missionPoolsByKindAndLevel),
    agentsByID: normalizeObject(payload.agentsByID),
    indexes: normalizeObject(payload.indexes),
  };
}

function readAgentsInSpaceRows() {
  if (!fs.existsSync(AGENTS_IN_SPACE_JSONL_PATH)) {
    return [];
  }
  const content = fs.readFileSync(AGENTS_IN_SPACE_JSONL_PATH, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((row) => ({
      agentID: normalizePositiveInt(row && row._key, 0),
      dungeonID: normalizePositiveInt(row && row.dungeonID, 0),
      solarSystemID: normalizePositiveInt(row && row.solarSystemID, 0),
      spawnPointID: normalizePositiveInt(row && row.spawnPointID, 0),
      typeID: normalizePositiveInt(row && row.typeID, 0),
    }))
    .filter((row) => row.agentID > 0 && row.solarSystemID > 0);
}

function buildAgentsInSpaceByID() {
  const agentsInSpaceByID = new Map();
  for (const row of readAgentsInSpaceRows()) {
    agentsInSpaceByID.set(row.agentID, row);
  }
  return agentsInSpaceByID;
}

function applyInSpaceOverlay(record, inSpaceRow) {
  if (!record || !inSpaceRow) {
    return record;
  }
  const originalStationID = normalizePositiveInt(record.stationID, 0);
  const originalSolarSystemID = normalizePositiveInt(record.solarSystemID, 0);
  return {
    ...record,
    stationID: null,
    sourceStationID: originalStationID || null,
    sourceSolarSystemID: originalSolarSystemID || null,
    solarSystemID: inSpaceRow.solarSystemID,
    isInSpace: true,
    agentInSpace: {
      source: "sde:agentsInSpace",
      sourceBuild: 3396210,
      agentID: inSpaceRow.agentID,
      dungeonID: inSpaceRow.dungeonID || null,
      spawnPointID: inSpaceRow.spawnPointID || null,
      solarSystemID: inSpaceRow.solarSystemID,
      typeID: inSpaceRow.typeID || null,
    },
  };
}

function addIndexValue(indexes, indexName, key, agentID) {
  const normalizedKey = normalizePositiveInt(key, 0);
  const normalizedAgentID = normalizePositiveInt(agentID, 0);
  if (!normalizedKey || !normalizedAgentID) {
    return;
  }
  if (!indexes[indexName].has(String(normalizedKey))) {
    indexes[indexName].set(String(normalizedKey), []);
  }
  indexes[indexName].get(String(normalizedKey)).push(normalizedAgentID);
}

function buildIndexes(agentsByID) {
  const indexes = {
    stationIDToAgentIDs: new Map(),
    corporationIDToAgentIDs: new Map(),
    factionIDToAgentIDs: new Map(),
    solarSystemIDToAgentIDs: new Map(),
  };

  for (const record of agentsByID.values()) {
    const agentID = normalizePositiveInt(record && record.agentID, 0);
    addIndexValue(indexes, "stationIDToAgentIDs", record && record.stationID, agentID);
    addIndexValue(indexes, "corporationIDToAgentIDs", record && record.corporationID, agentID);
    addIndexValue(indexes, "factionIDToAgentIDs", record && record.factionID, agentID);
    addIndexValue(indexes, "solarSystemIDToAgentIDs", record && record.solarSystemID, agentID);
  }

  for (const index of Object.values(indexes)) {
    for (const [key, agentIDs] of index.entries()) {
      index.set(
        key,
        [...new Set(agentIDs)].sort((left, right) => left - right),
      );
    }
  }

  return indexes;
}

function buildCache() {
  const payload = normalizePayload(readStaticTable(TABLE.AGENT_AUTHORITY));
  const agentsInSpaceByID = buildAgentsInSpaceByID();
  const agentsByID = new Map();
  for (const [agentID, record] of Object.entries(payload.agentsByID || {})) {
    const normalizedAgentID = toInt(agentID, 0);
    agentsByID.set(normalizedAgentID, applyInSpaceOverlay({
      ...clone(record),
      agentID: toInt(record && record.agentID, normalizedAgentID),
    }, agentsInSpaceByID.get(normalizedAgentID)));
  }

  return {
    payload,
    agentsByID,
    agentsInSpaceByID,
    indexes: buildIndexes(agentsByID),
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function getPayload() {
  return clone(ensureCache().payload);
}

function getAgentByID(agentID) {
  const record = ensureCache().agentsByID.get(toInt(agentID, 0));
  return record ? clone(record) : null;
}

function listAgents() {
  return [...ensureCache().agentsByID.values()]
    .map((record) => clone(record))
    .sort((left, right) => left.agentID - right.agentID);
}

function listAgentIDsByIndex(indexName, key) {
  const index = ensureCache().indexes[indexName];
  if (!index || typeof index.get !== "function") {
    return [];
  }
  const agentIDs = index.get(String(normalizePositiveInt(key, 0)));
  return Array.isArray(agentIDs) ? clone(agentIDs) : [];
}

function listAgentsByStationID(stationID) {
  return listAgentIDsByIndex("stationIDToAgentIDs", stationID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listAgentsByCorporationID(corporationID) {
  return listAgentIDsByIndex("corporationIDToAgentIDs", corporationID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listAgentsByFactionID(factionID) {
  return listAgentIDsByIndex("factionIDToAgentIDs", factionID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listAgentsBySolarSystemID(solarSystemID) {
  return listAgentIDsByIndex("solarSystemIDToAgentIDs", solarSystemID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listMissionTemplateIDsForAgent(agentID) {
  const agent = getAgentByID(agentID);
  return Array.isArray(agent && agent.missionTemplateIDs)
    ? clone(agent.missionTemplateIDs)
    : [];
}

function getMissionPoolForAgent(agentID) {
  const agent = getAgentByID(agentID);
  if (!agent) {
    return [];
  }
  return listMissionTemplateIDsForAgent(agentID);
}

function getAgentInSpaceByID(agentID) {
  const row = ensureCache().agentsInSpaceByID.get(toInt(agentID, 0));
  return row ? clone(row) : null;
}

function listAgentsInSpace() {
  return [...ensureCache().agentsInSpaceByID.values()]
    .map((record) => clone(record))
    .sort((left, right) => left.agentID - right.agentID);
}

module.exports = {
  clearCache,
  getAgentInSpaceByID,
  getAgentByID,
  getMissionPoolForAgent,
  getPayload,
  listAgents,
  listAgentsInSpace,
  listAgentsByCorporationID,
  listAgentsByFactionID,
  listAgentsBySolarSystemID,
  listAgentsByStationID,
  listMissionTemplateIDsForAgent,
};
