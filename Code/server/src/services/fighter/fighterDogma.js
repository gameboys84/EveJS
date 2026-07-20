const path = require("path");

const {
  getAttributeIDByNames,
  getEffectTypeRecord,
  getFittedModuleItems,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getCachedCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  findItemById,
  findShipItemById,
  getItemMutationVersion,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildLocationModifiedAttributeMap,
  collectShipModifierAttributes,
} = require(path.join(__dirname, "../../space/combat/weaponDogma"));
const {
  getLocationModifierSourcesForSystem,
} = require(path.join(
  __dirname,
  "../exploration/wormholes/wormholeEnvironmentRuntime",
));
const {
  getFighterAbilityMetaForSlot,
} = require(path.join(__dirname, "./fighterAbilities"));
const {
  getActiveImplantLocationModifierSources,
  getActiveImplantSourceStates,
  getActiveImplantShipModifierEntries,
} = require(path.join(__dirname, "../dogma/implants/activeImplantModifiers"));

const ATTRIBUTE_STRUCTURE_HP = getAttributeIDByNames("hp", "structureHP") || 9;
const ATTRIBUTE_ARMOR_HP = getAttributeIDByNames("armorHP") || 265;
const ATTRIBUTE_SHIELD_CAPACITY = getAttributeIDByNames("shieldCapacity") || 263;
const STRUCTURE_CONTROLLER_SKILL_TYPE_IDS = new Set([
  37796, // Structure Missile Systems
  37797, // Structure Doomsday Operation
  37798, // Structure Electronic Systems
  37799, // Structure Engineering Systems
]);

const ATTRIBUTE_ATTACK_TURRET_DAMAGE_MULTIPLIER =
  getAttributeIDByNames("fighterAbilityAttackTurretDamageMultiplier") || 2178;
const ATTRIBUTE_ATTACK_TURRET_SIGNATURE_RESOLUTION =
  getAttributeIDByNames("fighterAbilityAttackTurretSignatureResolution") || 2179;
const ATTRIBUTE_ATTACK_TURRET_DAMAGE_EM =
  getAttributeIDByNames("fighterAbilityAttackTurretDamageEM") || 2171;
const ATTRIBUTE_ATTACK_TURRET_DAMAGE_THERMAL =
  getAttributeIDByNames("fighterAbilityAttackTurretDamageTherm") || 2172;
const ATTRIBUTE_ATTACK_TURRET_DAMAGE_KINETIC =
  getAttributeIDByNames("fighterAbilityAttackTurretDamageKin") || 2173;
const ATTRIBUTE_ATTACK_TURRET_DAMAGE_EXPLOSIVE =
  getAttributeIDByNames("fighterAbilityAttackTurretDamageExp") || 2174;

const ATTRIBUTE_ATTACK_MISSILE_DAMAGE_MULTIPLIER =
  getAttributeIDByNames("fighterAbilityAttackMissileDamageMultiplier") || 2226;
const ATTRIBUTE_ATTACK_MISSILE_EXPLOSION_RADIUS =
  getAttributeIDByNames("fighterAbilityAttackMissileExplosionRadius") || 2234;
const ATTRIBUTE_ATTACK_MISSILE_EXPLOSION_VELOCITY =
  getAttributeIDByNames("fighterAbilityAttackMissileExplosionVelocity") || 2235;
const ATTRIBUTE_ATTACK_MISSILE_REDUCTION_FACTOR =
  getAttributeIDByNames("fighterAbilityAttackMissileReductionFactor") || 2231;
const ATTRIBUTE_ATTACK_MISSILE_REDUCTION_SENSITIVITY =
  getAttributeIDByNames("fighterAbilityAttackMissileReductionSensitivity") || 2232;
const ATTRIBUTE_ATTACK_MISSILE_DAMAGE_EM =
  getAttributeIDByNames("fighterAbilityAttackMissileDamageEM") || 2227;
const ATTRIBUTE_ATTACK_MISSILE_DAMAGE_THERMAL =
  getAttributeIDByNames("fighterAbilityAttackMissileDamageTherm") || 2228;
const ATTRIBUTE_ATTACK_MISSILE_DAMAGE_KINETIC =
  getAttributeIDByNames("fighterAbilityAttackMissileDamageKin") || 2229;
