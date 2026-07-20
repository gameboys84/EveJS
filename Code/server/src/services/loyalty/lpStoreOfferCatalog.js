const path = require("path");

const {
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const staticOffers = require("./lpStoreStaticOffers.json");

const GOLDEN_OFFER_FIELD_ORDER = Object.freeze([
  "typeID",
  "iskCost",
  "akCost",
  "reqItems",
  "offerID",
  "qty",
  "requiredStandings",
  "corpID",
  "lootItems",
  "lpCost",
]);

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.trunc(Number(fallback) || 0));
  }
  return Math.max(0, Math.trunc(numeric));
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeRequirementPair(entry) {
  if (Array.isArray(entry)) {
    const typeID = normalizePositiveInteger(entry[0], 0);
    const quantity = normalizeNonNegativeInteger(entry[1], 0);
    return typeID > 0 && quantity > 0 ? [typeID, quantity] : null;
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const typeID = normalizePositiveInteger(
    firstDefined(entry.typeID, entry.type_id),
    0,
  );
  const quantity = normalizeNonNegativeInteger(
    firstDefined(entry.quantity, entry.qty),
    0,
  );
  return typeID > 0 && quantity > 0 ? [typeID, quantity] : null;
}

function normalizeRequirementPairs(requirements = []) {
  return (Array.isArray(requirements) ? requirements : [])
    .map(normalizeRequirementPair)
    .filter(Boolean);
}

function buildRequirementPairs(requirements = []) {
  return buildList(
    normalizeRequirementPairs(requirements).map(([typeID, quantity]) =>
      buildList([typeID, quantity]),
    ),
  );
}

function normalizeOfferRecord(offer, fallbackCorpID = 0) {
  const safeOffer = offer && typeof offer === "object" ? offer : {};
  const corpID = normalizePositiveInteger(
    firstDefined(safeOffer.corpID, safeOffer.corporation_id, fallbackCorpID),
    fallbackCorpID,
  );
  const requiredStandings = firstDefined(
    safeOffer.requiredStandings,
    safeOffer.required_standings,
    null,
  );

  return {
    typeID: normalizePositiveInteger(
      firstDefined(safeOffer.typeID, safeOffer.type_id),
      0,
    ),
    iskCost: normalizeNonNegativeInteger(
      firstDefined(safeOffer.iskCost, safeOffer.isk_cost),
      0,
    ),
    akCost: normalizeNonNegativeInteger(
      firstDefined(safeOffer.akCost, safeOffer.ak_cost),
      0,
    ),
    reqItems: normalizeRequirementPairs(
      firstDefined(safeOffer.reqItems, safeOffer.required_items, []),
    ),
    offerID: normalizePositiveInteger(
      firstDefined(safeOffer.offerID, safeOffer.offer_id),
      0,
    ),
    qty: normalizePositiveInteger(
      firstDefined(safeOffer.qty, safeOffer.quantity),
      1,
    ),
    requiredStandings,
    corpID,
    lootItems: normalizeRequirementPairs(
      firstDefined(safeOffer.lootItems, safeOffer.loot_items, []),
    ),
    lpCost: normalizeNonNegativeInteger(
      firstDefined(safeOffer.lpCost, safeOffer.lp_cost),
      0,
    ),
  };
}

function buildLpStoreOfferKeyVal(offer, fallbackCorpID = 0) {
  const normalized = normalizeOfferRecord(offer, fallbackCorpID);
  return buildKeyVal([
    ["typeID", normalized.typeID],
    ["iskCost", normalized.iskCost],
    ["akCost", normalized.akCost],
    ["reqItems", buildRequirementPairs(normalized.reqItems)],
    ["offerID", normalized.offerID],
    ["qty", normalized.qty],
    ["requiredStandings", normalized.requiredStandings],
    ["corpID", normalized.corpID],
    ["lootItems", buildRequirementPairs(normalized.lootItems)],
    ["lpCost", normalized.lpCost],
  ]);
}

function getStaticOfferRows(corpID) {
  const normalizedCorpID = normalizePositiveInteger(corpID, 0);
  if (!normalizedCorpID) {
    return [];
  }

  const byCorpID = staticOffers.offersByCorpID || {};
  const rows = byCorpID[String(normalizedCorpID)];
  return Array.isArray(rows) ? rows : [];
}

function hasStaticLpStoreOffers(corpID) {
  return getStaticOfferRows(corpID).length > 0;
}

function listStaticLpStoreOffers(corpID) {
  const normalizedCorpID = normalizePositiveInteger(corpID, 0);
  return getStaticOfferRows(normalizedCorpID).map((offer) =>
    buildLpStoreOfferKeyVal(offer, normalizedCorpID),
  );
}

function getStaticLpStoreOfferRecord(corpID, offerID) {
  const normalizedCorpID = normalizePositiveInteger(corpID, 0);
  const normalizedOfferID = normalizePositiveInteger(offerID, 0);
  if (!normalizedCorpID || !normalizedOfferID) {
    return null;
  }

  const offer = getStaticOfferRows(normalizedCorpID).find(
    (candidate) =>
      normalizePositiveInteger(
        firstDefined(candidate.offerID, candidate.offer_id),
        0,
      ) === normalizedOfferID,
  );
  return offer ? normalizeOfferRecord(offer, normalizedCorpID) : null;
}

module.exports = {
  GOLDEN_OFFER_FIELD_ORDER,
  buildLpStoreOfferKeyVal,
  getStaticLpStoreOfferRecord,
  hasStaticLpStoreOffers,
  listStaticLpStoreOffers,
  normalizeOfferRecord,
  normalizeRequirementPairs,
};
