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

class AllianceFittingMgrService extends BaseService {
  constructor() {
    super("allianceFittingMgr");
  }

  Handle_GetFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.ALLIANCE);
    log.debug(`[AllianceFittingMgr] GetFittings(${ownerID})`);
    assertSessionCanAccessOwner(session, ownerID, OWNER_SCOPE.ALLIANCE);
    return getOwnerFittingsResponse(ownerID, OWNER_SCOPE.ALLIANCE);
  }

  Handle_SaveFitting(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.ALLIANCE);
    log.debug(`[AllianceFittingMgr] SaveFitting(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.ALLIANCE);
    const result = handleStoreResult(
      saveFitting(ownerID, args && args[1], OWNER_SCOPE.ALLIANCE),
      (data) => data,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, result.fittingID], {
      ownerScope: OWNER_SCOPE.ALLIANCE,
    });
    return result.fittingID;
  }

  Handle_UpdateFitting(args, session, kwargs) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.ALLIANCE);
    const fittingID = extractKwargValue(kwargs, "fittingID") ?? (args && args[2]);
    log.debug(`[AllianceFittingMgr] UpdateFitting(${ownerID}, ${fittingID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.ALLIANCE);
    const updatedFittingID = handleStoreResult(
      updateFitting(ownerID, fittingID, args && args[1], OWNER_SCOPE.ALLIANCE),
      (data) => data.fittingID,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, [updatedFittingID]], {
      ownerScope: OWNER_SCOPE.ALLIANCE,
    });
    return updatedFittingID;
  }

  Handle_SaveManyFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.ALLIANCE);
    log.debug(`[AllianceFittingMgr] SaveManyFittings(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.ALLIANCE);
    const mappings = handleStoreResult(
      saveManyFittings(ownerID, args && args[1], OWNER_SCOPE.ALLIANCE),
      (data) => data,
    );
    for (const entry of Array.isArray(mappings) ? mappings : []) {
      const fittingID = entry && typeof entry === "object" ? Number(entry.realFittingID) || 0 : 0;
      if (fittingID > 0) {
        notifyFittingMutation(session, "OnFittingAdded", [ownerID, fittingID], {
          ownerScope: OWNER_SCOPE.ALLIANCE,
        });
      }
    }
    return buildSaveManyResult(mappings);
  }

  Handle_DeleteFitting(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.ALLIANCE);
    log.debug(`[AllianceFittingMgr] DeleteFitting(${ownerID}, ${args && args[1]})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.ALLIANCE);
    const deletedResult = handleStoreResult(
      deleteFitting(ownerID, args && args[1], OWNER_SCOPE.ALLIANCE),
      () => null,
    );
    notifyFittingMutation(
      session,
      "OnFittingDeleted",
      [ownerID, Number(args && args[1]) || 0],
      { ownerScope: OWNER_SCOPE.ALLIANCE },
    );
    return deletedResult;
  }

  Handle_DeleteManyFittings(args, session) {
    const ownerID = resolveRequestedOwnerID(args, session, OWNER_SCOPE.ALLIANCE);
    log.debug(`[AllianceFittingMgr] DeleteManyFittings(${ownerID})`);
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.ALLIANCE);
    const deletedIDs = handleStoreResult(
      deleteManyFittings(ownerID, args && args[1], OWNER_SCOPE.ALLIANCE),
      buildDeletedResult,
    );
    notifyFittingMutation(
      session,
      "OnManyFittingsDeleted",
      [ownerID, Array.isArray(deletedIDs && deletedIDs.items) ? deletedIDs.items : []],
      { ownerScope: OWNER_SCOPE.ALLIANCE },
    );
    return deletedIDs;
  }

  Handle_UpdateNameAndDescription(args, session) {
    const fittingID = args && args[0];
    const ownerID = args && args[1];
    log.debug(
      `[AllianceFittingMgr] UpdateNameAndDescription(${ownerID}, ${fittingID})`,
    );
    assertSessionCanMutateOwner(session, ownerID, OWNER_SCOPE.ALLIANCE);
    const updatedResult = handleStoreResult(
      updateFittingNameAndDescription(
        fittingID,
        ownerID,
        args && args[2],
        args && args[3],
        OWNER_SCOPE.ALLIANCE,
      ),
      () => null,
    );
    notifyFittingMutation(session, "OnFittingAdded", [ownerID, [Number(fittingID) || 0]], {
      ownerScope: OWNER_SCOPE.ALLIANCE,
    });
    return updatedResult;
  }
}

module.exports = AllianceFittingMgrService;
