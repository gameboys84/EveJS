const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const accessGroupStore = require(path.join(__dirname, "../character/accessGroupStore"));
const {
  getCharacterRecord,
  listCharacterIDs,
} = require(path.join(__dirname, "../character/characterState"));
const {
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const {
  STRUCTURE_SETTING_ID,
} = require(path.join(__dirname, "./structureServiceAuthority"));
const structureState = require(path.join(__dirname, "./structureState"));

const TABLE_NAME = "structureProfiles";
const ROOT_VERSION = 1;
const DEFAULT_PROFILE_NAME = "Default Profile";
const DEFAULT_PROFILE_DESCRIPTION = "";

let cachedRoot = null;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function normalizeProfileName(value, fallback = DEFAULT_PROFILE_NAME) {
  const text = normalizeText(value, fallback).trim();
  return text.length > 0 ? text.slice(0, 30) : fallback;
}

function normalizeProfileDescription(value, fallback = DEFAULT_PROFILE_DESCRIPTION) {
  return normalizeText(value, fallback).trim().slice(0, 200);
}

function normalizeSettingValue(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "") {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : trimmed;
    }
    return "";
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compareProfileSettings(left, right) {
  const leftGroupID = toInt(left && left.groupID, 0);
  const rightGroupID = toInt(right && right.groupID, 0);
  if (leftGroupID !== rightGroupID) {
    return leftGroupID - rightGroupID;
  }
  return String(left && left.value).localeCompare(String(right && right.value));
}

function normalizeProfileSettingsBySettingID(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized = {};
  for (const [rawSettingID, rawEntries] of Object.entries(value)) {
    const settingID = toPositiveInt(rawSettingID, 0);
    if (!settingID) {
      continue;
    }

    const groupsByGroupID = new Map();
    for (const rawEntry of Array.isArray(rawEntries) ? rawEntries : []) {
      if (!rawEntry || typeof rawEntry !== "object") {
        continue;
      }
      const groupID = toInt(rawEntry.groupID, 0);
      groupsByGroupID.set(groupID, {
        groupID,
        value: normalizeSettingValue(rawEntry.value),
      });
    }

    normalized[String(settingID)] = [...groupsByGroupID.values()].sort(compareProfileSettings);
  }
  return normalized;
}

function buildDefaultRoot() {
  return {
    meta: {
      version: ROOT_VERSION,
      description: "DB-backed corporation structure deployment/access profile state.",
      updatedAt: null,
    },
    nextProfileID: 1,
    profilesByID: {},
  };
}

function normalizeProfileRecord(profile = {}) {
  const profileID = toPositiveInt(profile.profileID, 0);
  const corporationID = toPositiveInt(profile.corporationID, 0);
  if (!profileID || !corporationID) {
    return null;
  }

  return {
    profileID,
    corporationID,
    name: normalizeProfileName(profile.name),
    description: normalizeProfileDescription(profile.description),
    isDefault: profile.isDefault === true,
    settingsBySettingID: normalizeProfileSettingsBySettingID(profile.settingsBySettingID),
    createdAt: normalizeText(profile.createdAt, null),
    updatedAt: normalizeText(profile.updatedAt, null),
  };
}

function normalizeRoot(rawValue) {
  const next = buildDefaultRoot();
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};

  if (source.meta && typeof source.meta === "object") {
    next.meta = {
      ...next.meta,
      ...cloneValue(source.meta),
      version: ROOT_VERSION,
    };
  }

  const profilesByID = {};
  let highestProfileID = 0;
  if (source.profilesByID && typeof source.profilesByID === "object") {
    for (const rawProfile of Object.values(source.profilesByID)) {
      const profile = normalizeProfileRecord(rawProfile);
      if (!profile) {
        continue;
      }
      profilesByID[String(profile.profileID)] = profile;
      highestProfileID = Math.max(highestProfileID, profile.profileID);
    }
  }

  next.profilesByID = profilesByID;
  next.nextProfileID = Math.max(
    toPositiveInt(source.nextProfileID, 1),
    highestProfileID + 1,
    1,
  );
  return next;
}

