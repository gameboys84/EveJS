const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildObjectEx1,
  buildPackedRow,
  buildPythonSet,
  buildRowset,
  extractList,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  findItemById,
  getItemMetadata,
  ITEM_FLAGS,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const contractRuntime = require(path.join(
  __dirname,
  "../contracts/contractRuntimeState",
));
const worldData = require(path.join(__dirname, "../../space/worldData"));

const MAX_CONTRACTS_PER_SEARCH = 1000;
const CONTRACT_TYPE_ITEM_EXCHANGE = 1;
const CONTRACT_TYPE_AUCTION = 2;
const CONTRACT_TYPE_COURIER = 3;
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
];
const INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS = [
  [
    "stacksize",
    { type: "token", value: "eve.common.script.sys.eveCfg.StackSize" },
  ],
  [
    "singleton",
    { type: "token", value: "eve.common.script.sys.eveCfg.Singleton" },
  ],
];
const CONTRACT_DETAIL_ROW_DESCRIPTOR_COLUMNS = [
  ["contractID", 3],
  ["type", 3],
  ["issuerID", 3],
  ["issuerCorpID", 3],
  ["forCorp", 11],
  ["availability", 3],
  ["assigneeID", 3],
  ["acceptorID", 3],
  ["dateIssued", 64],
  ["dateExpired", 64],
  ["dateAccepted", 64],
  ["dateCompleted", 64],
  ["dateDeleted", 64],
  ["startStationID", 20],
  ["startSolarSystemID", 3],
  ["startRegionID", 3],
  ["endStationID", 20],
  ["endSolarSystemID", 3],
  ["endRegionID", 3],
  ["price", 5],
  ["reward", 5],
  ["collateral", 5],
  ["title", 130],
  ["description", 130],
  ["status", 3],
  ["crateID", 20],
  ["volume", 5],
  ["startStationDivision", 3],
  ["issuerWalletKey", 3],
  ["acceptorWalletKey", 3],
];
const CONTRACT_DETAIL_ITEM_ROW_DESCRIPTOR_COLUMNS = [
  ["contractID", 3],
  ["itemID", 20],
  ["quantity", 3],
  ["itemTypeID", 3],
  ["inCrate", 11],
  ["parentID", 20],
  ["productivityLevel", 3],
  ["materialLevel", 3],
  ["copy", 3],
  ["licensedProductionRunsRemaining", 3],
  ["damage", 5],
  ["flagID", 3],
  ["recordID", 20],
];
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

const auditEvents = [];

function getCharacterID(session) {
  return Number(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
  ) || 0;
}

function getCorporationID(session) {
  return Number(
    session &&
      (
        session.corporationID ||
        session.corpid ||
        session.corpID
      ),
  ) || 0;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = normalizeNumber(value, fallback);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric);
  }
  return fallback;
}

function compareItemsByID(left, right) {
  return normalizePositiveInteger(left && left.itemID, 0) -
    normalizePositiveInteger(right && right.itemID, 0);
}

function sameContractDivisionFlag(itemFlagID, selectedFlagID) {
  const normalizedItemFlagID = normalizePositiveInteger(itemFlagID, 0);
  const normalizedSelectedFlagID = normalizePositiveInteger(selectedFlagID, 0);
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

function getContractOwnerID(session, forCorp) {
  return forCorp ? getCorporationID(session) : getCharacterID(session);
}

function isAllowedContractSourceFlag(flagID, forCorp, selectedFlagID = 0) {
  const normalizedFlagID = normalizePositiveInteger(flagID, 0);
  if (forCorp) {
    if (!CORP_CONTRACT_ITEM_FLAGS.has(normalizedFlagID)) {
      return false;
    }
    const normalizedSelectedFlagID = normalizePositiveInteger(selectedFlagID, 0);
    return normalizedSelectedFlagID <= 0 ||
      sameContractDivisionFlag(normalizedFlagID, normalizedSelectedFlagID);
  }
  return normalizedFlagID === ITEM_FLAGS.HANGAR;
}

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null, kwargs = null) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    kwargs: kwargs || null,
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

