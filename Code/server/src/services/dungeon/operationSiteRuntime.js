const operationSpawnpointRecords = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clonePosition(value) {
  return {
    x: toFiniteNumber(value && value.x, 0),
    y: toFiniteNumber(value && value.y, 0),
    z: toFiniteNumber(value && value.z, 0),
  };
}

function getCharacterID(session) {
  return Math.max(
    0,
    toInt(
      session && (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
      0,
    ),
  );
}

function buildOperationSpawnpointKey(characterID, siteID) {
  return `${Math.max(0, toInt(characterID, 0))}:${Math.max(0, toInt(siteID, 0))}`;
}

function resolveOperationSiteArgs(args, session) {
  const first = Array.isArray(args) ? Math.max(0, toInt(args[0], 0)) : 0;
  const second = Array.isArray(args) ? Math.max(0, toInt(args[1], 0)) : 0;
  if (second > 0) {
    return {
      characterID: first || getCharacterID(session),
      siteID: second,
    };
  }
  return {
    characterID: getCharacterID(session),
    siteID: first,
  };
}

function normalizeOperationSpawnpointRecord(record) {
  const source = normalizeObject(record);
  const siteID = Math.max(0, toInt(source.siteID, 0));
  const characterID = Math.max(
    0,
    toInt(source.characterID, toInt(source.charID, toInt(source.charid, 0))),
  );
  if (siteID <= 0) {
    return null;
  }
  const position = clonePosition(source.position || source);
  return {
    characterID,
    siteID,
    solarSystemID: Math.max(
      0,
      toInt(source.solarSystemID, toInt(source.solarsystemid2, toInt(source.solarsystemid, 0))),
    ) || null,
    spawnID: Math.max(0, toInt(source.spawnID, toInt(source.spawnId, 0))) || null,
    position,
    isOperationSite: source.isOperationSite === false ? false : true,
  };
}

function registerOperationSpawnpointRecord(record) {
  const normalized = normalizeOperationSpawnpointRecord(record);
  if (!normalized) {
    return null;
  }
  operationSpawnpointRecords.set(
    buildOperationSpawnpointKey(normalized.characterID, normalized.siteID),
    normalized,
  );
  return normalized;
}

function resolveOperationSpawnpointRecord(characterID, siteID) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0) {
    return null;
  }
  const numericCharacterID = Math.max(0, toInt(characterID, 0));
  return (
    operationSpawnpointRecords.get(buildOperationSpawnpointKey(numericCharacterID, numericSiteID)) ||
    operationSpawnpointRecords.get(buildOperationSpawnpointKey(0, numericSiteID)) ||
    null
  );
}

function clearOperationSpawnpointRecords() {
  operationSpawnpointRecords.clear();
}

module.exports = {
  buildOperationSpawnpointKey,
  clearOperationSpawnpointRecords,
  getCharacterID,
  normalizeOperationSpawnpointRecord,
  registerOperationSpawnpointRecord,
  resolveOperationSiteArgs,
  resolveOperationSpawnpointRecord,
};