function readRoot() {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return buildDefaultRoot();
  }
  return normalizeRoot(result.data);
}

function writeRoot(root) {
  const next = normalizeRoot(root);
  next.meta.updatedAt = new Date().toISOString();
  const result = database.write(TABLE_NAME, "/", next);
  if (!result.success) {
    return false;
  }
  cachedRoot = next;
  return true;
}

function ensureRoot() {
  if (!cachedRoot) {
    cachedRoot = readRoot();
  }
  return cachedRoot;
}

function getCorporationIDForSession(session) {
  return toPositiveInt(
    session &&
      (
        session.corporationID ||
        session.corpid
      ),
    0,
  );
}

function getCharacterIDForSession(session) {
  return toPositiveInt(
    session &&
      (
        session.characterID ||
        session.charid
      ),
    0,
  );
}

function getAllianceIDForSession(session) {
  return toPositiveInt(
    session &&
      (
        session.allianceID ||
        session.allianceid
      ),
    0,
  );
}

function normalizeGroupIDList(values = []) {
  const normalized = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const groupID = toPositiveInt(value, 0);
    if (groupID > 0 && !normalized.includes(groupID)) {
      normalized.push(groupID);
    }
  }
  return normalized;
}

function findProfileSettingGroup(settingGroups, groupID) {
  const numericGroupID = toInt(groupID, 0);
  return settingGroups.find((entry) => (
    entry && toInt(entry.groupID, 0) === numericGroupID
  ));
}

function getMembershipRank(membershipType) {
  switch (toInt(membershipType, accessGroupStore.MEMBERSHIP_TYPE_NONE)) {
    case accessGroupStore.MEMBERSHIP_TYPE_ADMIN:
    case accessGroupStore.MEMBERSHIP_TYPE_MANAGER:
    case accessGroupStore.MEMBERSHIP_TYPE_MEMBER:
      return 30;
    default:
      return 0;
  }
}

function getAccessGroupMatchRank(groupID, session) {
  const numericGroupID = toPositiveInt(groupID, 0);
  const numericCharacterID = getCharacterIDForSession(session);
  if (!numericGroupID || !numericCharacterID) {
    return 0;
  }

  const members = accessGroupStore.getMembers(numericGroupID);
  const directMember = members.find((entry) => (
    entry && toInt(entry.memberID, -1) === numericCharacterID
  ));
  if (directMember) {
    const membershipType = toInt(
      directMember.membershipType,
      accessGroupStore.MEMBERSHIP_TYPE_NONE,
    );
    if (membershipType === accessGroupStore.MEMBERSHIP_TYPE_EXCLUDED) {
      return 0;
    }
    const membershipRank = getMembershipRank(membershipType);
    return membershipRank > 0
      ? 400 + membershipRank
      : 0;
  }

  const group = accessGroupStore.getGroup(numericGroupID);
  if (
    group &&
    toPositiveInt(group.creatorID, 0) === numericCharacterID
  ) {
    return 400 + getMembershipRank(accessGroupStore.MEMBERSHIP_TYPE_ADMIN);
  }

  const ownerCandidates = [
    { memberID: getCorporationIDForSession(session), specificityRank: 300 },
    { memberID: getAllianceIDForSession(session), specificityRank: 200 },
    { memberID: 0, specificityRank: 100 },
  ].filter((entry) => entry.memberID > 0 || entry.memberID === 0);

  for (const candidate of ownerCandidates) {
    const member = members.find((entry) => (
      entry && toInt(entry.memberID, -1) === candidate.memberID
    ));
    if (!member) {
      continue;
    }
    const membershipType = toInt(
      member.membershipType,
      accessGroupStore.MEMBERSHIP_TYPE_NONE,
    );
    if (membershipType === accessGroupStore.MEMBERSHIP_TYPE_EXCLUDED) {
      return 0;
    }
    const membershipRank = getMembershipRank(membershipType);
    return membershipRank > 0
      ? candidate.specificityRank + membershipRank
      : 0;
  }

  return 0;
}

