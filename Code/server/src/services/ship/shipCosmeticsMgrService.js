const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const log = require(path.join(__dirname, "../../utils/logger"));
const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildFiletimeLong,
  extractList,
  extractDictEntries,
  normalizeNumber,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllLicensedSkinRecords,
  getLicensedSkinRecordsForType,
  getEffectiveLicenseRecord,
  getLicenseCatalogEntry,
  giveSkin,
  removeSkin,
  expireSkin,
  applySkinToShip,
} = require(path.join(__dirname, "./shipCosmeticsState"));
const {
  consumeInventoryItemQuantity,
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getEnabledCosmeticsEntries,
} = require(path.join(__dirname, "./shipLogoFittingState"));
const {
  publishShipStateSetNotice,
} = require(path.join(__dirname, "../../_secondary/express/publicGatewayLocal"));

function throwNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: message,
  });
}

function buildLicensedSkinKeyVal(record) {
  return buildKeyVal([
    ["skinID", Number(record.skinID || 0) || 0],
    [
      "expires",
      record.expiresAtFileTime
        ? buildFiletimeLong(record.expiresAtFileTime)
        : null,
    ],
    ["isSingleUse", Boolean(record.isSingleUse)],
    ["licenseTypeID", Number(record.licenseTypeID || 0) || null],
    ["skinMaterialID", Number(record.skinMaterialID || 0) || null],
    ["materialID", Number(record.skinMaterialID || 0) || null],
  ]);
}

function getKwargValue(kwargs, key) {
  const entries = extractDictEntries(kwargs);
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

function getSessionCharacterID(session) {
  return (
    Number(
      session &&
        (session.characterID ||
          session.charid ||
          session.charID ||
          session.characterId),
    ) || 0
  );
}

function normalizeItemIDs(rawValue) {
  const directList = extractList(rawValue)
    .map((value) => {
      const normalizedValue = unwrapMarshalValue(value);
      return normalizeNumber(
        (value && value.itemID) ??
          (value && value.fields && value.fields.itemID) ??
          (normalizedValue && normalizedValue.itemID) ??
          (normalizedValue &&
            normalizedValue.fields &&
            normalizedValue.fields.itemID) ??
          normalizedValue,
        0,
      );
    })
    .filter((value) => value > 0);
  if (directList.length > 0) {
    return [...new Set(directList)];
  }

  const dictEntries = extractDictEntries(rawValue);
  if (dictEntries.length > 0) {
    const itemIDs = dictEntries
      .map(([entryKey, row]) => {
        const normalizedRow = unwrapMarshalValue(row);
        return normalizeNumber(
          (row && row.itemID) ??
            (row && row.fields && row.fields.itemID) ??
            (normalizedRow && normalizedRow.itemID) ??
            (normalizedRow &&
              normalizedRow.fields &&
              normalizedRow.fields.itemID) ??
            entryKey,
          0,
        );
      })
      .filter((value) => value > 0);
    if (itemIDs.length > 0) {
      return [...new Set(itemIDs)];
    }
  }

  const normalizedValue = unwrapMarshalValue(rawValue);
  if (normalizedValue && typeof normalizedValue === "object" && !Array.isArray(normalizedValue)) {
    const objectValues = Object.entries(normalizedValue)
      .map(([entryKey, row]) =>
        normalizeNumber(
          row && (row.itemID ?? (row.fields && row.fields.itemID)),
          normalizeNumber(entryKey, 0),
        ),
      )
      .filter((value) => value > 0);
    if (objectValues.length > 0) {
      return [...new Set(objectValues)];
    }
  }

  const numeric = normalizeNumber(normalizedValue, 0);
  return numeric ? [numeric] : [];
}

function syncInventoryChanges(session, changes = []) {
  const {
    syncInventoryItemForSession,
  } = require(path.join(__dirname, "../character/characterState"));
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(session, change.item, change.previousData || {}, {
      emitCfgLocation: false,
    });
  }
}

function notifySkinLicenseActivated(session, skinID, licenseeID) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  session.sendNotification("OnSkinLicenseActivated", "clientID", [
    Number(skinID || 0) || 0,
    Number(licenseeID || 0) || 0,
  ]);
}

function getSkinApplyFailureMessage(errorMsg) {
  switch (errorMsg) {
    case "SKIN_NOT_LICENSED":
      return "That SKIN license is not active on this character.";
    case "SKIN_NOT_VALID_FOR_TYPE":
      return "That SKIN is not valid for this ship type.";
    case "SKIN_NOT_FOUND":
      return "That SKIN could not be found.";
    case "SHIP_NOT_FOUND":
      return "That ship could not be found.";
    default:
      return "That SKIN could not be applied.";
  }
}

