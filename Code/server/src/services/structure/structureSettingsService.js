const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildDict,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  buildAccessibleStructureServices,
  characterHasStructureService,
  characterHasStructureSetting,
} = require(path.join(__dirname, "./structurePayloads"));
const {
  STRUCTURE_SETTING_ID,
  getStructureSettingAccessErrorLabel,
  getStructureServiceAccessSettingID,
} = require(path.join(__dirname, "./structureServiceAuthority"));
const {
  getProfileSettingValueForStructure,
} = require(path.join(__dirname, "./structureProfilesState"));

class StructureSettingsService extends BaseService {
  constructor() {
    super("structureSettings");
  }

  Handle_CharacterGetServices(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structure = structureState.getStructureByID(structureID);
    const services = buildAccessibleStructureServices(structure, session);
    return buildDict(
      Object.entries(services)
        .map(([serviceID, stateID]) => [Number(serviceID) || 0, stateID])
        .filter(([serviceID]) => serviceID > 0)
        .sort((left, right) => left[0] - right[0]),
    );
  }

  Handle_CharacterHasService(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const serviceID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const structure = structureState.getStructureByID(structureID);
    return characterHasStructureService(session, structure, serviceID);
  }

  Handle_CharacterGetService(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const serviceID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const structure = structureState.getStructureByID(structureID);
    if (!characterHasStructureService(session, structure, serviceID)) {
      return null;
    }

    const settingID = getStructureServiceAccessSettingID(serviceID);
    if (!settingID || settingID === STRUCTURE_SETTING_ID.NONE) {
      return true;
    }

    const value = getProfileSettingValueForStructure(structure, settingID, {
      session,
    });
    return value === undefined || value === null ? true : value;
  }

  Handle_CharacterCheckService(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const serviceID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const structure = structureState.getStructureByID(structureID);
    if (characterHasStructureService(session, structure, serviceID)) {
      return true;
    }

    const settingID = getStructureServiceAccessSettingID(serviceID);
    throwWrappedUserError(getStructureSettingAccessErrorLabel(settingID));
  }

  Handle_CharacterHasSetting(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const settingID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const structure = structureState.getStructureByID(structureID);
    return characterHasStructureSetting(session, structure, settingID);
  }
}

module.exports = StructureSettingsService;
