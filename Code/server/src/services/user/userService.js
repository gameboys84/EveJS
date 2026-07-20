/**
 * User Service — "userSvc"
 *
 * Handles account-level queries such as redeem tokens and reporting bots.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../gameStore"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  currentFileTime,
  extractDictEntries,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  DEFAULT_MCT_EXPIRY_FILETIME,
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  EVERMARK_ISSUER_CORP_ID,
  adjustCharacterWalletLPBalance,
} = require(path.join(__dirname, "../corporation/lpWalletState"));
const {
  notifyFreeSkillPointsChanged,
} = require(path.join(__dirname, "../skills/training/skillQueueNotifications"));
const {
  disconnectCharacterSession,
} = require(path.join(__dirname, "../_shared/sessionDisconnect"));
const {
  computeFutureFileTime,
  getTrainingSlotsForAccount,
  readRuntimeAccount,
  writeRuntimeAccount,
} = require(path.join(__dirname, "../newEdenStore/storeState"));

const DEFAULT_MCT_GRANT_DAYS = 30;
const OLD_ACCOUNT_CREATE_FILETIME = "132000000000000000";
const LOCAL_QA_REDEEM_TOKEN_BASE = 700000000;
const TYPE_THAT_GIVES_ISK = 52996;
const TYPE_THAT_GIVES_HERALDRY_LP = 73277;
const SKILLPOINT_REDEEM_AMOUNTS = Object.freeze({
  54652: 1000,
  54653: 2500,
  63303: 4000,
  63304: 4500,
  54650: 5000,
  63305: 5500,
  63306: 6000,
  63307: 6500,
  63308: 7000,
  54654: 7500,
  63309: 8000,
  63310: 9000,
  52520: 10000,
  63311: 11000,
  63312: 12000,
  63313: 13000,
  63314: 14000,
  63315: 15000,
  63316: 16000,
  63317: 17000,
  63318: 18000,
  63623: 19000,
  63624: 20000,
  63319: 21000,
  63320: 22000,
  63321: 23000,
  63322: 24000,
  49756: 25000,
  63323: 27000,
  63324: 28000,
  63325: 29000,
  57003: 30000,
  63326: 31000,
  63327: 32000,
  63328: 33000,
  63329: 34000,
  63330: 35000,
  63331: 42000,
  63332: 43000,
  63333: 44000,
  63334: 45000,
  63335: 46000,
  63336: 47000,
  63337: 48000,
  63338: 49000,
  49809: 50000,
  63339: 51000,
  63340: 52000,
  63824: 75000,
  49810: 100000,
  63825: 125000,
  54648: 150000,
  43680: 250000,
  52269: 500000,
  89839: 648000,
  52270: 750000,
  52318: 750000,
  52263: 1000000,
  56707: 1620000,
});

function getAccountRecordByUserID(userID) {
  const result = database.read("accounts", "/");
  const accounts = result.success && result.data ? result.data : {};

  for (const [username, account] of Object.entries(accounts)) {
    if (Number(account && account.id) === Number(userID || 0)) {
      return {
        username,
        account,
      };
    }
  }

  return null;
}

function buildDefaultTrainingSlots() {
  return {
    2: DEFAULT_MCT_EXPIRY_FILETIME,
    3: DEFAULT_MCT_EXPIRY_FILETIME,
  };
}

function getAccountIDFromSession(session) {
  return Number(session && (session.userid || session.userID || session.accountID)) || 0;
}

function getCharacterIDFromSession(session) {
  return Number(session && (session.characterID || session.charid)) || 0;
}

function getCharacterStateRuntime() {
  return require(path.join(__dirname, "../character/characterState"));
}

function getExpertSystemCatalogRuntime() {
  return require(path.join(__dirname, "../skills/expertSystems/expertSystemCatalog"));
}

function getExpertSystemRuntime() {
  return require(path.join(__dirname, "../skills/expertSystems/expertSystemRuntime"));
}

function getMergedTrainingSlots(accountID) {
  const configuredSlots = getTrainingSlotsForAccount(accountID);
  if (Object.keys(configuredSlots).length > 0) {
    return configuredSlots;
  }

  const accountRecord = getAccountRecordByUserID(accountID);
  if (
    accountRecord &&
    accountRecord.account &&
    accountRecord.account.multiCharacterTrainingSlots &&
    typeof accountRecord.account.multiCharacterTrainingSlots === "object"
  ) {
    return accountRecord.account.multiCharacterTrainingSlots;
  }
  return buildDefaultTrainingSlots();
}

function buildTrainingSlotList(trainingSlots) {
  return {
    type: "list",
    items: Object.entries(trainingSlots)
      .map(([slot, expiry]) => [
        Number(slot),
        buildFiletimeLong(expiry),
      ])
      .sort((left, right) => left[0] - right[0]),
  };
}

function getKwargValue(kwargs, key, fallback = undefined) {
  for (const [entryKey, entryValue] of extractDictEntries(kwargs)) {
    if (entryKey === key) {
      return entryValue;
    }
  }
  return fallback;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizeFileTimeString(value, fallback = "0") {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    return normalizeFileTimeString(value.value, fallback);
  }
  if (typeof value === "bigint") {
    return value > 0n ? value.toString() : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return fallback;
}

function toFileTimeBigInt(value, fallback = 0n) {
  try {
    return BigInt(normalizeFileTimeString(value, fallback.toString()));
  } catch (error) {
    return fallback;
  }
}

function normalizeRedeemTokenRecord(token) {
  const source = token && typeof token === "object" ? token : {};
  const tokenID = normalizePositiveInteger(source.tokenID, 0);
  const typeID = normalizePositiveInteger(source.typeID, 0);
  const quantity = Math.max(1, Math.trunc(Number(source.quantity || 1) || 1));
  if (!tokenID || !typeID) {
    return null;
  }
  return {
    tokenID,
    massTokenID: normalizePositiveInteger(source.massTokenID, 0),
    typeID,
    quantity,
    stationID: normalizePositiveInteger(source.stationID, 0),
    dateTime: normalizeFileTimeString(source.dateTime, "0"),
    expireDateTime: normalizeFileTimeString(source.expireDateTime, "0"),
    label: typeof source.label === "string" ? source.label : "",
    description: typeof source.description === "string" ? source.description : "",
    blueprintRuns: Math.max(0, Math.trunc(Number(source.blueprintRuns || 0) || 0)),
    blueprintMaterialLevel: Math.trunc(Number(source.blueprintMaterialLevel || 0) || 0),
    blueprintProductivityLevel: Math.trunc(Number(source.blueprintProductivityLevel || 0) || 0),
    soulbound: Boolean(source.soulbound),
    available:
      source.available === undefined || source.available === null
        ? true
        : Boolean(source.available),
    addedByContext: Math.trunc(Number(source.addedByContext || 0) || 0),
    addedByExtra: source.addedByExtra === undefined ? null : source.addedByExtra,
  };
}

function getRedeemTokensForAccount(accountID) {
  return (readRuntimeAccount(accountID).redeemTokens || [])
    .map(normalizeRedeemTokenRecord)
    .filter(Boolean);
}

function writeRedeemTokensForAccount(accountID, tokens) {
  const runtimeAccount = readRuntimeAccount(accountID);
  const normalizedTokens = (Array.isArray(tokens) ? tokens : [])
    .map(normalizeRedeemTokenRecord)
    .filter(Boolean);
  writeRuntimeAccount(accountID, {
    ...runtimeAccount,
    redeemTokens: normalizedTokens,
  });
  return normalizedTokens;
}

function buildRedeemTokenPayload(token) {
  const normalized = normalizeRedeemTokenRecord(token);
  if (!normalized) {
    return null;
  }
  const blueprintInfo = normalized.blueprintRuns > 0
    ? buildKeyVal([
        ["isCopy", true],
        ["runs", normalized.blueprintRuns],
        ["materialEfficiency", normalized.blueprintMaterialLevel],
        ["timeEfficiency", normalized.blueprintProductivityLevel],
      ])
    : null;
  return buildKeyVal([
    ["tokenID", normalized.tokenID],
    ["massTokenID", normalized.massTokenID],
    ["typeID", normalized.typeID],
    ["quantity", normalized.quantity],
    ["stationID", normalized.stationID],
    [
      "dateTime",
      buildFiletimeLong(normalized.dateTime !== "0" ? normalized.dateTime : currentFileTime().toString()),
    ],
    [
      "expireDateTime",
      normalized.expireDateTime !== "0"
        ? buildFiletimeLong(normalized.expireDateTime)
        : 0,
    ],
    ["label", normalized.label],
    ["description", normalized.description],
    ["blueprintRuns", normalized.blueprintRuns],
    ["blueprintInfo", blueprintInfo],
    ["soulbound", normalized.soulbound],
    ["isAutoInject", isAutoInjectedRedeemToken(normalized)],
  ]);
}

function getSkillPointRedeemAmount(typeID) {
  return SKILLPOINT_REDEEM_AMOUNTS[normalizePositiveInteger(typeID, 0)] || 0;
}

function getSkillPointsToRedeem(token) {
  return getSkillPointRedeemAmount(token && token.typeID) *
    Math.max(1, normalizeInteger(token && token.quantity, 1));
}

function isIskRedeemToken(typeID) {
  return normalizePositiveInteger(typeID, 0) === TYPE_THAT_GIVES_ISK;
}

function isHeraldryLpRedeemToken(typeID) {
  return normalizePositiveInteger(typeID, 0) === TYPE_THAT_GIVES_HERALDRY_LP;
}

function isAutoInjectedRedeemToken(token) {
  const typeID = normalizePositiveInteger(token && token.typeID, 0);
  return Boolean(
    (token && token.soulbound)
      || getSkillPointRedeemAmount(typeID) > 0
      || isIskRedeemToken(typeID)
      || isHeraldryLpRedeemToken(typeID)
      || isExpertSystemRedeemToken(typeID),
  );
}

function isExpertSystemRedeemToken(typeID) {
  const catalog = getExpertSystemCatalogRuntime();
  return Boolean(
    catalog &&
      typeof catalog.isExpertSystemType === "function" &&
      catalog.isExpertSystemType(typeID),
  );
}

function generateRedeemTokenID(existingTokens) {
  const maxExisting = Math.max(
    0,
    ...(Array.isArray(existingTokens) ? existingTokens : [])
      .flatMap((token) => [token && token.tokenID, token && token.massTokenID])
      .map((value) => Number(value) || 0),
  );
  if (maxExisting >= LOCAL_QA_REDEEM_TOKEN_BASE) {
    return maxExisting + 1;
  }
  return LOCAL_QA_REDEEM_TOKEN_BASE + (Date.now() % 100000000);
}

function resolveRedeemDestinationID(session, characterID, useHomeStation = false) {
  const character = characterID ? getCharacterRecord(characterID) : null;
  if (useHomeStation) {
    return (
      normalizePositiveInteger(character && character.homeStationID, 0) ||
      normalizePositiveInteger(character && character.cloneStationID, 0) ||
      normalizePositiveInteger(session && (session.homeStationID || session.homestationid), 0) ||
      normalizePositiveInteger(session && (session.cloneStationID || session.clonestationid), 0) ||
      normalizePositiveInteger(session && (session.stationid || session.stationID), 0)
    );
  }
  return (
    normalizePositiveInteger(session && (session.stationid || session.stationID), 0) ||
    normalizePositiveInteger(session && (session.structureid || session.structureID), 0) ||
    normalizePositiveInteger(character && character.stationID, 0) ||
    normalizePositiveInteger(character && character.structureID, 0) ||
    normalizePositiveInteger(character && character.homeStationID, 0)
  );
}

function extractRequestedRedeemTokens(value) {
  const unwrapped = unwrapMarshalValue(value);
  const sourceList = Array.isArray(unwrapped) ? unwrapped : [];
  return sourceList
    .map((entry) => {
      if (Array.isArray(entry)) {
        return {
          tokenID: normalizePositiveInteger(entry[0], 0),
          massTokenID: normalizePositiveInteger(entry[1], 0),
          typeID: normalizePositiveInteger(entry[2], 0),
        };
      }
      const source = entry && typeof entry === "object" ? entry : {};
      return {
        tokenID: normalizePositiveInteger(source.tokenID, 0),
        massTokenID: normalizePositiveInteger(source.massTokenID, 0),
        typeID: normalizePositiveInteger(source.typeID, 0),
      };
    })
    .filter((entry) => entry.tokenID || entry.massTokenID);
}

function tokenMatchesRequest(token, request) {
  return Boolean(
    token &&
      request &&
      (
        (request.tokenID && Number(token.tokenID) === Number(request.tokenID)) ||
        (request.massTokenID && Number(token.massTokenID) === Number(request.massTokenID))
      ),
  );
}

function buildCreatedItemPayload(item) {
  return buildDict([
    ["itemID", Number(item && item.itemID) || 0],
    ["typeID", Number(item && item.typeID) || 0],
    ["quantity", Number(item && (item.stacksize || item.quantity)) || 1],
    ["stationID", Number(item && item.locationID) || 0],
  ]);
}

function buildRedeemErrorPayload(message, data = {}) {
  return buildKeyVal([
    ["msg", message],
    ["dict", buildDict(Object.entries(data))],
  ]);
}

function syncInventoryItemChange(session, item, previousState = {}) {
  const characterState = require(path.join(__dirname, "../character/characterState"));
  if (
    characterState &&
    typeof characterState.syncInventoryItemForSession === "function"
  ) {
    characterState.syncInventoryItemForSession(session, item, previousState);
  }
}

function selectTrainingSlot(trainingSlots, requestedTrainingID) {
  const requestedSlot = Number(requestedTrainingID) || 0;
  if (requestedSlot >= 2) {
    return String(requestedSlot);
  }

  return Object.entries(trainingSlots)
    .map(([slot, expiry]) => ({
      slot: String(slot),
      numericSlot: Number(slot) || 0,
      expiry: BigInt(String(expiry || "0")),
    }))
    .filter((entry) => entry.numericSlot >= 2)
    .sort((left, right) => {
      if (left.expiry === right.expiry) {
        return left.numericSlot - right.numericSlot;
      }
      return left.expiry < right.expiry ? -1 : 1;
    })[0]?.slot || "2";
}

function grantTrainingDays(accountID, trainingID, durationDays = DEFAULT_MCT_GRANT_DAYS) {
  const numericAccountID = Number(accountID) || 0;
  if (!numericAccountID) {
    return buildDefaultTrainingSlots();
  }

  const currentSlots = getMergedTrainingSlots(numericAccountID);
  const slotKey = selectTrainingSlot(currentSlots, trainingID);
  const runtimeAccount = readRuntimeAccount(numericAccountID);
  const runtimeSlots = {
    ...(runtimeAccount && runtimeAccount.multiCharacterTrainingSlots
      ? runtimeAccount.multiCharacterTrainingSlots
      : {}),
  };
  runtimeSlots[slotKey] = computeFutureFileTime(durationDays, currentSlots[slotKey]);
  writeRuntimeAccount(numericAccountID, {
    ...runtimeAccount,
    multiCharacterTrainingSlots: runtimeSlots,
  });
  return getMergedTrainingSlots(numericAccountID);
}

function grantRedeemSkillPoints(characterID, token) {
  const skillPoints = getSkillPointsToRedeem(token);
  if (!skillPoints) {
    return {
      success: false,
      errorMsg: "INVALID_SKILLPOINT_REDEEM_TYPE",
    };
  }
  const characterState = getCharacterStateRuntime();
  if (!characterState || typeof characterState.updateCharacterRecord !== "function") {
    return {
      success: false,
      errorMsg: "CHARACTER_STATE_UNAVAILABLE",
    };
  }
  const updateResult = characterState.updateCharacterRecord(characterID, (record) => ({
    ...record,
    freeSkillPoints: Math.max(0, normalizeInteger(record && record.freeSkillPoints, 0)) +
      skillPoints,
  }));
  if (!updateResult.success) {
    return updateResult;
  }
  notifyFreeSkillPointsChanged(
    characterID,
    Math.max(0, normalizeInteger((updateResult.data || {}).freeSkillPoints, 0)),
  );
  return {
    success: true,
    data: {
      skillPoints,
      freeSkillPoints: Math.max(0, normalizeInteger((updateResult.data || {}).freeSkillPoints, 0)),
    },
  };
}

function grantRedeemIsk(characterID, token) {
  const iskAmount = Math.max(0, normalizeInteger(token && token.quantity, 0));
  if (!iskAmount) {
    return {
      success: false,
      errorMsg: "INVALID_ISK_REDEEM_AMOUNT",
    };
  }
  const creditResult = adjustCharacterBalance(characterID, iskAmount, {
    referenceID: normalizePositiveInteger(token && token.tokenID, 0),
    reason: "Redeem token",
    description: "Redeem token",
  });
  if (!creditResult.success) {
    return creditResult;
  }
  return {
    success: true,
    data: {
      iskAmount,
    },
  };
}

function grantRedeemHeraldryLp(characterID, token) {
  const lpAmount = Math.max(0, normalizeInteger(token && token.quantity, 0));
  if (!lpAmount) {
    return {
      success: false,
      errorMsg: "INVALID_HERALDRY_LP_REDEEM_AMOUNT",
    };
  }
  const creditResult = adjustCharacterWalletLPBalance(
    characterID,
    EVERMARK_ISSUER_CORP_ID,
    lpAmount,
    {
      changeType: "redeem",
    },
  );
  if (!creditResult.success) {
    return creditResult;
  }
  return {
    success: true,
    data: {
      lpAmount,
      previousAmount: Number(creditResult.data && creditResult.data.previousAmount) || 0,
      amount: Number(creditResult.data && creditResult.data.amount) || 0,
    },
  };
}

function installRedeemExpertSystem(characterID, token, session) {
  const catalog = getExpertSystemCatalogRuntime();
  const runtime = getExpertSystemRuntime();
  if (
    !catalog ||
    typeof catalog.getExpertSystemByTypeID !== "function" ||
    !runtime ||
    typeof runtime.installExpertSystemForCharacter !== "function"
  ) {
    return {
      success: false,
      errorMsg: "EXPERT_SYSTEM_RUNTIME_UNAVAILABLE",
    };
  }
  const expertSystem = catalog.getExpertSystemByTypeID(token && token.typeID);
  if (!expertSystem) {
    return {
      success: false,
      errorMsg: "EXPERT_SYSTEM_NOT_FOUND",
    };
  }
  const quantity = Math.max(1, normalizeInteger(token && token.quantity, 1));
  const durationDays = Math.max(1, normalizeInteger(expertSystem.durationDays, 7)) * quantity;
  return runtime.installExpertSystemForCharacter(characterID, token.typeID, {
    durationDays,
    grantReason: "redeem",
    session,
    sourceItemID: normalizePositiveInteger(token && token.tokenID, 0),
  });
}

function buildRedeemResult(session, options = {}) {
  const stationID = options.stationID !== undefined
    ? options.stationID
    : Number(session && (
        session.stationid ||
        session.stationID ||
        session.structureid ||
        session.structureID
      )) || null;
  const characterID =
    normalizePositiveInteger(options.characterID, 0) ||
    getCharacterIDFromSession(session) ||
    null;
  return {
    type: "dict",
    entries: [
      ["errors", { type: "list", items: [] }],
      ["itemsCreated", { type: "list", items: [] }],
      ["activated_licenses", { type: "list", items: [] }],
      ["isk_rewarded", 0],
      ["skillpoints", 0],
      ["stationID", stationID],
      ["charID", characterID],
    ],
  };
}

class UserService extends BaseService {
  constructor() {
    super("userSvc");
  }

  /**
   * GetRedeemTokens — returns tokens available to redeem
   *
   * Called during login process. If no tokens are available,
   * it returns an empty list. EVEmu does: `return new PyList();`
   */
  Handle_GetRedeemTokens(args, session, kwargs) {
    log.debug("[UserService] GetRedeemTokens called");
    const now = currentFileTime();
    const accountID = getAccountIDFromSession(session);
    const activeTokens = getRedeemTokensForAccount(accountID).filter((token) => {
      if (!token.available) {
        return false;
      }
      const expiry = toFileTimeBigInt(token.expireDateTime, 0n);
      return expiry <= 0n || expiry > now;
    });
    if (activeTokens.length !== getRedeemTokensForAccount(accountID).length) {
      writeRedeemTokensForAccount(accountID, activeTokens);
    }
    return {
      type: "list",
      items: activeTokens.map(buildRedeemTokenPayload).filter(Boolean),
    };
  }

  Handle_GetMultiCharactersTrainingSlots(args, session) {
    log.debug("[userSvc] GetMultiCharactersTrainingSlots called");
    const configuredSlots = getMergedTrainingSlots(getAccountIDFromSession(session));

    return {
      type: "dict",
      entries: Object.entries(configuredSlots).map(([slot, expiry]) => [
        Number(slot),
        buildFiletimeLong(expiry),
      ]),
    };
  }

  Handle_GetUpdatedMultiCharacterTraining(args, session) {
    log.debug("[userSvc] GetUpdatedMultiCharacterTraining called");
    return buildTrainingSlotList(getMergedTrainingSlots(getAccountIDFromSession(session)));
  }

  Handle_ActivateMultiTraining(args, session, kwargs) {
    const trainingID =
      (args && args.length > 1 ? args[1] : undefined) ??
      getKwargValue(kwargs, "trainingID", null);
    log.info(
      `[userSvc] ActivateMultiTraining user=${getAccountIDFromSession(session)} trainingID=${trainingID || "next"}`,
    );
    return buildTrainingSlotList(
      grantTrainingDays(getAccountIDFromSession(session), trainingID),
    );
  }

  Handle_ActivateSoulboundMultiTraining(args, session, kwargs) {
    const tokens = args && Array.isArray(args[1]) ? args[1] : [];
    const trainingID =
      (args && args.length > 2 ? args[2] : undefined) ??
      getKwargValue(kwargs, "trainingID", null);
    const durationDays = Math.max(1, tokens.length || 1) * DEFAULT_MCT_GRANT_DAYS;
    log.info(
      `[userSvc] ActivateSoulboundMultiTraining user=${getAccountIDFromSession(session)} trainingID=${trainingID || "next"} days=${durationDays}`,
    );
    const accountID = getAccountIDFromSession(session);
    const result = buildTrainingSlotList(
      grantTrainingDays(accountID, trainingID, durationDays),
    );
    const requestedTokens = extractRequestedRedeemTokens(tokens);
    if (requestedTokens.length > 0) {
      const remainingTokens = getRedeemTokensForAccount(accountID).filter(
        (token) => !requestedTokens.some((request) => tokenMatchesRequest(token, request)),
      );
      writeRedeemTokensForAccount(accountID, remainingTokens);
    }
    return result;
  }

  Handle_InvalidateMultiCharacterTrainingCache() {
    log.debug("[userSvc] InvalidateMultiCharacterTrainingCache called");
    return true;
  }

  Handle_ClaimRedeemTokens(args, session, kwargs) {
    const requestedTokens = extractRequestedRedeemTokens(args && args[0]);
    const tokenCount = requestedTokens.length;
    log.info(`[userSvc] ClaimRedeemTokens tokenCount=${tokenCount}`);
    if (tokenCount === 0) {
      return buildRedeemResult(session);
    }

    const accountID = getAccountIDFromSession(session);
    const characterID =
      normalizePositiveInteger(args && args.length > 1 ? args[1] : 0, 0) ||
      getCharacterIDFromSession(session);
    const useHomeStation = Boolean(getKwargValue(kwargs, "useHomeStation", false));
    const destinationID = resolveRedeemDestinationID(session, characterID, useHomeStation);
    const currentTokens = getRedeemTokensForAccount(accountID);
    const errors = [];
    const itemsCreated = [];
    let iskRewarded = 0;
    let skillPointsRewarded = 0;
    const consumedTokenIDs = new Set();

    for (const request of requestedTokens) {
      const token = currentTokens.find((candidate) => tokenMatchesRequest(candidate, request));
      if (!token) {
        errors.push([
          request.tokenID || request.massTokenID,
          buildRedeemErrorPayload("RedeemTokenNotFound"),
        ]);
        continue;
      }
      if (!characterID) {
        errors.push([
          token.tokenID,
          buildRedeemErrorPayload("RedeemNoCharacter", { itemTypeID: token.typeID }),
        ]);
        continue;
      }

      if (getSkillPointRedeemAmount(token.typeID) > 0) {
        const grantResult = grantRedeemSkillPoints(characterID, token);
        if (!grantResult.success) {
          errors.push([
            token.tokenID,
            buildRedeemErrorPayload("RedeemSkillPointsFailed", {
              itemTypeID: token.typeID,
              reason: grantResult.errorMsg || "UNKNOWN",
            }),
          ]);
          continue;
        }
        skillPointsRewarded += Number(grantResult.data.skillPoints) || 0;
        consumedTokenIDs.add(Number(token.tokenID));
        continue;
      }

      if (isIskRedeemToken(token.typeID)) {
        const grantResult = grantRedeemIsk(characterID, token);
        if (!grantResult.success) {
          errors.push([
            token.tokenID,
            buildRedeemErrorPayload("RedeemIskFailed", {
              itemTypeID: token.typeID,
              reason: grantResult.errorMsg || "UNKNOWN",
            }),
          ]);
          continue;
        }
        iskRewarded += Number(grantResult.data.iskAmount) || 0;
        consumedTokenIDs.add(Number(token.tokenID));
        continue;
      }

      if (isHeraldryLpRedeemToken(token.typeID)) {
        const grantResult = grantRedeemHeraldryLp(characterID, token);
        if (!grantResult.success) {
          errors.push([
            token.tokenID,
            buildRedeemErrorPayload("RedeemHeraldryLpFailed", {
              itemTypeID: token.typeID,
              reason: grantResult.errorMsg || "UNKNOWN",
            }),
          ]);
          continue;
        }
        consumedTokenIDs.add(Number(token.tokenID));
        continue;
      }

      if (isExpertSystemRedeemToken(token.typeID)) {
        const installResult = installRedeemExpertSystem(characterID, token, session);
        if (!installResult.success) {
          errors.push([
            token.tokenID,
            buildRedeemErrorPayload("RedeemExpertSystemFailed", {
              itemTypeID: token.typeID,
              reason: installResult.errorMsg || "UNKNOWN",
            }),
          ]);
          continue;
        }
        consumedTokenIDs.add(Number(token.tokenID));
        continue;
      }

      if (token.soulbound) {
        errors.push([
          token.tokenID,
          buildRedeemErrorPayload("RedeemAutoInjectUnsupported", {
            itemTypeID: token.typeID,
          }),
        ]);
        continue;
      }

      if (!destinationID) {
        errors.push([
          token.tokenID,
          buildRedeemErrorPayload("RedeemNoDestination", { itemTypeID: token.typeID }),
        ]);
        continue;
      }
      const grantResult = grantItemToCharacterLocation(
        characterID,
        destinationID,
        ITEM_FLAGS.HANGAR,
        token.typeID,
        token.quantity,
        {
          singleton: token.blueprintRuns > 0 ? 2 : undefined,
          customInfo: token.label || token.description || "",
        },
      );
      if (!grantResult.success) {
        errors.push([
          token.tokenID,
          buildRedeemErrorPayload("RedeemItemGrantFailed", {
            itemTypeID: token.typeID,
            reason: grantResult.errorMsg || "UNKNOWN",
          }),
        ]);
        continue;
      }
      consumedTokenIDs.add(Number(token.tokenID));
      for (const item of (grantResult.data && grantResult.data.items) || []) {
        itemsCreated.push(buildCreatedItemPayload(item));
      }
      if (session && Number(session.characterID || session.charid || 0) === Number(characterID)) {
        for (const change of (grantResult.data && grantResult.data.changes) || []) {
          syncInventoryItemChange(
            session,
            change.item,
            change.previousState || change.previousData || {},
          );
        }
      }
    }

    if (consumedTokenIDs.size > 0) {
      writeRedeemTokensForAccount(
        accountID,
        currentTokens.filter((token) => !consumedTokenIDs.has(Number(token.tokenID))),
      );
    }

    return {
      type: "dict",
      entries: [
        ["errors", { type: "list", items: errors }],
        ["itemsCreated", { type: "list", items: itemsCreated }],
        ["activated_licenses", { type: "list", items: [] }],
        ["isk_rewarded", iskRewarded],
        ["skillpoints", skillPointsRewarded],
        ["stationID", destinationID || null],
        ["charID", characterID || null],
      ],
    };
  }

  Handle_CreateRedeemTokenQA(args, session, kwargs) {
    const accountID =
      normalizePositiveInteger(getKwargValue(kwargs, "userID", 0), 0) ||
      getAccountIDFromSession(session);
    const typeID = normalizePositiveInteger(getKwargValue(kwargs, "typeID", 0), 0);
    const quantity = Math.max(1, Math.trunc(Number(getKwargValue(kwargs, "quantity", 1)) || 1));
    if (!accountID || !typeID) {
      return false;
    }

    const currentTokens = getRedeemTokensForAccount(accountID);
    const tokenID = generateRedeemTokenID(currentTokens);
    const token = normalizeRedeemTokenRecord({
      tokenID,
      massTokenID: tokenID,
      typeID,
      quantity,
      stationID: 0,
      dateTime: currentFileTime().toString(),
      expireDateTime: normalizeFileTimeString(getKwargValue(kwargs, "expiry", "0"), "0"),
      label: String(getKwargValue(kwargs, "label", "") || ""),
      description: String(getKwargValue(kwargs, "description", "") || ""),
      blueprintRuns: getKwargValue(kwargs, "blueprintRuns", 0),
      blueprintMaterialLevel: getKwargValue(kwargs, "blueprintMaterialLevel", 0),
      blueprintProductivityLevel: getKwargValue(kwargs, "blueprintProductivityLevel", 0),
      soulbound: Boolean(getKwargValue(kwargs, "soulbound", false)),
      available: getKwargValue(kwargs, "available", true),
      addedByContext: getKwargValue(kwargs, "addedByContext", 0),
      addedByExtra: getKwargValue(kwargs, "addedByExtra", null),
    });
    writeRedeemTokensForAccount(accountID, [...currentTokens, token]);
    log.info(
      `[userSvc] CreateRedeemTokenQA user=${accountID} token=${tokenID} type=${typeID} qty=${quantity}`,
    );
    return buildRedeemTokenPayload(token);
  }

  Handle_ReverseRedeem(args) {
    log.info(`[userSvc] ReverseRedeem itemID=${args && args.length ? args[0] : "?"}`);
    return true;
  }

  Handle_TrashRedeemTokens(args, session) {
    const requestedTokens = extractRequestedRedeemTokens(args && args[0]);
    const tokenCount = requestedTokens.length;
    log.info(`[userSvc] TrashRedeemTokens tokenCount=${tokenCount}`);
    if (tokenCount > 0) {
      const accountID = getAccountIDFromSession(session);
      const remainingTokens = getRedeemTokensForAccount(accountID).filter(
        (token) => !requestedTokens.some((request) => tokenMatchesRequest(token, request)),
      );
      writeRedeemTokensForAccount(accountID, remainingTokens);
    }
    return true;
  }

  Handle_ActivateCharacterReSculpt(args, session) {
    log.info(
      `[userSvc] ActivateCharacterReSculpt char=${getCharacterIDFromSession(session)} item=${args && args.length ? args[0] : "?"}`,
    );
    return true;
  }

  Handle_CastUpvote() {
    log.debug("[userSvc] CastUpvote called");
    return true;
  }

  Handle_CastDownvote(args) {
    const feedback = args && args.length > 0 ? String(args[0] || "") : "";
    log.debug(`[userSvc] CastDownvote called feedbackLength=${feedback.length}`);
    return true;
  }

  Handle_ReportBot(args, session) {
    log.info(
      `[userSvc] ReportBot reporter=${getCharacterIDFromSession(session)} target=${args && args.length ? args[0] : "?"}`,
    );
    return true;
  }

  Handle_ReportISKSpammer(args, session) {
    log.info(
      `[userSvc] ReportISKSpammer reporter=${getCharacterIDFromSession(session)} target=${args && args.length ? args[0] : "?"}`,
    );
    return true;
  }

  Handle_GetCreateDate(args, session) {
    const characterID = getCharacterIDFromSession(session);
    const character = characterID ? getCharacterRecord(characterID) : null;
    return buildFiletimeLong(
      character && character.createDateTime
        ? character.createDateTime
        : OLD_ACCOUNT_CREATE_FILETIME,
    );
  }

  Handle_GetSessionPlaytimeMinutes() {
    return 0;
  }

  Handle_GetUserName(args, session) {
    const userID = Number(args && args.length > 0 ? args[0] : getAccountIDFromSession(session)) || 0;
    const accountRecord = getAccountRecordByUserID(userID);
    return accountRecord ? accountRecord.username : `user-${userID || "local"}`;
  }

  Handle_GetUserToken(args, session) {
    const accountID = getAccountIDFromSession(session);
    const characterID = getCharacterIDFromSession(session);
    return `evejs-local-token-${accountID || "0"}-${characterID || "0"}`;
  }

  Handle_UserLogOffCharacter(args, session) {
    log.info(
      `[userSvc] UserLogOffCharacter user=${session ? session.userid : "?"} char=${session ? session.characterID : "?"}`,
    );

    if (!session || !session.characterID) {
      return true;
    }

    const characterID = Number(session.characterID || 0);
    const disconnectResult = disconnectCharacterSession(session, {
      broadcast: true,
      clearSession: true,
    });
    if (!disconnectResult.success) {
      log.warn(
        `[userSvc] Failed to disconnect char=${characterID}: ${disconnectResult.errorMsg}`,
      );
    }

    return true;
  }
}

module.exports = UserService;
