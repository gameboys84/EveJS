const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const syntheticNullsecAuthority = require(path.join(
  __dirname,
  "./iceSystemSyntheticNullsecAuthority.json",
));

const SOURCE = Object.freeze({
  systemList: "https://wiki.eveuniversity.org/Ice_harvesting",
  dotlanRegionList: "https://evemaps.dotlan.net/region",
  dotlanSystemCelestials: "https://evemaps.dotlan.net/system/<solarSystemName>/celestials",
  syntheticNullsecAuthority: "server/src/services/mining/iceSystemSyntheticNullsecAuthority.json",
  respawnRule: "https://www.eveonline.com/news/view/patch-notes-version-19-08",
});

const ICE_TYPE_NAMES_BY_DUNGEON_ID = Object.freeze({
  5496: Object.freeze(["Blue Ice"]),
  5497: Object.freeze(["White Glaze"]),
  5498: Object.freeze(["Glacial Mass"]),
  5499: Object.freeze(["Clear Icicle"]),
  5500: Object.freeze(["Blue Ice", "Glare Crust"]),
  5501: Object.freeze(["White Glaze", "Glare Crust"]),
  5502: Object.freeze(["Glacial Mass", "Glare Crust"]),
  5503: Object.freeze(["Clear Icicle", "Glare Crust"]),
  5504: Object.freeze(["Blue Ice IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus"]),
  5505: Object.freeze(["White Glaze IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus"]),
  5506: Object.freeze(["Glacial Mass IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus"]),
  5507: Object.freeze(["Clear Icicle IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus"]),
  5508: Object.freeze(["Blue Ice IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus", "Krystallos"]),
  5509: Object.freeze(["White Glaze IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus", "Krystallos"]),
  5510: Object.freeze(["Glacial Mass IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus", "Krystallos"]),
  5511: Object.freeze(["Clear Icicle IV-Grade", "Glare Crust", "Dark Glitter", "Gelidus", "Krystallos"]),
});

