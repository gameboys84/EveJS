#!/usr/bin/env node

const fs = require("fs");
const https = require("https");

const DOTLAN_BASE_URL = "https://evemaps.dotlan.net";

const DOTLAN_REGION_SLUGS = Object.freeze([
  "Aridia",
  "Black_Rise",
  "The_Bleak_Lands",
  "Branch",
  "Cache",
  "Catch",
  "The_Citadel",
  "Cloud_Ring",
  "Cobalt_Edge",
  "Curse",
  "Deklein",
  "Delve",
  "Derelik",
  "Detorid",
  "Devoid",
  "Domain",
  "Esoteria",
  "Essence",
  "Etherium_Reach",
  "Everyshore",
  "Exordium",
  "Fade",
  "Feythabolis",
  "The_Forge",
  "Fountain",
  "Geminate",
  "Genesis",
  "Great_Wildlands",
  "Heimatar",
  "Immensea",
  "Impass",
  "Insmother",
  "Kador",
  "The_Kalevala_Expanse",
  "Khanid",
  "Kor-Azor",
  "Lonetrek",
  "Malpais",
  "Metropolis",
  "Molden_Heath",
  "Oasa",
  "Omist",
  "Outer_Passage",
  "Outer_Ring",
  "Paragon_Soul",
  "Period_Basis",
  "Perrigen_Falls",
  "Placid",
  "Pochven",
  "Providence",
  "Pure_Blind",
  "Querious",
  "Scalding_Pass",
  "Sinq_Laison",
  "Solitude",
  "The_Spire",
  "Stain",
  "Syndicate",
  "Tash-Murkon",
  "Tenal",
  "Tenerifis",
  "Tribute",
  "Vale_of_the_Silent",
  "Venal",
  "Verge_Vendor",
  "Wicked_Creek",
  "Yasna_Zakh",
]);

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

