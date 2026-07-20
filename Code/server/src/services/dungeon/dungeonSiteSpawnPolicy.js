const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const sovModernState = require(path.join(__dirname, "../sovereignty/sovModernState"));
const sovState = require(path.join(__dirname, "../sovereignty/sovState"));

const POLICY_VERSION = 1;
const HOUR_MS = 60 * 60 * 1000;
const POWER_STATE_ONLINE = 2;

const SOURCE_REFS = Object.freeze({
  ccpSovHub: Object.freeze({
    title: "EVE Online Support: Sovereignty Hub",
    url: "https://support.eveonline.com/hc/en-us/articles/14339751569436-Sovereignty-Hub",
  }),
  ccpSovHubCombatAnomalies: Object.freeze({
    title: "EVE Online Support: Sovereignty Hub Combat Anomalies",
    url: "https://support.eveonline.com/hc/en-us/articles/14996978906908-Sovereignty-Hub-Combat-Anomalies",
  }),
  ccpActivityDefenseMultiplier: Object.freeze({
    title: "EVE Online Support: Activity Defense Multiplier",
    url: "https://support.eveonline.com/hc/en-us/articles/203354271-Activity-Defense-Multiplier",
  }),
  ccpEquinoxSovUpdates: Object.freeze({
    title: "EVE Online: Sovereignty Updates, Transition and Upgrades",
    url: "https://www.eveonline.com/news/view/sovereignty-updates-transition-and-upgrades",
  }),
  eveUniCosmicAnomalies: Object.freeze({
    title: "EVE University: Cosmic Anomalies",
    url: "https://wiki.eveuniversity.org/Cosmic_Anomalies",
  }),
  eveUniAsteroidsAndOre: Object.freeze({
    title: "EVE University: Asteroids and ore",
    url: "https://wiki.eveuniversity.org/Asteroids_and_ore",
  }),
  eveUniGasCloudHarvesting: Object.freeze({
    title: "EVE University: Gas cloud harvesting",
    url: "https://wiki.eveuniversity.org/Gas_cloud_harvesting",
  }),
});

const UPGRADE_CATEGORY_PATTERNS = Object.freeze({
  threat_detection: Object.freeze([/\bthreat detection array\b/i]),
  prospecting: Object.freeze([/\bprospecting array\b/i]),
  exploration_detector: Object.freeze([/\bexploration detector\b/i]),
});

const RULED_SITE_FAMILIES = new Set([
  "combat",
  "combat_anomaly",
  "combat_hacking",
  "data",
  "gas",
  "ghost",
  "ice",
  "ore",
  "relic",
]);

const SPACE_BAND_RULES = Object.freeze([
  Object.freeze({
    key: "wormhole_gas_reservoir",
    siteFamilies: Object.freeze(["gas"]),
    siteKinds: Object.freeze(["signature"]),
    namePattern: /\b(perimeter|frontier|core)\s+reservoir\b/i,
    allowedBands: Object.freeze(["wormhole"]),
    sourceRefs: Object.freeze(["eveUniGasCloudHarvesting"]),
  }),
  Object.freeze({
    key: "wormhole_ore_deposit",
    siteFamilies: Object.freeze(["ore"]),
    siteKinds: Object.freeze(["anomaly", "signature"]),
    namePattern: /\b(w-space|perimeter deposit|frontier deposit|core deposit|shattered debris field)\b/i,
    allowedBands: Object.freeze(["wormhole"]),
    sourceRefs: Object.freeze(["eveUniAsteroidsAndOre"]),
  }),
  Object.freeze({
    key: "nullsec_rare_ore",
    siteFamilies: Object.freeze(["ore"]),
    siteKinds: Object.freeze(["anomaly"]),
    namePattern: /\b(nullsec|mercoxit|arkonor|bistot|crokite|dark ochre|spodumain|asteroid cluster)\b/i,
    allowedBands: Object.freeze(["nullsec"]),
    sourceRefs: Object.freeze(["eveUniAsteroidsAndOre"]),
  }),
]);

