"use strict";

const path = require("path");

const gameStore = require(path.join(__dirname, "../../gameStore"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getQueueSnapshot,
  normalizeQueueInput,
  saveQueue,
} = require(path.join(
  __dirname,
  "../../services/skills/training/skillQueueRuntime",
));
const {
  resolveCharacterAccountID,
} = require(path.join(__dirname, "../../services/newEdenStore/storeState"));
const {
  restartExtractorsForCharacter,
} = require(path.join(__dirname, "../../services/planet/planetRuntimeStore"));
const {
  isCharacterOnline,
} = require(path.join(__dirname, "../../services/online/onlineStatusRuntime"));
const {
  marketDaemonClient,
} = require(path.join(__dirname, "../../services/market/marketDaemonClient"));

const BRIDGE_PREFIX = "/_evejs-web";
const BRIDGE_TOKEN_HEADER = "x-evejs-web-token";

const SNAPSHOT_ITEM_LIMIT = 20000;

function getBridgeToken() {
  return String(process.env.EVEJS_WEB_BRIDGE_TOKEN || "").trim();
}

function normalizeAddress(address) {
  const value = String(address || "").trim().toLowerCase();
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function isLoopbackAddress(address) {
  const normalized = normalizeAddress(address);
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  );
}

function readBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authorization.slice("bearer ".length).trim();
}

function authorizeBridgeRequest(req) {
  const configuredToken = getBridgeToken();
  if (configuredToken) {
    const suppliedToken =
      String(req.headers[BRIDGE_TOKEN_HEADER] || "").trim() ||
      readBearerToken(req);
    return suppliedToken === configuredToken;
  }

  return isLoopbackAddress(req.socket && req.socket.remoteAddress);
}

function sanitizeQueueEntry(entry) {
  return {
    queuePosition: Number(entry && entry.queuePosition) || 0,
    trainingTypeID: Number(entry && entry.trainingTypeID) || 0,
    trainingToLevel: Number(entry && entry.trainingToLevel) || 0,
    trainingStartSP: Number(entry && entry.trainingStartSP) || 0,
    trainingDestinationSP:
      Number(entry && entry.trainingDestinationSP) || 0,
    trainingStartTime: entry && entry.trainingStartTime
      ? String(entry.trainingStartTime)
      : null,
    trainingEndTime: entry && entry.trainingEndTime
      ? String(entry.trainingEndTime)
      : null,
    skillPointsPerMinute:
      Number(entry && entry.skillPointsPerMinute) || 0,
  };
}

function sanitizeQueueSnapshot(snapshot) {
  const queueEntries = Array.isArray(snapshot && snapshot.queueEntries)
    ? snapshot.queueEntries.map(sanitizeQueueEntry)
    : [];
  const currentEntry = snapshot && snapshot.currentEntry
    ? sanitizeQueueEntry(snapshot.currentEntry)
    : null;

  return {
    characterID: Number(snapshot && snapshot.characterID) || 0,
    accountID: Number(snapshot && snapshot.accountID) || 0,
    active: Boolean(snapshot && snapshot.active),
    queueEntries,
    queueEndTime: snapshot && snapshot.queueEndTime
      ? String(snapshot.queueEndTime)
      : null,
    currentEntry,
    freeSkillPoints: Math.max(
      0,
      Number(snapshot && snapshot.freeSkillPoints) || 0,
    ),
  };
}

function cloneValue(value) {
  return value === undefined || value === null
    ? value
    : JSON.parse(JSON.stringify(value));
}

function readRootTable(table) {
  const result = gameStore.read(table, "/");
  return result.success && result.data && typeof result.data === "object"
    ? result.data
    : {};
}

function readTableEntry(table, key) {
  const result = gameStore.read(table, `/${key}`);
  return result.success ? result.data : null;
}

