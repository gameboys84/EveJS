/**
 * Core fixture seeder.
 *
 * The local development database ships a small set of canonical fixtures that
 * a number of services and tests assume always exist:
 *   - the bootstrap player characters (140000001-140000004),
 *   - the first custom player corporation (98000000), and
 *   - that corporation's alliance (99000000).
 *
 * Regenerating or pruning the local database can drop these, which leaves
 * dependent write paths (member updates, alliance relationships, ...) with no
 * live records to act on. This seeder recreates whichever pieces are missing
 * and is fully idempotent: existing records are left untouched.
 *
 * It is invoked on server startup (see server/index.js) and by tests that
 * exercise the player-corp/alliance write paths, so both paths get the same
 * canonical world.
 */

const path = require("path");
const log = require(path.join(__dirname, "..", "..", "utils", "logger"));
const database = require(path.join(__dirname, "..", "..", "gameStore"));
const {
  peekCharacterRecord,
  writeCharacterRecord,
} = require(path.join(__dirname, "..", "character", "characterState"));
const {
  CUSTOM_ALLIANCE_ID_START,
  CUSTOM_CORPORATION_ID_START,
  createCustomAllianceForCorporation,
  createCustomCorporation,
  getAllianceRecord,
  getCorporationRecord,
  setCharacterAffiliation,
  setCorporationAlliance,
} = require(path.join(__dirname, "corporationState"));

const CORPORATIONS_TABLE = "corporations";
const ALLIANCES_TABLE = "alliances";

// The player fixture corporation and alliance are the first custom-ID records,
// so they derive from the allocation range starts (owned by corporationState)
// rather than restating a literal.
const PLAYER_CORPORATION_ID = CUSTOM_CORPORATION_ID_START;
const PLAYER_ALLIANCE_ID = CUSTOM_ALLIANCE_ID_START;
// The seeder is the single owner of the canonical fixture IDs. Everything else
// addresses these entities by role through services/_shared/fixtureIdentities and
// resolves the real, current identity from the seeded world — so no consumer
// binds to a literal. If these IDs ever change (or become dynamically allocated),
// this module is the only place that needs to know.
const PLAYER_CEO_CHARACTER_ID = 140000003;
const PLAYER_MEMBER_CHARACTER_ID = 140000002;
// The "alt account" bootstrap character intentionally belongs to a different
// account than the player CEO/member, so it exercises cross-account paths.
const ALT_ACCOUNT_CHARACTER_ID = 140000001;
const GM_CHARACTER_ID = 140000004;
// Names carry the "Elysian" project theme; lookup/search parity tests resolve
// the player corp by an "Elysian" substring match and the alliance by a
// whitespace-insensitive exact match (so its name must collapse to "elysian").
const PLAYER_CORPORATION_NAME = "Elysian Industries";
const PLAYER_ALLIANCE_NAME = "Elysian";

function loadCanonicalCharacters() {
  // DatabaseCreator owns the canonical local bootstrap character shapes. Pull
  // it in lazily (and only when a character is actually missing) so the build
  // tool is not loaded on every startup or wired into the require graph early.
  const databaseCreator = require(path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "tools",
    "DatabaseCreator",
    "database-creator.js",
  ));
  const built = databaseCreator.buildLocalAccountsAndCharacters();
  return (built && built.characters) || {};
}

const CANONICAL_CHARACTER_IDS = [
  ALT_ACCOUNT_CHARACTER_ID,
  PLAYER_MEMBER_CHARACTER_ID,
  PLAYER_CEO_CHARACTER_ID,
  GM_CHARACTER_ID,
];

function ensureCanonicalCharacters() {
  const created = [];
  const missing = CANONICAL_CHARACTER_IDS.filter(
    (characterID) => !peekCharacterRecord(characterID),
  );
  if (missing.length === 0) {
    return created;
  }

  const canonical = loadCanonicalCharacters();
  for (const characterID of missing) {
    const record = canonical[String(characterID)];
    if (!record) {
      continue;
    }
    writeCharacterRecord(characterID, record);
    created.push(characterID);
  }
  return created;
}