function resolveProfileSettingGroupForSession(settingGroups, session) {
  const characterID = getCharacterIDForSession(session);
  if (!characterID) {
    return null;
  }

  let bestMatch = null;
  let bestRank = 0;
  for (const entry of settingGroups) {
    const groupID = toPositiveInt(entry && entry.groupID, 0);
    if (!groupID) {
      continue;
    }
    const rank = getAccessGroupMatchRank(groupID, session);
    if (rank > bestRank) {
      bestRank = rank;
      bestMatch = entry;
    }
  }
  return bestMatch;
}

function resolveProfileSettingGroup(settingGroups, options = {}) {
  const hasSessionLookup = Boolean(options && options.session);
  const groupIDs = normalizeGroupIDList([
    ...(options && Object.prototype.hasOwnProperty.call(options, "groupID")
      ? [options.groupID]
      : []),
    ...(options ? normalizeGroupIDList(options.groupIDs) : []),
  ]);
  const hasGroupedLookup = hasSessionLookup || groupIDs.length > 0;

  if (!hasGroupedLookup) {
    return findProfileSettingGroup(
      settingGroups,
      options && Object.prototype.hasOwnProperty.call(options, "groupID")
        ? options.groupID
        : 0,
    );
  }

  for (const groupID of groupIDs) {
    const matchingGroup = findProfileSettingGroup(settingGroups, groupID);
    if (matchingGroup) {
      return matchingGroup;
    }
  }

  const sessionGroup = resolveProfileSettingGroupForSession(settingGroups, options.session);
  if (sessionGroup) {
    return sessionGroup;
  }

  return findProfileSettingGroup(settingGroups, 0);
}

function listProfileRecordsForCorporation(root, corporationID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  return Object.values(root.profilesByID)
    .filter((profile) => profile && profile.corporationID === numericCorporationID);
}

function profileHasAnySettingRows(profile) {
  const settingsBySettingID =
    profile && profile.settingsBySettingID && typeof profile.settingsBySettingID === "object"
      ? profile.settingsBySettingID
      : {};
  return Object.values(settingsBySettingID)
    .some((groups) => Array.isArray(groups) && groups.length > 0);
}

function compareProfiles(left, right) {
  if ((left && left.isDefault) !== (right && right.isDefault)) {
    return left && left.isDefault ? -1 : 1;
  }
  const nameComparison = String(left && left.name || "").localeCompare(
    String(right && right.name || ""),
    undefined,
    { sensitivity: "base" },
  );
  if (nameComparison !== 0) {
    return nameComparison;
  }
  return toPositiveInt(left && left.profileID, 0) - toPositiveInt(right && right.profileID, 0);
}

function clearDefaultFlagForCorporation(root, corporationID) {
  for (const profile of Object.values(root.profilesByID)) {
    if (!profile || profile.corporationID !== corporationID) {
      continue;
    }
    profile.isDefault = false;
  }
}

function allocateProfileID(root) {
  const profileID = Math.max(toPositiveInt(root.nextProfileID, 1), 1);
  root.nextProfileID = profileID + 1;
  return profileID;
}

