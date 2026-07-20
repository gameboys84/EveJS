/**
 * Inventory Broker Service (invbroker)
 *
 * Handles inventory/item queries from the client.
 * Called after character selection to load inventory data.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));
const {
  resolveSessionCharacterID,
} = require(path.join(__dirname, "../_shared/sessionIdentity"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const {
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  shouldFlushDeferredDockedShipSessionChange,
  flushDeferredDockedShipSessionChange,
  completeDockedFittingBootstrap,
  syncInventoryItemForSession,
  syncShipFittingStateForSession,
  emitItemsChangedBatchForSession,
  emitFittingTransactionForSession,
  buildInventoryDogmaPrimeEntry,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
  listContainerItems,
  findItemById,
  findShipItemById,
  getItemMetadata,
  getInventoryItemUnitVolume,
  grantItemToCharacterLocation,
  moveItemToLocation,
  removeInventoryItem,
  takeItemTypeFromCharacterLocation,
  transferItemToOwnerLocation,
  mergeItemStacks,
  updateInventoryItem,
} = require(path.join(__dirname, "./itemStore"));
const {
  getCorporationOfficeByInventoryID,
  getCorporationOffices,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "./itemTypeRegistry"));
const {
  isShipFittingFlag,
  listFittedItems,
  listFittedItemsForLocation,
  selectAutoFitFlagForType,
  validateFitForShip,
  resolveFitOnlineState,
  getShipBaseAttributeValue,
  getTypeAttributeValue,
  getTypeDogmaAttributes,
  getLoadedChargeByFlag,
  getFittedModuleByFlag,
  getLoadedChargeItems,
  buildChargeTupleItemID,
  getModuleChargeCapacity,
  isChargeCompatibleWithModule,
  SLOT_FAMILY_FLAGS,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getShipFittingSnapshot,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingRuntime"));
const {
  clearModuleFromBanksAndNotify,
  getMasterModuleID: getWeaponBankMasterModuleID,
  notifyWeaponBanksChanged,
  getShipWeaponBanks,
} = require(path.join(__dirname, "../moduleGrouping/moduleGroupingRuntime"));
const {
  MINING_SHIP_BAY_FLAGS,
  isItemTypeAllowedInHoldFlag,
  getShipHoldCapacityByFlag,
} = require(path.join(__dirname, "../mining/miningInventory"));
const {
  isFuelBayFlag,
  isStructureFuelBayFlag,
  isFuelBayCompatibleItem,
  isStructureFuelBayCompatibleItem,
  getFuelBayCapacity,
  ICE_PRODUCT_GROUP_ID,
  STRUCTURE_FUEL_BAY_FLAG,
  TYPE_UPWELL_AUTO_MOON_MINER,
} = require(path.join(__dirname, "./fuelBayInventory"));
const {
  SPECIAL_SHIP_HOLD_FLAGS,
  isSpecialShipHoldFlag,
  isGenericSpecialShipHoldFlag,
  isSpecialShipHoldItemAllowed,
  getSpecialShipHoldCapacity,
} = require(path.join(__dirname, "./specialShipHoldRegistry"));
const {
  canLoadFighterTypeIntoHostTube,
  isDroneItemRecord,
  isFighterItemRecord,
  isFighterTubeFlag,
} = require(path.join(__dirname, "../fighter/fighterInventory"));
const runtime = require(path.join(__dirname, "../../space/runtime"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const nativeNpcStore = require(path.join(__dirname, "../../space/npc/nativeNpcStore"));
const nativeNpcWreckService = require(path.join(__dirname, "../../space/npc/nativeNpcWreckService"));
const {
  maybeExpireEmptySpaceContainer,
} = require(path.join(__dirname, "../ship/jettisonRuntime"));
const dungeonUniverseSiteService = require(path.join(
  __dirname,
  "../dungeon/dungeonUniverseSiteService",
));
const {
  DEFAULT_STATION,
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const {
  STRUCTURE_FAMILY,
  STRUCTURE_SERVICE_ID,
  STRUCTURE_STATE,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  isStructureServiceSlotFlag,
  syncStructureServiceModuleState,
  tryAutoOnlineFittedStructureServiceModule,
} = require(path.join(__dirname, "../structure/structureServiceModules"));
const {
  buildCrpAccessDeniedInsufficientRolesValues,
  characterCanDisableStructureServiceModule,
  isStructureReactionServiceModuleType,
  STRUCTURE_SETTING_ID,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  canTakeFromOwnerLocation,
} = require(path.join(__dirname, "../industry/industryAccess"));
const {
  characterHasStructureSetting,
  characterHasStructureService,
} = require(path.join(__dirname, "../structure/structurePayloads"));
const {
  cancelIndustryJobsForRemovedServiceModule,
} = require(path.join(__dirname, "../structure/structureIndustryJobs"));
const {
  getCharacterSkills,
  SKILL_FLAG_ID,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  describeSessionHydrationState,
} = require(path.join(__dirname, "../chat/commandSessionEffects"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  buildDict,
  buildList,
  buildPackedRow,
  buildPackedRowDescriptor,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
  buildNotEnoughMoneyUserErrorValues,
  getCharacterWallet,
} = require(path.join(__dirname, "../account/walletState"));
const planetCostCalculator = require(path.join(
  __dirname,
  "../planet/planetCostCalculator",
));
const planetRuntimeStore = require(path.join(
  __dirname,
  "../planet/planetRuntimeStore",
));
const planetOrbitalState = require(path.join(
  __dirname,
  "../planet/planetOrbitalState",
));
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));
const {
  MOBILE_DEPOT_FITTING_RANGE_METERS,
  validateMobileDepotCargoAccess,
  validateMobileDepotFittingAccess,
} = require(path.join(__dirname, "../ship/mobileDepotRuntime"));
const {
  isShipServiceFlag,
  validateShipServiceAccess,
} = require(path.join(__dirname, "../ship/shipServiceAccess"));

const inventoryDebugPath = path.join(
  __dirname,
  "../../../logs/inventory-debug.log",
);
const CANNOT_TRASH_ERROR = "CannotTrashItem";
const CONTAINER_HANGAR_ID = 10004;
const CONTAINER_CORP_MARKET_ID = 10012;
const CONTAINER_STRUCTURE_ID = 10014;
const CONTAINER_CAPSULEER_DELIVERIES_ID = 10015;
const CHARACTER_TYPE_ID = 1373;
const CHARACTER_GROUP_ID = 1;
const CHARACTER_CATEGORY_ID = 3;
const STATION_TYPE_ID = DEFAULT_STATION.stationTypeID;
const STATION_GROUP_ID = 15;
const STATION_CATEGORY_ID = 3;
const STATION_OWNER_ID = DEFAULT_STATION.ownerID;
const CATEGORY_DEPLOYABLE = 22;
const GROUP_MOBILE_TRACTOR_UNIT = 1250;
const FLOATING_CARGO_TYPE_ID = 23;
const USER_ERROR_FORMAT_GROUP_ID = 7; // eveexceptions.const.UE_GROUPID
const INVENTORY_ROW_HEADER = {
  type: "list",
  items: [
    "itemID",
    "typeID",
    "ownerID",
    "locationID",
    "flagID",
    "quantity",
    "groupID",
    "categoryID",
    "customInfo",
    "stacksize",
    "singleton",
  ],
};
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
  ["stacksize", { type: "token", value: "eve.common.script.sys.eveCfg.StackSize" }],
  ["singleton", { type: "token", value: "eve.common.script.sys.eveCfg.Singleton" }],
];
const CHARGE_SUBLOCATION_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 129],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
];
const SHIP_BAY_FLAGS = new Set([
  ITEM_FLAGS.HANGAR,
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.FUEL_BAY,
  ITEM_FLAGS.DRONE_BAY,
  ITEM_FLAGS.FIGHTER_BAY,
  ITEM_FLAGS.SHIP_HANGAR,
  ITEM_FLAGS.FLEET_HANGAR,
  ITEM_FLAGS.MOBILE_DEPOT_HOLD,
  ITEM_FLAGS.SPECIALIZED_COMMAND_CENTER_HOLD,
  ITEM_FLAGS.COLONY_RESOURCES_HOLD,
  ...FIGHTER_TUBE_FLAGS,
  ...MINING_SHIP_BAY_FLAGS,
  ...SPECIAL_SHIP_HOLD_FLAGS,
]);
const CORP_HANGAR_FLAGS = new Set([115, 116, 117, 118, 119, 120, 121, 184]);
const CORP_HANGAR_BROADCAST_IDTYPE = "*corpid&corprole&solarsystemid";
const STRUCTURE_DEED_GROUP_ID = 4086;
const MOBILE_DEPOT_GROUP_ID = 1246;
const MOBILE_DEPOT_HOLD_CAPACITY_ATTRIBUTE = "specialMobileDepotHoldCapacity";
const TYPE_STANDUP_MOON_DRILL = 45009;
const SECURITY_CLASS_ZERO_SEC = 0;
const SECURITY_CLASS_LOW_SEC = 1;
const SECURITY_CLASS_HIGH_SEC = 2;
const ATTRIBUTE_DISALLOW_IN_EMPIRE_SPACE = "disallowInEmpireSpace";
const ATTRIBUTE_DISALLOW_IN_HIGH_SEC = "disallowInHighSec";
const INTEGRATED_STRUCTURE_SERVICE_MODULE_TYPE_IDS = new Set([
  35912,
  35913,
  35914,
  82941,
]);
const CHARGE_CATEGORY_ID = 8;
const IMPLANT_CATEGORY_ID = 20;
const SHIP_CATEGORY_ID = 6;
const STRUCTURE_CATEGORY_ID = 65;
const FLAG_MOON_MATERIAL_BAY = 186;
const ATTRIBUTE_OUTPUT_MOON_MATERIAL_BAY_CAPACITY = 5693;
const CORP_ROLE_STATION_MANAGER = 2048n;
const STRUCTURE_OWNER_BAY_FLAGS = new Set([
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.FIGHTER_BAY,
  ...FIGHTER_TUBE_FLAGS,
  ...SLOT_FAMILY_FLAGS.service,
  ITEM_FLAGS.STRUCTURE_DEED,
  STRUCTURE_FUEL_BAY_FLAG,
]);

function isMobileDepotItemRecord(item) {
  if (!item) {
    return false;
  }
  const typeRecord = resolveItemByTypeID(item.typeID) || {};
  return Number(item.groupID || typeRecord.groupID) === MOBILE_DEPOT_GROUP_ID;
}

function appendInventoryDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(inventoryDebugPath, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[InvBroker] Failed to write inventory debug log: ${error.message}`);
  }
}

class InvBrokerService extends BaseService {
  constructor() {
    super("invbroker");
    this._boundContexts = new Map();
  }

  _getStationId(session) {
    return getDockedLocationID(session) || 0;
  }

  _getCharacterId(session) {
    return resolveSessionCharacterID(session);
  }

  _getCorporationId(session) {
    return (
      (session && (session.corporationID || session.corpid)) ||
      0
    );
  }

  _getCorporationOffice(session, inventoryID = null) {
    const corporationID = this._getCorporationId(session);
    const numericInventoryID = this._normalizeInventoryId(inventoryID, 0);
    if (corporationID <= 0 || numericInventoryID <= 0) {
      return null;
    }

    return getCorporationOfficeByInventoryID(corporationID, numericInventoryID);
  }

  _getCorporationOfficeAtLocation(session, locationID = null) {
    const corporationID = this._getCorporationId(session);
    const numericLocationID = this._normalizeInventoryId(locationID, 0);
    if (corporationID <= 0 || numericLocationID <= 0) {
      return null;
    }

    return getCorporationOffices(corporationID).find(
      (office) =>
        this._normalizeInventoryId(office && office.stationID, 0) === numericLocationID &&
        !office.impounded,
    ) || null;
  }

  _getCorporationOfficeForItemLocation(session, locationID = null) {
    const corporationID = this._getCorporationId(session);
    const numericLocationID = this._normalizeInventoryId(locationID, 0);
    if (corporationID <= 0 || numericLocationID <= 0) {
      return null;
    }

    return getCorporationOffices(corporationID).find((office) => {
      if (!office || office.impounded) {
        return false;
      }
      return [
        office.officeID,
        office.officeFolderID,
        office.itemID,
      ].some(
        (candidateID) =>
          this._normalizeInventoryId(candidateID, 0) === numericLocationID,
      );
    }) || null;
  }

  _resolveCorporationOfficeForInventory(session, officeOrLocationID = null) {
    return (
      this._getCorporationOffice(session, officeOrLocationID) ||
      this._getCorporationOfficeAtLocation(session, officeOrLocationID)
    );
  }

  _getGenericContainerContentsOwnerID(session, containerRecord) {
    const characterID = this._getCharacterId(session);
    if (!containerRecord) {
      return characterID;
    }

    const typeRecord = resolveItemByTypeID(containerRecord.typeID) || {};
    const categoryID = this._normalizeInventoryId(
      containerRecord.categoryID ?? typeRecord.categoryID,
      0,
    );
    const containerFlagID = this._normalizeInventoryId(containerRecord.flagID, 0);
    const containerLocationID = this._normalizeInventoryId(containerRecord.locationID, 0);
    if (
      containerLocationID > 0 &&
      containerFlagID === 0 &&
      categoryID !== SHIP_CATEGORY_ID &&
      categoryID !== STRUCTURE_CATEGORY_ID
    ) {
      return null;
    }

    const corporationID = this._normalizeInventoryId(this._getCorporationId(session), 0);
    const containerOwnerID = this._normalizeInventoryId(containerRecord.ownerID, 0);
    if (corporationID <= 0 || containerOwnerID !== corporationID) {
      return characterID;
    }

    return categoryID === SHIP_CATEGORY_ID || categoryID === STRUCTURE_CATEGORY_ID
      ? corporationID
      : characterID;
  }

  _isCorporationHangarFlag(flagID) {
    return CORP_HANGAR_FLAGS.has(this._normalizeInventoryId(flagID, 0));
  }

  _isInventoryBindFlag(flagID) {
    const numericFlag = this._normalizeInventoryId(flagID, 0);
    return (
      numericFlag > 0 &&
      (
        SHIP_BAY_FLAGS.has(numericFlag) ||
        isShipFittingFlag(numericFlag) ||
        this._isStructureOwnerBayFlag(numericFlag) ||
        this._isMoonMaterialBayFlag(numericFlag) ||
        this._isCorporationHangarFlag(numericFlag)
      )
    );
  }

  _getShipId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    return (
      (activeShip && activeShip.shipID) ||
      (session && (session.activeShipID || session.shipID || session.shipid)) ||
      140000101
    );
  }

  _getShipTypeId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    const shipTypeID = activeShip ? activeShip.shipTypeID : (
      session && Number.isInteger(session.shipTypeID) ? session.shipTypeID : null
    );
    return shipTypeID && shipTypeID > 0 ? shipTypeID : 606;
  }

  _getStoredShips(session) {
    const charId = this._getCharacterId(session);
    return getCharacterShips(charId);
  }

  _describeValue(value, depth = 0) {
    if (depth > 4) {
      return "<max-depth>";
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Buffer.isBuffer(value)) {
      return `<Buffer:${value.toString("utf8")}>`;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this._describeValue(entry, depth + 1));
    }

    if (typeof value === "object") {
      const summary = {};
      for (const [key, entryValue] of Object.entries(value)) {
        summary[key] = this._describeValue(entryValue, depth + 1);
      }
      return summary;
    }

    return String(value);
  }

  _traceInventory(method, session, payload = {}) {
    const entry = {
      method,
      charId: this._getCharacterId(session),
      stationId: this._getStationId(session),
      activeShipId: this._getShipId(session),
      boundContext: this._getBoundContext(session),
      spaceHydrationState: session && session._space
        ? describeSessionHydrationState(session)
        : null,
      ...payload,
    };
    appendInventoryDebug(JSON.stringify(this._describeValue(entry)));
  }

  _summarizeInventoryRowsForLog(items, limit = 12) {
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    const summary = {
      total: safeItems.length,
      cargo: 0,
      modules: 0,
      charges: 0,
      drones: 0,
      others: 0,
      preview: [],
    };

    for (const item of safeItems) {
      const itemID = this._normalizeInventoryId(item && item.itemID, 0);
      const flagID = this._normalizeInventoryId(item && item.flagID, 0);
      const typeID = this._normalizeInventoryId(item && item.typeID, 0);
      const groupID = this._normalizeInventoryId(item && item.groupID, 0);
      const categoryID = this._normalizeInventoryId(item && item.categoryID, 0);
      const quantity = Number(item && (item.stacksize ?? item.quantity) || 0);

      if (flagID === ITEM_FLAGS.CARGO_HOLD) {
        summary.cargo += 1;
      }
      if (categoryID === 7) {
        summary.modules += 1;
      } else if (categoryID === 8) {
        summary.charges += 1;
      } else if (categoryID === 18) {
        summary.drones += 1;
      } else if (categoryID !== 0) {
        summary.others += 1;
      }

      if (summary.preview.length < limit) {
        summary.preview.push(
          `${itemID}:${flagID}:${typeID}:${groupID}:${categoryID}:${quantity}`,
        );
      }
    }

    return summary;
  }

  _rememberBoundContext(oidString, context) {
    if (!oidString) {
      return;
    }

    this._boundContexts.set(oidString, {
      inventoryID: context.inventoryID ?? null,
      locationID: context.locationID ?? null,
      flagID: context.flagID ?? null,
      kind: context.kind || "inventory",
      ownerID: context.ownerID ?? null,
    });
  }

  _rememberSessionBoundContext(session, oidString, context, boundAtFileTime) {
    if (!session || !oidString) {
      return;
    }

    if (!session._boundObjectState || typeof session._boundObjectState !== "object") {
      session._boundObjectState = {};
    }

    const inventoryID = this._normalizeInventoryId(
      context && context.inventoryID,
      0,
    );
    const flagID =
      context && context.flagID !== null && context.flagID !== undefined
        ? this._normalizeInventoryId(context.flagID, 0)
        : "all";
    const kind = context && context.kind ? context.kind : "inventory";
    session._boundObjectState[
      `invbroker:${kind}:${inventoryID || "unknown"}:${flagID}:${oidString}`
    ] = {
      objectID: oidString,
      boundAtFileTime:
        boundAtFileTime || BigInt(Date.now()) * 10000n + 116444736000000000n,
    };
  }

  _getBoundContext(session) {
    if (!session || !session.currentBoundObjectID) {
      return null;
    }

    return this._boundContexts.get(session.currentBoundObjectID) || null;
  }

  _extractBoundObjectId(value) {
    if (!value) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const boundId = this._extractBoundObjectId(entry);
        if (boundId) {
          return boundId;
        }
      }
      return null;
    }

    if (
      value &&
      value.type === "substruct" &&
      value.value &&
      value.value.type === "substream" &&
      Array.isArray(value.value.value) &&
      value.value.value.length > 0
    ) {
      return value.value.value[0] || null;
    }

    return null;
  }

  _hasLoginInventoryBootstrapPending(session) {
    if (!session) {
      return false;
    }

    return (
      session._loginInventoryBootstrapPending === true ||
      (session._space &&
        session._space.loginInventoryBootstrapPending === true)
    );
  }

  _clearLoginInventoryBootstrapPending(session) {
    if (!session) {
      return;
    }

    session._loginInventoryBootstrapPending = false;
    if (session._space) {
      session._space.loginInventoryBootstrapPending = false;
    }
  }

  _markLoginShipInventoryListed(session) {
    if (!session || !session._space) {
      return;
    }

    session._space.loginShipInventoryListed = true;
  }

  _buildBayDogmaBootstrapKey(items = [], attributesByItemID = new Map()) {
    const normalizedItems = Array.isArray(items) ? items : [];
    if (normalizedItems.length <= 0) {
      return "";
    }

    return normalizedItems
      .map((item) => {
        const itemID = this._normalizeInventoryId(item && item.itemID, 0);
        const stacksize = Math.max(0, Number(item && item.stacksize) || 0);
        const attributes = attributesByItemID.get(itemID) || {};
        const attributeKey = Object.entries(attributes)
          .map(([attributeID, value]) => [
            this._normalizeInventoryId(attributeID, 0),
            Number(value),
          ])
          .filter(([attributeID, value]) => attributeID > 0 && Number.isFinite(value))
          .sort(([left], [right]) => left - right)
          .map(([attributeID, value]) => `${attributeID}=${Number(value).toFixed(6)}`)
          .join(",");
        return `${itemID}:${stacksize}:${attributeKey}`;
      })
      .sort()
      .join("|");
  }

  _resolveDroneBayDogmaAttributes(session, item, boundContext) {
    if (
      !item ||
      this._normalizeInventoryId(item.flagID, 0) !== ITEM_FLAGS.DRONE_BAY
    ) {
      return null;
    }

    const shipID = this._normalizeInventoryId(
      item.locationID ||
        (boundContext && boundContext.inventoryID) ||
        (session && session._space && session._space.shipID) ||
        this._getShipId(session),
      0,
    );
    const charID = this._normalizeInventoryId(
      item.ownerID || this._getCharacterId(session),
      0,
    );
    if (shipID <= 0 || charID <= 0) {
      return null;
    }

    const activeShip = getActiveShipRecord(charID);
    const shipRecord =
      findCharacterShip(charID, shipID) ||
      (
        activeShip &&
        this._normalizeInventoryId(activeShip.itemID || activeShip.shipID, 0) === shipID
          ? activeShip
          : null
      ) ||
      findItemById(shipID);
    if (!shipRecord) {
      return null;
    }

    const systemID = this._normalizeInventoryId(
      (session && (
        session.solarsystemid2 ||
        session.solarsystemid ||
        (session._space && session._space.systemID)
      )) ||
        (shipRecord.spaceState && shipRecord.spaceState.systemID) ||
        0,
      0,
    );
    const controllerEntity = {
      kind: "ship",
      itemID: shipID,
      typeID: this._normalizeInventoryId(
        shipRecord.typeID || shipRecord.shipTypeID,
        0,
      ),
      ownerID: charID,
      characterID: charID,
      pilotCharacterID: charID,
      session,
      systemID,
      activeModuleEffects: new Map(),
    };
    const droneEntity = {
      ...item,
      kind: "drone",
      ownerID: charID,
      locationID: shipID,
      systemID,
    };
    const {
      resolveDroneOperationalAttributes,
    } = require(path.join(__dirname, "../drone/droneDogma"));
    return resolveDroneOperationalAttributes(droneEntity, controllerEntity);
  }

  _primeInSpaceBayDogmaItems(session, boundContext, flagID, items = []) {
    if (
      !session ||
      !session._space ||
      typeof session.sendNotification !== "function" ||
      !this._isActiveInSpaceShipInventory(session, boundContext)
    ) {
      return false;
    }

    const numericFlagID = this._normalizeInventoryId(flagID, 0);
    if (numericFlagID !== ITEM_FLAGS.DRONE_BAY) {
      return false;
    }

    const normalizedItems = (Array.isArray(items) ? items : []).filter(
      (item) =>
        item &&
        this._normalizeInventoryId(item.locationID, 0) ===
          this._normalizeInventoryId(boundContext && boundContext.inventoryID, 0) &&
        this._normalizeInventoryId(item.flagID, 0) === numericFlagID,
    );

    if (!session._space.inventoryBayDogmaBootstrapKeys) {
      session._space.inventoryBayDogmaBootstrapKeys = Object.create(null);
    }

    const attributesByItemID = new Map();
    for (const item of normalizedItems) {
      const itemID = this._normalizeInventoryId(item && item.itemID, 0);
      const attributes = this._resolveDroneBayDogmaAttributes(
        session,
        item,
        boundContext,
      );
      if (itemID > 0 && attributes && typeof attributes === "object") {
        attributesByItemID.set(itemID, attributes);
      }
    }

    const nextBootstrapKey = this._buildBayDogmaBootstrapKey(
      normalizedItems,
      attributesByItemID,
    );
    const previousBootstrapKey =
      session._space.inventoryBayDogmaBootstrapKeys[numericFlagID] || "";
    if (previousBootstrapKey === nextBootstrapKey) {
      return false;
    }

    for (const item of normalizedItems) {
      const itemID = this._normalizeInventoryId(item && item.itemID, 0);
      const primeEntry = buildInventoryDogmaPrimeEntry(item, {
        description: "drone",
        includeTypeAttributes: true,
        attributeOverrides: attributesByItemID.get(itemID) || {},
      });
      if (primeEntry) {
        session.sendNotification("OnGodmaPrimeItem", "clientID", [
          this._normalizeInventoryId(boundContext && boundContext.inventoryID, 0),
          primeEntry,
        ]);
      }
      syncInventoryItemForSession(
        session,
        item,
        {
          locationID: item.locationID,
          flagID: item.flagID,
          quantity: item.quantity,
          singleton: item.singleton,
          stacksize: item.stacksize,
        },
        {
          emitCfgLocation: false,
        },
      );
    }

    session._space.inventoryBayDogmaBootstrapKeys[numericFlagID] =
      nextBootstrapKey;
    return normalizedItems.length > 0;
  }

  _isChargeTupleItemID(value) {
    return (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((entry) => this._normalizeInventoryId(entry, 0) > 0)
    );
  }

  _buildActiveShipLoadedChargeTupleRows(session, boundContext, requestedFlag) {
    if (
      !this._isActiveInSpaceShipInventory(session, boundContext) ||
      requestedFlag !== null
    ) {
      return [];
    }

    const shipID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    const charID = this._getCharacterId(session);
    if (shipID <= 0 || charID <= 0) {
      return [];
    }

    return getLoadedChargeItems(charID, shipID)
      .filter((item) => (
        item &&
        this._normalizeInventoryId(item.locationID, 0) === shipID &&
        isShipFittingFlag(item.flagID) &&
        this._normalizeInventoryId(item.categoryID, 0) === 8
      ))
      .sort((left, right) => (
        this._normalizeInventoryId(left && left.flagID, 0) -
          this._normalizeInventoryId(right && right.flagID, 0) ||
        this._normalizeInventoryId(left && left.typeID, 0) -
          this._normalizeInventoryId(right && right.typeID, 0) ||
        this._normalizeInventoryId(left && left.itemID, 0) -
          this._normalizeInventoryId(right && right.itemID, 0)
      ))
      .map((item) => {
        const quantity = Math.max(
          0,
          Number(item.stacksize ?? item.quantity ?? 0) || 0,
        );
        return {
          itemID: buildChargeTupleItemID(shipID, item.flagID, item.typeID),
          typeID: this._normalizeInventoryId(item.typeID, 0),
          ownerID: this._normalizeInventoryId(item.ownerID, charID),
          locationID: shipID,
          flagID: this._normalizeInventoryId(item.flagID, 0),
          quantity,
          groupID: this._normalizeInventoryId(item.groupID, 0),
          categoryID: 8,
          customInfo: item.customInfo || "",
          singleton: Number(item.singleton) === 1 ? 1 : 0,
          stacksize: quantity,
        };
      })
      .filter((item) => (
        this._isChargeTupleItemID(item.itemID) &&
        item.typeID > 0 &&
        item.flagID > 0
      ));
  }

  _mergeActiveShipLoadedChargeTupleRows(
    session,
    boundContext,
    requestedFlag,
    items = [],
  ) {
    const activeShipID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    const baseItems = (Array.isArray(items) ? items : []).filter((item) => !(
      activeShipID > 0 &&
      item &&
      this._normalizeInventoryId(item.locationID, 0) === activeShipID &&
      this._normalizeInventoryId(item.categoryID, 0) === 8 &&
      isShipFittingFlag(item.flagID)
    ));
    const tupleRows = this._buildActiveShipLoadedChargeTupleRows(
      session,
      boundContext,
      requestedFlag,
    );
    if (tupleRows.length === 0) {
      return baseItems;
    }

    const seenTupleKeys = new Set(
      baseItems
        .map((item) => item && item.itemID)
        .filter((itemID) => this._isChargeTupleItemID(itemID))
        .map((itemID) => itemID
          .map((entry) => this._normalizeInventoryId(entry, 0))
          .join(":")),
    );
    const mergedRows = [...baseItems];
    for (const tupleRow of tupleRows) {
      const tupleKey = tupleRow.itemID.join(":");
      if (seenTupleKeys.has(tupleKey)) {
        continue;
      }
      seenTupleKeys.add(tupleKey);
      mergedRows.push(tupleRow);
    }
    return mergedRows;
  }

  _isActiveShipInventory(session, boundContext) {
    if (
      !session ||
      !boundContext ||
      boundContext.kind !== "shipInventory"
    ) {
      return false;
    }

    const activeShipID = this._normalizeInventoryId(
      (session._space && session._space.shipID) ||
        session.activeShipID ||
        session.shipID ||
        session.shipid ||
        this._getShipId(session),
      0,
    );
    const boundInventoryID = this._normalizeInventoryId(
      boundContext.inventoryID,
      0,
    );

    return activeShipID > 0 && boundInventoryID === activeShipID;
  }

  _isActiveInSpaceShipInventory(session, boundContext) {
    if (
      !this._isActiveShipInventory(session, boundContext) ||
      !session ||
      isDockedSession(session)
    ) {
      return false;
    }

    return true;
  }

  _shouldPrimeLoginShipInventoryBootstrap(session, boundContext, options = {}) {
    void session;
    void boundContext;
    void options;
    return false;
  }

  _primeDeferredSpaceBallparkVisuals(
    session,
    boundContext = null,
    options = {},
  ) {
    if (
      !this._isActiveInSpaceShipInventory(session, boundContext) ||
      !session ||
      !session._space
    ) {
      return false;
    }

    if (
      session._space.initialBallparkVisualsSent === true ||
      session._space.initialStateSent === true
    ) {
      return false;
    }

    // Direct login keeps restore-time attach as "no bootstrap yet" so the
    // packaged client can finish spinning up Michelle/GameUI first. Once the
    // active ship inventory is already being bound, it is safe to seed just
    // the AddBalls2 visual half early, while still leaving the authoritative
    // SetState for the later beyonce bind.
    if (session._space.beyonceBound !== true) {
      session._space.deferInitialBallparkStateUntilBind = true;
    }

    const startedAtMs = Date.now();
    const primed = runtime.ensureInitialBallpark(session, {
      allowDeferredJumpBootstrapVisuals: true,
    });
    const elapsedMs = Date.now() - startedAtMs;
    if (
      runtime &&
      typeof runtime.recordSessionJumpTimingTrace === "function"
    ) {
      runtime.recordSessionJumpTimingTrace(
        session,
        "invbroker-prime-deferred-ballpark",
        {
          primed: primed === true,
          elapsedMs,
          reason:
            typeof options.reason === "string" && options.reason.trim().length > 0
              ? options.reason.trim()
              : "unknown",
          beyonceBound: session._space.beyonceBound === true,
        },
      );
    }
    if (primed) {
      log.debug(
        `[InvBroker] Primed deferred ballpark visuals source=${
          typeof options.reason === "string" && options.reason.trim().length > 0
            ? options.reason.trim()
            : "unknown"
        } ${describeSessionHydrationState(session)}`,
      );
    }
    if (elapsedMs >= 100) {
      log.info(
        `[InvBroker] Deferred ballpark prime source=${
          typeof options.reason === "string" && options.reason.trim().length > 0
            ? options.reason.trim()
            : "unknown"
        } took ${elapsedMs}ms primed=${primed ? 1 : 0}`,
      );
    }
    return primed;
  }

  _primePendingSpaceShipInventoryBootstrap(
    session,
    boundContext = null,
    options = {},
  ) {
    if (!session || !session._space) {
      return;
    }

    session._space.loginShipInventoryPrimed = true;
    this._primeDeferredSpaceBallparkVisuals(session, boundContext, {
      reason:
        typeof options.reason === "string" && options.reason.trim().length > 0
          ? options.reason.trim()
          : "shipInventoryPrime",
    });
  }

  _isInitialLoginSpaceShipInventoryList(session, boundContext) {
    if (
      !session ||
      !this._hasLoginInventoryBootstrapPending(session) ||
      !this._isActiveShipInventory(session, boundContext) ||
      isDockedSession(session)
    ) {
      return false;
    }

    return true;
  }

  _makeBoundSubstruct(context, session = null) {
    const config = require(path.join(__dirname, "../../config"));
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    this._rememberBoundContext(idString, context);
    this._rememberSessionBoundContext(session, idString, context, now);

    return {
      type: "substruct",
      value: {
        type: "substream",
        value: [idString, now],
      },
    };
  }

  _getShipMetadata(session, shipTypeID = null, shipName = null) {
    const resolvedShipTypeID = shipTypeID || this._getShipTypeId(session);
    return (
      resolveShipByTypeID(resolvedShipTypeID) || {
        typeID: resolvedShipTypeID,
        name: shipName || (session && session.shipName) || "Ship",
        groupID: 25,
        categoryID: 6,
      }
    );
  }

  _extractKwarg(kwargs, key) {
    if (!kwargs || typeof kwargs !== "object") return undefined;

    if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
      return kwargs[key];
    }

    if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
      for (const [k, v] of kwargs.entries) {
        const dictKey = Buffer.isBuffer(k) ? k.toString("utf8") : k;
        if (dictKey === key) {
          return v;
        }
      }
    }

    return undefined;
  }

  _normalizeInventoryId(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
  }

  _normalizeFlagList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    return [];
  }

  _normalizeItemIdList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite)
        .filter((entry) => entry > 0);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite)
        .filter((entry) => entry > 0);
    }

    const numericValue = this._normalizeInventoryId(value, 0);
    return numericValue > 0 ? [numericValue] : [];
  }

  _isMarshalListLike(value) {
    return (
      Array.isArray(value) ||
      Boolean(value && value.type === "list" && Array.isArray(value.items))
    );
  }

  _normalizeMergeOps(value) {
    const rawOps =
      Array.isArray(value)
        ? value
        : value && value.type === "list" && Array.isArray(value.items)
          ? value.items
          : [];

    return rawOps
      .map((entry) => {
        const tuple = Array.isArray(entry)
          ? entry
          : entry && entry.type === "tuple" && Array.isArray(entry.items)
            ? entry.items
            : [];
        if (tuple.length < 2) {
          return null;
        }

        const sourceItemID = this._normalizeInventoryId(tuple[0], 0);
        const destinationItemID = this._normalizeInventoryId(tuple[1], 0);
        const quantity = this._normalizeQuantityArg(tuple[2]);
        if (sourceItemID <= 0 || destinationItemID <= 0) {
          return null;
        }

        return {
          sourceItemID,
          destinationItemID,
          quantity,
        };
      })
      .filter(Boolean);
  }

  _normalizeQuantityArg(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    const normalizedValue = Math.trunc(numericValue);
    return normalizedValue > 0 ? normalizedValue : null;
  }

  _normalizeCommodityDict(value) {
    const rawValue = unwrapMarshalValue(value);
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      return {};
    }

    const commodities = {};
    for (const [rawKey, rawQuantity] of Object.entries(rawValue)) {
      const key = this._normalizeInventoryId(rawKey, 0);
      const quantity = this._normalizeQuantityArg(rawQuantity);
      if (key > 0 && quantity > 0) {
        commodities[String(key)] = (commodities[String(key)] || 0) + quantity;
      }
    }
    return commodities;
  }

  _buildPIImportCommoditiesFromItems(importData, customsOfficeID, characterID) {
    const importItemQuantities = this._normalizeCommodityDict(importData);
    const commodities = {};
    const items = [];
    for (const [rawItemID, quantity] of Object.entries(importItemQuantities)) {
      const itemID = this._normalizeInventoryId(rawItemID, 0);
      const item = findItemById(itemID);
      if (
        !item ||
        this._normalizeInventoryId(item.ownerID, 0) !== characterID ||
        this._normalizeInventoryId(item.locationID, 0) !== customsOfficeID ||
        this._normalizeInventoryId(item.flagID, 0) !== ITEM_FLAGS.HANGAR
      ) {
        throwWrappedUserError("CannotImportCommoditiesNotFound");
      }

      const availableQuantity = this._normalizeInventoryId(
        item.singleton === 1 ? 1 : item.stacksize ?? item.quantity,
        0,
      );
      if (availableQuantity < quantity) {
        throwWrappedUserError("CannotImportCommoditiesNotFound");
      }

      const typeID = this._normalizeInventoryId(item.typeID, 0);
      commodities[String(typeID)] = (commodities[String(typeID)] || 0) + quantity;
      items.push({ itemID, typeID, quantity });
    }
    return { commodities, items };
  }

  _throwNotEnoughMoney(requiredAmount, currentBalance) {
    throwWrappedUserError(
      "NotEnoughMoney",
      buildNotEnoughMoneyUserErrorValues(requiredAmount, currentBalance),
    );
  }

  _ensurePIWalletCanCover(characterID, amount) {
    const normalizedAmount = Number(amount) || 0;
    if (!(normalizedAmount > 0)) {
      return;
    }

    const wallet = getCharacterWallet(characterID);
    if (!wallet) {
      throwWrappedUserError("CustomNotify", {
        notify: "Cannot charge PI wallet: character wallet not found.",
      });
    }
    if (wallet.balance < normalizedAmount) {
      this._throwNotEnoughMoney(normalizedAmount, wallet.balance);
    }
  }

  _debitPIWallet(characterID, amount, entryTypeID, referenceID, description) {
    const normalizedAmount = Number(amount) || 0;
    if (!(normalizedAmount > 0)) {
      return null;
    }

    const wallet = getCharacterWallet(characterID);
    if (!wallet) {
      throwWrappedUserError("CustomNotify", {
        notify: "Cannot charge PI wallet: character wallet not found.",
      });
    }

    const debitResult = adjustCharacterBalance(characterID, -normalizedAmount, {
      entryTypeID,
      referenceID,
      ownerID1: characterID,
      ownerID2: referenceID,
      description,
    });
    if (!debitResult.success) {
      if (debitResult.errorMsg === "INSUFFICIENT_FUNDS") {
        this._throwNotEnoughMoney(normalizedAmount, wallet.balance);
      }
      throwWrappedUserError("CustomNotify", {
        notify: `Cannot charge PI wallet: ${debitResult.errorMsg || "wallet debit failed"}.`,
      });
    }
    return debitResult;
  }

  _debitPIWalletInLegs(characterID, amount, entryTypeID, referenceID, description, legCount = 1) {
    const normalizedAmount = Math.round((Number(amount) || 0) * 100) / 100;
    if (!(normalizedAmount > 0)) {
      return [];
    }

    const normalizedLegCount = Math.max(1, Math.trunc(Number(legCount) || 1));
    if (normalizedLegCount === 1) {
      return [
        this._debitPIWallet(
          characterID,
          normalizedAmount,
          entryTypeID,
          referenceID,
          description,
        ),
      ].filter(Boolean);
    }

    const debits = [];
    let remaining = normalizedAmount;
    for (let index = 0; index < normalizedLegCount; index += 1) {
      const legAmount = index === normalizedLegCount - 1
        ? remaining
        : Math.round((normalizedAmount / normalizedLegCount) * 100) / 100;
      remaining = Math.round((remaining - legAmount) * 100) / 100;
      const debit = this._debitPIWallet(
        characterID,
        legAmount,
        entryTypeID,
        referenceID,
        description,
      );
      if (debit) {
        debits.push(debit);
      }
    }
    return debits;
  }

  _refundPIWalletDebits(characterID, debitResults = [], description = "PI tax refund") {
    for (const debitResult of debitResults.filter(Boolean)) {
      const amount = Math.abs(Number(debitResult.delta) || 0);
      if (!(amount > 0)) {
        continue;
      }
      adjustCharacterBalance(characterID, amount, {
        entryTypeID: debitResult.journalEntry && debitResult.journalEntry.entryTypeID,
        referenceID: debitResult.journalEntry && debitResult.journalEntry.referenceID,
        ownerID1: characterID,
        ownerID2: debitResult.journalEntry && debitResult.journalEntry.ownerID2,
        description,
      });
    }
  }

  _extractFitFittingEntryPairs(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (value instanceof Map) {
      return [...value.entries()];
    }

    if (value.type === "dict" && Array.isArray(value.entries)) {
      return value.entries;
    }

    if (
      (value.type === "objectex1" || value.type === "objectex2") &&
      Array.isArray(value.dict)
    ) {
      return value.dict;
    }

    if (
      value.type === "object" &&
      value.args &&
      value.args.type === "dict" &&
      Array.isArray(value.args.entries)
    ) {
      return value.args.entries;
    }

    return null;
  }

  _appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs) {
    const typeID = this._normalizeInventoryId(unwrapMarshalValue(rawTypeID), 0);
    if (typeID <= 0) {
      return;
    }

    const unwrappedItemIDs = unwrapMarshalValue(rawItemIDs);
    const itemIDs = (Array.isArray(unwrappedItemIDs) ? unwrappedItemIDs : [unwrappedItemIDs])
      .map((entry) => this._normalizeInventoryId(unwrapMarshalValue(entry), 0))
      .filter((entry) => entry > 0);
    if (itemIDs.length <= 0) {
      return;
    }

    const existingItemIDs = byType.get(typeID) || [];
    for (const itemID of itemIDs) {
      if (!existingItemIDs.includes(itemID)) {
        existingItemIDs.push(itemID);
      }
    }
    byType.set(typeID, existingItemIDs);
  }

  _normalizeFitFittingItemsByType(value) {
    const byType = new Map();
    const rawEntryPairs = this._extractFitFittingEntryPairs(value);
    if (Array.isArray(rawEntryPairs)) {
      for (const [rawTypeID, rawItemIDs] of rawEntryPairs) {
        this._appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs);
      }

      return byType;
    }

    const unwrapped = unwrapMarshalValue(value);
    const unwrappedEntryPairs =
      unwrapped && typeof unwrapped === "object" && Array.isArray(unwrapped.dict)
        ? unwrapped.dict
        : null;
    if (Array.isArray(unwrappedEntryPairs)) {
      for (const [rawTypeID, rawItemIDs] of unwrappedEntryPairs) {
        this._appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs);
      }

      return byType;
    }

    const source =
      unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
        ? unwrapped
        : {};

    for (const [rawTypeID, rawItemIDs] of Object.entries(source)) {
      this._appendFitFittingItemsByType(byType, rawTypeID, rawItemIDs);
    }

    return byType;
  }

  _normalizeFitFittingModulesByFlag(value) {
    const unwrapped = unwrapMarshalValue(value);
    const payload =
      unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
        ? unwrapped
        : {};
    const source =
      payload.modulesByFlag &&
      typeof payload.modulesByFlag === "object" &&
      !Array.isArray(payload.modulesByFlag)
        ? payload.modulesByFlag
        : payload;

    return Object.entries(source)
      .map(([rawFlagID, rawTypeID]) => ({
        flagID: this._normalizeInventoryId(rawFlagID, 0),
        typeID: this._normalizeInventoryId(rawTypeID, 0),
      }))
      .filter((entry) => entry.flagID > 0 && entry.typeID > 0)
      .sort((left, right) => left.flagID - right.flagID);
  }

  _requeueFitFittingSourceStack(candidateItemIDs, itemID, originalSourceItem) {
    if (!Array.isArray(candidateItemIDs) || !originalSourceItem) {
      return;
    }

    const sourceAfterMove = findItemById(itemID);
    if (
      !sourceAfterMove ||
      Number(sourceAfterMove.singleton) === 1 ||
      this._getStackableQuantity(sourceAfterMove) <= 0 ||
      this._normalizeInventoryId(sourceAfterMove.itemID, 0) !==
        this._normalizeInventoryId(originalSourceItem.itemID, 0) ||
      this._normalizeInventoryId(sourceAfterMove.typeID, 0) !==
        this._normalizeInventoryId(originalSourceItem.typeID, 0) ||
      this._normalizeInventoryId(sourceAfterMove.ownerID, 0) !==
        this._normalizeInventoryId(originalSourceItem.ownerID, 0) ||
      this._normalizeInventoryId(sourceAfterMove.locationID, 0) !==
        this._normalizeInventoryId(originalSourceItem.locationID, 0) ||
      this._normalizeInventoryId(sourceAfterMove.flagID, 0) !==
        this._normalizeInventoryId(originalSourceItem.flagID, 0)
    ) {
      return;
    }

    const normalizedItemID = this._normalizeInventoryId(itemID, 0);
    if (
      !candidateItemIDs.some(
        (candidateID) => this._normalizeInventoryId(candidateID, 0) === normalizedItemID,
      )
    ) {
      candidateItemIDs.unshift(normalizedItemID);
    }
  }

  _normalizeFitFittingQuantitiesByType(value, key) {
    const unwrapped = unwrapMarshalValue(value);
    const payload =
      unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
        ? unwrapped
        : {};
    // A named key (e.g. "dronesByType") selects a nested quantities map. When it
    // is provided but absent, the source is empty — NOT the whole payload, which
    // would misread an unrelated dict (e.g. a bare modulesByFlag {flag: typeID})
    // as quantities. Only the key-less call (cargoItemsByType) uses the payload
    // itself as the quantities map.
    const source = key
      ? (Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : {})
      : payload;
    const entryPairs = this._extractFitFittingEntryPairs(source);
    const pairs = Array.isArray(entryPairs)
      ? entryPairs
      : Object.entries(
        source && typeof source === "object" && !Array.isArray(source)
          ? source
          : {},
      );
    const quantitiesByType = new Map();

    for (const [rawTypeID, rawQuantity] of pairs) {
      const typeID = this._normalizeInventoryId(unwrapMarshalValue(rawTypeID), 0);
      const quantity = Math.max(0, Number(unwrapMarshalValue(rawQuantity)) || 0);
      if (typeID <= 0 || quantity <= 0) {
        continue;
      }
      quantitiesByType.set(typeID, (quantitiesByType.get(typeID) || 0) + Math.trunc(quantity));
    }

    return [...quantitiesByType.entries()]
      .map(([typeID, quantity]) => ({ typeID, quantity }))
      .sort((left, right) => left.typeID - right.typeID);
  }

  _getFitFittingDestinationOwnerID(session, shipRecord, destinationFlagID) {
    const destination = {
      locationID: shipRecord && shipRecord.itemID,
      flagID: destinationFlagID,
    };
    const structureDestination = this._getStructureForOwnerBayDestination(destination);
    const structureOwnerID = this._getStructureInventoryOwnerID(structureDestination);
    return structureOwnerID > 0 ? structureOwnerID : this._getCharacterId(session);
  }

  _getFitFittingExistingDestinationQuantity(session, shipRecord, destinationFlagID, typeID) {
    const ownerID = this._getFitFittingDestinationOwnerID(
      session,
      shipRecord,
      destinationFlagID,
    );
    const normalizedTypeID = this._normalizeInventoryId(typeID, 0);
    if (!shipRecord || ownerID <= 0 || normalizedTypeID <= 0) {
      return 0;
    }

    return listContainerItems(ownerID, shipRecord.itemID, destinationFlagID)
      .filter((item) => Number(item && item.typeID) === normalizedTypeID)
      .reduce(
        (sum, item) =>
          sum + (
            Number(item && item.singleton) === 1
              ? 1
              : Math.max(1, Number(item && (item.stacksize ?? item.quantity ?? 1)) || 1)
          ),
        0,
      );
  }

  _resolveMoveQuantity(item, destination, requestedQuantity = null) {
    if (this._isStructureCoreInstallMove(item, destination)) {
      return 1;
    }

    if (requestedQuantity !== null && requestedQuantity !== undefined) {
      return requestedQuantity;
    }

    // CCP's "Fit to Active Ship" path sends Add/MultiAdd with flagAutoFit and
    // no explicit qty. For a stackable source item, fitting should split off a
    // single unit into the ship slot and leave the remainder of the stack in
    // the source container.
    if (
      item &&
      Number(item.singleton) !== 1 &&
      Number(item.categoryID) !== CHARGE_CATEGORY_ID &&
      destination &&
      isShipFittingFlag(destination.flagID)
    ) {
      return 1;
    }

    return requestedQuantity;
  }

  _resolveAppliedMoveQuantity(item, destination, requestedQuantity = null) {
    const resolvedQuantity = this._resolveMoveQuantity(
      item,
      destination,
      requestedQuantity,
    );
    if (resolvedQuantity !== null && resolvedQuantity !== undefined) {
      return Math.max(1, Number(resolvedQuantity) || 1);
    }

    if (!item) {
      return 0;
    }

    return Number(item.singleton) === 1
      ? 1
      : Math.max(1, Number(item.stacksize ?? item.quantity ?? 1) || 1);
  }

  _getStackableQuantity(item) {
    if (!item) {
      return 0;
    }
    return Number(item.singleton) === 1
      ? 1
      : Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
  }

  _tryLoadChargeFromInventoryAdd(
    session,
    sourceItemDescriptor,
    destination,
    requestedQuantity = null,
  ) {
    const sourceItem = sourceItemDescriptor && sourceItemDescriptor.item
      ? sourceItemDescriptor.item
      : null;
    if (
      !sourceItem ||
      this._normalizeInventoryId(sourceItem.categoryID, 0) !== CHARGE_CATEGORY_ID ||
      !destination ||
      !isShipFittingFlag(destination.flagID)
    ) {
      return { handled: false };
    }

    const charID = this._getCharacterId(session);
    const shipID = this._normalizeInventoryId(destination.locationID, 0);
    const flagID = this._normalizeInventoryId(destination.flagID, 0);
    const moduleItem = getFittedModuleByFlag(charID, shipID, flagID);
    const chargeTypeID = this._normalizeInventoryId(sourceItem.typeID, 0);
    if (
      charID <= 0 ||
      shipID <= 0 ||
      flagID <= 0 ||
      !moduleItem ||
      chargeTypeID <= 0 ||
      !isChargeCompatibleWithModule(moduleItem.typeID, chargeTypeID)
    ) {
      return { handled: false };
    }

    const existingCharge = getLoadedChargeByFlag(charID, shipID, flagID);
    const existingChargeTypeID = this._normalizeInventoryId(
      existingCharge && existingCharge.typeID,
      0,
    );
    if (existingCharge && existingChargeTypeID !== chargeTypeID) {
      return { handled: false };
    }

    const moduleCapacity = Math.max(
      1,
      getModuleChargeCapacity(moduleItem.typeID, chargeTypeID),
    );
    const existingQuantity = this._getStackableQuantity(existingCharge);
    const neededQuantity = Math.max(0, moduleCapacity - existingQuantity);
    if (neededQuantity <= 0) {
      return {
        handled: true,
        success: true,
        data: {
          quantity: 0,
          changes: [],
          loadedChargeItemID: existingCharge ? existingCharge.itemID : null,
        },
      };
    }

    const availableQuantity = this._getStackableQuantity(sourceItem);
    const requestedLimit =
      requestedQuantity === null || requestedQuantity === undefined
        ? availableQuantity
        : Math.max(1, Number(requestedQuantity) || 1);
    const moveQuantity = Math.min(
      neededQuantity,
      availableQuantity,
      requestedLimit,
    );
    if (moveQuantity <= 0) {
      return {
        handled: true,
        success: false,
        errorMsg: "INSUFFICIENT_ITEMS",
      };
    }

    const moveResult = existingCharge
      ? mergeItemStacks(sourceItem.itemID, existingCharge.itemID, moveQuantity)
      : moveItemToLocation(sourceItem.itemID, shipID, flagID, moveQuantity);
    if (!moveResult || !moveResult.success) {
      return {
        handled: true,
        success: false,
        errorMsg: moveResult && moveResult.errorMsg
          ? moveResult.errorMsg
          : "MOVE_FAILED",
      };
    }

    const loadedChargeItemID = existingCharge
      ? existingCharge.itemID
      : this._resolveMovedItemID(moveResult, sourceItem.itemID, destination) ||
        sourceItem.itemID;

    return {
      handled: true,
      success: true,
      data: {
        quantity: moveQuantity,
        changes: (moveResult.data && moveResult.data.changes) || [],
        loadedChargeItemID,
      },
    };
  }

  _isStructureDeedDestination(destination) {
    return (
      this._normalizeInventoryId(destination && destination.flagID, 0) ===
      ITEM_FLAGS.STRUCTURE_DEED
    );
  }

  _isStructureDeedBaySource(item) {
    return (
      this._normalizeInventoryId(item && item.flagID, 0) ===
        ITEM_FLAGS.STRUCTURE_DEED &&
      Boolean(this._getStructureForInventoryID(item && item.locationID))
    );
  }

  _validateStructureDeedBaySourceMove(item) {
    if (!this._isStructureDeedBaySource(item)) {
      return { success: true };
    }
    return {
      success: false,
      errorMsg: "CustomNotify",
      values: {
        notify: "Installed Quantum Cores cannot be moved from a structure.",
      },
    };
  }

  _isStructureOwnerBayFlag(flagID) {
    return STRUCTURE_OWNER_BAY_FLAGS.has(this._normalizeInventoryId(flagID, 0));
  }

  _isMoonMaterialBayFlag(flagID) {
    return (
      this._normalizeInventoryId(flagID, 0) === FLAG_MOON_MATERIAL_BAY
    );
  }

  _getStructureInventoryOwnerID(structure) {
    return this._normalizeInventoryId(
      structure && (structure.ownerCorpID || structure.ownerID),
      0,
    );
  }

  _getStructureForInventoryID(inventoryID) {
    const structureID = this._normalizeInventoryId(inventoryID, 0);
    return structureID > 0
      ? structureState.getStructureByID(structureID, { refresh: false })
      : null;
  }

  _isAutoMoonMinerStructure(structure) {
    return (
      this._normalizeInventoryId(structure && structure.typeID, 0) ===
      TYPE_UPWELL_AUTO_MOON_MINER
    );
  }

  _isAutoMoonMinerReinforced(structure) {
    const stateID = this._normalizeInventoryId(structure && structure.state, 0);
    return (
      stateID === STRUCTURE_STATE.ARMOR_REINFORCE ||
      stateID === STRUCTURE_STATE.HULL_REINFORCE
    );
  }

  _getStructureDisplayName(structure, structureID) {
    return (
      structure &&
      (structure.itemName || structure.name || structure.structureName)
    ) || `Structure ${this._normalizeInventoryId(structureID, 0)}`;
  }

  _throwAutoMoonMinerAccessDenied(structure, structureID) {
    throwWrappedUserError("AccessToAutoMoonMinerDenied", {
      structureName: this._getStructureDisplayName(structure, structureID),
    });
  }

  _getSessionCorpID(session) {
    return this._normalizeInventoryId(
      session && (session.corporationID || session.corpid),
      0,
    );
  }

  _normalizeCorpRoleBitfield(value) {
    if (typeof value === "bigint") {
      return value;
    }
    const numeric = Number(value);
    return BigInt(
      Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0,
    );
  }

  _hasStationManagerRole(session) {
    const roleValue = session && (
      session.corprole ||
      session.corpRole ||
      session.rolesAtAll ||
      0
    );
    return (
      this._normalizeCorpRoleBitfield(roleValue) & CORP_ROLE_STATION_MANAGER
    ) === CORP_ROLE_STATION_MANAGER;
  }

  _hasAutoMoonMinerOwnerStationManagerAccess(session, structure) {
    const ownerCorpID = this._getStructureInventoryOwnerID(structure);
    return (
      ownerCorpID > 0 &&
      this._getSessionCorpID(session) === ownerCorpID &&
      this._hasStationManagerRole(session)
    );
  }

  _ensureCanAccessMoonMaterialBay(session, structure, structureID) {
    const hasAccess = this._isAutoMoonMinerStructure(structure) && (
      this._hasAutoMoonMinerOwnerStationManagerAccess(session, structure) ||
      characterHasStructureSetting(
        session,
        structure,
        STRUCTURE_SETTING_ID.AUTOMOONMINING,
      )
    );
    if (
      !this._isAutoMoonMinerStructure(structure) ||
      !hasAccess ||
      this._isAutoMoonMinerReinforced(structure)
    ) {
      this._throwAutoMoonMinerAccessDenied(structure, structureID);
    }
    return true;
  }

  _getMoonMaterialBayCapacity(structure) {
    const attributes = getTypeDogmaAttributes(structure && structure.typeID) || {};
    const capacity = Number(
      attributes[ATTRIBUTE_OUTPUT_MOON_MATERIAL_BAY_CAPACITY] ??
      attributes[String(ATTRIBUTE_OUTPUT_MOON_MATERIAL_BAY_CAPACITY)] ??
      0,
    );
    return Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
  }

  _getStructureFighterBayCapacity(structure) {
    const capacity = Number(
      getShipBaseAttributeValue(
        structure && structure.typeID,
        "fighterCapacity",
      ),
    );
    return Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
  }

  _validateMoonMaterialBayDestination(session, destination) {
    if (!destination || !this._isMoonMaterialBayFlag(destination.flagID)) {
      return { success: true };
    }
    const structureID = this._normalizeInventoryId(destination.locationID, 0);
    const structure = this._getStructureForInventoryID(structureID);
    this._ensureCanAccessMoonMaterialBay(session, structure, structureID);
    return { success: false, errorMsg: "OUTPUT_ONLY" };
  }

  _validateMoonMaterialBaySourceAccess(session, sourceItem) {
    if (!sourceItem || !this._isMoonMaterialBayFlag(sourceItem.flagID)) {
      return { success: true };
    }
    const structureID = this._normalizeInventoryId(sourceItem.locationID, 0);
    const structure = this._getStructureForInventoryID(structureID);
    this._ensureCanAccessMoonMaterialBay(session, structure, structureID);
    return { success: true };
  }

  _isControlledStructureInventoryID(session, inventoryID) {
    const structureID = this._normalizeInventoryId(inventoryID, 0);
    if (structureID <= 0) {
      return false;
    }

    const sessionStructureID = this._normalizeInventoryId(
      session && (session.structureID || session.structureid),
      0,
    );
    const sessionShipID = this._normalizeInventoryId(
      session && (session.shipID || session.shipid),
      0,
    );
    return (
      sessionStructureID === structureID &&
      sessionShipID === structureID &&
      Boolean(this._getStructureForInventoryID(structureID))
    );
  }

  _getStructureForDeedDestination(destination) {
    if (!this._isStructureDeedDestination(destination)) {
      return null;
    }

    return this._getStructureForInventoryID(destination.locationID);
  }

  _getStructureForOwnerBayDestination(destination) {
    if (!destination || !this._isStructureOwnerBayFlag(destination.flagID)) {
      return null;
    }
    return this._getStructureForInventoryID(destination.locationID);
  }

  _getRequiredStructureCoreTypeID(structure) {
    if (!structure) {
      return 0;
    }

    const explicitCoreTypeID = this._normalizeInventoryId(
      structure.quantumCoreItemTypeID,
      0,
    );
    if (explicitCoreTypeID > 0) {
      return explicitCoreTypeID;
    }

    const typeRecord =
      typeof structureState.getStructureTypeByID === "function"
        ? structureState.getStructureTypeByID(structure.typeID)
        : null;
    return this._normalizeInventoryId(
      typeRecord && typeRecord.defaultQuantumCoreTypeID,
      0,
    );
  }

  _isStructureCoreInstallMove(item, destination) {
    return Boolean(
      item &&
      this._isStructureDeedDestination(destination) &&
      this._normalizeInventoryId(item.groupID, 0) === STRUCTURE_DEED_GROUP_ID
    );
  }

  _validateStructureCoreInstallMove(item, destination) {
    if (!this._isStructureDeedDestination(destination)) {
      return { success: true };
    }

    const structure = this._getStructureForDeedDestination(destination);
    if (!structure || !this._isStructureCoreInstallMove(item, destination)) {
      return { success: false, errorMsg: "NoSpaceForThat" };
    }

    const expectedCoreTypeID = this._getRequiredStructureCoreTypeID(structure);
    const itemTypeID = this._normalizeInventoryId(item && item.typeID, 0);
    if (expectedCoreTypeID > 0 && itemTypeID !== expectedCoreTypeID) {
      return {
        success: false,
        errorMsg: "CustomNotify",
        values: {
          notify: `This structure requires core type ${expectedCoreTypeID}.`,
        },
      };
    }

    const existingDeedItems = listContainerItems(
      null,
      structure.structureID,
      ITEM_FLAGS.STRUCTURE_DEED,
    ).filter(
      (existingItem) =>
        this._normalizeInventoryId(existingItem && existingItem.itemID, 0) !==
        this._normalizeInventoryId(item && item.itemID, 0),
    );
    if (structure.hasQuantumCore === true || existingDeedItems.length > 0) {
      return {
        success: false,
        errorMsg: "CustomNotify",
        values: {
          notify: "This structure already has a Quantum Core installed.",
        },
      };
    }

    return { success: true, structure, expectedCoreTypeID };
  }

  _syncStructureCoreInstall(_session, item, destination) {
    if (!this._isStructureCoreInstallMove(item, destination)) {
      return null;
    }

    const structure = this._getStructureForDeedDestination(destination);
    if (!structure) {
      return null;
    }

    const result = structureState.setStructureQuantumCoreInstalled(
      structure.structureID,
      true,
    );
    if (!result.success) {
      log.warn(
        `[InvBroker] structure core install state update failed structure=${structure.structureID} error=${result.errorMsg || "UNKNOWN"}`,
      );
      return result;
    }

    const updatedStructure = result.data || structure;
    const solarSystemID = this._normalizeInventoryId(
      updatedStructure.solarSystemID || structure.solarSystemID,
      0,
    );
    if (solarSystemID > 0) {
      runtime.syncStructureSceneState(solarSystemID, {
        reason: "structureCoreInstall",
      });
    }
    return result;
  }

  _syncStructureServiceModuleMove(session, sourceItem, destination) {
    const touchedStructureIDs = new Set();
    const sourceFlagID = this._normalizeInventoryId(sourceItem && sourceItem.flagID, 0);
    const sourceLocationID = this._normalizeInventoryId(sourceItem && sourceItem.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination && destination.flagID, 0);
    const destinationLocationID = this._normalizeInventoryId(destination && destination.locationID, 0);

    if (isStructureServiceSlotFlag(sourceFlagID) && sourceLocationID > 0) {
      touchedStructureIDs.add(sourceLocationID);
    }
    const removedFromSourceServiceSlots =
      isStructureServiceSlotFlag(sourceFlagID) &&
      sourceLocationID > 0 &&
      !(
        isStructureServiceSlotFlag(destinationFlagID) &&
        destinationLocationID === sourceLocationID
      );
    if (removedFromSourceServiceSlots) {
      const cancelResult = cancelIndustryJobsForRemovedServiceModule(
        sourceLocationID,
        sourceItem && sourceItem.typeID,
        {
          session,
          completedCharacterID: this._normalizeInventoryId(
            session && (session.characterID || session.charid),
            0,
          ),
          excludedItemID: this._normalizeInventoryId(sourceItem && sourceItem.itemID, 0),
        },
      );
      if (cancelResult && cancelResult.success === false) {
        log.warn(
          `[InvBroker] structure service module removal job cancel failed structure=${sourceLocationID} item=${sourceItem && sourceItem.itemID || 0} error=${cancelResult.errorMsg || "UNKNOWN"}`,
        );
      }
      if (
        cancelResult &&
        Array.isArray(cancelResult.unbackedServiceIDs) &&
        cancelResult.unbackedServiceIDs.includes(STRUCTURE_SERVICE_ID.MEDICAL)
      ) {
        const {
          removeJumpClonesAtStructure,
        } = require(path.join(__dirname, "../station/jumpCloneRuntime"));
        const cloneCleanupResult = removeJumpClonesAtStructure(sourceLocationID, {
          reason: "structureCloneServiceRemoved",
          destroyerID: this._normalizeInventoryId(
            session && (session.characterID || session.charid),
            0,
          ),
        });
        if (!cloneCleanupResult || cloneCleanupResult.success !== true) {
          log.warn(
            `[InvBroker] structure clone cleanup failed structure=${sourceLocationID} item=${sourceItem && sourceItem.itemID || 0} error=${cloneCleanupResult && cloneCleanupResult.errorMsg || "UNKNOWN"}`,
          );
        } else if (cloneCleanupResult.removedCloneCount > 0) {
          log.info(
            `[InvBroker] removed ${cloneCleanupResult.removedCloneCount} structure jump clones after cloning service removal structure=${sourceLocationID}`,
          );
        }
      }
    }
    if (isStructureServiceSlotFlag(destinationFlagID) && destinationLocationID > 0) {
      touchedStructureIDs.add(destinationLocationID);
      const movedItemID = this._normalizeInventoryId(sourceItem && sourceItem.itemID, 0);
      const movedItem = movedItemID > 0 ? findItemById(movedItemID) : null;
      if (
        movedItem &&
        this._normalizeInventoryId(movedItem.locationID, 0) === destinationLocationID &&
        this._normalizeInventoryId(movedItem.flagID, 0) === destinationFlagID
      ) {
        const autoOnlineResult = tryAutoOnlineFittedStructureServiceModule(
          destinationLocationID,
          movedItem,
        );
        if (
          autoOnlineResult &&
          autoOnlineResult.success === true &&
          Array.isArray(autoOnlineResult.changes) &&
          autoOnlineResult.changes.length > 0
        ) {
          this._emitInventoryMoveChanges(session, autoOnlineResult.changes);
        } else if (
          autoOnlineResult &&
          autoOnlineResult.success !== true &&
          ![
            "NOT_ENOUGH_FUEL",
            "STRUCTURE_DAMAGED",
            "STRUCTURE_SERVICE_REQUIRES_SOV_UPGRADE",
          ].includes(
            String(autoOnlineResult.errorMsg || ""),
          )
        ) {
          log.warn(
            `[InvBroker] structure service module auto-online failed structure=${destinationLocationID} item=${movedItemID} error=${autoOnlineResult.errorMsg || "UNKNOWN"}`,
          );
        }
      }
    }

    for (const structureID of touchedStructureIDs) {
      const result = syncStructureServiceModuleState(structureID);
      if (!result || result.success !== true) {
        log.warn(
          `[InvBroker] structure service module sync failed structure=${structureID} error=${result && result.errorMsg || "UNKNOWN"}`,
        );
        continue;
      }
      if (Array.isArray(result.fuelCycleChanges) && result.fuelCycleChanges.length > 0) {
        this._emitInventoryMoveChanges(session, result.fuelCycleChanges);
      }
      if (result.data && result.data.solarSystemID) {
        runtime.syncStructureSceneState(result.data.solarSystemID, {
          reason: "structureServiceModuleMove",
        });
      }
    }
  }

  // After a ship module lands in a fitting slot, leave it OFFLINE when the ship
  // cannot supply its CPU/powergrid (counting the modules already online). This
  // mirrors the live server: an over-budget module is fitted offline, not left
  // online over budget. Modules that fit keep the implicit-online default.
  // Structure service modules have their own fuel-gated auto-online path.
  // Returns the inventory changes for the offline stamp (empty when none), so
  // callers can order them after the move change they belong to.
  _resolveShipModuleFitOnlineChanges(session, sourceItem, destination) {
    const destinationFlagID = this._normalizeInventoryId(destination && destination.flagID, 0);
    const destinationLocationID = this._normalizeInventoryId(
      destination && destination.locationID,
      0,
    );
    if (
      destinationLocationID <= 0 ||
      !isShipFittingFlag(destinationFlagID) ||
      isStructureServiceSlotFlag(destinationFlagID)
    ) {
      return [];
    }

    const charID = this._getCharacterId(session);
    // Scope to the acting character's own ship; structure hosts and other-owned
    // hosts are intentionally excluded.
    const shipRecord = findCharacterShip(charID, destinationLocationID);
    if (!shipRecord) {
      return [];
    }

    const movedItemID = this._normalizeInventoryId(sourceItem && sourceItem.itemID, 0);
    const movedItem = movedItemID > 0 ? findItemById(movedItemID) : null;
    if (
      !movedItem ||
      this._normalizeInventoryId(movedItem.locationID, 0) !== destinationLocationID ||
      this._normalizeInventoryId(movedItem.flagID, 0) !== destinationFlagID
    ) {
      return [];
    }

    const fittedItems = listFittedItems(charID, destinationLocationID);
    const decision = resolveFitOnlineState(charID, shipRecord, movedItem, fittedItems);
    if (!decision.applies || decision.online !== false) {
      return [];
    }

    const alreadyOffline =
      movedItem.moduleState && movedItem.moduleState.online === false;
    if (alreadyOffline) {
      return [];
    }

    const updateResult = updateInventoryItem(movedItemID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        online: false,
      },
    }));
    if (!updateResult || updateResult.success !== true) {
      log.warn(
        `[InvBroker] ship module fit auto-offline failed ship=${destinationLocationID} item=${movedItemID} reason=${decision.reason || "UNKNOWN"} error=${updateResult && updateResult.errorMsg || "UNKNOWN"}`,
      );
      return [];
    }

    log.debug(
      `[InvBroker] fitted module left offline ship=${destinationLocationID} item=${movedItemID} reason=${decision.reason || "UNKNOWN"}`,
    );
    return [
      {
        previousData: updateResult.previousData || movedItem,
        item: updateResult.data,
      },
    ];
  }

  _isLootContainerEntity(session, entityID) {
    const numericEntityID = this._normalizeInventoryId(entityID, 0);
    if (numericEntityID <= 0) {
      return false;
    }

    const scene = runtime.getSceneForSession(session);
    const entity = scene && scene.getEntityByID(numericEntityID);
    return Boolean(
      entity && (entity.kind === "container" || entity.kind === "wreck")
    );
  }

  _isFleetLootSource(session, sourceItemDescriptor, sourceLocationID = 0) {
    if (!sourceItemDescriptor || !sourceItemDescriptor.item) {
      return false;
    }

    if (sourceItemDescriptor.sourceKind === "nativeWreck") {
      return true;
    }

    const itemLocationID = this._normalizeInventoryId(
      sourceItemDescriptor.item.locationID,
      0,
    );
    if (this._isLootContainerEntity(session, itemLocationID)) {
      return true;
    }

    const explicitSourceLocationID = this._normalizeInventoryId(
      sourceLocationID,
      0,
    );
    return explicitSourceLocationID > 0
      ? this._isLootContainerEntity(session, explicitSourceLocationID)
      : false;
  }

  _appendFleetLootEntry(
    session,
    fleetLootEntries,
    sourceItemDescriptor,
    sourceLocationID,
    destination,
    requestedQuantity,
  ) {
    if (
      !Array.isArray(fleetLootEntries) ||
      !this._isFleetLootSource(session, sourceItemDescriptor, sourceLocationID)
    ) {
      return;
    }

    const item =
      sourceItemDescriptor && sourceItemDescriptor.item
        ? sourceItemDescriptor.item
        : null;
    const typeID = this._normalizeInventoryId(item && item.typeID, 0);
    const quantity = this._resolveAppliedMoveQuantity(
      item,
      destination,
      requestedQuantity,
    );
    if (typeID <= 0 || quantity <= 0) {
      return;
    }

    fleetLootEntries.push({
      typeID,
      quantity,
    });
  }

  _emitFleetLootEvents(session, fleetLootEntries = []) {
    if (!Array.isArray(fleetLootEntries) || fleetLootEntries.length <= 0) {
      return;
    }

    fleetRuntime.recordLootEventsForSession(session, fleetLootEntries);
  }

  _destinationUsesCapacity(boundContext, destination) {
    if (!boundContext || !destination) {
      return false;
    }

    if (
      boundContext.kind === "shipInventory" &&
      isShipFittingFlag(destination.flagID)
    ) {
      return false;
    }

    if (
      boundContext.kind === "controlledStructureInventory" &&
      this._isStructureOwnerBayFlag(destination.flagID)
    ) {
      return true;
    }

    return (
      boundContext.kind === "shipInventory" ||
      boundContext.kind === "container"
    );
  }

  _getMoveCapacityError(boundContext, destination, item) {
    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      Number(destination && destination.flagID) === ITEM_FLAGS.DRONE_BAY
    ) {
      return "NotEnoughDroneBaySpace";
    }

    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      Number(destination && destination.flagID) === ITEM_FLAGS.FIGHTER_BAY
    ) {
      return "NotEnoughFighterBaySpace";
    }

    if (
      boundContext &&
      Number(destination && destination.flagID) === ITEM_FLAGS.FIGHTER_BAY
    ) {
      return "NotEnoughFighterBaySpace";
    }

    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      isShipFittingFlag(Number(destination && destination.flagID)) &&
      Number(item && item.categoryID) === 8
    ) {
      return "NotEnoughChargeSpace";
    }

    if (boundContext && boundContext.kind === "container") {
      return "NoSpaceForThat";
    }

    return "NotEnoughCargoSpace";
  }

  _getMobileDepotCargoAccessError(session, containerID) {
    const numericContainerID = this._normalizeInventoryId(containerID, 0);
    if (numericContainerID <= 0) {
      return null;
    }

    const containerRecord = findItemById(numericContainerID);
    if (!isMobileDepotItemRecord(containerRecord)) {
      return null;
    }

    const accessResult = validateMobileDepotCargoAccess(session, containerRecord);
    return accessResult && accessResult.success
      ? null
      : accessResult.errorMsg || "ACCESS_DENIED";
  }

  _validateMobileDepotCargoTransferAccess(session, sourceItem, destination) {
    const sourceContainerID = this._normalizeInventoryId(
      sourceItem && sourceItem.locationID,
      0,
    );
    const destinationContainerID = this._normalizeInventoryId(
      destination && destination.locationID,
      0,
    );

    const sourceAccessError = this._getMobileDepotCargoAccessError(
      session,
      sourceContainerID,
    );
    if (sourceAccessError) {
      return {
        success: false,
        errorMsg: sourceAccessError,
        containerID: sourceContainerID,
      };
    }

    const destinationAccessError = this._getMobileDepotCargoAccessError(
      session,
      destinationContainerID,
    );
    if (destinationAccessError) {
      return {
        success: false,
        errorMsg: destinationAccessError,
        containerID: destinationContainerID,
      };
    }

    return { success: true };
  }

  _getShipServiceAccessError(session, shipID, flagID) {
    const numericFlagID = this._normalizeInventoryId(flagID, 0);
    if (!isShipServiceFlag(numericFlagID)) {
      return null;
    }

    const shipRecord =
      findShipItemById(this._normalizeInventoryId(shipID, 0)) ||
      findItemById(this._normalizeInventoryId(shipID, 0));
    if (!shipRecord || Number(shipRecord.categoryID) !== 6) {
      return null;
    }

    const accessResult = validateShipServiceAccess(
      session,
      shipRecord,
      numericFlagID,
    );
    return accessResult && accessResult.success
      ? null
      : accessResult.errorMsg || "SHIP_SERVICE_ACCESS_DENIED";
  }

  _validateShipServiceTransferAccess(session, sourceItem, destination) {
    const sourceLocationID = this._normalizeInventoryId(
      sourceItem && sourceItem.locationID,
      0,
    );
    const sourceFlagID = this._normalizeInventoryId(
      sourceItem && sourceItem.flagID,
      0,
    );
    const sourceAccessError = this._getShipServiceAccessError(
      session,
      sourceLocationID,
      sourceFlagID,
    );
    if (sourceAccessError) {
      return {
        success: false,
        errorMsg: sourceAccessError,
        shipID: sourceLocationID,
      };
    }

    const destinationLocationID = this._normalizeInventoryId(
      destination && destination.locationID,
      0,
    );
    const destinationFlagID = this._normalizeInventoryId(
      destination && destination.flagID,
      0,
    );
    const destinationAccessError = this._getShipServiceAccessError(
      session,
      destinationLocationID,
      destinationFlagID,
    );
    if (destinationAccessError) {
      return {
        success: false,
        errorMsg: destinationAccessError,
        shipID: destinationLocationID,
      };
    }

    return { success: true };
  }

  _throwShipServiceAccessError(errorMsg) {
    const notifyByError = {
      SHIP_SERVICE_ACCESS_DENIED:
        "You do not have access to this ship service bay.",
    };

    throwWrappedUserError("CustomNotify", {
      notify:
        notifyByError[errorMsg] ||
        "Unable to access this ship service bay.",
    });
  }

  _throwMobileDepotCargoAccessError(errorMsg) {
    if (errorMsg === "TARGET_TOO_FAR") {
      throwWrappedUserError("TargetTooFar");
    }

    const notifyByError = {
      INVALID_SESSION: "You must be in space in your active ship to access this Mobile Depot.",
      ITEM_NOT_FOUND: "Unable to find this Mobile Depot.",
      MOBILE_DEPOT_STATE_NOT_FOUND: "This Mobile Depot is not deployed.",
      MOBILE_DEPOT_NOT_IN_SPACE: "This Mobile Depot is not deployed in space.",
      MOBILE_DEPOT_NOT_OWNER: "Only the owner can access this Mobile Depot.",
      MOBILE_DEPOT_NOT_ACTIVE: "This Mobile Depot is still activating.",
    };

    throwWrappedUserError("CustomNotify", {
      notify: notifyByError[errorMsg] || "Unable to access this Mobile Depot.",
    });
  }

  _isActiveShipCloaked(session, shipID = 0) {
    const numericShipID = this._normalizeInventoryId(
      shipID || (session && session._space && session._space.shipID) || this._getShipId(session),
      0,
    );
    if (!session || !session._space || numericShipID <= 0) {
      return false;
    }

    const entity = runtime.getEntity(session, numericShipID);
    if (!entity) {
      return false;
    }

    return (
      entity.cloaked === true ||
      this._normalizeInventoryId(entity.cloakMode, 0) > 0 ||
      this._normalizeInventoryId(entity.isCloaked, 0) > 0 ||
      this._normalizeInventoryId(entity.cloakState, 0) > 0
    );
  }

  _isInSpaceRefitMove(session, shipRecord, item, destination) {
    if (
      !session ||
      isDockedSession(session) ||
      !shipRecord ||
      !item ||
      this._normalizeInventoryId(item.categoryID, 0) === CHARGE_CATEGORY_ID
    ) {
      return false;
    }

    const activeShipID = this._normalizeInventoryId(
      (session._space && session._space.shipID) ||
        session.activeShipID ||
        session.shipID ||
        session.shipid ||
        this._getShipId(session),
      0,
    );
    const shipID = this._normalizeInventoryId(shipRecord.itemID, 0);
    if (activeShipID <= 0 || shipID <= 0 || activeShipID !== shipID) {
      return false;
    }

    const sourceIsFitted = (
      this._normalizeInventoryId(item.locationID, 0) === shipID &&
      isShipFittingFlag(item.flagID)
    );
    const destinationIsFitted = (
      destination &&
      this._normalizeInventoryId(destination.locationID, 0) === shipID &&
      isShipFittingFlag(destination.flagID)
    );

    return sourceIsFitted || destinationIsFitted;
  }

  _getMobileDepotFittingServiceAccess(session) {
    const systemID = this._normalizeInventoryId(
      session && session._space && session._space.systemID,
      this._normalizeInventoryId(
        session && (session.solarsystemid2 || session.solarsystemid),
        0,
      ),
    );
    if (systemID <= 0) {
      return {
        success: false,
        errorMsg: "INVALID_SESSION",
      };
    }

    const depots = listContainerItems(null, systemID, 0)
      .filter((item) => isMobileDepotItemRecord(item))
      .sort((left, right) => (
        this._normalizeInventoryId(left && left.itemID, 0) -
        this._normalizeInventoryId(right && right.itemID, 0)
      ));
    let bestError = depots.length > 0
      ? "MOBILE_DEPOT_FITTING_SERVICE_NOT_AVAILABLE"
      : "MOBILE_DEPOT_FITTING_SERVICE_NOT_FOUND";
    const errorPriority = {
      MOBILE_DEPOT_REINFORCED: 60,
      TARGET_TOO_FAR: 50,
      MOBILE_DEPOT_NOT_ACTIVE: 40,
      MOBILE_DEPOT_NOT_IN_SPACE: 30,
      MOBILE_DEPOT_STATE_NOT_FOUND: 20,
      MOBILE_DEPOT_NOT_OWNER: 10,
    };

    for (const depot of depots) {
      const accessResult = validateMobileDepotFittingAccess(session, depot);
      if (accessResult && accessResult.success) {
        return accessResult;
      }

      const errorMsg =
        accessResult && accessResult.errorMsg
          ? accessResult.errorMsg
          : "MOBILE_DEPOT_FITTING_SERVICE_NOT_AVAILABLE";
      if ((errorPriority[errorMsg] || 0) > (errorPriority[bestError] || 0)) {
        bestError = errorMsg;
      }
    }

    return {
      success: false,
      errorMsg: bestError,
    };
  }

  _validateInSpaceFittingServiceAccess(session, shipRecord, item, destination) {
    if (!this._isInSpaceRefitMove(session, shipRecord, item, destination)) {
      return { success: true };
    }

    if (this._isActiveShipCloaked(session, shipRecord.itemID)) {
      return {
        success: false,
        errorMsg: "MOBILE_DEPOT_FITTING_SERVICE_CLOAKED",
      };
    }

    return this._getMobileDepotFittingServiceAccess(session);
  }

  _isDockedStructureRefitMove(session, shipRecord, item, destination) {
    if (
      !session ||
      !isDockedSession(session) ||
      !shipRecord ||
      !item ||
      this._normalizeInventoryId(item.categoryID, 0) === CHARGE_CATEGORY_ID
    ) {
      return false;
    }

    const structureID = this._normalizeInventoryId(
      session.structureID || session.structureid,
      0,
    );
    if (structureID <= 0) {
      return false;
    }

    const shipID = this._normalizeInventoryId(shipRecord.itemID, 0);
    if (shipID <= 0 || this._normalizeInventoryId(shipRecord.categoryID, 0) !== 6) {
      return false;
    }

    const sourceIsFitted = (
      this._normalizeInventoryId(item.locationID, 0) === shipID &&
      isShipFittingFlag(item.flagID)
    );
    const destinationIsFitted = (
      destination &&
      this._normalizeInventoryId(destination.locationID, 0) === shipID &&
      isShipFittingFlag(destination.flagID)
    );

    return sourceIsFitted || destinationIsFitted;
  }

  _validateDockedStructureFittingServiceAccess(session, shipRecord, item, destination) {
    if (!this._isDockedStructureRefitMove(session, shipRecord, item, destination)) {
      return { success: true };
    }

    const structureID = this._normalizeInventoryId(
      session.structureID || session.structureid,
      0,
    );
    const structure = this._getStructureForInventoryID(structureID);
    if (characterHasStructureService(session, structure, STRUCTURE_SERVICE_ID.FITTING)) {
      return { success: true };
    }

    return {
      success: false,
      errorMsg: "StructureDockingDenied",
      structureID,
    };
  }

  _throwDockedStructureFittingAccessError(errorMsg) {
    throwWrappedUserError(errorMsg || "StructureDockingDenied");
  }

  _throwMobileDepotFittingAccessError(errorMsg) {
    if (errorMsg === "TARGET_TOO_FAR") {
      throwWrappedUserError("TargetTooFar");
    }

    const notifyByError = {
      INVALID_SESSION: "You must be in space in your active ship to use a Mobile Depot fitting service.",
      MOBILE_DEPOT_NOT_ACTIVE: "This Mobile Depot is still activating.",
      MOBILE_DEPOT_REINFORCED: "This Mobile Depot is reinforced and cannot provide fitting service.",
      MOBILE_DEPOT_FITTING_SERVICE_CLOAKED: "You cannot refit from a Mobile Depot while cloaked.",
      MOBILE_DEPOT_FITTING_SERVICE_NOT_FOUND:
        `You must be within ${MOBILE_DEPOT_FITTING_RANGE_METERS} meters of an active Mobile Depot you own to refit in space.`,
      MOBILE_DEPOT_FITTING_SERVICE_NOT_AVAILABLE:
        `You must be within ${MOBILE_DEPOT_FITTING_RANGE_METERS} meters of an active Mobile Depot you own to refit in space.`,
    };

    throwWrappedUserError("CustomNotify", {
      notify:
        notifyByError[errorMsg] ||
        "Unable to access a Mobile Depot fitting service.",
    });
  }

  _getItemMoveVolume(item, quantity) {
    const numericQuantity = Math.max(1, Number(quantity) || 0);
    const unitVolume = Math.max(0, getInventoryItemUnitVolume(item));
    return unitVolume * numericQuantity;
  }

  _checkCapacityForMove(
    session,
    boundContext,
    destination,
    item,
    requestedQuantity = null,
  ) {
    if (
      !item ||
      !boundContext ||
      !destination ||
      !this._destinationUsesCapacity(boundContext, destination)
    ) {
      return { success: true };
    }

    const currentLocationID = this._normalizeInventoryId(item.locationID, 0);
    const currentFlagID = this._normalizeInventoryId(item.flagID, 0);
    if (
      currentLocationID === this._normalizeInventoryId(destination.locationID, 0) &&
      currentFlagID === this._normalizeInventoryId(destination.flagID, 0)
    ) {
      return { success: true };
    }

    const availableQuantity =
      Number(item.singleton) === 1
        ? 1
        : Math.max(1, Number(item.stacksize ?? item.quantity ?? 1) || 1);
    const resolvedQuantity = this._resolveMoveQuantity(
      item,
      destination,
      requestedQuantity,
    );
    const moveQuantity =
      resolvedQuantity === null || resolvedQuantity === undefined
        ? availableQuantity
        : Math.max(1, Number(resolvedQuantity) || 1);
    const requiredVolume = this._getItemMoveVolume(item, moveQuantity);
    if (requiredVolume <= 0) {
      return { success: true };
    }

    const capacityInfo = this._calculateCapacity(
      session,
      boundContext,
      destination.flagID,
    );
    const capacity = Number(
      capacityInfo &&
      capacityInfo.args &&
      capacityInfo.args.type === "dict" &&
      Array.isArray(capacityInfo.args.entries)
        ? (
            capacityInfo.args.entries.find(([key]) => key === "capacity") || []
          )[1]
        : 0,
    ) || 0;
    const used = Number(
      capacityInfo &&
      capacityInfo.args &&
      capacityInfo.args.type === "dict" &&
      Array.isArray(capacityInfo.args.entries)
        ? (
            capacityInfo.args.entries.find(([key]) => key === "used") || []
          )[1]
        : 0,
    ) || 0;
    const free = Math.max(0, capacity - used);

    if (requiredVolume <= free + 1e-7) {
      return { success: true };
    }

    return {
      success: false,
      errorMsg: this._getMoveCapacityError(boundContext, destination, item),
      free,
      requiredVolume,
    };
  }

  _buildCapacityMoveUserErrorValues(capacityCheck, item) {
    const available = Number(
      Number(capacityCheck && capacityCheck.free || 0).toFixed(6),
    );
    const volume = Number(
      Number(capacityCheck && capacityCheck.requiredVolume || 0).toFixed(6),
    );
    if (String(capacityCheck && capacityCheck.errorMsg || "") === "NotEnoughCargoSpace") {
      return { available, volume };
    }
    return {
      type: Number(item && item.typeID) || 0,
      free: available,
      required: volume,
    };
  }

  _getShipInventoryRecord(session, boundContext) {
    const inventoryID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    if (inventoryID <= 0) {
      return null;
    }

    const charId = this._getCharacterId(session);
    return (
      findCharacterShip(charId, inventoryID) ||
      findShipItemById(inventoryID) ||
      null
    );
  }

  _getStructureFitHostRecord(session, structureID) {
    const numericStructureID = this._normalizeInventoryId(structureID, 0);
    return numericStructureID > 0
      ? this._buildStructureItemOverrides(session, numericStructureID)
      : null;
  }

  _isStructureFitHostRecord(fitHostRecord) {
    return (
      this._normalizeInventoryId(fitHostRecord && fitHostRecord.categoryID, 0) ===
      STRUCTURE_CATEGORY_ID
    );
  }

  _listFittedItemsForFitHost(session, fitHostRecord) {
    if (!fitHostRecord) {
      return [];
    }
    const fitHostID = this._normalizeInventoryId(fitHostRecord.itemID, 0);
    return this._isStructureFitHostRecord(fitHostRecord)
      ? listFittedItemsForLocation(fitHostID)
      : listFittedItems(this._getCharacterId(session), fitHostID);
  }

  _isAutoFitRequested(explicitFlagValue, explicitFlagProvided) {
    if (!explicitFlagProvided) {
      return false;
    }

    const numericFlag = this._normalizeInventoryId(explicitFlagValue, 0);
    if (
      isShipFittingFlag(numericFlag) ||
      SHIP_BAY_FLAGS.has(numericFlag) ||
      this._isStructureOwnerBayFlag(numericFlag) ||
      this._isMoonMaterialBayFlag(numericFlag) ||
      numericFlag === ITEM_FLAGS.STRUCTURE_DEED
    ) {
      return false;
    }

    return true;
  }

  _resolveDestinationForMove(
    session,
    boundContext,
    item,
    requestedFlag,
    explicitFlagProvided,
    fittedItemsOverride = null,
  ) {
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const fitHostRecord = shipRecord || this._getStructureFitHostRecord(
      session,
      boundContext && boundContext.inventoryID,
    );
    const numericRequestedFlag =
      requestedFlag === undefined || requestedFlag === null
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const isExplicitFitMove =
      numericRequestedFlag !== null && isShipFittingFlag(numericRequestedFlag);
    const isAutoFitMove = this._isAutoFitRequested(
      requestedFlag,
      explicitFlagProvided,
    );

    if (!shipRecord && (!fitHostRecord || (!isExplicitFitMove && !isAutoFitMove))) {
      return {
        locationID: this._normalizeInventoryId(
          boundContext && boundContext.inventoryID,
          this._getStationId(session),
        ),
        flagID: requestedFlag ?? ITEM_FLAGS.HANGAR,
      };
    }

    const currentFittedItems =
      Array.isArray(fittedItemsOverride) && fittedItemsOverride.length >= 0
        ? fittedItemsOverride
        : this._listFittedItemsForFitHost(session, fitHostRecord);

    if (isExplicitFitMove) {
      return {
        locationID: fitHostRecord.itemID,
        flagID: numericRequestedFlag,
      };
    }

    if (isAutoFitMove) {
      const autoFitFlag = selectAutoFitFlagForType(
        fitHostRecord,
        currentFittedItems,
        item && item.typeID,
      );
      if (autoFitFlag) {
        return {
          locationID: fitHostRecord.itemID,
          flagID: autoFitFlag,
        };
      }

      return null;
    }

    return {
      locationID: shipRecord.itemID,
      flagID:
        numericRequestedFlag ??
        this._normalizeInventoryId(
          boundContext && boundContext.flagID,
          ITEM_FLAGS.CARGO_HOLD,
        ),
    };
  }

  _emitInventoryMoveChanges(session, changes = [], options = {}) {
    const normalizedChanges = Array.isArray(changes) ? changes : [];

    if (options.emitItemsChangedBatch === true) {
      emitItemsChangedBatchForSession(session, normalizedChanges, {
        idType: options.idType,
        locationContext: options.locationContext,
      });
      this._refreshDockedFittingState(session, normalizedChanges);
      return;
    }

    for (const change of normalizedChanges) {
      if (!change || !change.item) {
        continue;
      }

      syncInventoryItemForSession(
        session,
        change.item,
        change.previousData || {},
        {
          emitCfgLocation: true,
        },
      );
    }

    this._refreshDockedFittingState(session, normalizedChanges);
  }

  _isMtuSpaceComponentLootMove(session, sourceLocationID, destination) {
    const sourceContainer = findItemById(sourceLocationID);
    const metadata = sourceContainer
      ? getItemMetadata(sourceContainer.typeID, sourceContainer.itemName)
      : null;
    const sourceCategoryID = this._normalizeInventoryId(sourceContainer && sourceContainer.categoryID, 0);
    const sourceGroupID = this._normalizeInventoryId(sourceContainer && sourceContainer.groupID, 0);
    const metadataCategoryID = this._normalizeInventoryId(metadata && metadata.categoryID, 0);
    const metadataGroupID = this._normalizeInventoryId(metadata && metadata.groupID, 0);
    const isMtuSource =
      (sourceCategoryID === CATEGORY_DEPLOYABLE && sourceGroupID === GROUP_MOBILE_TRACTOR_UNIT) ||
      (metadataCategoryID === CATEGORY_DEPLOYABLE && metadataGroupID === GROUP_MOBILE_TRACTOR_UNIT);
    return Boolean(
      sourceContainer &&
      isMtuSource &&
      destination &&
      this._normalizeInventoryId(destination.locationID, 0) === this._normalizeInventoryId(this._getShipId(session), 0) &&
      this._normalizeInventoryId(destination.flagID, 0) === ITEM_FLAGS.CARGO_HOLD
    );
  }

  _isPlayerJetcanLootMove(session, sourceLocationID, destination) {
    const sourceContainer = findItemById(sourceLocationID);
    if (!sourceContainer || !destination) {
      return false;
    }

    const destinationLocationID = this._normalizeInventoryId(destination.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    return Boolean(
      this._normalizeInventoryId(sourceContainer.typeID, 0) === FLOATING_CARGO_TYPE_ID &&
      this._normalizeInventoryId(sourceContainer.flagID, 0) === 0 &&
      sourceContainer.expiresAtMs &&
      destinationLocationID === this._normalizeInventoryId(this._getShipId(session), 0) &&
      SHIP_BAY_FLAGS.has(destinationFlagID)
    );
  }

  _buildShipCargoLocationContext(session, destination) {
    const shipID = this._normalizeInventoryId(
      destination && destination.locationID,
      this._getShipId(session),
    );
    return ["Ship", shipID, "ShipCargo"];
  }

  _emitMtuSpaceComponentLootEvents(session, sourceLocationID, destination, lootedItems = []) {
    if (!session || typeof session.sendNotification !== "function") {
      return false;
    }
    const shipID = this._normalizeInventoryId(
      destination && destination.locationID,
      this._getShipId(session),
    );
    const flagID = this._normalizeInventoryId(
      destination && destination.flagID,
      ITEM_FLAGS.CARGO_HOLD,
    );
    session.sendNotification("OnClientEvent_MoveFromCargoToHangar", "clientID", [
      sourceLocationID,
      shipID,
      flagID,
    ]);
    const rows = (Array.isArray(lootedItems) ? lootedItems : [])
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean)
      .map((overrides) => this._buildInvRow(session, overrides));
    session.sendNotification("OnWreckLootAll", "clientID", [
      ["SpaceComponentInventory", sourceLocationID],
      rows,
    ]);
    return true;
  }

  _emitPlayerJetcanLootEvents(session, sourceLocationID, destination, lootedItems = []) {
    if (!session || typeof session.sendNotification !== "function") {
      return false;
    }
    const shipID = this._normalizeInventoryId(
      destination && destination.locationID,
      this._getShipId(session),
    );
    const flagID = this._normalizeInventoryId(
      destination && destination.flagID,
      ITEM_FLAGS.CARGO_HOLD,
    );
    session.sendNotification("OnClientEvent_MoveFromCargoToHangar", "clientID", [
      sourceLocationID,
      shipID,
      flagID,
    ]);
    const rows = (Array.isArray(lootedItems) ? lootedItems : [])
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean)
      .map((overrides) => this._buildInvRow(session, overrides));
    session.sendNotification("OnWreckLootAll", "clientID", [
      ["ItemFloatingCargo", sourceLocationID],
      rows,
    ]);
    return true;
  }

  _classifyCorpStructureHangarMove(session, change) {
    const item = change && change.item ? change.item : null;
    const previous = change && (change.previousData || change.previousState)
      ? (change.previousData || change.previousState)
      : null;
    if (!item || !previous) {
      return null;
    }

    const characterID = this._normalizeInventoryId(this._getCharacterId(session), 0);
    const corporationID = this._normalizeInventoryId(this._getCorporationId(session), 0);
    if (characterID <= 0 || corporationID <= 0) {
      return null;
    }

    const previousOwnerID = this._normalizeInventoryId(previous.ownerID, 0);
    const currentOwnerID = this._normalizeInventoryId(item.ownerID, 0);
    const previousLocationID = this._normalizeInventoryId(previous.locationID, 0);
    const currentLocationID = this._normalizeInventoryId(item.locationID, 0);
    const previousFlagID = this._normalizeInventoryId(previous.flagID, 0);
    const currentFlagID = this._normalizeInventoryId(item.flagID, 0);

    const previousOffice = this._getCorporationOfficeForItemLocation(
      session,
      previousLocationID,
    );
    const currentOffice = this._getCorporationOfficeForItemLocation(
      session,
      currentLocationID,
    );
    const previousStructure = this._getStructureForInventoryID(previousLocationID);
    const currentStructure = this._getStructureForInventoryID(currentLocationID);

    if (
      previousOwnerID === corporationID &&
      currentOwnerID === characterID &&
      previousOffice &&
      this._isCorporationHangarFlag(previousFlagID) &&
      currentFlagID === ITEM_FLAGS.HANGAR &&
      currentStructure
    ) {
      return {
        order: ["charid", CORP_HANGAR_BROADCAST_IDTYPE],
        locationContext: [
          "Structure",
          currentLocationID,
          "StructureItemHangar",
        ],
      };
    }

    if (
      previousOwnerID === characterID &&
      currentOwnerID === corporationID &&
      previousFlagID === ITEM_FLAGS.HANGAR &&
      previousStructure &&
      currentOffice &&
      this._isCorporationHangarFlag(currentFlagID)
    ) {
      return {
        order: [CORP_HANGAR_BROADCAST_IDTYPE, "charid"],
        locationContext: null,
      };
    }

    return null;
  }

  _emitCorpStructureHangarMoveChanges(session, changes = []) {
    const normalizedChanges = (Array.isArray(changes) ? changes : []).filter(
      (change) => change && change.item,
    );
    if (normalizedChanges.length !== 1) {
      return false;
    }

    const change = normalizedChanges[0];
    const classification = this._classifyCorpStructureHangarMove(session, change);
    if (!classification) {
      return false;
    }

    for (const idType of classification.order) {
      emitItemsChangedBatchForSession(session, [change], {
        idType,
        locationContext: classification.locationContext,
      });
    }
    this._refreshDockedFittingState(session, normalizedChanges);
    return true;
  }

  _emitStructureCoreInstallMoveChanges(
    session,
    changes = [],
    destination = null,
    sourceItem = null,
  ) {
    const normalizedChanges = (Array.isArray(changes) ? changes : []).filter(
      (change) => change && change.item,
    );
    const deedChanges = normalizedChanges.filter((change) => (
      this._normalizeInventoryId(change.item.locationID, 0) ===
        this._normalizeInventoryId(destination && destination.locationID, 0) &&
      this._normalizeInventoryId(change.item.flagID, 0) ===
        ITEM_FLAGS.STRUCTURE_DEED
    ));
    if (deedChanges.length === 0) {
      return false;
    }

    const deedItem = deedChanges[0].item;
    const previousOwnerID = this._normalizeInventoryId(
      sourceItem && sourceItem.ownerID,
      this._getCharacterId(session),
    );
    const previousLocationID = this._normalizeInventoryId(
      sourceItem && sourceItem.locationID,
      0,
    );
    const previousFlagID = this._normalizeInventoryId(
      sourceItem && sourceItem.flagID,
      ITEM_FLAGS.HANGAR,
    );
    const changeEntries = [];
    if (
      previousOwnerID > 0 &&
      previousOwnerID !== this._normalizeInventoryId(deedItem.ownerID, 0)
    ) {
      changeEntries.push([2, previousOwnerID]);
    }
    if (
      previousLocationID > 0 &&
      previousLocationID !== this._normalizeInventoryId(deedItem.locationID, 0)
    ) {
      changeEntries.push([3, previousLocationID]);
    }
    if (previousFlagID !== this._normalizeInventoryId(deedItem.flagID, 0)) {
      changeEntries.push([4, previousFlagID]);
    }
    const changeDict = {
      type: "dict",
      entries: changeEntries,
    };

    for (const idType of ["shipid", "charid"]) {
      emitItemsChangedBatchForSession(session, deedChanges, {
        idType,
        changeDict,
      });
    }
    this._refreshDockedFittingState(session, normalizedChanges);

    if (session && typeof session.sendNotification === "function") {
      const structureID = this._normalizeInventoryId(
        destination && destination.locationID,
        0,
      );
      session.sendNotification("OnClientEvent_MoveFromCargoToHangar", "clientID", [
        structureID,
        structureID,
        ITEM_FLAGS.STRUCTURE_DEED,
      ]);
    }
    return true;
  }

  _primeDroneBayDogmaForFittingChanges(session, changes = []) {
    if (!Array.isArray(changes) || changes.length === 0) {
      return false;
    }

    const shipIDs = new Set();
    for (const change of changes) {
      if (!change || !change.item) {
        continue;
      }
      const item = change.item;
      const previous = change.previousData || change.previousState || {};
      const currentFlagID = this._normalizeInventoryId(item.flagID, 0);
      const previousFlagID = this._normalizeInventoryId(previous.flagID, 0);
      if (
        currentFlagID !== ITEM_FLAGS.DRONE_BAY &&
        previousFlagID !== ITEM_FLAGS.DRONE_BAY
      ) {
        continue;
      }
      const shipID = this._normalizeInventoryId(
        currentFlagID === ITEM_FLAGS.DRONE_BAY
          ? item.locationID
          : previous.locationID,
        0,
      );
      if (shipID > 0) {
        shipIDs.add(shipID);
      }
    }

    let primed = false;
    for (const shipID of shipIDs) {
      const shipContext = {
        kind: "shipInventory",
        inventoryID: shipID,
        flagID: ITEM_FLAGS.DRONE_BAY,
      };
      const droneBayItems = this._resolveContainerItems(
        session,
        ITEM_FLAGS.DRONE_BAY,
        shipContext,
      );
      primed = this._primeInSpaceBayDogmaItems(
        session,
        shipContext,
        ITEM_FLAGS.DRONE_BAY,
        droneBayItems,
      ) || primed;
    }

    return primed;
  }

  // TQ-parity emission for fit/unfit moves: lock -> OnMultiEvent(dogma recalc) ->
  // OnItemsChanged -> unlock, delegated to characterState. Replaces the legacy
  // per-item OnItemChange + _refreshDockedFittingState path on the fitting
  // handlers. See doc/PARITY_FITTING_NOTIFICATION_SEQUENCE.md.
  _emitFittingMoveChanges(session, changes = []) {
    const normalized = (Array.isArray(changes) ? changes : []).filter(
      (change) => change && change.item,
    );
    if (normalized.length === 0) {
      return;
    }
    // Dedupe exact row deltas while preserving TQ's packaged-module sequence:
    // singleton conversion in cargo first, then the actual slot move. Folded-in
    // online-state changes carry no client-visible row delta and are skipped.
    const deduped = [];
    const seenRowDeltas = new Set();
    for (const change of normalized) {
      const itemID = this._normalizeInventoryId(change.item.itemID, 0);
      if (itemID <= 0) {
        continue;
      }
      const previous = change.previousData || change.previousState || {};
      const signatureParts = [
        itemID,
        this._normalizeInventoryId(previous.ownerID, 0),
        this._normalizeInventoryId(previous.locationID, 0),
        this._normalizeInventoryId(previous.flagID, -1),
        this._normalizeInventoryId(previous.quantity, 0),
        this._normalizeInventoryId(previous.stacksize, 0),
        this._normalizeInventoryId(previous.singleton, -1),
        this._normalizeInventoryId(change.item.ownerID, 0),
        this._normalizeInventoryId(change.item.locationID, 0),
        this._normalizeInventoryId(change.item.flagID, -1),
        this._normalizeInventoryId(change.item.quantity, 0),
        this._normalizeInventoryId(change.item.stacksize, 0),
        this._normalizeInventoryId(change.item.singleton, -1),
      ];
      const hasRowDelta =
        signatureParts[1] !== signatureParts[7] ||
        signatureParts[2] !== signatureParts[8] ||
        signatureParts[3] !== signatureParts[9] ||
        signatureParts[4] !== signatureParts[10] ||
        signatureParts[5] !== signatureParts[11] ||
        signatureParts[6] !== signatureParts[12];
      if (!hasRowDelta) {
        continue;
      }
      const signature = signatureParts.join(":");
      if (!seenRowDeltas.has(signature)) {
        seenRowDeltas.add(signature);
        deduped.push(change);
      }
    }
    if (deduped.length === 0) {
      return;
    }
    this._primeDroneBayDogmaForFittingChanges(session, deduped);

    let fittingShipID = 0;
    for (const change of deduped) {
      const previous = change.previousData || change.previousState || {};
      if (isShipFittingFlag(change.item.flagID)) {
        fittingShipID = this._normalizeInventoryId(change.item.locationID, 0);
        break;
      }
      if (isShipFittingFlag(previous.flagID)) {
        fittingShipID = this._normalizeInventoryId(previous.locationID, 0);
        break;
      }
    }
    if (fittingShipID <= 0) {
      fittingShipID = this._normalizeInventoryId(
        (session &&
          (session.activeShipID || session.shipID || session.shipid)) ||
          this._getShipId(session),
        0,
      );
    }

    emitFittingTransactionForSession(session, fittingShipID, deduped);
    this._refreshBallparkShipPresentation(session, deduped);
    this._refreshBallparkInventoryPresentation(session, deduped);
  }

  _maybeCompleteMaterializedDungeonSitesForSources(session, sourceContainerIDs = []) {
    if (!session || !session._space || !Array.isArray(sourceContainerIDs)) {
      return;
    }
    const systemID = this._normalizeInventoryId(session._space.systemID, 0);
    if (systemID <= 0 || !(runtime.scenes instanceof Map)) {
      return;
    }
    const scene = runtime.scenes.get(systemID);
    if (!scene) {
      return;
    }
    const nowMs = Date.now();
    for (const containerID of new Set(sourceContainerIDs.map((value) => this._normalizeInventoryId(value, 0)))) {
      if (containerID <= 0) {
        continue;
      }
      dungeonUniverseSiteService.maybeCompleteMaterializedDataRelicSiteForContainerID(
        scene,
        containerID,
        {
          broadcast: true,
          excludedSession: null,
          nowMs,
          session,
        },
      );
    }
  }

  _refreshDockedFittingState(session, changes = []) {
    if (
      !session ||
      !isDockedSession(session) ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      return;
    }

    const activeShipID = this._normalizeInventoryId(
      session.activeShipID || session.shipID || session.shipid,
      0,
    );
    if (activeShipID <= 0) {
      return;
    }

    const touchesFittingState = changes.some((change) => {
      if (!change || !change.item) {
        return false;
      }

      const previousState = change.previousData || change.previousState || {};
      const previousLocationID = this._normalizeInventoryId(
        previousState.locationID,
        0,
      );
      const previousFlagID = this._normalizeInventoryId(
        previousState.flagID,
        0,
      );
      const nextLocationID = this._normalizeInventoryId(
        change.item.locationID,
        0,
      );
      const nextFlagID = this._normalizeInventoryId(
        change.item.flagID,
        0,
      );

      if (
        previousLocationID !== activeShipID &&
        nextLocationID !== activeShipID
      ) {
        return false;
      }

      return (
        isShipFittingFlag(previousFlagID) ||
        isShipFittingFlag(nextFlagID)
      );
    });

    if (!touchesFittingState) {
      return;
    }

    syncShipFittingStateForSession(session, activeShipID, {
      includeOfflineModules: true,
      includeCharges: true,
      emitChargeInventoryRows: false,
    });
  }

  _refreshBallparkShipPresentation(session, changes = []) {
    if (!session || !session._space) {
      return;
    }

    const activeShipID = this._normalizeInventoryId(
      session._space.shipID || this._getShipId(session),
      0,
    );
    if (activeShipID <= 0) {
      return;
    }

    const touchesFittingState = (change) => {
      if (!change) {
        return false;
      }

      const previousLocationID = this._normalizeInventoryId(
        change.previousData && change.previousData.locationID,
        0,
      );
      const previousFlagID = this._normalizeInventoryId(
        change.previousData && change.previousData.flagID,
        0,
      );
      const nextLocationID = this._normalizeInventoryId(
        change.item && change.item.locationID,
        0,
      );
      const nextFlagID = this._normalizeInventoryId(
        change.item && change.item.flagID,
        0,
      );

      if (
        previousLocationID !== activeShipID &&
        nextLocationID !== activeShipID
      ) {
        return false;
      }

      return (
        isShipFittingFlag(previousFlagID) ||
        isShipFittingFlag(nextFlagID)
      );
    };

    if (!changes.some((change) => touchesFittingState(change))) {
      return;
    }

    const scene = runtime.getSceneForSession(session);
    if (!scene) {
      return;
    }

    runtime.refreshShipDerivedState(session, {
      broadcast: true,
    });

    const shipEntity = scene.getEntityByID(activeShipID);
    if (!shipEntity) {
      return;
    }

    scene.broadcastSlimItemChanges([shipEntity]);
  }

  _refreshBallparkInventoryPresentation(session, changes = []) {
    if (!session || !session._space || !Array.isArray(changes) || changes.length === 0) {
      return;
    }

    const scene = runtime.getSceneForSession(session);
    if (!scene) {
      return;
    }

    const affectedEntityIDs = new Set();
    const collectEntityID = (value) => {
      const numericID = this._normalizeInventoryId(value, 0);
      if (numericID <= 0) {
        return;
      }
      const entity = scene.getEntityByID(numericID);
      if (entity && (entity.kind === "container" || entity.kind === "wreck")) {
        affectedEntityIDs.add(numericID);
      }
    };

    for (const change of changes) {
      if (!change) {
        continue;
      }
      collectEntityID(change.item && change.item.itemID);
      collectEntityID(change.item && change.item.locationID);
      collectEntityID(change.previousData && change.previousData.locationID);
    }

    for (const entityID of affectedEntityIDs) {
      const entity = scene.getEntityByID(entityID);
      if (entity && entity.nativeNpcWreck === true) {
        nativeNpcWreckService.refreshNativeWreckRuntimeEntity(
          session._space.systemID,
          entityID,
          { broadcast: true },
        );
      } else {
        runtime.refreshInventoryBackedEntityPresentation(
          session._space.systemID,
          entityID,
          { broadcast: true },
        );
      }
    }
  }

  _validateFittingMove(session, shipRecord, item, destination, fittedItemsSnapshot = null) {
    if (
      !shipRecord ||
      !item ||
      !destination ||
      destination.locationID !== shipRecord.itemID ||
      !isShipFittingFlag(destination.flagID)
    ) {
      return { success: true };
    }

    const integratedServiceModuleValidation =
      this._validateIntegratedStructureServiceModuleFit(item, destination);
    if (!integratedServiceModuleValidation.success) {
      return integratedServiceModuleValidation;
    }

    const securityClassValidation =
      this._validateStructureServiceModuleSecurityClass(item, destination);
    if (!securityClassValidation.success) {
      return securityClassValidation;
    }

    const structureReactionValidation =
      this._validateStructureReactionServiceModuleFit(item, destination);
    if (!structureReactionValidation.success) {
      return structureReactionValidation;
    }

    const moonDrillValidation =
      this._validateStructureMoonDrillServiceModuleFit(item, destination);
    if (!moonDrillValidation.success) {
      return moonDrillValidation;
    }

    return validateFitForShip(
      this._getCharacterId(session),
      shipRecord,
      item,
      destination.flagID,
      fittedItemsSnapshot,
    );
  }

  _listFighterTubeItems(ownerID, locationID, excludedItemID = 0) {
    const numericOwnerID =
      ownerID === null || ownerID === undefined
        ? null
        : this._normalizeInventoryId(ownerID, 0);
    const numericLocationID = this._normalizeInventoryId(locationID, 0);
    const numericExcludedItemID = this._normalizeInventoryId(excludedItemID, 0);
    const tubeItems = [];

    for (const tubeFlagID of FIGHTER_TUBE_FLAGS) {
      for (const tubeItem of listContainerItems(
        numericOwnerID,
        numericLocationID,
        tubeFlagID,
      )) {
        if (
          numericExcludedItemID > 0 &&
          this._normalizeInventoryId(tubeItem && tubeItem.itemID, 0) ===
            numericExcludedItemID
        ) {
          continue;
        }
        tubeItems.push(tubeItem);
      }
    }

    return tubeItems;
  }

  _validateShipBayMove(session, shipRecord, item, destination) {
    if (
      !shipRecord ||
      !item ||
      !destination ||
      destination.locationID !== shipRecord.itemID
    ) {
      return { success: true };
    }

    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    if (isFuelBayFlag(destinationFlagID)) {
      return isFuelBayCompatibleItem(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (destinationFlagID === ITEM_FLAGS.DRONE_BAY) {
      return isDroneItemRecord(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (destinationFlagID === ITEM_FLAGS.FIGHTER_BAY) {
      return isFighterItemRecord(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (isFighterTubeFlag(destinationFlagID)) {
      if (!isFighterItemRecord(item)) {
        return {
          success: false,
          errorMsg: "NotEnoughCargoSpace",
        };
      }

      const destinationOccupants = listContainerItems(
        this._getCharacterId(session),
        shipRecord.itemID,
        destinationFlagID,
      ).filter(
        (existingItem) =>
          Number(existingItem && existingItem.itemID) !== Number(item.itemID),
      );
      if (destinationOccupants.length > 0) {
        return {
          success: false,
          errorMsg: "NotEnoughCargoSpace",
        };
      }

      const occupiedTubeItems = this._listFighterTubeItems(
        this._getCharacterId(session),
        shipRecord.itemID,
        item.itemID,
      );
      if (
        !canLoadFighterTypeIntoHostTube(
          shipRecord.typeID,
          item.typeID,
          destinationFlagID,
          occupiedTubeItems,
        )
      ) {
        return {
          success: false,
          errorMsg: "NotEnoughCargoSpace",
        };
      }

      return { success: true };
    }

    if (destinationFlagID === ITEM_FLAGS.MOBILE_DEPOT_HOLD) {
      const holdCapacity = Number(
        getShipBaseAttributeValue(
          shipRecord.typeID,
          MOBILE_DEPOT_HOLD_CAPACITY_ATTRIBUTE,
        ),
      ) || 0;
      return holdCapacity > 0 && isMobileDepotItemRecord(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (isGenericSpecialShipHoldFlag(destinationFlagID)) {
      const holdCapacity = getSpecialShipHoldCapacity(
        null,
        shipRecord.typeID,
        destinationFlagID,
        getShipBaseAttributeValue,
      );
      return holdCapacity > 0 &&
        isSpecialShipHoldItemAllowed(item, destinationFlagID) === true
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    if (!MINING_SHIP_BAY_FLAGS.includes(destinationFlagID)) {
      return { success: true };
    }

    return isItemTypeAllowedInHoldFlag(item, destinationFlagID)
      ? { success: true }
      : {
          success: false,
          errorMsg: "NotEnoughCargoSpace",
        };
  }

  _validateStructureOwnerBayMove(item, destination) {
    const structure = this._getStructureForOwnerBayDestination(destination);
    if (!structure) {
      return { success: true };
    }

    if (isStructureFuelBayFlag(destination.flagID)) {
      return isStructureFuelBayCompatibleItem(item, structure.typeID)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughCargoSpace",
          };
    }

    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    if (destinationFlagID === ITEM_FLAGS.FIGHTER_BAY) {
      return isFighterItemRecord(item)
        ? { success: true }
        : {
            success: false,
            errorMsg: "NotEnoughFighterBaySpace",
          };
    }

    if (isFighterTubeFlag(destinationFlagID)) {
      if (!isFighterItemRecord(item)) {
        return {
          success: false,
          errorMsg: "NotEnoughFighterBaySpace",
        };
      }

      const structureOwnerID = this._getStructureInventoryOwnerID(structure);
      const destinationOccupants = listContainerItems(
        structureOwnerID,
        structure.structureID,
        destinationFlagID,
      ).filter(
        (existingItem) =>
          Number(existingItem && existingItem.itemID) !== Number(item.itemID),
      );
      if (destinationOccupants.length > 0) {
        return {
          success: false,
          errorMsg: "NotEnoughFighterBaySpace",
        };
      }

      const occupiedTubeItems = this._listFighterTubeItems(
        structureOwnerID,
        structure.structureID,
        item.itemID,
      );
      if (
        !canLoadFighterTypeIntoHostTube(
          structure.typeID,
          item.typeID,
          destinationFlagID,
          occupiedTubeItems,
        )
      ) {
        return {
          success: false,
          errorMsg: "NotEnoughFighterBaySpace",
        };
      }
    }

    return { success: true };
  }

  _validateStructureServiceModuleRemovalAccess(session, item, destination) {
    const sourceFlagID = this._normalizeInventoryId(item && item.flagID, 0);
    const sourceLocationID = this._normalizeInventoryId(item && item.locationID, 0);
    if (!isStructureServiceSlotFlag(sourceFlagID) || sourceLocationID <= 0) {
      return { success: true };
    }

    const destinationFlagID = this._normalizeInventoryId(
      destination && destination.flagID,
      0,
    );
    const destinationLocationID = this._normalizeInventoryId(
      destination && destination.locationID,
      0,
    );
    if (
      isStructureServiceSlotFlag(destinationFlagID) &&
      destinationLocationID === sourceLocationID
    ) {
      return { success: true };
    }

    const structure = this._getStructureForInventoryID(sourceLocationID);
    if (
      structure &&
      !characterCanDisableStructureServiceModule(session, item, structure)
    ) {
      return {
        success: false,
        errorMsg: "CRP_ACCESS_DENIED",
        structureID: sourceLocationID,
      };
    }

    return { success: true };
  }

  _isHighSecurityStructureSystem(structure) {
    const system = worldData.getSolarSystemByID(structure && structure.solarSystemID);
    const security = Number(system && system.security);
    return Number.isFinite(security) && security >= 0.45;
  }

  _getStructureSystemSecurityClass(structure) {
    const system = worldData.getSolarSystemByID(structure && structure.solarSystemID);
    const security = Number(system && system.security);
    if (!Number.isFinite(security)) {
      return SECURITY_CLASS_ZERO_SEC;
    }
    if (security <= 0) {
      return SECURITY_CLASS_ZERO_SEC;
    }
    if (security < 0.45) {
      return SECURITY_CLASS_LOW_SEC;
    }
    return SECURITY_CLASS_HIGH_SEC;
  }

  _validateStructureServiceModuleSecurityClass(item, destination) {
    if (
      !item ||
      !destination ||
      !isStructureServiceSlotFlag(destination.flagID)
    ) {
      return { success: true };
    }

    const structure = this._getStructureForInventoryID(destination.locationID);
    if (!structure) {
      return { success: true };
    }

    const securityClass = this._getStructureSystemSecurityClass(structure);
    const disallowedInEmpire =
      Number(getTypeAttributeValue(item.typeID, ATTRIBUTE_DISALLOW_IN_EMPIRE_SPACE)) > 0;
    if (securityClass >= SECURITY_CLASS_LOW_SEC && disallowedInEmpire) {
      return {
        success: false,
        errorMsg: "MODULE_DISALLOWED_IN_EMPIRE",
      };
    }

    const disallowedInHighSec =
      Number(getTypeAttributeValue(item.typeID, ATTRIBUTE_DISALLOW_IN_HIGH_SEC)) > 0;
    if (securityClass >= SECURITY_CLASS_HIGH_SEC && disallowedInHighSec) {
      return {
        success: false,
        errorMsg: "MODULE_DISALLOWED_IN_HIGHSEC",
      };
    }

    return { success: true };
  }

  _validateStructureReactionServiceModuleFit(item, destination) {
    if (
      !item ||
      !destination ||
      !isStructureServiceSlotFlag(destination.flagID) ||
      !isStructureReactionServiceModuleType(item.typeID)
    ) {
      return { success: true };
    }

    const structure = this._getStructureForInventoryID(destination.locationID);
    if (!structure) {
      return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
    }

    if (structure.structureFamily !== STRUCTURE_FAMILY.REFINERY) {
      return {
        success: false,
        errorMsg: "REACTION_MODULE_REQUIRES_REFINERY",
      };
    }

    if (this._isHighSecurityStructureSystem(structure)) {
      return {
        success: false,
        errorMsg: "REACTION_MODULE_BANNED_IN_HIGHSEC",
      };
    }

    return { success: true };
  }

  _validateStructureMoonDrillServiceModuleFit(item, destination) {
    if (
      !item ||
      !destination ||
      !isStructureServiceSlotFlag(destination.flagID) ||
      Number(item.typeID) !== TYPE_STANDUP_MOON_DRILL
    ) {
      return { success: true };
    }

    const structure = this._getStructureForInventoryID(destination.locationID);
    if (!structure) {
      return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
    }

    if (structure.structureFamily !== STRUCTURE_FAMILY.REFINERY) {
      return {
        success: false,
        errorMsg: "MOON_DRILL_REQUIRES_REFINERY",
      };
    }

    const devFlags =
      structure.devFlags && typeof structure.devFlags === "object"
        ? structure.devFlags
        : {};
    const verifiedBeaconID = Number(devFlags.moonMiningBeaconID || 0);
    if (
      devFlags.moonMiningLocationVerified !== true ||
      !Number.isFinite(verifiedBeaconID) ||
      verifiedBeaconID <= 0
    ) {
      return {
        success: false,
        errorMsg: "MOON_DRILL_REQUIRES_MOON_MINING_LOCATION",
      };
    }

    return { success: true };
  }

  _validateIntegratedStructureServiceModuleFit(item, destination) {
    if (
      !item ||
      !destination ||
      !isStructureServiceSlotFlag(destination.flagID) ||
      !INTEGRATED_STRUCTURE_SERVICE_MODULE_TYPE_IDS.has(Number(item.typeID))
    ) {
      return { success: true };
    }

    return {
      success: false,
      errorMsg: "STRUCTURE_SERVICE_MODULE_IS_INTEGRATED",
    };
  }

  _throwFittingMoveUserError(fitValidation, shipRecord = null, item = null) {
    const errorMsg = String((fitValidation && fitValidation.errorMsg) || "");
    const data =
      fitValidation && fitValidation.data && typeof fitValidation.data === "object"
        ? fitValidation.data
        : {};
    if (errorMsg === "REACTION_MODULE_BANNED_IN_HIGHSEC") {
      throwWrappedUserError("CantInHighSecSpace");
    }
    if (errorMsg === "MODULE_DISALLOWED_IN_EMPIRE") {
      throwWrappedUserError("CantInEmpireSpace");
    }
    if (errorMsg === "MODULE_DISALLOWED_IN_HIGHSEC") {
      throwWrappedUserError("CantInHighSecSpace");
    }
    if (errorMsg === "REACTION_MODULE_REQUIRES_REFINERY") {
      throwWrappedUserError("ModuleFitFailed", {
        moduleName: [
          USER_ERROR_FORMAT_GROUP_ID,
          Number(item && item.groupID) || 0,
        ],
        reason: "",
      });
    }
    if (
      errorMsg === "MOON_DRILL_REQUIRES_REFINERY" ||
      errorMsg === "MOON_DRILL_REQUIRES_MOON_MINING_LOCATION" ||
      errorMsg === "STRUCTURE_SERVICE_MODULE_IS_INTEGRATED" ||
      errorMsg === "INVALID_SHIP_TYPE" ||
      errorMsg === "INVALID_SHIP_GROUP" ||
      errorMsg === "RIG_SIZE_MISMATCH" ||
      errorMsg === "INSUFFICIENT_CALIBRATION"
    ) {
      throwWrappedUserError("ModuleFitFailed", {
        moduleName: [
          USER_ERROR_FORMAT_GROUP_ID,
          Number(item && item.groupID) || 0,
        ],
        reason: "",
      });
    }
    if (errorMsg === "MAX_GROUP_FITTED") {
      const typeRecord = resolveItemByTypeID(item && item.typeID);
      throwWrappedUserError("CantFitTooManyByGroup", {
        ship: Number(data.shipTypeID ?? (shipRecord && shipRecord.typeID)) || 0,
        module: Number(data.moduleTypeID ?? (item && item.typeID)) || 0,
        groupName:
          data.groupName ||
          (item && item.groupName) ||
          (typeRecord && typeRecord.groupName) ||
          "",
        noOfModules: Number(data.noOfModules ?? data.maxGroupFitted) || 0,
        noOfModulesFitted:
          Number(data.noOfModulesFitted ?? data.existingGroupCount) || 0,
      });
    }
    if (errorMsg === "MAX_TYPE_FITTED") {
      throwWrappedUserError("CantFitTooManyByType", {
        ship: Number(data.shipTypeID ?? (shipRecord && shipRecord.typeID)) || 0,
        module: Number(data.moduleTypeID ?? (item && item.typeID)) || 0,
        noOfModules: Number(data.noOfModules ?? data.maxTypeFitted) || 0,
        noOfModulesFitted:
          Number(data.noOfModulesFitted ?? data.existingTypeCount) || 0,
      });
    }
    return false;
  }

  _resolveMovedItemID(moveResult, originalItemID, destination) {
    const destinationLocationID = this._normalizeInventoryId(
      destination && destination.locationID,
      0,
    );
    const destinationFlagID = this._normalizeInventoryId(
      destination && destination.flagID,
      0,
    );

    for (const change of (moveResult && moveResult.data && moveResult.data.changes) || []) {
      if (
        !change ||
        !change.item ||
        Number(change.item.itemID) === Number(originalItemID)
      ) {
        continue;
      }

      if (
        this._normalizeInventoryId(change.item.locationID, 0) === destinationLocationID &&
        this._normalizeInventoryId(change.item.flagID, 0) === destinationFlagID
      ) {
        return Number(change.item.itemID) || null;
      }
    }

    const originalMovedItem = findItemById(
      this._normalizeInventoryId(originalItemID, 0),
    );
    if (
      originalMovedItem &&
      this._normalizeInventoryId(originalMovedItem.locationID, 0) === destinationLocationID &&
      this._normalizeInventoryId(originalMovedItem.flagID, 0) === destinationFlagID
    ) {
      return this._normalizeInventoryId(originalMovedItem.itemID, null);
    }

    return null;
  }

  _getNativeWreckRecord(inventoryID) {
    const numericInventoryID = this._normalizeInventoryId(inventoryID, 0);
    if (numericInventoryID <= 0) {
      return null;
    }

    return nativeNpcStore.getNativeWreck(numericInventoryID) || null;
  }

  _buildNativeWreckItemOverrides(_session, inventoryID) {
    return nativeNpcStore.buildNativeWreckInventoryItem(
      this._normalizeInventoryId(inventoryID, 0),
    );
  }

  _findTransferSourceItem(itemID, sourceLocationID = 0) {
    const numericItemID = this._normalizeInventoryId(itemID, 0);
    if (numericItemID <= 0) {
      return null;
    }

    const inventoryItem = findItemById(numericItemID);
    if (inventoryItem) {
      return {
        sourceKind: "inventory",
        item: inventoryItem,
      };
    }

    const wreckItem = nativeNpcStore.getNativeWreckItem(numericItemID);
    if (!wreckItem) {
      return null;
    }

    const normalizedSourceLocationID = this._normalizeInventoryId(sourceLocationID, 0);
    if (
      normalizedSourceLocationID > 0 &&
      this._normalizeInventoryId(wreckItem.wreckID, 0) !== normalizedSourceLocationID
    ) {
      return null;
    }

    const wreckItemOverrides = nativeNpcStore.buildNativeWreckContents(wreckItem.wreckID)
      .find((entry) => this._normalizeInventoryId(entry && entry.itemID, 0) === numericItemID) || null;
    return {
      sourceKind: "nativeWreck",
      item: wreckItemOverrides,
      wreckItem,
    };
  }

  _isTransferSourceLocationMatch(sourceItemDescriptor, sourceLocationID = 0) {
    const requestedSourceLocationID = this._normalizeInventoryId(sourceLocationID, 0);
    if (requestedSourceLocationID <= 0) {
      return true;
    }

    if (!sourceItemDescriptor) {
      return false;
    }

    if (sourceItemDescriptor.sourceKind !== "inventory") {
      return true;
    }

    const item = sourceItemDescriptor.item;
    const directLocationID = this._normalizeInventoryId(item && item.locationID, 0);
    if (directLocationID === requestedSourceLocationID) {
      return true;
    }

    return this._resolveInventoryRootLocationID(item) === requestedSourceLocationID;
  }

  _resolveInventoryRootLocationID(itemOrItemID) {
    let currentItem =
      itemOrItemID && typeof itemOrItemID === "object"
        ? itemOrItemID
        : findItemById(this._normalizeInventoryId(itemOrItemID, 0));
    const seen = new Set();

    while (currentItem) {
      const currentItemID = this._normalizeInventoryId(currentItem.itemID, 0);
      const locationID = this._normalizeInventoryId(currentItem.locationID, 0);
      if (locationID <= 0) {
        return 0;
      }

      if (seen.has(currentItemID)) {
        return locationID;
      }
      seen.add(currentItemID);

      const parentItem = findItemById(locationID);
      if (!parentItem) {
        return locationID;
      }
      currentItem = parentItem;
    }

    return 0;
  }

  _canTakeFromCorporationHangarSource(session, sourceItemDescriptor) {
    const item = sourceItemDescriptor && sourceItemDescriptor.item
      ? sourceItemDescriptor.item
      : null;
    if (!item || sourceItemDescriptor.sourceKind !== "inventory") {
      return true;
    }

    const corporationID = this._normalizeInventoryId(this._getCorporationId(session), 0);
    if (
      corporationID <= 0 ||
      this._normalizeInventoryId(item.ownerID, 0) !== corporationID ||
      !this._isCorporationHangarFlag(item.flagID)
    ) {
      return true;
    }

    const office = this._getCorporationOfficeForItemLocation(
      session,
      item.locationID,
    );
    if (!office) {
      return false;
    }

    return canTakeFromOwnerLocation(
      session,
      corporationID,
      this._normalizeInventoryId(office.stationID, office.officeID),
      item.flagID,
    );
  }

  _isInventoryItemTrashable(session, item, requestedLocationID = 0) {
    if (!item || typeof item !== "object") {
      return false;
    }

    const characterID = this._getCharacterId(session);
    const itemID = this._normalizeInventoryId(item.itemID, 0);
    const ownerID = this._normalizeInventoryId(item.ownerID, 0);
    const activeShipID = this._getShipId(session);
    if (itemID <= 0 || ownerID !== characterID) {
      return false;
    }

    if (itemID === activeShipID) {
      return false;
    }

    if (isShipFittingFlag(item.flagID)) {
      return false;
    }

    const normalizedRequestedLocationID = this._normalizeInventoryId(
      requestedLocationID,
      0,
    );
    if (normalizedRequestedLocationID <= 0) {
      return true;
    }

    return (
      this._resolveInventoryRootLocationID(item) === normalizedRequestedLocationID
    );
  }

  _filterTopLevelTrashItemIDs(itemIDs = []) {
    const normalizedItemIDs = this._normalizeItemIdList(itemIDs);
    const selected = new Set(normalizedItemIDs);
    const topLevelIDs = [];

    for (const itemID of normalizedItemIDs) {
      let currentItem = findItemById(itemID);
      let coveredByAncestor = false;
      const seen = new Set([itemID]);

      while (currentItem) {
        const parentID = this._normalizeInventoryId(currentItem.locationID, 0);
        if (parentID <= 0) {
          break;
        }
        if (selected.has(parentID)) {
          coveredByAncestor = true;
          break;
        }
        if (seen.has(parentID)) {
          break;
        }
        seen.add(parentID);
        currentItem = findItemById(parentID);
      }

      if (!coveredByAncestor) {
        topLevelIDs.push(itemID);
      }
    }

    return topLevelIDs;
  }

  _moveSourceItemToDestination(session, sourceItemDescriptor, destination, quantity = null) {
    if (!sourceItemDescriptor || !sourceItemDescriptor.item || !destination) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }

    const sourceItem = sourceItemDescriptor.item;
    const groupingContext = {
      shipID: this._normalizeInventoryId(sourceItem.locationID, 0),
      moduleID: this._normalizeInventoryId(sourceItem.itemID, 0),
      wasGrouped:
        Number(sourceItem.categoryID) === 7 &&
        isShipFittingFlag(sourceItem.flagID) &&
        getWeaponBankMasterModuleID(
          this._normalizeInventoryId(sourceItem.locationID, 0),
          this._normalizeInventoryId(sourceItem.itemID, 0),
        ) > 0,
    };

    if (sourceItemDescriptor.sourceKind === "nativeWreck") {
      return nativeNpcWreckService.transferNativeWreckItemToCharacterLocation({
        characterID: this._getCharacterId(session),
        wreckID: this._normalizeInventoryId(
          sourceItemDescriptor.wreckItem && sourceItemDescriptor.wreckItem.wreckID,
          0,
        ),
        wreckItemID: this._normalizeInventoryId(
          sourceItemDescriptor.wreckItem && sourceItemDescriptor.wreckItem.wreckItemID,
          0,
        ),
        destinationLocationID: this._normalizeInventoryId(destination.locationID, 0),
        destinationFlagID: this._normalizeInventoryId(destination.flagID, ITEM_FLAGS.HANGAR),
        quantity,
      });
    }

    const destinationOffice = this._getCorporationOffice(
      session,
      destination.locationID,
    );
    if (
      destinationOffice &&
      this._isCorporationHangarFlag(destination.flagID)
    ) {
      const transferResult = transferItemToOwnerLocation(
        this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
        this._getCorporationId(session),
        this._normalizeInventoryId(destinationOffice.officeID, 0),
        destination.flagID,
        quantity,
      );
      return this._applyModuleGroupingMoveCleanup(
        session,
        sourceItemDescriptor,
        destination,
        transferResult,
        groupingContext,
      );
    }

    const structureDestination = this._getStructureForOwnerBayDestination(destination);
    const structureOwnerID = this._getStructureInventoryOwnerID(structureDestination);
    if (structureDestination && structureOwnerID > 0) {
      const transferResult = transferItemToOwnerLocation(
        this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
        structureOwnerID,
        this._normalizeInventoryId(structureDestination.structureID, 0),
        destination.flagID,
        quantity,
      );
      return this._applyModuleGroupingMoveCleanup(
        session,
        sourceItemDescriptor,
        destination,
        transferResult,
        groupingContext,
      );
    }

    if (
      this._shouldTransferInventoryItemToCharacterShipDestination(
        session,
        sourceItemDescriptor,
        destination,
      )
    ) {
      const transferResult = transferItemToOwnerLocation(
        this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
        this._getCharacterId(session),
        this._normalizeInventoryId(destination.locationID, 0),
        destination.flagID,
        quantity,
      );
      return this._applyModuleGroupingMoveCleanup(
        session,
        sourceItemDescriptor,
        destination,
        transferResult,
        groupingContext,
      );
    }

    if (
      this._shouldTransferInventoryItemToCharacterHangarDestination(
        session,
        sourceItemDescriptor,
        destination,
      )
    ) {
      const transferResult = transferItemToOwnerLocation(
        this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
        this._getCharacterId(session),
        this._normalizeInventoryId(destination.locationID, 0),
        destination.flagID,
        quantity,
      );
      return this._applyModuleGroupingMoveCleanup(
        session,
        sourceItemDescriptor,
        destination,
        transferResult,
        groupingContext,
      );
    }

    const moveResult = moveItemToLocation(
      this._normalizeInventoryId(sourceItemDescriptor.item.itemID, 0),
      destination.locationID,
      destination.flagID,
      quantity,
    );
    this._moveAttachedLoadedChargeWithModule(
      session,
      sourceItemDescriptor.item,
      destination,
      moveResult,
    );
    return this._applyModuleGroupingMoveCleanup(
      session,
      sourceItemDescriptor,
      destination,
      moveResult,
      groupingContext,
    );
  }

  _shouldTransferInventoryItemToCharacterHangarDestination(session, sourceItemDescriptor, destination) {
    const sourceItem = sourceItemDescriptor && sourceItemDescriptor.item
      ? sourceItemDescriptor.item
      : null;
    if (
      !sourceItem ||
      !destination ||
      sourceItemDescriptor.sourceKind !== "inventory"
    ) {
      return false;
    }

    const characterID = this._getCharacterId(session);
    const destinationLocationID = this._normalizeInventoryId(destination.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    if (
      characterID <= 0 ||
      destinationLocationID <= 0 ||
      destinationFlagID !== ITEM_FLAGS.HANGAR ||
      this._normalizeInventoryId(sourceItem.ownerID, 0) === characterID ||
      !this._isCorporationHangarFlag(sourceItem.flagID) ||
      !this._getCorporationOfficeForItemLocation(session, sourceItem.locationID)
    ) {
      return false;
    }

    if (destinationLocationID === this._getStationId(session)) {
      return true;
    }

    return Boolean(this._getStructureForInventoryID(destinationLocationID));
  }

  _shouldTransferInventoryItemToCharacterShipDestination(session, sourceItemDescriptor, destination) {
    const sourceItem = sourceItemDescriptor && sourceItemDescriptor.item
      ? sourceItemDescriptor.item
      : null;
    if (
      !sourceItem ||
      !destination ||
      sourceItemDescriptor.sourceKind !== "inventory"
    ) {
      return false;
    }

    const characterID = this._getCharacterId(session);
    const destinationLocationID = this._normalizeInventoryId(destination.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    if (
      characterID <= 0 ||
      destinationLocationID <= 0 ||
      this._normalizeInventoryId(sourceItem.ownerID, 0) === characterID ||
      (!SHIP_BAY_FLAGS.has(destinationFlagID) && !isShipFittingFlag(destinationFlagID))
    ) {
      return false;
    }

    const destinationShip = findShipItemById(destinationLocationID);
    return (
      destinationShip &&
      this._normalizeInventoryId(destinationShip.ownerID, 0) === characterID
    );
  }

  _moveAttachedLoadedChargeWithModule(session, sourceItem, destination, moveResult) {
    if (
      !moveResult ||
      !moveResult.success ||
      !sourceItem ||
      !destination ||
      Number(sourceItem.categoryID) !== 7
    ) {
      return;
    }

    const sourceShipID = this._normalizeInventoryId(sourceItem.locationID, 0);
    const sourceFlagID = this._normalizeInventoryId(sourceItem.flagID, 0);
    if (sourceShipID <= 0 || !isShipFittingFlag(sourceFlagID)) {
      return;
    }

    const destinationLocationID = this._normalizeInventoryId(destination.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    if (destinationLocationID === sourceShipID && destinationFlagID === sourceFlagID) {
      return;
    }

    const loadedCharge = getLoadedChargeByFlag(
      this._getCharacterId(session),
      sourceShipID,
      sourceFlagID,
    );
    if (!loadedCharge) {
      return;
    }

    const chargeMoveResult = moveItemToLocation(
      this._normalizeInventoryId(loadedCharge.itemID, 0),
      destinationLocationID,
      destinationFlagID,
      null,
    );
    if (!chargeMoveResult || !chargeMoveResult.success) {
      log.warn(
        `[InvBroker] Failed to move attached charge itemID=${loadedCharge.itemID} ` +
        `moduleID=${sourceItem.itemID} destination=${destinationLocationID}:${destinationFlagID} ` +
        `error=${chargeMoveResult && chargeMoveResult.errorMsg || "UNKNOWN"}`,
      );
      return;
    }

    if (!moveResult.data) {
      moveResult.data = {};
    }
    if (!Array.isArray(moveResult.data.changes)) {
      moveResult.data.changes = [];
    }
    moveResult.data.changes.push(
      ...((chargeMoveResult.data && chargeMoveResult.data.changes) || []),
    );
  }

  _applyModuleGroupingMoveCleanup(
    session,
    sourceItemDescriptor,
    destination,
    moveResult,
    groupingContext = null,
  ) {
    if (
      !moveResult ||
      !moveResult.success ||
      !sourceItemDescriptor ||
      !sourceItemDescriptor.item
    ) {
      return moveResult;
    }

    const sourceItem = sourceItemDescriptor.item;
    const sourceShipID = this._normalizeInventoryId(sourceItem.locationID, 0);
    const sourceFlagID = this._normalizeInventoryId(sourceItem.flagID, 0);
    const destinationLocationID = this._normalizeInventoryId(destination.locationID, 0);
    const destinationFlagID = this._normalizeInventoryId(destination.flagID, 0);
    const movedOutOfShipFitting =
      Number(sourceItem.categoryID) === 7 &&
      isShipFittingFlag(sourceFlagID) &&
      (
        destinationLocationID !== sourceShipID ||
        !isShipFittingFlag(destinationFlagID)
      );
    if (!movedOutOfShipFitting) {
      return moveResult;
    }

    clearModuleFromBanksAndNotify(
      session,
      sourceShipID,
      [sourceItem.itemID],
      {
        characterID: this._getCharacterId(session),
      },
    );
    if (groupingContext && groupingContext.wasGrouped) {
      notifyWeaponBanksChanged(
        session,
        groupingContext.shipID,
        getShipWeaponBanks(groupingContext.shipID, {
          characterID: this._getCharacterId(session),
        }),
      );
    }
    return moveResult;
  }

  _buildCharacterItemOverrides(session) {
    const charId = this._getCharacterId(session);
    return {
      itemID: charId,
      typeID: CHARACTER_TYPE_ID,
      ownerID: charId,
      locationID: this._getShipId(session) || this._getStationId(session),
      flagID: 0,
      quantity: -1,
      groupID: CHARACTER_GROUP_ID,
      categoryID: CHARACTER_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _findCharacterSkillRecord(session, itemID) {
    const charId = this._getCharacterId(session);
    const numericItemId = this._normalizeInventoryId(itemID, 0);
    if (numericItemId <= 0) {
      return null;
    }

    return (
      getCharacterSkills(charId).find((skill) => skill.itemID === numericItemId) ||
      null
    );
  }

  _buildSkillItemOverrides(skillRecord) {
    if (!skillRecord) {
      return null;
    }

    return {
      itemID: skillRecord.itemID,
      typeID: skillRecord.typeID,
      ownerID: skillRecord.ownerID,
      locationID: skillRecord.locationID,
      flagID: skillRecord.flagID ?? SKILL_FLAG_ID,
      quantity: -1,
      groupID: skillRecord.groupID,
      categoryID: skillRecord.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildInventoryItemOverrides(session, itemRecord) {
    if (!itemRecord || typeof itemRecord !== "object") {
      return null;
    }

    if (Number(itemRecord.categoryID) === 16) {
      return this._buildSkillItemOverrides(itemRecord);
    }

    const rawItemID = itemRecord.itemID ?? itemRecord.shipID;
    const itemID = this._isChargeTupleItemID(rawItemID)
      ? rawItemID.map((entry) => this._normalizeInventoryId(entry, 0))
      : this._normalizeInventoryId(rawItemID, 0);
    const typeID = this._normalizeInventoryId(
      itemRecord.typeID ?? itemRecord.shipTypeID,
      0,
    );
    if (
      (
        Array.isArray(itemID)
          ? !this._isChargeTupleItemID(itemID)
          : itemID <= 0
      ) ||
      typeID <= 0
    ) {
      return null;
    }

    const singleton =
      itemRecord.singleton === null || itemRecord.singleton === undefined
        ? Number(itemRecord.categoryID) === 6
          ? 1
          : 0
        : itemRecord.singleton;
    const quantity =
      itemRecord.quantity === null || itemRecord.quantity === undefined
        ? Number(singleton) === 1
            ? -1
            : 1
        : itemRecord.quantity;
    const stacksize =
      itemRecord.stacksize === null || itemRecord.stacksize === undefined
        ? Number(singleton) === 1
          ? 1
          : quantity
        : itemRecord.stacksize;

    return {
      itemID,
      typeID,
      shipName: itemRecord.shipName || itemRecord.itemName || null,
      ownerID: this._normalizeInventoryId(
        itemRecord.ownerID,
        this._getCharacterId(session),
      ),
      locationID: this._normalizeInventoryId(
        itemRecord.locationID,
        this._getStationId(session),
      ),
      flagID: this._normalizeInventoryId(itemRecord.flagID, 0),
      quantity,
      groupID: this._normalizeInventoryId(itemRecord.groupID, 0),
      categoryID: this._normalizeInventoryId(itemRecord.categoryID, 0),
      customInfo: itemRecord.customInfo || "",
      singleton,
      stacksize,
    };
  }

  _buildStationItemOverrides(session, overrideStationID = null) {
    const station = getStationRecord(session, overrideStationID);
    const stationID = this._normalizeInventoryId(station.stationID, this._getStationId(session));
    return {
      itemID: stationID,
      typeID: this._normalizeInventoryId(station.stationTypeID, STATION_TYPE_ID),
      ownerID: this._normalizeInventoryId(
        station.ownerID || station.corporationID,
        STATION_OWNER_ID,
      ),
      locationID: stationID,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildStructureItemOverrides(session, overrideStructureID = null) {
    const structureID = this._normalizeInventoryId(
      overrideStructureID ?? this._getStationId(session),
      0,
    );
    if (structureID <= 0) {
      return null;
    }

    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (!structure) {
      return null;
    }

    const structureTypeID = this._normalizeInventoryId(structure.typeID, 0);
    const structureType = resolveItemByTypeID(structureTypeID) || {};
    return {
      itemID: this._normalizeInventoryId(structure.structureID, structureID),
      typeID: structureTypeID,
      ownerID: this._normalizeInventoryId(
        structure.ownerCorpID || structure.ownerID,
        this._getCharacterId(session),
      ),
      // Upwell hangar/bootstrap paths expect the structure inventory item to
      // represent the docked structure itself, not a station-style shim row.
      locationID: this._normalizeInventoryId(
        structure.structureID,
        structureID,
      ),
      flagID: 0,
      quantity: -1,
      groupID: this._normalizeInventoryId(structureType.groupID, 0),
      categoryID: this._normalizeInventoryId(structureType.categoryID, 0),
      customInfo: String(structure.itemName || structure.name || ""),
      singleton: 1,
      stacksize: 1,
    };
  }

  _getCharacterContainerItems(session, requestedFlag = null) {
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);

    return getCharacterSkills(this._getCharacterId(session)).filter((skill) => {
      if (numericFlag === null || numericFlag === 0) {
        return true;
      }

      return this._normalizeInventoryId(skill.flagID, 0) === numericFlag;
    });
  }

  _listCorporationOfficeItems(session, office, requestedFlag = null) {
    if (!office) {
      return [];
    }

    const corporationID = this._getCorporationId(session);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const locationIDs = new Set(
      [
        this._normalizeInventoryId(office.officeID, 0),
        this._normalizeInventoryId(office.officeFolderID, 0),
        this._normalizeInventoryId(office.itemID, 0),
      ].filter((locationID) => locationID > 0),
    );
    const seenItemIDs = new Set();
    const items = [];

    for (const locationID of locationIDs) {
      for (const item of listContainerItems(corporationID, locationID, numericFlag)) {
        const itemID = this._normalizeInventoryId(item && item.itemID, 0);
        if (itemID <= 0 || seenItemIDs.has(itemID)) {
          continue;
        }
        seenItemIDs.add(itemID);
        items.push(item);
      }
    }

    return items.sort(
      (left, right) =>
        this._normalizeInventoryId(left && left.flagID, 0) -
          this._normalizeInventoryId(right && right.flagID, 0) ||
        this._normalizeInventoryId(left && left.typeID, 0) -
          this._normalizeInventoryId(right && right.typeID, 0) ||
        this._normalizeInventoryId(left && left.itemID, 0) -
          this._normalizeInventoryId(right && right.itemID, 0),
    );
  }

  _buildCorporationOfficeItemOverrides(session, office) {
    if (!office) {
      return null;
    }

    const stationItem = this._buildStationItemOverrides(
      session,
      this._normalizeInventoryId(office.stationID, this._getStationId(session)),
    );
    return {
      itemID: this._normalizeInventoryId(office.officeID, 0),
      typeID: stationItem.typeID,
      ownerID: this._getCorporationId(session),
      locationID: this._normalizeInventoryId(
        office.stationID,
        this._getStationId(session),
      ),
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildContainerItemOverrides(session, inventoryID) {
    const numericInventoryID = this._normalizeInventoryId(inventoryID);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const shipRecord =
      findCharacterShip(charId, numericInventoryID) ||
      findShipItemById(numericInventoryID);
    const genericItemRecord =
      shipRecord || findItemById(numericInventoryID);

    if (genericItemRecord) {
      return this._buildInventoryItemOverrides(session, genericItemRecord);
    }

    const corporationOffice = this._getCorporationOffice(
      session,
      numericInventoryID,
    );
    if (corporationOffice) {
      return this._buildCorporationOfficeItemOverrides(session, corporationOffice);
    }

    const nativeWreckRecord = this._getNativeWreckRecord(numericInventoryID);
    if (nativeWreckRecord) {
      return this._buildNativeWreckItemOverrides(session, numericInventoryID);
    }

    if (numericInventoryID === charId) {
      return this._buildCharacterItemOverrides(session);
    }

    if (numericInventoryID === stationId || numericInventoryID === 0) {
      if (
        Number(session && (session.structureID || session.structureid)) > 0
      ) {
        return (
          this._buildStructureItemOverrides(session, stationId) ||
          this._buildStationItemOverrides(session, stationId)
        );
      }
      return this._buildStationItemOverrides(session, stationId);
    }

    const stationItem = this._buildStationItemOverrides(session, stationId);
    return {
      itemID: numericInventoryID,
      typeID: stationItem.typeID,
      ownerID: this._getCharacterId(session),
      locationID: stationId,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _resolveContainerItems(session, requestedFlag, boundContext) {
    const stationId = this._getStationId(session);
    const charId = this._getCharacterId(session);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const containerID = boundContext && Number(boundContext.inventoryID)
      ? Number(boundContext.inventoryID)
      : stationId;

    if (containerID === charId) {
      return this._getCharacterContainerItems(session, numericFlag);
    }

    if (
      boundContext &&
      (boundContext.kind === "corpDeliveries" || boundContext.kind === "capsuleerDeliveries")
    ) {
      const expectedFlag =
        boundContext.kind === "capsuleerDeliveries"
          ? ITEM_FLAGS.CAPSULEER_DELIVERIES
          : ITEM_FLAGS.CORP_DELIVERIES;
      const requestedDeliveryFlag = numericFlag === null || numericFlag === 0
        ? expectedFlag
        : numericFlag;
      if (requestedDeliveryFlag !== expectedFlag) {
        return [];
      }
      return listContainerItems(
        this._getCorporationId(session),
        this._normalizeInventoryId(boundContext.locationID, stationId),
        expectedFlag,
      );
    }

    const corporationOffice = this._getCorporationOffice(session, containerID);
    if (corporationOffice) {
      return this._listCorporationOfficeItems(
        session,
        corporationOffice,
        numericFlag,
      );
    }

    if (containerID === stationId) {
      const structureContainer = this._getStructureForInventoryID(containerID);
      const structureOwnerID = this._getStructureInventoryOwnerID(structureContainer);
      if (this._isMoonMaterialBayFlag(numericFlag)) {
        this._ensureCanAccessMoonMaterialBay(
          session,
          structureContainer,
          containerID,
        );
        return listContainerItems(null, containerID, numericFlag);
      }
      if (
        structureContainer &&
        structureOwnerID > 0 &&
        boundContext &&
        boundContext.kind === "controlledStructureInventory"
      ) {
        if (numericFlag === null || isShipFittingFlag(numericFlag)) {
          return listContainerItems(null, containerID, numericFlag);
        }
        if (this._isStructureOwnerBayFlag(numericFlag)) {
          return listContainerItems(structureOwnerID, containerID, numericFlag);
        }
        return listContainerItems(null, containerID, numericFlag);
      }
      if (
        structureContainer &&
        structureOwnerID > 0 &&
        this._isStructureOwnerBayFlag(numericFlag)
      ) {
        return listContainerItems(structureOwnerID, containerID, numericFlag);
      }

      return listContainerItems(
        charId,
        stationId,
        numericFlag === null || numericFlag === 0
          ? ITEM_FLAGS.HANGAR
          : numericFlag,
      );
    }

    const structureContainer = this._getStructureForInventoryID(containerID);
    const structureOwnerID = this._getStructureInventoryOwnerID(structureContainer);
    if (this._isMoonMaterialBayFlag(numericFlag)) {
      this._ensureCanAccessMoonMaterialBay(
        session,
        structureContainer,
        containerID,
      );
      return listContainerItems(null, containerID, numericFlag);
    }
    if (
      structureContainer &&
      structureOwnerID > 0 &&
      boundContext &&
      boundContext.kind === "controlledStructureInventory"
    ) {
      if (numericFlag === null || isShipFittingFlag(numericFlag)) {
        return listContainerItems(null, containerID, numericFlag);
      }
      if (this._isStructureOwnerBayFlag(numericFlag)) {
        return listContainerItems(structureOwnerID, containerID, numericFlag);
      }
      return listContainerItems(null, containerID, numericFlag);
    }
    if (
      structureContainer &&
      structureOwnerID > 0 &&
      this._isStructureOwnerBayFlag(numericFlag)
    ) {
      return listContainerItems(structureOwnerID, containerID, numericFlag);
    }

    const shipContainerRecord = findShipItemById(containerID);
    if (shipContainerRecord && isShipServiceFlag(numericFlag)) {
      const accessError = this._getShipServiceAccessError(
        session,
        containerID,
        numericFlag,
      );
      if (accessError) {
        log.debug(
          `[InvBroker] Ship service bay list denied ship=${containerID} flag=${numericFlag} error=${accessError}`,
        );
        return [];
      }

      const ownerFilter =
        this._normalizeInventoryId(shipContainerRecord.ownerID, 0) === charId
          ? charId
          : null;
      return listContainerItems(ownerFilter, containerID, numericFlag);
    }

    const genericContainerRecord = findItemById(containerID);
    if (genericContainerRecord && !findShipItemById(containerID)) {
      const mobileDepotAccessError = this._getMobileDepotCargoAccessError(
        session,
        containerID,
      );
      if (mobileDepotAccessError) {
        log.debug(
          `[InvBroker] Mobile Depot cargo list denied container=${containerID} error=${mobileDepotAccessError}`,
        );
        return [];
      }
      const genericContainerOwnerID = this._normalizeInventoryId(
        genericContainerRecord.ownerID,
        0,
      );
      const isDockedPersonalContainer =
        stationId > 0 &&
        this._normalizeInventoryId(genericContainerRecord.locationID, 0) === stationId &&
        this._normalizeInventoryId(genericContainerRecord.flagID, 0) === ITEM_FLAGS.HANGAR;
      if (isDockedPersonalContainer && genericContainerOwnerID !== charId) {
        return [];
      }
      return listContainerItems(
        genericContainerOwnerID === charId ? charId : null,
        containerID,
        numericFlag,
      );
    }

    const nativeWreckRecord = this._getNativeWreckRecord(containerID);
    if (nativeWreckRecord) {
      return nativeNpcStore.buildNativeWreckContents(containerID);
    }

    return listContainerItems(
      this._getCharacterId(session),
      containerID,
      numericFlag,
    );
  }

  _buildCapacityInfo(capacity, used) {
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["capacity", Number(capacity)],
          ["used", Number(used)],
        ],
      },
    };
  }

  _buildInventoryRowDescriptor(
    columns = INVENTORY_ROW_DESCRIPTOR_COLUMNS,
    virtualColumns = INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS,
  ) {
    return buildPackedRowDescriptor(columns, virtualColumns);
  }

  _calculateCapacity(session, boundContext, requestedFlag = null) {
    const items = this._resolveContainerItems(session, requestedFlag, boundContext);
    const used = items.reduce((sum, item) => {
      if (!item) {
        return sum;
      }
      const units =
        Number(item.singleton) === 1
          ? 1
          : Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
      const volume = Math.max(0, getInventoryItemUnitVolume(item));
      return sum + (volume * units);
    }, 0);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? Number(boundContext.flagID)
          : null
        : Number(requestedFlag);

    let capacity = 1000000.0;
    if (this._isMoonMaterialBayFlag(numericFlag)) {
      const structure = this._getStructureForInventoryID(
        boundContext && boundContext.inventoryID,
      );
      return this._buildCapacityInfo(
        this._getMoonMaterialBayCapacity(structure),
        used,
      );
    }
    const structureForFighterBayCapacity =
      Number(numericFlag) === ITEM_FLAGS.FIGHTER_BAY
        ? this._getStructureForInventoryID(boundContext && boundContext.inventoryID)
        : null;
    if (structureForFighterBayCapacity) {
      return this._buildCapacityInfo(
        this._getStructureFighterBayCapacity(structureForFighterBayCapacity),
        used,
      );
    }
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    if (shipRecord) {
      const requiresDerivedShipState =
        numericFlag === ITEM_FLAGS.CARGO_HOLD ||
        isFuelBayFlag(numericFlag) ||
        MINING_SHIP_BAY_FLAGS.includes(numericFlag) ||
        isSpecialShipHoldFlag(numericFlag);
      const fittingSnapshot = requiresDerivedShipState
        ? getShipFittingSnapshot(this._getCharacterId(session), shipRecord.itemID, {
            shipItem: shipRecord,
            reason: "invbroker.capacity",
          })
        : null;
      const resourceState = fittingSnapshot && fittingSnapshot.resourceState
        ? fittingSnapshot.resourceState
        : {};

      if (numericFlag === ITEM_FLAGS.CARGO_HOLD) {
        capacity = Number(resourceState.cargoCapacity) || 0;
      } else if (isFuelBayFlag(numericFlag)) {
        capacity = Number(getFuelBayCapacity(resourceState)) || 0;
      } else if (MINING_SHIP_BAY_FLAGS.includes(numericFlag)) {
        capacity = Number(getShipHoldCapacityByFlag(resourceState, numericFlag)) || 0;
      } else if (numericFlag === ITEM_FLAGS.DRONE_BAY) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "droneCapacity"),
        ) || 0;
      } else if (numericFlag === ITEM_FLAGS.FIGHTER_BAY) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "fighterCapacity"),
        ) || 0;
      } else if (numericFlag === ITEM_FLAGS.SHIP_HANGAR) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "shipMaintenanceBayCapacity"),
        ) || 0;
      } else if (numericFlag === ITEM_FLAGS.FLEET_HANGAR) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "fleetHangarCapacity"),
        ) || 0;
      } else if (numericFlag === ITEM_FLAGS.MOBILE_DEPOT_HOLD) {
        capacity = Number(
          getShipBaseAttributeValue(
            shipRecord.typeID,
            MOBILE_DEPOT_HOLD_CAPACITY_ATTRIBUTE,
          ),
        ) || 0;
      } else if (isGenericSpecialShipHoldFlag(numericFlag)) {
        capacity = Number(
          getSpecialShipHoldCapacity(
            resourceState,
            shipRecord.typeID,
            numericFlag,
            getShipBaseAttributeValue,
          ),
        ) || 0;
      }
    } else if (boundContext && boundContext.kind === "container") {
      const containerRecord = findItemById(
        this._normalizeInventoryId(boundContext.inventoryID, 0),
      );
      const nativeWreckRecord =
        containerRecord ? null : this._getNativeWreckRecord(boundContext.inventoryID);
      const containerMetadata = getItemMetadata(
        (containerRecord && containerRecord.typeID) ||
          (nativeWreckRecord && nativeWreckRecord.typeID),
        (containerRecord && containerRecord.itemName) ||
          (nativeWreckRecord && nativeWreckRecord.itemName),
      );
      capacity =
        Number(containerRecord && containerRecord.capacity) ||
        Number(nativeWreckRecord && nativeWreckRecord.capacity) ||
        Number(containerMetadata && containerMetadata.capacity) ||
        capacity;
    } else if (numericFlag === ITEM_FLAGS.CARGO_HOLD) {
      capacity = 5000.0;
    } else if (isFuelBayFlag(numericFlag)) {
      capacity = 0.0;
    } else if (MINING_SHIP_BAY_FLAGS.includes(numericFlag)) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.DRONE_BAY) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.FIGHTER_BAY) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.SHIP_HANGAR) {
      capacity = 1000000.0;
    } else if (numericFlag === ITEM_FLAGS.FLEET_HANGAR) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.MOBILE_DEPOT_HOLD) {
      capacity = 0.0;
    } else if (isGenericSpecialShipHoldFlag(numericFlag)) {
      capacity = 0.0;
    }

    return this._buildCapacityInfo(capacity, used);
  }

  _buildInvRow(session, overrides = {}) {
    const shipMetadata = this._getShipMetadata(
      session,
      overrides.typeID ?? null,
      overrides.shipName ?? null,
    );
    const itemID = overrides.itemID ?? this._getShipId(session);
    const typeID = overrides.typeID ?? shipMetadata.typeID;
    const ownerID = overrides.ownerID ?? this._getCharacterId(session);
    const locationID = overrides.locationID ?? this._getStationId(session);
    const flagID = overrides.flagID ?? 4; // station hangar
    const singleton = overrides.singleton ?? 1;
    const quantity = overrides.quantity ?? (singleton === 2 ? -2 : singleton === 1 ? -1 : 1);
    const stacksize =
      overrides.stacksize ?? (singleton > 0 ? 1 : quantity);
    const groupID = overrides.groupID ?? shipMetadata.groupID;
    const categoryID = overrides.categoryID ?? shipMetadata.categoryID;
    const customInfo = overrides.customInfo ?? "";

    // Keep DBRowDescriptor-compatible order first, then convenience attrs.
    return [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      stacksize,
      singleton,
    ];
  }

  _buildInvItem(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const header = [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ];

    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", header],
          ["line", row],
        ],
      },
    };
  }

  _itemOverridesFromId(session, itemID) {
    const id = Number.isInteger(itemID) ? itemID : Number(itemID);
    const charId = this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, id);
    if (skillRecord) {
      return this._buildSkillItemOverrides(skillRecord);
    }

    const shipRecord =
      findCharacterShip(charId, id) ||
      findShipItemById(id);
    if (shipRecord) {
      return {
        itemID: shipRecord.itemID,
        typeID: shipRecord.typeID,
        shipName: shipRecord.itemName,
        ownerID: shipRecord.ownerID,
        locationID: shipRecord.locationID,
        flagID: shipRecord.flagID,
        quantity: shipRecord.quantity,
        groupID: shipRecord.groupID,
        categoryID: shipRecord.categoryID,
        customInfo: shipRecord.customInfo || "",
        singleton: shipRecord.singleton,
        stacksize: shipRecord.stacksize,
      };
    }

    const genericItem = findItemById(id);
    if (genericItem) {
      return {
        itemID: genericItem.itemID,
        typeID: genericItem.typeID,
        ownerID: genericItem.ownerID,
        locationID: genericItem.locationID,
        flagID: genericItem.flagID,
        quantity: genericItem.quantity,
        groupID: genericItem.groupID,
        categoryID: genericItem.categoryID,
        customInfo: genericItem.customInfo || "",
        singleton: genericItem.singleton,
        stacksize: genericItem.stacksize,
      };
    }

    const shipID = this._getShipId(session);
    const shipMetadata = this._getShipMetadata(session);
    return {
      itemID: Number.isInteger(id) ? id : shipID,
      typeID: shipMetadata.typeID,
      ownerID: this._getCharacterId(session),
      locationID: this._getStationId(session),
      flagID: 4,
      quantity: -1,
      groupID: shipMetadata.groupID,
      categoryID: shipMetadata.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  Handle_GetInventory(args, session) {
    const containerID = args && args.length > 0 ? args[0] : null;
    const numericContainerID =
      containerID === null || containerID === undefined
        ? this._getStationId(session)
        : this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    if (
      numericContainerID === CONTAINER_CORP_MARKET_ID ||
      numericContainerID === CONTAINER_CAPSULEER_DELIVERIES_ID
    ) {
      const isCapsuleerDeliveries =
        numericContainerID === CONTAINER_CAPSULEER_DELIVERIES_ID;
      this._traceInventory("GetInventory", session, { args });
      log.debug("[InvBroker] GetInventory corp deliveries");
      return this._makeBoundSubstruct({
        inventoryID: stationId,
        locationID: stationId,
        flagID: isCapsuleerDeliveries
          ? ITEM_FLAGS.CAPSULEER_DELIVERIES
          : ITEM_FLAGS.CORP_DELIVERIES,
        kind: isCapsuleerDeliveries ? "capsuleerDeliveries" : "corpDeliveries",
        ownerID: this._getCorporationId(session),
      }, session);
    }
    const isStructureDocked =
      Number(session && (session.structureID || session.structureid)) > 0;
    const isStationHangar =
      numericContainerID === stationId ||
      numericContainerID === CONTAINER_HANGAR_ID ||
      (isStructureDocked &&
        (
          numericContainerID === CONTAINER_STRUCTURE_ID
        )) ||
      numericContainerID === ITEM_FLAGS.HANGAR;
    this._traceInventory("GetInventory", session, { args });
    log.debug("[InvBroker] GetInventory");
    return this._makeBoundSubstruct({
      inventoryID: isStationHangar ? stationId : numericContainerID,
      locationID: isStationHangar ? stationId : numericContainerID,
      flagID: isStationHangar ? ITEM_FLAGS.HANGAR : null,
      kind: isStationHangar ? "stationHangar" : "inventory",
    }, session);
  }

  _buildInventoryRowset(lines) {
    return {
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          ["header", INVENTORY_ROW_HEADER],
          ["RowClass", { type: "token", value: "util.Row" }],
          [
            "lines",
            {
              type: "list",
              items: lines,
            },
          ],
        ],
      },
    };
  }

  _buildInventoryRemoteList(itemOverrides = []) {
    return {
      type: "list",
      items: itemOverrides.map((overrides) =>
        this._buildInventoryPackedRow(overrides)),
    };
  }

  _buildInventoryPackedRow(overrides = {}) {
    const fields = {
      itemID: overrides.itemID,
      typeID: overrides.typeID,
      ownerID: overrides.ownerID,
      locationID: overrides.locationID,
      flagID: overrides.flagID,
      quantity: overrides.quantity,
      groupID: overrides.groupID,
      categoryID: overrides.categoryID,
      customInfo: overrides.customInfo || "",
      stacksize: overrides.stacksize,
      singleton: overrides.singleton,
    };
    if (this._isChargeTupleItemID(overrides.itemID)) {
      return buildPackedRow(
        CHARGE_SUBLOCATION_ROW_DESCRIPTOR_COLUMNS,
        fields,
        INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS,
      );
    }
    return buildPackedRow(
      INVENTORY_ROW_DESCRIPTOR_COLUMNS,
      fields,
      INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS,
    );
  }

  _buildInvKeyVal(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      stacksize,
      singleton,
    ] = row;

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["itemID", itemID],
          ["typeID", typeID],
          ["ownerID", ownerID],
          ["locationID", locationID],
          ["flagID", flagID],
          ["quantity", quantity],
          ["groupID", groupID],
          ["categoryID", categoryID],
          ["customInfo", customInfo],
          ["stacksize", stacksize],
          ["singleton", singleton],
        ],
      },
    };
  }

  Handle_GetInventoryFromId(args, session, kwargs) {
    const itemid = args && args.length > 0 ? args[0] : 0;
    const numericItemId = this._normalizeInventoryId(itemid);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const boundContext = this._getBoundContext(session);
    const corporationOffice = this._getCorporationOffice(session, numericItemId);
    const boundShip =
      findCharacterShip(charId, numericItemId) ||
      findShipItemById(numericItemId);
    const isControlledStructureInventory =
      this._isControlledStructureInventoryID(session, numericItemId);
    const explicitLocationID =
      this._extractKwarg(kwargs, "locationID") ??
      (args && args.length > 2 ? args[2] : undefined);
    const normalizedExplicitLocationID =
      explicitLocationID === undefined || explicitLocationID === null
        ? 0
        : this._normalizeInventoryId(explicitLocationID);
    const inheritedLocationID =
      boundContext &&
      boundContext.locationID !== null &&
      boundContext.locationID !== undefined
        ? this._normalizeInventoryId(boundContext.locationID)
        : 0;
    const shipLocationID = boundShip
      ? this._normalizeInventoryId(boundShip.locationID)
      : 0;
    const resolvedLocationID =
      corporationOffice
        ? this._normalizeInventoryId(corporationOffice.officeID, numericItemId)
        :
      normalizedExplicitLocationID > 0
        ? normalizedExplicitLocationID
        : boundShip && inheritedLocationID > 0
          ? inheritedLocationID
          : shipLocationID > 0
            ? shipLocationID
            : numericItemId === stationId
              ? stationId
              : itemid;
    this._traceInventory("GetInventoryFromId", session, { args });
    log.debug(
      `[InvBroker] GetInventoryFromId(itemid=${itemid}, locationID=${resolvedLocationID})`,
    );
    const result = this._makeBoundSubstruct({
      inventoryID: corporationOffice
        ? this._normalizeInventoryId(corporationOffice.officeID, numericItemId)
        : itemid,
      locationID: resolvedLocationID,
      flagID:
        isControlledStructureInventory
          ? null
          :
        numericItemId === charId
          ? null
          :
        corporationOffice
          ? null
          :
        numericItemId === stationId
          ? ITEM_FLAGS.HANGAR
          : boundShip
            ? ITEM_FLAGS.CARGO_HOLD
            : null,
      kind:
        isControlledStructureInventory
          ? "controlledStructureInventory"
          :
        numericItemId === charId
          ? "characterInventory"
          :
        corporationOffice
          ? "corpOffice"
          :
        numericItemId === stationId
          ? "stationHangar"
          : boundShip
            ? "shipInventory"
            : "container",
    }, session);
    if (boundShip) {
      log.debug(
        `[InvBroker] shipInventory bind shipID=${numericItemId} ` +
        `activeShip=${Number(this._getShipId(session)) === numericItemId} ` +
        `stationID=${stationId} locationID=${resolvedLocationID} ` +
        `${describeSessionHydrationState(session, numericItemId)}`,
      );
    }
    return result;
  }

  Handle_SetLabel(args, session) {
    this._traceInventory("SetLabel", session, { args });
    log.debug("[InvBroker] SetLabel");
    return null;
  }

  Handle_ValidateItemListCanBeOpened(args, session) {
    this._traceInventory("ValidateItemListCanBeOpened", session, { args });
    log.debug("[InvBroker] ValidateItemListCanBeOpened");
    return [];
  }

  Handle_List(args, session, kwargs) {
    const argFlag = args && args.length > 0 ? args[0] : null;
    const kwFlag = this._extractKwarg(kwargs, "flag");
    const boundContext = this._getBoundContext(session);
    const hasArgFlag = Boolean(args && args.length > 0);
    const hasKwFlag = kwFlag !== undefined;
    const explicitFlagProvided = hasKwFlag || hasArgFlag;
    const explicitNullFlag =
      (hasKwFlag && kwFlag === null) ||
      (hasArgFlag && argFlag === null);
    const initialLoginSpaceShipInventoryList =
      this._isInitialLoginSpaceShipInventoryList(session, boundContext);
    if (initialLoginSpaceShipInventoryList) {
      this._clearLoginInventoryBootstrapPending(session);
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        reason: "invbroker.List.initialPrime",
      });
    }
    const suppressInitialLoginShipList = false;
    if (suppressInitialLoginShipList) {
      this._traceInventory("ListLoginBootstrapSuppressed", session, {
        args,
        kwargs,
        boundContext,
      });
      log.debug(
        `[InvBroker] Suppressing initial login-in-space ship List(flag=None) for ship=${boundContext && boundContext.inventoryID}`,
      );
      return this._buildInventoryRowset([]);
    }
    const inSpaceShipInventory =
      boundContext?.kind === "shipInventory" &&
      !this._getStationId(session);
    const requestedFlag =
      boundContext?.kind === "shipInventory" &&
      (
        explicitNullFlag ||
        (!explicitFlagProvided && !inSpaceShipInventory)
      )
        ? null
        : hasKwFlag
          ? kwFlag
          : hasArgFlag
            ? argFlag
            : boundContext?.flagID ?? null;
    this._traceInventory("List", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] List (inventory contents) flag=${requestedFlag} bound=${JSON.stringify(boundContext)}`,
    );

    const itemsForContainer = this._mergeActiveShipLoadedChargeTupleRows(
      session,
      boundContext,
      requestedFlag,
      this._resolveContainerItems(
        session,
        requestedFlag,
        boundContext,
      ),
    );
    this._primeInSpaceBayDogmaItems(
      session,
      boundContext,
      ITEM_FLAGS.DRONE_BAY,
      itemsForContainer,
    );
    const itemOverrides = itemsForContainer
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean);

    log.debug(`[InvBroker] List ships=${itemOverrides.length}`);
    if (boundContext && boundContext.kind === "shipInventory") {
      const listSummary = this._summarizeInventoryRowsForLog(itemsForContainer);
      log.debug(
        `[InvBroker] shipInventory List summary shipID=${Number(boundContext.inventoryID) || 0} ` +
        `requestedFlag=${requestedFlag === null ? "None" : requestedFlag} ` +
        `initialLogin=${initialLoginSpaceShipInventoryList} ` +
        `total=${listSummary.total} cargo=${listSummary.cargo} modules=${listSummary.modules} ` +
        `charges=${listSummary.charges} drones=${listSummary.drones} others=${listSummary.others} ` +
        `preview=${listSummary.preview.join("|")} ` +
        `${describeSessionHydrationState(session, boundContext.inventoryID)}`,
      );
    }
    this._traceInventory("ListResult", session, {
      requestedFlag,
      count: itemOverrides.length,
      firstLine: itemOverrides[0] || null,
    });
    const result = this._buildInventoryRemoteList(itemOverrides);
    if (
      this._shouldPrimeLoginShipInventoryBootstrap(session, boundContext, {
        initialLoginSpaceShipInventoryList,
        requestedFlag,
      })
    ) {
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        requestedFlag,
        reason: "invbroker.List.postResult",
      });
    }
    return result;
  }

  Handle_ListByFlags(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const rawFlags =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flags") ??
      [];
    const requestedFlags = this._normalizeFlagList(rawFlags);
    const seenItemIds = new Set();
    const itemOverrides = [];
    const dogmaPrimeItems = [];

    this._traceInventory("ListByFlags", session, {
      args,
      kwargs,
      requestedFlags,
    });
    log.debug(
      `[InvBroker] ListByFlags(flags=${requestedFlags.join(",")}) bound=${JSON.stringify(boundContext)}`,
    );

    for (const requestedFlag of requestedFlags) {
      const itemsForFlag = this._resolveContainerItems(
        session,
        requestedFlag,
        boundContext,
      );
      dogmaPrimeItems.push(...itemsForFlag);
      for (const item of itemsForFlag) {
        const itemID = item.itemID || item.shipID;
      if (seenItemIds.has(itemID)) {
        continue;
      }

      seenItemIds.add(itemID);
      const itemOverridesForRecord = this._buildInventoryItemOverrides(
        session,
        item,
      );
      if (itemOverridesForRecord) {
        itemOverrides.push(itemOverridesForRecord);
      }
    }
    }
    this._primeInSpaceBayDogmaItems(
      session,
      boundContext,
      ITEM_FLAGS.DRONE_BAY,
      dogmaPrimeItems,
    );

    this._traceInventory("ListByFlagsResult", session, {
      requestedFlags,
      count: itemOverrides.length,
      firstLine: itemOverrides[0] || null,
    });
    const result = this._buildInventoryRemoteList(itemOverrides);
    if (
      this._shouldPrimeLoginShipInventoryBootstrap(session, boundContext, {
        requestedFlags,
      })
    ) {
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        requestedFlags,
        reason: "invbroker.ListByFlags.postResult",
      });
    }
    return result;
  }

  Handle_ImportExportWithPlanet(args, session) {
    const boundContext = this._getBoundContext(session);
    const customsOfficeID = this._normalizeInventoryId(
      boundContext && (boundContext.inventoryID ?? boundContext.locationID),
      0,
    );
    const characterID = this._getCharacterId(session);
    const spaceportPinID = this._normalizeInventoryId(
      unwrapMarshalValue(args && args.length > 0 ? args[0] : 0),
      0,
    );
    const importData = args && args.length > 1 ? args[1] : {};
    const exportData = args && args.length > 2 ? args[2] : {};
    const clientTaxRate = Number(unwrapMarshalValue(args && args.length > 3 ? args[3] : null));
    const currentTaxRate = planetOrbitalState.getTaxRate(customsOfficeID);

    this._traceInventory("ImportExportWithPlanet", session, {
      customsOfficeID,
      spaceportPinID,
      clientTaxRate,
    });

    if (customsOfficeID <= 0 || spaceportPinID <= 0) {
      throwWrappedUserError("CannotImportEndpointNotFound");
    }

    if (
      !Number.isFinite(clientTaxRate) ||
      Math.abs(clientTaxRate - currentTaxRate) > 0.000001
    ) {
      throwWrappedUserError("TaxChanged");
    }

    const colony = planetRuntimeStore.getColonyByPin(characterID, spaceportPinID);
    if (!colony) {
      throwWrappedUserError("CannotImportEndpointNotFound");
    }

    const importInfo = this._buildPIImportCommoditiesFromItems(
      importData,
      customsOfficeID,
      characterID,
    );
    const exportCommodities = this._normalizeCommodityDict(exportData);
    const preview = planetRuntimeStore.previewSpaceportImportExport({
      planetID: colony.planetID,
      ownerID: characterID,
      spaceportPinID,
      importCommodities: importInfo.commodities,
      exportCommodities,
    });
    if (!preview.success) {
      throwWrappedUserError(preview.errorMsg || "CannotImportEndpointNotFound");
    }

    const importTax = planetCostCalculator.calculateImportTax(
      preview.spaceportPin && preview.spaceportPin.typeID,
      preview.importCommodities,
      currentTaxRate,
    );
    const exportTax = planetCostCalculator.calculateExportTax(
      preview.spaceportPin && preview.spaceportPin.typeID,
      preview.exportCommodities,
      currentTaxRate,
    );
    this._ensurePIWalletCanCover(characterID, importTax + exportTax);

    const debits = [];
    try {
      const result = planetRuntimeStore.applySpaceportImportExport({
        planetID: colony.planetID,
        ownerID: characterID,
        spaceportPinID,
        importCommodities: importInfo.commodities,
        exportCommodities,
      });
      if (!result.success) {
        throwWrappedUserError(result.errorMsg || "CannotImportEndpointNotFound");
      }

      if (session && typeof session.sendNotification === "function") {
        session.sendNotification("OnMajorPlanetStateUpdate", "clientID", [colony.planetID]);
      }

      const inventoryChanges = [];
      for (const [typeID, quantity] of Object.entries(preview.importCommodities)) {
        const takeResult = takeItemTypeFromCharacterLocation(
          characterID,
          customsOfficeID,
          ITEM_FLAGS.HANGAR,
          typeID,
          quantity,
        );
        if (!takeResult.success) {
          throwWrappedUserError("CannotImportCommoditiesNotFound");
        }
        inventoryChanges.push(...((takeResult.data && takeResult.data.changes) || []));
      }

      for (const [typeID, quantity] of Object.entries(preview.exportCommodities)) {
        const grantResult = grantItemToCharacterLocation(
          characterID,
          customsOfficeID,
          ITEM_FLAGS.HANGAR,
          typeID,
          quantity,
          { singleton: 0 },
        );
        if (!grantResult.success) {
          throwWrappedUserError("CannotExportCommodities");
        }
        inventoryChanges.push(
          ...((grantResult.data && grantResult.data.changes) || []).map((change) => ({
            ...change,
            previousData: {
              ...((change && (change.previousData || change.previousState)) || {}),
              locationID: spaceportPinID,
            },
          })),
        );
      }

      this._emitInventoryMoveChanges(session, inventoryChanges, {
        emitItemsChangedBatch: true,
      });
      debits.push(this._debitPIWallet(
        characterID,
        importTax,
        JOURNAL_ENTRY_TYPE.PLANETARY_IMPORT_TAX,
        colony.planetID,
        "Planetary import tax",
      ));
      debits.push(...this._debitPIWalletInLegs(
        characterID,
        exportTax,
        JOURNAL_ENTRY_TYPE.PLANETARY_EXPORT_TAX,
        colony.planetID,
        "Planetary export tax",
        2,
      ));
      return null;
    } catch (error) {
      this._refundPIWalletDebits(
        characterID,
        debits,
        "Planetary import/export tax refund",
      );
      throw error;
    }
  }

  Handle_GetItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const itemID =
      args && args.length > 0
        ? args[0]
        : boundContext && boundContext.inventoryID
          ? boundContext.inventoryID
          : this._getShipId(session);
    this._traceInventory("GetItem", session, {
      args,
      resolvedItemID: itemID,
    });
    log.debug(`[InvBroker] GetItem(itemID=${itemID})`);

    const numericItemID = this._normalizeInventoryId(itemID);
    const isCharacterItem = numericItemID === this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, numericItemID);
    const shipRecord = findCharacterShip(
      this._getCharacterId(session),
      numericItemID,
    );
    const overrides = isCharacterItem
      ? this._buildCharacterItemOverrides(session)
      : shipRecord || skillRecord
        ? this._itemOverridesFromId(session, numericItemID)
        : this._buildContainerItemOverrides(session, numericItemID);

    return this._buildInvItem(session, overrides);
  }

  Handle_GetItemByID(args, session) {
    return this.Handle_GetItem(args, session);
  }

  Handle_GetItems(args, session) {
    const ids = args && args.length > 0 && Array.isArray(args[0]) ? args[0] : [];
    this._traceInventory("GetItems", session, { args });
    log.debug(`[InvBroker] GetItems(count=${ids.length})`);

    const items = ids.map((id) =>
      this._buildInvItem(session, this._itemOverridesFromId(session, id)),
    );
    return { type: "list", items };
  }

  _extractCrystalDamageItemIDs(rawValue) {
    const unwrapped = unwrapMarshalValue(rawValue);
    const itemIDs = new Set();
    const visit = (value) => {
      if (value === null || value === undefined) {
        return;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          visit(entry);
        }
        return;
      }
      if (value instanceof Set) {
        for (const entry of value) {
          visit(entry);
        }
        return;
      }
      const numericValue = Number(value);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        itemIDs.add(Math.trunc(numericValue));
      }
    };
    visit(unwrapped);
    return [...itemIDs];
  }

  _getCrystalDamageRatioForItem(item, characterID) {
    if (!item || typeof item !== "object") {
      return null;
    }
    if (Number(item.ownerID) !== Number(characterID)) {
      return null;
    }
    if (Number(getTypeAttributeValue(item.typeID, "crystalsGetDamaged")) <= 0) {
      return null;
    }
    return Math.max(
      0,
      Math.min(
        1,
        Number(item.moduleState && item.moduleState.damage) || 0,
      ),
    );
  }

  Handle_GetDamageForCrystals(args, session) {
    const rawCrystalIDs = args && args.length > 0 ? args[0] : [];
    const crystalIDs = this._extractCrystalDamageItemIDs(rawCrystalIDs);
    const characterID = this._getCharacterId(session);
    this._traceInventory("GetDamageForCrystals", session, {
      count: crystalIDs.length,
    });

    return buildDict(
      crystalIDs
        .map((itemID) => {
          const damageRatio = this._getCrystalDamageRatioForItem(
            findItemById(itemID),
            characterID,
          );
          return damageRatio === null ? null : [itemID, damageRatio];
        })
        .filter(Boolean),
    );
  }

  Handle_GetSelfInvItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const inventoryID =
      boundContext && boundContext.inventoryID !== null && boundContext.inventoryID !== undefined
        ? boundContext.inventoryID
        : this._getShipId(session);
    const overrides = this._buildContainerItemOverrides(session, inventoryID);
    this._traceInventory("GetSelfInvItem", session, { args });
    log.debug("[InvBroker] GetSelfInvItem");
    this._traceInventory("GetSelfInvItemResult", session, {
      inventoryID,
      overrides,
    });
    if (
      this._shouldPrimeLoginShipInventoryBootstrap(session, boundContext, {
        requestedFlag: null,
      })
    ) {
      this._primePendingSpaceShipInventoryBootstrap(session, boundContext, {
        requestedFlag: null,
        reason: "invbroker.GetSelfInvItem",
      });
    }
    return this._buildInvKeyVal(session, overrides);
  }

  Handle_StripFitting(args, session) {
    this._traceInventory("StripFitting", session, { args });
    const boundContext = this._getBoundContext(session);
    const shipRecord = this._getShipInventoryRecord(session, boundContext);

    if (!shipRecord) {
      log.warn(`[InvBroker] StripFitting failed: could not resolve ship record from bound context`);
      return null;
    }

    const charID = this._getCharacterId(session);
    const fittedItems = listFittedItems(charID, shipRecord.itemID);
    log.debug(`[InvBroker] StripFitting shipID=${shipRecord.itemID} locationID=${shipRecord.locationID} fittedCount=${fittedItems.length}`);

    if (fittedItems.length === 0) {
      return null;
    }

    const firstNonChargeFittedItem = fittedItems.find((fittedItem) => (
      fittedItem &&
      !SLOT_FAMILY_FLAGS.rig.includes(fittedItem.flagID) &&
      this._normalizeInventoryId(fittedItem.categoryID, 0) !== CHARGE_CATEGORY_ID
    ));
    if (firstNonChargeFittedItem) {
      const fittingServiceAccess = this._validateInSpaceFittingServiceAccess(
        session,
        shipRecord,
        firstNonChargeFittedItem,
        {
          locationID: shipRecord.locationID,
          flagID: ITEM_FLAGS.HANGAR,
        },
      );
      if (!fittingServiceAccess.success) {
        log.debug(
          `[InvBroker] StripFitting rejected before moving items shipID=${shipRecord.itemID} error=${fittingServiceAccess.errorMsg}`,
        );
        this._throwMobileDepotFittingAccessError(fittingServiceAccess.errorMsg);
      }
    }

    const allChanges = [];
    let movedCount = 0;

    for (const fittedItem of fittedItems) {
      if (SLOT_FAMILY_FLAGS.rig.includes(fittedItem.flagID)) {
        continue;
      }

      const fittingServiceAccess = this._validateInSpaceFittingServiceAccess(
        session,
        shipRecord,
        fittedItem,
        {
          locationID: shipRecord.locationID,
          flagID: ITEM_FLAGS.HANGAR,
        },
      );
      if (!fittingServiceAccess.success) {
        log.debug(
          `[InvBroker] StripFitting rejected itemID=${fittedItem.itemID} error=${fittingServiceAccess.errorMsg}`,
        );
        this._throwMobileDepotFittingAccessError(fittingServiceAccess.errorMsg);
      }

      const sourceItemDescriptor = this._findTransferSourceItem(
        fittedItem.itemID,
        shipRecord.itemID,
      );
      const moveResult = this._moveSourceItemToDestination(
        session,
        sourceItemDescriptor,
        {
          locationID: shipRecord.locationID,
          flagID: ITEM_FLAGS.HANGAR,
        },
      );
      if (!moveResult.success) {
        log.warn(`[InvBroker] StripFitting failed to move itemID=${fittedItem.itemID} typeID=${fittedItem.typeID} flagID=${fittedItem.flagID} error=${moveResult.errorMsg}`);
        continue;
      }

      movedCount += 1;
      allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
    }

    if (movedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);

    // After all moves, getLoadedChargeItems returns empty. Syncing with
    // emitChargeInventoryRows:true sends the client an explicit "no charges"
    // state for this ship, clearing any stale ammo displayed in the fitting window.
    syncShipFittingStateForSession(session, shipRecord.itemID, {
      includeOfflineModules: true,
      includeCharges: true,
      emitChargeInventoryRows: true,
    });

    return null;
  }

  Handle_DestroyFitting(args, session) {
    this._traceInventory("DestroyFitting", session, { args });
    const boundContext = this._getBoundContext(session);
    const boundInventoryID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    const itemID = this._normalizeInventoryId(args && args.length > 0 ? args[0] : 0, 0);
    if (itemID <= 0) {
      log.warn(`[InvBroker] DestroyFitting failed: invalid itemID`);
      return null;
    }

    const item = findItemById(itemID);
    if (!item) {
      log.warn(`[InvBroker] DestroyFitting failed: itemID=${itemID} not found`);
      return null;
    }

    if (!SLOT_FAMILY_FLAGS.rig.includes(item.flagID)) {
      log.debug(`[InvBroker] DestroyFitting rejected: itemID=${itemID} flagID=${item.flagID} is not a rig slot`);
      return null;
    }
    if (
      !boundContext ||
      boundInventoryID <= 0 ||
      this._normalizeInventoryId(item.locationID, 0) !== boundInventoryID ||
      !(
        this._getShipInventoryRecord(session, boundContext) ||
        this._getStructureFitHostRecord(session, boundInventoryID)
      )
    ) {
      log.debug(
        `[InvBroker] DestroyFitting rejected: itemID=${itemID} locationID=${item.locationID} boundInventoryID=${boundInventoryID || 0}`,
      );
      return null;
    }

    log.debug(`[InvBroker] DestroyFitting itemID=${itemID} flagID=${item.flagID}`);
    const removeResult = removeInventoryItem(itemID, { removeContents: false });
    if (!removeResult.success) {
      log.warn(`[InvBroker] DestroyFitting failed to remove itemID=${itemID} error=${removeResult.errorMsg}`);
      return null;
    }

    const changes = (removeResult.data && removeResult.data.changes) || [];
    this._emitInventoryMoveChanges(session, changes);
    this._refreshBallparkShipPresentation(session, changes);
    this._refreshBallparkInventoryPresentation(session, changes);
    return null;
  }

  Handle_TrashItems(args, session) {
    this._traceInventory("TrashItems", session, { args });
    log.debug("[InvBroker] TrashItems");
    const itemIDs = this._normalizeItemIdList(args && args.length > 0 ? args[0] : []);
    const requestedLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : this._getStationId(session),
      this._getStationId(session),
    );

    if (itemIDs.length === 0) {
      return null;
    }

    const inventoryItems = itemIDs.map((itemID) => findItemById(itemID));
    const hasInvalidItem = inventoryItems.some(
      (item) => !this._isInventoryItemTrashable(session, item, requestedLocationID),
    );
    if (hasInvalidItem) {
      return [CANNOT_TRASH_ERROR];
    }

    const allChanges = [];
    for (const itemID of this._filterTopLevelTrashItemIDs(itemIDs)) {
      const removeResult = removeInventoryItem(itemID, { removeContents: true });
      if (!removeResult.success) {
        return [CANNOT_TRASH_ERROR];
      }
      allChanges.push(...((removeResult.data && removeResult.data.changes) || []));
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return null;
  }

  _fitFittingQuantityItemsToShipBay({
    session,
    shipRecord,
    sourceLocationID,
    itemsByType,
    entriesByType,
    destinationFlagID,
    itemLabel,
    allChanges,
    missingByType,
    isItemAllowed = null,
  } = {}) {
    if (
      !shipRecord ||
      !(itemsByType instanceof Map) ||
      !Array.isArray(entriesByType) ||
      !Array.isArray(allChanges) ||
      !(missingByType instanceof Map)
    ) {
      return 0;
    }

    let fittedCount = 0;
    for (const entry of entriesByType) {
      const candidateItemIDs = itemsByType.get(entry.typeID) || [];
      const requestedQuantity = Math.max(0, Number(entry.quantity) || 0);
      const existingQuantity = this._getFitFittingExistingDestinationQuantity(
        session,
        shipRecord,
        destinationFlagID,
        entry.typeID,
      );
      let remainingQuantity = Math.max(0, requestedQuantity - existingQuantity);

      while (remainingQuantity > 0 && candidateItemIDs.length > 0) {
        const itemID = candidateItemIDs.shift();
        const sourceItemDescriptor = this._findTransferSourceItem(itemID, sourceLocationID);
        const item = sourceItemDescriptor && sourceItemDescriptor.item
          ? sourceItemDescriptor.item
          : null;
        if (
          !item ||
          Number(item.typeID) !== entry.typeID ||
          (
            typeof isItemAllowed === "function" &&
            !isItemAllowed(item)
          )
        ) {
          continue;
        }

        const destination = {
          locationID: shipRecord.itemID,
          flagID: destinationFlagID,
        };
        const shipServiceAccess = this._validateShipServiceTransferAccess(
          session,
          item,
          destination,
        );
        if (!shipServiceAccess.success) {
          log.debug(
            `[InvBroker] FitFitting rejected ${itemLabel} itemID=${itemID} shipService=${shipServiceAccess.shipID} error=${shipServiceAccess.errorMsg}`,
          );
          this._throwShipServiceAccessError(shipServiceAccess.errorMsg);
        }
        const fittingServiceAccess = this._validateInSpaceFittingServiceAccess(
          session,
          shipRecord,
          item,
          destination,
        );
        if (!fittingServiceAccess.success) {
          log.debug(
            `[InvBroker] FitFitting rejected ${itemLabel} itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${fittingServiceAccess.errorMsg}`,
          );
          this._throwMobileDepotFittingAccessError(fittingServiceAccess.errorMsg);
        }
        const dockedStructureFittingAccess = this._validateDockedStructureFittingServiceAccess(
          session,
          shipRecord,
          item,
          destination,
        );
        if (!dockedStructureFittingAccess.success) {
          log.debug(
            `[InvBroker] FitFitting rejected ${itemLabel} itemID=${itemID} structure=${dockedStructureFittingAccess.structureID} destination=${destination.locationID}:${destination.flagID} error=${dockedStructureFittingAccess.errorMsg}`,
          );
          this._throwDockedStructureFittingAccessError(dockedStructureFittingAccess.errorMsg);
        }
        const shipBayValidation = this._validateShipBayMove(
          session,
          shipRecord,
          item,
          destination,
        );
        if (!shipBayValidation.success) {
          continue;
        }

        const availableQuantity = Number(item.singleton) === 1
          ? 1
          : Math.max(1, Number(item.stacksize ?? item.quantity ?? 1) || 1);
        const moveQuantity = Math.min(remainingQuantity, availableQuantity);
        const capacityCheck = this._checkCapacityForMove(
          session,
          { kind: "shipInventory", inventoryID: shipRecord.itemID, flagID: destinationFlagID },
          destination,
          item,
          moveQuantity,
        );
        if (!capacityCheck.success) {
          continue;
        }

        const moveResult = this._moveSourceItemToDestination(
          session,
          sourceItemDescriptor,
          destination,
          moveQuantity,
        );
        if (!moveResult.success) {
          continue;
        }

        allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
        remainingQuantity -= moveQuantity;
        fittedCount += moveQuantity;
      }

      if (remainingQuantity > 0) {
        missingByType.set(
          entry.typeID,
          (missingByType.get(entry.typeID) || 0) + remainingQuantity,
        );
      }
    }

    return fittedCount;
  }

  Handle_GetContainerContents(args, session) {
    const containerID =
      args && args.length > 0 ? args[0] : this._getStationId(session);
    const locationID = args && args.length > 1 ? args[1] : containerID;
    const numericContainerID = this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    const corporationOffice = this._getCorporationOffice(session, numericContainerID);
    const genericContainerRecord = findItemById(numericContainerID);
    const mobileDepotAccessError = this._getMobileDepotCargoAccessError(
      session,
      numericContainerID,
    );
    this._traceInventory("GetContainerContents", session, { args });
    log.debug(
      `[InvBroker] GetContainerContents(containerID=${numericContainerID}, locationID=${locationID})`,
    );
    if (mobileDepotAccessError) {
      log.debug(
        `[InvBroker] Mobile Depot contents denied container=${numericContainerID} error=${mobileDepotAccessError}`,
      );
    }

    const nativeWreckRecord = this._getNativeWreckRecord(numericContainerID);
    const items =
      mobileDepotAccessError
        ? []
        :
      numericContainerID === this._getCharacterId(session)
        ? this._getCharacterContainerItems(session, null)
        :
      corporationOffice
        ? this._listCorporationOfficeItems(session, corporationOffice, null)
        :
      numericContainerID === stationId
        ? listContainerItems(
            this._getCharacterId(session),
            stationId,
            ITEM_FLAGS.HANGAR,
          )
        : nativeWreckRecord
          ? nativeNpcStore.buildNativeWreckContents(numericContainerID)
        : isMobileDepotItemRecord(genericContainerRecord)
          ? listContainerItems(
              null,
              numericContainerID,
              null,
            )
        : listContainerItems(
            this._getGenericContainerContentsOwnerID(session, genericContainerRecord),
            numericContainerID,
            null,
          );

    this._traceInventory("GetContainerContentsResult", session, {
      containerID: numericContainerID,
      count: items.length,
      firstItem: items[0] || null,
    });
    return this._buildInventoryRowset(
      items
        .map((item) => this._buildInventoryItemOverrides(session, item))
        .filter(Boolean)
        .map((overrides) => this._buildInvRow(session, overrides)),
    );
  }

  Handle_GetCapacity(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : null);
    this._traceInventory("GetCapacity", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] GetCapacity(flag=${String(requestedFlag)}) bound=${JSON.stringify(boundContext)}`,
    );
    return this._calculateCapacity(session, boundContext, requestedFlag);
  }

  Handle_StackAll(args, session, kwargs) {
    this._traceInventory("StackAll", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : null);
    const containerID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      this._getStationId(session),
    );
    const flagID =
      requestedFlag === null || requestedFlag === undefined
        ? boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, ITEM_FLAGS.HANGAR)
          : ITEM_FLAGS.HANGAR
        : this._normalizeInventoryId(requestedFlag, ITEM_FLAGS.HANGAR);
    const items = this._resolveContainerItems(session, flagID, {
      ...(boundContext || {}),
      inventoryID: containerID,
    })
      .filter((item) => item && Number(item.singleton) !== 1)
      .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
    const stacksByType = new Map();
    const allChanges = [];
    let mergedCount = 0;

    log.debug(
      `[InvBroker] StackAll container=${containerID} flag=${flagID} count=${items.length}`,
    );

    for (const item of items) {
      if (!stacksByType.has(item.typeID)) {
        stacksByType.set(item.typeID, item.itemID);
        continue;
      }

      const destinationItemID = stacksByType.get(item.typeID);
      const mergeResult = mergeItemStacks(item.itemID, destinationItemID);
      if (!mergeResult.success) {
        continue;
      }

      mergedCount += 1;
      allChanges.push(...((mergeResult.data && mergeResult.data.changes) || []));
    }

    if (mergedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return true;
  }

  Handle_MultiMerge(args, session, kwargs) {
    this._traceInventory("MultiMerge", session, { args, kwargs });
    const ops = this._normalizeMergeOps(args && args.length > 0 ? args[0] : []);
    const sourceContainerID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const allChanges = [];
    let mergedCount = 0;

    log.debug(
      `[InvBroker] MultiMerge opCount=${ops.length} sourceContainerID=${sourceContainerID}`,
    );

    for (const op of ops) {
      const sourceItem = findItemById(op.sourceItemID);
      const destinationItem = findItemById(op.destinationItemID);
      if (!sourceItem || !destinationItem) {
        continue;
      }

      const mergeResult = mergeItemStacks(
        op.sourceItemID,
        op.destinationItemID,
        op.quantity,
      );
      if (!mergeResult.success) {
        continue;
      }

      mergedCount += 1;
      allChanges.push(...((mergeResult.data && mergeResult.data.changes) || []));
    }

    if (mergedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return null;
  }

  Handle_Add(args, session, kwargs) {
    this._traceInventory("Add", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const itemID = this._normalizeInventoryId(args && args.length > 0 ? args[0] : 0, 0);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const explicitFlagValue = this._extractKwarg(kwargs, "flag");
    const explicitFlagProvided = explicitFlagValue !== undefined;
    const requestedFlag =
      explicitFlagProvided
        ? this._normalizeInventoryId(explicitFlagValue, 0)
        : boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, 0)
          : null;
    const quantity = this._normalizeQuantityArg(
      this._extractKwarg(kwargs, "qty") ?? this._extractKwarg(kwargs, "quantity"),
    );
    const sourceItemDescriptor = this._findTransferSourceItem(itemID, sourceLocationID);
    const item = sourceItemDescriptor && sourceItemDescriptor.item
      ? sourceItemDescriptor.item
      : null;
    const fleetLootEntries = [];

    log.debug(
      `[InvBroker] Add itemID=${itemID} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} bound=${JSON.stringify(boundContext)}`,
    );

    if (!boundContext || !item || !sourceItemDescriptor) {
      return null;
    }

    if (!this._isTransferSourceLocationMatch(sourceItemDescriptor, sourceLocationID)) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} source=${sourceLocationID} error=SOURCE_LOCATION_MISMATCH`,
      );
      return null;
    }

    if (!this._canTakeFromCorporationHangarSource(session, sourceItemDescriptor)) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} source=${sourceLocationID} error=CORP_HANGAR_TAKE_DENIED`,
      );
      throwWrappedUserError(
        "CrpAccessDenied",
        buildCrpAccessDeniedInsufficientRolesValues(),
      );
    }

    this._validateMoonMaterialBaySourceAccess(session, item);

    // Rigs cannot be removed from a ship and returned to inventory — they must be destroyed.
    // If the item is currently in a rig slot, block the move silently.
    if (SLOT_FAMILY_FLAGS.rig.includes(Number(item.flagID))) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} — item is a rig in slot flagID=${item.flagID} and cannot be unfit to inventory`,
      );
      return null;
    }

    const destination = this._resolveDestinationForMove(
      session,
      boundContext,
      item,
      requestedFlag,
      explicitFlagProvided,
    );
    if (!destination) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} error=NO_SUITABLE_FIT_SLOT`,
      );
      throwWrappedUserError("ModuleFitFailed", {
        moduleName: Number(item.typeID) || 0,
        reason: "No suitable slot available",
      });
    }
    const moonMaterialBayDestination = this._validateMoonMaterialBayDestination(
      session,
      destination,
    );
    if (!moonMaterialBayDestination.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${moonMaterialBayDestination.errorMsg}`,
      );
      return null;
    }
    const shipServiceAccess = this._validateShipServiceTransferAccess(
      session,
      item,
      destination,
    );
    if (!shipServiceAccess.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} shipService=${shipServiceAccess.shipID} error=${shipServiceAccess.errorMsg}`,
      );
      this._throwShipServiceAccessError(shipServiceAccess.errorMsg);
    }
    const mobileDepotAccess = this._validateMobileDepotCargoTransferAccess(
      session,
      item,
      destination,
    );
    if (!mobileDepotAccess.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} mobileDepot=${mobileDepotAccess.containerID} error=${mobileDepotAccess.errorMsg}`,
      );
      this._throwMobileDepotCargoAccessError(mobileDepotAccess.errorMsg);
    }
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const fitHostRecord = shipRecord || this._getStructureFitHostRecord(
      session,
      boundContext && boundContext.inventoryID,
    );
    const fittingServiceAccess = this._validateInSpaceFittingServiceAccess(
      session,
      shipRecord,
      item,
      destination,
    );
    if (!fittingServiceAccess.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${fittingServiceAccess.errorMsg}`,
      );
      this._throwMobileDepotFittingAccessError(fittingServiceAccess.errorMsg);
    }
    const dockedStructureFittingAccess = this._validateDockedStructureFittingServiceAccess(
      session,
      shipRecord,
      item,
      destination,
    );
    if (!dockedStructureFittingAccess.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} structure=${dockedStructureFittingAccess.structureID} destination=${destination.locationID}:${destination.flagID} error=${dockedStructureFittingAccess.errorMsg}`,
      );
      this._throwDockedStructureFittingAccessError(dockedStructureFittingAccess.errorMsg);
    }
    const structureDeedBaySourceValidation =
      this._validateStructureDeedBaySourceMove(item);
    if (!structureDeedBaySourceValidation.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} source=${item.locationID}:${item.flagID} error=${structureDeedBaySourceValidation.errorMsg}`,
      );
      throwWrappedUserError(
        structureDeedBaySourceValidation.errorMsg,
        structureDeedBaySourceValidation.values || {
          type: Number(item.typeID) || 0,
        },
      );
    }
    const chargeLoadResult = this._tryLoadChargeFromInventoryAdd(
      session,
      sourceItemDescriptor,
      destination,
      quantity,
    );
    if (chargeLoadResult.handled) {
      if (!chargeLoadResult.success) {
        log.warn(
          `[InvBroker] Add charge load failed itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${chargeLoadResult.errorMsg}`,
        );
        return null;
      }

      const chargeChanges =
        chargeLoadResult.data && Array.isArray(chargeLoadResult.data.changes)
          ? chargeLoadResult.data.changes
          : [];
      if (chargeChanges.length > 0) {
        this._appendFleetLootEntry(
          session,
          fleetLootEntries,
          sourceItemDescriptor,
          sourceLocationID,
          destination,
          chargeLoadResult.data.quantity,
        );
        this._emitInventoryMoveChanges(session, chargeChanges);
        this._refreshBallparkShipPresentation(session, chargeChanges);
        this._refreshBallparkInventoryPresentation(session, chargeChanges);
        this._emitFleetLootEvents(session, fleetLootEntries);
        const sourceContainerIDs = [
          ...new Set(
            chargeChanges
              .filter((c) => c && c.previousData && Number(c.previousData.locationID) > 0)
              .map((c) => Number(c.previousData.locationID)),
          ),
        ];
        for (const cid of sourceContainerIDs) {
          maybeExpireEmptySpaceContainer(session, cid);
        }
        this._maybeCompleteMaterializedDungeonSitesForSources(session, sourceContainerIDs);
      }
      return chargeLoadResult.data && chargeLoadResult.data.loadedChargeItemID
        ? chargeLoadResult.data.loadedChargeItemID
        : null;
    }
    const fitValidation = this._validateFittingMove(
      session,
      fitHostRecord,
      item,
      destination,
      fitHostRecord
        ? this._listFittedItemsForFitHost(session, fitHostRecord)
        : null,
    );
    if (!fitValidation.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${fitValidation.errorMsg}`,
      );
      this._throwFittingMoveUserError(fitValidation, fitHostRecord, item);
      return null;
    }
    const structureCoreValidation = this._validateStructureCoreInstallMove(
      item,
      destination,
    );
    if (!structureCoreValidation.success) {
      throwWrappedUserError(
        structureCoreValidation.errorMsg,
        structureCoreValidation.values || {
          type: Number(item.typeID) || 0,
        },
      );
    }
    const shipBayValidation = this._validateShipBayMove(
      session,
      shipRecord,
      item,
      destination,
    );
    if (!shipBayValidation.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${shipBayValidation.errorMsg}`,
      );
      throwWrappedUserError(shipBayValidation.errorMsg, {
        type: Number(item.typeID) || 0,
      });
    }
    const structureOwnerBayValidation = this._validateStructureOwnerBayMove(
      item,
      destination,
    );
    if (!structureOwnerBayValidation.success) {
      throwWrappedUserError(structureOwnerBayValidation.errorMsg, {
        type: Number(item.typeID) || 0,
      });
    }
    const structureServiceModuleRemovalAccess =
      this._validateStructureServiceModuleRemovalAccess(
        session,
        item,
        destination,
      );
    if (!structureServiceModuleRemovalAccess.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} structure=${structureServiceModuleRemovalAccess.structureID || 0} error=${structureServiceModuleRemovalAccess.errorMsg}`,
      );
      throwWrappedUserError(
        "CrpAccessDenied",
        buildCrpAccessDeniedInsufficientRolesValues(),
      );
    }
    const appliedQuantity = this._resolveAppliedMoveQuantity(
      item,
      destination,
      quantity,
    );
    const capacityCheck = this._checkCapacityForMove(
      session,
      boundContext,
      destination,
      item,
      appliedQuantity,
    );
    if (!capacityCheck.success) {
      log.debug(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${capacityCheck.errorMsg}`,
      );
      if (capacityCheck.errorMsg === "NotEnoughCargoSpace") {
        throwWrappedUserError(
          "NotEnoughCargoSpace",
          this._buildCapacityMoveUserErrorValues(capacityCheck, item),
        );
      }
      throwWrappedUserError(
        capacityCheck.errorMsg,
        this._buildCapacityMoveUserErrorValues(capacityCheck, item),
      );
    }
    const moveResult = this._moveSourceItemToDestination(
      session,
      sourceItemDescriptor,
      destination,
      appliedQuantity,
    );
    if (!moveResult.success) {
      log.warn(
        `[InvBroker] Add failed itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${moveResult.errorMsg}`,
      );
      return null;
    }

    this._appendFleetLootEntry(
      session,
      fleetLootEntries,
      sourceItemDescriptor,
      sourceLocationID,
      destination,
      quantity,
    );
    const isStructureCoreInstallMove = this._isStructureCoreInstallMove(
      item,
      destination,
    );
    this._syncStructureServiceModuleMove(session, item, destination);
    // Fit (dest is a slot) or unfit (source was a slot) → TQ transaction path;
    // everything else stays on the legacy per-item move emission.
    const isFittingMove =
      isShipFittingFlag(destination.flagID) || isShipFittingFlag(item.flagID);
    const isMtuSpaceComponentLootMove =
      this._isMtuSpaceComponentLootMove(session, sourceLocationID, destination);
    const isPlayerJetcanLootMove =
      this._isPlayerJetcanLootMove(session, sourceLocationID, destination);
    if (isFittingMove) {
      this._emitFittingMoveChanges(session, [
        ...((moveResult.data && moveResult.data.changes) || []),
        ...this._resolveShipModuleFitOnlineChanges(session, item, destination),
      ]);
    } else {
      const moveChanges = (moveResult.data && moveResult.data.changes) || [];
      const emittedCorpStructureMove =
        this._emitCorpStructureHangarMoveChanges(session, moveChanges);
      const emittedStructureCoreMove =
        !emittedCorpStructureMove &&
        isStructureCoreInstallMove &&
        this._emitStructureCoreInstallMoveChanges(
          session,
          moveChanges,
          destination,
          item,
        );
      if (!emittedCorpStructureMove && !emittedStructureCoreMove) {
        const emitItemsChangedBatch =
          isMtuSpaceComponentLootMove ||
          isPlayerJetcanLootMove ||
          Number(destination.flagID) === ITEM_FLAGS.SPECIALIZED_PLANETARY_COMMODITIES_HOLD;
        this._emitInventoryMoveChanges(session, moveChanges, {
          emitItemsChangedBatch,
          idType:
            isPlayerJetcanLootMove
              ? "shipid"
              : isMtuSpaceComponentLootMove
                ? "charid"
                : undefined,
          locationContext: isMtuSpaceComponentLootMove || isPlayerJetcanLootMove
            ? this._buildShipCargoLocationContext(session, destination)
            : undefined,
        });
      }
      this._refreshBallparkShipPresentation(session, moveChanges);
      this._refreshBallparkInventoryPresentation(session, moveChanges);
      this._emitInventoryMoveChanges(
        session,
        this._resolveShipModuleFitOnlineChanges(session, item, destination),
      );
    }
    if (isStructureCoreInstallMove) {
      this._syncStructureCoreInstall(session, item, destination);
    }
    this._emitFleetLootEvents(session, fleetLootEntries);
    if (isMtuSpaceComponentLootMove) {
      this._emitMtuSpaceComponentLootEvents(session, sourceLocationID, destination, [item]);
    }
    if (isPlayerJetcanLootMove) {
      this._emitPlayerJetcanLootEvents(session, sourceLocationID, destination, [item]);
    }
    const sourceContainerIDs = [
      ...new Set(
        ((moveResult.data && moveResult.data.changes) || [])
          .filter((c) => c && c.previousData && Number(c.previousData.locationID) > 0)
          .map((c) => Number(c.previousData.locationID)),
      ),
    ];
    // If the source was a temporary space container, despawn it when empty.
    for (const cid of sourceContainerIDs) {
      maybeExpireEmptySpaceContainer(session, cid);
    }
    this._maybeCompleteMaterializedDungeonSitesForSources(session, sourceContainerIDs);
    return this._resolveMovedItemID(moveResult, itemID, destination);
  }

  Handle_MultiAdd(args, session, kwargs) {
    this._traceInventory("MultiAdd", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const itemIDs = this._normalizeItemIdList(args && args.length > 0 ? args[0] : []);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const explicitFlagValue = this._extractKwarg(kwargs, "flag");
    const explicitFlagProvided = explicitFlagValue !== undefined;
    const requestedFlag =
      explicitFlagProvided
        ? this._normalizeInventoryId(explicitFlagValue, 0)
        : boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, 0)
          : null;
    const quantity = this._normalizeQuantityArg(
      this._extractKwarg(kwargs, "qty") ?? this._extractKwarg(kwargs, "quantity"),
    );
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const fitHostRecord = shipRecord || this._getStructureFitHostRecord(
      session,
      boundContext && boundContext.inventoryID,
    );
    const fittedItemsSnapshot = fitHostRecord
      ? this._listFittedItemsForFitHost(session, fitHostRecord)
        .map((item) => ({ ...item }))
      : [];
    const allChanges = [];
    const fleetLootEntries = [];
    let movedCount = 0;
    let firstFitValidationFailure = null;

    log.debug(
      `[InvBroker] MultiAdd itemCount=${itemIDs.length} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} bound=${JSON.stringify(boundContext)}`,
    );

    if (!boundContext || itemIDs.length === 0) {
      return null;
    }

    for (const itemID of itemIDs) {
      const sourceItemDescriptor = this._findTransferSourceItem(itemID, sourceLocationID);
      const item = sourceItemDescriptor && sourceItemDescriptor.item
        ? sourceItemDescriptor.item
        : null;
      if (!item || !sourceItemDescriptor) {
        continue;
      }

      this._validateMoonMaterialBaySourceAccess(session, item);

      const destination = this._resolveDestinationForMove(
        session,
        boundContext,
        item,
        requestedFlag,
        explicitFlagProvided,
        fittedItemsSnapshot,
      );
      if (!destination) {
        continue;
      }
      const moonMaterialBayDestination = this._validateMoonMaterialBayDestination(
        session,
        destination,
      );
      if (!moonMaterialBayDestination.success) {
        log.debug(
          `[InvBroker] MultiAdd rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${moonMaterialBayDestination.errorMsg}`,
        );
        continue;
      }
      const shipServiceAccess = this._validateShipServiceTransferAccess(
        session,
        item,
        destination,
      );
      if (!shipServiceAccess.success) {
        log.debug(
          `[InvBroker] MultiAdd rejected itemID=${itemID} shipService=${shipServiceAccess.shipID} error=${shipServiceAccess.errorMsg}`,
        );
        if (movedCount > 0) {
          continue;
        }
        this._throwShipServiceAccessError(shipServiceAccess.errorMsg);
      }
      const mobileDepotAccess = this._validateMobileDepotCargoTransferAccess(
        session,
        item,
        destination,
      );
      if (!mobileDepotAccess.success) {
        log.debug(
          `[InvBroker] MultiAdd rejected itemID=${itemID} mobileDepot=${mobileDepotAccess.containerID} error=${mobileDepotAccess.errorMsg}`,
        );
        this._throwMobileDepotCargoAccessError(mobileDepotAccess.errorMsg);
      }
      const fittingServiceAccess = this._validateInSpaceFittingServiceAccess(
        session,
        shipRecord,
        item,
        destination,
      );
      if (!fittingServiceAccess.success) {
        log.debug(
          `[InvBroker] MultiAdd rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${fittingServiceAccess.errorMsg}`,
        );
        this._throwMobileDepotFittingAccessError(fittingServiceAccess.errorMsg);
      }
      const dockedStructureFittingAccess = this._validateDockedStructureFittingServiceAccess(
        session,
        shipRecord,
        item,
        destination,
      );
      if (!dockedStructureFittingAccess.success) {
        log.debug(
          `[InvBroker] MultiAdd rejected itemID=${itemID} structure=${dockedStructureFittingAccess.structureID} destination=${destination.locationID}:${destination.flagID} error=${dockedStructureFittingAccess.errorMsg}`,
        );
        if (movedCount > 0) {
          continue;
        }
        this._throwDockedStructureFittingAccessError(dockedStructureFittingAccess.errorMsg);
      }
      const chargeLoadResult = this._tryLoadChargeFromInventoryAdd(
        session,
        sourceItemDescriptor,
        destination,
        quantity,
      );
      if (chargeLoadResult.handled) {
        if (!chargeLoadResult.success) {
          log.debug(
            `[InvBroker] MultiAdd charge load rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${chargeLoadResult.errorMsg}`,
          );
          continue;
        }

        const chargeChanges =
          chargeLoadResult.data && Array.isArray(chargeLoadResult.data.changes)
            ? chargeLoadResult.data.changes
            : [];
        if (chargeChanges.length <= 0) {
          continue;
        }

        this._appendFleetLootEntry(
          session,
          fleetLootEntries,
          sourceItemDescriptor,
          sourceLocationID,
          destination,
          chargeLoadResult.data.quantity,
        );
        movedCount += 1;
        allChanges.push(...chargeChanges);
        continue;
      }
      const fitValidation = this._validateFittingMove(
        session,
        fitHostRecord,
        item,
        destination,
        fittedItemsSnapshot,
      );
      if (!fitValidation.success) {
        firstFitValidationFailure =
          firstFitValidationFailure || { fitValidation, fitHostRecord, item };
        continue;
      }
      const structureCoreValidation = this._validateStructureCoreInstallMove(
        item,
        destination,
      );
      if (!structureCoreValidation.success) {
        if (movedCount > 0) {
          continue;
        }
        throwWrappedUserError(
          structureCoreValidation.errorMsg,
          structureCoreValidation.values || {
            type: Number(item.typeID) || 0,
          },
        );
      }
      const shipBayValidation = this._validateShipBayMove(
        session,
        shipRecord,
        item,
        destination,
      );
      if (!shipBayValidation.success) {
        continue;
      }
      const structureOwnerBayValidation = this._validateStructureOwnerBayMove(
        item,
        destination,
      );
      if (!structureOwnerBayValidation.success) {
        continue;
      }
      const structureServiceModuleRemovalAccess =
        this._validateStructureServiceModuleRemovalAccess(
          session,
          item,
          destination,
        );
      if (!structureServiceModuleRemovalAccess.success) {
        log.debug(
          `[InvBroker] MultiAdd rejected itemID=${itemID} structure=${structureServiceModuleRemovalAccess.structureID || 0} error=${structureServiceModuleRemovalAccess.errorMsg}`,
        );
        if (movedCount > 0) {
          continue;
        }
        throwWrappedUserError(
          "CrpAccessDenied",
          buildCrpAccessDeniedInsufficientRolesValues(),
        );
      }
      const appliedQuantity = this._resolveAppliedMoveQuantity(
        item,
        destination,
        quantity,
      );
      const capacityCheck = this._checkCapacityForMove(
        session,
        boundContext,
        destination,
        item,
        appliedQuantity,
      );
      if (!capacityCheck.success) {
        log.debug(
          `[InvBroker] MultiAdd rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${capacityCheck.errorMsg}`,
        );
        if (capacityCheck.errorMsg === "NotEnoughCargoSpace") {
          throwWrappedUserError(
            "NotEnoughCargoSpace",
            this._buildCapacityMoveUserErrorValues(capacityCheck, item),
          );
        }
        throwWrappedUserError(
          capacityCheck.errorMsg,
          this._buildCapacityMoveUserErrorValues(capacityCheck, item),
        );
      }
      const moveResult = this._moveSourceItemToDestination(
        session,
        sourceItemDescriptor,
        destination,
        appliedQuantity,
      );
      if (!moveResult.success) {
        continue;
      }

      this._appendFleetLootEntry(
        session,
        fleetLootEntries,
        sourceItemDescriptor,
        sourceLocationID,
        destination,
        quantity,
      );
      movedCount += 1;
      allChanges.push(...(moveResult.data.changes || []));
      this._syncStructureCoreInstall(session, item, destination);
      this._syncStructureServiceModuleMove(session, item, destination);
      allChanges.push(
        ...this._resolveShipModuleFitOnlineChanges(session, item, destination),
      );
      if (
        fitHostRecord &&
        destination.locationID === fitHostRecord.itemID &&
        isShipFittingFlag(destination.flagID)
      ) {
        const movedItemID =
          this._resolveMovedItemID(moveResult, itemID, destination) || itemID;
        const movedItem = findItemById(movedItemID) || item;
        fittedItemsSnapshot.push({
          itemID: movedItemID,
          typeID: movedItem.typeID,
          flagID: destination.flagID,
          locationID: fitHostRecord.itemID,
          categoryID: movedItem.categoryID,
          groupID: movedItem.groupID,
        });
      }
    }

    if (movedCount <= 0) {
      this._throwFittingMoveUserError(
        firstFitValidationFailure && firstFitValidationFailure.fitValidation,
        firstFitValidationFailure && firstFitValidationFailure.fitHostRecord,
        firstFitValidationFailure && firstFitValidationFailure.item,
      );
      return null;
    }

    this._emitFittingMoveChanges(session, allChanges);
    this._emitFleetLootEvents(session, fleetLootEntries);
    // If any source was a temporary space container, despawn it when now empty.
    const sourceContainerIDs = new Set(
      allChanges
        .filter((c) => c && c.previousData && Number(c.previousData.locationID) > 0)
        .map((c) => Number(c.previousData.locationID)),
    );
    for (const cid of sourceContainerIDs) {
      maybeExpireEmptySpaceContainer(session, cid);
    }
    this._maybeCompleteMaterializedDungeonSitesForSources(session, [...sourceContainerIDs]);
    return true;
  }

  Handle_FitFitting(args, session, kwargs) {
    this._traceInventory("FitFitting", session, { args, kwargs });
    const shipID = this._normalizeInventoryId(args && args.length > 0 ? args[0] : 0, 0);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 3 ? args[3] : this._getStationId(session),
      this._getStationId(session),
    );
    const itemsByType = this._normalizeFitFittingItemsByType(
      args && args.length > 2 ? args[2] : {},
    );
    const modulesByFlag = this._normalizeFitFittingModulesByFlag(
      args && args.length > 4 ? args[4] : {},
    );
    const cargoItemsByType = this._normalizeFitFittingQuantitiesByType(
      args && args.length > 5 ? args[5] : {},
      null,
    );
    const fitRigs =
      args && args.length > 6
        ? Boolean(unwrapMarshalValue(args[6]))
        : true;
    const dronesByType = this._normalizeFitFittingQuantitiesByType(
      args && args.length > 4 ? args[4] : {},
      "dronesByType",
    );
    const chargesByType = this._normalizeFitFittingQuantitiesByType(
      args && args.length > 4 ? args[4] : {},
      "chargesByType",
    );
    const fightersByType = this._normalizeFitFittingQuantitiesByType(
      args && args.length > 4 ? args[4] : {},
      "fightersByTypeID",
    );
    const iceByType = this._normalizeFitFittingQuantitiesByType(
      args && args.length > 4 ? args[4] : {},
      "iceByType",
    );
    const implantsByType = this._normalizeFitFittingQuantitiesByType(
      args && args.length > 4 ? args[4] : {},
      "implantsByTypeID",
    );
    const shipRecord =
      findCharacterShip(this._getCharacterId(session), shipID) ||
      findShipItemById(shipID) ||
      this._getStructureFitHostRecord(session, shipID);
    const fittedItemsSnapshot = shipRecord
      ? this._listFittedItemsForFitHost(session, shipRecord)
        .map((item) => ({ ...item }))
      : [];
    const missingByType = new Map();
    const allChanges = [];
    let fittedCount = 0;

    log.debug(
      `[InvBroker] FitFitting shipID=${shipID} source=${sourceLocationID} moduleSlots=${modulesByFlag.length} cargoTypes=${cargoItemsByType.length} fitRigs=${fitRigs} droneTypes=${dronesByType.length} chargeTypes=${chargesByType.length} fighterTypes=${fightersByType.length} iceTypes=${iceByType.length} implantTypes=${implantsByType.length}`,
    );

    if (
      !shipRecord ||
      (
        modulesByFlag.length <= 0 &&
        cargoItemsByType.length <= 0 &&
        dronesByType.length <= 0 &&
        chargesByType.length <= 0 &&
        fightersByType.length <= 0 &&
        iceByType.length <= 0 &&
        implantsByType.length <= 0
      )
    ) {
      return buildList([]);
    }

    for (const entry of modulesByFlag) {
      if (!fitRigs && SLOT_FAMILY_FLAGS.rig.includes(entry.flagID)) {
        continue;
      }
      const slotAlreadySatisfied = fittedItemsSnapshot.some(
        (item) =>
          Number(item && item.flagID) === Number(entry.flagID) &&
          Number(item && item.typeID) === Number(entry.typeID),
      );
      if (slotAlreadySatisfied) {
        continue;
      }
      const candidateItemIDs = itemsByType.get(entry.typeID) || [];
      let fitted = false;

      while (candidateItemIDs.length > 0) {
        const itemID = candidateItemIDs.shift();
        const sourceItemDescriptor = this._findTransferSourceItem(itemID, sourceLocationID);
        const item = sourceItemDescriptor && sourceItemDescriptor.item
          ? sourceItemDescriptor.item
          : null;
        if (!item || Number(item.typeID) !== entry.typeID) {
          continue;
        }

        const destination = {
          locationID: shipRecord.itemID,
          flagID: entry.flagID,
        };
        const shipServiceAccess = this._validateShipServiceTransferAccess(
          session,
          item,
          destination,
        );
        if (!shipServiceAccess.success) {
          log.debug(
            `[InvBroker] FitFitting rejected itemID=${itemID} shipService=${shipServiceAccess.shipID} error=${shipServiceAccess.errorMsg}`,
          );
          this._throwShipServiceAccessError(shipServiceAccess.errorMsg);
        }
        const fittingServiceAccess = this._validateInSpaceFittingServiceAccess(
          session,
          shipRecord,
          item,
          destination,
        );
        if (!fittingServiceAccess.success) {
          log.debug(
            `[InvBroker] FitFitting rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${fittingServiceAccess.errorMsg}`,
          );
          this._throwMobileDepotFittingAccessError(fittingServiceAccess.errorMsg);
        }
        const dockedStructureFittingAccess = this._validateDockedStructureFittingServiceAccess(
          session,
          shipRecord,
          item,
          destination,
        );
        if (!dockedStructureFittingAccess.success) {
          log.debug(
            `[InvBroker] FitFitting rejected itemID=${itemID} structure=${dockedStructureFittingAccess.structureID} destination=${destination.locationID}:${destination.flagID} error=${dockedStructureFittingAccess.errorMsg}`,
          );
          this._throwDockedStructureFittingAccessError(dockedStructureFittingAccess.errorMsg);
        }
        const fitValidation = this._validateFittingMove(
          session,
          shipRecord,
          item,
          destination,
          fittedItemsSnapshot,
        );
        if (!fitValidation.success) {
          continue;
        }
        const shipBayValidation = this._validateShipBayMove(
          session,
          shipRecord,
          item,
          destination,
        );
        if (!shipBayValidation.success) {
          continue;
        }
        const capacityCheck = this._checkCapacityForMove(
          session,
          { kind: "shipInventory", inventoryID: shipRecord.itemID, flagID: entry.flagID },
          destination,
          item,
          1,
        );
        if (!capacityCheck.success) {
          continue;
        }

        const moveResult = this._moveSourceItemToDestination(
          session,
          sourceItemDescriptor,
          destination,
          this._resolveAppliedMoveQuantity(item, destination, 1),
        );
        if (!moveResult.success) {
          continue;
        }

        const movedItemID =
          this._resolveMovedItemID(moveResult, itemID, destination) || itemID;
        const movedItem = findItemById(movedItemID) || item;
        fittedItemsSnapshot.push({
          itemID: movedItemID,
          typeID: movedItem.typeID,
          flagID: entry.flagID,
          locationID: shipRecord.itemID,
          categoryID: movedItem.categoryID,
          groupID: movedItem.groupID,
        });
        allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
        this._syncStructureServiceModuleMove(session, item, destination);
        allChanges.push(
          ...this._resolveShipModuleFitOnlineChanges(session, item, destination),
        );
        this._requeueFitFittingSourceStack(candidateItemIDs, itemID, item);
        fittedCount += 1;
        fitted = true;
        break;
      }

      if (!fitted) {
        missingByType.set(entry.typeID, (missingByType.get(entry.typeID) || 0) + 1);
      }
    }

    fittedCount += this._fitFittingQuantityItemsToShipBay({
      session,
      shipRecord,
      sourceLocationID,
      itemsByType,
      entriesByType: cargoItemsByType,
      destinationFlagID: ITEM_FLAGS.CARGO_HOLD,
      itemLabel: "cargo item",
      allChanges,
      missingByType,
    });
    fittedCount += this._fitFittingQuantityItemsToShipBay({
      session,
      shipRecord,
      sourceLocationID,
      itemsByType,
      entriesByType: dronesByType,
      destinationFlagID: ITEM_FLAGS.DRONE_BAY,
      itemLabel: "drone",
      allChanges,
      missingByType,
    });
    fittedCount += this._fitFittingQuantityItemsToShipBay({
      session,
      shipRecord,
      sourceLocationID,
      itemsByType,
      entriesByType: iceByType,
      destinationFlagID: ITEM_FLAGS.CARGO_HOLD,
      itemLabel: "ice product",
      allChanges,
      missingByType,
      isItemAllowed: (item) => {
        const typeRecord = resolveItemByTypeID(item && item.typeID) || {};
        return Number(item && (item.groupID || typeRecord.groupID)) === ICE_PRODUCT_GROUP_ID;
      },
    });
    fittedCount += this._fitFittingQuantityItemsToShipBay({
      session,
      shipRecord,
      sourceLocationID,
      itemsByType,
      entriesByType: implantsByType,
      destinationFlagID: ITEM_FLAGS.CARGO_HOLD,
      itemLabel: "implant",
      allChanges,
      missingByType,
      isItemAllowed: (item) => {
        const typeRecord = resolveItemByTypeID(item && item.typeID) || {};
        return Number(item && (item.categoryID || typeRecord.categoryID)) === IMPLANT_CATEGORY_ID;
      },
    });
    fittedCount += this._fitFittingQuantityItemsToShipBay({
      session,
      shipRecord,
      sourceLocationID,
      itemsByType,
      entriesByType: fightersByType,
      destinationFlagID: ITEM_FLAGS.FIGHTER_BAY,
      itemLabel: "fighter",
      allChanges,
      missingByType,
    });
    fittedCount += this._fitFittingQuantityItemsToShipBay({
      session,
      shipRecord,
      sourceLocationID,
      itemsByType,
      entriesByType: chargesByType,
      destinationFlagID: ITEM_FLAGS.CARGO_HOLD,
      itemLabel: "charge",
      allChanges,
      missingByType,
    });

    if (fittedCount > 0) {
      this._emitFittingMoveChanges(session, allChanges);
    }

    return buildList(
      [...missingByType.entries()]
        .sort(([leftTypeID], [rightTypeID]) => leftTypeID - rightTypeID)
        .map(([typeID, quantity]) => ({
          type: "tuple",
          items: [typeID, quantity],
        })),
    );
  }

  _listShipInventoryFlagContents(session, flagID) {
    const boundContext = this._getBoundContext(session);
    const shipInventoryID =
      boundContext && boundContext.kind === "shipInventory"
        ? this._normalizeInventoryId(boundContext.inventoryID, this._getShipId(session))
        : this._getShipId(session);

    if (shipInventoryID <= 0) {
      return this._buildInventoryRemoteList([]);
    }

    const shipContext = {
      ...(boundContext || {}),
      kind: "shipInventory",
      inventoryID: shipInventoryID,
      flagID,
    };
    const itemsForFlag = this._resolveContainerItems(
      session,
      flagID,
      shipContext,
    );
    this._primeInSpaceBayDogmaItems(
      session,
      shipContext,
      flagID,
      itemsForFlag,
    );
    const itemOverrides = itemsForFlag
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean);

    return this._buildInventoryRemoteList(itemOverrides);
  }

  _listStructureInventoryFlagContents(session, flagID) {
    const boundContext = this._getBoundContext(session);
    const structureID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    const structure = this._getStructureForInventoryID(structureID);
    if (!structure) {
      return null;
    }

    const structureContext = {
      ...(boundContext || {}),
      inventoryID: structureID,
      locationID: structureID,
      flagID,
    };
    const itemsForFlag = this._resolveContainerItems(
      session,
      flagID,
      structureContext,
    );
    const itemOverrides = itemsForFlag
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean);

    return this._buildInventoryRemoteList(itemOverrides);
  }

  Handle_ListDroneBay(args, session, kwargs) {
    this._traceInventory("ListDroneBay", session, { args, kwargs });
    log.debug("[InvBroker] ListDroneBay");
    return this._listShipInventoryFlagContents(session, ITEM_FLAGS.DRONE_BAY);
  }

  Handle_ListFighterBay(args, session, kwargs) {
    this._traceInventory("ListFighterBay", session, { args, kwargs });
    log.debug("[InvBroker] ListFighterBay");
    return this._listShipInventoryFlagContents(session, ITEM_FLAGS.FIGHTER_BAY);
  }

  Handle_ListFuelBay(args, session, kwargs) {
    this._traceInventory("ListFuelBay", session, { args, kwargs });
    log.debug("[InvBroker] ListFuelBay");
    const structureFuelBay = this._listStructureInventoryFlagContents(
      session,
      STRUCTURE_FUEL_BAY_FLAG,
    );
    if (structureFuelBay) {
      return structureFuelBay;
    }
    return this._listShipInventoryFlagContents(session, ITEM_FLAGS.FUEL_BAY);
  }

  Handle_TakeOutTrash(args, session, kwargs) {
    this._traceInventory("TakeOutTrash", session, { args, kwargs });
    log.debug("[InvBroker] TakeOutTrash");
    return null;
  }

  Handle_AssembleCargoContainer(args, session, kwargs) {
    this._traceInventory("AssembleCargoContainer", session, { args, kwargs });
    log.debug("[InvBroker] AssembleCargoContainer");
    return null;
  }

  Handle_BreakPlasticWrap(args, session, kwargs) {
    this._traceInventory("BreakPlasticWrap", session, { args, kwargs });
    log.debug("[InvBroker] BreakPlasticWrap");
    return null;
  }

  Handle_DeliverToCorpHangar(args, session, kwargs) {
    this._traceInventory("DeliverToCorpHangar", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const rawArgs = Array.isArray(args) ? args : [];
    const hasClientCallShape =
      rawArgs.length >= 6 ||
      (
        rawArgs.length >= 3 &&
        this._isMarshalListLike(rawArgs[2]) &&
        !this._isMarshalListLike(rawArgs[0])
      );
    const rawItemIDs =
      this._extractKwarg(kwargs, "itemIDs") ??
      this._extractKwarg(kwargs, "items") ??
      (hasClientCallShape ? rawArgs[2] : rawArgs.length > 0 ? rawArgs[0] : args);
    const itemIDs = this._normalizeItemIdList(rawItemIDs);
    const officeOrLocationID =
      this._extractKwarg(kwargs, "officeID") ??
      this._extractKwarg(kwargs, "locationID") ??
      (hasClientCallShape
        ? rawArgs[1]
        : rawArgs.length > 1
          ? rawArgs[1]
          : null) ??
      (boundContext && boundContext.inventoryID);
    const corporationOffice = this._resolveCorporationOfficeForInventory(
      session,
      officeOrLocationID,
    );
    const explicitFlag =
      this._extractKwarg(kwargs, "flag") ??
      this._extractKwarg(kwargs, "divisionFlag") ??
      (hasClientCallShape
        ? rawArgs[5]
        : rawArgs.length > 2
          ? rawArgs[2]
          : null) ??
      (boundContext && boundContext.flagID);
    const destinationFlag = this._isCorporationHangarFlag(explicitFlag)
      ? this._normalizeInventoryId(explicitFlag, 0)
      : 115;
    const moveQuantity = this._normalizeQuantityArg(
      this._extractKwarg(kwargs, "qty") ??
        this._extractKwarg(kwargs, "quantity") ??
        (hasClientCallShape ? rawArgs[3] : null),
    );
    let sourceLocationID = this._normalizeInventoryId(
      this._extractKwarg(kwargs, "sourceLocationID") ??
        this._extractKwarg(kwargs, "fromLocationID") ??
        this._extractKwarg(kwargs, "stationID") ??
        (hasClientCallShape
          ? rawArgs[0]
          : rawArgs.length > 1
            ? rawArgs[1]
            : null) ??
        this._getStationId(session),
      this._getStationId(session),
    );
    const allChanges = [];
    let movedCount = 0;

    log.debug(
      `[InvBroker] DeliverToCorpHangar itemCount=${itemIDs.length} officeOrLocationID=${String(officeOrLocationID)} flag=${destinationFlag}`,
    );

    if (!corporationOffice || itemIDs.length === 0) {
      return null;
    }
    if (
      sourceLocationID ===
      this._normalizeInventoryId(corporationOffice.officeID, 0)
    ) {
      sourceLocationID = this._getStationId(session);
    }

    for (const itemID of itemIDs) {
      const sourceItemDescriptor = this._findTransferSourceItem(
        itemID,
        sourceLocationID,
      );
      if (!sourceItemDescriptor || !sourceItemDescriptor.item) {
        continue;
      }

      const moveResult = this._moveSourceItemToDestination(
        session,
        sourceItemDescriptor,
        {
          locationID: this._normalizeInventoryId(corporationOffice.officeID, 0),
          flagID: destinationFlag,
        },
        moveQuantity,
      );
      if (!moveResult.success) {
        continue;
      }

      movedCount += 1;
      allChanges.push(...((moveResult.data && moveResult.data.changes) || []));
    }

    if (movedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return true;
  }

  Handle_DeliverToCorpMember(args, session, kwargs) {
    this._traceInventory("DeliverToCorpMember", session, { args, kwargs });
    log.debug("[InvBroker] DeliverToCorpMember");
    return null;
  }

  Handle_GetItemDescriptor(args, session) {
    this._traceInventory("GetItemDescriptor", session, { args });
    log.debug("[InvBroker] GetItemDescriptor");
    return this._buildInventoryRowDescriptor();
  }

  Handle_GetAvailableTurretSlots(args, session) {
    this._traceInventory("GetAvailableTurretSlots", session, { args });
    log.debug(
      `[InvBroker] GetAvailableTurretSlots ${describeSessionHydrationState(session)}`,
    );
    this._primeDeferredSpaceBallparkVisuals(
      session,
      this._getBoundContext(session),
      {
        reason: "GetAvailableTurretSlots",
      },
    );
    const charId = Number(
      session && (session.characterID || session.charid || session.userid),
    ) || 0;
    const shipID = Number(
      session && (session.shipID || session.shipid || session.activeShipID),
    ) || 0;
    const shipRecord =
      (charId > 0 && shipID > 0 ? findCharacterShip(charId, shipID) : null) ||
      (charId > 0 ? getActiveShipRecord(charId) : null) ||
      (shipID > 0 ? findShipItemById(shipID) : null);
    if (!shipRecord) {
      return 0;
    }

    const fittingSnapshot = getShipFittingSnapshot(charId, shipRecord.itemID, {
      shipItem: shipRecord,
      reason: "invbroker.turret-slots",
    });
    const resourceState = fittingSnapshot && fittingSnapshot.resourceState
      ? fittingSnapshot.resourceState
      : {};
    return Math.max(0, Number(resourceState && resourceState.turretSlotsLeft) || 0);
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    const bindParameter = args && args[0];
    void bindParameter;
    this._traceInventory("MachoResolveObject", session, { args, kwargs });
    log.debug("[InvBroker] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[InvBroker] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))} kwargs=${JSON.stringify(kwargs, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );
    this._traceInventory("MachoBindObject", session, {
      args,
      kwargs,
      bindParams,
      nestedCall,
    });

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];
    const inventoryID =
      Array.isArray(bindParams) && bindParams.length > 0
        ? bindParams[0]
        : bindParams;
    const requestedFlag =
      Array.isArray(bindParams) && bindParams.length > 1
        ? this._normalizeInventoryId(bindParams[1], 0)
        : null;

    const initialBoundContext = {
      inventoryID,
      locationID: inventoryID,
      flagID: this._isInventoryBindFlag(requestedFlag) ? requestedFlag : null,
      kind: "boundInventory",
    };
    this._rememberBoundContext(idString, initialBoundContext);
    this._rememberSessionBoundContext(session, idString, initialBoundContext, now);

    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[InvBroker] MachoBindObject nested call: ${methodName}`);
      const previousBoundObjectID = session
        ? session.currentBoundObjectID
        : null;
      try {
        if (session) {
          session.currentBoundObjectID = idString;
        }
        callResult = this.callMethod(
          methodName,
          Array.isArray(callArgs) ? callArgs : [callArgs],
          session,
          callKwargs,
        );
        const nestedBoundId = this._extractBoundObjectId(callResult);
        const nestedBoundContext = nestedBoundId
          ? this._boundContexts.get(nestedBoundId) || null
          : null;
        if (nestedBoundContext) {
          this._rememberBoundContext(idString, nestedBoundContext);
          this._rememberSessionBoundContext(session, idString, nestedBoundContext, now);
        }
      } finally {
        if (session) {
          session.currentBoundObjectID = previousBoundObjectID || null;
        }
      }
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  afterCallResponse(method, session) {
    if (!session) {
      return;
    }

    if (method === "GetAvailableTurretSlots") {
      return;
    }

    if (
      method === "GetInventoryFromId" ||
      method === "List" ||
      method === "GetSelfInvItem"
    ) {
      completeDockedFittingBootstrap(session, {
        trigger: `invbroker.${method}`,
      });
    }

    if (
      method !== "List" &&
      method !== "GetSelfInvItem"
    ) {
      return;
    }
    const boundContext = this._getBoundContext(session);
    if (!boundContext || boundContext.kind !== "stationHangar") {
      return;
    }

    if (!shouldFlushDeferredDockedShipSessionChange(session, method)) {
      return;
    }

    flushDeferredDockedShipSessionChange(session, {
      trigger: `invbroker.${method}`,
    });
  }
}

module.exports = InvBrokerService;
