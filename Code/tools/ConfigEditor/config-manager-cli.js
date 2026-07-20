const fs = require("fs");
const path = require("path");

// This CLI communicates with the GUI purely via JSON on stdout, and the caller
// (PowerShell, $ErrorActionPreference = "Stop") treats ANY native stderr output
// as a terminating error - even on exit code 0. Some server modules (e.g. the
// market daemon client) log diagnostics through console.*, which would either
// corrupt the JSON (stdout) or trip that stderr-as-error behavior. Silence all
// library logging here; real CLI errors are surfaced explicitly via
// process.stderr.write with a non-zero exit code in main()'s catch handler.
const _silenceConsole = () => {};
console.log = _silenceConsole;
console.info = _silenceConsole;
console.warn = _silenceConsole;
console.error = _silenceConsole;
console.debug = _silenceConsole;

const config = require(path.join(__dirname, "../../server/src/config"));

const rootDir = path.resolve(__dirname, "../..");
const Database = require(path.join(
  rootDir,
  "server",
  "node_modules",
  "better-sqlite3",
));
const dataRoot = resolveDataRoot();
const databasePath = resolveDatabasePath();

function resolveDataRoot() {
  if (process.env.EVEJS_GAMESTORE_DATA_DIR) {
    return path.resolve(process.env.EVEJS_GAMESTORE_DATA_DIR);
  }
  return path.join(rootDir, "_local/gameStore/data");
}

function resolveDatabasePath() {
  if (process.env.EVEJS_GAMESTORE_SQLITE_PATH) {
    return path.resolve(process.env.EVEJS_GAMESTORE_SQLITE_PATH);
  }
  return path.resolve(dataRoot, "..", "gamestore.sqlite");
}

const GROUP_ORDER = [
  "Basics",
  "Structures & Safety",
  "Client Compatibility",
  "Network",
  "Market & Services",
  "HyperNet",
  "World & Performance",
  "NPC & Crimewatch",
  "Mining",
  "Belt Rats",
  "Wormholes",
  "New Eden Store",
  "Server Ops",
  "Developer",
  "Advanced",
];

const UI_METADATA = {
  devMode: {
    group: "Basics",
    label: "Developer Mode",
    control: "boolean",
  },
  upwellGmBypassRestrictions: {
    group: "Structures & Safety",
    label: "Upwell GM Bypass Restrictions",
    control: "boolean",
  },
  upwellTimerScale: {
    group: "Structures & Safety",
    label: "Upwell Timer Scale",
    control: "number",
  },
  logLevel: {
    group: "Basics",
    label: "Server Log Level",
    control: "select",
    options: [
      {
        value: 0,
        label: "0 - Silent",
      },
      {
        value: 1,
        label: "1 - Normal logging",
      },
      {
        value: 2,
        label: "2 - Verbose debug",
      },
    ],
  },
  omegaLicenseEnabled: {
    group: "Basics",
    label: "Omega License Flow",
    control: "boolean",
  },
  clientVersion: {
    group: "Client Compatibility",
    label: "Client Version",
    control: "number",
  },
  clientBuild: {
    group: "Client Compatibility",
    label: "Client Build",
    control: "number",
  },
  eveBirthday: {
    group: "Client Compatibility",
    label: "EVE Birthday",
    control: "number",
  },
  machoVersion: {
    group: "Client Compatibility",
    label: "MachoNet Version",
    control: "number",
  },
  projectCodename: {
    group: "Client Compatibility",
    label: "Project Codename",
    control: "text",
  },
  projectRegion: {
    group: "Client Compatibility",
    label: "Project Region",
    control: "text",
  },
  projectVersion: {
    group: "Client Compatibility",
    label: "Project Version String",
    control: "text",
  },
  defaultCountryCode: {
    group: "Client Compatibility",
    label: "Default Country Code",
    control: "text",
  },
  proxyNodeId: {
    group: "Client Compatibility",
    label: "Proxy Node ID",
    control: "number",
  },
  serverPort: {
    group: "Network",
    label: "Server TCP Port",
    control: "number",
  },
  imageServerUrl: {
    group: "Network",
    label: "Image Server URL",
    control: "text",
  },
  microservicesRedirectUrl: {
    group: "Network",
    label: "Microservices Redirect URL",
    control: "text",
  },
  xmppServerPort: {
    group: "Network",
    label: "XMPP Server Port",
    control: "number",
  },
  marketDaemonHost: {
    group: "Market & Services",
    label: "Market Daemon Host",
    control: "text",
  },
  marketDaemonPort: {
    group: "Market & Services",
    label: "Market Daemon Port",
    control: "number",
  },
  marketDaemonConnectTimeoutMs: {
    group: "Market & Services",
    label: "Market Daemon Connect Timeout (ms)",
    control: "number",
  },
  marketDaemonRequestTimeoutMs: {
    group: "Market & Services",
    label: "Market Daemon Request Timeout (ms)",
    control: "number",
  },
  marketDaemonRetryDelayMs: {
    group: "Market & Services",
    label: "Market Daemon Retry Delay (ms)",
    control: "number",
  },
  hyperNetKillSwitch: {
    group: "HyperNet",
    label: "HyperNet Kill Switch",
    control: "boolean",
  },
  hyperNetPlexPriceOverride: {
    group: "HyperNet",
    label: "HyperNet PLEX Price Override",
    control: "number",
  },
  hyperNetDevAutoGrantCores: {
    group: "HyperNet",
    label: "HyperNet Dev Auto-Grant Cores",
    control: "boolean",
  },
  hyperNetSeedEnabled: {
    group: "HyperNet",
    label: "HyperNet Startup Seeding",
    control: "boolean",
  },
  hyperNetSeedOwnerId: {
    group: "HyperNet",
    label: "HyperNet Seed Owner ID",
    control: "number",
  },
  hyperNetSeedRestockEnabled: {
    group: "HyperNet",
    label: "HyperNet Seed Restock",
    control: "boolean",
  },
  hyperNetSeedMinShips: {
    group: "HyperNet",
    label: "HyperNet Seed Minimum Ships",
    control: "number",
  },
  hyperNetSeedMaxShips: {
    group: "HyperNet",
    label: "HyperNet Seed Maximum Ships",
    control: "number",
  },
  hyperNetSeedMinItems: {
    group: "HyperNet",
    label: "HyperNet Seed Minimum Items",
    control: "number",
  },
  hyperNetSeedMaxItems: {
    group: "HyperNet",
    label: "HyperNet Seed Maximum Items",
    control: "number",
  },
  spaceDebrisLifetimeMs: {
    group: "World & Performance",
    label: "Space Debris Lifetime (ms)",
    control: "number",
  },
  tidiAutoscaler: {
    group: "World & Performance",
    label: "Time Dilation Autoscaler",
    control: "boolean",
  },
  NewEdenSystemLoading: {
    group: "World & Performance",
    label: "New Eden Startup Loading",
    control: "select",
    options: [
      {
        value: 1,
        label: "1 - Lazy boot (Jita + New Caldari)",
      },
      {
        value: 2,
        label: "2 - Preload all high-sec systems",
      },
      {
        value: 3,
        label: "3 - Preload every system in New Eden",
      },
      {
        value: 4,
        label: "4 - OnGoingLazy (lazy preload, all gates active)",
      },
    ],
  },
  asteroidFieldsEnabled: {
    group: "World & Performance",
    label: "Generated Asteroid Fields",
    control: "boolean",
  },
  npcAuthoredStartupEnabled: {
    group: "NPC & Crimewatch",
    label: "Authored NPC Startup Rules",
    control: "boolean",
  },
  npcDefaultConcordStartupEnabled: {
    group: "NPC & Crimewatch",
    label: "Default CONCORD Gate Coverage",
    control: "boolean",
  },
  npcDefaultConcordGateAutoAggroNpcsEnabled: {
    group: "NPC & Crimewatch",
    label: "Gate CONCORD Auto-Aggro NPCs",
    control: "boolean",
  },
  npcDefaultConcordStationScreensEnabled: {
    group: "NPC & Crimewatch",
    label: "CONCORD Station Screens",
    control: "boolean",
  },
  crimewatchConcordResponseEnabled: {
    group: "NPC & Crimewatch",
    label: "Crimewatch CONCORD Response",
    control: "boolean",
  },
  crimewatchConcordPodKillEnabled: {
    group: "NPC & Crimewatch",
    label: "Crimewatch CONCORD Pod Kill",
    control: "boolean",
  },
};