const SOV_UPGRADE_RULES = Object.freeze([
  Object.freeze({
    key: "sov_prospecting_ore",
    siteFamilies: Object.freeze(["ore"]),
    siteKinds: Object.freeze(["anomaly"]),
    namePattern: /\b(griemeer|hezorime|kylixium|mordunium|ueganite|nocxite|interstitial|veiled|prospecting|average|large|small|medium|enormous|colossal)\b/i,
    requiredBands: Object.freeze(["nullsec"]),
    requiredUpgradeCategory: "prospecting",
    enforce: true,
    sourceRefs: Object.freeze(["ccpSovHub", "ccpEquinoxSovUpdates"]),
    assumptions: Object.freeze([
      "Generated ore-deposit templates that look like upgrade-supplied deposits are treated as Sov Hub prospecting content.",
    ]),
  }),
  Object.freeze({
    key: "sov_threat_detection_combat",
    siteFamilies: Object.freeze(["combat"]),
    siteKinds: Object.freeze(["anomaly"]),
    namePattern: /\b(sanctum|haven|hub|rally point|forlorn|forsaken|hidden)\b/i,
    requiredBands: Object.freeze(["nullsec"]),
    requiredUpgradeCategory: "threat_detection",
    enforce: false,
    sourceRefs: Object.freeze(["ccpSovHubCombatAnomalies"]),
    assumptions: Object.freeze([
      "Baseline combat-anomaly profiles may still seed combat anomalies; threat-detection arrays are modeled as an optional upgraded supply path.",
    ]),
  }),
  Object.freeze({
    key: "sov_exploration_detector_signature",
    siteFamilies: Object.freeze(["data", "relic", "combat_hacking"]),
    siteKinds: Object.freeze(["signature"]),
    namePattern: /.*/i,
    requiredBands: Object.freeze(["nullsec"]),
    requiredUpgradeCategory: "exploration_detector",
    enforce: false,
    sourceRefs: Object.freeze(["ccpSovHub"]),
    assumptions: Object.freeze([
      "Exploration Detector upgrades are modeled as an optional upgraded supply path for scanner signatures, not a baseline signature requirement.",
    ]),
  }),
]);

const COMPLETION_RESPAWN_RULES = Object.freeze({
  combat_anomaly: Object.freeze({
    delayMs: 0,
    mode: "next_universe_tick",
    sourceRefs: Object.freeze(["eveUniCosmicAnomalies"]),
    assumptions: Object.freeze([
      "The emulator rotates completed combat anomalies on the next universe tick.",
    ]),
  }),
  combat_signature: Object.freeze({
    delayMs: 0,
    mode: "next_universe_tick",
    sourceRefs: Object.freeze(["eveUniCosmicAnomalies"]),
    assumptions: Object.freeze([
      "Combat signatures use the same immediate replacement bucket once a completion hook marks them cleared.",
    ]),
  }),
  data_signature: Object.freeze({
    delayMs: 0,
    mode: "next_universe_tick",
    sourceRefs: Object.freeze(["eveUniCosmicAnomalies"]),
    assumptions: Object.freeze([
      "Hacked-and-emptied data signatures leave the active supply bucket immediately.",
    ]),
  }),
  relic_signature: Object.freeze({
    delayMs: 0,
    mode: "next_universe_tick",
    sourceRefs: Object.freeze(["eveUniCosmicAnomalies"]),
    assumptions: Object.freeze([
      "Hacked-and-emptied relic signatures leave the active supply bucket immediately.",
    ]),
  }),
  gas_depleted: Object.freeze({
    delayMs: 6 * HOUR_MS,
    mode: "delayed_depleted_resource",
    sourceRefs: Object.freeze(["eveUniGasCloudHarvesting"]),
    assumptions: Object.freeze([
      "Gas-site depletion uses the same conservative six-hour bucket currently used by generated ice until better retail timing data is modeled.",
    ]),
  }),
  ore_depleted: Object.freeze({
    delayMs: 6 * HOUR_MS,
    mode: "delayed_depleted_resource",
    sourceRefs: Object.freeze(["eveUniAsteroidsAndOre"]),
    assumptions: Object.freeze([
      "Ore-site depletion uses the same conservative six-hour bucket currently used by generated ice until better retail timing data is modeled.",
    ]),
  }),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeSecurityBand(value) {
  const normalized = normalizeLowerText(value, "nullsec");
  switch (normalized) {
    case "highsec":
    case "lowsec":
    case "nullsec":
    case "wormhole":
      return normalized;
    default:
      return "nullsec";
  }
}

function getSecurityBand(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID >= 31_000_000 && numericSystemID <= 31_999_999) {
    return "wormhole";
  }
  const systemRecord = worldData.getSolarSystemByID(numericSystemID) || null;
  const securityStatus = Number(
    systemRecord && (systemRecord.securityStatus ?? systemRecord.security),
  );
  if (Number.isFinite(securityStatus)) {
    if (securityStatus >= 0.45) {
      return "highsec";
    }
    if (securityStatus >= 0) {
      return "lowsec";
    }
  }
  return "nullsec";
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => normalizeText(entry, ""))
    .filter(Boolean))];
}

