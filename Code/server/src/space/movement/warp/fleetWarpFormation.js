// Fleet warp formations.
//
// When a fleet commander warps the fleet, the client sends a
// `fleetFormationSettings` dict alongside fleet=True (michelle.CmdWarpToStuff ->
// SetFleetFormationSettings in eve/client/script/remote/michelle.py):
//
//   { formationType, formationSpacing, formationSize }
//
// formationType is one of POINT/SPHERE/PLANE/WALL/ARROW/RELATIVE
// (evefleet/const.py). formationSpacing/formationSize arrive as dogma attribute
// IDs whose index in the client's skill tables (FLEET_FORMATION_SPACING /
// FLEET_FORMATION_SIZE) is the effective Fleet Formation skill level chosen.
//
// The authoritative landing geometry lives in the server-only
// `ballpark.warpFormations.FormationPicker` (referenced by
// behaviors/actions/fleet.py) which is NOT shipped in the decompiled client, so
// the exact metre offsets cannot be mirrored 1:1. This module implements the
// faithful wiring — settings parsing, deterministic per-ship slot assignment,
// and an offset destination per member relative to the anchor's landing point —
// with a documented geometric approximation for the offsets themselves.

const FORMATION_POINT = 0;
const FORMATION_SPHERE = 1;
const FORMATION_PLANE = 2;
const FORMATION_WALL = 3;
const FORMATION_ARROW = 4;
const FORMATION_RELATIVE = 5;

// evefleet/const.py: FLEET_FORMATION_SPACING / FLEET_FORMATION_SIZE. The chosen
// dogma attribute ID maps back to a 0..5 Fleet Formation skill index.
const FLEET_FORMATION_SPACING_ATTR = [100, 101, 102, 103, 104, 20];
const FLEET_FORMATION_SIZE_ATTR = [20, 21, 22, 105, 106, 107];

// Approximated metre scale (exact values live server-side, see header). Spacing
// and size grow linearly with the chosen skill index, anchored on the client's
// documented fleetGroupingRange (300 m) order of magnitude.
const FORMATION_SPACING_BASE_METERS = 500; // index 0..5 -> 500..3000 m step
const FORMATION_SIZE_BASE_METERS = 1000; // index 0..5 -> 1000..6000 m radius
// evefleet/const.py RELATIVE_FORMATION_PICKUP_RANGE.
const RELATIVE_FORMATION_PICKUP_RANGE_METERS = 200000;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function cloneVec(vector) {
  return {
    x: toFiniteNumber(vector && vector.x, 0),
    y: toFiniteNumber(vector && vector.y, 0),
    z: toFiniteNumber(vector && vector.z, 0),
  };
}

