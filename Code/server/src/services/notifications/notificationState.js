const path = require("path");

// Phase 0 / 0.C pilot: this domain reaches gameStore through an ownership-scoped
// repository instead of the raw store. In strict mode a write to any table this
// service does not own throws immediately; it owns only `notifications`. Reads
// (incl. the cross-domain `characters` read) pass through unrestricted.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:notifications", { strict: true });
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "./notificationConstants"));

const NOTIFICATIONS_TABLE = "notifications";

function currentFileTimeString() {
  return (BigInt(Date.now()) * 10000n + 116444736000000000n).toString();
}

function toPositiveInteger(value, fallback = 0) {
  const numericValue = Math.trunc(normalizeNumber(value, fallback));
  return numericValue > 0 ? numericValue : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultState() {
  return {
    _meta: {
      nextNotificationID: 1,
    },
    boxes: {},
  };
}

function getCharactersTable() {
  const result = repo.read("characters", "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function resolveCharacterName(characterID) {
  const characters = getCharactersTable();
  const record = characters[String(characterID)];
  return record && record.characterName
    ? String(record.characterName)
    : `Character ${characterID}`;
}

function normalizeNotificationData(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeNotificationData(entry));
  }

  if (value && typeof value === "object") {
    return cloneValue(value);
  }

  return String(value);
}

function ensureNotificationShape(record, notificationID, receiverID) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const normalizedNotificationID = toPositiveInteger(
    record.notificationID || notificationID,
    0,
  );
  const normalizedReceiverID = toPositiveInteger(
    record.receiverID || receiverID,
    0,
  );
  if (normalizedNotificationID <= 0 || normalizedReceiverID <= 0) {
    return null;
  }

  record.notificationID = normalizedNotificationID;
  record.typeID = toPositiveInteger(record.typeID, 0);
  record.senderID = Math.trunc(normalizeNumber(record.senderID, 0));
  record.receiverID = normalizedReceiverID;
  record.processed = record.processed === true;
  record.created = normalizeText(record.created, "") || currentFileTimeString();
  record.groupID =
    record.groupID == null ? null : toPositiveInteger(record.groupID, 0) || null;
  record.data = normalizeNotificationData(record.data);
  return record;
}

function ensureNotificationBox(state, characterID) {
  const key = String(toPositiveInteger(characterID, 0));
  if (!state.boxes[key] || typeof state.boxes[key] !== "object") {
    state.boxes[key] = {
      byID: {},
      order: [],
    };
  }

  const box = state.boxes[key];
  if (!box.byID || typeof box.byID !== "object") {
    box.byID = {};
  }
  if (!Array.isArray(box.order)) {
    box.order = [];
  }

  const dedupedOrder = [];
  const seenIDs = new Set();
  for (const notificationID of box.order) {
    const numericNotificationID = toPositiveInteger(notificationID, 0);
    if (!numericNotificationID || seenIDs.has(numericNotificationID)) {
      continue;
    }
    const normalizedRecord = ensureNotificationShape(
      box.byID[String(numericNotificationID)],
      numericNotificationID,
      key,
    );
    if (!normalizedRecord) {
      delete box.byID[String(numericNotificationID)];
      continue;
    }
    box.byID[String(numericNotificationID)] = normalizedRecord;
    dedupedOrder.push(numericNotificationID);
    seenIDs.add(numericNotificationID);
  }

  for (const [notificationID, record] of Object.entries(box.byID)) {
    const normalizedRecord = ensureNotificationShape(record, notificationID, key);
    if (!normalizedRecord) {
      delete box.byID[notificationID];
      continue;
    }
    const numericNotificationID = normalizedRecord.notificationID;
    box.byID[String(numericNotificationID)] = normalizedRecord;
    if (!seenIDs.has(numericNotificationID)) {
      dedupedOrder.push(numericNotificationID);
      seenIDs.add(numericNotificationID);
    }
  }

  dedupedOrder.sort((left, right) => right - left);
  box.order = dedupedOrder;
  return box;
}

