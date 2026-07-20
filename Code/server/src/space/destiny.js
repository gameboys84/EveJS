const path = require("path");

const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildRowset,
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const {
  buildDamageState,
  hasDamageableHealth,
} = require(path.join(__dirname, "./combat/damage"));
const {
  STRUCTURE_STATE,
} = require(path.join(__dirname, "../services/structure/structureConstants"));
const {
  buildDroneStateRows,
} = require(path.join(__dirname, "../services/drone/droneRuntime"));
const {
  getShipDirtTimestamp,
  normalizeFiletime,
} = require(path.join(__dirname, "../services/ship/shipDirtState"));
const {
  getItemKillCountPlayer,
} = require(path.join(__dirname, "../services/ship/shipKillCounterState"));
const {
  getEntityStandingsForType,
} = require(path.join(__dirname, "../services/_shared/clientEntityStandings"));

const BALL_MODE = Object.freeze({
  GOTO: 0,
  FOLLOW: 1,
  STOP: 2,
  WARP: 3,
  ORBIT: 4,
  MISSILE: 5,
  MUSHROOM: 6,
  BOID: 7,
  TROLL: 8,
  MINIBALL: 9,
  FIELD: 10,
  RIGID: 11,
  FORMATION: 12,
});

const BALL_FLAG = Object.freeze({
  IS_FREE: 0x01,
  IS_GLOBAL: 0x02,
  IS_MASSIVE: 0x04,
  IS_INTERACTIVE: 0x08,
  IS_SPACEJUNK: 0x10,
  HAS_MINIBOXES: 0x20,
  HAS_MINIBALLS: 0x40,
  HAS_MINICAPSULES: 0x80,
});

const SOL_ITEM_COLUMNS = [
  ["itemID", 0x14],
  ["typeID", 0x03],
  ["ownerID", 0x03],
  ["locationID", 0x14],
  ["flagID", 0x02],
  ["contraband", 0x0b],
  ["singleton", 0x02],
  ["quantity", 0x03],
  ["groupID", 0x03],
  ["categoryID", 0x03],
  ["customInfo", 0x81],
];

const DRONE_STATE_HEADERS = [
  "droneID",
  "ownerID",
  "controllerID",
  "activityState",
  "typeID",
  "controllerOwnerID",
  "targetID",
];
const STARGATE_JUMP_HEADERS = ["toCelestialID", "locationID"];
const CLIENT_ROWSET_NAME = "eve.common.script.sys.rowset.Rowset";
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt32(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function toOptionalInt32(value, fallback = -1) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return toInt32(value, fallback);
}

function toOptionalInt64(value, fallback = -1) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return Math.trunc(toFiniteNumber(value, fallback));
}

function normalizeSlimNullableValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === "none" || normalized.toLowerCase() === "null") {
    return null;
  }
  return value;
}

function buildVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function buildWallclockFiletimeFromMs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }
  return buildFiletimeLong(
    BigInt(Math.trunc(numericValue)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET,
  );
}

function buildOptionalWallclockFiletimeValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return buildWallclockFiletimeFromMs(numericValue);
  }
  return value;
}

function buildStructureSlimTimer(entity) {
  const timerStart = buildWallclockFiletimeFromMs(entity && entity.stateStartedAt);
  const timerEnd = buildWallclockFiletimeFromMs(entity && entity.stateEndsAt);
  const timerPaused = buildWallclockFiletimeFromMs(entity && entity.timerPausedAt);
  if (!timerStart || !timerEnd) {
    return null;
  }
  return buildList([timerStart, timerEnd, timerPaused]);
}

function buildStructureSlimDeployTimes(entity) {
  const timerStart = buildWallclockFiletimeFromMs(entity && entity.stateStartedAt);
  const timerEnd = buildWallclockFiletimeFromMs(entity && entity.stateEndsAt);
  if (!timerStart || !timerEnd) {
    return null;
  }
  return buildList([timerStart, timerEnd]);
}

function buildStructureSlimDamage(entity) {
  const conditionState =
    entity && entity.conditionState && typeof entity.conditionState === "object"
      ? entity.conditionState
      : {};
  const structureDamage = Math.max(
    0,
    Math.min(1, toFiniteNumber(conditionState.damage, 0)),
  );
  const armorDamage = Math.max(
    0,
    Math.min(1, toFiniteNumber(conditionState.armorDamage, 0)),
  );
  const shieldCharge = Math.max(
    0,
    Math.min(
      1,
      conditionState.shieldCharge === undefined || conditionState.shieldCharge === null
        ? 1
        : toFiniteNumber(conditionState.shieldCharge, 1),
    ),
  );
  return buildList([
    structureDamage,
    armorDamage,
    1 - shieldCharge,
  ]);
}

function getEntityBallRadius(entity) {
  return toFiniteNumber(entity && entity.radius, 1);
}

function buildMarshalReal(value, fallback = 0) {
  return { type: "real", value: toFiniteNumber(value, fallback) };
}

function buildMarshalRealVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  const vector = buildVector(source, fallback);
  return {
    x: buildMarshalReal(vector.x, fallback.x),
    y: buildMarshalReal(vector.y, fallback.y),
    z: buildMarshalReal(vector.z, fallback.z),
  };
}

function normalizeVector(source = null, fallback = { x: 1, y: 0, z: 0 }) {
  const vector = buildVector(source, fallback);
  const length = Math.sqrt(
    (vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return buildVector(fallback);
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function buildRowDescriptor(columns) {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "blue.DBRowDescriptor" },
      [columns],
    ],
    list: [],
    dict: [],
  };
}

function buildPackedRow(columns, fields) {
  return {
    type: "packedrow",
    header: buildRowDescriptor(columns),
    columns,
    fields,
  };
}

function pushBigInt64(chunks, value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(
    typeof value === "bigint" ? value : BigInt(Math.trunc(toFiniteNumber(value, 0))),
    0,
  );
  chunks.push(buffer);
}

function pushInt32(chunks, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(toInt32(value, 0), 0);
  chunks.push(buffer);
}

function pushUInt8(chunks, value) {
  chunks.push(Buffer.from([toInt32(value, 0) & 0xff]));
}

function pushFloat(chunks, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(toFiniteNumber(value, 0), 0);
  chunks.push(buffer);
}

function pushDouble(chunks, value) {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(toFiniteNumber(value, 0), 0);
  chunks.push(buffer);
}

function encodeHeader(packetType, stamp) {
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(packetType, 0);
  buffer.writeUInt32LE(toInt32(stamp, 0) >>> 0, 1);
  return buffer;
}

function encodeRigidBall(entity) {
  const position = buildVector(entity.position);
  const miniGeometryFlags = getEntityMiniGeometryFlags(entity);
  const flags =
    (entity.kind === "station" || entity.kind === "stargate"
      ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_MASSIVE
      : entity.kind === "orbital"
        ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_INTERACTIVE
      : entity.kind === "container" || entity.kind === "wreck"
        ? BALL_FLAG.IS_INTERACTIVE
        : BALL_FLAG.IS_GLOBAL) |
    miniGeometryFlags;
  const chunks = [];
  pushBigInt64(chunks, entity.itemID);
  pushUInt8(chunks, BALL_MODE.RIGID);
  pushFloat(chunks, getEntityBallRadius(entity));
  pushDouble(chunks, position.x);
  pushDouble(chunks, position.y);
  pushDouble(chunks, position.z);
  pushUInt8(chunks, flags);
  pushUInt8(chunks, 0xff);
  encodeMiniGeometrySections(chunks, entity);
  return Buffer.concat(chunks);
}

function getFreeBallMode(entity) {
  switch (entity && entity.mode) {
    case "GOTO":
      return BALL_MODE.GOTO;
    case "FOLLOW":
      return BALL_MODE.FOLLOW;
    case "WARP":
      return BALL_MODE.WARP;
    case "ORBIT":
      return BALL_MODE.ORBIT;
    case "MISSILE":
      return BALL_MODE.MISSILE;
    case "MUSHROOM":
      return BALL_MODE.MUSHROOM;
    case "TROLL":
      return BALL_MODE.TROLL;
    case "FIELD":
      return BALL_MODE.FIELD;
    case "FORMATION":
      return BALL_MODE.FORMATION;
    default:
      return BALL_MODE.STOP;
  }
}

function isFreeBallEntity(entity) {
  if (entity && typeof entity.isFree === "boolean") {
    return entity.isFree;
  }

  return Boolean(
    entity &&
    (
      entity.kind === "ship" ||
      entity.kind === "missile" ||
      entity.kind === "drone" ||
      entity.kind === "fighter" ||
      entity.kind === "container" ||
      entity.kind === "wreck"
    )
  );
}