function normalizeAccountRecord(username, record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const accountID = Number(record.id || record.accountID || 0);
  if (!accountID) {
    return null;
  }
  return {
    username: String(username || record.username || ""),
    accountID,
    role: String(record.role || "0"),
    chatRole: String(record.chatRole || record.role || "0"),
    banned: record.banned === true,
  };
}

function listAccountRecords() {
  return Object.entries(readRootTable("accounts"))
    .map(([username, record]) => normalizeAccountRecord(username, record))
    .filter(Boolean)
    .sort((left, right) => left.username.localeCompare(right.username));
}

function getAccountByUsername(username) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    return null;
  }
  return normalizeAccountRecord(
    normalizedUsername,
    readTableEntry("accounts", normalizedUsername),
  );
}

function getAccountByID(accountID) {
  const numericAccountID = Number(accountID || 0);
  if (!numericAccountID) {
    return null;
  }
  return listAccountRecords().find((account) => account.accountID === numericAccountID) || null;
}

function normalizeCharacterRecord(characterID, record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const numericCharacterID = Number(characterID || record.characterID || record.charID || 0);
  const accountID = Number(record.accountId || record.accountID || record.userid || 0);
  if (!numericCharacterID || !accountID) {
    return null;
  }
  return {
    key: String(numericCharacterID),
    value: {
      ...cloneValue(record),
      characterID: numericCharacterID,
    },
    accountID,
    characterID: numericCharacterID,
    characterName: String(record.characterName || `Character ${numericCharacterID}`),
  };
}

function listCharacterRecordsForAccount(accountID) {
  const numericAccountID = Number(accountID || 0);
  if (!numericAccountID) {
    return [];
  }
  return Object.entries(readRootTable("characters"))
    .map(([characterID, record]) => normalizeCharacterRecord(characterID, record))
    .filter((entry) => entry && entry.accountID === numericAccountID)
    .sort((left, right) => left.characterName.localeCompare(right.characterName));
}

function getOwnedCharacter(accountID, characterID) {
  const numericCharacterID = Number(characterID || 0);
  if (!numericCharacterID) {
    return null;
  }
  const record = normalizeCharacterRecord(
    numericCharacterID,
    readTableEntry("characters", numericCharacterID),
  );
  return record && (!accountID || record.accountID === Number(accountID || 0))
    ? record
    : null;
}

function getNumericID(record, keys) {
  for (const key of keys) {
    const value = Number(record && record[key]);
    if (value > 0) {
      return value;
    }
  }
  return 0;
}

function listItemsForCharacter(characterID) {
  const numericCharacterID = Number(characterID || 0);
  const allItems = Object.values(readRootTable("items"))
    .filter((record) => record && typeof record === "object");
  const byItemID = new Map();
  for (const item of allItems) {
    const itemID = getNumericID(item, ["itemID", "shipID"]);
    if (itemID > 0) {
      byItemID.set(itemID, item);
    }
  }

  const selected = new Map();
  for (const item of allItems) {
    if (getNumericID(item, ["ownerID", "ownerid"]) === numericCharacterID) {
      const itemID = getNumericID(item, ["itemID", "shipID"]);
      if (itemID > 0) {
        selected.set(itemID, item);
      }
    }
  }

  const queue = [...selected.values()];
  for (let index = 0; index < queue.length && selected.size < SNAPSHOT_ITEM_LIMIT; index += 1) {
    const locationID = getNumericID(queue[index], ["locationID", "locationid"]);
    const parent = byItemID.get(locationID);
    if (!parent) {
      continue;
    }
    const parentID = getNumericID(parent, ["itemID", "shipID"]);
    if (parentID > 0 && !selected.has(parentID)) {
      selected.set(parentID, parent);
      queue.push(parent);
    }
  }

  return Object.fromEntries(
    [...selected.entries()].map(([itemID, item]) => [String(itemID), cloneValue(item)]),
  );
}

