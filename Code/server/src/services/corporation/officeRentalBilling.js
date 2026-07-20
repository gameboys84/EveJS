const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  BILL_TYPE_RENTAL,
  createBill,
  getBillRecord,
  listBillsForDebtor,
  listDueBills,
  markBillProcessed,
  tryAutoPayBill,
} = require(path.join(__dirname, "../account/billRuntimeState"));
const {
  getCorporationOffices,
  normalizePositiveInteger,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  notifyOfficeRentalChange,
} = require(path.join(__dirname, "./corporationNotifications"));
const {
  getCharacterIDsInCorporation,
} = require(path.join(__dirname, "./corporationState"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const structureState = require(path.join(__dirname, "../structure/structureState"));
const {
  STRUCTURE_SETTING_ID,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  getProfileSettingValueForStructure,
} = require(path.join(__dirname, "../structure/structureProfilesState"));
const assetSafetyState = require(path.join(
  __dirname,
  "../structure/structureAssetSafetyState",
));

const TYPE_OFFICE_RENTAL = 26;
const OFFICE_RENTAL_PERIOD_DAYS = 30n;
const FILETIME_TICKS_PER_DAY = 24n * 60n * 60n * 10000000n;

function filetimeLongData(value) {
  return {
    type: "long",
    value: String(normalizeFileTime(value, 0n)),
  };
}

function buildOfficeRentalBillNotificationData(bill) {
  return {
    billID: Number(bill && bill.billID) || 0,
    billTypeID: Number(bill && bill.billTypeID) || BILL_TYPE_RENTAL,
    amount: Number(bill && bill.amount) || 0,
    interest: Number(bill && bill.interest) || 0,
    debtorID: normalizePositiveInteger(bill && bill.debtorID, 0),
    creditorID: normalizePositiveInteger(bill && bill.creditorID, 0),
    dueDateTime: filetimeLongData(bill && bill.dueDateTime),
    paid: bill && bill.paid ? 1 : 0,
    paidDateTime: bill && bill.paidDateTime ? filetimeLongData(bill.paidDateTime) : null,
    paidByOwnerID: normalizePositiveInteger(bill && bill.paidByOwnerID, 0),
    externalID:
      bill && bill.externalID !== undefined && bill.externalID !== null
        ? Number(bill.externalID) || -1
        : -1,
    externalID2:
      bill && bill.externalID2 !== undefined && bill.externalID2 !== null
        ? Number(bill.externalID2) || -1
        : -1,
  };
}

function createStructureOfficeRentalBillNotifications(bill) {
  const debtorCorporationID = normalizePositiveInteger(bill && bill.debtorID, 0);
  if (!debtorCorporationID) {
    return;
  }
  const data = buildOfficeRentalBillNotificationData(bill);
  for (const characterID of [...new Set(getCharacterIDsInCorporation(debtorCorporationID))]) {
    const result = createNotification(characterID, {
      typeID: NOTIFICATION_TYPE.CORP_ALL_BILL,
      senderID: data.creditorID,
      groupID: NOTIFICATION_GROUP.BILLS,
      processed: false,
      data,
      emitLive: false,
    });
    if (!result || result.success !== true) {
      log.warn(
        `[OfficeRentalBilling] Failed to create rental bill notification ` +
        `bill=${data.billID} corporation=${debtorCorporationID} ` +
        `character=${characterID}: ${result && result.errorMsg ? result.errorMsg : "UNKNOWN"}`,
      );
    }
  }
}

function normalizeFileTime(value, fallback = currentFileTime()) {
  try {
    const filetime = BigInt(String(value || fallback));
    return filetime > 0n ? filetime : fallback;
  } catch (_error) {
    return fallback;
  }
}

function addOfficeRentalPeriod(fileTime) {
  return normalizeFileTime(fileTime) + OFFICE_RENTAL_PERIOD_DAYS * FILETIME_TICKS_PER_DAY;
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

function resolveStructureForOffice(office) {
  const stationID = normalizePositiveInteger(office && office.stationID, 0);
  const station = getStationRecord(null, stationID);
  if (!station || !station.isStructure) {
    return null;
  }
  return structureState.getStructureByID(station.structureID || station.stationID);
}

function getCurrentOfficeRentalCost(office, structure) {
  if (structure) {
    return Number(
      getProfileSettingValueForStructure(
        structure,
        STRUCTURE_SETTING_ID.CORP_RENT_OFFICE,
        {
          defaultValue: Number(office && office.rentalCost) || 0,
        },
      ) || 0,
    );
  }

  const station = getStationRecord(null, office && office.stationID);
  return Number(
    (station && station.officeRentalCost) ||
      (office && office.rentalCost) ||
      0,
  );
}

function createNextStructureOfficeRentalBill(
  corporationID,
  structure,
  stationID,
  rentalCost,
  options = {},
) {
  const amount = Number(rentalCost || 0);
  if (!structure || amount < 0) {
    return null;
  }
  const ownerCorporationID = getStructureOwnerCorporationID(structure);
  if (!ownerCorporationID) {
    return null;
  }
  const bill = createBill({
    billTypeID: BILL_TYPE_RENTAL,
    amount,
    debtorID: corporationID,
    creditorID: ownerCorporationID,
    dueDateTime: String(addOfficeRentalPeriod(options.baseFileTime || currentFileTime())),
    externalID: TYPE_OFFICE_RENTAL,
    externalID2: stationID,
  });
  if (bill) {
    createStructureOfficeRentalBillNotifications(bill);
  }
  return bill;
}

function createNextOfficeRentalBill(corporationID, stationID, rentalCost, options = {}) {
  const amount = Number(rentalCost || 0);
  if (amount < 0) {
    return null;
  }
  const station = getStationRecord(null, stationID);
  if (station && station.isStructure) {
    const structure = structureState.getStructureByID(station.structureID || station.stationID);
    return createNextStructureOfficeRentalBill(
      corporationID,
      structure,
      stationID,
      amount,
      options,
    );
  }
  const creditorID = getStationOwnerCorporationID(stationID);
  if (!creditorID) {
    return null;
  }
  return createBill({
    billTypeID: BILL_TYPE_RENTAL,
    amount,
    debtorID: corporationID,
    creditorID,
    dueDateTime: String(addOfficeRentalPeriod(options.baseFileTime || currentFileTime())),
    externalID: TYPE_OFFICE_RENTAL,
    externalID2: stationID,
  });
}

function cancelOfficeRentalBillsForOffice(corporationID, stationID) {
  const numericCorporationID = normalizePositiveInteger(corporationID, 0);
  const numericStationID = normalizePositiveInteger(stationID, 0);
  if (!numericCorporationID || !numericStationID) {
    return [];
  }
  const cancelled = [];
  for (const bill of listBillsForDebtor(numericCorporationID)) {
    if (
      Number(bill.billTypeID) !== Number(BILL_TYPE_RENTAL) ||
      Number(bill.externalID) !== Number(TYPE_OFFICE_RENTAL) ||
      Number(bill.externalID2) !== Number(numericStationID)
    ) {
      continue;
    }
    const updatedBill = markBillProcessed(bill.billID, "cancelled");
    cancelled.push(updatedBill || bill);
  }
  return cancelled;
}

function findCorporationOfficeForBill(bill) {
  const corporationID = normalizePositiveInteger(bill && bill.debtorID, 0);
  const stationID = normalizePositiveInteger(bill && bill.externalID2, 0);
  if (!corporationID || !stationID) {
    return null;
  }
  return getCorporationOffices(corporationID).find(
    (office) => Number(office.stationID) === stationID && !office.impounded,
  ) || null;
}

function updateOfficeAfterPaidBill(office, bill, nextBill) {
  const corporationID = normalizePositiveInteger(office && office.corporationID, 0);
  const officeID = normalizePositiveInteger(office && office.officeID, 0);
  if (!corporationID || !officeID) {
    return;
  }
  updateRuntimeState((runtimeTable) => {
    const corporationRuntime = runtimeTable.corporations[String(corporationID)];
    const currentOffice =
      corporationRuntime &&
      corporationRuntime.offices &&
      corporationRuntime.offices[String(officeID)];
    if (!currentOffice) {
      return runtimeTable;
    }
    currentOffice.expiryDate = String(addOfficeRentalPeriod(bill.dueDateTime));
    if (nextBill) {
      currentOffice.rentalCost = Number(nextBill.amount || currentOffice.rentalCost || 0);
    }
    return runtimeTable;
  });
}

function removeStructureOfficeForUnpaidBill(office, structure, options = {}) {
  const corporationID = normalizePositiveInteger(office && office.corporationID, 0);
  const officeID = normalizePositiveInteger(office && office.officeID, 0);
  if (!corporationID || !officeID || !structure) {
    return false;
  }

  const safetyResult = assetSafetyState.moveCorporationOfficeAssetsToSafety(
    corporationID,
    structure,
    office,
    options,
  );
  if (!safetyResult.success) {
    log.warn(
      `[OfficeRentalBilling] Structure office due-bill handoff failed corporation=${corporationID} office=${officeID}: ${safetyResult.errorMsg}`,
    );
    return false;
  }

  let removed = false;
  updateRuntimeState((runtimeTable) => {
    const corporationRuntime = runtimeTable.corporations[String(corporationID)];
    if (
      corporationRuntime &&
      corporationRuntime.offices &&
      corporationRuntime.offices[String(officeID)]
    ) {
      delete corporationRuntime.offices[String(officeID)];
      removed = true;
    }
    return runtimeTable;
  });
  if (removed) {
    notifyOfficeRentalChange(corporationID, office);
  }
  return removed;
}

function impoundStationOfficeForUnpaidBill(office) {
  const corporationID = normalizePositiveInteger(office && office.corporationID, 0);
  const officeID = normalizePositiveInteger(office && office.officeID, 0);
  if (!corporationID || !officeID) {
    return false;
  }

  let impounded = false;
  updateRuntimeState((runtimeTable) => {
    const corporationRuntime = runtimeTable.corporations[String(corporationID)];
    const currentOffice =
      corporationRuntime &&
      corporationRuntime.offices &&
      corporationRuntime.offices[String(officeID)];
    if (!currentOffice) {
      return runtimeTable;
    }
    currentOffice.impounded = true;
    currentOffice.expiryDate = String(currentFileTime());
    impounded = true;
    return runtimeTable;
  });
  if (impounded) {
    notifyOfficeRentalChange(corporationID, office);
  }
  return impounded;
}

function processPaidOfficeRentalBill(bill, office, structure) {
  const nextAmount = getCurrentOfficeRentalCost(office, structure);
  const nextBill = structure
    ? createNextStructureOfficeRentalBill(
        bill.debtorID,
        structure,
        bill.externalID2,
        nextAmount,
        {
          baseFileTime: bill.dueDateTime,
        },
      )
    : createBill({
        billTypeID: BILL_TYPE_RENTAL,
        amount: nextAmount,
        debtorID: bill.debtorID,
        creditorID: bill.creditorID,
        dueDateTime: String(addOfficeRentalPeriod(bill.dueDateTime)),
        externalID: TYPE_OFFICE_RENTAL,
        externalID2: bill.externalID2,
      });
  updateOfficeAfterPaidBill(office, bill, nextBill);
  markBillProcessed(bill.billID, "renewed", {
    renewedBillID: nextBill ? nextBill.billID : 0,
  });
  return {
    billID: bill.billID,
    officeID: office.officeID,
    stationID: office.stationID,
    action: "renewed",
    renewedBillID: nextBill ? nextBill.billID : 0,
  };
}

function processUnpaidOfficeRentalBill(bill, office, structure, options = {}) {
  const removed = structure
    ? removeStructureOfficeForUnpaidBill(office, structure, options)
    : impoundStationOfficeForUnpaidBill(office);
  if (!removed) {
    return {
      billID: bill.billID,
      officeID: office.officeID,
      stationID: office.stationID,
      action: "blocked",
    };
  }
  markBillProcessed(bill.billID, "defaulted");
  return {
    billID: bill.billID,
    officeID: office.officeID,
    stationID: office.stationID,
    action: structure ? "unrented" : "impounded",
  };
}

function processDueOfficeRentalBills(options = {}) {
  const dueBills = listDueBills({
    nowFileTime: options.nowFileTime || currentFileTime(),
    billTypeID: BILL_TYPE_RENTAL,
    externalID: TYPE_OFFICE_RENTAL,
  });
  const processed = [];
  for (const dueBill of dueBills) {
    const office = findCorporationOfficeForBill(dueBill);
    if (!office) {
      markBillProcessed(dueBill.billID, "orphaned");
      processed.push({
        billID: dueBill.billID,
        action: "orphaned",
      });
      continue;
    }

    const structure = resolveStructureForOffice(office);
    let bill = dueBill;
    if (!bill.paid) {
      tryAutoPayBill(bill.billID);
      bill = getBillRecord(bill.billID) || dueBill;
    }

    if (bill.paid) {
      processed.push(processPaidOfficeRentalBill(bill, office, structure));
      continue;
    }

    processed.push(processUnpaidOfficeRentalBill(bill, office, structure, options));
  }
  return {
    processedCount: processed.length,
    processed,
  };
}

module.exports = {
  TYPE_OFFICE_RENTAL,
  addOfficeRentalPeriod,
  cancelOfficeRentalBillsForOffice,
  createNextOfficeRentalBill,
  createNextStructureOfficeRentalBill,
  processDueOfficeRentalBills,
};