function isFreeBallInteractive(entity) {
  if (!isFreeBallEntity(entity)) {
    return false;
  }

  if (entity.kind === "container" || entity.kind === "wreck") {
    return true;
  }

  if (entity.kind === "missile") {
    return false;
  }

  if (entity.kind === "drone" || entity.kind === "fighter") {
    return Boolean(
      (Number(entity.controllerID) || 0) > 0 ||
      (Number(entity.ownerID) || 0) > 0,
    );
  }

  const npcEntityType = String(entity.npcEntityType || "").trim().toLowerCase();
  if (npcEntityType === "npc" || npcEntityType === "concord") {
    return true;
  }

  return Boolean(
    entity.session ||
      ((Number(entity.pilotCharacterID ?? entity.characterID) || 0) > 0),
  );
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getEntityMiniBalls(entity) {
  return normalizeArray(entity && (entity.miniBalls || entity.miniballs));
}

function getEntityMiniCapsules(entity) {
  return normalizeArray(entity && (entity.miniCapsules || entity.minicapsules));
}

function getEntityMiniBoxes(entity) {
  return normalizeArray(entity && (entity.miniBoxes || entity.miniboxes));
}

function getEntityMiniGeometryFlags(entity) {
  return (
    (getEntityMiniBoxes(entity).length > 0 ? BALL_FLAG.HAS_MINIBOXES : 0) |
    (getEntityMiniBalls(entity).length > 0 ? BALL_FLAG.HAS_MINIBALLS : 0) |
    (getEntityMiniCapsules(entity).length > 0 ? BALL_FLAG.HAS_MINICAPSULES : 0)
  );
}

function getMiniBallCenter(miniBall) {
  return buildVector(
    miniBall && (miniBall.center || miniBall.position || miniBall),
  );
}

function getMiniCapsulePoint(miniCapsule, primaryKey, fallbackKey) {
  return buildVector(
    miniCapsule && (
      miniCapsule[primaryKey] ||
      miniCapsule[fallbackKey] ||
      miniCapsule[primaryKey.toLowerCase()] ||
      miniCapsule[fallbackKey.toLowerCase()]
    ),
  );
}

function getMiniBoxVector(miniBox, key) {
  return buildVector(miniBox && miniBox[key]);
}

function encodeMiniGeometrySections(chunks, entity) {
  const miniBalls = getEntityMiniBalls(entity);
  if (miniBalls.length > 0) {
    const countBuffer = Buffer.alloc(2);
    countBuffer.writeUInt16LE(Math.min(miniBalls.length, 0xffff), 0);
    chunks.push(countBuffer);
    for (const miniBall of miniBalls.slice(0, 0xffff)) {
      const center = getMiniBallCenter(miniBall);
      pushDouble(chunks, center.x);
      pushDouble(chunks, center.y);
      pushDouble(chunks, center.z);
      pushFloat(chunks, toFiniteNumber(miniBall && miniBall.radius, 0));
    }
  }

  const miniCapsules = getEntityMiniCapsules(entity);
  if (miniCapsules.length > 0) {
    const countBuffer = Buffer.alloc(2);
    countBuffer.writeUInt16LE(Math.min(miniCapsules.length, 0xffff), 0);
    chunks.push(countBuffer);
    for (const miniCapsule of miniCapsules.slice(0, 0xffff)) {
      const hemisphereA = getMiniCapsulePoint(miniCapsule, "hemisphereA", "pointA");
      const hemisphereB = getMiniCapsulePoint(miniCapsule, "hemisphereB", "pointB");
      pushDouble(chunks, hemisphereA.x);
      pushDouble(chunks, hemisphereA.y);
      pushDouble(chunks, hemisphereA.z);
      pushDouble(chunks, hemisphereB.x);
      pushDouble(chunks, hemisphereB.y);
      pushDouble(chunks, hemisphereB.z);
      pushFloat(chunks, toFiniteNumber(miniCapsule && miniCapsule.radius, 0));
    }
  }

  const miniBoxes = getEntityMiniBoxes(entity);
  if (miniBoxes.length > 0) {
    const countBuffer = Buffer.alloc(2);
    countBuffer.writeUInt16LE(Math.min(miniBoxes.length, 0xffff), 0);
    chunks.push(countBuffer);
    for (const miniBox of miniBoxes.slice(0, 0xffff)) {
      for (const vectorName of ["corner", "localX", "localY", "localZ"]) {
        const vector = getMiniBoxVector(miniBox, vectorName);
        pushDouble(chunks, vector.x);
        pushDouble(chunks, vector.y);
        pushDouble(chunks, vector.z);
      }
    }
  }
}

function getShipTargetPoint(entity) {
  if (entity && entity.targetPoint) {
    return buildVector(entity.targetPoint);
  }

  const direction = normalizeVector(entity && entity.direction, { x: 1, y: 0, z: 0 });
  const position = buildVector(entity && entity.position);
  return {
    x: position.x + (direction.x * 1.0e16),
    y: position.y + (direction.y * 1.0e16),
    z: position.z + (direction.z * 1.0e16),
  };
}

function getShipDirection(entity) {
  if (entity && entity.direction) {
    return normalizeVector(entity.direction, { x: 1, y: 0, z: 0 });
  }

  if (entity && entity.targetPoint && entity.position) {
    return normalizeVector({
      x: entity.targetPoint.x - entity.position.x,
      y: entity.targetPoint.y - entity.position.y,
      z: entity.targetPoint.z - entity.position.z,
    }, { x: 1, y: 0, z: 0 });
  }

  return { x: 1, y: 0, z: 0 };
}

function getShipWarpFactor(entity) {
  const warpState = entity && entity.warpState;
  // DLL solver: tau0 = ball98 * 0.001, so ball98 = warpSpeedAU * 1000
  return toInt32(
    (warpState && warpState.warpSpeed) ||
      (toFiniteNumber(entity && entity.warpSpeedAU, 0) > 0
        ? Math.round(entity.warpSpeedAU * 1000)
        : 3000),
    3000,
  );
}

function shouldUseSessionlessNpcWarpAddBallsBootstrap(entity, options = {}) {
  if (
    !options.forAddBalls ||
    !entity ||
    entity.kind !== "ship" ||
    getFreeBallMode(entity) !== BALL_MODE.WARP
  ) {
    return false;
  }

  if (entity.session) {
    return false;
  }

  const npcEntityType = String(entity.npcEntityType || "").trim().toLowerCase();
  return (
    entity.sessionlessWarpIngress &&
    (entity.nativeNpc === true || npcEntityType === "npc" || npcEntityType === "concord")
  );
}

function buildAddBallsBootstrapEntity(entity, options = {}) {
  if (!shouldUseSessionlessNpcWarpAddBallsBootstrap(entity, options)) {
    return entity;
  }

  // Sessionless NPC/Concord arrivals stay on the older CCP-style ingress
  // contract: AddBalls2 seeds a neutral ball and EntityWarpIn establishes the
  // visible warp. Serializing these responders as full mode-3 warp balls inside
  // AddBalls2 misaligns the client decode stream and leaves invisible attackers.
  return {
    ...entity,
    mode: "STOP",
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
  };
}

function getEntityHarmonic(entity) {
  return toOptionalInt64(
    entity && (entity.harmonic ?? entity.harmonicID ?? entity.mHarmonic),
    -1,
  );
}

function getEntityCorporationID(entity) {
  return toOptionalInt32(entity && entity.corporationID, -1);
}

function getEntityAllianceID(entity) {
  return toOptionalInt32(entity && entity.allianceID, -1);
}

function getEntityCloakMode(entity) {
  return toInt32(
    entity && (
      entity.isCloaked ??
      entity.cloakMode ??
      entity.cloaked
    ),
    0,
  );
}

function getEntityEffectStamp(entity) {
  return toInt32(
    entity && (
      entity.effectStamp ??
      (entity.missileState && entity.missileState.effectStamp) ??
      (entity.warpState && entity.warpState.effectStamp)
    ),
    0,
  );
}

function getEntityModeOwnerID(entity) {
  return toOptionalInt64(
    entity && (
      entity.ownerEntityID ??
      entity.launcherEntityID ??
      entity.sourceShipID ??
      entity.ownerBallID ??
      entity.modeOwnerID ??
      entity.ownerID
    ),
    0,
  );
}

function getEntityFollowID(entity) {
  return toOptionalInt64(
    entity && (entity.targetEntityID ?? entity.followID ?? entity.followId),
    0,
  );
}

function getEntityFollowRange(entity) {
  return toFiniteNumber(
    entity && (
      entity.followRange ??
      entity.orbitDistance ??
      entity.formationRange
    ),
    0,
  );
}

function getEntityMushroomSpan(entity) {
  return toFiniteNumber(
    entity && (
      entity.span ??
      entity.mushroomSpan ??
      entity.targetSpan ??
      (entity.targetPoint && entity.targetPoint.x)
    ),
    0,
  );
}

function encodeFreeBall(entity, options = {}) {
  const encodedEntity = buildAddBallsBootstrapEntity(entity, options);
  const position = buildVector(encodedEntity.position);
  const velocity = buildVector(encodedEntity.velocity);
  const mode = getFreeBallMode(encodedEntity);
  const flags =
    BALL_FLAG.IS_FREE |
    (isFreeBallInteractive(encodedEntity) ? BALL_FLAG.IS_INTERACTIVE : 0) |
    getEntityMiniGeometryFlags(encodedEntity);
  const chunks = [];
  pushBigInt64(chunks, encodedEntity.itemID);
  pushUInt8(chunks, mode);
  pushFloat(chunks, getEntityBallRadius(encodedEntity));
  pushDouble(chunks, position.x);
  pushDouble(chunks, position.y);
  pushDouble(chunks, position.z);
  pushUInt8(chunks, flags);

  const fallbackMass =
    encodedEntity.kind === "container" || encodedEntity.kind === "wreck"
      ? 10_000
      : 1_000_000;
  pushDouble(chunks, toFiniteNumber(encodedEntity.mass, fallbackMass));
  pushUInt8(chunks, getEntityCloakMode(encodedEntity));
  pushBigInt64(chunks, getEntityHarmonic(encodedEntity));
  pushInt32(chunks, getEntityCorporationID(encodedEntity));
  pushInt32(chunks, getEntityAllianceID(encodedEntity));

  pushFloat(chunks, toFiniteNumber(encodedEntity.maxVelocity, 0));
  pushDouble(chunks, velocity.x);
  pushDouble(chunks, velocity.y);
  pushDouble(chunks, velocity.z);
  pushFloat(chunks, toFiniteNumber(encodedEntity.inertia, 1));
  pushFloat(chunks, toFiniteNumber(encodedEntity.speedFraction, 0));

  pushUInt8(chunks, 0xff);
  switch (mode) {
    case BALL_MODE.GOTO: {
      const targetPoint = getShipTargetPoint(encodedEntity);
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      break;
    }
    case BALL_MODE.FOLLOW:
      pushBigInt64(chunks, getEntityFollowID(encodedEntity));
      pushFloat(chunks, getEntityFollowRange(encodedEntity));
      break;
    case BALL_MODE.FORMATION:
      pushBigInt64(chunks, getEntityFollowID(encodedEntity));
      pushFloat(chunks, getEntityFollowRange(encodedEntity));
      pushInt32(chunks, getEntityEffectStamp(encodedEntity));
      break;
    case BALL_MODE.MISSILE: {
      const targetPoint = getShipTargetPoint(encodedEntity);
      pushBigInt64(chunks, getEntityFollowID(encodedEntity));
      pushFloat(chunks, getEntityFollowRange(encodedEntity));
      pushBigInt64(chunks, getEntityModeOwnerID(encodedEntity));
      pushInt32(chunks, getEntityEffectStamp(encodedEntity));
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      break;
    }
    case BALL_MODE.WARP: {
      const targetPoint = getShipTargetPoint(encodedEntity);
      const warpState = encodedEntity && encodedEntity.warpState;
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      // Public Destiny serializes WARP as goto + effectStamp + mLastCollision +
      // mFollowId + mOwnerId. mFollowId carries the minimum range as raw double
      // bytes; mOwnerId carries the integer warp factor.
      pushInt32(chunks, toInt32(warpState && warpState.effectStamp, 0));
      pushDouble(chunks, toFiniteNumber(warpState && warpState.totalDistance, 0));
      pushDouble(chunks, toFiniteNumber(warpState && warpState.stopDistance, 0));
      pushBigInt64(chunks, getShipWarpFactor(encodedEntity));
      break;
    }
    case BALL_MODE.ORBIT:
      // Bootstrap orbit state uses the same wide target-ID contract as follow:
      // int64 target ball ID + float radius. Using int32+double here made the
      // client decode garbage follow targets for already-orbiting NPCs.
      pushBigInt64(chunks, getEntityFollowID(encodedEntity));
      pushFloat(chunks, getEntityFollowRange(encodedEntity));
      break;
    case BALL_MODE.MUSHROOM:
      pushFloat(chunks, getEntityFollowRange(encodedEntity));
      pushDouble(chunks, getEntityMushroomSpan(encodedEntity));
      pushInt32(chunks, getEntityEffectStamp(encodedEntity));
      pushBigInt64(chunks, getEntityModeOwnerID(encodedEntity));
      break;
    case BALL_MODE.TROLL:
      pushInt32(chunks, getEntityEffectStamp(encodedEntity));
      break;
    default:
      break;
  }
  encodeMiniGeometrySections(chunks, encodedEntity);
  return Buffer.concat(chunks);
}

function encodeEntityBall(entity, options = {}) {
  if (isFreeBallEntity(entity)) {
    return encodeFreeBall(entity, options);
  }

  return encodeRigidBall(entity);
}

function describeBallMode(mode) {
  switch (mode) {
    case BALL_MODE.GOTO:
      return "GOTO";
    case BALL_MODE.FOLLOW:
      return "FOLLOW";
    case BALL_MODE.STOP:
      return "STOP";
    case BALL_MODE.WARP:
      return "WARP";
    case BALL_MODE.ORBIT:
      return "ORBIT";
    case BALL_MODE.MISSILE:
      return "MISSILE";
    case BALL_MODE.MUSHROOM:
      return "MUSHROOM";
    case BALL_MODE.BOID:
      return "BOID";
    case BALL_MODE.TROLL:
      return "TROLL";
    case BALL_MODE.MINIBALL:
      return "MINIBALL";
    case BALL_MODE.FIELD:
      return "FIELD";
    case BALL_MODE.RIGID:
      return "RIGID";
    case BALL_MODE.FORMATION:
      return "FORMATION";
    default:
      return `UNKNOWN_${mode}`;
  }
}

function describeBallFlags(flags) {
  return {
    byte: flags,
    isFree: (flags & BALL_FLAG.IS_FREE) !== 0,
    isGlobal: (flags & BALL_FLAG.IS_GLOBAL) !== 0,
    isMassive: (flags & BALL_FLAG.IS_MASSIVE) !== 0,
    isInteractive: (flags & BALL_FLAG.IS_INTERACTIVE) !== 0,
    isSpaceJunk: (flags & BALL_FLAG.IS_SPACEJUNK) !== 0,
    hasMiniBoxes: (flags & BALL_FLAG.HAS_MINIBOXES) !== 0,
    hasMiniBalls: (flags & BALL_FLAG.HAS_MINIBALLS) !== 0,
    hasMiniCapsules: (flags & BALL_FLAG.HAS_MINICAPSULES) !== 0,
  };
}

function debugDescribeEntityBall(entity, options = {}) {
  const debugEntity = buildAddBallsBootstrapEntity(entity, options);
  const encoded = encodeEntityBall(entity, options);
  if (isFreeBallEntity(debugEntity)) {
    const mode = getFreeBallMode(debugEntity);
    const flags =
      BALL_FLAG.IS_FREE |
      (isFreeBallInteractive(debugEntity) ? BALL_FLAG.IS_INTERACTIVE : 0) |
      getEntityMiniGeometryFlags(debugEntity);
    const summary = {
      kind: debugEntity.kind,
      itemID: debugEntity.itemID,
      mode: describeBallMode(mode),
      modeCode: mode,
      flags: describeBallFlags(flags),
      radius: getEntityBallRadius(debugEntity),
      position: buildVector(debugEntity.position),
      mass: toFiniteNumber(
        debugEntity.mass,
        debugEntity.kind === "container" || debugEntity.kind === "wreck"
          ? 10_000
          : 1_000_000,
      ),
      isCloaked: getEntityCloakMode(debugEntity),
      harmonic: getEntityHarmonic(debugEntity),
      corporationID: getEntityCorporationID(debugEntity),
      allianceID: getEntityAllianceID(debugEntity),
      maxVelocity: toFiniteNumber(debugEntity.maxVelocity, 0),
      velocity: buildVector(debugEntity.velocity),
      inertia: toFiniteNumber(debugEntity.inertia, 1),
      speedFraction: toFiniteNumber(debugEntity.speedFraction, 0),
      modeData: null,
    };
    if (mode === BALL_MODE.GOTO) {
      summary.modeData = {
        targetPoint: getShipTargetPoint(debugEntity),
      };
    } else if (mode === BALL_MODE.FOLLOW) {
      summary.modeData = {
        targetEntityID: getEntityFollowID(debugEntity),
        followRange: getEntityFollowRange(debugEntity),
      };
    } else if (mode === BALL_MODE.FORMATION) {
      summary.modeData = {
        targetEntityID: getEntityFollowID(debugEntity),
        followRange: getEntityFollowRange(debugEntity),
        effectStamp: getEntityEffectStamp(debugEntity),
      };
    } else if (mode === BALL_MODE.MISSILE) {
      summary.modeData = {
        targetEntityID: getEntityFollowID(debugEntity),
        followRange: getEntityFollowRange(debugEntity),
        ownerID: getEntityModeOwnerID(debugEntity),
        effectStamp: getEntityEffectStamp(debugEntity),
        targetPoint: getShipTargetPoint(debugEntity),
      };
    } else if (mode === BALL_MODE.WARP) {
      const totalDistance = toFiniteNumber(
        debugEntity &&
          debugEntity.warpState &&
          debugEntity.warpState.totalDistance,
        0,
      );
      const minimumRange = toFiniteNumber(
        debugEntity &&
          debugEntity.warpState &&
          debugEntity.warpState.stopDistance,
        0,
      );
      const warpFactor = getShipWarpFactor(debugEntity);
      summary.modeData = {
        targetPoint: getShipTargetPoint(debugEntity),
        effectStamp: toInt32(
          debugEntity &&
            debugEntity.warpState &&
            debugEntity.warpState.effectStamp,
          0,
        ),
        lastCollision: totalDistance,
        totalDistance,
        minimumRange,
        stopDistance: minimumRange,
        ownerID: warpFactor,
        warpFactor,
      };
    } else if (mode === BALL_MODE.ORBIT) {
      summary.modeData = {
        targetEntityID: getEntityFollowID(debugEntity),
        orbitDistance: getEntityFollowRange(debugEntity),
      };
    } else if (mode === BALL_MODE.MUSHROOM) {
      summary.modeData = {
        followRange: getEntityFollowRange(debugEntity),
        span: getEntityMushroomSpan(debugEntity),
        effectStamp: getEntityEffectStamp(debugEntity),
        ownerID: getEntityModeOwnerID(debugEntity),
      };
    } else if (mode === BALL_MODE.TROLL) {
      summary.modeData = {
        effectStamp: getEntityEffectStamp(debugEntity),
      };
    }
    if (getEntityMiniGeometryFlags(debugEntity) !== 0) {
      summary.miniGeometry = {
        miniBalls: getEntityMiniBalls(debugEntity).map((miniBall) => ({
          center: getMiniBallCenter(miniBall),
          radius: toFiniteNumber(miniBall && miniBall.radius, 0),
        })),
        miniCapsules: getEntityMiniCapsules(debugEntity).map((miniCapsule) => ({
          hemisphereA: getMiniCapsulePoint(miniCapsule, "hemisphereA", "pointA"),
          hemisphereB: getMiniCapsulePoint(miniCapsule, "hemisphereB", "pointB"),
          radius: toFiniteNumber(miniCapsule && miniCapsule.radius, 0),
        })),
        miniBoxes: getEntityMiniBoxes(debugEntity).map((miniBox) => ({
          corner: getMiniBoxVector(miniBox, "corner"),
          localX: getMiniBoxVector(miniBox, "localX"),
          localY: getMiniBoxVector(miniBox, "localY"),
          localZ: getMiniBoxVector(miniBox, "localZ"),
        })),
      };
    }
    return {
      encodedLength: encoded.length,
      encodedHex: encoded.toString("hex"),
      summary,
    };
  }

  const flags =
    (entity.kind === "station" || entity.kind === "stargate"
      ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_MASSIVE
      : BALL_FLAG.IS_GLOBAL) |
    getEntityMiniGeometryFlags(entity);
  const rigidSummary = {
    kind: entity.kind,
    itemID: entity.itemID,
    mode: "RIGID",
    modeCode: BALL_MODE.RIGID,
    flags: describeBallFlags(flags),
    radius: getEntityBallRadius(entity),
    position: buildVector(entity.position),
  };
  if (getEntityMiniGeometryFlags(entity) !== 0) {
    rigidSummary.miniGeometry = {
      miniBalls: getEntityMiniBalls(entity).map((miniBall) => ({
        center: getMiniBallCenter(miniBall),
        radius: toFiniteNumber(miniBall && miniBall.radius, 0),
      })),
      miniCapsules: getEntityMiniCapsules(entity).map((miniCapsule) => ({
        hemisphereA: getMiniCapsulePoint(miniCapsule, "hemisphereA", "pointA"),
        hemisphereB: getMiniCapsulePoint(miniCapsule, "hemisphereB", "pointB"),
        radius: toFiniteNumber(miniCapsule && miniCapsule.radius, 0),
      })),
      miniBoxes: getEntityMiniBoxes(entity).map((miniBox) => ({
        corner: getMiniBoxVector(miniBox, "corner"),
        localX: getMiniBoxVector(miniBox, "localX"),
        localY: getMiniBoxVector(miniBox, "localY"),
        localZ: getMiniBoxVector(miniBox, "localZ"),
      })),
    };
  }
  return {
    encodedLength: encoded.length,
    encodedHex: encoded.toString("hex"),
    summary: rigidSummary,
  };
}

function appendEntityStandings(entries, entity, slimTypeID) {
  const authoredStandings = getEntityStandingsForType(slimTypeID);
  const hostileResponseThreshold = Number.isFinite(
    Number(entity && entity.hostileResponseThreshold),
  )
    ? Number(entity.hostileResponseThreshold)
    : authoredStandings && authoredStandings.hostileResponseThreshold;
  const friendlyResponseThreshold = Number.isFinite(
    Number(entity && entity.friendlyResponseThreshold),
  )
    ? Number(entity.friendlyResponseThreshold)
    : authoredStandings && authoredStandings.friendlyResponseThreshold;

  if (Number.isFinite(hostileResponseThreshold)) {
    entries.push([
      "hostile_response_threshold",
      toFiniteNumber(hostileResponseThreshold, -11),
    ]);
  }
  if (Number.isFinite(friendlyResponseThreshold)) {
    entries.push([
      "friendly_response_threshold",
      toFiniteNumber(friendlyResponseThreshold, 11),
    ]);
  }
}

function hasOwnProperty(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function resolveShipSlimDirtTime(entity) {
  if (hasOwnProperty(entity, "dirtTime")) {
    return {
      explicit: true,
      dirtTime: normalizeFiletime(entity.dirtTime, 0n) || 0n,
    };
  }

  return {
    explicit: false,
    dirtTime: getShipDirtTimestamp(entity.itemID, {
      createIfMissing: false,
      reason: "slim",
    }),
  };
}

function buildShipStanceSlimValue(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }

  const oldStanceID = toInt32(value[0], 0);
  const newStanceID = toInt32(value[2], 0);
  if (oldStanceID <= 0 || newStanceID <= 0) {
    return null;
  }

  return [
    oldStanceID,
    buildFiletimeLong(value[1]),
    newStanceID,
  ];
}

function buildSlimNameIDValue(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value) && value.length >= 2) {
    const label = String(value[0] || "").trim();
    if (!label) {
      return null;
    }
    const payload = value[1];
    if (payload && typeof payload === "object" && payload.type === "dict") {
      return [label, payload];
    }
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return [label, buildDict(Object.entries(payload))];
    }
    return [label, payload ?? null];
  }
  if (typeof value === "object") {
    const label = String(value.label || value.path || value.key || "").trim();
    if (!label) {
      return null;
    }
    const payload = value.args || value.payload || {};
    if (payload && typeof payload === "object" && payload.type === "dict") {
      return [label, payload];
    }
    return [
      label,
      buildDict(
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.entries(payload)
          : [],
      ),
    ];
  }
  return null;
}

