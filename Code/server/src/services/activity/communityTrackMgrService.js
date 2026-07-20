const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

const VANGUARD_NEMESIS_INSTANCE_ID = 1337;
const VANGUARD_NEMESIS_DEFINITION_ID = 1;

const auditEvents = [];
const instanceAttributesByID = new Map();
let qaMode = false;

function toInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCharacterID(session = null) {
  return toInteger(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
    0,
  );
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, details = {}) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    characterID: getCharacterID(session) || null,
    details: { ...details },
    timestamp: Date.now(),
  });
}

function normalizeInstanceAttributes(attributes = null) {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const definitionID = toInteger(
    attributes.definitionID ??
      attributes.definitionId ??
      attributes.defID ??
      attributes.def_id,
    0,
  );
  const progress = toInteger(attributes.progress, 0);

  if (definitionID <= 0) {
    return null;
  }

  return {
    definitionID,
    progress: Math.max(0, progress),
  };
}

class CommunityTrackMgrService extends BaseService {
  constructor() {
    super("communityTrackMgr");
  }

  Handle_get_instance_attributes_public(args, session) {
    const instanceID = toInteger(args && args[0], 0);
    const attributes = normalizeInstanceAttributes(
      instanceAttributesByID.get(instanceID),
    );

    if (!attributes) {
      recordAuditEvent("community_track_instance_missing", args, session, {
        instanceID,
      });
      return [null, null];
    }

    recordAuditEvent("community_track_instance_returned", args, session, {
      instanceID,
      definitionID: attributes.definitionID,
      progress: attributes.progress,
    });
    return [attributes.definitionID, attributes.progress];
  }

  Handle_change_qa_mode(args, session) {
    qaMode = Boolean(args && args[0]);
    recordAuditEvent("community_track_qa_mode_changed", args, session, {
      qaMode,
    });
    log.debug(`[CommunityTrackMgr] QA mode set to ${qaMode ? "on" : "off"}`);
    return null;
  }
}

CommunityTrackMgrService._testing = {
  constants: {
    VANGUARD_NEMESIS_INSTANCE_ID,
    VANGUARD_NEMESIS_DEFINITION_ID,
  },
  getAuditEvents() {
    return auditEvents.map((entry) => ({
      ...entry,
      details: { ...(entry.details || {}) },
    }));
  },
  getQaMode() {
    return qaMode;
  },
  resetForTests() {
    auditEvents.length = 0;
    instanceAttributesByID.clear();
    qaMode = false;
  },
  setInstanceAttributes(instanceID, attributes) {
    const normalizedInstanceID = toInteger(instanceID, 0);
    if (normalizedInstanceID <= 0) {
      return;
    }
    const normalized = normalizeInstanceAttributes(attributes);
    if (normalized) {
      instanceAttributesByID.set(normalizedInstanceID, normalized);
    } else {
      instanceAttributesByID.delete(normalizedInstanceID);
    }
  },
};

module.exports = CommunityTrackMgrService;
