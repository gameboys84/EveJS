/**
 * Canonical session -> character identity resolution.
 *
 * Historically services resolved the acting character with ad-hoc chains like
 * `session.characterID || session.charid || session.userid || 140000001`. That
 * pattern has two defects:
 *   - it conflates `session.userid` (an ACCOUNT id) with a character id, and
 *   - it silently falls back to a hardcoded character, so a session with no
 *     identity acts as a specific real player (a cross-account hazard).
 *
 * This resolver only consults character-identifying fields and returns 0 when
 * none are present. Callers must treat 0 as "no acting character" and fail or
 * no-op rather than impersonating a default player.
 */

const CHARACTER_ID_FIELDS = ["characterID", "charID", "charid", "characterId"];

/**
 * @param {object} session
 * @returns {number} a positive character id, or 0 when the session carries none
 */
function resolveSessionCharacterID(session) {
  if (!session || typeof session !== "object") {
    return 0;
  }
  for (const field of CHARACTER_ID_FIELDS) {
    const numeric = Number(session[field]);
    if (Number.isSafeInteger(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return 0;
}

module.exports = {
  resolveSessionCharacterID,
};
