const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

const HEAT_ATTRIBUTE_MED = 1176;
const HEAT_ATTRIBUTE_LOW = 1177;
const HEAT_ATTRIBUTE_HI = 1175;
const ACTIVATION_HEAT_ATTRIBUTES = Object.freeze([
  HEAT_ATTRIBUTE_MED,
  HEAT_ATTRIBUTE_LOW,
  HEAT_ATTRIBUTE_HI,
]);

function currentFileTime() {
  return BigInt(Date.now()) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function buildActivationHeatStateTuple(timestamp = currentFileTime()) {
  return [
    0.0,
    100.0,
    0,
    1.0,
    0.01,
    timestamp,
  ];
}

function buildActivationHeatStateDict(timestamp = currentFileTime()) {
  return {
    type: "dict",
    entries: ACTIVATION_HEAT_ATTRIBUTES.map((attributeID) => [
      attributeID,
      buildActivationHeatStateTuple(timestamp),
    ]),
  };
}

module.exports = {
  ACTIVATION_HEAT_ATTRIBUTES,
  buildActivationHeatStateDict,
  buildActivationHeatStateTuple,
};
