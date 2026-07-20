"use strict";

const path = require("path");

const {
  buildDict,
  buildKeyVal,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const OBSERVED_TALE_TEMPLATE_CLASS_ID = 3;

// Recovered from MissionTQLogs OnTaleData notifications. These are active
// tale instance IDs only; the logs do not prove broader tale template rows.
const OBSERVED_TALE_IDS_BY_SOLAR_SYSTEM_ID = Object.freeze({
  30001363: Object.freeze([146846, 152503, 143607]),
  30002750: Object.freeze([143607, 147877, 146846, 152503]),
  30002751: Object.freeze([147877, 143607, 145069, 146846, 152503]),
  30002753: Object.freeze([147877, 152503, 145069, 117172, 143607, 146846]),
});

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

function getObservedTaleIDsForSolarSystem(solarSystemID) {
  const normalizedSolarSystemID = normalizePositiveInteger(solarSystemID, 0);
  return (
    OBSERVED_TALE_IDS_BY_SOLAR_SYSTEM_ID[normalizedSolarSystemID] || []
  ).slice();
}

function normalizeTaleIDs(taleIDs, solarSystemID) {
  const observedIDs = new Set(getObservedTaleIDsForSolarSystem(solarSystemID));
  if (observedIDs.size === 0) {
    return [];
  }
  const sourceIDs = Array.isArray(taleIDs) && taleIDs.length > 0
    ? taleIDs
    : [...observedIDs];
  return [...new Set(
    sourceIDs
      .map((taleID) => normalizePositiveInteger(taleID, 0))
      .filter((taleID) => taleID > 0 && observedIDs.has(taleID)),
  )];
}

function buildObservedTaleKeyVal(solarSystemID, taleID) {
  const normalizedSolarSystemID = normalizePositiveInteger(solarSystemID, 0);
  const normalizedTaleID = normalizePositiveInteger(taleID, 0);
  return buildKeyVal([
    ["templateClassID", OBSERVED_TALE_TEMPLATE_CLASS_ID],
    ["locationID", normalizedSolarSystemID],
    ["taleID", normalizedTaleID],
  ]);
}

function buildObservedTalesDict(solarSystemID, taleIDs = null) {
  const normalizedSolarSystemID = normalizePositiveInteger(solarSystemID, 0);
  if (!normalizedSolarSystemID) {
    return buildDict([]);
  }

  return buildDict(
    normalizeTaleIDs(taleIDs, normalizedSolarSystemID).map((taleID) => [
      taleID,
      buildObservedTaleKeyVal(normalizedSolarSystemID, taleID),
    ]),
  );
}

module.exports = {
  OBSERVED_TALE_IDS_BY_SOLAR_SYSTEM_ID,
  OBSERVED_TALE_TEMPLATE_CLASS_ID,
  buildObservedTaleKeyVal,
  buildObservedTalesDict,
  getObservedTaleIDsForSolarSystem,
};
