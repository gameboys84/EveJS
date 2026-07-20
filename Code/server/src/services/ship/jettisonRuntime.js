const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findItemById,
  createSpaceItemForCharacter,
  moveItemToLocation,
  removeInventoryItem,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

// CCP parity: jetcans last exactly 2 hours from creation, regardless of
// whether items are added or removed.
const JETCAN_LIFETIME_MS = 2 * 60 * 60 * 1000;

const JETCAN_CONTAINER_NAME = "Cargo Container";
const JETTISON_EFFECT_GUID = "effects.Jettison";
const JETCAN_DESTRUCTION_EFFECT_ID = 3;
const JETCAN_REMOVED_JUNK_LOCATION_ID = 10;
// Retail jetcans store contained rows with flagID 0. The active-ship cargo
// move notification in the golden trace reports {3: canID, 4: 0}.
const JETCAN_CONTENT_FLAG_ID = 0;
// Mirrors inventorycommon.const.jettisonableFlags in the client for ordinary
// ship inventory jettison into a jetcan.
const JETTISONABLE_FLAG_IDS = new Set([
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.GENERAL_MINING_HOLD,
  136, // flagSpecializedMineralHold
  143, // flagSpecializedAmmoHold
  149, // flagSpecializedPlanetaryCommoditiesHold
  172, // flagStructureFuel
  ITEM_FLAGS.SPECIALIZED_GAS_HOLD,
  ITEM_FLAGS.SPECIALIZED_ICE_HOLD,
  ITEM_FLAGS.SPECIALIZED_ASTEROID_HOLD,
  ITEM_FLAGS.COLONY_RESOURCES_HOLD,
  188, // flagExpeditionHold
].map((flagID) => Number(flagID))
  .filter((flagID) => Number.isFinite(flagID) && flagID > 0));

function isJettisonableShipFlag(flagID) {
  return JETTISONABLE_FLAG_IDS.has(Number(flagID) || 0);
}

// --- Private vector helpers (inlined — not exported from any shared module) ---

function getCharacterState() {
  return require(path.join(__dirname, "../character/characterState"));
}

function getFleetRuntime() {
  return require(path.join(__dirname, "../fleets/fleetRuntime"));
}

function emitItemsChangedForSession(...args) {
  const characterState = getCharacterState();
  return typeof characterState.emitItemsChangedForSession === "function"
    ? characterState.emitItemsChangedForSession(...args)
    : false;
}

function syncInventoryItemForSession(...args) {
  const characterState = getCharacterState();
  return typeof characterState.syncInventoryItemForSession === "function"
    ? characterState.syncInventoryItemForSession(...args)
    : false;
}

function buildRemovedJetcanNotificationState(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  return {
    ...item,
    locationID: JETCAN_REMOVED_JUNK_LOCATION_ID,
    flagID: 0,
    quantity: -1,
    stacksize: 1,
    singleton: 1,
    clientCustomInfo: null,
  };
}

function normalizeSpaceVector(v, fallback = { x: 1, y: 0, z: 0 }) {
  const x = Number(v && v.x || 0);
  const y = Number(v && v.y || 0);
  const z = Number(v && v.z || 0);
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) {
    return { ...fallback };
  }
  return { x: x / len, y: y / len, z: z / len };
}

function addVectors(a, b) {
  return {
    x: Number(a && a.x || 0) + Number(b && b.x || 0),
    y: Number(a && a.y || 0) + Number(b && b.y || 0),
    z: Number(a && a.z || 0) + Number(b && b.z || 0),
  };
}

function scaleVector(v, scalar) {
  const s = Number(scalar) || 0;
  return {
    x: Number(v && v.x || 0) * s,
    y: Number(v && v.y || 0) * s,
    z: Number(v && v.z || 0) * s,
  };
}

function getJetcanSessionLootContext(session) {
  const fleetID = resolveJetcanSessionFleetID(session);
  return {
    corporationID: Number(
      session && (
        session.corporationID ||
        session.corpid ||
        session.corpID ||
        session._character && session._character.corporationID
      ),
    ) || 0,
    allianceID: Number(
      session && (
        session.allianceID ||
        session.allianceid ||
        session._character && session._character.allianceID
      ),
    ) || 0,
    warFactionID: Number(
      session && (
        session.warFactionID ||
        session.warfactionid ||
        session._character && session._character.warFactionID
      ),
    ) || 0,
    fleetID,
  };
}

