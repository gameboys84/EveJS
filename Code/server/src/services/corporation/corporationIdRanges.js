/**
 * Pure ID-allocation range constants for custom (player) corporations and
 * alliances, plus the NPC starter corporation. Dependency-free on purpose: this
 * module loads no database or other services, so these canonical values can be
 * imported from anywhere — including tests that bind their own database — without
 * side effects. corporationState re-exports them for backwards compatibility.
 */

// The first custom corporation/alliance gets the start of its ID range, so these
// double as the player fixture corp/alliance IDs (see coreFixtureSeeder).
const CUSTOM_CORPORATION_ID_START = 98000000;
const CUSTOM_ALLIANCE_ID_START = 99000000;

// The NPC starter corporation new players belong to before joining a player corp.
const NPC_STARTER_CORPORATION_ID = 1000044;

module.exports = {
  CUSTOM_CORPORATION_ID_START,
  CUSTOM_ALLIANCE_ID_START,
  NPC_STARTER_CORPORATION_ID,
};
