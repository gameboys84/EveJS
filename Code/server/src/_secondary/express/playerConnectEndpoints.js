// Token-gated helper endpoints consumed by the PlayerConnect bundle handed to
// players. Mounted on the public proxy app (default :26002) so a remote player
// can (a) ping the server before pressing Play and (b) download the current CA
// so cert rotation needs no re-bundling. Both routes require the shared
// `playerConnectToken` (constant-time compared); when the token is unset the
// endpoints are disabled (503).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");

const config = require("../../config");

const CA_CERT_PATH = path.join(__dirname, "../../../certs/xmpp-ca-cert.pem");
const CLIENT_START_INI_PATH = path.join(
  __dirname,
  "../../../../client/EVE/tq/start.ini",
);

// Resolve the effective token: the in-memory value the process booted with,
// else a live-read fallback. Split out so it can be unit-tested without global
// config/env mutation.
function resolveConfiguredToken(inMemoryToken, readLiveToken) {
  const inMemory = String(inMemoryToken || "").trim();
  if (inMemory) {
    return inMemory;
  }
  try {
    return String(readLiveToken() || "").trim();
  } catch (error) {
    return "";
  }
}

// Live re-read of the token from the config files so a token set AFTER the
// server booted (e.g. by the PlayerConnect bundle GUI, which writes it into the
// local config) is honored without a restart. getConfigStateSnapshot only reads
// + merges the config files, so this is safe per request. Swappable for tests.
function defaultLiveTokenReader() {
  const snapshot = config.getConfigStateSnapshot();
  return (
    snapshot && snapshot.resolvedConfig && snapshot.resolvedConfig.playerConnectToken
  );
}

let liveTokenReader = defaultLiveTokenReader;

function getConfiguredToken() {
  // Fast path uses the value the process started with (env var or config file
  // at boot); the reader above is the no-restart fallback.
  return resolveConfiguredToken(config && config.playerConnectToken, liveTokenReader);
}

function isTokenValid(providedToken, configuredToken) {
  const configured = String(configuredToken || "");
  const provided = String(providedToken || "");
  if (!configured) {
    return false;
  }
  const configuredBuffer = Buffer.from(configured, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (configuredBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(configuredBuffer, providedBuffer);
}

function extractProvidedToken(req) {
  const queryToken = req && req.query && req.query.token;
  if (typeof queryToken === "string" && queryToken) {
    return queryToken;
  }
  const headerToken = req && req.headers && req.headers["x-playerconnect-token"];
  if (typeof headerToken === "string" && headerToken) {
    return headerToken;
  }
  return "";
}

// Returns true when the caller may proceed; otherwise writes the 503/401 error
// response and returns false.
function authorizeRequest(req, res) {
  const configuredToken = getConfiguredToken();
  if (!configuredToken) {
    res.status(503).json({ ok: false, error: "playerconnect_disabled" });
    return false;
  }
  if (!isTokenValid(extractProvidedToken(req), configuredToken)) {
    res.status(401).json({ ok: false, error: "invalid_token" });
    return false;
  }
  return true;
}

function readCaBuffer() {
  try {
    return fs.readFileSync(CA_CERT_PATH);
  } catch (error) {
    return null;
  }
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readClientBuild() {
  try {
    const content = fs.readFileSync(CLIENT_START_INI_PATH, "utf8");
    const match = /^\s*build\s*=\s*(.+?)\s*$/im.exec(content);
    return match ? match[1].trim() : null;
  } catch (error) {
    return null;
  }
}

function getXmppHost() {
  try {
    const { getXmppConnectHost } = require("../../services/chat/xmppConfig");
    return getXmppConnectHost();
  } catch (error) {
    return null;
  }
}

function probeGamePort(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const numericPort = Number(port) || 0;
    if (!numericPort) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch (error) {
        // ignore
      }
      resolve(value);
    };
    const socket = net.connect({ host: "127.0.0.1", port: numericPort });
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function mountPlayerConnectEndpoints(app) {
  if (!app || typeof app.get !== "function") {
    return;
  }

  app.get("/playerconnect/health", async (req, res) => {
    if (!authorizeRequest(req, res)) {
      return;
    }

    const caBuffer = readCaBuffer();
    const gamePort = Number((config && config.serverPort) || 26000) || 26000;
    let gamePortOpen = false;
    try {
      gamePortOpen = await probeGamePort(gamePort);
    } catch (error) {
      gamePortOpen = false;
    }

    res.status(200).json({
      ok: true,
      service: "playerconnect",
      build: readClientBuild(),
      xmppHost: getXmppHost(),
      gamePort,
      gamePortOpen,
      caSha256: caBuffer ? sha256Hex(caBuffer) : null,
      time: new Date().toISOString(),
    });
  });

  app.get("/playerconnect/ca.pem", (req, res) => {
    if (!authorizeRequest(req, res)) {
      return;
    }

    const caBuffer = readCaBuffer();
    if (!caBuffer) {
      res.status(404).json({ ok: false, error: "ca_not_found" });
      return;
    }

    res.setHeader("Content-Type", "application/x-pem-file");
    res.setHeader("x-evejs-ca-sha256", sha256Hex(caBuffer));
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="evejs-ca-cert.pem"',
    );
    res.status(200).send(caBuffer);
  });
}

module.exports = {
  mountPlayerConnectEndpoints,
  __test__: {
    isTokenValid,
    extractProvidedToken,
    resolveConfiguredToken,
    sha256Hex,
    CA_CERT_PATH,
    setLiveTokenReader(fn) {
      liveTokenReader = typeof fn === "function" ? fn : defaultLiveTokenReader;
    },
    resetLiveTokenReader() {
      liveTokenReader = defaultLiveTokenReader;
    },
  },
};