function buildLoginInfo(rows = {}) {
  return buildKeyVal([
    ["needsAttention", buildRowset(["contractID", "state"], rows.needsAttention || [])],
    [
      "inProgress",
      buildRowset(
        ["contractID", "startStationID", "endStationID", "expires"],
        rows.inProgress || [],
      ),
    ],
    ["assignedToMe", buildRowset(["contractID", "issuerID"], rows.assignedToMe || [])],
  ]);
}

function buildEmptyContractBundle() {
  return buildContractListBundle([]);
}

function buildEmptyContractSearchResult() {
  return buildKeyVal([
    ["contracts", buildList([])],
    ["numFound", 0],
    ["searchTime", 0],
    ["maxResults", MAX_CONTRACTS_PER_SEARCH],
  ]);
}

function buildFiletime(value) {
  return contractRuntime.toFileTimeBigInt(value);
}

function buildContractRow(contract) {
  if (!contract) {
    return null;
  }
  return buildKeyVal([
    ["contractID", normalizePositiveInteger(contract.contractID, 0)],
    ["type", normalizePositiveInteger(contract.type, 0)],
    ["status", normalizeNumber(contract.status, 0)],
    ["availability", normalizeNumber(contract.availability, 0)],
    ["issuerID", normalizePositiveInteger(contract.issuerID, 0)],
    ["issuerCorpID", normalizePositiveInteger(contract.issuerCorpID, 0)],
    ["forCorp", normalizeBoolean(contract.forCorp, false)],
    ["assigneeID", normalizePositiveInteger(contract.assigneeID, 0)],
    ["acceptorID", normalizePositiveInteger(contract.acceptorID, 0)],
    ["acceptorWalletKey", contract.acceptorWalletKey === null || contract.acceptorWalletKey === undefined
      ? null
      : normalizePositiveInteger(contract.acceptorWalletKey, 0)],
    ["dateIssued", buildFiletime(contract.dateIssued)],
    ["dateExpired", buildFiletime(contract.dateExpired)],
    ["dateAccepted", buildFiletime(contract.dateAccepted)],
    ["dateCompleted", buildFiletime(contract.dateCompleted)],
    ["numDays", normalizePositiveInteger(contract.numDays, 0)],
    ["startStationID", normalizePositiveInteger(contract.startStationID, 0)],
    ["endStationID", normalizePositiveInteger(contract.endStationID, 0)],
    ["startSolarSystemID", normalizePositiveInteger(contract.startSolarSystemID, 0)],
    ["endSolarSystemID", normalizePositiveInteger(contract.endSolarSystemID, 0)],
    ["startRegionID", normalizePositiveInteger(contract.startRegionID, 0)],
    ["endRegionID", normalizePositiveInteger(contract.endRegionID, 0)],
    ["price", normalizeNumber(contract.price, 0)],
    ["reward", normalizeNumber(contract.reward, 0)],
    ["collateral", normalizeNumber(contract.collateral, 0)],
    ["volume", normalizeNumber(contract.volume, 0)],
    ["title", contract.title ? String(contract.title) : ""],
    ["description", contract.description ? String(contract.description) : ""],
  ]);
}

function buildContractItemRow(item) {
  return buildKeyVal([
    ["recordID", normalizePositiveInteger(item && item.recordID, 0)],
    ["itemID", normalizePositiveInteger(item && item.itemID, 0)],
    ["itemTypeID", normalizePositiveInteger(item && item.itemTypeID, 0)],
    ["typeID", normalizePositiveInteger(item && (item.typeID || item.itemTypeID), 0)],
    ["quantity", normalizePositiveInteger(item && item.quantity, 0)],
    ["inCrate", normalizeBoolean(item && item.inCrate, false)],
    ["parentID", normalizePositiveInteger(item && item.parentID, 0)],
    ["flagID", normalizePositiveInteger(item && item.flagID, 0)],
    ["copy", normalizeNumber(item && item.copy, 0)],
    [
      "licensedProductionRunsRemaining",
      normalizeNumber(item && item.licensedProductionRunsRemaining, 0),
    ],
    ["materialLevel", normalizeNumber(item && item.materialLevel, 0)],
    ["productivityLevel", normalizeNumber(item && item.productivityLevel, 0)],
    ["damage", normalizeNumber(item && item.damage, 0)],
  ]);
}

function buildContractItemList(contract) {
  return buildList(
    (contract && Array.isArray(contract.items) ? contract.items : [])
      .map(buildContractItemRow),
  );
}

