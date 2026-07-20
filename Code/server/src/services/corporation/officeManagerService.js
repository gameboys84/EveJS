const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildBoundObjectResponse,
  buildDbRowset,
  buildFiletimeLong,
  buildPythonSet,
  currentFileTime,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  CORP_ROLE_CAN_RENT_OFFICE,
  CORP_ROLE_DIRECTOR,
  getCorporationRuntime,
  getCorporationOffices,
  getOfficesAtStation,
  normalizePositiveInteger,
  toRoleMaskBigInt,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  notifyOfficeBillRefresh,
  notifyOfficeRentItemChange,
  notifyOfficeRentalChange,
  notifyOfficeUnrentItemChange,
} = require(path.join(__dirname, "./corporationNotifications"));
const {
  CORPORATION_WALLET_KEY_START,
  adjustCorporationWalletDivisionBalance,
} = require(path.join(__dirname, "./corpWalletState"));
const {
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  listOwnedItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const {
  JOURNAL_ENTRY_TYPE,
  buildNotEnoughMoneyUserErrorValues,
} = require(path.join(__dirname, "../account/walletState"));
const structureState = require(path.join(__dirname, "../structure/structureState"));
const {
  STRUCTURE_SERVICE_ID,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  STRUCTURE_SETTING_ID,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  characterHasStructureService,
} = require(path.join(__dirname, "../structure/structurePayloads"));
const {
  getProfileSettingValueForStructure,
} = require(path.join(__dirname, "../structure/structureProfilesState"));
const assetSafetyState = require(path.join(
  __dirname,
  "../structure/structureAssetSafetyState",
));
const {
  addOfficeRentalPeriod,
  cancelOfficeRentalBillsForOffice,
  createNextOfficeRentalBill,
} = require(path.join(__dirname, "./officeRentalBilling"));

const MAX_STRUCTURE_OFFICE_RENTAL_COST = 1000000000;
const IMPOUND_RELEASE_FEE_FACTOR = 0.5;
const OFFICE_RENTAL_PERIOD_DAYS = 30;
const FILETIME_TICKS_PER_DAY = 24n * 60n * 60n * 10000000n;
const OFFICE_ROWSET_COLUMNS = [
  ["leaseID", 20],
  ["stationID", 20],
  ["rentorID", 3],
  ["startDate", 64],
  ["rentalPeriod", 2],
  ["rentalPrice", 6],
  ["billID", 3],
  ["dueDate", 64],
  ["officeID", 20],
  ["stationTypeID", 3],
  ["solarsystemID", 20],
];

function resolveCorporationID(session) {
  return (session && (session.corporationID || session.corpid)) || 0;
}

function resolveSessionLocationID(session) {
  if (!session) {
    return null;
  }
  return normalizePositiveInteger(
    session.structureID ||
      session.structureid ||
      session.stationID ||
      session.stationid ||
      session.locationid,
    null,
  );
}

function resolveBoundStationID(session, serviceManager) {
  if (!session || !serviceManager || typeof serviceManager.getBoundObjectParams !== "function") {
    return null;
  }
  const boundObjectID =
    typeof session.currentBoundObjectID === "string" ? session.currentBoundObjectID : "";
  if (!boundObjectID) {
    return null;
  }
  const boundParams = serviceManager.getBoundObjectParams(boundObjectID);
  if (Array.isArray(boundParams)) {
    return normalizePositiveInteger(boundParams[0], null);
  }
  if (boundParams && typeof boundParams === "object") {
    return normalizePositiveInteger(
      boundParams.stationID ||
        boundParams.stationid ||
        boundParams.structureID ||
        boundParams.structureid ||
        boundParams.locationID ||
        boundParams.locationid ||
        boundParams.value,
      null,
    );
  }
  return normalizePositiveInteger(boundParams, null);
}

function resolveStationID(args, session, serviceManager = null) {
  return (
    resolveBoundStationID(session, serviceManager) ||
    resolveSessionLocationID(session) ||
    normalizePositiveInteger(args && args[0], null)
  );
}

function resolveBoundOrSessionStationID(session, serviceManager = null) {
  return resolveBoundStationID(session, serviceManager) || resolveSessionLocationID(session);
}

function getStructureDisplayName(structure, fallbackID) {
  return (
    (structure && (structure.itemName || structure.name)) ||
    `Structure ${normalizePositiveInteger(
      structure && structure.structureID,
      fallbackID,
    )}`
  );
}

function normalizeStructureOfficeRentalCost(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(0, Math.min(MAX_STRUCTURE_OFFICE_RENTAL_COST, numericValue));
}

function resolveOfficeLocationContext(args, session, serviceManager = null) {
  const stationID = resolveStationID(args, session, serviceManager);
  const station = getStationRecord(session, stationID);
  const structure =
    station && station.isStructure
      ? structureState.getStructureByID(station.structureID || station.stationID)
      : null;
  return {
    stationID,
    station,
    structure,
  };
}

function getOfficeRentalCost(args, session, serviceManager = null) {
  const { station, structure } = resolveOfficeLocationContext(args, session, serviceManager);
  if (!structure) {
    return Number((station && station.officeRentalCost) || 0);
  }

  return normalizeStructureOfficeRentalCost(
    getProfileSettingValueForStructure(
      structure,
      STRUCTURE_SETTING_ID.CORP_RENT_OFFICE,
      {
        session,
        defaultValue: 0,
      },
    ),
  );
}

function ensureStructureOfficeAccess(session, structure) {
  if (!structure) {
    return;
  }
  if (characterHasStructureService(session, structure, STRUCTURE_SERVICE_ID.OFFICES)) {
    return;
  }
  throwWrappedUserError("StructureCorpOfficesDenied", {
    structureName: getStructureDisplayName(structure, structure.structureID),
  });
}

function getStructureOwnerCorporationID(structure) {
  return normalizePositiveInteger(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
}

function getStationOwnerCorporationID(stationID) {
  const station = getStationRecord(null, stationID);
  return normalizePositiveInteger(
    station && (station.corporationID || station.ownerID),
    0,
  );
}

function buildOfficeRentalWalletDescription(stationID) {
  return `Corporation office rental at ${stationID}`;
}

function throwNotEnoughOfficeRentMoney(amount, balance) {
  throwWrappedUserError(
    "NotEnoughMoney",
    buildNotEnoughMoneyUserErrorValues(amount, balance),
  );
}

function chargeOfficeRental(corporationID, structure, stationID, rentalCost) {
  const amount = Number(rentalCost || 0);
  if (amount <= 0) {
    return;
  }

  const ownerCorporationID = structure
    ? getStructureOwnerCorporationID(structure)
    : getStationOwnerCorporationID(stationID);
  const description = buildOfficeRentalWalletDescription(stationID);
  const debitResult = adjustCorporationWalletDivisionBalance(
    corporationID,
    CORPORATION_WALLET_KEY_START,
    -amount,
    {
      entryTypeID: JOURNAL_ENTRY_TYPE.OFFICE_RENTAL_FEE,
      ownerID1: corporationID,
      ownerID2: ownerCorporationID || 0,
      referenceID: stationID,
      description,
    },
  );
  if (!debitResult || !debitResult.success) {
    const balance =
      debitResult && debitResult.data && debitResult.data.balance !== undefined
        ? debitResult.data.balance
        : 0;
    throwNotEnoughOfficeRentMoney(amount, balance);
  }

  if (ownerCorporationID && getCorporationRecord(ownerCorporationID)) {
    adjustCorporationWalletDivisionBalance(
      ownerCorporationID,
      CORPORATION_WALLET_KEY_START,
      amount,
      {
        entryTypeID: JOURNAL_ENTRY_TYPE.OFFICE_RENTAL_FEE,
        ownerID1: corporationID,
        ownerID2: ownerCorporationID,
        referenceID: stationID,
        description,
      },
    );
  }
}

function getSessionCorpRoleMask(session) {
  if (!session) {
    return 0n;
  }
  return [
    session.corprole,
    session.rolesAtAll,
    session.corpRole,
  ].reduce(
    (mask, roleValue) => mask | toRoleMaskBigInt(roleValue, 0n),
    0n,
  );
}

function sessionHasDirectorRole(session) {
  const roleMask = getSessionCorpRoleMask(session);
  return (roleMask & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR;
}

function sessionCanRentOffice(session) {
  const roleMask = getSessionCorpRoleMask(session);
  return (
    (roleMask & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (roleMask & CORP_ROLE_CAN_RENT_OFFICE) === CORP_ROLE_CAN_RENT_OFFICE
  );
}

function ensureCanRentOffice(session) {
  if (sessionCanRentOffice(session)) {
    return;
  }
  throwWrappedUserError("CrpAccessDenied");
}

function ensureCanUnrentOffice(session) {
  if (sessionHasDirectorRole(session)) {
    return;
  }
  throwWrappedUserError("CrpAccessDenied");
}

function normalizeFileTime(value, fallback = currentFileTime()) {
  try {
    const fileTime = BigInt(String(value || fallback));
    return fileTime > 0n ? fileTime : fallback;
  } catch (_error) {
    return fallback;
  }
}

function resolveOfficeStartDate(office) {
  const explicitStartDate =
    office && (office.startDate || office.rentalStartDate || office.leaseStartDate);
  if (explicitStartDate) {
    return normalizeFileTime(explicitStartDate);
  }
  const dueDate = office && (office.dueDate || office.expiryDate);
  if (dueDate) {
    const normalizedDueDate = normalizeFileTime(dueDate, 0n);
    const periodTicks = BigInt(OFFICE_RENTAL_PERIOD_DAYS) * FILETIME_TICKS_PER_DAY;
    if (normalizedDueDate > periodTicks) {
      return normalizedDueDate - periodTicks;
    }
  }
  return currentFileTime();
}

function resolveOfficeDueDate(office, startDate) {
  const explicitDueDate = office && (office.dueDate || office.expiryDate);
  if (explicitDueDate) {
    return normalizeFileTime(explicitDueDate);
  }
  return addOfficeRentalPeriod(startDate);
}

function resolveClientOfficeID(office) {
  return normalizePositiveInteger(
    office && office.itemID,
    normalizePositiveInteger(office && office.officeID, 0),
  );
}

function buildOfficeRowset(offices) {
  return buildDbRowset(
    OFFICE_ROWSET_COLUMNS,
    offices.map((office) => {
      const startDate = resolveOfficeStartDate(office);
      const dueDate = resolveOfficeDueDate(office, startDate);
      return {
        leaseID: normalizePositiveInteger(
          office && office.leaseID,
          normalizePositiveInteger(office && office.officeID, 0),
        ),
        stationID: normalizePositiveInteger(office && office.stationID, 0),
        rentorID: normalizePositiveInteger(office && office.corporationID, 0),
        startDate: buildFiletimeLong(startDate),
        rentalPeriod: OFFICE_RENTAL_PERIOD_DAYS,
        rentalPrice: Number(office && office.rentalCost ? office.rentalCost : 0),
        billID: normalizePositiveInteger(office && office.billID, 0),
        dueDate: buildFiletimeLong(dueDate),
        officeID: resolveClientOfficeID(office),
        stationTypeID: normalizePositiveInteger(
          office && (office.stationTypeID || office.typeID),
          0,
        ),
        solarsystemID: normalizePositiveInteger(office && office.solarSystemID, 0),
      };
    }),
    "carbon.common.script.sys.crowset.CRowset",
  );
}

function listStationOffices(stationID) {
  return getOfficesAtStation(stationID);
}

function isActiveOffice(office) {
  return Boolean(office) && !office.impounded;
}

function listActiveStationOffices(stationID) {
  return listStationOffices(stationID).filter(isActiveOffice);
}

function officeHasCorporationAssets(corporationID, office) {
  const officeLocationIDs = new Set([
    normalizePositiveInteger(office && office.officeID, 0),
    normalizePositiveInteger(office && office.officeFolderID, 0),
    normalizePositiveInteger(office && office.itemID, 0),
  ].filter((locationID) => locationID > 0));
  if (!corporationID || officeLocationIDs.size === 0) {
    return false;
  }

  const items = listOwnedItems(corporationID);
  const itemByID = new Map(
    items
      .map((item) => [normalizePositiveInteger(item && item.itemID, 0), item])
      .filter(([itemID]) => itemID > 0),
  );
  for (const item of items) {
    let locationID = normalizePositiveInteger(item && item.locationID, 0);
    const visited = new Set();
    while (locationID > 0 && !visited.has(locationID)) {
      if (officeLocationIDs.has(locationID)) {
        return true;
      }
      visited.add(locationID);
      const parent = itemByID.get(locationID);
      locationID = normalizePositiveInteger(parent && parent.locationID, 0);
    }
  }
  return false;
}

function getStationOfficeRentalCost(stationID) {
  const station = getStationRecord(null, stationID);
  return Number((station && station.officeRentalCost) || 0);
}

function getImpoundReleasePriceForStation(stationID) {
  return Math.max(0, getStationOfficeRentalCost(stationID) * IMPOUND_RELEASE_FEE_FACTOR);
}

function chargeImpoundRelease(corporationID, stationID, amount) {
  const releaseCost = Number(amount || 0);
  if (!corporationID || releaseCost <= 0) {
    return;
  }
  const debitResult = adjustCorporationWalletDivisionBalance(
    corporationID,
    CORPORATION_WALLET_KEY_START,
    -releaseCost,
    {
      entryTypeID: JOURNAL_ENTRY_TYPE.RELEASE_OF_IMPOUNDED_PROPERTY,
      ownerID1: corporationID,
      ownerID2: stationID,
      referenceID: stationID,
      description: `Release impounded corporation assets at ${stationID}`,
    },
  );
  if (!debitResult || !debitResult.success) {
    const balance =
      debitResult && debitResult.data && debitResult.data.balance !== undefined
        ? debitResult.data.balance
        : 0;
    throwNotEnoughOfficeRentMoney(releaseCost, balance);
  }
}

function queueOfficeBillRefresh(session, corporationID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!session || !numericCorporationID) {
    return;
  }
  if (!session._pendingOfficeBillRefreshCorporationIDs) {
    session._pendingOfficeBillRefreshCorporationIDs = new Set();
  }
  session._pendingOfficeBillRefreshCorporationIDs.add(numericCorporationID);
}

function createOfficeRecord(runtimeTable, corporationID, stationID, options = {}) {
  const station = getStationRecord(null, stationID);
  const stationTypeID = normalizePositiveInteger(station && station.stationTypeID, null);
  const nextOfficeID = normalizePositiveInteger(runtimeTable._meta.nextOfficeID, 1) || 1;
  const nextOfficeFolderID =
    normalizePositiveInteger(runtimeTable._meta.nextOfficeFolderID, 1) || 1;
  const nextOfficeItemID =
    normalizePositiveInteger(runtimeTable._meta.nextOfficeItemID, 1) || 1;
  runtimeTable._meta.nextOfficeID = nextOfficeID + 1;
  runtimeTable._meta.nextOfficeFolderID = nextOfficeFolderID + 1;
  runtimeTable._meta.nextOfficeItemID = nextOfficeItemID + 1;
  const startDate = String(options.startDate || currentFileTime());
  const dueDate = String(options.dueDate || addOfficeRentalPeriod(startDate));
  return {
    corporationID,
    stationID,
    leaseID: normalizePositiveInteger(options.leaseID, nextOfficeID),
    officeID: nextOfficeID,
    officeFolderID: nextOfficeFolderID,
    itemID: nextOfficeItemID,
    solarSystemID: normalizePositiveInteger(station && station.solarSystemID, null),
    typeID: stationTypeID,
    stationTypeID,
    rentalCost: Number(
      Object.prototype.hasOwnProperty.call(options, "rentalCost")
        ? options.rentalCost
        : (station && station.officeRentalCost) || 0,
    ),
    startDate,
    dueDate,
    billID: normalizePositiveInteger(options.billID, null),
    expiryDate: dueDate,
    impounded: false,
  };
}

class OfficeManagerService extends BaseService {
  constructor() {
    super("officeManager");
  }

  Handle_MachoResolveObject() {
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetMyCorporationsOffices(args, session) {
    const corporationID = resolveCorporationID(session);
    const offices = getCorporationOffices(corporationID).filter(isActiveOffice);
    log.debug(`[OfficeManager] GetMyCorporationsOffices(${corporationID}) -> ${offices.length}`);
    return buildOfficeRowset(offices);
  }

  Handle_GetCorporationsWithOffices(args, session) {
    const stationID = resolveStationID(args, session, this.serviceManager);
    return buildPythonSet(listActiveStationOffices(stationID).map((office) => office.corporationID));
  }

  Handle_PrimeOfficeItem(args, session) {
    return true;
  }

  Handle_GetPriceQuote(args, session) {
    return getOfficeRentalCost(args, session, this.serviceManager);
  }

  Handle_RentOffice(args, session) {
    const corporationID = resolveCorporationID(session);
    const { stationID, structure } = resolveOfficeLocationContext(args, session, this.serviceManager);
    if (!corporationID || !stationID) {
      return false;
    }
    const corporationRuntime = getCorporationRuntime(corporationID);
    if (!corporationRuntime) {
      return false;
    }
    ensureCanRentOffice(session);
    const existingOfficeAtLocation = Object.values(corporationRuntime.offices || {}).find(
      (office) => Number(office.stationID) === Number(stationID) && isActiveOffice(office),
    );
    if (existingOfficeAtLocation) {
      return false;
    }
    ensureStructureOfficeAccess(session, structure);
    const rentalCost = getOfficeRentalCost(args, session, this.serviceManager);
    chargeOfficeRental(corporationID, structure, stationID, rentalCost);
    let changedOffice = null;
    const startDate = currentFileTime();
    const dueDate = addOfficeRentalPeriod(startDate);
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime) {
        return runtimeTable;
      }
      const existingOffice = Object.values(corporationRuntime.offices || {}).find(
        (office) => Number(office.stationID) === Number(stationID) && isActiveOffice(office),
      );
      if (!existingOffice) {
        const office = createOfficeRecord(runtimeTable, corporationID, stationID, {
          rentalCost,
          startDate,
          dueDate,
        });
        corporationRuntime.offices[String(office.officeID)] = office;
        changedOffice = { ...office };
      }
      return runtimeTable;
    });
    if (changedOffice) {
      const nextBill = createNextOfficeRentalBill(
        corporationID,
        stationID,
        rentalCost,
        { baseFileTime: startDate },
      );
      if (nextBill) {
        updateRuntimeState((runtimeTable) => {
          const corporationRuntime = runtimeTable.corporations[String(corporationID)];
          const office =
            corporationRuntime &&
            corporationRuntime.offices &&
            corporationRuntime.offices[String(changedOffice.officeID)];
          if (!office) {
            return runtimeTable;
          }
          office.billID = Number(nextBill.billID) || null;
          office.dueDate = String(nextBill.dueDateTime || office.dueDate);
          office.expiryDate = office.dueDate;
          changedOffice.billID = office.billID;
          changedOffice.dueDate = office.dueDate;
          changedOffice.expiryDate = office.expiryDate;
          return runtimeTable;
        });
      }
      notifyOfficeRentItemChange(corporationID, changedOffice);
      notifyOfficeRentalChange(corporationID, changedOffice);
      queueOfficeBillRefresh(session, corporationID);
      return true;
    }
    return false;
  }

  Handle_UnrentOffice(args, session) {
    const corporationID = resolveCorporationID(session);
    const { stationID, structure } = resolveOfficeLocationContext(args, session, this.serviceManager);
    if (!corporationID || !stationID) {
      return null;
    }
    ensureCanUnrentOffice(session);
    const changedOffices = [];
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime || !corporationRuntime.offices) {
        return runtimeTable;
      }
      for (const [officeID, office] of Object.entries(corporationRuntime.offices)) {
        if (Number(office.stationID) === Number(stationID) && isActiveOffice(office)) {
          const officeSnapshot = { ...office };
          if (structure) {
            const safetyResult = assetSafetyState.moveCorporationOfficeAssetsToSafety(
              corporationID,
              structure,
              office,
              { session },
            );
            if (!safetyResult.success) {
              log.warn(
                `[OfficeManager] Structure office asset-safety handoff failed corporation=${corporationID} office=${officeID}: ${safetyResult.errorMsg}`,
              );
              continue;
            }
          } else if (officeHasCorporationAssets(corporationID, office)) {
            office.impounded = true;
            const impoundedAt = String(currentFileTime());
            office.expiryDate = impoundedAt;
            office.dueDate = impoundedAt;
            changedOffices.push({
              office: officeSnapshot,
              emitUnrentItemChange: false,
            });
            continue;
          }
          changedOffices.push({
            office: officeSnapshot,
            emitUnrentItemChange: !structure,
          });
          delete corporationRuntime.offices[officeID];
        }
      }
      return runtimeTable;
    });
    for (const change of changedOffices) {
      if (change.emitUnrentItemChange) {
        notifyOfficeUnrentItemChange(corporationID, change.office);
      }
      notifyOfficeRentalChange(corporationID, change.office);
      cancelOfficeRentalBillsForOffice(corporationID, change.office.stationID);
      queueOfficeBillRefresh(session, corporationID);
    }
    return null;
  }

  Handle_GetEmptyOfficeCount(args, session) {
    const { stationID, structure } = resolveOfficeLocationContext(args, session, this.serviceManager);
    if (structure) {
      return null;
    }
    return Math.max(0, 24 - listActiveStationOffices(stationID).length);
  }

  Handle_HasCorpImpoundedItems(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session, this.serviceManager);
    const offices = getCorporationOffices(corporationID);
    if (offices.some((office) => Number(office.stationID) === Number(stationID) && isActiveOffice(office))) {
      return false;
    }
    return offices.some(
      (office) =>
        Number(office.stationID) === Number(stationID) && Boolean(office.impounded),
    );
  }

  Handle_GetImpoundReleasePrice(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session, this.serviceManager);
    const office = getCorporationOffices(corporationID).find(
      (entry) =>
        Number(entry.stationID) === Number(stationID) && Boolean(entry.impounded),
    );
    return office ? getImpoundReleasePriceForStation(stationID) : 0;
  }

  Handle_GetItemsFromImpound(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID =
      resolveBoundOrSessionStationID(session, this.serviceManager) ||
      normalizePositiveInteger(args && args[1], null) ||
      normalizePositiveInteger(args && args[0], null);
    const releasePrice = getImpoundReleasePriceForStation(stationID);
    const hasImpoundedOffice = getCorporationOffices(corporationID).some(
      (office) =>
        Number(office.stationID) === Number(stationID) && Boolean(office.impounded),
    );
    if (!hasImpoundedOffice) {
      return null;
    }
    chargeImpoundRelease(corporationID, stationID, releasePrice);
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime || !corporationRuntime.offices) {
        return runtimeTable;
      }
      for (const office of Object.values(corporationRuntime.offices)) {
        if (Number(office.stationID) === Number(stationID) && office.impounded) {
          office.impounded = false;
        }
      }
      return runtimeTable;
    });
    return null;
  }

  Handle_TrashImpoundedOffice(args, session) {
    const corporationID = resolveCorporationID(session);
    const stationID = resolveStationID(args, session, this.serviceManager);
    const removedOffices = [];
    updateRuntimeState((runtimeTable) => {
      const corporationRuntime = runtimeTable.corporations[String(corporationID)];
      if (!corporationRuntime || !corporationRuntime.offices) {
        return runtimeTable;
      }
      for (const [officeID, office] of Object.entries(corporationRuntime.offices)) {
        if (Number(office.stationID) === Number(stationID) && office.impounded) {
          removedOffices.push({ ...office });
          delete corporationRuntime.offices[officeID];
        }
      }
      return runtimeTable;
    });
    for (const office of removedOffices) {
      notifyOfficeRentalChange(corporationID, office);
    }
    return null;
  }

  afterCallResponse(method, session) {
    if ((method !== "RentOffice" && method !== "UnrentOffice") || !session) {
      return;
    }
    const pendingRefreshes = session._pendingOfficeBillRefreshCorporationIDs;
    if (!pendingRefreshes) {
      return;
    }
    session._pendingOfficeBillRefreshCorporationIDs = null;
    for (const corporationID of pendingRefreshes) {
      notifyOfficeBillRefresh(corporationID);
    }
  }
}

module.exports = OfficeManagerService;
