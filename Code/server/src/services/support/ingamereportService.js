const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

const REPORT_TYPES = Object.freeze({
  report_exploit_abuse: "exploit_abuse",
  report_gambling: "gambling",
  report_inappropriate_character_name: "inappropriate_character_name",
  report_inappropriate_language: "inappropriate_language",
  report_macro_use: "macro_use",
  report_offensive_mail: "offensive_mail",
  report_other: "other",
  report_questionable_transaction: "questionable_transaction",
});

const auditReports = [];

function toInteger(value, fallback = 0) {
  const unwrapped = unwrapMarshalValue(value);
  const numeric = Number(unwrapped);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const numeric = toInteger(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function toText(value, fallback = "") {
  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped === null || unwrapped === undefined) {
    return fallback;
  }
  if (Buffer.isBuffer(unwrapped)) {
    return unwrapped.toString("utf8");
  }
  return String(unwrapped);
}

function getSessionCharacterID(session) {
  return toPositiveInteger(
    session && (session.characterID || session.charid || session.clientID),
    0,
  );
}

function getSessionAccountID(session) {
  return toPositiveInteger(
    session && (session.userid || session.userID || session.accountID),
    0,
  );
}

function recordReport(methodName, args = [], session = null, details = {}) {
  const targetCharacterID = toPositiveInteger(args[0], 0);
  const comments = toText(args[1], "");
  const report = {
    reportID: auditReports.length + 1,
    reportType: REPORT_TYPES[methodName] || methodName,
    methodName,
    reporterCharacterID: getSessionCharacterID(session),
    reporterAccountID: getSessionAccountID(session),
    targetCharacterID,
    comments,
    submittedAt: new Date().toISOString(),
    details,
  };
  auditReports.push(report);
  log.info(
    `[InGameReport] ${report.reportType} reporter=${report.reporterCharacterID || "?"} target=${targetCharacterID || "?"}`,
  );
  return null;
}

class InGameReportService extends BaseService {
  constructor() {
    super("ingamereport");
  }

  Handle_report_inappropriate_language(args, session) {
    return recordReport("report_inappropriate_language", args, session, {
      chatTime: toText(args && args[2], ""),
      chatChannel: toText(args && args[3], ""),
      chatContent: toText(args && args[4], ""),
    });
  }

  Handle_report_offensive_mail(args, session) {
    return recordReport("report_offensive_mail", args, session);
  }

  Handle_report_macro_use(args, session) {
    return recordReport("report_macro_use", args, session);
  }

  Handle_report_questionable_transaction(args, session) {
    return recordReport("report_questionable_transaction", args, session);
  }

  Handle_report_inappropriate_character_name(args, session) {
    return recordReport("report_inappropriate_character_name", args, session);
  }

  Handle_report_exploit_abuse(args, session) {
    return recordReport("report_exploit_abuse", args, session);
  }

  Handle_report_gambling(args, session) {
    return recordReport("report_gambling", args, session);
  }

  Handle_report_other(args, session) {
    return recordReport("report_other", args, session);
  }
}

module.exports = InGameReportService;
module.exports._testing = {
  REPORT_TYPES,
  getReports() {
    return auditReports.map((report) => JSON.parse(JSON.stringify(report)));
  },
  resetForTests() {
    auditReports.length = 0;
  },
};
