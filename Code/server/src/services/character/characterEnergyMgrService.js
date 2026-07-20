const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const characterEnergyState = require(path.join(
  __dirname,
  "characterEnergyState",
));
const {
  buildFiletimeLong,
  buildObjectEx1,
  currentFileTime,
  normalizeBigInt,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const CHARACTER_ENERGY_STATE_CLASS =
  "characterenergy.characterEnergyState.CharacterEnergyState";
const DEFAULT_MIN_ENERGY_LEVEL = 0;
const DEFAULT_QUIESCENT_ENERGY_LEVEL = 100;
const DEFAULT_ENERGY_INCREASE_PER_RECHARGE_TICK = 1;
const DEFAULT_RECHARGE_TICK_PERIOD_SECONDS = 792;
const FILETIME_TICKS_PER_SECOND = 10_000_000n;

function resolveCharacterID(session) {
  const numericValue = Number(
    session && (session.charid || session.characterID || session.userid),
  );
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeTimestamp(value, fallback = currentFileTime()) {
  return normalizeBigInt(value, fallback);
}

function normalizeCharacterEnergyState(rawState = {}) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const minEnergyLevel = normalizeNumber(
    source.minEnergyLevel ?? source._minEnergyLevel,
    DEFAULT_MIN_ENERGY_LEVEL,
  );
  let quiescentEnergyLevel = normalizeNumber(
    source.quiescentEnergyLevel ?? source._quiescentEnergyLevel,
    DEFAULT_QUIESCENT_ENERGY_LEVEL,
  );

  if (quiescentEnergyLevel <= minEnergyLevel) {
    quiescentEnergyLevel = minEnergyLevel + 1;
  }

  const energyIncreasePerRechargeTick = Math.max(
    Number.EPSILON,
    normalizeNumber(
      source.energyIncreasePerRechargeTick ??
        source._energyIncreasePerRechargeTick,
      DEFAULT_ENERGY_INCREASE_PER_RECHARGE_TICK,
    ),
  );
  const rechargeTickPeriod = Math.max(
    Number.EPSILON,
    normalizeNumber(
      source.rechargeTickPeriod ?? source._rechargeTickPeriod,
      DEFAULT_RECHARGE_TICK_PERIOD_SECONDS,
    ),
  );

  const fallbackEnergyLevel = quiescentEnergyLevel;
  const requestedEnergyLevel = normalizeNumber(
    source.energyLevel ?? source._energyLevel,
    fallbackEnergyLevel,
  );
  const energyLevel = Math.min(
    quiescentEnergyLevel,
    Math.max(minEnergyLevel, requestedEnergyLevel),
  );

  return {
    energyLevel,
    lastRechargeTickTimestamp: normalizeTimestamp(
      source.lastRechargeTickTimestamp ?? source._lastRechargeTickTimestamp,
    ),
    energyIncreasePerRechargeTick,
    rechargeTickPeriod,
    minEnergyLevel,
    quiescentEnergyLevel,
  };
}

function buildCharacterEnergyStatePayload(rawState = {}) {
  const state = normalizeCharacterEnergyState(rawState);

  return buildObjectEx1(CHARACTER_ENERGY_STATE_CLASS, [
    state.energyLevel,
    buildFiletimeLong(state.lastRechargeTickTimestamp),
    state.energyIncreasePerRechargeTick,
    state.rechargeTickPeriod,
    state.minEnergyLevel,
    state.quiescentEnergyLevel,
  ]);
}

function getSessionStateSource(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return (
    session.characterEnergyStatesByCharacterID ||
    session.characterEnergyStateByCharacterID ||
    session.characterEnergyState ||
    null
  );
}

function calculateCharacterEnergyStateAtFileTime(rawState = {}, filetime = currentFileTime()) {
  const state = normalizeCharacterEnergyState(rawState);
  const targetFiletime = normalizeTimestamp(filetime);
  if (targetFiletime < state.lastRechargeTickTimestamp) {
    return state;
  }

  const deltaTicks = targetFiletime - state.lastRechargeTickTimestamp;
  const deltaSeconds = Number(deltaTicks) / Number(FILETIME_TICKS_PER_SECOND);
  const rechargeTicks = deltaSeconds / state.rechargeTickPeriod;
  const energyIncrease = rechargeTicks * state.energyIncreasePerRechargeTick;
  return {
    ...state,
    energyLevel: Math.min(
      state.quiescentEnergyLevel,
      state.energyLevel + energyIncrease,
    ),
    lastRechargeTickTimestamp: targetFiletime,
  };
}

function resolveRuntimeStateForCharacter(source, characterID) {
  if (!source || typeof source !== "object") {
    return null;
  }

  if (
    Object.prototype.hasOwnProperty.call(source, "energyLevel") ||
    Object.prototype.hasOwnProperty.call(source, "_energyLevel")
  ) {
    return source;
  }

  if (source instanceof Map) {
    return source.get(characterID) || source.get(String(characterID)) || null;
  }

  return source[String(characterID)] || source[characterID] || null;
}

function ensureSessionStateStore(session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (!session.characterEnergyStatesByCharacterID) {
    session.characterEnergyStatesByCharacterID = {};
  }
  return session.characterEnergyStatesByCharacterID;
}

function setRuntimeStateForCharacter(source, characterID, state) {
  if (!source || typeof source !== "object" || characterID <= 0) {
    return false;
  }
  if (source instanceof Map) {
    source.set(characterID, state);
    return true;
  }
  source[String(characterID)] = state;
  return true;
}

function notifyCharacterEnergyChanged(session, characterID, state) {
  if (!session || typeof session.sendNotification !== "function" || characterID <= 0) {
    return false;
  }
  session.sendNotification("OnCharacterEnergyChanged", "clientID", [
    characterID,
    buildCharacterEnergyStatePayload(state),
  ]);
  return true;
}

function getCharacterEnergyStateNow(session, options = {}) {
  const characterID = resolveCharacterID(session);
  const source = getSessionStateSource(session);
  const rawState =
    resolveRuntimeStateForCharacter(source, characterID) ||
    characterEnergyState.getCharacterEnergyState(characterID) ||
    {};
  return calculateCharacterEnergyStateAtFileTime(
    rawState,
    options.filetime || currentFileTime(),
  );
}

function spendCharacterEnergy(session, rawAmount, options = {}) {
  const characterID = resolveCharacterID(session);
  const amount = normalizeNumber(rawAmount, 0);
  if (characterID <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER_ENERGY_COST",
    };
  }

  const nowFiletime = normalizeTimestamp(options.filetime || currentFileTime());
  const currentState = getCharacterEnergyStateNow(session, {
    filetime: nowFiletime,
  });
  if (currentState.energyLevel - amount < currentState.minEnergyLevel) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_CHARACTER_ENERGY",
      data: {
        characterID,
        state: currentState,
      },
    };
  }

  const nextState = {
    ...currentState,
    energyLevel: currentState.energyLevel - amount,
    lastRechargeTickTimestamp: nowFiletime,
  };
  const writeResult = characterEnergyState.writeCharacterEnergyState(
    characterID,
    nextState,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "CHARACTER_ENERGY_STORAGE_FAILED",
    };
  }

  const store = ensureSessionStateStore(session);
  setRuntimeStateForCharacter(store, characterID, nextState);
  notifyCharacterEnergyChanged(session, characterID, nextState);
  log.debug(
    `[CharacterEnergyMgr] Spent ${amount} CEQ for char=${characterID}; energy=${nextState.energyLevel}/${nextState.quiescentEnergyLevel}`,
  );
  return {
    success: true,
    data: {
      characterID,
      previousState: currentState,
      state: nextState,
    },
  };
}

