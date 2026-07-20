const path = require("path");

const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  getAllianceRecord,
  getCharacterIDsInCorporation,
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

// A JSON-safe marshalled filetime long (string value), matching the issued-bill
// notification's date encoding. A BigInt value would break the data clone in
// createNotification.
function filetimeLongData(value) {
  return {
    type: "long",
    value: String(value === undefined || value === null ? "0" : value),
  };
}

// The issued- and paid-bill notifications carry the same bill row shape, so the
// client (FormatBillNotification) renders them identically.
function buildBillNotificationData(bill) {
  return {
    billID: normalizePositiveInteger(bill && bill.billID, 0) || 0,
    billTypeID: normalizePositiveInteger(bill && bill.billTypeID, 0) || 0,
    amount: Number(bill && bill.amount) || 0,
    interest: Number(bill && bill.interest) || 0,
    debtorID: normalizePositiveInteger(bill && bill.debtorID, 0) || 0,
    creditorID: normalizePositiveInteger(bill && bill.creditorID, 0) || 0,
    dueDateTime: filetimeLongData(bill && bill.dueDateTime),
    paidDateTime: filetimeLongData(bill && bill.paidDateTime),
    paidByOwnerID: normalizePositiveInteger(bill && bill.paidByOwnerID, 0) || 0,
  };
}

// BillPaidCharMsg (12) / BillPaidCorpAllMsg (13): a bill was paid, so the debtor
// receives a receipt. The debtor-type split mirrors the issued-bill pair
// (CharBillMsg 9 to a character, CorpAllBillMsg 10 to a corporation's members):
// a character debtor gets type 12; a corporation debtor's members get type 13.
// The creditor is the sender and the row lives in the BILLS group.
function notifyBillPaid(bill) {
  const debtorID = normalizePositiveInteger(bill && bill.debtorID, 0);
  if (!debtorID) {
    return [];
  }
  const data = buildBillNotificationData(bill);
  const senderID = normalizePositiveInteger(bill && bill.creditorID, 0) || 0;
  const isCorporationDebtor = Boolean(getCorporationRecord(debtorID));
  const recipients = isCorporationDebtor
    ? [...new Set(getCharacterIDsInCorporation(debtorID))]
    : [debtorID];
  const typeID = isCorporationDebtor
    ? NOTIFICATION_TYPE.BILL_PAID_CORP_ALL
    : NOTIFICATION_TYPE.BILL_PAID_CHAR;
  const delivered = [];
  for (const characterID of recipients) {
    const numericCharacterID = normalizePositiveInteger(characterID, 0);
    if (!numericCharacterID) {
      continue;
    }
    const result = createNotification(numericCharacterID, {
      typeID,
      senderID,
      groupID: NOTIFICATION_GROUP.BILLS,
      processed: false,
      data,
    });
    if (result && result.success) {
      delivered.push(numericCharacterID);
    }
  }
  return delivered;
}

// CharBillMsg (typeID 9): a bill was issued to a character, so the character is
// told. The corporation-debtor sibling (CorpAllBillMsg 10) is emitted by its own
// producers (e.g. office rental billing), and alliance debtors are likewise
// handled elsewhere, so only character debtors get a row here. The creditor is
// the sender and the row lives in the BILLS group.
function notifyBillIssued(bill) {
  const debtorID = normalizePositiveInteger(bill && bill.debtorID, 0);
  if (!debtorID) {
    return null;
  }
  if (getCorporationRecord(debtorID) || getAllianceRecord(debtorID)) {
    return null;
  }
  return createNotification(debtorID, {
    typeID: NOTIFICATION_TYPE.CHAR_BILL,
    senderID: normalizePositiveInteger(bill && bill.creditorID, 0) || 0,
    groupID: NOTIFICATION_GROUP.BILLS,
    processed: false,
    data: buildBillNotificationData(bill),
  });
}

module.exports = {
  notifyBillIssued,
  notifyBillPaid,
};