function buildPythonObjectSet(items = []) {
  return buildObjectEx1("__builtin__.set", [
    buildList(Array.isArray(items) ? items : []),
  ]);
}

function buildOutstandingContractsKeyVal(session) {
  const pageInfo = contractRuntime.collectMyPageInfo(session);
  const personalOutstanding = normalizePositiveInteger(
    pageInfo.numOutstandingContractsNonCorp,
    0,
  );
  const corpOutstanding = normalizePositiveInteger(
    pageInfo.numOutstandingContractsForCorp,
    0,
  );
  return buildKeyVal([
    ["nonCorpForMyChar", personalOutstanding],
    ["myCorpTotal", corpOutstanding],
    ["nonCorpForMyCorp", corpOutstanding],
    ["myCharTotal", personalOutstanding],
  ]);
}

function buildContractDetailContractRow(contract) {
  if (!contract) {
    return null;
  }
  const issuerWalletKey =
    contract.issuerWallet && contract.issuerWallet.kind === "corporation"
      ? normalizePositiveInteger(contract.issuerWallet.accountKey, 0)
      : null;
  return buildPackedRow(CONTRACT_DETAIL_ROW_DESCRIPTOR_COLUMNS, {
    contractID: normalizePositiveInteger(contract.contractID, 0),
    type: normalizePositiveInteger(contract.type, 0),
    issuerID: normalizePositiveInteger(contract.issuerID, 0),
    issuerCorpID: normalizePositiveInteger(contract.issuerCorpID, 0),
    forCorp: normalizeBoolean(contract.forCorp, false),
    availability: normalizeNumber(contract.availability, 0),
    assigneeID: normalizePositiveInteger(contract.assigneeID, 0),
    acceptorID: normalizePositiveInteger(contract.acceptorID, 0),
    dateIssued: buildFiletime(contract.dateIssued),
    dateExpired: buildFiletime(contract.dateExpired),
    dateAccepted: buildFiletime(contract.dateAccepted),
    dateCompleted: buildFiletime(contract.dateCompleted),
    dateDeleted: buildFiletime(contract.dateDeleted || 0),
    startStationID: normalizePositiveInteger(contract.startStationID, 0),
    startSolarSystemID: normalizePositiveInteger(contract.startSolarSystemID, 0),
    startRegionID: normalizePositiveInteger(contract.startRegionID, 0),
    endStationID: normalizePositiveInteger(contract.endStationID, 0),
    endSolarSystemID: normalizePositiveInteger(contract.endSolarSystemID, 0),
    endRegionID: normalizePositiveInteger(contract.endRegionID, 0),
    price: normalizeNumber(contract.price, 0),
    reward: normalizeNumber(contract.reward, 0),
    collateral: normalizeNumber(contract.collateral, 0),
    title: contract.title ? String(contract.title) : "",
    description: contract.description ? String(contract.description) : "",
    status: normalizeNumber(contract.status, 0),
    crateID: normalizePositiveInteger(contract.escrowLocationID, 0),
    volume: normalizeNumber(contract.volume, 0),
    startStationDivision: normalizePositiveInteger(contract.startStationDivision, 0) || null,
    issuerWalletKey,
    acceptorWalletKey: contract.acceptorWalletKey === null || contract.acceptorWalletKey === undefined
      ? null
      : normalizePositiveInteger(contract.acceptorWalletKey, 0),
  });
}

function buildContractDetailItemRow(contract, item) {
  return buildPackedRow(CONTRACT_DETAIL_ITEM_ROW_DESCRIPTOR_COLUMNS, {
    contractID: normalizePositiveInteger(contract && contract.contractID, 0),
    itemID: normalizePositiveInteger(item && item.itemID, 0),
    quantity: normalizePositiveInteger(item && item.quantity, 0),
    itemTypeID: normalizePositiveInteger(item && item.itemTypeID, 0),
    inCrate: normalizeBoolean(item && item.inCrate, false),
    parentID: normalizePositiveInteger(item && item.parentID, 0),
    productivityLevel:
      item && item.productivityLevel !== undefined ? normalizeNumber(item.productivityLevel, 0) : null,
    materialLevel:
      item && item.materialLevel !== undefined ? normalizeNumber(item.materialLevel, 0) : null,
    copy: item && item.copy !== undefined ? normalizeNumber(item.copy, 0) : null,
    licensedProductionRunsRemaining:
      item && item.licensedProductionRunsRemaining !== undefined
        ? normalizeNumber(item.licensedProductionRunsRemaining, 0)
        : null,
    damage: item && item.damage !== undefined ? normalizeNumber(item.damage, 0) : null,
    flagID: normalizePositiveInteger(item && item.flagID, 0),
    recordID: normalizePositiveInteger(item && item.recordID, 0),
  });
}

