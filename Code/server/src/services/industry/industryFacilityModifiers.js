const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  INDUSTRY_ACTIVITY,
  INDUSTRY_REFERENCE,
} = require(path.join(__dirname, "./industryConstants"));

const RIG_SLOT_FLAGS = Object.freeze([92, 93, 94, 95, 96, 97, 98, 99]);

const ATTRIBUTE_HISEC_MODIFIER = 2355;
const ATTRIBUTE_LOWSEC_MODIFIER = 2356;
const ATTRIBUTE_NULLSEC_MODIFIER = 2357;
const ATTRIBUTE_ENGINEERING_HULL_MATERIAL = 2600;
const ATTRIBUTE_ENGINEERING_HULL_COST = 2601;
const ATTRIBUTE_ENGINEERING_HULL_TIME = 2602;
const ATTRIBUTE_REFINERY_RIG_TIME = 2713;
const ATTRIBUTE_REFINERY_RIG_MATERIAL = 2714;

const GROUP_REACTION_COMPOSITE_INTERMEDIATE = 428;
const GROUP_REACTION_COMPOSITE = 429;
const GROUP_REACTION_HYBRID_POLYMERS = 974;
const GROUP_REACTION_UNREFINED_MINERALS = 4932;
const GROUP_REACTION_BIOCHEMICAL_MATERIAL = 712;
const GROUP_REACTION_MOLECULAR_FORGED_MATERIALS = 4096;
const CATEGORY_STARBASE = 23;
const CATEGORY_STRUCTURE = 65;
const CATEGORY_STRUCTURE_MODULE = 66;
const GROUP_STRUCTURE_COMPONENTS = 536;
const GROUP_FUEL_BLOCK = 1136;

const GROUPS_BASIC_SMALL_SHIPS = Object.freeze([
  25, // Frigate
  420, // Destroyer
  31, // Shuttle
]);
const GROUPS_BASIC_MEDIUM_SHIPS = Object.freeze([
  26, // Cruiser
  419, // Combat Battlecruiser
  1201, // Attack Battlecruiser
  28, // Hauler
  463, // Mining Barge
]);
const GROUPS_BASIC_LARGE_SHIPS = Object.freeze([
  27, // Battleship
  513, // Freighter
  941, // Industrial Command Ship
]);
const GROUPS_ADVANCED_SMALL_SHIPS = Object.freeze([
  324, // Assault Frigate
  830, // Covert Ops
  831, // Interceptor
  834, // Stealth Bomber
  893, // Electronic Attack Ship
  1527, // Logistics Frigate
  1283, // Expedition Frigate
  541, // Interdictor
  1534, // Command Destroyer
  1305, // Tactical Destroyer
]);
const GROUPS_ADVANCED_MEDIUM_SHIPS = Object.freeze([
  358, // Heavy Assault Cruiser
  832, // Logistics
  833, // Force Recon Ship
  906, // Combat Recon Ship
  894, // Heavy Interdiction Cruiser
  540, // Command Ship
  380, // Deep Space Transport
  1202, // Blockade Runner
  543, // Exhumer
  963, // Strategic Cruiser
  954, // Defensive Subsystem
  956, // Offensive Subsystem
  957, // Propulsion Subsystem
  958, // Core Subsystem
]);
const GROUPS_ADVANCED_LARGE_SHIPS = Object.freeze([
  898, // Black Ops
  900, // Marauder
  902, // Jump Freighter
]);
const GROUPS_CAPITAL_SHIPS = Object.freeze([
  30, // Titan
  485, // Dreadnought
  547, // Carrier
  659, // Supercarrier
  883, // Capital Industrial Ship
  1538, // Force Auxiliary
  4594, // Lancer Dreadnought
  5120, // Command Carrier
]);
const GROUPS_ADVANCED_COMPONENTS = Object.freeze([
  334, // Construction Components
  332, // Tool
  716, // Data Interfaces
  964, // Hybrid Tech Components
]);
const GROUPS_BASIC_CAPITAL_COMPONENTS = Object.freeze([873]);
const GROUPS_ADVANCED_CAPITAL_COMPONENTS = Object.freeze([913]);

