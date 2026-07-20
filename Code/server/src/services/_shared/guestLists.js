const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  getSessionStationID,
  getSessionStructureID,
} = require(path.join(__dirname, "../structure/structureLocation"));

function normalizePositiveInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function buildGuestIdentityTuple(session) {
  return [
    normalizePositiveInt(
      session && (session.characterID || session.charid),
      0,
    ),
    normalizePositiveInt(
      session && (session.corporationID || session.corpid),
      0,
    ),
    normalizePositiveInt(
      session && (session.allianceID || session.allianceid),
      0,
    ),
    normalizePositiveInt(
      session && (session.warFactionID || session.warfactionid),
      0,
    ),
  ];
}

function getGuestCharacterID(session) {
  return buildGuestIdentityTuple(session)[0];
}

function buildStructureGuestTuple(session) {
  const [, corporationID, allianceID, warFactionID] = buildGuestIdentityTuple(session);
  return [corporationID, allianceID, warFactionID];
}

// Per-observer record of which guest characterIDs the server has already told
// each observer's client are co-located, keyed by the observer's live session.
//
// The docked guest panel (eve/.../dockedUI/guests.py) appends every
// OnCharNowInStation / OnCharacterEnteredStructure to its visible scroll WITHOUT
// de-duping by character, and its removal walks the live node list while mutating
// it (BasicDynamicScroll.GetNodes returns the backing list) so it cannot reliably
// clear duplicate rows. We therefore must never send an observer a join for a
// character it already shows. This ledger is the authority for that: it is seeded
// from the authoritative GetGuests pull (what the client just rebuilt its list
// from) and then only genuine add/remove transitions are pushed. Node is single
// threaded, so seeding and diffing never interleave.
const observerGuestLedger = new WeakMap();

function resolveObserverLedger(observerSession, locationID) {
  const resolvedLocationID = normalizePositiveInt(locationID, 0);
  let entry = observerGuestLedger.get(observerSession);
  if (!entry || entry.locationID !== resolvedLocationID) {
    entry = { locationID: resolvedLocationID, guests: new Set() };
    observerGuestLedger.set(observerSession, entry);
  }
  return entry;
}

function seedObserverGuestLedger(observerSession, locationID, characterIDs = []) {
  const resolvedLocationID = normalizePositiveInt(locationID, 0);
  if (!observerSession || !resolvedLocationID) {
    return;
  }
  observerGuestLedger.set(observerSession, {
    locationID: resolvedLocationID,
    guests: new Set(
      (Array.isArray(characterIDs) ? characterIDs : [])
        .map((value) => normalizePositiveInt(value, 0))
        .filter((value) => value > 0),
    ),
  });
}

function forgetObserverGuestLedger(observerSession) {
  if (observerSession) {
    observerGuestLedger.delete(observerSession);
  }
}

function collectPreferredSessionsByCharacter(sessions = []) {
  const preferredSessions = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const [characterID] = buildGuestIdentityTuple(session);
    if (!characterID) {
      continue;
    }
    const currentSession = preferredSessions.get(characterID) || null;
    if (sessionRegistry.isPreferredCharacterSession(session, currentSession)) {
      preferredSessions.set(characterID, session);
    }
  }
  return [...preferredSessions.values()];
}

function getStationGuestTuples(stationID) {
  const resolvedStationID = normalizePositiveInt(stationID, 0);
  if (!resolvedStationID) {
    return [];
  }

  return collectPreferredSessionsByCharacter(
    sessionRegistry
      .getSessions()
      .filter((guestSession) => getSessionStationID(guestSession) === resolvedStationID),
  )
    .map((guestSession) => buildGuestIdentityTuple(guestSession))
    .filter(([characterID]) => characterID > 0)
    .sort((left, right) => left[0] - right[0]);
}

function getStructureGuestEntries(structureID) {
  const resolvedStructureID = normalizePositiveInt(structureID, 0);
  if (!resolvedStructureID) {
    return [];
  }

  return collectPreferredSessionsByCharacter(
    sessionRegistry
      .getSessions()
      .filter((guestSession) => getSessionStructureID(guestSession) === resolvedStructureID),
  )
    .map((guestSession) => {
      const [characterID] = buildGuestIdentityTuple(guestSession);
      return [characterID, buildStructureGuestTuple(guestSession)];
    })
    .filter(([characterID]) => characterID > 0)
    .sort((left, right) => left[0] - right[0]);
}

