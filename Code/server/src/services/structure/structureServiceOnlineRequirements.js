const path = require("path");

const { TABLE, readStaticTable } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));
const ATTRIBUTE_REQUIRES_SOV_HUB_UPGRADE = 5688;
const POWER_STATE_ONLINE = 2;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getDogmaAttributes(typeID) {
  const dogma = readStaticTable(TABLE.TYPE_DOGMA);
  const record =
    dogma &&
    dogma.typesByTypeID &&
    dogma.typesByTypeID[String(toPositiveInt(typeID, 0))];
  return record && record.attributes && typeof record.attributes === "object"
    ? record.attributes
    : {};
}

function getRequiredSovHubUpgradeTypeIDForServiceModule(moduleTypeID) {
  return toPositiveInt(
    getDogmaAttributes(moduleTypeID)[String(ATTRIBUTE_REQUIRES_SOV_HUB_UPGRADE)],
    0,
  );
}

function hasOnlineRequiredSovHubUpgrade(structure, requiredUpgradeTypeID) {
  const upgradeTypeID = toPositiveInt(requiredUpgradeTypeID, 0);
  if (!upgradeTypeID || !structure) {
    return true;
  }
  const solarSystemID = toPositiveInt(structure.solarSystemID, 0);
  if (!solarSystemID) {
    return false;
  }
  const { getSystemState } = require(path.join(__dirname, "../sovereignty/sovState"));
  const { getHubUpgrades } = require(path.join(
    __dirname,
    "../sovereignty/sovModernState",
  ));
  const systemState = getSystemState(solarSystemID);
  const hubID = toPositiveInt(systemState && systemState.infrastructureHubID, 0);
  if (!systemState || !hubID) {
    return false;
  }
  const structureAllianceID = toPositiveInt(structure.allianceID, 0);
  const sovAllianceID = toPositiveInt(systemState.allianceID, 0);
  if (!structureAllianceID || !sovAllianceID || structureAllianceID !== sovAllianceID) {
    return false;
  }
  const upgradeSnapshot = getHubUpgrades(hubID);
  const upgrades = Array.isArray(upgradeSnapshot && upgradeSnapshot.upgrades)
    ? upgradeSnapshot.upgrades
    : [];
  return upgrades.some((upgrade) => (
    toPositiveInt(upgrade && (upgrade.typeID || upgrade.installationTypeID), 0) ===
      upgradeTypeID &&
    toInt(upgrade && upgrade.powerState, 0) === POWER_STATE_ONLINE
  ));
}

function validateServiceModuleOnlineRequirements(structure, moduleTypeID) {
  const requiredUpgradeTypeID =
    getRequiredSovHubUpgradeTypeIDForServiceModule(moduleTypeID);
  if (
    requiredUpgradeTypeID &&
    !hasOnlineRequiredSovHubUpgrade(structure, requiredUpgradeTypeID)
  ) {
    return {
      success: false,
      errorMsg: "STRUCTURE_SERVICE_REQUIRES_SOV_UPGRADE",
      requiredUpgradeTypeID,
      changes: [],
    };
  }
  return { success: true, requiredUpgradeTypeID };
}

module.exports = {
  ATTRIBUTE_REQUIRES_SOV_HUB_UPGRADE,
  getRequiredSovHubUpgradeTypeIDForServiceModule,
  hasOnlineRequiredSovHubUpgrade,
  validateServiceModuleOnlineRequirements,
};