function getMutableState() {
  const result = repo.read(NOTIFICATIONS_TABLE, "/");
  let state =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : null;

  if (!state) {
    state = createDefaultState();
    repo.write(NOTIFICATIONS_TABLE, "/", state);
    return state;
  }

  let mutated = false;
  if (!state._meta || typeof state._meta !== "object") {
    state._meta = { nextNotificationID: 1 };
    mutated = true;
  }
  const nextNotificationID = toPositiveInteger(state._meta.nextNotificationID, 1);
  if (nextNotificationID !== state._meta.nextNotificationID) {
    state._meta.nextNotificationID = nextNotificationID;
    mutated = true;
  }
  if (!state.boxes || typeof state.boxes !== "object") {
    state.boxes = {};
    mutated = true;
  }

  for (const characterID of Object.keys(state.boxes)) {
    const before = JSON.stringify(state.boxes[characterID]);
    ensureNotificationBox(state, characterID);
    if (JSON.stringify(state.boxes[characterID]) !== before) {
      mutated = true;
    }
  }

  if (mutated) {
    repo.write(NOTIFICATIONS_TABLE, "/", state);
  }
  return state;
}

function persistState(state) {
  return repo.write(NOTIFICATIONS_TABLE, "/", state);
}

function allocateNotificationID(state) {
  const nextNotificationID = toPositiveInteger(state._meta.nextNotificationID, 1);
  state._meta.nextNotificationID = nextNotificationID + 1;
  return nextNotificationID;
}

function marshalNotificationValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return buildFiletimeLong(value);
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return buildList(value.map((entry) => marshalNotificationValue(entry)));
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "type")) {
      return value;
    }

    return buildDict(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        marshalNotificationValue(entryValue),
      ]),
    );
  }

  return String(value);
}

function buildNewMailNotificationDataPayload(data) {
  const source = data && typeof data === "object" ? data : {};
  const msg = source.msg && typeof source.msg === "object" ? source.msg : {};

  return buildDict([
    ["senderName", normalizeText(source.senderName, "")],
    ["subject", normalizeText(source.subject, "")],
    [
      "msg",
      buildKeyVal([
        ["messageID", toPositiveInteger(msg.messageID, 0)],
        ["senderID", Math.trunc(normalizeNumber(msg.senderID, 0))],
        ["senderName", normalizeText(msg.senderName, normalizeText(source.senderName, ""))],
        ["sentDate", buildFiletimeLong(msg.sentDate || currentFileTimeString())],
        [
          "toCharacterIDs",
          buildList(
            (Array.isArray(msg.toCharacterIDs) ? msg.toCharacterIDs : [])
              .map((entry) => toPositiveInteger(entry, 0))
              .filter((entry) => entry > 0),
          ),
        ],
        ["toListID", msg.toListID == null ? null : toPositiveInteger(msg.toListID, 0) || null],
        [
          "toCorpOrAllianceID",
          msg.toCorpOrAllianceID == null
            ? null
            : toPositiveInteger(msg.toCorpOrAllianceID, 0) || null,
        ],
        ["subject", normalizeText(msg.subject, normalizeText(source.subject, ""))],
        ["statusMask", Math.max(0, Math.trunc(normalizeNumber(msg.statusMask, 0)))],
        ["labelMask", Math.max(0, Math.trunc(normalizeNumber(msg.labelMask, 0)))],
        ["read", msg.read === true],
        ["trashed", msg.trashed === true],
        ["replied", msg.replied === true],
        ["forwarded", msg.forwarded === true],
      ]),
    ],
  ]);
}

function buildNotificationDataPayload(record) {
  if (!record || typeof record !== "object") {
    return buildDict([]);
  }

  if (toPositiveInteger(record.typeID, 0) === NOTIFICATION_TYPE.NEW_MAIL_FROM) {
    return buildNewMailNotificationDataPayload(record.data);
  }

  return marshalNotificationValue(record.data);
}

function hasNotificationDataPayload(dataPayload) {
  if (dataPayload === null || dataPayload === undefined) {
    return false;
  }
  if (
    dataPayload &&
    dataPayload.type === "dict" &&
    Array.isArray(dataPayload.entries) &&
    dataPayload.entries.length === 0
  ) {
    return false;
  }
  if (
    dataPayload &&
    dataPayload.type === "list" &&
    Array.isArray(dataPayload.items) &&
    dataPayload.items.length === 0
  ) {
    return false;
  }
  return true;
}

