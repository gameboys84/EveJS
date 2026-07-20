#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readJsonl(filePath) {
  const text = readTextIfExists(filePath);
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function buildBandSummary(rows) {
  const summary = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const band = normalizeText(row && row.securityBand, "unknown");
    if (!summary[band]) {
      summary[band] = { systems: 0, slots: 0 };
    }
    summary[band].systems += 1;
    summary[band].slots += Math.max(0, toInt(row && row.slotCount, 0));
  }
  return summary;
}

function loadIceSystemAuthority(repoRoot) {
  return require(path.join(repoRoot, "server/src/services/mining/iceSystemAuthority"));
}

function buildServerAuthoritySection(repoRoot) {
  const authority = loadIceSystemAuthority(repoRoot);
  const activeRows = authority.listIceSystemAuthorityRows();
  const pendingRows = typeof authority.listPendingCompositionSystems === "function"
    ? authority.listPendingCompositionSystems()
    : [];

  return {
    activeSystems: activeRows.length,
    activeSlots: activeRows.reduce((sum, row) => sum + Math.max(0, toInt(row && row.slotCount, 0)), 0),
    activeBySecurityBand: buildBandSummary(activeRows),
    syntheticAuthoritySystems: activeRows.filter((row) => row && row.syntheticAuthority === true).length,
    syntheticAuthoritySlots: activeRows
      .filter((row) => row && row.syntheticAuthority === true)
      .reduce((sum, row) => sum + Math.max(0, toInt(row && row.slotCount, 0)), 0),
    shatteredWormholeIceTodo:
      authority.SHATTERED_WORMHOLE_ICE_TODO || null,
    pendingCompositionSystems: pendingRows.map((row) => ({
      solarSystemID: toInt(row && row.solarSystemID, 0),
      solarSystemName: normalizeText(row && row.solarSystemName, ""),
      regionName: normalizeText(row && row.regionName, ""),
      securityBand: normalizeText(row && row.securityBand, ""),
      slotCount: Math.max(0, toInt(row && row.slotCount, 0)),
      source: normalizeText(row && row.source, ""),
      blockedReason: normalizeText(row && row.blockedReason, ""),
    })),
  };
}

function normalizeReviewSummary(summary) {
  const source = summary && typeof summary === "object" ? summary : {};
  return {
    dotlanIceSystems: toInt(source.dotlanIceSystems, 0),
    dotlanIceSlots: toInt(source.dotlanIceSlots, 0),
    missingAuthoritySystems: toInt(source.missingAuthoritySystems, 0),
    missingAuthoritySlots: toInt(source.missingAuthoritySlots, 0),
    missingAuthoritySystemsWithComposition: toInt(source.missingAuthoritySystemsWithComposition, 0),
    missingAuthoritySystemsMissingComposition: toInt(source.missingAuthoritySystemsMissingComposition, 0),
    uniqueCompositionSets: toInt(source.uniqueCompositionSets, 0),
    missingAuthoritySystemsWithExactClientTemplate:
      toInt(source.missingAuthoritySystemsWithExactClientTemplate, 0),
    missingAuthoritySystemsWithoutExactClientTemplate:
      toInt(source.missingAuthoritySystemsWithoutExactClientTemplate, 0),
    readyImportSystems: toInt(source.readyImportSystems, 0),
    blockedImportSystems: toInt(source.blockedImportSystems, 0),
    byReviewStatus: source.byReviewStatus && typeof source.byReviewStatus === "object"
      ? { ...source.byReviewStatus }
      : {},
  };
}

function normalizeNearestTemplateDelta(delta) {
  if (!delta || typeof delta !== "object") {
    return null;
  }
  return {
    templateID: normalizeText(delta.templateID, ""),
    sourceDungeonID: toInt(delta.sourceDungeonID, 0),
    exact: delta.exact === true,
    score: toInt(delta.score, 0),
    iceTypeNames: Array.isArray(delta.iceTypeNames) ? [...delta.iceTypeNames] : [],
    matchedIceTypeNames: Array.isArray(delta.matchedIceTypeNames) ? [...delta.matchedIceTypeNames] : [],
    missingFromDotlanTypeNames: Array.isArray(delta.missingFromDotlanTypeNames)
      ? [...delta.missingFromDotlanTypeNames]
      : [],
    missingFromTemplateTypeNames: Array.isArray(delta.missingFromTemplateTypeNames)
      ? [...delta.missingFromTemplateTypeNames]
      : [],
  };
}

