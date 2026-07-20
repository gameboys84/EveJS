const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  buildDict,
  buildKeyVal,
  buildList,
  extractList,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  assignProfileToStructuresForCorporation,
  createProfileForCorporation,
  deleteProfileForCorporation,
  duplicateProfileForCorporation,
  ensureCorporationDefaultProfile,
  getCorporationIDForSession,
  getProfileForCorporation,
  listProfilesForCorporation,
  saveProfileSettingsForCorporation,
  setDefaultProfileForCorporation,
  updateProfileForCorporation,
} = require(path.join(__dirname, "./structureProfilesState"));
const {
  CORP_ROLE_STATION_MANAGER,
  buildCrpAccessDeniedInsufficientRolesValues,
} = require(path.join(__dirname, "./structureServiceAuthority"));

function uniquePositiveIntegers(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => Number(value) || 0)
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function normalizeArgs(args) {
  return Array.isArray(args)
    ? args.map((entry) => unwrapMarshalValue(entry))
    : [];
}

function normalizeRoleMask(value) {
  if (typeof value === "bigint") {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch (_error) {
    return 0n;
  }
}

function canManageStructureProfiles(session) {
  const roleMask = normalizeRoleMask(
    session && (session.corprole ?? session.corpRole ?? session.rolesAtAll),
  );
  return (roleMask & CORP_ROLE_STATION_MANAGER) === CORP_ROLE_STATION_MANAGER;
}

function throwStructureProfileAccessDenied() {
  throwWrappedUserError(
    "CrpAccessDenied",
    buildCrpAccessDeniedInsufficientRolesValues(),
  );
}

function requireStructureProfileManager(session) {
  if (!canManageStructureProfiles(session)) {
    throwStructureProfileAccessDenied();
  }
}

function buildProfilePayload(profile) {
  return buildKeyVal([
    ["profileID", Number(profile && profile.profileID || 0)],
    ["name", String(profile && profile.name || "")],
    ["description", String(profile && profile.description || "")],
    ["isDefault", profile && profile.isDefault === true],
  ]);
}

function buildProfileSettingsPayload(profile) {
  const settingsBySettingID =
    profile && profile.settingsBySettingID && typeof profile.settingsBySettingID === "object"
      ? profile.settingsBySettingID
      : {};
  return buildDict(
    Object.entries(settingsBySettingID)
      .map(([rawSettingID, groups]) => {
        const settingID = Number(rawSettingID) || 0;
        if (settingID <= 0) {
          return null;
        }
        return [
          settingID,
          buildList(
            (Array.isArray(groups) ? groups : []).map((group) => buildKeyVal([
              ["groupID", Number(group && group.groupID || 0)],
              ["value", group && Object.prototype.hasOwnProperty.call(group, "value")
                ? group.value
                : 0],
            ])),
          ),
        ];
      })
      .filter(Boolean)
      .sort((left, right) => left[0] - right[0]),
  );
}

function getCorporationProfileIDs(corporationID, extraProfileIDs = []) {
  return uniquePositiveIntegers([
    ...listProfilesForCorporation(corporationID)
      .map((profile) => profile && profile.profileID),
    ...extraProfileIDs,
  ]);
}

function notifyCorporationSessions(corporationID, notifyType, payload = []) {
  const numericCorporationID = Number(corporationID) || 0;
  if (!numericCorporationID || !notifyType) {
    return 0;
  }

  let sentCount = 0;
  for (const session of sessionRegistry.getSessions()) {
    if (
      getCorporationIDForSession(session) !== numericCorporationID ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }

    session.sendNotification(notifyType, "clientID", payload);
    sentCount += 1;
  }
  return sentCount;
}

function notifyProfileSettingsChanged(corporationID, profileIDs) {
  const normalizedProfileIDs = uniquePositiveIntegers(profileIDs);
  if (!normalizedProfileIDs.length) {
    return 0;
  }

  return notifyCorporationSessions(
    corporationID,
    "OnProfileSettingsChange",
    [buildList(normalizedProfileIDs)],
  );
}

function notifyCorporationStructuresUpdated(corporationID) {
  return notifyCorporationSessions(
    corporationID,
    "OnCorporationStructuresUpdated",
    [],
  );
}

class StructureProfilesService extends BaseService {
  constructor() {
    super("structureProfiles");
  }

  Handle_GetProfiles(args, session) {
    const corporationID = getCorporationIDForSession(session);
    if (corporationID <= 0) {
      return buildList([]);
    }
    requireStructureProfileManager(session);

    ensureCorporationDefaultProfile(corporationID);
    return buildList(
      listProfilesForCorporation(corporationID).map((profile) => buildProfilePayload(profile)),
    );
  }

  Handle_CreateProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const createdProfile = createProfileForCorporation(
      corporationID,
      normalizedArgs[0],
      normalizedArgs[1],
    );
    if (createdProfile) {
      notifyProfileSettingsChanged(corporationID, [createdProfile.profileID]);
    }
    return Number(createdProfile && createdProfile.profileID || 0) || null;
  }

  Handle_UpdateProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const updatedProfile = updateProfileForCorporation(corporationID, normalizedArgs[0], {
      name: normalizedArgs[1],
      description: normalizedArgs[2],
    });
    if (updatedProfile) {
      notifyProfileSettingsChanged(corporationID, [updatedProfile.profileID]);
    }
    return null;
  }

  Handle_GetProfileSettings(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const profile = getProfileForCorporation(corporationID, normalizedArgs[0]);
    return buildProfileSettingsPayload(profile);
  }

  Handle_SaveProfileSettings(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const savedProfile = saveProfileSettingsForCorporation(
      corporationID,
      normalizedArgs[0],
      extractList(normalizedArgs[1]),
    );
    if (savedProfile) {
      notifyProfileSettingsChanged(corporationID, [savedProfile.profileID]);
    }
    return null;
  }

  Handle_SetDefaultProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const updatedProfile = setDefaultProfileForCorporation(corporationID, normalizedArgs[0]);
    if (updatedProfile) {
      notifyProfileSettingsChanged(
        corporationID,
        getCorporationProfileIDs(corporationID, [updatedProfile.profileID]),
      );
    }
    return null;
  }

  Handle_ChangeProfiles(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const result = assignProfileToStructuresForCorporation(
      corporationID,
      normalizedArgs[1],
      extractList(normalizedArgs[0]),
    );
    if (result && Array.isArray(result.structureIDs) && result.structureIDs.length > 0) {
      notifyCorporationStructuresUpdated(corporationID);
    }
    return null;
  }

  Handle_DeleteProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const deletedProfileID = normalizedArgs[0];
    const didDelete = deleteProfileForCorporation(corporationID, deletedProfileID);
    if (didDelete) {
      notifyProfileSettingsChanged(
        corporationID,
        getCorporationProfileIDs(corporationID, [deletedProfileID]),
      );
    }
    return null;
  }

  Handle_DuplicateProfile(args, session) {
    const corporationID = getCorporationIDForSession(session);
    requireStructureProfileManager(session);
    const normalizedArgs = normalizeArgs(args);
    const duplicatedProfile = duplicateProfileForCorporation(
      corporationID,
      normalizedArgs[0],
    );
    if (duplicatedProfile) {
      notifyProfileSettingsChanged(corporationID, [duplicatedProfile.profileID]);
    }
    return Number(duplicatedProfile && duplicatedProfile.profileID || 0) || null;
  }
}

module.exports = StructureProfilesService;
