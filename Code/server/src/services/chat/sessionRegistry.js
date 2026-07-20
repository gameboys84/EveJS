// Live session registry — the single source of truth for "who is connected".
//
// In addition to the membership Set, an eager characterID -> sessions index is
// maintained so the hot presence lookups (gateway notice routing, online status,
// XMPP client matching, the duplicate-login guard) resolve in O(1) instead of an
// O(N) scan per call. The index is kept complete by:
//   - register(): indexes a session that already carries a characterID,
//   - applyCharacterToSession()/clearCharacterFromSession(): call
//     indexCharacterSession()/deindexCharacterSession() when binding/clearing,
//   - unregister(): removes the session from its bucket.
// findSessionByCharacterID() still falls back to a full scan when the bucket is
// empty, so a session whose characterID was ever set outside those hooks is
// never missed — the index only accelerates, it never changes results.

const sessions = new Set();
const sessionsByCharacterID = new Map(); // characterID -> Set<session>
const characterIDBySession = new Map(); // session -> characterID it is indexed under

function isLiveSession(session) {
  return Boolean(session && session.socket && !session.socket.destroyed);
}

function toSessionTimestamp(value) {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function resolveSessionCharacterID(session) {
  if (!session) {
    return 0;
  }

  return Number(
    session.characterID ||
    session.charID ||
    session.charid ||
    0,
  ) || 0;
}

function isPreferredCharacterSession(candidate, current) {
  if (!candidate) {
    return false;
  }
  if (!current) {
    return true;
  }

  const candidateLastActivity = toSessionTimestamp(candidate.lastActivity);
  const currentLastActivity = toSessionTimestamp(current.lastActivity);
  if (candidateLastActivity !== currentLastActivity) {
    return candidateLastActivity > currentLastActivity;
  }

  const candidateConnectTime = toSessionTimestamp(candidate.connectTime);
  const currentConnectTime = toSessionTimestamp(current.connectTime);
  if (candidateConnectTime !== currentConnectTime) {
    return candidateConnectTime > currentConnectTime;
  }

  const candidateClientID = Number(candidate.clientID || candidate.clientId || 0) || 0;
  const currentClientID = Number(current.clientID || current.clientId || 0) || 0;
  return candidateClientID >= currentClientID;
}

function addToIndex(session, characterID) {
  let bucket = sessionsByCharacterID.get(characterID);
  if (!bucket) {
    bucket = new Set();
    sessionsByCharacterID.set(characterID, bucket);
  }
  bucket.add(session);
  characterIDBySession.set(session, characterID);
}

function removeFromIndex(session) {
  const previousCharacterID = characterIDBySession.get(session);
  if (previousCharacterID === undefined) {
    return;
  }
  characterIDBySession.delete(session);
  const bucket = sessionsByCharacterID.get(previousCharacterID);
  if (!bucket) {
    return;
  }
  bucket.delete(session);
  if (bucket.size === 0) {
    sessionsByCharacterID.delete(previousCharacterID);
  }
}

function indexCharacterSession(session) {
  if (!session) {
    return;
  }
  const characterID = resolveSessionCharacterID(session);
  if (characterIDBySession.get(session) === characterID) {
    return;
  }
  removeFromIndex(session);
  if (characterID > 0) {
    addToIndex(session, characterID);
  }
}

function deindexCharacterSession(session) {
  removeFromIndex(session);
}

function register(session) {
  if (session) {
    sessions.add(session);
    indexCharacterSession(session);
  }
}

function unregister(session) {
  if (session) {
    sessions.delete(session);
    removeFromIndex(session);
  }
}

function getSessions() {
  return Array.from(sessions).filter(isLiveSession);
}

function selectPreferredFrom(candidates, targetCharacterID, excludedSession) {
  let selectedSession = null;
  for (const session of candidates) {
    if (
      session === excludedSession ||
      !isLiveSession(session) ||
      resolveSessionCharacterID(session) !== targetCharacterID
    ) {
      continue;
    }
    if (isPreferredCharacterSession(session, selectedSession)) {
      selectedSession = session;
    }
  }
  return selectedSession;
}

function findSessionByCharacterID(characterID, options = {}) {
  const targetCharacterID = Number(characterID || 0);
  if (!Number.isInteger(targetCharacterID) || targetCharacterID <= 0) {
    return null;
  }

  const excludedSession = options.excludeSession || null;

  const bucket = sessionsByCharacterID.get(targetCharacterID);
  if (bucket && bucket.size > 0) {
    const indexed = selectPreferredFrom(bucket, targetCharacterID, excludedSession);
    if (indexed) {
      return indexed;
    }
  }

  // Defensive fallback: covers any session whose characterID was set without
  // passing through the index hooks. Keeps results identical to a full scan.
  return selectPreferredFrom(getSessions(), targetCharacterID, excludedSession);
}

module.exports = {
  register,
  unregister,
  getSessions,
  findSessionByCharacterID,
  indexCharacterSession,
  deindexCharacterSession,
  resolveSessionCharacterID,
  isPreferredCharacterSession,
};
