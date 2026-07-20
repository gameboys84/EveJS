const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));
const assetSafetyState = require(path.join(
  __dirname,
  "./structureAssetSafetyState",
));
const structureState = require(path.join(
  __dirname,
  "./structureState",
));

function buildEmptyList() {
  return {
    type: "list",
    items: [],
  };
}

function normalizeWrapIds(args) {
  const wrapIDs = Array.isArray(args) && args.length > 0 ? args[0] : [];
  return Array.isArray(wrapIDs) ? wrapIDs : [wrapIDs];
}

function normalizeInt(value, fallback = 0) {
  const numeric = Number(unwrapMarshalValue(value));
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getSessionCharacterID(session) {
  return normalizePositiveInt(
    session && (session.characterID || session.charID || session.charid || session.userid),
    0,
  );
}

function getSessionCorporationID(session) {
  return normalizePositiveInt(
    session && (session.corporationID || session.corpid),
    0,
  );
}

function throwAssetSafetyFailure(errorMsg, fallbackMessage) {
  const normalized = String(errorMsg || "").trim();
  if (normalized === "NO_ITEMS_TO_MOVE") {
    throwWrappedUserError("NoItemsToPutInAssetSafety");
  }

  const messageByError = {
    STRUCTURE_NOT_FOUND: "That structure is not available for asset safety.",
    SOLAR_SYSTEM_MISMATCH: "That structure is not in the requested solar system.",
    ASSET_SAFETY_DISABLED: "Asset safety is disabled in this solar system.",
    WRAP_NOT_FOUND: "That asset safety wrap could not be found.",
    WRAP_ALREADY_DELIVERED: "That asset safety wrap has already been delivered.",
    WRAP_ACCESS_DENIED: "You do not have access to that asset safety wrap.",
    WRAP_NOT_READY: "That asset safety wrap is not ready for manual delivery yet.",
    DESTINATION_NOT_FOUND: "The requested asset safety destination could not be found.",
    INVALID_DESTINATION_STRUCTURE: "The requested structure cannot receive this asset safety wrap.",
    INVALID_DESTINATION_STATION: "The requested station cannot receive this asset safety wrap.",
    DESTINATION_ACCESS_DENIED: "You do not have access to deliver asset safety to that structure.",
  };

  throwWrappedUserError("CustomNotify", {
    notify: messageByError[normalized] ||
      fallbackMessage ||
      "The asset safety request could not be completed.",
  });
}

function getNotificationTargets(ownerKind, ownerID, fallbackSession = null) {
  const normalizedOwnerKind = String(ownerKind || "char").trim().toLowerCase() === "corp"
    ? "corp"
    : "char";
  const normalizedOwnerID = normalizePositiveInt(ownerID, 0);
  const targets = new Set();

  if (fallbackSession) {
    targets.add(fallbackSession);
  }

  for (const session of sessionRegistry.getSessions()) {
    const sessionOwnerID = normalizedOwnerKind === "corp"
      ? getSessionCorporationID(session)
      : getSessionCharacterID(session);
    if (sessionOwnerID === normalizedOwnerID) {
      targets.add(session);
    }
  }

  return [...targets].filter(
    (session) => session && typeof session.sendNotification === "function",
  );
}

function notifyAssetSafetyCreated(session, wrap) {
  if (!wrap) {
    return;
  }

  const ownerID = normalizePositiveInt(wrap.ownerID, 0);
  const solarSystemID = normalizePositiveInt(wrap.solarSystemID, 0);
  const sourceStructureID = normalizePositiveInt(wrap.sourceStructureID, 0);
  for (const targetSession of getNotificationTargets(wrap.ownerKind, ownerID, session)) {
    targetSession.sendNotification("OnAssetSafetyCreated", "clientID", [
      ownerID,
      solarSystemID,
      sourceStructureID,
    ]);
  }
}

function notifyAssetSafetyDelivered(session, wrap) {
  if (!wrap) {
    return;
  }

  const ownerID = normalizePositiveInt(wrap.ownerID, 0);
  for (const targetSession of getNotificationTargets(wrap.ownerKind, ownerID, session)) {
    targetSession.sendNotification("OnAssetSafetyDelivered", "clientID", [
      ownerID,
    ]);
  }
}

function extractDestinationID(kwargs) {
  const unwrapped = unwrapMarshalValue(kwargs);
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    return null;
  }
  return unwrapped.destinationID;
}

function buildStationInfoPayload(info) {
  if (!info || typeof info !== "object") {
    return null;
  }

  return buildKeyVal([
    ["itemID", Number(info.itemID) || 0],
    ["typeID", Number(info.typeID) || 0],
    ["solarSystemID", Number(info.solarSystemID) || 0],
    ["itemName", String(info.itemName || `Station ${Number(info.itemID) || 0}`)],
  ]);
}

function buildWrapPayload(wrap) {
  return buildKeyVal([
    ["solarSystemID", Number(wrap.solarSystemID) || 0],
    ["assetWrapID", Number(wrap.assetWrapID) || 0],
    ["wrapName", String(wrap.wrapName || `Asset Safety Wrap ${wrap.assetWrapID}`)],
    ["ejectTime", buildFiletimeLong(structureState.toFileTimeLongFromMs(wrap.ejectTimeMs))],
    ["daysUntilCanDeliverConst", Number(wrap.daysUntilCanDeliverConst) || assetSafetyState.DAYS_UNTIL_CAN_DELIVER],
    ["daysUntilAutoMoveConst", Number(wrap.daysUntilAutoMoveConst) || assetSafetyState.DAYS_UNTIL_AUTO_MOVE],
    ["nearestNPCStationInfo", buildStationInfoPayload(wrap.nearestNPCStationInfo)],
  ]);
}

