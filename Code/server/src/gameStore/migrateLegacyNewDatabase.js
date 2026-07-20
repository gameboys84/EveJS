#!/usr/bin/env node
"use strict";

/**
 * One-time legacy migration: the data layer used to be named "newDatabase".
 * This script renames the old on-disk artifacts to the gameStore naming so an
 * existing install carries its data forward instead of regenerating from
 * scratch. It is the only place the old name intentionally remains.
 *
 * It does two things, both idempotent and safe to re-run:
 *   1. Move  _local/newDatabase  ->  _local/gameStore   (data + manifest + DB)
 *   2. Rename newdatabase.sqlite* ->  gamestore.sqlite*  inside the data root
 *
 * Run automatically by StartServer.bat, or manually: npm run db:migrate-legacy
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const legacyRoot = path.join(repoRoot, "_local", "newDatabase");
const gameStoreRoot = path.join(repoRoot, "_local", "gameStore");

let acted = false;

// 1. Move the whole legacy data directory to the new location.
function moveLegacyDataDir() {
  if (fs.existsSync(legacyRoot) && !fs.existsSync(gameStoreRoot)) {
    fs.mkdirSync(path.dirname(gameStoreRoot), { recursive: true });
    fs.renameSync(legacyRoot, gameStoreRoot);
    console.log("  moved _local/newDatabase -> _local/gameStore");
    acted = true;
  }
}

// 2. Rename the SQLite file (and its WAL/SHM sidecars) inside a data root.
function renameLegacySqliteIn(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const oldPath = path.join(rootDir, `newdatabase.sqlite${suffix}`);
    const newPath = path.join(rootDir, `gamestore.sqlite${suffix}`);
    if (!fs.existsSync(oldPath)) {
      continue;
    }
    if (fs.existsSync(newPath)) {
      // gamestore.sqlite already exists — drop the stale legacy file.
      fs.rmSync(oldPath, { force: true });
      console.log(`  removed stale legacy ${path.basename(oldPath)}`);
    } else {
      fs.renameSync(oldPath, newPath);
      console.log(`  renamed ${path.basename(oldPath)} -> ${path.basename(newPath)}`);
    }
    acted = true;
  }
}

function main() {
  moveLegacyDataDir();
  renameLegacySqliteIn(gameStoreRoot);

  // Also handle a custom data dir (e.g. a mounted Docker volume): the SQLite
  // file lives one level above EVEJS_GAMESTORE_DATA_DIR.
  if (process.env.EVEJS_GAMESTORE_DATA_DIR) {
    const customRoot = path.resolve(process.env.EVEJS_GAMESTORE_DATA_DIR, "..");
    if (customRoot !== gameStoreRoot) {
      renameLegacySqliteIn(customRoot);
    }
  }

  console.log(
    acted
      ? "Legacy newDatabase migration complete."
      : "No legacy newDatabase artifacts found; nothing to migrate.",
  );
}

main();
