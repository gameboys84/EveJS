const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildFiletimeLong,
  buildList,
  buildObjectEx1,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const CUSTOM_CONTENT_DATA_CLASS = "agency.common.contentdata.CustomContentData";
const CONTENT_TYPE_PIRATE_STRONGHOLD = 15;

const EXTRA_DATA_KEYS = Object.freeze([
  "location_id",
  "item_id",
  "type_id",
  "owner_id",
  "enemy_owner_id",
  "solar_system_coordinates",
  "title_text_id",
  "expanded_title_text_id",
  "subtitle_text_id",
  "expanded_subtitle_text_id",
  "blurb_text_id",
  "rewards",
  "primary_action_id",
  "hidden_location_id",
  "visibility_at_jump_range_after_minutes",
]);

const FIELD_ALIASES = Object.freeze({
  agency_content_id: ["agency_content_id", "agencyContentID", "customAgencyContentID", "id"],
  source_id: ["source_id", "sourceID", "sourceId"],
  source_content_id: ["source_content_id", "sourceContentID", "sourceContentId"],
  content_type: ["content_type", "contentType"],
  solar_system_id: ["solar_system_id", "solarSystemID", "solarSystemId", "systemID", "systemId"],
  creation_date: ["creation_date", "creationDate", "createdAt", "created"],
  expiry_date: ["expiry_date", "expiryDate", "expiresAt", "expires"],
  location_id: ["location_id", "locationID", "locationId"],
  item_id: ["item_id", "itemID", "itemId"],
  type_id: ["type_id", "typeID", "typeId"],
  owner_id: ["owner_id", "ownerID", "ownerId"],
  enemy_owner_id: ["enemy_owner_id", "enemyOwnerID", "enemyOwnerId", "enemyOwner"],
  solar_system_coordinates: [
    "solar_system_coordinates",
    "solarSystemCoordinates",
    "solarSystemPosition",
    "position",
  ],
  title_text_id: ["title_text_id", "titleTextID", "titleTextId"],
  expanded_title_text_id: ["expanded_title_text_id", "expandedTitleTextID", "expandedTitleTextId"],
  subtitle_text_id: ["subtitle_text_id", "subtitleTextID", "subtitleTextId"],
  expanded_subtitle_text_id: [
    "expanded_subtitle_text_id",
    "expandedSubtitleTextID",
    "expandedSubtitleTextId",
  ],
  blurb_text_id: ["blurb_text_id", "blurbTextID", "blurbTextId"],
  rewards: ["rewards", "agencyRewards"],
  primary_action_id: ["primary_action_id", "primaryActionID", "primaryActionId"],
  hidden_location_id: ["hidden_location_id", "hiddenLocationID", "hiddenLocationId"],
  visibility_at_jump_range_after_minutes: [
    "visibility_at_jump_range_after_minutes",
    "visibilityAtJumpRangeAfterMinutes",
    "visibility",
  ],
});

function toInt(value, fallback = 0) {
  const numeric = normalizeNumber(value, fallback);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getFirstPresent(source, aliases = []) {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, alias)) {
      return source[alias];
    }
  }
  return undefined;
}

function parseContentData(rawRecord) {
  const record = { ...(rawRecord || {}) };
  const contentData = getFirstPresent(record, ["contentData", "content_data", "extraData", "extra_data"]);
  if (typeof contentData === "string" && contentData.trim()) {
    try {
      Object.assign(record, JSON.parse(contentData));
    } catch (error) {
      // Keep malformed future rows from breaking the whole Agency view.
    }
  } else if (contentData && typeof contentData === "object" && !Array.isArray(contentData)) {
    Object.assign(record, contentData);
  }
  return record;
}

function buildMarshalTuple(items = []) {
  return {
    type: "tuple",
    items: Array.isArray(items) ? items : [],
  };
}

function buildMarshalValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (value && typeof value === "object" && value.type) {
    return value;
  }
  if (Array.isArray(value)) {
    return buildList(value.map((entry) => buildMarshalValue(entry)));
  }
  if (typeof value === "object") {
    return buildDict(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        buildMarshalValue(entryValue),
      ]),
    );
  }
  return value;
}

function normalizeCoordinates(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value.x, value.y, value.z]
      : null;
  if (!source || source.length < 3) {
    return undefined;
  }
  const coordinates = source.slice(0, 3).map((entry) => Number(entry));
  if (coordinates.some((entry) => !Number.isFinite(entry))) {
    return undefined;
  }
  return buildMarshalTuple(coordinates);
}

