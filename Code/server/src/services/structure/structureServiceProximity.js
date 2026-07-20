const path = require("path");

const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const {
  getDeploymentDistance,
} = require(path.join(__dirname, "./structureDeploymentPlacement"));
const {
  serviceOfflinesIfStructureTooClose,
} = require(path.join(__dirname, "./structureServiceAuthority"));

const CATEGORY_STRUCTURE = 65;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getTypeRecord(typeID) {
  return resolveItemByTypeID(toPositiveInt(typeID, 0)) || null;
}

function getTypeCategoryID(typeID) {
  const record = getTypeRecord(typeID);
  return toPositiveInt(record && record.categoryID, 0);
}

function getTypeRadius(typeID) {
  const record = getTypeRecord(typeID);
  return Math.max(0, toFiniteNumber(record && record.radius, 0));
}

function isCategoryStructureType(typeID) {
  return getTypeCategoryID(typeID) === CATEGORY_STRUCTURE;
}

function getStructureRadius(structure) {
  return Math.max(
    0,
    toFiniteNumber(
      structure && structure.radius,
      getTypeRadius(structure && structure.typeID),
    ),
  );
}

function normalizePosition(position) {
  if (!position || typeof position !== "object") {
    return null;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
}

function distanceBetween(left, right) {
  const a = normalizePosition(left);
  const b = normalizePosition(right);
  if (!a || !b) {
    return null;
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function getMinimumCategoryStructureDistanceMeters(structure, otherStructure) {
  if (
    !structure ||
    !otherStructure ||
    !isCategoryStructureType(structure.typeID) ||
    !isCategoryStructureType(otherStructure.typeID)
  ) {
    return 0;
  }
  const ownDeploymentDistance = getDeploymentDistance(structure.typeID);
  const otherDeploymentDistance = getDeploymentDistance(otherStructure.typeID);
  const minimumDistance = Math.min(
    Math.max(0, toFiniteNumber(ownDeploymentDistance, 0)),
    Math.max(0, toFiniteNumber(otherDeploymentDistance, 0)),
  );
  if (minimumDistance <= 0) {
    return 0;
  }
  return minimumDistance + getStructureRadius(structure) + getStructureRadius(otherStructure);
}

function findServiceProximityConflict(structure, serviceID, structures = []) {
  const numericServiceID = toPositiveInt(serviceID, 0);
  if (!structure || !serviceOfflinesIfStructureTooClose(numericServiceID)) {
    return null;
  }
  const structureID = toPositiveInt(structure.structureID, 0);
  const systemID = toPositiveInt(structure.solarSystemID, 0);
  const position = normalizePosition(structure.position);
  if (!structureID || !systemID || !position || !isCategoryStructureType(structure.typeID)) {
    return null;
  }
  for (const candidate of Array.isArray(structures) ? structures : []) {
    const otherStructureID = toPositiveInt(candidate && candidate.structureID, 0);
    if (!otherStructureID || otherStructureID === structureID) {
      continue;
    }
    if (toPositiveInt(candidate && candidate.solarSystemID, 0) !== systemID) {
      continue;
    }
    if (candidate && candidate.destroyedAt) {
      continue;
    }
    if (!normalizePosition(candidate && candidate.position)) {
      continue;
    }
    const minimumDistance = getMinimumCategoryStructureDistanceMeters(structure, candidate);
    if (minimumDistance <= 0) {
      continue;
    }
    const distance = distanceBetween(position, candidate.position);
    if (distance !== null && distance < minimumDistance) {
      return {
        serviceID: numericServiceID,
        structureID,
        otherStructureID,
        distance,
        minimumDistance,
        otherTypeID: toPositiveInt(candidate.typeID, 0),
      };
    }
  }
  return null;
}

function getServiceProximityCandidatesForSystem(structure, structures = []) {
  const systemID = toPositiveInt(structure && structure.solarSystemID, 0);
  if (!systemID) {
    return [];
  }
  return (Array.isArray(structures) ? structures : [])
    .filter((candidate) => toPositiveInt(candidate && candidate.solarSystemID, 0) === systemID);
}

module.exports = {
  CATEGORY_STRUCTURE,
  distanceBetween,
  findServiceProximityConflict,
  getMinimumCategoryStructureDistanceMeters,
  getServiceProximityCandidatesForSystem,
  isCategoryStructureType,
};