function buildUniqueProfileName(root, corporationID, requestedName, ignoreProfileID = 0) {
  const baseName = normalizeProfileName(requestedName);
  const takenNames = new Set(
    listProfileRecordsForCorporation(root, corporationID)
      .filter((profile) => profile.profileID !== ignoreProfileID)
      .map((profile) => String(profile.name || "").trim().toLowerCase()),
  );

  if (!takenNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = normalizeProfileName(`${baseName} ${suffix}`, baseName);
    if (!takenNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffix += 1;
  }

  return baseName;
}

function createProfileRecord(root, corporationID, options = {}) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return null;
  }

  const profileID = allocateProfileID(root);
  const isDefault = options.isDefault === true;
  if (isDefault) {
    clearDefaultFlagForCorporation(root, numericCorporationID);
  }

  const now = new Date().toISOString();
  const profile = {
    profileID,
    corporationID: numericCorporationID,
    name: buildUniqueProfileName(
      root,
      numericCorporationID,
      options.name || DEFAULT_PROFILE_NAME,
    ),
    description: normalizeProfileDescription(options.description),
    isDefault,
    settingsBySettingID: normalizeProfileSettingsBySettingID(options.settingsBySettingID),
    createdAt: now,
    updatedAt: now,
  };
  root.profilesByID[String(profileID)] = profile;
  return profile;
}

function ensureCorporationDefaultProfile(corporationID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return null;
  }

  const root = ensureRoot();
  const profiles = listProfileRecordsForCorporation(root, numericCorporationID);
  if (profiles.length === 0) {
    const createdProfile = createProfileRecord(root, numericCorporationID, {
      name: DEFAULT_PROFILE_NAME,
      description: DEFAULT_PROFILE_DESCRIPTION,
      isDefault: true,
    });
    writeRoot(root);
    return cloneValue(createdProfile);
  }

  const defaultProfiles = profiles.filter((profile) => profile.isDefault === true);
  if (defaultProfiles.length === 1) {
    return cloneValue(defaultProfiles[0]);
  }

  const nextDefault = [...profiles].sort(compareProfiles)[0];
  clearDefaultFlagForCorporation(root, numericCorporationID);
  nextDefault.isDefault = true;
  nextDefault.updatedAt = new Date().toISOString();
  writeRoot(root);
  return cloneValue(nextDefault);
}

function listProfilesForCorporation(corporationID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return [];
  }

  ensureCorporationDefaultProfile(numericCorporationID);
  return listProfileRecordsForCorporation(ensureRoot(), numericCorporationID)
    .sort(compareProfiles)
    .map((profile) => cloneValue(profile));
}

function getProfileForCorporation(corporationID, profileID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  ensureCorporationDefaultProfile(numericCorporationID);
  const profile = ensureRoot().profilesByID[String(numericProfileID)];
  if (!profile || profile.corporationID !== numericCorporationID) {
    return null;
  }
  return cloneValue(profile);
}

function resolveUsableProfileIDForCorporation(corporationID, requestedProfileID = null) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return 1;
  }

  const numericRequestedProfileID = toPositiveInt(requestedProfileID, 0);
  if (numericRequestedProfileID > 0) {
    const requestedProfile = getProfileForCorporation(
      numericCorporationID,
      numericRequestedProfileID,
    );
    if (requestedProfile) {
      return requestedProfile.profileID;
    }
  }

  const defaultProfile = ensureCorporationDefaultProfile(numericCorporationID);
  return toPositiveInt(defaultProfile && defaultProfile.profileID, 1) || 1;
}

function createProfileForCorporation(corporationID, name, description) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  if (!numericCorporationID) {
    return null;
  }

  ensureCorporationDefaultProfile(numericCorporationID);
  const root = ensureRoot();
  const createdProfile = createProfileRecord(root, numericCorporationID, {
    name,
    description,
    isDefault: false,
  });
  if (!createdProfile) {
    return null;
  }
  writeRoot(root);
  return cloneValue(createdProfile);
}

function updateProfileForCorporation(corporationID, profileID, updates = {}) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  const root = ensureRoot();
  const profile = root.profilesByID[String(numericProfileID)];
  if (!profile || profile.corporationID !== numericCorporationID) {
    return null;
  }

  profile.name = buildUniqueProfileName(
    root,
    numericCorporationID,
    updates.name || profile.name,
    profile.profileID,
  );
  profile.description = normalizeProfileDescription(
    updates.description,
    profile.description,
  );
  profile.updatedAt = new Date().toISOString();
  writeRoot(root);
  return cloneValue(profile);
}