// Second-level grouping rendered as section headers inside each group tab.
// Keys not listed fall back to the "General" sub-group.
const SUBGROUP_BY_KEY = {
  devMode: "Runtime",
  logLevel: "Runtime",
  omegaLicenseEnabled: "Account Features",

  upwellGmBypassRestrictions: "Upwell Structures",
  upwellTimerScale: "Upwell Structures",

  clientVersion: "Version Handshake",
  clientBuild: "Version Handshake",
  eveBirthday: "Version Handshake",
  machoVersion: "Version Handshake",
  projectCodename: "Project Identity",
  projectRegion: "Project Identity",
  projectVersion: "Project Identity",
  defaultCountryCode: "Project Identity",
  proxyNodeId: "Networking",

  serverPort: "Ports",
  xmppServerPort: "Ports",
  imageServerUrl: "Service URLs",
  microservicesRedirectUrl: "Service URLs",

  marketDaemonHost: "Connection",
  marketDaemonPort: "Connection",
  marketDaemonConnectTimeoutMs: "Timeouts & Retries",
  marketDaemonRequestTimeoutMs: "Timeouts & Retries",
  marketDaemonRetryDelayMs: "Timeouts & Retries",

  hyperNetKillSwitch: "Availability",
  hyperNetDevAutoGrantCores: "Availability",
  hyperNetPlexPriceOverride: "Pricing",
  hyperNetSeedEnabled: "Startup Seeding",
  hyperNetSeedOwnerId: "Startup Seeding",
  hyperNetSeedRestockEnabled: "Startup Seeding",
  hyperNetSeedMinShips: "Seeding Quantities",
  hyperNetSeedMaxShips: "Seeding Quantities",
  hyperNetSeedMinItems: "Seeding Quantities",
  hyperNetSeedMaxItems: "Seeding Quantities",

  spaceDebrisLifetimeMs: "Performance",
  tidiAutoscaler: "Performance",
  NewEdenSystemLoading: "Startup Loading",
  asteroidFieldsEnabled: "World Generation",

  npcAuthoredStartupEnabled: "NPC Startup",
  npcDefaultConcordStartupEnabled: "CONCORD Coverage",
  npcDefaultConcordGateAutoAggroNpcsEnabled: "CONCORD Coverage",
  npcDefaultConcordStationScreensEnabled: "CONCORD Coverage",
  crimewatchConcordResponseEnabled: "Crimewatch",
  crimewatchConcordPodKillEnabled: "Crimewatch",
};

// Fallback sub-grouping for the large auto-discovered config families. Matched
// longest-prefix-first; the explicit SUBGROUP_BY_KEY map always wins over these.
const SUBGROUP_PREFIX_RULES = [
  // Belt Rats tab
  ["asteroidBeltNpcRatCapital", "Capital Rats"],
  ["asteroidBeltNpcRatOfficer", "Officers"],
  ["asteroidBeltNpcRatCommander", "Commanders"],
  ["asteroidBeltNpcRatHauler", "Haulers"],
  ["asteroidBeltNpcRatSpecials", "Specials"],
  ["asteroidBeltNpcRatBounty", "Bounty"],
  ["asteroidBeltNpcRat", "Spawning"],
  // Mining tab
  ["miningNpcFleet", "NPC Fleets"],
  ["miningNpcHauler", "NPC Haulers"],
  ["miningNpcResponse", "NPC Response"],
  ["miningNpcStartup", "NPC Startup"],
  ["miningNpcStandings", "NPC Standings"],
  ["miningNpc", "NPC"],
  ["miningIce", "Ice Sites"],
  ["miningGas", "Gas Sites"],
  ["miningGenerated", "Generated Sites"],
  ["miningStructure", "Structures"],
  ["miningCommand", "Command Burst"],
  ["miningBelt", "Belts"],
  ["miningObserver", "Ledger"],
  ["miningCharacter", "Ledger"],
  ["mining", "General"],
  // Wormholes tab
  ["wormholeWandering", "Wandering"],
  ["wormhole", "General"],
  // New Eden Store tab
  ["newEdenStore", "General"],
  // Network tab (advanced networking)
  ["socket", "Sockets & Keep-Alive"],
  ["presenceReconcile", "Presence"],
  ["proxy", "Proxy"],
  ["xmpp", "XMPP"],
  ["redshiftMonitor", "Redshift Monitor"],
  ["gameServerHost", "Hosts & Sessions"],
  ["imageServerBindHost", "Hosts & Sessions"],
  ["microservices", "Hosts & Sessions"],
  ["loginTakeover", "Hosts & Sessions"],
  // Server Ops tab
  ["serverStatus", "Server Status"],
  ["clusterDowntime", "Downtime"],
  ["industry", "Industry"],
  ["logPacket", "Logging"],
  // NPC & Crimewatch tab
  ["npcDefaultEverMore", "EverMore Gates"],
  // Developer tab
  ["newCharacter", "New Character"],
  ["expertSystems", "Features"],
  ["localChatAuthority", "Features"],
  ["characterDeletion", "Characters"],
  ["skill", "Skills"],
  ["dev", "Developer"],
  // World & Performance tab
  ["defaultStargate", "Stargates"],
  ["defaultEmpireSentry", "Empire Sentries"],
];

function inferSubGroup(key, metadata = {}) {
  if (SUBGROUP_BY_KEY[key]) return SUBGROUP_BY_KEY[key];
  if (metadata.subGroup) return metadata.subGroup;
  for (const [prefix, name] of SUBGROUP_PREFIX_RULES) {
    if (String(key || "").startsWith(prefix)) return name;
  }
  return "General";
}

// Top-level tab routing for the large auto-discovered config families that
// would otherwise all land in "Advanced". Matched after the explicit checks
// in inferGroup(); first matching prefix wins.
const GROUP_PREFIX_RULES = [
  ["asteroidBeltNpcRat", "Belt Rats"],
  ["mining", "Mining"],
  ["wormhole", "Wormholes"],
  ["newEdenStore", "New Eden Store"],
  ["serverStatus", "Server Ops"],
  ["clusterDowntime", "Server Ops"],
  ["industry", "Server Ops"],
  ["logPacket", "Server Ops"],
  ["socket", "Network"],
  ["proxy", "Network"],
  ["xmpp", "Network"],
  ["presenceReconcile", "Network"],
  ["redshiftMonitor", "Network"],
  ["loginTakeover", "Network"],
  ["gameServerHost", "Network"],
  ["imageServerBindHost", "Network"],
  ["microservices", "Network"],
  ["dev", "Developer"],
  ["newCharacter", "Developer"],
  ["skill", "Developer"],
  ["expertSystems", "Developer"],
  ["localChatAuthority", "Developer"],
  ["characterDeletion", "Developer"],
  ["defaultStargate", "World & Performance"],
  ["defaultEmpireSentry", "World & Performance"],
];

const PLAYER_TABLE_NAMES = [
  "accounts",
  "characters",
  "skills",
  "items",
  "identityState",
];

const TYPE_TABLE_PATHS = {
  itemTypes: path.join(dataRoot, "itemTypes/data.json"),
  shipTypes: path.join(dataRoot, "shipTypes/data.json"),
  skillTypes: path.join(dataRoot, "skillTypes/data.json"),
  typeDogma: path.join(dataRoot, "typeDogma/data.json"),
};

function humanizeKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (firstChar) => firstChar.toUpperCase());
}

function inferGroup(entry, metadata = {}) {
  if (metadata.group) {
    return metadata.group;
  }

  const key = String(entry && entry.key || "");
  if (key.startsWith("upwell")) {
    return "Structures & Safety";
  }
  if (key.startsWith("marketDaemon")) {
    return "Market & Services";
  }
  if (key.startsWith("hyperNet")) {
    return "HyperNet";
  }
  if (key.startsWith("npc") || key.startsWith("crimewatch")) {
    return "NPC & Crimewatch";
  }
  if (
    [
      "clientVersion",
      "clientBuild",
      "eveBirthday",
      "machoVersion",
      "projectCodename",
      "projectRegion",
      "projectVersion",
      "defaultCountryCode",
      "proxyNodeId",
    ].includes(key)
  ) {
    return "Client Compatibility";
  }
  if (
    [
      "serverPort",
      "imageServerUrl",
      "microservicesRedirectUrl",
      "xmppServerPort",
    ].includes(key)
  ) {
    return "Network";
  }
  if (
    [
      "spaceDebrisLifetimeMs",
      "tidiAutoscaler",
      "NewEdenSystemLoading",
      "asteroidFieldsEnabled",
    ].includes(key)
  ) {
    return "World & Performance";
  }
  if (["devMode", "logLevel", "omegaLicenseEnabled"].includes(key)) {
    return "Basics";
  }
  for (const [prefix, group] of GROUP_PREFIX_RULES) {
    if (key.startsWith(prefix)) return group;
  }
  return "Advanced";
}

