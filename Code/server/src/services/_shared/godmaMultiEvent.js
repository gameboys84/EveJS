/**
 * godmaMultiEvent — build Tranquility-shape godma sub-events and batch them into
 * a single `OnMultiEvent` notification.
 *
 * Decoded from a real TQ client capture (see
 * doc/PARITY_FITTING_NOTIFICATION_SEQUENCE.md). TQ delivers the dogma recalc
 * caused by a fit/unfit as ONE `OnMultiEvent` (idtype clientID) whose arg is a
 * list of `(subEvent, time)` pairs. Sub-event tuple shapes:
 *
 *   ('OnModuleAttributeChange', ownerID, itemID, attributeID, time, newValue, oldValue, time)
 *   ('OnGodmaShipEffect', itemID, effectID, time, isStart, shouldStart,
 *       [itemID, ownerID, shipID, None, None, [], effectID, None], None, duration, repeat, None)
 *
 * These are marshal TUPLEs ({type:"tuple"}), nested inside a marshal LIST.
 */

function tuple(items) {
  return { type: "tuple", items };
}

function list(items) {
  return { type: "list", items };
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ('OnModuleAttributeChange', ownerID, itemID, attributeID, time, newValue, oldValue, time)
function buildModuleAttributeChangeEvent(ownerID, itemID, attributeID, newValue, oldValue, time) {
  return tuple([
    "OnModuleAttributeChange",
    toNum(ownerID),
    toNum(itemID),
    toNum(attributeID),
    time,
    Number.isFinite(Number(newValue)) ? Number(newValue) : newValue,
    Number.isFinite(Number(oldValue)) ? Number(oldValue) : oldValue,
    time,
  ]);
}

// ('OnGodmaShipEffect', itemID, effectID, time, isStart, shouldStart,
//   [itemID, ownerID, shipID, None, None, [], effectID, None], None, duration, repeat, None)
function buildGodmaShipEffectEvent(itemID, ownerID, shipID, effectID, time, options = {}) {
  const isStart = options.isStart ? 1 : 0;
  const shouldStart = options.shouldStart ? 1 : 0;
  const duration = options.duration === undefined || options.duration === null ? -1 : toNum(options.duration, -1);
  const repeat =
    typeof options.repeat === "number"
      ? toNum(options.repeat, 0)
      : options.repeat === true;
  const targetID = options.targetID === undefined || options.targetID === null
    ? null
    : toNum(options.targetID, 0);
  const environment = tuple([
    toNum(itemID),
    toNum(ownerID),
    toNum(shipID),
    targetID,
    null,
    list([]),
    toNum(effectID),
    null,
  ]);
  return tuple([
    "OnGodmaShipEffect",
    toNum(itemID),
    toNum(effectID),
    time,
    isStart,
    shouldStart,
    environment,
    options.effectStartTime === undefined ? null : options.effectStartTime,
    duration,
    repeat,
    null,
  ]);
}

function buildOnMultiEventPayloadFromPairs(eventPairs) {
  const pairs = (Array.isArray(eventPairs) ? eventPairs : [])
    .filter(Boolean)
    .map((entry) => tuple([entry.event || entry.subEvent || entry[0], entry.time ?? entry[1]]));
  return [list(pairs)];
}

// OnMultiEvent arg = [ (subEvent, time), (subEvent, time), ... ] (single list arg).
function buildOnMultiEventPayload(subEvents, time) {
  return buildOnMultiEventPayloadFromPairs(
    (Array.isArray(subEvents) ? subEvents : [])
      .filter(Boolean)
      .map((subEvent) => ({ event: subEvent, time })),
  );
}

function sendOnMultiEvent(session, subEvents, time) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  const events = (Array.isArray(subEvents) ? subEvents : []).filter(Boolean);
  if (events.length === 0) {
    return false;
  }
  session.sendNotification("OnMultiEvent", "clientID", buildOnMultiEventPayload(events, time));
  return true;
}

function sendOnMultiEventPairs(session, eventPairs) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  const pairs = (Array.isArray(eventPairs) ? eventPairs : [])
    .filter((entry) => entry && (entry.event || entry.subEvent || entry[0]));
  if (pairs.length === 0) {
    return false;
  }
  session.sendNotification("OnMultiEvent", "clientID", buildOnMultiEventPayloadFromPairs(pairs));
  return true;
}

module.exports = {
  buildModuleAttributeChangeEvent,
  buildGodmaShipEffectEvent,
  buildOnMultiEventPayload,
  buildOnMultiEventPayloadFromPairs,
  sendOnMultiEvent,
  sendOnMultiEventPairs,
};
