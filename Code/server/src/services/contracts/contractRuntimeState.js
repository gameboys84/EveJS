const path = require("path");

const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  currentFileTime,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ITEM_FLAGS,
  findItemById,
  getItemMetadata,
  grantItemToOwnerLocation,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
  transferItemToOwnerLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const {
  CORPORATION_WALLET_KEY_START,
  adjustCorporationWalletDivisionBalance,
  getCorporationWalletBalance,
  normalizeCorporationWalletKey,
} = require(path.join(__dirname, "../corporation/corpWalletState"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const worldData = require(path.join(__dirname, "../../space/worldData"));

const repo = createTableRepository("service:contracts", { strict: true });

const TABLE = "contractRuntime";
const CONTRACT_ID_START = 980000000;
const CONTRACT_ESCROW_LOCATION_BASE = 9_300_000_000;
const CONTRACT_ESCROW_OWNER_ID = 1;
const PLASTIC_WRAP_TYPE_ID = 3468;
const DAY_FILETIME_TICKS = 24n * 60n * 60n * 10_000_000n;
const SECOND_FILETIME_TICKS = 10_000_000;
const CONTRACTS_PER_PAGE = 100;

const CONTRACT_TYPE = Object.freeze({
  ITEM_EXCHANGE: 1,
  AUCTION: 2,
  COURIER: 3,
});

const CONTRACT_STATUS = Object.freeze({
  OUTSTANDING: 0,
  IN_PROGRESS: 1,
  FINISHED_ISSUER: 2,
  FINISHED_CONTRACTOR: 3,
  FINISHED: 4,
  CANCELLED: 5,
  REJECTED: 6,
  FAILED: 7,
  DELETED: 8,
  REVERSED: 9,
  BID_ON_BY: 10,
  REQUIRES_ATTENTION: -1,
});

const CONTRACT_AVAILABILITY = Object.freeze({
  PUBLIC: 0,
  MYSELF: 1,
  MY_CORP: 2,
  MY_ALLIANCE: 3,
});

const CONTRACT_SEARCH_SORT = Object.freeze({
  ID: 0,
  PRICE: 1,
  EXPIRED: 2,
  STATION_ID: 3,
  SOLARSYSTEM_ID: 4,
  REGION_ID: 5,
  CONSTELLATION_ID: 6,
  CONTRACT_TYPE: 7,
  REWARD: 8,
  COLLATERAL: 9,
  VOLUME: 10,
  ASSIGNEE_ID: 11,
});

const CONTRACT_SEARCH_HINT = Object.freeze({
  BPO: 1,
  BPC: 2,
});

const SECURITY_CLASS = Object.freeze({
  ZERO_SEC: 0,
  LOW_SEC: 1,
  HIGH_SEC: 2,
  SAFE_SEC: 3,
});

const CORP_CONTRACT_ITEM_FLAGS = new Set([
  ITEM_FLAGS.CORP_DELIVERIES,
  115,
  116,
  117,
  118,
  119,
  120,
  121,
]);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function toPositiveInteger(value, fallback = 0) {
  const numeric = toInteger(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }
  return Boolean(fallback);
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(Math.max(0, numeric) * 100) / 100;
}

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function getSessionCharacterID(session) {
  return toPositiveInteger(
    session && (
      session.characterID ||
      session.charid ||
      session.characterId ||
      session.charID
    ),
    0,
  );
}

function getSessionCorporationID(session) {
  return toPositiveInteger(
    session && (
      session.corporationID ||
      session.corpid ||
      session.corpID
    ),
    0,
  );
}

function getSessionAllianceID(session) {
  return toPositiveInteger(
    session && (
      session.allianceID ||
      session.allianceid
    ),
    0,
  );
}

function getSessionCorpAccountKey(session) {
  return normalizeCorporationWalletKey(
    session && (
      session.corpAccountKey ||
      session.corpaccountkey ||
      session.accountKey
    ) || CORPORATION_WALLET_KEY_START,
  );
}

function throwContractError(message) {
  throwWrappedUserError("CustomInfo", {
    info: String(message || "The contract operation could not be completed."),
  });
}

function throwContractUserError(message, values = {}) {
  throwWrappedUserError(message, values);
}

function nowFileTimeString() {
  return currentFileTime().toString();
}

function toFileTimeBigInt(value) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    const text = String(value || "0").trim();
    return text ? BigInt(text) : 0n;
  } catch (error) {
    return 0n;
  }
}

function addFileTimeDays(fileTimeValue, days) {
  return (
    toFileTimeBigInt(fileTimeValue) +
    BigInt(Math.max(0, toInteger(days, 0))) * DAY_FILETIME_TICKS
  ).toString();
}

function addFileTimeMinutes(fileTimeValue, minutes) {
  return (
    toFileTimeBigInt(fileTimeValue) +
    BigInt(Math.max(0, toInteger(minutes, 0))) * 60n * 10_000_000n
  ).toString();
}

function getContractEscrowLocationID(contractID) {
  return CONTRACT_ESCROW_LOCATION_BASE + toPositiveInteger(contractID, 0);
}

function ensureRuntimeTable() {
  const result = repo.read(TABLE, "/");
  const table =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : {};

  if (!table._meta || typeof table._meta !== "object") {
    table._meta = { version: 1, nextContractID: CONTRACT_ID_START };
    repo.write(TABLE, "/_meta", table._meta);
  } else if (!toPositiveInteger(table._meta.nextContractID, 0)) {
    table._meta.nextContractID = CONTRACT_ID_START;
    repo.write(TABLE, "/_meta/nextContractID", table._meta.nextContractID);
  }

  return table;
}

function listContractRecords() {
  const table = ensureRuntimeTable();
  return Object.entries(table)
    .filter(([key, value]) => key !== "_meta" && value && typeof value === "object")
    .map(([, value]) => cloneValue(value));
}

function getContractRecord(contractID) {
  const normalizedContractID = toPositiveInteger(contractID, 0);
  if (!normalizedContractID) {
    return null;
  }
  const result = repo.read(TABLE, `/${String(normalizedContractID)}`);
  return result.success && result.data ? cloneValue(result.data) : null;
}

function putContractRecord(record) {
  const contractID = toPositiveInteger(record && record.contractID, 0);
  if (!contractID) {
    return {
      success: false,
      errorMsg: "CONTRACT_ID_REQUIRED",
    };
  }
  return repo.write(TABLE, `/${String(contractID)}`, cloneValue(record));
}

function allocateContractID() {
  const table = ensureRuntimeTable();
  const existingMax = listContractRecords()
    .reduce(
      (maxValue, record) => Math.max(maxValue, toPositiveInteger(record.contractID, 0)),
      CONTRACT_ID_START - 1,
    );
  const nextContractID = Math.max(
    toPositiveInteger(table._meta && table._meta.nextContractID, CONTRACT_ID_START),
    existingMax + 1,
  );
  repo.write(TABLE, "/_meta/nextContractID", nextContractID + 1);
  return nextContractID;
}

function resetForTests() {
  repo.write(TABLE, "/", {
    _meta: {
      version: 1,
      nextContractID: CONTRACT_ID_START,
    },
  }, { force: true });
}

function extractPlainObject(rawValue) {
  if (!rawValue) {
    return {};
  }

  const unwrapped = unwrapMarshalValue(rawValue);
  if (
    unwrapped &&
    typeof unwrapped === "object" &&
    !Array.isArray(unwrapped) &&
    Object.prototype.hasOwnProperty.call(unwrapped, "contractType")
  ) {
    return { ...unwrapped };
  }

  if (
    unwrapped &&
    typeof unwrapped === "object" &&
    Array.isArray(unwrapped.header)
  ) {
    for (const candidate of unwrapped.header) {
      if (
        candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        Object.prototype.hasOwnProperty.call(candidate, "contractType")
      ) {
        return { ...candidate };
      }
    }
  }

  if (
    rawValue &&
    typeof rawValue === "object" &&
    Array.isArray(rawValue.header) &&
    rawValue.header.length > 2
  ) {
    const state = unwrapMarshalValue(rawValue.header[2]);
    if (state && typeof state === "object" && !Array.isArray(state)) {
      return { ...state };
    }
  }

  return unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
    ? { ...unwrapped }
    : {};
}

function normalizePairList(rawValue) {
  const unwrapped = unwrapMarshalValue(rawValue);
  const values = Array.isArray(unwrapped)
    ? unwrapped
    : unwrapped && typeof unwrapped === "object"
      ? Object.values(unwrapped)
      : [];

  const byFirst = new Map();
  for (const entry of values) {
    const pair = Array.isArray(entry)
      ? entry
      : entry && typeof entry === "object"
        ? Object.values(entry)
        : [];
    const first = toPositiveInteger(pair[0], 0);
    const second = toPositiveInteger(pair[1], 0);
    if (!first || !second) {
      continue;
    }
    byFirst.set(first, (byFirst.get(first) || 0) + second);
  }

  return [...byFirst.entries()]
    .map(([first, second]) => [first, second])
    .sort(([left], [right]) => left - right);
}

function normalizeContractInfo(rawInfo) {
  const source = extractPlainObject(rawInfo);
  return {
    contractType: toPositiveInteger(source.contractType, 0),
    isPrivate: normalizeBoolean(source.isPrivate, false),
    assignedToID: toPositiveInteger(source.assignedToID, 0),
    minutesExpire: toPositiveInteger(source.minutesExpire, 24 * 60),
    numDays: toPositiveInteger(source.numDays, 1),
    startStationID: toPositiveInteger(source.startStationID, 0),
    destinationID: toPositiveInteger(source.destinationID, 0),
    price: normalizeMoney(source.price, 0),
    reward: normalizeMoney(source.reward, 0),
    collateral: normalizeMoney(source.collateral, 0),
    title: normalizeText(source.title, "").slice(0, 200),
    description: normalizeText(source.description, "").slice(0, 4000),
    itemList: normalizePairList(source.itemList),
    startStationDivision: toPositiveInteger(source.startStationDivision, ITEM_FLAGS.HANGAR),
    requestItemTypeList: normalizePairList(source.requestItemTypeList),
    forCorp: normalizeBoolean(source.forCorp, false),
    multiContract: normalizeBoolean(source.multiContract, false),
  };
}

