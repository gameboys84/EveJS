const rawPolicy = require("./productionMissionPolicy.json");

function positiveInteger(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return normalized;
}

function nonEmptyText(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} must be non-empty text`);
  }
  return normalized;
}

function assertUnique(value, seen, fieldName) {
  const key = String(value).toLowerCase();
  if (seen.has(key)) {
    throw new TypeError(`${fieldName} must be unique: ${value}`);
  }
  seen.add(key);
}

function normalizedTemplateAliases(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0
    ? [normalized, normalized.slice(separatorIndex + 1)]
    : [normalized];
}

function validateProductionMissionPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("production mission policy must be an object");
  }

  const version = positiveInteger(value.version, "version");
  if (!Array.isArray(value.goldenSecurityMissions)) {
    throw new TypeError("goldenSecurityMissions must be an array");
  }
  const goldenMissionIDs = new Set();
  const goldenDungeonIDs = new Set();
  const goldenTemplateIDs = new Set();
  const goldenSecurityMissions = value.goldenSecurityMissions.map((entry, index) => {
    const prefix = `goldenSecurityMissions[${index}]`;
    const missionID = positiveInteger(entry && entry.missionID, `${prefix}.missionID`);
    const dungeonID = positiveInteger(entry && entry.dungeonID, `${prefix}.dungeonID`);
    const agentLevel = positiveInteger(entry && entry.agentLevel, `${prefix}.agentLevel`);
    const templateID = nonEmptyText(entry && entry.templateID, `${prefix}.templateID`);
    assertUnique(missionID, goldenMissionIDs, "goldenSecurityMissions missionID");
    assertUnique(dungeonID, goldenDungeonIDs, "goldenSecurityMissions dungeonID");
    assertUnique(templateID, goldenTemplateIDs, "goldenSecurityMissions templateID");
    return { missionID, dungeonID, agentLevel, templateID };
  });

  if (!Array.isArray(value.disabledMissions)) {
    throw new TypeError("disabledMissions must be an array");
  }
  const disabledMissionIDs = new Set();
  const disabledTemplateIDs = new Set();
  const disabledTemplateAliases = new Set();
  const disabledMissions = value.disabledMissions.map((entry, index) => {
    const prefix = `disabledMissions[${index}]`;
    const missionID = positiveInteger(entry && entry.missionID, `${prefix}.missionID`);
    assertUnique(missionID, disabledMissionIDs, "disabledMissions missionID");
    if (goldenMissionIDs.has(String(missionID).toLowerCase())) {
      throw new TypeError(`missionID ${missionID} cannot be both golden and disabled`);
    }
    if (!Array.isArray(entry && entry.templateIDs) || entry.templateIDs.length <= 0) {
      throw new TypeError(`${prefix}.templateIDs must be a non-empty array`);
    }
    const templateIDs = entry.templateIDs.map((templateID, templateIndex) => {
      const normalized = nonEmptyText(
        templateID,
        `${prefix}.templateIDs[${templateIndex}]`,
      );
      assertUnique(normalized, disabledTemplateIDs, "disabledMissions templateID");
      for (const alias of normalizedTemplateAliases(normalized)) {
        disabledTemplateAliases.add(alias);
      }
      return normalized;
    });
    return { missionID, templateIDs };
  });

  const generatedMissionIDRange = value.generatedMissionIDRange;
  if (!generatedMissionIDRange || typeof generatedMissionIDRange !== "object") {
    throw new TypeError("generatedMissionIDRange must be an object");
  }
  const minInclusive = positiveInteger(
    generatedMissionIDRange.minInclusive,
    "generatedMissionIDRange.minInclusive",
  );
  const maxExclusive = positiveInteger(
    generatedMissionIDRange.maxExclusive,
    "generatedMissionIDRange.maxExclusive",
  );
  if (maxExclusive <= minInclusive) {
    throw new TypeError("generatedMissionIDRange.maxExclusive must exceed minInclusive");
  }

  if (!Array.isArray(value.retiredTemplatePrefixes) || value.retiredTemplatePrefixes.length <= 0) {
    throw new TypeError("retiredTemplatePrefixes must be a non-empty array");
  }
  const retiredPrefixKeys = new Set();
  const retiredTemplatePrefixes = value.retiredTemplatePrefixes.map((prefix, index) => {
    const normalized = nonEmptyText(prefix, `retiredTemplatePrefixes[${index}]`)
      .toLowerCase();
    assertUnique(normalized, retiredPrefixKeys, "retiredTemplatePrefixes");
    return normalized;
  });

  for (const { missionID, templateID } of goldenSecurityMissions) {
    if (missionID >= minInclusive && missionID < maxExclusive) {
      throw new TypeError(
        `golden missionID ${missionID} cannot be inside generatedMissionIDRange`,
      );
    }
    const goldenTemplateAliases = normalizedTemplateAliases(templateID);
    if (goldenTemplateAliases.some((alias) => disabledTemplateAliases.has(alias))) {
      throw new TypeError(
        `templateID ${templateID} cannot be both golden and disabled`,
      );
    }
    const normalizedTemplateID = templateID.toLowerCase();
    if (retiredTemplatePrefixes.some((prefix) => normalizedTemplateID.startsWith(prefix))) {
      throw new TypeError(
        `golden templateID ${templateID} cannot use a retired template prefix`,
      );
    }
  }

  return {
    version,
    goldenSecurityMissions,
    disabledMissions,
    generatedMissionIDRange: { minInclusive, maxExclusive },
    retiredTemplatePrefixes,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

const productionMissionPolicy = deepFreeze(
  validateProductionMissionPolicy(rawPolicy),
);

const disabledMissionTemplateIdentifiers = new Set(
  productionMissionPolicy.disabledMissions.flatMap(({ templateIDs }) =>
    templateIDs.flatMap(normalizedTemplateAliases)),
);

function normalizeStableMissionIdentity(value) {
  let normalized = String(value == null ? "" : value).trim().toLowerCase();
  let match = normalized.match(/^(?:mission|client-mission|retail-mission):(.+)$/);
  while (match) {
    normalized = String(match[1] || "").trim().toLowerCase();
    match = normalized.match(/^(?:mission|client-mission|retail-mission):(.+)$/);
  }
  return normalized;
}

function isDisabledMissionIdentifier(value) {
  const normalized = normalizeStableMissionIdentity(value);
  if (!/^-?\d+$/.test(normalized)) {
    return false;
  }
  const missionID = Number.parseInt(normalized, 10);
  return productionMissionPolicy.disabledMissions.some(
    ({ missionID: disabledMissionID }) => missionID === disabledMissionID,
  );
}

function isGeneratedMissionIdentifier(value) {
  const normalized = normalizeStableMissionIdentity(value);
  if (!/^-?\d+$/.test(normalized)) {
    return false;
  }
  const missionID = Number.parseInt(normalized, 10);
  return missionID >= productionMissionPolicy.generatedMissionIDRange.minInclusive &&
    missionID < productionMissionPolicy.generatedMissionIDRange.maxExclusive;
}

function isDisabledMissionTemplateIdentifier(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return Boolean(normalized) && disabledMissionTemplateIdentifiers.has(normalized);
}

function isDisabledMissionSourceURL(value) {
  const normalized = String(value == null ? "" : value).trim();
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized, "https://eve-survival.org/");
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname !== "eve-survival.org" && hostname !== "www.eve-survival.org") {
      return false;
    }
    for (const [key, queryValue] of parsed.searchParams.entries()) {
      if (
        key.toLowerCase() === "wakka" &&
        isDisabledMissionTemplateIdentifier(queryValue)
      ) {
        return true;
      }
    }
  } catch (_error) {
    return false;
  }
  return false;
}

function isRetiredMissionTemplateIdentifier(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return isDisabledMissionTemplateIdentifier(normalized) ||
    isDisabledMissionSourceURL(normalized) ||
    productionMissionPolicy.retiredTemplatePrefixes.some((prefix) =>
      normalized.startsWith(prefix)) ||
    isDisabledMissionIdentifier(normalized) ||
    isGeneratedMissionIdentifier(normalized);
}

module.exports = {
  isDisabledMissionIdentifier,
  isDisabledMissionSourceURL,
  isDisabledMissionTemplateIdentifier,
  isGeneratedMissionIdentifier,
  isRetiredMissionTemplateIdentifier,
  normalizeStableMissionIdentity,
  productionMissionPolicy,
  validateProductionMissionPolicy,
};