const QUARTERS = Object.freeze({
  amarr: Object.freeze({
    label: "Amarr",
    factionName: "Amarr Empire",
    sourceDungeonIDs: Object.freeze({
      highsec: 5499,
      lowsec: 5503,
      nullsec: 5511,
    }),
    systemNames: Object.freeze([
      "Afivad",
      "Anath",
      "Avada",
      "Bashakru",
      "Bordan",
      "Bourar",
      "Cabeki",
      "Chanoun",
      "Claini",
      "Dantan",
      "Dihra",
      "Enal",
      "Erkinen",
      "Esteban",
      "Feshur",
      "Gasavak",
      "Gemodi",
      "Gosalav",
      "Haras",
      "Hezere",
      "Hoseen",
      "Illi",
      "Jarzalad",
      "Jerma",
      "Kamih",
      "Kothe",
      "Menri",
      "Miah",
      "Modun",
      "Moutid",
      "Naguton",
      "Nebian",
      "Oberen",
      "Ordion",
      "Pemsah",
      "Riavayed",
      "Sadana",
      "Schmaeel",
      "Seil",
      "Sosala",
      "Sosan",
      "Talidal",
      "Tannakan",
      "Tisot",
      "Upt",
      "Ussad",
      "Vezila",
      "Warouh",
      "Yahyerer",
      "Zatamaka",
      "Zazamye",
      "Zorenyen",
    ]),
  }),
  caldari: Object.freeze({
    label: "Caldari",
    factionName: "Caldari State",
    sourceDungeonIDs: Object.freeze({
      highsec: 5497,
      lowsec: 5501,
      nullsec: 5509,
    }),
    systemNames: Object.freeze([
      "Aakari",
      "Ahtulaima",
      "Dantumi",
      "Elonaya",
      "Fuskunen",
      "Gekutami",
      "Halaima",
      "Hallanen",
      "Hasama",
      "Hentogaira",
      "Hurtoken",
      "Hysera",
      "Jotenen",
      "Kehjari",
      "Kiskoken",
      "Mitsolen",
      "Obe",
      "Oishami",
      "Osmon",
      "Oto",
      "Outuni",
      "Passari",
      "Pavanakka",
      "Piekura",
      "Prism",
      "Reitsato",
      "Silen",
      "Sirseshin",
      "Teimo",
      "Uchomida",
      "Uotila",
      "Vattuolen",
      "Wuos",
      "Yoma",
    ]),
  }),
  gallente: Object.freeze({
    label: "Gallente",
    factionName: "Gallente Federation",
    sourceDungeonIDs: Object.freeze({
      highsec: 5496,
      lowsec: 5500,
      nullsec: 5508,
    }),
    systemNames: Object.freeze([
      "Actee",
      "Aeschee",
      "Agoze",
      "Alachene",
      "Alparena",
      "Alsavoinon",
      "Antollare",
      "Ardallabier",
      "Atlulle",
      "Aubenall",
      "Avaux",
      "Aydoteaux",
      "Brapelille",
      "Cadelanne",
      "Carirgnottin",
      "Carrou",
      "Chelien",
      "Costolle",
      "Cumemare",
      "Deninard",
      "Eugales",
      "Fliet",
      "Gallusiene",
      "Indregulle",
      "Jaschercis",
      "Lamadent",
      "Mannar",
      "Maut",
      "Mercomesier",
      "Misneden",
      "Niballe",
      "Palmon",
      "Rancer",
      "Ratillose",
      "Ruerrotta",
      "Stegette",
      "Thelan",
      "Tolle",
      "Uphallant",
      "Vaurent",
      "Vevelonel",
    ]),
  }),
  minmatar: Object.freeze({
    label: "Minmatar",
    factionName: "Minmatar Republic",
    sourceDungeonIDs: Object.freeze({
      highsec: 5498,
      lowsec: 5502,
      nullsec: 5510,
    }),
    systemNames: Object.freeze([
      "Abudban",
      "Asgeir",
      "Barkrik",
      "Dantbeinn",
      "Egmar",
      "Emolgranlan",
      "Endrulf",
      "Eszur",
      "Eygfe",
      "Finanar",
      "Gedugaud",
      "Hegfunden",
      "Helgatild",
      "Hodrold",
      "Hrokkur",
      "Nakugard",
      "Nein",
      "Oddelulf",
      "Oppold",
      "Osvetur",
      "Sirekur",
      "Teonusude",
      "Todifrauan",
      "Turnur",
      "Uisper",
      "Vard",
      "Varigne",
      "Weld",
      "Wiskeber",
    ]),
  }),
  ammatar: Object.freeze({
    label: "Ammatar",
    factionName: "Ammatar Mandate",
    sourceDungeonIDs: Object.freeze({
      highsec: 5499,
      lowsec: 5503,
      nullsec: 5511,
    }),
    systemNames: Object.freeze([
      "Astabih",
      "Faspera",
      "Gamis",
      "Gelhan",
      "Kenobanala",
      "Lilmad",
      "Mahti",
      "Majamar",
      "Nakah",
      "Yishinoon",
    ]),
  }),
});

const RESPAWN_DELAY_MINUTES = 360;
const GUARANTEED_SLOTS_PER_SYSTEM = 1;

const PENDING_COMPOSITION_SYSTEMS = Object.freeze([]);
const PENDING_COMPOSITION_SYSTEM_IDS = Object.freeze(new Set(
  PENDING_COMPOSITION_SYSTEMS.map((row) => row.solarSystemID),
));

const SHATTERED_WORMHOLE_ICE_TODO = Object.freeze({
  scope: "shattered_wormholes",
  status: "deferred",
  reason: "Needs a directed pass for shattered-system eligibility, slot counts, and template policy.",
});

const DOTLAN_SLOT_COUNT_BY_SYSTEM_ID = Object.freeze({
  30000180: Object.freeze({ slotCount: 3, sourceURL: "https://evemaps.dotlan.net/region/The_Forge" }),
  30000187: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/The_Forge" }),
  30000188: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/The_Forge" }),
  30002238: Object.freeze({ slotCount: 3, sourceURL: "https://evemaps.dotlan.net/region/Domain" }),
  30002409: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Molden_Heath" }),
  30002987: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Devoid" }),
  30002993: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Devoid" }),
  30003055: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Everyshore" }),
  30003060: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Everyshore" }),
  30003469: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Metropolis" }),
  30003495: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Pochven" }),
  30003841: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Placid" }),
  30003889: Object.freeze({ slotCount: 3, sourceURL: "https://evemaps.dotlan.net/region/Khanid" }),
  30004981: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Essence" }),
  30005063: Object.freeze({ slotCount: 2, sourceURL: "https://evemaps.dotlan.net/region/Kor-Azor" }),
});