const ATTRIBUTE_ATTACK_MISSILE_DAMAGE_EXPLOSIVE =
  getAttributeIDByNames("fighterAbilityAttackMissileDamageExp") || 2230;

const ATTRIBUTE_MISSILES_DAMAGE_MULTIPLIER =
  getAttributeIDByNames("fighterAbilityMissilesDamageMultiplier") || 2130;
const ATTRIBUTE_MISSILES_EXPLOSION_RADIUS =
  getAttributeIDByNames("fighterAbilityMissilesExplosionRadius") || 2125;
const ATTRIBUTE_MISSILES_EXPLOSION_VELOCITY =
  getAttributeIDByNames("fighterAbilityMissilesExplosionVelocity") || 2126;
const ATTRIBUTE_MISSILES_REDUCTION_FACTOR =
  getAttributeIDByNames("fighterAbilityMissilesDamageReductionFactor") || 2127;
const ATTRIBUTE_MISSILES_REDUCTION_SENSITIVITY =
  getAttributeIDByNames("fighterAbilityMissilesDamageReductionSensitivity") || 2128;
const ATTRIBUTE_MISSILES_DAMAGE_EM =
  getAttributeIDByNames("fighterAbilityMissilesEMDamage") || 2131;
const ATTRIBUTE_MISSILES_DAMAGE_THERMAL =
  getAttributeIDByNames("fighterAbilityMissilesThermDamage") || 2132;
const ATTRIBUTE_MISSILES_DAMAGE_KINETIC =
  getAttributeIDByNames("fighterAbilityMissilesKinDamage") || 2133;
const ATTRIBUTE_MISSILES_DAMAGE_EXPLOSIVE =
  getAttributeIDByNames("fighterAbilityMissilesExpDamage") || 2134;
const ATTRIBUTE_AFTERBURNER_SPEED_BONUS =
  getAttributeIDByNames("fighterAbilityAfterburnerSpeedBonus") || 2151;
const ATTRIBUTE_MICROWARPDRIVE_SPEED_BONUS =
  getAttributeIDByNames("fighterAbilityMicroWarpDriveSpeedBonus") || 2152;
const ATTRIBUTE_MICROWARPDRIVE_SIGNATURE_RADIUS_BONUS =
  getAttributeIDByNames("fighterAbilityMicroWarpDriveSignatureRadiusBonus") || 2153;
const ATTRIBUTE_MICROJUMPDRIVE_SIGNATURE_RADIUS_BONUS =
  getAttributeIDByNames("fighterAbilityMicroJumpDriveSignatureRadiusBonus") || 2156;
const ATTRIBUTE_EVASIVE_SPEED_BONUS =
  getAttributeIDByNames("fighterAbilityEvasiveManeuversSpeedBonus") || 2224;
const ATTRIBUTE_EVASIVE_SIGNATURE_RADIUS_BONUS =
  getAttributeIDByNames("fighterAbilityEvasiveManeuversSignatureRadiusBonus") || 2225;
const ATTRIBUTE_ECM_DURATION =
  getAttributeIDByNames("fighterAbilityECMDuration") || 2220;
const ATTRIBUTE_ECM_RANGE_OPTIMAL =
  getAttributeIDByNames("fighterAbilityECMRangeOptimal") || 2221;
const ATTRIBUTE_ECM_RANGE_FALLOFF =
  getAttributeIDByNames("fighterAbilityECMRangeFalloff") || 2222;
const ATTRIBUTE_ECM_STRENGTH_GRAVIMETRIC =
  getAttributeIDByNames("fighterAbilityECMStrengthGravimetric") || 2241;
const ATTRIBUTE_ECM_STRENGTH_LADAR =
  getAttributeIDByNames("fighterAbilityECMStrengthLadar") || 2242;
const ATTRIBUTE_ECM_STRENGTH_MAGNETOMETRIC =
  getAttributeIDByNames("fighterAbilityECMStrengthMagnetometric") || 2243;
