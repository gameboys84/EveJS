const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const runtime = require(path.join(__dirname, "./bookmarkRuntimeState"));
const {
  BOOKMARKS_ADDED,
  BOOKMARKS_MOVED,
  BOOKMARKS_REMOVED,
  BOOKMARKS_UPDATED,
  FOLDER_UPDATED,
  SUBFOLDER_ADDED,
  SUBFOLDER_REMOVED,
  SUBFOLDER_UPDATED,
} = require(path.join(__dirname, "./bookmarkConstants"));
const {
  buildBookmarkIDSet,
  buildBookmarkPayload,
  buildBookmarkText,
  buildFolderUpdateTuple,
  buildSubfolderPayload,
} = require(path.join(__dirname, "./bookmarkPayloads"));
const {
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

// ---------------------------------------------------------------------------
// Pure update-tuple builders
//
// Each returns the [target, updateType, updateArgs] triple the client unpacks
// in bookmarkSvc.OnSharedBookmarksFolderUpdated. They are the single source of
// truth for the broadcast payload shape (the notify* helpers below send these),
// and are exported so payload-parity tests can assert the unicode-safe shape
// directly. Bookmark lists are wrapped as marshal lists so the client iterates
// `for bm in updateArgs`.
// ---------------------------------------------------------------------------

function buildBookmarksAddedUpdate(folderID, bookmarks) {
  return buildFolderUpdateTuple(
    folderID,
    BOOKMARKS_ADDED,
    buildList((Array.isArray(bookmarks) ? bookmarks : []).map(buildBookmarkPayload)),
  );
}

function buildBookmarksUpdatedUpdate(folderID, bookmarks) {
  return buildFolderUpdateTuple(
    folderID,
    BOOKMARKS_UPDATED,
    buildList((Array.isArray(bookmarks) ? bookmarks : []).map(buildBookmarkPayload)),
  );
}

function buildBookmarksRemovedUpdate(folderID, bookmarkIDs) {
  return buildFolderUpdateTuple(folderID, BOOKMARKS_REMOVED, buildBookmarkIDSet(bookmarkIDs));
}

function buildBookmarksMovedUpdate(oldFolderID, newFolderID, bookmarks) {
  return buildFolderUpdateTuple(oldFolderID, BOOKMARKS_MOVED, [
    buildList((Array.isArray(bookmarks) ? bookmarks : []).map(buildBookmarkPayload)),
    Number(oldFolderID) || 0,
    Number(newFolderID) || 0,
  ]);
}

function buildFolderUpdatedUpdate(folderID, folderName, description) {
  return buildFolderUpdateTuple(folderID, FOLDER_UPDATED, [
    buildBookmarkText(folderName, 40, ""),
    buildBookmarkText(description, 3900, ""),
  ]);
}

function buildSubfolderAddedUpdate(folderID, subfolder) {
  return buildFolderUpdateTuple(folderID, SUBFOLDER_ADDED, buildSubfolderPayload(subfolder));
}

function buildSubfolderUpdatedUpdate(folderID, subfolderID, subfolderName) {
  return buildFolderUpdateTuple(folderID, SUBFOLDER_UPDATED, [
    Number(subfolderID) || 0,
    buildBookmarkText(subfolderName, 40, ""),
  ]);
}

function buildSubfolderRemovedUpdate(folderID, subfolderID) {
  return buildFolderUpdateTuple(folderID, SUBFOLDER_REMOVED, Number(subfolderID) || 0);
}

function getCharacterID(session) {
  return Number(session && session.characterID) || 0;
}

function getActiveFolderView(characterID, folderID) {
  try {
    const view = runtime.getFolderInfo(characterID, folderID);
    return view && view.isActive ? view : null;
  } catch (error) {
    return null;
  }
}

function collectRecipientSessions(folderIDs = [], excludeCharacterID = 0) {
  const normalizedFolderIDs = [...new Set((Array.isArray(folderIDs) ? folderIDs : [folderIDs]).map((folderID) => Number(folderID) || 0).filter((folderID) => folderID > 0))];
  if (normalizedFolderIDs.length <= 0) {
    return [];
  }
  return sessionRegistry.getSessions().filter((session) => {
    const characterID = getCharacterID(session);
    if (!characterID || characterID === excludeCharacterID) {
      return false;
    }
    return normalizedFolderIDs.some((folderID) => getActiveFolderView(characterID, folderID));
  });
}

function sendFolderUpdated(folderIDs, updateTuple, excludeCharacterID = 0) {
  const recipients = collectRecipientSessions(folderIDs, excludeCharacterID);
  if (recipients.length <= 0) {
    return;
  }
  for (const session of recipients) {
    session.sendServiceNotification("bookmarkSvc", "OnSharedBookmarksFolderUpdated", [[updateTuple]]);
  }
}

function notifyBookmarksAdded(folderID, bookmarks, options = {}) {
  if (!Array.isArray(bookmarks) || bookmarks.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [folderID],
    buildBookmarksAddedUpdate(folderID, bookmarks),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyBookmarksUpdated(folderID, bookmarks, options = {}) {
  if (!Array.isArray(bookmarks) || bookmarks.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [folderID],
    buildBookmarksUpdatedUpdate(folderID, bookmarks),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyBookmarksRemoved(folderID, bookmarkIDs, options = {}) {
  if (!Array.isArray(bookmarkIDs) || bookmarkIDs.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [folderID],
    buildBookmarksRemovedUpdate(folderID, bookmarkIDs),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyBookmarksMoved(oldFolderID, newFolderID, bookmarks, options = {}) {
  if (!Array.isArray(bookmarks) || bookmarks.length <= 0) {
    return;
  }
  sendFolderUpdated(
    [oldFolderID, newFolderID],
    buildBookmarksMovedUpdate(oldFolderID, newFolderID, bookmarks),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyFolderUpdated(folderID, folder, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildFolderUpdatedUpdate(folderID, folder && folder.folderName, folder && folder.description),
    Number(options.excludeCharacterID || 0),
  );
}

function notifySubfolderAdded(folderID, subfolder, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildSubfolderAddedUpdate(folderID, subfolder),
    Number(options.excludeCharacterID || 0),
  );
}

function notifySubfolderUpdated(folderID, subfolderID, subfolderName, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildSubfolderUpdatedUpdate(folderID, subfolderID, subfolderName),
    Number(options.excludeCharacterID || 0),
  );
}

function notifySubfolderRemoved(folderID, subfolderID, options = {}) {
  sendFolderUpdated(
    [folderID],
    buildSubfolderRemovedUpdate(folderID, subfolderID),
    Number(options.excludeCharacterID || 0),
  );
}

function notifyFolderDeleted(folderID, options = {}) {
  const recipients = collectRecipientSessions([folderID], Number(options.excludeCharacterID || 0));
  for (const session of recipients) {
    session.sendServiceNotification("bookmarkSvc", "OnSharedBookmarksFolderDeleted", [Number(folderID) || 0]);
  }
}

module.exports = {
  buildBookmarksAddedUpdate,
  buildBookmarksMovedUpdate,
  buildBookmarksRemovedUpdate,
  buildBookmarksUpdatedUpdate,
  buildFolderUpdatedUpdate,
  buildSubfolderAddedUpdate,
  buildSubfolderRemovedUpdate,
  buildSubfolderUpdatedUpdate,
  notifyBookmarksAdded,
  notifyBookmarksMoved,
  notifyBookmarksRemoved,
  notifyBookmarksUpdated,
  notifyFolderDeleted,
  notifyFolderUpdated,
  notifySubfolderAdded,
  notifySubfolderRemoved,
  notifySubfolderUpdated,
};
