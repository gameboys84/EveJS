const path = require("path");

const {
  getCharacterSkills,
} = require(path.join(__dirname, "../../services/skills/skillState"));
const {
  buildSkillEffectiveAttributes,
  getAttributeIDByNames,
  getTypeEffectRecords,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));

const INDUSTRY_CHARACTER_ATTRIBUTE_IDS = new Set([
  196,
  219,
  385,
  387,
  398,
  467,
  1959,
  2662,
  2664,
]);
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_DAMAGE_MULTIPLIER = getAttributeIDByNames("damageMultiplier") || 64;
const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS =
  getAttributeIDByNames("damageMultiplierBonus") || 292;
const ATTRIBUTE_ROF_BONUS = getAttributeIDByNames("rofBonus") || 293;
const DOGMA_OP_POST_PERCENT = 6;
const DAMAGE_ATTRIBUTE_BY_SKILL_EFFECT_NAME = Object.freeze({
  missileemdmgbonus: ATTRIBUTE_EM_DAMAGE,
  missileexplosivedmgbonus: ATTRIBUTE_EXPLOSIVE_DAMAGE,
  missilekineticdmgbonus2: ATTRIBUTE_KINETIC_DAMAGE,
  missilethermaldmgbonus: ATTRIBUTE_THERMAL_DAMAGE,
});

const BRAIN_MODIFIER_TYPE_BY_FUNC = Object.freeze({
  ItemModifier: Object.freeze({
    modifierType: "M",
    buildExtras() {
      return [];
    },
  }),
  LocationModifier: Object.freeze({
    modifierType: "L",
    buildExtras() {
      return [];
    },
  }),
  LocationGroupModifier: Object.freeze({
    modifierType: "LG",
    buildExtras(modifierInfo) {
      const groupID = toInt(modifierInfo && modifierInfo.groupID, 0);
      return groupID > 0 ? [groupID] : null;
    },
  }),
  LocationRequiredSkillModifier: Object.freeze({
    modifierType: "LRS",
    buildExtras(modifierInfo) {
      const skillTypeID = toInt(modifierInfo && modifierInfo.skillTypeID, 0);
      return skillTypeID > 0 ? [skillTypeID] : null;
    },
  }),
  OwnerRequiredSkillModifier: Object.freeze({
    modifierType: "ORS",
    buildExtras(modifierInfo) {
      const skillTypeID = toInt(modifierInfo && modifierInfo.skillTypeID, 0);
      return skillTypeID > 0 ? [skillTypeID] : null;
    },
  }),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function getNormalizedBrainDomain(domain) {
  switch (String(domain || "")) {
    case "charID":
      return "character";
    case "shipID":
      return "ship";
    case "structureID":
      return "structure";
    default:
      return null;
  }
}

function normalizeSkillLevel(skill) {
  return Math.max(
    0,
    Math.min(
      5,
      toInt(
        skill &&
          (skill.effectiveSkillLevel ??
            skill.trainedSkillLevel ??
            skill.skillLevel),
        0,
      ),
    ),
  );
}

function shouldIncludeCharacterTargetAttribute(attributeID) {
  return !INDUSTRY_CHARACTER_ATTRIBUTE_IDS.has(toInt(attributeID, 0));
}

function buildFittingBrainEffectDefinition(skill, skillAttributes, modifierInfo) {
  const funcInfo =
    BRAIN_MODIFIER_TYPE_BY_FUNC[String(modifierInfo && modifierInfo.func) || ""] ||
    null;
  if (!funcInfo) {
    return null;
  }

  const domain = getNormalizedBrainDomain(modifierInfo && modifierInfo.domain);
  if (!domain) {
    return null;
  }

  const skillTypeID = toInt(skill && skill.typeID, 0);
  const targetAttributeID = toInt(modifierInfo && modifierInfo.modifiedAttributeID, 0);
  const sourceAttributeID = toInt(modifierInfo && modifierInfo.modifyingAttributeID, 0);
  const operation = toInt(modifierInfo && modifierInfo.operation, 0);
  if (skillTypeID <= 0 || targetAttributeID <= 0 || sourceAttributeID <= 0) {
    return null;
  }

  if (
    domain === "character" &&
    !shouldIncludeCharacterTargetAttribute(targetAttributeID)
  ) {
    return null;
  }

  const extras = funcInfo.buildExtras(modifierInfo);
  if (extras === null) {
    return null;
  }

  const value = toFiniteNumber(skillAttributes[sourceAttributeID], NaN);
  if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
    return null;
  }

  return {
    domain,
    skillTypeID,
    skills: [skillTypeID],
    targetAttributeID,
    operation,
    modifierType: funcInfo.modifierType,
    extras,
    value: round6(value),
  };
}

function buildRequiredSkillBrainEffect(
  skill,
  skillAttributes,
  targetAttributeID,
  sourceAttributeID,
  options = {},
) {
  const skillTypeID = toInt(skill && skill.typeID, 0);
  const targetID = toInt(targetAttributeID, 0);
  const sourceID = toInt(sourceAttributeID, 0);
  const modifierType = String(options.modifierType || "LRS");
  const domain = String(options.domain || "ship");
  if (skillTypeID <= 0 || targetID <= 0 || sourceID <= 0) {
    return null;
  }

  const value = toFiniteNumber(skillAttributes[sourceID], NaN);
  if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
    return null;
  }

  return {
    domain,
    skillTypeID,
    skills: [skillTypeID],
    targetAttributeID: targetID,
    operation: DOGMA_OP_POST_PERCENT,
    modifierType,
    extras: [skillTypeID],
    value: round6(value),
  };
}