const MODIFIER_INDEX = Object.freeze({
  time: 0,
  material: 1,
  cost: 2,
});

const SECURITY_SCALED_RIG_ATTRIBUTES = new Set([
  2593,
  2594,
  2595,
  2653,
  ATTRIBUTE_REFINERY_RIG_TIME,
  ATTRIBUTE_REFINERY_RIG_MATERIAL,
]);

const HULL_MODIFIER_ACTIVITIES = Object.freeze([
  INDUSTRY_ACTIVITY.MANUFACTURING,
  INDUSTRY_ACTIVITY.RESEARCH_TIME,
  INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
  INDUSTRY_ACTIVITY.COPYING,
]);

function buildActivityGroupTargets(kind, activityID, groupIDs) {
  return Object.freeze(
    groupIDs.map((groupID) => Object.freeze({
      kind,
      activityID,
      groupID,
    })),
  );
}

function buildManufacturingGroupTargets(kind, groupIDs) {
  return buildActivityGroupTargets(kind, INDUSTRY_ACTIVITY.MANUFACTURING, groupIDs);
}

function buildManufacturingCategoryTargets(kind, categoryIDs) {
  return Object.freeze(
    categoryIDs.map((categoryID) => Object.freeze({
      kind,
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID,
    })),
  );
}

function buildStructureManufacturingTargets(kind) {
  return Object.freeze([
    ...buildManufacturingCategoryTargets(kind, [
      CATEGORY_STARBASE,
      CATEGORY_STRUCTURE,
      CATEGORY_STRUCTURE_MODULE,
    ]),
    ...buildManufacturingGroupTargets(kind, [
      GROUP_STRUCTURE_COMPONENTS,
      GROUP_FUEL_BLOCK,
    ]),
  ]);
}

function buildReactionTargets(kind, groupIDs) {
  return buildActivityGroupTargets(kind, INDUSTRY_ACTIVITY.REACTION, groupIDs);
}

