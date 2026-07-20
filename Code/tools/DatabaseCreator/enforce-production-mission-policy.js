#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  sanitizeAuthorityTable,
  policyViolationCount,
} = require("./production-mission-policy");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TABLE_NAMES = ["missionAuthority", "dungeonAuthority", "agentAuthority"];
const AUTHORITY_ROOTS = [
  {
    label: "static authority",
    path: path.join(REPO_ROOT, "tools", "DatabaseCreator", "staticTables"),
  },
  {
    label: "server fallback mirror",
    path: path.join(REPO_ROOT, "server", "src", "gameStore", "data"),
  },
];

function parseArgs(argv) {
  const options = { apply: false };
  for (const argument of argv) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--check" || argument === "--dry-run") options.apply = false;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node tools/DatabaseCreator/enforce-production-mission-policy.js --check",
    "  node tools/DatabaseCreator/enforce-production-mission-policy.js --apply",
    "",
    "Removes generated Eve-Survival mission offers, all eve-survival:* dungeon/agent",
    "references, and permanently banned mission 4743 / eve-survival:NewSlaves1 from",
    "both checked-in static authority and the server fallback data mirrors.",
  ].join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function reportChangeCount(tableName, report) {
  if (tableName === "missionAuthority") {
    return (
      report.removedGeneratedMissionCount +
      report.removedBannedMissionCount +
      report.removedSourceMetadataCount +
      Number(report.rebuiltIndexes) +
      Number(report.rebuiltCounts)
    );
  }
  if (tableName === "dungeonAuthority") {
    return (
      report.removedEveSurvivalTemplateCount +
      report.removedIndexReferenceCount +
      report.metadataChangeCount
    );
  }
  return (
    report.removedPoolReferenceCount +
    report.removedAgentReferenceCount +
    report.metadataChangeCount
  );
}

function formatReport(tableName, report) {
  if (tableName === "missionAuthority") {
    return [
      `missions ${report.beforeMissionCount} -> ${report.afterMissionCount}`,
      `generated removed ${report.removedGeneratedMissionCount}`,
      `banned removed ${report.removedBannedMissionCount}`,
    ].join(", ");
  }
  if (tableName === "dungeonAuthority") {
    return [
      `templates ${report.beforeTemplateCount} -> ${report.afterTemplateCount}`,
      `eve-survival removed ${report.removedEveSurvivalTemplateCount}`,
      `index refs removed ${report.removedIndexReferenceCount}`,
    ].join(", ");
  }
  return [
    `pool refs removed ${report.removedPoolReferenceCount}`,
    `agent refs removed ${report.removedAgentReferenceCount}`,
    `agents changed ${report.changedAgentCount}`,
  ].join(", ");
}

function run(options) {
  let pendingChangeCount = 0;
  for (const root of AUTHORITY_ROOTS) {
    process.stdout.write(`\n${root.label}:\n`);
    for (const tableName of TABLE_NAMES) {
      const filePath = path.join(root.path, tableName, "data.json");
      if (!fs.existsSync(filePath)) {
        process.stdout.write(`  ${tableName}: missing (skipped)\n`);
        continue;
      }
      const payload = readJson(filePath);
      const report = sanitizeAuthorityTable(tableName, payload);
      const changeCount = reportChangeCount(tableName, report);
      pendingChangeCount += changeCount;
      const violations = policyViolationCount(tableName, payload);
      if (violations !== 0) {
        throw new Error(`${tableName} still has ${violations} policy violation(s) after cleanup`);
      }
      if (options.apply && changeCount > 0) writeJson(filePath, payload);
      process.stdout.write(`  ${tableName}: ${formatReport(tableName, report)}\n`);
    }
  }

  if (options.apply) {
    process.stdout.write(`\nProduction mission policy applied (${pendingChangeCount} changes).\n`);
  } else if (pendingChangeCount > 0) {
    process.stdout.write(`\nProduction mission policy check found ${pendingChangeCount} pending changes.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("\nProduction mission policy check passed.\n");
  }
  return pendingChangeCount;
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  return run(options);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`enforce-production-mission-policy failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { AUTHORITY_ROOTS, TABLE_NAMES, parseArgs, run, runCli };
