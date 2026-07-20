#!/usr/bin/env node
"use strict";

/**
 * Migrate legacy per-table JSON runtime data into the SQLite backend.
 *
 * The server already auto-seeds each runtime table from its data.json the
 * first time it is read, so most installs never need to run this. Use it when
 * you want to migrate explicitly — e.g. before a deploy, or to confirm the
 * SQLite file is fully populated — without starting the server.
 *
 * For every runtime table it reads <DATA_DIR>/<table>/data.json and loads each
 * top-level entry as a row (key = top-level key, json = the value) into the
 * SQLite database the server uses. Your data.json files are left untouched.
 *
 * Idempotent: re-running re-imports each table from its JSON file.
 *
 * Usage:
 *   node src/gameStore/migrateJsonToSqlite.js              # all runtime tables
 *   node src/gameStore/migrateJsonToSqlite.js accounts mail   # specific tables
 *   node src/gameStore/migrateJsonToSqlite.js --help
 *
 * The data directory is resolved exactly like the server: $EVEJS_GAMESTORE_DATA_DIR,
 * else _local/gameStore/data, else the in-repo source data dir.
 */

const fs = require("fs");
const path = require("path");

// Requiring the gameStore resolves DATA_DIR + the SQLite path and opens the
// database, so we write to the exact same file the server reads.
const database = require("./index");
const sqliteStore = require("./sqliteStore");

function printHelp() {
  console.log(
    [
      "Migrate legacy per-table JSON runtime data into the SQLite backend.",
      "",
      "Usage:",
      "  node src/gameStore/migrateJsonToSqlite.js [table ...]",
      "",
      "With no arguments, migrates every runtime table currently routed to SQLite.",
      "Your data.json files are left untouched; re-running is safe (idempotent).",
      "",
      `SQLite database: ${database._sqliteDbPath}`,
      `Data directory:  ${database._dataDir}`,
    ].join("\n"),
  );
}

function migrateTable(table) {
  const dataFile = path.join(database._dataDir, table, "data.json");
  if (!fs.existsSync(dataFile)) {
    sqliteStore.replaceAll(table, {});
    sqliteStore.markMigrated(table);
    return { table, rows: 0, note: "no data.json — seeded empty" };
  }

  const raw = fs.readFileSync(dataFile, "utf8");
  let parsed;
  try {
    parsed = String(raw).trim().length === 0 ? {} : JSON.parse(raw);
  } catch (error) {
    return { table, rows: 0, error: `invalid JSON: ${error.message}` };
  }
  const rows = sqliteStore.replaceAll(table, parsed);
  sqliteStore.markMigrated(table);
  return { table, rows };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const unknown = args.filter((table) => !database._sqliteTables.has(table));
  if (unknown.length > 0) {
    console.error(
      `Not SQLite-backed runtime tables (skipping): ${unknown.join(", ")}`,
    );
  }
  const tables = (args.length > 0 ? args : [...database._sqliteTables])
    .filter((table) => database._sqliteTables.has(table))
    .sort();

  if (tables.length === 0) {
    console.log("No runtime tables to migrate.");
    return;
  }

  console.log(`Migrating ${tables.length} runtime table(s) → ${database._sqliteDbPath}`);
  let totalRows = 0;
  let failures = 0;
  for (const table of tables) {
    const result = migrateTable(table);
    if (result.error) {
      failures += 1;
      console.error(`  x ${table}: ${result.error}`);
      continue;
    }
    totalRows += result.rows;
    console.log(
      `  + ${table.padEnd(28)} ${String(result.rows).padStart(6)} row(s)` +
        (result.note ? `  (${result.note})` : ""),
    );
  }

  console.log(
    `\nDone: ${tables.length - failures}/${tables.length} table(s), ` +
      `${totalRows} row(s) imported.` +
      (failures > 0 ? ` ${failures} failed.` : ""),
  );
  process.exitCode = failures > 0 ? 1 : 0;
}

main();