function buildNotificationDTO(record) {
  return buildKeyVal([
    ["notificationID", toPositiveInteger(record && record.notificationID, 0)],
    ["typeID", toPositiveInteger(record && record.typeID, 0)],
    ["senderID", Math.trunc(normalizeNumber(record && record.senderID, 0))],
    ["receiverID", toPositiveInteger(record && record.receiverID, 0)],
    ["processed", record && record.processed === true],
    ["created", buildFiletimeLong(record && record.created ? record.created : currentFileTimeString())],
    ["data", buildNotificationDataPayload(record)],
  ]);
}

function listNotifications(characterID, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return [];
  }

  const state = getMutableState();
  const box = ensureNotificationBox(state, numericCharacterID);
  const fromID = toPositiveInteger(options.fromID, 0);
  const groupID =
    options.groupID == null ? null : toPositiveInteger(options.groupID, 0) || null;
  const processed =
    typeof options.processed === "boolean" ? options.processed : null;

  const results = [];
  for (const notificationID of box.order) {
    if (fromID > 0 && notificationID <= fromID) {
      continue;
    }
    const record = box.byID[String(notificationID)];
    if (!record || typeof record !== "object") {
      continue;
    }
    if (groupID != null && toPositiveInteger(record.groupID, 0) !== groupID) {
      continue;
    }
    if (processed != null && Boolean(record.processed) !== processed) {
      continue;
    }
    results.push(record);
  }

  return results;
}

function getAllNotifications(characterID, options = {}) {
  return listNotifications(characterID, {
    fromID: options.fromID,
  }).map((record) => buildNotificationDTO(record));
}

function getNotificationsByGroupID(characterID, groupID) {
  return listNotifications(characterID, {
    groupID,
  }).map((record) => buildNotificationDTO(record));
}

function getUnprocessedNotifications(characterID) {
  return listNotifications(characterID, {
    processed: false,
  }).map((record) => buildNotificationDTO(record));
}

function getUnprocessedNotificationCount(characterID) {
  return listNotifications(characterID, {
    processed: false,
  }).length;
}

function getCharacterSessions(characterID, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const excludedSession = options.excludeSession || null;
  if (numericCharacterID <= 0) {
    return [];
  }

  const sessions = [];
  const seen = new Set();
  const addSession = (session) => {
    if (!session || session === excludedSession) {
      return;
    }
    const sessionCharacterID = toPositiveInteger(
      session.characterID || session.charID || session.charid,
      0,
    );
    if (
      sessionCharacterID !== numericCharacterID ||
      seen.has(session) ||
      (session.socket && session.socket.destroyed)
    ) {
      return;
    }
    seen.add(session);
    sessions.push(session);
  };

  for (const session of sessionRegistry.getSessions()) {
    addSession(session);
  }
  for (const session of Array.isArray(options.extraSessions) ? options.extraSessions : []) {
    addSession(session);
  }

  return sessions;
}

function sendNotificationReceivedEvent(record, options = {}) {
  if (!record || typeof record !== "object") {
    return;
  }

  for (const session of getCharacterSessions(record.receiverID, options)) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    const payload = [
      toPositiveInteger(record.notificationID, 0),
      toPositiveInteger(record.typeID, 0),
      Math.trunc(normalizeNumber(record.senderID, 0)),
      buildFiletimeLong(record.created || currentFileTimeString()),
    ];
    const dataPayload = buildNotificationDataPayload(record);
    if (hasNotificationDataPayload(dataPayload)) {
      payload.push(dataPayload);
    }
    session.sendNotification("OnNotificationReceived", "clientID", payload);
  }
}

function sendNotificationDeletedEvent(characterID, notificationIDs, options = {}) {
  const normalizedIDs = (Array.isArray(notificationIDs) ? notificationIDs : [])
    .map((notificationID) => toPositiveInteger(notificationID, 0))
    .filter((notificationID) => notificationID > 0);
  if (normalizedIDs.length === 0) {
    return;
  }

  for (const session of getCharacterSessions(characterID, options)) {
    if (!session || typeof session.sendNotification !== "function") {
      continue;
    }
    session.sendNotification("OnNotificationDeleted", "clientID", [
      normalizedIDs,
    ]);
  }
}

