const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  OWNER_SCOPE,
  assertSessionCanAccessOwner,
  assertSessionCanMutateOwner,
  getCommunityFittingsResponse,
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
const {
  buildCachedMethodCallResult,
} = require(path.join(__dirname, "../cache/objectCacheRuntime"));

class CorpFittingMgrService extends BaseService {
  constructor() {
    super("corpFittingMgr");
  }

  Handle_GetFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CORPORATION);
    log.debug(`[CorpFittingMgr] GetFittings(${ownerID})`);
    assertSessionCanAccessOwner(session, ownerID, OWNER_SCOPE.CORPORATION);
    return buildCachedMethodCallResult(
      getOwnerFittingsResponse(ownerID, OWNER_SCOPE.CORPORATION),
      {
        serviceName: this.name,
        method: "GetFittings",
        args: [ownerID],
        versionCheck: "15 minutes",
      },
    );
  }

  Handle_GetCommunityFittings() {
    log.debug("[CorpFittingMgr] GetCommunityFittings");
    return buildCachedMethodCallResult(getCommunityFittingsResponse(), {
      serviceName: this.name,
      method: "GetCommunityFittings",
      versionCheck: "15 minutes",
    });
  }

  Handle_SaveFitting(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CORPORATION);
    log.debug(`[CorpFittingMgr] SaveFitting(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CORPORATION);
    const result = handleStoreResult(
      saveFitting(ownerID, args && args[1], OWNER_SCOPE.CORPORATION),
      (data) => data,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, result.fittingID], {
      ownerScope: OWNER_SCOPE.CORPORATION,
    });
    return result.fittingID;
  }

  Handle_UpdateFitting(args, session, kwargs) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CORPORATION);
    const fittingID = extractKwargValue(kwargs, "fittingID") ?? (args && args[2]);
    log.debug(`[CorpFittingMgr] UpdateFitting(${ownerID}, ${fittingID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CORPORATION);
    const updatedFittingID = handleStoreResult(
      updateFitting(ownerID, fittingID, args && args[1], OWNER_SCOPE.CORPORATION),
      (data) => data.fittingID,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, [updatedFittingID]], {
      ownerScope: OWNER_SCOPE.CORPORATION,
    });
    return updatedFittingID;
  }

  Handle_SaveManyFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CORPORATION);
    log.debug(`[CorpFittingMgr] SaveManyFittings(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CORPORATION);
    const mappings = handleStoreResult(
      saveManyFittings(ownerID, args && args[1], OWNER_SCOPE.CORPORATION),
      (data) => data,
    );
    for (const entry of Array.isArray(mappings) ? mappings : []) {
      const fittingID = entry && typeof entry === "object" ? Number(entry.realFittingID) || 0 : 0;
      if (fittingID > 0) {
        notifyFittingMutation(session, "OnFittingAdded", [ownerID, fittingID], {
          ownerScope: OWNER_SCOPE.CORPORATION,
        });
      }
    }
    return buildSaveManyResult(mappings);
  }

  Handle_DeleteFitting(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CORPORATION);
    log.debug(`[CorpFittingMgr] DeleteFitting(${ownerID}, ${args && args[1]})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CORPORATION);
    const deletedResult = handleStoreResult(
      deleteFitting(ownerID, args && args[1], OWNER_SCOPE.CORPORATION),
      () => null,
    );
    notifyFittingMutation(
      session,
      "OnFittingDeleted",
      [ownerID, Number(args && args[1]) || 0],
      { ownerScope: OWNER_SCOPE.CORPORATION },
    );
    return deletedResult;
  }

  Handle_DeleteManyFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.CORPORATION);
    log.debug(`[CorpFittingMgr] DeleteManyFittings(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CORPORATION);
    const deletedIDs = handleStoreResult(
      deleteManyFittings(ownerID, args && args[1], OWNER_SCOPE.CORPORATION),
      buildDeletedResult,
    );
    notifyFittingMutation(
      session,
      "OnManyFittingsDeleted",
      [ownerID, Array.isArray(deletedIDs && deletedIDs.items) ? deletedIDs.items : []],
      { ownerScope: OWNER_SCOPE.CORPORATION },
    );
    return deletedIDs;
  }

  Handle_UpdateNameAndDescription(args, session) {
    const fittingID = args && args[0];
    const ownerID = args && args[1];
    log.debug(`[CorpFittingMgr] UpdateNameAndDescription(${ownerID}, ${fittingID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.CORPORATION);
    const updatedResult = handleStoreResult(
      updateFittingNameAndDescription(
        fittingID,
        ownerID,
        args && args[2],
        args && args[3],
        OWNER_SCOPE.CORPORATION,
      ),
      () => null,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, [Number(fittingID) || 0]], {
      ownerScope: OWNER_SCOPE.CORPORATION,
    });
    return updatedResult;
  }
}

module.exports = CorpFittingMgrService;