function buildDotlanReviewEvidenceSection(options = {}) {
  const reviewReport = options.dotlanReviewReport || (
    options.dotlanReviewJsonPath
      ? readJsonFile(options.dotlanReviewJsonPath)
      : null
  );
  if (!reviewReport || typeof reviewReport !== "object") {
    return {
      provided: false,
      importGate: "synthetic_best_fit_enabled",
      expectedInput:
        "tools/IceAuthority/dotlanIceAuthorityReviewReport.js JSON output with compositionSets",
    };
  }

  const compositionSets = Array.isArray(reviewReport.compositionSets)
    ? reviewReport.compositionSets
    : [];
  const exactCompositionSets = compositionSets
    .filter((group) => Array.isArray(group && group.matchingClientDungeonIDs) &&
      group.matchingClientDungeonIDs.length > 0);
  const nonExactCompositionSets = compositionSets
    .filter((group) => Array.isArray(group && group.iceTypeIDs) &&
      group.iceTypeIDs.length > 0 &&
      (!Array.isArray(group.matchingClientDungeonIDs) ||
        group.matchingClientDungeonIDs.length <= 0));
  const nearestTemplateDeltaSamples = nonExactCompositionSets
    .map((group) => {
      const nearest = normalizeNearestTemplateDelta(
        Array.isArray(group && group.nearestClientTemplates)
          ? group.nearestClientTemplates[0]
          : null,
      );
      if (!nearest) {
        return null;
      }
      return {
        compositionKey: normalizeText(group && group.compositionKey, ""),
        iceTypeNames: Array.isArray(group && group.iceTypeNames) ? [...group.iceTypeNames] : [],
        systems: toInt(group && group.systems, 0),
        slots: toInt(group && group.slots, 0),
        missingAuthoritySystems: toInt(group && group.missingAuthoritySystems, 0),
        nearestClientTemplate: nearest,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.missingAuthoritySystems !== left.missingAuthoritySystems) {
        return right.missingAuthoritySystems - left.missingAuthoritySystems;
      }
      if (right.slots !== left.slots) {
        return right.slots - left.slots;
      }
      return left.nearestClientTemplate.score - right.nearestClientTemplate.score;
    })
    .slice(0, Math.max(1, toInt(options.dotlanReviewSampleLimit, 5)));

  return {
    provided: true,
    source: normalizeText(options.dotlanReviewJsonPath, "in-memory"),
    importGate: "synthetic_best_fit_enabled",
    summary: normalizeReviewSummary(reviewReport.summary),
    compositionSets: {
      total: compositionSets.length,
      exactClientTemplateSets: exactCompositionSets.length,
      nonExactClientTemplateSets: nonExactCompositionSets.length,
      nearestTemplateDeltaSampleCount: nearestTemplateDeltaSamples.length,
    },
    nearestTemplateDeltaSamples,
  };
}