const TARGET_MODIFIER_MAP = Object.freeze({
  2538: Object.freeze([
    Object.freeze({
      kind: "material",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 7,
    }),
  ]),
  2539: Object.freeze([
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 7,
    }),
  ]),
  2540: Object.freeze([
    Object.freeze({
      kind: "material",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 8,
    }),
  ]),
  2541: Object.freeze([
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 8,
    }),
  ]),
  2542: Object.freeze([
    Object.freeze({
      kind: "material",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 18,
    }),
    Object.freeze({
      kind: "material",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 87,
    }),
  ]),
  2543: Object.freeze([
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 18,
    }),
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 87,
    }),
  ]),
  2544: buildManufacturingGroupTargets("material", GROUPS_BASIC_SMALL_SHIPS),
  2545: buildManufacturingGroupTargets("time", GROUPS_BASIC_SMALL_SHIPS),
  2546: buildManufacturingGroupTargets("material", GROUPS_BASIC_MEDIUM_SHIPS),
  2547: buildManufacturingGroupTargets("time", GROUPS_BASIC_MEDIUM_SHIPS),
  2548: buildManufacturingGroupTargets("material", GROUPS_BASIC_LARGE_SHIPS),
  2549: buildManufacturingGroupTargets("time", GROUPS_BASIC_LARGE_SHIPS),
  2550: buildManufacturingGroupTargets("material", GROUPS_ADVANCED_SMALL_SHIPS),
  2551: buildManufacturingGroupTargets("time", GROUPS_ADVANCED_SMALL_SHIPS),
  2552: buildManufacturingGroupTargets("material", GROUPS_ADVANCED_MEDIUM_SHIPS),
  2553: buildManufacturingGroupTargets("time", GROUPS_ADVANCED_MEDIUM_SHIPS),
  2555: buildManufacturingGroupTargets("material", GROUPS_ADVANCED_LARGE_SHIPS),
  2556: buildManufacturingGroupTargets("time", GROUPS_ADVANCED_LARGE_SHIPS),
  2557: buildManufacturingGroupTargets("material", GROUPS_ADVANCED_COMPONENTS),
  2558: buildManufacturingGroupTargets("time", GROUPS_ADVANCED_COMPONENTS),
  2559: buildManufacturingGroupTargets("material", GROUPS_BASIC_CAPITAL_COMPONENTS),
  2560: buildManufacturingGroupTargets("time", GROUPS_BASIC_CAPITAL_COMPONENTS),
  2561: buildStructureManufacturingTargets("material"),
  2562: buildStructureManufacturingTargets("time"),
  2565: Object.freeze([
    Object.freeze({
      kind: "cost",
      activityID: INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
    }),
  ]),
  2566: Object.freeze([
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.RESEARCH_MATERIAL,
    }),
  ]),
  2567: Object.freeze([
    Object.freeze({
      kind: "cost",
      activityID: INDUSTRY_ACTIVITY.RESEARCH_TIME,
    }),
  ]),
  2568: Object.freeze([
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.RESEARCH_TIME,
    }),
  ]),
  2569: Object.freeze([
    Object.freeze({
      kind: "cost",
      activityID: INDUSTRY_ACTIVITY.COPYING,
    }),
  ]),
  2570: Object.freeze([
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.COPYING,
    }),
  ]),
  2575: buildManufacturingGroupTargets("material", GROUPS_CAPITAL_SHIPS),
  2576: buildManufacturingGroupTargets("time", GROUPS_CAPITAL_SHIPS),
  2591: Object.freeze([
    Object.freeze({
      kind: "time",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 6,
    }),
  ]),
  2592: Object.freeze([
    Object.freeze({
      kind: "material",
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      categoryID: 6,
    }),
  ]),
  2658: buildManufacturingGroupTargets("material", GROUPS_ADVANCED_CAPITAL_COMPONENTS),
  2659: buildManufacturingGroupTargets("time", GROUPS_ADVANCED_CAPITAL_COMPONENTS),
  2715: buildReactionTargets("time", [GROUP_REACTION_HYBRID_POLYMERS]),
  2716: buildReactionTargets("material", [GROUP_REACTION_HYBRID_POLYMERS]),
  2717: buildReactionTargets("time", [
    GROUP_REACTION_COMPOSITE_INTERMEDIATE,
    GROUP_REACTION_COMPOSITE,
    GROUP_REACTION_UNREFINED_MINERALS,
  ]),
  2718: buildReactionTargets("material", [
    GROUP_REACTION_COMPOSITE_INTERMEDIATE,
    GROUP_REACTION_COMPOSITE,
    GROUP_REACTION_UNREFINED_MINERALS,
  ]),
  2719: buildReactionTargets("time", [
    GROUP_REACTION_BIOCHEMICAL_MATERIAL,
    GROUP_REACTION_MOLECULAR_FORGED_MATERIALS,
  ]),
  2720: buildReactionTargets("material", [
    GROUP_REACTION_BIOCHEMICAL_MATERIAL,
    GROUP_REACTION_MOLECULAR_FORGED_MATERIALS,
  ]),
});

let typeDogmaPayload = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneActivityEntry(entry) {
  if (!Array.isArray(entry)) {
    return [[], [], [], [], [], []];
  }
  return [0, 1, 2, 3, 4, 5].map((index) => (
    Array.isArray(entry[index])
      ? entry[index].map((value) => (Array.isArray(value) ? [...value] : value))
      : []
  ));
}

function cloneActivities(activities = {}) {
  return Object.fromEntries(
    Object.entries(activities || {}).map(([activityID, entry]) => [
      activityID,
      cloneActivityEntry(entry),
    ]),
  );
}

function ensureActivityEntryShape(entry) {
  if (!Array.isArray(entry)) {
    return [[], [], [], [], [], []];
  }
  for (let index = 0; index < 6; index += 1) {
    if (!Array.isArray(entry[index])) {
      entry[index] = [];
    }
  }
  return entry;
}

