const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const { syncInventoryItemForSession } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  ITEM_FLAGS,
  findItemById,
  transferItemToOwnerLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  NOTIFICATION_GROUP,
  NOTIFICATION_TYPE,
} = require(path.join(__dirname, "../notifications/notificationConstants"));
const {
  createNotification,
} = require(path.join(__dirname, "../notifications/notificationState"));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const structureState = require(path.join(__dirname, "./structureState"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function throwNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "The selected items could not be delivered."),
  });
}

function normalizeItemIDList(rawValue) {
  const unwrapped = unwrapMarshalValue(rawValue);
  const values = Array.isArray(unwrapped)
    ? unwrapped
    : unwrapped && typeof unwrapped === "object"
      ? Object.values(unwrapped)
      : [unwrapped];
  return [...new Set(
    values
      .map((value) => toPositiveInt(value, 0))
      .filter((value) => value > 0),
  )];
}

function getSessionCharacterID(session) {
  return toPositiveInt(
    session && (session.characterID || session.charID || session.charid),
    0,
  );
}

function getSessionStructureID(session) {
  return toPositiveInt(
    session && (session.structureID || session.structureid),
    0,
  );
}

function syncInventoryChanges(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(session, change.item, change.previousData || {}, {
      emitCfgLocation: false,
    });
  }
}

function isDeliverablePersonalHangarItem(item, senderCharacterID, structureID) {
  return Boolean(
    item &&
      toPositiveInt(item.ownerID, 0) === senderCharacterID &&
      toPositiveInt(item.locationID, 0) === structureID &&
      toInt(item.flagID, 0) === ITEM_FLAGS.HANGAR,
  );
}

function getStackQuantity(item) {
  if (!item) {
    return 0;
  }
  if (toInt(item.singleton, 0) === 1) {
    return 1;
  }
  return toPositiveInt(item.stacksize ?? item.quantity, 0);
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

function summarizeDeliveredTypes(items) {
  const quantitiesByTypeID = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const typeID = toPositiveInt(item && item.typeID, 0);
    const quantity = getStackQuantity(item);
    if (!typeID || quantity <= 0) {
      continue;
    }
    quantitiesByTypeID.set(
      typeID,
      (quantitiesByTypeID.get(typeID) || 0) + quantity,
    );
  }
  return [...quantitiesByTypeID.entries()]
    .sort(([leftTypeID], [rightTypeID]) => leftTypeID - rightTypeID)
    .map(([typeID, quantity]) => [quantity, typeID]);
}

function createStructureItemsDeliveredNotification(
  structure,
  recipientCharacterID,
  senderCharacterID,
  deliveredItems,
) {
  const listOfTypesAndQty = summarizeDeliveredTypes(deliveredItems);
  if (listOfTypesAndQty.length <= 0) {
    return;
  }
  createNotification(recipientCharacterID, {
    typeID: NOTIFICATION_TYPE.STRUCTURE_ITEMS_DELIVERED,
    senderID: senderCharacterID,
    groupID: NOTIFICATION_GROUP.STRUCTURES,
    processed: false,
    data: {
      ...buildStructureBaseNotificationData(structure),
      charID: senderCharacterID,
      listOfTypesAndQty,
    },
    emitLive: false,
  });
}

class StructureDeliveriesService extends BaseService {
  constructor() {
    super("structureDeliveries");
  }

  Handle_Deliver(args, session) {
    const structureID = toPositiveInt(Array.isArray(args) ? unwrapMarshalValue(args[0]) : null, 0);
    const recipientCharacterID = toPositiveInt(
      Array.isArray(args) ? unwrapMarshalValue(args[1]) : null,
      0,
    );
    const itemIDs = normalizeItemIDList(Array.isArray(args) ? args[2] : null);
    const senderCharacterID = getSessionCharacterID(session);
    const sessionStructureID = getSessionStructureID(session);

    if (!senderCharacterID) {
      throwNotify("You need an active character to deliver items.");
    }
    if (!structureID || !sessionStructureID || structureID !== sessionStructureID) {
      throwNotify("You must be inside the structure to deliver items.");
    }
    if (!recipientCharacterID) {
      throwNotify("Choose a capsuleer to receive the delivered items.");
    }
    const structure = structureState.getStructureByID(structureID, { refresh: false });
    if (!structure || structure.destroyedAt || structure.dockable !== true) {
      throwNotify("That structure cannot accept personal deliveries.");
    }

    const deliveredItems = [];
    for (const itemID of itemIDs) {
      const item = findItemById(itemID);
      if (!isDeliverablePersonalHangarItem(item, senderCharacterID, structureID)) {
        continue;
      }
      const deliveredItem = {
        typeID: item.typeID,
        stacksize: getStackQuantity(item),
        singleton: item.singleton,
      };
      const moveResult = transferItemToOwnerLocation(
        item.itemID,
        recipientCharacterID,
        structureID,
        ITEM_FLAGS.DELIVERIES,
      );
      if (!moveResult.success) {
        continue;
      }
      deliveredItems.push(deliveredItem);
      syncInventoryChanges(session, moveResult.data && moveResult.data.changes);
    }
    createStructureItemsDeliveredNotification(
      structure,
      recipientCharacterID,
      senderCharacterID,
      deliveredItems,
    );

    return null;
  }
}

module.exports = StructureDeliveriesService;
module.exports._testing = {
  summarizeDeliveredTypes,
  isDeliverablePersonalHangarItem,
};