function normalizeUpgrade(value = {}) {
  if (typeof value === "string") {
    return {
      typeID: null,
      name: normalizeText(value, ""),
      online: true,
    };
  }
  const definition = value && value.definition && typeof value.definition === "object"
    ? value.definition
    : {};
  const name = normalizeText(
    value.typeName,
    normalizeText(
      value.name,
      normalizeText(
        value.displayName,
        normalizeText(
          definition.typeName,
          normalizeText(definition.name, normalizeText(definition.displayName, "")),
        ),
      ),
    ),
  );
  const powerState = value.powerState != null
    ? value.powerState
    : value.power_state;
  const online =
    value.online === true ||
    value.isOnline === true ||
    powerState === POWER_STATE_ONLINE ||
    normalizeLowerText(powerState, "") === "online" ||
    (
      value.online == null &&
      value.isOnline == null &&
      powerState == null &&
      name.length > 0
    );
  return {
    typeID: toInt(value.typeID, toInt(definition.typeID, null)),
    name,
    online,
  };
}

function normalizeUpgrades(...values) {
  const merged = [];
  for (const value of values) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      const upgrade = normalizeUpgrade(entry);
      if (upgrade.name || upgrade.typeID) {
        merged.push(upgrade);
      }
    }
  }
  return merged;
}

function extractHubUpgrades(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload.upgrades)) {
    return payload.upgrades;
  }
  if (Array.isArray(payload.installedUpgrades)) {
    return payload.installedUpgrades;
  }
  return [];
}

function normalizePolicyContext(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const sov = source.sovereignty && typeof source.sovereignty === "object"
    ? source.sovereignty
    : source;
  const claim = sov.claim || source.claim || null;
  const hubID = toInt(
    sov.hubID,
    toInt(source.hubID, toInt(sov.infrastructureHubID, toInt(source.infrastructureHubID, 0))),
  );
  const onlineUpgradeNames = normalizeStringArray([
    ...(Array.isArray(sov.onlineUpgradeNames) ? sov.onlineUpgradeNames : []),
    ...(Array.isArray(source.onlineUpgradeNames) ? source.onlineUpgradeNames : []),
  ]);
  const upgrades = normalizeUpgrades(
    sov.onlineUpgrades,
    source.onlineUpgrades,
    sov.upgrades,
    source.upgrades,
    onlineUpgradeNames,
  );
  const normalizedUpgrades = upgrades.map((upgrade) => ({
    ...upgrade,
    online: upgrade.online !== false,
  }));
  const hasSovereignty =
    sov.hasSovereignty === true ||
    source.hasSovereignty === true ||
    Boolean(
      claim &&
      (
        toInt(claim.ownerID, 0) > 0 ||
        toInt(claim.allianceID, 0) > 0 ||
        toInt(claim.corporationID, 0) > 0 ||
        toInt(claim.claimStructureID, 0) > 0
      ),
    );
  return {
    securityBand: normalizeSecurityBand(source.securityBand || sov.securityBand || "nullsec"),
    sovereignty: {
      hasSovereignty,
      claim: cloneValue(claim),
      hubID: hubID || null,
      onlineUpgrades: normalizedUpgrades.filter((upgrade) => upgrade.online !== false),
      upgrades: normalizedUpgrades,
      development: cloneValue(sov.development || source.development || {}),
    },
  };
}

