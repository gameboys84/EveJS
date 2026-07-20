#!/usr/bin/env node

const fs = require("fs");
const https = require("https");
const path = require("path");

const extractor = require(path.join(__dirname, "./dotlanIceAuthorityExtractor"));

const DOTLAN_BASE_URL = "https://evemaps.dotlan.net";

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  return normalized || fallback;
}

function normalizeNameKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueSortedInts(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => toInt(value, 0))
    .filter((value) => value > 0))]
    .sort((left, right) => left - right);
}

function compositionKey(typeIDs) {
  return uniqueSortedInts(typeIDs).join(",");
}

function getReferenceDataModule() {
  return require(path.join(__dirname, "../../server/src/services/_shared/referenceData"));
}

function loadStaticTableRows(tableName, rowArrayKey = null) {
  try {
    const { readStaticRows } = getReferenceDataModule();
    const rows = readStaticRows(tableName);
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }
  } catch (_error) {
    // Fall back to gameStore/legacy JSON below for standalone tool use.
  }

  try {
    const database = require(path.join(__dirname, "../../server/src/gameStore"));
    const result = database.read(tableName, "/");
    if (result && result.success && result.data && typeof result.data === "object") {
      if (rowArrayKey && Array.isArray(result.data[rowArrayKey])) {
        return result.data[rowArrayKey];
      }
      if (Array.isArray(result.data)) {
        return result.data;
      }
      return Object.values(result.data);
    }
  } catch (_error) {
    // Fall back to legacy JSON below for pre-local-data checkouts.
  }

  const legacyPath = path.join(
    __dirname,
    "../../server/src/gameStore/data",
    tableName,
    "data.json",
  );
  if (!fs.existsSync(legacyPath)) {
    return [];
  }
  const data = require(legacyPath);
  if (rowArrayKey && Array.isArray(data && data[rowArrayKey])) {
    return data[rowArrayKey];
  }
  if (Array.isArray(data)) {
    return data;
  }
  return Object.values(data || {});
}

function getItemTypeRows() {
  const { TABLE, readStaticRows } = getReferenceDataModule();
  return readStaticRows(TABLE.ITEM_TYPES);
}

function loadLocalIceTypeRows(options = {}) {
  const includeCompressed = options.includeCompressed === true;
  return getItemTypeRows()
    .filter((row) => {
      const groupID = toInt(row && row.groupID, 0);
      const groupName = normalizeText(row && row.groupName, "").toLowerCase();
      const name = normalizeText(row && row.name, "");
      if (groupID !== 465 && groupName !== "ice") {
        return false;
      }
      return includeCompressed || !/^compressed\s+/i.test(name);
    })
    .map((row) => ({
      typeID: toInt(row.typeID, 0),
      name: normalizeText(row.name, ""),
      groupID: toInt(row.groupID, 0),
      groupName: normalizeText(row.groupName, ""),
      published: row.published !== false,
    }))
    .filter((row) => row.typeID > 0 && row.name)
    .sort((left, right) => left.typeID - right.typeID);
}

function buildIceTypeIndex(iceTypeRows = loadLocalIceTypeRows()) {
  const byNameKey = new Map();
  const byTypeID = new Map();
  for (const row of Array.isArray(iceTypeRows) ? iceTypeRows : []) {
    const typeID = toInt(row && row.typeID, 0);
    const name = normalizeText(row && row.name, "");
    if (typeID <= 0 || !name) {
      continue;
    }
    const normalized = {
      typeID,
      name,
      groupID: toInt(row && row.groupID, 0) || null,
      groupName: normalizeText(row && row.groupName, "Ice"),
      published: row.published !== false,
    };
    byNameKey.set(normalizeNameKey(name), normalized);
    byTypeID.set(typeID, normalized);
  }
  return { byNameKey, byTypeID };
}