function updateNewMailNotificationMessageState(characterID, updatesByMessageID = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0 || !updatesByMessageID || typeof updatesByMessageID !== "object") {
    return { success: false, mutated: false, changedNotificationIDs: [] };
  }

  const updates = new Map(
    Object.entries(updatesByMessageID)
      .map(([messageID, update]) => [
        toPositiveInteger(messageID, 0),
        update && typeof update === "object" ? update : null,
      ])
      .filter(([messageID, update]) => messageID > 0 && update),
  );
  if (updates.size === 0) {
    return { success: true, mutated: false, changedNotificationIDs: [] };
  }

  const state = getMutableState();
  const box = ensureNotificationBox(state, numericCharacterID);
  let mutated = false;
  const changedNotificationIDs = [];

  for (const record of Object.values(box.byID || {})) {
    if (toPositiveInteger(record && record.typeID, 0) !== NOTIFICATION_TYPE.NEW_MAIL_FROM) {
      continue;
    }
    const data = record.data && typeof record.data === "object" ? record.data : null;
    const msg = data && data.msg && typeof data.msg === "object" ? data.msg : null;
    const messageID = toPositiveInteger(msg && msg.messageID, 0);
    const update = updates.get(messageID);
    if (!msg || !update) {
      continue;
    }

    const before = JSON.stringify(msg);
    if (Object.prototype.hasOwnProperty.call(update, "statusMask")) {
      msg.statusMask = Math.max(0, Math.trunc(normalizeNumber(update.statusMask, 0)));
    }
    if (Object.prototype.hasOwnProperty.call(update, "labelMask")) {
      msg.labelMask = Math.max(0, Math.trunc(normalizeNumber(update.labelMask, 0)));
    }
    if (Object.prototype.hasOwnProperty.call(update, "read")) {
      msg.read = update.read === true;
    }
    if (Object.prototype.hasOwnProperty.call(update, "trashed")) {
      msg.trashed = update.trashed === true;
    }
    if (Object.prototype.hasOwnProperty.call(update, "replied")) {
      msg.replied = update.replied === true;
    }
    if (Object.prototype.hasOwnProperty.call(update, "forwarded")) {
      msg.forwarded = update.forwarded === true;
    }

    if (JSON.stringify(msg) !== before) {
      mutated = true;
      changedNotificationIDs.push(toPositiveInteger(record.notificationID, 0));
    }
  }

  if (mutated) {
    persistState(state);
  }
  return { success: true, mutated, changedNotificationIDs };
}

function deleteNewMailNotificationsForMessages(characterID, messageIDs = []) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const messageIDSet = new Set(
    (Array.isArray(messageIDs) ? messageIDs : [])
      .map((messageID) => toPositiveInteger(messageID, 0))
      .filter((messageID) => messageID > 0),
  );
  if (numericCharacterID <= 0 || messageIDSet.size === 0) {
    return { success: false, mutated: false, deletedNotificationIDs: [] };
  }

  const state = getMutableState();
  const box = ensureNotificationBox(state, numericCharacterID);
  let mutated = false;
  const deletedNotificationIDs = [];

  for (const [notificationID, record] of Object.entries(box.byID || {})) {
    if (toPositiveInteger(record && record.typeID, 0) !== NOTIFICATION_TYPE.NEW_MAIL_FROM) {
      continue;
    }
    const msg =
      record.data &&
      typeof record.data === "object" &&
      record.data.msg &&
      typeof record.data.msg === "object"
        ? record.data.msg
        : null;
    if (!messageIDSet.has(toPositiveInteger(msg && msg.messageID, 0))) {
      continue;
    }
    delete box.byID[notificationID];
    deletedNotificationIDs.push(toPositiveInteger(notificationID, 0));
    mutated = true;
  }

  if (mutated) {
    const deletedSet = new Set(deletedNotificationIDs);
    box.order = (Array.isArray(box.order) ? box.order : [])
      .map((notificationID) => toPositiveInteger(notificationID, 0))
      .filter((notificationID) => notificationID > 0 && !deletedSet.has(notificationID));
    persistState(state);
  }
  return { success: true, mutated, deletedNotificationIDs };
}