function sameContractDivisionFlag(itemFlagID, selectedFlagID) {
  const normalizedItemFlagID = toPositiveInteger(itemFlagID, 0);
  const normalizedSelectedFlagID = toPositiveInteger(selectedFlagID, 0);
  if (normalizedItemFlagID === normalizedSelectedFlagID) {
    return true;
  }
  return new Set([
    normalizedItemFlagID,
    normalizedSelectedFlagID,
  ]).size === 2 &&
    normalizedItemFlagID > 0 &&
    normalizedSelectedFlagID > 0 &&
    [
      normalizedItemFlagID,
      normalizedSelectedFlagID,
    ].every((flagID) => flagID === ITEM_FLAGS.HANGAR || flagID === 115);
}

function isAllowedContractSourceFlag(flagID, forCorp, selectedFlagID = 0) {
  const normalizedFlagID = toPositiveInteger(flagID, 0);
  if (forCorp) {
    if (!CORP_CONTRACT_ITEM_FLAGS.has(normalizedFlagID)) {
      return false;
    }
    const normalizedSelectedFlagID = toPositiveInteger(selectedFlagID, 0);
    return normalizedSelectedFlagID <= 0 ||
      sameContractDivisionFlag(normalizedFlagID, normalizedSelectedFlagID);
  }
  return normalizedFlagID === ITEM_FLAGS.HANGAR;
}

function getOwnedContractSourceID(session, forCorp) {
  const ownerID = forCorp
    ? getSessionCorporationID(session)
    : getSessionCharacterID(session);
  if (!ownerID) {
    throwContractError("The contract owner could not be resolved.");
  }
  return ownerID;
}

function getItemQuantity(item) {
  if (!item) {
    return 0;
  }
  if (toInteger(item.singleton, 0) === 1) {
    return 1;
  }
  return toPositiveInteger(item.stacksize ?? item.quantity, 0);
}

function resolveDockableLocation(locationID, session = null) {
  const normalizedLocationID = toPositiveInteger(locationID, 0);
  const station = normalizedLocationID ? worldData.getStationByID(normalizedLocationID) : null;
  if (station) {
    const system = worldData.getSolarSystemByID(station.solarSystemID);
    return {
      stationID: normalizedLocationID,
      solarSystemID: toPositiveInteger(station.solarSystemID, 0),
      regionID: toPositiveInteger(
        station.regionID || (system && system.regionID),
        0,
      ),
    };
  }

  const structure = normalizedLocationID ? worldData.getStructureByID(normalizedLocationID) : null;
  if (structure) {
    const system = worldData.getSolarSystemByID(structure.solarSystemID);
    return {
      stationID: normalizedLocationID,
      solarSystemID: toPositiveInteger(structure.solarSystemID, 0),
      regionID: toPositiveInteger(
        structure.regionID || (system && system.regionID),
        0,
      ),
    };
  }

  return {
    stationID: normalizedLocationID,
    solarSystemID: toPositiveInteger(
      session && (
        session.solarSystemID ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
      0,
    ),
    regionID: toPositiveInteger(
      session && (
        session.regionID ||
        session.regionid
      ),
      0,
    ),
  };
}

function resolveAvailability(info, session) {
  if (!info.isPrivate || !info.assignedToID) {
    return CONTRACT_AVAILABILITY.PUBLIC;
  }
  if (info.assignedToID === getSessionCorporationID(session)) {
    return CONTRACT_AVAILABILITY.MY_CORP;
  }
  if (info.assignedToID === getSessionAllianceID(session)) {
    return CONTRACT_AVAILABILITY.MY_ALLIANCE;
  }
  return CONTRACT_AVAILABILITY.MYSELF;
}

function buildWalletRef(session, forCorp) {
  if (forCorp) {
    const corporationID = getSessionCorporationID(session);
    if (!corporationID) {
      throwContractError("The corporation wallet could not be resolved.");
    }
    return {
      kind: "corporation",
      ownerID: corporationID,
      accountKey: getSessionCorpAccountKey(session),
    };
  }

  const characterID = getSessionCharacterID(session);
  if (!characterID) {
    throwContractError("The character wallet could not be resolved.");
  }
  return {
    kind: "character",
    ownerID: characterID,
    accountKey: 1000,
  };
}

function cloneWalletRef(ref) {
  return {
    kind: ref && ref.kind === "corporation" ? "corporation" : "character",
    ownerID: toPositiveInteger(ref && ref.ownerID, 0),
    accountKey: toPositiveInteger(ref && ref.accountKey, 1000),
  };
}

function getWalletBalance(ref) {
  const walletRef = cloneWalletRef(ref);
  if (walletRef.kind === "corporation") {
    return normalizeMoney(
      getCorporationWalletBalance(walletRef.ownerID, walletRef.accountKey),
      0,
    );
  }
  const wallet = getCharacterWallet(walletRef.ownerID);
  return wallet ? normalizeMoney(wallet.balance, 0) : null;
}

function ensureWalletFunds(ref, amount, description) {
  const normalizedAmount = normalizeMoney(amount, 0);
  if (!(normalizedAmount > 0)) {
    return;
  }
  const balance = getWalletBalance(ref);
  if (balance === null || balance + 0.0001 < normalizedAmount) {
    throwContractError(
      `${description} requires ${normalizedAmount.toFixed(2)} ISK, but the wallet does not have enough funds.`,
    );
  }
}

function adjustWallet(ref, delta, description, contractID, counterpartyID = 0) {
  const normalizedDelta = Math.round((Number(delta) || 0) * 100) / 100;
  if (Math.abs(normalizedDelta) < 0.0001) {
    return null;
  }
  const walletRef = cloneWalletRef(ref);
  const options = {
    ownerID1: walletRef.ownerID,
    ownerID2: toPositiveInteger(counterpartyID, 0),
    referenceID: toPositiveInteger(contractID, 0),
    entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_TRADING,
    description,
  };
  const result = walletRef.kind === "corporation"
    ? adjustCorporationWalletDivisionBalance(
      walletRef.ownerID,
      walletRef.accountKey,
      normalizedDelta,
      options,
    )
    : adjustCharacterBalance(walletRef.ownerID, normalizedDelta, options);

  if (!result || !result.success) {
    throwContractError(`${description} failed: ${(result && result.errorMsg) || "wallet write error"}.`);
  }
  return result;
}

function getOwnerDeliveryFlag(forCorp, divisionFlagID = 0) {
  if (!forCorp) {
    return ITEM_FLAGS.HANGAR;
  }
  const normalizedFlagID = toPositiveInteger(divisionFlagID, 0);
  return CORP_CONTRACT_ITEM_FLAGS.has(normalizedFlagID)
    ? normalizedFlagID
    : ITEM_FLAGS.CORP_DELIVERIES;
}

function getAcceptorDeliveryFlag(forCorp) {
  return forCorp ? ITEM_FLAGS.CORP_DELIVERIES : ITEM_FLAGS.HANGAR;
}

function getItemContractQuantity(item, requestedQuantity) {
  const available = getItemQuantity(item);
  if (toInteger(item && item.singleton, 0) === 1) {
    return 1;
  }
  return Math.min(available, toPositiveInteger(requestedQuantity, available));
}

function validateSelectedItem(itemID, quantity, ownerID, locationID, forCorp, selectedFlagID) {
  const item = findItemById(itemID);
  if (!item) {
    throwContractError(`Item ${itemID} could not be found.`);
  }
  if (toPositiveInteger(item.ownerID, 0) !== ownerID) {
    throwContractError(`Item ${itemID} is not owned by the contract issuer.`);
  }
  if (toPositiveInteger(item.locationID, 0) !== locationID) {
    throwContractError(`Item ${itemID} is not at the contract start location.`);
  }
  if (!isAllowedContractSourceFlag(item.flagID, forCorp, selectedFlagID)) {
    throwContractError(`Item ${itemID} cannot be added to a contract from its current hangar.`);
  }
  if (getItemQuantity(item) < quantity) {
    throwContractError(`Item ${itemID} does not have the requested quantity.`);
  }
  return item;
}

function validateCreationItems(info, ownerID) {
  for (const [itemID, quantity] of info.itemList) {
    validateSelectedItem(
      itemID,
      quantity,
      ownerID,
      info.startStationID,
      info.forCorp,
      info.startStationDivision,
    );
  }
}

function buildContractItemRowFromInventory(item, quantity, inCrate, extra = {}) {
  const normalizedTypeID = toPositiveInteger(item && item.typeID, 0);
  return {
    recordID: toPositiveInteger(extra.recordID, 0),
    itemID: toPositiveInteger(extra.itemID ?? (item && item.itemID), 0),
    sourceItemID: toPositiveInteger(extra.sourceItemID ?? (item && item.itemID), 0),
    escrowItemID: toPositiveInteger(extra.escrowItemID ?? (item && item.itemID), 0),
    itemTypeID: normalizedTypeID,
    typeID: normalizedTypeID,
    quantity: toPositiveInteger(quantity, 1),
    inCrate: normalizeBoolean(inCrate, true),
    parentID: toPositiveInteger(extra.parentID, 0),
    flagID: toPositiveInteger(extra.flagID ?? (item && item.flagID), 0),
    copy: toInteger(extra.copy, 0),
    licensedProductionRunsRemaining: toInteger(extra.licensedProductionRunsRemaining, 0),
    materialLevel: toInteger(extra.materialLevel, 0),
    productivityLevel: toInteger(extra.productivityLevel, 0),
    damage: normalizeNumber(extra.damage, 0),
  };
}

function buildRequestedItemRow(typeID, quantity, recordID) {
  return {
    recordID,
    itemID: 0,
    sourceItemID: 0,
    escrowItemID: 0,
    itemTypeID: toPositiveInteger(typeID, 0),
    typeID: toPositiveInteger(typeID, 0),
    quantity: toPositiveInteger(quantity, 1),
    inCrate: false,
    parentID: 0,
    flagID: ITEM_FLAGS.HANGAR,
    copy: 0,
    licensedProductionRunsRemaining: 0,
    materialLevel: 0,
    productivityLevel: 0,
    damage: 0,
  };
}

function findMovedItem(changes, locationID, sourceItemID, typeID) {
  const normalizedLocationID = toPositiveInteger(locationID, 0);
  const normalizedSourceItemID = toPositiveInteger(sourceItemID, 0);
  const normalizedTypeID = toPositiveInteger(typeID, 0);
  const candidates = (Array.isArray(changes) ? changes : [])
    .map((change) => change && change.item)
    .filter((item) => (
      item &&
      toPositiveInteger(item.locationID, 0) === normalizedLocationID &&
      toPositiveInteger(item.typeID, 0) === normalizedTypeID
    ));
  return candidates.find((item) => toPositiveInteger(item.itemID, 0) !== normalizedSourceItemID) ||
    candidates.find((item) => toPositiveInteger(item.itemID, 0) === normalizedSourceItemID) ||
    null;
}

function moveSelectedItemsToEscrow(info, contractID, ownerID) {
  const escrowLocationID = getContractEscrowLocationID(contractID);
  const rows = [];
  const changes = [];
  let recordID = 1;

  for (const [itemID, requestedQuantity] of info.itemList) {
    const currentItem = validateSelectedItem(
      itemID,
      requestedQuantity,
      ownerID,
      info.startStationID,
      info.forCorp,
      info.startStationDivision,
    );
    const moveQuantity = getItemContractQuantity(currentItem, requestedQuantity);
    const moveResult = transferItemToOwnerLocation(
      currentItem.itemID,
      CONTRACT_ESCROW_OWNER_ID,
      escrowLocationID,
      0,
      moveQuantity,
    );
    if (!moveResult.success) {
      throwContractError(`Failed to escrow item ${currentItem.itemID}: ${moveResult.errorMsg || "item move failed"}.`);
    }

    const moveChanges = (moveResult.data && moveResult.data.changes) || [];
    const escrowItem = findMovedItem(
      moveChanges,
      escrowLocationID,
      currentItem.itemID,
      currentItem.typeID,
    );
    if (!escrowItem) {
      throwContractError(`Failed to identify escrowed item ${currentItem.itemID}.`);
    }

    rows.push(buildContractItemRowFromInventory(
      escrowItem,
      moveQuantity,
      true,
      {
        recordID,
        sourceItemID: currentItem.itemID,
        escrowItemID: escrowItem.itemID,
        flagID: escrowItem.flagID,
      },
    ));
    recordID += 1;
    changes.push(...moveChanges);
  }

  return {
    escrowLocationID,
    rows,
    changes,
    nextRecordID: recordID,
  };
}

function appendRequestedItemRows(info, rows, nextRecordID) {
  let recordID = nextRecordID;
  for (const [typeID, quantity] of info.requestItemTypeList) {
    rows.push(buildRequestedItemRow(typeID, quantity, recordID));
    recordID += 1;
  }
  return recordID;
}

function collectContainedItems(rootItemID) {
  const normalizedRootItemID = toPositiveInteger(rootItemID, 0);
  if (!normalizedRootItemID) {
    return [];
  }

  const collected = [];
  const queue = [normalizedRootItemID];
  const seen = new Set([normalizedRootItemID]);
  while (queue.length > 0) {
    const currentLocationID = queue.shift();
    const children = listContainerItems(null, currentLocationID, null)
      .sort((left, right) => toPositiveInteger(left.itemID, 0) - toPositiveInteger(right.itemID, 0));
    for (const child of children) {
      const childItemID = toPositiveInteger(child && child.itemID, 0);
      if (!childItemID || seen.has(childItemID)) {
        continue;
      }
      seen.add(childItemID);
      collected.push(child);
      queue.push(childItemID);
    }
  }
  return collected;
}

function transferContainedItemsToOwner(rootItemID, destinationOwnerID) {
  const changes = [];
  for (const child of collectContainedItems(rootItemID)) {
    const transferResult = transferItemToOwnerLocation(
      child.itemID,
      destinationOwnerID,
      child.locationID,
      child.flagID,
      null,
    );
    if (!transferResult.success) {
      throwContractError(`Failed to transfer contained item ${child.itemID}.`);
    }
    changes.push(...((transferResult.data && transferResult.data.changes) || []));
  }
  return changes;
}

function buildStructureHangarLocationContext(locationID) {
  const normalizedLocationID = toPositiveInteger(locationID, 0);
  return normalizedLocationID > 0
    ? ["Structure", normalizedLocationID, "StructureItemHangar"]
    : null;
}

function sendContractCreatedNotification(session) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  session.sendNotification("OnContractCreated", "clientID", []);
  return true;
}

