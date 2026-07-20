const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../gameStore"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  ITEM_FLAGS,
  createSpaceItemForOwner,
  findItemById,
  grantItemToOwnerLocation,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  NEXT_ASSET_WRAP_ID_START,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  getCharacterIDsInCorporation,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  buildStructureScatterPosition,
  getStructureSpaceDirection,
} = require(path.join(__dirname, "./structureSpaceInterop"));

const STRUCTURE_ASSET_SAFETY_TABLE = "structureAssetSafety";
const ASSET_SAFETY_FLAG_ID = 36;
const ASSET_SAFETY_WRAP_TYPE_ID = 60;
const OFFICE_EJECT_CONTAINER_TYPE_ID = 10167;
const STRUCTURE_RIG_SLOT_FLAGS = Object.freeze(new Set([92, 93, 94, 95, 96, 97, 98, 99]));
const STRUCTURE_ATTACHED_ITEM_FLAGS = Object.freeze(new Set([
  ...Array.from({ length: 24 }, (_, index) => 11 + index),
  ...Array.from({ length: 8 }, (_, index) => 125 + index),
  ...Array.from({ length: 8 }, (_, index) => 164 + index),
  ITEM_FLAGS.FIGHTER_BAY,
  ITEM_FLAGS.FIGHTER_TUBE_0,
  ITEM_FLAGS.FIGHTER_TUBE_1,
  ITEM_FLAGS.FIGHTER_TUBE_2,
  ITEM_FLAGS.FIGHTER_TUBE_3,
  ITEM_FLAGS.FIGHTER_TUBE_4,
  ITEM_FLAGS.STRUCTURE_FUEL_BAY,
  ITEM_FLAGS.STRUCTURE_DEED,
]));
const CORPORATION_HANGAR_FLAGS = Object.freeze(new Set([
  115, // flagCorpSAG1
  116, // flagCorpSAG2
  117, // flagCorpSAG3
  118, // flagCorpSAG4
  119, // flagCorpSAG5
  120, // flagCorpSAG6
  121, // flagCorpSAG7
  184, // flagCorpGoalDeliveries
]));
const DAYS_UNTIL_CAN_DELIVER = 5;
const DAYS_UNTIL_AUTO_MOVE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;

let wrapCache = null;
let stationCache = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeTimestampMs(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function readWrapTable() {
  const result = database.read(STRUCTURE_ASSET_SAFETY_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {
      _meta: {
        nextWrapID: NEXT_ASSET_WRAP_ID_START,
        generatedAt: null,
        lastUpdatedAt: null,
      },
      wraps: [],
    };
  }
  return cloneValue(result.data);
}

function writeWrapTable(payload) {
  const result = database.write(STRUCTURE_ASSET_SAFETY_TABLE, "/", payload);
  if (!result.success) {
    return {
      success: false,
      errorMsg: result.errorMsg || "WRITE_FAILED",
    };
  }
  wrapCache = null;
  return { success: true };
}

function getStaticStations() {
  if (stationCache) {
    return stationCache;
  }

  stationCache = readStaticRows(TABLE.STATIONS)
    .map((station) => ({
      itemID: normalizePositiveInt(station && station.stationID, 0),
      typeID: normalizePositiveInt(station && station.stationTypeID, 0),
      solarSystemID: normalizePositiveInt(station && station.solarSystemID, 0),
      constellationID: normalizePositiveInt(station && station.constellationID, 0),
      regionID: normalizePositiveInt(station && station.regionID, 0),
      itemName: String(
        station && (station.stationName || station.itemName || `Station ${station.stationID}`),
      ),
    }))
    .filter((station) => station.itemID > 0)
    .sort((left, right) => left.itemID - right.itemID);

  return stationCache;
}

function normalizeStationInfo(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const itemID = normalizePositiveInt(value.itemID || value.stationID, 0);
  if (!itemID) {
    return null;
  }

  return {
    itemID,
    typeID: normalizePositiveInt(value.typeID || value.stationTypeID, 0),
    solarSystemID: normalizePositiveInt(value.solarSystemID, 0),
    itemName: String(value.itemName || value.stationName || `Station ${itemID}`),
  };
}

function normalizeWrapRecord(entry = {}) {
  const assetWrapID = normalizePositiveInt(entry.assetWrapID, 0);
  const ownerKind = String(entry.ownerKind || "char").trim().toLowerCase() === "corp"
    ? "corp"
    : "char";
  const nearestNPCStationInfo = normalizeStationInfo(entry.nearestNPCStationInfo);
  const createdAt = normalizeTimestampMs(entry.createdAt, null) || Date.now();
  const ejectTimeMs =
    normalizeTimestampMs(entry.ejectTimeMs, null) ||
    normalizeTimestampMs(entry.ejectTime, null) ||
    createdAt;

  return {
    assetWrapID,
    ownerID: normalizePositiveInt(entry.ownerID, 0),
    ownerKind,
    sourceStructureID: normalizePositiveInt(entry.sourceStructureID, 0),
    solarSystemID: normalizePositiveInt(entry.solarSystemID, 0),
    wrapName: String(entry.wrapName || `Asset Safety Wrap ${assetWrapID}`),
    wrapTypeID: ASSET_SAFETY_WRAP_TYPE_ID,
    itemIDs: [...new Set((Array.isArray(entry.itemIDs) ? entry.itemIDs : []).map((itemID) => normalizePositiveInt(itemID, 0)).filter(Boolean))].sort((left, right) => left - right),
    createdAt,
    ejectTimeMs,
    daysUntilCanDeliverConst: DAYS_UNTIL_CAN_DELIVER,
    daysUntilAutoMoveConst: DAYS_UNTIL_AUTO_MOVE,
    nearestNPCStationInfo,
    destinationID: normalizePositiveInt(entry.destinationID, 0) || null,
    destinationKind: entry.destinationKind ? String(entry.destinationKind) : null,
    deliveredAt: normalizeTimestampMs(entry.deliveredAt, null),
    autoMovedAt: normalizeTimestampMs(entry.autoMovedAt, null),
    assetSafetyDisabled: Boolean(entry.assetSafetyDisabled),
  };
}

function ensureWrapCache() {
  if (wrapCache) {
    return wrapCache;
  }

  const payload = readWrapTable();
  const wraps = Array.isArray(payload.wraps)
    ? payload.wraps.map((entry) => normalizeWrapRecord(entry))
    : [];
  wrapCache = {
    meta: {
      nextWrapID: Math.max(
        NEXT_ASSET_WRAP_ID_START,
        normalizePositiveInt(payload._meta && payload._meta.nextWrapID, NEXT_ASSET_WRAP_ID_START),
      ),
      generatedAt: payload._meta && payload._meta.generatedAt ? String(payload._meta.generatedAt) : null,
      lastUpdatedAt: payload._meta && payload._meta.lastUpdatedAt ? String(payload._meta.lastUpdatedAt) : null,
    },
    wraps,
    byWrapID: new Map(wraps.map((wrap) => [wrap.assetWrapID, wrap])),
  };
  return wrapCache;
}

function persistWraps(wraps, metaOverrides = {}) {
  const normalizedWraps = wraps.map((wrap) => normalizeWrapRecord(wrap));
  const nextWrapID = Math.max(
    NEXT_ASSET_WRAP_ID_START,
    ...normalizedWraps.map((wrap) => normalizePositiveInt(wrap.assetWrapID, 0) + 1),
    NEXT_ASSET_WRAP_ID_START,
  );
  return writeWrapTable({
    _meta: {
      ...(ensureWrapCache().meta || {}),
      nextWrapID,
      lastUpdatedAt: new Date().toISOString(),
      ...metaOverrides,
    },
    wraps: normalizedWraps,
  });
}

function updateWrap(assetWrapID, updater) {
  const targetID = normalizePositiveInt(assetWrapID, 0);
  if (!targetID || typeof updater !== "function") {
    return {
      success: false,
      errorMsg: "WRAP_NOT_FOUND",
    };
  }

  const cache = ensureWrapCache();
  const current = cache.byWrapID.get(targetID);
  if (!current) {
    return {
      success: false,
      errorMsg: "WRAP_NOT_FOUND",
    };
  }

  const next = normalizeWrapRecord(updater(cloneValue(current)) || current);
  const writeResult = persistWraps(
    cache.wraps.map((wrap) => (wrap.assetWrapID === targetID ? next : wrap)),
  );
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: next,
  };
}