function getContractDetailItems(contract) {
  return contract && Array.isArray(contract.items) ? contract.items : [];
}

function collectContractDetailTypeIDs(contract) {
  return [...new Set(getContractDetailItems(contract)
    .map((item) => normalizePositiveInteger(item && item.itemTypeID, 0))
    .filter((typeID) => typeID > 0))]
    .sort((left, right) => left - right);
}

function collectContractDetailMetadataIDs(typeIDs, fieldName) {
  return [...new Set(typeIDs
    .map((typeID) => normalizePositiveInteger(getItemMetadata(typeID)[fieldName], 0))
    .filter((metadataID) => metadataID > 0))]
    .sort((left, right) => left - right);
}

function resolveSolarSystemName(solarSystemID) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  return system && (system.solarSystemName || system.name)
    ? String(system.solarSystemName || system.name)
    : "";
}

function resolveConstellationID(solarSystemID) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  return normalizePositiveInteger(system && system.constellationID, 0) || null;
}

function buildContractDetailBundle(contract) {
  if (!contract) {
    return null;
  }
  const typeIDs = collectContractDetailTypeIDs(contract);
  const startSolarSystemID = normalizePositiveInteger(contract.startSolarSystemID, 0);
  const endSolarSystemID = normalizePositiveInteger(contract.endSolarSystemID, 0);
  return buildKeyVal([
    ["startSolarSystemName", resolveSolarSystemName(startSolarSystemID)],
    [
      "items",
      buildList(getContractDetailItems(contract).map((item) =>
        buildContractDetailItemRow(contract, item),
      )),
    ],
    ["bids", buildList([])],
    ["contract", buildContractDetailContractRow(contract)],
    ["itemGroups", buildPythonSet(collectContractDetailMetadataIDs(typeIDs, "groupID"))],
    ["startSolarSystemID", startSolarSystemID],
    ["startConstellationID", resolveConstellationID(startSolarSystemID)],
    ["endConstellationID", endSolarSystemID > 0 ? resolveConstellationID(endSolarSystemID) : null],
    ["itemCategories", buildPythonSet(collectContractDetailMetadataIDs(typeIDs, "categoryID"))],
    ["itemTypes", buildPythonSet(typeIDs)],
    ["endSolarSystemID", endSolarSystemID],
  ]);
}

function buildContractListBundle(contracts = []) {
  const normalizedContracts = Array.isArray(contracts) ? contracts : [];
  return buildKeyVal([
    ["contracts", buildList(normalizedContracts.map(buildContractRow))],
    [
      "items",
      buildDict(normalizedContracts.map((contract) => [
        normalizePositiveInteger(contract && contract.contractID, 0),
        buildContractItemList(contract),
      ])),
    ],
  ]);
}

function buildContractSearchEntry(contract) {
  if (!contract) {
    return null;
  }
  const typeIDs = collectContractDetailTypeIDs(contract);
  const startSolarSystemID = normalizePositiveInteger(contract.startSolarSystemID, 0);
  const endSolarSystemID = normalizePositiveInteger(contract.endSolarSystemID, 0);
  return buildKeyVal([
    ["startSolarSystemName", resolveSolarSystemName(startSolarSystemID)],
    [
      "items",
      buildList(getContractDetailItems(contract).map((item) =>
        buildContractDetailItemRow(contract, item),
      )),
    ],
    ["bids", buildList([])],
    ["contract", buildContractDetailContractRow(contract)],
    ["itemGroups", buildPythonSet(collectContractDetailMetadataIDs(typeIDs, "groupID"))],
    ["startSolarSystemID", startSolarSystemID],
    ["startConstellationID", resolveConstellationID(startSolarSystemID)],
    ["endConstellationID", endSolarSystemID > 0 ? resolveConstellationID(endSolarSystemID) : null],
    ["itemCategories", buildPythonSet(collectContractDetailMetadataIDs(typeIDs, "categoryID"))],
    ["itemTypes", buildPythonSet(typeIDs)],
    ["endSolarSystemID", endSolarSystemID],
    ["numBids", 0],
  ]);
}