function createNotification(characterID, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  const typeID = toPositiveInteger(options.typeID, 0);
  if (numericCharacterID <= 0 || typeID <= 0) {
    return { success: false, errorMsg: "INVALID_NOTIFICATION" };
  }

  const state = getMutableState();
  const box = ensureNotificationBox(state, numericCharacterID);
  const notificationID = allocateNotificationID(state);
  const record = ensureNotificationShape({
    notificationID,
    typeID,
    senderID: Math.trunc(normalizeNumber(options.senderID, 0)),
    receiverID: numericCharacterID,
    processed: options.processed === true,
    created: normalizeText(options.created, "") || currentFileTimeString(),
    groupID:
      options.groupID == null
        ? null
        : toPositiveInteger(options.groupID, 0) || null,
    data: options.data,
  }, notificationID, numericCharacterID);

  box.byID[String(notificationID)] = record;
  if (!box.order.includes(notificationID)) {
    box.order.unshift(notificationID);
  }

  const writeResult = persistState(state);
  if (!writeResult || !writeResult.success) {
    return { success: false, errorMsg: "WRITE_ERROR" };
  }

  if (options.emitLive !== false) {
    sendNotificationReceivedEvent(record, {
      excludeSession: options.excludeSession || null,
      extraSessions: options.extraSessions || [],
    });
  }

  return {
    success: true,
    notificationID,
    record: buildNotificationDTO(record),
  };
}

function mutateProcessed(characterID, notificationIDs, processed) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const normalizedIDs = [...new Set(
    (Array.isArray(notificationIDs) ? notificationIDs : [])
      .map((notificationID) => toPositiveInteger(notificationID, 0))
      .filter((notificationID) => notificationID > 0),
  )];
  if (normalizedIDs.length === 0) {
    return { success: true, changedNotificationIDs: [] };
  }

  const state = getMutableState();
  const box = ensureNotificationBox(state, numericCharacterID);
  const changedNotificationIDs = [];
  for (const notificationID of normalizedIDs) {
    const record = box.byID[String(notificationID)];
    if (!record || record.processed === processed) {
      continue;
    }
    record.processed = processed;
    changedNotificationIDs.push(notificationID);
  }

  if (changedNotificationIDs.length === 0) {
    return { success: true, changedNotificationIDs: [] };
  }

  const writeResult = persistState(state);
  if (!writeResult || !writeResult.success) {
    return { success: false, errorMsg: "WRITE_ERROR" };
  }

  return { success: true, changedNotificationIDs };
}

function markAsProcessed(characterID, notificationIDs) {
  return mutateProcessed(characterID, notificationIDs, true);
}

function markGroupAsProcessed(characterID, groupID) {
  const records = listNotifications(characterID, { groupID, processed: false });
  return markAsProcessed(
    characterID,
    records.map((record) => record.notificationID),
  );
}

function markAllAsProcessed(characterID) {
  const records = listNotifications(characterID, { processed: false });
  return markAsProcessed(
    characterID,
    records.map((record) => record.notificationID),
  );
}

function deleteNotificationIDs(characterID, notificationIDs, options = {}) {
  const numericCharacterID = toPositiveInteger(characterID, 0);
  if (numericCharacterID <= 0) {
    return { success: false, errorMsg: "INVALID_CHARACTER" };
  }

  const normalizedIDs = [...new Set(
    (Array.isArray(notificationIDs) ? notificationIDs : [])
      .map((notificationID) => toPositiveInteger(notificationID, 0))
      .filter((notificationID) => notificationID > 0),
  )];
  if (normalizedIDs.length === 0) {
    return { success: true, changedNotificationIDs: [] };
  }

  const state = getMutableState();
  const box = ensureNotificationBox(state, numericCharacterID);
  const changedNotificationIDs = [];
  for (const notificationID of normalizedIDs) {
    if (!box.byID[String(notificationID)]) {
      continue;
    }
    delete box.byID[String(notificationID)];
    changedNotificationIDs.push(notificationID);
  }

  if (changedNotificationIDs.length === 0) {
    return { success: true, changedNotificationIDs: [] };
  }

  box.order = box.order.filter(
    (notificationID) => !changedNotificationIDs.includes(notificationID),
  );

  const writeResult = persistState(state);
  if (!writeResult || !writeResult.success) {
    return { success: false, errorMsg: "WRITE_ERROR" };
  }

  if (options.emitLive !== false) {
    sendNotificationDeletedEvent(numericCharacterID, changedNotificationIDs, {
      excludeSession: options.excludeSession || null,
    });
  }

  return { success: true, changedNotificationIDs };
}