function buildIndustryJobsForCharacter(characterID) {
  const numericCharacterID = Number(characterID || 0);
  const jobsState = readRootTable("industryJobs");
  const jobs = jobsState.jobs && typeof jobsState.jobs === "object"
    ? jobsState.jobs
    : jobsState;
  return {
    jobs: Object.fromEntries(
      Object.entries(jobs || {})
        .filter(([, job]) => (
          Number(job && job.ownerID) === numericCharacterID ||
          Number(job && job.installerID) === numericCharacterID
        ))
        .map(([jobID, job]) => [jobID, cloneValue(job)]),
    ),
  };
}

function buildPlanetRuntimeForCharacter(characterID) {
  const numericCharacterID = Number(characterID || 0);
  const state = readRootTable("planetRuntimeState");
  const coloniesByKey = {};
  const launchesByID = {};
  const resourcesByPlanetID = {};
  for (const [key, colony] of Object.entries(state.coloniesByKey || {})) {
    if (Number(colony && colony.ownerID) !== numericCharacterID) {
      continue;
    }
    coloniesByKey[key] = cloneValue(colony);
    const planetID = Number(colony && colony.planetID) || 0;
    if (planetID > 0 && state.resourcesByPlanetID && state.resourcesByPlanetID[String(planetID)]) {
      resourcesByPlanetID[String(planetID)] = cloneValue(state.resourcesByPlanetID[String(planetID)]);
    }
  }
  for (const [launchID, launch] of Object.entries(state.launchesByID || {})) {
    if (Number(launch && launch.ownerID) === numericCharacterID) {
      launchesByID[launchID] = cloneValue(launch);
    }
  }
  return {
    schemaVersion: Number(state.schemaVersion || 1),
    resourcesByPlanetID,
    coloniesByKey,
    launchesByID,
    acceptedNetworkEditsByKey: {},
    nextIDs: cloneValue(state.nextIDs || {}),
  };
}

function buildCharacterSnapshot(accountID, characterID) {
  const account = getAccountByID(accountID);
  const character = getOwnedCharacter(account && account.accountID, characterID);
  if (!account || !character) {
    return null;
  }

  let queueSnapshot = null;
  let queueSnapshotWarning = null;
  try {
    queueSnapshot = sanitizeQueueSnapshot(getQueueSnapshot(character.characterID));
  } catch (error) {
    queueSnapshotWarning = error && error.message ? error.message : "skill queue unavailable";
  }

  return {
    source: "evejs-web-bridge",
    account,
    accounts: {
      [account.username]: account,
    },
    characters: {
      [String(character.characterID)]: cloneValue(character.value),
    },
    skills: {
      [String(character.characterID)]: cloneValue(readTableEntry("skills", character.characterID) || {}),
    },
    skillQueues: {
      [String(character.characterID)]: cloneValue(readTableEntry("skillQueues", character.characterID) || {}),
    },
    queueSnapshot,
    queueSnapshotWarning,
    items: listItemsForCharacter(character.characterID),
    industryJobs: buildIndustryJobsForCharacter(character.characterID),
    planetRuntimeState: buildPlanetRuntimeForCharacter(character.characterID),
  };
}

function flushSkillQueueTables() {
  if (gameStore && typeof gameStore.flushTablesSync === "function") {
    gameStore.flushTablesSync(["skillQueues", "skills", "characters"]);
  }
}

function flushPlanetTables() {
  if (gameStore && typeof gameStore.flushTablesSync === "function") {
    gameStore.flushTablesSync(["planetRuntimeState"]);
  }
}

function sendError(res, status, code, message) {
  res.status(status).json({
    ok: false,
    error: code,
    message,
  });
}

