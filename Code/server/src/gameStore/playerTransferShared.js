"use strict";

/**
 * Shared helpers for the player export/import tools
 * (exportPlayers.js / importPlayers.js).
 *
 * The export bundle is a faithful, corp-stripped snapshot that keeps every
 * ORIGINAL id. All id renumbering happens on the import side, where the target
 * server's identityAllocator hands out collision-proof ids. Keeping the bundle
 * in original-id space means one process owns remapping (import) and the bundle
 * stays diff-able against the source DB.
 */

const BUNDLE_VERSION = 1;

// Unit separator used by gameStore to explode `group<US>id` rows in SQLite.
const US = String.fromCharCode(31);

// EVE id conventions used to classify entities without an SDE lookup:
//   - player corporations live above NPC/faction ranges
//     (we use a safe 2,000,000 floor)
//   - NPC corps live in the ~1,000,000 range, factions in the 500,000 range
const PLAYER_CORP_FLOOR = 2000000;

// Default usernames treated as dev/test scaffolding (skipped unless overridden).
const DEFAULT_EXCLUDED_USERNAMES = ["test", "test2"];

// Fallback NPC corp for a stripped character whose employmentHistory has no NPC
// entry to fall back to. 1000060 = Native Freshfood (a real, always-present NPC
// corp). Override with --default-npc-corp.
const DEFAULT_NPC_CORP = 1000060;

// "Simple" per-character tables: the character owns exactly one row, keyed either
// directly by characterID (group:null) or as an exploded `group<US>characterID`
// row. On import these are rekeyed to the new characterID and any field in
// CHARID_FIELDS that equals the old characterID is rewritten. (skills, items,
// characters, mail and notifications are handled with dedicated logic instead.)
// `group` matches the table's wrapper key in ROW_GROUPS (sqliteStore.js); a null
// group means the row is keyed directly by characterID. Both shapes assemble in
// memory as obj[group][charID] / obj[charID], so import writes the same way.
const SIMPLE_CHAR_TABLES = [
  { table: "skillPlans", group: null },
  { table: "skillQueues", group: null },
  { table: "skillTradingState", group: null },
  { table: "characterExpertSystems", group: null },
  { table: "lpWallets", group: "characterWallets" },
  { table: "bookmarkKnownFolders", group: "recordsByCharacterID" },
  { table: "savedFittings", group: "owners" },
];

// Field names (anywhere in a record) that hold a characterID self-reference.
const CHARID_FIELDS = ["ownerID", "characterID", "creatorID", "charID"];

function makeExplodedKey(group, id) {
  return `${group}${US}${String(id)}`;
}

function parseExplodedKey(key) {
  const idx = key.indexOf(US);
  if (idx === -1) {
    return { group: null, id: key };
  }
  return { group: key.slice(0, idx), id: key.slice(idx + 1) };
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const truncated = Math.trunc(numeric);
  return truncated > 0 ? truncated : fallback;
}

function isPlayerCorp(corporationID, playerCorpIDSet) {
  const id = toPositiveInt(corporationID, 0);
  if (id <= 0) {
    return false;
  }
  if (playerCorpIDSet && playerCorpIDSet.has(id)) {
    return true;
  }
  return id >= PLAYER_CORP_FLOOR;
}

/**
 * Skill-entry itemIDs are deterministic, not allocated:
 *   characterID * 100000 + typeID
 * (mirrors buildSkillItemId in services/skills/skillState.js). Regenerated from
 * the new characterID on import.
 */
function buildSkillItemID(characterID, typeID) {
  return toPositiveInt(characterID, 0) * 100000 + toPositiveInt(typeID, 0);
}

module.exports = {
  BUNDLE_VERSION,
  US,
  PLAYER_CORP_FLOOR,
  DEFAULT_EXCLUDED_USERNAMES,
  DEFAULT_NPC_CORP,
  SIMPLE_CHAR_TABLES,
  CHARID_FIELDS,
  makeExplodedKey,
  parseExplodedKey,
  toPositiveInt,
  isPlayerCorp,
  buildSkillItemID,
};