function formatSelectOptionLabel(entry, value) {
  const key = String(entry && entry.key || "");
  if (key === "logLevel") {
    if (Number(value) === 0) {
      return "0 - Silent";
    }
    if (Number(value) === 1) {
      return "1 - Normal logging";
    }
    if (Number(value) === 2) {
      return "2 - Verbose debug";
    }
  }
  if (key === "NewEdenSystemLoading") {
    if (Number(value) === 1) {
      return "1 - Lazy boot (Jita + New Caldari)";
    }
    if (Number(value) === 2) {
      return "2 - Preload all high-sec systems";
    }
    if (Number(value) === 3) {
      return "3 - Preload every system in New Eden";
    }
    if (Number(value) === 4) {
      return "4 - OnGoingLazy (lazy preload, all gates active)";
    }
  }
  return String(value);
}

function buildControlOptions(entry, metadata = {}) {
  if (Array.isArray(metadata.options) && metadata.options.length > 0) {
    return metadata.options.map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }
  if (Array.isArray(entry.allowedValues) && entry.allowedValues.length > 0) {
    return entry.allowedValues.map((value) => ({
      value,
      label: formatSelectOptionLabel(entry, value),
    }));
  }
  return [];
}

function inferControl(entry, metadata) {
  if (metadata.control) {
    return metadata.control;
  }
  if (Array.isArray(metadata.options) && metadata.options.length > 0) {
    return "select";
  }
  if (Array.isArray(entry.allowedValues) && entry.allowedValues.length > 0) {
    return "select";
  }
  if (entry.valueType === "boolean") {
    return "boolean";
  }
  if (entry.valueType === "number") {
    return "number";
  }
  return "text";
}

function buildConfigEntries(snapshot) {
  return config
    .getConfigDefinitions()
    .map((entry, index) => {
      const metadata = UI_METADATA[entry.key] || {};
      const description = Array.isArray(entry.description)
        ? entry.description
        : [entry.description];
      const options = buildControlOptions(entry, metadata);
      const control = inferControl(entry, {
        ...metadata,
        options,
      });
      return {
        key: entry.key,
        label: metadata.label || humanizeKey(entry.key),
        group: inferGroup(entry, metadata),
        subGroup: inferSubGroup(entry.key, metadata),
        order: index,
        control,
        options,
        valueType: entry.valueType,
        defaultValue: snapshot.defaults[entry.key],
        fileValue: snapshot.fileConfig[entry.key],
        currentValue: snapshot.resolvedConfig[entry.key],
        localValue: snapshot.localRawConfig[entry.key],
        sharedValue: snapshot.sharedRawConfig[entry.key],
        source: snapshot.sources[entry.key],
        envVar: entry.envVar || null,
        envOverrideValue: Object.prototype.hasOwnProperty.call(
          snapshot.envConfig,
          entry.key,
        )
          ? snapshot.envConfig[entry.key]
          : null,
        validValues: entry.validValues,
        description,
      };
    })
    .sort((left, right) => {
      const leftGroupIndex = GROUP_ORDER.indexOf(left.group);
      const rightGroupIndex = GROUP_ORDER.indexOf(right.group);
      const normalizedLeftGroupIndex =
        leftGroupIndex === -1 ? GROUP_ORDER.length : leftGroupIndex;
      const normalizedRightGroupIndex =
        rightGroupIndex === -1 ? GROUP_ORDER.length : rightGroupIndex;

      if (normalizedLeftGroupIndex !== normalizedRightGroupIndex) {
        return normalizedLeftGroupIndex - normalizedRightGroupIndex;
      }

      return left.order - right.order;
    });
}

function buildGroupOrder(entries = []) {
  const usedGroups = new Set(
    entries
      .map((entry) => String(entry && entry.group || "").trim())
      .filter(Boolean),
  );
  const orderedGroups = GROUP_ORDER.filter((group) => usedGroups.has(group));
  const additionalGroups = [...usedGroups]
    .filter((group) => !GROUP_ORDER.includes(group))
    .sort();
  return [
    ...orderedGroups,
    ...additionalGroups,
  ];
}

function buildConfigExportPayload(snapshot = config.getConfigStateSnapshot()) {
  const entries = buildConfigEntries(snapshot);
  const environmentOverrides = Object.keys(snapshot.envConfig);
  return {
    generatedAt: new Date().toISOString(),
    groupOrder: buildGroupOrder(entries),
    paths: {
      repoRoot: snapshot.rootDir,
      sharedConfigPath: snapshot.sharedConfigPath,
      localConfigPath: snapshot.localConfigPath,
    },
    environmentOverrides,
    notes:
      environmentOverrides.length > 0
        ? [
            "Some settings are currently overridden by EVEJS_* environment variables.",
            "Saving still updates evejs.config.local.json, but runtime will keep using the environment value until that override is removed.",
          ]
        : [],
    entries,
  };
}

function readJsonFromStdin() {
  const input = fs.readFileSync(0, "utf8").trim();
  if (input === "") {
    return {};
  }
  return JSON.parse(input);
}

const OPTIONAL_BLANK_CONFIG_KEYS = new Set([
  "miningNpcFleetProfileOrPool",
]);

function getBlankValidationKey(error) {
  const message = String(error && error.message || error || "");
  const match = /^([^.\r\n]+) cannot be blank\.$/.exec(message.trim());
  return match ? match[1] : "";
}

function inferConfigEntryType(entry) {
  if (entry && entry.valueType) {
    return entry.valueType;
  }
  if (entry && entry.envType) {
    return entry.envType;
  }
  switch (typeof (entry && entry.defaultValue)) {
    case "boolean":
    case "number":
    case "string":
      return typeof entry.defaultValue;
    default:
      return "string";
  }
}

