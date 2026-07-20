const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const dungeonUniverseSiteService = require(path.join(
  __dirname,
  "../dungeon/dungeonUniverseSiteService",
));

const HACKING_CONSTANTS = Object.freeze({
  GAMETYPE_HACKING: 0,
  GAMETYPE_ARCHEOLOGY: 1,
  TYPE_NONE: -1,
  TYPE_SEGMENT: 0,
  TYPE_VIRUS: 1,
  TYPE_CORE: 2,
  SUBTYPE_NONE: -1,
  SUBTYPE_CORE_LOW: 11,
  EVENT_GAME_LOST: 0,
  EVENT_GAME_WON: 1,
  EVENT_GAME_START: 2,
  EVENT_VIRUS_CREATED: 3,
  EVENT_OBJECT_KILLED: 4,
  EVENT_GAME_STYLE: 5,
  EVENT_ACK: 6,
  EVENT_TILE_FLIPPED: 100,
  EVENT_TILE_CREATED: 101,
  EVENT_ATTACK: 301,
  HACKING_STATE_SECURE: 0,
  HACKING_STATE_BEING_HACKED: 1,
  HACKING_STATE_HACKED: 2,
});

const ACTIVE_ATTEMPTS = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  return Math.max(0, toInt(value, fallback));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function normalizeCallArgs(args = [], fallbackArgs = []) {
  if (Array.isArray(args)) {
    return args;
  }
  if (arguments.length > 1) {
    return Array.isArray(fallbackArgs) ? fallbackArgs : [];
  }
  return [];
}

function buildTuple(items = []) {
  return {
    type: "tuple",
    items: Array.isArray(items) ? items : [items],
  };
}

function buildCoord(x, y) {
  return buildTuple([toInt(x, 0), toInt(y, 0)]);
}

function unwrapCoord(coord) {
  if (Array.isArray(coord)) {
    return [toInt(coord[0], 0), toInt(coord[1], 0)];
  }
  if (coord && typeof coord === "object") {
    if (Array.isArray(coord.items)) {
      return [toInt(coord.items[0], 0), toInt(coord.items[1], 0)];
    }
    if (Array.isArray(coord.value)) {
      return [toInt(coord.value[0], 0), toInt(coord.value[1], 0)];
    }
    if (Array.isArray(coord.list)) {
      return [toInt(coord.list[0], 0), toInt(coord.list[1], 0)];
    }
    return [
      toInt(coord.x ?? coord[0], 0),
      toInt(coord.y ?? coord[1], 0),
    ];
  }
  return [0, 0];
}

function coordKey(coord) {
  const [x, y] = unwrapCoord(coord);
  return `${x}:${y}`;
}

function buildEvent(eventID, eventData = {}) {
  return {
    eventID,
    eventData,
  };
}

function buildUtilityInventory(slotCount) {
  return Array.from(
    { length: Math.max(0, Math.min(8, toInt(slotCount, 0))) },
    (_, index) => ({
      id: null,
      subtype: HACKING_CONSTANTS.SUBTYPE_NONE,
      info: null,
      index,
    }),
  );
}

function buildSyntheticBoard(difficulty = 1) {
  const coreHitpoints = Math.max(
    1,
    roundNumber(toFiniteNumber(difficulty, 1) * 10, 6),
  );
  return [
    {
      id: 1,
      type: HACKING_CONSTANTS.TYPE_SEGMENT,
      subtype: HACKING_CONSTANTS.SUBTYPE_NONE,
      coord: buildCoord(0, 0),
      hidden: false,
      blocked: false,
      strength: 0,
      coherence: 0,
    },
    {
      id: 2,
      type: HACKING_CONSTANTS.TYPE_CORE,
      subtype: HACKING_CONSTANTS.SUBTYPE_CORE_LOW,
      coord: buildCoord(1, 0),
      hidden: true,
      blocked: false,
      strength: coreHitpoints,
      coherence: coreHitpoints,
    },
    {
      id: 3,
      type: HACKING_CONSTANTS.TYPE_SEGMENT,
      subtype: HACKING_CONSTANTS.SUBTYPE_NONE,
      coord: buildCoord(0, 1),
      hidden: true,
      blocked: false,
      strength: 0,
      coherence: 0,
    },
  ];
}

