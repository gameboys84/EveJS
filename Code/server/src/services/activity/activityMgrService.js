const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildList,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const DEFAULT_POP_STATE = 1;

const auditEvents = [];
const stateByCharacterID = new Map();

function toInt(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function getCharacterID(session = null) {
  return toInt(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
    0,
  );
}

function cloneArgs(args = []) {
  return Array.isArray(args)
    ? args.map((entry) => unwrapMarshalValue(entry))
    : [];
}

function recordAuditEvent(kind, args = [], session = null, details = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
    details: { ...details },
  });
}

function normalizeActivityID(value) {
  const activityID = toInt(value, 0);
  return activityID > 0 ? activityID : 0;
}

function normalizePopState(value) {
  return toInt(value, DEFAULT_POP_STATE) === 0 ? 0 : 1;
}

function createCharacterState() {
  return {
    popState: DEFAULT_POP_STATE,
    seenActivityIDs: new Set(),
  };
}

function getCharacterState(characterID) {
  const stateKey = toInt(characterID, 0);
  if (!stateByCharacterID.has(stateKey)) {
    stateByCharacterID.set(stateKey, createCharacterState());
  }
  return stateByCharacterID.get(stateKey);
}

function getSessionState(session = null) {
  return getCharacterState(getCharacterID(session));
}

function serializeState(state) {
  return {
    popState: normalizePopState(state && state.popState),
    seenActivityIDs: [...(state && state.seenActivityIDs || [])]
      .sort((left, right) => left - right),
  };
}

function sendSystemActivityUpdated(session) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  session.sendNotification("OnSystemActivityUpdated", "None", []);
  return true;
}

class ActivityMgrService extends BaseService {
  constructor() {
    super("activityMgr");
  }

  Handle_GetActivityBadgeStatuses(args, session) {
    const state = getSessionState(session);
    const seenActivityIDs = [...state.seenActivityIDs]
      .sort((left, right) => left - right);
    recordAuditEvent("get_activity_badge_statuses", args, session, {
      seenActivityIDs,
    });
    sendSystemActivityUpdated(session);
    return buildList(seenActivityIDs);
  }

  Handle_ActivitySeen(args, session) {
    const activityID = normalizeActivityID(args && args[0]);
    if (activityID <= 0) {
      recordAuditEvent("activity_seen_rejected", args, session, {
        activityID,
      });
      return false;
    }

    const state = getSessionState(session);
    state.seenActivityIDs.add(activityID);
    recordAuditEvent("activity_seen", args, session, {
      activityID,
    });
    return true;
  }

  Handle_GetActivitiesPopState(args, session) {
    const state = getSessionState(session);
    const popState = normalizePopState(state.popState);
    recordAuditEvent("get_activities_pop_state", args, session, {
      popState,
    });
    return popState;
  }

  Handle_SetActivitiesPopState(args, session) {
    const state = getSessionState(session);
    const popState = normalizePopState(args && args[0]);
    state.popState = popState;
    recordAuditEvent("set_activities_pop_state", args, session, {
      popState,
    });
    return true;
  }
}

ActivityMgrService._testing = {
  constants: {
    DEFAULT_POP_STATE,
  },
  getAuditEvents() {
    return auditEvents.map((event) => ({
      ...event,
      details: { ...(event.details || {}) },
    }));
  },
  getCharacterState(characterID) {
    return serializeState(getCharacterState(characterID));
  },
  resetForTests() {
    auditEvents.length = 0;
    stateByCharacterID.clear();
  },
  setCharacterState(characterID, state = {}) {
    const targetState = createCharacterState();
    targetState.popState = normalizePopState(state.popState);
    for (const activityID of Array.isArray(state.seenActivityIDs)
      ? state.seenActivityIDs
      : []) {
      const normalizedActivityID = normalizeActivityID(activityID);
      if (normalizedActivityID > 0) {
        targetState.seenActivityIDs.add(normalizedActivityID);
      }
    }
    stateByCharacterID.set(toInt(characterID, 0), targetState);
  },
  sendSystemActivityUpdated,
};

module.exports = ActivityMgrService;