function findIssuerNotificationSession(contract, sourceSession = null) {
  const issuerID = toPositiveInteger(contract && contract.issuerID, 0);
  if (issuerID <= 0) {
    return null;
  }
  if (
    sourceSession &&
    getSessionCharacterID(sourceSession) === issuerID &&
    typeof sourceSession.sendNotification === "function"
  ) {
    return sourceSession;
  }
  return sessionRegistry.findSessionByCharacterID(issuerID) || null;
}

function sendContractAcceptedNotification(contract, sourceSession = null) {
  const targetSession = findIssuerNotificationSession(contract, sourceSession);
  if (!targetSession || typeof targetSession.sendNotification !== "function") {
    return false;
  }
  targetSession.sendNotification("OnContractAccepted", "clientID", [
    toPositiveInteger(contract && contract.contractID, 0),
  ]);
  return true;
}

function syncInventoryChangesToSession(session, changes = [], options = {}) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  const { emitItemsChangedBatchForSession } = require(path.join(
    __dirname,
    "../character/characterState",
  ));
  const normalizedChanges = (Array.isArray(changes) ? changes : [])
    .filter((change) => change && change.item);
  if (normalizedChanges.length <= 0) {
    return;
  }
  emitItemsChangedBatchForSession(session, normalizedChanges, {
    locationContext: options.locationContext || null,
  });
}

