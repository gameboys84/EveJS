const path = require("path");

const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const { buildDict } = require(path.join(__dirname, "../_shared/serviceHelpers"));

const SITE_ENTRY_INFERENCE_RANGE_METERS = 1_000_000;
const SITE_ENTRY_INFERENCE_RANGE_SQUARED =
  SITE_ENTRY_INFERENCE_RANGE_METERS ** 2;
const SAME_ROOM_WARP_PRESERVE_RANGE_METERS = 1_000_000;
const SAME_ROOM_WARP_PRESERVE_RANGE_SQUARED =
  SAME_ROOM_WARP_PRESERVE_RANGE_METERS ** 2;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function clonePosition(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    x: toFiniteNumber(value.x, 0),
    y: toFiniteNumber(value.y, 0),
    z: toFiniteNumber(value.z, 0),
  };
}

function positionTuple(value) {
  const position = clonePosition(value);
  if (!position) {
    return null;
  }
  return [position.x, position.y, position.z];
}

function distanceSquared(left, right) {
  const leftPosition = clonePosition(left);
  const rightPosition = clonePosition(right);
  if (!leftPosition || !rightPosition) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    ((leftPosition.x - rightPosition.x) ** 2) +
    ((leftPosition.y - rightPosition.y) ** 2) +
    ((leftPosition.z - rightPosition.z) ** 2)
  );
}

function isActiveDungeonInstance(instance) {
  return (
    instance &&
    ["seeded", "active", "paused"].includes(
      normalizeLowerText(instance.lifecycleState, "seeded"),
    )
  );
}

function isTrackedDungeonInstance(instance) {
  return (
    instance &&
    ["seeded", "active", "paused", "completed"].includes(
      normalizeLowerText(instance.lifecycleState, "seeded"),
    )
  );
}

function resolveTemplate(instance) {
  const templateID = normalizeText(instance && instance.templateID, "");
  return templateID ? dungeonAuthority.getTemplateByID(templateID) : null;
}

function resolveDungeonID(instance, template = null) {
  return Math.max(
    0,
    toInt(instance && instance.sourceDungeonID, 0),
    toInt(instance && instance.metadata && instance.metadata.sourceDungeonID, 0),
    toInt(instance && instance.metadata && instance.metadata.dungeonID, 0),
    toInt(template && template.sourceDungeonID, 0),
    toInt(template && template.dungeonID, 0),
  );
}

function resolveRoomID(roomKey, roomState = null) {
  const explicitRoomID = Math.max(
    0,
    toInt(roomState && roomState.pocketID, 0),
    toInt(roomState && roomState.roomID, 0),
  );
  if (explicitRoomID > 0) {
    return explicitRoomID;
  }
  const normalizedRoomKey = normalizeText(roomKey, "");
  const match = normalizedRoomKey.match(/(\d+)$/);
  return match ? Math.max(0, toInt(match[1], 0)) : 0;
}

function resolveRoomState(instance, roomKey) {
  const roomStatesByKey =
    instance &&
    instance.roomStatesByKey &&
    typeof instance.roomStatesByKey === "object"
      ? instance.roomStatesByKey
      : {};
  return roomStatesByKey[normalizeText(roomKey, "")] || null;
}

function buildDungeonValues() {
  // The build-3396210 client immediately calls iteritems() on dungeon_values.
  // Keep this as a real Python dict shape while authored blackboard values are unknown.
  return buildDict([]);
}

function buildCurrentDungeonInfo(instance, roomKey, options = {}) {
  const template = options.template || resolveTemplate(instance);
  const dungeonID = resolveDungeonID(instance, template);
  if (dungeonID <= 0 || !instance) {
    return null;
  }
  const normalizedRoomKey = normalizeText(roomKey, "room:entry");
  const roomState = resolveRoomState(instance, normalizedRoomKey);
  return [
    dungeonID,
    resolveRoomID(normalizedRoomKey, roomState),
    Math.max(0, toInt(instance.instanceID, 0)),
    buildDungeonValues(instance, normalizedRoomKey, { template }),
  ];
}

