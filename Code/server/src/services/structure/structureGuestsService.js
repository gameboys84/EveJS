const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { buildDict } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  getStructureGuestEntries,
  normalizePositiveInt,
  seedObserverGuestLedger,
} = require(path.join(
  __dirname,
  "../_shared/guestLists",
));

function getSessionStructureID(session) {
  return normalizePositiveInt(
    session && (session.structureID || session.structureid),
    0,
  );
}

class StructureGuestsService extends BaseService {
  constructor() {
    super("structureGuests");
  }

  Handle_GetGuests(args, session) {
    const requestedStructureID = normalizePositiveInt(args && args[0], 0);
    const structureID = requestedStructureID || getSessionStructureID(session);

    if (!structureID) {
      return buildDict([]);
    }

    const entries = getStructureGuestEntries(structureID);

    // Seed this observer's guest ledger from the snapshot it just pulled so later
    // join/leave broadcasts only push genuine deltas. See guestLists.js.
    seedObserverGuestLedger(
      session,
      structureID,
      entries.map(([characterID]) => characterID),
    );

    return buildDict(entries);
  }
}

module.exports = StructureGuestsService;
