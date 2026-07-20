const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  extractList,
  buildList,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  TYPE_PHAROLUX_CYNO_BEACON,
  TYPE_ANSIBLEX_JUMP_BRIDGE,
} = require(path.join(__dirname, "../sovereignty/sovUpgradeSupport"));
const {
  isSolarSystemCynoJammed,
} = require(path.join(__dirname, "../sovereignty/sovSuppressionState"));
const {
  characterHasStructureService,
  buildIDList,
  buildBasicStructureInfoPayload,
  buildStructureInfoDict,
  buildStructureInfoPayload,
  buildStructureMapList,
} = require(path.join(__dirname, "./structurePayloads"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  CORP_ROLE_BRAND_MANAGER,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  findServiceProximityConflict,
} = require(path.join(__dirname, "./structureServiceProximity"));
const {
  CORP_ROLE_STATION_MANAGER,
  buildCrpAccessDeniedInsufficientRolesValues,
} = require(path.join(__dirname, "./structureServiceAuthority"));
const worldData = require(path.join(__dirname, "../../space/worldData"));

const MAX_STRUCTURE_BIO_LENGTH = 1000;

function buildWarHQPayload(structure) {
  return buildKeyVal([
    ["typeID", Number(structure && structure.typeID) || 0],
    ["structureID", Number(structure && (structure.structureID || structure.itemID)) || 0],
    ["upkeepState", Number(structure && structure.upkeepState) || 1],
    ["wars", buildList([])],
    ["ownerID", Number(structure && (structure.ownerCorpID || structure.ownerID)) || 0],
    ["solarSystemID", Number(structure && structure.solarSystemID) || 0],
    [
      "itemName",
      String(
        (structure && (structure.itemName || structure.name)) ||
          `Structure ${Number(structure && (structure.structureID || structure.itemID)) || 0}`,
      ),
    ],
    ["inSpace", structure && structure.inSpace === false ? 0 : 1],
  ]);
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeStructureDescription(value) {
  return normalizeText(value, "").slice(0, MAX_STRUCTURE_BIO_LENGTH);
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

function getCurrentSolarSystemID(session) {
  return normalizePositiveInt(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function getSessionCorporationID(session) {
  return normalizePositiveInt(
    session && (session.corpid || session.corporationID || session.corpID),
    0,
  );
}

function canManageStructure(session, structure) {
  const sessionCorpID = getSessionCorporationID(session);
  const structureOwnerCorpID = normalizePositiveInt(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
  if (!sessionCorpID || sessionCorpID !== structureOwnerCorpID) {
    return false;
  }
  const roleMask = normalizeRoleMask(
    session && (session.corprole ?? session.corpRole ?? session.rolesAtAll),
  );
  return (roleMask & CORP_ROLE_STATION_MANAGER) === CORP_ROLE_STATION_MANAGER;
}

function isStructureOwnerCorporationSession(session, structure) {
  const sessionCorpID = getSessionCorporationID(session);
  const structureOwnerCorpID = normalizePositiveInt(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
  return sessionCorpID > 0 && sessionCorpID === structureOwnerCorpID;
}

function canReadCorporationStructureDirectory(session) {
  if (!getSessionCorporationID(session)) {
    return false;
  }
  const roleMask = normalizeRoleMask(
    session && (session.corprole ?? session.corpRole ?? session.rolesAtAll),
  );
  const allowedRoles = CORP_ROLE_STATION_MANAGER | CORP_ROLE_BRAND_MANAGER;
  return (roleMask & allowedRoles) !== 0n;
}

function throwStructureManagementDenied() {
  throwWrappedUserError(
    "CrpAccessDenied",
    buildCrpAccessDeniedInsufficientRolesValues(),
  );
}

function listRequestedStructures(args, options = {}) {
  const ids = extractList(Array.isArray(args) && args.length > 0 ? args[0] : []);
  if (ids.length === 0) {
    return [];
  }

  return ids
    .map((structureID) => structureState.getStructureByID(structureID, {
      refresh: options.refresh !== false,
    }))
    .filter(Boolean);
}

function buildKeyVal(entries = []) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function buildCynoBeaconEntry(structure) {
  return buildList([
    normalizePositiveInt(structure && structure.structureID, 0),
    normalizePositiveInt(structure && structure.typeID, 0),
    normalizePositiveInt(structure && (structure.ownerCorpID || structure.ownerID), 0),
    normalizePositiveInt(structure && structure.solarSystemID, 0),
    normalizePositiveInt(structure && structure.state, 0),
    String(
      (structure && (structure.itemName || structure.name)) ||
        `Structure ${normalizePositiveInt(structure && structure.structureID, 0)}`,
    ),
  ]);
}

function isAnsiblexStructure(structure) {
  return Boolean(
    structure &&
      normalizePositiveInt(structure.typeID, 0) === TYPE_ANSIBLEX_JUMP_BRIDGE &&
      !structure.destroyedAt
  );
}

function isPharoluxStructure(structure) {
  return Boolean(
    structure &&
      normalizePositiveInt(structure.typeID, 0) === TYPE_PHAROLUX_CYNO_BEACON &&
      !structure.destroyedAt
  );
}

function isJumpBridgeServiceOnline(structure) {
  return Number(
    structure &&
      structure.serviceStates &&
      structure.serviceStates[String(STRUCTURE_SERVICE_ID.JUMP_BRIDGE)],
  ) === STRUCTURE_SERVICE_STATE.ONLINE;
}

function hasJumpBridgeServiceProximityConflict(structure, structures) {
  return Boolean(findServiceProximityConflict(
    structure,
    STRUCTURE_SERVICE_ID.JUMP_BRIDGE,
    structures,
  ));
}

function isJumpBridgeServiceAvailable(structure, structures) {
  return (
    isJumpBridgeServiceOnline(structure) &&
    !hasJumpBridgeServiceProximityConflict(structure, structures)
  );
}

function isHighSecurityStructure(structure) {
  const system = worldData.getSolarSystemByID(
    normalizePositiveInt(structure && structure.solarSystemID, 0),
  );
  const security = Number(system && system.security);
  return Number.isFinite(security) && security >= 0.45;
}

function isDockableUpwellWarHQStructure(structure) {
  if (!structure || structure.destroyedAt) {
    return false;
  }
  const typeRecord = structureState.getStructureTypeByID(structure.typeID);
  return Boolean(
    typeRecord &&
      normalizePositiveInt(typeRecord.categoryID, 0) === 65 &&
      typeRecord.dockable === true,
  );
}

function structureBelongsToOwnerID(structure, ownerID) {
  const normalizedOwnerID = normalizePositiveInt(ownerID, 0);
  if (!structure || !normalizedOwnerID) {
    return false;
  }
  return (
    normalizePositiveInt(structure.ownerCorpID || structure.ownerID, 0) ===
      normalizedOwnerID ||
    normalizePositiveInt(structure.allianceID, 0) === normalizedOwnerID
  );
}

function canRequestWarHQsForOwner(session, ownerID) {
  const normalizedOwnerID = normalizePositiveInt(ownerID, 0);
  if (!normalizedOwnerID) {
    return false;
  }
  return (
    normalizedOwnerID === getSessionCorporationID(session) ||
    normalizedOwnerID ===
      normalizePositiveInt(session && (session.allianceID || session.allianceid), 0)
  );
}

function getJumpBridgeDestinationSolarSystemID(structure) {
  const devFlags =
    structure && structure.devFlags && typeof structure.devFlags === "object"
      ? structure.devFlags
      : {};
  return normalizePositiveInt(
    devFlags.destinationSolarsystemID ||
      devFlags.sovereigntyJumpBridgeDestinationSolarsystemID,
    0,
  );
}

function buildJumpBridgeMapStructurePayload(structure) {
  const ownerID = normalizePositiveInt(
    structure && (structure.ownerCorpID || structure.ownerID),
    0,
  );
  const structureID = normalizePositiveInt(structure && structure.structureID, 0);
  const name = String(
    (structure && (structure.itemName || structure.name)) ||
      "Ansiblex Jump Bridge",
  );
  return buildKeyVal([
    ["structureID", structureID],
    ["itemID", structureID],
    ["typeID", normalizePositiveInt(structure && structure.typeID, 0)],
    ["solarSystemID", normalizePositiveInt(structure && structure.solarSystemID, 0)],
    ["ownerID", ownerID || null],
    ["corporationID", ownerID || null],
    ["allianceID", normalizePositiveInt(structure && structure.allianceID, 0) || null],
    ["itemName", name],
    ["structureName", name],
    ["destinationSolarsystemID", getJumpBridgeDestinationSolarSystemID(structure) || null],
  ]);
}

function findReciprocalJumpBridge(sourceStructure, structures) {
  if (!isAnsiblexStructure(sourceStructure)) {
    return null;
  }
  const sourceSolarSystemID = normalizePositiveInt(sourceStructure.solarSystemID, 0);
  const destinationSolarSystemID = getJumpBridgeDestinationSolarSystemID(sourceStructure);
  if (!sourceSolarSystemID || !destinationSolarSystemID) {
    return null;
  }
  return structures.find((candidate) => (
    isAnsiblexStructure(candidate) &&
      normalizePositiveInt(candidate.structureID, 0) !==
        normalizePositiveInt(sourceStructure.structureID, 0) &&
      normalizePositiveInt(candidate.solarSystemID, 0) === destinationSolarSystemID &&
      getJumpBridgeDestinationSolarSystemID(candidate) === sourceSolarSystemID
  )) || null;
}

function buildJumpBridgeAccessPayload(session) {
  const structures = structureState.listStructures({
    includeDestroyed: false,
    refresh: false,
  });
  const ansiblexStructures = structures.filter(isAnsiblexStructure);
  const sortedStructures = [...ansiblexStructures].sort(
    (left, right) =>
      normalizePositiveInt(left && left.structureID, 0) -
        normalizePositiveInt(right && right.structureID, 0),
  );
  const seenPairKeys = new Set();
  const pairs = [];
  const hasAccessTo = [];
  const hasNoAccessTo = [];

  for (const sourceStructure of sortedStructures) {
    if (!isJumpBridgeServiceAvailable(sourceStructure, structures)) {
      continue;
    }
    const destinationStructure = findReciprocalJumpBridge(sourceStructure, sortedStructures);
    if (
      !destinationStructure ||
      !isJumpBridgeServiceAvailable(destinationStructure, structures)
    ) {
      continue;
    }

    const sourceID = normalizePositiveInt(sourceStructure.structureID, 0);
    const destinationID = normalizePositiveInt(destinationStructure.structureID, 0);
    const pairKey = [sourceID, destinationID].sort((left, right) => left - right).join(":");
    if (seenPairKeys.has(pairKey)) {
      continue;
    }
    seenPairKeys.add(pairKey);

    pairs.push(buildList([
      buildJumpBridgeMapStructurePayload(sourceStructure),
      buildJumpBridgeMapStructurePayload(destinationStructure),
    ]));

    for (const structure of [sourceStructure, destinationStructure]) {
      const structureID = normalizePositiveInt(structure && structure.structureID, 0);
      if (!structureID) {
        continue;
      }
      if (characterHasStructureService(session, structure, STRUCTURE_SERVICE_ID.JUMP_BRIDGE)) {
        hasAccessTo.push(structureID);
      } else {
        hasNoAccessTo.push(structureID);
      }
    }
  }

  return [
    buildList(pairs),
    buildIDList(hasAccessTo),
    buildIDList(hasNoAccessTo),
  ];
}

class StructureDirectoryService extends BaseService {
  constructor() {
    super("structureDirectory");
  }

  callMethod(method, args, session, kwargs) {
    const handlerName = `Handle_${method}`;
    if (
      typeof this[handlerName] === "function" ||
      typeof this[method] === "function"
    ) {
      return super.callMethod(method, args, session, kwargs);
    }

    // The modern client probes several structure-directory reads while
    // building station/system UI. Returning null here bubbles into
    // client-side `structures = None` errors in map/surroundings code.
    if (typeof method === "string" && method.startsWith("Get")) {
      log.debug(
        `[StructureDirectoryService] Fallback empty result for ${method}`,
      );
      return { type: "list", items: [] };
    }

    return super.callMethod(method, args, session, kwargs);
  }

  Handle_GetStructureInfo(args, session, kwargs) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structure = structureState.getStructureByID(structureID);
    log.debug(`[StructureDirectoryService] GetStructureInfo structure=${String(structureID)}`);
    if (!structure) {
      return null;
    }
    return isStructureOwnerCorporationSession(session, structure)
      ? buildStructureInfoPayload(structure, session)
      : buildBasicStructureInfoPayload(structure);
  }

  Handle_GetStructureInfo_(args, session, kwargs) {
    return this.Handle_GetStructureInfo(args, session, kwargs);
  }

  Handle_GetMyCharacterStructures(args, session, kwargs) {
    const structures = structureState.listDockableStructuresForCharacter(session);
    log.debug(`[StructureDirectoryService] GetMyCharacterStructures count=${structures.length}`);
    return buildStructureInfoDict(structures, session);
  }

  Handle_GetMyCorporationStructures(args, session, kwargs) {
    const corpID = normalizePositiveInt(
      session && (session.corporationID || session.corpid),
      0,
    );
    if (!canReadCorporationStructureDirectory(session)) {
      throwStructureManagementDenied();
    }
    const structures = corpID > 0 ? structureState.listOwnedStructures(corpID) : [];
    log.debug(`[StructureDirectoryService] GetMyCorporationStructures count=${structures.length}`);
    return buildStructureInfoDict(structures, session, {
      includeAccessibleServices: false,
    });
  }

  Handle_GetCorporationStructures(args, session, kwargs) {
    return this.Handle_GetMyCorporationStructures(args, session, kwargs);
  }

  Handle_GetMyDockableStructures(args, session, kwargs) {
    const solarSystemID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : getCurrentSolarSystemID(session),
      getCurrentSolarSystemID(session),
    );
    const structures = structureState.listDockableStructuresForCharacter(session, {
      solarSystemID,
    });
    log.debug(`[StructureDirectoryService] GetMyDockableStructures count=${structures.length} system=${solarSystemID}`);
    return buildIDList(structures.map((structure) => structure.structureID));
  }

  Handle_GetStructures(args, session, kwargs) {
    const structures = listRequestedStructures(args);
    log.debug(`[StructureDirectoryService] GetStructures count=${structures.length}`);
    return buildStructureInfoDict(structures, session);
  }

  Handle_GetStructuresInSystem(args, session, kwargs) {
    const solarSystemID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : getCurrentSolarSystemID(session),
      getCurrentSolarSystemID(session),
    );
    const structures = structureState.listStructuresForSystem(solarSystemID);
    log.debug(`[StructureDirectoryService] GetStructuresInSystem count=${structures.length} system=${solarSystemID}`);
    return buildStructureInfoDict(structures, session);
  }

  Handle_GetSolarsystemStructures(args, session, kwargs) {
    return this.Handle_GetStructuresInSystem(args, session, kwargs);
  }

  Handle_GetStructureMapData(args, session, kwargs) {
    const solarSystemID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : getCurrentSolarSystemID(session),
      getCurrentSolarSystemID(session),
    );
    const structures = structureState.listStructuresForSystem(solarSystemID);
    log.debug(`[StructureDirectoryService] GetStructureMapData count=${structures.length} system=${solarSystemID}`);
    return buildCachedMethodCallResult(buildStructureMapList(structures), {
      serviceName: this.name,
      method: "GetStructureMapData",
      args: [solarSystemID],
      versionCheck: "5 minutes",
      sessionInfo: "charid",
      sessionInfoValue:
        session && (session.charid || session.charID || session.characterID),
    });
  }

  Handle_GetStructureDescription(args, session, kwargs) {
    const structureID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : null,
      0,
    );
    const structure = structureState.getStructureByID(structureID);
    log.debug(`[StructureDirectoryService] GetStructureDescription structure=${structureID}`);
    return structure ? normalizeStructureDescription(structure.description) : "";
  }

  Handle_SetStructureDescription(args, session, kwargs) {
    const structureID = normalizePositiveInt(
      Array.isArray(args) && args.length > 0 ? args[0] : null,
      0,
    );
    const description = normalizeStructureDescription(
      Array.isArray(args) && args.length > 1 ? args[1] : "",
    );
    const currentStructure = structureState.getStructureByID(structureID);
    if (!canManageStructure(session, currentStructure)) {
      throwStructureManagementDenied();
    }

    const updateResult = structureState.updateStructureRecord(structureID, (structure) => ({
      ...structure,
      description,
    }));
    if (!updateResult.success) {
      log.warn(
        `[StructureDirectoryService] SetStructureDescription failed structure=${structureID} error=${updateResult.errorMsg || "UNKNOWN"}`,
      );
    } else {
      log.debug(`[StructureDirectoryService] SetStructureDescription structure=${structureID}`);
    }
    return null;
  }

  Handle_CheckMyDockingAccessToStructures(args, session, kwargs) {
    const requested = listRequestedStructures(args);
    const allowed = requested
      .filter((structure) => structureState.canCharacterDockAtStructure(session, structure).success)
      .map((structure) => structure.structureID);
    log.debug(`[StructureDirectoryService] CheckMyDockingAccessToStructures requested=${requested.length} allowed=${allowed.length}`);
    return buildIDList(allowed);
  }

  Handle_GetMyAccessibleOnlineCynoBeaconStructures(args, session, kwargs) {
    const structures = structureState.listStructures()
      .filter((structure) => (
        isPharoluxStructure(structure) &&
        Number(
          structure.serviceStates &&
          structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_BEACON)],
        ) === STRUCTURE_SERVICE_STATE.ONLINE &&
        !isSolarSystemCynoJammed(structure.solarSystemID) &&
        characterHasStructureService(session, structure, STRUCTURE_SERVICE_ID.CYNO_BEACON)
      ));
    log.debug(`[StructureDirectoryService] GetMyAccessibleOnlineCynoBeaconStructures count=${structures.length}`);
    return buildList(
      structures
        .sort((left, right) => left.structureID - right.structureID)
        .map((structure) => buildCynoBeaconEntry(structure)),
    );
  }

  Handle_GetSolarSystemsWithBeacons(args, session, kwargs) {
    const systemIDs = structureState.listStructures()
      .filter((structure) => (
        isPharoluxStructure(structure) &&
        Number(
          structure.serviceStates &&
          structure.serviceStates[String(STRUCTURE_SERVICE_ID.CYNO_BEACON)],
        ) === STRUCTURE_SERVICE_STATE.ONLINE &&
        !isSolarSystemCynoJammed(structure.solarSystemID)
      ))
      .map((structure) => structure.solarSystemID);
    log.debug(`[StructureDirectoryService] GetSolarSystemsWithBeacons count=${systemIDs.length}`);
    return buildIDList(systemIDs);
  }

  Handle_GetValidWarHQs(args, session, kwargs) {
    const ownerID = normalizePositiveInt(Array.isArray(args) && args.length > 0 ? args[0] : null, 0);
    if (!canRequestWarHQsForOwner(session, ownerID)) {
      log.debug(`[StructureDirectoryService] GetValidWarHQs denied owner=${ownerID}`);
      return buildList([]);
    }
    const structures = structureState.listStructures()
      .filter((structure) => (
        structureBelongsToOwnerID(structure, ownerID) &&
        isDockableUpwellWarHQStructure(structure) &&
        isHighSecurityStructure(structure)
      ));
    log.debug(`[StructureDirectoryService] GetValidWarHQs owner=${ownerID} count=${structures.length}`);
      return buildList(
        structures
          .sort((left, right) => left.structureID - right.structureID)
          .map((structure) => buildWarHQPayload(structure)),
      );
    }

  Handle_GetJumpBridgesWithMyAccess(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetJumpBridgesWithMyAccess called");
    return buildJumpBridgeAccessPayload(session);
  }

  Handle_GetNearbyJumpBridges(args, session, kwargs) {
    const currentSolarSystemID = getCurrentSolarSystemID(session);
    const structures = structureState.listStructures({
      includeDestroyed: false,
      refresh: false,
    }).filter((structure) => (
      Number(structure && structure.typeID) === TYPE_ANSIBLEX_JUMP_BRIDGE &&
      !structure.destroyedAt
    ));

    return {
      type: "list",
      items: structures.map((structure) => {
        const devFlags =
          structure && structure.devFlags && typeof structure.devFlags === "object"
            ? structure.devFlags
            : {};
        const destinationSolarsystemID = normalizePositiveInt(
          devFlags.destinationSolarsystemID ||
          devFlags.sovereigntyJumpBridgeDestinationSolarsystemID,
          0,
        );
        return buildKeyVal([
          ["structureID", Number(structure.structureID || 0)],
          ["typeID", Number(structure.typeID || 0)],
          ["solarSystemID", Number(structure.solarSystemID || 0)],
          ["ownerID", Number(structure.ownerCorpID || structure.ownerID || 0)],
          ["structureName", String(structure.itemName || structure.name || "Ansiblex Jump Bridge")],
          ["destinationSolarsystemID", destinationSolarsystemID || null],
          ["alignedToCurrentSystem", destinationSolarsystemID > 0 && destinationSolarsystemID === currentSolarSystemID],
        ]);
      }),
    };
  }
}

module.exports = StructureDirectoryService;
