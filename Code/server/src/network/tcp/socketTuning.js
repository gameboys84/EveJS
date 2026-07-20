// Applies TCP-level tuning to a freshly accepted game client socket.
//
// The presence systems (local chat membership, station/structure guest lists,
// online-status, the duplicate-login guard) all treat a session as "live" while
// its socket is not destroyed. An ungracefully dropped client (sleep, Wi-Fi
// drop, crash with no FIN/RST) leaves a half-open socket that Node never closes
// on its own, so the ghost session keeps showing the player as present and
// blocks their reconnection until OS-default keep-alive (~2h) finally trips.
//
// Enabling keep-alive makes the OS detect the dead peer in tens of seconds,
// which trips the socket's 'close'/'error' handler and runs the normal
// disconnect + presence-leave broadcast path.

function toNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : fallback;
}

/**
 * Configure keep-alive, Nagle, and an optional idle timeout on a client socket.
 *
 * @param {import("net").Socket} socket - the accepted client socket
 * @param {object} config - server config (config.socket* keys)
 * @param {object} [log] - optional logger with a warn() method
 * @returns {{keepAlive: boolean, keepAliveInitialDelayMs: number, noDelay: boolean, idleTimeoutMs: number}}
 */
function configureClientSocket(socket, config = {}, log = null) {
  if (!socket || typeof socket.setKeepAlive !== "function") {
    return {
      keepAlive: false,
      keepAliveInitialDelayMs: 0,
      noDelay: false,
      idleTimeoutMs: 0,
    };
  }

  const keepAliveEnabled = config.socketKeepAliveEnabled !== false;
  const keepAliveInitialDelayMs = toNonNegativeInteger(
    config.socketKeepAliveInitialDelayMs,
    30000,
  );
  if (keepAliveEnabled) {
    socket.setKeepAlive(true, keepAliveInitialDelayMs);
  }

  const noDelayEnabled = config.socketNoDelayEnabled !== false;
  if (noDelayEnabled && typeof socket.setNoDelay === "function") {
    socket.setNoDelay(true);
  }

  const idleTimeoutMs = toNonNegativeInteger(config.socketIdleTimeoutMs, 0);
  if (idleTimeoutMs > 0 && typeof socket.setTimeout === "function") {
    socket.setTimeout(idleTimeoutMs, () => {
      if (log && typeof log.warn === "function") {
        log.warn(
          `[TCP] Idle timeout (${idleTimeoutMs}ms) reached for ` +
            `${socket.remoteAddress}:${socket.remotePort}; destroying socket`,
        );
      }
      socket.destroy();
    });
  }

  return {
    keepAlive: keepAliveEnabled,
    keepAliveInitialDelayMs: keepAliveEnabled ? keepAliveInitialDelayMs : 0,
    noDelay: noDelayEnabled,
    idleTimeoutMs,
  };
}

module.exports = {
  configureClientSocket,
  toNonNegativeInteger,
};