function buildBaseContractRecord(info, session, contractID, ownerID, issuerWalletRef) {
  const issuedAt = nowFileTimeString();
  const start = resolveDockableLocation(info.startStationID, session);
  const end = resolveDockableLocation(info.destinationID || info.startStationID, session);
  const issuerID = getSessionCharacterID(session);
  const issuerCorpID = getSessionCorporationID(session);

  return {
    contractID,
    type: info.contractType,
    status: CONTRACT_STATUS.OUTSTANDING,
    availability: resolveAvailability(info, session),
    issuerID,
    issuerCorpID,
    issuerOwnerID: ownerID,
    issuerWallet: cloneWalletRef(issuerWalletRef),
    forCorp: info.forCorp,
    assigneeID: info.isPrivate ? info.assignedToID : 0,
    acceptorID: 0,
    acceptorWallet: null,
    acceptorWalletKey: null,
    dateIssued: issuedAt,
    dateExpired: addFileTimeMinutes(issuedAt, info.minutesExpire),
    dateAccepted: "0",
    dateCompleted: "0",
    numDays: info.numDays,
    startStationID: start.stationID,
    endStationID: info.contractType === CONTRACT_TYPE.COURIER ? end.stationID : 0,
    startSolarSystemID: start.solarSystemID,
    endSolarSystemID: info.contractType === CONTRACT_TYPE.COURIER ? end.solarSystemID : 0,
    startRegionID: start.regionID,
    endRegionID: info.contractType === CONTRACT_TYPE.COURIER ? end.regionID : 0,
    price: info.price,
    reward: info.reward,
    collateral: info.collateral,
    volume: 0,
    title: info.title,
    description: info.description,
    startStationDivision: info.startStationDivision,
    escrowLocationID: getContractEscrowLocationID(contractID),
    packageLocationID: 0,
    plasticWrapItemID: 0,
    rewardEscrow: 0,
    collateralEscrow: 0,
    collateralCredited: false,
    rewardPaid: false,
    items: [],
    packageItems: [],
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
}

function ensureSupportedCreateInfo(info) {
  if (
    info.contractType !== CONTRACT_TYPE.ITEM_EXCHANGE &&
    info.contractType !== CONTRACT_TYPE.COURIER
  ) {
    return false;
  }
  if (!info.startStationID) {
    throwContractError("Choose a start location before creating the contract.");
  }
  if (info.contractType === CONTRACT_TYPE.COURIER && !info.destinationID) {
    throwContractError("Choose a destination before creating the courier contract.");
  }
  if (info.contractType === CONTRACT_TYPE.COURIER && info.itemList.length === 0) {
    throwContractError("Choose at least one item for the courier contract.");
  }
  return true;
}

function calculateItemRowsVolume(rows) {
  return rows.reduce((total, row) => {
    const metadata = getItemMetadata(row.itemTypeID);
    return total + (Number(metadata && metadata.volume) || 0) * toPositiveInteger(row.quantity, 1);
  }, 0);
}

function createPlasticWrap(ownerID, packageLocationID) {
  const grantResult = grantItemToOwnerLocation(
    ownerID,
    packageLocationID,
    ITEM_FLAGS.HANGAR,
    { typeID: PLASTIC_WRAP_TYPE_ID },
    1,
    { singleton: 1 },
  );
  if (!grantResult.success) {
    throwContractError(`Failed to create courier package: ${grantResult.errorMsg || "item create failed"}.`);
  }
  const wrapItem = grantResult.data && Array.isArray(grantResult.data.items)
    ? grantResult.data.items[0]
    : null;
  if (!wrapItem) {
    throwContractError("Failed to identify the courier package item.");
  }
  return {
    wrapItem,
    changes: (grantResult.data && grantResult.data.changes) || [],
  };
}

function createContract(rawInfo, session, options = {}) {
  const info = normalizeContractInfo(rawInfo);
  if (!ensureSupportedCreateInfo(info)) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_CONTRACT_TYPE",
      contractIDs: [],
    };
  }

  const ownerID = getOwnedContractSourceID(session, info.forCorp);
  validateCreationItems(info, ownerID);
  const issuerWalletRef = buildWalletRef(session, info.forCorp);
  ensureWalletFunds(issuerWalletRef, info.reward, "Contract reward escrow");

  const contractID = allocateContractID();
  const baseRecord = buildBaseContractRecord(info, session, contractID, ownerID, issuerWalletRef);
  const moved = moveSelectedItemsToEscrow(info, contractID, ownerID);
  baseRecord.escrowLocationID = moved.escrowLocationID;
  baseRecord.items = moved.rows;
  appendRequestedItemRows(info, baseRecord.items, moved.nextRecordID);

  if (info.contractType === CONTRACT_TYPE.COURIER) {
    const packageLocationID = baseRecord.escrowLocationID;
    const plasticWrap = createPlasticWrap(ownerID, packageLocationID);
    baseRecord.packageLocationID = packageLocationID;
    baseRecord.plasticWrapItemID = plasticWrap.wrapItem.itemID;
    baseRecord.packageItems = moved.rows.map((row) => ({
      itemID: row.escrowItemID,
      itemTypeID: row.itemTypeID,
      quantity: row.quantity,
    }));
    baseRecord.items = [];
    baseRecord.volume = Math.round(calculateItemRowsVolume(moved.rows) * 100) / 100;
  } else {
    baseRecord.volume = Math.round(calculateItemRowsVolume(
      baseRecord.items.filter((row) => row.inCrate),
    ) * 100) / 100;
  }

  if (info.reward > 0) {
    adjustWallet(
      issuerWalletRef,
      -info.reward,
      `Contract ${contractID} reward escrow`,
      contractID,
      0,
    );
    baseRecord.rewardEscrow = info.reward;
  }

  const writeResult = putContractRecord(baseRecord);
  if (!writeResult.success) {
    throwContractError(`Failed to persist contract ${contractID}.`);
  }

  if (options.syncInventory !== false) {
    syncInventoryChangesToSession(session, moved.changes, {
      locationContext: buildStructureHangarLocationContext(baseRecord.startStationID),
    });
  }
  if (options.notify !== false) {
    sendContractCreatedNotification(session);
  }

  return {
    success: true,
    contractIDs: [contractID],
    contract: cloneValue(baseRecord),
    inventoryChanges: moved.changes,
  };
}

function isContractExpired(contract) {
  const expires = toFileTimeBigInt(contract && contract.dateExpired);
  return expires > 0n && expires < currentFileTime();
}

function isIssuedBySession(contract, session) {
  const characterID = getSessionCharacterID(session);
  const corporationID = getSessionCorporationID(session);
  return Boolean(
    contract &&
    (
      toPositiveInteger(contract.issuerID, 0) === characterID ||
      (
        normalizeBoolean(contract.forCorp, false) &&
        toPositiveInteger(contract.issuerCorpID, 0) === corporationID
      )
    ),
  );
}

function isAssignedToSession(contract, session) {
  if (!contract || toPositiveInteger(contract.assigneeID, 0) <= 0) {
    return false;
  }
  const assigneeID = toPositiveInteger(contract.assigneeID, 0);
  return assigneeID === getSessionCharacterID(session) ||
    assigneeID === getSessionCorporationID(session) ||
    assigneeID === getSessionAllianceID(session);
}

function canAcceptContract(contract, session) {
  if (!contract || contract.status !== CONTRACT_STATUS.OUTSTANDING) {
    return false;
  }
  if (isContractExpired(contract)) {
    return false;
  }
  if (contract.availability === CONTRACT_AVAILABILITY.PUBLIC) {
    return true;
  }
  return isAssignedToSession(contract, session);
}

function findRequestedItems(ownerID, locationID, forCorp, typeID) {
  return listContainerItems(ownerID, locationID, null)
    .filter((item) => (
      toPositiveInteger(item && item.typeID, 0) === toPositiveInteger(typeID, 0) &&
      isAllowedContractSourceFlag(item.flagID, forCorp, 0)
    ))
    .sort((left, right) => toPositiveInteger(left.itemID, 0) - toPositiveInteger(right.itemID, 0));
}

function ensureRequestedItemsAvailable(contract, acceptorOwnerID, acceptForCorp) {
  for (const requested of (contract.items || []).filter((row) => !row.inCrate)) {
    let remaining = toPositiveInteger(requested.quantity, 0);
    for (const item of findRequestedItems(
      acceptorOwnerID,
      contract.startStationID,
      acceptForCorp,
      requested.itemTypeID,
    )) {
      remaining -= getItemQuantity(item);
      if (remaining <= 0) {
        break;
      }
    }
    if (remaining > 0) {
      throwContractError(`The acceptor does not have enough item type ${requested.itemTypeID} at the contract location.`);
    }
  }
}

function transferRequestedItemsToIssuer(contract, acceptorOwnerID, acceptForCorp) {
  const changes = [];
  const issuerFlagID = getOwnerDeliveryFlag(
    normalizeBoolean(contract.forCorp, false),
    contract.startStationDivision,
  );

  for (const requested of (contract.items || []).filter((row) => !row.inCrate)) {
    let remaining = toPositiveInteger(requested.quantity, 0);
    const candidates = findRequestedItems(
      acceptorOwnerID,
      contract.startStationID,
      acceptForCorp,
      requested.itemTypeID,
    );
    for (const item of candidates) {
      if (remaining <= 0) {
        break;
      }
      const moveQuantity = Math.min(remaining, getItemQuantity(item));
      const transferResult = transferItemToOwnerLocation(
        item.itemID,
        contract.issuerOwnerID,
        contract.startStationID,
        issuerFlagID,
        toInteger(item.singleton, 0) === 1 ? null : moveQuantity,
      );
      if (!transferResult.success) {
        throwContractError(`Failed to transfer requested item ${item.itemID}.`);
      }
      changes.push(...((transferResult.data && transferResult.data.changes) || []));
      const movedItem = findMovedItem(
        transferResult.data && transferResult.data.changes,
        contract.startStationID,
        item.itemID,
        item.typeID,
      );
      if (movedItem) {
        changes.push(...transferContainedItemsToOwner(movedItem.itemID, contract.issuerOwnerID));
      }
      remaining -= moveQuantity;
    }
    if (remaining > 0) {
      throwContractError(`The acceptor does not have enough item type ${requested.itemTypeID} at the contract location.`);
    }
  }

  return changes;
}

function transferEscrowRowsToOwner(contract, targetOwnerID, locationID, flagID) {
  const changes = [];
  const nextRows = (contract.items || []).map((row) => ({ ...row }));

  for (const row of nextRows.filter((entry) => entry.inCrate)) {
    const escrowItemID = toPositiveInteger(row.escrowItemID || row.itemID, 0);
    if (!escrowItemID) {
      continue;
    }
    const transferResult = transferItemToOwnerLocation(
      escrowItemID,
      targetOwnerID,
      locationID,
      flagID,
      null,
    );
    if (!transferResult.success) {
      throwContractError(`Failed to transfer escrow item ${escrowItemID}.`);
    }
    const transferChanges = (transferResult.data && transferResult.data.changes) || [];
    changes.push(...transferChanges);
    const movedItem = findMovedItem(
      transferChanges,
      locationID,
      escrowItemID,
      row.itemTypeID,
    );
    if (movedItem) {
      row.itemID = movedItem.itemID;
      row.escrowItemID = movedItem.itemID;
      changes.push(...transferContainedItemsToOwner(movedItem.itemID, targetOwnerID));
    }
  }

  return {
    rows: nextRows,
    changes,
  };
}