function broadcastLiveShipSlimRefresh(shipID) {
  const numericShipID = Number(shipID || 0) || 0;
  if (!numericShipID) {
    return;
  }

  const seenSystems = new Set();
  for (const observerSession of sessionRegistry.getSessions()) {
    try {
      const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
      const scene =
        spaceRuntime && typeof spaceRuntime.getSceneForSession === "function"
          ? spaceRuntime.getSceneForSession(observerSession)
          : null;
      if (!scene) {
        continue;
      }

      const systemID = Number(scene.systemID || 0) || 0;
      const entity =
        typeof scene.getEntityByID === "function"
          ? scene.getEntityByID(numericShipID)
          : null;
      if (
        !entity ||
        entity.kind !== "ship" ||
        seenSystems.has(systemID) ||
        typeof scene.broadcastSlimItemChanges !== "function"
      ) {
        continue;
      }

      seenSystems.add(systemID);
      scene.broadcastSlimItemChanges([entity]);
    } catch (_error) {
      continue;
    }
  }
}

class ShipCosmeticsMgrService extends BaseService {
  constructor() {
    super("shipCosmeticsMgr");
  }

  Handle_GetEnabledCosmetics(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[ShipCosmeticsMgr] GetEnabledCosmetics(shipID=${shipID})`);
    return buildDict(
      getEnabledCosmeticsEntries(shipID).map((entry) => [
        entry.backendSlot,
        entry.cosmeticType,
      ]),
    );
  }

  Handle_GetLicencedSkins(args, session) {
    const charId = Number(session && session.characterID) || 0;
    const licensed = getAllLicensedSkinRecords(charId).map(buildLicensedSkinKeyVal);
    log.debug(
      `[ShipCosmeticsMgr] GetLicencedSkins(charID=${charId}) -> ${licensed.length}`,
    );
    return buildList(licensed);
  }

  Handle_GetLicensedSkins(args, session, kwargs) {
    return this.Handle_GetLicencedSkins(args, session, kwargs);
  }

  Handle_GetLicencedSkinsForShipType(args, session) {
    const argCount = Array.isArray(args) ? args.length : 0;
    const sessionCharacterID = Number(session && session.characterID) || 0;
    const charId =
      argCount >= 2
        ? Number(args[0] || 0) || 0
        : sessionCharacterID;
    const shipTypeID =
      argCount >= 2
        ? Number(args[1] || 0) || 0
        : Number(argCount >= 1 ? args[0] : 0) || 0;
    const licensed = getLicensedSkinRecordsForType(charId, shipTypeID).map(
      buildLicensedSkinKeyVal,
    );
    log.debug(
      `[ShipCosmeticsMgr] GetLicencedSkinsForShipType(charID=${charId}, shipTypeID=${shipTypeID}) -> ${licensed.length}`,
    );
    return buildList(licensed);
  }

  Handle_GetLicensedSkinsForShipType(args, session, kwargs) {
    return this.Handle_GetLicencedSkinsForShipType(args, session, kwargs);
  }

  Handle_GetFirstPartySkinData(args) {
    const licenseeID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const skinID = Number(args && args.length > 1 ? args[1] : 0) || 0;
    const record = getEffectiveLicenseRecord(licenseeID, skinID);
    log.debug(
      `[ShipCosmeticsMgr] GetFirstPartySkinData(licenseeID=${licenseeID}, skinID=${skinID}) -> ${record ? "hit" : "miss"}`,
    );
    return record ? buildLicensedSkinKeyVal(record) : null;
  }

  Handle_ApplySkinToShip(args, session) {
    const shipID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const skinID =
      args && args.length > 1 && args[1] !== undefined && args[1] !== null
        ? Number(args[1] || 0) || 0
        : null;
    const activeCharacterID = getSessionCharacterID(session);
    const finalResult = applySkinToShip(shipID, skinID, {
      characterID: activeCharacterID,
    });

    if (finalResult.success) {
      publishShipStateSetNotice(
        shipID,
        activeCharacterID ||
          Number(finalResult.data && finalResult.data.characterID ? finalResult.data.characterID : 0) ||
          Number(finalResult.data && finalResult.data.ownerID ? finalResult.data.ownerID : 0) ||
          0,
      );
      broadcastLiveShipSlimRefresh(shipID);
    }

    log.info(
      `[ShipCosmeticsMgr] ApplySkinToShip(shipID=${shipID}, skinID=${skinID || 0}) -> ${finalResult.success ? "ok" : finalResult.errorMsg}`,
    );
    if (!finalResult.success) {
      throwNotify(getSkinApplyFailureMessage(finalResult.errorMsg));
    }
    return null;
  }

  Handle_GiveSkin(args, session, kwargs) {
    const skinID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const durationDays = normalizeNumber(getKwargValue(kwargs, "duration"), 0);
    const isSingleUse = Boolean(getKwargValue(kwargs, "isSingleUse"));
    const charId = Number(session && session.characterID) || 0;
    const result = giveSkin(charId, skinID, {
      durationDays,
      isSingleUse,
      source: "shipCosmeticsMgr.GiveSkin",
    });
    log.info(
      `[ShipCosmeticsMgr] GiveSkin(charID=${charId}, skinID=${skinID}, durationDays=${durationDays}, isSingleUse=${isSingleUse}) -> ${result.success ? "ok" : result.errorMsg}`,
    );
    return null;
  }

  Handle_RemoveSkin(args) {
    const skinID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const licenseeID = Number(args && args.length > 1 ? args[1] : 0) || 0;
    const result = removeSkin(licenseeID, skinID);
    log.info(
      `[ShipCosmeticsMgr] RemoveSkin(licenseeID=${licenseeID}, skinID=${skinID}) -> ${result.success ? "ok" : result.errorMsg}`,
    );
    return null;
  }

  Handle_GMExpireSkinLicense(args, session) {
    const skinID = Number(args && args.length > 0 ? args[0] : 0) || 0;
    const charId = Number(session && session.characterID) || 0;
    const result = expireSkin(charId, skinID);
    log.info(
      `[ShipCosmeticsMgr] GMExpireSkinLicense(charID=${charId}, skinID=${skinID}) -> ${result.success ? "ok" : result.errorMsg}`,
    );
    return null;
  }

  Handle_ActivateSkinLicense(args, session) {
    const characterID = getSessionCharacterID(session);
    if (!characterID) {
      throwNotify("You need an active character to activate a SKIN license.");
    }

    const rawItemsArg = args && args[0];
    const itemIDs = normalizeItemIDs(rawItemsArg);
    if (itemIDs.length === 0) {
      log.warn(
        `[ShipCosmeticsMgr] ActivateSkinLicense(charID=${characterID}) -> no itemIDs resolved from payloadType=${rawItemsArg && rawItemsArg.type ? rawItemsArg.type : typeof rawItemsArg}`,
      );
      return null;
    }

    log.info(
      `[ShipCosmeticsMgr] ActivateSkinLicense(charID=${characterID}) resolving itemIDs=${itemIDs.join(",")}`,
    );

    const activationPlan = [];
    const plannedSkinIDs = new Set();
    for (const itemID of itemIDs) {
      const item = findItemById(itemID);
      if (!item || Number(item.ownerID || 0) !== characterID) {
        throwNotify("That SKIN license is not in your inventory.");
      }

      const licenseEntry = getLicenseCatalogEntry(item.typeID);
      if (!licenseEntry || !Number(licenseEntry.skinID || 0)) {
        throwNotify("That item is not a ship SKIN license.");
      }

      const skinID = Number(licenseEntry.skinID || 0) || 0;
      if (getEffectiveLicenseRecord(characterID, skinID) || plannedSkinIDs.has(skinID)) {
        throwNotify("That SKIN license is already active on this character.");
      }

      plannedSkinIDs.add(skinID);
      activationPlan.push({
        item,
        licenseEntry,
        skinID,
      });
    }

    for (const entry of activationPlan) {
      const grantResult = giveSkin(characterID, entry.skinID, {
        licenseTypeID: entry.licenseEntry.licenseTypeID,
        skinMaterialID: entry.licenseEntry.skinMaterialID,
        durationDays: entry.licenseEntry.duration,
        isSingleUse: entry.licenseEntry.isSingleUse,
        source: "shipCosmeticsMgr.ActivateSkinLicense",
      });
      if (!grantResult.success) {
        log.warn(
          `[ShipCosmeticsMgr] ActivateSkinLicense(charID=${characterID}, itemID=${entry.item.itemID}, skinID=${entry.skinID}) grant failed=${grantResult.errorMsg}`,
        );
        throwNotify("That SKIN license could not be activated.");
      }

      const consumeResult = consumeInventoryItemQuantity(entry.item.itemID, 1);
      if (!consumeResult.success) {
        log.warn(
          `[ShipCosmeticsMgr] ActivateSkinLicense(charID=${characterID}, itemID=${entry.item.itemID}, skinID=${entry.skinID}) consume failed=${consumeResult.errorMsg}`,
        );
        removeSkin(characterID, entry.skinID);
        throwNotify("That SKIN license could not be consumed.");
      }

      syncInventoryChanges(session, consumeResult.data && consumeResult.data.changes);
      notifySkinLicenseActivated(session, entry.skinID, characterID);
    }

    log.info(
      `[ShipCosmeticsMgr] ActivateSkinLicense(charID=${characterID}, itemCount=${activationPlan.length}) -> ok`,
    );
    return null;
  }
}

module.exports = ShipCosmeticsMgrService;