const ATTRIBUTE_ECM_STRENGTH_RADAR =
  getAttributeIDByNames("fighterAbilityECMStrengthRadar") || 2244;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function firstPositiveInt(...values) {
  for (const value of values) {
    const numeric = toInt(value, 0);
    if (numeric > 0) {
      return numeric;
    }
  }
  return 0;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function fingerprintText(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(36)}`;
}

function resolveSquadronSize(itemOrEntity) {
  if (!itemOrEntity || typeof itemOrEntity !== "object") {
    return 0;
  }
  if (toInt(itemOrEntity.squadronSize, 0) > 0) {
    return toInt(itemOrEntity.squadronSize, 0);
  }
  if (toInt(itemOrEntity.singleton, 0) === 1) {
    return 1;
  }
  return Math.max(
    0,
    toInt(itemOrEntity.stacksize ?? itemOrEntity.quantity, 0),
  );
}

function resolveFighterDogmaItem(fighterEntity) {
  if (!fighterEntity) {
    return null;
  }

  const itemID = firstPositiveInt(fighterEntity.itemID);
  const storedItem = itemID > 0 ? findItemById(itemID) : null;
  const typeID = firstPositiveInt(
    fighterEntity.typeID,
    storedItem && storedItem.typeID,
  );
  if (typeID <= 0) {
    return null;
  }

  const customInfo =
    fighterEntity.customInfo !== undefined &&
    fighterEntity.customInfo !== null &&
    String(fighterEntity.customInfo || "") !== ""
      ? String(fighterEntity.customInfo || "")
      : String((storedItem && storedItem.customInfo) || "");
  const squadronSize = resolveSquadronSize({
    ...(storedItem || {}),
    ...fighterEntity,
  });

  return {
    ...(storedItem || {}),
    itemID,
    typeID,
    groupID: firstPositiveInt(
      fighterEntity.groupID,
      storedItem && storedItem.groupID,
    ),
    categoryID: firstPositiveInt(
      fighterEntity.categoryID,
      storedItem && storedItem.categoryID,
    ),
    ownerID: firstPositiveInt(
      fighterEntity.ownerID,
      storedItem && storedItem.ownerID,
    ),
    locationID: firstPositiveInt(
      fighterEntity.locationID,
      storedItem && storedItem.locationID,
      fighterEntity.systemID,
    ),
    flagID:
      fighterEntity.flagID !== undefined && fighterEntity.flagID !== null
        ? toInt(fighterEntity.flagID, 0)
        : toInt(storedItem && storedItem.flagID, 0),
    singleton:
      fighterEntity.singleton !== undefined && fighterEntity.singleton !== null
        ? toInt(fighterEntity.singleton, 0)
        : toInt(storedItem && storedItem.singleton, 0),
    quantity:
      fighterEntity.quantity !== undefined && fighterEntity.quantity !== null
        ? fighterEntity.quantity
        : storedItem && storedItem.quantity !== undefined
          ? storedItem.quantity
          : squadronSize,
    stacksize:
      fighterEntity.stacksize !== undefined && fighterEntity.stacksize !== null
        ? fighterEntity.stacksize
        : storedItem && storedItem.stacksize !== undefined
          ? storedItem.stacksize
          : squadronSize,
    squadronSize,
    customInfo,
  };
}

function buildFighterSnapshotCacheKey(fighterEntity, fighterItem = null) {
  const resolvedItem = fighterItem || resolveFighterDogmaItem(fighterEntity);
  const typeID = firstPositiveInt(
    resolvedItem && resolvedItem.typeID,
    fighterEntity && fighterEntity.typeID,
  );
  const itemID = firstPositiveInt(
    resolvedItem && resolvedItem.itemID,
    fighterEntity && fighterEntity.itemID,
  );
  const customInfo = String(
    (resolvedItem && resolvedItem.customInfo) ||
      (fighterEntity && fighterEntity.customInfo) ||
      "",
  );
  if (itemID > 0) {
    return `item:${itemID}:${toInt(getItemMutationVersion(itemID), 0)}:${fingerprintText(customInfo)}`;
  }
  return `type:${typeID}:${fingerprintText(customInfo)}`;
}

function resolveSkillLevel(skillRecord) {
  return toInt(
    skillRecord && (
      skillRecord.effectiveSkillLevel ??
      skillRecord.trainedSkillLevel ??
      skillRecord.skillLevel
    ),
    0,
  );
}

function buildSkillMapFingerprint(skillMap) {
  if (!(skillMap instanceof Map) || skillMap.size <= 0) {
    return "";
  }
  return [...skillMap.values()]
    .map((skillRecord) => {
      const typeID = toInt(skillRecord && skillRecord.typeID, 0);
      return typeID > 0 ? `${typeID}:${resolveSkillLevel(skillRecord)}` : null;
    })
    .filter(Boolean)
    .sort()
    .join(",");
}

function buildControllerDogmaFingerprint(controllerEntity, fittedItems = [], skillMap = null) {
  const shipID = toInt(controllerEntity && controllerEntity.itemID, 0);
  const isStructureController = isStructureControllerEntity(controllerEntity);
  const controllerOwnerID = toInt(
    controllerEntity &&
      (
        controllerEntity.session && controllerEntity.session.characterID
      ) ||
      controllerEntity &&
      (
        controllerEntity.pilotCharacterID ??
        controllerEntity.characterID ??
        controllerEntity.ownerID
      ),
    0,
  );
  const shipMutationVersion =
    shipID > 0 ? toInt(getItemMutationVersion(shipID), 0) : 0;
  const systemID = toInt(controllerEntity && controllerEntity.systemID, 0);
  const fittedMutationFingerprint = fittedItems
    .map((item) => (
      `${toInt(item && item.itemID, 0)}:` +
      `${toInt(getItemMutationVersion(item && item.itemID), 0)}`
    ))
    .join("|");
  const activeEffectFingerprint =
    controllerEntity && controllerEntity.activeModuleEffects instanceof Map
      ? [...controllerEntity.activeModuleEffects.values()]
        .filter(Boolean)
        .map((effectState) => (
          `${toInt(effectState && effectState.moduleID, 0)}:` +
          `${toInt(effectState && effectState.effectID, 0)}:` +
          `${toInt(effectState && effectState.chargeTypeID, 0)}`
        ))
        .sort()
        .join("|")
      : "";
  const activeImplantFingerprint =
    controllerOwnerID > 0 && !isStructureController
      ? getActiveImplantSourceStates(controllerOwnerID)
        .map((implant) => `${toInt(implant && implant.slot, 0)}:${toInt(implant && implant.typeID, 0)}`)
        .join(",")
      : "";
  return [
    shipMutationVersion,
    systemID,
    buildSkillMapFingerprint(skillMap),
    fittedMutationFingerprint,
    activeEffectFingerprint,
    activeImplantFingerprint,
  ].join("#");
}

function isStructureControllerEntity(controllerEntity) {
  return Boolean(
    controllerEntity && (
      controllerEntity.kind === "structure" ||
      toInt(controllerEntity.categoryID, 0) === 65
    ),
  );
}

function filterStructureControllerSkillMap(skillMap) {
  if (!(skillMap instanceof Map) || skillMap.size <= 0) {
    return new Map();
  }
  return new Map(
    [...skillMap.entries()].filter(([, skillRecord]) => (
      STRUCTURE_CONTROLLER_SKILL_TYPE_IDS.has(toInt(skillRecord && skillRecord.typeID, 0))
    )),
  );
}

function buildActiveModuleContexts(controllerEntity, fittedItems = [], characterID = 0) {
  if (!controllerEntity || !(controllerEntity.activeModuleEffects instanceof Map)) {
    return [];
  }

  return [...controllerEntity.activeModuleEffects.values()]
    .filter(Boolean)
    .map((effectState) => {
      const moduleItem = fittedItems.find((item) => (
        toInt(item && item.itemID, 0) === toInt(effectState && effectState.moduleID, 0) ||
        (
          toInt(effectState && effectState.moduleFlagID, 0) > 0 &&
          toInt(item && item.flagID, 0) === toInt(effectState && effectState.moduleFlagID, 0)
        )
      )) || null;
      if (!moduleItem) {
        return null;
      }

      return {
        effectState,
        effectRecord: getEffectTypeRecord(toInt(effectState && effectState.effectID, 0)),
        moduleItem,
        chargeItem: null,
        characterID,
      };
    })
    .filter((entry) => entry && entry.effectRecord && entry.moduleItem);
}

function getControllerDogmaContext(controllerEntity) {
  const controllerShipID = toInt(controllerEntity && controllerEntity.itemID, 0);
  if (controllerShipID <= 0) {
    return null;
  }

  const controllerOwnerID = toInt(
    (
      controllerEntity &&
      controllerEntity.session &&
      controllerEntity.session.characterID
    ) ||
      (
        controllerEntity &&
        (
          controllerEntity.pilotCharacterID ??
          controllerEntity.characterID ??
          controllerEntity.ownerID
        )
      ),
    0,
  );
  const shipItem =
    findShipItemById(controllerShipID) ||
    findItemById(controllerShipID) ||
    null;
  if (!shipItem) {
    return null;
  }

  const fittedItems =
    controllerOwnerID > 0
      ? getFittedModuleItems(controllerOwnerID, controllerShipID)
      : [];
  const isStructureController = isStructureControllerEntity(controllerEntity);
  const rawSkillMap =
    controllerOwnerID > 0
      ? getCachedCharacterSkillMap(controllerOwnerID)
      : new Map();
  const skillMap = isStructureController
    ? filterStructureControllerSkillMap(rawSkillMap)
    : rawSkillMap;
  const fingerprint = buildControllerDogmaFingerprint(controllerEntity, fittedItems, skillMap);
  const cached =
    controllerEntity &&
    controllerEntity.fighterDogmaCache &&
    controllerEntity.fighterDogmaCache.fingerprint === fingerprint
      ? controllerEntity.fighterDogmaCache
      : null;
  if (cached) {
    return cached;
  }

  const activeModuleContexts = buildActiveModuleContexts(
    controllerEntity,
    fittedItems,
    controllerOwnerID,
  );
  const implantShipModifierEntries =
    controllerOwnerID > 0 && !isStructureController
      ? getActiveImplantShipModifierEntries(controllerOwnerID)
      : [];
  const shipModifierAttributes = collectShipModifierAttributes(
    shipItem,
    skillMap,
    activeModuleContexts,
    {
      additionalDirectModifierEntries: implantShipModifierEntries,
    },
  );
  const additionalLocationModifierSources = [
    ...(controllerOwnerID > 0 && !isStructureController
      ? getActiveImplantLocationModifierSources(controllerOwnerID)
      : []),
    ...(isStructureController
      ? []
      : getLocationModifierSourcesForSystem(
        controllerEntity && controllerEntity.systemID,
      )),
  ];
  const nextCache = {
    fingerprint,
    shipItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
    shipModifierAttributes,
    additionalLocationModifierSources,
    abilitySnapshotsByKey: new Map(),
  };
  controllerEntity.fighterDogmaCache = nextCache;
  return nextCache;
}

function buildOperationalAttributes(fighterEntity, controllerEntity) {
  const context = getControllerDogmaContext(controllerEntity);
  if (!context || !fighterEntity) {
    return null;
  }

  const fighterItem = resolveFighterDogmaItem(fighterEntity);
  if (!fighterItem) {
    return null;
  }
  const attributes = buildLocationModifiedAttributeMap(
    fighterItem,
    context.shipItem,
    context.skillMap,
    context.shipModifierAttributes,
    context.fittedItems,
    context.activeModuleContexts,
    {
      additionalLocationModifierSources: context.additionalLocationModifierSources,
    },
  );
  if (!attributes || Object.keys(attributes).length === 0) {
    return null;
  }
  return {
    context,
    fighterItem,
    attributes,
  };
}

function resolveFighterOperationalAttributes(fighterEntity, controllerEntity) {
  const operational = buildOperationalAttributes(fighterEntity, controllerEntity);
  return operational ? operational.attributes : null;
}

function buildDamageVector(attributes, idsByType, scale = 1) {
  return {
    em: round6(Math.max(0, toFiniteNumber(attributes[idsByType.em], 0)) * scale),
    thermal: round6(Math.max(0, toFiniteNumber(attributes[idsByType.thermal], 0)) * scale),
    kinetic: round6(Math.max(0, toFiniteNumber(attributes[idsByType.kinetic], 0)) * scale),
    explosive: round6(Math.max(0, toFiniteNumber(attributes[idsByType.explosive], 0)) * scale),
  };
}

function sumDamageVector(damageVector) {
  return round6(
    Math.max(0, toFiniteNumber(damageVector.em, 0)) +
      Math.max(0, toFiniteNumber(damageVector.thermal, 0)) +
      Math.max(0, toFiniteNumber(damageVector.kinetic, 0)) +
      Math.max(0, toFiniteNumber(damageVector.explosive, 0)),
  );
}

function getBaseHealthLayers(attributes = {}) {
  return {
    shield: Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_SHIELD_CAPACITY], 0))),
    armor: Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_ARMOR_HP], 0))),
    structure: Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_STRUCTURE_HP], 0))),
  };
}

function classifyOffensiveKind(effectFamily) {
  const normalizedFamily = String(effectFamily || "").trim().toLowerCase();
  if (normalizedFamily === "fighterabilityattackturret") {
    return "turret";
  }
  if (
    normalizedFamily === "fighterabilityattackmissile" ||
    normalizedFamily === "fighterabilityattackm" ||
    normalizedFamily === "fighterabilitymissiles"
  ) {
    return "missile";
  }
  return null;
}

function resolveFighterAbilitySnapshot(fighterEntity, controllerEntity, slotID) {
  const numericSlotID = toInt(slotID, -1);
  const fighterItem = resolveFighterDogmaItem(fighterEntity);
  const typeID = toInt(fighterItem && fighterItem.typeID, 0);
  if (numericSlotID < 0 || typeID <= 0) {
    return null;
  }

  const abilityMeta = getFighterAbilityMetaForSlot(typeID, numericSlotID);
  const operational = buildOperationalAttributes(fighterItem, controllerEntity);
  if (!abilityMeta || !operational) {
    return null;
  }

  const snapshotKey = `${buildFighterSnapshotCacheKey(fighterEntity, operational.fighterItem)}:${numericSlotID}`;
  const cached = operational.context.abilitySnapshotsByKey.get(snapshotKey) || null;
  const squadronSize = Math.max(1, resolveSquadronSize(operational.fighterItem));
  if (cached && cached.squadronSize === squadronSize) {
    return cached;
  }

  const attributes = operational.attributes;
  const durationMs =
    abilityMeta.durationAttributeID
      ? Math.max(
        1,
        Math.round(toFiniteNumber(attributes[abilityMeta.durationAttributeID], abilityMeta.durationMs || 1)),
      )
      : Math.max(1, toInt(abilityMeta.durationMs, 1));
  const rangeMeters =
    abilityMeta.rangeAttributeID
      ? Math.max(0, round6(toFiniteNumber(attributes[abilityMeta.rangeAttributeID], abilityMeta.rangeMeters)))
      : Math.max(0, round6(toFiniteNumber(abilityMeta.rangeMeters, 0)));
  const falloffMeters =
    abilityMeta.falloffAttributeID
      ? Math.max(0, round6(toFiniteNumber(attributes[abilityMeta.falloffAttributeID], abilityMeta.falloffMeters)))
      : Math.max(0, round6(toFiniteNumber(abilityMeta.falloffMeters, 0)));
  const trackingSpeed =
    abilityMeta.trackingSpeedAttributeID
      ? Math.max(0, round6(toFiniteNumber(attributes[abilityMeta.trackingSpeedAttributeID], abilityMeta.trackingSpeed)))
      : Math.max(0, round6(toFiniteNumber(abilityMeta.trackingSpeed, 0)));
  const healthPerMember = getBaseHealthLayers(attributes);
  const normalizedEffectFamily = String(abilityMeta.effectFamily || "").trim().toLowerCase();
  const offensiveKind = classifyOffensiveKind(normalizedEffectFamily);
  const speedBonusPercent =
    normalizedEffectFamily === "fighterabilityafterburner"
      ? round6(toFiniteNumber(attributes[ATTRIBUTE_AFTERBURNER_SPEED_BONUS], 0))
      : normalizedEffectFamily === "fighterabilitymicrowarpdrive"
        ? round6(toFiniteNumber(attributes[ATTRIBUTE_MICROWARPDRIVE_SPEED_BONUS], 0))
        : normalizedEffectFamily === "fighterabilityevasivemaneuvers"
          ? round6(toFiniteNumber(attributes[ATTRIBUTE_EVASIVE_SPEED_BONUS], 0))
          : 0;
  const signatureRadiusBonusPercent =
    normalizedEffectFamily === "fighterabilitymicrowarpdrive"
      ? round6(toFiniteNumber(attributes[ATTRIBUTE_MICROWARPDRIVE_SIGNATURE_RADIUS_BONUS], 0))
      : normalizedEffectFamily === "fighterabilitymicrojumpdrive"
        ? round6(toFiniteNumber(attributes[ATTRIBUTE_MICROJUMPDRIVE_SIGNATURE_RADIUS_BONUS], 0))
        : normalizedEffectFamily === "fighterabilityevasivemaneuvers"
          ? round6(toFiniteNumber(attributes[ATTRIBUTE_EVASIVE_SIGNATURE_RADIUS_BONUS], 0))
          : 0;
  const jammerStrengthBySensorType =
    normalizedEffectFamily === "fighterabilityecm"
      ? Object.freeze({
        gravimetric: round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_STRENGTH_GRAVIMETRIC], 0)),
        ladar: round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_STRENGTH_LADAR], 0)),
        magnetometric: round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_STRENGTH_MAGNETOMETRIC], 0)),
        radar: round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_STRENGTH_RADAR], 0)),
      })
      : null;

  let damageMultiplierAttributeID = null;
  let damageAttributeIDs = null;
  let optimalSigRadius = Math.max(1, round6(toFiniteNumber(attributes[ATTRIBUTE_ATTACK_TURRET_SIGNATURE_RESOLUTION], 25)));
  let explosionRadius = null;
  let explosionVelocity = null;
  let damageReductionFactor = null;
  let damageReductionSensitivity = null;

  if (normalizedEffectFamily === "fighterabilityattackturret") {
    damageMultiplierAttributeID = ATTRIBUTE_ATTACK_TURRET_DAMAGE_MULTIPLIER;
    damageAttributeIDs = {
      em: ATTRIBUTE_ATTACK_TURRET_DAMAGE_EM,
      thermal: ATTRIBUTE_ATTACK_TURRET_DAMAGE_THERMAL,
      kinetic: ATTRIBUTE_ATTACK_TURRET_DAMAGE_KINETIC,
      explosive: ATTRIBUTE_ATTACK_TURRET_DAMAGE_EXPLOSIVE,
    };
    optimalSigRadius = Math.max(
      1,
      round6(toFiniteNumber(attributes[ATTRIBUTE_ATTACK_TURRET_SIGNATURE_RESOLUTION], 25)),
    );
  } else if (
    normalizedEffectFamily === "fighterabilityattackmissile" ||
    normalizedEffectFamily === "fighterabilityattackm"
  ) {
    damageMultiplierAttributeID = ATTRIBUTE_ATTACK_MISSILE_DAMAGE_MULTIPLIER;
    damageAttributeIDs = {
      em: ATTRIBUTE_ATTACK_MISSILE_DAMAGE_EM,
      thermal: ATTRIBUTE_ATTACK_MISSILE_DAMAGE_THERMAL,
      kinetic: ATTRIBUTE_ATTACK_MISSILE_DAMAGE_KINETIC,
      explosive: ATTRIBUTE_ATTACK_MISSILE_DAMAGE_EXPLOSIVE,
    };
    explosionRadius = Math.max(
      1,
      round6(toFiniteNumber(attributes[ATTRIBUTE_ATTACK_MISSILE_EXPLOSION_RADIUS], 1)),
    );
    explosionVelocity = Math.max(
      0.001,
      round6(toFiniteNumber(attributes[ATTRIBUTE_ATTACK_MISSILE_EXPLOSION_VELOCITY], 0.001)),
    );
    damageReductionFactor = Math.max(
      0.000001,
      round6(toFiniteNumber(attributes[ATTRIBUTE_ATTACK_MISSILE_REDUCTION_FACTOR], 1)),
    );
    damageReductionSensitivity = Math.max(
      0.000001,
      round6(toFiniteNumber(attributes[ATTRIBUTE_ATTACK_MISSILE_REDUCTION_SENSITIVITY], 5.5)),
    );
  } else if (offensiveKind === "missile") {
    damageMultiplierAttributeID = ATTRIBUTE_MISSILES_DAMAGE_MULTIPLIER;
    damageAttributeIDs = {
      em: ATTRIBUTE_MISSILES_DAMAGE_EM,
      thermal: ATTRIBUTE_MISSILES_DAMAGE_THERMAL,
      kinetic: ATTRIBUTE_MISSILES_DAMAGE_KINETIC,
      explosive: ATTRIBUTE_MISSILES_DAMAGE_EXPLOSIVE,
    };
    explosionRadius = Math.max(
      1,
      round6(toFiniteNumber(attributes[ATTRIBUTE_MISSILES_EXPLOSION_RADIUS], 1)),
    );
    explosionVelocity = Math.max(
      0.001,
      round6(toFiniteNumber(attributes[ATTRIBUTE_MISSILES_EXPLOSION_VELOCITY], 0.001)),
    );
    damageReductionFactor = Math.max(
      0.000001,
      round6(toFiniteNumber(attributes[ATTRIBUTE_MISSILES_REDUCTION_FACTOR], 1)),
    );
    damageReductionSensitivity = Math.max(
      0.000001,
      round6(toFiniteNumber(attributes[ATTRIBUTE_MISSILES_REDUCTION_SENSITIVITY], 5.5)),
    );
  }

  const damageMultiplier =
    damageMultiplierAttributeID
      ? Math.max(0, round6(toFiniteNumber(attributes[damageMultiplierAttributeID], 1)))
      : 0;
  const perMemberDamage =
    damageAttributeIDs
      ? buildDamageVector(attributes, damageAttributeIDs, damageMultiplier)
      : { em: 0, thermal: 0, kinetic: 0, explosive: 0 };
  const rawShotDamage = {
    em: round6(perMemberDamage.em * squadronSize),
    thermal: round6(perMemberDamage.thermal * squadronSize),
    kinetic: round6(perMemberDamage.kinetic * squadronSize),
    explosive: round6(perMemberDamage.explosive * squadronSize),
  };

  const snapshot = Object.freeze({
    slotID: numericSlotID,
    abilityID: toInt(abilityMeta.abilityID, 0),
    effectFamily: String(abilityMeta.effectFamily || ""),
    effectID: toInt(abilityMeta.effectID, 0),
    effectName: String(abilityMeta.effectName || ""),
    effectGuid: String(abilityMeta.effectGuid || ""),
    normalizedEffectFamily,
    isOffensive: abilityMeta.isOffensive === true,
    targetMode: String(abilityMeta.targetMode || ""),
    displayNameID: toInt(abilityMeta.displayNameID, 0),
    disallowInHighSec: abilityMeta.disallowInHighSec === true,
    disallowInLowSec: abilityMeta.disallowInLowSec === true,
    durationMs,
    cooldownMs:
      abilityMeta.cooldownMs === null || abilityMeta.cooldownMs === undefined
        ? null
        : Math.max(1, toInt(abilityMeta.cooldownMs, 1)),
    rangeMeters,
    falloffMeters,
    trackingSpeed,
    optimalSigRadius,
    offensiveKind,
    damageMultiplier,
    perMemberDamage,
    rawShotDamage,
    totalRawDamage: sumDamageVector(rawShotDamage),
    chargeCount:
      abilityMeta.chargeCount === null || abilityMeta.chargeCount === undefined
        ? null
        : Math.max(0, toInt(abilityMeta.chargeCount, 0)),
    maxChargeCount:
      abilityMeta.chargeCount === null || abilityMeta.chargeCount === undefined
        ? null
        : Math.max(0, toInt(abilityMeta.chargeCount, 0)),
    rearmTimeMs:
      abilityMeta.rearmTimeMs === null || abilityMeta.rearmTimeMs === undefined
        ? null
        : Math.max(1, toInt(abilityMeta.rearmTimeMs, 1)),
    squadronSize,
    healthPerMember,
    speedBonusPercent,
    signatureRadiusBonusPercent,
    jammerStrengthBySensorType,
    jammerDurationMs:
      normalizedEffectFamily === "fighterabilityecm"
        ? Math.max(1, round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_DURATION], durationMs)))
        : 0,
    jammerOptimalRangeMeters:
      normalizedEffectFamily === "fighterabilityecm"
        ? Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_RANGE_OPTIMAL], rangeMeters)))
        : 0,
    jammerFalloffMeters:
      normalizedEffectFamily === "fighterabilityecm"
        ? Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_RANGE_FALLOFF], falloffMeters)))
        : 0,
    explosionRadius,
    explosionVelocity,
    damageReductionFactor,
    damageReductionSensitivity,
  });
  operational.context.abilitySnapshotsByKey.set(snapshotKey, snapshot);
  return snapshot;
}

module.exports = {
  resolveSquadronSize,
  resolveFighterOperationalAttributes,
  resolveFighterAbilitySnapshot,
  getBaseHealthLayers,
  _testing: {
    buildFighterSnapshotCacheKey,
    resolveFighterDogmaItem,
  },
};