function getShipEntityForSession(scene, session) {
  if (!scene || !session) {
    return null;
  }
  if (typeof scene.getShipEntityForSession === "function") {
    return scene.getShipEntityForSession(session);
  }
  const shipID = Math.max(0, toInt(session.shipID, toInt(session.shipid, 0)));
  if (shipID > 0 && typeof scene.getEntityByID === "function") {
    return scene.getEntityByID(shipID);
  }
  return null;
}

function markShipCurrentDungeonRoom(shipEntity, instance, roomKey, options = {}) {
  if (!shipEntity || !instance) {
    return false;
  }
  const normalizedRoomKey = normalizeText(roomKey, "room:entry");
  const template = options.template || resolveTemplate(instance);
  const dungeonID = resolveDungeonID(instance, template);
  if (dungeonID <= 0) {
    return false;
  }
  const roomID = resolveRoomID(normalizedRoomKey, resolveRoomState(instance, normalizedRoomKey));
  const previousInstanceID = Math.max(0, toInt(shipEntity.dungeonCurrentInstanceID, 0));
  const previousRoomKey = normalizeText(shipEntity.dungeonCurrentRoomKey, "");
  const changed =
    previousInstanceID !== Math.max(0, toInt(instance.instanceID, 0)) ||
    previousRoomKey !== normalizedRoomKey;
  if (previousInstanceID !== Math.max(0, toInt(instance.instanceID, 0))) {
    delete shipEntity.dungeonCompletedNotifiedInstanceID;
  }

  shipEntity.dungeonCurrentInstanceID = Math.max(0, toInt(instance.instanceID, 0));
  shipEntity.dungeonCurrentDungeonID = dungeonID;
  shipEntity.dungeonCurrentRoomKey = normalizedRoomKey;
  shipEntity.dungeonCurrentRoomID = roomID;
  shipEntity.dungeonCurrentSiteID = Math.max(
    0,
    toInt(options.siteID, toInt(instance && instance.metadata && instance.metadata.siteID, 0)),
  ) || null;
  shipEntity.dungeonCurrentRoomPosition = positionTuple(options.roomPosition) || null;
  shipEntity.dungeonCurrentUpdatedAtMs = Math.max(0, toInt(options.nowMs, Date.now()));
  return changed;
}

function resolveTrackedDungeonForShip(shipEntity, options = {}) {
  const instanceID = Math.max(0, toInt(shipEntity && shipEntity.dungeonCurrentInstanceID, 0));
  if (instanceID <= 0) {
    return null;
  }
  const instance = dungeonRuntime.getInstance(instanceID);
  if (!isTrackedDungeonInstance(instance)) {
    return null;
  }
  const expectedSystemID = Math.max(0, toInt(options.solarSystemID, 0));
  if (expectedSystemID > 0 && Math.max(0, toInt(instance.solarSystemID, 0)) !== expectedSystemID) {
    return null;
  }
  return {
    instance,
    roomKey: normalizeText(shipEntity.dungeonCurrentRoomKey, "room:entry"),
  };
}

function resolveSiteEntityInstance(scene, siteEntity) {
  const instanceID = Math.max(
    0,
    toInt(
      siteEntity && (
        siteEntity.dungeonSiteInstanceID ||
        siteEntity.dungeonInstanceID ||
        siteEntity.instanceID
      ),
      0,
    ),
  );
  if (instanceID <= 0) {
    return null;
  }
  const instance = dungeonRuntime.getInstance(instanceID);
  return isActiveDungeonInstance(instance) ? instance : null;
}