function createWrap(record) {
  const cache = ensureWrapCache();
  const assetWrapID = Math.max(NEXT_ASSET_WRAP_ID_START, cache.meta.nextWrapID || NEXT_ASSET_WRAP_ID_START);
  const next = normalizeWrapRecord({
    ...record,
    assetWrapID,
  });
  const writeResult = persistWraps([...cache.wraps, next], {
    nextWrapID: assetWrapID + 1,
    generatedAt: cache.meta.generatedAt || new Date().toISOString(),
  });
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    data: next,
  };
}

function listWraps(options = {}) {
  if (options.refresh !== false) {
    tickAssetSafetyWraps(options.nowMs);
  }
  const includeDelivered = options.includeDelivered === true;
  return ensureWrapCache().wraps
    .filter((wrap) => includeDelivered || !wrap.deliveredAt)
    .map((wrap) => cloneValue(wrap));
}

function getWrapByID(assetWrapID, options = {}) {
  if (options.refresh !== false) {
    tickAssetSafetyWraps(options.nowMs);
  }
  return ensureWrapCache().byWrapID.get(normalizePositiveInt(assetWrapID, 0)) || null;
}

function getWrapNames(wrapIDs = []) {
  return Object.fromEntries(
    (Array.isArray(wrapIDs) ? wrapIDs : [wrapIDs])
      .map((wrapID) => normalizePositiveInt(wrapID, 0))
      .filter(Boolean)
      .map((wrapID) => {
        const wrap = getWrapByID(wrapID);
        return [wrapID, wrap ? wrap.wrapName : null];
      }),
  );
}

function listWrapsForOwner(ownerKind, ownerID, options = {}) {
  const normalizedOwnerKind = String(ownerKind || "char").trim().toLowerCase() === "corp"
    ? "corp"
    : "char";
  const normalizedOwnerID = normalizePositiveInt(ownerID, 0);
  if (!normalizedOwnerID) {
    return [];
  }

  return listWraps(options).filter(
    (wrap) =>
      wrap.ownerKind === normalizedOwnerKind &&
      normalizePositiveInt(wrap.ownerID, 0) === normalizedOwnerID,
  );
}

function getSessionCharacterID(session) {
  return normalizePositiveInt(
    session && (session.characterID || session.charid || session.userid),
    0,
  );
}

function getSessionCorporationID(session) {
  return normalizePositiveInt(
    session && (session.corporationID || session.corpid),
    0,
  );
}

function sessionCanManageWrap(session, wrap) {
  if (!wrap) {
    return false;
  }
  if (config.devBypassAssetSafetyWrapAccess === true) {
    return true;
  }

  const structureState = require(path.join(__dirname, "./structureState"));
  if (structureState.hasStructureGmBypass(session)) {
    return true;
  }

  return (
    (wrap.ownerKind === "char" && wrap.ownerID === getSessionCharacterID(session)) ||
    (wrap.ownerKind === "corp" && wrap.ownerID === getSessionCorporationID(session))
  );
}

function getFallbackNpcStationInfo(solarSystemID) {
  const stations = getStaticStations();
  if (stations.length === 0) {
    return null;
  }

  const numericSystemID = normalizePositiveInt(solarSystemID, 0);
  const systemRecord = worldData.getSolarSystemByID(numericSystemID);
  const sameSystem = stations.find((station) => station.solarSystemID === numericSystemID);
  if (sameSystem) {
    return cloneValue(sameSystem);
  }

  if (systemRecord) {
    const sameConstellation = stations.find(
      (station) =>
        normalizePositiveInt(station.constellationID, 0) > 0 &&
        station.constellationID === normalizePositiveInt(systemRecord.constellationID, 0),
    );
    if (sameConstellation) {
      return cloneValue(sameConstellation);
    }

    const sameRegion = stations.find(
      (station) =>
        normalizePositiveInt(station.regionID, 0) > 0 &&
        station.regionID === normalizePositiveInt(systemRecord.regionID, 0),
    );
    if (sameRegion) {
      return cloneValue(sameRegion);
    }
  }

  return cloneValue(stations[0]);
}