class CharacterEnergyMgrService extends BaseService {
  constructor(options = {}) {
    super("characterEnergyMgr");
    this._stateByCharacterID = options.stateByCharacterID || null;
  }

  getCharacterEnergyState(session) {
    const characterID = resolveCharacterID(session);
    return (
      resolveRuntimeStateForCharacter(this._stateByCharacterID, characterID) ||
      resolveRuntimeStateForCharacter(getSessionStateSource(session), characterID) ||
      characterEnergyState.getCharacterEnergyState(characterID) ||
      null
    );
  }

  Handle_GetMyEnergyState(args, session) {
    const characterID = resolveCharacterID(session);
    const state = this.getCharacterEnergyState(session);

    log.debug(
      `[CharacterEnergyMgr] GetMyEnergyState char=${characterID || "unknown"} -> ${state ? "runtime" : "default"}`,
    );

    return buildCharacterEnergyStatePayload(state || {});
  }
}

CharacterEnergyMgrService._testing = {
  CHARACTER_ENERGY_STATE_CLASS,
  DEFAULT_MIN_ENERGY_LEVEL,
  DEFAULT_QUIESCENT_ENERGY_LEVEL,
  DEFAULT_ENERGY_INCREASE_PER_RECHARGE_TICK,
  DEFAULT_RECHARGE_TICK_PERIOD_SECONDS,
  buildCharacterEnergyStatePayload,
  calculateCharacterEnergyStateAtFileTime,
  normalizeCharacterEnergyState,
};

CharacterEnergyMgrService.getCharacterEnergyStateNow = getCharacterEnergyStateNow;
CharacterEnergyMgrService.spendCharacterEnergy = spendCharacterEnergy;
CharacterEnergyMgrService.notifyCharacterEnergyChanged = notifyCharacterEnergyChanged;

module.exports = CharacterEnergyMgrService;