function inferEntryDungeonForShip(scene, shipEntity) {
  if (!scene || !shipEntity) {
    return null;
  }
  const shipPosition = clonePosition(shipEntity.position);
  if (!shipPosition) {
    return null;
  }
  let nearest = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const entity of Array.isArray(scene.staticEntities) ? scene.staticEntities : []) {
    if (
      !entity ||
      (
        entity.signalTrackerUniverseSeededSite !== true &&
        normalizeText(entity.kind, "") !== "missionSite"
      )
    ) {
      continue;
    }
    const candidateDistanceSquared = distanceSquared(shipPosition, entity.position);
    if (
      candidateDistanceSquared > SITE_ENTRY_INFERENCE_RANGE_SQUARED ||
      candidateDistanceSquared >= nearestDistanceSquared
    ) {
      continue;
    }
    const instance = resolveSiteEntityInstance(scene, entity);
    if (!instance) {
      continue;
    }
    nearest = {
      instance,
      roomKey: "room:entry",
      siteID: Math.max(0, toInt(entity.itemID, 0)) || null,
      roomPosition: entity.position || null,
    };
    nearestDistanceSquared = candidateDistanceSquared;
  }
  return nearest;
}

function resolveCurrentDungeonForSession(scene, session) {
  const shipEntity = getShipEntityForSession(scene, session);
  if (!shipEntity) {
    return null;
  }
  return (
    resolveTrackedDungeonForShip(shipEntity, {
      solarSystemID: scene && scene.systemID,
    }) ||
    inferEntryDungeonForShip(scene, shipEntity)
  );
}

function resolveTrackedDungeonForSession(scene, session) {
  const shipEntity = getShipEntityForSession(scene, session);
  if (!shipEntity) {
    return null;
  }
  const tracked = resolveTrackedDungeonForShip(shipEntity, {
    solarSystemID: scene && scene.systemID,
  });
  return tracked
    ? {
        ...tracked,
        shipEntity,
      }
    : null;
}

function resolveCurrentDungeonInfoForSession(scene, session) {
  const current = resolveCurrentDungeonForSession(scene, session);
  return current
    ? buildCurrentDungeonInfo(current.instance, current.roomKey)
    : null;
}

function sendEnteringDungeonRoomNotification(session, instance, roomKey, options = {}) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  const info = buildCurrentDungeonInfo(instance, roomKey, options);
  if (!info) {
    return false;
  }
  session.sendNotification("OnEnteringDungeonRoom", "shipid", [
    info[0],
    info[1],
    positionTuple(options.roomPosition),
    info[2],
    info[3],
  ]);
  return true;
}

function clearShipCurrentDungeonRoom(shipEntity, options = {}) {
  if (!shipEntity) {
    return false;
  }
  const hadDungeon = Math.max(0, toInt(shipEntity.dungeonCurrentInstanceID, 0)) > 0 ||
    Math.max(0, toInt(shipEntity.dungeonCurrentDungeonID, 0)) > 0 ||
    !!normalizeText(shipEntity.dungeonCurrentRoomKey, "");

  delete shipEntity.dungeonCurrentInstanceID;
  delete shipEntity.dungeonCurrentDungeonID;
  delete shipEntity.dungeonCurrentRoomKey;
  delete shipEntity.dungeonCurrentRoomID;
  delete shipEntity.dungeonCurrentSiteID;
  delete shipEntity.dungeonCurrentRoomPosition;
  delete shipEntity.dungeonCompletedNotifiedInstanceID;
  shipEntity.dungeonCurrentUpdatedAtMs = Math.max(0, toInt(options.nowMs, Date.now()));
  return hadDungeon;
}

function sendExitingDungeonNotification(session, dungeonID) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    Math.max(0, toInt(dungeonID, 0)) <= 0
  ) {
    return false;
  }
  session.sendNotification("OnExitingDungeon", "shipid", [
    Math.max(0, toInt(dungeonID, 0)),
  ]);
  return true;
}

