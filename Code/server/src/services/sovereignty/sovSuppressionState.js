const path = require("path");

const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const {
  STRUCTURE_STATE,
  STRUCTURE_UPKEEP_STATE,
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  getHubIDForSolarSystem,
  getHubUpgrades,
} = require(path.join(__dirname, "./sovModernState"));
const {
  TYPE_CYNO_SUPPRESSION_UPGRADE,
  TYPE_TENEBREX_CYNO_JAMMER,
} = require(path.join(__dirname, "./sovUpgradeSupport"));
const {
  findServiceProximityConflict,
} = require(path.join(__dirname, "../structure/structureServiceProximity"));
const {
  broadcastCynoJammerChanged,
} = require(path.join(__dirname, "./sovNotifications"));

const ACTIVE_CYNO_JAMMER_STATES = new Set([
  STRUCTURE_STATE.SHIELD_VULNERABLE,
  STRUCTURE_STATE.ARMOR_REINFORCE,
  STRUCTURE_STATE.ARMOR_VULNERABLE,
  STRUCTURE_STATE.HULL_REINFORCE,
  STRUCTURE_STATE.HULL_VULNERABLE,
  STRUCTURE_STATE.FITTING_INVULNERABLE,
  STRUCTURE_STATE.ONLINE_DEPRECATED,
  STRUCTURE_STATE.FOB_INVULNERABLE,
]);

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function listStructuresForSuppressionSystem(solarSystemID, options = {}) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return [];
  }
  if (Array.isArray(options.structureRows)) {
    return options.structureRows.filter((structure) => (
      normalizePositiveInteger(structure && structure.solarSystemID, 0) ===
      numericSolarSystemID
    ));
  }
  return structureState.listStructuresForSystem(numericSolarSystemID, {
    includeDestroyed: true,
    refresh: false,
  });
}

function getLiveTenebrexForSolarSystem(solarSystemID, options = {}) {
  const structures = listStructuresForSuppressionSystem(solarSystemID, options);
  return structures.find((structure) => (
    normalizePositiveInteger(structure && structure.typeID, 0) === TYPE_TENEBREX_CYNO_JAMMER &&
    !normalizePositiveInteger(structure && structure.destroyedAt, null)
  )) || null;
}

function getLiveTenebrexStructuresForSolarSystem(solarSystemID, options = {}) {
  return listStructuresForSuppressionSystem(solarSystemID, options).filter((structure) => (
    normalizePositiveInteger(structure && structure.typeID, 0) === TYPE_TENEBREX_CYNO_JAMMER &&
    !normalizePositiveInteger(structure && structure.destroyedAt, null)
  ));
}

function isCynoSuppressionUpgradeOnline(solarSystemID) {
  const hubID = normalizePositiveInteger(getHubIDForSolarSystem(solarSystemID), null);
  if (!hubID) {
    return false;
  }
  const upgrades = getHubUpgrades(hubID);
  const cynoSuppression = Array.isArray(upgrades && upgrades.upgrades)
    ? upgrades.upgrades.find(
      (upgrade) => normalizePositiveInteger(upgrade && upgrade.typeID, 0) === TYPE_CYNO_SUPPRESSION_UPGRADE,
    ) || null
    : null;
  return normalizeInteger(cynoSuppression && cynoSuppression.powerState, 0) === 2;
}

function isTenebrexOperational(structure, nowMs = Date.now(), options = {}) {
  if (!structure) {
    return false;
  }
  if (
    normalizeInteger(
      structure &&
        structure.serviceStates &&
        structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_JAMMER)],
      0,
    ) !== STRUCTURE_SERVICE_STATE.ONLINE
  ) {
    return false;
  }
  if (
    normalizeInteger(structure && structure.upkeepState, 0) !==
    STRUCTURE_UPKEEP_STATE.FULL_POWER
  ) {
    return false;
  }
  if (normalizeInteger(structure && structure.liquidOzoneQty, 0) <= 0) {
    return false;
  }
  if (normalizeInteger(structure && structure.fuelExpiresAt, 0) <= normalizeInteger(nowMs, 0)) {
    return false;
  }
  if (
    findServiceProximityConflict(
      structure,
      STRUCTURE_SERVICE_ID.CYNO_JAMMER,
      listStructuresForSuppressionSystem(structure.solarSystemID, options).filter((candidate) => (
        !normalizePositiveInteger(candidate && candidate.destroyedAt, null)
      )),
    )
  ) {
    return false;
  }
  return true;
}