function positionCustomCounter(tableName, metaKey, targetID) {
  // createCustom* mint the next custom ID from the table meta, so to land the
  // canonical bootstrap record on its fixed ID we point the counter directly at
  // it. This is only called when that record is missing, and the bootstrap IDs
  // are the first custom IDs, so forcing the counter does not collide with
  // higher player-created records.
  database.ensureTable(tableName);
  const result = database.read(tableName, "/");
  const table =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : { _meta: {}, records: {} };
  table._meta = table._meta && typeof table._meta === "object" ? table._meta : {};
  table._meta[metaKey] = targetID;
  database.write(tableName, "/", table, { force: true });
}

function ensurePlayerCorporation() {
  if (getCorporationRecord(PLAYER_CORPORATION_ID)) {
    return false;
  }
  positionCustomCounter(
    CORPORATIONS_TABLE,
    "nextCustomCorporationID",
    PLAYER_CORPORATION_ID,
  );
  const result = createCustomCorporation(
    PLAYER_CEO_CHARACTER_ID,
    PLAYER_CORPORATION_NAME,
  );
  if (!result || !result.success) {
    log.warn(
      `[CoreFixtures] Failed to seed player corporation ${PLAYER_CORPORATION_ID}: ${
        (result && result.errorMsg) || "UNKNOWN"
      }`,
    );
    return false;
  }
  return true;
}

function ensurePlayerAlliance() {
  if (getAllianceRecord(PLAYER_ALLIANCE_ID)) {
    // Already present; make sure the corporation still belongs to it.
    const corporation = getCorporationRecord(PLAYER_CORPORATION_ID);
    if (corporation && Number(corporation.allianceID) !== PLAYER_ALLIANCE_ID) {
      setCorporationAlliance(PLAYER_CORPORATION_ID, PLAYER_ALLIANCE_ID);
    }
    return false;
  }
  positionCustomCounter(
    ALLIANCES_TABLE,
    "nextCustomAllianceID",
    PLAYER_ALLIANCE_ID,
  );
  const result = createCustomAllianceForCorporation(
    PLAYER_CEO_CHARACTER_ID,
    PLAYER_CORPORATION_ID,
    PLAYER_ALLIANCE_NAME,
  );
  if (!result || !result.success) {
    log.warn(
      `[CoreFixtures] Failed to seed player alliance ${PLAYER_ALLIANCE_ID}: ${
        (result && result.errorMsg) || "UNKNOWN"
      }`,
    );
    return false;
  }
  return true;
}

/**
 * Recreate any missing canonical fixtures (characters, player corporation,
 * player alliance, CEO membership). Idempotent and safe to call repeatedly.
 *
 * @returns {{charactersCreated:number[],corporationCreated:boolean,allianceCreated:boolean}}
 */
function ensureCoreFixtures() {
  const summary = {
    charactersCreated: [],
    corporationCreated: false,
    allianceCreated: false,
  };

  summary.charactersCreated = ensureCanonicalCharacters();
  summary.corporationCreated = ensurePlayerCorporation();

  // Guarantee the CEO is a live member of the player corporation. createCustom*
  // already affiliate the CEO when they create the corp, but on a partially
  // seeded database (corp present, CEO not yet a member) this fills the gap and
  // carries the alliance affiliation through.
  if (getCorporationRecord(PLAYER_CORPORATION_ID)) {
    setCharacterAffiliation(
      PLAYER_CEO_CHARACTER_ID,
      PLAYER_CORPORATION_ID,
      PLAYER_ALLIANCE_ID,
    );
  }

  summary.allianceCreated = ensurePlayerAlliance();

  return summary;
}

module.exports = {
  ensureCoreFixtures,
  PLAYER_CORPORATION_ID,
  PLAYER_ALLIANCE_ID,
  PLAYER_CEO_CHARACTER_ID,
  PLAYER_MEMBER_CHARACTER_ID,
  ALT_ACCOUNT_CHARACTER_ID,
  GM_CHARACTER_ID,
};
