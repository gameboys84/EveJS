const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  OWNER_SCOPE,
  assertSessionCanAccessOwner,
  assertSessionCanMutateOwner,
  getOwnerFittingsResponse,
  saveFitting,
  saveManyFittings,
  updateFitting,
  updateFittingNameAndDescription,
  deleteFitting,
  deleteManyFittings,
} = require(path.join(__dirname, "../../_secondary/fitting/fittingStore"));
const {
  buildDeletedResult,
  buildSaveManyResult,
  extractKwargValue,
  handleStoreResult,
  notifyFittingMutation,
  resolveRequestedOwnerID,
} = require(path.join(__dirname, "./fittingMgrServiceHelpers"));

class CharFittingMgrService extends BaseService {
  constructor() {
    super("charFittingMgr");
  }

  Handle_GetFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CHARACTER);
    log.debug(`[CharFittingMgr] GetFittings(${ownerID})`);
    assertSessionCanAccessOwner(session, ownerID, OWNER_SCOPE.CHARACTER);
    return getOwnerFittingsResponse(ownerID, OWNER_SCOPE.CHARACTER);
  }

  Handle_SaveFitting(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CHARACTER);
    log.debug(`[CharFittingMgr] SaveFitting(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CHARACTER);
    const result = handleStoreResult(
      saveFitting(ownerID, args && args[1], OWNER_SCOPE.CHARACTER),
      (data) => data,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, result.fittingID], {
      ownerScope: OWNER_SCOPE.CHARACTER,
    });
    return result.fittingID;
  }

  Handle_UpdateFitting(args, session, kwargs) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CHARACTER);
    const fittingID = extractKwargValue(kwargs, "fittingID") ?? (args && args[2]);
    log.debug(`[CharFittingMgr] UpdateFitting(${ownerID}, ${fittingID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CHARACTER);
    const updatedFittingID = handleStoreResult(
      updateFitting(ownerID, fittingID, args && args[1], OWNER_SCOPE.CHARACTER),
      (data) => data.fittingID,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, [updatedFittingID]], {
      ownerScope: OWNER_SCOPE.CHARACTER,
    });
    return updatedFittingID;
  }

  Handle_SaveManyFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CHARACTER);
    log.debug(`[CharFittingMgr] SaveManyFittings(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CHARACTER);
    const mappings = handleStoreResult(
      saveManyFittings(ownerID, args && args[1], OWNER_SCOPE.CHARACTER),
      (data) => data,
    );
    for (const entry of Array.isArray(mappings) ? mappings : []) {
      const fittingID = entry && typeof entry === "object" ? Number(entry.realFittingID) || 0 : 0;
      if (fittingID > 0) {
        notifyFittingMutation(session, "OnFittingAdded", [ownerID, fittingID], {
          ownerScope: OWNER_SCOPE.CHARACTER,
        });
      }
    }
    return buildSaveManyResult(mappings);
  }

  Handle_DeleteFitting(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CHARACTER);
    log.debug(`[CharFittingMgr] DeleteFitting(${ownerID}, ${args && args[1]})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CHARACTER);
    const deletedResult = handleStoreResult(
      deleteFitting(ownerID, args && args[1], OWNER_SCOPE.CHARACTER),
      () => null,
    );
    notifyFittingMutation(
      session,
      "OnFittingDeleted",
      [ownerID, Number(args && args[1]) || 0],
      { ownerScope: OWNER_SCOPE.CHARACTER },
    );
    return deletedResult;
  }

  Handle_DeleteManyFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CHARACTER);
    log.debug(`[CharFittingMgr] DeleteManyFittings(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CHARACTER);
    const deletedIDs = handleStoreResult(
      deleteManyFittings(ownerID, args && args[1], OWNER_SCOPE.CHARACTER),
      buildDeletedResult,
    );
    notifyFittingMutation(
      session,
      "OnManyFittingsDeleted",
      [ownerID, Array.isArray(deletedIDs && deletedIDs.items) ? deletedIDs.items : []],
      { ownerScope: OWNER_SCOPE.CHARACTER },
    );
    return deletedIDs;
  }

  Handle_UpdateNameAndDescription(args, session) {
    const fittingID = args && args[0];
    const ownerID = args && args[1];
    log.debug(`[CharFittingMgr] UpdateNameAndDescription(${ownerID}, ${fittingID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CHARACTER);
    const updatedResult = handleStoreResult(
      updateFittingNameAndDescription(
        fittingID,
        ownerID,
        args && args[2],
        args && args[3],
        OWNER_SCOPE.CHARACTER,
      ),
      () => null,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, [Number(fittingID) || 0]], {
      ownerScope: OWNER_SCOPE.CHARACTER,
    });
    return updatedResult;
  }
}

module.exports = CharFittingMgrService;
