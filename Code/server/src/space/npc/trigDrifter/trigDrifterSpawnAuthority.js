const path = require("path");

const database = require(path.join(__dirname, "../../../gameStore"));

function readAuthorityRoot() {
  const result = database.read("trigDrifterSpawnAuthority", "/");
  return result.success && result.data && typeof result.data === "object"
    ? result.data
    : {};
}

const authorityRoot = readAuthorityRoot();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }
  return Object.freeze(value);
}

const SYSTEM_LISTS = deepFreeze(
  authorityRoot &&
    authorityRoot.systemLists &&
    typeof authorityRoot.systemLists === "object"
      ? authorityRoot.systemLists
      : {},
);

const SYSTEM_LISTS_BY_NORMALIZED_KEY = new Map(
  Object.entries(SYSTEM_LISTS).map(([key, list]) => [
    String(key || "").trim().toLowerCase(),
    list,
  ]),
);

function getSystemList(key) {
  const normalizedKey = String(key || "").trim();
  const list =
    SYSTEM_LISTS[normalizedKey] ||
    SYSTEM_LISTS_BY_NORMALIZED_KEY.get(normalizedKey.toLowerCase());
  return Array.isArray(list) ? [...list] : [];
}

module.exports = {
  SYSTEM_LISTS,
  getSystemList,
};
