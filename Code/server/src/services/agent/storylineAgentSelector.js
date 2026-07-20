const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  listAgents,
} = require(path.join(__dirname, "./agentAuthority"));

const GENERIC_STORYLINE_AGENT_TYPE_ID = 6;
const STORYLINE_AGENT_TYPE_ID = 7;
const STORYLINE_AGENT_TYPE_IDS = Object.freeze([
  GENERIC_STORYLINE_AGENT_TYPE_ID,
  STORYLINE_AGENT_TYPE_ID,
]);
const HIGH_SEC_MINIMUM_SECURITY = 0.45;

let cache = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  const normalized = Math.trunc(numericValue);
  return normalized > 0 ? normalized : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text.length > 0 ? text : fallback;
}

function getSolarSystemSecurity(system) {
  if (!system || typeof system !== "object") {
    return 0;
  }
  return toFiniteNumber(
    system.security ?? system.securityStatus,
    0,
  );
}

function isHighSecSystem(system) {
  return getSolarSystemSecurity(system) >= HIGH_SEC_MINIMUM_SECURITY;
}

function isStorylineAgentRecord(agentRecord) {
  return STORYLINE_AGENT_TYPE_IDS.includes(toPositiveInteger(agentRecord && agentRecord.agentTypeID, 0));
}

function normalizeStorylineAgent(agentRecord) {
  if (!isStorylineAgentRecord(agentRecord)) {
    return null;
  }
  const agentID = toPositiveInteger(agentRecord.agentID, 0);
  const factionID = toPositiveInteger(agentRecord.factionID, 0);
  const solarSystemID = toPositiveInteger(agentRecord.solarSystemID, 0);
  if (!agentID || !factionID || !solarSystemID) {
    return null;
  }

  const system = worldData.getSolarSystemByID(solarSystemID);
  return {
    agentID,
    ownerName: normalizeText(agentRecord.ownerName, String(agentID)),
    agentTypeID: toPositiveInteger(agentRecord.agentTypeID, 0),
    factionID,
    corporationID: toPositiveInteger(agentRecord.corporationID, 0) || null,
    stationID: toPositiveInteger(agentRecord.stationID, 0) || null,
    solarSystemID,
    missionKind: normalizeText(agentRecord.missionKind, ""),
    level: toPositiveInteger(agentRecord.level, 0) || null,
    highSec: isHighSecSystem(system),
    securityStatus: system ? getSolarSystemSecurity(system) : null,
  };
}

function buildAdjacency() {
  const adjacency = new Map();
  for (const system of worldData.getSolarSystems()) {
    const solarSystemID = toPositiveInteger(system && system.solarSystemID, 0);
    if (solarSystemID) {
      adjacency.set(solarSystemID, []);
    }
  }

  for (const systemID of adjacency.keys()) {
    const neighbors = worldData.getStargatesForSystem(systemID)
      .map((stargate) => toPositiveInteger(stargate && stargate.destinationSolarSystemID, 0))
      .filter((destinationSystemID) => destinationSystemID > 0);
    adjacency.set(
      systemID,
      [...new Set(neighbors)].sort((left, right) => left - right),
    );
  }
  return adjacency;
}