const DOTLAN_SUPPLEMENTAL_HIGH_LOW_SYSTEMS = Object.freeze([
  Object.freeze({
    solarSystemID: 30000017,
    solarSystemName: "Futzchag",
    quarter: "ammatar",
    slotCount: 2,
    sourceURL: "https://evemaps.dotlan.net/region/Derelik",
  }),
  Object.freeze({
    solarSystemID: 30002782,
    solarSystemName: "Kamio",
    quarter: "caldari",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/The_Citadel",
  }),
  Object.freeze({
    solarSystemID: 30003439,
    solarSystemName: "Aderkan",
    quarter: "minmatar",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Metropolis",
  }),
  Object.freeze({
    solarSystemID: 30004988,
    solarSystemName: "Hulmate",
    quarter: "gallente",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Essence",
  }),
  Object.freeze({
    solarSystemID: 30005207,
    solarSystemName: "Nardiarang",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005224,
    solarSystemName: "Assez",
    quarter: "amarr",
    slotCount: 2,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005230,
    solarSystemName: "Manatirid",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005238,
    solarSystemName: "Menai",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005241,
    solarSystemName: "Petidu",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005260,
    solarSystemName: "Keri",
    quarter: "amarr",
    slotCount: 3,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005264,
    solarSystemName: "Angur",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005266,
    solarSystemName: "Access",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005268,
    solarSystemName: "Gonditsa",
    quarter: "amarr",
    slotCount: 2,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005280,
    solarSystemName: "Partod",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
  Object.freeze({
    solarSystemID: 30005292,
    solarSystemName: "Agal",
    quarter: "amarr",
    slotCount: 1,
    sourceURL: "https://evemaps.dotlan.net/region/Genesis",
  }),
]);

let cachedRows = null;
let cachedRowsBySystemID = null;
let cachedTypeIDsByName = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function getSecurityBandForSystem(system) {
  const systemID = toInt(system && system.solarSystemID, 0);
  if (systemID >= 31_000_000 && systemID <= 31_999_999) {
    return "wormhole";
  }
  const security = toFiniteNumber(
    system && (system.securityStatus != null ? system.securityStatus : system.security),
    0,
  );
  if (security >= 0.45) {
    return "highsec";
  }
  if (security >= 0) {
    return "lowsec";
  }
  return "nullsec";
}

function getSystemsByName() {
  return new Map(
    worldData.getSolarSystems()
      .map((system) => [normalizeLowerText(system && system.solarSystemName, ""), system])
      .filter(([name]) => !!name),
  );
}

function getIceTypeIDsByName() {
  if (cachedTypeIDsByName) {
    return cachedTypeIDsByName;
  }
  cachedTypeIDsByName = new Map();
  const names = new Set([
    ...Object.values(ICE_TYPE_NAMES_BY_DUNGEON_ID).flat(),
    ...(Array.isArray(syntheticNullsecAuthority && syntheticNullsecAuthority.rows)
      ? syntheticNullsecAuthority.rows.flatMap((row) => (
        Array.isArray(row && row.iceTypeNames) ? row.iceTypeNames : []
      ))
      : []),
  ]);
  for (const name of names) {
    const lookup = resolveItemByName(name);
    const typeID = toInt(lookup && lookup.success && lookup.match && lookup.match.typeID, 0);
    if (typeID > 0) {
      cachedTypeIDsByName.set(name, typeID);
    }
  }
  return cachedTypeIDsByName;
}

function resolveIceTypeIDs(sourceDungeonID, iceTypeNamesOverride = null) {
  const byName = getIceTypeIDsByName();
  const names = Array.isArray(iceTypeNamesOverride) && iceTypeNamesOverride.length > 0
    ? iceTypeNamesOverride
    : (ICE_TYPE_NAMES_BY_DUNGEON_ID[toInt(sourceDungeonID, 0)] || []);
  return names
    .map((name) => byName.get(name))
    .filter((typeID) => toInt(typeID, 0) > 0);
}

function buildAuthorityRow(options) {
  const system = options && options.system;
  const systemName = normalizeText(options && options.systemName, system && system.solarSystemName);
  const quarterKey = normalizeLowerText(options && options.quarterKey, "");
  const quarter = QUARTERS[quarterKey];
  if (!quarter) {
    throw new Error(`Ice authority quarter not found for ${systemName}: ${quarterKey}`);
  }

  const solarSystemID = toInt(system && system.solarSystemID, 0);
  if (PENDING_COMPOSITION_SYSTEM_IDS.has(solarSystemID)) {
    return null;
  }
  const securityBand = getSecurityBandForSystem(system);
  const sourceDungeonID = toInt(quarter.sourceDungeonIDs[securityBand], 0);
  if (sourceDungeonID <= 0) {
    return null;
  }
  const slotEvidence =
    (options && options.slotEvidence) ||
    DOTLAN_SLOT_COUNT_BY_SYSTEM_ID[solarSystemID] ||
    null;
  const slotCount = slotEvidence
    ? Math.max(1, toInt(slotEvidence.slotCount, GUARANTEED_SLOTS_PER_SYSTEM))
    : GUARANTEED_SLOTS_PER_SYSTEM;
  const slotSourceURL = normalizeText(slotEvidence && slotEvidence.sourceURL, "");
  const iceTypeNames = ICE_TYPE_NAMES_BY_DUNGEON_ID[sourceDungeonID] || [];

  return Object.freeze({
    authorityKey: normalizeText(options && options.authorityKey, `ice:${quarterKey}:${solarSystemID}`),
    authorityScope: normalizeText(options && options.authorityScope, "empire_space"),
    confidence: normalizeText(options && options.confidence, "secondary_public_source"),
    source: normalizeText(options && options.source, "eve_university_ice_harvesting_empire_space"),
    sourceURL: normalizeText(options && options.sourceURL, SOURCE.systemList),
    respawnRuleSourceURL: SOURCE.respawnRule,
    solarSystemID,
    solarSystemName: normalizeText(system && system.solarSystemName, systemName),
    regionID: toInt(system.regionID, 0),
    constellationID: toInt(system.constellationID, 0),
    factionID: toInt(system.factionID, 0) || null,
    security: toFiniteNumber(system.securityStatus != null ? system.securityStatus : system.security, 0),
    securityClass: normalizeText(system.securityClass, null),
    securityBand,
    quarter: quarterKey,
    quarterLabel: quarter.label,
    factionName: quarter.factionName,
    slotCount,
    slotCountConfidence: slotEvidence
      ? "dotlan_region_belts_ice_cell"
      : "ccp_gateway_minimum_guaranteed",
    slotCountSource: slotEvidence
      ? "dotlan_region_belts_ice"
      : "ccp_gateway_minimum_guaranteed",
    slotCountSourceURL: slotEvidence ? slotSourceURL : null,
    respawnDelayMinutes: RESPAWN_DELAY_MINUTES,
    sourceDungeonID,
    templateID: `client-dungeon:${sourceDungeonID}`,
    siteFamily: "ice",
    siteKind: "anomaly",
    siteOrigin: "generatedmining",
    iceTypeNames: Object.freeze([...iceTypeNames]),
    iceTypeIDs: Object.freeze(resolveIceTypeIDs(sourceDungeonID)),
    quarterMappingSource: normalizeText(options && options.quarterMappingSource, null),
  });
}

function buildSyntheticNullsecAuthorityRow(synthetic) {
  const solarSystemID = toInt(synthetic && synthetic.solarSystemID, 0);
  const system = worldData.getSolarSystemByID(solarSystemID);
  const systemName = normalizeText(
    synthetic && synthetic.solarSystemName,
    system && system.solarSystemName,
  );
  if (!system) {
    throw new Error(`Synthetic nullsec ice authority system not found in local star map: ${systemName}`);
  }

  const sourceDungeonID = toInt(synthetic && synthetic.sourceDungeonID, 0);
  if (sourceDungeonID <= 0) {
    throw new Error(`Synthetic nullsec ice authority row has no client source dungeon: ${systemName}`);
  }
  const iceTypeNames = Array.isArray(synthetic && synthetic.iceTypeNames)
    ? synthetic.iceTypeNames.map((name) => normalizeText(name, "")).filter(Boolean)
    : [];
  if (iceTypeNames.length <= 0) {
    throw new Error(`Synthetic nullsec ice authority row has no ice composition: ${systemName}`);
  }

  return Object.freeze({
    authorityKey: `dotlan-synthetic-nullsec-ice:${solarSystemID}`,
    authorityScope: "nullsec_pochven_synthetic_authority",
    confidence: normalizeText(
      synthetic && synthetic.compositionConfidence,
      "researched_synthetic_best_fit",
    ),
    source: normalizeText(
      synthetic && synthetic.source,
      "dotlan_region_belts_ice_synthetic_nullsec_authority",
    ),
    sourceURL: normalizeText(synthetic && synthetic.sourceURL, SOURCE.dotlanRegionList),
    respawnRuleSourceURL: SOURCE.respawnRule,
    solarSystemID,
    solarSystemName: normalizeText(system && system.solarSystemName, systemName),
    regionID: toInt(system.regionID, toInt(synthetic && synthetic.regionID, 0)),
    constellationID: toInt(system.constellationID, toInt(synthetic && synthetic.constellationID, 0)),
    factionID: toInt(system.factionID, 0) || null,
    security: toFiniteNumber(system.securityStatus != null ? system.securityStatus : system.security, toFiniteNumber(synthetic && synthetic.security, 0)),
    securityClass: normalizeText(system.securityClass, normalizeText(synthetic && synthetic.securityClass, null)),
    securityBand: getSecurityBandForSystem(system),
    quarter: normalizeText(synthetic && synthetic.quarter, "synthetic_nullsec"),
    quarterLabel: "Synthetic Nullsec/Pochven",
    factionName: normalizeText(synthetic && synthetic.regionName, null),
    slotCount: Math.max(1, toInt(synthetic && synthetic.slotCount, GUARANTEED_SLOTS_PER_SYSTEM)),
    slotCountConfidence: "dotlan_region_belts_ice_cell",
    slotCountSource: normalizeText(synthetic && synthetic.slotCountSource, "dotlan_region_belts_ice"),
    slotCountSourceURL: normalizeText(synthetic && synthetic.slotCountSourceURL, null),
    respawnDelayMinutes: RESPAWN_DELAY_MINUTES,
    sourceDungeonID,
    templateID: `client-dungeon:${sourceDungeonID}`,
    siteFamily: "ice",
    siteKind: "anomaly",
    siteOrigin: "generatedmining",
    iceTypeNames: Object.freeze([...iceTypeNames]),
    iceTypeIDs: Object.freeze(resolveIceTypeIDs(sourceDungeonID, iceTypeNames)),
    quarterMappingSource: normalizeText(synthetic && synthetic.fallbackReason, null),
    syntheticAuthority: true,
    compositionSource: normalizeText(synthetic && synthetic.compositionSource, null),
    compositionSourceURL: normalizeText(synthetic && synthetic.compositionSourceURL, null),
    clientTemplateSource: normalizeText(synthetic && synthetic.clientTemplateSource, null),
    dotlanIceTypeNames: Object.freeze(Array.isArray(synthetic && synthetic.dotlanIceTypeNames)
      ? synthetic.dotlanIceTypeNames.map((name) => normalizeText(name, "")).filter(Boolean)
      : []),
    nearestClientTemplate: synthetic && synthetic.nearestClientTemplate
      ? Object.freeze({ ...synthetic.nearestClientTemplate })
      : null,
  });
}

function buildRows() {
  const systemsByName = getSystemsByName();
  const rows = [];
  const seenSystemIDs = new Set();

  for (const [quarterKey, quarter] of Object.entries(QUARTERS)) {
    for (const systemName of quarter.systemNames) {
      const system = systemsByName.get(normalizeLowerText(systemName, ""));
      if (!system) {
        continue;
      }
      const solarSystemID = toInt(system.solarSystemID, 0);
      if (seenSystemIDs.has(solarSystemID)) {
        throw new Error(`Duplicate ice authority system: ${systemName} (${solarSystemID})`);
      }
      seenSystemIDs.add(solarSystemID);

      const row = buildAuthorityRow({
        authorityKey: `eveuni-ice:${quarterKey}:${solarSystemID}`,
        authorityScope: "empire_space",
        confidence: "secondary_public_source",
        source: "eve_university_ice_harvesting_empire_space",
        sourceURL: SOURCE.systemList,
        system,
        systemName,
        quarterKey,
      });
      if (row) {
        rows.push(row);
      }
    }
  }

  for (const supplemental of DOTLAN_SUPPLEMENTAL_HIGH_LOW_SYSTEMS) {
    const solarSystemID = toInt(supplemental && supplemental.solarSystemID, 0);
    const system = worldData.getSolarSystemByID(solarSystemID);
    const systemName = normalizeText(supplemental && supplemental.solarSystemName, String(solarSystemID));
    if (!system) {
      continue;
    }
    if (seenSystemIDs.has(solarSystemID)) {
      throw new Error(`Duplicate DOTLAN supplemental ice authority system: ${systemName} (${solarSystemID})`);
    }
    seenSystemIDs.add(solarSystemID);

    const row = buildAuthorityRow({
      authorityKey: `dotlan-ice:${supplemental.quarter}:${solarSystemID}`,
      authorityScope: "empire_space_dotlan_supplemental",
      confidence: "secondary_public_source_with_local_faction_quarter_mapping",
      source: "dotlan_region_belts_ice",
      sourceURL: supplemental.sourceURL,
      system,
      systemName,
      quarterKey: supplemental.quarter,
      slotEvidence: supplemental,
      quarterMappingSource: "local_star_map_faction_id_existing_authority_mapping",
    });
    if (row) {
      rows.push(row);
    }
  }

  const syntheticRows = Array.isArray(syntheticNullsecAuthority && syntheticNullsecAuthority.rows)
    ? syntheticNullsecAuthority.rows
    : [];
  for (const synthetic of syntheticRows) {
    const solarSystemID = toInt(synthetic && synthetic.solarSystemID, 0);
    const systemName = normalizeText(synthetic && synthetic.solarSystemName, String(solarSystemID));
    if (!worldData.getSolarSystemByID(solarSystemID)) {
      continue;
    }
    if (seenSystemIDs.has(solarSystemID)) {
      throw new Error(`Duplicate synthetic nullsec ice authority system: ${systemName} (${solarSystemID})`);
    }
    seenSystemIDs.add(solarSystemID);
    rows.push(buildSyntheticNullsecAuthorityRow(synthetic));
  }

  return rows.sort((left, right) => left.solarSystemID - right.solarSystemID);
}

function ensureRows() {
  if (!cachedRows) {
    cachedRows = Object.freeze(buildRows());
  }
  return cachedRows;
}

function ensureRowsBySystemID() {
  if (!cachedRowsBySystemID) {
    cachedRowsBySystemID = new Map(ensureRows().map((row) => [row.solarSystemID, row]));
  }
  return cachedRowsBySystemID;
}

function listIceSystemAuthorityRows(systemIDs = null) {
  const rows = ensureRows();
  if (!Array.isArray(systemIDs) || systemIDs.length <= 0) {
    return [...rows];
  }
  const filter = new Set(systemIDs.map((systemID) => toInt(systemID, 0)).filter((systemID) => systemID > 0));
  return rows.filter((row) => filter.has(row.solarSystemID));
}

function listPendingCompositionSystems(systemIDs = null) {
  if (!Array.isArray(systemIDs) || systemIDs.length <= 0) {
    return [...PENDING_COMPOSITION_SYSTEMS];
  }
  const filter = new Set(systemIDs.map((systemID) => toInt(systemID, 0)).filter((systemID) => systemID > 0));
  return PENDING_COMPOSITION_SYSTEMS.filter((row) => filter.has(row.solarSystemID));
}

function getIceSystemAuthorityRow(solarSystemID) {
  return ensureRowsBySystemID().get(toInt(solarSystemID, 0)) || null;
}

function isIceSystem(solarSystemID) {
  return !!getIceSystemAuthorityRow(solarSystemID);
}

function listIceSystemIDs(systemIDs = null) {
  return listIceSystemAuthorityRows(systemIDs).map((row) => row.solarSystemID);
}

function getSourceDungeonIDForSystem(solarSystemID) {
  const row = getIceSystemAuthorityRow(solarSystemID);
  return row ? row.sourceDungeonID : null;
}

function getRespawnDelayMsForSystem(solarSystemID) {
  return isIceSystem(solarSystemID)
    ? RESPAWN_DELAY_MINUTES * 60 * 1000
    : null;
}

function clearCache() {
  cachedRows = null;
  cachedRowsBySystemID = null;
  cachedTypeIDsByName = null;
}

module.exports = {
  SOURCE,
  RESPAWN_DELAY_MINUTES,
  GUARANTEED_SLOTS_PER_SYSTEM,
  ICE_TYPE_NAMES_BY_DUNGEON_ID,
  QUARTERS,
  DOTLAN_SLOT_COUNT_BY_SYSTEM_ID,
  DOTLAN_SUPPLEMENTAL_HIGH_LOW_SYSTEMS,
  SHATTERED_WORMHOLE_ICE_TODO,
  PENDING_COMPOSITION_SYSTEMS,
  PENDING_COMPOSITION_SYSTEM_IDS,
  getSecurityBandForSystem,
  listIceSystemAuthorityRows,
  listIceSystemIDs,
  listPendingCompositionSystems,
  getIceSystemAuthorityRow,
  getSourceDungeonIDForSystem,
  getRespawnDelayMsForSystem,
  isIceSystem,
  clearCache,
};