function duplicateProfileForCorporation(corporationID, profileID) {
  const sourceProfile = getProfileForCorporation(corporationID, profileID);
  if (!sourceProfile) {
    return null;
  }

  const root = ensureRoot();
  const duplicatedProfile = createProfileRecord(root, corporationID, {
    name: `${sourceProfile.name} Copy`,
    description: sourceProfile.description,
    settingsBySettingID: cloneValue(sourceProfile.settingsBySettingID),
    isDefault: false,
  });
  if (!duplicatedProfile) {
    return null;
  }
  writeRoot(root);
  return cloneValue(duplicatedProfile);
}

function setDefaultProfileForCorporation(corporationID, profileID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  const root = ensureRoot();
  const targetProfile = root.profilesByID[String(numericProfileID)];
  if (!targetProfile || targetProfile.corporationID !== numericCorporationID) {
    return null;
  }

  clearDefaultFlagForCorporation(root, numericCorporationID);
  targetProfile.isDefault = true;
  targetProfile.updatedAt = new Date().toISOString();
  writeRoot(root);
  return cloneValue(targetProfile);
}

function deleteProfileForCorporation(corporationID, profileID) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return false;
  }

  const root = ensureRoot();
  const targetProfile = root.profilesByID[String(numericProfileID)];
  if (!targetProfile || targetProfile.corporationID !== numericCorporationID) {
    return false;
  }

  delete root.profilesByID[String(numericProfileID)];
  const remainingProfiles = listProfileRecordsForCorporation(root, numericCorporationID)
    .sort(compareProfiles);
  if (remainingProfiles.length === 0) {
    createProfileRecord(root, numericCorporationID, {
      name: DEFAULT_PROFILE_NAME,
      description: DEFAULT_PROFILE_DESCRIPTION,
      isDefault: true,
    });
  } else if (targetProfile.isDefault) {
    clearDefaultFlagForCorporation(root, numericCorporationID);
    remainingProfiles[0].isDefault = true;
    remainingProfiles[0].updatedAt = new Date().toISOString();
  }
  return writeRoot(root);
}

function normalizeSavedProfileSettings(value) {
  const normalized = {};
  for (const rawEntry of Array.isArray(value) ? value : []) {
    const entry = Array.isArray(rawEntry)
      ? rawEntry
      : rawEntry && typeof rawEntry === "object"
        ? [
          rawEntry.settingID,
          rawEntry.value,
          rawEntry.groupID,
        ]
        : [];
    const settingID = toPositiveInt(entry[0], 0);
    if (!settingID) {
      continue;
    }

    const groupID = toInt(entry[2], 0);
    if (!normalized[String(settingID)]) {
      normalized[String(settingID)] = [];
    }
    normalized[String(settingID)].push({
      groupID,
      value: normalizeSettingValue(entry[1]),
    });
  }
  return normalizeProfileSettingsBySettingID(normalized);
}

function saveProfileSettingsForCorporation(corporationID, profileID, settings = []) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const numericProfileID = toPositiveInt(profileID, 0);
  if (!numericCorporationID || !numericProfileID) {
    return null;
  }

  const root = ensureRoot();
  const profile = root.profilesByID[String(numericProfileID)];
  if (!profile || profile.corporationID !== numericCorporationID) {
    return null;
  }

  const affectedStructures = structureState.listOwnedStructures(numericCorporationID, {
    refresh: false,
  }).filter((structure) => {
    const context = getProfileContextForStructure(structure);
    return toPositiveInt(context.profile && context.profile.profileID, 0) === numericProfileID;
  });
  const dockingAccessSnapshot = snapshotDockingAccessForStructures(affectedStructures);
  profile.settingsBySettingID = normalizeSavedProfileSettings(settings);
  profile.updatedAt = new Date().toISOString();
  writeRoot(root);
  notifyLostDockingAccessFromSnapshot(dockingAccessSnapshot, affectedStructures);
  return cloneValue(profile);
}