function buildStorylineSelectorIndex() {
  const storylineAgents = listAgents()
    .map(normalizeStorylineAgent)
    .filter(Boolean)
    .sort((left, right) => left.agentID - right.agentID);
  const agentsBySystemID = new Map();
  for (const agent of storylineAgents) {
    if (!agentsBySystemID.has(agent.solarSystemID)) {
      agentsBySystemID.set(agent.solarSystemID, []);
    }
    agentsBySystemID.get(agent.solarSystemID).push(agent);
  }
  for (const agents of agentsBySystemID.values()) {
    agents.sort((left, right) => (
      left.agentTypeID - right.agentTypeID ||
      left.agentID - right.agentID
    ));
  }

  return {
    storylineAgents,
    agentsBySystemID,
    adjacency: buildAdjacency(),
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildStorylineSelectorIndex();
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function normalizeExcludedAgentIDs(excludedAgentIDs) {
  if (excludedAgentIDs instanceof Set) {
    return new Set(
      [...excludedAgentIDs]
        .map((entry) => toPositiveInteger(entry, 0))
        .filter((entry) => entry > 0),
    );
  }
  const values = Array.isArray(excludedAgentIDs)
    ? excludedAgentIDs
    : [];
  return new Set(
    values
      .map((entry) => toPositiveInteger(entry, 0))
      .filter((entry) => entry > 0),
  );
}

function getRequireHighSecDefault(startSolarSystemID) {
  const system = worldData.getSolarSystemByID(startSolarSystemID);
  return isHighSecSystem(system);
}

function findNearestStorylineAgent({
  startSolarSystemID,
  factionID,
  missionLevel,
  requireHighSec = null,
  excludedAgentIDs = [],
} = {}) {
  const normalizedStartSystemID = toPositiveInteger(startSolarSystemID, 0);
  const normalizedFactionID = toPositiveInteger(factionID, 0);
  const normalizedMissionLevel = toPositiveInteger(missionLevel, 0);
  if (!normalizedStartSystemID || !normalizedFactionID || !normalizedMissionLevel) {
    return null;
  }

  const selectorIndex = ensureCache();
  if (!selectorIndex.adjacency.has(normalizedStartSystemID)) {
    return null;
  }

  const shouldRequireHighSec =
    requireHighSec === null || requireHighSec === undefined
      ? getRequireHighSecDefault(normalizedStartSystemID)
      : requireHighSec === true;
  const excluded = normalizeExcludedAgentIDs(excludedAgentIDs);
  const visited = new Set([normalizedStartSystemID]);
  const queue = [{
    solarSystemID: normalizedStartSystemID,
    jumpDistance: 0,
  }];

  while (queue.length > 0) {
    const current = queue.shift();
    const candidates = (selectorIndex.agentsBySystemID.get(current.solarSystemID) || [])
      .filter((agent) => (
        agent.factionID === normalizedFactionID &&
        (!shouldRequireHighSec || agent.highSec) &&
        !excluded.has(agent.agentID)
      ));

    if (candidates.length > 0) {
      return {
        ...cloneValue(candidates[0]),
        offerLevel: normalizedMissionLevel,
        jumpDistance: current.jumpDistance,
        startSolarSystemID: normalizedStartSystemID,
        requireHighSec: shouldRequireHighSec,
        selectorSource: "agentAuthority+worldData",
      };
    }

    const neighbors = selectorIndex.adjacency.get(current.solarSystemID) || [];
    for (const neighborSystemID of neighbors) {
      if (visited.has(neighborSystemID)) {
        continue;
      }
      visited.add(neighborSystemID);
      queue.push({
        solarSystemID: neighborSystemID,
        jumpDistance: current.jumpDistance + 1,
      });
    }
  }

  return null;
}

function getStorylineSelectorSummary() {
  const selectorIndex = ensureCache();
  const highSecCount = selectorIndex.storylineAgents.filter((agent) => agent.highSec).length;
  return {
    storylineAgentCount: selectorIndex.storylineAgents.length,
    highSecStorylineAgentCount: highSecCount,
    lowOrNullSecStorylineAgentCount: selectorIndex.storylineAgents.length - highSecCount,
    indexedSystemCount: selectorIndex.agentsBySystemID.size,
    routeSystemCount: selectorIndex.adjacency.size,
    routeDirectedEdgeCount: [...selectorIndex.adjacency.values()]
      .reduce((total, neighbors) => total + neighbors.length, 0),
  };
}

module.exports = {
  GENERIC_STORYLINE_AGENT_TYPE_ID,
  HIGH_SEC_MINIMUM_SECURITY,
  STORYLINE_AGENT_TYPE_ID,
  STORYLINE_AGENT_TYPE_IDS,
  clearCache,
  findNearestStorylineAgent,
  getStorylineSelectorSummary,
  isHighSecSystem,
  isStorylineAgentRecord,
};
