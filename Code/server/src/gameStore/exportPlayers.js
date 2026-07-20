#!/usr/bin/env node
"use strict";

/**
 * Export real player accounts (+ their characters and per-character data) from a
 * gameStore SQLite DB into a portable, corp-stripped JSON bundle.
 *
 * The source DB is opened READ-ONLY (no gameStore require, no WAL write), so this
 * is safe to run even while the source server is live. All ids in the bundle stay
 * in their ORIGINAL space — renumbering is done by importPlayers.js against the
 * target's identityAllocator.
 *
 * Corp data is stripped here: a character in a player corp is reassigned to an NPC
 * corp, alliance/title cleared, employment history reduced to the NPC corp, and
 * standings entries that reference the stripped player corp are dropped. Corp
 * tables and corp-owned items are never exported.
 *
 * Usage:
 *   node src/gameStore/exportPlayers.js
 *   node src/gameStore/exportPlayers.js --source <dataDir> --out bundle.json
 *   node src/gameStore/exportPlayers.js --source-sqlite path/to/gamestore.sqlite
 *   node src/gameStore/exportPlayers.js --include rrfarmer,rrfarmerAdmin
 *   node src/gameStore/exportPlayers.js --exclude test,test2 --default-npc-corp 1000060
 *
 * Source resolution (sqlite): --source-sqlite, else <--source|$EVEJS_GAMESTORE_DATA_DIR|
 * _local/gameStore/data>/../gamestore.sqlite.
 */

const fs = require("fs");
const path = require("path");