function buildClientEvidenceSection(repoRoot) {
  const clientRoot = path.join(repoRoot, "tools/ClientCodeGrabber/Latest");
  const evidenceFiles = {
    iceTypesInDungeonData: "evedungeons/client/iceTypesInDungeon/data.py",
    anomalyTracker: "evedungeons/client/anomalyTracker.py",
    cosmicAnomalyInfo: "explorationscanner/common/cosmicAnomalyInfo.py",
    agencyIceProvider: "eve/client/script/ui/shared/agencyNew/contentProviders/contentProviderIceBelts.py",
    mapIceFilter: "eve/client/script/ui/shared/mapView/filters/mapFilterIceBelts.py",
  };

  const result = {};
  for (const [key, relativePath] of Object.entries(evidenceFiles)) {
    const absolutePath = path.join(clientRoot, relativePath);
    const text = readTextIfExists(absolutePath);
    result[key] = {
      path: relativePath,
      exists: text != null,
    };
    if (key === "iceTypesInDungeonData") {
      result[key].declaresIceTypesByDungeonStatic = /iceTypesByDungeonID\.static/.test(text || "");
    } else if (key === "anomalyTracker") {
      result[key].callsGetIceBeltInstances = /GetIceBeltInstances/.test(text || "");
      result[key].callsGetIceBeltsCount = /GetIceBeltsCount/.test(text || "");
    } else if (key === "cosmicAnomalyInfo") {
      result[key].declaresSiteIDFromInstanceID = /self\.siteID\s*=\s*instanceID/.test(text || "");
      result[key].declaresInstanceIDFromInstanceID = /self\.instanceID\s*=\s*instanceID/.test(text || "");
    } else if (key === "agencyIceProvider") {
      result[key].derivesCompositionFromReturnedDungeonID =
        /get_consolidated_ice_types_in_dungeon/.test(text || "") &&
        /iceBelt\.dungeonID/.test(text || "");
    } else if (key === "mapIceFilter") {
      result[key].declaresIceBeltMapFilter = /Ice Belts/.test(text || "");
    }
  }

  return result;
}

function buildSdeEvidenceSection(repoRoot) {
  const sdeRoot = path.join(repoRoot, "tools/DataSync/source_json/eve-online-static-data-3396210-jsonl");
  const asteroidBelts = readJsonl(path.join(sdeRoot, "mapAsteroidBelts.jsonl"));
  const beltTypeCounts = new Map();
  for (const row of asteroidBelts) {
    const typeID = toInt(row && row.typeID, 0);
    beltTypeCounts.set(typeID, (beltTypeCounts.get(typeID) || 0) + 1);
  }

  const solarSystems = readJsonl(path.join(sdeRoot, "mapSolarSystems.jsonl"));
  const shatteredSystems = solarSystems
    .filter((row) => /SHATTEREDWORMHOLE/.test(String(row && row.visualEffect || "")))
    .map((row) => ({
      solarSystemID: toInt(row && row._key, 0),
      solarSystemName: normalizeText(row && row.name && row.name.en, ""),
      visualEffect: normalizeText(row && row.visualEffect, ""),
    }))
    .filter((row) => row.solarSystemID > 0);

  const dungeons = readJsonl(path.join(sdeRoot, "dungeons.jsonl"));
  const archetype28IceTemplates = dungeons
    .filter((row) => toInt(row && row.archetypeID, 0) === 28)
    .map((row) => ({
      dungeonID: toInt(row && row._key, 0),
      name: normalizeText(row && row.name && row.name.en, ""),
    }))
    .filter((row) => row.dungeonID > 0 && /ice|glaze|icicle|gelidus|krystallos|glitter/i.test(row.name))
    .sort((left, right) => left.dungeonID - right.dungeonID);

  return {
    mapAsteroidBelts: {
      rows: asteroidBelts.length,
      typeCounts: [...beltTypeCounts.entries()]
        .map(([typeID, count]) => ({ typeID, count }))
        .sort((left, right) => left.typeID - right.typeID),
      onlyNormalAsteroidBeltType15:
        beltTypeCounts.size === 1 &&
        beltTypeCounts.get(15) === asteroidBelts.length,
    },
    mapSolarSystems: {
      rows: solarSystems.length,
      shatteredWormholeOverlaySystems: shatteredSystems.length,
      shatteredWormholeOverlaySample: shatteredSystems.slice(0, 5),
    },
    dungeons: {
      archetype28IceTemplateCount: archetype28IceTemplates.length,
      archetype28IceTemplates,
    },
  };
}

function getBandCount(summary, band, field) {
  return toInt(summary && summary[band] && summary[band][field], 0);
}

