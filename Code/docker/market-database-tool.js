"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Database = require(path.join(
  __dirname,
  "../server/node_modules/better-sqlite3",
));

const REQUIRED_TABLES = [
  "manifest",
  "regions",
  "solar_systems",
  "stations",
  "market_types",
  "seed_stock",
  "seed_buy_orders",
  "market_orders",
  "market_order_events",
  "region_summaries",
  "system_seed_summaries",
  "price_history",
];

function databaseFamily(databasePath) {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

function removeDatabaseFamily(databasePath) {
  for (const memberPath of databaseFamily(databasePath)) {
    fs.rmSync(memberPath, { force: true });
  }
}

function openExisting(databasePath, options = {}) {
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size < 1) {
    throw new Error(`Market database does not exist or is empty: ${databasePath}`);
  }
  return new Database(databasePath, {
    readonly: options.readonly !== false,
    fileMustExist: true,
  });
}

function tableNames(database) {
  return new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
}

function readManifest(database) {
  const row = database
    .prepare("SELECT value FROM manifest WHERE key = ?")
    .get("manifest_json");
  if (!row) {
    throw new Error("Market manifest_json row was not found.");
  }
  try {
    return JSON.parse(row.value);
  } catch (error) {
    throw new Error(`Market manifest_json is invalid JSON: ${error.message}`);
  }
}

function validateDatabase(databasePath) {
  const database = openExisting(databasePath);
  try {
    const quickCheck = database.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok") {
      throw new Error(`SQLite quick_check failed: ${quickCheck}`);
    }

    const names = tableNames(database);
    const missingTables = REQUIRED_TABLES.filter((name) => !names.has(name));
    if (missingTables.length > 0) {
      throw new Error(
        `Market database is missing required table(s): ${missingTables.join(", ")}`,
      );
    }

    const manifest = readManifest(database);
    const counts = Object.fromEntries(
      [
        "regions",
        "solar_systems",
        "stations",
        "market_types",
        "seed_stock",
        "seed_buy_orders",
        "market_orders",
        "market_order_events",
        "price_history",
      ].map((table) => [
        table,
        database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count,
      ]),
    );

    for (const requiredContentTable of [
      "regions",
      "solar_systems",
      "stations",
      "market_types",
    ]) {
      if (counts[requiredContentTable] < 1) {
        throw new Error(
          `Market database table ${requiredContentTable} is unexpectedly empty.`,
        );
      }
    }
    if (counts.seed_stock + counts.seed_buy_orders < 1) {
      throw new Error("Market database contains no seeded liquidity.");
    }

    return {
      databasePath: path.resolve(databasePath),
      sizeBytes: fs.statSync(databasePath).size,
      quickCheck,
      manifest,
      counts,
    };
  } finally {
    database.close();
  }
}

function prepareCandidate(databasePath, finalDatabasePath) {
  const database = openExisting(databasePath, { readonly: false });
  try {
    const names = tableNames(database);
    for (const table of REQUIRED_TABLES) {
      if (!names.has(table)) {
        throw new Error(`Market candidate is missing required table: ${table}`);
      }
    }

    const manifest = readManifest(database);
    manifest.database_path = finalDatabasePath;
    database
      .prepare("UPDATE manifest SET value = ? WHERE key = ?")
      .run(JSON.stringify(manifest, null, 2), "manifest_json");
    database.pragma("wal_checkpoint(TRUNCATE)");
    database.pragma("journal_mode = DELETE");
  } finally {
    database.close();
  }
  return validateDatabase(databasePath);
}

function utcFileTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".", "-");
}

function safeLabel(label) {
  const normalized = String(label || "manual")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "manual";
}

async function copyDatabase(sourcePath, destinationPath) {
  validateDatabase(sourcePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  removeDatabaseFamily(destinationPath);

  const source = openExisting(sourcePath);
  try {
    await source.backup(destinationPath);
  } finally {
    source.close();
  }
  validateDatabase(destinationPath);
  return destinationPath;
}

async function backupDatabase(sourcePath, backupDirectory, label) {
  if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size < 1) {
    return "";
  }
  const backupPath = path.join(
    backupDirectory,
    `market-${utcFileTimestamp()}-${safeLabel(label)}.sqlite`,
  );
  await copyDatabase(sourcePath, backupPath);
  return backupPath;
}

function listBackups(backupDirectory) {
  if (!fs.existsSync(backupDirectory)) {
    return [];
  }
  return fs
    .readdirSync(backupDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("market-") &&
        entry.name.endsWith(".sqlite"),
    )
    .map((entry) => {
      const filePath = path.join(backupDirectory, entry.name);
      const stats = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveBackup(backupDirectory, selector) {
  const backups = listBackups(backupDirectory);
  if (backups.length < 1) {
    throw new Error(`No market backups were found in ${backupDirectory}`);
  }
  if (!selector || selector === "latest") {
    return backups.at(-1);
  }
  const match = backups.find((backup) => backup.name === selector);
  if (!match) {
    throw new Error(
      `Market backup '${selector}' was not found. Run the backups command first.`,
    );
  }
  return match;
}

async function stageRestore(backupDirectory, selector, candidatePath) {
  const backup = resolveBackup(backupDirectory, selector);
  await copyDatabase(backup.path, candidatePath);
  return backup;
}

function formatBytes(value) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = Number(value) || 0;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function printBackups(backupDirectory) {
  const backups = listBackups(backupDirectory);
  if (backups.length < 1) {
    console.log(`No market backups found in ${backupDirectory}`);
    return;
  }
  for (const backup of backups) {
    console.log(`${backup.name}\t${formatBytes(backup.sizeBytes)}`);
  }
  const totalBytes = backups.reduce((total, backup) => total + backup.sizeBytes, 0);
  console.log(`Total: ${backups.length} backup(s), ${formatBytes(totalBytes)}`);
}

function printStatus(databasePath, backupDirectory) {
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size < 1) {
    console.log(`Market database: missing (${databasePath})`);
    printBackups(backupDirectory);
    return;
  }
  const report = validateDatabase(databasePath);
  const backups = listBackups(backupDirectory);
  console.log(
    JSON.stringify(
      {
        ...report,
        backups: {
          count: backups.length,
          totalBytes: backups.reduce(
            (total, backup) => total + backup.sizeBytes,
            0,
          ),
        },
      },
      null,
      2,
    ),
  );
}

function usage() {
  return [
    "Usage:",
    "  market-database-tool.js validate <database>",
    "  market-database-tool.js prepare <candidate> <final-path>",
    "  market-database-tool.js backup <database> <backup-dir> <label>",
    "  market-database-tool.js backups <backup-dir>",
    "  market-database-tool.js status <database> <backup-dir>",
    "  market-database-tool.js stage-restore <backup-dir> <selector> <candidate>",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  switch (command) {
    case "validate":
      console.log(JSON.stringify(validateDatabase(args[0]), null, 2));
      return;
    case "prepare":
      console.log(JSON.stringify(prepareCandidate(args[0], args[1]), null, 2));
      return;
    case "backup":
      console.log(await backupDatabase(args[0], args[1], args[2]));
      return;
    case "backups":
      printBackups(args[0]);
      return;
    case "status":
      printStatus(args[0], args[1]);
      return;
    case "stage-restore": {
      const backup = await stageRestore(args[0], args[1], args[2]);
      console.log(backup.path);
      return;
    }
    default:
      throw new Error(usage());
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[market-database-tool] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_TABLES,
  backupDatabase,
  databaseFamily,
  listBackups,
  prepareCandidate,
  resolveBackup,
  stageRestore,
  validateDatabase,
};