function sendDungeonCompletedNotification(session, dungeonID) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    Math.max(0, toInt(dungeonID, 0)) <= 0
  ) {
    return false;
  }
  session.sendNotification("OnDungeonCompleted", "charid", [
    Math.max(0, toInt(dungeonID, 0)),
  ]);
  return true;
}

function resolveDungeonInstance(instanceOrID) {
  if (instanceOrID && typeof instanceOrID === "object") {
    return instanceOrID;
  }
  const instanceID = Math.max(0, toInt(instanceOrID, 0));
  return instanceID > 0 ? dungeonRuntime.getInstance(instanceID) : null;
}

function completeCurrentDungeonForSession(scene, session, instanceOrID, options = {}) {
  const instance = resolveDungeonInstance(instanceOrID);
  if (!instance) {
    return false;
  }
  const current = resolveTrackedDungeonForSession(scene, session);
  if (!current || !current.instance || !current.shipEntity) {
    return false;
  }
  const instanceID = Math.max(0, toInt(instance.instanceID, 0));
  if (
    instanceID <= 0 ||
    Math.max(0, toInt(current.instance && current.instance.instanceID, 0)) !== instanceID
  ) {
    return false;
  }
  if (
    options.forceNotify !== true &&
    Math.max(0, toInt(current.shipEntity.dungeonCompletedNotifiedInstanceID, 0)) === instanceID
  ) {
    return false;
  }
  const dungeonID = Math.max(
    0,
    toInt(current.shipEntity && current.shipEntity.dungeonCurrentDungeonID, 0),
    resolveDungeonID(instance),
    resolveDungeonID(current.instance),
  );
  if (!sendDungeonCompletedNotification(session, dungeonID)) {
    return false;
  }
  current.shipEntity.dungeonCompletedNotifiedInstanceID = instanceID;
  current.shipEntity.dungeonCurrentUpdatedAtMs = Math.max(0, toInt(options.nowMs, Date.now()));
  return true;
}

function listSceneSessions(scene) {
  if (!scene || !scene.sessions) {
    return [];
  }
  if (scene.sessions instanceof Map) {
    return Array.from(scene.sessions.values());
  }
  if (Array.isArray(scene.sessions)) {
    return scene.sessions;
  }
  if (typeof scene.sessions === "object") {
    return Object.values(scene.sessions);
  }
  return [];
}

function notifyDungeonCompletedForScene(scene, instanceOrID, options = {}) {
  const instance = resolveDungeonInstance(instanceOrID);
  if (!scene || !instance) {
    return 0;
  }
  let notifiedCount = 0;
  for (const session of listSceneSessions(scene)) {
    if (completeCurrentDungeonForSession(scene, session, instance, options)) {
      notifiedCount += 1;
    }
  }
  return notifiedCount;
}

function getSceneEntityByID(scene, entityID) {
  const numericEntityID = Math.max(0, toInt(entityID, 0));
  if (!scene || numericEntityID <= 0) {
    return null;
  }
  if (typeof scene.getEntityByID === "function") {
    return scene.getEntityByID(numericEntityID);
  }
  if (scene.staticEntitiesByID instanceof Map && scene.staticEntitiesByID.has(numericEntityID)) {
    return scene.staticEntitiesByID.get(numericEntityID);
  }
  if (scene.dynamicEntities instanceof Map && scene.dynamicEntities.has(numericEntityID)) {
    return scene.dynamicEntities.get(numericEntityID);
  }
  return null;
}