function cloneTile(tile) {
  return {
    ...tile,
    coord: buildTuple(tile.coord && tile.coord.items),
  };
}

function getAttemptKey(session) {
  return String(
    toPositiveInt(
      session && (
        session.characterID ||
        session.charid ||
        session.userid ||
        session.clientID ||
        session.clientId
      ),
      0,
    ) || "anonymous",
  );
}

function getSessionSystemID(session) {
  return toPositiveInt(
    session && (
      (session._space && session._space.systemID) ||
      session.solarsystemid2 ||
      session.solarsystemid ||
      session.systemID
    ),
    0,
  );
}

function emitHackingTurn(session, events) {
  if (
    session &&
    typeof session.sendNotification === "function" &&
    Array.isArray(events) &&
    events.length > 0
  ) {
    session.sendNotification("OnHackingTurnComplete", "clientID", [events]);
  }
}

function getSceneEntity(scene, entityID) {
  const numericEntityID = toPositiveInt(entityID, 0);
  if (!scene || numericEntityID <= 0) {
    return null;
  }
  if (typeof scene.getEntityByID === "function") {
    return scene.getEntityByID(numericEntityID);
  }
  return (
    (scene.dynamicEntities instanceof Map && scene.dynamicEntities.get(numericEntityID)) ||
    (scene.staticEntitiesByID instanceof Map && scene.staticEntitiesByID.get(numericEntityID)) ||
    null
  );
}

function resolveContainerTarget(targetID, session) {
  const numericTargetID = toPositiveInt(targetID, 0);
  const systemID = getSessionSystemID(session);
  if (numericTargetID <= 0 || systemID <= 0) {
    return null;
  }
  const scene = spaceRuntime.ensureScene(systemID);
  const entity = getSceneEntity(scene, numericTargetID);
  if (
    !scene ||
    !entity ||
    entity.dungeonMaterializedContainer !== true ||
    entity.dungeonMaterializedSiteContent !== true
  ) {
    return null;
  }
  return {
    scene,
    entity,
    systemID,
    instanceID: toPositiveInt(entity.dungeonSiteInstanceID, 0),
  };
}

function markContainerState(target, state, nowMs) {
  if (!(target && target.entity)) {
    return;
  }
  target.entity.dungeonSiteContentHackingState = state;
  if (state === HACKING_CONSTANTS.HACKING_STATE_BEING_HACKED) {
    target.entity.dungeonSiteContentHackingStartedAtMs = nowMs;
  } else if (state === HACKING_CONSTANTS.HACKING_STATE_HACKED) {
    target.entity.dungeonSiteContentHackedAtMs = nowMs;
  }
}

function buildStartEvents(attempt) {
  return [
    buildEvent(HACKING_CONSTANTS.EVENT_GAME_STYLE, {
      style: attempt.gameType,
    }),
    ...attempt.tiles.map((tile) => buildEvent(
      HACKING_CONSTANTS.EVENT_TILE_CREATED,
      cloneTile(tile),
    )),
    buildEvent(HACKING_CONSTANTS.EVENT_VIRUS_CREATED, {
      id: attempt.virusID,
      type: HACKING_CONSTANTS.TYPE_VIRUS,
      strength: attempt.virusStrength,
      coherence: attempt.virusCoherence,
      inventory: buildUtilityInventory(attempt.virusSlots),
    }),
    buildEvent(HACKING_CONSTANTS.EVENT_GAME_START, {
      moduleTypeID: attempt.moduleTypeID,
      targetID: attempt.targetID || null,
      gameType: attempt.gameType,
      difficulty: attempt.difficulty,
    }),
  ];
}

function buildVirusResult(attempt) {
  return {
    id: attempt.virusID,
    type: HACKING_CONSTANTS.TYPE_VIRUS,
    strength: attempt.virusStrength,
    coherence: attempt.virusCoherence,
  };
}