const Database = require(path.join(
  __dirname,
  "..",
  "..",
  "node_modules",
  "better-sqlite3",
));
const shared = require("./playerTransferShared");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function parseArgs(argv) {
  const opts = {
    sourceSqlite: null,
    sourceDataDir: null,
    out: null,
    include: null,
    exclude: null,
    defaultNpcCorp: shared.DEFAULT_NPC_CORP,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--source-sqlite":
        opts.sourceSqlite = next();
        break;
      case "--source":
        opts.sourceDataDir = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--include":
        opts.include = String(next() || "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--exclude":
        opts.exclude = String(next() || "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--default-npc-corp":
        opts.defaultNpcCorp = shared.toPositiveInt(next(), shared.DEFAULT_NPC_CORP);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        opts.help = true;
    }
  }
  return opts;
}

function resolveSqlitePath(opts) {
  if (opts.sourceSqlite) {
    return path.resolve(opts.sourceSqlite);
  }
  const dataDir =
    opts.sourceDataDir ||
    process.env.EVEJS_GAMESTORE_DATA_DIR ||
    path.join(REPO_ROOT, "_local", "gameStore", "data");
  return path.resolve(dataDir, "..", "gamestore.sqlite");
}

function printHelp() {
  console.log(
    [
      "Export real player accounts to a corp-stripped JSON bundle.",
      "",
      "Usage:",
      "  node src/gameStore/exportPlayers.js [options]",
      "",
      "Options:",
      "  --source <dataDir>        gameStore data dir (sqlite is <dir>/../gamestore.sqlite)",
      "  --source-sqlite <path>    explicit path to the source gamestore.sqlite",
      "  --out <file>              output bundle path (default _local/export/players-<ts>.json)",
      "  --include a,b             only these usernames",
      "  --exclude a,b             skip these usernames (default: test,test2)",
      "  --default-npc-corp <id>   NPC corp for stripped chars w/o NPC history (default 1000060)",
    ].join("\n"),
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const sqlitePath = resolveSqlitePath(opts);
  if (!fs.existsSync(sqlitePath)) {
    console.error(`Source SQLite not found: ${sqlitePath}`);
    process.exitCode = 1;
    return;
  }

  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });

  // ── tiny read helpers over the (key TEXT, json TEXT) row shape ──────────
  const stmtCache = {};
  function allRows(table) {
    try {
      const stmt =
        stmtCache[table] ||
        (stmtCache[table] = db.prepare(`SELECT key, json FROM "${table}"`));
      return stmt.all().map((r) => ({ key: r.key, value: JSON.parse(r.json) }));
    } catch (_) {
      return []; // table may not exist in this DB
    }
  }
  function rowByKey(table, key) {
    try {
      const row = db
        .prepare(`SELECT json FROM "${table}" WHERE key = ?`)
        .get(key);
      return row ? JSON.parse(row.json) : null;
    } catch (_) {
      return null;
    }
  }

  // Player corps are detected purely by id range (>= PLAYER_CORP_FLOOR). Note:
  // corporationRuntime is NOT a usable signal — it holds rows for every NPC corp
  // too, so membership there does not imply a player corp.

  // ── pick accounts ───────────────────────────────────────────────────────
  const accounts = allRows("accounts"); // key = username
  const excluded = new Set(
    (opts.exclude || shared.DEFAULT_EXCLUDED_USERNAMES).map((s) => s.toLowerCase()),
  );
  const includeSet = opts.include
    ? new Set(opts.include.map((s) => s.toLowerCase()))
    : null;

  // ── index characters by accountId ────────────────────────────────────────
  const charactersByAccount = new Map();
  for (const { key, value } of allRows("characters")) {
    const accountId = shared.toPositiveInt(value && value.accountId, 0);
    if (accountId <= 0) {
      continue; // orphan / bot / fixture without an owning account
    }
    if (!charactersByAccount.has(accountId)) {
      charactersByAccount.set(accountId, []);
    }
    charactersByAccount.get(accountId).push({ characterID: key, record: value });
  }

  const bundle = {
    bundleVersion: shared.BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source: { sqlitePath },
    accounts: [],
  };

  let charCount = 0;
  for (const { key: username, value: account } of accounts) {
    if (includeSet) {
      if (!includeSet.has(username.toLowerCase())) continue;
    } else if (excluded.has(username.toLowerCase())) {
      continue;
    }
    const accountId = shared.toPositiveInt(account && account.id, 0);
    const chars = charactersByAccount.get(accountId) || [];
    if (chars.length === 0) {
      console.log(`  - skip account "${username}" (no characters)`);
      continue;
    }

    const accountEntry = { username, account, characters: [] };
    for (const { characterID, record } of chars) {
      accountEntry.characters.push(
        exportCharacter(characterID, record, {
          playerCorpIDs: null,
          defaultNpcCorp: opts.defaultNpcCorp,
          rowByKey,
          allRows,
        }),
      );
      charCount += 1;
    }
    bundle.accounts.push(accountEntry);
    console.log(
      `  + account "${username}" (id ${accountId}) — ${chars.length} character(s)`,
    );
  }

  db.close();

  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(
        REPO_ROOT,
        "_local",
        "export",
        `players-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));

  console.log(
    `\nExported ${bundle.accounts.length} account(s), ${charCount} character(s) → ${outPath}`,
  );
}

/**
 * Build the per-character bundle entry, performing corp stripping on the record.
 */
function exportCharacter(characterID, record, ctx) {
  const charID = shared.toPositiveInt(characterID, 0);
  const strip = stripCorpData(record, ctx.playerCorpIDs, ctx.defaultNpcCorp);

  const entry = {
    originalCharacterID: charID,
    characterName: record.characterName || null,
    strip,
    record,
    skills: ctx.rowByKey("skills", String(charID)),
    items: ctx
      .allRows("items")
      .filter((r) => shared.toPositiveInt(r.value && r.value.ownerID, 0) === charID)
      .map((r) => r.value),
    simple: {},
    mail: collectMail(charID, ctx.rowByKey, ctx.allRows),
    notifications: { box: ctx.rowByKey("notifications", shared.makeExplodedKey("boxes", charID)) },
  };

  for (const { table, group } of shared.SIMPLE_CHAR_TABLES) {
    const key = group ? shared.makeExplodedKey(group, charID) : String(charID);
    const value = ctx.rowByKey(table, key);
    if (value != null) {
      entry.simple[table] = value;
    }
  }

  return entry;
}

function collectMail(charID, rowByKey, allRows) {
  const mailbox = rowByKey("mail", shared.makeExplodedKey("mailboxes", charID));
  const messages = [];
  for (const { key, value } of allRows("mail")) {
    const { group } = shared.parseExplodedKey(key);
    if (group !== "messages" || !value) continue;
    const isRecipient =
      Array.isArray(value.toCharacterIDs) &&
      value.toCharacterIDs.some((id) => shared.toPositiveInt(id, 0) === charID);
    const isSender = shared.toPositiveInt(value.senderID, 0) === charID;
    if (isRecipient || isSender) {
      messages.push(value);
    }
  }
  return { mailbox, messages };
}

/**
 * Mutates `record` in place to remove corp/alliance footprint. Returns a summary.
 */
function stripCorpData(record, playerCorpIDs, defaultNpcCorp) {
  const originalCorp = shared.toPositiveInt(record.corporationID, 0);
  const hadPlayerCorp = shared.isPlayerCorp(originalCorp, playerCorpIDs);

  let assignedCorp = originalCorp;
  if (hadPlayerCorp) {
    assignedCorp = pickNpcCorp(record, playerCorpIDs, defaultNpcCorp);
    record.corporationID = assignedCorp;
    record.allianceID = 0;
    record.allianceMemberStartDate = 0;
    record.title = "";
    record.employmentHistory = [
      {
        corporationID: assignedCorp,
        startDate:
          (Array.isArray(record.employmentHistory) &&
            record.employmentHistory[0] &&
            record.employmentHistory[0].startDate) ||
          record.startDateTime ||
          "0",
        deleted: 0,
      },
    ];
    stripStandingsForCorp(record, originalCorp);
  }

  return {
    originalCorporationID: originalCorp,
    assignedCorporationID: assignedCorp,
    hadPlayerCorp,
  };
}

function pickNpcCorp(record, playerCorpIDs, defaultNpcCorp) {
  const history = Array.isArray(record.employmentHistory)
    ? record.employmentHistory
    : [];
  // most-recent NPC corp first
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const corp = shared.toPositiveInt(history[i] && history[i].corporationID, 0);
    if (corp > 0 && !shared.isPlayerCorp(corp, playerCorpIDs)) {
      return corp;
    }
  }
  return defaultNpcCorp;
}

function stripStandingsForCorp(record, corpID) {
  const sd = record.standingData;
  if (!sd || typeof sd !== "object") return;
  for (const bucket of ["char", "corp", "npc"]) {
    if (!Array.isArray(sd[bucket])) continue;
    sd[bucket] = sd[bucket].filter(
      (entry) =>
        shared.toPositiveInt(entry && entry.fromID, 0) !== corpID &&
        shared.toPositiveInt(entry && entry.toID, 0) !== corpID,
    );
  }
}

main();
