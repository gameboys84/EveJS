const path = require("path");

const config = require(path.join(__dirname, "../../../config"));

// The five learning (mental) attributes. These are the only character
// attributes that drive skill training, so they are the only ones the
// training-speed multiplier scales for client display.
const MENTAL_ATTRIBUTE_IDS = Object.freeze([164, 165, 166, 167, 168]);

function getSkillTrainingSpeedMultiplier() {
  const numeric = Number(config.skillTrainingSpeed);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

// Scales the learning attributes the server reports to the client by the
// training-speed multiplier.
//
// The client computes its displayed per-skill and total-queue training times
// locally from these attributes (SP/min = primary + secondary/2) and has no
// knowledge of the server-side `skillTrainingSpeed` multiplier. Server SP
// accrual already applies that multiplier (see skillTrainingMath), so reporting
// the same factor on the learning attributes keeps the client's displayed
// estimates in sync with the authoritative training rate. Since the rate is
// linear in the attributes, scaling all five by the multiplier scales the
// computed SP/min by exactly the same factor, leaving CCP SP thresholds
// untouched.
//
// Mutates and returns the supplied attribute map; non-learning attributes are
// left untouched. At the retail default (multiplier 1) the map is returned
// unchanged.
function applyClientTrainingSpeedScale(attributes) {
  const multiplier = getSkillTrainingSpeedMultiplier();
  if (multiplier === 1 || !attributes || typeof attributes !== "object") {
    return attributes;
  }
  for (const attributeID of MENTAL_ATTRIBUTE_IDS) {
    const value = Number(attributes[attributeID]);
    if (Number.isFinite(value)) {
      attributes[attributeID] = value * multiplier;
    }
  }
  return attributes;
}

module.exports = {
  MENTAL_ATTRIBUTE_IDS,
  getSkillTrainingSpeedMultiplier,
  applyClientTrainingSpeedScale,
};
