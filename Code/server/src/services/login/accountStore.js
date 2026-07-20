"use strict";

/**
 * Phase 0 / 0.C — accounts table owner (login domain).
 *
 * The `accounts` table (login/auth account records, keyed by userName) was
 * previously read/written directly by three places with duplicated helpers:
 * the TCP handshake (account create/update on login), chat admin commands, and
 * userService. This module is the single owner: it is the only thing that
 * writes the accounts table, through a strict ownership-scoped repository. All
 * other domains call this API instead of touching the table.
 *
 * This is also the seam that localizes a future storage change: when accounts
 * moves from a JSON map to a relational table, only this module changes — the
 * handshake, chat, and userService callers stay as-is.
 */

const path = require("path");
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));

const ACCOUNTS_TABLE = "accounts";
const repo = createTableRepository("service:login", { strict: true });

/** Whole accounts map ({ userName: record }), or {} when absent. */
function readAccountsTable() {
  const result = repo.read(ACCOUNTS_TABLE, "/");
  return result && result.success && result.data && typeof result.data === "object"
    ? result.data
    : {};
}

/** Single account record by userName, or null. */
function getAccountByUserName(userName) {
  const accounts = readAccountsTable();
  return Object.prototype.hasOwnProperty.call(accounts, String(userName))
    ? accounts[String(userName)]
    : null;
}

/** Upsert a single account record at /<userName>. */
function writeAccountRecord(userName, record) {
  return repo.write(ACCOUNTS_TABLE, `/${String(userName)}`, record);
}

/** Replace the whole accounts table (admin / bulk paths). */
function writeAccountsTable(accounts) {
  return repo.write(ACCOUNTS_TABLE, "/", accounts);
}

/** Force a synchronous flush of the accounts table (login persistence). */
function flushAccounts() {
  return repo.flushTablesSync([ACCOUNTS_TABLE]);
}

module.exports = {
  ACCOUNTS_TABLE,
  readAccountsTable,
  getAccountByUserName,
  writeAccountRecord,
  writeAccountsTable,
  flushAccounts,
};
