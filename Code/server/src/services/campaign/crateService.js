const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const {
  syncInventoryItemForSession,
  updateCharacterRecord,
} = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  ITEM_FLAGS,
  consumeInventoryItemQuantity,
  findItemById,
  grantItemsToOwnerLocation,
  transferItemToOwnerLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  OWNER_SCOPE,
  findFittingByID,
  saveFitting,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingStore"));
const {
  grantCharacterSkillLevels,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  emitSkillSessionState,
} = require(path.join(__dirname, "../skills/training/skillQueueNotifications"));

const GROUP_REWARD_CRATE = 1194;
const GROUP_STRONG_BOX = 1818;
const TYPE_TRITANIUM = 34;
const MAX_MULTI_OPEN = 30;
const PENDING_CRATE_LOOT_FLAG_ID = 0;
let nextPendingLocationID = -9000000000000;
const pendingLootByItemID = new Map();
const pendingSkillBundlesByCrateID = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(unwrapMarshalValue(value));
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function cloneValue(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function throwNotify(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "That crate cannot be opened right now."),
  });
}

function getSessionCharacterID(session) {
  return toPositiveInt(
    session && (session.characterID || session.charID || session.charid),
    0,
  );
}

function getStackQuantity(item) {
  if (!item) {
    return 0;
  }
  if (toInt(item.singleton, 0) === 1) {
    return 1;
  }
  return Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
}

function getTypeName(typeID) {
  const typeRecord = resolveItemByTypeID(typeID);
  return String(typeRecord && typeRecord.name ? typeRecord.name : "");
}

function isSupportedCrateItem(item) {
  if (!item) {
    return false;
  }
  const groupID = toInt(item.groupID, 0);
  if (groupID === GROUP_REWARD_CRATE || groupID === GROUP_STRONG_BOX) {
    return true;
  }
  const name = String(item.itemName || getTypeName(item.typeID));
  return /\b(crate|gift box|strong box)\b/i.test(name) && groupID > 0;
}

function normalizeLootEntry(rawEntry) {
  const source = Array.isArray(rawEntry)
    ? { typeID: rawEntry[0], quantity: rawEntry[1], singleton: rawEntry[2] }
    : rawEntry && typeof rawEntry === "object"
      ? rawEntry
      : null;
  if (!source) {
    return null;
  }
  const typeID = toPositiveInt(source.typeID || source.itemTypeID, 0);
  const quantity = Math.max(1, toInt(source.quantity ?? source.stacksize, 1));
  if (!typeID || !resolveItemByTypeID(typeID)) {
    return null;
  }
  const entry = {
    typeID,
    quantity,
  };
  if (source.singleton !== undefined && source.singleton !== null) {
    entry.singleton = toInt(source.singleton, 0) > 0;
  }
  return entry;
}

function normalizeSkillGrantEntry(rawEntry) {
  const source = Array.isArray(rawEntry)
    ? { typeID: rawEntry[0], level: rawEntry[1] }
    : rawEntry && typeof rawEntry === "object"
      ? rawEntry
      : null;
  if (!source) {
    return null;
  }
  const typeID = toPositiveInt(source.typeID || source.skillTypeID, 0);
  const level = Math.max(
    1,
    Math.min(5, toInt(source.level ?? source.toLevel ?? source.trainedSkillLevel, 1)),
  );
  if (!typeID) {
    return null;
  }
  return {
    typeID,
    level,
  };
}

function normalizeSkillBundleEntry(rawEntry, fallbackSkillBundleID = 0) {
  const source = rawEntry && typeof rawEntry === "object" ? rawEntry : null;
  if (!source) {
    return null;
  }
  const skillBundleID = toPositiveInt(
    source.skillBundleID || source.bundleID || source.id,
    fallbackSkillBundleID,
  );
  if (!skillBundleID) {
    return null;
  }
  const rawSkills =
    source.skills ||
    source.skillLevels ||
    source.skillGrants ||
    source.grants ||
    [];
  const skills = (Array.isArray(rawSkills) ? rawSkills : [])
    .map(normalizeSkillGrantEntry)
    .filter(Boolean);
  const freeSkillPoints = Math.max(
    0,
    toInt(
      source.freeSkillPoints ??
        source.skillPoints ??
        source.unallocatedSkillPoints ??
        source.sp,
      0,
    ),
  );
  return {
    skillBundleID,
    freeSkillPoints,
    skills,
  };
}

function parseCustomLoot(item) {
  const customInfo = String(item && item.customInfo ? item.customInfo : "").trim();
  if (!customInfo) {
    return [];
  }
  let parsed = null;
  try {
    parsed = JSON.parse(customInfo);
  } catch (_error) {
    return [];
  }
  const rawLoot =
    (parsed && parsed.evejsCrateLoot) ||
    (parsed && parsed.crateLoot) ||
    (parsed && parsed.loot);
  const entries = Array.isArray(rawLoot) ? rawLoot : [];
  return entries.map(normalizeLootEntry).filter(Boolean);
}