function buildRuntimeSystemPolicyContext(systemID, options = {}) {
  const numericSystemID = toInt(systemID, 0);
  let claim = null;
  let hubID = 0;
  let hubUpgrades = [];
  let development = {};

  try {
    claim = sovState.getSystemSovClaim(numericSystemID);
  } catch (_) {
    claim = null;
  }

  try {
    hubID = toInt(sovModernState.getHubIDForSolarSystem(numericSystemID), 0);
  } catch (_) {
    hubID = 0;
  }

  if (!hubID) {
    try {
      const hubClaim = sovState.getInfrastructureHubClaim(numericSystemID);
      hubID = toInt(
        hubClaim && (
          hubClaim.infrastructureHubID ||
          hubClaim.hubID ||
          hubClaim.claimStructureID ||
          hubClaim.itemID
        ),
        0,
      );
    } catch (_) {
      hubID = 0;
    }
  }

  if (hubID > 0) {
    try {
      hubUpgrades = extractHubUpgrades(sovModernState.getHubUpgrades(hubID));
    } catch (_) {
      hubUpgrades = [];
    }
  }

  try {
    const devIndices = sovState.getDevelopmentIndicesForSystem(numericSystemID);
    development = devIndices && typeof devIndices === "object" ? devIndices : {};
  } catch (_) {
    development = {};
  }

  return normalizePolicyContext({
    securityBand: normalizeSecurityBand(options.securityBand || getSecurityBand(numericSystemID)),
    sovereignty: {
      claim,
      hasSovereignty: Boolean(claim),
      hubID,
      upgrades: hubUpgrades,
      development,
    },
  });
}

function getTemplateName(template = {}) {
  return normalizeText(
    template.resolvedName,
    normalizeText(template.name, normalizeText(template.templateID, "")),
  );
}

function normalizeSiteFamily(value, fallback = "") {
  const normalized = normalizeLowerText(value, fallback);
  return normalized === "combat_anomaly" ? "combat" : normalized;
}

function isRuledSpawnFamily(family) {
  return RULED_SITE_FAMILIES.has(normalizeSiteFamily(family, ""));
}

function normalizeSiteInput(input = {}) {
  const template = input.template && typeof input.template === "object"
    ? input.template
    : {};
  const spawnFamilyKey = normalizeLowerText(input.spawnFamilyKey || input.family, "");
  const siteFamily = normalizeSiteFamily(
    input.siteFamily,
    normalizeSiteFamily(template.siteFamily, normalizeSiteFamily(spawnFamilyKey, "unknown")),
  );
  const siteKind = normalizeLowerText(
    input.siteKind,
    normalizeLowerText(template.siteKind, spawnFamilyKey === "combat_anomaly" ? "anomaly" : "signature"),
  );
  const securityBand = normalizeSecurityBand(input.securityBand || getSecurityBand(input.systemID));
  return {
    template,
    templateID: normalizeText(template.templateID, ""),
    templateName: getTemplateName(template),
    source: normalizeLowerText(template.source, ""),
    spawnFamilyKey,
    siteFamily,
    siteKind,
    securityBand,
    systemID: toInt(input.systemID, 0),
  };
}

function siteMatchesRule(site, rule) {
  if (!site || !rule) {
    return false;
  }
  if (Array.isArray(rule.siteFamilies) && rule.siteFamilies.length > 0) {
    const families = rule.siteFamilies.map((entry) => normalizeSiteFamily(entry, ""));
    if (!families.includes(site.siteFamily)) {
      return false;
    }
  }
  if (Array.isArray(rule.siteKinds) && rule.siteKinds.length > 0) {
    const kinds = rule.siteKinds.map((entry) => normalizeLowerText(entry, ""));
    if (!kinds.includes(site.siteKind)) {
      return false;
    }
  }
  return !rule.namePattern || rule.namePattern.test(site.templateName);
}

function dedupeStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((entry) => normalizeText(entry, ""))
    .filter(Boolean))];
}

function hasOnlineUpgradeCategory(context, category) {
  const normalizedCategory = normalizeLowerText(category, "");
  const patterns = UPGRADE_CATEGORY_PATTERNS[normalizedCategory] || [];
  if (patterns.length <= 0) {
    return false;
  }
  const normalizedContext = normalizePolicyContext(context);
  return normalizedContext.sovereignty.onlineUpgrades.some((upgrade) => (
    patterns.some((pattern) => pattern.test(normalizeText(upgrade.name, "")))
  ));
}