function parseBooleanConfigValue(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && (value === 0 || value === 1)) {
    return value === 1;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function configEntryMentionsBlank(entry) {
  const description = Array.isArray(entry && entry.description)
    ? entry.description
    : [entry && entry.description];
  const text = [
    entry && entry.validValues,
    ...description,
  ]
    .filter((part) => part !== undefined && part !== null)
    .join(" ")
    .toLowerCase();
  return /\bblank\b/.test(text);
}

function isOptionalBlankConfigEntry(entry) {
  return Boolean(
    entry &&
      (
        entry.allowBlank === true ||
        entry.defaultValue === "" ||
        OPTIONAL_BLANK_CONFIG_KEYS.has(entry.key) ||
        configEntryMentionsBlank(entry)
      ),
  );
}

function validateAllowedEditorValue(entry, value) {
  if (
    Array.isArray(entry && entry.allowedValues) &&
    !entry.allowedValues.includes(value)
  ) {
    throw new Error(
      `${entry.key} must be one of ${entry.allowedValues
        .map((allowedValue) => JSON.stringify(allowedValue))
        .join(", ")}.`,
    );
  }
  return value;
}

function coerceEditorConfigValue(entry, value) {
  switch (inferConfigEntryType(entry)) {
    case "boolean": {
      const parsedBoolean = parseBooleanConfigValue(value);
      if (parsedBoolean !== undefined) {
        return validateAllowedEditorValue(entry, parsedBoolean);
      }
      throw new Error(`${entry.key} must be true or false.`);
    }
    case "number": {
      const parsedNumber =
        typeof value === "number" ? value : Number(String(value).trim());
      if (Number.isFinite(parsedNumber)) {
        return validateAllowedEditorValue(entry, parsedNumber);
      }
      throw new Error(`${entry.key} must be a valid number.`);
    }
    case "string": {
      if (value === undefined || value === null) {
        throw new Error(`${entry.key} must be a string.`);
      }
      const trimmedValue = String(value).trim();
      if (trimmedValue === "" && !isOptionalBlankConfigEntry(entry)) {
        throw new Error(`${entry.key} cannot be blank.`);
      }
      return validateAllowedEditorValue(entry, trimmedValue);
    }
    default:
      return value;
  }
}

function buildSnapshotAfterEditorSave(snapshot, definitions, nextLocalConfig, localConfigPath) {
  const sharedRawConfig = snapshot.sharedRawConfig || {};
  const defaults = snapshot.defaults || {};
  const envConfig = snapshot.envConfig || {};
  const fileConfig = {
    ...defaults,
    ...sharedRawConfig,
    ...nextLocalConfig,
  };
  const resolvedConfig = {
    ...fileConfig,
    ...envConfig,
  };
  const localSource = path.basename(localConfigPath);
  const sharedSource = snapshot.sharedConfigPath
    ? path.basename(snapshot.sharedConfigPath)
    : "shared";
  const sources = Object.fromEntries(
    definitions.map((entry) => {
      if (Object.prototype.hasOwnProperty.call(envConfig, entry.key)) {
        return [entry.key, "env"];
      }
      if (Object.prototype.hasOwnProperty.call(nextLocalConfig, entry.key)) {
        return [entry.key, localSource];
      }
      if (Object.prototype.hasOwnProperty.call(sharedRawConfig, entry.key)) {
        return [entry.key, sharedSource];
      }
      return [entry.key, "default"];
    }),
  );

  return {
    ...snapshot,
    localRawConfig: nextLocalConfig,
    fileConfig,
    resolvedConfig,
    sources,
  };
}

function saveConfigWithOptionalBlankFallback(values, blankKey) {
  const snapshot = config.getConfigStateSnapshot();
  const localConfigPath = snapshot && snapshot.localConfigPath;
  if (!localConfigPath) {
    throw new Error(
      `${blankKey} is blank, but this EvEJS build does not expose a writable local config path.`,
    );
  }

  const definitions = config.getConfigDefinitions();
  const entryByKey = new Map(definitions.map((entry) => [entry.key, entry]));
  const blankEntry = entryByKey.get(blankKey);
  const submittedBlankValue =
    values &&
    typeof values === "object" &&
    !Array.isArray(values) &&
    Object.prototype.hasOwnProperty.call(values, blankKey)
      ? values[blankKey]
      : snapshot.fileConfig && snapshot.fileConfig[blankKey];

  if (
    !blankEntry ||
    !isOptionalBlankConfigEntry(blankEntry) ||
    String(submittedBlankValue ?? "").trim() !== ""
  ) {
    throw new Error(`${blankKey} cannot be blank.`);
  }

  const nextLocalConfig = {
    ...(snapshot.localRawConfig || {}),
  };
  for (const entry of definitions) {
    const candidateValue =
      values &&
      typeof values === "object" &&
      !Array.isArray(values) &&
      Object.prototype.hasOwnProperty.call(values, entry.key)
        ? values[entry.key]
        : snapshot.fileConfig[entry.key];
    nextLocalConfig[entry.key] = coerceEditorConfigValue(entry, candidateValue);
  }

  fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
  fs.writeFileSync(localConfigPath, `${JSON.stringify(nextLocalConfig, null, 2)}\n`, "utf8");
  return buildSnapshotAfterEditorSave(snapshot, definitions, nextLocalConfig, localConfigPath);
}

function saveConfig() {
  const payload = readJsonFromStdin();
  const values =
    payload && typeof payload === "object" && !Array.isArray(payload) && payload.values
      ? payload.values
      : payload;
  let snapshot;
  try {
    snapshot = config.saveLocalConfig(values);
  } catch (error) {
    const blankKey = getBlankValidationKey(error);
    if (!blankKey) {
      throw error;
    }
    snapshot = saveConfigWithOptionalBlankFallback(values, blankKey);
  }
  return buildConfigExportPayload(snapshot);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        `Required database file was not found: ${filePath}. Run tools\\DatabaseCreator\\CreateDatabase.bat if local database data has not been generated.`,
      );
    }
    throw error;
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function openPlayerDatabase(readonly = true) {
  if (!fs.existsSync(databasePath)) {
    throw new Error(
      `The authoritative player database was not found: ${databasePath}`,
    );
  }
  const db = new Database(databasePath, { readonly, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

function readSqliteTable(db, table) {
  if (!PLAYER_TABLE_NAMES.includes(table)) {
    throw new Error(`Unsupported player table: ${table}`);
  }

  let rows;
  try {
    rows = db.prepare(`SELECT key, json FROM "${table}" ORDER BY key`).all();
  } catch (error) {
    throw new Error(`Could not read SQLite table ${table}: ${error.message}`);
  }

  const records = {};
  for (const row of rows) {
    try {
      records[String(row.key)] = JSON.parse(row.json);
    } catch (error) {
      throw new Error(
        `Could not parse SQLite row ${table}.${row.key}: ${error.message}`,
      );
    }
  }
  return records;
}

function readPlayerTablesFromDatabase(db) {
  return {
    accounts: readSqliteTable(db, "accounts"),
    characters: readSqliteTable(db, "characters"),
    skills: readSqliteTable(db, "skills"),
    items: readSqliteTable(db, "items"),
    identityState: readSqliteTable(db, "identityState"),
  };
}

function detectRecordId(record) {
  if (!isPlainObject(record)) {
    return null;
  }

  for (const key of [
    "stationID",
    "solarSystemID",
    "corporationID",
    "typeID",
    "itemID",
    "characterID",
    "id",
  ]) {
    if (record[key] !== undefined && record[key] !== null) {
      return String(record[key]);
    }
  }

  return null;
}

function mapArrayRecords(records) {
  return Object.fromEntries(
    records
      .map((record) => [detectRecordId(record), record])
      .filter(([key, value]) => typeof key === "string" && key !== "" && isPlainObject(value)),
  );
}

function getRecordMap(data) {
  if (isPlainObject(data.records)) {
    return data.records;
  }

  for (const collectionKey of ["stations", "solarSystems", "shipTypes", "corporations"]) {
    if (Array.isArray(data?.[collectionKey])) {
      return mapArrayRecords(data[collectionKey]);
    }
  }

  const arrayValue = Object.values(data || {}).find((value) => Array.isArray(value));
  if (Array.isArray(arrayValue)) {
    return mapArrayRecords(arrayValue);
  }

  return Object.fromEntries(
    Object.entries(data || {}).filter(
      ([key, value]) =>
        !["source", "_meta"].includes(key) && isPlainObject(value),
    ),
  );
}

function getReferenceName(record, preferredKeys) {
  if (!isPlainObject(record)) {
    return null;
  }

  for (const key of preferredKeys) {
    if (typeof record[key] === "string" && record[key].trim() !== "") {
      return record[key];
    }
  }

  return null;
}

function loadReferenceMaps() {
  const corporations = getRecordMap(
    readJsonFile(path.join(dataRoot, "corporations/data.json")),
  );
  const stations = getRecordMap(
    readJsonFile(path.join(dataRoot, "stations/data.json")),
  );
  const solarSystems = getRecordMap(
    readJsonFile(path.join(dataRoot, "solarSystems/data.json")),
  );
  const shipTypes = getRecordMap(
    readJsonFile(path.join(dataRoot, "shipTypes/data.json")),
  );

  return {
    corporationNames: Object.fromEntries(
      Object.entries(corporations).map(([key, value]) => [
        key,
        getReferenceName(value, ["corporationName", "name"]) || key,
      ]),
    ),
    stationNames: Object.fromEntries(
      Object.entries(stations).map(([key, value]) => [
        key,
        getReferenceName(value, ["stationName", "name"]) || key,
      ]),
    ),
    solarSystemNames: Object.fromEntries(
      Object.entries(solarSystems).map(([key, value]) => [
        key,
        getReferenceName(value, ["solarSystemName", "name"]) || key,
      ]),
    ),
    shipTypeNames: Object.fromEntries(
      Object.entries(shipTypes).map(([key, value]) => [
        key,
        getReferenceName(value, ["typeName", "name"]) || key,
      ]),
    ),
  };
}

function loadPlayerTables() {
  const db = openPlayerDatabase(true);
  try {
    return db.transaction(() => readPlayerTablesFromDatabase(db))();
  } finally {
    db.close();
  }
}

function loadTypeTables() {
  const itemTypesPayload = readJsonFile(TYPE_TABLE_PATHS.itemTypes);
  const shipTypesPayload = readJsonFile(TYPE_TABLE_PATHS.shipTypes);
  const skillTypesPayload = readJsonFile(TYPE_TABLE_PATHS.skillTypes);

  return {
    itemTypes: Array.isArray(itemTypesPayload?.types) ? itemTypesPayload.types : [],
    shipTypes: Array.isArray(shipTypesPayload?.ships) ? shipTypesPayload.ships : [],
    skillTypes: Array.isArray(skillTypesPayload?.skills) ? skillTypesPayload.skills : [],
  };
}

function loadSkillRanksByTypeID() {
  if (!fs.existsSync(TYPE_TABLE_PATHS.typeDogma)) {
    return {};
  }

  const typeDogmaPayload = readJsonFile(TYPE_TABLE_PATHS.typeDogma);
  const dogmaTypes = isPlainObject(typeDogmaPayload?.typesByTypeID)
    ? typeDogmaPayload.typesByTypeID
    : {};
  const ranksByTypeID = {};

  for (const [typeID, dogmaType] of Object.entries(dogmaTypes)) {
    const skillRank = Number(dogmaType?.attributes?.["275"]);
    if (Number.isFinite(skillRank) && skillRank > 0) {
      ranksByTypeID[String(typeID)] = skillRank;
    }
  }

  return ranksByTypeID;
}

function buildAccountMaps(accounts) {
  const accountEntries = Object.entries(accounts || {});
  const accountKeyById = new Map();
  const accountById = new Map();

  for (const [accountKey, account] of accountEntries) {
    const normalizedId = String(account?.id ?? "");
    if (normalizedId !== "") {
      accountKeyById.set(normalizedId, accountKey);
      accountById.set(normalizedId, account);
    }
  }

  return {
    accountEntries,
    accountKeyById,
    accountById,
  };
}

function formatLocationLabel(characterId, item, itemsById, references) {
  const locationId = item?.locationID;
  const normalizedLocationId = String(locationId ?? "");
  if (normalizedLocationId === "") {
    return "Unknown location";
  }

  if (normalizedLocationId === String(characterId)) {
    return "Character inventory";
  }

  const parentItem = itemsById.get(normalizedLocationId);
  if (parentItem) {
    return parentItem.itemName || parentItem.shipName || `Inside item ${normalizedLocationId}`;
  }

  if (references.stationNames[normalizedLocationId]) {
    return references.stationNames[normalizedLocationId];
  }
  if (references.solarSystemNames[normalizedLocationId]) {
    return references.solarSystemNames[normalizedLocationId];
  }

  return normalizedLocationId;
}

function buildPlayerSummary(
  characterId,
  character,
  accountKey,
  account,
  characterSkills,
  characterItems,
  references,
) {
  const corporationName =
    references.corporationNames[String(character?.corporationID ?? "")] ||
    (character?.corporationID ? String(character.corporationID) : "Unknown");
  const stationName =
    references.stationNames[String(character?.stationID ?? "")] ||
    (character?.stationID ? String(character.stationID) : "Unknown");
  const solarSystemName =
    references.solarSystemNames[String(character?.solarSystemID ?? "")] ||
    (character?.solarSystemID ? String(character.solarSystemID) : "Unknown");
  const shipName =
    character?.shipName ||
    references.shipTypeNames[String(character?.shipTypeID ?? "")] ||
    "Unknown ship";
  const itemCount = characterItems.length;
  const shipCount = characterItems.filter(
    (item) => Number(item?.categoryID) === 6,
  ).length;
  const skillCount = Object.keys(characterSkills || {}).length;
  const warningMessages = [];

  if (String(characterId) === "140000001") {
    warningMessages.push("Placeholder character. Deleting or corrupting it can break the server.");
  }
  if (character?.characterName === "DO NOT DELETE") {
    warningMessages.push("This character is intentionally marked DO NOT DELETE.");
  }

  const searchText = [
    character?.characterName,
    accountKey,
    shipName,
    stationName,
    solarSystemName,
    corporationName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    characterId: String(characterId),
    characterName: character?.characterName || `Character ${characterId}`,
    accountId: character?.accountId ?? null,
    accountName: accountKey || "Unknown account",
    banned: Boolean(account?.banned),
    corporationName,
    stationName,
    solarSystemName,
    shipName,
    shipTypeID: character?.shipTypeID ?? null,
    balance: character?.balance ?? 0,
    plexBalance: character?.plexBalance ?? 0,
    aurBalance: character?.aurBalance ?? 0,
    skillPoints: character?.skillPoints ?? 0,
    securityStatus: character?.securityStatus ?? 0,
    itemCount,
    shipCount,
    skillCount,
    warningMessages,
    searchText,
  };
}

function buildSkillList(skillMap) {
  return Object.entries(skillMap || {})
    .map(([skillKey, skill]) => ({
      skillKey: String(skillKey),
      typeID: skill?.typeID ?? Number(skillKey),
      itemName: skill?.itemName || `Skill ${skillKey}`,
      groupName: skill?.groupName || "",
      groupID: skill?.groupID ?? null,
      skillRank: skill?.skillRank ?? 1,
      skillLevel: skill?.skillLevel ?? 0,
      trainedSkillLevel: skill?.trainedSkillLevel ?? 0,
      effectiveSkillLevel: skill?.effectiveSkillLevel ?? 0,
      skillPoints: skill?.skillPoints ?? 0,
      inTraining: Boolean(skill?.inTraining),
      raw: cloneValue(skill),
    }))
    .sort((left, right) => {
      const nameComparison = left.itemName.localeCompare(right.itemName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.skillKey.localeCompare(right.skillKey);
    });
}

function buildItemList(characterId, items, references) {
  const itemsById = new Map(items.map((item) => [String(item.itemID), item]));
  return items
    .map((item) => ({
      itemKey: String(item.itemID),
      typeID: item?.typeID ?? null,
      itemName: item?.itemName || item?.shipName || `Item ${item?.itemID}`,
      typeName:
        item?.itemName ||
        references.shipTypeNames[String(item?.typeID ?? "")] ||
        `Type ${item?.typeID ?? "unknown"}`,
      quantity: item?.quantity ?? null,
      stacksize: item?.stacksize ?? null,
      categoryID: item?.categoryID ?? null,
      groupID: item?.groupID ?? null,
      locationLabel: formatLocationLabel(characterId, item, itemsById, references),
      raw: cloneValue(item),
    }))
    .sort((left, right) => {
      const nameComparison = left.itemName.localeCompare(right.itemName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.itemKey.localeCompare(right.itemKey);
    });
}

function buildSkillCatalog(skillsTable, skillTypes = [], skillRanksByTypeID = {}) {
  const catalog = new Map();
  const ownedSkillKeys = new Set();

  for (const skillType of skillTypes || []) {
    const rawTypeID = skillType?.typeID;
    if (rawTypeID == null || String(rawTypeID) === "") {
      continue;
    }

    const normalizedSkillKey = String(rawTypeID);
    catalog.set(normalizedSkillKey, {
      skillKey: normalizedSkillKey,
      typeID: rawTypeID,
      itemName: skillType?.name || `Skill ${normalizedSkillKey}`,
      groupName: skillType?.groupName || "",
      groupID: skillType?.groupID ?? null,
      skillRank:
        skillType?.skillRank ?? skillRanksByTypeID[normalizedSkillKey] ?? 1,
      published: skillType?.published ?? true,
    });
  }

  for (const skillMap of Object.values(skillsTable || {})) {
    for (const [skillKey, skill] of Object.entries(skillMap || {})) {
      const normalizedSkillKey = String(skillKey);
      const catalogEntry = catalog.get(normalizedSkillKey);
      ownedSkillKeys.add(normalizedSkillKey);
      catalog.set(normalizedSkillKey, {
        skillKey: normalizedSkillKey,
        typeID: skill?.typeID ?? catalogEntry?.typeID ?? Number(normalizedSkillKey),
        itemName:
          skill?.itemName || catalogEntry?.itemName || `Skill ${normalizedSkillKey}`,
        groupName: skill?.groupName || catalogEntry?.groupName || "",
        groupID: skill?.groupID ?? catalogEntry?.groupID ?? null,
        skillRank: skill?.skillRank ?? catalogEntry?.skillRank ?? 1,
        published: skill?.published ?? catalogEntry?.published ?? true,
      });
    }
  }

  return [...catalog.values()]
    .filter((entry) => entry.published !== false || ownedSkillKeys.has(entry.skillKey))
    .sort((left, right) => {
      const groupComparison = (left.groupName || "").localeCompare(
        right.groupName || "",
      );
      if (groupComparison !== 0) {
        return groupComparison;
      }
      const nameComparison = left.itemName.localeCompare(right.itemName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.skillKey.localeCompare(right.skillKey);
    });
}

function buildShipCatalog(shipTypes) {
  return shipTypes
    .filter((ship) => Boolean(ship?.published))
    .map((ship) => ({
      typeID: ship.typeID,
      name: ship.name || `Ship ${ship.typeID}`,
      groupID: ship.groupID ?? null,
      groupName: ship.groupName || "",
      categoryID: ship.categoryID ?? 6,
      mass: ship.mass ?? 0,
      volume: ship.volume ?? 0,
      capacity: ship.capacity ?? 0,
      radius: ship.radius ?? 0,
      raceID: ship.raceID ?? null,
      basePrice: ship.basePrice ?? null,
      published: Boolean(ship?.published),
    }))
    .sort((left, right) => {
      const groupComparison = (left.groupName || "").localeCompare(right.groupName || "");
      if (groupComparison !== 0) {
        return groupComparison;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildItemTypeSearchResults(itemTypes, queryText, limit = 80) {
  const normalizedQuery = String(queryText || "").trim().toLowerCase();
  const publishedTypes = itemTypes.filter(
    (type) => Boolean(type?.published) && Number(type?.categoryID ?? 0) !== 6,
  );

  const scored = publishedTypes
    .map((type) => {
      const name = type?.name || `Type ${type?.typeID}`;
      const groupName = type?.groupName || "";
      const haystack = `${name} ${groupName}`.toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return null;
      }
      const exactName = normalizedQuery && name.toLowerCase() === normalizedQuery ? 0 : 1;
      const startsWith = normalizedQuery && name.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      return {
        score: `${exactName}${startsWith}${name}`,
        typeID: type.typeID,
        name,
        groupID: type.groupID ?? null,
        groupName,
        categoryID: type.categoryID ?? null,
        volume: type.volume ?? 0,
        capacity: type.capacity ?? 0,
        radius: type.radius ?? 0,
        mass: type.mass ?? 0,
        portionSize: type.portionSize ?? 1,
        basePrice: type.basePrice ?? null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.score.localeCompare(right.score))
    .slice(0, limit);

  return scored.map(({ score, ...entry }) => entry);
}

function buildNextItemIdSeed(itemsTable, identityState = {}) {
  let maxItemId = 990000000;
  for (const item of Object.values(itemsTable || {})) {
    const itemId = Number(item?.itemID ?? 0);
    if (Number.isFinite(itemId) && itemId > maxItemId) {
      maxItemId = itemId;
    }
  }
  const allocatedNextItemId = Number(identityState?.nextItemID ?? 0);
  return Math.max(
    maxItemId + 1,
    Number.isFinite(allocatedNextItemId) ? allocatedNextItemId : 0,
  );
}

function buildPlayerList(tables, references) {
  const { accounts, characters, skills, items } = tables;
  const { accountKeyById, accountById } = buildAccountMaps(accounts);
  const itemsByOwnerId = new Map();

  for (const item of Object.values(items || {})) {
    const ownerId = String(item?.ownerID ?? "");
    if (ownerId === "") {
      continue;
    }
    if (!itemsByOwnerId.has(ownerId)) {
      itemsByOwnerId.set(ownerId, []);
    }
    itemsByOwnerId.get(ownerId).push(item);
  }

  return Object.entries(characters || {})
    .map(([characterId, character]) => {
      const accountId = String(character?.accountId ?? "");
      const accountKey = accountKeyById.get(accountId) || "";
      const account = accountById.get(accountId) || null;
      const characterSkills = isPlainObject(skills?.[characterId])
        ? skills[characterId]
        : {};
      const characterItems = itemsByOwnerId.get(String(characterId)) || [];
      return buildPlayerSummary(
        characterId,
        character,
        accountKey,
        account,
        characterSkills,
        characterItems,
        references,
      );
    })
    .sort((left, right) => {
      const nameComparison = left.characterName.localeCompare(right.characterName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.characterId.localeCompare(right.characterId);
    });
}

function buildPlayerDetail(characterId, tables, references) {
  const normalizedCharacterId = String(characterId);
  const character = tables.characters?.[normalizedCharacterId];
  if (!isPlainObject(character)) {
    throw new Error(`Character ${normalizedCharacterId} was not found.`);
  }

  const { accountKeyById, accountById } = buildAccountMaps(tables.accounts);
  const accountId = String(character?.accountId ?? "");
  const accountKey = accountKeyById.get(accountId) || "";
  const account = accountById.get(accountId);
  if (!accountKey || !isPlainObject(account)) {
    throw new Error(`Account ${accountId || "unknown"} for character ${normalizedCharacterId} was not found.`);
  }

  const skills = isPlainObject(tables.skills?.[normalizedCharacterId])
    ? tables.skills[normalizedCharacterId]
    : {};
  const items = Object.values(tables.items || {}).filter(
    (item) => String(item?.ownerID ?? "") === normalizedCharacterId,
  );
  const summary = buildPlayerSummary(
    normalizedCharacterId,
    character,
    accountKey,
    account,
    skills,
    items,
    references,
  );

  return {
    summary,
    originalAccountKey: accountKey,
    accountName: accountKey,
    account: cloneValue(account),
    characterId: normalizedCharacterId,
    character: cloneValue(character),
    skills: cloneValue(skills),
    items: Object.fromEntries(
      items
        .map((item) => [String(item.itemID), cloneValue(item)])
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    ),
    skillsList: buildSkillList(skills),
    itemsList: buildItemList(normalizedCharacterId, items, references),
    metrics: {
      itemCount: summary.itemCount,
      shipCount: summary.shipCount,
      skillCount: summary.skillCount,
      walletJournalCount: Array.isArray(character?.walletJournal)
        ? character.walletJournal.length
        : 0,
      bookmarkCount: Array.isArray(character?.bookmarks)
        ? character.bookmarks.length
        : 0,
    },
    references: {
      corporationName: summary.corporationName,
      stationName: summary.stationName,
      solarSystemName: summary.solarSystemName,
      shipName: summary.shipName,
    },
    warningMessages: [...summary.warningMessages],
  };
}

function buildDatabasePayload(selectedCharacterId) {
  const tables = loadPlayerTables();
  const typeTables = loadTypeTables();
  const skillRanksByTypeID = loadSkillRanksByTypeID();
  const references = loadReferenceMaps();
  const players = buildPlayerList(tables, references);
  const skillCatalog = buildSkillCatalog(
    tables.skills,
    typeTables.skillTypes,
    skillRanksByTypeID,
  );
  const shipCatalog = buildShipCatalog(typeTables.shipTypes);
  const resolvedCharacterId =
    selectedCharacterId && players.some((player) => player.characterId === String(selectedCharacterId))
      ? String(selectedCharacterId)
      : players[0]?.characterId || null;

  return {
    generatedAt: new Date().toISOString(),
    paths: {
      databasePath,
      staticDataRoot: dataRoot,
    },
    playerCount: players.length,
    players,
    skillCatalog,
    shipCatalog,
    nextItemIdSeed: buildNextItemIdSeed(tables.items, tables.identityState),
    selectedCharacterId: resolvedCharacterId,
    selectedPlayer: resolvedCharacterId
      ? buildPlayerDetail(resolvedCharacterId, tables, references)
      : null,
  };
}

function searchDatabaseTypes(kind, queryText) {
  const typeTables = loadTypeTables();
  switch (kind) {
    case "ship":
      return buildShipCatalog(typeTables.shipTypes).filter((entry) => {
        const normalizedQuery = String(queryText || "").trim().toLowerCase();
        if (!normalizedQuery) {
          return true;
        }
        return `${entry.name} ${entry.groupName}`.toLowerCase().includes(normalizedQuery);
      }).slice(0, 80);
    case "item":
      return buildItemTypeSearchResults(typeTables.itemTypes, queryText, 80);
    default:
      throw new Error(`Unknown database type search kind "${kind}". Use "ship" or "item".`);
  }
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function validateDatabaseSave(payload, tables) {
  const characterId = requireNonEmptyString(payload.characterId, "characterId");
  const originalAccountKey = requireNonEmptyString(
    payload.originalAccountKey,
    "originalAccountKey",
  );
  const accountName = requireNonEmptyString(payload.accountName, "accountName");

  if (!Object.prototype.hasOwnProperty.call(tables.characters, characterId)) {
    throw new Error(`Character ${characterId} was not found in SQLite.`);
  }
  if (!Object.prototype.hasOwnProperty.call(tables.accounts, originalAccountKey)) {
    throw new Error(`Account ${originalAccountKey} was not found in SQLite.`);
  }
  if (
    originalAccountKey !== accountName &&
    Object.prototype.hasOwnProperty.call(tables.accounts, accountName)
  ) {
    throw new Error(`An account named ${accountName} already exists in SQLite.`);
  }

  const accountId = String(payload.account?.id ?? "");
  const characterAccountId = String(payload.character?.accountId ?? "");
  if (!accountId || accountId !== characterAccountId) {
    throw new Error("account.id must match character.accountId.");
  }
  for (const [key, account] of Object.entries(tables.accounts)) {
    if (key !== originalAccountKey && String(account?.id ?? "") === accountId) {
      throw new Error(`Account id ${accountId} is already used by ${key}.`);
    }
  }

  let skillPointTotal = 0;
  for (const [skillKey, skill] of Object.entries(payload.skills)) {
    requirePlainObject(skill, `skills.${skillKey}`);
    if (String(skill?.typeID ?? "") !== String(skillKey)) {
      throw new Error(`Skill ${skillKey} must have matching typeID.`);
    }
    if (
      skill?.ownerID != null &&
      String(skill.ownerID) !== characterId
    ) {
      throw new Error(`Skill ${skillKey} belongs to another character.`);
    }
    if (
      skill?.locationID != null &&
      String(skill.locationID) !== characterId
    ) {
      throw new Error(`Skill ${skillKey} has an invalid character location.`);
    }
    const skillPoints = Number(skill?.skillPoints ?? 0);
    if (!Number.isFinite(skillPoints) || skillPoints < 0) {
      throw new Error(`Skill ${skillKey} has invalid skillPoints.`);
    }
    skillPointTotal += skillPoints;
  }

  const characterSkillPoints = Number(payload.character?.skillPoints);
  if (
    !Number.isFinite(characterSkillPoints) ||
    Math.round(characterSkillPoints) !== Math.round(skillPointTotal)
  ) {
    throw new Error(
      `character.skillPoints must equal the skill total (${Math.round(skillPointTotal)}).`,
    );
  }

  const ownedItemKeys = [];
  for (const [itemKey, item] of Object.entries(tables.items)) {
    if (String(item?.ownerID ?? "") === characterId) {
      ownedItemKeys.push(String(itemKey));
    }
  }

  for (const [itemKey, item] of Object.entries(payload.items)) {
    requirePlainObject(item, `items.${itemKey}`);
    if (String(item?.itemID ?? "") !== String(itemKey)) {
      throw new Error(`Item ${itemKey} must have matching itemID.`);
    }
    if (String(item?.ownerID ?? "") !== characterId) {
      throw new Error(`Item ${itemKey} belongs to another character.`);
    }
    const existingItem = tables.items[String(itemKey)];
    if (
      existingItem &&
      String(existingItem?.ownerID ?? "") !== characterId
    ) {
      throw new Error(`Item id ${itemKey} is already owned by another character.`);
    }
  }

  const nextItems = { ...tables.items };
  for (const itemKey of ownedItemKeys) {
    delete nextItems[itemKey];
  }
  for (const [itemKey, item] of Object.entries(payload.items)) {
    nextItems[String(itemKey)] = item;
  }

  return {
    characterId,
    originalAccountKey,
    accountName,
    ownedItemKeys,
    nextItemID: buildNextItemIdSeed(nextItems, tables.identityState),
  };
}

function nextDatabaseBackupPath() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  let candidate = `${databasePath}.${timestamp}.bak`;
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = `${databasePath}.${timestamp}-${suffix}.bak`;
    suffix += 1;
  }
  return candidate;
}

async function createDatabaseBackup(db) {
  const backupPath = nextDatabaseBackupPath();
  await db.backup(backupPath);

  const backupDb = new Database(backupPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const quickCheck = backupDb.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok") {
      throw new Error(`SQLite backup integrity check failed: ${quickCheck}`);
    }
  } finally {
    backupDb.close();
  }
  return backupPath;
}

function writeDatabasePlayer(db, payload) {
  const updateAccount = db.prepare(
    'UPDATE "accounts" SET json = ? WHERE key = ?',
  );
  const renameAccount = db.prepare(
    'UPDATE "accounts" SET key = ?, json = ? WHERE key = ?',
  );
  const updateCharacter = db.prepare(
    'UPDATE "characters" SET json = ? WHERE key = ?',
  );
  const upsertSkillMap = db.prepare(
    'INSERT INTO "skills"(key, json) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET json = excluded.json',
  );
  const deleteItem = db.prepare('DELETE FROM "items" WHERE key = ?');
  const upsertItem = db.prepare(
    'INSERT INTO "items"(key, json) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET json = excluded.json',
  );
  const upsertIdentity = db.prepare(
    'INSERT INTO "identityState"(key, json) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET json = excluded.json',
  );

  const transaction = db.transaction(() => {
    const tables = readPlayerTablesFromDatabase(db);
    const context = validateDatabaseSave(payload, tables);
    const accountJson = JSON.stringify(payload.account);

    const accountResult =
      context.originalAccountKey === context.accountName
        ? updateAccount.run(accountJson, context.originalAccountKey)
        : renameAccount.run(
            context.accountName,
            accountJson,
            context.originalAccountKey,
          );
    if (accountResult.changes !== 1) {
      throw new Error(`SQLite did not update account ${context.originalAccountKey}.`);
    }

    const characterResult = updateCharacter.run(
      JSON.stringify(payload.character),
      context.characterId,
    );
    if (characterResult.changes !== 1) {
      throw new Error(`SQLite did not update character ${context.characterId}.`);
    }

    upsertSkillMap.run(context.characterId, JSON.stringify(payload.skills));
    for (const itemKey of context.ownedItemKeys) {
      deleteItem.run(itemKey);
    }
    for (const [itemKey, item] of Object.entries(payload.items)) {
      upsertItem.run(String(itemKey), JSON.stringify(item));
    }
    upsertIdentity.run("nextItemID", JSON.stringify(context.nextItemID));
  });

  transaction.immediate();
}

async function saveDatabasePlayer() {
  const payload = readJsonFromStdin();
  requirePlainObject(payload, "Database save payload");

  requirePlainObject(payload.account, "account");
  requirePlainObject(payload.character, "character");
  requirePlainObject(payload.skills, "skills");
  requirePlainObject(payload.items, "items");

  const db = openPlayerDatabase(false);
  let backupPath;
  try {
    const tables = db.transaction(() => readPlayerTablesFromDatabase(db))();
    validateDatabaseSave(payload, tables);
    backupPath = await createDatabaseBackup(db);
    writeDatabasePlayer(db, payload);
  } finally {
    db.close();
  }

  const snapshot = buildDatabasePayload(payload.characterId);
  snapshot.backupPath = backupPath;
  return snapshot;
}

// --- Market daemon integration -------------------------------------------
// Market orders are owned by the external market daemon (marketDaemonHost:Port),
// not the local gamestore. These commands proxy to it over its newline-JSON RPC
// by reusing the server's own client, so the framing/protocol always matches.

let _marketClientModule = null;
function getMarketClientClass() {
  if (!_marketClientModule) {
    _marketClientModule = require(
      path.join(rootDir, "server/src/services/market/marketDaemonClient"),
    );
  }
  return _marketClientModule.MarketDaemonClient;
}

async function withMarketClient(fn) {
  const MarketDaemonClient = getMarketClientClass();
  const client = new MarketDaemonClient();
  try {
    return await fn(client);
  } finally {
    try {
      if (client._socket) {
        client._socket.destroy();
      }
    } catch (error) {
      // ignore teardown errors
    }
  }
}

function buildTypeNameLookup() {
  const tables = loadTypeTables();
  const map = new Map();
  for (const type of tables.itemTypes) {
    if (type && type.typeID != null) {
      map.set(Number(type.typeID), String(type.name || ""));
    }
  }
  for (const ship of tables.shipTypes) {
    const id = ship && (ship.typeID != null ? ship.typeID : ship.shipTypeID);
    if (id != null && !map.has(Number(id))) {
      map.set(Number(id), String(ship.name || ship.shipName || ""));
    }
  }
  return map;
}

// Resolve station / region / solar-system ids to names from the local static
// catalogs (station records already carry stationName + regionName), so market
// orders can show human-readable locations instead of raw ids.
function buildMarketLocationLookups() {
  const stations = new Map();
  const regions = new Map();
  const systems = new Map();
  try {
    const stationData = readJsonFile(path.join(dataRoot, "stations/data.json"));
    for (const station of stationData.stations || []) {
      if (!station) continue;
      const stationId = Number(station.stationID);
      if (stationId) {
        stations.set(stationId, String(station.stationName || ""));
      }
      const regionId = Number(station.regionID);
      if (regionId && station.regionName && !regions.has(regionId)) {
        regions.set(regionId, String(station.regionName));
      }
      const systemId = Number(station.solarSystemID);
      if (systemId && station.solarSystemName && !systems.has(systemId)) {
        systems.set(systemId, String(station.solarSystemName));
      }
    }
  } catch (error) {
    // static catalog missing - fall back to numeric ids
  }
  try {
    const systemData = readJsonFile(path.join(dataRoot, "solarSystems/data.json"));
    for (const system of systemData.solarSystems || []) {
      const systemId = Number(system && system.solarSystemID);
      if (systemId && !systems.has(systemId)) {
        systems.set(systemId, String(system.solarSystemName || ""));
      }
    }
  } catch (error) {
    // ignore
  }
  return { types: buildTypeNameLookup(), stations, regions, systems };
}

function normalizeMarketOrder(order, lookups) {
  const row = order && order.row ? order.row : order || {};
  const typeId = Number(row.type_id ?? row.typeID ?? order.type_id ?? 0);
  const stationId = Number(row.station_id ?? row.stationID ?? 0);
  const regionId = Number(row.region_id ?? row.regionID ?? 0);
  const solarSystemId = Number(row.solar_system_id ?? row.solarSystemID ?? 0);
  const bid = Boolean(row.bid ?? order.bid ?? false);
  return {
    orderId: String(row.order_id ?? order.order_id ?? order.orderId ?? ""),
    ownerId: Number(order.owner_id ?? order.ownerId ?? row.owner_id ?? 0),
    isCorp: Boolean(order.is_corp ?? order.isCorp ?? false),
    state: String(order.state ?? "open"),
    typeId,
    typeName: lookups.types.get(typeId) || `Type ${typeId}`,
    bid,
    side: bid ? "buy" : "sell",
    price: Number(row.price ?? 0),
    volEntered: Number(row.vol_entered ?? row.volEntered ?? 0),
    volRemaining: Number(row.vol_remaining ?? row.volRemaining ?? 0),
    minVolume: Number(row.min_volume ?? row.minVolume ?? 1),
    durationDays: Number(row.duration_days ?? row.duration ?? 0),
    rangeValue: Number(row.range_value ?? row.range ?? 0),
    stationId,
    stationName: lookups.stations.get(stationId) || "",
    regionId,
    regionName: lookups.regions.get(regionId) || "",
    solarSystemId,
    solarSystemName: lookups.systems.get(solarSystemId) || "",
    source: String(row.source ?? order.source ?? ""),
    issuedAt: row.issued_at ?? order.issued_at ?? null,
  };
}

async function getMarketStatus() {
  const MarketDaemonClient = getMarketClientClass();
  const probe = new MarketDaemonClient();
  const base = { host: probe.host, port: probe.port };
  try {
    await probe.ensureConnected({ suppressConnectFailureLog: true });
    return { ...base, reachable: true };
  } catch (error) {
    return {
      ...base,
      reachable: false,
      error: String((error && error.message) || error),
    };
  } finally {
    try {
      if (probe._socket) {
        probe._socket.destroy();
      }
    } catch (teardownError) {
      // ignore
    }
  }
}

async function getMarketOrders(ownerId, isCorp) {
  const owner = Number(ownerId) || 0;
  if (!owner) {
    throw new Error("A character id is required to list market orders.");
  }
  const lookups = buildMarketLocationLookups();
  return withMarketClient(async (client) => {
    const result = await client.call("GetCharOrders", {
      owner_id: owner,
      is_corp: Boolean(isCorp),
    });
    const orders = Array.isArray(result) ? result : [];
    return {
      ownerId: owner,
      isCorp: Boolean(isCorp),
      orders: orders.map((order) => normalizeMarketOrder(order, lookups)),
    };
  });
}

async function getMarketBook(regionId, typeId) {
  const region = Number(regionId) || 0;
  const type = Number(typeId) || 0;
  if (!region || !type) {
    throw new Error("Both a region id and a type id are required to load the market book.");
  }
  const lookups = buildMarketLocationLookups();
  return withMarketClient(async (client) => {
    const book = await client.call("GetOrders", {
      region_id: region,
      type_id: type,
    });
    const sells = Array.isArray(book && book.sells) ? book.sells : [];
    const buys = Array.isArray(book && book.buys) ? book.buys : [];
    return {
      regionId: region,
      regionName: lookups.regions.get(region) || "",
      typeId: type,
      typeName: lookups.types.get(type) || `Type ${type}`,
      sells: sells.map((order) => normalizeMarketOrder(order, lookups)),
      buys: buys.map((order) => normalizeMarketOrder(order, lookups)),
    };
  });
}

function buildPlaceOrderRequest(payload) {
  requirePlainObject(payload, "Market order payload");
  const side = String(payload.side || "").toLowerCase();
  const order = {
    owner_id: Number(payload.ownerId ?? payload.owner_id) || 0,
    is_corp: Boolean(payload.isCorp ?? payload.is_corp ?? false),
    station_id: Number(payload.stationId ?? payload.station_id) || 0,
    type_id: Number(payload.typeId ?? payload.type_id) || 0,
    price: Number(payload.price) || 0,
    quantity: Number(payload.quantity) || 0,
    min_volume: Number(payload.minVolume ?? payload.min_volume) || 1,
    duration_days: Number(payload.durationDays ?? payload.duration_days) || 0,
    range_value: Number(payload.rangeValue ?? payload.range_value ?? 0),
    bid: payload.bid != null ? Boolean(payload.bid) : side === "buy",
    source: String(payload.source || "player"),
  };
  if (!order.owner_id) {
    throw new Error("Order owner (character) is required.");
  }
  if (!order.type_id) {
    throw new Error("Order item type is required.");
  }
  if (!order.station_id) {
    throw new Error("Order station is required.");
  }
  if (!(order.price > 0)) {
    throw new Error("Order price must be greater than zero.");
  }
  if (!(order.quantity > 0)) {
    throw new Error("Order quantity must be greater than zero.");
  }
  return order;
}

async function placeMarketOrder() {
  const order = buildPlaceOrderRequest(readJsonFromStdin());
  return withMarketClient(async (client) => {
    const placed = await client.call("PlaceOrder", order);
    return {
      ok: true,
      orderId: String((placed && placed.order_id) || ""),
      placed,
    };
  });
}

async function cancelMarketOrder(orderId) {
  const id = String(orderId || "").trim();
  if (!id) {
    throw new Error("An order id is required to cancel a market order.");
  }
  return withMarketClient(async (client) => {
    const result = await client.call("CancelOrder", { order_id: id });
    return { ok: true, orderId: id, result };
  });
}

// Seed orders (source "seed", owner 0) are NOT player orders - ModifyOrder /
// CancelOrder cannot find them. They are seed *stock* keyed by (station,type)
// and are edited with AdjustSeedStock: delta_quantity changes quantity by a
// delta, and new_price SETS the price (a "price" field is ignored).
async function adjustSeedStock() {
  const payload = readJsonFromStdin();
  requirePlainObject(payload, "Seed adjust payload");
  const request = {
    station_id: Number(payload.stationId ?? payload.station_id) || 0,
    type_id: Number(payload.typeId ?? payload.type_id) || 0,
    delta_quantity: Number(payload.deltaQuantity ?? payload.delta_quantity) || 0,
    reason: String(payload.reason || "config_editor"),
  };
  if (!request.station_id) {
    throw new Error("Seed station id is required.");
  }
  if (!request.type_id) {
    throw new Error("Seed item type is required.");
  }
  const newPrice = Number(payload.newPrice ?? payload.new_price);
  if (Number.isFinite(newPrice) && newPrice > 0) {
    request.new_price = newPrice;
  }
  return withMarketClient(async (client) => {
    const seed = await client.call("AdjustSeedStock", request);
    return { ok: true, seed };
  });
}

// Modify = cancel the existing order then place a fresh one with the new terms
// (the daemon exposes no in-place edit). The payload carries both the order to
// cancel and the replacement order fields.
async function modifyMarketOrder() {
  const payload = readJsonFromStdin();
  requirePlainObject(payload, "Market modify payload");
  const cancelId = String(payload.orderId ?? payload.order_id ?? "").trim();
  if (!cancelId) {
    throw new Error("The order id to modify is required.");
  }
  const replacement = buildPlaceOrderRequest(payload);
  return withMarketClient(async (client) => {
    await client.call("CancelOrder", { order_id: cancelId });
    const placed = await client.call("PlaceOrder", replacement);
    return {
      ok: true,
      cancelledOrderId: cancelId,
      orderId: String((placed && placed.order_id) || ""),
      placed,
    };
  });
}

async function main() {
  const command = process.argv[2] || "export";
  const argument = process.argv[3] || "";
  const secondaryArgument = process.argv[4] || "";

  switch (command) {
    case "export":
      process.stdout.write(
        `${JSON.stringify(buildConfigExportPayload(), null, 2)}\n`,
      );
      return;
    case "save":
      process.stdout.write(`${JSON.stringify(saveConfig(), null, 2)}\n`);
      return;
    case "database-export":
      process.stdout.write(
        `${JSON.stringify(buildDatabasePayload(argument || null), null, 2)}\n`,
      );
      return;
    case "database-save":
      process.stdout.write(
        `${JSON.stringify(await saveDatabasePlayer(), null, 2)}\n`,
      );
      return;
    case "database-type-search":
      process.stdout.write(
        `${JSON.stringify(searchDatabaseTypes(argument || "item", secondaryArgument || ""), null, 2)}\n`,
      );
      return;
    case "market-status":
      process.stdout.write(`${JSON.stringify(await getMarketStatus(), null, 2)}\n`);
      return;
    case "market-orders":
      process.stdout.write(
        `${JSON.stringify(await getMarketOrders(argument, secondaryArgument === "corp"), null, 2)}\n`,
      );
      return;
    case "market-book":
      process.stdout.write(
        `${JSON.stringify(await getMarketBook(argument, secondaryArgument), null, 2)}\n`,
      );
      return;
    case "market-place":
      process.stdout.write(`${JSON.stringify(await placeMarketOrder(), null, 2)}\n`);
      return;
    case "market-cancel":
      process.stdout.write(`${JSON.stringify(await cancelMarketOrder(argument), null, 2)}\n`);
      return;
    case "market-modify":
      process.stdout.write(`${JSON.stringify(await modifyMarketOrder(), null, 2)}\n`);
      return;
    case "market-adjust-seed":
      process.stdout.write(`${JSON.stringify(await adjustSeedStock(), null, 2)}\n`);
      return;
    default:
      throw new Error(
        `Unknown command "${command}". Use "export", "save", "database-export", "database-save", "database-type-search", "market-status", "market-orders", "market-book", "market-place", "market-cancel", or "market-modify".`,
      );
  }
}

main().catch((error) => {
  process.stderr.write(`[eve.js] ${error.message}\n`);
  process.exitCode = 1;
});