function normalizeRegionSlug(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function decodeHtmlEntities(value) {
  return String(value == null ? "" : value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(toInt(code, 0)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value) {
  return normalizeText(
    decodeHtmlEntities(String(value == null ? "" : value).replace(/<[^>]*>/g, " ")),
  );
}

function extractRegionName(html, fallback = "") {
  const title = /<title>\s*([\s\S]+?)\s+-\s+DOTLAN\s*::\s*EveMaps\s*<\/title>/i.exec(html);
  if (title) {
    return stripTags(title[1]);
  }
  const heading = /<h2[^>]*>\s*([^<]+?)\s*<\/h2>/i.exec(html);
  if (heading) {
    return stripTags(heading[1]);
  }
  return normalizeText(fallback);
}

function parseBeltIceCell(cellHtml) {
  const raw = String(cellHtml == null ? "" : cellHtml);
  const text = stripTags(raw);
  const iceMatch = /color:\s*blue;?[^>]*>\s*\+(\d+)\s*</i.exec(raw) || /\+(\d+)/.exec(text);
  const beltMatch = /^\s*(\d+)/.exec(text);
  return {
    asteroidBeltCount: beltMatch ? toInt(beltMatch[1], 0) : 0,
    iceSlotCount: iceMatch ? toInt(iceMatch[1], 0) : 0,
    rawText: text,
  };
}

function getTableCells(rowHtml) {
  return [...String(rowHtml == null ? "" : rowHtml).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => match[1]);
}

function findTableCellValueByLabel(html, labelPattern) {
  for (const rowMatch of String(html == null ? "" : html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = getTableCells(rowMatch[1]);
    if (cells.length < 2) {
      continue;
    }
    const label = stripTags(cells[0]);
    if (labelPattern.test(label)) {
      return cells.slice(1).join(" ");
    }
  }
  return "";
}

function parseDotlanRegionSystems(html, options = {}) {
  const sourceURL = normalizeText(options.sourceURL, "");
  const regionName = normalizeText(options.regionName, extractRegionName(html, ""));
  const regionSlug = normalizeRegionSlug(options.regionSlug || regionName);
  const rows = [];

  for (const rowMatch of String(html == null ? "" : html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const systemMatch = /<a\s+href="\/system\/([^"]+)"[^>]*class="[^"]*\blink-5-(\d+)\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(rowHtml);
    if (!systemMatch) {
      continue;
    }
    const cells = getTableCells(rowHtml);
    if (cells.length < 3) {
      continue;
    }
    const beltsCell = cells[cells.length - 2] || "";
    const beltIce = parseBeltIceCell(beltsCell);
    const constellationMatch = /<a\s+href="\/map\/[^/"]+\/[^"]+"[^>]*class="[^"]*\blink-4-(\d+)\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(rowHtml);
    const securityMatch = /<span\s+class="([^"]+)"\s+title="([^"]+)">([\s\S]*?)<\/span>/i.exec(rowHtml);
    const securityClass = stripTags(cells[3] || "");

    rows.push({
      regionName,
      regionSlug,
      sourceURL,
      solarSystemID: toInt(systemMatch[2], 0),
      solarSystemName: stripTags(systemMatch[3]),
      solarSystemSlug: decodeURIComponent(systemMatch[1]),
      constellationID: constellationMatch ? toInt(constellationMatch[1], 0) : null,
      constellationName: constellationMatch ? stripTags(constellationMatch[2]) : null,
      securityBand: securityMatch ? normalizeText(securityMatch[1]).toLowerCase() : null,
      security: securityMatch ? toFiniteNumber(securityMatch[2], 0) : null,
      securityDisplay: securityMatch ? stripTags(securityMatch[3]) : null,
      securityClass: securityClass || null,
      asteroidBeltCount: beltIce.asteroidBeltCount,
      iceSlotCount: beltIce.iceSlotCount,
      hasIce: beltIce.iceSlotCount > 0,
      beltsIceText: beltIce.rawText,
    });
  }

  return rows.sort((left, right) => left.solarSystemID - right.solarSystemID);
}

function extractSystemNameFromCelestials(html, fallback = "") {
  const hidden = /<a\s+name="([^"]+)_-_Hidden_Ice_Belt"/i.exec(html);
  if (hidden) {
    return stripTags(hidden[1].replace(/_/g, " "));
  }
  const title = /<title>\s*([\s\S]+?)\s+-\s+Celestials\s+-\s+DOTLAN/i.exec(html);
  if (title) {
    return stripTags(title[1]).split(" - ").pop();
  }
  return normalizeText(fallback);
}

function extractMineralsIceText(html) {
  const value = findTableCellValueByLabel(html, /Minerals\/\s*Ice/i);
  if (!value) {
    return "";
  }
  return stripTags(value).replace(/\s*\(not accurate\)\s*$/i, "");
}

function parseDotlanSystemCelestials(html, options = {}) {
  const sourceURL = normalizeText(options.sourceURL, "");
  const systemName = normalizeText(options.solarSystemName, extractSystemNameFromCelestials(html, ""));
  const summaryCell = findTableCellValueByLabel(html, /Belts\/\s*Icebelts/i);
  const securityMatch = /<td[^>]*>\s*<b>Security Level<\/b>\s*<\/td>\s*<td[^>]*><span\s+class="([^"]+)"\s+title="([^"]+)">([\s\S]*?)<\/span>/i.exec(html);
  const hiddenMatches = [...String(html == null ? "" : html).matchAll(/Hidden_Ice_Belt/gi)];
  const beltIce = parseBeltIceCell(summaryCell);

  return {
    sourceURL,
    solarSystemName: systemName,
    securityBand: securityMatch ? normalizeText(securityMatch[1]).toLowerCase() : null,
    security: securityMatch ? toFiniteNumber(securityMatch[2], 0) : null,
    securityDisplay: securityMatch ? stripTags(securityMatch[3]) : null,
    asteroidBeltCount: beltIce.asteroidBeltCount,
    iceSlotCount: beltIce.iceSlotCount,
    hasIce: beltIce.iceSlotCount > 0 || hiddenMatches.length > 0,
    hiddenIceBeltPresent: hiddenMatches.length > 0,
    hiddenIceBeltRowCount: hiddenMatches.length,
    mineralsIceText: extractMineralsIceText(html),
    beltsIceText: beltIce.rawText,
  };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "eve.js parity ice-authority extractor",
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

async function loadRegionHtml(slug) {
  const regionSlug = normalizeRegionSlug(slug);
  const sourceURL = `${DOTLAN_BASE_URL}/region/${regionSlug}`;
  return {
    sourceURL,
    html: await fetchText(sourceURL),
  };
}

function buildSummary(rows) {
  const iceRows = rows.filter((row) => row && row.hasIce);
  return {
    regions: [...new Set(rows.map((row) => row.regionName).filter(Boolean))].sort(),
    totalSystems: rows.length,
    iceSystems: iceRows.length,
    iceSlots: iceRows.reduce((sum, row) => sum + toInt(row.iceSlotCount, 0), 0),
  };
}

function printHelp() {
  process.stdout.write([
    "Usage:",
    "  node tools/IceAuthority/dotlanIceAuthorityExtractor.js --region-html <file> [--region <name>]",
    "  node tools/IceAuthority/dotlanIceAuthorityExtractor.js --system-html <file>",
    "  node tools/IceAuthority/dotlanIceAuthorityExtractor.js --fetch-region <DOTLAN region slug>",
    "  node tools/IceAuthority/dotlanIceAuthorityExtractor.js --fetch-all-regions",
    "",
    "The tool only prints extracted candidate JSON to stdout. It never writes server authority data.",
  ].join("\n"));
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const regionHtmlIndex = argv.indexOf("--region-html");
  const systemHtmlIndex = argv.indexOf("--system-html");
  const fetchRegionIndex = argv.indexOf("--fetch-region");
  const regionNameIndex = argv.indexOf("--region");

  if (systemHtmlIndex >= 0) {
    const htmlPath = argv[systemHtmlIndex + 1];
    if (!htmlPath) {
      throw new Error("--system-html requires a file path");
    }
    const html = fs.readFileSync(htmlPath, "utf8");
    const row = parseDotlanSystemCelestials(html, {
      sourceURL: htmlPath,
    });
    process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
    return 0;
  }

  let rows = [];
  if (regionHtmlIndex >= 0) {
    const htmlPath = argv[regionHtmlIndex + 1];
    if (!htmlPath) {
      throw new Error("--region-html requires a file path");
    }
    const html = fs.readFileSync(htmlPath, "utf8");
    rows = parseDotlanRegionSystems(html, {
      regionName: regionNameIndex >= 0 ? argv[regionNameIndex + 1] : undefined,
      sourceURL: htmlPath,
    });
  } else if (fetchRegionIndex >= 0) {
    const slug = argv[fetchRegionIndex + 1];
    if (!slug) {
      throw new Error("--fetch-region requires a DOTLAN region slug");
    }
    const fetched = await loadRegionHtml(slug);
    rows = parseDotlanRegionSystems(fetched.html, {
      regionName: slug.replace(/_/g, " "),
      regionSlug: slug,
      sourceURL: fetched.sourceURL,
    });
  } else if (argv.includes("--fetch-all-regions")) {
    for (const slug of DOTLAN_REGION_SLUGS) {
      const fetched = await loadRegionHtml(slug);
      rows.push(...parseDotlanRegionSystems(fetched.html, {
        regionName: slug.replace(/_/g, " "),
        regionSlug: slug,
        sourceURL: fetched.sourceURL,
      }));
    }
  } else {
    printHelp();
    return 1;
  }

  process.stdout.write(`${JSON.stringify({
    summary: buildSummary(rows),
    rows,
  }, null, 2)}\n`);
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
  DOTLAN_REGION_SLUGS,
  parseBeltIceCell,
  parseDotlanRegionSystems,
  parseDotlanSystemCelestials,
  buildSummary,
};
