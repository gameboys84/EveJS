function toNonNegativeBigInt(value, fallback = 0n) {
  try {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    if (typeof value === "bigint") {
      return value >= 0n ? value : fallback;
    }
    if (value && typeof value === "object" && value.type === "long") {
      return toNonNegativeBigInt(value.value, fallback);
    }
    const normalized = BigInt(String(value));
    return normalized >= 0n ? normalized : fallback;
  } catch (error) {
    return fallback;
  }
}

function nextPowerOfTwo(value) {
  let candidate = 1n;
  const minimum = toNonNegativeBigInt(value, 1n);
  while (candidate < minimum) {
    candidate <<= 1n;
  }
  return candidate;
}

function toStoredMaskValue(value) {
  const normalized = toNonNegativeBigInt(value, 0n);
  return normalized <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(normalized)
    : normalized.toString();
}

function toMarshalMaskValue(value) {
  const normalized = toNonNegativeBigInt(value, 0n);
  return normalized <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(normalized)
    : { type: "long", value: normalized };
}

function toLabelKey(value, fallback = null) {
  const normalized = toNonNegativeBigInt(value, 0n);
  return normalized > 0n ? normalized.toString() : fallback;
}

function allocateNextLabelID(labels = {}, nextLabelIDHint = 1) {
  const usedIDs = new Set(
    Object.keys(labels || {}).map((labelID) => toNonNegativeBigInt(labelID, 0n).toString()),
  );
  let labelID = nextPowerOfTwo(nextLabelIDHint);
  while (usedIDs.has(labelID.toString())) {
    labelID <<= 1n;
  }
  return {
    labelID: toMarshalMaskValue(labelID),
    labelKey: labelID.toString(),
    nextLabelID: toStoredMaskValue(labelID << 1n),
  };
}

function addLabelMask(currentMask, labelMask) {
  return toStoredMaskValue(
    toNonNegativeBigInt(currentMask, 0n) | toNonNegativeBigInt(labelMask, 0n),
  );
}

function removeLabelMask(currentMask, labelMask) {
  return toStoredMaskValue(
    toNonNegativeBigInt(currentMask, 0n) & ~toNonNegativeBigInt(labelMask, 0n),
  );
}

module.exports = {
  addLabelMask,
  allocateNextLabelID,
  removeLabelMask,
  toLabelKey,
  toMarshalMaskValue,
  toStoredMaskValue,
};