function acceptItemExchange(contract, session, acceptForCorp) {
  const acceptorOwnerID = getOwnedContractSourceID(session, acceptForCorp);
  const acceptorWalletRef = buildWalletRef(session, acceptForCorp);
  ensureRequestedItemsAvailable(contract, acceptorOwnerID, acceptForCorp);
  ensureWalletFunds(acceptorWalletRef, contract.price, "Contract price");

  const requestedChanges = transferRequestedItemsToIssuer(
    contract,
    acceptorOwnerID,
    acceptForCorp,
  );
  const offeredTransfer = transferEscrowRowsToOwner(
    contract,
    acceptorOwnerID,
    contract.startStationID,
    getAcceptorDeliveryFlag(acceptForCorp),
  );

  if (contract.price > 0) {
    adjustWallet(
      acceptorWalletRef,
      -contract.price,
      `Contract ${contract.contractID} price paid`,
      contract.contractID,
      contract.issuerOwnerID,
    );
    adjustWallet(
      contract.issuerWallet,
      contract.price,
      `Contract ${contract.contractID} price received`,
      contract.contractID,
      acceptorOwnerID,
    );
  }
  if (contract.rewardEscrow > 0) {
    adjustWallet(
      acceptorWalletRef,
      contract.rewardEscrow,
      `Contract ${contract.contractID} reward received`,
      contract.contractID,
      contract.issuerOwnerID,
    );
  }

  const now = nowFileTimeString();
  const next = {
    ...contract,
    status: CONTRACT_STATUS.FINISHED,
    acceptorID: acceptForCorp ? getSessionCorporationID(session) : getSessionCharacterID(session),
    acceptorWallet: cloneWalletRef(acceptorWalletRef),
    acceptorWalletKey: acceptorWalletRef.kind === "corporation" ? acceptorWalletRef.accountKey : null,
    dateAccepted: now,
    dateCompleted: now,
    rewardEscrow: 0,
    rewardPaid: contract.rewardEscrow > 0,
    items: offeredTransfer.rows,
    updatedAtMs: Date.now(),
  };
  putContractRecord(next);
  syncInventoryChangesToSession(session, [...requestedChanges, ...offeredTransfer.changes]);
  return next;
}

function getPackageWrap(contract) {
  const wrapItemID = toPositiveInteger(contract && contract.plasticWrapItemID, 0);
  return wrapItemID ? findItemById(wrapItemID) : null;
}

function acceptCourier(contract, session, acceptForCorp) {
  const acceptorOwnerID = getOwnedContractSourceID(session, acceptForCorp);
  const acceptorWalletRef = buildWalletRef(session, acceptForCorp);
  ensureWalletFunds(acceptorWalletRef, contract.collateral, "Courier collateral");

  const wrap = getPackageWrap(contract);
  if (!wrap) {
    throwContractError("The courier package could not be found.");
  }

  if (contract.collateral > 0) {
    adjustWallet(
      acceptorWalletRef,
      -contract.collateral,
      `Contract ${contract.contractID} collateral escrow`,
      contract.contractID,
      contract.issuerOwnerID,
    );
  }

  const transferResult = transferItemToOwnerLocation(
    wrap.itemID,
    acceptorOwnerID,
    contract.startStationID,
    getAcceptorDeliveryFlag(acceptForCorp),
    null,
  );
  if (!transferResult.success) {
    throwContractError(`Failed to transfer courier package: ${transferResult.errorMsg || "item move failed"}.`);
  }

  const now = nowFileTimeString();
  const next = {
    ...contract,
    status: CONTRACT_STATUS.IN_PROGRESS,
    acceptorID: acceptForCorp ? getSessionCorporationID(session) : getSessionCharacterID(session),
    acceptorWallet: cloneWalletRef(acceptorWalletRef),
    acceptorWalletKey: acceptorWalletRef.kind === "corporation" ? acceptorWalletRef.accountKey : null,
    dateAccepted: now,
    collateralEscrow: contract.collateral,
    updatedAtMs: Date.now(),
  };
  putContractRecord(next);
  syncInventoryChangesToSession(session, transferResult.data && transferResult.data.changes);
  return next;
}

function acceptContract(contractID, session, acceptForCorp = false) {
  const contract = getContractRecord(contractID);
  if (!contract) {
    return null;
  }
  if (!canAcceptContract(contract, session)) {
    throwContractError("This contract is not available to accept.");
  }
  if (isIssuedBySession(contract, session) && !isAssignedToSession(contract, session)) {
    throwContractError("You cannot accept your own unassigned contract.");
  }

  let acceptedContract = null;
  if (contract.type === CONTRACT_TYPE.ITEM_EXCHANGE) {
    acceptedContract = acceptItemExchange(
      contract,
      session,
      normalizeBoolean(acceptForCorp, false),
    );
  } else if (contract.type === CONTRACT_TYPE.COURIER) {
    acceptedContract = acceptCourier(
      contract,
      session,
      normalizeBoolean(acceptForCorp, false),
    );
  }

  if (acceptedContract) {
    sendContractAcceptedNotification(acceptedContract, session);
  }
  return acceptedContract;
}

function listPackageContentItems(contract) {
  return listContainerItems(
    CONTRACT_ESCROW_OWNER_ID,
    contract.packageLocationID || contract.escrowLocationID,
    null,
  )
    .filter((item) => toPositiveInteger(item.itemID, 0) !== toPositiveInteger(contract.plasticWrapItemID, 0))
    .sort((left, right) => toPositiveInteger(left.itemID, 0) - toPositiveInteger(right.itemID, 0));
}

function transferPackageContents(contract, destinationOwnerID, destinationLocationID, destinationFlagID) {
  const changes = [];
  for (const item of listPackageContentItems(contract)) {
    const transferResult = destinationOwnerID === toPositiveInteger(item.ownerID, 0)
      ? moveItemToLocation(item.itemID, destinationLocationID, destinationFlagID, null)
      : transferItemToOwnerLocation(
        item.itemID,
        destinationOwnerID,
        destinationLocationID,
        destinationFlagID,
        null,
      );
    if (!transferResult.success) {
      throwContractError(`Failed to transfer package item ${item.itemID}.`);
    }
    const transferChanges = (transferResult.data && transferResult.data.changes) || [];
    changes.push(...transferChanges);
    const movedItem = findMovedItem(
      transferChanges,
      destinationLocationID,
      item.itemID,
      item.typeID,
    );
    if (movedItem && destinationOwnerID !== toPositiveInteger(item.ownerID, 0)) {
      changes.push(...transferContainedItemsToOwner(movedItem.itemID, destinationOwnerID));
    }
  }
  return changes;
}

function removePlasticWrap(contract) {
  const wrap = getPackageWrap(contract);
  if (!wrap) {
    return [];
  }
  const removeResult = removeInventoryItem(wrap.itemID, { removeContents: false });
  if (!removeResult.success) {
    throwContractError(`Failed to remove courier package ${wrap.itemID}.`);
  }
  return (removeResult.data && removeResult.data.changes) || [];
}

function completeCourierContract(contract, session) {
  if (contract.status !== CONTRACT_STATUS.IN_PROGRESS) {
    throwContractError("Only in-progress courier contracts can be completed.");
  }
  const wrap = getPackageWrap(contract);
  const acceptorOwnerID = toPositiveInteger(contract.acceptorWallet && contract.acceptorWallet.ownerID, 0);
  if (
    !wrap ||
    toPositiveInteger(wrap.ownerID, 0) !== acceptorOwnerID ||
    toPositiveInteger(wrap.locationID, 0) !== toPositiveInteger(contract.endStationID, 0)
  ) {
    throwContractError("The courier package must be intact at the destination.");
  }

  const contentChanges = transferPackageContents(
    contract,
    contract.issuerOwnerID,
    contract.endStationID,
    getOwnerDeliveryFlag(normalizeBoolean(contract.forCorp, false), contract.startStationDivision),
  );
  const removeChanges = removePlasticWrap(contract);
  if (contract.collateralEscrow > 0) {
    adjustWallet(
      contract.acceptorWallet,
      contract.collateralEscrow,
      `Contract ${contract.contractID} collateral returned`,
      contract.contractID,
      contract.issuerOwnerID,
    );
  }
  if (contract.rewardEscrow > 0) {
    adjustWallet(
      contract.acceptorWallet,
      contract.rewardEscrow,
      `Contract ${contract.contractID} reward paid`,
      contract.contractID,
      contract.issuerOwnerID,
    );
  }

  const next = {
    ...contract,
    status: CONTRACT_STATUS.FINISHED,
    dateCompleted: nowFileTimeString(),
    collateralEscrow: 0,
    rewardEscrow: 0,
    collateralCredited: true,
    rewardPaid: contract.rewardEscrow > 0,
    updatedAtMs: Date.now(),
  };
  putContractRecord(next);
  syncInventoryChangesToSession(session, [...contentChanges, ...removeChanges]);
  return true;
}

function failCourierContract(contract, session) {
  if (contract.status !== CONTRACT_STATUS.IN_PROGRESS) {
    throwContractError("Only in-progress courier contracts can be failed.");
  }
  const acceptorOwnerID = toPositiveInteger(contract.acceptorWallet && contract.acceptorWallet.ownerID, 0);
  const wrap = getPackageWrap(contract);
  const destinationLocationID = toPositiveInteger(wrap && wrap.locationID, contract.startStationID);
  const destinationFlagID = toPositiveInteger(wrap && wrap.flagID, getAcceptorDeliveryFlag(false));
  const contentChanges = transferPackageContents(
    contract,
    acceptorOwnerID,
    destinationLocationID,
    destinationFlagID,
  );
  const removeChanges = removePlasticWrap(contract);

  if (contract.collateralEscrow > 0) {
    adjustWallet(
      contract.issuerWallet,
      contract.collateralEscrow,
      `Contract ${contract.contractID} collateral paid to issuer`,
      contract.contractID,
      acceptorOwnerID,
    );
  }
  if (contract.rewardEscrow > 0) {
    adjustWallet(
      contract.issuerWallet,
      contract.rewardEscrow,
      `Contract ${contract.contractID} reward escrow refunded`,
      contract.contractID,
      acceptorOwnerID,
    );
  }

  const next = {
    ...contract,
    status: CONTRACT_STATUS.FAILED,
    dateCompleted: nowFileTimeString(),
    collateralEscrow: 0,
    rewardEscrow: 0,
    collateralCredited: true,
    updatedAtMs: Date.now(),
  };
  putContractRecord(next);
  syncInventoryChangesToSession(session, [...contentChanges, ...removeChanges]);
  return true;
}