function buildContractSearchResult(result) {
  if (!result || !Array.isArray(result.contracts)) {
    return buildEmptyContractSearchResult();
  }
  return buildKeyVal([
    ["contracts", buildList(result.contracts.map(buildContractSearchEntry))],
    ["numFound", normalizePositiveInteger(result.numFound, 0)],
    ["searchTime", normalizeNumber(result.searchTime, 0)],
    ["maxResults", MAX_CONTRACTS_PER_SEARCH],
  ]);
}

function buildContractTypeRows() {
  return buildList([
    buildKeyVal([
      ["contractType", CONTRACT_TYPE_ITEM_EXCHANGE],
      ["typeID", CONTRACT_TYPE_ITEM_EXCHANGE],
      ["name", "Item Exchange"],
    ]),
    buildKeyVal([
      ["contractType", CONTRACT_TYPE_AUCTION],
      ["typeID", CONTRACT_TYPE_AUCTION],
      ["name", "Auction"],
    ]),
    buildKeyVal([
      ["contractType", CONTRACT_TYPE_COURIER],
      ["typeID", CONTRACT_TYPE_COURIER],
      ["name", "Courier"],
    ]),
  ]);
}

function buildContractInventoryItemRow(item) {
  return buildPackedRow(
    INVENTORY_ROW_DESCRIPTOR_COLUMNS,
    {
      itemID: normalizePositiveInteger(item && item.itemID, 0),
      typeID: normalizePositiveInteger(item && item.typeID, 0),
      ownerID: normalizePositiveInteger(item && item.ownerID, 0),
      locationID: normalizePositiveInteger(item && item.locationID, 0),
      flagID: normalizePositiveInteger(item && item.flagID, 0),
      quantity: normalizeNumber(item && item.quantity, 0),
      groupID: normalizePositiveInteger(item && item.groupID, 0),
      categoryID: normalizePositiveInteger(item && item.categoryID, 0),
      customInfo: item && item.customInfo ? String(item.customInfo) : "",
      stacksize: normalizeNumber(item && item.stacksize, 0),
      singleton: normalizeNumber(item && item.singleton, 0),
    },
    INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS,
  );
}

function listContractItemsInDockableLocation(args, session) {
  const locationID = normalizePositiveInteger(
    Array.isArray(args) && args.length > 0 ? args[0] : null,
    0,
  );
  const forCorp = normalizeBoolean(
    Array.isArray(args) && args.length > 1 ? args[1] : false,
    false,
  );
  if (locationID <= 0) {
    return [];
  }

  if (forCorp) {
    const corporationID = getCorporationID(session);
    if (corporationID <= 0) {
      return [];
    }
    return listContainerItems(corporationID, locationID, null)
      .filter((item) => CORP_CONTRACT_ITEM_FLAGS.has(
        normalizePositiveInteger(item && item.flagID, 0),
      ))
      .sort(compareItemsByID);
  }

  const characterID = getCharacterID(session);
  if (characterID <= 0) {
    return [];
  }
  return listContainerItems(characterID, locationID, ITEM_FLAGS.HANGAR)
    .sort(compareItemsByID);
}

function extractContainerItemIDs(rawValue) {
  return [...new Set(
    extractList(rawValue)
      .map((itemID) => normalizePositiveInteger(itemID, 0))
      .filter((itemID) => itemID > 0),
  )];
}

function canReadContractContainer(locationID, containerID, forCorp, flagID, session) {
  if (locationID <= 0 || containerID <= 0) {
    return false;
  }
  const ownerID = getContractOwnerID(session, forCorp);
  if (ownerID <= 0) {
    return false;
  }

  const container = findItemById(containerID);
  if (!container) {
    return false;
  }
  if (normalizePositiveInteger(container.ownerID, 0) !== ownerID) {
    return false;
  }
  if (normalizePositiveInteger(container.locationID, 0) !== locationID) {
    return false;
  }
  return isAllowedContractSourceFlag(container.flagID, forCorp, flagID);
}

