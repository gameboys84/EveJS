const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

const TRACKING_METHODS = Object.freeze({
  TrackOfferBuyPress: "buy_press",
  TrackOfferClosed: "closed",
  TrackOfferDelivered: "delivered",
  TrackOfferPurchased: "purchased",
  TrackOfferPurchasedSeen: "purchased_seen",
  TrackOfferSeen: "seen",
});

const trackingEvents = [];

function toInteger(value, fallback = 0) {
  const unwrapped = unwrapMarshalValue(value);
  const numeric = Number(unwrapped);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const numeric = toInteger(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getSessionCharacterID(session) {
  return toPositiveInteger(
    session && (session.characterID || session.charid || session.clientID),
    0,
  );
}

function getSessionAccountID(session) {
  return toPositiveInteger(
    session && (session.userid || session.userID || session.accountID),
    0,
  );
}

function recordTrackingEvent(methodName, args = [], session = null) {
  const offerID = toPositiveInteger(args && args[0], 0);
  const event = {
    eventID: trackingEvents.length + 1,
    eventType: TRACKING_METHODS[methodName] || methodName,
    methodName,
    offerID,
    characterID: getSessionCharacterID(session),
    accountID: getSessionAccountID(session),
    recordedAt: new Date().toISOString(),
  };
  trackingEvents.push(event);
  log.debug(
    `[ContextualOfferMgr] ${event.eventType} offer=${offerID || "?"} char=${event.characterID || "?"}`,
  );
  return null;
}

class ContextualOfferMgrService extends BaseService {
  constructor() {
    super("contextualOfferMgr");
  }

  Handle_TrackOfferDelivered(args, session) {
    return recordTrackingEvent("TrackOfferDelivered", args, session);
  }

  Handle_TrackOfferSeen(args, session) {
    return recordTrackingEvent("TrackOfferSeen", args, session);
  }

  Handle_TrackOfferBuyPress(args, session) {
    return recordTrackingEvent("TrackOfferBuyPress", args, session);
  }

  Handle_TrackOfferClosed(args, session) {
    return recordTrackingEvent("TrackOfferClosed", args, session);
  }

  Handle_TrackOfferPurchased(args, session) {
    return recordTrackingEvent("TrackOfferPurchased", args, session);
  }

  Handle_TrackOfferPurchasedSeen(args, session) {
    return recordTrackingEvent("TrackOfferPurchasedSeen", args, session);
  }
}

module.exports = ContextualOfferMgrService;
module.exports._testing = {
  TRACKING_METHODS,
  getEvents() {
    return trackingEvents.map((event) => JSON.parse(JSON.stringify(event)));
  },
  resetForTests() {
    trackingEvents.length = 0;
  },
};
