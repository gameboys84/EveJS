#!/usr/bin/env node
/*
 * Build repo-owned missionAuthority rows for playable Eve-Survival dungeon templates.
 *
 * The dungeonAuthority template is the spawn/completion truth. missionAuthority is the
 * agent-offer layer the client sees. These generated rows bind a stable numeric missionID
 * to a playable eve-survival:* template so security agents can offer it naturally.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATIC_ROOT = path.join(REPO_ROOT, "tools", "DatabaseCreator", "staticTables");
const MISSION_AUTHORITY_PATH = path.join(STATIC_ROOT, "missionAuthority", "data.json");
const DUNGEON_AUTHORITY_PATH = path.join(STATIC_ROOT, "dungeonAuthority", "data.json");

const GENERATED_ID_BASE = 900000000;
const GENERATED_ID_SPAN = 1000000;
const FALLBACK_CLIENT_DUNGEON_ID = 213;
const BASIC_KILL_TEMPLATE = "agent.missionTemplatizedContent_BasicKillMission";
const GENERATED_SOURCE = "eve-survival-generated";
const PROTECTED_GOLDEN_WAKKAS = new Set([
  "AlluringEmanations1",
  "AvengeaFallenComrade1gu",
  "Blockade1gu",
  "GoneBerserk1",
]);

function parseArgs(argv) {
  const args = { apply: false, dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (token === "--dry-run") {
      args.apply = false;
      args.dryRun = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node tools/DatabaseCreator/build-scraped-mission-authority.js [--apply]",
    "",
    "Reads playable eve-survival:* templates from static dungeonAuthority and",
    "generates static missionAuthority rows in a reserved numeric missionID range.",
  ].join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeText(value, fallback = "") {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableHash(text) {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableGeneratedMissionID(templateID, usedIDs) {
  let candidate = GENERATED_ID_BASE + (stableHash(templateID) % GENERATED_ID_SPAN);
  while (usedIDs.has(String(candidate))) {
    candidate += 1;
    if (candidate >= GENERATED_ID_BASE + GENERATED_ID_SPAN) {
      candidate = GENERATED_ID_BASE;
    }
  }
  usedIDs.add(String(candidate));
  return candidate;
}

function isGeneratedMission(record, missionID) {
  const numericMissionID = toInt(missionID, 0);
  return (
    numericMissionID >= GENERATED_ID_BASE &&
    numericMissionID < GENERATED_ID_BASE + GENERATED_ID_SPAN
  ) || normalizeText(record && record.generatedFromSource, "") === GENERATED_SOURCE;
}

function playabilityForTemplate(template) {
  return (template && template.adminMetadata && template.adminMetadata.playability) ||
    (template && template.populationHints && template.populationHints.playability) ||
    null;
}

function isPlayableScrapedTemplate(templateID, template) {
  if (!String(templateID || "").startsWith("eve-survival:")) return false;
  const playability = playabilityForTemplate(template);
  return Boolean(playability && playability.playable !== false);
}

function wakkaFromEveSurvivalTemplateID(templateID) {
  const match = String(templateID || "").match(/^eve-survival:(.+)$/);
  return match ? match[1] : "";
}

function isProtectedGoldenTemplate(templateID) {
  const wakka = wakkaFromEveSurvivalTemplateID(templateID);
  return Boolean(wakka && PROTECTED_GOLDEN_WAKKAS.has(wakka));
}

function normalizeMissionTitle(value) {
  return normalizeText(value, "")
    .toLowerCase()
    .replace(/\b(?:lvl|level)\s*\d+\b/g, " ")
    .replace(/\bstoryline\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localizedMissionTitle(record) {
  return normalizeText(
    record && record.localizedName && record.localizedName.text,
    normalizeText(record && record.name, ""),
  );
}

function buildRetailMissionTitleIndex(missionAuthority) {
  const byTitle = new Map();
  for (const [missionID, record] of Object.entries(missionAuthority.missionsByID || {})) {
    if (isGeneratedMission(record, missionID)) continue;
    if (normalizeText(record && record.missionKind, "").toLowerCase() !== "encounter") continue;
    if (!record || !record.killMission || toInt(record.killMission.dungeonID, 0) <= 0) continue;
    const titleKey = normalizeMissionTitle(localizedMissionTitle(record));
    if (!titleKey) continue;
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, []);
    byTitle.get(titleKey).push({ missionID: toInt(missionID, 0), record });
  }
  for (const rows of byTitle.values()) {
    rows.sort((left, right) => left.missionID - right.missionID);
  }
  return byTitle;
}

function bestRetailMissionMatch(template, retailByTitle) {
  const templateTitle = normalizeText(template && (template.title || template.resolvedName), "");
  const candidates = retailByTitle.get(normalizeMissionTitle(templateTitle)) || [];
  return candidates.length > 0 ? candidates[0].record : null;
}

function buildGeneratedMissionRecord(missionID, templateID, template, matchedRetailMission) {
  const title = normalizeText(template && (template.title || template.resolvedName), templateID);
  const matchedKillMission = matchedRetailMission && matchedRetailMission.killMission;
  const matchedRewards = matchedRetailMission && matchedRetailMission.missionRewards;
  const matchedLpAlpha = toInt(matchedRetailMission && matchedRetailMission.fixedLpRewardAlpha, 0);
  const matchedLpOmega = toInt(matchedRetailMission && matchedRetailMission.fixedLpRewardOmega, 0);
  const playability = playabilityForTemplate(template);

  return {
    missionID,
    contentTemplate: BASIC_KILL_TEMPLATE,
    nameID: 0,
    contentTags: [],
    messages: {},
    localizedName: {
      messageID: null,
      text: title,
      metadata: null,
      tokens: null,
    },
    localizedMessages: {},
    hasStandingRewards: true,
    fixedLpRewardAlpha: matchedLpAlpha,
    fixedLpRewardOmega: matchedLpOmega,
    expirationTime: null,
    agentTypeID: null,
    corporationID: null,
    factionID: null,
    initialAgentGiftTypeID: null,
    initialAgentGiftQuantity: null,
    nodeGraphID: null,
    missionTemplateID: templateID,
    dungeonTemplateID: templateID,
    generatedFromTemplateID: templateID,
    generatedFromSource: GENERATED_SOURCE,
    generatedMetadata: {
      source: GENERATED_SOURCE,
      matchedRetailMissionID: matchedRetailMission ? toInt(matchedRetailMission.missionID, 0) || null : null,
      matchedRetailDungeonID: matchedKillMission ? toInt(matchedKillMission.dungeonID, 0) || null : null,
      fallbackClientDungeonID: FALLBACK_CLIENT_DUNGEON_ID,
      playability: playability ? clone(playability) : null,
    },
    killMission: {
      dungeonID: toInt(matchedKillMission && matchedKillMission.dungeonID, 0) || FALLBACK_CLIENT_DUNGEON_ID,
      objectiveQuantity: 0,
    },
    courierMission: null,
    missionRewards: matchedRewards ? clone(matchedRewards) : null,
    clientObjectives: null,
    extraStandings: null,
    remoteCompletable: null,
    missionKind: "encounter",
    missionFlavor: "basic",
    isEpicArc: false,
    isHeraldry: false,
    isResearch: false,
    isStoryline: false,
    isGenericStoryline: false,
    isAgentInteraction: false,
    isTalkToAgent: false,
  };
}

function compareMissionIDs(left, right) {
  const leftNumber = toInt(left, NaN);
  const rightNumber = toInt(right, NaN);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right));
}

function addIndexValue(indexes, indexName, key, missionID) {
  const normalizedKey = normalizeText(key, "");
  if (!normalizedKey) return;
  indexes[indexName] = indexes[indexName] || {};
  indexes[indexName][normalizedKey] = Array.isArray(indexes[indexName][normalizedKey])
    ? indexes[indexName][normalizedKey]
    : [];
  const missionKey = String(missionID);
  if (!indexes[indexName][normalizedKey].some((entry) => String(entry) === missionKey)) {
    indexes[indexName][normalizedKey].push(missionID);
  }
}

function rebuildIndexes(payload) {
  const indexes = {
    missionKindToMissionIDs: {},
    missionFlavorToMissionIDs: {},
    missionTemplateToMissionIDs: {},
    agentIDToMissionIDs: payload.indexes && payload.indexes.agentIDToMissionIDs
      ? clone(payload.indexes.agentIDToMissionIDs)
      : {},
    preferredMissionIDs: payload.indexes && payload.indexes.preferredMissionIDs
      ? clone(payload.indexes.preferredMissionIDs)
      : {},
  };

  for (const [missionID, record] of Object.entries(payload.missionsByID || {})) {
    const normalizedMissionID = toInt(record && record.missionID, toInt(missionID, 0));
    addIndexValue(indexes, "missionKindToMissionIDs", record && record.missionKind, normalizedMissionID);
    addIndexValue(indexes, "missionFlavorToMissionIDs", record && record.missionFlavor, normalizedMissionID);
    addIndexValue(indexes, "missionTemplateToMissionIDs", record && record.contentTemplate, normalizedMissionID);
    addIndexValue(indexes, "missionTemplateToMissionIDs", record && record.missionTemplateID, normalizedMissionID);
    addIndexValue(indexes, "missionTemplateToMissionIDs", record && record.dungeonTemplateID, normalizedMissionID);
  }

  for (const map of [
    indexes.missionKindToMissionIDs,
    indexes.missionFlavorToMissionIDs,
    indexes.missionTemplateToMissionIDs,
    indexes.agentIDToMissionIDs,
  ]) {
    for (const key of Object.keys(map)) {
      map[key] = [...new Set((Array.isArray(map[key]) ? map[key] : []).map((entry) => (
        /^-?\d+$/.test(String(entry)) ? Number(entry) : entry
      )))].sort(compareMissionIDs);
    }
  }
  return indexes;
}

function rebuildCounts(payload) {
  const missions = Object.values(payload.missionsByID || {});
  const localizedMessageCount = missions.reduce((total, record) =>
    total + Object.keys(record && record.localizedMessages || {}).length, 0);
  const generatedCount = missions.filter((record) =>
    normalizeText(record && record.generatedFromSource, "") === GENERATED_SOURCE).length;
  return {
    ...(payload.counts || {}),
    missionCount: missions.length,
    missionKindCount: new Set(missions.map((record) => normalizeText(record && record.missionKind, ""))).size,
    missionFlavorCount: new Set(missions.map((record) => normalizeText(record && record.missionFlavor, ""))).size,
    missionTemplateCount: new Set(missions.map((record) => normalizeText(record && record.contentTemplate, ""))).size,
    epicArcMissionCount: missions.filter((record) => record && record.isEpicArc === true).length,
    preferredMissionCount: Object.keys(payload.indexes && payload.indexes.preferredMissionIDs || {}).length,
    localizedMissionCount: missions.filter((record) => record && record.localizedName && record.localizedName.text).length,
    localizedMissionMessageCount: localizedMessageCount,
    generatedEveSurvivalMissionCount: generatedCount,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const missionAuthority = readJson(MISSION_AUTHORITY_PATH);
  const dungeonAuthority = readJson(DUNGEON_AUTHORITY_PATH);
  const originalMissionCount = Object.keys(missionAuthority.missionsByID || {}).length;
  const missionsByID = missionAuthority.missionsByID || {};
  const retailByTitle = buildRetailMissionTitleIndex(missionAuthority);

  let removed = 0;
  for (const [missionID, record] of Object.entries({ ...missionsByID })) {
    if (isGeneratedMission(record, missionID)) {
      delete missionsByID[missionID];
      removed += 1;
    }
  }

  const usedIDs = new Set(Object.keys(missionsByID));
  const playableTemplatesAll = Object.entries(dungeonAuthority.templatesByID || {})
    .filter(([templateID, template]) => isPlayableScrapedTemplate(templateID, template))
    .sort(([leftID], [rightID]) => leftID.localeCompare(rightID));
  const protectedGoldenTemplates = playableTemplatesAll
    .filter(([templateID]) => isProtectedGoldenTemplate(templateID))
    .map(([templateID]) => templateID);
  const playableTemplates = playableTemplatesAll
    .filter(([templateID]) => !isProtectedGoldenTemplate(templateID));
  let matchedRetail = 0;
  const generatedRows = [];

  for (const [templateID, template] of playableTemplates) {
    const missionID = stableGeneratedMissionID(templateID, usedIDs);
    const matched = bestRetailMissionMatch(template, retailByTitle);
    if (matched) matchedRetail += 1;
    const record = buildGeneratedMissionRecord(missionID, templateID, template, matched);
    missionsByID[String(missionID)] = record;
    generatedRows.push({ missionID, templateID, title: record.localizedName.text, matchedRetailMissionID: record.generatedMetadata.matchedRetailMissionID });
  }

  missionAuthority.missionsByID = Object.fromEntries(
    Object.entries(missionsByID).sort(([left], [right]) => compareMissionIDs(left, right)),
  );
  missionAuthority.source = {
    ...(missionAuthority.source || {}),
    generatedEveSurvivalMissionAuthority: {
      provider: "EveJS DatabaseCreator",
      generatedAt: new Date().toISOString(),
      sourceTable: "dungeonAuthority",
      generatedFromSource: GENERATED_SOURCE,
      idBase: GENERATED_ID_BASE,
      idSpan: GENERATED_ID_SPAN,
      fallbackClientDungeonID: FALLBACK_CLIENT_DUNGEON_ID,
    },
  };
  missionAuthority.indexes = rebuildIndexes(missionAuthority);
  missionAuthority.counts = rebuildCounts(missionAuthority);

  process.stdout.write([
    "",
    `Scraped missionAuthority build ${args.apply ? "APPLIED" : "DRY RUN"}`,
    `  playable templates: ${playableTemplates.length}`,
    `  protected golden templates skipped: ${protectedGoldenTemplates.length}`,
    `  previous generated rows removed: ${removed}`,
    `  generated rows: ${generatedRows.length}`,
    `  generated rows matched to retail mission text/rewards: ${matchedRetail}`,
    `  mission count: ${originalMissionCount} -> ${Object.keys(missionAuthority.missionsByID).length}`,
  ].join("\n"));
  process.stdout.write("\n");

  if (generatedRows.length > 0) {
    process.stdout.write("\nGenerated sample:\n");
    for (const row of generatedRows.slice(0, 12)) {
      process.stdout.write(`  ${row.missionID}  ${row.templateID}  ${row.title}${row.matchedRetailMissionID ? `  retail=${row.matchedRetailMissionID}` : ""}\n`);
    }
  }
  if (protectedGoldenTemplates.length > 0) {
    process.stdout.write("\nProtected golden templates skipped:\n");
    for (const templateID of protectedGoldenTemplates) {
      process.stdout.write(`  ${templateID}\n`);
    }
  }

  if (args.apply) {
    writeJson(MISSION_AUTHORITY_PATH, missionAuthority);
    process.stdout.write(`\nWrote ${MISSION_AUTHORITY_PATH}\n`);
  } else {
    process.stdout.write("\nNo files written. Re-run with --apply to update static missionAuthority.\n");
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`build-scraped-mission-authority failed: ${error.message}\n`);
  process.exit(1);
}
