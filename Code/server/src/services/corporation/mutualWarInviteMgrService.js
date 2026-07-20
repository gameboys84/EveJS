const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  createWarRecord,
  processWarLifecycle,
} = require(path.join(__dirname, "./warRuntimeState"));
const {
  ensureRuntimeInitialized,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  isMutualWarInviteBlocked,
  setMutualWarInviteBlocked,
} = require(path.join(__dirname, "./warNegotiationRuntimeState"));
const {
  notifyMadeWarMutual,
  notifyMutualWarInviteAccepted,
  notifyMutualWarInviteRejected,
  notifyMutualWarInviteSent,
} = require(path.join(__dirname, "./warNotificationCenter"));

function resolveOwnerID(session) {
  return (
    (session &&
      ((session.allianceID || session.allianceid) ||
        (session.corporationID || session.corpid))) ||
    0
  );
}

function resolveCharacterID(session) {
  return Number(session && (session.characterID || session.charid)) || 0;
}

function sessionMatchesOwner(session, ownerID) {
  const numericOwnerID = Number(ownerID) || 0;
  return Boolean(
    numericOwnerID &&
      session &&
      (Number(session.allianceID || session.allianceid) === numericOwnerID ||
        Number(session.corporationID || session.corpid) === numericOwnerID),
  );
}

function notifyMutualWarsUpdated(ownerIDs = []) {
  const normalizedOwnerIDs = [...new Set(ownerIDs.map((ownerID) => Number(ownerID) || 0))]
    .filter(Boolean);
  if (normalizedOwnerIDs.length <= 0) {
    return;
  }
  for (const session of sessionRegistry.getSessions()) {
    if (!normalizedOwnerIDs.some((ownerID) => sessionMatchesOwner(session, ownerID))) {
      continue;
    }
    if (typeof session.sendNotification === "function") {
      session.sendNotification("OnMutualWarsUpdated_Remote", "clientID", []);
    }
  }
}

function buildInvitePayload(invite) {
  return buildKeyVal([
    ["fromOwnerID", Number(invite && invite.fromOwnerID ? invite.fromOwnerID : 0)],
    ["toOwnerID", Number(invite && invite.toOwnerID ? invite.toOwnerID : 0)],
    [
      "sentDate",
      buildFiletimeLong(invite && invite.sentDate ? invite.sentDate : currentFileTime()),
    ],
  ]);
}

class MutualWarInviteManagerService extends BaseService {
  constructor() {
    super("mutualWarInviteMgr");
  }

  Handle_GetPendingInvitesForSession(args, session) {
    processWarLifecycle();
    const ownerID = resolveOwnerID(session);
    const runtime = ensureRuntimeInitialized();
    return buildList(
      Object.values(runtime.mutualWarInvites || {})
        .filter(
          (invite) =>
            Number(invite.fromOwnerID) === Number(ownerID) ||
            Number(invite.toOwnerID) === Number(ownerID),
        )
        .sort((left, right) => {
          const leftSentDate = BigInt(String(left && left.sentDate ? left.sentDate : "0"));
          const rightSentDate = BigInt(String(right && right.sentDate ? right.sentDate : "0"));
          if (leftSentDate === rightSentDate) {
            return 0;
          }
          return rightSentDate > leftSentDate ? 1 : -1;
        })
        .map((invite) => buildInvitePayload(invite)),
    );
  }

  Handle_SendInviteByPlayer(args, session) {
    const toOwnerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const fromOwnerID = resolveOwnerID(session);
    if (!fromOwnerID || !toOwnerID || isMutualWarInviteBlocked(toOwnerID)) {
      return null;
    }
    const sentAt = currentFileTime();
    updateRuntimeState((runtime) => {
      runtime.mutualWarInvites =
        runtime.mutualWarInvites && typeof runtime.mutualWarInvites === "object"
          ? runtime.mutualWarInvites
          : {};
      runtime.mutualWarInvites[`${fromOwnerID}:${toOwnerID}`] = {
        fromOwnerID,
        toOwnerID,
        sentDate: sentAt.toString(),
      };
      return runtime;
    });
    notifyMutualWarInviteSent({
      fromOwnerID,
      toOwnerID,
      sentDate: sentAt,
    });
    notifyMutualWarsUpdated([fromOwnerID, toOwnerID]);
    return null;
  }

  Handle_WithdrawInviteByPlayer(args, session) {
    const toOwnerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const fromOwnerID = resolveOwnerID(session);
    updateRuntimeState((runtime) => {
      runtime.mutualWarInvites =
        runtime.mutualWarInvites && typeof runtime.mutualWarInvites === "object"
          ? runtime.mutualWarInvites
          : {};
      delete runtime.mutualWarInvites[`${fromOwnerID}:${toOwnerID}`];
      return runtime;
    });
    notifyMutualWarsUpdated([fromOwnerID, toOwnerID]);
    return null;
  }

  Handle_RespondToInviteByPlayer(args, session) {
    const fromOwnerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const accepts = Boolean(args && args.length > 1 ? args[1] : false);
    const toOwnerID = resolveOwnerID(session);
    updateRuntimeState((runtime) => {
      runtime.mutualWarInvites =
        runtime.mutualWarInvites && typeof runtime.mutualWarInvites === "object"
          ? runtime.mutualWarInvites
          : {};
      delete runtime.mutualWarInvites[`${fromOwnerID}:${toOwnerID}`];
      return runtime;
    });
    if (accepts && fromOwnerID && toOwnerID) {
      const acceptedAt = currentFileTime();
      createWarRecord({
        declaredByID: fromOwnerID,
        againstID: toOwnerID,
        mutual: true,
        timeDeclared: acceptedAt,
        timeStarted: acceptedAt,
      });
      notifyMutualWarInviteAccepted({
        fromOwnerID,
        toOwnerID,
        time: acceptedAt,
      });
      notifyMadeWarMutual({
        fromOwnerID,
        toOwnerID,
        characterID: resolveCharacterID(session),
      });
    } else if (fromOwnerID && toOwnerID) {
      notifyMutualWarInviteRejected({ fromOwnerID, toOwnerID });
    }
    notifyMutualWarsUpdated([fromOwnerID, toOwnerID]);
    return null;
  }

  Handle_SetInvitesBlockedByPlayer(args, session) {
    const blocked = Boolean(args && args.length > 0 ? args[0] : false);
    const ownerID = resolveOwnerID(session);
    setMutualWarInviteBlocked(ownerID, blocked);
    notifyMutualWarsUpdated([ownerID]);
    return null;
  }

  Handle_IsCorpInvitesBlockedPlayer(args, session) {
    return isMutualWarInviteBlocked(resolveOwnerID(session)) ? 1 : 0;
  }
}

module.exports = MutualWarInviteManagerService;