function resolveJetcanSessionFleetID(session) {
  const characterRecord = session && session._character ? session._character : {};
  const directFleetID = Number(
    session
      ? session.fleetid ?? session.fleetID ?? characterRecord.fleetid ?? characterRecord.fleetID
      : 0,
  ) || 0;
  if (directFleetID > 0) {
    return directFleetID;
  }

  const characterID = Number(
    session
      ? session.characterID ?? session.charid ?? characterRecord.characterID ?? characterRecord.charid
      : 0,
  ) || 0;
  if (characterID <= 0) {
    return 0;
  }

  try {
    const fleetRuntime = getFleetRuntime();
    if (fleetRuntime && typeof fleetRuntime.getSessionFleetState === "function") {
      const state = fleetRuntime.getSessionFleetState(session);
      const stateFleetID = Number(state && state.fleetid) || 0;
      if (stateFleetID > 0) {
        return stateFleetID;
      }
    }
    if (fleetRuntime && typeof fleetRuntime.getFleetForCharacter === "function") {
      const fleet = fleetRuntime.getFleetForCharacter(characterID);
      const runtimeFleetID = Number(fleet && fleet.fleetID) || 0;
      if (runtimeFleetID > 0) {
        return runtimeFleetID;
      }
    }
    const mappedFleetID = Number(
      fleetRuntime &&
      fleetRuntime.runtimeState &&
      fleetRuntime.runtimeState.characterToFleet instanceof Map
        ? fleetRuntime.runtimeState.characterToFleet.get(characterID)
        : 0,
    ) || 0;
    return mappedFleetID > 0 ? mappedFleetID : 0;
  } catch (_) {
    return 0;
  }
}

function buildJetcanLootCustomInfo(session) {
  const context = getJetcanSessionLootContext(session);
  const lootInfo = {};
  if (context.corporationID > 0) {
    lootInfo.corporationID = context.corporationID;
    lootInfo.lootRightCorpID = context.corporationID;
  }
  if (context.allianceID > 0) {
    lootInfo.allianceID = context.allianceID;
  }
  if (context.warFactionID > 0) {
    lootInfo.warFactionID = context.warFactionID;
  }
  if (context.fleetID > 0) {
    lootInfo.lootRightFleetID = context.fleetID;
  }
  return Object.keys(lootInfo).length > 0
    ? JSON.stringify({ evejsLoot: lootInfo })
    : "";
}

function buildNearbySpawnState(shipEntity, distanceMeters = 275) {
  const position = {
    x: Number(shipEntity && shipEntity.position && shipEntity.position.x || 0),
    y: Number(shipEntity && shipEntity.position && shipEntity.position.y || 0),
    z: Number(shipEntity && shipEntity.position && shipEntity.position.z || 0),
  };
  const direction = normalizeSpaceVector(
    shipEntity && shipEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  return {
    position: addVectors(position, scaleVector(direction, Math.max(50, Number(distanceMeters) || 275))),
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    mode: "STOP",
    speedFraction: 0,
  };
}

function syncChangesToSession(session, changes = [], options = {}) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    if (options.emitItemsChanged === true) {
      emitItemsChangedForSession(
        session,
        change.item,
        change.previousData || change.previousState || {},
        {
          idType: options.idType,
          locationContext: options.locationContext,
        },
      );
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      { emitCfgLocation: true },
    );
  }
}

function hydrateJetcanSessionContext(session, entity) {
  if (!entity) {
    return;
  }
  const context = getJetcanSessionLootContext(session);
  if (context.corporationID > 0) {
    entity.corporationID = context.corporationID;
    entity.lootRightCorpID = context.corporationID;
  }
  if (context.allianceID > 0) {
    entity.allianceID = context.allianceID;
  }
  if (context.warFactionID > 0) {
    entity.warFactionID = context.warFactionID;
  }
  entity.lootRightFleetID = context.fleetID > 0 ? context.fleetID : null;
}