function normalizeVisibility(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tuples = value
    .map((entry) => {
      const source = Array.isArray(entry)
        ? entry
        : entry && typeof entry === "object"
          ? [entry.jumps, entry.minutes]
          : null;
      if (!source || source.length < 2) {
        return null;
      }
      const jumps = toInt(source[0], 0);
      if (jumps < 0) {
        return null;
      }
      const minutes = source[1] === null || source[1] === undefined
        ? null
        : toInt(source[1], 0);
      return buildMarshalTuple([jumps, minutes]);
    })
    .filter(Boolean);
  return tuples.length > 0 ? buildList(tuples) : undefined;
}

function normalizeOptionalExtraValue(key, value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (key === "solar_system_coordinates") {
    return normalizeCoordinates(value);
  }
  if (key === "visibility_at_jump_range_after_minutes") {
    return normalizeVisibility(value);
  }
  if (key === "rewards") {
    return buildMarshalValue(Array.isArray(value) ? value : []);
  }
  if (key.endsWith("_id")) {
    const numericValue = toInt(value, 0);
    return numericValue > 0 ? numericValue : undefined;
  }
  return buildMarshalValue(value);
}

function normalizeCustomContentRecord(rawRecord) {
  const record = parseContentData(rawRecord);
  const agencyContentID = toInt(getFirstPresent(record, FIELD_ALIASES.agency_content_id), 0);
  const contentType = toInt(getFirstPresent(record, FIELD_ALIASES.content_type), 0);
  const solarSystemID = toInt(getFirstPresent(record, FIELD_ALIASES.solar_system_id), 0);
  if (agencyContentID <= 0 || contentType <= 0 || solarSystemID <= 0) {
    return null;
  }

  const sourceID = toInt(getFirstPresent(record, FIELD_ALIASES.source_id), 0);
  const sourceContentID = toInt(
    getFirstPresent(record, FIELD_ALIASES.source_content_id),
    agencyContentID,
  );
  const creationDate = getFirstPresent(record, FIELD_ALIASES.creation_date);
  const expiryDate = getFirstPresent(record, FIELD_ALIASES.expiry_date);
  const stateEntries = [];
  for (const key of EXTRA_DATA_KEYS) {
    const value = normalizeOptionalExtraValue(key, getFirstPresent(record, FIELD_ALIASES[key]));
    if (value !== undefined) {
      stateEntries.push([key, value]);
    }
  }

  return {
    agencyContentID,
    sourceID,
    sourceContentID,
    contentType,
    solarSystemID,
    creationDate: creationDate === undefined ? 0n : creationDate,
    expiryDate: expiryDate === undefined ? null : expiryDate,
    stateEntries,
  };
}

function buildCustomContentDataPayload(rawRecord) {
  const record = normalizeCustomContentRecord(rawRecord);
  if (!record) {
    return null;
  }
  return buildObjectEx1(
    CUSTOM_CONTENT_DATA_CLASS,
    [
      record.agencyContentID,
      record.sourceID,
      record.sourceContentID,
      record.contentType,
      record.solarSystemID,
      buildFiletimeLong(record.creationDate),
      record.expiryDate === null ? null : buildFiletimeLong(record.expiryDate),
    ],
    record.stateEntries,
  );
}

function buildContentList(records = []) {
  const payloads = (Array.isArray(records) ? records : [])
    .map(buildCustomContentDataPayload)
    .filter(Boolean)
    .sort((left, right) => {
      const leftArgs = left.header[1];
      const rightArgs = right.header[1];
      return (
        leftArgs[4] - rightArgs[4] ||
        leftArgs[3] - rightArgs[3] ||
        leftArgs[0] - rightArgs[0]
      );
    });
  return buildList(payloads);
}

class CustomAgencyProviderService extends BaseService {
  constructor(options = {}) {
    super("custom_agency_provider");
    this.contentProvider =
      typeof options.contentProvider === "function"
        ? options.contentProvider
        : () => [];
    this.warpHandler =
      typeof options.warpHandler === "function"
        ? options.warpHandler
        : null;
  }

  Handle_get_content_data(args, session) {
    return buildContentList(this.contentProvider(session, args) || []);
  }

  Handle_warp_to_content(args, session) {
    const agencyContentID = Array.isArray(args) && args.length > 0
      ? toInt(args[0], 0)
      : 0;
    if (agencyContentID <= 0 || !this.warpHandler) {
      return null;
    }
    return this.warpHandler(agencyContentID, session, args) ?? null;
  }
}

CustomAgencyProviderService._testing = {
  CONTENT_TYPE_PIRATE_STRONGHOLD,
  CUSTOM_CONTENT_DATA_CLASS,
  EXTRA_DATA_KEYS,
  buildContentList,
  buildCustomContentDataPayload,
  normalizeCustomContentRecord,
};

module.exports = CustomAgencyProviderService;