function deleteNotifications(characterID, notificationIDs, options = {}) {
  return deleteNotificationIDs(characterID, notificationIDs, options);
}

function deleteGroupNotifications(characterID, groupID, options = {}) {
  const records = listNotifications(characterID, { groupID });
  return deleteNotificationIDs(
    characterID,
    records.map((record) => record.notificationID),
    options,
  );
}

function deleteAllNotifications(characterID, options = {}) {
  const records = listNotifications(characterID, {});
  return deleteNotificationIDs(
    characterID,
    records.map((record) => record.notificationID),
    options,
  );
}

function logNotificationInteraction() {
  return null;
}

function resolveMailNotificationSenderName(data = {}) {
  const senderID = Math.trunc(normalizeNumber(data.senderID, 0));
  if (senderID > 0) {
    const corporationRecord = getCorporationRecord(senderID);
    if (corporationRecord && corporationRecord.corporationName) {
      return corporationRecord.corporationName;
    }
    const allianceRecord = getAllianceRecord(senderID);
    if (allianceRecord && allianceRecord.allianceName) {
      return allianceRecord.allianceName;
    }
    return resolveCharacterName(senderID);
  }

  return normalizeText(data.senderName, "Unknown Sender");
}

function createNewMailNotification(characterID, data = {}, options = {}) {
  const senderName =
    normalizeText(data.senderName, "") || resolveMailNotificationSenderName(data);
  const messageData = data.msg && typeof data.msg === "object" ? data.msg : {};

  return createNotification(characterID, {
    typeID: NOTIFICATION_TYPE.NEW_MAIL_FROM,
    senderID: Math.trunc(normalizeNumber(data.senderID, 0)),
    groupID: NOTIFICATION_GROUP.MISC,
    processed: false,
    created: normalizeText(data.sentDate, "") || currentFileTimeString(),
    data: {
      senderName,
      subject: normalizeText(data.subject, ""),
      msg: {
        messageID: toPositiveInteger(messageData.messageID, 0),
        senderID: Math.trunc(normalizeNumber(messageData.senderID, 0)),
        senderName,
        sentDate:
          normalizeText(messageData.sentDate, "") ||
          normalizeText(data.sentDate, "") ||
          currentFileTimeString(),
        toCharacterIDs: Array.isArray(messageData.toCharacterIDs)
          ? messageData.toCharacterIDs.map((entry) => toPositiveInteger(entry, 0)).filter((entry) => entry > 0)
          : [],
        toListID:
          messageData.toListID == null
            ? null
            : toPositiveInteger(messageData.toListID, 0) || null,
        toCorpOrAllianceID:
          messageData.toCorpOrAllianceID == null
            ? null
            : toPositiveInteger(messageData.toCorpOrAllianceID, 0) || null,
        subject: normalizeText(messageData.subject, normalizeText(data.subject, "")),
        statusMask: Math.max(0, Math.trunc(normalizeNumber(messageData.statusMask, 0))),
        labelMask: Math.max(0, Math.trunc(normalizeNumber(messageData.labelMask, 0))),
        read: messageData.read === true,
        trashed: messageData.trashed === true,
        replied: messageData.replied === true,
        forwarded: messageData.forwarded === true,
      },
    },
    emitLive: options.emitLive === true,
    excludeSession: options.excludeSession || null,
  });
}

module.exports = {
  NOTIFICATIONS_TABLE,
  createNewMailNotification,
  createNotification,
  deleteAllNotifications,
  deleteGroupNotifications,
  deleteNewMailNotificationsForMessages,
  deleteNotifications,
  getAllNotifications,
  getNotificationsByGroupID,
  getUnprocessedNotificationCount,
  getUnprocessedNotifications,
  logNotificationInteraction,
  markAllAsProcessed,
  markAsProcessed,
  markGroupAsProcessed,
  updateNewMailNotificationMessageState,
};