function completeContract(contractID, targetStatus, session) {
  const contract = getContractRecord(contractID);
  if (!contract) {
    return false;
  }
  const normalizedStatus = toInteger(targetStatus, CONTRACT_STATUS.FINISHED);

  if (normalizedStatus === CONTRACT_STATUS.REJECTED) {
    if (!isAssignedToSession(contract, session)) {
      throwContractError("This contract is not assigned to you.");
    }
    if (contract.status !== CONTRACT_STATUS.OUTSTANDING) {
      throwContractError("Only outstanding contracts can be rejected.");
    }
    putContractRecord({
      ...contract,
      status: CONTRACT_STATUS.REJECTED,
      dateCompleted: nowFileTimeString(),
      updatedAtMs: Date.now(),
    });
    return true;
  }

  if (contract.type !== CONTRACT_TYPE.COURIER) {
    return false;
  }
  if (normalizedStatus === CONTRACT_STATUS.FINISHED) {
    return completeCourierContract(contract, session);
  }
  if (normalizedStatus === CONTRACT_STATUS.FAILED) {
    return failCourierContract(contract, session);
  }
  return false;
}

function returnOutstandingEscrow(contract, session) {
  const changes = [];
  if (contract.type === CONTRACT_TYPE.ITEM_EXCHANGE) {
    const returned = transferEscrowRowsToOwner(
      contract,
      contract.issuerOwnerID,
      contract.startStationID,
      getOwnerDeliveryFlag(normalizeBoolean(contract.forCorp, false), contract.startStationDivision),
    );
    changes.push(...returned.changes);
    contract.items = returned.rows;
  } else if (contract.type === CONTRACT_TYPE.COURIER) {
    changes.push(...transferPackageContents(
      contract,
      contract.issuerOwnerID,
      contract.startStationID,
      getOwnerDeliveryFlag(normalizeBoolean(contract.forCorp, false), contract.startStationDivision),
    ));
    changes.push(...removePlasticWrap(contract));
  }

  if (contract.rewardEscrow > 0) {
    adjustWallet(
      contract.issuerWallet,
      contract.rewardEscrow,
      `Contract ${contract.contractID} reward escrow refunded`,
      contract.contractID,
      0,
    );
    contract.rewardEscrow = 0;
  }
  syncInventoryChangesToSession(session, changes);
  return changes;
}

function deleteContract(contractID, session) {
  const contract = getContractRecord(contractID);
  if (!contract) {
    return false;
  }
  if (!isIssuedBySession(contract, session)) {
    throwContractError("Only the issuer can delete this contract.");
  }

  const next = {
    ...contract,
    updatedAtMs: Date.now(),
  };
  if (
    contract.status === CONTRACT_STATUS.OUTSTANDING ||
    contract.status === CONTRACT_STATUS.REJECTED
  ) {
    returnOutstandingEscrow(next, session);
  } else {
    throwContractUserError("ConContractNotOutstanding");
  }
  next.status = CONTRACT_STATUS.DELETED;
  next.dateCompleted = next.dateCompleted && next.dateCompleted !== "0"
    ? next.dateCompleted
    : nowFileTimeString();
  next.rewardEscrow = 0;
  putContractRecord(next);
  return true;
}

function deleteMultipleContracts(contractIDs, session) {
  const deleted = [];
  const failed = [];
  const ids = Array.isArray(contractIDs) ? contractIDs : [];
  for (const contractID of ids) {
    try {
      if (deleteContract(contractID, session)) {
        deleted.push(toPositiveInteger(contractID, 0));
      } else {
        failed.push(toPositiveInteger(contractID, 0));
      }
    } catch (error) {
      failed.push(toPositiveInteger(contractID, 0));
    }
  }
  return { deleted, failed };
}

function getCourierContractFromItemID(itemID, session = null) {
  const normalizedItemID = toPositiveInteger(itemID, 0);
  if (!normalizedItemID) {
    return null;
  }
  const contract = listContractRecords().find((record) => (
    record.type === CONTRACT_TYPE.COURIER &&
    record.status === CONTRACT_STATUS.IN_PROGRESS &&
    toPositiveInteger(record.plasticWrapItemID, 0) === normalizedItemID
  ));
  if (!contract) {
    return null;
  }
  if (session && contract.acceptorID) {
    const allowed = contract.acceptorID === getSessionCharacterID(session) ||
      contract.acceptorID === getSessionCorporationID(session);
    if (!allowed) {
      return null;
    }
  }
  return cloneValue(contract);
}

function contractMatchesOwner(contract, ownerID) {
  const normalizedOwnerID = toPositiveInteger(ownerID, 0);
  return Boolean(
    normalizedOwnerID &&
    (
      toPositiveInteger(contract.issuerID, 0) === normalizedOwnerID ||
      toPositiveInteger(contract.issuerCorpID, 0) === normalizedOwnerID ||
      toPositiveInteger(contract.acceptorID, 0) === normalizedOwnerID ||
      toPositiveInteger(contract.assigneeID, 0) === normalizedOwnerID
    ),
  );
}

function filterContractsForOwner(ownerID, options = {}) {
  const status = toInteger(options.status, null);
  const contractType = toInteger(options.contractType, 0);
  const includeCombinedItemSearch = contractType === 10 || contractType === 11 || contractType === 0;

  return listContractRecords()
    .filter((contract) => contractMatchesOwner(contract, ownerID))
    .filter((contract) => {
      if (status === null) {
        return true;
      }
      if (status === CONTRACT_STATUS.REQUIRES_ATTENTION) {
        return (
        isContractExpired(contract) ||
        contract.status === CONTRACT_STATUS.REJECTED ||
        contract.status === CONTRACT_STATUS.FAILED
        );
      }
      return contract.status === status;
    })
    .filter((contract) => (
      includeCombinedItemSearch ||
      contract.type === contractType
    ))
    .sort((left, right) => toPositiveInteger(right.contractID, 0) - toPositiveInteger(left.contractID, 0));
}

function filterMyCurrentContracts(session, isAccepted = false, forCorp = false) {
  const ownerID = forCorp ? getSessionCorporationID(session) : getSessionCharacterID(session);
  return listContractRecords()
    .filter((contract) => {
      if (isAccepted) {
        return toPositiveInteger(contract.acceptorID, 0) === ownerID;
      }
      return forCorp
        ? normalizeBoolean(contract.forCorp, false) && toPositiveInteger(contract.issuerCorpID, 0) === ownerID
        : toPositiveInteger(contract.issuerID, 0) === ownerID;
    })
    .filter((contract) => (
      contract.status === CONTRACT_STATUS.OUTSTANDING ||
      contract.status === CONTRACT_STATUS.IN_PROGRESS
    ))
    .sort((left, right) => toPositiveInteger(right.contractID, 0) - toPositiveInteger(left.contractID, 0));
}

function filterExpiredContracts(session, forCorp = false) {
  const ownerID = forCorp ? getSessionCorporationID(session) : getSessionCharacterID(session);
  return listContractRecords()
    .filter((contract) => contractMatchesOwner(contract, ownerID))
    .filter((contract) => (
      isContractExpired(contract) ||
      contract.status === CONTRACT_STATUS.REJECTED ||
      contract.status === CONTRACT_STATUS.FAILED
    ))
    .sort((left, right) => toPositiveInteger(right.contractID, 0) - toPositiveInteger(left.contractID, 0));
}

function isContractVisibleInSearch(contract, session, availabilityFilter = null) {
  if (!contract || contract.status !== CONTRACT_STATUS.OUTSTANDING || isContractExpired(contract)) {
    return false;
  }
  const availability = toInteger(availabilityFilter, CONTRACT_AVAILABILITY.PUBLIC);
  if (availabilityFilter === null || availabilityFilter === undefined) {
    return contract.availability === CONTRACT_AVAILABILITY.PUBLIC || canAcceptContract(contract, session);
  }
  if (availability === CONTRACT_AVAILABILITY.PUBLIC) {
    return contract.availability === CONTRACT_AVAILABILITY.PUBLIC;
  }
  if (availability === CONTRACT_AVAILABILITY.MYSELF) {
    return contractMatchesOwner(contract, getSessionCharacterID(session));
  }
  if (availability === CONTRACT_AVAILABILITY.MY_CORP) {
    return contractMatchesOwner(contract, getSessionCorporationID(session));
  }
  if (availability === CONTRACT_AVAILABILITY.MY_ALLIANCE) {
    return toPositiveInteger(contract.assigneeID, 0) === getSessionAllianceID(session);
  }
  return false;
}

function normalizeNumericSet(rawValue, options = {}) {
  const unwrapped = unwrapMarshalValue(rawValue);
  if (unwrapped === null || unwrapped === undefined || unwrapped === false || unwrapped === "") {
    return new Set();
  }
  const allowZero = Boolean(options.allowZero);
  const values = Array.isArray(unwrapped)
    ? unwrapped
    : unwrapped && typeof unwrapped === "object"
      ? Object.values(unwrapped)
      : [unwrapped];
  return new Set(
    values
      .map((value) => allowZero ? toInteger(value, Number.NaN) : toPositiveInteger(value, 0))
      .filter((value) => Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)),
  );
}

function normalizeItemTypeSet(rawValue) {
  const pairs = normalizePairList(rawValue)
    .map(([typeID]) => typeID)
    .filter((typeID) => typeID > 0);
  if (pairs.length > 0) {
    return new Set(pairs);
  }
  return normalizeNumericSet(rawValue);
}

function getContractStationID(contract, endpoint = "start") {
  return toPositiveInteger(
    endpoint === "end" ? contract && contract.endStationID : contract && contract.startStationID,
    0,
  );
}

