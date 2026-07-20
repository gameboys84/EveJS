const path = require("path");

const config = require(path.join(__dirname, "../../config"));

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampCostIndex(value) {
  const numeric = toFloat(value, 0);
  if (!(numeric > 0)) {
    return 0;
  }
  return numeric > 1 ? 1 : numeric;
}

/**
 * Option A static approximation of EVE's industry system cost index.
 *
 * Live EVE tracks a separate cost index per solar system and per activity,
 * derived from the rolling estimated-item-value of jobs installed in that
 * system. This server does not track that telemetry yet (map.GetIndustryJobs
 * OverLast24Hours returns no history), so a single configurable index stands
 * in for the whole cluster.
 *
 * The (solarSystemID, activityID) signature is intentional: it is the seam a
 * future dynamic tracker (Option B) can fill in without touching the quote or
 * map call sites. For now both arguments are accepted and the flat configured
 * index is returned for every system and activity.
 *
 * See doc/PARITY_FEATURE_ROADMAP.md for the parity notes.
 */
function resolveSystemCostIndex(solarSystemID, activityID) {
  return clampCostIndex(config.industrySystemCostIndex);
}

module.exports = {
  clampCostIndex,
  resolveSystemCostIndex,
};