function entityBelongsToTrackedDungeon(entity, instance, shipEntity) {
  if (!entity || !instance) {
    return false;
  }
  const instanceID = Math.max(0, toInt(instance.instanceID, 0));
  const siteID = Math.max(
    0,
    toInt(shipEntity && shipEntity.dungeonCurrentSiteID, 0),
    toInt(instance && instance.metadata && instance.metadata.siteID, 0),
  );
  const entityInstanceID = Math.max(
    0,
    toInt(entity.dungeonSiteInstanceID, 0),
    toInt(entity.dungeonInstanceID, 0),
    toInt(entity.instanceID, 0),
  );
  if (instanceID > 0 && entityInstanceID === instanceID) {
    return true;
  }
  const entitySiteID = Math.max(
    0,
    toInt(entity.dungeonSiteID, 0),
    toInt(entity.itemID, 0),
  );
  if (siteID > 0 && entitySiteID === siteID) {
    return true;
  }
  const dungeonID = Math.max(0, toInt(shipEntity && shipEntity.dungeonCurrentDungeonID, 0));
  return (
    dungeonID > 0 &&
    Math.max(0, toInt(entity.dungeonID, 0)) === dungeonID &&
    (
      normalizeText(entity.kind, "") === "missionSite" ||
      entity.signalTrackerUniverseSeededSite === true ||
      entity.dungeonMaterializedSiteContent === true
    )
  );
}

function pointBelongsToTrackedDungeon(point, shipEntity) {
  const roomPosition = Array.isArray(shipEntity && shipEntity.dungeonCurrentRoomPosition)
    ? {
        x: shipEntity.dungeonCurrentRoomPosition[0],
        y: shipEntity.dungeonCurrentRoomPosition[1],
        z: shipEntity.dungeonCurrentRoomPosition[2],
      }
    : null;
  if (!point || !roomPosition) {
    return false;
  }
  return distanceSquared(point, roomPosition) <= SAME_ROOM_WARP_PRESERVE_RANGE_SQUARED;
}

function shouldPreserveDungeonForWarp(scene, current, options = {}) {
  if (!current || !current.instance || !current.shipEntity) {
    return false;
  }
  if (
    options.preserveDungeonTracking === true ||
    options.dungeonRoomTransition === true
  ) {
    return true;
  }
  const targetEntity = options.targetEntity ||
    getSceneEntityByID(scene, options.targetEntityID);
  if (entityBelongsToTrackedDungeon(targetEntity, current.instance, current.shipEntity)) {
    return true;
  }
  return pointBelongsToTrackedDungeon(options.targetPoint, current.shipEntity);
}

function exitCurrentDungeonForSession(scene, session, options = {}) {
  const current = resolveTrackedDungeonForSession(scene, session);
  if (!current) {
    return false;
  }
  if (shouldPreserveDungeonForWarp(scene, current, options)) {
    return false;
  }
  const dungeonID = Math.max(
    0,
    toInt(current.shipEntity && current.shipEntity.dungeonCurrentDungeonID, 0),
    resolveDungeonID(current.instance),
  );
  clearShipCurrentDungeonRoom(current.shipEntity, options);
  return sendExitingDungeonNotification(session, dungeonID);
}

function enterDungeonRoomForSession(scene, session, instance, roomKey, options = {}) {
  const shipEntity = getShipEntityForSession(scene, session);
  if (!shipEntity || !instance) {
    return false;
  }
  const normalizedRoomKey = normalizeText(roomKey, "room:entry");
  const changed = markShipCurrentDungeonRoom(shipEntity, instance, normalizedRoomKey, options);
  if (changed || options.forceNotify === true) {
    return sendEnteringDungeonRoomNotification(session, instance, normalizedRoomKey, options);
  }
  return false;
}

module.exports = {
  buildCurrentDungeonInfo,
  clearShipCurrentDungeonRoom,
  completeCurrentDungeonForSession,
  enterDungeonRoomForSession,
  exitCurrentDungeonForSession,
  markShipCurrentDungeonRoom,
  notifyDungeonCompletedForScene,
  resolveTrackedDungeonForSession,
  resolveCurrentDungeonForSession,
  resolveCurrentDungeonInfoForSession,
  resolveDungeonID,
  resolveRoomID,
  sendDungeonCompletedNotification,
  sendExitingDungeonNotification,
  sendEnteringDungeonRoomNotification,
};