function assignProfileToStructuresForCorporation(corporationID, profileID, structureIDs = []) {
  const numericCorporationID = toPositiveInt(corporationID, 0);
  const resolvedProfileID = resolveUsableProfileIDForCorporation(
    numericCorporationID,
    profileID,
  );
  const normalizedStructureIDs = [...new Set(
    (Array.isArray(structureIDs) ? structureIDs : [])
      .map((structureID) => toPositiveInt(structureID, 0))
      .filter((structureID) => structureID > 0),
  )];

  const updatedStructureIDs = [];
  const affectedStructures = normalizedStructureIDs
    .map((structureID) => structureState.getStructureByID(structureID, {
      refresh: false,
    }))
    .filter((structure) => (
      structure &&
      toPositiveInt(structure.ownerCorpID || structure.ownerID, 0) === numericCorporationID
    ));
  const dockingAccessSnapshot = snapshotDockingAccessForStructures(affectedStructures);
  const updatedStructures = [];
  for (const structureID of normalizedStructureIDs) {
    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (
      !structure ||
      toPositiveInt(structure.ownerCorpID || structure.ownerID, 0) !== numericCorporationID
    ) {
      continue;
    }
    const updateResult = structureState.updateStructureRecord(structureID, (current) => ({
      ...current,
      profileID: resolvedProfileID,
    }));
    if (updateResult && updateResult.success) {
      updatedStructureIDs.push(structureID);
      updatedStructures.push(updateResult.data);
    }
  }
  notifyLostDockingAccessFromSnapshot(dockingAccessSnapshot, updatedStructures);

  return {
    profileID: resolvedProfileID,
    structureIDs: updatedStructureIDs,
  };
}

function getProfileContextForStructure(structure) {
  if (!structure) {
    return {
      ownerCorpID: 0,
      requestedProfileID: 0,
      profile: null,
      corporationProfiles: [],
    };
  }

  const ownerCorpID = toPositiveInt(structure.ownerCorpID || structure.ownerID, 0);
  if (!ownerCorpID) {
    return {
      ownerCorpID: 0,
      requestedProfileID: 0,
      profile: null,
      corporationProfiles: [],
    };
  }

  const root = ensureRoot();
  const requestedProfileID = toPositiveInt(structure.profileID, 0);
  const corporationProfiles = listProfileRecordsForCorporation(root, ownerCorpID);
  let profile = requestedProfileID > 0
    ? root.profilesByID[String(requestedProfileID)]
    : null;
  if (!profile || profile.corporationID !== ownerCorpID) {
    profile = corporationProfiles
      .find((candidate) => candidate && candidate.isDefault === true);
  }
  return {
    ownerCorpID,
    requestedProfileID,
    profile: profile || null,
    corporationProfiles,
  };
}

function getProfileForStructure(structure) {
  return getProfileContextForStructure(structure).profile;
}

function buildStructureBaseNotificationData(structure) {
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  const structureTypeID = toPositiveInt(structure && structure.typeID, 0);
  return {
    structureID,
    structureShowInfoData: ["showinfo", structureTypeID, structureID],
    solarsystemID: toPositiveInt(structure && structure.solarSystemID, 0),
    structureTypeID,
  };
}

function buildCharacterStructureAccessSession(characterID) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (!numericCharacterID) {
    return null;
  }
  const character = getCharacterRecord(numericCharacterID);
  if (!character) {
    return null;
  }
  const corporationID = toPositiveInt(
    character.corporationID || character.corpid || character.corpID,
    0,
  );
  return {
    characterID: numericCharacterID,
    charid: numericCharacterID,
    corporationID,
    corpid: corporationID,
    allianceID: toPositiveInt(character.allianceID || character.allianceid, 0),
    allianceid: toPositiveInt(character.allianceID || character.allianceid, 0),
    shipTypeID: toPositiveInt(character.shipTypeID || character.activeShipTypeID, 0),
  };
}