function buildAllowedResult(site, policyKey, extra = {}) {
  return {
    allowed: true,
    reason: normalizeText(extra.reason, "allowed"),
    policyKey,
    securityBand: site.securityBand,
    siteFamily: site.siteFamily,
    siteKind: site.siteKind,
    requiredBands: Array.isArray(extra.requiredBands) ? [...extra.requiredBands] : [],
    requiredUpgradeCategory: normalizeText(extra.requiredUpgradeCategory, "") || null,
    sourceRefs: dedupeStrings(extra.sourceRefs),
    assumptions: dedupeStrings(extra.assumptions),
    tags: dedupeStrings(extra.tags),
  };
}

function buildBlockedResult(site, policyKey, reason, extra = {}) {
  return {
    allowed: false,
    reason: normalizeText(reason, "blocked"),
    policyKey,
    securityBand: site.securityBand,
    siteFamily: site.siteFamily,
    siteKind: site.siteKind,
    requiredBands: Array.isArray(extra.requiredBands) ? [...extra.requiredBands] : [],
    requiredUpgradeCategory: normalizeText(extra.requiredUpgradeCategory, "") || null,
    sourceRefs: dedupeStrings(extra.sourceRefs),
    assumptions: dedupeStrings(extra.assumptions),
    tags: dedupeStrings(extra.tags),
  };
}

function evaluateSovereigntyUpgradeRule(site, context, rule, options = {}) {
  const requiredBands = Array.isArray(rule.requiredBands) ? [...rule.requiredBands] : [];
  if (requiredBands.length > 0 && !requiredBands.includes(site.securityBand)) {
    return buildBlockedResult(site, rule.key, "wrong_security_band_for_sov_upgrade_site", {
      requiredBands,
      requiredUpgradeCategory: rule.requiredUpgradeCategory,
      sourceRefs: rule.sourceRefs,
      assumptions: rule.assumptions,
      tags: ["sov_upgrade"],
    });
  }

  const enforce =
    options.enforceSovereigntyUpgrades === true ||
    (
      options.enforceSovereigntyUpgrades !== false &&
      rule.enforce === true
    );
  if (!enforce) {
    return buildAllowedResult(site, rule.key, {
      reason: "allowed_baseline_with_optional_sov_upgrade",
      requiredBands,
      requiredUpgradeCategory: rule.requiredUpgradeCategory,
      sourceRefs: rule.sourceRefs,
      assumptions: rule.assumptions,
      tags: ["sov_upgrade_optional"],
    });
  }

  const normalizedContext = normalizePolicyContext(context);
  if (normalizedContext.sovereignty.hasSovereignty !== true) {
    return buildBlockedResult(site, rule.key, "missing_sovereignty_claim", {
      requiredBands,
      requiredUpgradeCategory: rule.requiredUpgradeCategory,
      sourceRefs: rule.sourceRefs,
      assumptions: rule.assumptions,
      tags: ["sov_upgrade"],
    });
  }
  if (!normalizedContext.sovereignty.hubID) {
    return buildBlockedResult(site, rule.key, "missing_sovereignty_hub", {
      requiredBands,
      requiredUpgradeCategory: rule.requiredUpgradeCategory,
      sourceRefs: rule.sourceRefs,
      assumptions: rule.assumptions,
      tags: ["sov_upgrade"],
    });
  }
  if (!hasOnlineUpgradeCategory(normalizedContext, rule.requiredUpgradeCategory)) {
    return buildBlockedResult(site, rule.key, "missing_required_sov_upgrade", {
      requiredBands,
      requiredUpgradeCategory: rule.requiredUpgradeCategory,
      sourceRefs: rule.sourceRefs,
      assumptions: rule.assumptions,
      tags: ["sov_upgrade"],
    });
  }

  return buildAllowedResult(site, rule.key, {
    reason: "allowed_by_sov_upgrade",
    requiredBands,
    requiredUpgradeCategory: rule.requiredUpgradeCategory,
    sourceRefs: rule.sourceRefs,
    assumptions: rule.assumptions,
    tags: ["sov_upgrade"],
  });
}

