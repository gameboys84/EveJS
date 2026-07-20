// Presence reconciler — the safety net for live "who is here" state.
//
// Local-chat membership and chat-window rosters are delivered as fire-and-forget
// push deltas off discrete transition points (dock/undock/jump/login/logout).
// There is no per-client acknowledgement and no replay, so a dropped delta can
// leave an observer out of sync until they organically re-pull.
//
// This module periodically re-pushes authoritative state computed live from the
// session registry, so a missed delta self-heals within one tick:
//   - chat: re-publish each character's full local-membership snapshot (the same
//           payload the client requests on demand — a set-based idempotent
//           full-list replacement, so re-pushing never duplicates a member).
//   - xmpp: re-assert each character's MUC room presence so chat-window rosters
//           (local/corp/fleet/alliance/militia) self-heal a missed join.
//
// Station/structure guest lists are deliberately NOT reconciled here. The docked
// guest panel appends each OnCharNowInStation / OnCharacterEnteredStructure to its
// visible scroll WITHOUT de-duping by character (GuestList.add fires
// on_guest_added unconditionally), so re-broadcasting a join the observer already
// has produces a duplicate row that grows every tick. Station/structure guests
// instead self-heal through the client's authoritative GetGuests pull on dock /
// guest-panel load, plus the one-time discrete dock/undock deltas.

const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const chatRuntime = require(path.join(
  __dirname,
  "../../_secondary/chat/chatRuntime",
));

let reconcileTimer = null;

function resolveCharacterID(session) {
  return Number(session && (session.characterID || session.charid)) || 0;
}

// Resolved lazily (and only when XMPP reconciliation actually runs) so the
// reconciler does not pull in the heavy XMPP stub module unless it is needed.
function resolveXmppReassert() {
  try {
    return require("../chat/xmppStubServer").reassertSessionRoomPresence;
  } catch (error) {
    log.debug(`[PresenceReconcile] xmpp reassert unavailable: ${error.message}`);
    return null;
  }
}

function buildDefaultDeps() {
  return {
    getSessions: () => sessionRegistry.getSessions(),
    publishLocalMembershipListForSession: (session) =>
      chatRuntime.publishLocalMembershipListForSession(session),
    chatEnabled: config.presenceReconcileChatEnabled !== false,
    xmppEnabled: config.presenceReconcileXmppEnabled !== false,
    reassertXmppRoomPresence: null,
  };
}

/**
 * Run one reconciliation pass. Accepts dependency overrides for testing.
 * @returns {{sessions:number, chatSnapshots:number, xmppReasserts:number}}
 */
function reconcileOnce(depsOverride = {}) {
  const deps = { ...buildDefaultDeps(), ...depsOverride };
  const sessions = (deps.getSessions() || []).filter(
    (session) => resolveCharacterID(session) > 0,
  );

  let chatSnapshots = 0;
  let xmppReasserts = 0;

  if (deps.chatEnabled) {
    for (const session of sessions) {
      try {
        deps.publishLocalMembershipListForSession(session);
        chatSnapshots += 1;
      } catch (error) {
        log.debug(
          `[PresenceReconcile] chat snapshot failed char=${resolveCharacterID(session)}: ${error.message}`,
        );
      }
    }
  }

  if (deps.xmppEnabled) {
    const reassert = deps.reassertXmppRoomPresence || resolveXmppReassert();
    if (typeof reassert === "function") {
      for (const session of sessions) {
        try {
          if (reassert(session)) {
            xmppReasserts += 1;
          }
        } catch (error) {
          log.debug(
            `[PresenceReconcile] xmpp reassert failed char=${resolveCharacterID(session)}: ${error.message}`,
          );
        }
      }
    }
  }

  return {
    sessions: sessions.length,
    chatSnapshots,
    xmppReasserts,
  };
}

function start(options = {}) {
  if (reconcileTimer) {
    return reconcileTimer;
  }

  const intervalMs = Math.max(
    0,
    Number(
      options.intervalMs !== undefined
        ? options.intervalMs
        : config.presenceReconcileIntervalMs,
    ) || 0,
  );
  if (intervalMs <= 0) {
    log.debug("[PresenceReconcile] disabled (intervalMs <= 0)");
    return null;
  }

  reconcileTimer = setInterval(() => {
    try {
      reconcileOnce();
    } catch (error) {
      log.warn(`[PresenceReconcile] tick failed: ${error.message}`);
    }
  }, intervalMs);
  if (typeof reconcileTimer.unref === "function") {
    reconcileTimer.unref();
  }

  log.info(
    `[PresenceReconcile] started interval=${intervalMs}ms ` +
      `chat=${config.presenceReconcileChatEnabled !== false} ` +
      `xmpp=${config.presenceReconcileXmppEnabled !== false}`,
  );
  return reconcileTimer;
}

function stop() {
  if (!reconcileTimer) {
    return false;
  }
  clearInterval(reconcileTimer);
  reconcileTimer = null;
  return true;
}

module.exports = {
  reconcileOnce,
  start,
  stop,
};