function buildParityCompletionSection(sections = {}) {
  const serverAuthority = sections.serverAuthority || {};
  const clientEvidence = sections.clientEvidence || {};
  const sdeEvidence = sections.sdeEvidence || {};
  const dotlanReviewEvidence = sections.dotlanReviewEvidence || {};
  const activeBySecurityBand = serverAuthority.activeBySecurityBand || {};
  const dotlanSummary = dotlanReviewEvidence.summary || {};
  const activeHighsecSystems = getBandCount(activeBySecurityBand, "highsec", "systems");
  const activeLowsecSystems = getBandCount(activeBySecurityBand, "lowsec", "systems");
  const activeNullsecSystems = getBandCount(activeBySecurityBand, "nullsec", "systems");
  const activeWormholeSystems = getBandCount(activeBySecurityBand, "wormhole", "systems");
  const clientConsumerEvidenceComplete = Boolean(
    clientEvidence.iceTypesInDungeonData &&
      clientEvidence.iceTypesInDungeonData.declaresIceTypesByDungeonStatic &&
      clientEvidence.anomalyTracker &&
      clientEvidence.anomalyTracker.callsGetIceBeltInstances &&
      clientEvidence.anomalyTracker.callsGetIceBeltsCount &&
      clientEvidence.cosmicAnomalyInfo &&
      clientEvidence.cosmicAnomalyInfo.declaresSiteIDFromInstanceID &&
      clientEvidence.cosmicAnomalyInfo.declaresInstanceIDFromInstanceID &&
      clientEvidence.agencyIceProvider &&
      clientEvidence.agencyIceProvider.derivesCompositionFromReturnedDungeonID &&
      clientEvidence.mapIceFilter &&
      clientEvidence.mapIceFilter.declaresIceBeltMapFilter
  );

  let nonEmpireStatus = activeNullsecSystems > 0
    ? "implemented_synthetic_best_fit"
    : "blocked_missing_review";
  let nonEmpireReason = activeNullsecSystems > 0
    ? "Nullsec/Pochven DOTLAN system and slot authority is active with researched synthetic composition/template best fits."
    : "No active nullsec/Pochven authority is present.";
  if (dotlanReviewEvidence.provided && activeNullsecSystems <= 0) {
    const readyImportSystems = toInt(dotlanSummary.readyImportSystems, 0);
    const blockedImportSystems = toInt(dotlanSummary.blockedImportSystems, 0);
    if (readyImportSystems > 0 && blockedImportSystems > 0) {
      nonEmpireStatus = "partial_ready_imports_blocked";
      nonEmpireReason =
        "Some missing-authority systems have exact client templates, but other systems remain blocked.";
    } else if (readyImportSystems > 0 && blockedImportSystems <= 0) {
      nonEmpireStatus = "ready_to_import_exact_templates";
      nonEmpireReason =
        "All reviewed missing-authority systems have exact client-template matches, but they are not active authority yet.";
    } else {
      nonEmpireStatus = "blocked_no_exact_templates";
      nonEmpireReason =
        "DOTLAN composition evidence does not exactly match current client archetype-28 templates.";
    }
  }

  const gates = [
    {
      id: "target_client_ice_consumers_identified",
      status: clientConsumerEvidenceComplete ? "proven" : "missing_evidence",
      requirement:
        "Build-3396210 scanner, Agency, and starmap ice consumers must be identified before changing payloads.",
      evidence: [
        clientEvidence.iceTypesInDungeonData && clientEvidence.iceTypesInDungeonData.path,
        clientEvidence.anomalyTracker && clientEvidence.anomalyTracker.path,
        clientEvidence.cosmicAnomalyInfo && clientEvidence.cosmicAnomalyInfo.path,
        clientEvidence.agencyIceProvider && clientEvidence.agencyIceProvider.path,
        clientEvidence.mapIceFilter && clientEvidence.mapIceFilter.path,
      ].filter(Boolean),
    },
    {
      id: "active_empire_authority_sourced",
      status: activeHighsecSystems > 0 && activeLowsecSystems > 0 ? "proven" : "missing_evidence",
      requirement:
        "Highsec and lowsec ice systems must come from sourced authority rows, not broad security-band generation.",
      evidence: {
        activeHighsecSystems,
        activeLowsecSystems,
        activeSlots: toInt(serverAuthority.activeSlots, 0),
      },
    },
    {
      id: "non_empire_authority_complete",
      status: nonEmpireStatus,
      requirement:
        "Nullsec/Pochven ice systems must come from DOTLAN system/slot authority with documented composition/template policy before becoming player-visible.",
      reason: nonEmpireReason,
      evidence: dotlanReviewEvidence.provided
        ? {
          readyImportSystems: toInt(dotlanSummary.readyImportSystems, 0),
          blockedImportSystems: toInt(dotlanSummary.blockedImportSystems, 0),
          nonExactClientTemplateSets:
            dotlanReviewEvidence.compositionSets &&
              toInt(dotlanReviewEvidence.compositionSets.nonExactClientTemplateSets, 0),
          activeNullsecSystems,
        }
        : {
          activeNullsecSystems,
          expectedReviewInput:
            "tools/IceAuthority/dotlanIceAuthorityReviewReport.js JSON output",
        },
    },
    {
      id: "shattered_wormhole_authority_complete",
      status: "deferred_todo",
      requirement:
        "Shattered wormhole ice is intentionally deferred until a directed shattered-field pass chooses eligibility, slots, and template policy.",
      evidence: {
        shatteredOverlaySystems: toInt(
          sdeEvidence &&
            sdeEvidence.mapSolarSystems &&
            sdeEvidence.mapSolarSystems.shatteredWormholeOverlaySystems,
          0,
        ),
        activeWormholeSystems,
      },
    },
    {
      id: "client_projection_and_runtime_lifecycle",
      status: "implemented_needs_live_signoff",
      requirement:
        "Generated authority ice must deplete, despawn, disappear from scanner/cache/map, respawn after six hours, and reset on server restart.",
      evidence: [
        "server/tests/dungeonUniverseRuntimeParity.test.js",
        "server/tests/dungeonInstanceCacheMgrService.test.js",
        "server/tests/scannerPayloadParity.test.js",
      ],
    },
    {
      id: "no_synthetic_ice_generation",
      status:
        activeWormholeSystems === 0 &&
        sdeEvidence.mapAsteroidBelts &&
        sdeEvidence.mapAsteroidBelts.onlyNormalAsteroidBeltType15
          ? "proven"
          : "needs_review",
      requirement:
        "No generic security-band, map-asteroid-belt, or shattered-overlay inference may create player-visible ice authority outside documented authority rows.",
      evidence: {
        activeNullsecSystems,
        activeWormholeSystems,
        mapAsteroidBeltsOnlyType15:
          Boolean(sdeEvidence.mapAsteroidBelts &&
            sdeEvidence.mapAsteroidBelts.onlyNormalAsteroidBeltType15),
      },
    },
  ];

  const nextActions = [
    {
      id: "recover_non_empire_exact_authority",
      status: nonEmpireStatus,
      command:
        "node tools/IceAuthority/dotlanIceAuthorityReviewReport.js --fetch-all-regions --fetch-celestials missing-nullsec",
      action:
        "Use the no-write DOTLAN review JSON as evidence for future synthetic-authority review, not as a blocker on exact client-template matches.",
      guardrail:
        "Do not regenerate SDE/static data; keep synthetic ice authority explicit and reviewed.",
    },
    {
      id: "recover_shattered_authority",
      status: "blocked_missing_authority",
      action:
        "TODO: design shattered wormhole ice separately after the nullsec/Pochven pass is tested.",
      guardrail:
        "mapSolarSystems shattered overlays prove space class only, not ice authority.",
    },
    {
      id: "live_client_signoff",
      status: "needed",
      action:
        "Verify Agency, starmap, scanner, depletion, six-hour respawn, and downtime restoration in the target client with authority-backed systems.",
    },
  ];

  return {
    complete: gates.every((gate) => gate.status === "proven"),
    state: gates.every((gate) => gate.status === "proven") ? "complete" : "not_complete",
    provenGateCount: gates.filter((gate) => gate.status === "proven").length,
    blockedGateCount: gates.filter((gate) => /^blocked/.test(gate.status)).length,
    gates,
    nextActions,
  };
}

