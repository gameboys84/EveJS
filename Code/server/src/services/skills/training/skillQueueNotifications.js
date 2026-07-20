const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../../chat/sessionRegistry"));
const {
  applyCharacterToSession,
  syncShipFittingStateForSession,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  buildFiletimeLong,
  currentFileTime,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  buildModuleAttributeChangeEvent,
  sendOnMultiEventPairs,
} = require(path.join(__dirname, "../../_shared/godmaMultiEvent"));
const {
  buildImplantAttributeChangePayloads,
} = require(path.join(__dirname, "../../dogma/implants/activeImplantModifiers"));
const {
  buildIndustryAttributeChangePayloads,
} = require(path.join(__dirname, "../../dogma/brain/providers/industryBrainProvider"));
const {
  syncCharacterDogmaBrain,
  syncCharacterDogmaState,
} = require(path.join(__dirname, "../../dogma/brain/characterBrainRuntime"));
const {
  recordRecentSkillPointChangesFromDiff,
} = require(path.join(__dirname, "../certificates/skillChangeTracker"));
const {
  buildCharacterSkillDict,
  buildCharacterSkillEntry,
} = require(path.join(__dirname, "../skillTransport"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function buildKeyVal(entries) {
  return {
    type: "object",
    name: "utillib.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSkillRecordTypeID(skillRecord) {
  return toInt(skillRecord && skillRecord.typeID, 0);
}

function dedupeSkillRecords(skillRecords = []) {
  const recordsByTypeID = new Map();
  for (const skillRecord of Array.isArray(skillRecords) ? skillRecords : []) {
    const typeID = normalizeSkillRecordTypeID(skillRecord);
    if (!typeID) {
      continue;
    }
    recordsByTypeID.set(typeID, cloneValue(skillRecord));
  }
  return [...recordsByTypeID.values()];
}

function buildSkillQueuePayload(entries = []) {
  return {
    type: "list",
    items: entries.map((entry) =>
      buildKeyVal([
        ["trainingStartSP", toInt(entry.trainingStartSP, 0)],
        ["queuePosition", toInt(entry.queuePosition, 0)],
        ["trainingTypeID", toInt(entry.trainingTypeID, 0)],
        ["trainingDestinationSP", toInt(entry.trainingDestinationSP, 0)],
        [
          "trainingEndTime",
          entry.trainingEndTime ? buildFiletimeLong(entry.trainingEndTime) : null,
        ],
        [
          "trainingStartTime",
          entry.trainingStartTime ? buildFiletimeLong(entry.trainingStartTime) : null,
        ],
        ["trainingToLevel", toInt(entry.trainingToLevel, 0)],
      ]),
    ),
  };
}

function buildSkillNotificationInfo(skillRecord, options = {}) {
  return buildCharacterSkillEntry(skillRecord, {
    includeMetadata: options.includeMetadata !== false,
  });
}

function buildSkillNotificationDict(skillRecords = [], options = {}) {
  return buildCharacterSkillDict(dedupeSkillRecords(skillRecords), {
    includeMetadata: options.includeMetadata !== false,
  });
}

function getSkillRecordFromPreviousMap(previousSkillMap, typeID) {
  if (previousSkillMap instanceof Map) {
    return previousSkillMap.get(typeID) || previousSkillMap.get(String(typeID)) || null;
  }
  if (previousSkillMap && typeof previousSkillMap === "object") {
    return previousSkillMap[typeID] || previousSkillMap[String(typeID)] || null;
  }
  return null;
}

function normalizeTrainedLevelPair(value, skillRecordsByTypeID = new Map()) {
  if (Array.isArray(value)) {
    const typeID = toInt(value[0], 0);
    const level = toInt(value[1], 0);
    return typeID > 0 && level > 0 ? [typeID, level] : null;
  }

  if (value && typeof value === "object") {
    const typeID = toInt(value.typeID ?? value.trainingTypeID ?? value.skillTypeID, 0);
    const level = toInt(
      value.trainedSkillLevel ?? value.skillLevel ?? value.level ?? value.toLevel,
      0,
    );
    return typeID > 0 && level > 0 ? [typeID, level] : null;
  }

  const typeID = toInt(value, 0);
  const skillRecord = skillRecordsByTypeID.get(typeID);
  const level = toInt(
    skillRecord && (skillRecord.trainedSkillLevel ?? skillRecord.skillLevel),
    0,
  );
  return typeID > 0 && level > 0 ? [typeID, level] : null;
}

function buildTrainedLevelPairs(changedSkills = [], options = {}) {
  const skillRecordsByTypeID = new Map(
    changedSkills.map((record) => [toInt(record.typeID, 0), record]),
  );
  const pairSource = Array.isArray(options.trainedLevelPairs)
    ? options.trainedLevelPairs
    : null;
  if (pairSource) {
    return pairSource
      .map((value) => normalizeTrainedLevelPair(value, skillRecordsByTypeID))
      .filter(Boolean);
  }

  if (Array.isArray(options.trainedTypeIDs)) {
    return options.trainedTypeIDs
      .map((typeID) => normalizeTrainedLevelPair(typeID, skillRecordsByTypeID))
      .filter(Boolean);
  }

  const pairs = [];
  for (const record of changedSkills) {
    const typeID = toInt(record && record.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    const nextLevel = toInt(record.trainedSkillLevel ?? record.skillLevel, 0);
    if (nextLevel <= 0) {
      continue;
    }
    const previousRecord = getSkillRecordFromPreviousMap(options.previousSkillMap, typeID);
    if (previousRecord) {
      const previousLevel = toInt(
        previousRecord.trainedSkillLevel ?? previousRecord.skillLevel,
        0,
      );
      if (nextLevel <= previousLevel) {
        continue;
      }
    }
    pairs.push([typeID, nextLevel]);
  }
  return pairs;
}

function buildRemovedSkillNotificationRecord(skillRecord) {
  if (!skillRecord || typeof skillRecord !== "object") {
    return null;
  }

  return {
    ...cloneValue(skillRecord),
    locationID: 0,
    flagID: 0,
    skillLevel: 0,
    trainedSkillLevel: 0,
    effectiveSkillLevel: 0,
    virtualSkillLevel: null,
    skillPoints: 0,
    trainedSkillPoints: 0,
    inTraining: false,
    trainingStartSP: 0,
    trainingDestinationSP: 0,
    trainingStartTime: null,
    trainingEndTime: null,
  };
}

function buildRemovedSkillServerRecord(skillRecord) {
  const notificationRecord = buildRemovedSkillNotificationRecord(skillRecord);
  if (!notificationRecord) {
    return null;
  }

  // The client skill service deletes cached skills when trained points go negative.
  notificationRecord.skillPoints = -1;
  notificationRecord.trainedSkillPoints = -1;
  return notificationRecord;
}

function getLiveCharacterSession(characterID) {
  return sessionRegistry.findSessionByCharacterID(characterID);
}

function buildMultiEventPairFromModuleAttributeChange(change) {
  if (!Array.isArray(change) || change.length < 8) {
    return null;
  }
  const time = change[4] ?? currentFileTime();
  return {
    event: buildModuleAttributeChangeEvent(
      change[1],
      change[2],
      change[3],
      change[5],
      change[6],
      time,
    ),
    time,
  };
}

function buildSkillMutationAttributeMultiEventPairs(session, characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  return [
    ...buildImplantAttributeChangePayloads(session, numericCharacterID),
    ...buildIndustryAttributeChangePayloads(session, numericCharacterID),
  ]
    .map(buildMultiEventPairFromModuleAttributeChange)
    .filter(Boolean);
}

function notifySkillDogmaBrainChanged(characterID, options = {}) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  return syncCharacterDogmaBrain(session, characterID, {
    idType: options.idType || "charid",
  });
}

function notifySkillDogmaAttributesChangedAsMultiEvent(characterID, options = {}) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  const send = () =>
    sendOnMultiEventPairs(
      session,
      buildSkillMutationAttributeMultiEventPairs(session, characterID),
    );

  if (options.defer === true) {
    setImmediate(send);
    return true;
  }

  return send();
}

function emitSkillSessionState(
  session,
  characterID,
  changedSkillRecords = [],
  options = {},
) {
  if (options.skipRecentSkillTracking !== true) {
    recordRecentSkillPointChangesFromDiff(
      characterID,
      changedSkillRecords,
      options.previousSkillMap,
    );
  }

  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return;
  }

  const changedSkills = dedupeSkillRecords(changedSkillRecords);
  const removedSkills = dedupeSkillRecords(options.removedSkillRecords);
  const hasSkillMutation = changedSkills.length > 0 || removedSkills.length > 0;
  const timeStamp = options.timeStamp || currentFileTime();

  if (hasSkillMutation) {
    applyCharacterToSession(session, numericCharacterID, {
      emitNotifications: false,
      logSelection: false,
      selectionEvent: false,
    });
  }

  const clientSkillChanges = [
    ...changedSkills,
    ...removedSkills
      .map((skillRecord) => buildRemovedSkillNotificationRecord(skillRecord))
      .filter(Boolean),
  ];

  if (changedSkills.length > 0) {
    session.sendNotification("OnServerSkillsChanged", "charid", [
      buildSkillNotificationDict(changedSkills, options),
      options.serverReason === undefined ? null : options.serverReason,
      buildFiletimeLong(timeStamp),
    ]);
  }

  if (removedSkills.length > 0) {
    session.sendNotification("OnServerSkillsRemoved", "clientID", [
      buildSkillNotificationDict(
        removedSkills
          .map((skillRecord) => buildRemovedSkillServerRecord(skillRecord))
          .filter(Boolean),
        options,
      ),
      buildFiletimeLong(timeStamp),
    ]);
  }

  if (clientSkillChanges.length > 0 && options.emitLocalSkillScatters !== false) {
    const trainedLevelPairs = buildTrainedLevelPairs(changedSkills, options);
    if (trainedLevelPairs.length > 0 && options.emitSkillLevelsTrained !== false) {
      session.sendNotification("OnSkillLevelsTrained", "clientID", [
        {
          type: "list",
          items: trainedLevelPairs,
        },
      ]);
    }
    session.sendNotification("OnSkillsChanged", "clientID", [
      buildSkillNotificationDict(clientSkillChanges, options),
    ]);
  }

  if (options.freeSkillPoints !== undefined) {
    session.sendNotification("OnFreeSkillPointsChanged", "charid", [
      Math.max(0, toInt(options.freeSkillPoints, 0)),
    ]);
  }

  if (options.queueEntries) {
    session.sendNotification("OnNewSkillQueueSaved", "charid", [
      buildSkillQueuePayload(options.queueEntries),
    ]);
  }

  if (options.emitQueuePaused === true) {
    session.sendNotification("OnSkillQueuePausedServer", "clientID", []);
  }

  if (hasSkillMutation && options.syncDogmaState !== false) {
    const activeShipID = toInt(
      session.activeShipID || session.shipID || session.shipid,
      0,
    );
    if (activeShipID > 0 && options.syncShipFittingState !== false) {
      syncShipFittingStateForSession(session, activeShipID, {
        includeOfflineModules: true,
        includeCharges: true,
        emitChargeInventoryRows: true,
        emitOnlineEffects: true,
      });
    }
    syncCharacterDogmaState(session, numericCharacterID);
  }
}

function notifySkillQueueSaved(characterID, queueEntries = []) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnNewSkillQueueSaved", "charid", [
    buildSkillQueuePayload(queueEntries),
  ]);
}