function appendUniqueInt(values, value) {
  const numericValue = toInt(value, 0);
  if (numericValue <= 0 || !Array.isArray(values)) {
    return;
  }
  if (!values.some((candidate) => toInt(candidate, 0) === numericValue)) {
    values.push(numericValue);
  }
}

function getTypeDogmaPayload() {
  if (!typeDogmaPayload) {
    typeDogmaPayload = readStaticTable(TABLE.TYPE_DOGMA) || {};
  }
  return typeDogmaPayload;
}

function getTypeDogmaEntry(typeID) {
  const payload = getTypeDogmaPayload();
  return (
    payload &&
    payload.typesByTypeID &&
    payload.typesByTypeID[String(toInt(typeID, 0))]
  ) || null;
}

function getEffectDogmaEntry(effectID) {
  const payload = getTypeDogmaPayload();
  return (
    payload &&
    payload.effectTypesByID &&
    payload.effectTypesByID[String(toInt(effectID, 0))]
  ) || null;
}

function getDogmaAttributes(typeRecord) {
  return typeRecord && typeRecord.attributes && typeof typeRecord.attributes === "object"
    ? typeRecord.attributes
    : {};
}

function resolveStructureSecurityBand(structure) {
  const solarSystem = worldData.getSolarSystemByID(toInt(structure && structure.solarSystemID, 0));
  const security = toFloat(solarSystem && solarSystem.security, 0);
  if (security >= 0.45) {
    return "high";
  }
  if (security > 0) {
    return "low";
  }
  return "null";
}

function getRigSecurityMultiplier(attributes, securityBand) {
  if (securityBand === "high") {
    return toFloat(attributes[String(ATTRIBUTE_HISEC_MODIFIER)], 1);
  }
  if (securityBand === "low") {
    return toFloat(attributes[String(ATTRIBUTE_LOWSEC_MODIFIER)], 1);
  }
  return toFloat(attributes[String(ATTRIBUTE_NULLSEC_MODIFIER)], 1);
}

function getRigSourceAttribute(attributes, sourceAttributeID, securityBand) {
  const numericSourceAttributeID = toInt(sourceAttributeID, 0);
  const value = toFloat(attributes[String(numericSourceAttributeID)], 0);
  if (!SECURITY_SCALED_RIG_ATTRIBUTES.has(numericSourceAttributeID)) {
    return value;
  }
  return value * getRigSecurityMultiplier(attributes, securityBand);
}

function postPercentAmount(percent) {
  return Math.max(0, 1 + toFloat(percent, 0) / 100);
}

function appendActivityModifier(activities, target, amount, reference) {
  const activityID = toInt(target && target.activityID, 0);
  const modifierIndex = MODIFIER_INDEX[target && target.kind];
  if (activityID <= 0 || modifierIndex === undefined || !activities[String(activityID)]) {
    return false;
  }
  const entry = ensureActivityEntryShape(activities[String(activityID)]);
  const categoryID = toInt(target && target.categoryID, 0) || null;
  const groupID = toInt(target && target.groupID, 0) || null;
  const invTypeID = toInt(target && target.invTypeID, 0) || null;
  entry[modifierIndex].push([
    amount,
    categoryID,
    groupID,
    invTypeID,
    reference,
  ]);
  appendUniqueInt(entry[3], categoryID);
  appendUniqueInt(entry[4], groupID);
  appendUniqueInt(entry[5], invTypeID);
  return true;
}

