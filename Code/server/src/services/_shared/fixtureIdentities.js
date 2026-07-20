/**
 * Fixture identity registry.
 *
 * The local development world ships a small set of canonical fixtures (the
 * bootstrap characters, the player corporation, its alliance). Historically
 * code and tests referenced these by their literal IDs (140000001, 98000000,
 * ...), which is fragile: the IDs are an implementation detail of the seeder and
 * could differ between deployments or become dynamically allocated.
 *
 * This module is the single place consumers ask "who is the canonical X". It
 * addresses entities by ROLE and resolves the real, current identity from the
 * seeded world, so nothing downstream binds to a literal ID. The seeder
 * (corporation/coreFixtureSeeder) remains the sole OWNER of the literals; this
 * registry is the consumer-facing facade that resolves them.
 *
 * Usage (runtime or test):
 *   const { FIXTURE_ROLE, getFixtureIdentity } = require(".../fixtureIdentities");
 *   const ceo = getFixtureIdentity(FIXTURE_ROLE.PLAYER_CEO);
 *   ceo.characterID; ceo.accountID; ceo.corporationID; ceo.allianceID;
 */

const path = require("path");

const {
  peekCharacterRecord,
} = require(path.join(__dirname, "..", "character", "characterState"));
const {
  NPC_STARTER_CORPORATION_ID,
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "..", "corporation", "corporationState"));
const seeder = require(path.join(
  __dirname,
  "..",
  "corporation",
  "coreFixtureSeeder",
));

// Symbolic roles. Consumers reference these, never the underlying IDs.
const FIXTURE_ROLE = Object.freeze({
  PLAYER_CEO: "playerCeo",
  PLAYER_MEMBER: "playerMember",
  GM: "gm",
  ALT_ACCOUNT_CHARACTER: "altAccountCharacter",
  PLAYER_CORP: "playerCorp",
  PLAYER_ALLIANCE: "playerAlliance",
  NPC_STARTER_CORP: "npcStarterCorp",
});

// Each role anchors to an entity the seeder owns. The literal lives once, in the
// seeder; here we only reference its exported constant. Derived facts (account,
// corp, alliance) are resolved from the seeded record at call time.
const ROLE_ANCHORS = Object.freeze({
  [FIXTURE_ROLE.PLAYER_CEO]: {
    kind: "character",
    id: seeder.PLAYER_CEO_CHARACTER_ID,
  },
  [FIXTURE_ROLE.PLAYER_MEMBER]: {
    kind: "character",
    id: seeder.PLAYER_MEMBER_CHARACTER_ID,
  },
  [FIXTURE_ROLE.GM]: {
    kind: "character",
    id: seeder.GM_CHARACTER_ID,
  },
  [FIXTURE_ROLE.ALT_ACCOUNT_CHARACTER]: {
    kind: "character",
    id: seeder.ALT_ACCOUNT_CHARACTER_ID,
  },
  [FIXTURE_ROLE.PLAYER_CORP]: {
    kind: "corporation",
    id: seeder.PLAYER_CORPORATION_ID,
  },
  [FIXTURE_ROLE.PLAYER_ALLIANCE]: {
    kind: "alliance",
    id: seeder.PLAYER_ALLIANCE_ID,
  },
  // The NPC starter corp is static data (not minted by the seeder); anchor to
  // the shared corporationState constant and resolve from the corporations table.
  [FIXTURE_ROLE.NPC_STARTER_CORP]: {
    kind: "corporation",
    id: NPC_STARTER_CORPORATION_ID,
  },
});

function toPositiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function resolveCharacterIdentity(role, characterID) {
  const record = peekCharacterRecord(characterID) || {};
  return {
    role,
    kind: "character",
    characterID: toPositiveInteger(characterID),
    accountID: toPositiveInteger(record.accountId),
    corporationID: toPositiveInteger(record.corporationID),
    allianceID: toPositiveInteger(record.allianceID) || null,
  };
}

function resolveCorporationIdentity(role, corporationID) {
  const record = getCorporationRecord(corporationID) || {};
  return {
    role,
    kind: "corporation",
    corporationID: toPositiveInteger(corporationID),
    allianceID: toPositiveInteger(record.allianceID) || null,
    ceoCharacterID: toPositiveInteger(record.ceoID) || null,
  };
}

function resolveAllianceIdentity(role, allianceID) {
  const record = getAllianceRecord(allianceID) || {};
  return {
    role,
    kind: "alliance",
    allianceID: toPositiveInteger(allianceID),
    executorCorporationID:
      toPositiveInteger(record.executorCorporationID || record.executorCorpID) ||
      null,
  };
}

/**
 * Resolve a single role to its current identity in the seeded world.
 * Returns null for an unknown role. Does NOT seed; pair with ensureFixtures()
 * (or getFixtureManifest, which seeds by default) when the world may be empty.
 *
 * @param {string} role one of FIXTURE_ROLE
 * @returns {object|null}
 */
function resolveFixtureIdentity(role) {
  const anchor = ROLE_ANCHORS[role];
  if (!anchor) {
    return null;
  }
  if (anchor.kind === "character") {
    return resolveCharacterIdentity(role, anchor.id);
  }
  if (anchor.kind === "corporation") {
    return resolveCorporationIdentity(role, anchor.id);
  }
  return resolveAllianceIdentity(role, anchor.id);
}

/**
 * Ensure the canonical fixtures exist, then resolve a role. This is the entry
 * point for callers that need the identity to be valid (seeds on demand).
 *
 * @param {string} role one of FIXTURE_ROLE
 * @returns {object|null}
 */
function getFixtureIdentity(role) {
  seeder.ensureCoreFixtures();
  return resolveFixtureIdentity(role);
}

/**
 * Ensure fixtures (unless { ensure: false }) and return every role resolved.
 *
 * @param {{ensure?: boolean}} [options]
 * @returns {Record<string, object>}
 */
function getFixtureManifest(options = {}) {
  if (options.ensure !== false) {
    seeder.ensureCoreFixtures();
  }
  const manifest = {};
  for (const role of Object.values(FIXTURE_ROLE)) {
    manifest[role] = resolveFixtureIdentity(role);
  }
  return manifest;
}

module.exports = {
  FIXTURE_ROLE,
  getFixtureIdentity,
  getFixtureManifest,
  resolveFixtureIdentity,
};