function notifySkillQueuePaused(characterID) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnSkillQueuePausedServer", "clientID", []);
}

function notifyFreeSkillPointsChanged(characterID, newFreeSkillPoints) {
  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnFreeSkillPointsChanged", "charid", [
    toInt(newFreeSkillPoints, 0),
  ]);
}

function notifyMultipleCharacterTrainingUpdated(accountID) {
  const numericAccountID = toInt(accountID, 0);
  if (numericAccountID <= 0) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (toInt(session && session.userid, 0) !== numericAccountID) {
      continue;
    }
    if (typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnMultipleCharactersTrainingUpdated", "userid", []);
  }
}

function notifySkillStateChanged(characterID, changedSkillRecords = [], options = {}) {
  recordRecentSkillPointChangesFromDiff(
    characterID,
    changedSkillRecords,
    options.previousSkillMap,
  );

  const session = getLiveCharacterSession(characterID);
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  emitSkillSessionState(session, characterID, changedSkillRecords, {
    ...options,
    skipRecentSkillTracking: true,
  });
}

module.exports = {
  buildSkillNotificationDict,
  buildSkillQueuePayload,
  emitSkillSessionState,
  getLiveCharacterSession,
  notifySkillDogmaAttributesChangedAsMultiEvent,
  notifySkillDogmaBrainChanged,
  notifyFreeSkillPointsChanged,
  notifyMultipleCharacterTrainingUpdated,
  notifySkillQueuePaused,
  notifySkillQueueSaved,
  notifySkillStateChanged,
};
