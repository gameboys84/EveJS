/**
 * Dogma IM Service (dogmaIM)
 *
 * Handles dogma (attributes/effects) related calls.
 */
const path = require("path");
const database = require(path.join(__dirname, "../../gameStore"));
const BaseService = require(path.join(__dirname, "../baseService"));
const {
  resolveSessionCharacterID,
} = require(path.join(__dirname, "../_shared/sessionIdentity"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  findCharacterShip,
  activateShipForSession,
  buildItemChangePayload,
  buildChargeSublocationItem,
  syncInventoryItemForSession,
  syncChargeGodmaPrimeForSession,
  syncShipFittingStateForSession,
  buildChargeDogmaPrimeEntry,
  syncDamageStateAttributesForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getShipConditionState,
  normalizeShipConditionState,
  ITEM_FLAGS,
  SHIP_CATEGORY_ID,
  getItemMutationVersion,
  findCharacterShipByType,
  findItemById,
  grantItemToCharacterLocation,
  grantItemToOwnerLocation,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
  syncCapsuleTypeForCharacter,
  updateInventoryItem,
  updateShipItem,
  mergeItemStacks,
  consumeInventoryItemQuantity,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getCharacterSkills,
  getCharacterSkillPointTotal,
  getSkillMutationVersion,
  SKILL_FLAG_ID,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  injectSkillbookItems,
} = require(path.join(__dirname, "../skills/skillbooks/skillbookRuntime"));
const {
  useBoosterItem,
} = require(path.join(__dirname, "../skills/boosters/boosterRuntime"));
const {
  getLocationModifierSourcesForSystem,
  buildSystemWideEffectsPayloadForSystem,
  buildEmptySystemWideEffectsPayload,
} = require(path.join(
  __dirname,
  "../exploration/wormholes/wormholeEnvironmentRuntime",
));
const HackingMgrService = require(path.join(
  __dirname,
  "../exploration/hackingMgrService",
));
const {
  getAttributeIDByNames,
  getFittedModuleItems,
  getFittedModuleByFlag,
  getItemModuleState,
  getLoadedChargeByFlag,
  getLoadedChargeItems,
  getModuleChargeCapacity,
  getEffectIDByNames,
  isFittedChargeItem,
  isFittedModuleItem,
  isModuleOnline,
  isEffectivelyOnlineModule,
  isChargeCompatibleWithModule,
  buildChargeTupleItemID,
  buildModuleStatusSnapshot,
  buildCharacterTargetingState,
  buildEffectiveItemAttributeMap,
  buildSkillEffectiveAttributes,
  getTypeDogmaAttributes,
  getTypeAttributeValue,
  getRequiredSkillRequirements,
  isShipFittingFlag,
  listHiddenModifierItems,
  listFittedItemsForLocation,
  applyModifierGroups,
  typeHasEffectName,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getShipFittingSnapshot,
  refreshShipFittingSnapshot,
  invalidateShipFittingSnapshot,
  listShipFittingAttributeChanges,
} = require(path.join(
  __dirname,
  "../../_secondary/fitting/fittingRuntime",
));
const {
  buildModuleAttributeChangeEvent,
  buildGodmaShipEffectEvent,
  sendOnMultiEvent,
} = require(path.join(__dirname, "../_shared/godmaMultiEvent"));
const {
  ensureShipFittingInventoryParity,
} = require(path.join(__dirname, "../fitting/fittingIntegrity"));
const {
  resolveCharacterIndustryAttributes,
} = require(path.join(__dirname, "./brain/providers/industryBrainProvider"));
const {
  applyActiveImplantLocationModifiersToAttributes,
  applyActiveImplantAttributeBonuses,
} = require(path.join(__dirname, "./implants/activeImplantModifiers"));
const {
  applyClientTrainingSpeedScale,
} = require(path.join(__dirname, "../skills/training/skillTrainingSpeed"));
const {
  destroyImplantItem,
  installImplantItem,
} = require(path.join(__dirname, "./implants/implantRuntime"));
const {
  ATTRIBUTE_MAX_JUMP_CLONES,
  ATTRIBUTE_CLONE_JUMP_COOLDOWN,
  getCharacterCloneLimit,
  getCharacterCloneJumpCooldownHours,
} = require(path.join(__dirname, "../station/jumpCloneRules"));
const probeRuntimeState = require(path.join(
  __dirname,
  "../exploration/probes/probeRuntimeState",
));
const probeScanRuntime = require(path.join(
  __dirname,
  "../exploration/probes/probeScanRuntime",
));
const probeSceneRuntime = require(path.join(
  __dirname,
  "../exploration/probes/probeSceneRuntime",
));
const interdictionProbeRuntime = require(path.join(
  __dirname,
  "../ship/interdictionProbeRuntime",
));
const warpDisruptFieldGeneratorRuntime = require(path.join(
  __dirname,
  "../ship/warpDisruptFieldGeneratorRuntime",
));
const {
  buildBootstrapCharacterBrain,
  buildCharacterBrainDefinitionSet,
  syncCharacterDogmaState,
} = require(path.join(__dirname, "./brain/characterBrainRuntime"));
const {
  buildWeaponBankStateDict,
  getShipWeaponBanks,
  getMasterModuleID: getWeaponBankMasterModuleID,
  getModulesInBank,
  linkWeapons: linkWeaponBanks,
  mergeModuleGroups,
  peelAndLink,
  unlinkModuleFromBank,
  linkAllWeapons: linkAllWeaponBanks,
  unlinkAllWeaponBanks,
  destroyWeaponBank,
  destroyWeaponBankAndNotify,
} = require(path.join(__dirname, "../moduleGrouping/moduleGroupingRuntime"));
const {
  buildWeaponDogmaAttributeOverrides,
  collectCharacterModifierAttributes,
} = require(path.join(__dirname, "../../space/combat/weaponDogma"));
const {
  extractDictEntries,
  extractList,
  normalizeNumber,
  currentFileTime,
  buildList,
  buildKeyVal,
  buildPackedRow,
  buildMarshalReal,
  buildDict,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  consumeStructureServiceModuleOnlineFuel,
  buildStructureServiceModuleEffectiveAttributeMap,
  isStructureDamagedForServiceOnline,
  isStructureServiceModuleItem,
  syncStructureServiceModuleState,
} = require(path.join(__dirname, "../structure/structureServiceModules"));
const {
  buildCrpAccessDeniedInsufficientRolesValues,
  characterCanDisableStructureServiceModule,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  resolveStructureEffectiveHitpoints,
} = require(path.join(__dirname, "../structure/structureFullPowerDogma"));
const {
  boardRookieShipForSession,
  isRookieShipItem,
  repairShipAndFittedItemsForSession,
  resolveRookieShipTypeID,
} = require(path.join(__dirname, "../ship/rookieShipRuntime"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

function recordSpaceBootstrapTrace(session, event, details = {}) {
  if (
    !session ||
    !log.isVerboseDebugEnabled() ||
    !spaceRuntime ||
    typeof spaceRuntime.recordSessionJumpTimingTrace !== "function"
  ) {
    return false;
  }
  return (
    spaceRuntime.recordSessionJumpTimingTrace(session, event, details) === true
  );
}

const REMOVED_ITEM_JUNK_LOCATION_ID = 6;
const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;
const ATTRIBUTE_MANUFACTURE_SLOT_LIMIT = 196;
const ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER = 219;
const ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED = 385;
const ATTRIBUTE_COPY_SPEED_PERCENT = 387;
const ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED = 398;
const ATTRIBUTE_MAX_LABORATORY_SLOTS = 467;
const ATTRIBUTE_INVENTION_RESEARCH_SPEED = 1959;
const ATTRIBUTE_REACTION_TIME_MULTIPLIER = 2662;
const ATTRIBUTE_REACTION_SLOT_LIMIT = 2664;
const ATTRIBUTE_PILOT_SECURITY_STATUS = 2610;
const ATTRIBUTE_ITEM_DAMAGE = 3;
const ATTRIBUTE_HP = getAttributeIDByNames("hp", "structureHP") || 9;
const ATTRIBUTE_STRUCTURE_HP = ATTRIBUTE_HP;
const ATTRIBUTE_MASS = 4;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_MAX_TARGET_RANGE =
  getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_MAX_GROUP_ONLINE =
  getAttributeIDByNames("maxGroupOnline") || 978;
const ATTRIBUTE_FALLOFF = getAttributeIDByNames("falloff") || 158;
const ATTRIBUTE_FALLOFF_EFFECTIVENESS =
  getAttributeIDByNames("falloffEffectiveness") || 2044;
const FALLOFF_EFFECTIVENESS_MODULE_GROUPS = new Set([
  71, // groupEnergyDestabilizer
  68, // groupEnergyVampire
  67, // groupEnergyTransferArray
  325, // groupArmorRepairProjector
  41, // groupShieldTransporter
  585, // groupRemoteHullRepairer
  208, // groupRemoteSensorDamper
  201, // groupElectronicCounterMeasures
  290, // groupRemoteSensorBooster
  209, // groupTrackingLink
  1672, // groupStasisGrappler
  379, // groupTargetPainter
  291, // groupTrackingDisruptor
  1697, // groupFueledRemoteShieldBooster
]);
// CCP parity: attribute 18 ("charge") is the current capacitor energy level in
// GJ.  The client reads shipItem.charge to display the capacitor gauge.
const ATTRIBUTE_CHARGE = 18;
const ATTRIBUTE_CAPACITY = 38;
const ATTRIBUTE_POWER_LOAD = getAttributeIDByNames("powerLoad") || 15;
const ATTRIBUTE_CPU_LOAD = getAttributeIDByNames("cpuLoad") || 49;
const ATTRIBUTE_CAPACITOR_CAPACITY =
  getAttributeIDByNames("capacitorCapacity") || 482;
const ATTRIBUTE_MAX_LOCKED_TARGETS =
  getAttributeIDByNames("maxLockedTargets") || 192;
const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;
const LIVE_SPACE_TUPLE_CHARGE_PROFILES = new Set([
  "login",
  "stargate",
  "solar",
  "solarWarm",
  "transition",
  "undock",
]);
const ATTRIBUTE_RECHARGE_RATE = getAttributeIDByNames("rechargeRate") || 55;
const ATTRIBUTE_VOLUME = 161;
const ATTRIBUTE_RADIUS = 162;
const ATTRIBUTE_CLOAKING_TARGETING_DELAY =
  getAttributeIDByNames("cloakingTargetingDelay") || 560;
const ATTRIBUTE_SCAN_RESOLUTION =
  getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_SIGNATURE_RADIUS =
  getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_RELOAD_TIME = getAttributeIDByNames("reloadTime") || 1795;
const ATTRIBUTE_NEXT_ACTIVATION_TIME =
  getAttributeIDByNames("nextActivationTime") || 1796;
const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP =
  getAttributeIDByNames("damageMultiplierBonusMaxTimestamp") || 5818;
const ATTRIBUTE_DRONE_IS_AGGRESSIVE =
  getAttributeIDByNames("droneIsAggressive") || 1275;
const ATTRIBUTE_DRONE_FOCUS_FIRE =
  getAttributeIDByNames("droneFocusFire") || 1297;
const ATTRIBUTE_MODULE_REPAIR_RATE =
  getAttributeIDByNames("moduleRepairRate") || 1267;
const ATTRIBUTE_SHIP_BROKEN_MODULE_REPAIR_COST_MULTIPLIER =
  getAttributeIDByNames("shipBrokenModuleRepairCostMultiplier") || 1277;
const ATTRIBUTE_SHIP_BROKEN_REPAIR_COST_MULTIPLIER_BONUS =
  getAttributeIDByNames("shipBrokenRepairCostMultiplierBonus") || 1294;
const ATTRIBUTE_MODULE_REPAIR_RATE_BONUS =
  getAttributeIDByNames("moduleRepairRateBonus") || 1295;
const INTEGER_NOTIFY_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const DRONE_CATEGORY_ID = 18;
const SCANNER_PROBE_CATEGORY_ID = 8;
const GROUP_SCAN_PROBE_LAUNCHER = 481;
const GROUP_SCANNER_PROBE = 479;
const GROUP_INTERDICTION_SPHERE_LAUNCHER =
  interdictionProbeRuntime.GROUP_INTERDICTION_SPHERE_LAUNCHER;
const GROUP_WARP_DISRUPT_FIELD_GENERATOR =
  warpDisruptFieldGeneratorRuntime.GROUP_WARP_DISRUPT_FIELD_GENERATOR;
const ANALYZER_EFFECT_NAME = "doHacking";
const ANALYZER_HACKING_SKILL_TYPE_ID = 21718;
const ANALYZER_ARCHAEOLOGY_SKILL_TYPE_ID = 13278;
const ANALYZER_GAME_TYPE_HACKING = 0;
const ANALYZER_GAME_TYPE_ARCHEOLOGY = 1;
const ATTRIBUTE_VIRUS_COHERENCE =
  getAttributeIDByNames("virusCoherence") || 1909;
const ATTRIBUTE_VIRUS_STRENGTH =
  getAttributeIDByNames("virusStrength") || 1910;
const ATTRIBUTE_VIRUS_ELEMENT_SLOTS =
  getAttributeIDByNames("virusElementSlots", "virusUtilityElementSlots") || 1911;
const ATTRIBUTE_ACCESS_DIFFICULTY_BONUS =
  getAttributeIDByNames("accessDifficultyBonus") || 902;
const ANALYZER_ACCESS_BONUS_DIFFICULTY_DIVISOR = 5;
const HACKING_STATE_BEING_HACKED = 1;
const HACKING_STATE_HACKED = 2;
const CATEGORY_MODULE = 7;
const CATEGORY_STRUCTURE_MODULE = 66;
const TYPE_NANITE_REPAIR_PASTE = 28668;
const SKILL_NANITE_OPERATION = 28879;
const SKILL_NANITE_INTERFACING = 28880;
const ATTRIBUTE_SHIELD_CAPACITY = 263;
const ATTRIBUTE_SHIELD_CHARGE_HELPER = 264;
const ATTRIBUTE_ARMOR_HP = 265;
const ATTRIBUTE_ARMOR_DAMAGE = 266;
const MODULE_ATTRIBUTE_CAPACITOR_NEED =
  getAttributeIDByNames("capacitorNeed") || 6;
const MODULE_ATTRIBUTE_SPEED_FACTOR = getAttributeIDByNames("speedFactor") || 20;
const MODULE_ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MODULE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
function clampRatio(value, fallback = 1) {
  const numericValue = normalizeNumber(value, fallback);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  if (numericValue <= 0) {
    return 0;
  }
  if (numericValue >= 1) {
    return 1;
  }
  return numericValue;
}
const MODULE_ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const CHARACTER_TYPE_ID = 1373;
const CHARACTER_GROUP_ID = 1;
const CHARACTER_CATEGORY_ID = 3;
const FLAG_PILOT = 57;
const DBTYPE_I2 = 0x02;
const DBTYPE_I4 = 0x03;
const DBTYPE_R8 = 0x05;
const DBTYPE_BOOL = 0x0b;
const DBTYPE_I8 = 0x14;
const DBTYPE_STR = 0x81;
const ONLINE_CAPACITOR_CHARGE_RATIO = 95;
const ONLINE_CAPACITOR_REMAINDER_RATIO = 5;
const USER_ERROR_TYPE_ID = 4;
const USER_ERROR_GROUP_ID = 7;
const EFFECT_ONLINE = getEffectIDByNames("online") || 16;
const EFFECT_AFTERBURNER =
  getEffectIDByNames("moduleBonusAfterburner") || 6731;
const EFFECT_MICROWARPDRIVE =
  getEffectIDByNames("moduleBonusMicrowarpdrive") || 6730;
const INSTANCE_ROW_DESCRIPTOR_COLUMNS = [
  ["instanceID", DBTYPE_I8],
  ["online", DBTYPE_BOOL],
  ["damage", DBTYPE_R8],
  ["charge", DBTYPE_R8],
  ["skillPoints", DBTYPE_I4],
  ["armorDamage", DBTYPE_R8],
  ["shieldCharge", DBTYPE_R8],
  ["incapacitated", DBTYPE_BOOL],
];
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", DBTYPE_I8],
  ["typeID", DBTYPE_I4],
  ["ownerID", DBTYPE_I4],
  ["locationID", DBTYPE_I8],
  ["flagID", DBTYPE_I2],
  ["quantity", DBTYPE_I4],
  ["groupID", DBTYPE_I4],
  ["categoryID", DBTYPE_I4],
  ["customInfo", DBTYPE_STR],
];
const INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS = [
  ["stacksize", { type: "token", value: "eve.common.script.sys.eveCfg.StackSize" }],
  ["singleton", { type: "token", value: "eve.common.script.sys.eveCfg.Singleton" }],
];
const pendingModuleReloads = new Map();
let pendingModuleReloadTimer = null;
const RELOAD_PUMP_POLL_MS = 50;
const VALID_DRONE_SETTING_ATTRIBUTE_IDS = new Set([
  ATTRIBUTE_DRONE_IS_AGGRESSIVE,
  ATTRIBUTE_DRONE_FOCUS_FIRE,
]);
function isNewbieShipItem(item) {
  return isRookieShipItem(item);
}
function resolveNewbieShipTypeID(session, characterRecord = null) {
  return resolveRookieShipTypeID(
    session,
    characterRecord || getCharacterRecord(session && session.characterID) || {},
  );
}
function boardNewbieShipForSession(session, options = {}) {
  const boardResult = boardRookieShipForSession(session, {
    ...options,
    logLabel: String(options.logLabel || "BoardNewbieShip"),
  });
  if (
    boardResult &&
    boardResult.success &&
    boardResult.data &&
    boardResult.data.ship
  ) {
    log.info(
      `[DogmaIM] ${String(options.logLabel || "BoardNewbieShip")} boarded char=${Number(session && session.characterID) || 0} ship=${boardResult.data.ship.itemID} typeID=${boardResult.data.corvetteTypeID} reusedExisting=${boardResult.data.reusedExistingShip === true}`,
    );
  }
  return boardResult;
}
function marshalModuleDurationWireValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (value && typeof value === "object" && value.type === "real") {
    return value;
  }
  const numericValue = normalizeNumber(value, Number.NaN);
  if (!Number.isFinite(numericValue)) {
    return value;
  }
  if (numericValue < 0) {
    return Math.trunc(numericValue);
  }
  return buildMarshalReal(numericValue, 0);
}
function isModuleTimingAttribute(attributeID) {
  const numericAttributeID = Number(attributeID) || 0;
  return (
    numericAttributeID === MODULE_ATTRIBUTE_DURATION ||
    numericAttributeID === MODULE_ATTRIBUTE_SPEED
  );
}
function isMarshalRealDogmaAttribute(attributeID) {
  const numericAttributeID = Number(attributeID) || 0;
  return (
    isModuleTimingAttribute(numericAttributeID) ||
    numericAttributeID === ATTRIBUTE_RECHARGE_RATE ||
    numericAttributeID === ATTRIBUTE_CAPACITOR_CAPACITY
  );
}
function marshalDogmaAttributeValue(attributeID, value) {
  if ((Number(attributeID) || 0) === ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP) {
    if (typeof value === "bigint") {
      return value;
    }
    const numericValue = normalizeNumber(value, Number.NaN);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }
    return toFileTimeFromMs(numericValue);
  }
  return isMarshalRealDogmaAttribute(attributeID)
    ? marshalModuleDurationWireValue(value)
    : value;
}
function normalizeModuleAttributeChange(change) {
  if (!Array.isArray(change) || change.length === 0) {
    return change;
  }
  const normalized = change.slice();
  // TQ parity: every inner change is a tuple tagged with the SINGULAR
  // 'OnModuleAttributeChange' (the plural is the outer notification name), and its
  // trailing element repeats the change time at index 4 — never null.
  normalized[0] = "OnModuleAttributeChange";
  const attributeID = normalized[3];
  if (normalized.length > 5) {
    normalized[5] = marshalDogmaAttributeValue(attributeID, normalized[5]);
  }
  if (normalized.length > 6) {
    normalized[6] = marshalDogmaAttributeValue(attributeID, normalized[6]);
  }
  normalized[7] = normalized.length > 4 ? normalized[4] : null;
  return normalized;
}
function summarizeDogmaLogValue(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => summarizeDogmaLogValue(entry));
  }
  if (value && typeof value === "object") {
    if (
      Array.isArray(value.entries) ||
      Array.isArray(value.items)
    ) {
      return JSON.parse(JSON.stringify(value, (key, entryValue) => (
        typeof entryValue === "bigint"
          ? entryValue.toString()
          : entryValue
      )));
    }
    return `[${value.constructor && value.constructor.name ? value.constructor.name : "object"}]`;
  }
  return value;
}
function summarizeModuleAttributeChangeLog(change) {
  const normalized = normalizeModuleAttributeChange(change);
  if (!Array.isArray(normalized)) {
    return summarizeDogmaLogValue(normalized);
  }
  return {
    target: summarizeDogmaLogValue(normalized[2]),
    attributeID: Number(normalized[3]) || 0,
    timestamp: summarizeDogmaLogValue(normalized[4]),
    newValue: summarizeDogmaLogValue(normalized[5]),
    oldValue: summarizeDogmaLogValue(normalized[6]),
  };
}
function summarizeModuleItemForLog(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    itemID: Number(item.itemID) || 0,
    typeID: Number(item.typeID) || 0,
    locationID: Number(item.locationID) || 0,
    flagID: Number(item.flagID) || 0,
    groupID: Number(item.groupID) || 0,
    categoryID: Number(item.categoryID) || 0,
    online: isEffectivelyOnlineModule(item),
    quantity: Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0),
  };
}
function summarizeRuntimeEffectForLog(effect) {
  if (!effect || typeof effect !== "object") {
    return null;
  }
  return {
    effectID: Number(effect.effectID) || 0,
    effectName: String(effect.effectName || ""),
    targetID: Number(effect.targetID) || 0,
    repeat: Number(effect.repeat) || 0,
    durationMs: Number(effect.durationMs) || 0,
    startedAtMs: Number(effect.startedAtMs) || 0,
    pendingDeactivation: effect.pendingDeactivation === true,
    isGeneric: effect.isGeneric === true,
  };
}
function extractKeyValEntries(value) {
  if (
    value &&
    typeof value === "object" &&
    value.name === "util.KeyVal" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    return value.args.entries;
  }
  return extractDictEntries(value);
}
function buildAmmoLoadRequest(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    const itemID = Math.trunc(Number(value) || 0);
    return itemID > 0 ? { itemID, typeID: 0, quantity: null } : null;
  }
  if (typeof value === "string") {
    const itemID = Math.trunc(Number(value) || 0);
    return itemID > 0 ? { itemID, typeID: 0, quantity: null } : null;
  }
  if (Array.isArray(value)) {
    const numericValues = value.map((entry) => Math.trunc(normalizeNumber(entry, 0)));
    if (numericValues.length === 0) {
      return null;
    }
    if (numericValues.length === 1) {
      return numericValues[0] > 0
        ? { itemID: numericValues[0], typeID: 0, quantity: null }
        : null;
    }
    if (numericValues.length === 2) {
      return numericValues[0] > 0
        ? {
            itemID: 0,
            typeID: numericValues[0],
            quantity: numericValues[1] > 0 ? numericValues[1] : null,
          }
        : null;
    }
    // Charge sublocation tuples commonly end with the charge typeID.
    return numericValues[numericValues.length - 1] > 0
      ? {
          itemID: 0,
          typeID: numericValues[numericValues.length - 1],
          quantity: numericValues.length > 1 && numericValues[1] > 0
            ? numericValues[1]
            : null,
        }
      : null;
  }
  if (value && typeof value === "object" && value.type === "packedrow" && value.fields) {
    return buildAmmoLoadRequest(value.fields);
  }
  if (value && typeof value === "object" && value.type === "list") {
    return buildAmmoLoadRequest(extractList(value));
  }
  if (value && typeof value === "object") {
    const mapped = {};
    for (const [key, entryValue] of extractKeyValEntries(value)) {
      mapped[String(key)] = entryValue;
    }
    const source = Object.keys(mapped).length > 0 ? mapped : value;
    let itemID = 0;
    let typeID = 0;
    let quantity = null;
    if (Array.isArray(source.itemID)) {
      const tupleRequest = buildAmmoLoadRequest(source.itemID);
      itemID = tupleRequest ? tupleRequest.itemID || 0 : 0;
      typeID = tupleRequest ? tupleRequest.typeID || 0 : 0;
      quantity = tupleRequest ? tupleRequest.quantity : null;
    } else {
      itemID = Math.trunc(normalizeNumber(
        source.itemID ??
          source.chargeItemID ??
          source.chargeID,
        0,
      ));
      typeID = Math.trunc(normalizeNumber(
        source.typeID ??
          source.chargeTypeID ??
          source.ammoTypeID,
        0,
      ));
      quantity = Math.trunc(normalizeNumber(
        source.quantity ??
          source.qty ??
          source.chargeQty ??
          source.stacksize,
        0,
      )) || null;
    }
    if (itemID <= 0 && typeID <= 0) {
      return null;
    }
    return {
      itemID: itemID > 0 ? itemID : 0,
      typeID: typeID > 0 ? typeID : 0,
      quantity,
    };
  }
  return null;
}
function normalizeAmmoLoadRequests(rawValue) {
  const listValues = extractList(rawValue);
  const sourceValues = listValues.length > 0 ? listValues : [rawValue];
  const requests = [];
  const seen = new Set();
  for (const sourceValue of sourceValues) {
    const request = buildAmmoLoadRequest(sourceValue);
    if (!request) {
      continue;
    }
    const dedupeKey = `${request.itemID || 0}:${request.typeID || 0}:${request.quantity || 0}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    requests.push(request);
  }
  return requests;
}
function extractSequenceValues(value) {
  if (Array.isArray(value)) {
    return value;
  }
  const listValues = extractList(value);
  if (listValues.length > 0) {
    return listValues;
  }
  if (
    value &&
    typeof value === "object" &&
    value.type === "tuple" &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }
  if (
    value &&
    typeof value === "object" &&
    value.type === "substream"
  ) {
    return extractSequenceValues(value.value);
  }
  return [];
}
function summarizeAmmoLoadRequests(requests = []) {
  return requests.map((request) => (
    request.itemID > 0
      ? `item:${request.itemID}`
      : `type:${request.typeID}${request.quantity ? `x${request.quantity}` : ""}`
  ));
}
function toFileTimeFromMs(value, fallback = currentFileTime()) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return BigInt(Math.trunc(numericValue)) * 10000n + 116444736000000000n;
}
function getSessionSimulationTimeMs(session, fallback = Date.now()) {
  if (session && session._space) {
    return spaceRuntime.getSimulationTimeMsForSession(session, fallback);
  }
  return fallback;
}
function getSessionSimulationFileTime(session, fallback = currentFileTime()) {
  if (session && session._space) {
    return spaceRuntime.getSimulationFileTimeForSession(session, fallback);
  }
  return fallback;
}
function getReloadStateCurrentTimeMs(reloadState, fallback = Date.now()) {
  const session = reloadState && reloadState.session;
  if (session && session._space) {
    return getSessionSimulationTimeMs(session, fallback);
  }
  const systemID = Number(reloadState && reloadState.systemID) || 0;
  if (systemID > 0) {
    return spaceRuntime.getSimulationTimeMsForSystem(systemID, fallback);
  }
  return fallback;
}
function normalizeReloadSourceItemIDs(rawItemIDs = []) {
  return [...new Set(
    (Array.isArray(rawItemIDs) ? rawItemIDs : [rawItemIDs])
      .map((itemID) => Number(itemID) || 0)
      .filter((itemID) => itemID > 0),
  )];
}
function schedulePendingModuleReloadPump() {
  if (pendingModuleReloadTimer) {
    clearTimeout(pendingModuleReloadTimer);
    pendingModuleReloadTimer = null;
  }
  if (pendingModuleReloads.size === 0) {
    return;
  }
  pendingModuleReloadTimer = setTimeout(() => {
    pendingModuleReloadTimer = null;
    if (
      DogmaService._testing &&
      typeof DogmaService._testing.flushPendingModuleReloads === "function"
    ) {
      DogmaService._testing.flushPendingModuleReloads();
    }
  }, RELOAD_PUMP_POLL_MS);
  if (typeof pendingModuleReloadTimer.unref === "function") {
    pendingModuleReloadTimer.unref();
  }
}
function typeHasDogmaAttribute(typeID, attributeID) {
  const attributes = getTypeDogmaAttributes(typeID);
  return Object.prototype.hasOwnProperty.call(
    attributes || {},
    String(attributeID),
  );
}
function resolveMaxGroupOnlineLimit(moduleItem, fittedItems = []) {
  const groupID = Number(moduleItem && moduleItem.groupID) || 0;
  if (groupID <= 0) {
    return null;
  }
  let maxGroupOnline = null;
  let limitingTypeID = 0;
  for (const fittedItem of Array.isArray(fittedItems) ? fittedItems : []) {
    if (Number(fittedItem && fittedItem.groupID) !== groupID) {
      continue;
    }
    if (!typeHasDogmaAttribute(fittedItem && fittedItem.typeID, ATTRIBUTE_MAX_GROUP_ONLINE)) {
      continue;
    }
    const attributes = buildEffectiveItemAttributeMap(fittedItem);
    const value = Number(attributes[ATTRIBUTE_MAX_GROUP_ONLINE]);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    const normalizedValue = Math.trunc(value);
    if (maxGroupOnline === null || normalizedValue < maxGroupOnline) {
      maxGroupOnline = normalizedValue;
      limitingTypeID = Number(fittedItem && fittedItem.typeID) || 0;
    }
  }
  if (maxGroupOnline === null) {
    return null;
  }
  const onlineGroupCount = (Array.isArray(fittedItems) ? fittedItems : [])
    .filter((fittedItem) =>
      Number(fittedItem && fittedItem.groupID) === groupID &&
      isEffectivelyOnlineModule(fittedItem)
    ).length;
  return {
    groupID,
    maxGroupOnline,
    onlineGroupCount,
    limitingTypeID,
  };
}
class DogmaService extends BaseService {
  constructor() {
    super("dogmaIM");
  }
  _getDockedItemInfoCache(session, options = {}) {
    if (!session || !isDockedSession(session)) {
      return null;
    }
    const charID = this._getCharID(session);
    const shipID = this._getShipID(session);
    if (charID <= 0 || shipID <= 0) {
      return null;
    }
    const cacheToken = [
      charID,
      shipID,
      getItemMutationVersion(),
      getSkillMutationVersion(),
    ].join(":");
    const allowCreate = options.allowCreate !== false;
    const cached =
      session._dockedDogmaItemInfoCache &&
      typeof session._dockedDogmaItemInfoCache === "object"
        ? session._dockedDogmaItemInfoCache
        : null;
    if (
      cached &&
      cached.token === cacheToken &&
      cached.entries instanceof Map
    ) {
      return cached;
    }
    if (!allowCreate) {
      return null;
    }
    const nextCache = {
      token: cacheToken,
      entries: new Map(),
    };
    session._dockedDogmaItemInfoCache = nextCache;
    return nextCache;
  }
  _buildDockedItemInfoCacheKey(requestedItemID, item = null) {
    if (Array.isArray(requestedItemID)) {
      return `tuple:${JSON.stringify(
        requestedItemID.map((value) => Number(value) || 0),
      )}`;
    }
    const numericRequestedItemID =
      Number.parseInt(String(requestedItemID), 10) || 0;
    if (numericRequestedItemID > 0) {
      return `item:${numericRequestedItemID}`;
    }
    const numericItemID = Number(item && item.itemID) || 0;
    return numericItemID > 0 ? `item:${numericItemID}` : null;
  }
  _getCachedDockedItemInfoEntry(session, requestedItemID, item = null) {
    const cache = this._getDockedItemInfoCache(session, {
      allowCreate: false,
    });
    if (!cache) {
      return null;
    }
    const cacheKey = this._buildDockedItemInfoCacheKey(requestedItemID, item);
    return cacheKey ? cache.entries.get(cacheKey) || null : null;
  }
  _cacheDockedItemInfoEntry(session, requestedItemID, item, entry) {
    if (!entry) {
      return entry;
    }
    const cache = this._getDockedItemInfoCache(session, {
      allowCreate: true,
    });
    if (!cache) {
      return entry;
    }
    const cacheKeys = [];
    const requestedKey = this._buildDockedItemInfoCacheKey(requestedItemID, item);
    if (requestedKey) {
      cacheKeys.push(requestedKey);
    }
    const itemKey = this._buildDockedItemInfoCacheKey(
      Number(item && item.itemID) || 0,
      item,
    );
    if (itemKey && !cacheKeys.includes(itemKey)) {
      cacheKeys.push(itemKey);
    }
    for (const cacheKey of cacheKeys) {
      cache.entries.set(cacheKey, entry);
    }
    return entry;
  }
  _coalesce(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }
  _getSessionSpaceSystemID(session) {
    if (!session || isDockedSession(session)) {
      return 0;
    }
    for (const candidate of [
      session.solarsystemid2,
      session.solarsystemid,
      session.locationid,
      session.locationID,
    ]) {
      const numeric = Math.trunc(normalizeNumber(candidate, 0));
      if (numeric > 0) {
        return numeric;
      }
    }
    return 0;
  }
  _resolveActiveShipLocationID(session, shipMetadata = {}, fallback = 0) {
    const metadataLocationID = Math.trunc(
      normalizeNumber(shipMetadata && shipMetadata.locationID, 0),
    );
    const spaceSystemID = this._getSessionSpaceSystemID(session);
    if (spaceSystemID > 0) {
      return metadataLocationID === spaceSystemID
        ? metadataLocationID
        : spaceSystemID;
    }
    if (metadataLocationID > 0) {
      return metadataLocationID;
    }
    return this._coalesce(shipMetadata && shipMetadata.locationID, fallback);
  }
  _resolveActiveShipFlagID(session, shipMetadata = {}, fallback = 4) {
    const spaceSystemID = this._getSessionSpaceSystemID(session);
    if (spaceSystemID > 0) {
      return 0;
    }
    return this._coalesce(shipMetadata && shipMetadata.flagID, fallback);
  }
  _normalizeTypeID(value) {
    return Math.trunc(normalizeNumber(value, 0)) || 0;
  }
  _buildRequiredSkillLevelDict(typeID) {
    const levelsBySkillID = new Map();
    for (const requirement of getRequiredSkillRequirements(typeID)) {
      const skillTypeID = this._normalizeTypeID(requirement && requirement.skillTypeID);
      const requiredLevel = Math.max(
        1,
        this._normalizeTypeID(
          requirement && (requirement.requiredLevel || requirement.level),
        ),
      );
      if (skillTypeID <= 0) {
        continue;
      }
      levelsBySkillID.set(
        skillTypeID,
        Math.max(levelsBySkillID.get(skillTypeID) || 0, requiredLevel),
      );
    }
    return buildDict(
      [...levelsBySkillID.entries()].sort((left, right) => left[0] - right[0]),
    );
  }
  _getCharID(session) {
    return resolveSessionCharacterID(session);
  }
  _isControllingStructureSession(session) {
    const structureID = Number(
      session && (session.structureID || session.structureid),
    ) || 0;
    const shipID = Number(session && (session.shipID || session.shipid)) || 0;
    return structureID > 0 && shipID === structureID;
  }
  _getControlledStructureInventoryOwnerID(session, locationID) {
    if (!this._isControllingStructureSession(session)) {
      return 0;
    }
    const numericLocationID = Number(locationID) || 0;
    const structureID = Number(
      session && (session.structureID || session.structureid),
    ) || 0;
    const shipID = Number(session && (session.shipID || session.shipid)) || 0;
    if (
      numericLocationID <= 0 ||
      (numericLocationID !== structureID && numericLocationID !== shipID)
    ) {
      return 0;
    }
    const structure =
      worldData.getStructureByID(numericLocationID) ||
      worldData.getStructureByID(structureID) ||
      null;
    return Number(structure && (structure.ownerCorpID || structure.ownerID)) || 0;
  }
  _getDogmaInventoryOwnerID(session, locationID) {
    const structureOwnerID = this._getControlledStructureInventoryOwnerID(
      session,
      locationID,
    );
    return structureOwnerID > 0 ? structureOwnerID : this._getCharID(session);
  }
  _getShipID(session) {
    if (this._isControllingStructureSession(session)) {
      return (
        session &&
        (session.shipID || session.shipid)
      ) || 140000101;
    }
    return (
      session &&
      (session.activeShipID || session.shipID || session.shipid)
    ) || 140000101;
  }
  _getShipTypeID(session) {
    return session && Number.isInteger(session.shipTypeID) && session.shipTypeID > 0
      ? session.shipTypeID
      : 606;
  }
  _getDogmaAttributeDefaultValue(attributeID, fallback = 0) {
    const numericAttributeID = Number(attributeID) || 0;
    if (numericAttributeID <= 0) {
      return fallback;
    }
    const typeDogma = readStaticTable(TABLE.TYPE_DOGMA);
    const attributeTypesByID =
      typeDogma && typeDogma.attributeTypesByID &&
      typeof typeDogma.attributeTypesByID === "object"
        ? typeDogma.attributeTypesByID
        : {};
    const record = attributeTypesByID[String(numericAttributeID)] ||
      attributeTypesByID[numericAttributeID] ||
      null;
    const defaultValue = Number(record && record.defaultValue);
    return Number.isFinite(defaultValue) ? defaultValue : fallback;
  }
  _getCharacterSkillEffectiveAttributes(charID, skillTypeID) {
    const numericCharID = Number(charID) || 0;
    const numericSkillTypeID = Number(skillTypeID) || 0;
    if (numericSkillTypeID <= 0) {
      return {};
    }
    const skillRecord =
      numericCharID > 0
        ? getCharacterSkills(numericCharID).find(
            (skill) => Number(skill && skill.typeID) === numericSkillTypeID,
          )
        : null;
    return buildSkillEffectiveAttributes(skillRecord || {
      typeID: numericSkillTypeID,
      skillLevel: 0,
      trainedSkillLevel: 0,
      effectiveSkillLevel: 0,
    });
  }
  _resolveCharacterNaniteRepairAttributes(charID) {
    const baseRepairRate = this._getDogmaAttributeDefaultValue(
      ATTRIBUTE_MODULE_REPAIR_RATE,
      10,
    );
    const baseRepairCostMultiplier = this._getDogmaAttributeDefaultValue(
      ATTRIBUTE_SHIP_BROKEN_MODULE_REPAIR_COST_MULTIPLIER,
      0.5,
    );
    const operationAttributes = this._getCharacterSkillEffectiveAttributes(
      charID,
      SKILL_NANITE_OPERATION,
    );
    const interfacingAttributes = this._getCharacterSkillEffectiveAttributes(
      charID,
      SKILL_NANITE_INTERFACING,
    );
    const repairCostBonus = Number(
      operationAttributes[ATTRIBUTE_SHIP_BROKEN_REPAIR_COST_MULTIPLIER_BONUS],
    ) || 0;
    const repairRateBonus = Number(
      interfacingAttributes[ATTRIBUTE_MODULE_REPAIR_RATE_BONUS],
    ) || 0;
    return {
      moduleRepairRate: Math.max(
        0.01,
        baseRepairRate * (1 + repairRateBonus / 100),
      ),
      repairCostMultiplier: Math.max(
        0.01,
        baseRepairCostMultiplier * (1 + repairCostBonus / 100),
      ),
    };
  }
  _buildStructureControlShipMetadata(structure = null) {
    if (!structure) {
      return null;
    }
    const typeID = Number(structure.typeID) || 0;
    const itemType = resolveItemByTypeID(typeID) || {};
    const effectiveHitpoints = resolveStructureEffectiveHitpoints(structure);
    return {
      itemID: Number(structure.structureID) || 0,
      typeID,
      ownerID: Number(structure.ownerCorpID || structure.ownerID) || 0,
      // The controlled structure is a location dogma item; the client expects
      // it to behave like the docked structure itself rather than a solar-
      // system station row.
      locationID: Number(structure.structureID || structure.locationID) || 0,
      flagID: 0,
      quantity: -1,
      singleton: 1,
      stacksize: 1,
      groupID: Number(itemType.groupID) || 0,
      categoryID: Number(itemType.categoryID) || 0,
      customInfo: String(structure.itemName || structure.name || ""),
      radius: Number(structure.radius) || 0,
      shieldCapacity: Number(effectiveHitpoints.effectiveShieldCapacity) || 0,
      armorHP: Number(effectiveHitpoints.effectiveArmorHP) || 0,
      hullHP: Number(effectiveHitpoints.effectiveStructureHP) || 0,
      conditionState:
        structure && structure.conditionState && typeof structure.conditionState === "object"
          ? { ...structure.conditionState }
          : null,
    };
  }
  _getControlledStructureShipMetadata(session) {
    if (!this._isControllingStructureSession(session)) {
      return null;
    }
    return this._getStructureShipMetadataByID(
      session && (session.structureID || session.structureid),
    );
  }
  _getStructureShipMetadataByID(structureID) {
    const numericStructureID = Number(structureID) || 0;
    if (numericStructureID <= 0) {
      return null;
    }
    return this._buildStructureControlShipMetadata(
      worldData.getStructureByID(numericStructureID) || null,
    );
  }
  _getShipMetadata(session) {
    const controlledStructureShip = this._getControlledStructureShipMetadata(session);
    if (controlledStructureShip) {
      return controlledStructureShip;
    }
    const shipTypeID = this._getShipTypeID(session);
    return (
      resolveShipByTypeID(shipTypeID) || {
        typeID: shipTypeID,
        name: (session && session.shipName) || "Ship",
        groupID: 25,
        categoryID: 6,
      }
    );
  }
  _getCharacterRecord(session) {
    return getCharacterRecord(this._getCharID(session));
  }
  _getPersistedDroneSettingAttributes(session) {
    const characterRecord = this._getCharacterRecord(session) || {};
    const storedSettings =
      characterRecord.droneSettings &&
      typeof characterRecord.droneSettings === "object"
        ? characterRecord.droneSettings
        : {};
    const normalizedSettings = {};
    for (const attributeID of VALID_DRONE_SETTING_ATTRIBUTE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(storedSettings, attributeID)) {
        continue;
      }
      normalizedSettings[attributeID] = Boolean(storedSettings[attributeID]);
    }
    return normalizedSettings;
  }
  _normalizeDroneSettingChanges(rawChanges) {
    const normalizedChanges = {};
    for (const [rawAttributeID, rawValue] of extractDictEntries(rawChanges)) {
      const attributeID = Number(normalizeNumber(rawAttributeID, 0)) || 0;
      if (!VALID_DRONE_SETTING_ATTRIBUTE_IDS.has(attributeID)) {
        continue;
      }
      normalizedChanges[attributeID] = Boolean(normalizeNumber(rawValue, 0));
    }
    return normalizedChanges;
  }
  _persistDroneSettingChanges(session, droneSettingChanges = {}) {
    const characterID = this._getCharID(session);
    if (characterID <= 0) {
      return this._getPersistedDroneSettingAttributes(session);
    }
    const characterRecord = this._getCharacterRecord(session);
    if (!characterRecord) {
      return {};
    }
    const nextDroneSettings = {
      ...this._getPersistedDroneSettingAttributes(session),
      ...droneSettingChanges,
    };
    const nextCharacterRecord = {
      ...characterRecord,
      droneSettings: nextDroneSettings,
    };
    // Phase 0: persist the character record through its owner (characterState).
    const writeResult = require("../character/characterState").writeCharacterRecord(
      characterID,
      nextCharacterRecord,
      { silent: true },
    );
    if (!writeResult.success) {
      log.warn(
        `[DogmaService] Failed to persist drone settings for char=${characterID}: ${writeResult.errorMsg || "WRITE_ERROR"}`,
      );
      return this._getPersistedDroneSettingAttributes(session);
    }
    return nextDroneSettings;
  }
  _buildDroneSettingAttributesPayload(session) {
    return buildDict(
      Object.entries(this._getPersistedDroneSettingAttributes(session)).map(
        ([attributeID, value]) => [
          Number(attributeID) || 0,
          Boolean(value),
        ],
      ),
    );
  }
  _getActiveShipRecord(session) {
    return getActiveShipRecord(this._getCharID(session));
  }
  _getCurrentDogmaShipContext(session) {
    const controlledStructureShip = this._getControlledStructureShipMetadata(session);
    if (controlledStructureShip) {
      return {
        shipID: controlledStructureShip.itemID,
        shipMetadata: controlledStructureShip,
        shipRecord: controlledStructureShip,
        controllingStructure: true,
      };
    }
    const activeShip = this._getActiveShipRecord(session);
    const shipMetadata = activeShip || this._getShipMetadata(session);
    return {
      shipID: activeShip ? activeShip.itemID : this._getShipID(session),
      shipMetadata,
      shipRecord: activeShip,
      controllingStructure: false,
    };
  }
  _getLocationID(session) {
    return (
      (getDockedLocationID(session) || (session && (session.locationid || session.solarsystemid2 || session.solarsystemid))) ||
      60003760
    );
  }
  _nowFileTime() {
    return BigInt(Date.now()) * 10000n + 116444736000000000n;
  }
  // Scene-aware filetime: returns the solar system's sim filetime when the
  // session is in space, wallclock filetime otherwise.  Use this for any
  // timestamp that is sent to the client so it stays coherent with TiDi.
  _sessionFileTime(session) {
    return getSessionSimulationFileTime(session, this._nowFileTime());
  }
  _toFileTime(value, fallback = null) {
    const fallbackValue =
      typeof fallback === "bigint" ? fallback : this._nowFileTime();
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return fallbackValue;
    }
    return BigInt(Math.trunc(numericValue)) * 10000n + 116444736000000000n;
  }
  _toBoolArg(value, fallback = true) {
    if (value === undefined) {
      return fallback;
    }
    if (value === null) {
      return fallback;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "object") {
      if (value.type === "bool") {
        return Boolean(value.value);
      }
      if (value.type === "none") {
        return fallback;
      }
    }
    return fallback;
  }
  _buildInvRow({
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    groupID,
    categoryID,
    quantity = -1,
    singleton = 1,
    stacksize = 1,
    customInfo = "",
  }) {
    const normalizedQuantity = Number.isFinite(Number(quantity))
      ? quantity
      : -1;
    const normalizedSingleton =
      singleton === null || singleton === undefined
        ? (normalizedQuantity === -1 ? 1 : 0)
        : singleton;
    const normalizedStacksize =
      stacksize === null || stacksize === undefined
        ? (normalizedSingleton === 1
          ? 1
          : (normalizedQuantity === -1 ? 0 : normalizedQuantity))
        : stacksize;
    const normalizedCustomInfo =
      customInfo === null || customInfo === undefined
        ? ""
        : customInfo;
    return buildPackedRow(
      INVENTORY_ROW_DESCRIPTOR_COLUMNS,
      {
        itemID,
        typeID,
        ownerID,
        locationID,
        flagID,
        quantity: normalizedQuantity,
        groupID,
        categoryID,
        customInfo: normalizedCustomInfo,
        stacksize: normalizedStacksize,
        singleton: normalizedSingleton,
      },
      INVENTORY_ROW_DESCRIPTOR_VIRTUAL_COLUMNS,
    );
  }
  _buildCommonGetInfoEntry({
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    groupID,
    categoryID,
    quantity = -1,
    singleton = 1,
    stacksize = 1,
    customInfo = "",
    attributes = null,
    activeEffects = null,
    invItem,
    session = null,
  }) {
    const resolvedInvItem = invItem === undefined
      ? this._buildInvRow({
          itemID,
          typeID,
          ownerID,
          locationID,
          flagID,
          groupID,
          categoryID,
          quantity,
          singleton,
          stacksize,
          customInfo,
        })
      : invItem;
    // Keep dogma bootstrap timestamps on the same solar-system sim clock that
    // Michelle is about to use for the initial ballpark. Raw wallclock here
    // causes client-only reconnects into a lagged scene to seed module timers
    // off a different clock than space bootstrap.
    const now = session ? this._sessionFileTime(session) : this._nowFileTime();
    const entries = [
      ["itemID", itemID],
      ["invItem", resolvedInvItem],
      ["activeEffects", activeEffects || { type: "dict", entries: [] }],
      ["attributes", attributes || { type: "dict", entries: [] }],
    ];
    entries.push(
      ["time", now],
      ["wallclockTime", now],
    );
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: entries,
      },
    };
  }
  _buildStatusRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", ["instanceID", "online", "damage", "charge", "skillPoints", "armorDamage", "shieldCharge", "incapacitated"]],
          ["line", [itemID, online, damage, charge, skillPoints, armorDamage, shieldCharge, incapacitated]],
        ],
      },
    };
  }
  _buildInstanceRowDescriptor() {
    return {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INSTANCE_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    };
  }
  _buildPackedInstanceRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "packedrow",
      header: this._buildInstanceRowDescriptor(),
      columns: INSTANCE_ROW_DESCRIPTOR_COLUMNS,
      fields: {
        instanceID: itemID,
        online,
        damage,
        charge,
        skillPoints,
        armorDamage,
        shieldCharge,
        incapacitated,
      },
    };
  }
  _buildCharacterAttributes(charData = {}, characterID = null) {
    const source = charData.characterAttributes || {};
    const charID = Number(
      characterID ?? charData.characterID ?? charData.charID ?? charData.charid ?? 0,
    ) || 0;
    const securityStatus = Number(
      charData.securityStatus ?? charData.securityRating ?? source.securityStatus ?? 0,
    );
    const characterTargetingState = buildCharacterTargetingState(
      charID,
      {
        characterAttributes: source,
      },
    );
    const industryAttributes = resolveCharacterIndustryAttributes(charID);
    const naniteRepairAttributes =
      this._resolveCharacterNaniteRepairAttributes(charID);
    // Scale the learning attributes by skillTrainingSpeed so the godma-driven
    // Character Sheet and training-time displays match server SP accrual.
    return applyClientTrainingSpeedScale(applyActiveImplantAttributeBonuses({
      [ATTRIBUTE_CHARISMA]: Number(source[ATTRIBUTE_CHARISMA] ?? source.charisma ?? 20),
      [ATTRIBUTE_INTELLIGENCE]: Number(
        source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence ?? 20,
      ),
      [ATTRIBUTE_MEMORY]: Number(source[ATTRIBUTE_MEMORY] ?? source.memory ?? 20),
      [ATTRIBUTE_PERCEPTION]: Number(
        source[ATTRIBUTE_PERCEPTION] ?? source.perception ?? 20,
      ),
      [ATTRIBUTE_WILLPOWER]: Number(source[ATTRIBUTE_WILLPOWER] ?? source.willpower ?? 20),
      [ATTRIBUTE_MAX_LOCKED_TARGETS]: Number(
        characterTargetingState.maxLockedTargets ?? source[ATTRIBUTE_MAX_LOCKED_TARGETS] ?? 0,
      ),
      [ATTRIBUTE_MAX_JUMP_CLONES]: Number(
        source[ATTRIBUTE_MAX_JUMP_CLONES] ?? getCharacterCloneLimit(charID),
      ),
      [ATTRIBUTE_CLONE_JUMP_COOLDOWN]: Number(
        source[ATTRIBUTE_CLONE_JUMP_COOLDOWN] ?? getCharacterCloneJumpCooldownHours(charID),
      ),
      [ATTRIBUTE_MANUFACTURE_SLOT_LIMIT]: Number(
        source[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT] ??
          industryAttributes[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT],
      ),
      [ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER]: Number(
        source[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER] ??
          industryAttributes[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER],
      ),
      [ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED]: Number(
        source[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED] ??
          industryAttributes[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED],
      ),
      [ATTRIBUTE_COPY_SPEED_PERCENT]: Number(
        source[ATTRIBUTE_COPY_SPEED_PERCENT] ??
          industryAttributes[ATTRIBUTE_COPY_SPEED_PERCENT],
      ),
      [ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED]: Number(
        source[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED] ??
          industryAttributes[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED],
      ),
      [ATTRIBUTE_MAX_LABORATORY_SLOTS]: Number(
        source[ATTRIBUTE_MAX_LABORATORY_SLOTS] ??
          industryAttributes[ATTRIBUTE_MAX_LABORATORY_SLOTS],
      ),
      [ATTRIBUTE_INVENTION_RESEARCH_SPEED]: Number(
        source[ATTRIBUTE_INVENTION_RESEARCH_SPEED] ??
          industryAttributes[ATTRIBUTE_INVENTION_RESEARCH_SPEED],
      ),
      [ATTRIBUTE_REACTION_TIME_MULTIPLIER]: Number(
        source[ATTRIBUTE_REACTION_TIME_MULTIPLIER] ??
          industryAttributes[ATTRIBUTE_REACTION_TIME_MULTIPLIER],
      ),
      [ATTRIBUTE_REACTION_SLOT_LIMIT]: Number(
        source[ATTRIBUTE_REACTION_SLOT_LIMIT] ??
          industryAttributes[ATTRIBUTE_REACTION_SLOT_LIMIT],
      ),
      [ATTRIBUTE_MODULE_REPAIR_RATE]: Number(
        source[ATTRIBUTE_MODULE_REPAIR_RATE] ??
          naniteRepairAttributes.moduleRepairRate,
      ),
      [ATTRIBUTE_SHIP_BROKEN_MODULE_REPAIR_COST_MULTIPLIER]: Number(
        source[ATTRIBUTE_SHIP_BROKEN_MODULE_REPAIR_COST_MULTIPLIER] ??
          naniteRepairAttributes.repairCostMultiplier,
      ),
      [ATTRIBUTE_PILOT_SECURITY_STATUS]: Number.isFinite(securityStatus)
        ? securityStatus
        : 0,
    }, charID > 0 ? charID : charData));
  }
  _buildCharacterBaseAttributes(charData = {}) {
    const typeID = Number(charData.typeID || CHARACTER_TYPE_ID) || CHARACTER_TYPE_ID;
    const source =
      charData.characterAttributes && typeof charData.characterAttributes === "object"
        ? charData.characterAttributes
        : {};
    const attributes = Object.fromEntries(
      Object.entries(getTypeDogmaAttributes(typeID))
        .map(([attributeID, value]) => [Number(attributeID), Number(value)])
        .filter(
          ([attributeID, value]) =>
            Number.isInteger(attributeID) && Number.isFinite(value),
        ),
    );

    for (const [attributeID, value] of Object.entries(source)) {
      const numericAttributeID = Number(attributeID);
      const numericValue = Number(value);
      if (!Number.isInteger(numericAttributeID) || !Number.isFinite(numericValue)) {
        continue;
      }
      attributes[numericAttributeID] = numericValue;
    }

    const namedPrimaryAttributes = [
      [ATTRIBUTE_CHARISMA, source.charisma ?? charData.charisma ?? 20],
      [ATTRIBUTE_INTELLIGENCE, source.intelligence ?? charData.intelligence ?? 20],
      [ATTRIBUTE_MEMORY, source.memory ?? charData.memory ?? 20],
      [ATTRIBUTE_PERCEPTION, source.perception ?? charData.perception ?? 20],
      [ATTRIBUTE_WILLPOWER, source.willpower ?? charData.willpower ?? 20],
    ];
    for (const [attributeID, value] of namedPrimaryAttributes) {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        attributes[attributeID] = numericValue;
      }
    }

    return attributes;
  }
  _buildShipModifiedCharacterAttributes(
    charData = {},
    characterID = null,
    session = null,
    options = {},
  ) {
    const charID = Number(
      characterID ?? charData.characterID ?? charData.charID ?? charData.charid ?? 0,
    ) || 0;
    const source =
      charData.characterAttributes && typeof charData.characterAttributes === "object"
        ? charData.characterAttributes
        : {};
    const attributes = this._buildCharacterBaseAttributes(charData);
    const directCharacterModifierEntries = buildCharacterBrainDefinitionSet(charID)
      .characterEffects
      .filter(
        (effectDefinition) =>
          String(effectDefinition && effectDefinition.modifierType || "M") === "M",
      )
      .map((effectDefinition) => ({
        modifiedAttributeID: Number(effectDefinition && effectDefinition.targetAttributeID) || 0,
        operation: Number(effectDefinition && effectDefinition.operation) || 0,
        value: Number(effectDefinition && effectDefinition.value),
        stackingPenalized: false,
      }))
      .filter(
        (modifierEntry) =>
          modifierEntry.modifiedAttributeID > 0 &&
          Number.isFinite(modifierEntry.value),
      );
    if (directCharacterModifierEntries.length > 0) {
      applyModifierGroups(attributes, directCharacterModifierEntries);
    }

    const sessionShipID = Number(
      session && (session.activeShipID ?? session.shipID ?? session.shipid),
    ) || 0;
    const activeShip =
      (sessionShipID > 0 && findCharacterShip(charID, sessionShipID)) ||
      getActiveShipRecord(charID) ||
      null;
    if (activeShip) {
      const fittingSnapshot = getShipFittingSnapshot(charID, activeShip.itemID, {
        shipItem: activeShip,
        reason: "dogma.ship-modified-char-attrs",
        ...this._getFittingContextSnapshotOptions(
          options.fittingContext,
          charID,
          activeShip.itemID,
        ),
      });
      if (fittingSnapshot) {
        const ownerModifierAttributes = collectCharacterModifierAttributes(
          fittingSnapshot.skillMap,
          fittingSnapshot.fittedItems,
          fittingSnapshot.assumedActiveModuleContexts,
        );
        for (const [attributeID, value] of Object.entries(
          ownerModifierAttributes || {},
        )) {
          const numericAttributeID = Number(attributeID);
          const numericValue = Number(value);
          if (!Number.isInteger(numericAttributeID) || !Number.isFinite(numericValue)) {
            continue;
          }
          attributes[numericAttributeID] = numericValue;
        }
      }
    }

    const characterTargetingState = buildCharacterTargetingState(
      charID,
      {
        characterAttributes: source,
      },
    );
    const industryAttributes = resolveCharacterIndustryAttributes(charID);
    const securityStatus = Number(
      charData.securityStatus ?? charData.securityRating ?? source.securityStatus ?? 0,
    );
    const naniteRepairAttributes =
      this._resolveCharacterNaniteRepairAttributes(charID);

    attributes[ATTRIBUTE_MAX_LOCKED_TARGETS] = Number(
      characterTargetingState.maxLockedTargets ?? attributes[ATTRIBUTE_MAX_LOCKED_TARGETS] ?? 0,
    );
    attributes[ATTRIBUTE_MAX_JUMP_CLONES] = Number(
      source[ATTRIBUTE_MAX_JUMP_CLONES] ??
        attributes[ATTRIBUTE_MAX_JUMP_CLONES] ??
        getCharacterCloneLimit(charID),
    );
    attributes[ATTRIBUTE_CLONE_JUMP_COOLDOWN] = Number(
      source[ATTRIBUTE_CLONE_JUMP_COOLDOWN] ??
        attributes[ATTRIBUTE_CLONE_JUMP_COOLDOWN] ??
        getCharacterCloneJumpCooldownHours(charID),
    );
    attributes[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT] = Number(
      source[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT] ??
        industryAttributes[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT] ??
        attributes[ATTRIBUTE_MANUFACTURE_SLOT_LIMIT] ??
        0,
    );
    attributes[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER] = Number(
      source[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER] ??
        industryAttributes[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER] ??
        attributes[ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER] ??
        0,
    );
    attributes[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED] = Number(
      source[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED] ??
        industryAttributes[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED] ??
        attributes[ATTRIBUTE_MANUFACTURING_TIME_RESEARCH_SPEED] ??
        0,
    );
    attributes[ATTRIBUTE_COPY_SPEED_PERCENT] = Number(
      source[ATTRIBUTE_COPY_SPEED_PERCENT] ??
        industryAttributes[ATTRIBUTE_COPY_SPEED_PERCENT] ??
        attributes[ATTRIBUTE_COPY_SPEED_PERCENT] ??
        0,
    );
    attributes[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED] = Number(
      source[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED] ??
        industryAttributes[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED] ??
        attributes[ATTRIBUTE_MINERAL_NEED_RESEARCH_SPEED] ??
        0,
    );
    attributes[ATTRIBUTE_MAX_LABORATORY_SLOTS] = Number(
      source[ATTRIBUTE_MAX_LABORATORY_SLOTS] ??
        industryAttributes[ATTRIBUTE_MAX_LABORATORY_SLOTS] ??
        attributes[ATTRIBUTE_MAX_LABORATORY_SLOTS] ??
        0,
    );
    attributes[ATTRIBUTE_INVENTION_RESEARCH_SPEED] = Number(
      source[ATTRIBUTE_INVENTION_RESEARCH_SPEED] ??
        industryAttributes[ATTRIBUTE_INVENTION_RESEARCH_SPEED] ??
        attributes[ATTRIBUTE_INVENTION_RESEARCH_SPEED] ??
        0,
    );
    attributes[ATTRIBUTE_REACTION_TIME_MULTIPLIER] = Number(
      source[ATTRIBUTE_REACTION_TIME_MULTIPLIER] ??
        industryAttributes[ATTRIBUTE_REACTION_TIME_MULTIPLIER] ??
        attributes[ATTRIBUTE_REACTION_TIME_MULTIPLIER] ??
        0,
    );
    attributes[ATTRIBUTE_REACTION_SLOT_LIMIT] = Number(
      source[ATTRIBUTE_REACTION_SLOT_LIMIT] ??
        industryAttributes[ATTRIBUTE_REACTION_SLOT_LIMIT] ??
        attributes[ATTRIBUTE_REACTION_SLOT_LIMIT] ??
        0,
    );
    attributes[ATTRIBUTE_MODULE_REPAIR_RATE] = Number(
      source[ATTRIBUTE_MODULE_REPAIR_RATE] ??
        attributes[ATTRIBUTE_MODULE_REPAIR_RATE] ??
        naniteRepairAttributes.moduleRepairRate,
    );
    attributes[ATTRIBUTE_SHIP_BROKEN_MODULE_REPAIR_COST_MULTIPLIER] = Number(
      source[ATTRIBUTE_SHIP_BROKEN_MODULE_REPAIR_COST_MULTIPLIER] ??
        attributes[ATTRIBUTE_SHIP_BROKEN_MODULE_REPAIR_COST_MULTIPLIER] ??
        naniteRepairAttributes.repairCostMultiplier,
    );
    attributes[ATTRIBUTE_PILOT_SECURITY_STATUS] = Number.isFinite(securityStatus)
      ? securityStatus
      : 0;

    return attributes;
  }
  _buildShipModifiedCharacterAttributeDict(
    charData = {},
    characterID = null,
    session = null,
    options = {},
  ) {
    const attributes = this._buildShipModifiedCharacterAttributes(
      charData,
      characterID,
      session,
      options,
    );
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        value,
      ]),
    };
  }
  _buildCharacterAttributeDict(charData = {}, characterID = null) {
    const attributes = this._buildCharacterAttributes(charData, characterID);
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        value,
      ]),
    };
  }
  _getShipRuntimeAttributeOverrides(session, shipData = {}) {
    if (!session || !session._space || !shipData) {
      return null;
    }
    const activeShipID = Number(
      shipData.itemID ??
      shipData.shipID ??
      this._getShipID(session),
    ) || 0;
    const runtimeState = spaceRuntime.getShipAttributeSnapshot(session);
    if (!runtimeState || Number(runtimeState.itemID) !== activeShipID) {
      return null;
    }
    return runtimeState;
  }
  _getPropulsionModuleAttributeOverrides(item, session) {
    if (!item || !session || Number(item.flagID) === ITEM_FLAGS.DRONE_BAY) {
      return null;
    }
    const runtimeAttributes = spaceRuntime.getPropulsionModuleRuntimeAttributes(
      this._getCharID(session),
      item,
      {
        activeModuleContexts:
          spaceRuntime &&
          typeof spaceRuntime.getActiveModuleContextsForSession === "function"
            ? spaceRuntime.getActiveModuleContextsForSession(session, {
              excludeModuleID: Number(item && item.itemID) || 0,
              includeOverloadModuleID: Number(item && item.itemID) || 0,
            })
            : [],
      },
    );
    if (
      !runtimeAttributes ||
      !Number.isFinite(Number(runtimeAttributes.speedBoostFactor)) ||
      Number(runtimeAttributes.speedBoostFactor) <= 0
    ) {
      return null;
    }
    return runtimeAttributes;
  }
  _getGenericModuleAttributeOverrides(item, session, options = {}) {
    if (!item || !session || Number(item.flagID) === ITEM_FLAGS.DRONE_BAY) {
      return null;
    }
    const charID = this._getCharID(session);
    let shipItem = getActiveShipRecord(charID);
    if (
      !shipItem ||
      Number(shipItem.itemID) !== Number(item.locationID)
    ) {
      shipItem = findItemById(item.locationID);
    }
    if (
      !shipItem ||
      Number(shipItem.itemID) !== Number(item.locationID)
    ) {
      return null;
    }
    const chargeItem =
      this._getFittingContextChargeByFlag(
        options.fittingContext,
        charID,
        shipItem.itemID,
        item.flagID,
      ) ||
      getLoadedChargeByFlag(
        charID,
        shipItem.itemID,
        item.flagID,
      );
    const activeModuleContexts =
      spaceRuntime &&
      typeof spaceRuntime.getActiveModuleContextsForSession === "function"
        ? spaceRuntime.getActiveModuleContextsForSession(session, {
          excludeModuleID: Number(item && item.itemID) || 0,
          includeOverloadModuleID: Number(item && item.itemID) || 0,
        })
        : [];
    const additionalLocationModifierSources = getLocationModifierSourcesForSystem(
      session &&
      (
        session.solarsystemid2 ||
        session.solarsystemid ||
        (session._space && session._space.systemID) ||
        0
      ),
    );
    const fittingSnapshotOptions = this._getFittingContextSnapshotOptions(
      options.fittingContext,
      charID,
      shipItem.itemID,
    );
    const runtimeAttributes = spaceRuntime.getGenericModuleRuntimeAttributes(
      charID,
      shipItem,
      item,
      chargeItem,
      null,
      {
        activeModuleContexts,
        additionalLocationModifierSources,
        ...fittingSnapshotOptions,
      },
    );
    if (!runtimeAttributes) {
      return null;
    }

    const activeEffectState =
      spaceRuntime &&
      typeof spaceRuntime.getActiveModuleEffect === "function"
        ? spaceRuntime.getActiveModuleEffect(session, Number(item && item.itemID) || 0)
        : null;
    const activeAttributeOverrides =
      activeEffectState &&
      activeEffectState.genericAttributeOverrides &&
      typeof activeEffectState.genericAttributeOverrides === "object"
        ? activeEffectState.genericAttributeOverrides
        : null;
    if (!activeAttributeOverrides) {
      return runtimeAttributes;
    }

    return {
      ...runtimeAttributes,
      attributeOverrides: {
        ...(runtimeAttributes.attributeOverrides || {}),
        ...activeAttributeOverrides,
      },
    };
  }
  _buildScannerProbeLauncherRuntimeAttributeMap(item, session) {
    if (
      !item ||
      !session ||
      Number(item.groupID) !== GROUP_SCAN_PROBE_LAUNCHER
    ) {
      return null;
    }

    const runtimeAttributes = this._getGenericModuleAttributeOverrides(item, session);
    if (!runtimeAttributes) {
      return null;
    }

    const attributes = {};
    if (Number.isFinite(Number(runtimeAttributes.capNeed))) {
      attributes[MODULE_ATTRIBUTE_CAPACITOR_NEED] = Number(
        runtimeAttributes.capNeed,
      );
    }

    const durationAttributeID =
      Number(runtimeAttributes.durationAttributeID) || MODULE_ATTRIBUTE_DURATION;
    if (Number.isFinite(Number(runtimeAttributes.durationMs))) {
      attributes[durationAttributeID] = Number(runtimeAttributes.durationMs);
    }

    const attributeOverrides =
      runtimeAttributes.attributeOverrides &&
      typeof runtimeAttributes.attributeOverrides === "object"
        ? runtimeAttributes.attributeOverrides
        : null;
    if (
      attributeOverrides &&
      Number.isFinite(Number(attributeOverrides[MODULE_ATTRIBUTE_SPEED]))
    ) {
      attributes[MODULE_ATTRIBUTE_SPEED] = Number(
        attributeOverrides[MODULE_ATTRIBUTE_SPEED],
      );
    }

    const reloadRuntimeAttributes = this._getModuleReloadAttributeOverrides(
      item,
      session,
    );
    if (
      reloadRuntimeAttributes &&
      Number.isFinite(Number(reloadRuntimeAttributes.reloadTime))
    ) {
      attributes[ATTRIBUTE_RELOAD_TIME] = Number(
        reloadRuntimeAttributes.reloadTime,
      );
    }

    return attributes;
  }
  _syncScannerProbeLauncherRuntimeAttributes(
    session,
    moduleItem,
    options = {},
  ) {
    if (!session || typeof session.sendNotification !== "function" || !moduleItem) {
      return 0;
    }

    const runtimeAttributes = this._buildScannerProbeLauncherRuntimeAttributeMap(
      moduleItem,
      session,
    );
    if (!runtimeAttributes) {
      return 0;
    }

    const numericModuleID = Number(moduleItem.itemID) || 0;
    const numericCharID = Number(moduleItem.ownerID) || this._getCharID(session);
    if (numericModuleID <= 0 || numericCharID <= 0) {
      return 0;
    }

    const forceAll = options.forceAll === true;
    const when = this._sessionFileTime(session);
    const changes = [];
    for (const [rawAttributeID, rawValue] of Object.entries(runtimeAttributes)) {
      const attributeID = Number(rawAttributeID);
      const nextValue = Number(rawValue);
      if (
        !Number.isInteger(attributeID) ||
        attributeID <= 0 ||
        !Number.isFinite(nextValue)
      ) {
        continue;
      }
      if (!forceAll && Math.abs(nextValue) <= 1e-9) {
        continue;
      }
      changes.push([
        "OnModuleAttributeChanges",
        numericCharID,
        numericModuleID,
        attributeID,
        when,
        nextValue,
        forceAll ? 0 : nextValue,
        null,
      ]);
    }

    if (changes.length <= 0) {
      return 0;
    }
    this._notifyModuleAttributeChanges(session, changes);
    return changes.length;
  }
  _refreshScannerProbeLauncherClientState(
    session,
    shipID,
    moduleItem,
    options = {},
  ) {
    if (
      !session ||
      !session._space ||
      !moduleItem ||
      Number(moduleItem.groupID) !== GROUP_SCAN_PROBE_LAUNCHER
    ) {
      return 0;
    }

    void shipID;
    if (options.forceRuntimeSync === true) {
      this._syncScannerProbeLauncherRuntimeAttributes(session, moduleItem, {
        forceAll: true,
      });
    }
    return 0;
  }
  _resolveLoadedChargeItem(item, session = null, options = {}) {
    if (!item || !session || !isShipFittingFlag(item.flagID)) {
      return null;
    }
    if (
      item.loadedChargeItem &&
      Number(item.loadedChargeItem.typeID) > 0 &&
      Number(item.loadedChargeItem.flagID) === Number(item.flagID)
    ) {
      return item.loadedChargeItem;
    }
    const charID = this._getCharID(session);
    const shipID = Number(item.locationID) || 0;
    const flagID = Number(item.flagID) || 0;
    if (charID <= 0 || shipID <= 0 || flagID <= 0) {
      return null;
    }
    const contextCharge = this._getFittingContextChargeByFlag(
      options.fittingContext,
      charID,
      shipID,
      flagID,
    );
    if (contextCharge) {
      return contextCharge;
    }
    return getLoadedChargeByFlag(charID, shipID, flagID);
  }
  _getWeaponDogmaAttributeOverrides(item, session = null, options = {}) {
    if (
      !item ||
      Number(item.flagID) === ITEM_FLAGS.DRONE_BAY ||
      !isShipFittingFlag(item.flagID)
    ) {
      return null;
    }
    const characterID = Number(item.ownerID) || this._getCharID(session);
    const shipID = Number(item.locationID) || 0;
    if (characterID <= 0 || shipID <= 0) {
      return null;
    }
    const activeShipRecord = this._getActiveShipRecord(session);
    const shipItem =
      findCharacterShip(characterID, shipID) ||
      (
        activeShipRecord &&
        Number(activeShipRecord.itemID) === shipID
          ? activeShipRecord
          : null
      );
    if (!shipItem) {
      return null;
    }
    const isChargeItem = Number(item.categoryID) === 8;
    const moduleItem = isChargeItem
      ? (
          this._getFittingContextModuleByFlag(
            options.fittingContext,
            characterID,
            shipID,
            item.flagID,
          ) ||
          getFittedModuleByFlag(characterID, shipID, item.flagID)
        )
      : item;
    const chargeItem = isChargeItem
      ? item
      : this._resolveLoadedChargeItem(item, session, options);
    if (!moduleItem) {
      return null;
    }
    return this._getWeaponDogmaAttributeOverridesForCharge(
      moduleItem,
      chargeItem,
      session,
      options,
    );
  }
  _getWeaponDogmaAttributeOverridesForCharge(
    moduleItem,
    chargeItem = null,
    session = null,
    options = {},
  ) {
    if (!moduleItem || !isShipFittingFlag(moduleItem.flagID)) {
      return null;
    }
    const characterID = Number(moduleItem.ownerID) || this._getCharID(session);
    const shipID = Number(moduleItem.locationID) || 0;
    if (characterID <= 0 || shipID <= 0) {
      return null;
    }
    const activeShipRecord = this._getActiveShipRecord(session);
    const shipItem =
      findCharacterShip(characterID, shipID) ||
      (
        activeShipRecord &&
        Number(activeShipRecord.itemID) === shipID
          ? activeShipRecord
          : null
      );
    if (!shipItem) {
      return null;
    }
    return buildWeaponDogmaAttributeOverrides({
      characterID,
      shipItem,
      moduleItem,
      chargeItem,
      ...this._getFittingContextSnapshotOptions(
        options.fittingContext,
        characterID,
        shipID,
      ),
    });
  }
  _buildWeaponModuleAttributeMap(moduleItem, chargeItem = null, session = null) {
    const weaponDogmaAttributes = this._getWeaponDogmaAttributeOverridesForCharge(
      moduleItem,
      chargeItem,
      session,
    );
    const moduleAttributes =
      weaponDogmaAttributes &&
      weaponDogmaAttributes.moduleAttributes &&
      typeof weaponDogmaAttributes.moduleAttributes === "object"
        ? weaponDogmaAttributes.moduleAttributes
        : null;
    if (!moduleAttributes) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(moduleAttributes)
        .map(([attributeID, value]) => [Number(attributeID), Number(value)])
        .filter(
          ([attributeID, value]) =>
            Number.isInteger(attributeID) && Number.isFinite(value),
        ),
    );
  }
  _getFittedModuleResourceAttributeOverrides(item, session = null, options = {}) {
    if (
      !item ||
      Number(item.categoryID) === 8 ||
      Number(item.flagID) === ITEM_FLAGS.DRONE_BAY ||
      !isShipFittingFlag(item.flagID)
    ) {
      return null;
    }
    const characterID = Number(item.ownerID) || this._getCharID(session);
    const shipID = Number(item.locationID) || 0;
    if (characterID <= 0 || shipID <= 0) {
      return null;
    }
    const activeShipRecord = this._getActiveShipRecord(session);
    const shipItem =
      findCharacterShip(characterID, shipID) ||
      (
        activeShipRecord &&
        Number(activeShipRecord.itemID) === shipID
          ? activeShipRecord
          : null
      );
    if (!shipItem) {
      return null;
    }

    const fittingSnapshot = getShipFittingSnapshot(characterID, shipID, {
      shipItem,
      reason: "dogma.module-attrs",
      ...this._getFittingContextSnapshotOptions(
        options.fittingContext,
        characterID,
        shipID,
      ),
    });
    return fittingSnapshot
      ? fittingSnapshot.getModuleAttributeOverrides(item)
      : null;
  }
  _buildShipAttributes(charData = {}, shipData = {}, session = null, options = {}) {
    const securityStatus = Number(
      charData.securityStatus ??
        charData.securityRating ??
        shipData.securityStatus ??
        shipData.securityRating ??
        0,
    );
    const shipCondition = getShipConditionState(shipData);
    const numericCharID = Number(charData.characterID ?? charData.charID ?? charData.charid ?? shipData.ownerID ?? 0) || 0;
    const fittingSnapshot = getShipFittingSnapshot(
      numericCharID,
      shipData && shipData.itemID,
      {
        shipItem: shipData,
        reason: "dogma.ship-attrs",
        ...this._getFittingContextSnapshotOptions(
          options.fittingContext,
          numericCharID,
          shipData && shipData.itemID,
        ),
      },
    );
    const attributes = fittingSnapshot
      ? { ...fittingSnapshot.shipAttributes }
      : {};
    const runtimeAttributeOverrides = this._getShipRuntimeAttributeOverrides(
      session,
      shipData,
    );
    const shipTypeID = Number(shipData.typeID);
    const shipMetadata =
      Number.isInteger(shipTypeID) && shipTypeID > 0
        ? resolveShipByTypeID(shipTypeID)
        : null;
    const resolvedMass = Number(shipData.mass ?? (shipMetadata && shipMetadata.mass));
    if (!(ATTRIBUTE_MASS in attributes) && Number.isFinite(resolvedMass)) {
      attributes[ATTRIBUTE_MASS] = resolvedMass;
    }
    const resolvedVolume = Number(shipData.volume ?? (shipMetadata && shipMetadata.volume));
    if (!(ATTRIBUTE_VOLUME in attributes) && Number.isFinite(resolvedVolume)) {
      attributes[ATTRIBUTE_VOLUME] = resolvedVolume;
    }
    const resolvedRadius = Number(shipData.radius ?? (shipMetadata && shipMetadata.radius));
    if (!(ATTRIBUTE_RADIUS in attributes) && Number.isFinite(resolvedRadius)) {
      attributes[ATTRIBUTE_RADIUS] = resolvedRadius;
    }
    if (
      runtimeAttributeOverrides &&
      runtimeAttributeOverrides.attributes &&
      typeof runtimeAttributeOverrides.attributes === "object"
    ) {
      for (const [attributeID, value] of Object.entries(runtimeAttributeOverrides.attributes)) {
        const numericAttributeID = Number(attributeID);
        const numericValue = Number(value);
        if (!Number.isInteger(numericAttributeID) || !Number.isFinite(numericValue)) {
          continue;
        }
        attributes[numericAttributeID] = numericValue;
      }
    }
    if (runtimeAttributeOverrides) {
      attributes[ATTRIBUTE_MASS] = Number(runtimeAttributeOverrides.mass);
      attributes[ATTRIBUTE_MAX_VELOCITY] = Number(
        runtimeAttributeOverrides.maxVelocity,
      );
      attributes[ATTRIBUTE_MAX_TARGET_RANGE] = Number(
        runtimeAttributeOverrides.maxTargetRange,
      );
      attributes[ATTRIBUTE_MAX_LOCKED_TARGETS] = Number(
        runtimeAttributeOverrides.maxLockedTargets,
      );
      attributes[ATTRIBUTE_SIGNATURE_RADIUS] = Number(
        runtimeAttributeOverrides.signatureRadius,
      );
      attributes[ATTRIBUTE_CLOAKING_TARGETING_DELAY] = Number(
        runtimeAttributeOverrides.cloakingTargetingDelay,
      );
      attributes[ATTRIBUTE_SCAN_RESOLUTION] = Number(
        runtimeAttributeOverrides.scanResolution,
      );
    }
    const shieldCapacity = Number(attributes[ATTRIBUTE_SHIELD_CAPACITY]);
    if (
      Number.isFinite(shieldCapacity) &&
      shieldCapacity >= 0 &&
      Number.isFinite(shipCondition.shieldCharge)
    ) {
      attributes[ATTRIBUTE_SHIELD_CHARGE_HELPER] = Number(
        (shieldCapacity * shipCondition.shieldCharge).toFixed(6),
      );
    }
    const armorHP = Number(attributes[ATTRIBUTE_ARMOR_HP]);
    if (
      Number.isFinite(armorHP) &&
      armorHP >= 0 &&
      Number.isFinite(shipCondition.armorDamage)
    ) {
      attributes[ATTRIBUTE_ARMOR_DAMAGE] = Number(
        (armorHP * shipCondition.armorDamage).toFixed(6),
      );
    }
    if (Number.isFinite(shipCondition.damage)) {
      attributes[ATTRIBUTE_ITEM_DAMAGE] = shipCondition.damage;
    }
    // CCP parity: Set attribute 18 ("charge") to the current capacitor energy
    // in GJ so the client's HUD capacitor gauge displays correctly.  The value
    // is capacitorCapacity * chargeRatio (conditionState.charge stores 0-1).
    const capacitorCapacity = Number(attributes[482]); // ATTRIBUTE_CAPACITOR_CAPACITY
    if (
      Number.isFinite(capacitorCapacity) &&
      capacitorCapacity > 0 &&
      Number.isFinite(shipCondition.charge)
    ) {
      attributes[ATTRIBUTE_CHARGE] = Number(
        (capacitorCapacity * shipCondition.charge).toFixed(6),
      );
    }
    attributes[ATTRIBUTE_PILOT_SECURITY_STATUS] = Number.isFinite(securityStatus)
      ? securityStatus
      : 0;
    return {
      ...attributes,
      [ATTRIBUTE_PILOT_SECURITY_STATUS]: Number.isFinite(securityStatus)
        ? securityStatus
        : 0,
    };
  }
  _buildShipAttributeDict(charData = {}, shipData = {}, session = null, options = {}) {
    const attributes = this._buildShipAttributes(
      charData,
      shipData,
      session,
      options,
    );
    return this._buildAttributeValueDict(attributes);
  }
  _buildAttributeValueDict(attributes = {}) {
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        marshalDogmaAttributeValue(attributeID, value),
      ]),
    };
  }
  _getDroneBayItemAttributeOverrides(item, session = null) {
    if (
      !item ||
      Number(item.flagID) !== ITEM_FLAGS.DRONE_BAY ||
      Number(item.locationID) <= 0
    ) {
      return null;
    }
    const shipID = Number(item.locationID) || 0;
    const charID = Number(item.ownerID) || this._getCharID(session);
    if (shipID <= 0 || charID <= 0) {
      return null;
    }
    const activeShipRecord = this._getActiveShipRecord(session);
    const shipItem =
      findCharacterShip(charID, shipID) ||
      (
        activeShipRecord &&
        Number(activeShipRecord.itemID) === shipID
          ? activeShipRecord
          : null
      ) ||
      findItemById(shipID);
    if (!shipItem) {
      return null;
    }

    const scene =
      spaceRuntime &&
      typeof spaceRuntime.getSceneForSession === "function"
        ? spaceRuntime.getSceneForSession(session)
        : null;
    const runtimeShipEntity =
      scene && typeof scene.getShipEntityForSession === "function"
        ? scene.getShipEntityForSession(session)
        : null;
    const characterRecord = this._getCharacterRecord(session) || {};
    const systemID = Number(
      (session && (
        session.solarsystemid2 ||
        session.solarsystemid ||
        (session._space && session._space.systemID)
      )) ||
      (runtimeShipEntity && runtimeShipEntity.systemID) ||
      (shipItem.spaceState && shipItem.spaceState.systemID) ||
      characterRecord.solarSystemID ||
      0
    ) || 0;
    const controllerEntity = {
      ...(runtimeShipEntity || {}),
      kind: "ship",
      itemID: shipID,
      typeID: Number(shipItem.typeID) || 0,
      ownerID: charID,
      characterID: charID,
      pilotCharacterID: charID,
      session,
      systemID,
      activeModuleEffects:
        runtimeShipEntity &&
        runtimeShipEntity.activeModuleEffects instanceof Map
          ? runtimeShipEntity.activeModuleEffects
          : new Map(),
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
  _buildInventoryItemAttributes(item, session = null, options = {}) {
    const loadedChargeItem = this._resolveLoadedChargeItem(item, session, options);
    const typeAttributes = buildEffectiveItemAttributeMap(item, loadedChargeItem);
    const attributes = Object.fromEntries(
      Object.entries(typeAttributes || {})
        .map(([attributeID, value]) => [Number(attributeID), Number(value)])
        .filter(
          ([attributeID, value]) =>
            Number.isInteger(attributeID) && Number.isFinite(value),
        )
        .map(([attributeID, value]) => [
          attributeID,
          marshalDogmaAttributeValue(attributeID, value),
        ]),
    );
    const droneBayAttributeOverrides =
      this._getDroneBayItemAttributeOverrides(item, session);
    if (
      droneBayAttributeOverrides &&
      typeof droneBayAttributeOverrides === "object"
    ) {
      for (const [attributeID, value] of Object.entries(droneBayAttributeOverrides)) {
        const numericAttributeID = Number(attributeID);
        const numericValue = Number(value);
        if (
          !Number.isInteger(numericAttributeID) ||
          !Number.isFinite(numericValue)
        ) {
          continue;
        }
        attributes[numericAttributeID] = marshalDogmaAttributeValue(
          numericAttributeID,
          numericValue,
        );
      }
    }
    const structureServiceAttributes =
      this._getStructureServiceModuleAttributeOverrides(item);
    if (structureServiceAttributes) {
      for (const [attributeID, value] of Object.entries(structureServiceAttributes)) {
        const numericAttributeID = Number(attributeID);
        const numericValue = Number(value);
        if (
          !Number.isInteger(numericAttributeID) ||
          !Number.isFinite(numericValue)
        ) {
          continue;
        }
        attributes[numericAttributeID] = marshalDogmaAttributeValue(
          numericAttributeID,
          numericValue,
        );
      }
    }
    const resourceAttributeOverrides =
      this._getFittedModuleResourceAttributeOverrides(item, session, options);
    if (resourceAttributeOverrides) {
      for (const [attributeID, value] of Object.entries(resourceAttributeOverrides)) {
        const numericAttributeID = Number(attributeID);
        const numericValue = Number(value);
        if (
          Number.isInteger(numericAttributeID) &&
          Number.isFinite(numericValue)
        ) {
          attributes[numericAttributeID] = marshalDogmaAttributeValue(
            numericAttributeID,
            numericValue,
          );
        }
      }
    }
    const weaponDogmaAttributes = this._getWeaponDogmaAttributeOverrides(
      item,
      session,
      options,
    );
    const overrideAttributes =
      Number(item && item.categoryID) === 8
        ? weaponDogmaAttributes && weaponDogmaAttributes.chargeAttributes
        : weaponDogmaAttributes && weaponDogmaAttributes.moduleAttributes;
    if (overrideAttributes && typeof overrideAttributes === "object") {
      for (const [attributeID, value] of Object.entries(overrideAttributes)) {
        const numericAttributeID = Number(attributeID);
        const numericValue = Number(value);
        if (
          !Number.isInteger(numericAttributeID) ||
          !Number.isFinite(numericValue)
        ) {
          continue;
        }
        attributes[numericAttributeID] = marshalDogmaAttributeValue(
          numericAttributeID,
          numericValue,
        );
      }
    }
    const quantityAttributeID = getAttributeIDByNames("quantity");
    if (quantityAttributeID) {
      attributes[quantityAttributeID] = Number(
        item && (item.stacksize ?? item.quantity ?? 0),
      ) || 0;
    }
    const isOnlineAttributeID = getAttributeIDByNames("isOnline");
    if (isOnlineAttributeID && item && item.moduleState) {
      attributes[isOnlineAttributeID] = isModuleOnline(item) ? 1 : 0;
    }
    if (item && item.moduleState) {
      if (Number.isFinite(Number(item.moduleState.damage))) {
        const structureHP = this._getItemStructureHitpoints(item.typeID);
        attributes[ATTRIBUTE_ITEM_DAMAGE] = structureHP > 0
          ? Number((structureHP * clampRatio(item.moduleState.damage, 0)).toFixed(6))
          : Number(item.moduleState.damage);
      }
      if (Number.isFinite(Number(item.moduleState.armorDamage))) {
        attributes[ATTRIBUTE_ARMOR_DAMAGE] = Number(item.moduleState.armorDamage);
      }
      if (Number.isFinite(Number(item.moduleState.shieldCharge))) {
        attributes[ATTRIBUTE_SHIELD_CHARGE_HELPER] = Number(item.moduleState.shieldCharge);
      }
    }
    if (item && item.conditionState && typeof item.conditionState === "object") {
      const conditionState = normalizeShipConditionState(item.conditionState);
      const shieldCapacity = Number(
        item.shieldCapacity ??
          this._resolveDogmaAttributeNumber(attributes, ATTRIBUTE_SHIELD_CAPACITY, NaN),
      );
      if (
        Number.isFinite(shieldCapacity) &&
        shieldCapacity >= 0 &&
        Number.isFinite(conditionState.shieldCharge)
      ) {
        attributes[ATTRIBUTE_SHIELD_CHARGE_HELPER] = Number(
          (shieldCapacity * conditionState.shieldCharge).toFixed(6),
        );
      }
      const armorHP = Number(
        item.armorHP ??
          this._resolveDogmaAttributeNumber(attributes, ATTRIBUTE_ARMOR_HP, NaN),
      );
      if (
        Number.isFinite(armorHP) &&
        armorHP >= 0 &&
        Number.isFinite(conditionState.armorDamage)
      ) {
        attributes[ATTRIBUTE_ARMOR_DAMAGE] = Number(
          (armorHP * conditionState.armorDamage).toFixed(6),
        );
      }
      const structureHP = Number(
        item.structureHP ??
          item.hullHP ??
          this._resolveDogmaAttributeNumber(attributes, ATTRIBUTE_STRUCTURE_HP, NaN),
      );
      if (
        Number.isFinite(structureHP) &&
        structureHP >= 0 &&
        Number.isFinite(conditionState.damage)
      ) {
        attributes[ATTRIBUTE_ITEM_DAMAGE] = Number(
          (structureHP * conditionState.damage).toFixed(6),
        );
      }
    }
    const propulsionRuntimeAttributes = this._getPropulsionModuleAttributeOverrides(
      item,
      session,
    );
    if (propulsionRuntimeAttributes) {
      attributes[MODULE_ATTRIBUTE_CAPACITOR_NEED] = Number(
        propulsionRuntimeAttributes.capNeed,
      );
      attributes[MODULE_ATTRIBUTE_SPEED_FACTOR] = Number(
        propulsionRuntimeAttributes.speedFactor,
      );
      attributes[MODULE_ATTRIBUTE_DURATION] = marshalDogmaAttributeValue(
        MODULE_ATTRIBUTE_DURATION,
        Number(propulsionRuntimeAttributes.durationMs),
      );
    } else {
      const genericRuntimeAttributes = this._getGenericModuleAttributeOverrides(
        item,
        session,
        options,
      );
      if (genericRuntimeAttributes) {
        const genericAttributeOverrides =
          genericRuntimeAttributes.attributeOverrides &&
          typeof genericRuntimeAttributes.attributeOverrides === "object"
            ? genericRuntimeAttributes.attributeOverrides
            : null;
        if (genericAttributeOverrides) {
          for (const [attributeID, value] of Object.entries(genericAttributeOverrides)) {
            const numericAttributeID = Number(attributeID);
            const numericValue = Number(value);
            if (
              !Number.isInteger(numericAttributeID) ||
              !Number.isFinite(numericValue)
            ) {
              continue;
            }
            attributes[numericAttributeID] = marshalDogmaAttributeValue(
              numericAttributeID,
              numericValue,
            );
          }
        }
        attributes[MODULE_ATTRIBUTE_CAPACITOR_NEED] = Number(
          genericRuntimeAttributes.capNeed,
        );
        const durationAttributeID = Number(
          genericRuntimeAttributes.durationAttributeID,
        ) || MODULE_ATTRIBUTE_DURATION;
        attributes[durationAttributeID] = marshalDogmaAttributeValue(
          durationAttributeID,
          Number(genericRuntimeAttributes.durationMs),
        );
        if (
          durationAttributeID !== MODULE_ATTRIBUTE_DURATION &&
          MODULE_ATTRIBUTE_DURATION in attributes
        ) {
          delete attributes[MODULE_ATTRIBUTE_DURATION];
        }
        if (
          durationAttributeID !== MODULE_ATTRIBUTE_SPEED &&
          MODULE_ATTRIBUTE_SPEED in attributes &&
          Number(item && item.groupID) !== GROUP_SCAN_PROBE_LAUNCHER
        ) {
          delete attributes[MODULE_ATTRIBUTE_SPEED];
        }
      }
    }
    const reloadRuntimeAttributes = this._getModuleReloadAttributeOverrides(
      item,
      session,
    );
    if (reloadRuntimeAttributes) {
      if (
        ATTRIBUTE_RELOAD_TIME &&
        Number.isFinite(Number(reloadRuntimeAttributes.reloadTime))
      ) {
        attributes[ATTRIBUTE_RELOAD_TIME] = Number(reloadRuntimeAttributes.reloadTime);
      }
      if (
        ATTRIBUTE_NEXT_ACTIVATION_TIME &&
        typeof reloadRuntimeAttributes.nextActivationTime === "bigint"
      ) {
        attributes[ATTRIBUTE_NEXT_ACTIVATION_TIME] =
          reloadRuntimeAttributes.nextActivationTime;
      }
    }
    return attributes;
  }
  _getStructureServiceModuleAttributeOverrides(item) {
    if (!isStructureServiceModuleItem(item)) {
      return null;
    }
    const structureID = Number(item && item.locationID) || 0;
    if (structureID <= 0) {
      return null;
    }
    return buildStructureServiceModuleEffectiveAttributeMap(structureID, item);
  }
  _getPendingModuleReload(moduleID) {
    const numericModuleID = Number(moduleID) || 0;
    if (numericModuleID <= 0) {
      return null;
    }
    const reloadState = pendingModuleReloads.get(numericModuleID) || null;
    if (!reloadState) {
      return null;
    }
    const completeAtMs = Number(reloadState.completeAtMs) || 0;
    const currentTimeMs = getReloadStateCurrentTimeMs(reloadState, Date.now());
    if (completeAtMs > 0 && completeAtMs > currentTimeMs) {
      return reloadState;
    }
    pendingModuleReloads.delete(numericModuleID);
    schedulePendingModuleReloadPump();
    return null;
  }
  _getModuleReloadTimeMs(moduleItem) {
    const effectiveAttributes = moduleItem
      ? buildEffectiveItemAttributeMap(moduleItem)
      : null;
    const reloadTimeMs = Number(
      effectiveAttributes && effectiveAttributes[ATTRIBUTE_RELOAD_TIME] !== undefined
        ? effectiveAttributes[ATTRIBUTE_RELOAD_TIME]
        : getTypeAttributeValue(
            Number(moduleItem && moduleItem.typeID) || 0,
            "reloadTime",
          ),
    );
    if (!Number.isFinite(reloadTimeMs) || reloadTimeMs <= 0) {
      return 0;
    }
    return Math.max(0, Math.round(reloadTimeMs));
  }
  _getModuleReloadAttributeOverrides(item, _session = null) {
    const reloadState = this._getPendingModuleReload(item && item.itemID);
    if (!reloadState) {
      return null;
    }
    return {
      reloadTime: Number(reloadState.reloadTimeMs) || 0,
      nextActivationTime: toFileTimeFromMs(reloadState.completeAtMs, 0n),
    };
  }
  _notifyChargeBeingLoadedToModule(session, moduleIDs = [], chargeTypeID, reloadTimeMs) {
    if (!session || typeof session.sendNotification !== "function") {
      return;
    }
    const numericModuleIDs = (Array.isArray(moduleIDs) ? moduleIDs : [moduleIDs])
      .map((moduleID) => Number(moduleID) || 0)
      .filter((moduleID) => moduleID > 0);
    if (numericModuleIDs.length === 0) {
      return;
    }
    session.sendNotification("OnChargeBeingLoadedToModule", "charid", [
      {
        type: "list",
        items: numericModuleIDs,
      },
      Number(chargeTypeID) > 0 ? Number(chargeTypeID) : null,
      Math.max(0, Math.round(Number(reloadTimeMs) || 0)),
    ]);
    log.debug(
      `[DogmaIM] OnChargeBeingLoadedToModule modules=${JSON.stringify(
        numericModuleIDs,
      )} chargeTypeID=${Number(chargeTypeID) || 0} ` +
      `reloadTimeMs=${Math.max(0, Math.round(Number(reloadTimeMs) || 0))}`,
    );
  }
  _notifyModuleNextActivationTime(
    session,
    moduleID,
    nextActivationTime = 0n,
    previousActivationTime = 0n,
  ) {
    if (!ATTRIBUTE_NEXT_ACTIVATION_TIME) {
      return;
    }
    const numericModuleID = Number(moduleID) || 0;
    if (numericModuleID <= 0) {
      return;
    }
    this._notifyModuleAttributeChanges(session, [[
      "OnModuleAttributeChanges",
      this._getCharID(session),
      numericModuleID,
      ATTRIBUTE_NEXT_ACTIVATION_TIME,
      this._sessionFileTime(session),
      typeof nextActivationTime === "bigint" ? nextActivationTime : 0n,
      typeof previousActivationTime === "bigint" ? previousActivationTime : 0n,
      null,
    ]]);
    log.debug(
      `[DogmaIM] NextActivationTime moduleID=${numericModuleID} ` +
      `next=${typeof nextActivationTime === "bigint" ? nextActivationTime.toString() : String(nextActivationTime)} ` +
      `previous=${typeof previousActivationTime === "bigint" ? previousActivationTime.toString() : String(previousActivationTime)}`,
    );
  }
  _buildInventoryItemAttributeDict(item, session = null, options = {}) {
    return this._buildAttributeValueDict(
      this._buildInventoryItemAttributes(item, session, options),
    );
  }
  _resolveDogmaAttributeNumber(attributes, attributeID, fallback = 0) {
    const value = attributes && attributes[attributeID];
    const unwrapped = unwrapMarshalValue(value);
    const numeric = Number(unwrapped);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    return fallback;
  }
  _buildActiveEffectEntry(item, effectID, options = {}, session = null) {
    if (!item || effectID <= 0) {
      return null;
    }
    const now = session ? this._sessionFileTime(session) : this._nowFileTime();
    const timestamp = this._toFileTime(options.startedAt, now);
    const durationMs = Number.isFinite(Number(options.duration))
      ? Math.max(Number(options.duration), -1)
      : -1;
    const duration = marshalModuleDurationWireValue(durationMs);
    const repeat = options.repeat === undefined || options.repeat === null
      ? -1
      : Number(options.repeat);
    return [
      effectID,
      [
        Number(item.itemID) || 0,
        Number(item.ownerID) || 0,
        Number(item.locationID) || 0,
        Number(options.targetID) > 0 ? Number(options.targetID) : null,
        Number(options.otherID) > 0 ? Number(options.otherID) : null,
        [],
        effectID,
        timestamp,
        duration,
        Number.isFinite(repeat) ? repeat : -1,
      ],
    ];
  }
  _getPropulsionEffectID(effectName) {
    switch (String(effectName || "")) {
      case "moduleBonusAfterburner":
        return EFFECT_AFTERBURNER;
      case "moduleBonusMicrowarpdrive":
        return EFFECT_MICROWARPDRIVE;
      default:
        return 0;
    }
  }
  _buildInventoryItemActiveEffects(item, session = null) {
    if (!item) {
      return this._buildEmptyDict();
    }
    const entries = [];
    if (isEffectivelyOnlineModule(item)) {
      const onlineEntry = this._buildActiveEffectEntry(item, EFFECT_ONLINE, {}, session);
      if (onlineEntry) {
        entries.push(onlineEntry);
      }
    }
    if (session && session._space) {
      const activeEffect = spaceRuntime.getActiveModuleEffect(session, item.itemID);
      if (activeEffect) {
        const activeEffectID =
          Number(activeEffect.effectID) > 0
            ? Number(activeEffect.effectID)
            : this._getPropulsionEffectID(activeEffect.effectName);
        const activeEntry = this._buildActiveEffectEntry(
          item,
          activeEffectID,
          {
            startedAt: activeEffect.startedAtMs,
            duration: activeEffect.durationMs,
            repeat: activeEffect.repeat,
            targetID: activeEffect.targetID,
          },
          session,
        );
        if (activeEntry) {
          entries.push(activeEntry);
        }
      }
      const overloadEffect =
        typeof spaceRuntime.getOverloadModuleEffect === "function"
          ? spaceRuntime.getOverloadModuleEffect(session, item.itemID)
          : null;
      if (overloadEffect && Number(overloadEffect.effectID) > 0) {
        const overloadEntry = this._buildActiveEffectEntry(
          item,
          Number(overloadEffect.effectID),
          {
            startedAt: overloadEffect.startedAtMs,
            duration: overloadEffect.durationMs,
            repeat: overloadEffect.repeat,
            targetID: overloadEffect.targetID,
          },
          session,
        );
        if (overloadEntry) {
          entries.push(overloadEntry);
        }
      }
    }
    return entries.length > 0
      ? {
          type: "dict",
          entries,
        }
      : this._buildEmptyDict();
  }
  _listLoadedChargeSublocationItems(charID, shipID, options = {}) {
    const numericShipID = Number(shipID) || 0;
    if (numericShipID <= 0) {
      return [];
    }
    if (
      this._isFittingContextMatch(
        options.fittingContext,
        charID,
        numericShipID,
        options,
      )
    ) {
      return [...options.fittingContext.chargeItems];
    }
    const rows = options.includeAllFittingOwners === true
      ? listContainerItems(null, numericShipID, null)
      : getLoadedChargeItems(charID, numericShipID);
    return (Array.isArray(rows) ? rows : [])
      .filter((item) => (
        item &&
        Number(item.locationID) === numericShipID &&
        isShipFittingFlag(item.flagID) &&
        Number(item.categoryID) === 8 &&
        Number(item.typeID) > 0
      ))
      .sort((left, right) => (
        (Number(left.flagID) || 0) - (Number(right.flagID) || 0) ||
        (Number(left.typeID) || 0) - (Number(right.typeID) || 0) ||
        (Number(left.itemID) || 0) - (Number(right.itemID) || 0)
      ));
  }
  _buildChargeSublocationData(charID, shipID, options = {}) {
    const numericShipID = Number(shipID) || 0;
    return this._listLoadedChargeSublocationItems(charID, numericShipID, options)
      .map((item) => ({
        flagID: Number(item.flagID) || 0,
        itemID: buildChargeTupleItemID(numericShipID, item.flagID, item.typeID),
        quantity: Number(item.stacksize ?? item.quantity ?? 0) || 0,
        sourceItem: item,
        typeID: Number(item.typeID) || 0,
      }))
      .filter((entry) => entry.flagID > 0 && entry.typeID > 0);
  }
  _buildShipInventoryInfoEntries(
    charID,
    shipID,
    ownerID,
    locationID,
    session = null,
    options = {},
  ) {
    const inventoryEntries = [];
    const listFittedRows = (chargeRows = false) => {
      if (
        this._isFittingContextMatch(
          options.fittingContext,
          charID,
          shipID,
          options,
        )
      ) {
        return chargeRows
          ? options.fittingContext.chargeItems
          : options.fittingContext.moduleItems;
      }
      if (options.includeAllFittingOwners === true) {
        return listContainerItems(null, shipID, null)
          .filter((item) => item && isShipFittingFlag(item.flagID))
          .filter((item) => (Number(item.categoryID) === 8) === chargeRows)
          .sort((left, right) => (
            (Number(left && left.flagID) || 0) - (Number(right && right.flagID) || 0) ||
            (Number(left && left.itemID) || 0) - (Number(right && right.itemID) || 0)
          ));
      }
      return chargeRows
        ? getLoadedChargeItems(charID, shipID)
        : getFittedModuleItems(charID, shipID);
    };
    if (options.includeFittedItems !== false) {
      const fittedItems = listFittedRows(false);
      if (Array.isArray(fittedItems)) {
        for (const item of fittedItems) {
          const hasDynamicStructureServiceAttributes = isStructureServiceModuleItem(item);
          const cachedEntry = hasDynamicStructureServiceAttributes
            ? null
            : this._getCachedDockedItemInfoEntry(
                session,
                item.itemID,
                item,
              );
          const entry =
            cachedEntry ||
            this._buildCommonGetInfoEntry({
              itemID: item.itemID,
              typeID: item.typeID,
              ownerID: item.ownerID || ownerID,
              locationID: this._coalesce(item.locationID, shipID),
              flagID: item.flagID,
              groupID: item.groupID,
              categoryID: item.categoryID,
              quantity: item.quantity,
              singleton: item.singleton,
              stacksize: item.stacksize,
              customInfo: item.customInfo || "",
              description: item.itemName || "item",
              activeEffects: this._buildInventoryItemActiveEffects(item, session),
              attributes: this._buildInventoryItemAttributeDict(item, session, {
                fittingContext: options.fittingContext,
              }),
              session,
            });
          inventoryEntries.push([
            item.itemID,
            entry,
          ]);
          if (!hasDynamicStructureServiceAttributes) {
            this._cacheDockedItemInfoEntry(session, item.itemID, item, entry);
          }
        }
      }
    }
    if (options.includeLoadedCharges === true) {
      const loadedCharges = listFittedRows(true);
      if (Array.isArray(loadedCharges)) {
        for (const item of loadedCharges) {
          const cachedEntry = this._getCachedDockedItemInfoEntry(
            session,
            item.itemID,
            item,
          );
          const entry =
            cachedEntry ||
            this._buildCommonGetInfoEntry({
              itemID: item.itemID,
              typeID: item.typeID,
              ownerID: item.ownerID || ownerID,
              locationID: this._coalesce(item.locationID, shipID),
              flagID: item.flagID,
              groupID: item.groupID,
              categoryID: item.categoryID,
              quantity: item.quantity,
              singleton: item.singleton,
              stacksize: item.stacksize,
              customInfo: item.customInfo || "",
              description: item.itemName || "charge",
              attributes: this._buildInventoryItemAttributeDict(item, session, {
                fittingContext: options.fittingContext,
              }),
              session,
            });
          inventoryEntries.push([
            item.itemID,
            entry,
          ]);
          this._cacheDockedItemInfoEntry(session, item.itemID, item, entry);
        }
      }
    }
    if (options.includeChargeSublocations !== false) {
      const tupleChargeEntries = this._buildChargeSublocationData(charID, shipID, options)
        .map((entry) => {
          const loadedCharge =
            entry.sourceItem || getLoadedChargeByFlag(charID, shipID, entry.flagID);
          if (!loadedCharge) {
            return null;
          }
          const quantity = Math.max(
            0,
            Number(loadedCharge.stacksize ?? loadedCharge.quantity ?? 0) || 0,
          );
          const tupleChargeItem = {
            ...loadedCharge,
            itemID: buildChargeTupleItemID(shipID, entry.flagID, entry.typeID),
            ownerID: loadedCharge.ownerID || ownerID,
            locationID: shipID,
            flagID: entry.flagID,
            typeID: entry.typeID,
            quantity,
            stacksize: quantity,
            singleton: 0,
            customInfo: loadedCharge.customInfo || "",
          };
          return [
            tupleChargeItem.itemID,
            this._buildCommonGetInfoEntry({
              itemID: tupleChargeItem.itemID,
              typeID: tupleChargeItem.typeID,
              ownerID: tupleChargeItem.ownerID || ownerID,
              locationID: shipID,
              flagID: tupleChargeItem.flagID,
              groupID: tupleChargeItem.groupID,
              categoryID: tupleChargeItem.categoryID,
              quantity,
              singleton: 0,
              stacksize: quantity,
              customInfo: tupleChargeItem.customInfo || "",
              description: "charge",
              // Login tooltip parity: the active-ship HUD resolves current-ship
              // charge DPS through `svc.godma`, not only clientDogmaLocation.
              // Stock `GetAllInfo.shipInfo` therefore has to seed the tuple
              // charge rows with the full attribute dict, not just quantity.
              attributes: this._buildInventoryItemAttributeDict(
                tupleChargeItem,
                session,
                {
                  fittingContext: options.fittingContext,
                },
              ),
              invItem: null,
              session,
            }),
          ];
        })
        .filter(Boolean);
      inventoryEntries.push(...tupleChargeEntries);
    }
    return inventoryEntries;
  }
  _buildChargeSublocationRow({
    locationID,
    flagID,
    typeID,
    quantity,
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", ["instanceID", "flagID", "typeID", "quantity"]],
          ["line", [locationID, flagID, typeID, quantity]],
        ],
      },
    };
  }
  _buildChargeStateDict(charID, shipID, options = {}) {
    const chargesByFlag = this._buildChargeSublocationData(charID, shipID, options);
    if (chargesByFlag.length === 0) {
      return this._buildEmptyDict();
    }
    return {
      type: "dict",
      entries: [[
        shipID,
        {
          type: "dict",
          entries: chargesByFlag.map((entry) => [
            entry.flagID,
            this._buildChargeSublocationRow({
              locationID: shipID,
              flagID: entry.flagID,
              typeID: entry.typeID,
              quantity: entry.quantity,
            }),
          ]),
        },
      ]],
    };
  }
  _findInventoryItemContext(requestedItemID, session, options = {}) {
    const includeAttributes = options.includeAttributes !== false;
    const charID = this._getCharID(session);
    if (Array.isArray(requestedItemID) && requestedItemID.length >= 3) {
      const [shipID, flagID, typeID] = requestedItemID;
      const chargeItem = getLoadedChargeByFlag(charID, Number(shipID), Number(flagID));
      if (
        chargeItem &&
        Number(chargeItem.typeID) === Number(typeID)
      ) {
        return {
          itemID: requestedItemID,
          typeID: Number(typeID),
          item: chargeItem,
          attributes: includeAttributes
            ? this._buildInventoryItemAttributes(chargeItem, session)
            : undefined,
          baseAttributes: includeAttributes
            ? this._buildInventoryItemAttributes(chargeItem)
            : undefined,
        };
      }
      return null;
    }
    const numericItemID = Number.parseInt(String(requestedItemID), 10) || 0;
    if (numericItemID <= 0) {
      return null;
    }
    const item = findItemById(numericItemID);
    if (
      !item ||
      Number(item.ownerID) !== charID ||
      Number(item.categoryID) === SHIP_CATEGORY_ID
    ) {
      return null;
    }
    return {
      itemID: item.itemID,
      typeID: Number(item.typeID),
      item,
      attributes: includeAttributes
        ? this._buildInventoryItemAttributes(item, session)
        : undefined,
      baseAttributes: includeAttributes
        ? this._buildInventoryItemAttributes(item)
        : undefined,
    };
  }
  _notifyModuleAttributeChanges(session, changes = []) {
    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      return;
    }
    const normalizedChanges = changes.map((change) => normalizeModuleAttributeChange(change));
    session.sendNotification("OnModuleAttributeChanges", "clientID", [{
      type: "list",
      items: normalizedChanges,
    }]);
    log.debug(
      `[DogmaIM] OnModuleAttributeChanges count=${normalizedChanges.length} ` +
      `changes=${JSON.stringify(
        normalizedChanges.map((change) => summarizeModuleAttributeChangeLog(change)),
      )}`,
    );
  }
  _notifyShipFittingResourceAttributeChanges(
    session,
    shipID,
    previousSnapshot,
    nextSnapshot,
  ) {
    if (!previousSnapshot || !nextSnapshot) {
      return;
    }
    const numericShipID = Number(shipID) || this._getShipID(session);
    const charID = this._getCharID(session);
    if (numericShipID <= 0 || charID <= 0) {
      return;
    }

    const timestamp = this._sessionFileTime(session);
    const changes = listShipFittingAttributeChanges(
      previousSnapshot,
      nextSnapshot,
    ).map((change) => [
      "OnModuleAttributeChanges",
      charID,
      numericShipID,
      Number(change.attributeID) || 0,
      timestamp,
      Number(change.nextValue) || 0,
      Number(change.previousValue) || 0,
      null,
    ]);
    this._notifyModuleAttributeChanges(session, changes);
  }
  _refreshDockedFittingState(session, changes = [], options = {}) {
    if (
      !session ||
      !isDockedSession(session) ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      return;
    }
    const activeShipID = Number(
      session.activeShipID || session.shipID || session.shipid || 0,
    ) || 0;
    if (activeShipID <= 0) {
      return;
    }
    const touchesFittingState = changes.some((change) => {
      if (!change || !change.item) {
        return false;
      }
      const previousState = change.previousData || change.previousState || {};
      const previousLocationID = Number(previousState.locationID) || 0;
      const previousFlagID = Number(previousState.flagID) || 0;
      const nextLocationID = Number(change.item.locationID) || 0;
      const nextFlagID = Number(change.item.flagID) || 0;
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
      ...this._getFittingContextSnapshotOptions(
        options.fittingContext,
        this._getCharID(session),
        activeShipID,
      ),
    });
  }
  _captureChargeStateSnapshot(charID, shipID, flagID) {
    const chargeItem = getLoadedChargeByFlag(charID, shipID, flagID);
    if (!chargeItem) {
      return {
        typeID: 0,
        quantity: 0,
      };
    }
    return {
      typeID: Number(chargeItem.typeID) || 0,
      quantity: Math.max(
        0,
        Number(chargeItem.stacksize ?? chargeItem.quantity ?? 0) || 0,
      ),
    };
  }
  _captureChargeItemSnapshot(charID, shipID, flagID) {
    const chargeItem = getLoadedChargeByFlag(charID, shipID, flagID);
    return chargeItem ? { ...chargeItem } : null;
  }
  _buildChargeTransitionPrimeItem(
    charID,
    shipID,
    flagID,
    chargeState = null,
    chargeItem = null,
  ) {
    const typeID =
      Number(chargeState && chargeState.typeID) ||
      Number(chargeItem && chargeItem.typeID) ||
      0;
    if (typeID <= 0) {
      return null;
    }
    return buildChargeSublocationItem({
      shipID,
      flagID,
      typeID,
      quantity: 0,
      ownerID: charID,
      groupID: chargeItem && chargeItem.groupID,
      categoryID: chargeItem && chargeItem.categoryID,
    });
  }
  _primeChargeTupleForQuantityTransition(
    session,
    charID,
    shipID,
    flagID,
    chargeState = null,
    chargeItem = null,
    options = {},
  ) {
    if (options.primeNewChargeTuple === false) {
      return false;
    }
    const primeItem = this._buildChargeTransitionPrimeItem(
      charID,
      shipID,
      flagID,
      chargeState,
      chargeItem,
    );
    if (!primeItem) {
      return false;
    }
    syncChargeGodmaPrimeForSession(session, shipID, primeItem, {
      description: "charge",
      now: options.when != null ? options.when : this._sessionFileTime(session),
    });
    return true;
  }
  _notifyWeaponModuleAttributeTransition(
    session,
    moduleItem,
    previousChargeItem = null,
    nextChargeItem = null,
  ) {
    if (!session || typeof session.sendNotification !== "function" || !moduleItem) {
      return;
    }
    const numericModuleID = Number(moduleItem.itemID) || 0;
    const numericCharID = Number(moduleItem.ownerID) || this._getCharID(session);
    if (numericModuleID <= 0 || numericCharID <= 0) {
      return;
    }
    const previousAttributes =
      this._buildWeaponModuleAttributeMap(
        moduleItem,
        previousChargeItem,
        session,
      ) || {};
    const nextAttributes =
      this._buildWeaponModuleAttributeMap(
        moduleItem,
        nextChargeItem,
        session,
      ) || {};
    const changedAttributeIDs = new Set([
      ...Object.keys(previousAttributes),
      ...Object.keys(nextAttributes),
    ]);
    const when = this._sessionFileTime(session);
    const changes = [];
    for (const rawAttributeID of changedAttributeIDs) {
      const attributeID = Number(rawAttributeID);
      if (!Number.isInteger(attributeID) || attributeID <= 0) {
        continue;
      }
      const previousValue = Object.prototype.hasOwnProperty.call(
        previousAttributes,
        attributeID,
      )
        ? Number(previousAttributes[attributeID])
        : 0;
      const nextValue = Object.prototype.hasOwnProperty.call(
        nextAttributes,
        attributeID,
      )
        ? Number(nextAttributes[attributeID])
        : 0;
      if (
        !Number.isFinite(previousValue) ||
        !Number.isFinite(nextValue) ||
        Math.abs(nextValue - previousValue) <= 1e-9
      ) {
        continue;
      }
      changes.push([
        "OnModuleAttributeChanges",
        numericCharID,
        numericModuleID,
        attributeID,
        when,
        nextValue,
        previousValue,
        null,
      ]);
    }
    if (changes.length > 0) {
      this._notifyModuleAttributeChanges(session, changes);
    }
  }
  _notifyChargeQuantityTransition(
    session,
    charID,
    shipID,
    flagID,
    previousState = null,
    nextState = null,
    options = {},
  ) {
    if (!ATTRIBUTE_QUANTITY) {
      return false;
    }
    const numericCharID = Number(charID) || this._getCharID(session);
    const numericShipID = Number(shipID) || this._getShipID(session);
    const numericFlagID = Number(flagID) || 0;
    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      numericCharID <= 0 ||
      numericShipID <= 0 ||
      numericFlagID <= 0
    ) {
      return false;
    }
    if (isDockedSession(session)) {
      return false;
    }

    const previousTypeID = Number(previousState && previousState.typeID) || 0;
    const nextTypeID = Number(nextState && nextState.typeID) || 0;
    const previousQuantity = Math.max(
      0,
      Number(previousState && previousState.quantity) || 0,
    );
    const nextQuantity = Math.max(
      0,
      Number(nextState && nextState.quantity) || 0,
    );
    if (
      previousTypeID === nextTypeID &&
      previousQuantity === nextQuantity
    ) {
      return false;
    }

    const when = options.when != null
      ? options.when
      : this._sessionFileTime(session);
    const sendQuantityChange = (change) => {
      if (!change) {
        return false;
      }
      this._notifyModuleAttributeChanges(session, [change]);
      return true;
    };
    const buildQuantityChange = (typeID, nextValue, previousValue) => [
        "OnModuleAttributeChange",
        numericCharID,
        buildChargeTupleItemID(numericShipID, numericFlagID, typeID),
        ATTRIBUTE_QUANTITY,
        when,
        nextValue,
        previousValue,
        null,
      ];
    let notified = false;
    if (previousTypeID > 0) {
      notified = sendQuantityChange(buildQuantityChange(
        previousTypeID,
        previousTypeID === nextTypeID ? nextQuantity : 0,
        previousQuantity,
      )) || notified;
    }
    if (nextTypeID > 0 && nextTypeID !== previousTypeID) {
      this._primeChargeTupleForQuantityTransition(
        session,
        numericCharID,
        numericShipID,
        numericFlagID,
        nextState,
        options.nextChargeItem,
        {
          ...options,
          when,
        },
      );
      notified = sendQuantityChange(buildQuantityChange(
        nextTypeID,
        nextQuantity,
        0,
      )) || notified;
    }
    return notified;
  }
  _syncInventoryChanges(session, changes = [], options = {}) {
    if (!session || !Array.isArray(changes)) {
      return;
    }
    const normalizedChanges = this._normalizeInventoryChanges(changes);
    const clientFacingChanges = this._filterInventoryChangesForClient(
      session,
      normalizedChanges,
    );
    for (const change of clientFacingChanges) {
      if (!change) {
        continue;
      }
      if (change.item) {
        if (!this._syncShipInventoryItemsChangedForSession(session, change)) {
          syncInventoryItemForSession(
            session,
            change.item,
            change.previousData || change.previousState || {},
            {
              emitCfgLocation: false,
            },
          );
        }
      }
    }
    this._refreshDockedFittingState(session, normalizedChanges, options);
  }
  _getSkillQueueRuntime() {
    return require(path.join(
      __dirname,
      "../skills/training/skillQueueRuntime",
    ));
  }
  _captureQueueSnapshotForAttributeChange(charID, reason = "attribute") {
    try {
      const { getQueueSnapshot } = this._getSkillQueueRuntime();
      return getQueueSnapshot(charID);
    } catch (error) {
      log.warn(
        `[DogmaIM] Failed to capture skill queue before ${reason} change char=${charID}: ${error && error.message ? error.message : error}`,
      );
      return null;
    }
  }
  _prepareQueueForAttributeChange(charID, reason = "attribute", snapshot = null) {
    try {
      const { prepareQueueForAttributeChange } = this._getSkillQueueRuntime();
      return prepareQueueForAttributeChange(charID, snapshot ? { snapshot } : {});
    } catch (error) {
      log.warn(
        `[DogmaIM] Failed to prepare skill queue for ${reason} change char=${charID}: ${error && error.message ? error.message : error}`,
      );
      return null;
    }
  }
  _syncQueueAfterAttributeChange(charID, reason = "attribute") {
    try {
      const { syncQueueAfterAttributeChange } = this._getSkillQueueRuntime();
      return syncQueueAfterAttributeChange(charID);
    } catch (error) {
      log.warn(
        `[DogmaIM] Failed to sync skill queue after ${reason} change char=${charID}: ${error && error.message ? error.message : error}`,
      );
      return null;
    }
  }
  _syncCapsuleTypeForCharacter(session, charID) {
    const result = syncCapsuleTypeForCharacter(charID);
    if (!result.success) {
      if (result.errorMsg !== "CAPSULE_NOT_FOUND") {
        log.warn(
          `[DogmaIM] Failed to sync capsule type after implant change char=${charID}: ${result.errorMsg || "UNKNOWN"}`,
        );
      }
      return result;
    }

    if (session && result.changed && result.data) {
      const activeShipID = Number(
        session.shipID ||
        session.shipid ||
        session.activeShipID ||
        session._space && session._space.shipID ||
        0,
      ) || 0;
      if (activeShipID === Number(result.data.itemID)) {
        session.shipTypeID = Number(result.data.typeID) || session.shipTypeID;
        session.shiptypeid = Number(result.data.typeID) || session.shiptypeid;
        session.shipName = result.data.itemName || session.shipName;
      }
      this._syncInventoryChanges(session, [{
        item: result.data,
        previousData: result.previousData || {},
      }]);
    }
    return result;
  }
  _resolveShipInventoryChangeContext(session, change = {}) {
    if (!session || !session._space || !change || !change.item) {
      return null;
    }
    const activeShipID = Number(
      (session._space && session._space.shipID) ||
      session.activeShipID ||
      session.shipID ||
      session.shipid ||
      0,
    ) || 0;
    if (activeShipID <= 0) {
      return null;
    }
    const currentItem = change.item || {};
    const previousItem = change.previousData || change.previousState || {};
    const currentLocationID = Number(currentItem.locationID) || 0;
    const previousLocationID = Number(previousItem.locationID) || 0;
    const currentFlagID = Number(currentItem.flagID) || 0;
    const previousFlagID = Number(previousItem.flagID) || 0;
    if (
      (currentLocationID === activeShipID &&
        currentFlagID === ITEM_FLAGS.CARGO_HOLD) ||
      (previousLocationID === activeShipID &&
        previousFlagID === ITEM_FLAGS.CARGO_HOLD)
    ) {
      return ["Ship", activeShipID, "ShipCargo"];
    }
    return null;
  }
  _syncShipInventoryItemsChangedForSession(session, change = {}) {
    const context = this._resolveShipInventoryChangeContext(session, change);
    if (!context) {
      return false;
    }
    const payload = buildItemChangePayload(
      change.item,
      change.previousData || change.previousState || {},
    );
    const row = Array.isArray(payload) ? payload[0] : null;
    const changeDict = Array.isArray(payload) ? payload[1] : null;
    if (!row || !changeDict) {
      return false;
    }
    session.sendNotification("OnItemsChanged", "charid", [
      {
        type: "list",
        items: [row],
      },
      changeDict,
      context,
    ]);
    return true;
  }
  _resolveProbeLaunchPosition(session, shipID) {
    const numericShipID = Number(shipID) || this._getShipID(session);
    const scene = spaceRuntime.getSceneForSession(session);
    const shipEntity =
      (scene &&
        typeof scene.getShipEntityForSession === "function" &&
        scene.getShipEntityForSession(session)) ||
      (scene &&
        typeof scene.getEntityByID === "function" &&
        scene.getEntityByID(numericShipID)) ||
      null;
    const rawPosition =
      (shipEntity &&
        (shipEntity.position || shipEntity.destination || shipEntity.pos)) ||
      null;
    if (Array.isArray(rawPosition)) {
      return {
        x: Number(rawPosition[0]) || 0,
        y: Number(rawPosition[1]) || 0,
        z: Number(rawPosition[2]) || 0,
      };
    }
    return {
      x: Number(rawPosition && rawPosition.x) || 0,
      y: Number(rawPosition && rawPosition.y) || 0,
      z: Number(rawPosition && rawPosition.z) || 0,
    };
  }
  _resolveValidatedProbeLaunchContext(session, moduleID, requestedCount = 1) {
    const normalizedModuleID = Number(moduleID) || 0;
    const normalizedRequestedCount = Math.max(1, Number(requestedCount) || 1);
    const shipID = this._getShipID(session);
    const charID = this._getCharID(session);
    const systemID = Number(
      (session && session.solarsystemid2) ||
      (session && session.solarsystemid) ||
      (session && session._space && session._space.systemID) ||
      0,
    ) || 0;
    const moduleItem = findItemById(normalizedModuleID);
    if (
      !session ||
      !session._space ||
      charID <= 0 ||
      shipID <= 0 ||
      systemID <= 0
    ) {
      this._throwProbeLaunchUserError("NOT_IN_SPACE", moduleItem);
    }
    if (
      !moduleItem ||
      Number(moduleItem.ownerID) !== charID ||
      Number(moduleItem.locationID) !== shipID
    ) {
      this._throwProbeLaunchUserError("MODULE_NOT_FOUND", moduleItem);
    }
    if (Number(moduleItem.groupID) !== GROUP_SCAN_PROBE_LAUNCHER) {
      this._throwProbeLaunchUserError("INVALID_LAUNCHER", moduleItem);
    }
    if (!isEffectivelyOnlineModule(moduleItem)) {
      this._throwProbeLaunchUserError("MODULE_NOT_ONLINE", moduleItem);
    }

    const removedGhostProbes = probeRuntimeState.removeInvalidCharacterProbes(charID, {
      systemID,
      nowMs: Date.now(),
    });
    if (removedGhostProbes.length > 0) {
      log.debug(
        `[DogmaIM] Purged ${removedGhostProbes.length} invalid persisted probe record(s) ` +
        `before launch for charID=${charID} systemID=${systemID}`,
      );
    }
    const removedExpiredProbes = probeRuntimeState.removeExpiredCharacterProbes(charID, {
      systemID,
      nowMs: Date.now(),
    });
    if (removedExpiredProbes.length > 0) {
      log.debug(
        `[DogmaIM] Purged ${removedExpiredProbes.length} expired persisted probe record(s) ` +
        `before launch for charID=${charID} systemID=${systemID}`,
      );
    }

    const loadedCharge = getLoadedChargeByFlag(charID, shipID, moduleItem.flagID);
    if (!loadedCharge) {
      this._throwProbeLaunchUserError("NO_CHARGES", moduleItem);
    }
    if (
      Number(loadedCharge.categoryID) !== SCANNER_PROBE_CATEGORY_ID ||
      Number(loadedCharge.groupID) !== GROUP_SCANNER_PROBE
    ) {
      this._throwProbeLaunchUserError("INVALID_CHARGE", moduleItem);
    }

    const loadedChargeQuantity = Math.max(
      0,
      Number(loadedCharge.stacksize ?? loadedCharge.quantity ?? 0) || 0,
    );
    if (loadedChargeQuantity < normalizedRequestedCount) {
      this._throwProbeLaunchUserError("NOT_ENOUGH_CHARGES", moduleItem);
    }

    const activeProbeCount = probeRuntimeState.getReconnectableCharacterProbes(charID, systemID)
      .length;
    if ((activeProbeCount + normalizedRequestedCount) > probeRuntimeState.MAX_ACTIVE_PROBES) {
      this._throwProbeLaunchUserError("TOO_MANY_ACTIVE_PROBES", moduleItem);
    }

    return {
      moduleItem,
      loadedCharge,
      requestedCount: normalizedRequestedCount,
      shipID,
      charID,
      systemID,
    };
  }
  _throwProbeLaunchUserError(errorMsg = "", moduleItem = null) {
    switch (String(errorMsg || "").trim()) {
      case "NO_CHARGES":
        throwWrappedUserError("NoCharges", {
          launcher: this._buildUserErrorTypeValue(moduleItem && moduleItem.typeID),
        });
        break;
      case "TOO_MANY_ACTIVE_PROBES":
        this._throwCustomNotifyUserError("You cannot control more than eight active probes.");
        break;
      case "NOT_ENOUGH_CHARGES":
        this._throwCustomNotifyUserError("You do not have enough loaded scanner probes.");
        break;
      case "NOT_IN_SPACE":
      case "MODULE_NOT_FOUND":
      case "SHIP_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "MODULE_NOT_ONLINE":
        this._throwCustomNotifyUserError(`${this._resolveModuleDisplayName(moduleItem)} is offline.`);
        break;
      case "INVALID_LAUNCHER":
        this._throwCustomNotifyUserError("That module cannot launch scanner probes.");
        break;
      case "INVALID_CHARGE":
        this._throwCustomNotifyUserError("The loaded charge is not a valid scanner probe.");
        break;
      default:
        this._throwCustomNotifyUserError("Unable to launch probes.");
        break;
    }
  }
  _resolveValidatedInterdictionProbeLaunchContext(session, moduleID) {
    const normalizedModuleID = Number(moduleID) || 0;
    const shipID = this._getShipID(session);
    const charID = this._getCharID(session);
    const moduleItem = findItemById(normalizedModuleID);
    const loadedCharge = moduleItem
      ? getLoadedChargeByFlag(charID, shipID, moduleItem.flagID)
      : null;
    if (!moduleItem) {
      this._throwInterdictionProbeLaunchUserError("MODULE_NOT_FOUND", moduleItem);
    }
    if (Number(moduleItem.groupID) !== GROUP_INTERDICTION_SPHERE_LAUNCHER) {
      this._throwInterdictionProbeLaunchUserError("INVALID_LAUNCHER", moduleItem);
    }
    if (!isEffectivelyOnlineModule(moduleItem)) {
      this._throwInterdictionProbeLaunchUserError("MODULE_NOT_ONLINE", moduleItem);
    }

    const validation = interdictionProbeRuntime.validateInterdictionProbeLaunchContext(
      session,
      moduleItem,
      loadedCharge,
    );
    if (!validation || validation.success !== true) {
      this._throwInterdictionProbeLaunchUserError(
        validation && validation.errorMsg,
        moduleItem,
      );
    }
    const contextData = validation.data || {};
    return {
      moduleItem,
      loadedCharge,
      shipID,
      charID,
      systemID:
        contextData.context && Number(contextData.context.systemID) > 0
          ? Number(contextData.context.systemID)
          : Number(
            (session && session.solarsystemid2) ||
            (session && session.solarsystemid) ||
            (session && session._space && session._space.systemID) ||
            0,
          ) || 0,
    };
  }
  _throwInterdictionProbeLaunchUserError(errorMsg = "", moduleItem = null) {
    const normalizedError = String(errorMsg || "").trim();
    switch (normalizedError) {
      case "NO_CHARGES":
        throwWrappedUserError("NoCharges", {
          launcher: this._buildUserErrorTypeValue(moduleItem && moduleItem.typeID),
        });
        break;
      case "NOT_IN_SPACE":
      case "MODULE_NOT_FOUND":
      case "SHIP_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "MODULE_NOT_ONLINE":
        this._throwCustomNotifyUserError(`${this._resolveModuleDisplayName(moduleItem)} is offline.`);
        break;
      case "INVALID_LAUNCHER":
        this._throwCustomNotifyUserError("That module cannot launch warp disrupt probes.");
        break;
      case "INVALID_CHARGE":
        this._throwCustomNotifyUserError("The loaded charge is not a valid warp disrupt probe.");
        break;
      case "INTERDICTION_PROBE_POSITION_UNAVAILABLE":
        this._throwCustomNotifyUserError("Unable to resolve a launch position for the warp disrupt probe.");
        break;
      default:
        if (normalizedError) {
          this._throwCustomNotifyUserError(normalizedError);
        }
        this._throwCustomNotifyUserError("Unable to launch warp disrupt probe.");
        break;
    }
  }
  _launchInterdictionProbeFromContext(session, probeContext = null) {
    const moduleItem = probeContext && probeContext.moduleItem
      ? probeContext.moduleItem
      : null;
    const loadedCharge = probeContext && probeContext.loadedCharge
      ? probeContext.loadedCharge
      : null;
    const charID = Number(probeContext && probeContext.charID) || this._getCharID(session);
    const shipID = Number(probeContext && probeContext.shipID) || this._getShipID(session);
    const systemID = Number(probeContext && probeContext.systemID) || Number(
      (session && session.solarsystemid2) ||
      (session && session.solarsystemid) ||
      (session && session._space && session._space.systemID) ||
      0,
    ) || 0;

    const launchResult = interdictionProbeRuntime.launchInterdictionProbeFromModule(
      session,
      moduleItem,
      loadedCharge,
    );
    if (!launchResult || launchResult.success !== true) {
      this._throwInterdictionProbeLaunchUserError(
        launchResult && launchResult.errorMsg,
        moduleItem,
      );
    }

    const launchedItemID = Number(launchResult.data && launchResult.data.itemID) || 0;
    const consumeResult = this._consumeLoadedProbeCharge(
      session,
      charID,
      shipID,
      moduleItem,
      1,
    );
    if (!consumeResult.success) {
      if (launchedItemID > 0) {
        interdictionProbeRuntime.removeInterdictionProbe(
          launchedItemID,
          systemID,
          "charge-consume-failed",
        );
      }
      this._throwInterdictionProbeLaunchUserError(consumeResult.errorMsg, moduleItem);
    }

    const remainingQuantity = Math.max(
      0,
      Number(consumeResult && consumeResult.data && consumeResult.data.remainingQuantity) || 0,
    );
    return {
      launchedProbeID: launchedItemID,
      chargeTypeID: Number(loadedCharge && loadedCharge.typeID) || 0,
      remainingQuantity,
      autoReloadRecommended: remainingQuantity <= 0,
    };
  }
  _resolveValidatedWarpDisruptFieldGeneratorContext(session, moduleItem) {
    const shipID = this._getShipID(session);
    const charID = this._getCharID(session);
    const systemID = Number(
      (session && session.solarsystemid2) ||
      (session && session.solarsystemid) ||
      (session && session._space && session._space.systemID) ||
      0,
    ) || 0;
    const loadedCharge = moduleItem
      ? getLoadedChargeByFlag(charID, shipID, moduleItem.flagID)
      : null;

    if (!session || !session._space || charID <= 0 || shipID <= 0 || systemID <= 0) {
      this._throwWarpDisruptFieldGeneratorUserError("NOT_IN_SPACE", moduleItem);
    }
    if (!moduleItem || Number(moduleItem.locationID) !== shipID) {
      this._throwWarpDisruptFieldGeneratorUserError("MODULE_NOT_FOUND", moduleItem);
    }
    if (Number(moduleItem.groupID) !== GROUP_WARP_DISRUPT_FIELD_GENERATOR) {
      this._throwWarpDisruptFieldGeneratorUserError("INVALID_MODULE", moduleItem);
    }
    if (!isEffectivelyOnlineModule(moduleItem)) {
      this._throwWarpDisruptFieldGeneratorUserError("MODULE_NOT_ONLINE", moduleItem);
    }

    const restriction = warpDisruptFieldGeneratorRuntime.getActivationRestriction(
      systemID,
      moduleItem,
      loadedCharge,
    );
    if (restriction) {
      this._throwWarpDisruptFieldGeneratorUserError(restriction, moduleItem);
    }

    return {
      moduleItem,
      loadedCharge,
      charID,
      shipID,
      systemID,
    };
  }
  _throwWarpDisruptFieldGeneratorUserError(errorMsg = "", moduleItem = null) {
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "MODULE_NOT_FOUND":
      case "SHIP_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "MODULE_NOT_ONLINE":
        this._throwCustomNotifyUserError(`${this._resolveModuleDisplayName(moduleItem)} is offline.`);
        break;
      case "INVALID_MODULE":
      case "INVALID_WARP_DISRUPT_FIELD_GENERATOR":
        this._throwCustomNotifyUserError("That module cannot create a warp disruption field.");
        break;
      case "WARP_DISRUPT_FIELD_GENERATOR_SCRIPT_UNSUPPORTED":
        this._throwCustomNotifyUserError("That Warp Disruption Field Generator script is not supported.");
        break;
      case "INVALID_WARP_DISRUPT_FIELD_GENERATOR_CHARGE":
        this._throwCustomNotifyUserError("The loaded charge is not valid for this warp disruption field mode.");
        break;
      case "SOLAR_SYSTEM_DATA_UNAVAILABLE":
        this._throwCustomNotifyUserError("Solar system data is unavailable for this warp disruption field.");
        break;
      case "WARP_DISRUPTION_FIELD_DISALLOWED_IN_EMPIRE":
        this._throwCustomNotifyUserError("Warp Disruption Fields cannot be used in high or low security space.");
        break;
      case "WARP_DISRUPTION_FIELD_DISALLOWED_IN_ZARZAKH":
        this._throwCustomNotifyUserError("Warp Disruption Fields cannot be used in Zarzakh.");
        break;
      case "WARP_DISRUPTION_FIELD_RANGE_UNAVAILABLE":
        this._throwCustomNotifyUserError("Warp disruption field range is unavailable for this module.");
        break;
      default:
        this._throwCustomNotifyUserError("Unable to activate warp disruption field generator.");
        break;
    }
  }
  _launchProbesFromContext(session, probeContext = null) {
    const moduleItem = probeContext && probeContext.moduleItem
      ? probeContext.moduleItem
      : null;
    const loadedCharge = probeContext && probeContext.loadedCharge
      ? probeContext.loadedCharge
      : null;
    const requestedCount = Math.max(
      1,
      Number(probeContext && probeContext.requestedCount) || 1,
    );
    const shipID = Number(probeContext && probeContext.shipID) || this._getShipID(session);
    const charID = Number(probeContext && probeContext.charID) || this._getCharID(session);
    const systemID = Number(probeContext && probeContext.systemID) || Number(
      (session && session.solarsystemid2) ||
      (session && session.solarsystemid) ||
      (session && session._space && session._space.systemID) ||
      0,
    ) || 0;

    const consumeResult = this._consumeLoadedProbeCharge(
      session,
      charID,
      shipID,
      moduleItem,
      requestedCount,
    );
    if (!consumeResult.success) {
      this._throwProbeLaunchUserError(consumeResult.errorMsg, moduleItem);
    }

    const launchPosition = this._resolveProbeLaunchPosition(session, shipID);
    const launchedProbes = probeRuntimeState.launchCharacterProbes(
      charID,
      systemID,
      Number(loadedCharge && loadedCharge.typeID) || 0,
      requestedCount,
      {
        nowMs: Date.now(),
        position: launchPosition,
        shipID,
        launcherItemID: Number(moduleItem && moduleItem.itemID) || 0,
        launcherFlagID: Number(moduleItem && moduleItem.flagID) || 0,
      },
    );
    if (launchedProbes.length !== requestedCount) {
      probeSceneRuntime.removeProbeEntitiesForSession(
        session,
        launchedProbes.map((probe) => Number(probe && probe.probeID) || 0),
      );
      probeRuntimeState.removeCharacterProbes(
        charID,
        launchedProbes.map((probe) => Number(probe && probe.probeID) || 0),
        { nowMs: Date.now() },
      );
      this._throwProbeLaunchUserError("TOO_MANY_ACTIVE_PROBES", moduleItem);
    }

    probeSceneRuntime.ensureProbeEntitiesForSession(session, launchedProbes, {
      ownerID: charID,
    });
    for (const probe of launchedProbes) {
      session.sendNotification("OnNewProbe", "clientID", [
        probeScanRuntime.buildProbeKeyVal(probe),
      ]);
    }
    return {
      launchedProbes,
      chargeTypeID: Number(loadedCharge && loadedCharge.typeID) || 0,
      remainingQuantity: Math.max(
        0,
        Number(consumeResult && consumeResult.data && consumeResult.data.remainingQuantity) || 0,
      ),
      autoReloadRecommended:
        Math.max(
          0,
          Number(consumeResult && consumeResult.data && consumeResult.data.remainingQuantity) || 0,
        ) <= 0,
    };
  }
  _consumeLoadedProbeCharge(session, charID, shipID, moduleItem, quantity = 1) {
    const numericCharID = Number(charID) || this._getCharID(session);
    const numericShipID = Number(shipID) || this._getShipID(session);
    const numericQuantity = Math.max(1, Number(quantity) || 1);
    if (!moduleItem || numericCharID <= 0 || numericShipID <= 0) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }

    const chargeItem = getLoadedChargeByFlag(
      numericCharID,
      numericShipID,
      Number(moduleItem.flagID) || 0,
    );
    if (!chargeItem) {
      return {
        success: false,
        errorMsg: "NO_CHARGES",
      };
    }

    const availableQuantity = Math.max(
      0,
      Number(chargeItem.stacksize ?? chargeItem.quantity ?? 0) || 0,
    );
    if (availableQuantity <= 0) {
      return {
        success: false,
        errorMsg: "NO_CHARGES",
      };
    }
    if (availableQuantity < numericQuantity) {
      return {
        success: false,
        errorMsg: "NOT_ENOUGH_CHARGES",
      };
    }

    const previousChargeState = this._captureChargeStateSnapshot(
      numericCharID,
      numericShipID,
      moduleItem.flagID,
    );
    const previousChargeItem = this._captureChargeItemSnapshot(
      numericCharID,
      numericShipID,
      moduleItem.flagID,
    );

    let mutationResult = null;
    if (availableQuantity === numericQuantity) {
      mutationResult = removeInventoryItem(chargeItem.itemID, {
        removeContents: true,
      });
    } else {
      mutationResult = updateInventoryItem(chargeItem.itemID, (currentItem) => ({
        ...currentItem,
        quantity: availableQuantity - numericQuantity,
        stacksize: availableQuantity - numericQuantity,
        singleton: 0,
      }));
    }
    if (!mutationResult || mutationResult.success !== true) {
      return {
        success: false,
        errorMsg: mutationResult && mutationResult.errorMsg ? mutationResult.errorMsg : "WRITE_ERROR",
      };
    }

    if (mutationResult.data && Array.isArray(mutationResult.data.changes)) {
      this._syncInventoryChanges(session, mutationResult.data.changes);
    } else {
      this._syncInventoryChanges(session, [{
        previousData: mutationResult.previousData || {},
        item: mutationResult.data || null,
      }]);
    }

    const nextChargeState = this._captureChargeStateSnapshot(
      numericCharID,
      numericShipID,
      moduleItem.flagID,
    );
    const nextChargeItem = this._captureChargeItemSnapshot(
      numericCharID,
      numericShipID,
      moduleItem.flagID,
    );
    this._notifyChargeQuantityTransition(
      session,
      numericCharID,
      numericShipID,
      moduleItem.flagID,
      previousChargeState,
      nextChargeState,
      {
        previousChargeItem,
        nextChargeItem,
      },
    );
    this._notifyWeaponModuleAttributeTransition(
      session,
      moduleItem,
      previousChargeItem,
      nextChargeItem,
    );

    return {
      success: true,
      data: {
        chargeTypeID: Number(chargeItem.typeID) || 0,
        remainingQuantity: Math.max(
          0,
          Number(nextChargeState && nextChargeState.quantity) || 0,
        ),
      },
    };
  }
  _buildRemovedInventoryNotificationState(item = {}) {
    return {
      ...item,
      locationID: REMOVED_ITEM_JUNK_LOCATION_ID,
      quantity:
        Number(item.singleton) === 1
          ? -1
          : Number(item.stacksize ?? item.quantity ?? 0) || 0,
      stacksize:
        Number(item.singleton) === 1
          ? 1
          : Number(item.stacksize ?? item.quantity ?? 0) || 0,
    };
  }
  _filterInventoryChangesForClient(session, changes = []) {
    if (!Array.isArray(changes)) {
      return [];
    }
    if (!session || !session._space) {
      return changes.filter((change) => Boolean(change));
    }
    const activeShipID = Number(
      (session._space && session._space.shipID) ||
      session.activeShipID ||
      session.shipID ||
      session.shipid ||
      0,
    ) || 0;
    return changes.flatMap((change) => {
      if (!change) {
        return [];
      }
      const currentItem = change.item || null;
      const previousItem = change.previousData || change.previousState || null;
      const candidateItem = currentItem || previousItem || null;
      if (!candidateItem || typeof candidateItem !== "object") {
        return [change];
      }
      if (Number(candidateItem.categoryID) !== 8) {
        return [change];
      }
      const currentLocationID = Number(currentItem && currentItem.locationID) || 0;
      const previousLocationID =
        Number(previousItem && previousItem.locationID) || 0;
      const currentFlagID = Number(currentItem && currentItem.flagID) || 0;
      const previousFlagID = Number(previousItem && previousItem.flagID) || 0;
      const currentFitted =
        currentLocationID === activeShipID &&
        isShipFittingFlag(currentFlagID);
      const previousFitted =
        previousLocationID === activeShipID &&
        isShipFittingFlag(previousFlagID);
      if (!currentFitted && !previousFitted) {
        return [change];
      }

      const movedWholeCargoStackIntoSlot =
        previousItem &&
        currentFitted &&
        !previousFitted &&
        previousLocationID === activeShipID;
      if (movedWholeCargoStackIntoSlot) {
        // Keep live dogma tuple-backed by suppressing the fitted charge row, but
        // still tell invCache that the source cargo stack disappeared so it does
        // not keep stale ammo itemIDs around after repeated crystal swaps.
        return [{
          ...change,
          item: this._buildRemovedInventoryNotificationState(previousItem),
          previousData: previousItem,
        }];
      }

      // Do not stream real fitted charge rows into the live in-space godma
      // inventory model. They end up in shipItem.modules, override the
      // tuple-backed slot charge rows, and the HUD then hovers real charge
      // itemIDs that clientDogmaIM never loaded.
      return [];
    });
  }
  _normalizeInventoryChanges(changes = []) {
    if (!Array.isArray(changes)) {
      return [];
    }
    return changes
      .filter((change) => change && change.item)
      .map((change) => ({
        ...change,
        previousData: change.previousData || change.previousState || {},
      }));
  }
  _moveLoadedChargeToDestination(
    chargeItem,
    destinationLocationID,
    destinationFlagID,
    quantity = null,
  ) {
    const sourceItemID = Number(chargeItem && chargeItem.itemID) || 0;
    const ownerID = Number(chargeItem && chargeItem.ownerID) || 0;
    const sourceFlagID = Number(chargeItem && chargeItem.flagID) || 0;
    const sourceQuantity = Math.max(
      0,
      Number(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity ?? 0)) || 0,
    );
    const numericDestinationLocationID = Number(destinationLocationID) || 0;
    const numericDestinationFlagID = Number(destinationFlagID) || 0;
    const requestedQuantity =
      quantity === null || quantity === undefined
        ? sourceQuantity
        : Math.max(1, Math.min(sourceQuantity, Number(quantity) || 0));
    if (
      sourceItemID <= 0 ||
      ownerID <= 0 ||
      requestedQuantity <= 0 ||
      numericDestinationLocationID <= 0
    ) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }
    const sourceIsLoadedCharge =
      Number(chargeItem.categoryID) === 8 &&
      isShipFittingFlag(sourceFlagID) &&
      !isShipFittingFlag(numericDestinationFlagID);
    if (!sourceIsLoadedCharge) {
      return moveItemToLocation(
        sourceItemID,
        numericDestinationLocationID,
        numericDestinationFlagID,
        requestedQuantity,
      );
    }
    const matchingDestinationCandidates = listContainerItems(
      ownerID,
      numericDestinationLocationID,
      numericDestinationFlagID,
    )
      .filter(
        (item) =>
          item &&
          Number(item.itemID) !== sourceItemID &&
          Number(item.singleton) !== 1 &&
          Number(item.typeID) === Number(chargeItem.typeID),
      )
      .sort((left, right) => Number(left.itemID) - Number(right.itemID));
    const preferredOriginStackID = Number(chargeItem && chargeItem.stackOriginID) || 0;
    const matchingDestinationStack =
      (preferredOriginStackID > 0
        ? matchingDestinationCandidates.find(
          (item) =>
            item &&
            Number(item.itemID) === preferredOriginStackID &&
            Number(item.singleton) !== 1 &&
            Number(item.typeID) === Number(chargeItem.typeID),
        )
        : null) ||
      matchingDestinationCandidates[0] ||
      null;
    if (matchingDestinationStack) {
      return mergeItemStacks(
        sourceItemID,
        matchingDestinationStack.itemID,
        requestedQuantity,
      );
    }
    if (requestedQuantity < sourceQuantity) {
      return moveItemToLocation(
        sourceItemID,
        numericDestinationLocationID,
        numericDestinationFlagID,
        requestedQuantity,
      );
    }
    const grantResult = grantItemToOwnerLocation(
      ownerID,
      numericDestinationLocationID,
      numericDestinationFlagID,
      Number(chargeItem.typeID) || 0,
      requestedQuantity,
      {
        itemName: chargeItem.itemName || "",
        customInfo: chargeItem.customInfo || "",
      },
    );
    if (!grantResult.success) {
      return grantResult;
    }
    const removeResult = removeInventoryItem(sourceItemID, {
      removeContents: false,
    });
    if (!removeResult.success) {
      return removeResult;
    }
    return {
      success: true,
      data: {
        quantity: requestedQuantity,
        changes: [
          ...this._normalizeInventoryChanges(grantResult.data && grantResult.data.changes),
          ...this._normalizeInventoryChanges(removeResult.data && removeResult.data.changes),
        ],
      },
    };
  }
  _buildShipBaseAttributes(shipData = {}) {
    const payload = readStaticTable(TABLE.SHIP_DOGMA_ATTRIBUTES);
    const shipTypeID = Number(shipData.typeID);
    const staticEntry =
      Number.isInteger(shipTypeID) &&
      payload &&
      payload.shipAttributesByTypeID &&
      typeof payload.shipAttributesByTypeID === "object"
        ? payload.shipAttributesByTypeID[String(shipTypeID)] || null
        : null;
    const staticAttributes =
      staticEntry && staticEntry.attributes && typeof staticEntry.attributes === "object"
        ? staticEntry.attributes
        : null;
    const attributes = staticAttributes
      ? Object.fromEntries(
          Object.entries(staticAttributes)
            .map(([attributeID, value]) => [Number(attributeID), Number(value)])
            .filter(
              ([attributeID, value]) =>
                Number.isInteger(attributeID) && Number.isFinite(value),
            ),
        )
      : {};
    const shipMetadata =
      Number.isInteger(shipTypeID) && shipTypeID > 0
        ? resolveShipByTypeID(shipTypeID)
        : null;
    const resolvedMass = Number(shipData.mass ?? (shipMetadata && shipMetadata.mass));
    if (!(ATTRIBUTE_MASS in attributes) && Number.isFinite(resolvedMass)) {
      attributes[ATTRIBUTE_MASS] = resolvedMass;
    }
    const resolvedCapacity = Number(
      shipData.capacity ?? (shipMetadata && shipMetadata.capacity),
    );
    if (!(ATTRIBUTE_CAPACITY in attributes) && Number.isFinite(resolvedCapacity)) {
      attributes[ATTRIBUTE_CAPACITY] = resolvedCapacity;
    }
    const resolvedVolume = Number(shipData.volume ?? (shipMetadata && shipMetadata.volume));
    if (!(ATTRIBUTE_VOLUME in attributes) && Number.isFinite(resolvedVolume)) {
      attributes[ATTRIBUTE_VOLUME] = resolvedVolume;
    }
    const resolvedRadius = Number(shipData.radius ?? (shipMetadata && shipMetadata.radius));
    if (!(ATTRIBUTE_RADIUS in attributes) && Number.isFinite(resolvedRadius)) {
      attributes[ATTRIBUTE_RADIUS] = resolvedRadius;
    }
    return attributes;
  }
  _isNewbieShipItem(item) {
    return isNewbieShipItem(item);
  }
  _resolveNewbieShipTypeID(session) {
    return resolveNewbieShipTypeID(
      session,
      this._getCharacterRecord(session) || {},
    );
  }
  _repairShipAndFittedItems(session, shipItem) {
    repairShipAndFittedItemsForSession(session, shipItem);
  }
  _resolveItemAttributeContext(requestedItemID, session) {
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const tupleItemID = Array.isArray(requestedItemID) ? requestedItemID[0] : requestedItemID;
    const numericItemID =
      Number.parseInt(String(tupleItemID), 10) || this._getShipID(session);
    const skillRecord =
      getCharacterSkills(charID).find(
        (skill) =>
          skill.itemID === numericItemID ||
          skill.itemID === Number.parseInt(String(requestedItemID), 10),
      ) || null;
    if (numericItemID === charID) {
      const attributes = this._buildCharacterAttributes(charData, charID);
      return {
        itemID: charID,
        typeID: Number(charData.typeID || CHARACTER_TYPE_ID),
        attributes,
        baseAttributes: { ...attributes },
      };
    }
    if (skillRecord) {
      return {
        itemID: skillRecord.itemID,
        typeID: Number(skillRecord.typeID),
        attributes: {},
        baseAttributes: {},
      };
    }
    const inventoryContext = this._findInventoryItemContext(requestedItemID, session);
    if (inventoryContext) {
      return inventoryContext;
    }
    const controlledStructureShip = this._getControlledStructureShipMetadata(session);
    if (
      controlledStructureShip &&
      Number(controlledStructureShip.itemID) === numericItemID
    ) {
      const attributes = this._buildInventoryItemAttributes(
        controlledStructureShip,
        session,
      );
      return {
        itemID: controlledStructureShip.itemID,
        typeID: Number(controlledStructureShip.typeID),
        attributes,
        baseAttributes: { ...attributes },
      };
    }
    const shipRecord =
      findCharacterShip(charID, numericItemID) ||
      this._getActiveShipRecord(session) ||
      this._getShipMetadata(session);
    const attributes = this._buildShipAttributes(charData, shipRecord || {}, session);
    return {
      itemID: shipRecord && shipRecord.itemID ? shipRecord.itemID : numericItemID,
      typeID: Number(shipRecord && shipRecord.typeID),
      attributes,
      baseAttributes: this._buildShipBaseAttributes(shipRecord || {}),
    };
  }
  _formatDebugValue(value, fallback = "[n/a]") {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return fallback;
      }
      return String(value);
    }
    if (typeof value === "boolean") {
      return value ? "True" : "False";
    }
    return String(value);
  }
  _buildEmptyDict() {
    return { type: "dict", entries: [] };
  }
  _buildEmptyList() {
    return { type: "list", items: [] };
  }
  _compareFittingRows(left, right) {
    const flagDiff =
      (Number(left && left.flagID) || 0) - (Number(right && right.flagID) || 0);
    if (flagDiff !== 0) {
      return flagDiff;
    }
    return (Number(left && left.itemID) || 0) - (Number(right && right.itemID) || 0);
  }
  _buildFittingHydrationContext(charID, shipID, shipItem = null, options = {}) {
    const numericShipID =
      Number(shipID) || Number(shipItem && shipItem.itemID) || 0;
    if (numericShipID <= 0) {
      return null;
    }

    const includeAllFittingOwners = options.includeAllFittingOwners === true;
    const numericCharID = Number(charID) || 0;
    const ownerID = includeAllFittingOwners
      ? null
      : numericCharID > 0
        ? numericCharID
        : null;
    const fittedItems = listContainerItems(ownerID, numericShipID, null)
      .filter((item) => (
        item &&
        Number(item.locationID) === numericShipID &&
        isShipFittingFlag(item.flagID)
      ))
      .sort((left, right) => this._compareFittingRows(left, right));
    const moduleItems = fittedItems.filter((item) => isFittedModuleItem(item));
    const chargeItems = fittedItems.filter((item) => isFittedChargeItem(item));
    const moduleByFlag = new Map();
    for (const item of moduleItems) {
      const flagID = Number(item && item.flagID) || 0;
      if (flagID > 0 && !moduleByFlag.has(flagID)) {
        moduleByFlag.set(flagID, item);
      }
    }
    const chargeByFlag = new Map();
    for (const item of chargeItems) {
      const flagID = Number(item && item.flagID) || 0;
      if (flagID > 0 && !chargeByFlag.has(flagID)) {
        chargeByFlag.set(flagID, item);
      }
    }
    const hiddenModifierItems = listHiddenModifierItems(
      ownerID,
      numericShipID,
      shipItem,
    );

    return {
      charID: numericCharID,
      shipID: numericShipID,
      includeAllFittingOwners,
      fittedItems,
      moduleItems,
      chargeItems,
      moduleByFlag,
      chargeByFlag,
      hiddenModifierItems,
    };
  }
  _isFittingContextMatch(context, charID, shipID, options = {}) {
    if (!context) {
      return false;
    }
    const numericShipID = Number(shipID) || 0;
    if (numericShipID <= 0 || Number(context.shipID) !== numericShipID) {
      return false;
    }
    if (options.includeAllFittingOwners === true || context.includeAllFittingOwners === true) {
      return true;
    }
    const numericCharID = Number(charID) || 0;
    return numericCharID <= 0 || Number(context.charID) === numericCharID;
  }
  _getFittingContextSnapshotOptions(context, charID, shipID, options = {}) {
    if (!this._isFittingContextMatch(context, charID, shipID, options)) {
      return {};
    }
    return {
      fittedItems: context.fittedItems,
      hiddenModifierItems: context.hiddenModifierItems,
    };
  }
  _getFittingContextModuleByFlag(context, charID, shipID, flagID, options = {}) {
    if (!this._isFittingContextMatch(context, charID, shipID, options)) {
      return null;
    }
    return context.moduleByFlag.get(Number(flagID) || 0) || null;
  }
  _getFittingContextChargeByFlag(context, charID, shipID, flagID, options = {}) {
    if (!this._isFittingContextMatch(context, charID, shipID, options)) {
      return null;
    }
    return context.chargeByFlag.get(Number(flagID) || 0) || null;
  }
  _buildActivationState(charID, shipID, shipRecord = null, options = {}) {
    // The live 23.02 client build in use here still expects a 4-slot
    // shipState tuple during MakeShipActive on station boarding/login paths.
    // Keep the fourth slot as an empty reserved payload for compatibility.
    return [
      this._buildShipState(charID, shipID, shipRecord, options),
      options.includeCharges === false
        ? this._buildEmptyDict()
        : this._buildChargeStateDict(charID, shipID, options),
      buildWeaponBankStateDict(shipID, { characterID: charID }),
      this._buildEmptyDict(),
    ];
  }
  _getCharacterItemLocationID(session, options = {}) {
    const allowShipLocation = options.allowShipLocation !== false;
    if (
      !allowShipLocation ||
      (session && session._deferredDockedShipSessionChange)
    ) {
      return this._getLocationID(session);
    }
    return this._getShipID(session);
  }
  _buildCharacterInfoDict(charID, charData, locationID) {
    return {
      type: "dict",
      entries: this._buildCharacterInfoEntries(charID, charData, locationID),
    };
  }
  _buildCharacterInfoEntries(charID, charData, locationID) {
    return [
      [
        charID,
        this._buildCommonGetInfoEntry({
          itemID: charID,
          typeID: charData.typeID || CHARACTER_TYPE_ID,
          ownerID: charID,
          locationID,
          flagID: FLAG_PILOT,
          groupID: CHARACTER_GROUP_ID,
          categoryID: CHARACTER_CATEGORY_ID,
          quantity: -1,
          singleton: 1,
          stacksize: 1,
          description: "character",
          attributes: this._buildCharacterAttributeDict(charData, charID),
        }),
      ],
    ];
  }
  _buildShipModifiedCharacterAttributeInfo(
    charID,
    charData,
    locationID,
    session = null,
    options = {},
  ) {
    return this._buildCommonGetInfoEntry({
      itemID: charID,
      typeID: charData.typeID || CHARACTER_TYPE_ID,
      ownerID: charID,
      locationID,
      flagID: FLAG_PILOT,
      groupID: CHARACTER_GROUP_ID,
      categoryID: CHARACTER_CATEGORY_ID,
      quantity: -1,
      singleton: 1,
      stacksize: 1,
      description: "character",
      attributes: this._buildShipModifiedCharacterAttributeDict(
        charData,
        charID,
        session,
        options,
      ),
      session,
    });
  }
  _buildCharacterBrain(charID, session = null) {
    return buildBootstrapCharacterBrain(charID, 0, {
      shipID:
        session && (
          session.activeShipID ??
          session.shipID ??
          session.shipid
        ),
      structureID:
        session && (
          session.structureid ??
          session.structureID ??
          session.structureId
        ),
    });
  }
  _getDockedStructureRecord(session) {
    const structureID = Number(
      session && (session.structureid || session.structureID),
    ) || 0;
    if (structureID <= 0) {
      return null;
    }
    return worldData.getStructureByID(structureID) || null;
  }
  _buildStructureInfoDict(structure, session = null) {
    if (!structure) {
      return this._buildEmptyDict();
    }
    const itemType = resolveItemByTypeID(structure.typeID) || {};
    const effectiveHitpoints = resolveStructureEffectiveHitpoints(structure);
    const structureItem = {
      itemID: Number(structure.structureID) || 0,
      typeID: Number(structure.typeID) || 0,
      ownerID: Number(structure.ownerCorpID || structure.ownerID) || 0,
      locationID: Number(structure.solarSystemID) || 0,
      flagID: 0,
      quantity: -1,
      singleton: 1,
      stacksize: 1,
      groupID: Number(itemType.groupID) || 0,
      categoryID: Number(itemType.categoryID) || 0,
      customInfo: String(structure.itemName || structure.name || ""),
      conditionState:
        structure && structure.conditionState && typeof structure.conditionState === "object"
          ? { ...structure.conditionState }
          : null,
      shieldCapacity: Number(effectiveHitpoints.effectiveShieldCapacity) || 0,
      armorHP: Number(effectiveHitpoints.effectiveArmorHP) || 0,
      structureHP: Number(effectiveHitpoints.effectiveStructureHP) || 0,
    };
    return {
      type: "dict",
      entries: [[
        structureItem.itemID,
        this._buildCommonGetInfoEntry({
          itemID: structureItem.itemID,
          typeID: structureItem.typeID,
          ownerID: structureItem.ownerID,
          locationID: structureItem.locationID,
          flagID: structureItem.flagID,
          groupID: structureItem.groupID,
          categoryID: structureItem.categoryID,
          quantity: structureItem.quantity,
          singleton: structureItem.singleton,
          stacksize: structureItem.stacksize,
          customInfo: structureItem.customInfo,
          description: "structure",
          attributes: this._buildInventoryItemAttributeDict(
            structureItem,
            session,
          ),
          session,
        }),
      ]],
    };
  }
  _shouldDeferLoginShipFittingBootstrap(session) {
    void session;
    return false;
  }
  _shouldPrimeLoginShipInfoChargeSublocations(session, options = {}) {
    if (!session || !session._space) {
      return false;
    }
    if (options.controllingStructure !== true && isDockedSession(session)) {
      return false;
    }
    return LIVE_SPACE_TUPLE_CHARGE_PROFILES.has(
      String(session._space.loginChargeHydrationProfile || ""),
    );
  }
  _buildLoadedChargeTupleQuantityChanges(session, charID, shipID, options = {}) {
    if (!ATTRIBUTE_QUANTITY) {
      return [];
    }
    const numericCharID = Number(charID) || this._getCharID(session);
    const numericShipID = Number(shipID) || this._getShipID(session);
    if (numericCharID <= 0 || numericShipID <= 0) {
      return [];
    }

    const when = this._sessionFileTime(session);
    return this._listLoadedChargeSublocationItems(numericCharID, numericShipID, options)
      .map((item) => {
        const quantity = Math.max(
          0,
          Number(item.stacksize ?? item.quantity ?? 0) || 0,
        );
        return [
          "OnModuleAttributeChange",
          numericCharID,
          buildChargeTupleItemID(numericShipID, item.flagID, item.typeID),
          ATTRIBUTE_QUANTITY,
          when,
          quantity,
          quantity,
          null,
        ];
      });
  }
  _queuePostGetAllInfoChargeQuantityRefresh(session, charID, shipID, options = {}) {
    if (!session || !session._space) {
      return 0;
    }
    const changes = this._buildLoadedChargeTupleQuantityChanges(
      session,
      charID,
      shipID,
      options,
    );
    if (changes.length <= 0) {
      delete session._space.pendingDogmaGetAllInfoChargeQuantityRefresh;
      return 0;
    }
    session._space.pendingDogmaGetAllInfoChargeQuantityRefresh = changes;
    return changes.length;
  }
  _flushPostGetAllInfoChargeQuantityRefresh(session) {
    if (!session || !session._space) {
      return 0;
    }
    const changes = Array.isArray(
      session._space.pendingDogmaGetAllInfoChargeQuantityRefresh,
    )
      ? session._space.pendingDogmaGetAllInfoChargeQuantityRefresh
      : [];
    delete session._space.pendingDogmaGetAllInfoChargeQuantityRefresh;
    if (changes.length <= 0) {
      return 0;
    }
    this._notifyModuleAttributeChanges(session, changes);
    return changes.length;
  }
  _shouldIncludeLoginShipInfoLoadedCharges(session) {
    // Docked normal fitting and its warning pass consume the actual loaded
    // charge rows in the module slots. Keep those real charge items in
    // shipInfo docked-only. Live-space HUD authority is tuple-backed.
    return isDockedSession(session) === true;
  }
  _buildShipState(charID, shipID, shipRecord = null, options = {}) {
    const shipCondition = getShipConditionState(shipRecord);
    const fittedItems =
      options.includeFittedItems === false
        ? []
        : this._isFittingContextMatch(
            options.fittingContext,
            charID,
            shipID,
            options,
          )
          ? options.fittingContext.moduleItems
        : options.includeAllFittingOwners === true
          ? listContainerItems(null, shipID, null)
            .filter((item) => item && isShipFittingFlag(item.flagID))
            .filter((item) => Number(item.categoryID) !== 8)
            .sort((left, right) => (
              (Number(left && left.flagID) || 0) - (Number(right && right.flagID) || 0) ||
              (Number(left && left.itemID) || 0) - (Number(right && right.itemID) || 0)
            ))
          : getFittedModuleItems(charID, shipID);
    return {
      type: "dict",
      entries: [
        [
          shipID,
          this._buildPackedInstanceRow({
            itemID: shipID,
            damage: shipCondition.damage,
            charge: shipCondition.charge,
            armorDamage: shipCondition.armorDamage,
            shieldCharge: shipCondition.shieldCharge,
            incapacitated: shipCondition.incapacitated,
          }),
        ],
        [
          charID,
          this._buildPackedInstanceRow({
            itemID: charID,
            online: true,
            skillPoints: getCharacterSkillPointTotal(charID) || 0,
          }),
        ],
        ...fittedItems.map((item) => [
          item.itemID,
          this._buildPackedInstanceRow(buildModuleStatusSnapshot(item)),
        ]),
      ],
    };
  }
  Handle_GetCharacterAttributes(args, session) {
    log.debug("[DogmaIM] GetCharacterAttributes");
    return this._buildCharacterAttributeDict(
      this._getCharacterRecord(session) || {},
      this._getCharID(session),
    );
  }
  Handle_ChangeDroneSettings(args, session) {
    const rawDroneSettingChanges = args && args.length > 0 ? args[0] : null;
    const droneSettingChanges = this._normalizeDroneSettingChanges(
      rawDroneSettingChanges,
    );
    const nextDroneSettings = this._persistDroneSettingChanges(
      session,
      droneSettingChanges,
    );
    if (session && typeof session === "object") {
      session.droneSettings = {
        ...nextDroneSettings,
      };
    }
    log.debug(
      `[DogmaService] ChangeDroneSettings char=${this._getCharID(session)} keys=${Object.keys(droneSettingChanges).join(",")}`,
    );
    return true;
  }
  Handle_GetDroneSettingAttributes(args, session) {
    void args;
    return this._buildDroneSettingAttributesPayload(session);
  }
  Handle_GetRequiredSkillLevels(args) {
    const typeID = this._normalizeTypeID(args && args.length > 0 ? args[0] : 0);
    if (typeID <= 0) {
      return buildDict([]);
    }
    return this._buildRequiredSkillLevelDict(typeID);
  }
  _extractRequestedItemIDs(rawValue) {
    const unwrapped = unwrapMarshalValue(rawValue);
    const values = Array.isArray(unwrapped) ? unwrapped : extractList(rawValue);
    return [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value) || 0)
        .filter((itemID) => itemID > 0),
    )];
  }
  _buildItemLayerDamageValues(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const categoryID = Number(item.categoryID) || 0;
    const rawConditionState =
      item.conditionState && typeof item.conditionState === "object"
        ? item.conditionState
        : null;
    const conditionState = rawConditionState
      ? normalizeShipConditionState(rawConditionState)
      : (
        categoryID === SHIP_CATEGORY_ID || categoryID === DRONE_CATEGORY_ID
          ? normalizeShipConditionState({})
          : {
              damage: clampRatio(item && item.moduleState && item.moduleState.damage, 0),
              charge: clampRatio(item && item.moduleState && item.moduleState.charge, 0),
              armorDamage: clampRatio(
                item && item.moduleState && item.moduleState.armorDamage,
                0,
              ),
              shieldCharge: clampRatio(
                item && item.moduleState && item.moduleState.shieldCharge,
                1,
              ),
              incapacitated: Boolean(
                item && item.moduleState && item.moduleState.incapacitated,
              ),
            }
      );
    const shieldCapacity = Number(
      item.shieldCapacity ?? getTypeAttributeValue(item.typeID, "shieldCapacity"),
    ) || 0;
    const shieldRechargeRate = Number(
      item.shieldRechargeRate ?? getTypeAttributeValue(item.typeID, "shieldRechargeRate"),
    ) || 0;
    const armorHP = Number(item.armorHP ?? getTypeAttributeValue(item.typeID, "armorHP")) || 0;
    const structureHP = Number(
      item.structureHP ?? item.hullHP ?? getTypeAttributeValue(item.typeID, "hp", "structureHP"),
    ) || 0;
    const shieldRatio =
      shieldCapacity > 0 ? clampRatio(conditionState.shieldCharge, 1) : 0;
    const armorRatio =
      armorHP > 0 ? clampRatio(1 - clampRatio(conditionState.armorDamage, 0), 1) : 0;
    const hullRatio =
      structureHP > 0 ? clampRatio(1 - clampRatio(conditionState.damage, 0), 1) : 0;
    const currentShield = shieldCapacity > 0 ? shieldCapacity * shieldRatio : 0;
    const armorDamageAmount =
      armorHP > 0 ? armorHP * clampRatio(conditionState.armorDamage, 0) : 0;
    const hullDamageAmount =
      structureHP > 0 ? structureHP * clampRatio(conditionState.damage, 0) : 0;
    const currentArmor = armorHP > 0 ? armorHP - armorDamageAmount : 0;
    const currentHull = structureHP > 0 ? structureHP - hullDamageAmount : 0;
    return buildKeyVal([
      [
        "shieldInfo",
        shieldCapacity > 0
          ? buildList([
              buildMarshalReal(currentShield, currentShield),
              buildMarshalReal(shieldCapacity, shieldCapacity),
              buildMarshalReal(Math.max(0, shieldRechargeRate), 0),
            ])
          : buildMarshalReal(0, 0),
      ],
      // Drone bay damage parity: the client reads armorInfo/hullInfo as max
      // layer values and armorDamage/hullDamage as absolute damage amounts.
      ["armorInfo", buildMarshalReal(armorHP, armorHP)],
      ["hullInfo", buildMarshalReal(structureHP, structureHP)],
      ["armorDamage", buildMarshalReal(armorDamageAmount, armorDamageAmount)],
      ["hullDamage", buildMarshalReal(hullDamageAmount, hullDamageAmount)],
      ["shieldRatio", buildMarshalReal(shieldRatio, shieldRatio)],
      ["armorRatio", buildMarshalReal(armorRatio, armorRatio)],
      ["hullRatio", buildMarshalReal(hullRatio, hullRatio)],
      ["armorMax", buildMarshalReal(armorHP, armorHP)],
      ["hullMax", buildMarshalReal(structureHP, structureHP)],
    ]);
  }
  _buildStructureLayerDamageValues(structure) {
    if (!structure || typeof structure !== "object") {
      return null;
    }
    const typeRecord = resolveItemByTypeID(structure.typeID) || {};
    const effectiveHitpoints = resolveStructureEffectiveHitpoints(structure);
    return this._buildItemLayerDamageValues({
      itemID: Number(structure.structureID) || 0,
      typeID: Number(structure.typeID) || 0,
      ownerID: Number(structure.ownerCorpID || structure.ownerID) || 0,
      locationID: Number(structure.solarSystemID) || 0,
      flagID: 0,
      groupID: Number(typeRecord.groupID) || 0,
      categoryID: Number(typeRecord.categoryID) || 0,
      conditionState: structure.conditionState,
      shieldCapacity: effectiveHitpoints.effectiveShieldCapacity,
      armorHP: effectiveHitpoints.effectiveArmorHP,
      structureHP: effectiveHitpoints.effectiveStructureHP,
    });
  }
  Handle_GetLayerDamageValuesByItems(args, session) {
    const requestedItemIDs = this._extractRequestedItemIDs(args && args[0]);
    const charID = this._getCharID(session);
    const shipID = this._getShipID(session);
    const entries = [];
    for (const itemID of requestedItemIDs) {
      // The retail client (eveDrones/droneDamageTracker.py) treats this method
      // as authoritative for every requested item: it only writes a damage-state
      // cache entry for IDs present in the response, then unconditionally clears
      // its in-flight guard. Silently dropping a requested ID therefore leaves
      // the client with the item neither cached nor in-flight, so the in-bay
      // drone UI re-issues this call every render frame (~1900/s) until the bay
      // enumeration changes — which freezes the live client. To keep the loop
      // self-terminating we must return an entry for EVERY requested item ID,
      // falling back to a zeroed payload when the item cannot be resolved
      // (e.g. a drone that just merged/relaunched and whose transient itemID no
      // longer exists server-side).
      const item = findItemById(itemID);
      let layerDamageValues = null;
      if (item) {
        const ownerID = Number(item.ownerID) || 0;
        const locationID = Number(item.locationID) || 0;
        const ownedByOther =
          charID > 0 &&
          ownerID > 0 &&
          ownerID !== charID &&
          locationID !== shipID;
        if (!ownedByOther) {
          layerDamageValues = this._buildItemLayerDamageValues(item);
        }
      } else {
        const structure = worldData.getStructureByID(itemID);
        if (structure) {
          layerDamageValues = this._buildStructureLayerDamageValues(structure);
        }
      }
      entries.push([
        itemID,
        layerDamageValues || this._buildEmptyLayerDamageValues(),
      ]);
    }
    return buildDict(entries);
  }
  _buildEmptyLayerDamageValues() {
    // Undamaged/zero-capacity sentinel for items the server cannot resolve.
    // Mirrors the shape of _buildItemLayerDamageValues so the client can read
    // every field without raising, and reports the item as fully intact rather
    // than re-requesting it forever. shieldInfo must stay list-shaped: the
    // client's ConvertDroneStateToCorrectFormat indexes shieldInfo[0..2].
    return buildKeyVal([
      [
        "shieldInfo",
        buildList([
          buildMarshalReal(0, 0),
          buildMarshalReal(0, 0),
          buildMarshalReal(0, 0),
        ]),
      ],
      ["armorInfo", buildMarshalReal(0, 0)],
      ["hullInfo", buildMarshalReal(0, 0)],
      ["armorDamage", buildMarshalReal(0, 0)],
      ["hullDamage", buildMarshalReal(0, 0)],
      ["shieldRatio", buildMarshalReal(0, 0)],
      ["armorRatio", buildMarshalReal(1, 1)],
      ["hullRatio", buildMarshalReal(1, 1)],
      ["armorMax", buildMarshalReal(0, 0)],
      ["hullMax", buildMarshalReal(0, 0)],
    ]);
  }
  Handle_ShipOnlineModules(args, session) {
    log.debug("[DogmaIM] ShipOnlineModules");
    const charID = this._getCharID(session);
    const shipID = this._getShipID(session);
    return {
      type: "list",
      items: getFittedModuleItems(charID, shipID)
        .filter((item) => isEffectivelyOnlineModule(item))
        .map((item) => item.itemID),
    };
  }
  _buildTargetIDList(targetIDs = []) {
    return {
      type: "list",
      items: (Array.isArray(targetIDs) ? targetIDs : [])
        .map((targetID) => Number(targetID) || 0)
        .filter((targetID) => targetID > 0),
    };
  }
  _buildTargetingAttemptFailedUserErrorValues(data = null) {
    const errorData = data && typeof data === "object" ? data : {};
    const targetTypeID = Number(
      errorData.targetTypeID ??
        errorData.targetType ??
        errorData.typeID ??
        errorData.target,
    ) || 0;
    return {
      target: Math.max(0, Math.trunc(targetTypeID)),
    };
  }
  _throwTargetingUserError(errorMsg = "", data = null) {
    const errorData = data && typeof data === "object" ? data : {};
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "TARGET_SELF":
        throwWrappedUserError("DeniedTargetSelf");
        break;
      case "SOURCE_WARPING":
        throwWrappedUserError("DeniedTargetSelfWarping");
        break;
      case "TARGET_WARPING":
        throwWrappedUserError("DeniedTargetOtherWarping");
        break;
      case "TARGET_OUT_OF_RANGE":
        throwWrappedUserError("TargetTooFar");
        break;
      case "TARGET_NOT_FOUND":
        throwWrappedUserError("TargetingAttemptCancelled");
        break;
      case "TARGET_LOCK_LIMIT_REACHED":
        throwWrappedUserError("TargetingSystemsAlreadyFullyUtilized", {
          limit: Math.max(
            0,
            Number(errorData.limit ?? errorData.effectiveMaxLockedTargets) || 0,
          ),
        });
        break;
      case "TARGET_JAMMED":
        this._throwCustomNotifyUserError(
          "You cannot lock that target while jammed except against the ships currently jamming you.",
        );
        break;
      default:
        throwWrappedUserError(
          "DeniedTargetingAttemptFailed",
          this._buildTargetingAttemptFailedUserErrorValues(errorData),
        );
        break;
    }
  }
  _buildUserErrorTypeValue(typeID) {
    const numericTypeID = Number(typeID) || 0;
    return numericTypeID > 0 ? [USER_ERROR_TYPE_ID, numericTypeID] : numericTypeID;
  }
  _resolveModuleDisplayName(moduleItem, fallback = "module") {
    const typeRecord = resolveItemByTypeID(Number(moduleItem && moduleItem.typeID) || 0);
    const rawName =
      (moduleItem && moduleItem.itemName) ||
      (typeRecord && (typeRecord.name || typeRecord.typeName)) ||
      fallback;
    const normalizedName = String(rawName || fallback).trim();
    return normalizedName || fallback;
  }
  _resolveEntityDisplayName(entity, fallback = "That target") {
    const typeRecord = resolveItemByTypeID(Number(entity && entity.typeID) || 0);
    const rawName =
      (entity && (entity.itemName || entity.name)) ||
      (typeRecord && (typeRecord.name || typeRecord.typeName)) ||
      fallback;
    const normalizedName = String(rawName || fallback).trim();
    return normalizedName || fallback;
  }
  _resolveModuleActivationRangeMeters(session, moduleItem) {
    if (!moduleItem) {
      return 0;
    }
    const loadedChargeItem = this._resolveLoadedChargeItem(moduleItem, session);
    const weaponAttributes =
      this._buildWeaponModuleAttributeMap(moduleItem, loadedChargeItem, session);
    const moduleAttributes =
      weaponAttributes ||
      buildEffectiveItemAttributeMap(moduleItem, loadedChargeItem);
    const maxRangeMeters = Math.max(
      0,
      Number(moduleAttributes && moduleAttributes[ATTRIBUTE_MAX_RANGE]) || 0,
    );
    const falloffAttributeID = FALLOFF_EFFECTIVENESS_MODULE_GROUPS.has(
      Number(moduleItem && moduleItem.groupID) || 0,
    )
      ? ATTRIBUTE_FALLOFF_EFFECTIVENESS
      : ATTRIBUTE_FALLOFF;
    const falloffMeters = Math.max(
      0,
      Number(moduleAttributes && moduleAttributes[falloffAttributeID]) || 0,
    );
    return Math.max(0, Math.round(maxRangeMeters + falloffMeters));
  }
  _isAnalyzerModuleActivation(moduleItem, effectName) {
    const normalizedEffectName = String(effectName || "").trim();
    const typeID = Number(moduleItem && moduleItem.typeID) || 0;
    return (
      normalizedEffectName === ANALYZER_EFFECT_NAME &&
      typeID > 0 &&
      Number(moduleItem && moduleItem.categoryID) === 7 &&
      typeHasEffectName(typeID, ANALYZER_EFFECT_NAME)
    );
  }
  _getEntityPosition(entity) {
    if (!entity || typeof entity !== "object") {
      return null;
    }
    if (entity.position && typeof entity.position === "object") {
      return {
        x: normalizeNumber(entity.position.x, 0),
        y: normalizeNumber(entity.position.y, 0),
        z: normalizeNumber(entity.position.z, 0),
      };
    }
    const x = normalizeNumber(entity.x, Number.NaN);
    const y = normalizeNumber(entity.y, Number.NaN);
    const z = normalizeNumber(entity.z, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    return { x, y, z };
  }
  _getEntityRadiusMeters(entity) {
    return Math.max(
      0,
      normalizeNumber(
        entity && (entity.radius ?? entity.spaceRadius ?? entity.interactionRadius),
        0,
      ),
    );
  }
  _getEntitySurfaceDistanceMeters(sourceEntity, targetEntity) {
    const sourcePosition = this._getEntityPosition(sourceEntity);
    const targetPosition = this._getEntityPosition(targetEntity);
    if (!sourcePosition || !targetPosition) {
      return Number.POSITIVE_INFINITY;
    }
    const dx = sourcePosition.x - targetPosition.x;
    const dy = sourcePosition.y - targetPosition.y;
    const dz = sourcePosition.z - targetPosition.z;
    const centerDistance = Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
    return Math.max(
      0,
      centerDistance -
        this._getEntityRadiusMeters(sourceEntity) -
        this._getEntityRadiusMeters(targetEntity),
    );
  }
  _isLockedTarget(sourceEntity, targetID) {
    const normalizedTargetID = Number(targetID) || 0;
    if (!sourceEntity || normalizedTargetID <= 0) {
      return false;
    }
    const lockedTargets = sourceEntity.lockedTargets;
    if (lockedTargets instanceof Map || lockedTargets instanceof Set) {
      return lockedTargets.has(normalizedTargetID);
    }
    if (Array.isArray(lockedTargets)) {
      return lockedTargets.map((entry) => Number(entry) || 0).includes(normalizedTargetID);
    }
    return false;
  }
  _resolveAnalyzerModuleKind(moduleItem) {
    const typeID = Number(moduleItem && moduleItem.typeID) || 0;
    const typeRecord = resolveItemByTypeID(typeID);
    const typeName = String(
      (moduleItem && moduleItem.itemName) ||
        (typeRecord && (typeRecord.name || typeRecord.typeName)) ||
        "",
    ).toLowerCase();
    const requiredSkillIDs = new Set(
      [
        getTypeAttributeValue(typeID, "requiredSkill1"),
        getTypeAttributeValue(typeID, "requiredSkill2"),
      ]
        .map((value) => Number(value) || 0)
        .filter((value) => value > 0),
    );
    const requiresHacking = requiredSkillIDs.has(ANALYZER_HACKING_SKILL_TYPE_ID);
    const requiresArchaeology = requiredSkillIDs.has(ANALYZER_ARCHAEOLOGY_SKILL_TYPE_ID);

    if (
      (requiresHacking && requiresArchaeology) ||
      typeName.includes("integrated analyzer")
    ) {
      return "integrated";
    }
    if (requiresArchaeology || typeName.includes("relic analyzer")) {
      return "relic";
    }
    if (requiresHacking || typeName.includes("data analyzer")) {
      return "data";
    }
    return "unknown";
  }
  _resolveAnalyzerTargetKind(targetEntity) {
    const normalized = String(
      targetEntity &&
        (
          targetEntity.dungeonSiteContentAnalyzer ||
          targetEntity.hackingAnalyzer ||
          targetEntity.analyzer
        ) ||
        "",
    ).trim().toLowerCase();
    if (normalized.includes("relic") || normalized.includes("archaeolog")) {
      return "relic";
    }
    if (normalized.includes("data") || normalized.includes("hack")) {
      return "data";
    }
    return "";
  }
  _isAnalyzerCompatibleWithTarget(moduleKind, targetKind) {
    if (!targetKind) {
      return moduleKind === "data" || moduleKind === "relic" || moduleKind === "integrated";
    }
    if (moduleKind === "integrated") {
      return targetKind === "data" || targetKind === "relic";
    }
    return moduleKind === targetKind;
  }
  _resolveAnalyzerDifficulty(targetEntity) {
    const rawDifficulty =
      targetEntity &&
      (
        targetEntity.dungeonSiteContentHackingDifficulty ||
        targetEntity.hackingDifficulty ||
        targetEntity.difficulty
      );
    const numericDifficulty = normalizeNumber(rawDifficulty, Number.NaN);
    if (Number.isFinite(numericDifficulty) && numericDifficulty > 0) {
      return Math.max(1, Math.trunc(numericDifficulty));
    }
    switch (String(rawDifficulty || "").trim().toLowerCase()) {
      case "trivial":
      case "very_easy":
      case "very easy":
      case "easy":
      case "low":
        return 1;
      case "medium":
      case "moderate":
      case "normal":
        return 2;
      case "hard":
      case "difficult":
      case "high":
        return 3;
      case "very_hard":
      case "very hard":
      case "hardest":
      case "severe":
        return 4;
      case "extreme":
      case "critical":
        return 5;
      default:
        return 1;
    }
  }
  _resolveAnalyzerAccessDifficultyBonusPercent(session, moduleItem) {
    const characterID = this._getCharID(session);
    const effectiveAttributes = applyActiveImplantLocationModifiersToAttributes(
      buildEffectiveItemAttributeMap(moduleItem),
      moduleItem,
      characterID,
    );
    const rawBonus = normalizeNumber(
      effectiveAttributes[ATTRIBUTE_ACCESS_DIFFICULTY_BONUS],
      0,
    );
    return Number.isFinite(rawBonus) ? Math.max(0, Number(rawBonus.toFixed(6))) : 0;
  }
  _resolveAnalyzerEffectiveDifficulty(session, moduleItem, targetEntity) {
    const baseDifficulty = this._resolveAnalyzerDifficulty(targetEntity);
    const accessDifficultyBonusPercent =
      this._resolveAnalyzerAccessDifficultyBonusPercent(session, moduleItem);
    const effectiveDifficulty = Math.max(
      1,
      baseDifficulty -
        (accessDifficultyBonusPercent / ANALYZER_ACCESS_BONUS_DIFFICULTY_DIVISOR),
    );
    return {
      difficulty: Number(effectiveDifficulty.toFixed(6)),
      baseDifficulty,
      accessDifficultyBonusPercent,
    };
  }
  _getCharacterSkillLevelForAnalyzer(session, skillTypeID) {
    const characterID = this._getCharID(session);
    const normalizedSkillTypeID = Number(skillTypeID) || 0;
    if (characterID <= 0 || normalizedSkillTypeID <= 0) {
      return 0;
    }
    const skill = getCharacterSkills(characterID).find(
      (record) => Number(record && record.typeID) === normalizedSkillTypeID,
    );
    const skillLevel = normalizeNumber(
      skill && (skill.trainedSkillLevel ?? skill.skillLevel ?? skill.effectiveSkillLevel),
      0,
    );
    if (!Number.isFinite(skillLevel) || skillLevel <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(5, Math.trunc(skillLevel)));
  }
  _resolveAnalyzerVirusStats(session, moduleItem, moduleKind) {
    const characterID = this._getCharID(session);
    const effectiveAttributes = applyActiveImplantLocationModifiersToAttributes(
      buildEffectiveItemAttributeMap(moduleItem),
      moduleItem,
      characterID,
    );
    const rawCoherence = Number(effectiveAttributes[ATTRIBUTE_VIRUS_COHERENCE]);
    const rawStrength = Number(effectiveAttributes[ATTRIBUTE_VIRUS_STRENGTH]);
    const baseCoherence = Math.max(
      1,
      Math.round(Number.isFinite(rawCoherence) ? rawCoherence : 40),
    );
    const baseStrength = Math.max(
      1,
      Math.round(Number.isFinite(rawStrength) ? rawStrength : 20),
    );
    const slots = Math.max(
      0,
      Math.round(
        Number(effectiveAttributes[ATTRIBUTE_VIRUS_ELEMENT_SLOTS]) || 0,
      ),
    );
    const skillTypeIDs =
      moduleKind === "integrated"
        ? [ANALYZER_HACKING_SKILL_TYPE_ID, ANALYZER_ARCHAEOLOGY_SKILL_TYPE_ID]
        : moduleKind === "relic"
          ? [ANALYZER_ARCHAEOLOGY_SKILL_TYPE_ID]
          : [ANALYZER_HACKING_SKILL_TYPE_ID];
    const skillCoherence = skillTypeIDs.reduce(
      (sum, skillTypeID) => sum + (this._getCharacterSkillLevelForAnalyzer(session, skillTypeID) * 10),
      0,
    );
    return {
      coherence: baseCoherence + skillCoherence,
      strength: baseStrength,
      slots,
    };
  }
  _resolveAnalyzerHackingContext(session, moduleItem, targetID) {
    const normalizedTargetID = Number(targetID) || 0;
    if (!session || !session._space) {
      return { success: false, errorMsg: "NOT_IN_SPACE" };
    }
    if (normalizedTargetID <= 0) {
      return { success: false, errorMsg: "TARGET_REQUIRED" };
    }
    const scene =
      typeof spaceRuntime.getSceneForSession === "function"
        ? spaceRuntime.getSceneForSession(session)
        : null;
    if (!scene || typeof scene.getShipEntityForSession !== "function") {
      return { success: false, errorMsg: "SHIP_NOT_FOUND" };
    }
    const sourceEntity = scene.getShipEntityForSession(session);
    if (!sourceEntity) {
      return { success: false, errorMsg: "SHIP_NOT_FOUND" };
    }
    const targetEntity =
      typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(normalizedTargetID)
        : null;
    if (!targetEntity) {
      return { success: false, errorMsg: "TARGET_NOT_FOUND" };
    }
    if (!this._isLockedTarget(sourceEntity, normalizedTargetID)) {
      return { success: false, errorMsg: "TARGET_NOT_LOCKED" };
    }
    const isHackableContainer = Boolean(
      targetEntity.dungeonMaterializedContainer === true ||
        targetEntity.dungeonSiteContentAnalyzer ||
        targetEntity.hackingAnalyzer ||
        targetEntity.analyzer,
    );
    if (!isHackableContainer) {
      return { success: false, errorMsg: "ANALYZER_TARGET_INVALID" };
    }
    if (Number(targetEntity.dungeonSiteContentHackingState) === HACKING_STATE_HACKED) {
      return { success: false, errorMsg: "ANALYZER_TARGET_ALREADY_HACKED" };
    }
    if (Number(targetEntity.dungeonSiteContentHackingState) === HACKING_STATE_BEING_HACKED) {
      return { success: false, errorMsg: "ANALYZER_TARGET_BUSY" };
    }
    const maxRangeMeters = this._resolveModuleActivationRangeMeters(session, moduleItem);
    if (
      maxRangeMeters > 0 &&
      this._getEntitySurfaceDistanceMeters(sourceEntity, targetEntity) > maxRangeMeters + 1
    ) {
      return { success: false, errorMsg: "TARGET_OUT_OF_RANGE" };
    }

    const moduleKind = this._resolveAnalyzerModuleKind(moduleItem);
    const targetKind = this._resolveAnalyzerTargetKind(targetEntity) || moduleKind;
    if (!this._isAnalyzerCompatibleWithTarget(moduleKind, targetKind)) {
      return { success: false, errorMsg: "ANALYZER_TYPE_MISMATCH" };
    }
    const virusStats = this._resolveAnalyzerVirusStats(session, moduleItem, moduleKind);
    const difficultyStats = this._resolveAnalyzerEffectiveDifficulty(
      session,
      moduleItem,
      targetEntity,
    );
    return {
      success: true,
      data: {
        targetID: normalizedTargetID,
        targetEntity,
        moduleTypeID: Number(moduleItem && moduleItem.typeID) || 0,
        gameType:
          targetKind === "relic"
            ? ANALYZER_GAME_TYPE_ARCHEOLOGY
            : ANALYZER_GAME_TYPE_HACKING,
        difficulty: difficultyStats.difficulty,
        baseDifficulty: difficultyStats.baseDifficulty,
        accessDifficultyBonusPercent: difficultyStats.accessDifficultyBonusPercent,
        coherence: virusStats.coherence,
        strength: virusStats.strength,
        slots: virusStats.slots,
      },
    };
  }
  _buildModuleTargetOutOfRangeNotify(context = {}) {
    const session = context.session || null;
    const moduleItem = context.moduleItem || null;
    const moduleName = this._resolveModuleDisplayName(moduleItem);
    const targetID = Number(context.targetID) || 0;
    const scene =
      session && typeof spaceRuntime.getSceneForSession === "function"
        ? spaceRuntime.getSceneForSession(session)
        : null;
    const targetEntity =
      scene && targetID > 0 && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(targetID)
        : null;
    const targetName = this._resolveEntityDisplayName(targetEntity, "That target");
    const maxRangeMeters = this._resolveModuleActivationRangeMeters(session, moduleItem);

    if (maxRangeMeters > 0) {
      return (
        `${targetName} is too far away to use your ${moduleName} on. ` +
        `It needs to be closer than ${INTEGER_NOTIFY_FORMATTER.format(maxRangeMeters)} meters.`
      );
    }

    return `${targetName} is too far away to use your ${moduleName} on.`;
  }
  _buildModuleTargetOutOfRangeUserErrorValues(context = {}) {
    const session = context.session || null;
    const moduleItem = context.moduleItem || null;
    const targetID = Number(context.targetID) || 0;
    const scene =
      session && typeof spaceRuntime.getSceneForSession === "function"
        ? spaceRuntime.getSceneForSession(session)
        : null;
    const sourceEntity =
      scene && typeof scene.getShipEntityForSession === "function"
        ? scene.getShipEntityForSession(session)
        : null;
    const targetEntity =
      scene && targetID > 0 && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(targetID)
        : null;
    const desiredRange = Math.max(
      0,
      Number(this._resolveModuleActivationRangeMeters(session, moduleItem)) || 0,
    );
    const actualDistance = this._getEntitySurfaceDistanceMeters(sourceEntity, targetEntity);
    const targetName = this._buildUserErrorTypeValue(targetEntity && targetEntity.typeID);
    const shipType = this._buildUserErrorTypeValue(sourceEntity && sourceEntity.typeID);

    return {
      desiredRange,
      targetName:
        targetName ||
        this._resolveEntityDisplayName(targetEntity, "That target"),
      shipType,
      actualDistance: Number.isFinite(actualDistance)
        ? Math.max(0, actualDistance)
        : 0,
    };
  }
  _buildModuleTargetTooFarUserErrorValues(context = {}) {
    const session = context.session || null;
    const moduleItem = context.moduleItem || null;
    const targetID = Number(context.targetID) || 0;
    const scene =
      session && typeof spaceRuntime.getSceneForSession === "function"
        ? spaceRuntime.getSceneForSession(session)
        : null;
    const targetEntity =
      scene && targetID > 0 && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(targetID)
        : null;
    const distance = Math.max(
      0,
      Number(this._resolveModuleActivationRangeMeters(session, moduleItem)) || 0,
    );
    const targetname = this._buildUserErrorTypeValue(targetEntity && targetEntity.typeID);
    const module = Math.max(
      0,
      Math.trunc(Number(moduleItem && moduleItem.typeID) || 0),
    );

    return {
      distance,
      targetname,
      module,
    };
  }
  _throwCustomNotifyUserError(message) {
    throwWrappedUserError("CustomNotify", {
      notify: String(message || "The requested action could not be completed."),
    });
  }
  _formatBoosterUserError(errorMsg = "") {
    switch (String(errorMsg || "")) {
      case "ITEM_NOT_FOUND":
      case "ITEM_NOT_OWNED":
      case "ITEM_LOCATION_MISMATCH":
        return "That booster is no longer available.";
      case "NOT_A_CONSUMABLE_BOOSTER":
        return "That item cannot be consumed as a booster.";
      case "BOOSTER_EXPIRED":
        return "That booster can no longer be consumed.";
      case "BOOSTER_CHARACTER_TOO_OLD":
        return "Your character is too old to consume that booster.";
      case "BOOSTER_CHARACTER_AGE_UNKNOWN":
        return "That booster cannot be consumed by this character.";
      case "BOOSTER_SLOT_OCCUPIED":
        return "You already have an active booster in that slot.";
      case "INSUFFICIENT_ITEMS":
      case "ITEM_QUANTITY_OUT_OF_RANGE":
        return "You do not have a booster available to consume.";
      default:
        return "The booster could not be consumed.";
    }
  }
  _formatImplantUserError(errorMsg = "") {
    switch (String(errorMsg || "")) {
      case "ITEM_NOT_FOUND":
      case "ITEM_NOT_OWNED":
      case "ITEM_LOCATION_MISMATCH":
      case "IMPLANT_NOT_FOUND":
        return "That implant is no longer available.";
      case "NOT_AN_IMPLANT":
        return "That item cannot be plugged in as an implant.";
      case "IMPLANT_SLOT_OCCUPIED":
        return "You already have an implant in that slot.";
      case "SKILL_REQUIRED":
        return "You do not have the required skills to plug in that implant.";
      case "INSUFFICIENT_ITEMS":
      case "ITEM_QUANTITY_OUT_OF_RANGE":
        return "You do not have an implant available to plug in.";
      default:
        return "The implant could not be plugged in.";
    }
  }
  _buildModuleReactivationUserErrorValues(session, moduleItem) {
    const numericModuleID = Number(moduleItem && moduleItem.itemID) || 0;
    const numericTypeID = Number(moduleItem && moduleItem.typeID) || 0;
    const scene = spaceRuntime.getSceneForSession(session);
    const shipEntity = scene ? scene.getShipEntityForSession(session) : null;
    const nowMs =
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? Number(scene.getCurrentSimTimeMs()) || Date.now()
        : Date.now();
    const lockUntilMs =
      shipEntity &&
      shipEntity.moduleReactivationLocks instanceof Map
        ? Number(shipEntity.moduleReactivationLocks.get(numericModuleID)) || 0
        : 0;
    const moduleAttributes =
      moduleItem && numericTypeID > 0
        ? buildEffectiveItemAttributeMap(moduleItem)
        : null;
    const fullDelayMs = Math.max(
      0,
      Number(
        moduleAttributes && moduleAttributes[ATTRIBUTE_MODULE_REACTIVATION_DELAY] !== undefined
          ? moduleAttributes[ATTRIBUTE_MODULE_REACTIVATION_DELAY]
          : getTypeAttributeValue(numericTypeID, "moduleReactivationDelay"),
      ) || 0,
    );
    const remainingDelayMs = Math.max(0, lockUntilMs - nowMs);
    const timeSinceLastStopMs = Math.max(0, fullDelayMs - remainingDelayMs);
    return {
      itemID: numericModuleID,
      timeSinceLastStop: timeSinceLastStopMs,
    };
  }
  _buildEffectCrowdedOutValues(session, moduleItem) {
    const numericTypeID = Number(moduleItem && moduleItem.typeID) || 0;
    const numericGroupID = Number(moduleItem && moduleItem.groupID) || 0;
    const scene = spaceRuntime.getSceneForSession(session);
    const shipEntity = scene ? scene.getShipEntityForSession(session) : null;
    const count =
      shipEntity &&
      shipEntity.activeModuleEffects instanceof Map
        ? [...shipEntity.activeModuleEffects.values()].filter(
          (effectState) => Number(effectState && effectState.groupID) === numericGroupID,
        ).length
        : 0;
    return {
      module: numericTypeID,
      count,
    };
  }
  _throwModuleOnlineUserError(errorMsg = "", moduleItem = null, data = null) {
    switch (String(errorMsg || "").trim()) {
      case "MODULE_NOT_FOUND":
      case "SHIP_NOT_FOUND":
      case "NOT_IN_SPACE":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "NOT_ENOUGH_CPU":
        this._throwCustomNotifyUserError("You do not have enough CPU to online that module.");
        break;
      case "NOT_ENOUGH_POWER":
        this._throwCustomNotifyUserError("You do not have enough powergrid to online that module.");
        break;
      case "NOT_ENOUGH_CAPACITOR":
        throwWrappedUserError("NotEnoughCapacitorForOnline", {
          module: Number(moduleItem && moduleItem.typeID) || 0,
          have: 0,
          need: ONLINE_CAPACITOR_CHARGE_RATIO / 100,
        });
        break;
      case "NOT_ENOUGH_FUEL":
        this._throwCustomNotifyUserError(
          "There is not enough fuel in the structure fuel bay to online that service module.",
        );
        break;
      case "MAX_GROUP_ONLINE":
        throwWrappedUserError("CannotOnlineReachedMaxGroupOnline", {
          type: this._buildUserErrorTypeValue(moduleItem && moduleItem.typeID),
          group: [
            USER_ERROR_GROUP_ID,
            Number(
              (data && data.groupID) ||
                (moduleItem && moduleItem.groupID),
            ) || 0,
          ],
          maxGroupOnline: Math.max(
            0,
            Math.trunc(Number(data && data.maxGroupOnline) || 0),
          ),
        });
        break;
      case "STRUCTURE_DAMAGED":
        this._throwCustomNotifyUserError(
          "Service modules cannot be onlined while the structure is damaged.",
        );
        break;
      case "STRUCTURE_SERVICE_TOO_CLOSE":
        this._throwCustomNotifyUserError(
          "That navigation service cannot be onlined because another Upwell structure is too close.",
        );
        break;
      case "STRUCTURE_SERVICE_REQUIRES_SOV_UPGRADE":
        this._throwCustomNotifyUserError(
          this._formatStructureServiceRequiresSovUpgradeError(data),
        );
        break;
      case "CRP_ACCESS_DENIED":
        throwWrappedUserError(
          "CrpAccessDenied",
          buildCrpAccessDeniedInsufficientRolesValues(),
        );
        break;
      default:
        this._throwCustomNotifyUserError(
          `Failed to change the online state for ${this._resolveModuleDisplayName(moduleItem)}.`,
        );
        break;
    }
  }
  _formatStructureServiceRequiresSovUpgradeError(data = null) {
    const requiredUpgradeTypeID = Math.max(
      0,
      Math.trunc(Number(data && data.requiredUpgradeTypeID) || 0),
    );
    const upgradeType = requiredUpgradeTypeID > 0
      ? resolveItemByTypeID(requiredUpgradeTypeID)
      : null;
    const upgradeName = upgradeType && upgradeType.name
      ? String(upgradeType.name)
      : "the required sovereignty hub upgrade";
    return `That service module requires ${upgradeName} to be online in this solar system.`;
  }
  _throwModuleActivationUserError(errorMsg = "", context = {}) {
    const normalizedErrorMsg = String(errorMsg || "").trim();
    const session = context.session || null;
    const moduleItem = context.moduleItem || null;
    const moduleName = this._resolveModuleDisplayName(moduleItem);

    switch (normalizedErrorMsg) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
      case "MODULE_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "TARGET_SELF":
        throwWrappedUserError("DeniedTargetSelf");
        break;
      case "SOURCE_WARPING":
        throwWrappedUserError("DeniedTargetSelfWarping");
        break;
      case "TARGET_WARPING":
        throwWrappedUserError("DeniedTargetOtherWarping");
        break;
      case "TARGET_NOT_FOUND":
        throwWrappedUserError("DeniedActivateTargetNotPresent");
        break;
      case "TARGET_OUT_OF_RANGE":
        if (String(context.effectName || "").trim() === "miningLaser") {
          throwWrappedUserError(
            "TargetTooFar",
            this._buildModuleTargetTooFarUserErrorValues(context),
          );
        }
        throwWrappedUserError(
          "TargetNotWithinRangeGeneric",
          this._buildModuleTargetOutOfRangeUserErrorValues(context),
        );
        break;
      case "MODULE_ALREADY_ACTIVE":
        throwWrappedUserError("EffectAlreadyActive2", {
          modulename: this._buildUserErrorTypeValue(moduleItem && moduleItem.typeID),
        });
        break;
      case "MODULE_REACTIVATING":
        throwWrappedUserError(
          "ModuleReactivationDelayed2",
          this._buildModuleReactivationUserErrorValues(session, moduleItem),
        );
        break;
      case "NO_AMMO":
        throwWrappedUserError("NoCharges", {
          launcher: this._buildUserErrorTypeValue(moduleItem && moduleItem.typeID),
        });
        break;
      case "MAX_GROUP_ACTIVE":
        throwWrappedUserError(
          "EffectCrowdedOut",
          this._buildEffectCrowdedOutValues(session, moduleItem),
        );
        break;
      case "TARGET_REQUIRED":
        this._throwCustomNotifyUserError("You need an active target to activate that module.");
        break;
      case "TARGET_NOT_LOCKED":
        this._throwCustomNotifyUserError("That target is not locked.");
        break;
      case "TARGET_TETHERED":
        this._throwCustomNotifyUserError("That target is tethered and cannot be affected by this module.");
        break;
      case "MODULE_NOT_ONLINE":
        this._throwCustomNotifyUserError(`${moduleName} is offline.`);
        break;
      case "MODULE_INCAPACITATED":
        this._throwCustomNotifyUserError(`${moduleName} is too damaged to activate.`);
        break;
      case "NOT_ENOUGH_CAPACITOR":
        this._throwCustomNotifyUserError("You do not have enough capacitor to activate that module.");
        break;
      case "CLOAK_PROXIMITY_BLOCKED":
        this._throwCustomNotifyUserError(
          "You are too close to another object to activate your cloaking device.",
        );
        break;
      case "CLOAK_TARGET_LOCKED":
        this._throwCustomNotifyUserError(
          "Your ship is already target locked and cannot activate a cloaking device.",
        );
        break;
      case "MODULE_CLOAKED":
        this._throwCustomNotifyUserError("You cannot activate modules while cloaked.");
        break;
      case "ANALYZER_TARGET_INVALID":
        this._throwCustomNotifyUserError("That target cannot be hacked with this analyzer.");
        break;
      case "ANALYZER_TYPE_MISMATCH":
        this._throwCustomNotifyUserError("That analyzer is not compatible with this container.");
        break;
      case "ANALYZER_TARGET_ALREADY_HACKED":
        this._throwCustomNotifyUserError("That container has already been hacked.");
        break;
      case "ANALYZER_TARGET_BUSY":
        this._throwCustomNotifyUserError("That container is already being hacked.");
        break;
      case "NO_FUEL":
        this._throwCustomNotifyUserError("You do not have enough fuel to activate that module.");
        break;
      case "MODULE_DISALLOWED_IN_HIGHSEC":
        throwWrappedUserError("CantInHighSecSpace");
        break;
      case "ACTIVE_INDUSTRIAL_CORE_REQUIRED":
        this._throwCustomNotifyUserError(
          "An active industrial core is required to activate that module.",
        );
        break;
      case "WARP_SCRAMBLED":
        this._throwCustomNotifyUserError("You cannot warp because you are warp scrambled.");
        break;
      case "MICROWARPDRIVE_BLOCKED":
        this._throwCustomNotifyUserError(
          "That module cannot be activated while you are warp scrambled.",
        );
        break;
      case "MICRO_JUMP_DRIVE_BLOCKED":
        this._throwCustomNotifyUserError(
          "That module cannot be activated while you are warp scrambled.",
        );
        break;
      case "MAX_VELOCITY_ACTIVATION_LIMIT":
        this._throwCustomNotifyUserError("You are moving too fast to activate that module.");
        break;
      case "NO_ACTIVATABLE_EFFECT":
      case "UNSUPPORTED_EFFECT":
      case "UNSUPPORTED_MODULE":
        this._throwCustomNotifyUserError(`${moduleName} cannot be activated.`);
        break;
      case "CANNOT_ACTIVATE_IN_WARP":
        throwWrappedUserError("DeniedActivateInWarp");
        break;
      case "MODULE_RESTRICTED_IN_LOWSEC":
        this._throwCustomNotifyUserError(
          "That module cannot be activated in the current security band.",
        );
        break;
      case "TARGET_POINT_REQUIRED":
        this._throwCustomNotifyUserError("You must choose a point in space for that module.");
        break;
      default:
        this._throwCustomNotifyUserError(
          `Failed to activate ${moduleName}: ${normalizedErrorMsg || "unknown error"}.`,
        );
        break;
    }
  }
  _throwModuleDeactivationUserError(errorMsg = "", moduleItem = null) {
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
      case "MODULE_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "MODULE_NOT_ACTIVE":
        this._throwCustomNotifyUserError(`${this._resolveModuleDisplayName(moduleItem)} is not active.`);
        break;
      default:
        this._throwCustomNotifyUserError(
          `Failed to deactivate ${this._resolveModuleDisplayName(moduleItem)}.`,
        );
        break;
    }
  }
  _throwModuleOverloadUserError(errorMsg = "", moduleItem = null, data = null) {
    const errorData = data && typeof data === "object" ? data : {};
    const moduleName = this._resolveModuleDisplayName(moduleItem);
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
      case "MODULE_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "MODULE_NOT_ONLINE":
        this._throwCustomNotifyUserError(`${moduleName} is offline.`);
        break;
      case "MODULE_INCAPACITATED":
        this._throwCustomNotifyUserError(`${moduleName} is too damaged to overload.`);
        break;
      case "MODULE_NOT_OVERLOADABLE":
        this._throwCustomNotifyUserError(`${moduleName} cannot be overloaded.`);
        break;
      case "THERMODYNAMICS_SKILL_REQUIRED":
        throwWrappedUserError("DontHaveThermoDynamicsSkill", {
          skillLevel: Math.max(1, Number(errorData.skillLevel) || 1),
        });
        break;
      default:
        this._throwCustomNotifyUserError(
          `Failed to change overload state for ${moduleName}.`,
        );
        break;
    }
  }
  _getModuleRepairRuntimeMap(session) {
    if (!session || typeof session !== "object") {
      return null;
    }
    if (!(session._dogmaModuleRepairs instanceof Map)) {
      session._dogmaModuleRepairs = new Map();
    }
    return session._dogmaModuleRepairs;
  }
  _getItemStructureHitpoints(typeID) {
    const hp = Number(getTypeAttributeValue(typeID, "hp", "structureHP")) || 0;
    if (hp > 0) {
      return hp;
    }
    return this._getDogmaAttributeDefaultValue(ATTRIBUTE_HP, 0);
  }
  _getNaniteRepairPasteQuantity(item) {
    return Math.max(0, Number(item && (item.stacksize ?? item.quantity)) || 0);
  }
  _listNaniteRepairPasteStacks(charID, shipID) {
    return listContainerItems(charID, shipID, ITEM_FLAGS.CARGO_HOLD)
      .filter(
        (item) =>
          Number(item && item.typeID) === TYPE_NANITE_REPAIR_PASTE &&
          this._getNaniteRepairPasteQuantity(item) > 0,
      )
      .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
  }
  _consumeNaniteRepairPaste(session, charID, shipID, requiredUnits) {
    const units = Math.max(0, Math.ceil(Number(requiredUnits) || 0));
    if (units <= 0) {
      return {
        success: true,
        changes: [],
      };
    }
    const stacks = this._listNaniteRepairPasteStacks(charID, shipID);
    const availableUnits = stacks.reduce(
      (total, stack) => total + this._getNaniteRepairPasteQuantity(stack),
      0,
    );
    if (availableUnits < units) {
      return {
        success: false,
        errorMsg: "NOT_ENOUGH_NANITE_REPAIR_PASTE",
      };
    }

    let remainingUnits = units;
    const changes = [];
    for (const stack of stacks) {
      if (remainingUnits <= 0) {
        break;
      }
      const consumeUnits = Math.min(
        remainingUnits,
        this._getNaniteRepairPasteQuantity(stack),
      );
      const consumeResult = consumeInventoryItemQuantity(stack.itemID, consumeUnits, {
        reason: "nanite-module-repair",
      });
      if (!consumeResult || consumeResult.success !== true) {
        return {
          success: false,
          errorMsg: consumeResult && consumeResult.errorMsg
            ? consumeResult.errorMsg
            : "WRITE_ERROR",
        };
      }
      if (consumeResult.data && Array.isArray(consumeResult.data.changes)) {
        changes.push(...consumeResult.data.changes);
      }
      remainingUnits -= consumeUnits;
    }
    this._syncInventoryChanges(session, changes);
    return {
      success: true,
      changes,
    };
  }
  _resolveModuleRepairContext(session, moduleID) {
    const numericModuleID = Number(moduleID) || 0;
    const charID = this._getCharID(session);
    const shipID = this._getShipID(session);
    const moduleItem = findItemById(numericModuleID);
    if (
      !session ||
      !session._space ||
      numericModuleID <= 0 ||
      charID <= 0 ||
      shipID <= 0
    ) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
        moduleItem,
      };
    }
    if (
      !moduleItem ||
      Number(moduleItem.ownerID) !== charID ||
      Number(moduleItem.locationID) !== shipID
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
        moduleItem,
      };
    }
    const categoryID = Number(moduleItem.categoryID) || 0;
    if (categoryID !== CATEGORY_MODULE && categoryID !== CATEGORY_STRUCTURE_MODULE) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
        moduleItem,
      };
    }
    if (spaceRuntime.getActiveModuleEffect(session, numericModuleID)) {
      return {
        success: false,
        errorMsg: "MODULE_ACTIVE",
        moduleItem,
      };
    }
    const hp = this._getItemStructureHitpoints(moduleItem.typeID);
    const damageRatio = clampRatio(
      moduleItem.moduleState && moduleItem.moduleState.damage,
      0,
    );
    const damageHP = hp * damageRatio;
    if (hp <= 0 || damageHP <= 0) {
      return {
        success: false,
        errorMsg: "NOT_DAMAGED",
        moduleItem,
      };
    }
    const naniteRepairAttributes =
      this._resolveCharacterNaniteRepairAttributes(charID);
    const rawTypeRepairCostMultiplier = getTypeAttributeValue(
      moduleItem.typeID,
      "repairCostMultiplier",
    );
    const rawTypeRepairCostPercent = getTypeAttributeValue(
      moduleItem.typeID,
      "repairCostPercent",
    );
    const typeRepairCostMultiplier = Number(rawTypeRepairCostMultiplier);
    const typeRepairCostPercent = Number(rawTypeRepairCostPercent);
    const pasteUnits = Math.max(
      1,
      Math.ceil(
        damageHP *
          naniteRepairAttributes.repairCostMultiplier *
          (rawTypeRepairCostMultiplier !== null &&
          rawTypeRepairCostMultiplier !== undefined &&
          Number.isFinite(typeRepairCostMultiplier)
            ? typeRepairCostMultiplier
            : 1) *
          ((rawTypeRepairCostPercent !== null &&
          rawTypeRepairCostPercent !== undefined &&
          Number.isFinite(typeRepairCostPercent)
            ? typeRepairCostPercent
            : 100) / 100),
      ),
    );
    return {
      success: true,
      data: {
        charID,
        shipID,
        moduleID: numericModuleID,
        moduleItem,
        hp,
        damageRatio,
        damageHP,
        pasteUnits,
        moduleRepairRate: naniteRepairAttributes.moduleRepairRate,
      },
    };
  }
  _startModuleRepair(session, moduleID, options = {}) {
    const context = this._resolveModuleRepairContext(session, moduleID);
    if (!context.success) {
      return context;
    }
    const data = context.data;
    const repairMap = this._getModuleRepairRuntimeMap(session);
    if (repairMap && repairMap.has(data.moduleID)) {
      return {
        success: true,
        data,
      };
    }
    const consumeResult = this._consumeNaniteRepairPaste(
      session,
      data.charID,
      data.shipID,
      data.pasteUnits,
    );
    if (!consumeResult.success) {
      return consumeResult;
    }
    if (repairMap) {
      repairMap.set(data.moduleID, {
        ...data,
        startedAtMs: Date.now(),
        consumedPasteUnits: data.pasteUnits,
        source: options.source || "single",
      });
    }
    return {
      success: true,
      data,
    };
  }
  _finishModuleRepair(session, moduleID) {
    const numericModuleID = Number(moduleID) || 0;
    const repairMap = this._getModuleRepairRuntimeMap(session);
    const repairState =
      repairMap && numericModuleID > 0
        ? repairMap.get(numericModuleID) || null
        : null;
    if (!repairState) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_REPAIRING",
      };
    }
    const moduleItem = findItemById(numericModuleID);
    if (!moduleItem) {
      repairMap.delete(numericModuleID);
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const hp = this._getItemStructureHitpoints(moduleItem.typeID);
    const currentDamageRatio = clampRatio(
      moduleItem.moduleState && moduleItem.moduleState.damage,
      0,
    );
    const currentDamageHP = hp * currentDamageRatio;
    const elapsedMs = Math.max(0, Date.now() - (Number(repairState.startedAtMs) || Date.now()));
    const repairHP = Math.min(
      currentDamageHP,
      (elapsedMs / 60000) * Math.max(0, Number(repairState.moduleRepairRate) || 0),
    );
    const nextDamageHP = Math.max(0, currentDamageHP - repairHP);
    const nextDamageRatio = hp > 0 ? clampRatio(nextDamageHP / hp, 0) : 0;
    const updateResult = updateInventoryItem(numericModuleID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        damage: nextDamageRatio,
        incapacitated:
          nextDamageRatio >= 1
            ? true
            : (currentItem.moduleState && currentItem.moduleState.incapacitated) === true &&
              nextDamageRatio > 0,
      },
    }));
    repairMap.delete(numericModuleID);
    if (!updateResult.success) {
      return updateResult;
    }
    syncDamageStateAttributesForSession(
      session,
      updateResult.data,
      updateResult.previousData || {},
    );
    return updateResult;
  }
  Handle_AddTarget(args, session) {
    const targetID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[DogmaIM] AddTarget targetID=${targetID}`);
    const result = spaceRuntime.addTarget(session, targetID);
    if (!result || !result.success) {
      const errorData =
        result && result.data && typeof result.data === "object"
          ? { ...result.data }
          : {};
      if (errorData.targetTypeID === undefined && targetID > 0) {
        const scene =
          session && typeof spaceRuntime.getSceneForSession === "function"
            ? spaceRuntime.getSceneForSession(session)
            : null;
        const targetEntity =
          scene && typeof scene.getEntityByID === "function"
            ? scene.getEntityByID(targetID)
            : null;
        if (targetEntity && Number(targetEntity.typeID) > 0) {
          errorData.targetTypeID = Number(targetEntity.typeID) || 0;
        }
      }
      this._throwTargetingUserError(result && result.errorMsg, errorData);
    }
    const shipID = Number(
      session && session._space && session._space.shipID ||
      session && (session.activeShipID || session.shipID || session.shipid),
    ) || 0;
    if (shipID > 0 && session && typeof session.sendNotification === "function") {
      session.sendNotification("OnInvulnCancelled", "shipid", [shipID]);
    }
    return [
      result.data && result.data.pending ? 1 : 0,
      this._buildTargetIDList(
        (result.data && result.data.targets) || spaceRuntime.getTargets(session),
      ),
    ];
  }
  Handle_CancelAddTarget(args, session) {
    const targetID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[DogmaIM] CancelAddTarget targetID=${targetID}`);
    spaceRuntime.cancelAddTarget(session, targetID, {
      notifySelf: false,
    });
    return null;
  }
  Handle_RemoveTarget(args, session) {
    const targetID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[DogmaIM] RemoveTarget targetID=${targetID}`);
    spaceRuntime.removeTarget(session, targetID, {
      notifySelf: true,
      notifyTarget: true,
    });
    return null;
  }
  Handle_RemoveTargets(args, session) {
    const rawTargetIDs = args && args.length > 0 ? args[0] : [];
    const targetIDs = extractList(rawTargetIDs)
      .map((targetID) => Number(targetID) || 0)
      .filter((targetID) => targetID > 0);
    log.debug(`[DogmaIM] RemoveTargets count=${targetIDs.length}`);
    spaceRuntime.removeTargets(session, targetIDs, {
      notifySelf: true,
      notifyTarget: true,
    });
    return null;
  }
  Handle_ClearTargets(args, session) {
    log.debug("[DogmaIM] ClearTargets");
    spaceRuntime.clearTargets(session, {
      notifySelf: true,
      notifyTarget: true,
    });
    return null;
  }
  Handle_GetTargets(args, session) {
    log.debug("[DogmaIM] GetTargets");
    return this._buildTargetIDList(spaceRuntime.getTargets(session));
  }
  Handle_GetTargeters(args, session) {
    log.debug("[DogmaIM] GetTargeters");
    return this._buildTargetIDList(spaceRuntime.getTargeters(session));
  }
  _expandGroupedModuleIDs(shipID, rawModuleIDs) {
    const normalizedModuleIDs = extractSequenceValues(rawModuleIDs);
    const requestedModuleIDs =
      normalizedModuleIDs.length > 0
        ? normalizedModuleIDs
        : Array.isArray(rawModuleIDs)
          ? rawModuleIDs
          : [rawModuleIDs];
    const expandedModuleIDs = [];
    const seenModuleIDs = new Set();
    for (const requestedModuleID of requestedModuleIDs) {
      const numericModuleID = Number(requestedModuleID) || 0;
      if (numericModuleID <= 0) {
        continue;
      }
      const bankModuleIDs = getModulesInBank(shipID, numericModuleID);
      const nextModuleIDs =
        Array.isArray(bankModuleIDs) && bankModuleIDs.length > 0
          ? bankModuleIDs
          : [numericModuleID];
      for (const moduleID of nextModuleIDs) {
        const numericExpandedModuleID = Number(moduleID) || 0;
        if (numericExpandedModuleID <= 0 || seenModuleIDs.has(numericExpandedModuleID)) {
          continue;
        }
        seenModuleIDs.add(numericExpandedModuleID);
        expandedModuleIDs.push(numericExpandedModuleID);
      }
    }
    return expandedModuleIDs;
  }
  _buildGroupedUnloadTargets(charID, shipID, rawModuleIDs, quantity = null) {
    const normalizedQuantity =
      quantity === null || quantity === undefined
        ? null
        : Math.max(0, Math.trunc(Number(quantity) || 0));
    const expandedModuleIDs = this._expandGroupedModuleIDs(shipID, rawModuleIDs);
    if (normalizedQuantity === null) {
      return expandedModuleIDs.map((moduleID) => ({
        moduleID,
        quantity: null,
      }));
    }

    const normalizedRequestedModuleIDs = extractSequenceValues(rawModuleIDs);
    const requestedModuleIDs =
      normalizedRequestedModuleIDs.length > 0
        ? normalizedRequestedModuleIDs
        : Array.isArray(rawModuleIDs)
          ? rawModuleIDs
          : [rawModuleIDs];
    if (requestedModuleIDs.length !== 1 || expandedModuleIDs.length <= 1) {
      return expandedModuleIDs.map((moduleID) => ({
        moduleID,
        quantity: normalizedQuantity,
      }));
    }

    let remainingQuantity = normalizedQuantity;
    const unloadTargets = [];
    for (const moduleID of expandedModuleIDs) {
      if (remainingQuantity <= 0) {
        break;
      }
      const moduleItem = findItemById(moduleID);
      if (!moduleItem) {
        continue;
      }
      const chargeItem = getLoadedChargeByFlag(charID, shipID, moduleItem.flagID);
      const availableQuantity = Number(
        chargeItem && (chargeItem.stacksize || chargeItem.quantity),
      ) || 0;
      if (availableQuantity <= 0) {
        continue;
      }
      const unloadQuantity = Math.min(remainingQuantity, availableQuantity);
      unloadTargets.push({
        moduleID,
        quantity: unloadQuantity,
      });
      remainingQuantity -= unloadQuantity;
    }

    if (unloadTargets.length > 0) {
      return unloadTargets;
    }
    return expandedModuleIDs.map((moduleID) => ({
      moduleID,
      quantity: normalizedQuantity,
    }));
  }
  _collectWeaponBankTouchedModuleIDs(
    shipID,
    moduleIDs = [],
    options = {},
  ) {
    const numericShipID = Number(shipID) || 0;
    const touchedModuleIDs = new Set();
    if (options.includeAllBanks === true) {
      const banks = getShipWeaponBanks(numericShipID, {
        characterID: this._getCharID(options.session || null),
      });
      for (const [masterID, slaveIDs] of Object.entries(banks || {})) {
        const numericMasterID = Number(masterID) || 0;
        if (numericMasterID > 0) {
          touchedModuleIDs.add(numericMasterID);
        }
        for (const slaveID of Array.isArray(slaveIDs) ? slaveIDs : []) {
          const numericSlaveID = Number(slaveID) || 0;
          if (numericSlaveID > 0) {
            touchedModuleIDs.add(numericSlaveID);
          }
        }
      }
    }
    for (const rawModuleID of Array.isArray(moduleIDs) ? moduleIDs : [moduleIDs]) {
      const numericModuleID = Number(rawModuleID) || 0;
      if (numericModuleID <= 0) {
        continue;
      }
      touchedModuleIDs.add(numericModuleID);
      for (const bankModuleID of getModulesInBank(numericShipID, numericModuleID)) {
        const numericBankModuleID = Number(bankModuleID) || 0;
        if (numericBankModuleID > 0) {
          touchedModuleIDs.add(numericBankModuleID);
        }
      }
    }
    return [...touchedModuleIDs].sort((left, right) => left - right);
  }
  _repairWeaponBankModulePresentation(session, shipID, moduleIDs = []) {
    if (!session || !Array.isArray(moduleIDs) || moduleIDs.length <= 0) {
      return;
    }
    const numericShipID = Number(shipID) || this._getShipID(session);
    if (numericShipID <= 0) {
      return;
    }
    if (!session._space) {
      syncShipFittingStateForSession(session, numericShipID, {
        includeOfflineModules: true,
        includeCharges: true,
        onlyCharges: true,
        emitChargeInventoryRows: true,
        syntheticFitTransition: true,
      });
      return;
    }
    if (
      spaceRuntime &&
      typeof spaceRuntime.reconcileActiveTurretWeaponBankEffects === "function"
    ) {
      const reconcileResult = spaceRuntime.reconcileActiveTurretWeaponBankEffects(
        session,
        numericShipID,
        moduleIDs,
      );
      if (reconcileResult && reconcileResult.changed) {
        log.debug(
          `[DogmaIM] Reconciled active turret bank effects shipID=${numericShipID} ` +
          `modules=${JSON.stringify(reconcileResult.activeModuleIDs || [])}`,
        );
      }
    }
  }
  _throwWeaponBankMutationUserError(errorMsg = "") {
    switch (String(errorMsg || "").trim()) {
      case "MODULES_MUST_BE_ONLINE":
        this._throwCustomNotifyUserError(
          "All weapons in the bank must be online before grouping them.",
        );
        break;
      case "MODULE_CHARGE_MISMATCH":
        this._throwCustomNotifyUserError(
          "All weapons in the bank must have the same loaded charge, or all be empty.",
        );
        break;
      case "BANK_NOT_FOUND":
        this._throwCustomNotifyUserError("That weapon bank no longer exists.");
        break;
      default:
        this._throwCustomNotifyUserError(
          "Failed to change the current weapon bank configuration.",
        );
        break;
    }
  }
  Handle_LinkWeapons(args, session) {
    const shipID =
      args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const masterModuleID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const slaveModuleID = args && args.length > 2 ? Number(args[2]) || 0 : 0;
    const touchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
      shipID,
      [masterModuleID, slaveModuleID],
    );
    const result = linkWeaponBanks(shipID, masterModuleID, slaveModuleID, {
      characterID: this._getCharID(session),
    });
    if (!result || result.success !== true) {
      this._throwWeaponBankMutationUserError(result && result.errorMsg);
    }
    if (result && result.data && result.data.changed) {
      this._repairWeaponBankModulePresentation(session, shipID, touchedModuleIDs);
    }
    return buildWeaponBankStateDict(shipID, {
      banks:
        result && result.data && result.data.banks
          ? result.data.banks
          : null,
      characterID: this._getCharID(session),
    });
  }
  Handle_MergeModuleGroups(args, session) {
    const shipID =
      args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const targetMasterID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const sourceMasterID = args && args.length > 2 ? Number(args[2]) || 0 : 0;
    const touchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
      shipID,
      [targetMasterID, sourceMasterID],
    );
    const result = mergeModuleGroups(shipID, targetMasterID, sourceMasterID, {
      characterID: this._getCharID(session),
    });
    if (!result || result.success !== true) {
      this._throwWeaponBankMutationUserError(result && result.errorMsg);
    }
    if (result && result.data && result.data.changed) {
      this._repairWeaponBankModulePresentation(session, shipID, touchedModuleIDs);
    }
    return buildWeaponBankStateDict(shipID, {
      banks:
        result && result.data && result.data.banks
          ? result.data.banks
          : null,
      characterID: this._getCharID(session),
    });
  }
  Handle_PeelAndLink(args, session) {
    const shipID =
      args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const targetMasterID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const sourceMasterID = args && args.length > 2 ? Number(args[2]) || 0 : 0;
    const touchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
      shipID,
      [targetMasterID, sourceMasterID],
    );
    const result = peelAndLink(shipID, targetMasterID, sourceMasterID, {
      characterID: this._getCharID(session),
    });
    if (!result || result.success !== true) {
      this._throwWeaponBankMutationUserError(result && result.errorMsg);
    }
    if (result && result.data && result.data.changed) {
      this._repairWeaponBankModulePresentation(session, shipID, touchedModuleIDs);
    }
    return buildWeaponBankStateDict(shipID, {
      banks:
        result && result.data && result.data.banks
          ? result.data.banks
          : null,
      characterID: this._getCharID(session),
    });
  }
  Handle_UnlinkModule(args, session) {
    const shipID =
      args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const masterModuleID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const touchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
      shipID,
      [masterModuleID],
    );
    const result = unlinkModuleFromBank(shipID, masterModuleID, {
      characterID: this._getCharID(session),
    });
    if (!result || result.success !== true) {
      this._throwWeaponBankMutationUserError(result && result.errorMsg);
    }
    if (result && result.data && result.data.changed) {
      this._repairWeaponBankModulePresentation(session, shipID, touchedModuleIDs);
    }
    return Number(result && result.data && result.data.peeledModuleID) || 0;
  }
  Handle_LinkAllWeapons(args, session) {
    const shipID =
      args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const touchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
      shipID,
      [],
      { includeAllBanks: true, session },
    );
    const result = linkAllWeaponBanks(shipID, {
      characterID: this._getCharID(session),
    });
    if (!result || result.success !== true) {
      this._throwWeaponBankMutationUserError(result && result.errorMsg);
    }
    if (result && result.data && result.data.changed) {
      const nextTouchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
        shipID,
        [],
        { includeAllBanks: true, session },
      );
      this._repairWeaponBankModulePresentation(
        session,
        shipID,
        [...new Set([...touchedModuleIDs, ...nextTouchedModuleIDs])],
      );
    }
    return buildWeaponBankStateDict(shipID, {
      banks:
        result && result.data && result.data.banks
          ? result.data.banks
          : null,
      characterID: this._getCharID(session),
    });
  }
  Handle_UnlinkAllModules(args, session) {
    const shipID =
      args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const touchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
      shipID,
      [],
      { includeAllBanks: true, session },
    );
    const result = unlinkAllWeaponBanks(shipID, {
      characterID: this._getCharID(session),
    });
    if (!result || result.success !== true) {
      this._throwWeaponBankMutationUserError(result && result.errorMsg);
    }
    if (result && result.data && result.data.changed) {
      this._repairWeaponBankModulePresentation(session, shipID, touchedModuleIDs);
    }
    return buildWeaponBankStateDict(shipID, {
      banks:
        result && result.data && result.data.banks
          ? result.data.banks
          : {},
      characterID: this._getCharID(session),
    });
  }
  Handle_DestroyWeaponBank(args, session) {
    const shipID =
      args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const masterModuleID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const touchedModuleIDs = this._collectWeaponBankTouchedModuleIDs(
      shipID,
      [masterModuleID],
    );
    const result = destroyWeaponBank(shipID, masterModuleID, {
      characterID: this._getCharID(session),
    });
    if (!result || result.success !== true) {
      this._throwWeaponBankMutationUserError(result && result.errorMsg);
    }
    if (result && result.data && result.data.changed) {
      this._repairWeaponBankModulePresentation(session, shipID, touchedModuleIDs);
    }
    return null;
  }
  _setModuleOnlineState(shipID, moduleID, online, session) {
    const charID = this._getCharID(session);
    const numericShipID = Number(shipID) || this._getShipID(session);
    const numericModuleID = Number(moduleID) || 0;
    const moduleItem = findItemById(numericModuleID);
    const structureShipRecord = this._getStructureShipMetadataByID(numericShipID);
    const isStructureHost = Boolean(structureShipRecord);
    const moduleOwnerID = Number(moduleItem && moduleItem.ownerID) || 0;
    const structureOwnerID = Number(
      structureShipRecord &&
      (structureShipRecord.ownerCorpID || structureShipRecord.ownerID),
    ) || 0;
    const moduleOwnedForHost =
      moduleOwnerID === charID ||
      (isStructureHost && structureOwnerID > 0 && moduleOwnerID === structureOwnerID);
    if (
      !moduleItem ||
      !moduleOwnedForHost ||
      Number(moduleItem.locationID) !== numericShipID
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const previousOnline = isEffectivelyOnlineModule(moduleItem);
    const nextOnline = Boolean(online);
    const inSpace = Boolean(session && session._space);
    if (!nextOnline) {
      const bankMasterID = getWeaponBankMasterModuleID(
        numericShipID,
        numericModuleID,
      );
      if (bankMasterID > 0) {
        destroyWeaponBankAndNotify(session, numericShipID, bankMasterID, {
          characterID: charID,
          skipOfflineValidation: true,
        });
      }
    }
    const shipRecord =
      findCharacterShip(charID, numericShipID) ||
      structureShipRecord ||
      this._getActiveShipRecord(session) ||
      null;
    const shipStateSource = shipRecord || {
      itemID: numericShipID,
      typeID: this._getShipTypeID(session),
    };
    const previousFittingSnapshot = getShipFittingSnapshot(charID, numericShipID, {
      shipItem: shipStateSource,
      fittedItems: isStructureHost
        ? listFittedItemsForLocation(numericShipID)
        : undefined,
      reason: "dogma.online.before",
    });
    if (
      !nextOnline &&
      previousOnline &&
      isStructureHost &&
      isStructureServiceModuleItem(moduleItem) &&
      !characterCanDisableStructureServiceModule(
        session,
        moduleItem,
        structureShipRecord,
      )
    ) {
      return {
        success: false,
        errorMsg: "CRP_ACCESS_DENIED",
      };
    }
    if (nextOnline && !previousOnline) {
      const maxGroupOnlineLimit = resolveMaxGroupOnlineLimit(
        moduleItem,
        previousFittingSnapshot && previousFittingSnapshot.fittedItems,
      );
      if (
        maxGroupOnlineLimit &&
        maxGroupOnlineLimit.onlineGroupCount >= maxGroupOnlineLimit.maxGroupOnline
      ) {
        return {
          success: false,
          errorMsg: "MAX_GROUP_ONLINE",
          data: maxGroupOnlineLimit,
        };
      }
      const onlineCandidate =
        previousFittingSnapshot &&
        previousFittingSnapshot.buildOnlineCandidateResourceState(moduleItem);
      const resourceState =
        onlineCandidate && onlineCandidate.baselineResourceState;
      const moduleResourceLoad =
        onlineCandidate && onlineCandidate.moduleResourceLoad;
      if (!resourceState || !moduleResourceLoad) {
        return {
          success: false,
          errorMsg: "MODULE_NOT_FOUND",
        };
      }
      if (onlineCandidate.cpuAfter > resourceState.cpuOutput + 1e-6) {
        return {
          success: false,
          errorMsg: "NOT_ENOUGH_CPU",
        };
      }
      if (onlineCandidate.powerAfter > resourceState.powerOutput + 1e-6) {
        return {
          success: false,
          errorMsg: "NOT_ENOUGH_POWER",
        };
      }
      if (inSpace && !isStructureHost) {
        const capacitorState = spaceRuntime.getShipCapacitorState(session);
        if (
          !capacitorState ||
          !Number.isFinite(Number(capacitorState.ratio)) ||
          Number(capacitorState.ratio) < (ONLINE_CAPACITOR_CHARGE_RATIO / 100)
        ) {
          return {
            success: false,
            errorMsg: "NOT_ENOUGH_CAPACITOR",
          };
        }
      }
    }
    let fuelConsumptionChanges = [];
    if (
      nextOnline &&
      !previousOnline &&
      isStructureHost &&
      isStructureServiceModuleItem(moduleItem)
    ) {
      if (isStructureDamagedForServiceOnline(structureShipRecord)) {
        return {
          success: false,
          errorMsg: "STRUCTURE_DAMAGED",
        };
      }
      const fuelResult = consumeStructureServiceModuleOnlineFuel(
        numericShipID,
        moduleItem,
      );
      if (!fuelResult || fuelResult.success !== true) {
        return {
          success: false,
          errorMsg:
            fuelResult && fuelResult.errorMsg
              ? fuelResult.errorMsg
              : "NOT_ENOUGH_FUEL",
          data: fuelResult || null,
        };
      }
      fuelConsumptionChanges = Array.isArray(fuelResult.changes)
        ? fuelResult.changes
        : [];
    }
    if (!nextOnline && inSpace) {
      const activeEffect = spaceRuntime.getActiveModuleEffect(session, numericModuleID);
      if (activeEffect) {
        if (activeEffect.isGeneric) {
          spaceRuntime.deactivateGenericModule(session, numericModuleID, {
            reason: "offline",
            deferUntilCycle: false,
          });
        } else {
          spaceRuntime.deactivatePropulsionModule(session, numericModuleID, {
            reason: "offline",
          });
        }
      }
    }
    const updateResult = updateInventoryItem(numericModuleID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        online: nextOnline,
      },
    }));
    if (!updateResult.success) {
      return updateResult;
    }
    if (isStructureHost && isStructureServiceModuleItem(updateResult.data)) {
      const syncResult = syncStructureServiceModuleState(numericShipID);
      if (!syncResult || syncResult.success !== true) {
        log.warn(
          `[DogmaIM] structure service module sync failed structure=${numericShipID} module=${numericModuleID} error=${syncResult && syncResult.errorMsg || "UNKNOWN"}`,
        );
      } else {
        if (
          Array.isArray(syncResult.fuelCycleChanges) &&
          syncResult.fuelCycleChanges.length > 0
        ) {
          this._syncInventoryChanges(session, syncResult.fuelCycleChanges);
        }
        if (syncResult.data && syncResult.data.solarSystemID) {
          spaceRuntime.syncStructureSceneState(syncResult.data.solarSystemID, {
            reason: "structureServiceModuleState",
          });
        }
      }
    }
    this._syncInventoryChanges(session, fuelConsumptionChanges);
    invalidateShipFittingSnapshot(charID, numericShipID, {
      shipItem: shipStateSource,
    });
    const refreshedShipStateSource =
      findCharacterShip(charID, numericShipID) ||
      this._getStructureShipMetadataByID(numericShipID) ||
      this._getActiveShipRecord(session) ||
      shipStateSource;
    const nextFittingSnapshot = refreshShipFittingSnapshot(charID, numericShipID, {
      shipItem: refreshedShipStateSource,
      reason: "dogma.online.after",
    });
    // TQ parity: an online/offline toggle is delivered as ONE OnMultiEvent that
    // batches the module's isOnline flip + the ship fitting-resource recalc
    // (powerLoad/cpuLoad/slotsLeft) + the module's online effect start/stop.
    // Decoded from a real Tranquility capture (L6196→L6390; see
    // doc/PARITY_FITTING_NOTIFICATION_SEQUENCE.md). No item move is sent — the
    // module stays in its slot.
    const onlineToggleTime = this._sessionFileTime(session);
    const onlineToggleSubEvents = [];
    const isOnlineAttributeID = getAttributeIDByNames("isOnline");
    if (isOnlineAttributeID && previousOnline !== nextOnline) {
      onlineToggleSubEvents.push(
        buildModuleAttributeChangeEvent(
          charID,
          numericModuleID,
          isOnlineAttributeID,
          nextOnline ? 1 : 0,
          previousOnline ? 1 : 0,
          onlineToggleTime,
        ),
      );
    }
    if (previousFittingSnapshot && nextFittingSnapshot) {
      for (const change of listShipFittingAttributeChanges(
        previousFittingSnapshot,
        nextFittingSnapshot,
      )) {
        onlineToggleSubEvents.push(
          buildModuleAttributeChangeEvent(
            charID,
            numericShipID,
            change.attributeID,
            change.nextValue,
            change.previousValue,
            onlineToggleTime,
          ),
        );
      }
    }
    onlineToggleSubEvents.push(
      buildGodmaShipEffectEvent(
        numericModuleID,
        charID,
        numericShipID,
        EFFECT_ONLINE,
        onlineToggleTime,
        { isStart: nextOnline ? 1 : 0, shouldStart: nextOnline ? 1 : 0 },
      ),
    );
    sendOnMultiEvent(session, onlineToggleSubEvents, onlineToggleTime);
    log.debug(
      `[DogmaIM] SetModuleOnlineState applied shipID=${numericShipID} ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(updateResult.data))} ` +
      `previousOnline=${previousOnline === true} nextOnline=${nextOnline} ` +
      `inSpace=${inSpace}`,
    );
    if (inSpace) {
      if (nextOnline && !previousOnline) {
        spaceRuntime.setShipCapacitorRatio(
          session,
          ONLINE_CAPACITOR_REMAINDER_RATIO / 100,
        );
      }
      spaceRuntime.refreshShipDerivedState(session, {
        broadcast: true,
      });
    }
    return {
      success: true,
      data: updateResult.data,
    };
  }
  _resolveUnloadDestination(destination, session, shipID) {
    const numericShipID = Number(shipID) || this._getShipID(session);
    const destinationValues = extractSequenceValues(destination);
    if (destinationValues.length > 0) {
      let locationID = Number(destinationValues[0]) || 0;
      const flagID = Number(destinationValues[2]) || ITEM_FLAGS.HANGAR;
      // Virtual container IDs (10004 = hangar, 10014 = structure) must be
      // resolved to the player's actual docked station/structure ID so items
      // are stored at the correct location rather than the abstract constant.
      if (locationID === 10004 || locationID === 10014) {
        locationID = getDockedLocationID(session) || this._getLocationID(session);
      }
      return {
        locationID,
        flagID,
      };
    }
    const numericDestination = Number(destination) || 0;
    if (numericDestination === numericShipID) {
      return {
        locationID: numericShipID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
      };
    }
    return {
      locationID: numericDestination || this._getLocationID(session),
      flagID: ITEM_FLAGS.HANGAR,
    };
  }
  _resolveAmmoLocationID(ammoLocationID, session, shipID) {
    const numericShipID = Number(shipID) || this._getShipID(session);
    const numericLocationID = Number(ammoLocationID) || numericShipID;
    if (numericLocationID === 10004 || numericLocationID === 10014) {
      return getDockedLocationID(session) || this._getLocationID(session) || numericLocationID;
    }
    return numericLocationID;
  }
  _normalizeEffectName(rawEffectName) {
    if (typeof rawEffectName === "string") {
      return rawEffectName;
    }
    if (Buffer.isBuffer(rawEffectName)) {
      return rawEffectName.toString("utf8");
    }
    if (rawEffectName === undefined || rawEffectName === null) {
      return "";
    }
    return String(rawEffectName);
  }
  _normalizeActivationEffectName(rawEffectName) {
    const normalized = this._normalizeEffectName(rawEffectName).trim().toLowerCase();
    switch (normalized) {
      case "online":
        return "online";
      case "dohacking":
        return "doHacking";
      case "usemissiles":
        return "useMissiles";
      case "modulebonusafterburner":
      case "effectmodulebonusafterburner":
      case "effects.afterburner":
      case "dogmaxp.afterburner":
      case "afterburner":
        return "moduleBonusAfterburner";
      case "modulebonusmicrowarpdrive":
      case "effectmodulebonusmicrowarpdrive":
      case "effects.microwarpdrive":
      case "dogmaxp.microwarpdrive":
      case "microwarpdrive":
      case "mwd":
        return "moduleBonusMicrowarpdrive";
      default:
        return normalized;
    }
  }
  _resolveAmmoSourceStacks(charID, ammoLocationID, sourceFlagID, chargeTypeID, chargeRequests = []) {
    const explicitItemIDs = new Set(
      chargeRequests
        .map((request) => Number(request && request.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );
    const requestedTypeIDs = new Set(
      chargeRequests
        .map((request) => Number(request && request.typeID) || 0)
        .filter((typeID) => typeID > 0),
    );
    const normalizedChargeTypeID = Number(chargeTypeID) || 0;
    const locationItems = listContainerItems(charID, ammoLocationID, sourceFlagID)
      .filter((item) => Number(item.typeID) === normalizedChargeTypeID)
      .filter((item) => (Number(item.stacksize || item.quantity || 0) || 0) > 0);
    if (explicitItemIDs.size > 0) {
      const explicitMatches = locationItems
        .filter((item) => explicitItemIDs.has(Number(item.itemID) || 0))
        .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
      if (explicitMatches.length > 0) {
        return explicitMatches;
      }
      if (requestedTypeIDs.size > 0 && !requestedTypeIDs.has(normalizedChargeTypeID)) {
        return [];
      }
    }
    if (requestedTypeIDs.size > 0 && !requestedTypeIDs.has(normalizedChargeTypeID)) {
      return [];
    }
    return locationItems.sort(
      (left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0),
    );
  }
  _resolveRequestedAmmoTypeID(charID, ammoLocationID, sourceFlagID, chargeRequests = []) {
    for (const request of chargeRequests) {
      const itemID = Number(request && request.itemID) || 0;
      if (itemID <= 0) {
        continue;
      }
      const candidate = findItemById(itemID);
      if (
        candidate &&
        Number(candidate.ownerID) === charID
      ) {
        if (
          Number(candidate.locationID) === ammoLocationID &&
          Number(candidate.flagID) === sourceFlagID
        ) {
          return Number(candidate.typeID) || 0;
        }
        if (Number(candidate.typeID) > 0) {
          return Number(candidate.typeID) || 0;
        }
      }
    }
    for (const request of chargeRequests) {
      const typeID = Number(request && request.typeID) || 0;
      if (typeID > 0) {
        return typeID;
      }
    }
    return 0;
  }
  _resolvePendingReloadSourceStacks(
    charID,
    ammoLocationID,
    sourceFlagID,
    chargeTypeID,
    sourceItemIDs = [],
  ) {
    const explicitItemIDs = new Set(normalizeReloadSourceItemIDs(sourceItemIDs));
    return listContainerItems(charID, ammoLocationID, sourceFlagID)
      .filter((item) => Number(item.typeID) === Number(chargeTypeID))
      .filter((item) => (Number(item.stacksize || item.quantity || 0) || 0) > 0)
      .filter((item) => explicitItemIDs.size === 0 || explicitItemIDs.has(Number(item.itemID) || 0))
      .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
  }
  _queuePendingModuleReload(session, moduleItem, options = {}) {
    const numericModuleID = Number(moduleItem && moduleItem.itemID) || 0;
    if (numericModuleID <= 0) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const reloadTimeMs = Math.max(
      0,
      Math.round(
        Number(options.reloadTimeMs) || this._getModuleReloadTimeMs(moduleItem),
      ),
    );
    if (reloadTimeMs <= 0) {
      return {
        success: false,
        errorMsg: "NO_RELOAD_TIME",
      };
    }
    const existingReload = this._getPendingModuleReload(numericModuleID);
    if (existingReload) {
      return {
        success: true,
        data: {
          reloadState: existingReload,
          alreadyPending: true,
        },
      };
    }
    const startedAtMs = getSessionSimulationTimeMs(session, Date.now());
    const completeAtMs = startedAtMs + reloadTimeMs;
    const reloadState = {
      action: String(options.action || "load"),
      moduleID: numericModuleID,
      moduleFlagID: Number(moduleItem.flagID) || 0,
      moduleTypeID: Number(moduleItem.typeID) || 0,
      shipID: Number(options.shipID) || Number(moduleItem.locationID) || 0,
      charID: this._getCharID(session),
      inventoryOwnerID:
        Number(options.inventoryOwnerID) ||
        this._getDogmaInventoryOwnerID(
          session,
          Number(options.shipID) || Number(moduleItem.locationID) || 0,
        ),
      sourceOwnerID:
        Number(options.sourceOwnerID) ||
        this._getDogmaInventoryOwnerID(
          session,
          Number(options.ammoLocationID) || Number(moduleItem.locationID) || 0,
        ),
      chargeTypeID: Number(options.chargeTypeID) || 0,
      ammoLocationID: Number(options.ammoLocationID) || 0,
      sourceFlagID: Number(options.sourceFlagID) || ITEM_FLAGS.CARGO_HOLD,
      sourceItemIDs: normalizeReloadSourceItemIDs(options.sourceItemIDs),
      destinationLocationID: Number(options.destinationLocationID) || 0,
      destinationFlagID: Number(options.destinationFlagID) || 0,
      quantity:
        options.quantity === undefined || options.quantity === null
          ? null
          : Math.max(1, Number(options.quantity) || 0),
      reloadTimeMs,
      startedAtMs,
      completeAtMs,
      systemID: Number(session && session._space && session._space.systemID) || 0,
      session,
    };
    pendingModuleReloads.set(numericModuleID, reloadState);
    schedulePendingModuleReloadPump();
    const nextActivationTime = toFileTimeFromMs(completeAtMs, 0n);
    this._notifyModuleNextActivationTime(session, numericModuleID, nextActivationTime, 0n);
    if (reloadState.chargeTypeID > 0) {
      this._notifyChargeBeingLoadedToModule(
        session,
        [numericModuleID],
        reloadState.chargeTypeID,
        reloadTimeMs,
      );
    }
    return {
      success: true,
      data: {
        reloadState,
      },
    };
  }
  queueAutomaticModuleReload(session, moduleItem, options = {}) {
    const normalizedModuleItem = moduleItem || null;
    const numericModuleID = Number(normalizedModuleItem && normalizedModuleItem.itemID) || 0;
    if (numericModuleID <= 0) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const shipID =
      Number(options.shipID) ||
      Number(normalizedModuleItem.locationID) ||
      this._getShipID(session);
    const charID = this._getCharID(session);
    if (shipID <= 0 || charID <= 0) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }
    const chargeTypeID = Number(options.chargeTypeID) || 0;
    if (chargeTypeID <= 0) {
      return {
        success: false,
        errorMsg: "NO_AMMO",
      };
    }
    if (!isChargeCompatibleWithModule(normalizedModuleItem.typeID, chargeTypeID)) {
      return {
        success: false,
        errorMsg: "INCOMPATIBLE_AMMO",
      };
    }
    const ammoLocationID = Number(options.ammoLocationID) || shipID;
    const sourceFlagID = Number(options.sourceFlagID) || ITEM_FLAGS.CARGO_HOLD;
    const inventoryOwnerID = this._getDogmaInventoryOwnerID(session, shipID);
    const sourceOwnerID = this._getDogmaInventoryOwnerID(session, ammoLocationID);
    const sourceStacks = this._resolvePendingReloadSourceStacks(
      sourceOwnerID,
      ammoLocationID,
      sourceFlagID,
      chargeTypeID,
      options.sourceItemIDs,
    );
    if (sourceStacks.length === 0) {
      return {
        success: false,
        errorMsg: "NO_AMMO",
      };
    }
    const requestedQuantity =
      options.quantity === undefined || options.quantity === null
        ? getModuleChargeCapacity(normalizedModuleItem.typeID, chargeTypeID)
        : Math.max(1, Number(options.quantity) || 0);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      return {
        success: false,
        errorMsg: "NO_AMMO",
      };
    }
    return this._queuePendingModuleReload(session, normalizedModuleItem, {
      action: "load",
      shipID,
      chargeTypeID,
      ammoLocationID,
      sourceFlagID,
      inventoryOwnerID,
      sourceOwnerID,
      sourceItemIDs: sourceStacks.map((item) => item.itemID),
      reloadTimeMs:
        Number(options.reloadTimeMs) || this._getModuleReloadTimeMs(normalizedModuleItem),
      quantity: requestedQuantity,
    });
  }
  _completePendingModuleReload(
    reloadState,
    nowMs = getReloadStateCurrentTimeMs(reloadState, Date.now()),
  ) {
    if (!reloadState) {
      return {
        success: false,
        errorMsg: "RELOAD_NOT_FOUND",
      };
    }
    const numericModuleID = Number(reloadState.moduleID) || 0;
    if (numericModuleID > 0) {
      pendingModuleReloads.delete(numericModuleID);
    }
    schedulePendingModuleReloadPump();
    const session =
      reloadState.session &&
      reloadState.session.socket &&
      !reloadState.session.socket.destroyed
        ? reloadState.session
        : reloadState.session || null;
    const moduleItem = findItemById(numericModuleID);
    const charID = Number(reloadState.charID) || 0;
    const inventoryOwnerID =
      Number(reloadState.inventoryOwnerID) ||
      this._getDogmaInventoryOwnerID(session, reloadState.shipID) ||
      charID;
    const sourceOwnerID =
      Number(reloadState.sourceOwnerID) ||
      this._getDogmaInventoryOwnerID(session, reloadState.ammoLocationID) ||
      inventoryOwnerID;
    const shipID = Number(reloadState.shipID) || 0;
    const moduleFlagID = Number(reloadState.moduleFlagID) || 0;
    const previousNextActivationTime = toFileTimeFromMs(
      Number(reloadState.completeAtMs) || nowMs,
      0n,
    );
    if (
      !moduleItem ||
      Number(moduleItem.ownerID) !== inventoryOwnerID ||
      Number(moduleItem.locationID) !== shipID ||
      Number(moduleItem.flagID) !== moduleFlagID
    ) {
      this._notifyModuleNextActivationTime(session, numericModuleID, 0n, previousNextActivationTime);
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const previousChargeState = this._captureChargeStateSnapshot(
      inventoryOwnerID,
      shipID,
      moduleFlagID,
    );
    const previousChargeItem = this._captureChargeItemSnapshot(
      inventoryOwnerID,
      shipID,
      moduleFlagID,
    );
    try {
      if (reloadState.action === "load") {
        let existingCharge = getLoadedChargeByFlag(inventoryOwnerID, shipID, moduleFlagID);
        let activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
        const chargeTypeID = Number(reloadState.chargeTypeID) || 0;
        if (
          chargeTypeID > 0 &&
          isChargeCompatibleWithModule(moduleItem.typeID, chargeTypeID)
        ) {
          const sourceStacks = this._resolvePendingReloadSourceStacks(
            sourceOwnerID,
            reloadState.ammoLocationID,
            reloadState.sourceFlagID,
            chargeTypeID,
            reloadState.sourceItemIDs,
          );
          if (
            sourceStacks.length > 0 ||
            (existingCharge && activeChargeTypeID === chargeTypeID)
          ) {
            if (existingCharge && activeChargeTypeID !== chargeTypeID) {
              const unloadResult = this._moveLoadedChargeToDestination(
                existingCharge,
                reloadState.ammoLocationID,
                reloadState.sourceFlagID,
              );
              if (unloadResult.success) {
                this._syncInventoryChanges(session, unloadResult.data.changes);
              }
              existingCharge = null;
              activeChargeTypeID = 0;
            }
            const moduleCapacity = getModuleChargeCapacity(moduleItem.typeID, chargeTypeID);
            const existingQuantity = existingCharge
              ? Number(existingCharge.stacksize || existingCharge.quantity || 0) || 0
              : 0;
            let neededQuantity = Math.max(0, moduleCapacity - existingQuantity);
            for (const sourceCharge of sourceStacks) {
              if (neededQuantity <= 0) {
                break;
              }
              const chargeItem = findItemById(sourceCharge.itemID);
              if (
                !chargeItem ||
                Number(chargeItem.ownerID) !== sourceOwnerID ||
                Number(chargeItem.locationID) !== Number(reloadState.ammoLocationID) ||
                Number(chargeItem.flagID) !== Number(reloadState.sourceFlagID) ||
                Number(chargeItem.typeID) !== chargeTypeID
              ) {
                continue;
              }
              const availableQuantity = Number(chargeItem.stacksize || chargeItem.quantity || 0) || 0;
              if (availableQuantity <= 0) {
                continue;
              }
              const moveQuantity = Math.min(neededQuantity, availableQuantity);
              const moveResult =
                existingCharge && activeChargeTypeID === chargeTypeID
                  ? mergeItemStacks(
                    chargeItem.itemID,
                    existingCharge.itemID,
                    moveQuantity,
                  )
                  : moveItemToLocation(
                    chargeItem.itemID,
                    shipID,
                    moduleFlagID,
                    moveQuantity,
                  );
              if (!moveResult.success) {
                continue;
              }
              this._syncInventoryChanges(session, moveResult.data.changes);
              neededQuantity -= moveQuantity;
              if (existingCharge && activeChargeTypeID === chargeTypeID) {
                existingCharge = findItemById(existingCharge.itemID) || existingCharge;
              } else if (!existingCharge) {
                existingCharge = getLoadedChargeByFlag(
                  inventoryOwnerID,
                  shipID,
                  moduleFlagID,
                );
                activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
              }
            }
          }
        }
      }
    } finally {
      const nextChargeState = this._captureChargeStateSnapshot(
        inventoryOwnerID,
        shipID,
        moduleFlagID,
      );
      const nextChargeItem = this._captureChargeItemSnapshot(
        inventoryOwnerID,
        shipID,
        moduleFlagID,
      );
      this._notifyChargeQuantityTransition(
        session,
        charID,
        shipID,
        moduleFlagID,
        previousChargeState,
        nextChargeState,
        {
          previousChargeItem,
          nextChargeItem,
        },
      );
      this._notifyWeaponModuleAttributeTransition(
        session,
        moduleItem,
        previousChargeItem,
        nextChargeItem,
      );
      this._refreshScannerProbeLauncherClientState(
        session,
        shipID,
        moduleItem,
        {
          forceRuntimeSync: true,
        },
      );
      this._notifyModuleNextActivationTime(
        session,
        numericModuleID,
        0n,
        previousNextActivationTime,
      );
    }
    return {
      success: true,
      data: {
        moduleID: numericModuleID,
      },
    };
  }
  Handle_Activate(args, session) {
    const requestedItemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const effectName = this._normalizeActivationEffectName(
      args && args.length > 1 ? args[1] : "",
    );
    const targetID = args && args.length > 2 ? args[2] : null;
    const repeat = args && args.length > 3 ? args[3] : null;
    const requestedItem = findItemById(requestedItemID);
    const groupedMasterModuleID =
      requestedItem &&
      Number(requestedItem.categoryID) === 7
        ? getWeaponBankMasterModuleID(
          Number(requestedItem.locationID) || this._getShipID(session),
          requestedItemID,
        )
        : 0;
    const itemID = groupedMasterModuleID || requestedItemID;
    const item = groupedMasterModuleID > 0
      ? findItemById(itemID)
      : requestedItem;
    log.debug(
      `[DogmaIM] Activate(itemID=${itemID}, effect=${effectName}, target=${String(targetID)}, repeat=${String(repeat)}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    if (effectName === "online") {
      const shipID = Number(item && item.locationID) || this._getShipID(session);
      const result = this._setModuleOnlineState(shipID, itemID, true, session);
      if (!result.success) {
        log.warn(
          `[DogmaIM] Activate online rejected itemID=${itemID} shipID=${shipID} error=${result.errorMsg}`,
        );
        this._throwModuleOnlineUserError(result.errorMsg, item, result.data);
      }
      return 1;
    }
    if (!item || !isEffectivelyOnlineModule(item)) {
      log.warn(
        `[DogmaIM] Activate rejected itemID=${itemID} effect=${effectName} error=MODULE_NOT_ONLINE`,
      );
      this._throwModuleActivationUserError("MODULE_NOT_ONLINE", {
        session,
        moduleItem: item || requestedItem,
        effectName,
      });
    }
    // Propulsion modules (AB/MWD) use the dedicated propulsion path which
    // applies speed/mass bonuses.  All other activatable modules use the
    // generic path that provides cycle timing for the HUD radial ring.
    const isPropulsion =
      effectName === "moduleBonusAfterburner" ||
      effectName === "moduleBonusMicrowarpdrive";
    const isProbeLauncherActivation =
      effectName === "useMissiles" &&
      item &&
      Number(item.groupID) === GROUP_SCAN_PROBE_LAUNCHER;
    const isInterdictionProbeLauncherActivation =
      effectName === "useMissiles" &&
      item &&
      Number(item.groupID) === GROUP_INTERDICTION_SPHERE_LAUNCHER;
    const isWarpDisruptFieldGeneratorActivation =
      item &&
      Number(item.groupID) === GROUP_WARP_DISRUPT_FIELD_GENERATOR &&
      warpDisruptFieldGeneratorRuntime.isWarpDisruptFieldGeneratorActivation(
        item,
        effectName,
      );
    const isAnalyzerActivation = this._isAnalyzerModuleActivation(item, effectName);
    const probeLaunchContext = isProbeLauncherActivation
      ? this._resolveValidatedProbeLaunchContext(session, itemID, 1)
      : null;
    const interdictionProbeLaunchContext = isInterdictionProbeLauncherActivation
      ? this._resolveValidatedInterdictionProbeLaunchContext(session, itemID)
      : null;
    if (isWarpDisruptFieldGeneratorActivation) {
      this._resolveValidatedWarpDisruptFieldGeneratorContext(session, item);
    }
    const analyzerHackingContext = isAnalyzerActivation
      ? this._resolveAnalyzerHackingContext(session, item, targetID)
      : null;
    if (analyzerHackingContext && analyzerHackingContext.success !== true) {
      log.debug(
        `[DogmaIM] Activate analyzer rejected itemID=${itemID} target=${String(targetID)} ` +
        `error=${analyzerHackingContext.errorMsg}`,
      );
      this._throwModuleActivationUserError(analyzerHackingContext.errorMsg, {
        session,
        moduleItem: item || requestedItem,
        targetID,
        effectName,
      });
    }
    if (isProbeLauncherActivation) {
      this._refreshScannerProbeLauncherClientState(
        session,
        Number(item && item.locationID) || this._getShipID(session),
        item,
        {
          forceRuntimeSync: true,
        },
      );
    }
    const activationRepeat =
      isProbeLauncherActivation ||
      isInterdictionProbeLauncherActivation ||
      isAnalyzerActivation
        ? 1
        : repeat;
    const result = isPropulsion
      ? spaceRuntime.activatePropulsionModule(session, item, effectName, {
          targetID,
          repeat: activationRepeat,
        })
      : spaceRuntime.activateGenericModule(session, item, effectName, {
          targetID,
          repeat: activationRepeat,
        });
    if (!result.success) {
      log.warn(
        `[DogmaIM] Activate rejected itemID=${itemID} effect=${effectName} error=${result.errorMsg}`,
      );
      this._throwModuleActivationUserError(result.errorMsg, {
        session,
        moduleItem: item || requestedItem,
        targetID,
        effectName,
      });
    }
    if (isProbeLauncherActivation) {
      if (result && result.data && result.data.effectState) {
        // CCP parity: scan-probe launchers are still a one-shot server cycle,
        // but the client button/radial behaves much better when the wire
        // contract stays on the launcher's normal repeatable cycle shape.
        // Keep the server-side auto-stop, but do not collapse the live client
        // effect row down to repeat=0.
        result.data.effectState.autoDeactivateAtCycleEnd = true;
        result.data.effectState.repeat = 1;
        result.data.effectState.stopReason = "cycle";
      }
      try {
        const launchResult = this._launchProbesFromContext(session, probeLaunchContext);
        if (
          result &&
          result.data &&
          result.data.effectState &&
          launchResult &&
          launchResult.autoReloadRecommended === true &&
          Number(launchResult.chargeTypeID) > 0
        ) {
          result.data.effectState.autoReloadOnCycleEnd = {
            chargeTypeID: Number(launchResult.chargeTypeID) || 0,
            reloadTimeMs: this._getModuleReloadTimeMs(item),
            ammoLocationID:
              Number(item && item.locationID) || this._getShipID(session),
          };
        }
        this._refreshScannerProbeLauncherClientState(
          session,
          Number(item && item.locationID) || this._getShipID(session),
          item,
          {
            forceRuntimeSync: true,
          },
        );
      } catch (error) {
        spaceRuntime.deactivateGenericModule(session, itemID, {
          reason: "probe-launch-failed",
        });
        throw error;
      }
    }
    if (isInterdictionProbeLauncherActivation) {
      if (result && result.data && result.data.effectState) {
        result.data.effectState.autoDeactivateAtCycleEnd = true;
        result.data.effectState.repeat = 1;
        result.data.effectState.stopReason = "cycle";
      }
      try {
        const launchResult = this._launchInterdictionProbeFromContext(
          session,
          interdictionProbeLaunchContext,
        );
        if (
          result &&
          result.data &&
          result.data.effectState &&
          launchResult &&
          launchResult.autoReloadRecommended === true &&
          Number(launchResult.chargeTypeID) > 0
        ) {
          result.data.effectState.autoReloadOnCycleEnd = {
            chargeTypeID: Number(launchResult.chargeTypeID) || 0,
            reloadTimeMs: this._getModuleReloadTimeMs(item),
            ammoLocationID:
              Number(item && item.locationID) || this._getShipID(session),
          };
        }
      } catch (error) {
        spaceRuntime.deactivateGenericModule(session, itemID, {
          reason: "interdiction-probe-launch-failed",
        });
        throw error;
      }
    }
    if (isAnalyzerActivation && analyzerHackingContext && analyzerHackingContext.success === true) {
      const contextData = analyzerHackingContext.data || {};
      try {
        const hackingMgr = new HackingMgrService();
        hackingMgr.Handle_StartNewGameInstance(
          [
            contextData.targetID,
            contextData.gameType,
            contextData.moduleTypeID,
            contextData.difficulty,
            contextData.coherence,
            contextData.strength,
            contextData.slots,
          ],
          session,
        );
        if (result && result.data && result.data.effectState) {
          result.data.effectState.autoDeactivateAtCycleEnd = true;
          result.data.effectState.repeat = 1;
          result.data.effectState.stopReason = "cycle";
        }
      } catch (error) {
        spaceRuntime.deactivateGenericModule(session, itemID, {
          reason: "analyzer-hacking-start-failed",
        });
        throw error;
      }
    }
    log.debug(
      `[DogmaIM] Activate accepted itemID=${itemID} effect=${effectName} ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} ` +
      `runtime=${JSON.stringify(
        summarizeRuntimeEffectForLog(
          session && session._space
            ? spaceRuntime.getActiveModuleEffect(session, itemID)
            : null,
        ),
      )}`,
    );
    return 1;
  }
  Handle_Deactivate(args, session) {
    const requestedItemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const effectName = this._normalizeActivationEffectName(
      args && args.length > 1 ? args[1] : "",
    );
    const requestedItem = findItemById(requestedItemID);
    const groupedMasterModuleID =
      requestedItem &&
      Number(requestedItem.categoryID) === 7
        ? getWeaponBankMasterModuleID(
          Number(requestedItem.locationID) || this._getShipID(session),
          requestedItemID,
        )
        : 0;
    const itemID = groupedMasterModuleID || requestedItemID;
    const item = groupedMasterModuleID > 0
      ? findItemById(itemID)
      : requestedItem;
    log.debug(
      `[DogmaIM] Deactivate(itemID=${itemID}, effect=${effectName}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    if (effectName === "online") {
      const item = findItemById(itemID);
      const shipID = Number(item && item.locationID) || this._getShipID(session);
      const result = this._setModuleOnlineState(shipID, itemID, false, session);
      if (!result.success) {
        log.warn(
          `[DogmaIM] Deactivate online rejected itemID=${itemID} shipID=${shipID} error=${result.errorMsg}`,
        );
        this._throwModuleOnlineUserError(result.errorMsg, item);
      }
      return 1;
    }
    const isPropulsion =
      effectName === "moduleBonusAfterburner" ||
      effectName === "moduleBonusMicrowarpdrive";
    const result = isPropulsion
      ? spaceRuntime.deactivatePropulsionModule(session, itemID, {
          reason: "manual",
        })
      : spaceRuntime.deactivateGenericModule(session, itemID, {
          reason: "manual",
        });
    if (!result.success) {
      log.warn(
        `[DogmaIM] Deactivate rejected itemID=${itemID} effect=${effectName} error=${result.errorMsg}`,
      );
      this._throwModuleDeactivationUserError(result.errorMsg, item || requestedItem);
    }
    log.debug(
      `[DogmaIM] Deactivate accepted itemID=${itemID} effect=${effectName} ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} ` +
      `runtime=${JSON.stringify(
        summarizeRuntimeEffectForLog(
          session && session._space
            ? spaceRuntime.getActiveModuleEffect(session, itemID)
            : null,
        ),
      )}`,
    );
    return 1;
  }
  Handle_Overload(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const effectID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const item = findItemById(itemID);
    log.debug(
      `[DogmaIM] Overload(itemID=${itemID}, effectID=${effectID}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    const result = spaceRuntime.overloadModule(session, item, effectID);
    if (!result.success) {
      log.warn(
        `[DogmaIM] Overload rejected itemID=${itemID} effectID=${effectID} error=${result.errorMsg}`,
      );
      this._throwModuleOverloadUserError(result.errorMsg, item, result.data);
    }
    return itemID;
  }
  Handle_OverloadRack(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const item = findItemById(itemID);
    log.debug(
      `[DogmaIM] OverloadRack(itemID=${itemID}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    const result = spaceRuntime.overloadRack(session, item);
    if (!result.success) {
      log.warn(`[DogmaIM] OverloadRack rejected itemID=${itemID} error=${result.errorMsg}`);
      this._throwModuleOverloadUserError(result.errorMsg, item, result.data);
    }
    return result.data && Array.isArray(result.data.moduleIDs)
      ? result.data.moduleIDs
      : [];
  }
  Handle_StopOverload(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const effectID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const item = findItemById(itemID);
    log.debug(
      `[DogmaIM] StopOverload(itemID=${itemID}, effectID=${effectID}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    const result = spaceRuntime.stopOverloadModule(session, item, effectID);
    if (!result.success) {
      log.warn(
        `[DogmaIM] StopOverload rejected itemID=${itemID} effectID=${effectID} error=${result.errorMsg}`,
      );
      this._throwModuleOverloadUserError(result.errorMsg, item, result.data);
    }
    return itemID;
  }
  Handle_StopOverloadRack(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const item = findItemById(itemID);
    log.debug(
      `[DogmaIM] StopOverloadRack(itemID=${itemID}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    const result = spaceRuntime.stopOverloadRack(session, item);
    if (!result.success) {
      log.warn(`[DogmaIM] StopOverloadRack rejected itemID=${itemID} error=${result.errorMsg}`);
      this._throwModuleOverloadUserError(result.errorMsg, item, result.data);
    }
    return result.data && Array.isArray(result.data.moduleIDs)
      ? result.data.moduleIDs
      : [];
  }
  Handle_InitiateModuleRepair(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const result = this._startModuleRepair(session, itemID, {
      source: "single",
    });
    if (result.success) {
      log.debug(
        `[DogmaIM] InitiateModuleRepair accepted itemID=${itemID} ` +
        `pasteUnits=${result.data && result.data.pasteUnits || 0}`,
      );
      return true;
    }
    log.debug(
      `[DogmaIM] InitiateModuleRepair rejected itemID=${itemID} error=${result.errorMsg}`,
    );
    if (result.errorMsg === "NOT_ENOUGH_NANITE_REPAIR_PASTE") {
      throwWrappedUserError("NotEnoughRepairMaterialToFinishAllRepairs");
    }
    return false;
  }
  Handle_InitiateModuleRepairMany(args, session) {
    const moduleIDs = extractList(args && args.length > 0 ? args[0] : [])
      .map((itemID) => Number(itemID) || 0)
      .filter((itemID) => itemID > 0);
    const success = [];
    const missingCharges = [];
    const failed = [];
    for (const itemID of moduleIDs) {
      const result = this._startModuleRepair(session, itemID, {
        source: "many",
      });
      if (result.success) {
        success.push(itemID);
      } else if (result.errorMsg === "NOT_ENOUGH_NANITE_REPAIR_PASTE") {
        missingCharges.push(itemID);
      } else {
        failed.push(itemID);
      }
    }
    log.debug(
      `[DogmaIM] InitiateModuleRepairMany success=${success.length} ` +
      `missingCharges=${missingCharges.length} failed=${failed.length}`,
    );
    return [success, missingCharges, failed];
  }
  Handle_StopModuleRepair(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const result = this._finishModuleRepair(session, itemID);
    if (!result.success) {
      log.debug(
        `[DogmaIM] StopModuleRepair rejected itemID=${itemID} error=${result.errorMsg}`,
      );
      return false;
    }
    log.debug(`[DogmaIM] StopModuleRepair accepted itemID=${itemID}`);
    return true;
  }
  Handle_SetModuleOnline(args, session) {
    const shipID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const moduleID = args && args.length > 1 ? args[1] : null;
    log.debug(`[DogmaIM] SetModuleOnline(shipID=${shipID}, moduleID=${moduleID})`);
    const result = this._setModuleOnlineState(shipID, moduleID, true, session);
    if (!result.success) {
      log.debug(`[DogmaIM] SetModuleOnline rejected moduleID=${moduleID} error=${result.errorMsg}`);
      this._throwModuleOnlineUserError(
        result.errorMsg,
        findItemById(moduleID),
        result.data,
      );
    }
    return null;
  }
  Handle_TakeModuleOffline(args, session) {
    const shipID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const moduleID = args && args.length > 1 ? args[1] : null;
    log.debug(`[DogmaIM] TakeModuleOffline(shipID=${shipID}, moduleID=${moduleID})`);
    const result = this._setModuleOnlineState(shipID, moduleID, false, session);
    if (!result.success) {
      this._throwModuleOnlineUserError(result.errorMsg, findItemById(moduleID));
    }
    return null;
  }
  Handle_CreateNewbieShip(args, session) {
    const requestedShipID =
      args && args.length > 0 ? Number(args[0]) || 0 : this._getShipID(session);
    const requestedLocationID =
      args && args.length > 1 ? Number(args[1]) || 0 : this._getLocationID(session);
    const stationID = getDockedLocationID(session) || 0;
    log.info(
      `[DogmaIM] CreateNewbieShip(shipID=${requestedShipID}, locationID=${requestedLocationID})`,
    );
    if (!session || !session.characterID || !stationID) {
      throwWrappedUserError("MustBeDocked");
    }
    const boardResult = boardNewbieShipForSession(session, {
      emitNotifications: true,
      logSelection: false,
      repairExistingShip: true,
      logLabel: "CreateNewbieShip",
    });
    if (!boardResult.success) {
      if (boardResult.errorMsg === "DOCK_REQUIRED") {
        throwWrappedUserError("MustBeDocked");
      }
      if (boardResult.errorMsg === "ALREADY_IN_NEWBIE_SHIP") {
        throwWrappedUserError("AlreadyInNewbieShip");
      }
      throwWrappedUserError("ErrorCreatingNewbieShip");
    }
    return null;
  }
  Handle_LaunchProbes(args, session) {
    const moduleID = args && args.length > 0
      ? Number(args[0]) || 0
      : 0;
    const requestedCount = Math.max(
      1,
      Number(args && args.length > 1 ? args[1] : 1) || 1,
    );
    const shipID = this._getShipID(session);
    const charID = this._getCharID(session);
    const systemID = Number(
      (session && session.solarsystemid2) ||
      (session && session.solarsystemid) ||
      (session && session._space && session._space.systemID) ||
      0,
    ) || 0;
    log.info(
      `[DogmaIM] LaunchProbes(moduleID=${moduleID}, requestedCount=${requestedCount}, shipID=${shipID}, charID=${charID}, systemID=${systemID})`,
    );
    const probeLaunchContext = this._resolveValidatedProbeLaunchContext(
      session,
      moduleID,
      requestedCount,
    );
    this._launchProbesFromContext(session, probeLaunchContext);
    return null;
  }
  Handle_LoadAmmo(args, session) {
    const shipID = args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const rawModuleIDs = args && args.length > 1 ? args[1] : [];
    const rawChargeItemIDs = args && args.length > 2 ? args[2] : [];
    const rawAmmoLocationID = args && args.length > 3 ? Number(args[3]) || shipID : shipID;
    const ammoLocationID = this._resolveAmmoLocationID(rawAmmoLocationID, session, shipID);
    const charID = this._getCharID(session);
    const inventoryOwnerID = this._getDogmaInventoryOwnerID(session, shipID);
    const sourceOwnerID = this._getDogmaInventoryOwnerID(session, ammoLocationID);
    const moduleIDs = this._expandGroupedModuleIDs(shipID, rawModuleIDs);
    const chargeRequests = normalizeAmmoLoadRequests(rawChargeItemIDs);
    log.info(
      `[DogmaIM] LoadAmmo(shipID=${shipID}, modules=[${moduleIDs}], charges=[${summarizeAmmoLoadRequests(chargeRequests)}], ammoLocationID=${ammoLocationID})`,
    );
    const sourceFlagID = ammoLocationID === shipID ? ITEM_FLAGS.CARGO_HOLD : ITEM_FLAGS.HANGAR;
    for (const moduleID of moduleIDs.map((value) => Number(value) || 0).filter((value) => value > 0)) {
      const moduleItem = findItemById(moduleID);
      if (
        !moduleItem ||
        Number(moduleItem.ownerID) !== inventoryOwnerID ||
        Number(moduleItem.locationID) !== shipID
      ) {
        log.warn(
          `[DogmaIM] LoadAmmo: module ${moduleID} not found or not owned (owner=${moduleItem && moduleItem.ownerID}, loc=${moduleItem && moduleItem.locationID}, inventoryOwnerID=${inventoryOwnerID}, charID=${charID}, shipID=${shipID})`,
        );
        continue;
      }
      const previousChargeState = this._captureChargeStateSnapshot(
        inventoryOwnerID,
        shipID,
        moduleItem.flagID,
      );
      const previousChargeItem = this._captureChargeItemSnapshot(
        inventoryOwnerID,
        shipID,
        moduleItem.flagID,
      );
      try {
        let existingCharge = getLoadedChargeByFlag(
          inventoryOwnerID,
          shipID,
          moduleItem.flagID,
        );
        let activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
        let requestedChargeTypeID = this._resolveRequestedAmmoTypeID(
          sourceOwnerID,
          ammoLocationID,
          sourceFlagID,
          chargeRequests,
        );
        if (requestedChargeTypeID <= 0 && activeChargeTypeID > 0) {
          requestedChargeTypeID = activeChargeTypeID;
        }
        if (requestedChargeTypeID <= 0) {
          log.warn(
            `[DogmaIM] LoadAmmo: no valid charge found for module ${moduleID} (flag=${moduleItem.flagID}) in location ${ammoLocationID} requests=[${summarizeAmmoLoadRequests(chargeRequests)}]`,
          );
          continue;
        }
        const chargeTypeID = requestedChargeTypeID;
        if (!isChargeCompatibleWithModule(moduleItem.typeID, chargeTypeID)) {
          log.warn(
            `[DogmaIM] LoadAmmo: incompatible charge typeID=${chargeTypeID} for module ${moduleID} typeID=${moduleItem.typeID}`,
          );
          continue;
        }
        const moduleCapacity = getModuleChargeCapacity(moduleItem.typeID, chargeTypeID);
        const existingQuantity = existingCharge
          ? Number(existingCharge.stacksize || existingCharge.quantity || 0) || 0
          : 0;
        const resolvedChargeSources = this._resolveAmmoSourceStacks(
          sourceOwnerID,
          ammoLocationID,
          sourceFlagID,
          chargeTypeID,
          chargeRequests,
        );
        if (
          session &&
          session._space &&
          this._getModuleReloadTimeMs(moduleItem) > 0
        ) {
          if (
            existingCharge &&
            activeChargeTypeID === chargeTypeID &&
            existingQuantity >= moduleCapacity
          ) {
            continue;
          }
          if (
            resolvedChargeSources.length === 0 &&
            !(existingCharge && activeChargeTypeID === chargeTypeID)
          ) {
            log.warn(
              `[DogmaIM] LoadAmmo: no source stacks resolved for reload module ${moduleID} typeID=${chargeTypeID} in location ${ammoLocationID}`,
            );
            continue;
          }
          this._queuePendingModuleReload(session, moduleItem, {
            action: "load",
            shipID,
            chargeTypeID,
            ammoLocationID,
            sourceFlagID,
            inventoryOwnerID,
            sourceOwnerID,
            sourceItemIDs: resolvedChargeSources.map((item) => item.itemID),
            reloadTimeMs: this._getModuleReloadTimeMs(moduleItem),
          });
          continue;
        }
        if (existingCharge && activeChargeTypeID !== chargeTypeID) {
          const unloadResult = this._moveLoadedChargeToDestination(
            existingCharge,
            ammoLocationID,
            sourceFlagID,
          );
          if (unloadResult.success) {
            this._syncInventoryChanges(session, unloadResult.data.changes);
          }
          existingCharge = null;
          activeChargeTypeID = 0;
        }
        // Re-read current charge state after potential unload so that modules
        // with capacity 1 (crystals, lenses, scripts) correctly compute the
        // needed quantity instead of using the stale pre-unload count.
        const currentChargeQuantity = existingCharge
          ? Number(existingCharge.stacksize || existingCharge.quantity || 0) || 0
          : 0;
        let neededQuantity = Math.max(0, moduleCapacity - currentChargeQuantity);
        if (neededQuantity <= 0) {
          continue;
        }
        if (resolvedChargeSources.length === 0) {
          log.warn(
            `[DogmaIM] LoadAmmo: no source stacks resolved for module ${moduleID} typeID=${chargeTypeID} in location ${ammoLocationID}`,
          );
          continue;
        }
        for (const sourceCharge of resolvedChargeSources) {
          if (neededQuantity <= 0) {
            break;
          }
          const chargeItem = findItemById(sourceCharge.itemID);
          if (
            !chargeItem ||
            Number(chargeItem.ownerID) !== sourceOwnerID ||
            Number(chargeItem.flagID) !== sourceFlagID ||
            Number(chargeItem.locationID) !== ammoLocationID ||
            Number(chargeItem.typeID) !== chargeTypeID
          ) {
            continue;
          }
          const availableQuantity = Number(chargeItem.stacksize || chargeItem.quantity || 0) || 0;
          if (availableQuantity <= 0) {
            continue;
          }
          const moveQuantity = Math.min(neededQuantity, availableQuantity);
          const moveResult =
            existingCharge && activeChargeTypeID === chargeTypeID
              ? mergeItemStacks(
                chargeItem.itemID,
                existingCharge.itemID,
                moveQuantity,
              )
              : moveItemToLocation(
                chargeItem.itemID,
                shipID,
                moduleItem.flagID,
                moveQuantity,
              );
          if (!moveResult.success) {
            log.warn(
              `[DogmaIM] LoadAmmo: move failed for charge ${chargeItem.itemID} -> module flag ${moduleItem.flagID}: ${moveResult.errorMsg}`,
            );
            continue;
          }
          log.info(
            `[DogmaIM] LoadAmmo: loaded ${moveQuantity}x typeID=${chargeTypeID} into module ${moduleID} (flag=${moduleItem.flagID})`,
          );
          neededQuantity -= moveQuantity;
          this._syncInventoryChanges(session, moveResult.data.changes);
          if (existingCharge && activeChargeTypeID === chargeTypeID) {
            existingCharge = findItemById(existingCharge.itemID) || existingCharge;
          } else if (!existingCharge) {
            existingCharge = getLoadedChargeByFlag(
              inventoryOwnerID,
              shipID,
              moduleItem.flagID,
            );
            activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
          }
        }
      } finally {
        const nextChargeState = this._captureChargeStateSnapshot(
          inventoryOwnerID,
          shipID,
          moduleItem.flagID,
        );
        const nextChargeItem = this._captureChargeItemSnapshot(
          inventoryOwnerID,
          shipID,
          moduleItem.flagID,
        );
        this._notifyChargeQuantityTransition(
          session,
          charID,
          shipID,
          moduleItem.flagID,
          previousChargeState,
          nextChargeState,
          {
            previousChargeItem,
            nextChargeItem,
          },
        );
        this._notifyWeaponModuleAttributeTransition(
          session,
          moduleItem,
          previousChargeItem,
          nextChargeItem,
        );
        const shouldForceScannerProbeRuntimeSync =
          session &&
          session._space &&
          Number(moduleItem && moduleItem.groupID) === GROUP_SCAN_PROBE_LAUNCHER;
        this._refreshScannerProbeLauncherClientState(
          session,
          shipID,
          moduleItem,
          {
            forceRuntimeSync: shouldForceScannerProbeRuntimeSync,
          },
        );
      }
    }
    return null;
  }
  Handle_UnloadAmmo(args, session) {
    const shipID = args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const rawModuleIDs = args && args.length > 1 ? args[1] : [];
    const destination = args && args.length > 2 ? args[2] : shipID;
    const quantity = args && args.length > 3 ? Number(args[3]) || null : null;
    const charID = this._getCharID(session);
    const inventoryOwnerID = this._getDogmaInventoryOwnerID(session, shipID);
    const unloadTargets = this._buildGroupedUnloadTargets(
      inventoryOwnerID,
      shipID,
      rawModuleIDs,
      quantity,
    );
    const resolvedDestination = this._resolveUnloadDestination(destination, session, shipID);
    log.debug(
      `[DogmaIM] UnloadAmmo(shipID=${shipID}, moduleCount=${unloadTargets.length}, destination=${JSON.stringify(resolvedDestination)})`,
    );
    for (const unloadTarget of unloadTargets) {
      const moduleID = Number(unloadTarget && unloadTarget.moduleID) || 0;
      if (moduleID <= 0) {
        continue;
      }
      const moduleItem = findItemById(moduleID);
      if (
        !moduleItem ||
        Number(moduleItem.ownerID) !== inventoryOwnerID ||
        Number(moduleItem.locationID) !== shipID
      ) {
        continue;
      }
      if (typeHasEffectName(moduleItem.typeID, "rigSlot")) {
        log.debug(
          `[DogmaIM] UnloadAmmo skipping rig module moduleID=${moduleID} typeID=${moduleItem.typeID} — rigs cannot be unloaded`,
        );
        continue;
      }
      const chargeItem = getLoadedChargeByFlag(
        inventoryOwnerID,
        shipID,
        moduleItem.flagID,
      );
      if (!chargeItem) {
        continue;
      }
      const previousChargeState = this._captureChargeStateSnapshot(
        inventoryOwnerID,
        shipID,
        moduleItem.flagID,
      );
      const previousChargeItem = this._captureChargeItemSnapshot(
        inventoryOwnerID,
        shipID,
        moduleItem.flagID,
      );
      try {
        const unloadResult = this._moveLoadedChargeToDestination(
          chargeItem,
          resolvedDestination.locationID,
          resolvedDestination.flagID,
          unloadTarget.quantity,
        );
        if (!unloadResult.success) {
          continue;
        }
        this._syncInventoryChanges(session, unloadResult.data.changes);
      } finally {
        const nextChargeState = this._captureChargeStateSnapshot(
          inventoryOwnerID,
          shipID,
          moduleItem.flagID,
        );
        const nextChargeItem = this._captureChargeItemSnapshot(
          inventoryOwnerID,
          shipID,
          moduleItem.flagID,
        );
        this._notifyChargeQuantityTransition(
          session,
          charID,
          shipID,
          moduleItem.flagID,
          previousChargeState,
          nextChargeState,
          {
            previousChargeItem,
            nextChargeItem,
          },
        );
        this._notifyWeaponModuleAttributeTransition(
          session,
          moduleItem,
          previousChargeItem,
          nextChargeItem,
        );
        const shouldForceScannerProbeRuntimeSync =
          session &&
          session._space &&
          Number(moduleItem && moduleItem.groupID) === GROUP_SCAN_PROBE_LAUNCHER;
        this._refreshScannerProbeLauncherClientState(
          session,
          shipID,
          moduleItem,
          {
            forceRuntimeSync: shouldForceScannerProbeRuntimeSync,
          },
        );
      }
    }
    return null;
  }
  Handle_GetAllInfo(args, session) {
    log.debug("[DogmaIM] GetAllInfo");
    const startedAtMs = Date.now();
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const shipContext = this._getCurrentDogmaShipContext(session);
    const shipID = shipContext.shipID;
    const shipMetadata = shipContext.shipMetadata;
    if (shipContext.controllingStructure) {
      const syncResult = syncStructureServiceModuleState(shipID);
      if (!syncResult || syncResult.success !== true) {
        log.warn(
          `[DogmaIM] GetAllInfo structure service sync failed structure=${shipID} error=${syncResult && syncResult.errorMsg || "UNKNOWN"}`,
        );
      } else if (
        Array.isArray(syncResult.fuelCycleChanges) &&
        syncResult.fuelCycleChanges.length > 0
      ) {
        this._syncInventoryChanges(session, syncResult.fuelCycleChanges);
      }
    }
    const ownerID = charID;
    const locationID = this._getLocationID(session);
    const getCharInfo = this._toBoolArg(args && args[0], true);
    const getShipInfo = this._toBoolArg(args && args[1], true);
    const getStructureInfo = this._toBoolArg(
      args && args[2],
      Boolean(session && (session.structureid || session.structureID)),
    );
    let fittingContext = null;
    const getFittingContext = () => {
      if (!getShipInfo) {
        return null;
      }
      if (!fittingContext) {
        fittingContext = this._buildFittingHydrationContext(
          charID,
          shipID,
          shipMetadata,
          {
            includeAllFittingOwners: shipContext.controllingStructure,
          },
        );
      }
      return fittingContext;
    };
    if (getShipInfo && !shipContext.controllingStructure) {
      const fittingParityResult = ensureShipFittingInventoryParity(
        charID,
        shipContext.shipRecord || shipID,
        {
          logFailures: true,
        },
      );
      if (
        fittingParityResult &&
        fittingParityResult.data &&
        Array.isArray(fittingParityResult.data.changes) &&
        fittingParityResult.data.changes.length > 0
      ) {
        invalidateShipFittingSnapshot(charID, shipID, {
          shipItem: shipContext.shipRecord || shipMetadata,
        });
        this._syncInventoryChanges(session, fittingParityResult.data.changes, {
          fittingContext: getFittingContext(),
        });
      }
    }
    fittingContext = getFittingContext();
    const includeDockedShipInfoBootstrap =
      getShipInfo &&
      !getCharInfo &&
      isDockedSession(session);
    const includeOptionalDogmaBootstrap =
      getShipInfo && (
        getCharInfo ||
        getStructureInfo ||
        shipContext.controllingStructure ||
        includeDockedShipInfoBootstrap
      );
    const includeDockedCharInfo = includeDockedShipInfoBootstrap;
    const includeCharInfo = getCharInfo || includeDockedCharInfo;
    const deferLoginShipFittingBootstrap =
      getShipInfo && this._shouldDeferLoginShipFittingBootstrap(session);
    const primeLoginShipInfoChargeSublocations =
      getShipInfo && this._shouldPrimeLoginShipInfoChargeSublocations(session, {
        controllingStructure: shipContext.controllingStructure,
      });
    const includeLoginShipInfoLoadedCharges =
      getShipInfo && this._shouldIncludeLoginShipInfoLoadedCharges(session);
    const includeShipModifiedCharAttribs =
      getShipInfo && getCharInfo && !primeLoginShipInfoChargeSublocations;
    const characterLocationID = this._getCharacterItemLocationID(session, {
      allowShipLocation: getShipInfo,
    });
    const resolvedShipLocationID = this._resolveActiveShipLocationID(
      session,
      shipMetadata,
      locationID,
    );
    const resolvedShipFlagID = this._resolveActiveShipFlagID(
      session,
      shipMetadata,
      4,
    );
    const locationInfo = this._buildEmptyDict();
    const getAllInfoLocationInfo =
      getCharInfo && getShipInfo && !primeLoginShipInfoChargeSublocations
        ? locationInfo
        : null;
    const dockedStructureRecord = getStructureInfo
      ? this._getDockedStructureRecord(session)
      : null;
    const shipInfoEntry = getShipInfo
      ? (
        this._getCachedDockedItemInfoEntry(session, shipID, shipMetadata) ||
        this._buildCommonGetInfoEntry({
          itemID: shipID,
          typeID: shipMetadata.typeID,
          ownerID: shipMetadata.ownerID || ownerID,
          locationID: resolvedShipLocationID,
          flagID: resolvedShipFlagID,
          groupID: shipMetadata.groupID,
          categoryID: shipMetadata.categoryID,
          quantity:
            shipMetadata.quantity === undefined ||
            shipMetadata.quantity === null
              ? -1
              : shipMetadata.quantity,
          singleton:
            shipMetadata.singleton === undefined ||
            shipMetadata.singleton === null
              ? 1
              : shipMetadata.singleton,
          stacksize:
            shipMetadata.stacksize === undefined ||
            shipMetadata.stacksize === null
              ? 1
              : shipMetadata.stacksize,
          customInfo: shipMetadata.customInfo || "",
          description: shipContext.controllingStructure ? "structure" : "ship",
          attributes: shipContext.controllingStructure
            ? this._buildInventoryItemAttributeDict(shipMetadata, session, {
                fittingContext,
              })
            : this._buildShipAttributeDict(charData, shipMetadata, session, {
                fittingContext,
              }),
          session,
        })
      )
      : null;
    if (getShipInfo && shipInfoEntry) {
      this._cacheDockedItemInfoEntry(session, shipID, shipMetadata, shipInfoEntry);
    }
    const shipInventoryInfoEntries = getShipInfo
      ? this._buildShipInventoryInfoEntries(
          charID,
          shipID,
          shipMetadata.ownerID || ownerID,
          resolvedShipLocationID,
          session,
          {
            includeFittedItems: !deferLoginShipFittingBootstrap,
            includeLoadedCharges:
              shipContext.controllingStructure || includeLoginShipInfoLoadedCharges,
            includeChargeSublocations: primeLoginShipInfoChargeSublocations,
            includeAllFittingOwners: shipContext.controllingStructure,
            fittingContext,
          },
        )
      : [];
    const shipInfoTupleChargeEntries = shipInventoryInfoEntries.filter(
      (entry) => Array.isArray(Array.isArray(entry) ? entry[0] : null),
    ).length;
    if (primeLoginShipInfoChargeSublocations && shipInfoTupleChargeEntries > 0) {
      this._queuePostGetAllInfoChargeQuantityRefresh(session, charID, shipID, {
        includeAllFittingOwners: shipContext.controllingStructure,
        fittingContext,
      });
    } else if (session && session._space) {
      delete session._space.pendingDogmaGetAllInfoChargeQuantityRefresh;
    }
    log.debug(
      `[DogmaIM] GetAllInfo shipInfo entries=${shipInventoryInfoEntries.length} ` +
      `tupleCharges=${shipInfoTupleChargeEntries} ` +
      `loadedCharges=${includeLoginShipInfoLoadedCharges ? 1 : 0} ` +
      `deferredFitting=${deferLoginShipFittingBootstrap ? 1 : 0} ` +
      `loginTuplePrime=${primeLoginShipInfoChargeSublocations ? 1 : 0} ` +
      `docked=${isDockedSession(session) ? 1 : 0}`,
    );
    // The live V24.01 client's util.KeyVal RAISES AttributeError on any MISSING top-level
    // GetAllInfo key. On undock, godma.ProcessAllInfo reads `allInfo.charInfo` and
    // MakeShipActive reads `allInfo.shipState`; an omitted key throws and the entire undock
    // dogma pass dies (no module cycling, no own-ship damage). Golden captures OMIT
    // activeShipID/shipState on the (False,True,None) undock call, but THIS client needs the
    // keys PRESENT. Keep them present with null values when the optional bootstrap is off — a
    // null shipState drives the client's own Board/cached reconstruction, same net result as
    // golden. DO NOT omit these to "match golden"; it re-breaks undock (regressed by d525d116
    // "Match golden protocol return payloads").
    const optionalDogmaBootstrapEntries = [
      ["activeShipID", shipID],
      [
        "shipState",
        includeOptionalDogmaBootstrap
          ? this._buildActivationState(charID, shipID, shipContext.shipRecord, {
              includeFittedItems: !deferLoginShipFittingBootstrap,
              includeAllFittingOwners: shipContext.controllingStructure,
              fittingContext,
              includeCharges:
                shipContext.controllingStructure || isDockedSession(session)
                  ? false
                  : true,
            })
          : null,
      ],
    ];
    const result = {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ...optionalDogmaBootstrapEntries,
          ["locationInfo", getAllInfoLocationInfo],
          [
            "shipModifiedCharAttribs",
            includeShipModifiedCharAttribs
              ? this._buildShipModifiedCharacterAttributeInfo(
                  charID,
                  charData,
                  characterLocationID,
                  session,
                  {
                    fittingContext,
                  },
                )
              : null,
          ],
          // MUST stay a PRESENT key (see optionalDogmaBootstrapEntries note above): the
          // client reads `allInfo.charInfo` in godma.ProcessAllInfo on undock and its KeyVal
          // raises AttributeError if the key is absent, crashing the whole dogma pass. Golden
          // omits charInfo on undock but this client requires it present; null when not
          // populated. DO NOT drop this key to match golden (regressed by d525d116).
          [
            "charInfo",
            includeCharInfo
              ? [
                  this._buildCharacterInfoDict(
                    charID,
                    charData,
                    characterLocationID,
                  ),
                  // The client seeds charBrain exclusively from charInfo, and without it
                  // docked MakeShipActive later crashes in RemoveBrainEffects while switching ships.
                  this._buildCharacterBrain(charID, session),
                ]
              : null,
          ],
          [
            "shipInfo",
            getShipInfo
              ? {
                  type: "dict",
                  entries: [[shipID, shipInfoEntry], ...shipInventoryInfoEntries],
                }
              : this._buildEmptyDict(),
          ],
          [
            "systemWideEffectsOnShip",
            buildSystemWideEffectsPayloadForSystem(
              Number(session && (session.solarsystemid2 || session.solarsystemid)) || 0,
            ) || buildEmptySystemWideEffectsPayload(),
          ],
          [
            "structureInfo",
            dockedStructureRecord
              ? this._buildStructureInfoDict(dockedStructureRecord, session)
              : this._buildEmptyDict(),
          ],
        ],
      },
    };
    const elapsedMs = Date.now() - startedAtMs;
    const shipState = getShipInfo
      ? result.args.entries.find((entry) => entry[0] === "shipState")?.[1]
      : null;
    const shipStateEntries =
      shipState && Array.isArray(shipState) && shipState[0] && shipState[0].type === "dict"
        ? shipState[0].entries.length
        : 0;
    const chargeStateEntries =
      shipState && Array.isArray(shipState) && shipState[1] && shipState[1].type === "dict"
        ? shipState[1].entries.length
        : 0;
    recordSpaceBootstrapTrace(session, "dogma-get-all-info", {
      charID,
      shipID,
      elapsedMs,
      getCharInfo,
      getShipInfo,
      includeCharInfo,
      includeDockedCharInfo,
      shipInfoEntries: 1 + shipInventoryInfoEntries.length,
      shipStateEntries,
      chargeStateEntries,
      tupleCharges: shipInfoTupleChargeEntries,
      loadedCharges: includeLoginShipInfoLoadedCharges === true,
      deferredFitting: deferLoginShipFittingBootstrap === true,
      loginTuplePrime: primeLoginShipInfoChargeSublocations === true,
      docked: isDockedSession(session) === true,
    });
    if (elapsedMs >= 100) {
      log.info(
        `[DogmaIM] GetAllInfo took ${elapsedMs}ms ship=${shipID} ` +
        `shipInfoEntries=${1 + shipInventoryInfoEntries.length} shipStateEntries=${shipStateEntries} ` +
        `chargeStateEntries=${chargeStateEntries} deferredFitting=${deferLoginShipFittingBootstrap ? 1 : 0}`,
      );
    }
    return result;
  }
  Handle_ShipGetInfo(args, session) {
    log.debug("[DogmaIM] ShipGetInfo");
    const shipContext = this._getCurrentDogmaShipContext(session);
    const shipID = shipContext.shipID;
    const shipMetadata = shipContext.shipMetadata;
    const ownerID = shipMetadata.ownerID || this._getCharID(session);
    const locationID = this._resolveActiveShipLocationID(
      session,
      shipMetadata,
      this._getLocationID(session),
    );
    const entry = this._buildCommonGetInfoEntry({
      itemID: shipID,
      typeID: shipMetadata.typeID,
      ownerID,
      locationID,
      flagID: this._resolveActiveShipFlagID(session, shipMetadata, 4),
      groupID: shipMetadata.groupID,
      categoryID: shipMetadata.categoryID,
      quantity:
        shipMetadata.quantity === undefined || shipMetadata.quantity === null
          ? -1
          : shipMetadata.quantity,
      singleton:
        shipMetadata.singleton === undefined || shipMetadata.singleton === null
          ? 1
          : shipMetadata.singleton,
      stacksize:
        shipMetadata.stacksize === undefined || shipMetadata.stacksize === null
          ? 1
          : shipMetadata.stacksize,
      customInfo: shipMetadata.customInfo || "",
      description: shipContext.controllingStructure ? "structure" : "ship",
      attributes: shipContext.controllingStructure
        ? this._buildInventoryItemAttributeDict(shipMetadata, session)
        : this._buildShipAttributeDict(
          this._getCharacterRecord(session) || {},
          shipMetadata,
          session,
        ),
      session,
    });
    return { type: "dict", entries: [[shipID, entry]] };
  }
  Handle_CharGetInfo(args, session) {
    log.debug("[DogmaIM] CharGetInfo");
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const characterLocationID = this._getCharacterItemLocationID(session);
    return this._buildCharacterInfoDict(charID, charData, characterLocationID);
  }
  Handle_ItemGetInfo(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[DogmaIM] ItemGetInfo(itemID=${requestedItemID})`);
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const skillRecord =
      getCharacterSkills(charID).find(
        (skill) => skill.itemID === requestedItemID || skill.itemID === Number.parseInt(String(requestedItemID), 10),
      ) || null;
    const numericItemID = Number.parseInt(String(requestedItemID), 10) || this._getShipID(session);
    const shipRecord = findCharacterShip(charID, numericItemID);
    const isCharacter = numericItemID === charID;
    if (skillRecord) {
      return this._buildCommonGetInfoEntry({
        itemID: skillRecord.itemID,
        typeID: skillRecord.typeID,
        ownerID: skillRecord.ownerID || charID,
        locationID: this._coalesce(skillRecord.locationID, charID),
        flagID: skillRecord.flagID ?? SKILL_FLAG_ID,
        groupID: skillRecord.groupID,
        categoryID: skillRecord.categoryID,
        quantity: 1,
        singleton: 1,
        stacksize: 1,
        description: skillRecord.itemName || "skill",
        session,
      });
    }
    const inventoryContext = this._findInventoryItemContext(
      requestedItemID,
      session,
      {
        includeAttributes: false,
      },
    );
    if (inventoryContext && inventoryContext.item) {
      const item = inventoryContext.item;
      const cachedEntry = this._getCachedDockedItemInfoEntry(
        session,
        requestedItemID,
        item,
      );
      if (cachedEntry) {
        return cachedEntry;
      }
      const entry = this._buildCommonGetInfoEntry({
        itemID: Array.isArray(requestedItemID) ? requestedItemID : item.itemID,
        typeID: item.typeID,
        ownerID: item.ownerID || charID,
        locationID: item.locationID,
        flagID: item.flagID,
        groupID: item.groupID,
        categoryID: item.categoryID,
        quantity: item.quantity,
        singleton: item.singleton,
        stacksize: item.stacksize,
        customInfo: item.customInfo || "",
        description: item.itemName || "item",
        activeEffects: this._buildInventoryItemActiveEffects(item, session),
        attributes: this._buildInventoryItemAttributeDict(item, session),
        session,
      });
      this._cacheDockedItemInfoEntry(session, requestedItemID, item, entry);
      return entry;
    }
    const shipContext = this._getCurrentDogmaShipContext(session);
    if (
      shipContext.controllingStructure &&
      numericItemID === Number(shipContext.shipID)
    ) {
      const cachedEntry = this._getCachedDockedItemInfoEntry(
        session,
        requestedItemID,
        shipContext.shipMetadata,
      );
      if (cachedEntry) {
        return cachedEntry;
      }
      const entry = this._buildCommonGetInfoEntry({
        itemID: shipContext.shipID,
        typeID: shipContext.shipMetadata.typeID,
        ownerID: shipContext.shipMetadata.ownerID || charID,
        locationID: this._resolveActiveShipLocationID(
          session,
          shipContext.shipMetadata,
          this._getLocationID(session),
        ),
        flagID: this._resolveActiveShipFlagID(
          session,
          shipContext.shipMetadata,
          0,
        ),
        groupID: shipContext.shipMetadata.groupID,
        categoryID: shipContext.shipMetadata.categoryID,
        quantity:
          shipContext.shipMetadata.quantity === undefined ||
          shipContext.shipMetadata.quantity === null
            ? -1
            : shipContext.shipMetadata.quantity,
        singleton:
          shipContext.shipMetadata.singleton === undefined ||
          shipContext.shipMetadata.singleton === null
            ? 1
            : shipContext.shipMetadata.singleton,
        stacksize:
          shipContext.shipMetadata.stacksize === undefined ||
          shipContext.shipMetadata.stacksize === null
            ? 1
            : shipContext.shipMetadata.stacksize,
        customInfo: shipContext.shipMetadata.customInfo || "",
        description: "item",
        attributes: this._buildInventoryItemAttributeDict(
          shipContext.shipMetadata,
          session,
        ),
        session,
      });
      this._cacheDockedItemInfoEntry(
        session,
        requestedItemID,
        shipContext.shipMetadata,
        entry,
      );
      return entry;
    }
    const itemID = isCharacter
      ? charID
      : shipRecord
        ? shipRecord.itemID
        : this._getShipID(session);
    const ownerID = charID;
    const locationID = this._getLocationID(session);
    const shipMetadata = shipRecord || this._getActiveShipRecord(session) || this._getShipMetadata(session);
    const characterLocationID = this._getCharacterItemLocationID(session);
    return this._buildCommonGetInfoEntry({
      itemID,
      typeID: isCharacter ? (charData.typeID || 1373) : shipMetadata.typeID,
      ownerID,
      locationID: isCharacter
        ? characterLocationID
        : this._resolveActiveShipLocationID(session, shipMetadata, locationID),
      flagID: isCharacter
        ? FLAG_PILOT
        : this._resolveActiveShipFlagID(session, shipMetadata, 4),
      groupID: isCharacter ? 1 : shipMetadata.groupID,
      categoryID: isCharacter ? 3 : shipMetadata.categoryID,
      quantity: isCharacter
        ? -1
        : (
            shipMetadata.quantity === undefined || shipMetadata.quantity === null
              ? -1
              : shipMetadata.quantity
          ),
      singleton: isCharacter
        ? 1
        : (
            shipMetadata.singleton === undefined || shipMetadata.singleton === null
              ? 1
              : shipMetadata.singleton
          ),
      stacksize: isCharacter
        ? 1
        : (
            shipMetadata.stacksize === undefined || shipMetadata.stacksize === null
              ? 1
              : shipMetadata.stacksize
          ),
      customInfo: isCharacter ? "" : (shipMetadata.customInfo || ""),
      description: "item",
      attributes: isCharacter
        ? this._buildCharacterAttributeDict(charData, this._getCharID(session))
        : this._buildShipAttributeDict(charData, shipMetadata, session),
      session,
    });
  }
  Handle_QueryAllAttributesForItem(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[DogmaIM] QueryAllAttributesForItem(itemID=${requestedItemID})`);
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    return this._buildAttributeValueDict(context.attributes);
  }
  Handle_QueryAttributeValue(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const attributeID = args && args.length > 1 ? Number(args[1]) : null;
    log.debug(
      `[DogmaIM] QueryAttributeValue(itemID=${requestedItemID}, attributeID=${attributeID})`,
    );
    if (!Number.isInteger(attributeID)) {
      return null;
    }
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    return Object.prototype.hasOwnProperty.call(context.attributes, attributeID)
      ? context.attributes[attributeID]
      : null;
  }
  Handle_FullyDescribeAttribute(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const attributeID = args && args.length > 1 ? Number(args[1]) : null;
    const reason = args && args.length > 2 ? args[2] : "";
    log.debug(
      `[DogmaIM] FullyDescribeAttribute(itemID=${requestedItemID}, attributeID=${attributeID})`,
    );
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    const serverValue = Number.isInteger(attributeID)
      ? context.attributes[attributeID]
      : undefined;
    const baseValue = Number.isInteger(attributeID)
      ? context.baseAttributes[attributeID]
      : undefined;
    return {
      type: "list",
      items: [
        `Item ID:${this._formatDebugValue(context.itemID)}`,
        `Reason:${this._formatDebugValue(reason, "")}`,
        `Server value:${this._formatDebugValue(serverValue)}`,
        `Base value:${this._formatDebugValue(baseValue)}`,
        "Attribute modification graph:",
        "  No server-side modifier graph is implemented in EveJS Elysian yet.",
      ],
    };
  }
  Handle_GetLocationInfo(args, session) {
    log.debug("[DogmaIM] GetLocationInfo");
    return [
      (session && session.userid) || 1,
      this._getLocationID(session),
      0,
    ];
  }
  Handle_InjectSkillIntoBrain(args, session) {
    log.debug("[DogmaIM] InjectSkillIntoBrain");
    const rawItemIDs = args && args.length === 1 ? args[0] : args;
    return injectSkillbookItems(this._getCharID(session), rawItemIDs, session);
  }
  Handle_InjectImplant(args, session) {
    const itemID = Number.parseInt(String(unwrapMarshalValue(args && args[0])), 10) || 0;
    const charID = this._getCharID(session);
    log.debug(`[DogmaIM] InjectImplant(itemID=${itemID})`);
    const queueSnapshot = this._captureQueueSnapshotForAttributeChange(charID, "implant");
    const result = installImplantItem(charID, itemID, { session });
    if (!result.success) {
      log.warn(
        `[DogmaIM] InjectImplant rejected itemID=${itemID} error=${result.errorMsg || "UNKNOWN"}`,
      );
      this._throwCustomNotifyUserError(this._formatImplantUserError(result.errorMsg));
    }

    if (queueSnapshot) {
      this._prepareQueueForAttributeChange(charID, "implant", queueSnapshot);
    }
    this._syncInventoryChanges(session, result.data.inventoryChanges || []);
    this._syncCapsuleTypeForCharacter(session, charID);
    if (session && typeof session.sendNotification === "function") {
      session.sendNotification("OnServerImplantsChanged", "clientID", []);
      session.sendNotification("OnJumpCloneCacheInvalidated", "clientID", []);
    }
    syncCharacterDogmaState(session, charID);
    this._syncQueueAfterAttributeChange(charID, "implant");
    return null;
  }
  Handle_DestroyImplant(args, session) {
    const itemID = Number.parseInt(String(unwrapMarshalValue(args && args[0])), 10) || 0;
    const charID = this._getCharID(session);
    log.debug(`[DogmaIM] DestroyImplant(itemID=${itemID})`);
    const queueSnapshot = this._captureQueueSnapshotForAttributeChange(charID, "implant");
    const result = destroyImplantItem(charID, itemID);
    if (!result.success) {
      log.warn(
        `[DogmaIM] DestroyImplant rejected itemID=${itemID} error=${result.errorMsg || "UNKNOWN"}`,
      );
      this._throwCustomNotifyUserError(this._formatImplantUserError(result.errorMsg));
    }

    if (queueSnapshot) {
      this._prepareQueueForAttributeChange(charID, "implant", queueSnapshot);
    }
    this._syncCapsuleTypeForCharacter(session, charID);
    if (session && typeof session.sendNotification === "function") {
      session.sendNotification("OnServerImplantsChanged", "clientID", []);
      session.sendNotification("OnJumpCloneCacheInvalidated", "clientID", []);
    }
    syncCharacterDogmaState(session, charID);
    this._syncQueueAfterAttributeChange(charID, "implant");
    return null;
  }
  Handle_UseBooster(args, session) {
    const itemID = Number.parseInt(String(unwrapMarshalValue(args && args[0])), 10) || 0;
    const locationID = Number.parseInt(String(unwrapMarshalValue(args && args[1])), 10) || 0;
    const charID = this._getCharID(session);
    log.debug(`[DogmaIM] UseBooster(itemID=${itemID}, locationID=${locationID})`);
    const queueSnapshot = this._captureQueueSnapshotForAttributeChange(charID, "booster");
    const result = useBoosterItem(
      charID,
      itemID,
      locationID > 0 ? locationID : null,
    );
    if (!result.success) {
      log.warn(
        `[DogmaIM] UseBooster rejected itemID=${itemID} error=${result.errorMsg || "UNKNOWN"}`,
      );
      this._throwCustomNotifyUserError(this._formatBoosterUserError(result.errorMsg));
    }

    if (queueSnapshot) {
      this._prepareQueueForAttributeChange(charID, "booster", queueSnapshot);
    }
    this._syncInventoryChanges(session, result.data.inventoryChanges || []);
    if (session && typeof session.sendNotification === "function") {
      session.sendNotification("OnServerBoostersChanged", "clientID", []);
    }
    syncCharacterDogmaState(session, charID);
    this._syncQueueAfterAttributeChange(charID, "booster");
    return null;
  }
  _sendPostUndockDogmaMultiEvent(session) {
    if (
      !session ||
      !session._space ||
      session._space.loginChargeHydrationProfile !== "undock" ||
      session._space.postUndockDogmaMultiEventSent === true
    ) {
      return false;
    }

    const charID = this._getCharID(session);
    const shipContext = this._getCurrentDogmaShipContext(session);
    const shipID = Number(shipContext && shipContext.shipID) || this._getShipID(session);
    if (!shipContext || charID <= 0 || shipID <= 0 || shipContext.controllingStructure) {
      return false;
    }

    const shipRecord =
      shipContext.shipRecord ||
      this._getActiveShipRecord(session) ||
      shipContext.shipMetadata ||
      {};
    const fittingContext = this._buildFittingHydrationContext(
      charID,
      shipID,
      shipContext.shipMetadata || shipRecord,
    );
    const shipAttributes = this._buildShipAttributes(
      this._getCharacterRecord(session) || {},
      shipRecord,
      session,
      { fittingContext },
    );
    const time = this._sessionFileTime(session);
    const subEvents = [];
    const shipAttributeIDs = [
      ATTRIBUTE_MASS,
      ATTRIBUTE_MAX_VELOCITY,
      ATTRIBUTE_CHARGE,
      ATTRIBUTE_SHIELD_CHARGE_HELPER,
      ATTRIBUTE_POWER_LOAD,
      ATTRIBUTE_CPU_LOAD,
    ];

    for (const attributeID of shipAttributeIDs) {
      const value = Number(shipAttributes && shipAttributes[attributeID]);
      if (!Number.isFinite(value)) {
        continue;
      }
      subEvents.push(
        buildModuleAttributeChangeEvent(
          charID,
          shipID,
          attributeID,
          value,
          value,
          time,
        ),
      );
    }

    const isOnlineAttributeID = getAttributeIDByNames("isOnline") || 1153;
    for (const moduleItem of getFittedModuleItems(charID, shipID)) {
      if (!isModuleOnline(moduleItem)) {
        continue;
      }
      subEvents.push(
        buildModuleAttributeChangeEvent(
          charID,
          moduleItem.itemID,
          isOnlineAttributeID,
          1,
          1,
          time,
        ),
      );
    }

    const sent = sendOnMultiEvent(session, subEvents, time);
    if (sent) {
      session._space.postUndockDogmaMultiEventSent = true;
    }
    return sent;
  }
  Handle_MachoResolveObject(args, session, kwargs) {
    const bindParameter = args && args[0];
    void bindParameter;
    log.debug("[DogmaIM] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }
  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;
    log.debug(
      `[DogmaIM] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];
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
      log.debug(`[DogmaIM] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }
    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }
  afterCallResponse(methodName, session, context = {}) {
    let dogmaMethodName = methodName;
    if (methodName === "MachoBindObject") {
      const bindArgs = Array.isArray(context && context.args)
        ? context.args
        : [];
      const nestedCall = bindArgs.length > 1 ? bindArgs[1] : null;
      if (Array.isArray(nestedCall) && nestedCall.length >= 1) {
        dogmaMethodName =
          typeof nestedCall[0] === "string"
            ? nestedCall[0]
            : Buffer.isBuffer(nestedCall[0])
              ? nestedCall[0].toString("utf8")
              : String(nestedCall[0]);
      }
    }
    if (dogmaMethodName !== "GetAllInfo") {
      return;
    }
    if (this._isControllingStructureSession(session)) {
      return;
    }
    this._flushPostGetAllInfoChargeQuantityRefresh(session);
    this._sendPostUndockDogmaMultiEvent(session);
    syncCharacterDogmaState(session, this._getCharID(session));
  }
}
/**
 * Process all pending module reloads whose timers have expired.
 * Called from the scheduled timer callback and can also be invoked
 * directly for testing.
 */
DogmaService.flushPendingModuleReloads = function flushPendingModuleReloads(
  nowMs = Date.now(),
) {
  const instance = new DogmaService();
  const completed = [];
  for (const [moduleID, reloadState] of pendingModuleReloads.entries()) {
    const completeAtMs = Number(reloadState && reloadState.completeAtMs) || 0;
    const currentTimeMs = getReloadStateCurrentTimeMs(reloadState, nowMs);
    if (completeAtMs <= 0 || completeAtMs > currentTimeMs) {
      continue;
    }
    const result = instance._completePendingModuleReload(reloadState, currentTimeMs);
    completed.push({
      moduleID,
      success: result.success,
      errorMsg: result.errorMsg || null,
    });
  }
  schedulePendingModuleReloadPump();
  return completed;
};
DogmaService.boardNewbieShipForSession = boardNewbieShipForSession;
DogmaService.resolveNewbieShipTypeIDForSession = resolveNewbieShipTypeID;
DogmaService.repairShipAndFittedItemsForSession = repairShipAndFittedItemsForSession;
DogmaService._testing = {
  flushPendingModuleReloads: DogmaService.flushPendingModuleReloads,
  getPendingModuleReloads() {
    return pendingModuleReloads;
  },
  marshalDogmaAttributeValue,
  normalizeModuleAttributeChange,
  clearPendingModuleReloads() {
    pendingModuleReloads.clear();
    if (pendingModuleReloadTimer) {
      clearTimeout(pendingModuleReloadTimer);
      pendingModuleReloadTimer = null;
    }
  },
};
module.exports = DogmaService;