function buildNamedFittingBrainEffectDefinition(skill, skillAttributes, effectRecord) {
  const normalizedEffectName = String(effectRecord && effectRecord.name || "")
    .trim()
    .toLowerCase();
  if (normalizedEffectName === "dronedmgbonus") {
    return buildRequiredSkillBrainEffect(
      skill,
      skillAttributes,
      ATTRIBUTE_DAMAGE_MULTIPLIER,
      ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS,
      {
        domain: "character",
        modifierType: "ORS",
      },
    );
  }

  const missileDamageAttributeID =
    DAMAGE_ATTRIBUTE_BY_SKILL_EFFECT_NAME[normalizedEffectName] || 0;
  if (missileDamageAttributeID > 0) {
    return buildRequiredSkillBrainEffect(
      skill,
      skillAttributes,
      missileDamageAttributeID,
      ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS,
    );
  }

  if (normalizedEffectName === "selfrof") {
    return buildRequiredSkillBrainEffect(
      skill,
      skillAttributes,
      ATTRIBUTE_SPEED,
      ATTRIBUTE_ROF_BONUS,
    );
  }

  return null;
}

function compareBrainEffectDefinitions(left, right) {
  return (
    toInt(left && left.skillTypeID, 0) - toInt(right && right.skillTypeID, 0) ||
    String(left && left.modifierType || "").localeCompare(
      String(right && right.modifierType || ""),
    ) ||
    toInt(left && left.targetAttributeID, 0) -
      toInt(right && right.targetAttributeID, 0) ||
    toInt(left && left.operation, 0) - toInt(right && right.operation, 0) ||
    JSON.stringify(Array.isArray(left && left.extras) ? left.extras : []).localeCompare(
      JSON.stringify(Array.isArray(right && right.extras) ? right.extras : []),
    ) ||
    toFiniteNumber(left && left.value, 0) - toFiniteNumber(right && right.value, 0)
  );
}

function buildFittingBrainEffectDefinitions(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      characterEffects: [],
      shipEffects: [],
      structureEffects: [],
    };
  }

  const definitions = {
    characterEffects: [],
    shipEffects: [],
    structureEffects: [],
  };

  for (const skill of getCharacterSkills(numericCharacterID)) {
    const skillTypeID = toInt(skill && skill.typeID, 0);
    if (skillTypeID <= 0 || normalizeSkillLevel(skill) <= 0) {
      continue;
    }

    const skillAttributes = buildSkillEffectiveAttributes(skill);
    for (const effectRecord of getTypeEffectRecords(skillTypeID)) {
      const namedDefinition = buildNamedFittingBrainEffectDefinition(
        skill,
        skillAttributes,
        effectRecord,
      );
      if (namedDefinition) {
        switch (namedDefinition.domain) {
          case "character":
            definitions.characterEffects.push(namedDefinition);
            break;
          case "ship":
            definitions.shipEffects.push(namedDefinition);
            break;
          case "structure":
            definitions.structureEffects.push(namedDefinition);
            break;
          default:
            break;
        }
      }

      for (const modifierInfo of effectRecord && effectRecord.modifierInfo || []) {
        const definition = buildFittingBrainEffectDefinition(
          skill,
          skillAttributes,
          modifierInfo,
        );
        if (!definition) {
          continue;
        }

        switch (definition.domain) {
          case "character":
            definitions.characterEffects.push(definition);
            break;
          case "ship":
            definitions.shipEffects.push(definition);
            break;
          case "structure":
            definitions.structureEffects.push(definition);
            break;
          default:
            break;
        }
      }
    }
  }

  definitions.characterEffects.sort(compareBrainEffectDefinitions);
  definitions.shipEffects.sort(compareBrainEffectDefinitions);
  definitions.structureEffects.sort(compareBrainEffectDefinitions);
  return definitions;
}

module.exports = {
  buildFittingBrainEffectDefinitions,
};