function isAssetSafetyDisabledSolarSystem(solarSystemID) {
  const numericSystemID = normalizePositiveInt(solarSystemID, 0);
  const systemRecord = worldData.getSolarSystemByID(numericSystemID);
  if (!systemRecord) {
    return false;
  }

  if (numericSystemID >= 31000000) {
    return true;
  }

  if (normalizePositiveInt(systemRecord.regionID, 0) === 10000070) {
    return true;
  }

  return /^J\d+/i.test(String(systemRecord.solarSystemName || "").trim());
}

function getWrapUnlockTimeMs(wrap) {
  return normalizeTimestampMs(wrap && wrap.ejectTimeMs, 0) + DAYS_UNTIL_CAN_DELIVER * DAY_MS;
}

function getWrapAutoMoveTimeMs(wrap) {
  return normalizeTimestampMs(wrap && wrap.ejectTimeMs, 0) + DAYS_UNTIL_AUTO_MOVE * DAY_MS;
}

function listTopLevelStructureItems(ownerID, structureID, options = {}) {
  const excludedItemIDs = new Set(
    (Array.isArray(options.excludeItemIDs) ? options.excludeItemIDs : [])
      .map((itemID) => normalizePositiveInt(itemID, 0))
      .filter(Boolean),
  );

  return listContainerItems(normalizePositiveInt(ownerID, 0), normalizePositiveInt(structureID, 0), null)
    .filter((item) => item && !excludedItemIDs.has(normalizePositiveInt(item.itemID, 0)));
}

function getOwnerKindForAssetSafety(ownerID) {
  const numericOwnerID = normalizePositiveInt(ownerID, 0);
  return numericOwnerID >= 140000000 && numericOwnerID < 200000000
    ? "char"
    : "corp";
}

function isStructureHangarAssetItem(item) {
  const flagID = normalizePositiveInt(item && item.flagID, 0);
  return flagID === ITEM_FLAGS.HANGAR || CORPORATION_HANGAR_FLAGS.has(flagID);
}

function listTopLevelStructureHangarItems(ownerID, structureID, options = {}) {
  return listTopLevelStructureItems(ownerID, structureID, options)
    .filter(isStructureHangarAssetItem);
}

function listTopLevelCorporationOfficeItems(corporationID, office) {
  const numericCorporationID = normalizePositiveInt(corporationID, 0);
  if (!numericCorporationID || !office || typeof office !== "object") {
    return [];
  }

  const officeLocationIDs = [
    office.officeID,
    office.officeFolderID,
    office.itemID,
  ]
    .map((locationID) => normalizePositiveInt(locationID, 0))
    .filter(Boolean);
  const seenItemIDs = new Set();
  const items = [];
  for (const locationID of officeLocationIDs) {
    for (const item of listContainerItems(numericCorporationID, locationID, null)) {
      const itemID = normalizePositiveInt(item && item.itemID, 0);
      if (!itemID || seenItemIDs.has(itemID)) {
        continue;
      }
      seenItemIDs.add(itemID);
      items.push(item);
    }
  }
  return items;
}

function buildOfficeEjectContainerName(structure) {
  const structureName = String(
    structure && (structure.itemName || structure.name || `Structure ${structure.structureID}`),
  );
  return `${structureName} Office Assets`;
}

function buildStructureEjectContainerName(structure) {
  const structureName = String(
    structure && (structure.itemName || structure.name || `Structure ${structure.structureID}`),
  );
  return `${structureName} Asset Safety Container`;
}

function buildStructureDecommissionContainerName(structure) {
  const structureName = String(
    structure && (structure.itemName || structure.name || `Structure ${structure.structureID}`),
  );
  return `${structureName} Decommissioned Fittings`;
}

function isStructureRigSlotItem(item) {
  return STRUCTURE_RIG_SLOT_FLAGS.has(normalizePositiveInt(item && item.flagID, 0));
}

function isStructureAttachedItemForUnanchor(item) {
  return STRUCTURE_ATTACHED_ITEM_FLAGS.has(normalizePositiveInt(item && item.flagID, 0));
}

function msToFiletimeLong(value) {
  const timestampMs = normalizeTimestampMs(value, Date.now()) || Date.now();
  return {
    type: "long",
    value: String(BigInt(timestampMs) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET),
  };
}

function durationMsToLong(value) {
  const durationMs = Math.max(0, normalizeInt(value, 0));
  return {
    type: "long",
    value: String(BigInt(durationMs) * FILETIME_TICKS_PER_MS),
  };
}

function buildAssetSafetyMovedNotificationData(structure, wrap) {
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  const structureTypeID = normalizePositiveInt(structure && structure.typeID, 0);
  const solarSystemID = normalizePositiveInt(structure && structure.solarSystemID, 0);
  const structureName = String(
    structure && (structure.itemName || structure.name || `Structure ${structureID}`),
  );
  const minimumDurationMs = DAYS_UNTIL_CAN_DELIVER * DAY_MS;
  const fullDurationMs = DAYS_UNTIL_AUTO_MOVE * DAY_MS;
  const ejectTimeMs = normalizeTimestampMs(wrap && wrap.ejectTimeMs, Date.now()) || Date.now();
  return {
    structureID,
    structureShowInfoData: ["showinfo", structureTypeID, structureID],
    solarsystemID: solarSystemID,
    structureTypeID,
    assetSafetyDurationMinimum: durationMsToLong(minimumDurationMs),
    assetSafetyMinimumTimestamp: msToFiletimeLong(ejectTimeMs + minimumDurationMs),
    assetSafetyDurationFull: durationMsToLong(fullDurationMs),
    assetSafetyFullTimestamp: msToFiletimeLong(ejectTimeMs + fullDurationMs),
    isCorpOwned: wrap && wrap.ownerKind === "corp",
    structureLink: `<a href="showinfo:${structureTypeID}//${structureID}">${structureName}</a>`,
    newStationID:
      normalizePositiveInt(
        wrap && wrap.nearestNPCStationInfo && wrap.nearestNPCStationInfo.itemID,
        0,
      ) || null,
  };
}