function collectChangedStructureSystemIDs(previousRows = [], nextRows = []) {
  const previousByID = new Map(
    (Array.isArray(previousRows) ? previousRows : [])
      .map((entry) => [normalizePositiveInteger(entry && entry.structureID, 0), entry])
      .filter(([structureID]) => structureID > 0),
  );
  const nextByID = new Map(
    (Array.isArray(nextRows) ? nextRows : [])
      .map((entry) => [normalizePositiveInteger(entry && entry.structureID, 0), entry])
      .filter(([structureID]) => structureID > 0),
  );
  const changedSystemIDs = new Set();
  for (const structureID of new Set([...previousByID.keys(), ...nextByID.keys()])) {
    const previous = previousByID.get(structureID) || null;
    const next = nextByID.get(structureID) || null;
    if (JSON.stringify(previous) === JSON.stringify(next)) {
      continue;
    }
    const previousSystemID = normalizePositiveInteger(previous && previous.solarSystemID, 0);
    const nextSystemID = normalizePositiveInteger(next && next.solarSystemID, 0);
    if (previousSystemID) {
      changedSystemIDs.add(previousSystemID);
    }
    if (nextSystemID) {
      changedSystemIDs.add(nextSystemID);
    }
  }
  return [...changedSystemIDs];
}

function formatOnlineSimTimeForCompare(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  return typeof value === "bigint" ? `${value.toString()}n` : String(value);
}

function broadcastCynoJammerChangesForStructureRows(previousRows = [], nextRows = [], options = {}) {
  const systemIDs = Array.isArray(options.systemIDs)
    ? options.systemIDs
    : collectChangedStructureSystemIDs(previousRows, nextRows);
  let notifiedSessions = 0;
  for (const systemID of systemIDs) {
    const numericSystemID = normalizePositiveInteger(systemID, null);
    if (!numericSystemID) {
      continue;
    }
    const previousSimTime = getCynoJammerOnlineSimTime(numericSystemID, {
      ...options,
      structureRows: previousRows,
    });
    const nextSimTime = getCynoJammerOnlineSimTime(numericSystemID, {
      ...options,
      structureRows: nextRows,
    });
    if (
      formatOnlineSimTimeForCompare(previousSimTime) ===
      formatOnlineSimTimeForCompare(nextSimTime)
    ) {
      continue;
    }
    notifiedSessions += broadcastCynoJammerChanged(numericSystemID, nextSimTime);
  }
  return notifiedSessions;
}

function getCynoJammerActivationTimeMs(solarSystemID, options = {}) {
  const nowMs = normalizeInteger(options.nowMs, Date.now());
  if (!isCynoSuppressionUpgradeOnline(solarSystemID)) {
    return null;
  }
  const structure = getLiveTenebrexStructuresForSolarSystem(solarSystemID, options)
    .find((candidate) => isTenebrexOperational(candidate, nowMs, options)) || null;
  if (!structure) {
    return null;
  }
  const state = normalizeInteger(structure && structure.state, 0);
  const stateEndsAt = normalizeInteger(structure && structure.stateEndsAt, 0);
  const flexFuelState =
    structure &&
    structure.devFlags &&
    structure.devFlags.flexFuelState &&
    typeof structure.devFlags.flexFuelState === "object"
      ? structure.devFlags.flexFuelState
      : null;
  const serviceActivatesAt = normalizeInteger(
    flexFuelState && flexFuelState.cynoJamActivatesAt,
    0,
  );
  const pendingActivationTimes = [];
  if (state === STRUCTURE_STATE.ONLINING_VULNERABLE && stateEndsAt > nowMs) {
    pendingActivationTimes.push(stateEndsAt);
  }
  if (serviceActivatesAt > nowMs) {
    pendingActivationTimes.push(serviceActivatesAt);
  }
  if (pendingActivationTimes.length > 0) {
    return Math.max(...pendingActivationTimes);
  }
  if (ACTIVE_CYNO_JAMMER_STATES.has(state)) {
    return 0;
  }
  return null;
}

function getCynoJammerOnlineSimTime(solarSystemID, options = {}) {
  const activationTimeMs = getCynoJammerActivationTimeMs(solarSystemID, options);
  if (activationTimeMs === null) {
    return null;
  }
  if (activationTimeMs === 0) {
    return 0;
  }
  return structureState.toFileTimeLongFromMs(activationTimeMs);
}

function isSolarSystemCynoJammed(solarSystemID, options = {}) {
  const nowMs = normalizeInteger(options.nowMs, Date.now());
  const activationTimeMs = getCynoJammerActivationTimeMs(solarSystemID, options);
  return activationTimeMs === 0 || (
    normalizePositiveInteger(activationTimeMs, null) !== null &&
    normalizeInteger(activationTimeMs, 0) <= nowMs
  );
}

module.exports = {
  broadcastCynoJammerChangesForStructureRows,
  getCynoJammerOnlineSimTime,
  getLiveTenebrexForSolarSystem,
  getCynoJammerActivationTimeMs,
  isSolarSystemCynoJammed,
};