function extractIceTypeMatchesFromMineralsText(mineralsIceText, iceTypeRows = loadLocalIceTypeRows()) {
  const index = buildIceTypeIndex(iceTypeRows);
  const matches = [];
  const seenTypeIDs = new Set();
  for (const token of normalizeText(mineralsIceText, "").split(",")) {
    const cleaned = normalizeText(token.replace(/\s*\([^)]*\)\s*/g, " "), "");
    const match = index.byNameKey.get(normalizeNameKey(cleaned));
    if (!match || seenTypeIDs.has(match.typeID)) {
      continue;
    }
    seenTypeIDs.add(match.typeID);
    matches.push({
      typeID: match.typeID,
      name: match.name,
    });
  }
  return matches.sort((left, right) => left.typeID - right.typeID);
}

function loadClientIceDungeonTemplates(options = {}) {
  const includeNonIceBeltArchetypes = options.includeNonIceBeltArchetypes === true;
  const templates = loadStaticTableRows("dungeonAuthority", "templates");
  const iceTypeIndex = buildIceTypeIndex(options.iceTypeRows || loadLocalIceTypeRows());

  return templates
    .map((template) => {
      const resourceComposition = template &&
        template.resourceComposition &&
        typeof template.resourceComposition === "object"
        ? template.resourceComposition
        : {};
      const iceTypeIDs = uniqueSortedInts(resourceComposition.iceTypeIDs);
      const archetypeID = toInt(template && template.archetypeID, 0) || null;
      if (iceTypeIDs.length <= 0) {
        return null;
      }
      if (!includeNonIceBeltArchetypes && archetypeID !== 28) {
        return null;
      }
      const sourceDungeonID = toInt(
        template && template.sourceDungeonID,
        toInt(template && template.dungeonID, 0),
      );
      if (sourceDungeonID <= 0) {
        return null;
      }
      return {
        templateID: normalizeText(template && template.templateID, `client-dungeon:${sourceDungeonID}`),
        sourceDungeonID,
        archetypeID,
        dungeonNameID: toInt(template && template.dungeonNameID, 0) || null,
        iceTypeIDs,
        iceTypeNames: iceTypeIDs.map((typeID) => {
          const type = iceTypeIndex.byTypeID.get(typeID);
          return type ? type.name : String(typeID);
        }),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sourceDungeonID - right.sourceDungeonID);
}

function buildTemplateCompositionIndex(clientTemplates = loadClientIceDungeonTemplates()) {
  const index = new Map();
  for (const template of Array.isArray(clientTemplates) ? clientTemplates : []) {
    const key = compositionKey(template && template.iceTypeIDs);
    if (!key) {
      continue;
    }
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push({
      templateID: template.templateID,
      sourceDungeonID: toInt(template.sourceDungeonID, 0),
      archetypeID: toInt(template.archetypeID, 0) || null,
      dungeonNameID: toInt(template.dungeonNameID, 0) || null,
      iceTypeIDs: uniqueSortedInts(template.iceTypeIDs),
      iceTypeNames: Array.isArray(template.iceTypeNames) ? [...template.iceTypeNames] : [],
    });
  }
  return index;
}

function resolveIceTypeNames(typeIDs, iceTypeIndex) {
  return uniqueSortedInts(typeIDs).map((typeID) => {
    const type = iceTypeIndex && iceTypeIndex.byTypeID && iceTypeIndex.byTypeID.get(typeID);
    return type ? type.name : String(typeID);
  });
}

function buildClientTemplateCompositionDelta(iceTypeIDs, template, iceTypeIndex) {
  const dotlanTypeIDs = uniqueSortedInts(iceTypeIDs);
  const templateTypeIDs = uniqueSortedInts(template && template.iceTypeIDs);
  const dotlanTypeIDSet = new Set(dotlanTypeIDs);
  const templateTypeIDSet = new Set(templateTypeIDs);
  const matchedIceTypeIDs = dotlanTypeIDs.filter((typeID) => templateTypeIDSet.has(typeID));
  const missingFromDotlanTypeIDs = templateTypeIDs.filter((typeID) => !dotlanTypeIDSet.has(typeID));
  const missingFromTemplateTypeIDs = dotlanTypeIDs.filter((typeID) => !templateTypeIDSet.has(typeID));
  const score = missingFromDotlanTypeIDs.length + missingFromTemplateTypeIDs.length;

  return {
    templateID: normalizeText(template && template.templateID, ""),
    sourceDungeonID: toInt(template && template.sourceDungeonID, 0),
    archetypeID: toInt(template && template.archetypeID, 0) || null,
    dungeonNameID: toInt(template && template.dungeonNameID, 0) || null,
    exact: score === 0,
    score,
    iceTypeIDs: templateTypeIDs,
    iceTypeNames: resolveIceTypeNames(templateTypeIDs, iceTypeIndex),
    matchedIceTypeIDs,
    matchedIceTypeNames: resolveIceTypeNames(matchedIceTypeIDs, iceTypeIndex),
    missingFromDotlanTypeIDs,
    missingFromDotlanTypeNames: resolveIceTypeNames(missingFromDotlanTypeIDs, iceTypeIndex),
    missingFromTemplateTypeIDs,
    missingFromTemplateTypeNames: resolveIceTypeNames(missingFromTemplateTypeIDs, iceTypeIndex),
  };
}

function buildNearestClientTemplateDeltas(
  iceTypeIDs,
  clientTemplates = loadClientIceDungeonTemplates(),
  iceTypeIndex = buildIceTypeIndex(),
  limit = 3,
) {
  const dotlanTypeIDs = uniqueSortedInts(iceTypeIDs);
  if (dotlanTypeIDs.length <= 0) {
    return [];
  }
  return (Array.isArray(clientTemplates) ? clientTemplates : [])
    .map((template) => buildClientTemplateCompositionDelta(dotlanTypeIDs, template, iceTypeIndex))
    .filter((delta) => delta.sourceDungeonID > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      if (left.missingFromTemplateTypeIDs.length !== right.missingFromTemplateTypeIDs.length) {
        return left.missingFromTemplateTypeIDs.length - right.missingFromTemplateTypeIDs.length;
      }
      if (left.missingFromDotlanTypeIDs.length !== right.missingFromDotlanTypeIDs.length) {
        return left.missingFromDotlanTypeIDs.length - right.missingFromDotlanTypeIDs.length;
      }
      return left.sourceDungeonID - right.sourceDungeonID;
    })
    .slice(0, Math.max(1, toInt(limit, 3)));
}

function runWithMutedConsole(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = () => {};
    console.error = () => {};
    return callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function loadAuthorityRows() {
  return runWithMutedConsole(() => {
    const iceSystemAuthority = require(path.join(
      __dirname,
      "../../server/src/services/mining/iceSystemAuthority",
    ));
    return iceSystemAuthority.listIceSystemAuthorityRows();
  });
}

function buildAuthoritySystemSet(authorityRows = loadAuthorityRows()) {
  return new Set(
    (Array.isArray(authorityRows) ? authorityRows : [])
      .map((row) => toInt(row && row.solarSystemID, 0))
      .filter((solarSystemID) => solarSystemID > 0),
  );
}

function loadWorldSystems() {
  return loadStaticTableRows("solarSystems", "solarSystems");
}

function buildWorldSystemIndex(worldSystems = loadWorldSystems()) {
  if (worldSystems instanceof Map) {
    return worldSystems;
  }
  return new Map(
    (Array.isArray(worldSystems) ? worldSystems : [])
      .map((system) => [toInt(system && system.solarSystemID, 0), system])
      .filter(([solarSystemID]) => solarSystemID > 0),
  );
}

function buildSystemDetailIndex(systemDetailsBySystemID = {}) {
  if (systemDetailsBySystemID instanceof Map) {
    return systemDetailsBySystemID;
  }
  if (Array.isArray(systemDetailsBySystemID)) {
    return new Map(
      systemDetailsBySystemID
        .map((detail) => [toInt(detail && detail.solarSystemID, 0), detail])
        .filter(([solarSystemID]) => solarSystemID > 0),
    );
  }
  return new Map(
    Object.entries(systemDetailsBySystemID || {})
      .map(([key, detail]) => {
        const solarSystemID = toInt(
          detail && detail.solarSystemID,
          toInt(key, 0),
        );
        return [solarSystemID, {
          ...detail,
          solarSystemID,
        }];
      })
      .filter(([solarSystemID]) => solarSystemID > 0),
  );
}

function getSecurityBand(row, system) {
  const solarSystemID = toInt(
    system && system.solarSystemID,
    toInt(row && row.solarSystemID, 0),
  );
  if (solarSystemID >= 31000000 && solarSystemID < 32000000) {
    return "wormhole";
  }
  const security = toFiniteNumber(
    system && (system.securityStatus != null ? system.securityStatus : system.security),
    toFiniteNumber(row && row.security, 0),
  );
  if (security >= 0.45) {
    return "highsec";
  }
  if (security >= 0) {
    return "lowsec";
  }
  return "nullsec";
}

function incrementCounter(object, key, amount = 1) {
  const normalizedKey = normalizeText(key, "unknown");
  object[normalizedKey] = toInt(object[normalizedKey], 0) + amount;
}

function buildReviewReport(options = {}) {
  const regionRows = Array.isArray(options.regionRows) ? options.regionRows : [];
  const iceRows = regionRows.filter((row) => row && (row.hasIce || toInt(row.iceSlotCount, 0) > 0));
  const authoritySystemIDs = buildAuthoritySystemSet(options.authorityRows || loadAuthorityRows());
  const worldSystemsByID = buildWorldSystemIndex(options.worldSystems || loadWorldSystems());
  const systemDetailsByID = buildSystemDetailIndex(options.systemDetailsBySystemID || {});
  const iceTypeRows = options.iceTypeRows || loadLocalIceTypeRows();
  const iceTypeIndex = buildIceTypeIndex(iceTypeRows);
  const clientTemplates = options.clientTemplates || loadClientIceDungeonTemplates({ iceTypeRows });
  const templateIndex = buildTemplateCompositionIndex(clientTemplates);

  const rows = [];
  const bySecurityBand = {};
  const byReviewStatus = {};
  const compositionGroups = new Map();

  for (const dotlanRow of iceRows) {
    const solarSystemID = toInt(dotlanRow && dotlanRow.solarSystemID, 0);
    const worldSystem = worldSystemsByID.get(solarSystemID) || null;
    const detail = systemDetailsByID.get(solarSystemID) || null;
    const securityBand = getSecurityBand(dotlanRow, worldSystem);
    const currentAuthority = authoritySystemIDs.has(solarSystemID);
    const iceMatches = extractIceTypeMatchesFromMineralsText(
      detail && detail.mineralsIceText,
      iceTypeRows,
    );
    const iceTypeIDs = uniqueSortedInts(iceMatches.map((match) => match.typeID));
    const key = compositionKey(iceTypeIDs);
    const exactClientTemplates = key ? (templateIndex.get(key) || []) : [];
    const nearestClientTemplates = key
      ? buildNearestClientTemplateDeltas(iceTypeIDs, clientTemplates, iceTypeIndex)
      : [];
    const iceSlotCount = Math.max(0, toInt(dotlanRow && dotlanRow.iceSlotCount, 0));

    let reviewStatus = "blocked_missing_composition";
    if (!worldSystem) {
      reviewStatus = "blocked_unresolved_world_data";
    } else if (currentAuthority) {
      reviewStatus = "current_authority";
    } else if (iceTypeIDs.length <= 0) {
      reviewStatus = "blocked_missing_composition";
    } else if (exactClientTemplates.length > 0) {
      reviewStatus = "ready_exact_client_template";
    } else {
      reviewStatus = "blocked_no_exact_client_template";
    }

    const reportRow = {
      solarSystemID,
      solarSystemName: normalizeText(
        dotlanRow && dotlanRow.solarSystemName,
        worldSystem && worldSystem.solarSystemName,
      ),
      regionName: normalizeText(dotlanRow && dotlanRow.regionName, ""),
      regionSlug: normalizeText(dotlanRow && dotlanRow.regionSlug, ""),
      sourceURL: normalizeText(dotlanRow && dotlanRow.sourceURL, ""),
      security: toFiniteNumber(
        worldSystem && (worldSystem.securityStatus != null ? worldSystem.securityStatus : worldSystem.security),
        toFiniteNumber(dotlanRow && dotlanRow.security, 0),
      ),
      securityBand,
      securityClass: normalizeText(
        worldSystem && worldSystem.securityClass,
        normalizeText(dotlanRow && dotlanRow.securityClass, ""),
      ),
      constellationID: toInt(
        worldSystem && worldSystem.constellationID,
        toInt(dotlanRow && dotlanRow.constellationID, 0),
      ) || null,
      regionID: toInt(worldSystem && worldSystem.regionID, 0) || null,
      iceSlotCount,
      currentAuthority,
      worldDataResolved: !!worldSystem,
      mineralsIceText: normalizeText(detail && detail.mineralsIceText, ""),
      hiddenIceBeltPresent: detail ? detail.hiddenIceBeltPresent === true : null,
      hiddenIceBeltRowCount: detail ? toInt(detail.hiddenIceBeltRowCount, 0) : null,
      iceTypeIDs,
      iceTypeNames: iceMatches.map((match) => match.name),
      exactClientDungeonIDs: exactClientTemplates
        .map((template) => toInt(template.sourceDungeonID, 0))
        .filter((sourceDungeonID) => sourceDungeonID > 0),
      nearestClientTemplates,
      reviewStatus,
    };

    rows.push(reportRow);
    incrementCounter(byReviewStatus, reviewStatus);
    if (!bySecurityBand[securityBand]) {
      bySecurityBand[securityBand] = {
        systems: 0,
        slots: 0,
        currentAuthoritySystems: 0,
        missingAuthoritySystems: 0,
      };
    }
    bySecurityBand[securityBand].systems += 1;
    bySecurityBand[securityBand].slots += iceSlotCount;
    if (currentAuthority) {
      bySecurityBand[securityBand].currentAuthoritySystems += 1;
    } else {
      bySecurityBand[securityBand].missingAuthoritySystems += 1;
    }

    if (key) {
      if (!compositionGroups.has(key)) {
        compositionGroups.set(key, {
          compositionKey: key,
          iceTypeIDs,
          iceTypeNames: reportRow.iceTypeNames,
          matchingClientDungeonIDs: reportRow.exactClientDungeonIDs,
          nearestClientTemplates: reportRow.nearestClientTemplates,
          systems: 0,
          slots: 0,
          currentAuthoritySystems: 0,
          missingAuthoritySystems: 0,
          sampleSystems: [],
        });
      }
      const group = compositionGroups.get(key);
      group.systems += 1;
      group.slots += iceSlotCount;
      if (currentAuthority) {
        group.currentAuthoritySystems += 1;
      } else {
        group.missingAuthoritySystems += 1;
      }
      if (group.sampleSystems.length < 10) {
        group.sampleSystems.push({
          solarSystemID,
          solarSystemName: reportRow.solarSystemName,
          regionName: reportRow.regionName,
          security: reportRow.security,
        });
      }
    }
  }

  rows.sort((left, right) => left.solarSystemID - right.solarSystemID);
  const compositionSets = [...compositionGroups.values()]
    .sort((left, right) => {
      if (right.systems !== left.systems) {
        return right.systems - left.systems;
      }
      return left.compositionKey.localeCompare(right.compositionKey);
    });
  const systemsWithComposition = rows.filter((row) => row.iceTypeIDs.length > 0).length;
  const systemsWithExactClientTemplate = rows
    .filter((row) => row.iceTypeIDs.length > 0 && row.exactClientDungeonIDs.length > 0)
    .length;
  const missingAuthorityRows = rows.filter((row) => !row.currentAuthority);
  const missingAuthoritySystemsWithComposition = missingAuthorityRows
    .filter((row) => row.iceTypeIDs.length > 0)
    .length;
  const missingAuthoritySystemsWithExactClientTemplate = missingAuthorityRows
    .filter((row) => row.iceTypeIDs.length > 0 && row.exactClientDungeonIDs.length > 0)
    .length;
  const readyImportSystems = rows
    .filter((row) => row.reviewStatus === "ready_exact_client_template")
    .length;

  return {
    summary: {
      dotlanIceSystems: rows.length,
      dotlanIceSlots: rows.reduce((sum, row) => sum + row.iceSlotCount, 0),
      currentAuthoritySystems: rows.filter((row) => row.currentAuthority).length,
      missingAuthoritySystems: missingAuthorityRows.length,
      missingAuthoritySlots: missingAuthorityRows
        .reduce((sum, row) => sum + row.iceSlotCount, 0),
      resolvedWorldSystems: rows.filter((row) => row.worldDataResolved).length,
      unresolvedWorldSystems: rows.filter((row) => !row.worldDataResolved).length,
      systemsWithComposition,
      systemsMissingComposition: rows.length - systemsWithComposition,
      missingAuthoritySystemsWithComposition,
      missingAuthoritySystemsMissingComposition:
        missingAuthorityRows.length - missingAuthoritySystemsWithComposition,
      uniqueCompositionSets: compositionSets.length,
      systemsWithExactClientTemplate,
      systemsWithoutExactClientTemplate: systemsWithComposition - systemsWithExactClientTemplate,
      missingAuthoritySystemsWithExactClientTemplate,
      missingAuthoritySystemsWithoutExactClientTemplate:
        missingAuthoritySystemsWithComposition - missingAuthoritySystemsWithExactClientTemplate,
      readyImportSystems,
      blockedImportSystems: missingAuthorityRows.length - readyImportSystems,
      bySecurityBand,
      byReviewStatus,
    },
    compositionSets,
    rows,
  };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "eve.js parity ice-authority review",
      },
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`GET ${url} failed with HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const source = Array.isArray(items) ? items : [];
  const limit = Math.max(1, toInt(concurrency, 1));
  const results = new Array(source.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, source.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= source.length) {
        return;
      }
      results[index] = await mapper(source[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchRegionRows(slugs = extractor.DOTLAN_REGION_SLUGS) {
  const rows = [];
  for (const slug of slugs) {
    const regionSlug = normalizeText(slug).replace(/\s+/g, "_");
    const sourceURL = `${DOTLAN_BASE_URL}/region/${regionSlug}`;
    const html = await fetchText(sourceURL);
    rows.push(...extractor.parseDotlanRegionSystems(html, {
      regionName: regionSlug.replace(/_/g, " "),
      regionSlug,
      sourceURL,
    }));
  }
  return rows.sort((left, right) => left.solarSystemID - right.solarSystemID);
}

function selectRowsForCelestialsFetch(rows, scope, authorityRows, worldSystems) {
  const authoritySystemIDs = buildAuthoritySystemSet(authorityRows || loadAuthorityRows());
  const worldSystemsByID = buildWorldSystemIndex(worldSystems || loadWorldSystems());
  const normalizedScope = normalizeText(scope, "none").toLowerCase();
  if (normalizedScope === "none") {
    return [];
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && (row.hasIce || toInt(row.iceSlotCount, 0) > 0))
    .filter((row) => {
      const solarSystemID = toInt(row && row.solarSystemID, 0);
      const currentAuthority = authoritySystemIDs.has(solarSystemID);
      const securityBand = getSecurityBand(row, worldSystemsByID.get(solarSystemID));
      if (normalizedScope === "all") {
        return true;
      }
      if (normalizedScope === "missing-authority") {
        return !currentAuthority;
      }
      if (normalizedScope === "nullsec") {
        return securityBand === "nullsec";
      }
      if (normalizedScope === "missing-nullsec") {
        return !currentAuthority && securityBand === "nullsec";
      }
      throw new Error(`Unknown celestials fetch scope: ${scope}`);
    });
}

async function fetchSystemCelestialDetails(rows, options = {}) {
  const concurrency = Math.max(1, toInt(options.concurrency, 6));
  const selectedRows = selectRowsForCelestialsFetch(
    rows,
    options.scope || "none",
    options.authorityRows,
    options.worldSystems,
  );
  return mapWithConcurrency(selectedRows, concurrency, async (row) => {
    const solarSystemID = toInt(row && row.solarSystemID, 0);
    const slug = normalizeText(row && row.solarSystemSlug, row && row.solarSystemName)
      .replace(/\s+/g, "_");
    const sourceURL = `${DOTLAN_BASE_URL}/system/${encodeURIComponent(slug)}/celestials`;
    try {
      const html = await fetchText(sourceURL);
      return {
        solarSystemID,
        ...extractor.parseDotlanSystemCelestials(html, {
          sourceURL,
          solarSystemName: row && row.solarSystemName,
        }),
      };
    } catch (error) {
      return {
        solarSystemID,
        solarSystemName: normalizeText(row && row.solarSystemName, ""),
        sourceURL,
        fetchError: error && error.message ? error.message : String(error),
      };
    }
  });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function normalizeRegionRowsJson(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value && value.rows)) {
    return value.rows;
  }
  throw new Error("Region JSON must be an array or an extractor output object with a rows array");
}

function normalizeSystemDetailsJson(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value && value.rows)) {
    return value.rows;
  }
  return value || {};
}

function printHelp() {
  process.stdout.write([
    "Usage:",
    "  node tools/IceAuthority/dotlanIceAuthorityReviewReport.js --region-json <file> [--system-json <file>]",
    "  node tools/IceAuthority/dotlanIceAuthorityReviewReport.js --fetch-all-regions [--fetch-celestials missing-nullsec]",
    "  node tools/IceAuthority/dotlanIceAuthorityReviewReport.js --fetch-region <DOTLAN region slug> [--fetch-celestials all]",
    "",
    "Celestials fetch scopes: none, all, missing-authority, nullsec, missing-nullsec.",
    "The tool prints review JSON to stdout and never writes server authority/static data.",
  ].join("\n"));
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const regionJsonIndex = argv.indexOf("--region-json");
  const systemJsonIndex = argv.indexOf("--system-json");
  const fetchRegionIndex = argv.indexOf("--fetch-region");
  const fetchCelestialsIndex = argv.indexOf("--fetch-celestials");
  const concurrencyIndex = argv.indexOf("--celestial-concurrency");
  let regionRows = [];

  if (regionJsonIndex >= 0) {
    const filePath = argv[regionJsonIndex + 1];
    if (!filePath) {
      throw new Error("--region-json requires a file path");
    }
    regionRows = normalizeRegionRowsJson(readJsonFile(filePath));
  } else if (fetchRegionIndex >= 0) {
    const slug = argv[fetchRegionIndex + 1];
    if (!slug) {
      throw new Error("--fetch-region requires a DOTLAN region slug");
    }
    regionRows = await fetchRegionRows([slug]);
  } else if (argv.includes("--fetch-all-regions")) {
    regionRows = await fetchRegionRows();
  } else {
    printHelp();
    return 1;
  }

  let systemDetails = {};
  if (systemJsonIndex >= 0) {
    const filePath = argv[systemJsonIndex + 1];
    if (!filePath) {
      throw new Error("--system-json requires a file path");
    }
    systemDetails = normalizeSystemDetailsJson(readJsonFile(filePath));
  }

  if (fetchCelestialsIndex >= 0) {
    const scope = normalizeText(argv[fetchCelestialsIndex + 1], "");
    if (!scope) {
      throw new Error("--fetch-celestials requires a scope");
    }
    const fetchedDetails = await fetchSystemCelestialDetails(regionRows, {
      scope,
      concurrency: concurrencyIndex >= 0 ? argv[concurrencyIndex + 1] : 6,
    });
    const detailMap = buildSystemDetailIndex(systemDetails);
    for (const detail of fetchedDetails) {
      detailMap.set(toInt(detail && detail.solarSystemID, 0), detail);
    }
    systemDetails = detailMap;
  }

  const report = buildReviewReport({
    regionRows,
    systemDetailsBySystemID: systemDetails,
  });
  if (argv.includes("--summary-only")) {
    delete report.rows;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildIceTypeIndex,
  buildClientTemplateCompositionDelta,
  buildNearestClientTemplateDeltas,
  extractIceTypeMatchesFromMineralsText,
  buildTemplateCompositionIndex,
  buildReviewReport,
  selectRowsForCelestialsFetch,
  fetchSystemCelestialDetails,
  loadLocalIceTypeRows,
  loadClientIceDungeonTemplates,
};