function buildStructureItemsNeedAttentionNotificationData(structure) {
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  const structureTypeID = normalizePositiveInt(structure && structure.typeID, 0);
  const solarSystemID = normalizePositiveInt(structure && structure.solarSystemID, 0);
  return {
    structureID,
    structureShowInfoData: ["showinfo", structureTypeID, structureID],
    solarsystemID: solarSystemID,
    structureTypeID,
  };
}

function collectAssetSafetyNotificationRecipients(wrap) {
  if (!wrap) {
    return [];
  }
  const ownerID = normalizePositiveInt(wrap.ownerID, 0);
  if (!ownerID) {
    return [];
  }
  if (wrap.ownerKind === "corp") {
    return [...new Set(getCharacterIDsInCorporation(ownerID))];
  }
  return [ownerID];
}

function collectStructureOwnerNotificationRecipients(ownerID) {
  const numericOwnerID = normalizePositiveInt(ownerID, 0);
  if (!numericOwnerID) {
    return [];
  }
  if (getOwnerKindForAssetSafety(numericOwnerID) === "corp") {
    return [...new Set(getCharacterIDsInCorporation(numericOwnerID))];
  }
  return [numericOwnerID];
}

function createAssetSafetyMovedNotifications(structure, wrap) {
  const recipients = collectAssetSafetyNotificationRecipients(wrap);
  if (recipients.length <= 0) {
    return;
  }
  const senderID = normalizePositiveInt(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
  const data = buildAssetSafetyMovedNotificationData(structure, wrap);
  for (const characterID of recipients) {
    const result = createNotification(characterID, {
      typeID: NOTIFICATION_TYPE.STRUCTURE_ITEMS_TO_ASSET_SAFETY,
      senderID,
      groupID: NOTIFICATION_GROUP.STRUCTURES,
      processed: false,
      data,
      emitLive: false,
    });
    if (!result || result.success !== true) {
      log.warn(
        `[StructureAssetSafety] Failed to create asset-safety notification ` +
        `structure=${data.structureID} wrap=${wrap.assetWrapID} ` +
        `character=${characterID}: ${result && result.errorMsg ? result.errorMsg : "UNKNOWN"}`,
      );
    }
  }
}

function createStructureItemsNeedAttentionNotifications(structure, ownerID) {
  const recipients = collectStructureOwnerNotificationRecipients(ownerID);
  if (recipients.length <= 0) {
    return;
  }
  const senderID = normalizePositiveInt(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
  const data = buildStructureItemsNeedAttentionNotificationData(structure);
  for (const characterID of recipients) {
    const result = createNotification(characterID, {
      typeID: NOTIFICATION_TYPE.STRUCTURE_ITEMS_NEED_ATTENTION,
      senderID,
      groupID: NOTIFICATION_GROUP.STRUCTURES,
      processed: false,
      data,
      emitLive: false,
    });
    if (!result || result.success !== true) {
      log.warn(
        `[StructureAssetSafety] Failed to create items-need-attention notification ` +
        `structure=${data.structureID} owner=${ownerID} ` +
        `character=${characterID}: ${result && result.errorMsg ? result.errorMsg : "UNKNOWN"}`,
      );
    }
  }
}

function ejectStructureAssetsToSpace(ownerID, structure, items, index, options = {}) {
  const numericOwnerID = normalizePositiveInt(ownerID, 0);
  const solarSystemID = normalizePositiveInt(structure && structure.solarSystemID, 0);
  const structureItems = Array.isArray(items) ? items : [];
  if (!numericOwnerID || !solarSystemID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (structureItems.length === 0) {
    return {
      success: true,
      data: {
        ejectedContainer: null,
        movedItemIDs: [],
      },
    };
  }

  const containerType = resolveItemByTypeID(OFFICE_EJECT_CONTAINER_TYPE_ID);
  if (!containerType) {
    return {
      success: false,
      errorMsg: "DROP_CONTAINER_TYPE_NOT_FOUND",
    };
  }

  const position = buildStructureScatterPosition(structure, index, options);
  const createContainerResult = createSpaceItemForOwner(
    numericOwnerID,
    solarSystemID,
    containerType,
    {
      itemName: buildStructureEjectContainerName(structure),
      position,
      direction: getStructureSpaceDirection(structure),
      targetPoint: position,
      createdAtMs: options.nowMs ?? Date.now(),
      launcherID: normalizePositiveInt(structure && structure.structureID, 0),
    },
  );
  if (!createContainerResult.success || !createContainerResult.data) {
    return createContainerResult;
  }

  const container = createContainerResult.data;
  const movedItemIDs = [];
  for (const item of structureItems) {
    const itemID = normalizePositiveInt(item && item.itemID, 0);
    if (!itemID) {
      continue;
    }
    const moveResult = moveItemToLocation(itemID, container.itemID, ITEM_FLAGS.HANGAR);
    if (!moveResult.success) {
      log.warn(
        `[StructureAssetSafety] Failed to eject structure item ${itemID} into container ${container.itemID}: ${moveResult.errorMsg}`,
      );
      continue;
    }
    movedItemIDs.push(itemID);
  }

  if (movedItemIDs.length > 0) {
    createStructureItemsNeedAttentionNotifications(structure, numericOwnerID);
  }

  return {
    success: true,
    data: {
      ejectedContainer: findItemById(container.itemID) || container,
      movedItemIDs,
    },
  };
}

function handOffStructureAttachedItemsForUnanchor(structure, options = {}) {
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  const solarSystemID = normalizePositiveInt(structure && structure.solarSystemID, 0);
  const ownerID = normalizePositiveInt(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
  if (!structureID || !solarSystemID || !ownerID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const topLevelItems = listContainerItems(null, structureID, null)
    .filter((item) => normalizePositiveInt(item && item.locationID, 0) === structureID);
  const rigItems = topLevelItems.filter(isStructureRigSlotItem);
  const attachedItems = topLevelItems.filter((item) =>
    !isStructureRigSlotItem(item) && isStructureAttachedItemForUnanchor(item),
  );
  const existingCoreItem = attachedItems.find(
    (item) =>
      normalizePositiveInt(item && item.flagID, 0) === ITEM_FLAGS.STRUCTURE_DEED &&
      normalizePositiveInt(item && item.typeID, 0) ===
        normalizePositiveInt(structure && structure.quantumCoreItemTypeID, 0),
  );
  const shouldCreateCore =
    structure &&
    structure.hasQuantumCore === true &&
    !existingCoreItem &&
    normalizePositiveInt(structure.quantumCoreItemTypeID, 0) > 0;

  const destroyedRigItemIDs = [];
  for (const item of rigItems) {
    const itemID = normalizePositiveInt(item && item.itemID, 0);
    if (!itemID) {
      continue;
    }
    const removeResult = removeInventoryItem(itemID, { removeContents: true });
    if (!removeResult.success) {
      return removeResult;
    }
    destroyedRigItemIDs.push(itemID);
  }

  if (attachedItems.length === 0 && !shouldCreateCore) {
    return {
      success: true,
      data: {
        decommissionContainer: null,
        movedItemIDs: [],
        destroyedRigItemIDs,
        quantumCore: {
          movedExisting: false,
          created: false,
        },
      },
    };
  }

  const containerType = resolveItemByTypeID(OFFICE_EJECT_CONTAINER_TYPE_ID);
  if (!containerType) {
    return {
      success: false,
      errorMsg: "DROP_CONTAINER_TYPE_NOT_FOUND",
    };
  }

  const position = buildStructureScatterPosition(structure, 0, options);
  const createContainerResult = createSpaceItemForOwner(
    ownerID,
    solarSystemID,
    containerType,
    {
      itemName: buildStructureDecommissionContainerName(structure),
      position,
      direction: getStructureSpaceDirection(structure),
      targetPoint: position,
      createdAtMs: options.nowMs ?? Date.now(),
      launcherID: structureID,
    },
  );
  if (!createContainerResult.success || !createContainerResult.data) {
    return createContainerResult;
  }

  const container = createContainerResult.data;
  const movedItemIDs = [];
  for (const item of attachedItems) {
    const itemID = normalizePositiveInt(item && item.itemID, 0);
    if (!itemID) {
      continue;
    }
    const moveResult = moveItemToLocation(itemID, container.itemID, ITEM_FLAGS.HANGAR);
    if (!moveResult.success) {
      return moveResult;
    }
    movedItemIDs.push(itemID);
  }

  let createdCoreItemID = null;
  if (shouldCreateCore) {
    const coreType = resolveItemByTypeID(structure.quantumCoreItemTypeID);
    if (!coreType) {
      return {
        success: false,
        errorMsg: "QUANTUM_CORE_TYPE_NOT_FOUND",
      };
    }
    const coreGrantResult = grantItemToOwnerLocation(
      ownerID,
      container.itemID,
      ITEM_FLAGS.HANGAR,
      coreType,
      1,
      {
        itemName: coreType.name,
        singleton: 1,
      },
    );
    if (!coreGrantResult.success) {
      return coreGrantResult;
    }
    const coreItem =
      coreGrantResult.data &&
      Array.isArray(coreGrantResult.data.items) &&
      coreGrantResult.data.items[0];
    createdCoreItemID = normalizePositiveInt(coreItem && coreItem.itemID, 0);
    if (createdCoreItemID) {
      movedItemIDs.push(createdCoreItemID);
    }
  }

  return {
    success: true,
    data: {
      decommissionContainer: findItemById(container.itemID) || container,
      movedItemIDs,
      destroyedRigItemIDs,
      quantumCore: {
        movedExisting: Boolean(existingCoreItem),
        created: Boolean(createdCoreItemID),
        itemID: createdCoreItemID || normalizePositiveInt(existingCoreItem && existingCoreItem.itemID, 0) || null,
      },
    },
  };
}

function ejectCorporationOfficeAssetsToSpace(corporationID, structure, office, items, options = {}) {
  const corpID = normalizePositiveInt(corporationID, 0);
  const solarSystemID = normalizePositiveInt(structure && structure.solarSystemID, 0);
  const officeItems = Array.isArray(items) ? items : [];
  if (!corpID || !solarSystemID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (officeItems.length === 0) {
    return {
      success: true,
      data: {
        createdWrap: null,
        ejectedContainer: null,
        movedItemIDs: [],
      },
    };
  }

  const containerType = resolveItemByTypeID(OFFICE_EJECT_CONTAINER_TYPE_ID);
  if (!containerType) {
    return {
      success: false,
      errorMsg: "DROP_CONTAINER_TYPE_NOT_FOUND",
    };
  }

  const position = buildStructureScatterPosition(structure, 0, options);
  const createContainerResult = createSpaceItemForOwner(
    corpID,
    solarSystemID,
    containerType,
    {
      itemName: buildOfficeEjectContainerName(structure),
      position,
      direction: getStructureSpaceDirection(structure),
      targetPoint: position,
      createdAtMs: options.nowMs ?? Date.now(),
      launcherID: normalizePositiveInt(structure && structure.structureID, 0),
    },
  );
  if (!createContainerResult.success || !createContainerResult.data) {
    return createContainerResult;
  }

  const container = createContainerResult.data;
  const movedItemIDs = [];
  for (const item of officeItems) {
    const itemID = normalizePositiveInt(item && item.itemID, 0);
    if (!itemID) {
      continue;
    }
    const moveResult = moveItemToLocation(itemID, container.itemID, ITEM_FLAGS.HANGAR);
    if (!moveResult.success) {
      log.warn(
        `[StructureAssetSafety] Failed to eject office item ${itemID} into container ${container.itemID}: ${moveResult.errorMsg}`,
      );
      continue;
    }
    movedItemIDs.push(itemID);
  }

  if (movedItemIDs.length > 0) {
    createStructureItemsNeedAttentionNotifications(structure, corpID);
  }

  return {
    success: true,
    data: {
      createdWrap: null,
      ejectedContainer: findItemById(container.itemID) || container,
      movedItemIDs,
      officeID: normalizePositiveInt(office && office.officeID, 0),
    },
  };
}

function createWrapFromItems(ownerKind, ownerID, structure, items = [], options = {}) {
  const topLevelItems = (Array.isArray(items) ? items : [])
    .map((item) => {
      const itemID = normalizePositiveInt(item && item.itemID, 0);
      return itemID > 0 ? (findItemById(itemID) || item) : null;
    })
    .filter(Boolean);

  if (topLevelItems.length === 0) {
    return {
      success: true,
      data: {
        createdWrap: null,
        movedItemIDs: [],
      },
    };
  }

  const structureName = String(
    structure && (structure.itemName || structure.name || `Structure ${structure.structureID}`),
  );
  const wrapCreateResult = createWrap({
    ownerID: normalizePositiveInt(ownerID, 0),
    ownerKind,
    sourceStructureID: normalizePositiveInt(structure && structure.structureID, 0),
    solarSystemID: normalizePositiveInt(structure && structure.solarSystemID, 0),
    wrapName: options.wrapName || `${structureName} Asset Safety`,
    itemIDs: topLevelItems.map((item) => normalizePositiveInt(item.itemID, 0)).filter(Boolean),
    createdAt: normalizeTimestampMs(options.nowMs, Date.now()) || Date.now(),
    ejectTimeMs: normalizeTimestampMs(options.nowMs, Date.now()) || Date.now(),
    nearestNPCStationInfo:
      normalizeStationInfo(options.nearestNPCStationInfo) ||
      getFallbackNpcStationInfo(structure && structure.solarSystemID),
    assetSafetyDisabled: Boolean(options.assetSafetyDisabled),
  });
  if (!wrapCreateResult.success) {
    return wrapCreateResult;
  }

  const movedItemIDs = [];
  for (const item of topLevelItems) {
    const moveResult = moveItemToLocation(
      item.itemID,
      wrapCreateResult.data.assetWrapID,
      ASSET_SAFETY_FLAG_ID,
    );
    if (!moveResult.success) {
      log.warn(
        `[StructureAssetSafety] Failed to move item ${item.itemID} into wrap ${wrapCreateResult.data.assetWrapID}: ${moveResult.errorMsg}`,
      );
      continue;
    }
    movedItemIDs.push(normalizePositiveInt(item.itemID, 0));
  }

  if (movedItemIDs.length > 0) {
    const refreshResult = updateWrap(wrapCreateResult.data.assetWrapID, (current) => ({
      ...current,
      itemIDs: movedItemIDs,
    }));
    if (!refreshResult.success) {
      return refreshResult;
    }
    createAssetSafetyMovedNotifications(structure, refreshResult.data);
    return {
      success: true,
      data: {
        createdWrap: refreshResult.data,
        movedItemIDs,
      },
    };
  }

  return {
    success: true,
    data: {
      createdWrap: wrapCreateResult.data,
      movedItemIDs: [],
    },
  };
}

function listItemsInsideWrap(wrap) {
  if (!wrap) {
    return [];
  }
  return listContainerItems(
    normalizePositiveInt(wrap.ownerID, 0),
    normalizePositiveInt(wrap.assetWrapID, 0),
    ASSET_SAFETY_FLAG_ID,
  );
}

function deliverWrapToDestination(assetWrapID, destinationID, options = {}) {
  // Automatic delivery already runs inside tickAssetSafetyWraps. Refreshing
  // here would re-enter the tick before the current wrap can be delivered.
  const wrap = getWrapByID(assetWrapID, { refresh: false });
  if (!wrap) {
    return {
      success: false,
      errorMsg: "WRAP_NOT_FOUND",
    };
  }
  if (wrap.deliveredAt) {
    return {
      success: false,
      errorMsg: "WRAP_ALREADY_DELIVERED",
    };
  }

  const session = options.session || null;
  if (options.skipAccessCheck !== true && !sessionCanManageWrap(session, wrap)) {
    return {
      success: false,
      errorMsg: "WRAP_ACCESS_DENIED",
    };
  }

  const nowMs = normalizeTimestampMs(options.nowMs, Date.now()) || Date.now();
  const structureState = require(path.join(__dirname, "./structureState"));
  const bypass = Boolean(
    options.ignoreTimer === true || structureState.hasStructureGmBypass(session),
  );
  if (!bypass && nowMs < getWrapUnlockTimeMs(wrap)) {
    return {
      success: false,
      errorMsg: "WRAP_NOT_READY",
    };
  }

  const numericDestinationID = normalizePositiveInt(destinationID, 0) ||
    normalizePositiveInt(
      wrap.nearestNPCStationInfo && wrap.nearestNPCStationInfo.itemID,
      0,
    );
  if (!numericDestinationID) {
    return {
      success: false,
      errorMsg: "DESTINATION_NOT_FOUND",
    };
  }

  let destinationKind = "station";
  const destinationStructure = worldData.getStructureByID(numericDestinationID);
  if (destinationStructure) {
    destinationKind = "structure";
    if (
      destinationStructure.destroyedAt ||
      destinationStructure.solarSystemID !== wrap.solarSystemID
    ) {
      return {
        success: false,
        errorMsg: "INVALID_DESTINATION_STRUCTURE",
      };
    }

    const accessResult = structureState.canCharacterDockAtStructure(
      session,
      destinationStructure,
      {
        ignoreRestrictions: structureState.hasStructureGmBypass(session),
      },
    );
    if (!accessResult.success) {
      return {
        success: false,
        errorMsg: accessResult.errorMsg || "DESTINATION_ACCESS_DENIED",
      };
    }
  } else {
    const destinationStation = worldData.getStationByID(numericDestinationID);
    if (!destinationStation) {
      return {
        success: false,
        errorMsg: "DESTINATION_NOT_FOUND",
      };
    }
    if (
      normalizePositiveInt(destinationStation.solarSystemID, 0) !== wrap.solarSystemID &&
      numericDestinationID !== normalizePositiveInt(
        wrap.nearestNPCStationInfo && wrap.nearestNPCStationInfo.itemID,
        0,
      )
    ) {
      return {
        success: false,
        errorMsg: "INVALID_DESTINATION_STATION",
      };
    }
  }

  const movedItemIDs = [];
  for (const item of listItemsInsideWrap(wrap)) {
    const moveResult = moveItemToLocation(item.itemID, numericDestinationID, ITEM_FLAGS.HANGAR);
    if (!moveResult.success) {
      return moveResult;
    }
    movedItemIDs.push(normalizePositiveInt(item.itemID, 0));
  }

  return updateWrap(wrap.assetWrapID, (current) => ({
    ...current,
    destinationID: numericDestinationID,
    destinationKind,
    deliveredAt: nowMs,
    autoMovedAt: options.autoMove === true ? nowMs : current.autoMovedAt,
    itemIDs: movedItemIDs.length > 0 ? movedItemIDs : current.itemIDs,
  }));
}

function tickAssetSafetyWraps(nowMs = Date.now()) {
  const normalizedNowMs = normalizeTimestampMs(nowMs, Date.now()) || Date.now();
  const wraps = ensureWrapCache().wraps;
  let changed = false;

  for (const wrap of wraps) {
    if (wrap.deliveredAt || !wrap.nearestNPCStationInfo) {
      continue;
    }
    if (normalizedNowMs < getWrapAutoMoveTimeMs(wrap)) {
      continue;
    }

    const deliverResult = deliverWrapToDestination(
      wrap.assetWrapID,
      wrap.nearestNPCStationInfo.itemID,
      {
        session: null,
        skipAccessCheck: true,
        ignoreTimer: true,
        autoMove: true,
        nowMs: normalizedNowMs,
      },
    );
    if (!deliverResult.success) {
      log.warn(
        `[StructureAssetSafety] Auto-move failed for wrap ${wrap.assetWrapID}: ${deliverResult.errorMsg}`,
      );
      continue;
    }
    changed = true;
  }

  if (changed) {
    wrapCache = null;
  }
  return listWraps({
    includeDelivered: true,
    nowMs: normalizedNowMs,
    refresh: false,
  });
}

function movePersonalAssetsToSafety(session, solarSystemID, structureID, options = {}) {
  const structureState = require(path.join(__dirname, "./structureState"));
  const charID = getSessionCharacterID(session);
  const structure = worldData.getStructureByID(structureID);
  if (!charID || !structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (
    normalizePositiveInt(solarSystemID, structure.solarSystemID) !==
    normalizePositiveInt(structure.solarSystemID, 0)
  ) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_MISMATCH",
    };
  }

  const assetSafetyDisabled =
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) &&
    !structureState.hasStructureGmBypass(session);
  if (assetSafetyDisabled) {
    return {
      success: false,
      errorMsg: "ASSET_SAFETY_DISABLED",
    };
  }

  const activeShipID = normalizePositiveInt(
    options.excludeActiveShipID ||
      (session && session.structureID === structure.structureID && (session.activeShipID || session.shipID || session.shipid)),
    0,
  );
  return createWrapFromItems(
    "char",
    charID,
    structure,
    listTopLevelStructureItems(charID, structure.structureID, {
      excludeItemIDs: activeShipID ? [activeShipID] : [],
    }),
    options,
  );
}

function moveCorporationAssetsToSafety(session, solarSystemID, structureID, options = {}) {
  const structureState = require(path.join(__dirname, "./structureState"));
  const corpID = getSessionCorporationID(session);
  const structure = worldData.getStructureByID(structureID);
  if (!corpID || !structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  if (
    normalizePositiveInt(solarSystemID, structure.solarSystemID) !==
    normalizePositiveInt(structure.solarSystemID, 0)
  ) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_MISMATCH",
    };
  }

  const assetSafetyDisabled =
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) &&
    !structureState.hasStructureGmBypass(session);
  if (assetSafetyDisabled) {
    return {
      success: false,
      errorMsg: "ASSET_SAFETY_DISABLED",
    };
  }

  return createWrapFromItems(
    "corp",
    corpID,
    structure,
    listTopLevelStructureItems(corpID, structure.structureID),
    options,
  );
}

function moveCorporationOfficeAssetsToSafety(corporationID, structure, office, options = {}) {
  const corpID = normalizePositiveInt(corporationID, 0);
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  if (!corpID || !structureID || !office) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const officeItems = listTopLevelCorporationOfficeItems(corpID, office);
  if (officeItems.length === 0) {
    return {
      success: true,
      data: {
        createdWrap: null,
        movedItemIDs: [],
      },
    };
  }

  const structureState = require(path.join(__dirname, "./structureState"));
  const assetSafetyDisabled =
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) &&
    !structureState.hasStructureGmBypass(options.session);
  if (assetSafetyDisabled) {
    return ejectCorporationOfficeAssetsToSpace(
      corpID,
      structure,
      office,
      officeItems,
      options,
    );
  }

  const structureName = String(
    structure && (structure.itemName || structure.name || `Structure ${structureID}`),
  );
  return createWrapFromItems(
    "corp",
    corpID,
    structure,
    officeItems,
    {
      ...options,
      wrapName: options.wrapName || `${structureName} Office Asset Safety`,
    },
  );
}

function handleStructureDestroyed(structure, options = {}) {
  if (!structure || normalizePositiveInt(structure.structureID, 0) <= 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const structureState = require(path.join(__dirname, "./structureState"));
  const bypass = structureState.hasStructureGmBypass(options.session);
  const assetSafetyDisabled = (
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) ||
    Number(structure.upkeepState || 0) === STRUCTURE_UPKEEP_STATE.ABANDONED
  ) && !bypass;
  if (assetSafetyDisabled) {
    log.warn(
      `[StructureAssetSafety] Asset safety is disabled for destroyed structure ${structure.structureID}; structure contents must be handled by the destruction-loot path instead.`,
    );
    return {
      success: false,
      errorMsg: "ASSET_SAFETY_DISABLED",
    };
  }

  const ownerIDs = new Set();
  for (const item of listContainerItems(null, structure.structureID, null)) {
    ownerIDs.add(normalizePositiveInt(item && item.ownerID, 0));
  }

  const createdWraps = [];
  for (const ownerID of ownerIDs) {
    if (!ownerID) {
      continue;
    }
    const ownerKind = getOwnerKindForAssetSafety(ownerID);
    const wrapResult = createWrapFromItems(
      ownerKind,
      ownerID,
      structure,
      listTopLevelStructureItems(ownerID, structure.structureID),
      {
        nowMs: options.nowMs,
      },
    );
    if (!wrapResult.success) {
      log.warn(
        `[StructureAssetSafety] Failed to create ${ownerKind} wrap for owner ${ownerID} on structure ${structure.structureID}: ${wrapResult.errorMsg}`,
      );
      continue;
    }
    if (wrapResult.data && wrapResult.data.createdWrap) {
      createdWraps.push(wrapResult.data.createdWrap);
    }
  }

  return {
    success: true,
    data: {
      createdWraps,
    },
  };
}

function handleStructureUnanchored(structure, options = {}) {
  if (!structure || normalizePositiveInt(structure.structureID, 0) <= 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const structureState = require(path.join(__dirname, "./structureState"));
  const bypass = structureState.hasStructureGmBypass(options.session);
  const assetSafetyDisabled =
    isAssetSafetyDisabledSolarSystem(structure.solarSystemID) && !bypass;

  const ownerIDs = new Set();
  for (const item of listContainerItems(null, structure.structureID, null)) {
    if (!isStructureHangarAssetItem(item)) {
      continue;
    }
    const ownerID = normalizePositiveInt(item && item.ownerID, 0);
    if (ownerID) {
      ownerIDs.add(ownerID);
    }
  }

  const createdWraps = [];
  const ejectedContainers = [];
  const movedItemIDs = [];
  const attachedHandoffResult = handOffStructureAttachedItemsForUnanchor(
    structure,
    options,
  );
  if (!attachedHandoffResult.success) {
    return attachedHandoffResult;
  }
  let ownerIndex =
    attachedHandoffResult.data && attachedHandoffResult.data.decommissionContainer ? 1 : 0;
  for (const ownerID of ownerIDs) {
    const ownerItems = listTopLevelStructureHangarItems(ownerID, structure.structureID);
    if (ownerItems.length === 0) {
      continue;
    }

    if (assetSafetyDisabled) {
      const ejectResult = ejectStructureAssetsToSpace(
        ownerID,
        structure,
        ownerItems,
        ownerIndex,
        options,
      );
      ownerIndex += 1;
      if (!ejectResult.success) {
        return ejectResult;
      }
      if (ejectResult.data && ejectResult.data.ejectedContainer) {
        ejectedContainers.push(ejectResult.data.ejectedContainer);
      }
      if (ejectResult.data && Array.isArray(ejectResult.data.movedItemIDs)) {
        movedItemIDs.push(...ejectResult.data.movedItemIDs);
      }
      continue;
    }

    const ownerKind = getOwnerKindForAssetSafety(ownerID);
    const wrapResult = createWrapFromItems(
      ownerKind,
      ownerID,
      structure,
      ownerItems,
      {
        nowMs: options.nowMs,
      },
    );
    if (!wrapResult.success) {
      return wrapResult;
    }
    if (wrapResult.data && wrapResult.data.createdWrap) {
      createdWraps.push(wrapResult.data.createdWrap);
    }
    if (wrapResult.data && Array.isArray(wrapResult.data.movedItemIDs)) {
      movedItemIDs.push(...wrapResult.data.movedItemIDs);
    }
  }

  return {
    success: true,
    data: {
      assetSafetyDisabled,
      createdWraps,
      ejectedContainers,
      movedItemIDs,
      attachedHandoff: attachedHandoffResult.data || null,
    },
  };
}

function getDeliveryTargetsForSession(session, solarSystemID) {
  const structureState = require(path.join(__dirname, "./structureState"));
  const numericSystemID = normalizePositiveInt(solarSystemID, 0);
  const structures = structureState.listDockableStructuresForCharacter(session, {
    solarSystemID: numericSystemID,
  }).map((structure) => ({
    itemID: structure.structureID,
    typeID: structure.typeID,
    solarSystemID: structure.solarSystemID,
    itemName: structure.itemName || structure.name || `Structure ${structure.structureID}`,
  }));
  return {
    structures,
    nearestNPCStationInfo: getFallbackNpcStationInfo(numericSystemID),
  };
}

function shiftWrapEjectTimeGM(assetWrapID, daysDelta) {
  const normalizedDays = Number(daysDelta) || 0;
  return updateWrap(assetWrapID, (current) => ({
    ...current,
    ejectTimeMs: normalizeTimestampMs(current.ejectTimeMs, Date.now()) + Math.round(normalizedDays * DAY_MS),
  }));
}

function resetStructureAssetSafetyStateForTests() {
  wrapCache = null;
  stationCache = null;
}

module.exports = {
  STRUCTURE_ASSET_SAFETY_TABLE,
  ASSET_SAFETY_FLAG_ID,
  ASSET_SAFETY_WRAP_TYPE_ID,
  DAYS_UNTIL_CAN_DELIVER,
  DAYS_UNTIL_AUTO_MOVE,
  listWraps,
  getWrapByID,
  getWrapNames,
  listWrapsForOwner,
  movePersonalAssetsToSafety,
  moveCorporationAssetsToSafety,
  moveCorporationOfficeAssetsToSafety,
  getDeliveryTargetsForSession,
  deliverWrapToDestination,
  shiftWrapEjectTimeGM,
  tickAssetSafetyWraps,
  handleStructureDestroyed,
  handleStructureUnanchored,
  isAssetSafetyDisabledSolarSystem,
  resetStructureAssetSafetyStateForTests,
};