function listContractItemsInContainer(args, session) {
  const locationID = normalizePositiveInteger(
    Array.isArray(args) && args.length > 0 ? args[0] : null,
    0,
  );
  const containerID = normalizePositiveInteger(
    Array.isArray(args) && args.length > 1 ? args[1] : null,
    0,
  );
  const forCorp = normalizeBoolean(
    Array.isArray(args) && args.length > 2 ? args[2] : false,
    false,
  );
  const flagID = normalizePositiveInteger(
    Array.isArray(args) && args.length > 3 ? args[3] : null,
    0,
  );
  if (!canReadContractContainer(locationID, containerID, forCorp, flagID, session)) {
    return [];
  }

  const ownerID = getContractOwnerID(session, forCorp);
  return listContainerItems(ownerID, containerID, null)
    .sort(compareItemsByID);
}

function countContractItemsInContainers(args, session) {
  const locationID = normalizePositiveInteger(
    Array.isArray(args) && args.length > 0 ? args[0] : null,
    0,
  );
  const containerIDs = extractContainerItemIDs(
    Array.isArray(args) && args.length > 1 ? args[1] : [],
  );
  const forCorp = normalizeBoolean(
    Array.isArray(args) && args.length > 2 ? args[2] : false,
    false,
  );
  const flagID = normalizePositiveInteger(
    Array.isArray(args) && args.length > 3 ? args[3] : null,
    0,
  );
  const ownerID = getContractOwnerID(session, forCorp);
  if (locationID <= 0 || ownerID <= 0 || containerIDs.length === 0) {
    return [];
  }

  return containerIDs
    .map((containerID) => [
      containerID,
      canReadContractContainer(locationID, containerID, forCorp, flagID, session)
        ? listContainerItems(ownerID, containerID, null).length
        : 0,
    ])
    .filter(([, itemCount]) => itemCount > 0);
}

class contractProxyService extends BaseService {
  constructor() {
    super("contractProxy");
  }

  Handle_GetLoginInfo(args, session) {
    log.debug("[ContractProxy] GetLoginInfo called");
    return buildLoginInfo(contractRuntime.buildLoginInfoRows(session));
  }

  Handle_CollectMyPageInfo(args, session) {
    log.debug("[ContractProxy] CollectMyPageInfo called");
    const pageInfo = contractRuntime.collectMyPageInfo(session);
    return buildKeyVal([
      ["numInProgressCorp", pageInfo.numInProgressCorp],
      ["numOutstandingContracts", pageInfo.numOutstandingContracts],
      ["numBiddingOn", pageInfo.numBiddingOn],
      ["numRequiresAttentionCorp", pageInfo.numRequiresAttentionCorp],
      ["numInProgress", pageInfo.numInProgress],
      ["numBiddingOnCorp", pageInfo.numBiddingOnCorp],
      ["numOutstandingContractsNonCorp", pageInfo.numOutstandingContractsNonCorp],
      ["outstandingContracts", buildList(pageInfo.outstandingContracts || [])],
      ["numOutstandingContractsForCorp", pageInfo.numOutstandingContractsForCorp],
      ["numRequiresAttention", pageInfo.numRequiresAttention],
      ["numContractsLeftCorp", pageInfo.numContractsLeftCorp],
    ]);
  }

  Handle_GetMyContractEscrow(args, session) {
    log.debug("[ContractProxy] GetMyContractEscrow called");
    const escrow = contractRuntime.getMyContractEscrow(session);
    return buildKeyVal([
      ["iskEscrow", escrow.iskEscrow],
      ["itemsEscrow", escrow.itemsEscrow],
    ]);
  }

  Handle_NumOutstandingContracts(args, session) {
    log.debug("[ContractProxy] NumOutstandingContracts called");
    return buildOutstandingContractsKeyVal(session);
  }

  Handle_SearchContracts(args, session, kwargs) {
    recordAuditEvent("SearchContracts", args, session, kwargs);
    return buildContractSearchResult(contractRuntime.searchContracts(session, kwargs || {}));
  }