function addVec(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVec(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function lengthVec(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalizeVec(v, fallback = { x: 1, y: 0, z: 0 }) {
  const len = lengthVec(v);
  if (!(len > 1e-6)) {
    return cloneVec(fallback);
  }
  return scaleVec(v, 1 / len);
}

function crossVec(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// Build an orthonormal basis with `forward` along the warp direction. `right`
// and `up` span the plane perpendicular to the warp, used to lay out wall/plane/
// arrow formations relative to the direction of travel.
function buildBasis(warpDirection) {
  const forward = normalizeVec(cloneVec(warpDirection || { x: 1, y: 0, z: 0 }));
  const worldUp =
    Math.abs(forward.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = normalizeVec(crossVec(worldUp, forward), { x: 1, y: 0, z: 0 });
  const up = normalizeVec(crossVec(forward, right), { x: 0, y: 1, z: 0 });
  return { forward, right, up };
}

function attributeIndex(table, attributeID) {
  const index = table.indexOf(toInt(attributeID, -1));
  return index >= 0 ? index : 0;
}

function spacingMetersFromAttribute(attributeID) {
  return (
    FORMATION_SPACING_BASE_METERS *
    (attributeIndex(FLEET_FORMATION_SPACING_ATTR, attributeID) + 1)
  );
}

function sizeMetersFromAttribute(attributeID) {
  return (
    FORMATION_SIZE_BASE_METERS *
    (attributeIndex(FLEET_FORMATION_SIZE_ATTR, attributeID) + 1)
  );
}

// Normalize the client's fleetFormationSettings (a marshaled dict
// { type:"dict", entries:[...] } on the wire, or a plain object internally) into
// resolved metre values. Returns null when no usable formation is present.
function resolveFormationSettings(rawSettings) {
  if (!rawSettings || typeof rawSettings !== "object") {
    return null;
  }

  let formationType = null;
  let spacingAttr = null;
  let sizeAttr = null;

  if (Array.isArray(rawSettings.entries)) {
    for (const entry of rawSettings.entries) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }
      const key = String(entry[0]);
      if (key === "formationType") {
        formationType = entry[1];
      } else if (key === "formationSpacing") {
        spacingAttr = entry[1];
      } else if (key === "formationSize") {
        sizeAttr = entry[1];
      }
    }
  } else {
    formationType = rawSettings.formationType;
    spacingAttr = rawSettings.formationSpacing;
    sizeAttr = rawSettings.formationSize;
  }

  if (formationType === null || formationType === undefined) {
    return null;
  }

  return {
    formationType: toInt(formationType, FORMATION_POINT),
    spacingMeters: spacingMetersFromAttribute(spacingAttr),
    sizeMeters: sizeMetersFromAttribute(sizeAttr),
  };
}

// POINT stacks the fleet on a single landing point and is handled by the normal
// per-ship warp path, so it carries no geometric offset here.
function isOffsetFormation(formationType) {
  return (
    formationType === FORMATION_SPHERE ||
    formationType === FORMATION_PLANE ||
    formationType === FORMATION_WALL ||
    formationType === FORMATION_ARROW ||
    formationType === FORMATION_RELATIVE
  );
}

// Even-sided 2D grid dimensions for `count` slots (columns >= rows).
function gridDimensions(count) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  return { columns, rows };
}

function sphereOffset(slotIndex, count, radius) {
  // Deterministic Fibonacci-sphere distribution so slots never collide.
  const total = Math.max(1, count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (slotIndex + 0.5) * (2 / total);
  const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * slotIndex;
  return {
    ex: Math.cos(theta) * ringRadius * radius,
    ey: y * radius,
    ez: Math.sin(theta) * ringRadius * radius,
  };
}

// Returns a Map of characterID -> destination point for the fleet-warp
// followers, laid out in the requested formation around `anchorPoint` (the
// commander's landing point). `followers` must be a stable-ordered array of
// { characterID, position }. Returns an empty Map for POINT / unusable input.
function computeFleetWarpFormationPoints(options = {}) {
  const result = new Map();
  const followers = Array.isArray(options.followers) ? options.followers : [];
  if (followers.length === 0) {
    return result;
  }

  const formationType = toInt(options.formationType, FORMATION_POINT);
  if (!isOffsetFormation(formationType)) {
    return result;
  }

  const anchorPoint = cloneVec(options.anchorPoint);
  const spacing = Math.max(0, toFiniteNumber(options.spacingMeters, 0));
  const size = Math.max(0, toFiniteNumber(options.sizeMeters, 0));
  const { right, up, forward } = buildBasis(options.warpDirection);
  const anchorPosition = options.anchorPosition
    ? cloneVec(options.anchorPosition)
    : null;
  const { columns } = gridDimensions(followers.length);

  followers.forEach((follower, slotIndex) => {
    if (!follower || !(toInt(follower.characterID, 0) > 0)) {
      return;
    }

    let offset = { x: 0, y: 0, z: 0 };

    if (formationType === FORMATION_RELATIVE && anchorPosition && follower.position) {
      // Preserve each member's pre-warp offset from the anchor, clamped to the
      // client's relative-formation pickup range.
      let relative = subVec(cloneVec(follower.position), anchorPosition);
      const relLength = lengthVec(relative);
      if (relLength > RELATIVE_FORMATION_PICKUP_RANGE_METERS) {
        relative = scaleVec(
          relative,
          RELATIVE_FORMATION_PICKUP_RANGE_METERS / relLength,
        );
      }
      offset = relative;
    } else if (formationType === FORMATION_SPHERE) {
      const s = sphereOffset(slotIndex, followers.length, size || spacing || 1000);
      offset = addVec(
        addVec(scaleVec(right, s.ex), scaleVec(up, s.ey)),
        scaleVec(forward, s.ez),
      );
    } else {
      // Grid-based formations. Center the grid on the anchor.
      const column = slotIndex % columns;
      const row = Math.floor(slotIndex / columns);
      const step = spacing > 0 ? spacing : 1000;
      const columnOffset = (column - (columns - 1) / 2) * step;

      if (formationType === FORMATION_WALL) {
        // Vertical sheet perpendicular to the warp: spread on right/up.
        offset = addVec(scaleVec(right, columnOffset), scaleVec(up, row * step));
      } else if (formationType === FORMATION_PLANE) {
        // Horizontal carpet: spread on right and along the warp axis.
        offset = addVec(
          scaleVec(right, columnOffset),
          scaleVec(forward, row * step),
        );
      } else if (formationType === FORMATION_ARROW) {
        // V opening backward from the anchor.
        const rank = Math.floor(slotIndex / 2) + 1;
        const side = slotIndex % 2 === 0 ? 1 : -1;
        offset = addVec(
          scaleVec(right, side * rank * step),
          scaleVec(forward, -rank * step),
        );
      }
    }

    result.set(toInt(follower.characterID, 0), addVec(anchorPoint, offset));
  });

  return result;
}

module.exports = {
  FORMATION_POINT,
  FORMATION_SPHERE,
  FORMATION_PLANE,
  FORMATION_WALL,
  FORMATION_ARROW,
  FORMATION_RELATIVE,
  RELATIVE_FORMATION_PICKUP_RANGE_METERS,
  resolveFormationSettings,
  isOffsetFormation,
  computeFleetWarpFormationPoints,
};
