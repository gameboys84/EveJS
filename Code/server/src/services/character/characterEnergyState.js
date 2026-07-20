const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const {
  currentFileTime,
  normalizeBigInt,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const CHARACTER_ENERGY_STATE_TABLE = "characterEnergyState";
const CHARACTER_ENERGY_STATE_VERSION = 1;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCharacterID(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function characterPath(characterID) {
  return `/characters/${String(characterID)}`;
}

function normalizeStorageTimestamp(value) {
  return normalizeBigInt(value, currentFileTime()).toString();
}

function normalizeStorageState(rawState = {}) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  return {
    energyLevel: normalizeNumber(
      source.energyLevel ?? source._energyLevel,
      0,
    ),
    lastRechargeTickTimestamp: normalizeStorageTimestamp(
      source.lastRechargeTickTimestamp ?? source._lastRechargeTickTimestamp,
    ),
    energyIncreasePerRechargeTick: normalizeNumber(
      source.energyIncreasePerRechargeTick ??
        source._energyIncreasePerRechargeTick,
      1,
    ),
    rechargeTickPeriod: normalizeNumber(
      source.rechargeTickPeriod ?? source._rechargeTickPeriod,
      792,
    ),
    minEnergyLevel: normalizeNumber(
      source.minEnergyLevel ?? source._minEnergyLevel,
      0,
    ),
    quiescentEnergyLevel: normalizeNumber(
      source.quiescentEnergyLevel ?? source._quiescentEnergyLevel,
      100,
    ),
    updatedAtFiletime: currentFileTime().toString(),
  };
}

function readCharacterEnergyTable() {
  const result = database.read(CHARACTER_ENERGY_STATE_TABLE, "/");
  if (result.success && result.data && typeof result.data === "object") {
    return cloneValue({
      _meta: {
        version: CHARACTER_ENERGY_STATE_VERSION,
        ...(result.data._meta && typeof result.data._meta === "object"
          ? result.data._meta
          : {}),
      },
      characters:
        result.data.characters && typeof result.data.characters === "object"
          ? result.data.characters
          : {},
    });
  }

  return {
    _meta: {
      version: CHARACTER_ENERGY_STATE_VERSION,
    },
    characters: {},
  };
}

function getCharacterEnergyState(characterID) {
  const normalizedCharacterID = normalizeCharacterID(characterID);
  if (!normalizedCharacterID) {
    return null;
  }

  const result = database.read(
    CHARACTER_ENERGY_STATE_TABLE,
    characterPath(normalizedCharacterID),
  );
  if (!result.success || !result.data || typeof result.data !== "object") {
    return null;
  }
  return cloneValue(result.data);
}

function writeCharacterEnergyState(characterID, rawState) {
  const normalizedCharacterID = normalizeCharacterID(characterID);
  if (!normalizedCharacterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const writeMetaResult = database.write(
    CHARACTER_ENERGY_STATE_TABLE,
    "/_meta/version",
    CHARACTER_ENERGY_STATE_VERSION,
  );
  if (!writeMetaResult || !writeMetaResult.success) {
    return {
      success: false,
      errorMsg: writeMetaResult && writeMetaResult.errorMsg
        ? writeMetaResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  const writeResult = database.write(
    CHARACTER_ENERGY_STATE_TABLE,
    characterPath(normalizedCharacterID),
    normalizeStorageState(rawState),
  );
  if (!writeResult || !writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "WRITE_ERROR",
    };
  }

  return {
    success: true,
  };
}

module.exports = {
  CHARACTER_ENERGY_STATE_TABLE,
  readCharacterEnergyTable,
  getCharacterEnergyState,
  writeCharacterEnergyState,
};
