const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const FACTION_CALDARI_STATE = 500001;
const FACTION_MINMATAR_REPUBLIC = 500002;
const FACTION_AMARR_EMPIRE = 500003;
const FACTION_GALLENTE_FEDERATION = 500004;

const WARZONE_AMARR_MINMATAR = 1;
const WARZONE_CALDARI_GALLENTE = 2;

const WARZONES = Object.freeze({
  [WARZONE_AMARR_MINMATAR]: [
    FACTION_AMARR_EMPIRE,
    FACTION_MINMATAR_REPUBLIC,
  ],
  [WARZONE_CALDARI_GALLENTE]: [
    FACTION_CALDARI_STATE,
    FACTION_GALLENTE_FEDERATION,
  ],
});

const FACTION_HQ_SYSTEMS = Object.freeze({
  [FACTION_AMARR_EMPIRE]: 30002974, // Mehatoor
  [FACTION_CALDARI_STATE]: 30045324, // Onnamon
  [FACTION_GALLENTE_FEDERATION]: 30003788, // Intaki
  [FACTION_MINMATAR_REPUBLIC]: 30002055, // Amo
});

function buildWarzonesDict() {
  return buildDict(
    Object.entries(WARZONES).map(([warzoneID, factionIDs]) => [
      Number(warzoneID),
      buildList(factionIDs),
    ]),
  );
}

function buildHQSystemsDict() {
  return buildDict(
    Object.entries(FACTION_HQ_SYSTEMS).map(([factionID, solarSystemID]) => [
      Number(factionID),
      solarSystemID,
    ]),
  );
}

function buildEmptyOccupationStatesByWarzone() {
  return buildDict(
    Object.keys(WARZONES).map((warzoneID) => [
      Number(warzoneID),
      buildDict([]),
    ]),
  );
}

class FwWarzoneSolarsystemService extends BaseService {
  constructor() {
    super("fwWarzoneSolarsystem");
  }

  Handle_GetAllWarzonesOccupationStates(args, session) {
    log.debug("[fwWarzoneSvc] GetAllWarzonesOccupationStates called");

    // Decompiled V23.02 fwWarzoneSvc.py does:
    //   occupationStatesBySolarsystemByWarzone =
    //       sm.RemoteSvc('fwWarzoneSolarsystem').GetAllWarzonesOccupationStates()
    //   for occupationStatesBySolarsystem in
    //       occupationStatesBySolarsystemByWarzone.itervalues():
    //
    // The dashboard indexes occupationStates[warzoneID]. Keep warzone shells
    // present while leaving per-system occupation empty until runtime state is
    // authoritative.
    return buildEmptyOccupationStatesByWarzone();
  }

  Handle_GetAllWarzonesOccupationStatesUncached(args, session) {
    log.debug("[fwWarzoneSvc] GetAllWarzonesOccupationStatesUncached called");
    return buildEmptyOccupationStatesByWarzone();
  }

  Handle_GetAllWarzones() {
    log.debug("[fwWarzoneSvc] GetAllWarzones called");
    return buildWarzonesDict();
  }

  Handle_GetHQSystemIDs() {
    log.debug("[fwWarzoneSvc] GetHQSystemIDs called");
    return buildHQSystemsDict();
  }

  Handle_GetLocalOccupationState(args, session) {
    log.debug("[fwWarzoneSvc] GetLocalOccupationState called");
    const solarSystemID =
      Number(
        args && args.length > 0
          ? args[0]
          : session && (session.solarsystemid2 || session.solarsystemid),
      ) || 0;

    // V23.02 expects a 2-tuple of:
    //   (solarSystemID, occupationState)
    // For non-warzone systems, the second slot must be None. Returning a
    // populated util.KeyVal here makes the client treat the current system as
    // faction warfare even when owner/occupier are null.
    return [solarSystemID, null];
  }
}

FwWarzoneSolarsystemService._testing = {
  constants: {
    FACTION_CALDARI_STATE,
    FACTION_MINMATAR_REPUBLIC,
    FACTION_AMARR_EMPIRE,
    FACTION_GALLENTE_FEDERATION,
    WARZONE_AMARR_MINMATAR,
    WARZONE_CALDARI_GALLENTE,
    WARZONES,
    FACTION_HQ_SYSTEMS,
  },
};

module.exports = FwWarzoneSolarsystemService;