function getContractSolarSystemID(contract, endpoint = "start") {
  const direct = toPositiveInteger(
    endpoint === "end" ? contract && contract.endSolarSystemID : contract && contract.startSolarSystemID,
    0,
  );
  if (direct > 0) {
    return direct;
  }
  const stationID = getContractStationID(contract, endpoint);
  const station = stationID > 0 ? worldData.getStationByID(stationID) : null;
  const structure = stationID > 0 && !station ? worldData.getStructureByID(stationID) : null;
  return toPositiveInteger(
    (station && station.solarSystemID) || (structure && structure.solarSystemID),
    0,
  );
}

function getContractRegionID(contract, endpoint = "start") {
  const direct = toPositiveInteger(
    endpoint === "end" ? contract && contract.endRegionID : contract && contract.startRegionID,
    0,
  );
  if (direct > 0) {
    return direct;
  }
  const system = worldData.getSolarSystemByID(getContractSolarSystemID(contract, endpoint));
  return toPositiveInteger(system && system.regionID, 0);
}

function getContractConstellationID(contract, endpoint = "start") {
  const direct = toPositiveInteger(
    endpoint === "end" ? contract && contract.endConstellationID : contract && contract.startConstellationID,
    0,
  );
  if (direct > 0) {
    return direct;
  }
  const system = worldData.getSolarSystemByID(getContractSolarSystemID(contract, endpoint));
  return toPositiveInteger(system && system.constellationID, 0);
}

function resolveLocationScope(locationID) {
  const normalizedLocationID = toPositiveInteger(locationID, 0);
  if (!normalizedLocationID) {
    return { kind: "none", locationID: 0 };
  }
  if (
    worldData.getStationByID(normalizedLocationID) ||
    worldData.getStructureByID(normalizedLocationID)
  ) {
    return { kind: "station", locationID: normalizedLocationID };
  }
  if (
    (normalizedLocationID >= 30000000 && normalizedLocationID < 40000000) ||
    worldData.getSolarSystemByID(normalizedLocationID)
  ) {
    return { kind: "system", locationID: normalizedLocationID };
  }
  if (normalizedLocationID >= 20000000 && normalizedLocationID < 30000000) {
    return { kind: "constellation", locationID: normalizedLocationID };
  }
  if (normalizedLocationID >= 10000000 && normalizedLocationID < 20000000) {
    return { kind: "region", locationID: normalizedLocationID };
  }
  return { kind: "station", locationID: normalizedLocationID };
}

function contractMatchesLocation(contract, locationID, endpoint = "start") {
  const scope = resolveLocationScope(locationID);
  if (!scope.locationID) {
    return true;
  }
  if (scope.kind === "station") {
    return getContractStationID(contract, endpoint) === scope.locationID;
  }
  if (scope.kind === "system") {
    return getContractSolarSystemID(contract, endpoint) === scope.locationID;
  }
  if (scope.kind === "constellation") {
    return getContractConstellationID(contract, endpoint) === scope.locationID;
  }
  if (scope.kind === "region") {
    return getContractRegionID(contract, endpoint) === scope.locationID;
  }
  return false;
}

function getContractSearchItems(contract) {
  return [
    ...((contract && Array.isArray(contract.items)) ? contract.items : []),
    ...((contract && Array.isArray(contract.packageItems)) ? contract.packageItems : []),
  ];
}

function getContractOfferedItems(contract) {
  return getContractSearchItems(contract).filter((item) => (
    !Object.prototype.hasOwnProperty.call(item, "inCrate") ||
    normalizeBoolean(item.inCrate, true)
  ));
}

function contractHasRequestedItems(contract) {
  return (contract && Array.isArray(contract.items) ? contract.items : [])
    .some((item) => !normalizeBoolean(item && item.inCrate, false));
}

function contractMatchesItemFilters(contract, filters, itemTypes) {
  const items = getContractSearchItems(contract);
  if (itemTypes.size > 0 && !items.some((item) => itemTypes.has(toPositiveInteger(item && item.itemTypeID, 0)))) {
    return false;
  }

  const itemCategoryID = toPositiveInteger(filters.itemCategoryID, 0);
  if (
    itemCategoryID > 0 &&
    !items.some((item) => toPositiveInteger(getItemMetadata(item && item.itemTypeID).categoryID, 0) === itemCategoryID)
  ) {
    return false;
  }

  const itemGroupID = toPositiveInteger(filters.itemGroupID, 0);
  if (
    itemGroupID > 0 &&
    !items.some((item) => toPositiveInteger(getItemMetadata(item && item.itemTypeID).groupID, 0) === itemGroupID)
  ) {
    return false;
  }

  const itemTypeName = normalizeText(filters.itemTypeName, "").trim().toLowerCase();
  if (
    itemTypeName &&
    !items.some((item) => normalizeText(getItemMetadata(item && item.itemTypeID).name, "").toLowerCase().includes(itemTypeName))
  ) {
    return false;
  }

  const searchHint = toInteger(filters.searchHint, 0);
  if (searchHint === CONTRACT_SEARCH_HINT.BPO || searchHint === CONTRACT_SEARCH_HINT.BPC) {
    const wantsCopy = searchHint === CONTRACT_SEARCH_HINT.BPC;
    return items.some((item) => (
      toPositiveInteger(getItemMetadata(item && item.itemTypeID).categoryID, 0) === 9 &&
      normalizeBoolean(item && item.copy, false) === wantsCopy
    ));
  }

  return true;
}

function hasFilterValue(value) {
  return value !== null && value !== undefined && value !== false && value !== "";
}

function contractMatchesRange(value, minValue, maxValue, normalizer) {
  const normalizedValue = normalizer(value, 0);
  if (hasFilterValue(minValue) && normalizedValue < normalizer(minValue, 0)) {
    return false;
  }
  if (hasFilterValue(maxValue) && normalizedValue > normalizer(maxValue, Number.MAX_SAFE_INTEGER)) {
    return false;
  }
  return true;
}

function securityClassFromLevel(level) {
  const security = Number(level);
  if (!Number.isFinite(security)) {
    return null;
  }
  if (security <= 0.0) {
    return SECURITY_CLASS.ZERO_SEC;
  }
  if (security < 0.45) {
    return SECURITY_CLASS.LOW_SEC;
  }
  if (security < 0.95) {
    return SECURITY_CLASS.HIGH_SEC;
  }
  return SECURITY_CLASS.SAFE_SEC;
}

function getSolarSystemSecurityClass(solarSystemID) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  return system ? securityClassFromLevel(system.security ?? system.securityStatus) : null;
}

function contractMatchesSecurityClasses(contract, securityClasses) {
  if (securityClasses.size <= 0) {
    return true;
  }
  const startSecurityClass = getSolarSystemSecurityClass(getContractSolarSystemID(contract, "start"));
  return startSecurityClass !== null && securityClasses.has(startSecurityClass);
}

function contractMatchesDescription(contract, description) {
  const needle = normalizeText(description, "").trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    contract && contract.title,
    contract && contract.description,
  ].map((value) => normalizeText(value, "").toLowerCase()).join("\n");
  return haystack.includes(needle);
}

function contractMatchesType(contract, contractType) {
  if (!contractType || contractType === 11) {
    return true;
  }
  if (contractType === 10) {
    return contract.type === CONTRACT_TYPE.ITEM_EXCHANGE ||
      contract.type === CONTRACT_TYPE.AUCTION;
  }
  return contract.type === contractType;
}

function compareSearchValues(leftValue, rightValue) {
  if (typeof leftValue === "bigint" || typeof rightValue === "bigint") {
    const leftBigInt = typeof leftValue === "bigint" ? leftValue : BigInt(toInteger(leftValue, 0));
    const rightBigInt = typeof rightValue === "bigint" ? rightValue : BigInt(toInteger(rightValue, 0));
    return leftBigInt < rightBigInt ? -1 : leftBigInt > rightBigInt ? 1 : 0;
  }
  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return normalizeText(leftValue, "").localeCompare(normalizeText(rightValue, ""));
}

function getSearchSortValue(contract, sortBy) {
  switch (sortBy) {
    case CONTRACT_SEARCH_SORT.PRICE:
      return normalizeMoney(contract && contract.price, 0);
    case CONTRACT_SEARCH_SORT.EXPIRED:
      return toFileTimeBigInt(contract && contract.dateExpired);
    case CONTRACT_SEARCH_SORT.STATION_ID:
      return getContractStationID(contract, "start");
    case CONTRACT_SEARCH_SORT.SOLARSYSTEM_ID:
      return getContractSolarSystemID(contract, "start");
    case CONTRACT_SEARCH_SORT.REGION_ID:
      return getContractRegionID(contract, "start");
    case CONTRACT_SEARCH_SORT.CONSTELLATION_ID:
      return getContractConstellationID(contract, "start");
    case CONTRACT_SEARCH_SORT.CONTRACT_TYPE:
      return toPositiveInteger(contract && contract.type, 0);
    case CONTRACT_SEARCH_SORT.REWARD:
      return normalizeMoney(contract && contract.reward, 0);
    case CONTRACT_SEARCH_SORT.COLLATERAL:
      return normalizeMoney(contract && contract.collateral, 0);
    case CONTRACT_SEARCH_SORT.VOLUME:
      return normalizeNumber(contract && contract.volume, 0);
    case CONTRACT_SEARCH_SORT.ASSIGNEE_ID:
      return toPositiveInteger(contract && contract.assigneeID, 0);
    case CONTRACT_SEARCH_SORT.ID:
    default:
      return toPositiveInteger(contract && contract.contractID, 0);
  }
}