function buildSlimItemDict(entity) {
  const hasEntityField = (fieldName) => hasOwnProperty(entity, fieldName);
  const slimTypeID = toInt32(
    entity && entity.slimTypeID,
    toInt32(entity && entity.typeID, 0),
  );
  const slimGroupID = toInt32(
    entity && entity.slimGroupID,
    toInt32(entity && entity.groupID, 0),
  );
  const slimCategoryID = toInt32(
    entity && entity.slimCategoryID,
    toInt32(entity && entity.categoryID, 0),
  );
  const suppressSlimName = entity && entity.suppressSlimName === true;
  const slimName = suppressSlimName
    ? ""
    : String(
        entity && (
          hasEntityField("slimName")
            ? entity.slimName
            : entity.itemName
        ) || "",
      );
  const entries = [
    ["itemID", entity.itemID],
    ["typeID", slimTypeID],
    ["ownerID", entity.ownerID || 0],
  ];
  const slimNameID = buildSlimNameIDValue(entity && entity.nameID);

  if (slimName && !slimNameID) {
    entries.push(["name", slimName]);
  }
  if (slimNameID) {
    entries.push(["nameID", slimNameID]);
  }
  if (slimGroupID > 0) {
    entries.push(["groupID", slimGroupID]);
  }
  if (slimCategoryID > 0) {
    entries.push(["categoryID", slimCategoryID]);
  }
  const slimGraphicID = toInt32(
    entity && entity.slimGraphicID,
    toInt32(entity && entity.graphicID, 0),
  );
  if (slimGraphicID > 0 && !(entity && entity.suppressSlimGraphicID === true)) {
    entries.push(["graphicID", slimGraphicID]);
  }

  const dunObjectID = toInt32(
    entity && (entity.dunObjectID || entity.dungeonObjectID),
    0,
  );
  if (dunObjectID > 0) {
    entries.push(["dunObjectID", dunObjectID]);
  }
  if (hasEntityField("dunObjectNameID")) {
    entries.push(["dunObjectNameID", entity.dunObjectNameID ?? null]);
  }
  if (hasEntityField("objectiveTargetGroup")) {
    entries.push(["objectiveTargetGroup", normalizeSlimNullableValue(entity.objectiveTargetGroup)]);
  }
  if (Array.isArray(entity && entity.dunPosition) && entity.dunPosition.length === 3) {
    entries.push(["dunPosition", entity.dunPosition]);
  } else if (
    entity &&
    entity.dunPosition &&
    typeof entity.dunPosition === "object" &&
    ["x", "y", "z"].every((axis) => Number.isFinite(Number(entity.dunPosition[axis])))
  ) {
    entries.push([
      "dunPosition",
      [entity.dunPosition.x, entity.dunPosition.y, entity.dunPosition.z],
    ]);
  }
  if (
    Array.isArray(entity && entity.dunRotation) &&
    entity.dunRotation.length === 3 &&
    !["station", "structure", "orbital", "stargate"].includes(String(entity && entity.kind || ""))
  ) {
    entries.push(["dunRotation", entity.dunRotation]);
  }
  const gateActivationRange = toFiniteNumber(entity && entity.gateActivationRange, 0);
  if (gateActivationRange > 0) {
    entries.push(["gateActivationRange", gateActivationRange]);
  }
  if (entity && Object.prototype.hasOwnProperty.call(entity, "dunMusicUrl")) {
    entries.push(["dunMusicUrl", entity.dunMusicUrl || null]);
  }
  if (
    slimGroupID === 548 ||
    (
      entity &&
      (
        entity.warpDisruptionStartTimeMs !== undefined ||
        entity.warpDisruptionStartTime !== undefined
      )
    )
  ) {
    const startTimeMs =
      entity && entity.warpDisruptionStartTimeMs !== undefined
        ? entity.warpDisruptionStartTimeMs
        : entity && entity.warpDisruptionStartTime;
    entries.push([
      "warpDisruptionStartTime",
      buildWallclockFiletimeFromMs(startTimeMs),
    ]);
  }

  if (entity.kind === "ship") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["charID", entity.characterID || 0]);
    const dirtState = resolveShipSlimDirtTime(entity);
    if (dirtState.explicit || dirtState.dirtTime > 0n) {
      entries.push(["dirtTime", buildFiletimeLong(dirtState.dirtTime)]);
    }
    entries.push(["kills", getItemKillCountPlayer(entity.itemID)]);
    if (Array.isArray(entity.cosmeticsItems) && entity.cosmeticsItems.length > 0) {
      entries.push(["cosmeticsItems", buildList(entity.cosmeticsItems)]);
    }
    entries.push(["skinMaterialSetID", entity.skinMaterialSetID ?? null]);
    entries.push([
      "modules",
      buildList(Array.isArray(entity.modules) ? entity.modules : []),
    ]);
    const shipStance = buildShipStanceSlimValue(entity.shipStance);
    if (shipStance) {
      entries.push(["shipStance", shipStance]);
    }
    entries.push([
      "securityStatus",
      toFiniteNumber(entity.securityStatus, 0.0),
    ]);
    entries.push(["bounty", toFiniteNumber(entity.bounty, 0.0)]);
    if (
      Array.isArray(entity.compressionFacilityTypelists) &&
      entity.compressionFacilityTypelists.length > 0
    ) {
      entries.push([
        "compression_facility_typelists",
        buildDict(
          entity.compressionFacilityTypelists
            .map((entry) => ([
              toInt32(entry && entry[0], 0),
              Math.max(1, toInt32(entry && entry[1], 0)),
            ]))
            .filter((entry) => entry[0] > 0 && entry[1] > 0),
        ),
      ]);
    }
  } else if (entity.kind === "station") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["online", 1]);
    entries.push(["incapacitated", 0]);
    entries.push(["activityLevel", entity.activityLevel ?? null]);
    entries.push(["skinMaterialSetID", entity.skinMaterialSetID ?? null]);
    if (entity.celestialEffect !== undefined && entity.celestialEffect !== null) {
      entries.push(["celestialEffect", entity.celestialEffect]);
    }
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "structure") {
    if (!entries.some((entry) => Array.isArray(entry) && entry[0] === "nameID")) {
      entries.push(["nameID", null]);
    }
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || null]);
    entries.push(["warFactionID", entity.warFactionID || null]);
    entries.push(["state", entity.state ?? null]);
    entries.push(["upkeepState", entity.upkeepState ?? null]);
    entries.push([
      "deedState",
      entity.deedState === undefined || entity.deedState === null
        ? null
        : entity.deedState === true || Number(entity.deedState) === 1,
    ]);
    entries.push([
      "unanchoring",
      entity.unanchoring
        ? buildWallclockFiletimeFromMs(entity.unanchoring)
        : false,
    ]);
    entries.push([
      "repairing",
      entity.repairing === undefined || entity.repairing === null
        ? null
        : entity.repairing === true || Number(entity.repairing) === 1,
    ]);
    entries.push([
      "timer",
      buildStructureSlimTimer(entity),
    ]);
    entries.push([
      "deployTimes",
      entity.state === STRUCTURE_STATE.DEPLOY_VULNERABLE
        ? buildStructureSlimDeployTimes(entity)
        : buildList([null, null]),
    ]);
    entries.push([
      "modules",
      buildList(Array.isArray(entity.modules) ? entity.modules : []),
    ]);
    entries.push(["docked", toInt32(entity.docked, 0)]);
    entries.push(["damage", buildStructureSlimDamage(entity)]);
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "orbital") {
    entries.push(["locationID", entity.locationID || entity.systemID || 0]);
    entries.push(["corpID", entity.corporationID || entity.ownerID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["planetID", entity.planetID || 0]);
    entries.push(["level", entity.level ?? 1]);
    entries.push(["orbitalState", entity.orbitalState ?? null]);
    entries.push(["orbitalTimestamp", buildWallclockFiletimeFromMs(entity.orbitalTimestampMs)]);
    entries.push(["orbitalHackerID", entity.orbitalHackerID ?? null]);
    entries.push(["orbitalHackerProgress", entity.orbitalHackerProgress ?? null]);
    entries.push(["online", 1]);
    entries.push(["incapacitated", 0]);
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "stargate") {
    entries.push(["nameID", null]);
    entries.push(["activationState", entity.activationState ?? 2]);
    entries.push(["poseID", entity.poseID ?? 0]);
    entries.push([
      "localCorruptionStageAndMaximum",
      buildList(entity.localCorruptionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "destinationCorruptionStageAndMaximum",
      buildList(entity.destinationCorruptionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "localSuppressionStageAndMaximum",
      buildList(entity.localSuppressionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "destinationSuppressionStageAndMaximum",
      buildList(entity.destinationSuppressionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "hasVolumetricDrifterCloud",
      entity.hasVolumetricDrifterCloud ? 1 : 0,
    ]);
    entries.push(["originSystemOwnerID", entity.originSystemOwnerID ?? null]);
    entries.push([
      "destinationSystemOwnerID",
      entity.destinationSystemOwnerID ?? null,
    ]);
    entries.push([
      "destinationSystemStatusIcons",
      buildList(entity.destinationSystemStatusIcons || []),
    ]);
    entries.push([
      "destinationSystemWarning",
      entity.destinationSystemWarning ?? null,
    ]);
    entries.push([
      "destinationSystemWarningIcon",
      entity.destinationSystemWarningIcon ?? null,
    ]);
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
    entries.push(["jumps", buildStargateJumps(entity)]);
  } else if (entity.kind === "wormhole") {
    entries.push(["nebulaType", entity.nebulaType ?? null]);
    entries.push(["wormholeSize", toFiniteNumber(entity.wormholeSize, 1)]);
    entries.push(["wormholeAge", toInt32(entity.wormholeAge, 0)]);
    entries.push(["maxShipJumpMass", toInt32(entity.maxShipJumpMass, 0)]);
    entries.push(["isDestTriglavian", entity.isDestTriglavian ? 1 : 0]);
    entries.push([
      "otherSolarSystemClass",
      toInt32(entity.otherSolarSystemClass, 0),
    ]);
  } else if (entity.kind === "container" || entity.kind === "wreck") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push([
      "securityStatus",
      toFiniteNumber(entity.securityStatus, 0.0),
    ]);
    entries.push(["isEmpty", entity.isEmpty ? 1 : 0]);
    // Loot rights drive the client's looting/abandon UI: the tuple is
    // (ownerID, corpID, fleetID, abandoned). Michelle.HaveLootRight /
    // IsAbandoned read this to decide whether a pilot may loot freely and
    // whether the "Abandon Wreck"/"Abandon All Wrecks" menu is offered.
    if (entity.deferLootRightsSlimUpdate !== true) {
      entries.push([
        "lootRights",
        buildList([
          toInt32(entity.ownerID, 0),
          toInt32(entity.lootRightCorpID ?? entity.corporationID, 0),
          entity.lootRightFleetID ?? null,
          Boolean(entity.lootAbandoned),
        ]),
      ]);
    }
    const launcherID = toInt32(entity.launcherID, 0);
    if (launcherID > 0) {
      entries.push(["launcherID", launcherID]);
    }
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "missile") {
    entries.push(["sourceShipID", entity.sourceShipID || 0]);
    entries.push([
      "launchModules",
      buildList(
        Array.isArray(entity.launchModules)
          ? entity.launchModules.map((value) => Number(value) || 0)
          : [],
      ),
    ]);
  } else if (entity.kind === "fighter") {
    entries.push([
      "fighter.squadronSize",
      Math.max(0, toInt32(entity.squadronSize, 0)),
    ]);
  }

  if (entity && entity.activityState !== undefined && entity.activityState !== null) {
    entries.push(["activityState", toInt32(entity.activityState, 0)]);
  }
  if (entity && entity.component_activate !== undefined && entity.component_activate !== null) {
    const componentActivate = Array.isArray(entity.component_activate)
      ? entity.component_activate
      : [Boolean(entity.component_activate), null];
    entries.push([
      "component_activate",
      buildList([
        Boolean(componentActivate[0]),
        buildOptionalWallclockFiletimeValue(componentActivate[1]),
      ]),
    ]);
  }
  if (
    entity &&
    entity.activate_comp_durationSeconds !== undefined &&
    entity.activate_comp_durationSeconds !== null
  ) {
    entries.push([
      "activate_comp_durationSeconds",
      Math.max(0, toInt32(entity.activate_comp_durationSeconds, 0)),
    ]);
  }
  if (
    entity &&
    entity.component_microJumpDriver !== undefined &&
    entity.component_microJumpDriver !== null
  ) {
    entries.push([
      "component_microJumpDriver",
      buildFiletimeLong(entity.component_microJumpDriver),
    ]);
  }
  if (
    entity &&
    entity.component_linkWithShip !== undefined &&
    entity.component_linkWithShip !== null
  ) {
    const componentLinkWithShip = Array.isArray(entity.component_linkWithShip)
      ? entity.component_linkWithShip
      : [null, 1, null, null];
    entries.push([
      "component_linkWithShip",
      buildList([
        buildOptionalWallclockFiletimeValue(componentLinkWithShip[0]),
        toInt32(componentLinkWithShip[1], 1),
        buildOptionalWallclockFiletimeValue(componentLinkWithShip[2]),
        componentLinkWithShip[3] === undefined ||
        componentLinkWithShip[3] === null ||
        componentLinkWithShip[3] === ""
          ? null
          : toOptionalInt64(componentLinkWithShip[3], null),
      ]),
    ]);
  }
  if (
    entity &&
    entity.component_decloakemitter_nextPing !== undefined &&
    entity.component_decloakemitter_nextPing !== null
  ) {
    entries.push([
      "component_decloakemitter_nextPing",
      buildOptionalWallclockFiletimeValue(entity.component_decloakemitter_nextPing),
    ]);
  }
  if (
    entity &&
    entity.component_phaseStabilizer !== undefined &&
    entity.component_phaseStabilizer !== null
  ) {
    const componentPhaseStabilizer = Array.isArray(entity.component_phaseStabilizer)
      ? entity.component_phaseStabilizer
      : [0, null, 0, null, false, false];
    entries.push([
      "component_phaseStabilizer",
      buildList([
        toInt32(componentPhaseStabilizer[0], 0),
        buildOptionalWallclockFiletimeValue(componentPhaseStabilizer[1]),
        toInt32(componentPhaseStabilizer[2], 0),
        componentPhaseStabilizer[3] === undefined ||
        componentPhaseStabilizer[3] === null ||
        componentPhaseStabilizer[3] === ""
          ? null
          : toOptionalInt64(componentPhaseStabilizer[3], null),
        Boolean(componentPhaseStabilizer[4]),
        Boolean(componentPhaseStabilizer[5]),
      ]),
    ]);
  }
  if (entity && entity.component_reinforce !== undefined && entity.component_reinforce !== null) {
    const componentReinforce = Array.isArray(entity.component_reinforce)
      ? entity.component_reinforce
      : [Boolean(entity.component_reinforce), null];
    entries.push([
      "component_reinforce",
      buildList([
        Boolean(componentReinforce[0]),
        buildWallclockFiletimeFromMs(componentReinforce[1]),
      ]),
    ]);
  }
  if (entity && entity.component_decay !== undefined && entity.component_decay !== null) {
    entries.push([
      "component_decay",
      buildWallclockFiletimeFromMs(entity.component_decay),
    ]);
  }
  if (entity && entity.component_turboshield !== undefined && entity.component_turboshield !== null) {
    entries.push(["component_turboshield", toInt32(entity.component_turboshield, 0)]);
  }
  appendEntityStandings(entries, entity, slimTypeID);

  return buildDict(entries);
}

function buildSlimItemObject(entity) {
  return {
    type: "object",
    name: "foo.SlimItem",
    args: buildSlimItemDict(entity),
  };
}

function buildDroneState(entities = []) {
  // V23.02 rejects util.Rowset here during remote SetState unmarshal.
  return buildRowset(
    DRONE_STATE_HEADERS,
    buildDroneStateRows(entities),
    CLIENT_ROWSET_NAME,
  );
}

function buildStargateJumps(entity) {
  const rows =
    entity && entity.destinationID && entity.destinationSolarSystemID
      ? [[entity.destinationID, entity.destinationSolarSystemID]]
      : [];

  return buildRowset(STARGATE_JUMP_HEADERS, rows, CLIENT_ROWSET_NAME);
}

function buildSolItem(system) {
  return buildPackedRow(SOL_ITEM_COLUMNS, {
    itemID: system.solarSystemID,
    typeID: 5,
    ownerID: 1,
    locationID: system.constellationID,
    flagID: 0,
    contraband: false,
    singleton: 1,
    quantity: -1,
    groupID: 5,
    categoryID: 2,
    customInfo: "",
  });
}

function buildAddBallsStateBuffer(stamp, entities) {
  const chunks = [encodeHeader(1, stamp)];
  for (const entity of entities) {
    chunks.push(encodeEntityBall(entity, { forAddBalls: true }));
  }
  return Buffer.concat(chunks);
}

function buildSetStateBuffer(stamp, entities) {
  const chunks = [encodeHeader(0, stamp)];
  for (const entity of entities) {
    chunks.push(encodeEntityBall(entity));
  }
  return Buffer.concat(chunks);
}

function buildAddBalls2Payload(
  stateStamp,
  entities,
  simFileTime = currentFileTime(),
) {
  const extraBallData = entities.map((entity) => {
    if (entity.kind === "station" || hasDamageableHealth(entity)) {
      return [buildSlimItemDict(entity), buildDamageState(entity, simFileTime)];
    }
    return buildSlimItemDict(entity);
  });

  return [
    "AddBalls2",
    [
      [
        buildAddBallsStateBuffer(stateStamp, entities),
        buildList(extraBallData),
      ],
    ],
  ];
}

function buildSetStatePayload(
  stateStamp,
  system,
  egoEntityID,
  entities,
  simFileTime = currentFileTime(),
  dbuffStateEntries = [],
  effectStateEntries = [],
) {
  const damageEntries = entities
    .filter((entity) => entity.kind === "station" || hasDamageableHealth(entity))
    .map((entity) => [entity.itemID, buildDamageState(entity, simFileTime)]);

  const state = buildKeyVal([
    ["stamp", stateStamp],
    ["state", buildSetStateBuffer(stateStamp, entities)],
    ["ego", egoEntityID],
    ["industryLevel", 0],
    ["researchLevel", 0],
    ["damageState", buildDict(damageEntries)],
    ["dbuffState", buildList(Array.isArray(dbuffStateEntries) ? dbuffStateEntries : [])],
    ["aggressors", buildDict([])],
    ["droneState", buildDroneState(entities)],
    ["slims", buildList(entities.map((entity) => buildSlimItemObject(entity)))],
    ["solItem", buildSolItem(system)],
    ["effectStates", buildList(Array.isArray(effectStateEntries) ? effectStateEntries : [])],
    ["allianceBridges", buildList([])],
  ]);

  return ["SetState", [state]];
}

function restampEncodedStateBuffer(buffer, stamp) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return buffer;
  }

  const nextBuffer = Buffer.from(buffer);
  nextBuffer.writeUInt32LE(toInt32(stamp, 0) >>> 0, 1);
  return nextBuffer;
}

function restampAddBalls2Payload(payload, stamp) {
  if (
    !Array.isArray(payload) ||
    payload[0] !== "AddBalls2" ||
    !Array.isArray(payload[1])
  ) {
    return payload;
  }

  const normalizedStamp = toInt32(stamp, 0) >>> 0;
  return [
    payload[0],
    payload[1].map((entry) => {
      if (!Array.isArray(entry) || !Buffer.isBuffer(entry[0])) {
        return entry;
      }
      return [restampEncodedStateBuffer(entry[0], normalizedStamp), ...entry.slice(1)];
    }),
  ];
}

function restampSetStatePayload(payload, stamp) {
  if (
    !Array.isArray(payload) ||
    payload[0] !== "SetState" ||
    !Array.isArray(payload[1]) ||
    payload[1].length === 0
  ) {
    return payload;
  }

  const stateObject = payload[1][0];
  const stateArgs = stateObject && stateObject.args;
  if (
    !stateObject ||
    !stateArgs ||
    stateArgs.type !== "dict" ||
    !Array.isArray(stateArgs.entries)
  ) {
    return payload;
  }

  const normalizedStamp = toInt32(stamp, 0) >>> 0;
  return [
    payload[0],
    [
      {
        ...stateObject,
        args: {
          ...stateArgs,
          entries: stateArgs.entries.map((entry) => {
            if (!Array.isArray(entry) || entry.length < 2) {
              return entry;
            }
            if (entry[0] === "stamp") {
              return [entry[0], normalizedStamp];
            }
            if (entry[0] === "state") {
              return [entry[0], restampEncodedStateBuffer(entry[1], normalizedStamp)];
            }
            return entry;
          }),
        },
      },
    ],
  ];
}

function restampPayloadState(payload, stamp) {
  if (!Array.isArray(payload) || typeof payload[0] !== "string") {
    return payload;
  }

  switch (payload[0]) {
    case "AddBalls2":
      return restampAddBalls2Payload(payload, stamp);
    case "SetState":
      return restampSetStatePayload(payload, stamp);
    default:
      return payload;
  }
}

function buildDestinyUpdatePayload(
  updates,
  waitForBubble = false,
  delayedTargetEvents = null,
) {
  const updateList = buildList(updates.map((update) => [update.stamp, update.payload]));
  if (Array.isArray(delayedTargetEvents)) {
    return [updateList, waitForBubble, delayedTargetEvents];
  }
  return [updateList, waitForBubble];
}

function buildGotoDirectionPayload(entityID, direction) {
  const vector = buildMarshalRealVector(direction);
  return ["GotoDirection", [entityID, vector.x, vector.y, vector.z]];
}

function buildGotoPointPayload(entityID, point) {
  const vector = buildMarshalRealVector(point);
  return ["GotoPoint", [entityID, vector.x, vector.y, vector.z]];
}

function buildFollowBallPayload(entityID, targetID, range) {
  return ["FollowBall", [entityID, targetID, toInt32(range, 0)]];
}

function buildWarpToPayload(entityID, destination, distance, warpSpeed) {
  const vector = buildMarshalRealVector(destination);
  return [
    "WarpTo",
    [
      entityID,
      vector.x,
      vector.y,
      vector.z,
      buildMarshalReal(distance, 0),
      toInt32(warpSpeed, 3000),
    ],
  ];
}

function buildAddBallPayload(
  entityID,
  {
    mass = 0,
    radius = 0,
    maxSpeed = 0,
    isFree = true,
    isGlobal = false,
    isMassive = false,
    isInteractive = true,
    isMoribund = false,
    position = null,
    velocity = null,
    inertia = 1,
    speedFraction = 0,
  } = {},
) {
  const positionVector = buildMarshalRealVector(position);
  const velocityVector = buildMarshalRealVector(velocity);
  return [
    "AddBall",
    [
      entityID,
      buildMarshalReal(mass, 0),
      buildMarshalReal(radius, 0),
      buildMarshalReal(maxSpeed, 0),
      isFree ? 1 : 0,
      isGlobal ? 1 : 0,
      isMassive ? 1 : 0,
      isInteractive ? 1 : 0,
      isMoribund ? 1 : 0,
      positionVector.x,
      positionVector.y,
      positionVector.z,
      velocityVector.x,
      velocityVector.y,
      velocityVector.z,
      buildMarshalReal(inertia, 1),
      buildMarshalReal(speedFraction, 0),
    ],
  ];
}

function buildEntityWarpInPayload(entityID, destination, warpFactor) {
  const vector = buildMarshalRealVector(destination);
  return [
    "EntityWarpIn",
    [
      entityID,
      vector.x,
      vector.y,
      vector.z,
      toInt32(warpFactor, 0),
    ],
  ];
}

function buildOrbitPayload(entityID, orbitEntityID, distance) {
  return ["Orbit", [entityID, orbitEntityID, toInt32(distance, 0)]];
}

function buildSetSpeedFractionPayload(entityID, fraction) {
  return ["SetSpeedFraction", [entityID, buildMarshalReal(fraction, 0)]];
}

function buildStopPayload(entityID) {
  return ["Stop", [entityID]];
}

function buildSetBallVelocityPayload(entityID, velocity) {
  const vector = buildMarshalRealVector(velocity);
  return ["SetBallVelocity", [entityID, vector.x, vector.y, vector.z]];
}

function buildSetBallPositionPayload(entityID, position) {
  const vector = buildMarshalRealVector(position);
  return ["SetBallPosition", [entityID, vector.x, vector.y, vector.z]];
}

function buildSetBallAngularVelocityPayload(entityID, angularVelocity) {
  const vector = buildMarshalRealVector(angularVelocity);
  return ["SetBallAngularVelocity", [entityID, vector.x, vector.y, vector.z]];
}

function buildSetMaxAngularVelocityPayload(entityID, maxAngularVelocity) {
  const vector = buildMarshalRealVector(maxAngularVelocity);
  return ["SetMaxAngularVelocity", [entityID, vector.x, vector.y, vector.z]];
}

function buildSetBallRotationPayload(entityID, rotation) {
  const vector = {
    x: buildMarshalReal(rotation && rotation.x, 0),
    y: buildMarshalReal(rotation && rotation.y, 0),
    z: buildMarshalReal(rotation && rotation.z, 0),
    w: buildMarshalReal(rotation && rotation.w, 1),
  };
  return [
    "SetBallRotation",
    [entityID, vector.x, vector.y, vector.z, vector.w],
  ];
}

function buildOnDockingAcceptedPayload(shipPosition, stationPosition, stationID) {
  return [toInt32(stationID, 0)];
}

function buildSetBallAgilityPayload(entityID, agility) {
  return ["SetBallAgility", [entityID, buildMarshalReal(agility, 0)]];
}

function buildSetBallAngularAgilityPayload(entityID, angularAgility) {
  return ["SetBallAngularAgility", [entityID, buildMarshalReal(angularAgility, 0)]];
}

function buildSetBallMassPayload(entityID, mass) {
  return ["SetBallMass", [entityID, buildMarshalReal(mass, 0)]];
}

function buildSetMaxSpeedPayload(entityID, speed) {
  return [
    "SetMaxSpeed",
    [entityID, buildMarshalReal(speed, 0)],
  ];
}

function buildSetBallMassivePayload(entityID, isMassive) {
  return ["SetBallMassive", [entityID, isMassive ? 1 : 0]];
}

function buildSetBallFreePayload(entityID, isFree = true) {
  return ["SetBallFree", [entityID, isFree ? 1 : 0]];
}

function buildSetBallInteractivePayload(entityID, isInteractive) {
  return ["SetBallInteractive", [entityID, isInteractive ? 1 : 0]];
}

function buildSetBallRadiusPayload(entityID, radius) {
  return ["SetBallRadius", [entityID, buildMarshalReal(radius, 0)]];
}

function buildSetMaxAngularSpeedPayload(entityID, maxAngularSpeed) {
  return ["SetMaxAngularSpeed", [entityID, buildMarshalReal(maxAngularSpeed, 0)]];
}

function buildSetBallTrollPayload(entityID, delayTicks) {
  return ["SetBallTroll", [entityID, toInt32(delayTicks, 0)]];
}

function buildSetBallHarmonicPayload(
  entityID,
  harmonicValue,
  corporationID,
  allianceID,
  isForcefield,
) {
  return [
    "SetBallHarmonic",
    [
      entityID,
      toInt32(harmonicValue, -1),
      toInt32(corporationID, -1),
      toInt32(allianceID, -1),
      isForcefield ? 1 : 0,
    ],
  ];
}

function buildCloakBallPayload(entityID, cloakMode, uncloakRange) {
  return [
    "CloakBall",
    [
      entityID,
      toInt32(cloakMode, 1),
      buildMarshalReal(uncloakRange, 0),
    ],
  ];
}

function buildUncloakBallPayload(entityID) {
  return ["UncloakBall", [entityID]];
}

function buildLaunchMissilePayload(
  entityID,
  targetID,
  ownerID,
  isAimedLaunch = true,
  isMissileMassive = false,
) {
  return [
    "LaunchMissile",
    [
      entityID,
      targetID,
      ownerID,
      isAimedLaunch ? 1 : 0,
      isMissileMassive ? 1 : 0,
    ],
  ];
}

function buildBallNotGlobalPayload(bubbleID) {
  return ["BallNotGlobal", [toInt32(bubbleID, 0)]];
}

function buildRemoveGlobalBallPayload(entityID) {
  return ["RemoveGlobalBall", [entityID]];
}

function buildPackagedActionPayload(serializedActions) {
  return ["PackagedAction", serializedActions];
}

function buildGraphicInfoDict(entries = []) {
  return buildDict(entries);
}

function normalizeGraphicInfo(graphicInfo) {
  if (graphicInfo === undefined) {
    return undefined;
  }
  if (
    graphicInfo === null ||
    (graphicInfo && typeof graphicInfo === "object" && graphicInfo.type)
  ) {
    return graphicInfo;
  }
  if (Array.isArray(graphicInfo)) {
    return buildList(graphicInfo);
  }
  if (graphicInfo && typeof graphicInfo === "object" && !Array.isArray(graphicInfo)) {
    // Client FX code mixes `graphicInfo.foo`, `graphicInfo.get("foo")`, and
    // `graphicInfo["foo"]` access. Marshal plain JS objects as util.KeyVal so
    // one payload shape satisfies all three lookup styles.
    return buildKeyVal(Object.entries(graphicInfo));
  }
  return graphicInfo;
}

function buildOnSpecialFXPayload(
  entityID,
  guid,
  {
    moduleID = null,
    moduleTypeID = null,
    targetID = null,
    chargeTypeID = null,
    isOffensive = false,
    start = true,
    active = true,
    duration,
    repeat,
    startTime,
    timeFromStart,
    graphicInfo,
  } = {},
) {
  const args = [
    entityID,
    moduleID,
    moduleTypeID,
    targetID,
    chargeTypeID,
    String(guid || ""),
    isOffensive ? 1 : 0,
    start ? 1 : 0,
    active ? 1 : 0,
  ];
  // Michelle's live signature always reserves the full optional tail:
  // duration, repeat, startTime, timeFromStart, graphicInfo.
  args.push(
    duration === undefined ? -1 : toFiniteNumber(duration, -1),
    repeat === undefined ? null : repeat,
    startTime === undefined ? null : startTime,
    timeFromStart === undefined ? 0 : toFiniteNumber(timeFromStart, 0),
    graphicInfo === undefined ? null : normalizeGraphicInfo(graphicInfo),
  );
  return ["OnSpecialFX", args];
}

function buildOnDamageStateChangePayload(entityID, damageState = null) {
  return [
    "OnDamageStateChange",
    [
      toInt32(entityID, 0),
      damageState,
    ],
  ];
}

function buildOnSlimItemChangePayload(entityID, slimItem = null) {
  return [
    "OnSlimItemChange",
    [
      toInt32(entityID, 0),
      slimItem || null,
    ],
  ];
}

function buildOnDbuffUpdatedPayload(entityID, dbuffState = []) {
  return [
    "OnDbuffUpdated",
    [
      toInt32(entityID, 0),
      Array.isArray(dbuffState) ? buildList(dbuffState) : dbuffState,
    ],
  ];
}

function buildTerminalPlayDestructionEffectPayload(entityID, destructionEffectID) {
  return [
    "TerminalPlayDestructionEffect",
    [
      toInt32(entityID, 0),
      toInt32(destructionEffectID, 0),
    ],
  ];
}

function buildRemoveBallPayload(entityID) {
  return ["RemoveBall", [entityID]];
}

function buildRemoveBallsPayload(entityIDs) {
  return ["RemoveBalls", [{ type: "list", items: entityIDs }]];
}

module.exports = {
  BALL_FLAG,
  BALL_MODE,
  buildDamageState,
  buildSlimItemDict,
  buildSlimItemObject,
  buildAddBalls2Payload,
  buildSetStatePayload,
  restampPayloadState,
  buildDestinyUpdatePayload,
  buildGotoDirectionPayload,
  buildGotoPointPayload,
  buildFollowBallPayload,
  buildAddBallPayload,
  buildWarpToPayload,
  buildEntityWarpInPayload,
  buildOrbitPayload,
  buildSetSpeedFractionPayload,
  buildStopPayload,
  buildSetBallVelocityPayload,
  buildSetBallPositionPayload,
  buildSetBallAngularVelocityPayload,
  buildSetMaxAngularVelocityPayload,
  buildSetBallRotationPayload,
  buildOnDockingAcceptedPayload,
  buildSetBallAgilityPayload,
  buildSetBallAngularAgilityPayload,
  buildSetBallMassPayload,
  buildSetMaxSpeedPayload,
  buildSetBallMassivePayload,
  buildSetBallFreePayload,
  buildSetBallInteractivePayload,
  buildSetBallRadiusPayload,
  buildSetMaxAngularSpeedPayload,
  buildSetBallTrollPayload,
  buildSetBallHarmonicPayload,
  buildCloakBallPayload,
  buildUncloakBallPayload,
  buildLaunchMissilePayload,
  buildBallNotGlobalPayload,
  buildRemoveGlobalBallPayload,
  buildPackagedActionPayload,
  buildGraphicInfoDict,
  buildOnSpecialFXPayload,
  buildOnDamageStateChangePayload,
  buildOnSlimItemChangePayload,
  buildOnDbuffUpdatedPayload,
  buildTerminalPlayDestructionEffectPayload,
  buildRemoveBallPayload,
  buildRemoveBallsPayload,
  debugDescribeEntityBall,
};
