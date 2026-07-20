const path = require("path");

const {
  getTypeEffectRecords,
  isPassiveModifierSource,
  appendSelfItemModifierEntries,
  appendLocationModifierEntries,
  buildEffectiveItemAttributeMap,
  isStructureDogmaHost,
  resolveDogmaSkillMapForHost,
  applyModifierGroups,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildSkillEffectiveAttributes,
  collectShipModifierAttributes,
} = require(path.join(__dirname, "../combat/weaponDogma"));
const {
  buildNpcEffectiveModuleItem,
} = require(path.join(__dirname, "../npc/npcCapabilityResolver"));

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildLiveModuleAttributeMap(
  shipItem,
  moduleItem,
  chargeItem,
  skillMap,
  fittedItems,
  activeModuleContexts,
  options = {},
) {
  if (!shipItem || !moduleItem) {
    return null;
  }

  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const attributes = buildEffectiveItemAttributeMap(effectiveModuleItem, chargeItem);
  const modifierEntries = [];
  const isStructureHost = isStructureDogmaHost(shipItem);
  const resolvedSkillMap = resolveDogmaSkillMapForHost(0, shipItem, {
    skillMap: skillMap instanceof Map ? skillMap : new Map(),
  });
  const resolvedFittedItems = Array.isArray(fittedItems) ? fittedItems : [];
  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];
  const additionalLocationModifierSources = Array.isArray(
    options.additionalLocationModifierSources,
  )
    ? options.additionalLocationModifierSources
    : [];
  const additionalShipModifierEntries = !isStructureHost && Array.isArray(
    options.additionalShipModifierEntries,
  )
    ? options.additionalShipModifierEntries
    : [];
  const hiddenModifierItems = Array.isArray(options.hiddenModifierItems)
    ? options.hiddenModifierItems
    : null;
  const locationModifierDomains = isStructureHost
    ? new Set(["structureID", "charID"])
    : new Set(["shipID", "charID"]);
  const shipModifierAttributes = collectShipModifierAttributes(
    shipItem,
    resolvedSkillMap,
    resolvedActiveModuleContexts,
    {
      fittedItems: resolvedFittedItems,
      additionalDirectModifierEntries: additionalShipModifierEntries,
      ...(hiddenModifierItems ? { hiddenModifierItems } : {}),
    },
  );

  for (const skillRecord of resolvedSkillMap.values()) {
    appendLocationModifierEntries(
      modifierEntries,
      buildSkillEffectiveAttributes(skillRecord),
      getTypeEffectRecords(skillRecord.typeID),
      "skill",
      effectiveModuleItem,
      { allowedDomains: locationModifierDomains },
    );
  }

  appendLocationModifierEntries(
    modifierEntries,
    shipModifierAttributes,
    getTypeEffectRecords(shipItem.typeID),
    "ship",
    effectiveModuleItem,
    { allowedDomains: locationModifierDomains },
  );

  for (const fittedItem of resolvedFittedItems) {
    if (
      !isPassiveModifierSource(fittedItem) ||
      toInt(fittedItem && fittedItem.itemID, 0) === toInt(moduleItem.itemID, 0)
    ) {
      continue;
    }

    const effectiveFittedItem = buildNpcEffectiveModuleItem(fittedItem);
    appendLocationModifierEntries(
      modifierEntries,
      buildEffectiveItemAttributeMap(effectiveFittedItem),
      getTypeEffectRecords(effectiveFittedItem.typeID),
      "fittedModule",
      effectiveModuleItem,
      { allowedDomains: locationModifierDomains },
    );
  }

  for (const activeModuleContext of resolvedActiveModuleContexts) {
    const activeModuleItem = buildNpcEffectiveModuleItem(
      activeModuleContext && activeModuleContext.moduleItem,
    );
    const activeEffectRecord =
      activeModuleContext && activeModuleContext.effectRecord
        ? activeModuleContext.effectRecord
        : null;
    if (!activeModuleItem || !activeEffectRecord) {
      continue;
    }

    if (
      (
        activeModuleContext &&
        activeModuleContext.effectState &&
        activeModuleContext.effectState.isOverload === true
      ) ||
      toInt(activeEffectRecord.effectCategoryID, 0) === 5
    ) {
      if (
        toInt(activeModuleItem.itemID, 0) ===
        toInt(effectiveModuleItem.itemID || moduleItem.itemID, 0)
      ) {
        appendSelfItemModifierEntries(
          modifierEntries,
          buildEffectiveItemAttributeMap(
            activeModuleItem,
            activeModuleContext && activeModuleContext.chargeItem,
          ),
          [activeEffectRecord],
          "fittedModule",
        );
      }
    }

    appendLocationModifierEntries(
      modifierEntries,
      buildEffectiveItemAttributeMap(
        activeModuleItem,
        activeModuleContext && activeModuleContext.chargeItem,
      ),
      [activeEffectRecord],
      "fittedModule",
      effectiveModuleItem,
      { allowedDomains: locationModifierDomains },
    );
  }

  for (const source of isStructureHost ? [] : additionalLocationModifierSources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    appendLocationModifierEntries(
      modifierEntries,
      source.sourceAttributes,
      source.sourceEffects,
      String(source.sourceKind || "system"),
      effectiveModuleItem,
      { allowedDomains: locationModifierDomains },
    );
  }

  applyModifierGroups(attributes, modifierEntries);
  return attributes;
}

module.exports = {
  buildLiveModuleAttributeMap,
};