function sortSearchContracts(contracts, filters = {}) {
  const hasExplicitSort = hasFilterValue(filters.sortBy) || hasFilterValue(filters.sortDir);
  const sortBy = hasFilterValue(filters.sortBy)
    ? toInteger(filters.sortBy, CONTRACT_SEARCH_SORT.ID)
    : CONTRACT_SEARCH_SORT.ID;
  const descending = hasExplicitSort
    ? toInteger(filters.sortDir, 0) !== 0
    : true;

  contracts.sort((left, right) => {
    let comparison = compareSearchValues(
      getSearchSortValue(left, sortBy),
      getSearchSortValue(right, sortBy),
    );
    if (descending) {
      comparison *= -1;
    }
    if (comparison !== 0) {
      return comparison;
    }
    return toPositiveInteger(right && right.contractID, 0) -
      toPositiveInteger(left && left.contractID, 0);
  });
}

function searchContracts(session, filters = {}) {
  const startedAt = Date.now();
  const contractType = toInteger(filters.contractType, 0);
  const itemTypes = normalizeItemTypeSet(filters.itemTypes);
  const securityClasses = normalizeNumericSet(filters.securityClasses, { allowZero: true });
  const startNum = Math.max(0, toInteger(filters.startNum, 0));

  let contracts = listContractRecords()
    .filter((contract) => isContractVisibleInSearch(contract, session, filters.availability))
    .filter((contract) => contractMatchesType(contract, contractType))
    .filter((contract) => contractMatchesLocation(contract, filters.locationID, "start"))
    .filter((contract) => contractMatchesLocation(contract, filters.endLocationID, "end"))
    .filter((contract) => !filters.issuerID || (
      contract.issuerID === toPositiveInteger(filters.issuerID, 0) ||
      contract.issuerCorpID === toPositiveInteger(filters.issuerID, 0)
    ))
    .filter((contract) => contractMatchesRange(contract.price, filters.minPrice, filters.maxPrice, normalizeMoney))
    .filter((contract) => contractMatchesRange(contract.reward, filters.minReward, filters.maxReward, normalizeMoney))
    .filter((contract) => contractMatchesRange(contract.collateral, filters.minCollateral, filters.maxCollateral, normalizeMoney))
    .filter((contract) => contractMatchesRange(contract.volume, filters.minVolume, filters.maxVolume, normalizeNumber))
    .filter((contract) => !normalizeBoolean(filters.excludeTrade, false) || !contractHasRequestedItems(contract))
    .filter((contract) => !normalizeBoolean(filters.excludeMultiple, false) || getContractOfferedItems(contract).length <= 1)
    .filter((contract) => !normalizeBoolean(filters.excludeNoBuyout, false) || contract.type !== CONTRACT_TYPE.AUCTION || normalizeMoney(contract.price, 0) > 0)
    .filter((contract) => contractMatchesDescription(contract, filters.description))
    .filter((contract) => contractMatchesSecurityClasses(contract, securityClasses))
    .filter((contract) => contractMatchesItemFilters(contract, filters, itemTypes));

  sortSearchContracts(contracts, filters);
  const numFound = contracts.length;
  return {
    contracts: contracts.slice(startNum, startNum + CONTRACTS_PER_PAGE),
    numFound,
    searchTime: Math.max(0, Date.now() - startedAt) * (SECOND_FILETIME_TICKS / 1000),
  };
}

function collectMyPageInfo(session) {
  const characterID = getSessionCharacterID(session);
  const corporationID = getSessionCorporationID(session);
  const allianceID = getSessionAllianceID(session);
  const now = currentFileTime();
  const outstandingContracts = [];
  let nonCorp = 0;
  let corp = 0;
  let inProgress = 0;
  let inProgressCorp = 0;
  let requiresAttention = 0;
  let requiresAttentionCorp = 0;

  for (const contract of listContractRecords()) {
    const isCorpContract = normalizeBoolean(contract.forCorp, false);
    const isPersonalIssuer = contract.issuerID === characterID && !isCorpContract;
    const isCorpIssuer = isCorpContract && contract.issuerCorpID === corporationID;
    const isPersonalAcceptor = contract.acceptorID === characterID;
    const isCorpAcceptor = contract.acceptorID === corporationID;
    const isAssignedToCharacter = contract.assigneeID === characterID;
    const isAssignedToCorpOrAlliance = contract.assigneeID === corporationID ||
      (allianceID > 0 && contract.assigneeID === allianceID);
    const needsAttention = (
      contract.status === CONTRACT_STATUS.REJECTED ||
      contract.status === CONTRACT_STATUS.FAILED ||
      (
        contract.status === CONTRACT_STATUS.OUTSTANDING &&
        toFileTimeBigInt(contract.dateExpired) < now
      )
    );

    if (contract.status === CONTRACT_STATUS.OUTSTANDING) {
      if (isPersonalIssuer) {
        nonCorp += 1;
      }
      if (isCorpIssuer) {
        corp += 1;
      }
      if (isAssignedToCharacter || isAssignedToCorpOrAlliance) {
        outstandingContracts.push([
          toPositiveInteger(contract.issuerID, 0),
          toPositiveInteger(contract.issuerCorpID, 0),
          toPositiveInteger(contract.assigneeID, 0),
          toPositiveInteger(contract.type, 0),
        ]);
      }
    }

    if (contract.status === CONTRACT_STATUS.IN_PROGRESS) {
      if (isPersonalAcceptor) {
        inProgress += 1;
      }
      if (isCorpAcceptor) {
        inProgressCorp += 1;
      }
    }

    if (needsAttention) {
      if (isPersonalIssuer || isPersonalAcceptor) {
        requiresAttention += 1;
      }
      if (isCorpIssuer || isCorpAcceptor) {
        requiresAttentionCorp += 1;
      }
    }
  }

  return {
    numInProgressCorp: inProgressCorp,
    numOutstandingContractsNonCorp: nonCorp,
    numOutstandingContractsForCorp: corp,
    numOutstandingContracts: nonCorp + corp,
    numBiddingOn: 0,
    numRequiresAttentionCorp: requiresAttentionCorp,
    numInProgress: inProgress,
    numBiddingOnCorp: 0,
    outstandingContracts,
    numRequiresAttention: requiresAttention,
    numContractsLeftCorp: 0,
  };
}

function getMyContractEscrow(session) {
  const characterID = getSessionCharacterID(session);
  const corporationID = getSessionCorporationID(session);
  let iskEscrow = 0;
  let itemsEscrow = 0;
  for (const contract of listContractRecords()) {
    const issuedByMe = contract.issuerID === characterID ||
      (
        normalizeBoolean(contract.forCorp, false) &&
        contract.issuerCorpID === corporationID
      );
    if (!issuedByMe) {
      continue;
    }
    iskEscrow += normalizeMoney(contract.rewardEscrow, 0);
    itemsEscrow += (contract.items || []).filter((row) => row.inCrate).length +
      (contract.packageItems || []).length;
  }
  return {
    iskEscrow: Math.round(iskEscrow * 100) / 100,
    itemsEscrow,
  };
}

function buildLoginInfoRows(session) {
  const characterID = getSessionCharacterID(session);
  const corporationID = getSessionCorporationID(session);
  const allianceID = getSessionAllianceID(session);
  const now = currentFileTime();
  const needsAttention = [];
  const inProgress = [];
  const assignedToMe = [];

  for (const contract of listContractRecords()) {
    const isIssuer = contract.issuerID === characterID ||
      (normalizeBoolean(contract.forCorp, false) && contract.issuerCorpID === corporationID);
    const isAcceptor = contract.acceptorID === characterID || contract.acceptorID === corporationID;
    const isAssigned = contract.assigneeID === characterID ||
      contract.assigneeID === corporationID ||
      (allianceID > 0 && contract.assigneeID === allianceID);

    if (
      (isIssuer || isAcceptor) &&
      (
        contract.status === CONTRACT_STATUS.REJECTED ||
        contract.status === CONTRACT_STATUS.FAILED ||
        (
          contract.status === CONTRACT_STATUS.OUTSTANDING &&
          toFileTimeBigInt(contract.dateExpired) < now
        )
      )
    ) {
      needsAttention.push([contract.contractID, contract.status]);
    }
    if (isAcceptor && contract.status === CONTRACT_STATUS.IN_PROGRESS) {
      inProgress.push([
        contract.contractID,
        contract.startStationID,
        contract.endStationID,
        toFileTimeBigInt(addFileTimeDays(contract.dateAccepted, contract.numDays)),
      ]);
    }
    if (isAssigned && contract.status === CONTRACT_STATUS.OUTSTANDING) {
      assignedToMe.push([contract.contractID, contract.issuerID]);
    }
  }

  return {
    needsAttention,
    inProgress,
    assignedToMe,
  };
}

module.exports = {
  TABLE,
  CONTRACT_TYPE,
  CONTRACT_STATUS,
  CONTRACT_AVAILABILITY,
  CONTRACT_ID_START,
  CONTRACT_ESCROW_LOCATION_BASE,
  PLASTIC_WRAP_TYPE_ID,
  DAY_FILETIME_TICKS,
  addFileTimeDays,
  toFileTimeBigInt,
  getContractEscrowLocationID,
  normalizeContractInfo,
  listContractRecords,
  getContractRecord,
  putContractRecord,
  createContract,
  acceptContract,
  completeContract,
  deleteContract,
  deleteMultipleContracts,
  getCourierContractFromItemID,
  filterContractsForOwner,
  filterMyCurrentContracts,
  filterExpiredContracts,
  searchContracts,
  collectMyPageInfo,
  getMyContractEscrow,
  buildLoginInfoRows,
  _testing: {
    resetForTests,
    collectContainedItems,
    transferContainedItemsToOwner,
    validateSelectedItem,
    getWalletBalance,
  },
};