function collectStructureAssetCharacterIDs(structure) {
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  if (!structureID) {
    return [];
  }
  const characterIDs = new Set();
  for (const item of listContainerItems(null, structureID, null)) {
    const ownerID = toPositiveInt(item && item.ownerID, 0);
    if (ownerID > 0 && getCharacterRecord(ownerID)) {
      characterIDs.add(ownerID);
    }
  }
  for (const characterID of listCharacterIDs()) {
    const character = getCharacterRecord(characterID);
    const hasCloneAtStructure = (Array.isArray(character && character.jumpClones)
      ? character.jumpClones
      : []
    ).some((clone) => toPositiveInt(clone && clone.locationID, 0) === structureID);
    if (hasCloneAtStructure) {
      characterIDs.add(toPositiveInt(characterID, 0));
    }
  }
  return [...characterIDs].filter(Boolean).sort((left, right) => left - right);
}

function characterHasDockingAccessForProfile(structure, session) {
  if (!structure || !session) {
    return false;
  }
  const dockResult = structureState.canCharacterDockAtStructure(session, structure, {
    shipTypeID: toPositiveInt(session.shipTypeID, 0) || undefined,
  });
  if (!dockResult || dockResult.success !== true) {
    return false;
  }
  return structureProfileSettingAllowsSession(
    structure,
    STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
    { session },
  );
}

function snapshotDockingAccessForStructures(structures) {
  const snapshot = new Map();
  for (const structure of Array.isArray(structures) ? structures : []) {
    const structureID = toPositiveInt(structure && structure.structureID, 0);
    if (!structureID) {
      continue;
    }
    const characterIDs = collectStructureAssetCharacterIDs(structure)
      .filter((characterID) => {
        const session = buildCharacterStructureAccessSession(characterID);
        return characterHasDockingAccessForProfile(structure, session);
      });
    snapshot.set(structureID, {
      structure: cloneValue(structure),
      characterIDs,
    });
  }
  return snapshot;
}

function createStructureLostDockingAccessNotification(characterID, structure) {
  const notificationTypeID = NOTIFICATION_TYPE.STRUCTURE_LOST_DOCKING_ACCESS;
  if (!notificationTypeID || !characterID || !structure) {
    return;
  }
  createNotification(characterID, {
    typeID: notificationTypeID,
    senderID: toPositiveInt(structure.ownerCorpID || structure.ownerID, 0),
    groupID: NOTIFICATION_GROUP.STRUCTURES,
    processed: false,
    data: buildStructureBaseNotificationData(structure),
    emitLive: false,
  });
}

function notifyLostDockingAccessFromSnapshot(accessSnapshot, nextStructures) {
  if (!(accessSnapshot instanceof Map) || accessSnapshot.size <= 0) {
    return;
  }
  for (const nextStructure of Array.isArray(nextStructures) ? nextStructures : []) {
    const structureID = toPositiveInt(nextStructure && nextStructure.structureID, 0);
    const previous = accessSnapshot.get(structureID);
    if (!previous || !Array.isArray(previous.characterIDs)) {
      continue;
    }
    for (const characterID of previous.characterIDs) {
      const session = buildCharacterStructureAccessSession(characterID);
      if (characterHasDockingAccessForProfile(nextStructure, session)) {
        continue;
      }
      createStructureLostDockingAccessNotification(characterID, nextStructure);
    }
  }
}

function isDefaultOwnerCorporationFallback(context) {
  const profile = context && context.profile;
  const corporationProfiles = Array.isArray(context && context.corporationProfiles)
    ? context.corporationProfiles
    : [];
  if (!profile) {
    return corporationProfiles.length === 0 && toPositiveInt(context && context.requestedProfileID, 0) > 0;
  }
  return (
    corporationProfiles.length === 1 &&
    profile.isDefault === true &&
    String(profile.name || "") === DEFAULT_PROFILE_NAME &&
    String(profile.description || "") === DEFAULT_PROFILE_DESCRIPTION &&
    !profileHasAnySettingRows(profile)
  );
}