function broadcastStationGuestJoined(session, stationID) {
  const guestTuple = buildGuestIdentityTuple(session);
  const guestCharacterID = guestTuple[0];
  if (!guestCharacterID) {
    return;
  }

  const resolvedStationID = normalizePositiveInt(stationID, 0);
  if (!resolvedStationID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    // Exclude by character, not object identity, so a re-login/takeover ghost
    // session for the same character is never treated as an observer of itself.
    if (getGuestCharacterID(guestSession) === guestCharacterID) {
      continue;
    }
    if (getSessionStationID(guestSession) !== resolvedStationID) {
      continue;
    }

    const ledger = resolveObserverLedger(guestSession, resolvedStationID);
    if (ledger.guests.has(guestCharacterID)) {
      // Observer already shows this character; re-sending the join would append a
      // duplicate row the client cannot remove. Skip.
      continue;
    }
    ledger.guests.add(guestCharacterID);
    guestSession.sendNotification("OnCharNowInStation", "stationid", [guestTuple]);
  }
}

function broadcastStationGuestLeft(session, stationID) {
  const guestTuple = buildGuestIdentityTuple(session);
  const guestCharacterID = guestTuple[0];
  if (!guestCharacterID) {
    return;
  }

  const resolvedStationID = normalizePositiveInt(stationID, 0);
  if (!resolvedStationID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    if (getGuestCharacterID(guestSession) === guestCharacterID) {
      continue;
    }
    if (getSessionStationID(guestSession) !== resolvedStationID) {
      continue;
    }

    const ledger = resolveObserverLedger(guestSession, resolvedStationID);
    if (!ledger.guests.delete(guestCharacterID)) {
      // Observer was never told this character is here; nothing to remove.
      continue;
    }
    guestSession.sendNotification("OnCharNoLongerInStation", "stationid", [guestTuple]);
  }
}

function broadcastStructureGuestJoined(session, structureID) {
  const guestTuple = buildGuestIdentityTuple(session);
  const guestCharacterID = guestTuple[0];
  if (!guestCharacterID) {
    return;
  }

  const resolvedStructureID = normalizePositiveInt(structureID, 0);
  if (!resolvedStructureID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    if (getGuestCharacterID(guestSession) === guestCharacterID) {
      continue;
    }
    if (getSessionStructureID(guestSession) !== resolvedStructureID) {
      continue;
    }

    const ledger = resolveObserverLedger(guestSession, resolvedStructureID);
    if (ledger.guests.has(guestCharacterID)) {
      continue;
    }
    ledger.guests.add(guestCharacterID);
    guestSession.sendNotification(
      "OnCharacterEnteredStructure",
      "clientID",
      guestTuple,
    );
  }
}

function broadcastStructureGuestLeft(session, structureID) {
  const guestCharacterID = getGuestCharacterID(session);
  if (!guestCharacterID) {
    return;
  }

  const resolvedStructureID = normalizePositiveInt(structureID, 0);
  if (!resolvedStructureID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    if (getGuestCharacterID(guestSession) === guestCharacterID) {
      continue;
    }
    if (getSessionStructureID(guestSession) !== resolvedStructureID) {
      continue;
    }

    const ledger = resolveObserverLedger(guestSession, resolvedStructureID);
    if (!ledger.guests.delete(guestCharacterID)) {
      continue;
    }
    guestSession.sendNotification("OnCharacterLeftStructure", "clientID", [
      guestCharacterID,
    ]);
  }
}

module.exports = {
  broadcastStationGuestJoined,
  broadcastStationGuestLeft,
  broadcastStructureGuestJoined,
  broadcastStructureGuestLeft,
  buildGuestIdentityTuple,
  forgetObserverGuestLedger,
  getStationGuestTuples,
  getStructureGuestEntries,
  normalizePositiveInt,
  seedObserverGuestLedger,
};