function broadcastJetcanPresentation(session, systemID, containerID) {
  const scene = spaceRuntime.ensureScene(systemID);
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(systemID, containerID, {
    broadcast: false,
  });
  if (!spawnResult || !spawnResult.success) {
    return spawnResult || {
      success: false,
      errorMsg: "SPAWN_FAILED",
    };
  }

  const entity =
    spawnResult.data && spawnResult.data.entity
      ? spawnResult.data.entity
      : scene.getEntityByID(containerID);
  if (!entity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  hydrateJetcanSessionContext(session, entity);
  entity.deferLootRightsSlimUpdate = true;
  scene.broadcastAddBalls([entity], null, {
    freshAcquire: true,
  });
  entity.deferLootRightsSlimUpdate = false;
  scene.broadcastSpecialFx(entity.itemID, JETTISON_EFFECT_GUID, {
    moduleID: null,
    moduleTypeID: null,
    targetID: null,
    chargeTypeID: null,
    isOffensive: false,
    start: true,
    active: false,
    duration: -1,
    useCurrentVisibleStamp: true,
  }, entity);
  return {
    success: true,
    data: {
      entity,
    },
  };
}

function broadcastJetcanLootRightsSlimUpdate(session, systemID, containerID) {
  const scene = spaceRuntime.ensureScene(systemID);
  const entity = scene && scene.getEntityByID(containerID);
  if (!scene || !entity) {
    return false;
  }
  hydrateJetcanSessionContext(session, entity);
  entity.deferLootRightsSlimUpdate = false;
  scene.broadcastSlimItemChanges([entity]);
  return true;
}

// --- Public API ---

/**
 * After an item is removed from a space container, check whether the container
 * is now empty. If so, remove it from the DB and despawn it from the scene
 * immediately rather than waiting for the 2-hour expiry timer.
 *
 * Only acts on temporary space items (flagID=0 + expiresAtMs set), so
 * permanent structures/stations are never touched.
 *
 * @param {object} session - Active player session.
 * @param {number} containerID - The item ID of the container to check.
 */
function maybeExpireEmptySpaceContainer(session, containerID) {
  const numericID = Number(containerID) || 0;
  if (numericID <= 0) {
    return;
  }

  const container = findItemById(numericID);
  if (!container) {
    return;
  }

  // Only act on temporary space items (in space + has an expiry timer).
  if (Number(container.flagID) !== 0 || !container.expiresAtMs) {
    return;
  }

  // Check if any items remain inside, regardless of who owns them.
  const contents = listContainerItems(null, numericID, null);
  if (contents.length > 0) {
    return;
  }

  const systemID = Number(container.locationID) || 0;

  log.info(
    `[Jettison] Container ${numericID} is now empty — despawning early`,
  );

  const removeResult = removeInventoryItem(numericID, { removeContents: false });
  if (!removeResult.success) {
    log.warn(
      `[Jettison] Failed to remove empty container ${numericID}: ${removeResult.errorMsg}`,
    );
    return;
  }

  // Notify the client that the container item was removed.
  for (const change of (removeResult.data && removeResult.data.changes) || []) {
    if (!change || change.removed !== true || !change.previousData) {
      continue;
    }
    const removedState = buildRemovedJetcanNotificationState(change.previousData);
    if (!removedState) {
      continue;
    }
    emitItemsChangedForSession(
      session,
      removedState,
      change.previousData,
      { idType: "charid" },
    );
  }

  // Remove the space ball from the scene so all players stop seeing it.
  if (systemID > 0) {
    spaceRuntime.removeDynamicEntity(systemID, numericID, {
      terminalDestructionEffectID: JETCAN_DESTRUCTION_EFFECT_ID,
      persistSpaceState: false,
    });
  }
}

/**
 * Jettison the specified items from the character's active ship cargo into a
 * new Cargo Container spawned 275 m ahead of the ship.
 *
 * @param {object} session - Active player session with _space context.
 * @param {number[]} itemIDs - Item IDs to jettison (must be in ship cargo hold).
 * @returns {{ success: boolean, errorMsg?: string, jettisonedToCanIDs?: number[], containerID?: number }}
 */
function jettisonItemsForSession(session, itemIDs) {
  const characterID = Number(session && session.characterID) || 0;
  const space = session && session._space;
  const shipID = Number(space && space.shipID) || 0;
  const systemID = Number(space && space.systemID) || 0;

  if (!characterID || !shipID || !systemID) {
    log.warn("[Jettison] Session missing character/ship/system context");
    return { success: false, errorMsg: "INVALID_SESSION" };
  }

  if (!Array.isArray(itemIDs) || itemIDs.length === 0) {
    return { success: false, errorMsg: "NO_ITEMS" };
  }

  // Validate each item: must be owned by this character and in a
  // client-jettisonable ship hold.
  const validItems = [];
  for (const rawID of itemIDs) {
    const itemID = Number(rawID) || 0;
    if (itemID <= 0) {
      continue;
    }
    const item = findItemById(itemID);
    if (!item) {
      log.warn(`[Jettison] Item ${itemID} not found`);
      continue;
    }
    if (Number(item.ownerID) !== characterID) {
      log.warn(`[Jettison] Item ${itemID} not owned by char=${characterID}`);
      continue;
    }
    if (Number(item.locationID) !== shipID || !isJettisonableShipFlag(item.flagID)) {
      log.warn(
        `[Jettison] Item ${itemID} not in a jettisonable ship hold (locationID=${item.locationID}, flagID=${item.flagID})`,
      );
      continue;
    }
    validItems.push(item);
  }

  if (validItems.length === 0) {
    log.warn(`[Jettison] No valid cargo items to jettison for char=${characterID}`);
    return { success: false, errorMsg: "NO_VALID_ITEMS" };
  }

  // Resolve the container type.
  const containerLookup = resolveItemByName(JETCAN_CONTAINER_NAME);
  if (!containerLookup.success || !containerLookup.match) {
    log.warn(`[Jettison] Could not resolve container type "${JETCAN_CONTAINER_NAME}"`);
    return { success: false, errorMsg: "CONTAINER_TYPE_NOT_FOUND" };
  }

  // Create the container in space near the ship.
  const shipEntity = spaceRuntime.getEntity(session, shipID);
  const simTimeMs = spaceRuntime.getSimulationTimeMsForSession(session, Date.now());

  const createResult = createSpaceItemForCharacter(
    characterID,
    systemID,
    containerLookup.match,
    {
      ...buildNearbySpawnState(shipEntity, 275),
      createdAtMs: simTimeMs,
      expiresAtMs: simTimeMs + JETCAN_LIFETIME_MS,
      launcherID: shipID,
      customInfo: buildJetcanLootCustomInfo(session),
    },
  );

  if (!createResult.success || !createResult.data) {
    log.warn(`[Jettison] Container creation failed: ${createResult.errorMsg}`);
    return { success: false, errorMsg: "CONTAINER_CREATE_FAILED" };
  }

  const containerID = Number(createResult.data.itemID);

  // Retail presents the new ball and jettison FX before the cargo row moves
  // from the ship hold into the can.
  const presentationResult = broadcastJetcanPresentation(session, systemID, containerID);
  if (!presentationResult || !presentationResult.success) {
    log.warn(
      `[Jettison] Container ${containerID} presentation failed: ` +
      `${presentationResult && presentationResult.errorMsg || "SPAWN_FAILED"}`,
    );
    // Non-fatal: items are still moved into the DB container and the can can
    // be materialized by later visibility syncs.
  }

  // Move each valid item into the container.
  const jettisonedToCanIDs = [];
  for (const item of validItems) {
    const moveResult = moveItemToLocation(
      item.itemID,
      containerID,
      JETCAN_CONTENT_FLAG_ID,
    );
    if (!moveResult.success) {
      log.warn(
        `[Jettison] Failed to move item ${item.itemID} into container ${containerID}: ${moveResult.errorMsg}`,
      );
      continue;
    }
    jettisonedToCanIDs.push(item.itemID);
    syncChangesToSession(session, (moveResult.data && moveResult.data.changes) || [], {
      emitItemsChanged: true,
      idType: "shipid",
    });
  }

  broadcastJetcanLootRightsSlimUpdate(session, systemID, containerID);

  if (jettisonedToCanIDs.length === 0) {
    log.warn(`[Jettison] All item moves failed for container ${containerID}`);
    return { success: false, errorMsg: "MOVE_FAILED" };
  }

  log.info(
    `[Jettison] char=${characterID} jettisoned ${jettisonedToCanIDs.length} item(s) into container ${containerID} (expires in 2h)`,
  );

  return {
    success: true,
    jettisonedToCanIDs,
    containerID,
  };
}

module.exports = {
  JETCAN_LIFETIME_MS,
  JETTISONABLE_FLAG_IDS,
  jettisonItemsForSession,
  isJettisonableShipFlag,
  maybeExpireEmptySpaceContainer,
};