function sessionHasDefaultOwnerCorporationAccess(structure, session) {
  if (structureState.hasStructureGmBypass(session)) {
    return true;
  }
  const ownerCorpID = toPositiveInt(structure && (structure.ownerCorpID || structure.ownerID), 0);
  const sessionCorpID = getCorporationIDForSession(session);
  return ownerCorpID > 0 && sessionCorpID > 0 && ownerCorpID === sessionCorpID;
}

function hasExplicitStructureProfile(context) {
  return Boolean(
    context &&
    context.profile &&
    toPositiveInt(context.requestedProfileID, 0) > 0,
  );
}

function getProfileSettingResolutionForStructure(structure, settingID, options = {}) {
  const normalizedSettingID = toPositiveInt(settingID, 0);
  const defaultValue = Object.prototype.hasOwnProperty.call(options, "defaultValue")
    ? options.defaultValue
    : null;
  const emptyResolution = {
    configured: false,
    matched: false,
    groupID: null,
    value: defaultValue,
    defaultOwnerCorporationFallback: false,
  };
  if (!structure || !normalizedSettingID) {
    return emptyResolution;
  }

  const context = getProfileContextForStructure(structure);
  const profile = context.profile;
  if (!profile) {
    if (isDefaultOwnerCorporationFallback(context)) {
      return {
        ...emptyResolution,
        configured: true,
        matched: sessionHasDefaultOwnerCorporationAccess(structure, options.session),
        defaultOwnerCorporationFallback: true,
      };
    }
    return emptyResolution;
  }

  const settingGroups = profile.settingsBySettingID[String(normalizedSettingID)];
  if (!Array.isArray(settingGroups) || settingGroups.length === 0) {
    if (isDefaultOwnerCorporationFallback(context)) {
      return {
        ...emptyResolution,
        configured: true,
        matched: sessionHasDefaultOwnerCorporationAccess(structure, options.session),
        defaultOwnerCorporationFallback: true,
      };
    }
    if (hasExplicitStructureProfile(context)) {
      return {
        ...emptyResolution,
        configured: true,
      };
    }
    return emptyResolution;
  }

  const matchingGroup = resolveProfileSettingGroup(settingGroups, options);
  if (!matchingGroup) {
    return {
      ...emptyResolution,
      configured: true,
    };
  }

  return {
    configured: true,
    matched: true,
    groupID: toInt(matchingGroup.groupID, 0),
    value: normalizeSettingValue(matchingGroup.value),
  };
}

function structureProfileSettingAllowsSession(structure, settingID, options = {}) {
  const resolution = getProfileSettingResolutionForStructure(structure, settingID, options);
  return !resolution.configured || resolution.matched;
}

function getProfileSettingValueForStructure(structure, settingID, options = {}) {
  const resolution = getProfileSettingResolutionForStructure(structure, settingID, options);
  return resolution.value;
}

function resetStructureProfilesStateForTests() {
  cachedRoot = null;
}

module.exports = {
  DEFAULT_PROFILE_NAME,
  DEFAULT_PROFILE_DESCRIPTION,
  getCorporationIDForSession,
  listProfilesForCorporation,
  getProfileForCorporation,
  ensureCorporationDefaultProfile,
  resolveUsableProfileIDForCorporation,
  createProfileForCorporation,
  updateProfileForCorporation,
  duplicateProfileForCorporation,
  setDefaultProfileForCorporation,
  deleteProfileForCorporation,
  saveProfileSettingsForCorporation,
  assignProfileToStructuresForCorporation,
  getProfileSettingResolutionForStructure,
  structureProfileSettingAllowsSession,
  getProfileSettingValueForStructure,
  resetStructureProfilesStateForTests,
};