function buildReadinessReport(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "../.."));
  const serverAuthority = buildServerAuthoritySection(repoRoot);
  const clientEvidence = buildClientEvidenceSection(repoRoot);
  const sdeEvidence = buildSdeEvidenceSection(repoRoot);
  const dotlanReviewEvidence = buildDotlanReviewEvidenceSection(options);

  const activeNonEmpireSystems =
    toInt(serverAuthority.activeBySecurityBand.nullsec && serverAuthority.activeBySecurityBand.nullsec.systems, 0) +
    toInt(serverAuthority.activeBySecurityBand.wormhole && serverAuthority.activeBySecurityBand.wormhole.systems, 0);

  const blockers = [
    {
      scope: "nullsec/Pochven",
      status: "implemented_synthetic_best_fit",
      reason:
        "DOTLAN system/slot candidates are active through emulator-owned synthetic best-fit authority.",
      verifier: "tools/IceAuthority/dotlanIceAuthorityReviewReport.js --fetch-all-regions --fetch-celestials missing-nullsec",
      dotlanReview: dotlanReviewEvidence.provided
        ? {
          importGate: dotlanReviewEvidence.importGate,
          readyImportSystems: dotlanReviewEvidence.summary.readyImportSystems,
          blockedImportSystems: dotlanReviewEvidence.summary.blockedImportSystems,
          nonExactClientTemplateSets: dotlanReviewEvidence.compositionSets.nonExactClientTemplateSets,
          nearestTemplateDeltaSamples: dotlanReviewEvidence.nearestTemplateDeltaSamples.slice(0, 3),
        }
        : {
          importGate: dotlanReviewEvidence.importGate,
          evidence: "not_provided",
        },
    },
    {
      scope: "shattered wormholes",
      status: "deferred_todo",
      reason:
        "Shattered wormhole ice is intentionally deferred to a later directed pass.",
      localEvidence: "mapSolarSystems.SHATTEREDWORMHOLE_OVERLAY",
    },
  ];
  const parityCompletion = buildParityCompletionSection({
    serverAuthority,
    clientEvidence,
    sdeEvidence,
    dotlanReviewEvidence,
  });

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    summary: {
      activeIceAuthoritySystems: serverAuthority.activeSystems,
      activeIceAuthoritySlots: serverAuthority.activeSlots,
      pendingCompositionSystems: serverAuthority.pendingCompositionSystems.length,
      activeNonEmpireSystems,
      localStaticDataCanEnableNonEmpireIce: true,
      blockerCount: blockers.filter((blocker) => blocker.status === "blocked").length,
      dotlanReviewProvided: dotlanReviewEvidence.provided,
      parityComplete: parityCompletion.complete,
    },
    serverAuthority,
    clientEvidence,
    sdeEvidence,
    dotlanReviewEvidence,
    parityCompletion,
    blockers,
  };
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const options = {
    repoRoot: null,
    summaryOnly: false,
    dotlanReviewJsonPath: null,
  };
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--repo-root") {
      options.repoRoot = args.shift();
    } else if (arg === "--dotlan-review-json") {
      const filePath = args.shift();
      if (!filePath) {
        throw new Error("--dotlan-review-json requires a file path");
      }
      options.dotlanReviewJsonPath = filePath;
    } else if (arg === "--summary-only") {
      options.summaryOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage() {
  console.error([
    "Usage:",
    "  node tools/IceAuthority/iceParityReadinessReport.js [--summary-only] [--repo-root <path>] [--dotlan-review-json <file>]",
    "",
    "The tool prints read-only JSON evidence. It never writes server authority/static data.",
  ].join("\n"));
}

function withSuppressedStdout(fn) {
  const originalWrite = process.stdout.write;
  process.stdout.write = function suppressedStdout(_chunk, _encoding, callback) {
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };
  try {
    return fn();
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const report = withSuppressedStdout(() => buildReadinessReport(options));
  process.stdout.write(`${JSON.stringify(options.summaryOnly ? report.summary : report, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReadinessReport,
  buildServerAuthoritySection,
  buildClientEvidenceSection,
  buildSdeEvidenceSection,
  buildDotlanReviewEvidenceSection,
  buildParityCompletionSection,
};