function mountWebCompanionBridge(app) {
  app.get(`${BRIDGE_PREFIX}/health`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }

    res.status(200).json({
      ok: true,
      source: "evejs-web-bridge",
      service: "evejs-web-bridge",
      skillQueue: true,
      snapshots: true,
      piRestartExtractors: true,
      characterStatus: true,
      marketStationAsks: true,
      tokenRequired: Boolean(getBridgeToken()),
    });
  });

  app.get(`${BRIDGE_PREFIX}/status`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }
    const accounts = listAccountRecords();
    const characters = readRootTable("characters");
    res.status(200).json({
      ok: true,
      source: "evejs-web-bridge",
      hasAccounts: true,
      hasCharacters: true,
      hasSkills: true,
      accountCount: accounts.length,
      characterCount: Object.keys(characters).length,
    });
  });

  app.get(`${BRIDGE_PREFIX}/accounts`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }
    res.status(200).json({
      ok: true,
      source: "evejs-web-bridge",
      accounts: listAccountRecords(),
    });
  });

  app.get(`${BRIDGE_PREFIX}/account`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }
    const account = getAccountByUsername(req.query.username);
    if (!account) {
      sendError(res, 404, "ACCOUNT_NOT_FOUND", "Account was not found.");
      return;
    }
    res.status(200).json({
      ok: true,
      source: "evejs-web-bridge",
      account,
    });
  });

  app.get(`${BRIDGE_PREFIX}/characters`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }
    const accountID = Number(req.query.accountID || 0);
    if (!accountID || !getAccountByID(accountID)) {
      sendError(res, 404, "ACCOUNT_NOT_FOUND", "Account was not found.");
      return;
    }
    res.status(200).json({
      ok: true,
      source: "evejs-web-bridge",
      characters: listCharacterRecordsForAccount(accountID).map((entry) => entry.value),
    });
  });

  app.get(`${BRIDGE_PREFIX}/snapshot`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }
    const accountID = Number(req.query.accountID || 0);
    const characterID = Number(req.query.characterID || 0);
    const snapshot = buildCharacterSnapshot(accountID, characterID);
    if (!snapshot) {
      sendError(res, 404, "CHARACTER_NOT_FOUND", "Character was not found.");
      return;
    }
    res.status(200).json({
      ok: true,
      source: "evejs-web-bridge",
      snapshot,
    });
  });

  app.get(`${BRIDGE_PREFIX}/character-status`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }

    const characterID = Number(req.query.characterID || 0);
    if (!characterID) {
      sendError(res, 400, "INVALID_CHARACTER", "characterID is required.");
      return;
    }

    const accountID = Number(req.query.accountID || 0);
    const ownerAccountID = Number(resolveCharacterAccountID(characterID) || 0);
    if (accountID && ownerAccountID && accountID !== ownerAccountID) {
      sendError(
        res,
        403,
        "CHARACTER_ACCOUNT_MISMATCH",
        "Character does not belong to the supplied account.",
      );
      return;
    }

    res.status(200).json({
      ok: true,
      source: "evejs-web-bridge",
      characterID,
      online: Boolean(isCharacterOnline(characterID)),
    });
  });

  app.post(`${BRIDGE_PREFIX}/skill-queue`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }

    const body = req.body || {};
    const accountID = Number(body.accountID || 0);
    const characterID = Number(body.characterID || 0);
    if (!characterID) {
      sendError(res, 400, "INVALID_CHARACTER", "characterID is required.");
      return;
    }

    const ownerAccountID = Number(resolveCharacterAccountID(characterID) || 0);
    if (
      accountID &&
      ownerAccountID &&
      accountID !== ownerAccountID
    ) {
      sendError(
        res,
        403,
        "CHARACTER_ACCOUNT_MISMATCH",
        "Character does not belong to the supplied account.",
      );
      return;
    }

    // Authoritative guard: never mutate queue state underneath a live client.
    // The web companion checks first, but this keeps direct bridge calls safe.
    if (isCharacterOnline(characterID)) {
      sendError(
        res,
        409,
        "CHARACTER_ONLINE",
        "Character is currently logged in. Log out of the game before changing the skill queue from the companion.",
      );
      return;
    }

    try {
      const normalizedEntries = normalizeQueueInput(
        Array.isArray(body.entries) ? body.entries : [],
      );
      const snapshot = saveQueue(characterID, normalizedEntries, {
        activate: body.activate !== false,
        emitNotifications: true,
      });
      flushSkillQueueTables();

      log.info(
        `[WebCompanionBridge] skill queue saved characterID=${characterID} ` +
          `entries=${normalizedEntries.length} active=${snapshot.active}`,
      );
      res.status(200).json({
        ok: true,
        source: "evejs-web-bridge",
        snapshot: sanitizeQueueSnapshot(snapshot),
      });
    } catch (error) {
      log.warn(
        `[WebCompanionBridge] skill queue save failed ` +
          `characterID=${characterID}: ${error.message}`,
      );
      sendError(
        res,
        400,
        error && error.name ? error.name : "SKILL_QUEUE_SAVE_FAILED",
        error && error.message
          ? error.message
          : "Skill queue save failed.",
      );
    }
  });

  app.post(`${BRIDGE_PREFIX}/pi/restart-extractors`, (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }

    const body = req.body || {};
    const accountID = Number(body.accountID || 0);
    const characterID = Number(body.characterID || 0);
    if (!characterID) {
      sendError(res, 400, "INVALID_CHARACTER", "characterID is required.");
      return;
    }

    const ownerAccountID = Number(resolveCharacterAccountID(characterID) || 0);
    if (
      accountID &&
      ownerAccountID &&
      accountID !== ownerAccountID
    ) {
      sendError(
        res,
        403,
        "CHARACTER_ACCOUNT_MISMATCH",
        "Character does not belong to the supplied account.",
      );
      return;
    }

    // Authoritative guard: never mutate colony state underneath a live client.
    // The companion also gates the UI, but this is the guarantee even if bypassed.
    if (isCharacterOnline(characterID)) {
      sendError(
        res,
        409,
        "CHARACTER_ONLINE",
        "Character is currently logged in. Log out of the game before restarting extractors from the companion.",
      );
      return;
    }

    try {
      const planetID = Number(body.planetID || 0);
      const summary = restartExtractorsForCharacter(characterID, {
        planetID: planetID > 0 ? planetID : 0,
      });
      flushPlanetTables();

      log.info(
        `[WebCompanionBridge] PI extractors restarted characterID=${characterID} ` +
          `colonies=${summary.colonyCount} restarted=${summary.restartedCount}`,
      );
      res.status(200).json({
        ok: true,
        source: "evejs-web-bridge",
        summary,
      });
    } catch (error) {
      log.warn(
        `[WebCompanionBridge] PI extractor restart failed ` +
          `characterID=${characterID}: ${error.message}`,
      );
      sendError(
        res,
        400,
        error && error.name ? error.name : "PI_RESTART_FAILED",
        error && error.message
          ? error.message
          : "PI extractor restart failed.",
      );
    }
  });

  app.get(`${BRIDGE_PREFIX}/market/station-asks`, async (req, res) => {
    if (!authorizeBridgeRequest(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Bridge request is not authorized.");
      return;
    }
    const stationID = Number(req.query.stationID || 0);
    if (!stationID) {
      sendError(res, 400, "INVALID_STATION", "stationID is required.");
      return;
    }
    try {
      await marketDaemonClient.startupCheck();
      const rows = await marketDaemonClient.call("GetStationAsks", {
        station_id: stationID,
      });
      res.status(200).json({
        ok: true,
        source: "evejs-web-bridge",
        rows: Array.isArray(rows) ? rows : [],
      });
    } catch (error) {
      sendError(
        res,
        503,
        "MARKET_UNAVAILABLE",
        error && error.message ? error.message : "Market daemon unavailable.",
      );
    }
  });
}

module.exports = {
  mountWebCompanionBridge,
  sanitizeQueueSnapshot,
};