function parseCustomSkillBundles(item) {
  const customInfo = String(item && item.customInfo ? item.customInfo : "").trim();
  if (!customInfo) {
    return [];
  }
  let parsed = null;
  try {
    parsed = JSON.parse(customInfo);
  } catch (_error) {
    return [];
  }
  const rawBundles =
    (parsed && parsed.evejsCrateSkillBundles) ||
    (parsed && parsed.skillBundles) ||
    (parsed && parsed.skillBundle);
  if (!rawBundles) {
    return [];
  }
  if (Array.isArray(rawBundles)) {
    return rawBundles.map((entry) => normalizeSkillBundleEntry(entry)).filter(Boolean);
  }
  if (typeof rawBundles === "object") {
    if (
      rawBundles.skillBundleID ||
      rawBundles.bundleID ||
      rawBundles.id ||
      rawBundles.freeSkillPoints ||
      rawBundles.skillPoints ||
      rawBundles.skills
    ) {
      return [normalizeSkillBundleEntry(rawBundles)].filter(Boolean);
    }
    return Object.entries(rawBundles)
      .map(([skillBundleID, entry]) =>
        normalizeSkillBundleEntry(entry, toPositiveInt(skillBundleID, 0)),
      )
      .filter(Boolean);
  }
  return [];
}

function buildFallbackLoot(item) {
  // Authored crate reward pools are not shipped in the SDE/client source dump.
  // Keep the fallback deliberately small and deterministic; tests and fixtures
  // can override it through item customInfo without creating broad content data.
  const crateTypeID = toPositiveInt(item && item.typeID, 0);
  return [{
    typeID: TYPE_TRITANIUM,
    quantity: 100 + (crateTypeID % 25),
  }];
}

function selectCrateLoot(item) {
  const customLoot = parseCustomLoot(item);
  return customLoot.length > 0 ? customLoot : buildFallbackLoot(item);
}