  Handle_GetMyExpiredContractList(args, session) {
    recordAuditEvent("GetMyExpiredContractList", args, session);
    const forCorp = normalizeBoolean(Array.isArray(args) ? unwrapMarshalValue(args[0]) : false, false);
    return buildContractListBundle(contractRuntime.filterExpiredContracts(session, forCorp));
  }

  Handle_GetMyBids(args, session) {
    recordAuditEvent("GetMyBids", args, session);
    return buildEmptyContractBundle();
  }

  Handle_GetMyCurrentContractList(args, session) {
    recordAuditEvent("GetMyCurrentContractList", args, session);
    const isAccepted = normalizeBoolean(Array.isArray(args) ? unwrapMarshalValue(args[0]) : false, false);
    const forCorp = normalizeBoolean(Array.isArray(args) ? unwrapMarshalValue(args[1]) : false, false);
    return buildContractListBundle(
      contractRuntime.filterMyCurrentContracts(session, isAccepted, forCorp),
    );
  }

  Handle_GetContractListForOwner(args, session, kwargs) {
    recordAuditEvent("GetContractListForOwner", args, session, kwargs);
    const ownerID = normalizePositiveInteger(Array.isArray(args) ? unwrapMarshalValue(args[0]) : 0, 0);
    const status = Array.isArray(args) && args.length > 1 ? unwrapMarshalValue(args[1]) : null;
    const contractType = Array.isArray(args) && args.length > 2 ? unwrapMarshalValue(args[2]) : 0;
    return buildContractListBundle(contractRuntime.filterContractsForOwner(ownerID, {
      status,
      contractType,
    }));
  }

  Handle_GetAvailableContractList(args, session, kwargs) {
    recordAuditEvent("GetAvailableContractList", args, session, kwargs);
    const result = contractRuntime.searchContracts(session, {
      ...(kwargs || {}),
      availability: kwargs && Object.prototype.hasOwnProperty.call(kwargs, "availability")
        ? kwargs.availability
        : 0,
    });
    return buildContractListBundle(result.contracts);
  }

  Handle_GetContractListForStatus(args, session, kwargs) {
    recordAuditEvent("GetContractListForStatus", args, session, kwargs);
    const ownerID = normalizePositiveInteger(
      Array.isArray(args) && args.length > 1 ? unwrapMarshalValue(args[1]) : getCharacterID(session),
      getCharacterID(session),
    );
    const status = Array.isArray(args) ? unwrapMarshalValue(args[0]) : null;
    return buildContractListBundle(contractRuntime.filterContractsForOwner(ownerID, {
      status,
      contractType: kwargs && kwargs.contractType,
    }));
  }

  Handle_GetContractsForOwner(args, session, kwargs) {
    recordAuditEvent("GetContractsForOwner", args, session, kwargs);
    const ownerID = normalizePositiveInteger(Array.isArray(args) ? unwrapMarshalValue(args[0]) : 0, 0);
    const status = Array.isArray(args) && args.length > 1 ? unwrapMarshalValue(args[1]) : null;
    const contractType = Array.isArray(args) && args.length > 2 ? unwrapMarshalValue(args[2]) : 0;
    return buildContractListBundle(contractRuntime.filterContractsForOwner(ownerID, {
      status,
      contractType,
    }));
  }

  Handle_GetContractBids(args, session) {
    recordAuditEvent("GetContractBids", args, session);
    return buildList([]);
  }

  Handle_GetContractTypes() {
    return buildContractTypeRows();
  }

  Handle_GetContract(args, session) {
    const contractID = normalizeNumber(args && args[0], 0);
    recordAuditEvent("GetContract", [contractID], session);
    return buildContractDetailBundle(contractRuntime.getContractRecord(contractID));
  }

  Handle_CreateContract(args, session, kwargs) {
    recordAuditEvent("CreateContract", args, session, kwargs);
    const rawInfo = Array.isArray(args) ? args[0] : null;
    const info = contractRuntime.normalizeContractInfo(rawInfo);
    if (
      info.contractType !== contractRuntime.CONTRACT_TYPE.ITEM_EXCHANGE &&
      info.contractType !== contractRuntime.CONTRACT_TYPE.COURIER
    ) {
      return null;
    }
    const result = contractRuntime.createContract(rawInfo, session, {
      confirm: kwargs && kwargs.confirm,
    });
    return buildList(result.contractIDs || []);
  }

