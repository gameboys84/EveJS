const path = require("path");

const {
  applyDogmaModifierGroups,
  getActiveImplantShipModifierEntries,
} = require(path.join(
  __dirname,
  "../dogma/implants/activeImplantModifiers",
));

const ATTRIBUTE_DOES_NOT_EMERGENCY_WARP = 1854;
const EMERGENCY_WARP_DISTANCE_METERS = 1_000_000_000;
const DEFAULT_DIRECTION = Object.freeze({ x: 1, y: 0, z: 0 });
const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(value, fallback = ZERO_VECTOR) {
  if (!value || typeof value !== "object") {
    return {
      x: fallback.x,
      y: fallback.y,
      z: fallback.z,
    };
  }

  return {
    x: toFiniteNumber(value.x, fallback.x),
    y: toFiniteNumber(value.y, fallback.y),
    z: toFiniteNumber(value.z, fallback.z),
  };
}

function vectorMagnitude(value) {
  const vector = cloneVector(value);
  return Math.sqrt(
    vector.x * vector.x +
      vector.y * vector.y +
      vector.z * vector.z,
  );
}

function normalizeVector(value, fallback = DEFAULT_DIRECTION) {
  const vector = cloneVector(value, fallback);
  const magnitude = vectorMagnitude(vector);
  if (magnitude <= 1e-9) {
    return cloneVector(fallback, DEFAULT_DIRECTION);
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scale) {
  const numericScale = toFiniteNumber(scale, 0);
  return {
    x: toFiniteNumber(vector && vector.x, 0) * numericScale,
    y: toFiniteNumber(vector && vector.y, 0) * numericScale,
    z: toFiniteNumber(vector && vector.z, 0) * numericScale,
  };
}

function positiveMod(value, divisor) {
  const result = value % divisor;
  return result < 0 ? result + divisor : result;
}

function seededUnitVector(seedValue) {
  const seed = Math.max(1, Math.abs(toInt(seedValue, 1)));
  const thetaSeed = positiveMod((seed * 1103515245 + 12345), 1_000_000) / 1_000_000;
  const zSeed = positiveMod((seed * 1664525 + 1013904223), 1_000_000) / 1_000_000;
  const theta = thetaSeed * Math.PI * 2;
  const z = (zSeed * 2) - 1;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return normalizeVector({
    x: radius * Math.cos(theta),
    y: radius * Math.sin(theta),
    z,
  });
}

function buildEmergencyWarpDirection(liveSpaceState, options = {}) {
  const seed =
    toInt(options.characterID, 0) * 31 +
    toInt(options.shipID, 0) * 17 +
    toInt(liveSpaceState && liveSpaceState.systemID, 0) * 13 +
    Math.trunc(toFiniteNumber(options.nowMs, Date.now()) / 1000);
  return seededUnitVector(seed);
}

function getEmergencyWarpReturnState(spaceState) {
  const returnState =
    spaceState &&
    typeof spaceState === "object" &&
    spaceState.emergencyWarpReturnState &&
    typeof spaceState.emergencyWarpReturnState === "object"
      ? spaceState.emergencyWarpReturnState
      : null;
  if (!returnState) {
    return null;
  }

  const systemID = toInt(returnState.systemID || spaceState.systemID, 0);
  if (systemID <= 0) {
    return null;
  }

  return {
    systemID,
    position: cloneVector(returnState.position),
    velocity: cloneVector(returnState.velocity, ZERO_VECTOR),
    direction: normalizeVector(returnState.direction, DEFAULT_DIRECTION),
    targetPoint: returnState.targetPoint
      ? cloneVector(returnState.targetPoint)
      : cloneVector(returnState.position),
    speedFraction: 0,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    orbitDistance: 0,
    orbitNormal: returnState.orbitNormal
      ? normalizeVector(returnState.orbitNormal, { x: 0, y: 1, z: 0 })
      : null,
    orbitSign: toFiniteNumber(returnState.orbitSign, 1) < 0 ? -1 : 1,
    warpState: null,
    pendingWarp: null,
  };
}

function clearEmergencyWarpReturnState(spaceState) {
  if (!spaceState || typeof spaceState !== "object") {
    return spaceState;
  }
  return {
    ...spaceState,
    emergencyWarpReturnState: null,
  };
}

function buildEmergencyWarpReturnSpaceState(spaceState) {
  const returnState = getEmergencyWarpReturnState(spaceState);
  if (!returnState) {
    return null;
  }
  return {
    ...spaceState,
    ...returnState,
    emergencyWarpReturnState: null,
  };
}

function buildEmergencyWarpLogoffState(liveSpaceState, options = {}) {
  if (!liveSpaceState || typeof liveSpaceState !== "object") {
    return null;
  }
  const systemID = toInt(liveSpaceState.systemID, 0);
  if (systemID <= 0) {
    return null;
  }

  const origin = cloneVector(liveSpaceState.position);
  const liveDirection = normalizeVector(liveSpaceState.direction, DEFAULT_DIRECTION);
  const emergencyDirection = buildEmergencyWarpDirection(liveSpaceState, options);
  const emergencyPosition = addVectors(
    origin,
    scaleVector(emergencyDirection, EMERGENCY_WARP_DISTANCE_METERS),
  );

  return {
    ...liveSpaceState,
    systemID,
    position: emergencyPosition,
    velocity: cloneVector(ZERO_VECTOR),
    direction: emergencyDirection,
    targetPoint: emergencyPosition,
    speedFraction: 0,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    orbitDistance: 0,
    warpState: null,
    pendingWarp: null,
    emergencyWarpReturnState: {
      systemID,
      position: origin,
      velocity: cloneVector(ZERO_VECTOR),
      direction: liveDirection,
      targetPoint: liveSpaceState.targetPoint
        ? cloneVector(liveSpaceState.targetPoint)
        : origin,
      speedFraction: 0,
      mode: "STOP",
      targetEntityID: null,
      followRange: 0,
      orbitDistance: 0,
      warpState: null,
      pendingWarp: null,
    },
  };
}

function shipSuppressesEmergencyWarp(characterOrID) {
  const characterID = toInt(characterOrID && characterOrID.characterID, toInt(characterOrID, 0));
  if (characterID <= 0) {
    return false;
  }

  const attributes = {
    [ATTRIBUTE_DOES_NOT_EMERGENCY_WARP]: 0,
  };
  applyDogmaModifierGroups(
    attributes,
    getActiveImplantShipModifierEntries(characterID),
  );
  return toFiniteNumber(attributes[ATTRIBUTE_DOES_NOT_EMERGENCY_WARP], 0) > 0;
}

module.exports = {
  ATTRIBUTE_DOES_NOT_EMERGENCY_WARP,
  EMERGENCY_WARP_DISTANCE_METERS,
  buildEmergencyWarpLogoffState,
  buildEmergencyWarpReturnSpaceState,
  clearEmergencyWarpReturnState,
  getEmergencyWarpReturnState,
  shipSuppressesEmergencyWarp,
  _testing: {
    vectorMagnitude,
  },
};