function destroyTargetContainer(target, options = {}) {
  if (!(target && target.scene && target.entity)) {
    return {
      success: false,
      errorMsg: "CONTAINER_NOT_FOUND",
    };
  }
  return dungeonUniverseSiteService.destroyMaterializedContentEntity(
    target.scene,
    target.entity,
    {
      broadcast: options.broadcast === true,
      excludedSession: options.excludedSession || null,
      nowMs: options.nowMs,
    },
  );
}

function failContainerAttempt(attempt, session, nowMs) {
  const target = attempt && attempt.target;
  if (!(target && target.entity)) {
    return null;
  }

  const failureCount = Math.max(
    0,
    toInt(target.entity.dungeonSiteContentFailureCount, 0),
  ) + 1;
  target.entity.dungeonSiteContentFailureCount = failureCount;
  markContainerState(target, HACKING_CONSTANTS.HACKING_STATE_SECURE, nowMs);

  if (target.entity.dungeonSiteContentFailureExplodes === true && target.instanceID > 0) {
    return dungeonUniverseSiteService.triggerSiteEncounter(
      target.scene,
      target.instanceID,
      "hack_failure",
      {
        nowMs,
        session,
      },
    );
  }

  if (failureCount >= 2) {
    return destroyTargetContainer(target, {
      broadcast: true,
      excludedSession: null,
      nowMs,
    });
  }

  return {
    success: true,
    data: {
      failureCount,
      destroyed: false,
    },
  };
}

function maybeCompleteAttemptSite(attempt, session, nowMs) {
  const target = attempt && attempt.target;
  if (!(target && target.scene && target.entity)) {
    return null;
  }
  return dungeonUniverseSiteService.maybeCompleteMaterializedDataRelicSite(
    target.scene,
    target.entity,
    {
      broadcast: true,
      excludedSession: null,
      nowMs,
      session,
    },
  );
}

class HackingMgrService extends BaseService {
  constructor() {
    super("hackingMgr");
  }

  Handle_StartNewGameInstance(args = [], session = null) {
    const [
      targetID,
      gameType,
      moduleTypeID,
      difficulty,
      virusInitialCoherence,
      virusInitialStrength,
      virusSlots,
    ] = normalizeCallArgs(args);
    const nowMs = Date.now();
    const target = resolveContainerTarget(targetID, session);
    const normalizedDifficulty = Math.max(
      1,
      roundNumber(toFiniteNumber(difficulty, 1), 6),
    );
    const attempt = {
      key: getAttemptKey(session),
      targetID: toPositiveInt(targetID, 0),
      target,
      gameType: toInt(
        gameType,
        target && String(target.entity.dungeonSiteContentAnalyzer || "") === "relic"
          ? HACKING_CONSTANTS.GAMETYPE_ARCHEOLOGY
          : HACKING_CONSTANTS.GAMETYPE_HACKING,
      ),
      moduleTypeID: toPositiveInt(moduleTypeID, 0) || null,
      difficulty: normalizedDifficulty,
      virusCoherence: Math.max(1, toInt(virusInitialCoherence, 200)),
      virusStrength: Math.max(1, toInt(virusInitialStrength, 30)),
      virusSlots: Math.max(0, toInt(virusSlots, 3)),
      virusID: 1,
      tiles: buildSyntheticBoard(normalizedDifficulty),
      completed: false,
      startedAtMs: nowMs,
    };
    ACTIVE_ATTEMPTS.set(attempt.key, attempt);
    markContainerState(target, HACKING_CONSTANTS.HACKING_STATE_BEING_HACKED, nowMs);
    emitHackingTurn(session, buildStartEvents(attempt));
    return null;
  }

  StartNewGameInstance(targetID, gameType, moduleTypeID, difficulty, coherence, strength, slots, session = null) {
    return this.Handle_StartNewGameInstance(
      [targetID, gameType, moduleTypeID, difficulty, coherence, strength, slots],
      session,
    );
  }