function evaluateSiteSpawnPolicy(input = {}, context = {}, options = {}) {
  const site = normalizeSiteInput(input);
  if (!RULED_SITE_FAMILIES.has(site.siteFamily)) {
    return buildAllowedResult(site, "unruled_family", {
      reason: "allowed_unruled_family",
    });
  }

  for (const rule of SPACE_BAND_RULES) {
    if (!siteMatchesRule(site, rule)) {
      continue;
    }
    const requiredBands = Array.isArray(rule.allowedBands) ? [...rule.allowedBands] : [];
    if (!requiredBands.includes(site.securityBand)) {
      return buildBlockedResult(site, rule.key, "wrong_security_band", {
        requiredBands,
        sourceRefs: rule.sourceRefs,
        tags: ["space_band"],
      });
    }
    return buildAllowedResult(site, rule.key, {
      reason: "allowed_by_security_band",
      requiredBands,
      sourceRefs: rule.sourceRefs,
      tags: ["space_band"],
    });
  }

  for (const rule of SOV_UPGRADE_RULES) {
    if (siteMatchesRule(site, rule)) {
      return evaluateSovereigntyUpgradeRule(site, context, rule, options);
    }
  }

  return buildAllowedResult(site, "baseline_family", {
    reason: "allowed_baseline_family",
    sourceRefs: ["eveUniCosmicAnomalies"],
    assumptions: [
      "Baseline security-band and density selection remains owned by dungeonAuthority spawn profiles.",
    ],
  });
}

function buildSelectionMetadata(evaluation) {
  const result = evaluation && typeof evaluation === "object" ? evaluation : {};
  return {
    version: POLICY_VERSION,
    allowed: result.allowed !== false,
    policyKey: normalizeText(result.policyKey, "unknown"),
    reason: normalizeText(result.reason, ""),
    requiredBands: Array.isArray(result.requiredBands) ? [...result.requiredBands] : [],
    requiredUpgradeCategory: normalizeText(result.requiredUpgradeCategory, "") || null,
    sourceRefs: dedupeStrings(result.sourceRefs),
    assumptions: dedupeStrings(result.assumptions),
    tags: dedupeStrings(result.tags),
  };
}

function getCompletionRespawnRule(input = {}) {
  const siteFamily = normalizeSiteFamily(input.siteFamily || input.family, "unknown");
  const siteKind = normalizeLowerText(input.siteKind, "signature");
  const lifecycleReason = normalizeLowerText(input.lifecycleReason || input.reason, "");

  let key = `${siteFamily}_${siteKind}`;
  if ((siteFamily === "ore" || siteFamily === "gas") && lifecycleReason === "depleted") {
    key = `${siteFamily}_depleted`;
  }
  const rule = COMPLETION_RESPAWN_RULES[key] || null;
  if (!rule) {
    return {
      delayMs: 0,
      mode: "next_universe_tick",
      sourceRefs: [],
      assumptions: [
        "No family-specific respawn rule exists yet; use existing immediate universe rotation behavior.",
      ],
    };
  }
  return cloneValue(rule);
}

function getPolicyDescriptor() {
  return {
    version: POLICY_VERSION,
    sources: Object.keys(SOURCE_REFS).sort(),
    ruledFamilies: [...RULED_SITE_FAMILIES].sort(),
    spaceBandRuleKeys: SPACE_BAND_RULES.map((rule) => rule.key),
    sovUpgradeRuleKeys: SOV_UPGRADE_RULES.map((rule) => rule.key),
  };
}

module.exports = {
  POLICY_VERSION,
  SOURCE_REFS,
  buildRuntimeSystemPolicyContext,
  buildSelectionMetadata,
  evaluateSiteSpawnPolicy,
  getCompletionRespawnRule,
  getPolicyDescriptor,
  hasOnlineUpgradeCategory,
  isRuledSpawnFamily,
  normalizePolicyContext,
  _testing: {
    COMPLETION_RESPAWN_RULES,
    SPACE_BAND_RULES,
    SOV_UPGRADE_RULES,
    UPGRADE_CATEGORY_PATTERNS,
    getSecurityBand,
    normalizeSiteInput,
    normalizeUpgrade,
  },
};