function aggregateLootEntries(entries = []) {
  const aggregate = new Map();
  for (const entry of entries) {
    const normalized = normalizeLootEntry(entry);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.typeID}:${normalized.singleton ? 1 : 0}`;
    const current = aggregate.get(key) || {
      typeID: normalized.typeID,
      quantity: 0,
      singleton: normalized.singleton,
    };
    current.quantity += normalized.quantity;
    aggregate.set(key, current);
  }
  return [...aggregate.values()];
}

function toGrantEntries(entries = []) {
  return entries
    .map(normalizeLootEntry)
    .filter(Boolean)
    .map((entry) => ({
      itemType: entry.typeID,
      quantity: entry.quantity,
      options: {
        singleton: entry.singleton === true ? 1 : 0,
      },
    }));
}

function buildLootResponseItems(items = []) {
  return items
    .filter(Boolean)
    .map((item) => [
      toPositiveInt(item.itemID, 0),
      toPositiveInt(item.typeID, 0),
      getStackQuantity(item),
    ])
    .filter(([itemID, typeID, quantity]) => itemID > 0 && typeID > 0 && quantity > 0);
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

function validateOwnedCrate(itemID, session) {
  const characterID = getSessionCharacterID(session);
  if (!characterID) {
    throwNotify("You need an active character to open crates.");
  }
  const item = findItemById(itemID);
  if (!item || toPositiveInt(item.ownerID, 0) !== characterID) {
    throwNotify("That crate could not be found.");
  }
  if (!isSupportedCrateItem(item)) {
    throwNotify("That item is not a crate.");
  }
  if (getStackQuantity(item) <= 0) {
    throwNotify("That crate stack is empty.");
  }
  return {
    characterID,
    item,
  };
}

function rememberPendingLoot(items, context) {
  for (const item of items) {
    const itemID = toPositiveInt(item && item.itemID, 0);
    if (!itemID) {
      continue;
    }
    pendingLootByItemID.set(itemID, {
      characterID: context.characterID,
      crateItemID: context.crateItemID,
      crateTypeID: context.crateTypeID,
      pendingLocationID: context.pendingLocationID,
      destinationID: context.destinationID,
      destinationFlagID: context.destinationFlagID,
    });
  }
}

function rememberPendingSkillBundles(crateItem, characterID) {
  const bundles = parseCustomSkillBundles(crateItem);
  if (bundles.length === 0) {
    return;
  }
  const key = `${characterID}:${toPositiveInt(crateItem && crateItem.itemID, 0)}`;
  const byBundleID = new Map();
  for (const bundle of bundles) {
    byBundleID.set(bundle.skillBundleID, bundle);
  }
  pendingSkillBundlesByCrateID.set(key, byBundleID);
}

function takePendingSkillBundle(characterID, crateID, skillBundleID) {
  const key = `${characterID}:${crateID}`;
  const byBundleID = pendingSkillBundlesByCrateID.get(key);
  if (!byBundleID) {
    return null;
  }
  const bundle = byBundleID.get(skillBundleID) || null;
  if (!bundle) {
    return null;
  }
  byBundleID.delete(skillBundleID);
  if (byBundleID.size === 0) {
    pendingSkillBundlesByCrateID.delete(key);
  }
  return bundle;
}

function applySkillBundleToCharacter(session, characterID, bundle) {
  const changedSkills = grantCharacterSkillLevels(characterID, bundle.skills || []);
  let freeSkillPoints = null;
  if (bundle.freeSkillPoints > 0) {
    const updateResult = updateCharacterRecord(characterID, (record) => ({
      ...record,
      freeSkillPoints:
        Math.max(0, toInt(record && record.freeSkillPoints, 0)) +
        bundle.freeSkillPoints,
    }));
    if (!updateResult.success) {
      throwNotify("That skill bundle could not be claimed.");
    }
    freeSkillPoints = toInt(updateResult.data && updateResult.data.freeSkillPoints, 0);
  }

  emitSkillSessionState(session, characterID, changedSkills, {
    freeSkillPoints: freeSkillPoints === null ? undefined : freeSkillPoints,
  });
  if (session && typeof session.sendNotification === "function") {
    session.sendNotification("OnSkillBundleInjected", "clientID", [
      changedSkills.length,
      bundle.freeSkillPoints,
    ]);
  }
  return {
    changedSkillCount: changedSkills.length,
    freeSkillPoints: bundle.freeSkillPoints,
  };
}

function isPendingLootItem(item, session) {
  if (!item) {
    return false;
  }
  const characterID = getSessionCharacterID(session);
  if (!characterID || toPositiveInt(item.ownerID, 0) !== characterID) {
    return false;
  }
  const locationID = toInt(item.locationID, 0);
  if (locationID >= 0 || toInt(item.flagID, 0) !== PENDING_CRATE_LOOT_FLAG_ID) {
    return false;
  }
  const pending = pendingLootByItemID.get(toPositiveInt(item.itemID, 0));
  return !pending || pending.characterID === characterID;
}

function normalizeDestinationFromPending(itemID, destinationID, destinationFlagID) {
  const pending = pendingLootByItemID.get(toPositiveInt(itemID, 0));
  if (!pending) {
    return {
      destinationID: toPositiveInt(destinationID, 0),
      destinationFlagID: toInt(destinationFlagID, ITEM_FLAGS.HANGAR),
    };
  }
  const requestedDestinationID = toPositiveInt(destinationID, pending.destinationID);
  const requestedFlagID = toInt(destinationFlagID, pending.destinationFlagID);
  if (
    requestedDestinationID !== pending.destinationID ||
      requestedFlagID !== pending.destinationFlagID
  ) {
    throwNotify("That crate loot has a different claim destination.");
  }
  return {
    destinationID: pending.destinationID,
    destinationFlagID: pending.destinationFlagID,
  };
}

function grantLootToLocation({
  characterID,
  destinationID,
  destinationFlagID,
  lootEntries,
}) {
  const grantResult = grantItemsToOwnerLocation(
    characterID,
    destinationID,
    destinationFlagID,
    toGrantEntries(lootEntries),
  );
  if (!grantResult.success) {
    throwNotify("The crate rewards could not be created.");
  }
  return grantResult.data || {};
}

class CrateService extends BaseService {
  constructor() {
    super("crateService");
  }

  Handle_GetCrateLocation(args, session) {
    const itemID = toPositiveInt(args && args[0], 0);
    const { item } = validateOwnedCrate(itemID, session);
    return [
      toPositiveInt(item.locationID, 0),
      toInt(item.flagID, ITEM_FLAGS.HANGAR),
    ];
  }

  Handle_OpenCrate(args, session) {
    const itemID = toPositiveInt(args && args[0], 0);
    const { characterID, item } = validateOwnedCrate(itemID, session);
    const destinationID = toPositiveInt(item.locationID, 0);
    const destinationFlagID = toInt(item.flagID, ITEM_FLAGS.HANGAR);
    if (!destinationID) {
      throwNotify("That crate does not have a valid reward destination.");
    }

    const pendingLocationID = nextPendingLocationID;
    nextPendingLocationID -= 1;
    const lootEntries = selectCrateLoot(item);
    const pendingGrant = grantLootToLocation({
      characterID,
      destinationID: pendingLocationID,
      destinationFlagID: PENDING_CRATE_LOOT_FLAG_ID,
      lootEntries,
    });

    const consumeResult = consumeInventoryItemQuantity(item.itemID, 1);
    if (!consumeResult.success) {
      throwNotify("The crate could not be consumed.");
    }
    syncInventoryChanges(session, consumeResult.data && consumeResult.data.changes);

    rememberPendingSkillBundles(item, characterID);
    rememberPendingLoot(pendingGrant.items || [], {
      characterID,
      crateItemID: item.itemID,
      crateTypeID: item.typeID,
      pendingLocationID,
      destinationID,
      destinationFlagID,
    });
    return buildLootResponseItems(pendingGrant.items || []);
  }

  Handle_PeekInsideFixedCrate(args, session) {
    const itemID = toPositiveInt(args && args[0], 0);
    const { item } = validateOwnedCrate(itemID, session);
    return selectCrateLoot(item).map((entry) => [
      entry.typeID,
      entry.quantity,
      "",
    ]);
  }

  Handle_ClaimLoot(args, session) {
    const itemID = toPositiveInt(args && args[0], 0);
    const item = findItemById(itemID);
    if (!isPendingLootItem(item, session)) {
      throwNotify("That crate reward is no longer available.");
    }
    const {
      destinationID,
      destinationFlagID,
    } = normalizeDestinationFromPending(itemID, args && args[1], args && args[2]);
    if (!destinationID) {
      throwNotify("That crate reward does not have a valid destination.");
    }

    const moveResult = transferItemToOwnerLocation(
      item.itemID,
      getSessionCharacterID(session),
      destinationID,
      destinationFlagID,
    );
    if (!moveResult.success) {
      throwNotify("That crate reward could not be claimed.");
    }
    pendingLootByItemID.delete(item.itemID);
    syncInventoryChanges(session, moveResult.data && moveResult.data.changes);
    return null;
  }

  Handle_ClaimLootFromCrateStack(args, session) {
    const itemID = toPositiveInt(args && args[0], 0);
    const requestedQuantity = Math.min(
      MAX_MULTI_OPEN,
      Math.max(1, toInt(args && args[1], 1)),
    );
    const { characterID, item } = validateOwnedCrate(itemID, session);
    const destinationID = toPositiveInt(item.locationID, 0);
    const destinationFlagID = toInt(item.flagID, ITEM_FLAGS.HANGAR);
    if (!destinationID) {
      throwNotify("That crate does not have a valid reward destination.");
    }

    const cratesToOpen = Math.min(requestedQuantity, getStackQuantity(item));
    const consumeResult = consumeInventoryItemQuantity(item.itemID, cratesToOpen);
    if (!consumeResult.success) {
      throwNotify("The crate stack could not be consumed.");
    }

    const lootEntries = aggregateLootEntries(
      Array.from({ length: cratesToOpen }, () => selectCrateLoot(item)).flat(),
    );
    const grantResult = grantLootToLocation({
      characterID,
      destinationID,
      destinationFlagID,
      lootEntries,
    });

    syncInventoryChanges(session, consumeResult.data && consumeResult.data.changes);
    syncInventoryChanges(session, grantResult.changes || []);
    return [cratesToOpen, requestedQuantity];
  }

  Handle_ClaimSkillBundle(args, session) {
    const crateID = toPositiveInt(args && args[0], 0);
    const skillBundleID = toPositiveInt(args && args[1], 0);
    const characterID = getSessionCharacterID(session);
    if (!characterID || !crateID || !skillBundleID) {
      return null;
    }
    const bundle = takePendingSkillBundle(characterID, crateID, skillBundleID);
    if (!bundle) {
      return null;
    }
    return applySkillBundleToCharacter(session, characterID, bundle);
  }

  Handle_ClaimFitting(args, session) {
    const crateID = toPositiveInt(args && args[0], 0);
    const fittingID = toPositiveInt(args && args[1], 0);
    const characterID = getSessionCharacterID(session);
    if (!characterID || !crateID || !fittingID) {
      return null;
    }
    const fitting = findFittingByID(fittingID);
    if (!fitting) {
      return null;
    }
    const saveResult = saveFitting(characterID, {
      shipTypeID: fitting.shipTypeID,
      name: fitting.name || `Crate Fitting ${fittingID}`,
      description: fitting.description || "",
      fitData: cloneValue(fitting.fitData || []),
    }, OWNER_SCOPE.CHARACTER);
    return saveResult.success ? saveResult.data.fittingID : null;
  }
}

module.exports = CrateService;
module.exports._testing = {
  GROUP_REWARD_CRATE,
  GROUP_STRONG_BOX,
  MAX_MULTI_OPEN,
  PENDING_CRATE_LOOT_FLAG_ID,
  aggregateLootEntries,
  isSupportedCrateItem,
  parseCustomLoot,
  parseCustomSkillBundles,
  selectCrateLoot,
  resetForTests() {
    nextPendingLocationID = -9000000000000;
    pendingLootByItemID.clear();
    pendingSkillBundlesByCrateID.clear();
  },
};