  Handle_ClickedOnTile(args = [], session = null) {
    const [tileCoord] = normalizeCallArgs(args);
    const key = getAttemptKey(session);
    const attempt = ACTIVE_ATTEMPTS.get(key);
    if (!attempt || attempt.completed) {
      emitHackingTurn(session, [buildEvent(HACKING_CONSTANTS.EVENT_ACK, {})]);
      return null;
    }

    const tile = attempt.tiles.find((candidate) => coordKey(candidate.coord) === coordKey(tileCoord));
    if (!tile) {
      emitHackingTurn(session, [buildEvent(HACKING_CONSTANTS.EVENT_ACK, {})]);
      return null;
    }

    const nowMs = Date.now();
    let shouldEvaluateSiteCompletion = false;
    tile.hidden = false;
    const events = [
      buildEvent(HACKING_CONSTANTS.EVENT_TILE_FLIPPED, cloneTile(tile)),
    ];

    if (tile.type === HACKING_CONSTANTS.TYPE_CORE) {
      tile.coherence = 0;
      attempt.completed = true;
      markContainerState(
        attempt.target,
        HACKING_CONSTANTS.HACKING_STATE_HACKED,
        nowMs,
      );
      shouldEvaluateSiteCompletion = true;
      events.push(
        buildEvent(HACKING_CONSTANTS.EVENT_ATTACK, {
          attackerResult: buildVirusResult(attempt),
          defenderResult: cloneTile(tile),
        }),
        buildEvent(HACKING_CONSTANTS.EVENT_OBJECT_KILLED, cloneTile(tile)),
        buildEvent(HACKING_CONSTANTS.EVENT_GAME_WON, {
          targetID: attempt.targetID || null,
        }),
      );
      ACTIVE_ATTEMPTS.delete(key);
    }

    emitHackingTurn(session, events);
    if (shouldEvaluateSiteCompletion) {
      maybeCompleteAttemptSite(attempt, session, nowMs);
    }
    return null;
  }

  ClickedOnTile(tileCoord, session = null) {
    return this.Handle_ClickedOnTile([tileCoord], session);
  }

  Handle_QuitHackingAttempt(args = [], session = null) {
    normalizeCallArgs(args);
    const key = getAttemptKey(session);
    const attempt = ACTIVE_ATTEMPTS.get(key);
    if (!attempt || attempt.completed) {
      return null;
    }
    attempt.completed = true;
    const nowMs = Date.now();
    failContainerAttempt(attempt, session, nowMs);
    ACTIVE_ATTEMPTS.delete(key);
    emitHackingTurn(session, [
      buildEvent(HACKING_CONSTANTS.EVENT_GAME_LOST, {
        targetID: attempt.targetID || null,
      }),
    ]);
    maybeCompleteAttemptSite(attempt, session, nowMs);
    return null;
  }

  QuitHackingAttempt(session = null) {
    return this.Handle_QuitHackingAttempt([], session);
  }

  Handle_UsedUtilityElement(args = [], session = null) {
    normalizeCallArgs(args);
    emitHackingTurn(session, [buildEvent(HACKING_CONSTANTS.EVENT_ACK, {})]);
    return null;
  }

  UsedUtilityElement(index, tileCoord, session = null) {
    return this.Handle_UsedUtilityElement([index, tileCoord], session);
  }

  Handle_UsedUtilityElementOnVirus(args = [], session = null) {
    normalizeCallArgs(args);
    emitHackingTurn(session, [buildEvent(HACKING_CONSTANTS.EVENT_ACK, {})]);
    return null;
  }

  UsedUtilityElementOnVirus(index, session = null) {
    return this.Handle_UsedUtilityElementOnVirus([index], session);
  }
}

HackingMgrService._testing = {
  clearActiveAttempts() {
    ACTIVE_ATTEMPTS.clear();
  },
  constants: HACKING_CONSTANTS,
  getActiveAttemptCount() {
    return ACTIVE_ATTEMPTS.size;
  },
  resolveContainerTarget,
};

module.exports = HackingMgrService;