class StructureAssetSafetyService extends BaseService {
  constructor() {
    super("structureAssetSafety");
  }

  Handle_GetItemsInSafetyForCharacter(args, session) {
    const wraps = assetSafetyState.listWrapsForOwner(
      "char",
      session && (session.characterID || session.charid || session.userid),
    );
    log.debug(`[StructureAssetSafety] GetItemsInSafetyForCharacter count=${wraps.length}`);
    return buildList(wraps.map((wrap) => buildWrapPayload(wrap)));
  }

  Handle_GetItemsInSafetyForCorp(args, session) {
    const wraps = assetSafetyState.listWrapsForOwner(
      "corp",
      session && (session.corporationID || session.corpid),
    );
    log.debug(`[StructureAssetSafety] GetItemsInSafetyForCorp count=${wraps.length}`);
    return buildCachedMethodCallResult(
      buildList(wraps.map((wrap) => buildWrapPayload(wrap))),
      {
        serviceName: "structureAssetSafety",
        method: "GetItemsInSafetyForCorp",
        args: [],
        versionCheck: "1 minute",
      },
    );
  }

  Handle_GetWrapNames(args) {
    const wrapIDs = normalizeWrapIds(args);
    log.debug(`[StructureAssetSafety] GetWrapNames count=${wrapIDs.length}`);
    return buildDict(
      wrapIDs.map((wrapID) => [
        Number(wrapID) || wrapID,
        assetSafetyState.getWrapNames([wrapID])[Number(wrapID) || wrapID] || null,
      ]),
    );
  }

  Handle_GetStructuresICanDeliverTo(args, session) {
    const solarSystemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const targets = assetSafetyState.getDeliveryTargetsForSession(session, solarSystemID);
    const activeWraps = [
      ...assetSafetyState.listWrapsForOwner(
        "char",
        session && (session.characterID || session.charid || session.userid),
        { refresh: false },
      ),
      ...assetSafetyState.listWrapsForOwner(
        "corp",
        session && (session.corporationID || session.corpid),
        { refresh: false },
      ),
    ].filter((wrap) => Number(wrap.solarSystemID) === Number(solarSystemID));
    log.debug(
      `[StructureAssetSafety] GetStructuresICanDeliverTo solarSystem=${String(solarSystemID)}`,
    );
    return [
      activeWraps.length > 0
        ? buildList(
          targets.structures.map((structure) => buildKeyVal([
            ["itemID", Number(structure.itemID) || 0],
            ["typeID", Number(structure.typeID) || 0],
            ["solarSystemID", Number(structure.solarSystemID) || 0],
            ["itemName", String(structure.itemName || `Structure ${Number(structure.itemID) || 0}`)],
          ])),
        )
        : buildEmptyList(),
      activeWraps.length > 0
        ? buildStationInfoPayload(targets.nearestNPCStationInfo)
        : null,
    ];
  }

  Handle_MovePersonalAssetsToSafety(args, session) {
    const solarSystemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structureID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    log.debug(
      `[StructureAssetSafety] MovePersonalAssetsToSafety solarSystem=${String(solarSystemID)} structure=${String(structureID)}`,
    );
    const result = assetSafetyState.movePersonalAssetsToSafety(session, solarSystemID, structureID);
    if (!result.success) {
      throwAssetSafetyFailure(result.errorMsg);
    }
    if (!result.data || !result.data.createdWrap) {
      throwAssetSafetyFailure("NO_ITEMS_TO_MOVE");
    }
    notifyAssetSafetyCreated(session, result.data.createdWrap);
    return null;
  }

  Handle_MoveCorpAssetsToSafety(args, session) {
    const solarSystemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structureID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    log.debug(
      `[StructureAssetSafety] MoveCorpAssetsToSafety solarSystem=${String(solarSystemID)} structure=${String(structureID)}`,
    );
    const result = assetSafetyState.moveCorporationAssetsToSafety(session, solarSystemID, structureID);
    if (!result.success) {
      throwAssetSafetyFailure(result.errorMsg);
    }
    if (!result.data || !result.data.createdWrap) {
      throwAssetSafetyFailure("NO_ITEMS_TO_MOVE");
    }
    notifyAssetSafetyCreated(session, result.data.createdWrap);
    return null;
  }

  Handle_MoveSafetyWrapToStructure(args, session, kwargs) {
    const assetWrapID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const solarSystemID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const destinationID = extractDestinationID(kwargs);
    log.debug(
      `[StructureAssetSafety] MoveSafetyWrapToStructure wrap=${String(assetWrapID)} solarSystem=${String(solarSystemID)} destination=${String(destinationID)}`,
    );
    const result = assetSafetyState.deliverWrapToDestination(assetWrapID, destinationID, {
      session,
    });
    if (!result.success) {
      throwAssetSafetyFailure(result.errorMsg);
    }
    notifyAssetSafetyDelivered(session, result.data);
    return null;
  }

  Handle_MoveEjectTimeGM(args) {
    const assetWrapID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const days = Array.isArray(args) && args.length > 1 ? args[1] : null;
    log.debug(
      `[StructureAssetSafety] MoveEjectTimeGM wrap=${String(assetWrapID)} days=${String(days)}`,
    );
    assetSafetyState.shiftWrapEjectTimeGM(assetWrapID, days);
    return null;
  }
}

module.exports = StructureAssetSafetyService;