  Handle_AcceptContract(args, session) {
    recordAuditEvent("AcceptContract", args, session);
    const contractID = normalizePositiveInteger(Array.isArray(args) ? unwrapMarshalValue(args[0]) : 0, 0);
    const forCorp = normalizeBoolean(Array.isArray(args) ? unwrapMarshalValue(args[1]) : false, false);
    return buildContractRow(contractRuntime.acceptContract(contractID, session, forCorp));
  }

  Handle_CompleteContract(args, session) {
    recordAuditEvent("CompleteContract", args, session);
    const contractID = normalizePositiveInteger(Array.isArray(args) ? unwrapMarshalValue(args[0]) : 0, 0);
    const status = Array.isArray(args) && args.length > 1
      ? unwrapMarshalValue(args[1])
      : contractRuntime.CONTRACT_STATUS.FINISHED;
    return contractRuntime.completeContract(contractID, status, session);
  }

  Handle_DeleteContract(args, session) {
    recordAuditEvent("DeleteContract", args, session);
    const contractID = normalizePositiveInteger(Array.isArray(args) ? unwrapMarshalValue(args[0]) : 0, 0);
    return contractRuntime.deleteContract(contractID, session);
  }

  Handle_DeleteMultipleContracts(args, session) {
    recordAuditEvent("DeleteMultipleContracts", args, session);
    const contractIDs = extractList(Array.isArray(args) ? args[0] : [])
      .map((contractID) => normalizePositiveInteger(contractID, 0))
      .filter((contractID) => contractID > 0);
    const result = contractRuntime.deleteMultipleContracts(contractIDs, session);
    return [buildList(result.deleted), buildList(result.failed)];
  }

  Handle_PlaceBid(args, session) {
    recordAuditEvent("PlaceBid", args, session);
    return null;
  }

  Handle_FinishAuction(args, session) {
    recordAuditEvent("FinishAuction", args, session);
    return false;
  }

  Handle_SplitStack(args, session) {
    recordAuditEvent("SplitStack", args, session);
    return null;
  }

  Handle_GetItemsInContainer(args, session) {
    recordAuditEvent("GetItemsInContainer", args, session);
    return buildList(
      listContractItemsInContainer(args, session)
        .map(buildContractInventoryItemRow),
    );
  }

  Handle_GetNumItemsInContainers(args, session) {
    recordAuditEvent("GetNumItemsInContainers", args, session);
    return buildDict(countContractItemsInContainers(args, session));
  }

  Handle_GetItemsInDockableLocation(args, session) {
    recordAuditEvent("GetItemsInDockableLocation", args, session);
    return buildPythonObjectSet(
      listContractItemsInDockableLocation(args, session)
        .map(buildContractInventoryItemRow),
    );
  }

  Handle_DeleteNotification(args, session) {
    recordAuditEvent("DeleteNotification", args, session);
    return null;
  }

  Handle_DeleteContractNotification(args, session) {
    recordAuditEvent("DeleteContractNotification", args, session);
    return null;
  }

  Handle_GetCourierContractFromItemID(args, session) {
    recordAuditEvent("GetCourierContractFromItemID", args, session);
    const itemID = normalizePositiveInteger(Array.isArray(args) ? unwrapMarshalValue(args[0]) : 0, 0);
    const contract = contractRuntime.getCourierContractFromItemID(itemID, session);
    return contract ? buildContractRow(contract) : null;
  }

  Handle_SetContractExpired(args, session) {
    recordAuditEvent("SetContractExpired", args, session);
    return false;
  }

  Handle_GM_ExpireContract(args, session) {
    recordAuditEvent("GM_ExpireContract", args, session);
    return false;
  }
}

contractProxyService._testing = {
  getAuditEvents() {
    return auditEvents.slice();
  },
  resetForTests() {
    auditEvents.length = 0;
  },
  constants: {
    MAX_CONTRACTS_PER_SEARCH,
    CONTRACT_TYPE_ITEM_EXCHANGE,
    CONTRACT_TYPE_AUCTION,
    CONTRACT_TYPE_COURIER,
  },
  listContractItemsInDockableLocation,
  listContractItemsInContainer,
  countContractItemsInContainers,
};

module.exports = contractProxyService;