function applyEngineeringHullModifiers(structure, activities) {
  const typeRecord = getTypeDogmaEntry(structure && structure.typeID);
  const attributes = getDogmaAttributes(typeRecord);
  const materialAmount = toFloat(attributes[String(ATTRIBUTE_ENGINEERING_HULL_MATERIAL)], 1);
  const timeAmount = toFloat(attributes[String(ATTRIBUTE_ENGINEERING_HULL_TIME)], 1);
  const costAmount = toFloat(attributes[String(ATTRIBUTE_ENGINEERING_HULL_COST)], 1);

  if (materialAmount > 0 && Math.abs(materialAmount - 1) > 1e-9) {
    appendActivityModifier(
      activities,
      {
        kind: "material",
        activityID: INDUSTRY_ACTIVITY.MANUFACTURING,
      },
      materialAmount,
      INDUSTRY_REFERENCE.HULL,
    );
  }

  for (const activityID of HULL_MODIFIER_ACTIVITIES) {
    if (timeAmount > 0 && Math.abs(timeAmount - 1) > 1e-9) {
      appendActivityModifier(
        activities,
        { kind: "time", activityID },
        timeAmount,
        INDUSTRY_REFERENCE.HULL,
      );
    }
    if (costAmount > 0 && Math.abs(costAmount - 1) > 1e-9) {
      appendActivityModifier(
        activities,
        { kind: "cost", activityID },
        costAmount,
        INDUSTRY_REFERENCE.HULL,
      );
    }
  }
}

function appendRigActivityID(rigModifiers, rigTypeID, activityID) {
  const key = String(toInt(rigTypeID, 0));
  if (!rigModifiers[key]) {
    rigModifiers[key] = [];
  }
  appendUniqueInt(rigModifiers[key], activityID);
}

function applyFittedRigModifiers(structure, activities) {
  const structureID = toInt(structure && structure.structureID, 0);
  if (structureID <= 0) {
    return {};
  }

  const rigModifiers = {};
  const securityBand = resolveStructureSecurityBand(structure);
  const fittedRigs = listContainerItems(null, structureID, null)
    .filter((item) => item && RIG_SLOT_FLAGS.includes(toInt(item.flagID, 0)));

  for (const rigItem of fittedRigs) {
    const rigTypeID = toInt(rigItem && rigItem.typeID, 0);
    const typeRecord = getTypeDogmaEntry(rigTypeID);
    const attributes = getDogmaAttributes(typeRecord);
    const effects = Array.isArray(typeRecord && typeRecord.effects)
      ? typeRecord.effects
      : [];

    for (const effectID of effects) {
      const effect = getEffectDogmaEntry(effectID);
      const modifierInfo = Array.isArray(effect && effect.modifierInfo)
        ? effect.modifierInfo
        : [];
      for (const modifier of modifierInfo) {
        if (
          !modifier ||
          modifier.domain !== "structureID" ||
          modifier.func !== "ItemModifier" ||
          toInt(modifier.operation, 0) !== 6
        ) {
          continue;
        }
        const targets = TARGET_MODIFIER_MAP[toInt(modifier.modifiedAttributeID, 0)];
        if (!targets) {
          continue;
        }
        const sourceValue = getRigSourceAttribute(
          attributes,
          modifier.modifyingAttributeID,
          securityBand,
        );
        const amount = postPercentAmount(sourceValue);
        if (!(amount > 0) || Math.abs(amount - 1) <= 1e-9) {
          continue;
        }
        for (const target of targets) {
          if (
            appendActivityModifier(
              activities,
              target,
              amount,
              INDUSTRY_REFERENCE.RIG,
            )
          ) {
            appendRigActivityID(rigModifiers, rigTypeID, target.activityID);
          }
        }
      }
    }
  }

  for (const activityIDs of Object.values(rigModifiers)) {
    activityIDs.sort((left, right) => left - right);
  }
  return rigModifiers;
}

function buildStructureIndustryFacilityModifiers(structure, activities = {}) {
  const nextActivities = cloneActivities(activities);
  applyEngineeringHullModifiers(structure, nextActivities);
  const rigModifiers = applyFittedRigModifiers(structure, nextActivities);
  return {
    activities: nextActivities,
    rigModifiers,
  };
}

function resetIndustryFacilityModifierCachesForTests() {
  typeDogmaPayload = null;
}

module.exports = {
  RIG_SLOT_FLAGS,
  buildStructureIndustryFacilityModifiers,
  resetIndustryFacilityModifierCachesForTests,
};
