const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildDbRowset,
  buildDict,
  buildList,
  buildBoundObjectResponse,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterWalletLPBalances,
  getCorporationWalletLPBalances,
  getCharacterWalletLPBalance,
  EVERMARK_ISSUER_CORP_ID,
  transferCharacterWalletLPToCorporation,
  transferCorporationWalletLPToCorporation,
} = require(path.join(__dirname, "./lpWalletState"));

const LP_BALANCE_ROWSET_NAME = "carbon.common.script.sys.crowset.CRowset";
const LP_BALANCE_COLUMNS = [
  ["issuerCorpID", 0x03],
  ["loyaltyPoints", 0x03],
];

function buildWalletRows(entries = []) {
  return buildList(
    entries.map((entry) => buildList([
      Number(entry && entry.issuerCorpID) || 0,
      Number(entry && entry.amount) || 0,
    ])),
  );
}

function buildWalletBalanceRowset(entries = []) {
  return buildDbRowset(
    LP_BALANCE_COLUMNS,
    entries.map((entry) => [
      Number(entry && entry.issuerCorpID) || 0,
      Number(entry && entry.amount) || 0,
    ]),
    LP_BALANCE_ROWSET_NAME,
  );
}

function throwLpTransferError(errorMsg) {
  let notify = "Loyalty point transfer failed.";
  if (errorMsg === "INSUFFICIENT_FUNDS") {
    notify = "Loyalty point transfer failed: insufficient balance.";
  } else if (errorMsg === "ACCESS_DENIED") {
    notify = "Loyalty point transfer failed: insufficient corporation roles.";
  } else if (errorMsg === "DESTINATION_NOT_ALLOWED") {
    notify = "That destination corporation is not valid for this loyalty point transfer.";
  } else if (errorMsg === "DESTINATION_CORPORATION_INVALID" || errorMsg === "DESTINATION_CORPORATION_EMPTY") {
    notify = "Loyalty point transfer failed: destination corporation is not eligible.";
  } else if (errorMsg === "INVALID_TRANSFER") {
    notify = "Loyalty point transfer failed: invalid transfer arguments.";
  }
  throwWrappedUserError("CustomNotify", { notify });
}

class LPService extends BaseService {
  constructor() {
    super("LPSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[LPSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[LPSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetLPExchangeRates() {
    log.debug("[LPSvc] GetLPExchangeRates");
    return buildList([]);
  }

  Handle_GetLPsForCharacter(args, session) {
    log.debug("[LPSvc] GetLPsForCharacter");
    return buildWalletRows(
      getCharacterWalletLPBalances(session && session.characterID),
    );
  }

  Handle_GetAllMyCharacterWalletLPBalances(args, session) {
    log.debug("[LPSvc] GetAllMyCharacterWalletLPBalances");
    return buildWalletBalanceRowset(
      getCharacterWalletLPBalances(session && session.characterID),
    );
  }

  Handle_GetAllMyCorporationWalletLPBalances(args, session) {
    log.debug("[LPSvc] GetAllMyCorporationWalletLPBalances");
    return buildWalletBalanceRowset(
      getCorporationWalletLPBalances(
        session && (session.corporationID || session.corpid),
      ),
    );
  }

  Handle_GetLPForCharacterCorp(args, session) {
    log.debug("[LPSvc] GetLPForCharacterCorp");
    const issuerCorpID = Array.isArray(args) && args.length > 0
      ? Number(args[0]) || EVERMARK_ISSUER_CORP_ID
      : EVERMARK_ISSUER_CORP_ID;
    return getCharacterWalletLPBalance(
      session && session.characterID,
      issuerCorpID,
    );
  }

  Handle_TransferLPFromMyWalletToOtherCorp(args, session) {
    log.debug("[LPSvc] TransferLPFromMyWalletToOtherCorp");
    const receiverCorpID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const issuerCorpID = Array.isArray(args) && args.length > 1 ? args[1] : EVERMARK_ISSUER_CORP_ID;
    const lpAmount = Array.isArray(args) && args.length > 2 ? args[2] : 0;
    const result = transferCharacterWalletLPToCorporation(
      session,
      receiverCorpID,
      issuerCorpID,
      lpAmount,
    );
    if (!result.success) {
      throwLpTransferError(result.errorMsg);
    }
    return null;
  }

  Handle_TransferLPFromMyCorpWalletToOtherCorp(args, session) {
    log.debug("[LPSvc] TransferLPFromMyCorpWalletToOtherCorp");
    const receiverCorpID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const issuerCorpID = Array.isArray(args) && args.length > 1 ? args[1] : EVERMARK_ISSUER_CORP_ID;
    const lpAmount = Array.isArray(args) && args.length > 2 ? args[2] : 0;
    const result = transferCorporationWalletLPToCorporation(
      session,
      receiverCorpID,
      issuerCorpID,
      lpAmount,
    );
    if (!result.success) {
      throwLpTransferError(result.errorMsg);
    }
    return null;
  }

  Handle_GetAvailableOffersFromCorp() {
    log.debug("[LPSvc] GetAvailableOffersFromCorp");
    return buildList([]);
  }

  Handle_TakeOffer() {
    log.debug("[LPSvc] TakeOffer");
    return null;
  }

  Handle_ExchangeConcordLP() {
    log.debug("[LPSvc] ExchangeConcordLP");
    return buildDict([]);
  }
}

module.exports = LPService;
