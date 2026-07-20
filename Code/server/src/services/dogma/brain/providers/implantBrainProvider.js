const path = require("path");

const {
  getImplantBrainEffectDefinitions,
  syncImplantCharacterModifiers,
} = require(path.join(__dirname, "../../implants/activeImplantModifiers"));

function buildCharacterEffects(characterID) {
  return getImplantBrainEffectDefinitions(characterID).characterEffects;
}

function buildShipEffects(characterID) {
  return getImplantBrainEffectDefinitions(characterID).shipEffects;
}

function buildStructureEffects(characterID) {
  return getImplantBrainEffectDefinitions(characterID).structureEffects;
}

const IMPLANT_BRAIN_PROVIDER = Object.freeze({
  key: "implants",
  buildCharacterEffects,
  buildShipEffects,
  buildStructureEffects,
  syncCharacterAttributeState: syncImplantCharacterModifiers,
});

module.exports = {
  IMPLANT_BRAIN_PROVIDER,
  buildCharacterEffects,
  buildShipEffects,
  buildStructureEffects,
};
