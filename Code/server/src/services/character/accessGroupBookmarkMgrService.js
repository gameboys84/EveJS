const path = require("path");
const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  buildList,
  buildDict,
  normalizeNumber,
  normalizeText,
} = require("../_shared/serviceHelpers");
const {
  throwWrappedUserError,
} = require("../../common/machoErrors");
const spaceRuntime = require("../../space/runtime");
const runtime = require("../bookmark/bookmarkRuntimeState");
const bookmarkNotifications = require("../bookmark/bookmarkNotifications");
const {
  buildBookmarkPayload,
  buildBookmarkReplyTuple,
  buildFolderPayload,
  buildSubfolderPayload,
} = require("../bookmark/bookmarkPayloads");
const {
  resolveLocationBookmarkTarget,
} = require("../bookmark/bookmarkTargetResolver");

// -----------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------

/**
 * Convert a folder view ({ folder, accessLevel, isActive }) returned by the
 * runtime into the KeyVal payload the client unpacks.
 */
function folderViewPayload(view) {
  if (!view) {
    return null;
  }
  return buildFolderPayload(view.folder, {
    accessLevel: view.accessLevel,
    isActive: view.isActive,
  });
}

/**
 * Translate a runtime bookmarkError into the wrapped UserError the client
 * expects, falling back to a generic message for anything unexpected.
 */
function rethrowAsUserError(error) {
  if (error && error.bookmarkError) {
    throwWrappedUserError(error.bookmarkError);
  }
  throw error;
}

/**
 * Normalize a Python-set / array / objectex1 argument into a plain JS array of
 * numbers. The client sends bookmark IDs as a Python set which deserializes as
 * an ObjectEx1 struct.
 */
function normalizeIDSetArg(rawIDs) {
  if (Array.isArray(rawIDs)) {
    return rawIDs;
  }
  if (rawIDs && typeof rawIDs === "object" && Array.isArray(rawIDs.items)) {
    return rawIDs.items;
  }
  if (
    rawIDs &&
    rawIDs.type === "objectex1" &&
    Array.isArray(rawIDs.header) && rawIDs.header.length >= 2 &&
    Array.isArray(rawIDs.header[1]) && rawIDs.header[1].length >= 1
  ) {
    const inner = rawIDs.header[1][0];
    return Array.isArray(inner) ? inner
      : inner && Array.isArray(inner.items) ? inner.items
      : [];
  }
  if (typeof rawIDs === "number" && rawIDs > 0) {
    return [rawIDs];
  }
  return [];
}

function getSubfolderArg(value) {
  return value != null ? normalizeNumber(value, null) : null;
}

class AccessGroupBookmarkMgrService extends BaseService {
  constructor() {
    super("accessGroupBookmarkMgr");
  }

  // -----------------------------------------------------------------------
  // Initial load
  // -----------------------------------------------------------------------

  Handle_GetMyActiveBookmarks(args, session) {
    const charID = session && session.characterID;
    log.debug(`[AccessGroupBookmarkMgr] GetMyActiveBookmarks char=${charID}`);

    let active;
    try {
      active = runtime.getMyActiveBookmarks(charID);
    } catch (error) {
      rethrowAsUserError(error);
    }

    return [
      buildList(active.folders.map(folderViewPayload)),
      buildList(active.bookmarks.map(buildBookmarkPayload)),
      buildList(active.subfolders.map(buildSubfolderPayload)),
    ];
  }

  // -----------------------------------------------------------------------
  // Folder CRUD
  // -----------------------------------------------------------------------

  Handle_AddFolder(args, session) {
    const charID = session && session.characterID;
    const isPersonal = args && args[0] !== undefined ? Boolean(args[0]) : true;
    const folderName = normalizeText(args && args[1], "My Locations");
    const description = normalizeText(args && args[2], "");
    const adminGroupID = args && args[3] != null ? normalizeNumber(args[3], null) : null;
    const manageGroupID = args && args[4] != null ? normalizeNumber(args[4], null) : null;
    const useGroupID = args && args[5] != null ? normalizeNumber(args[5], null) : null;
    const viewGroupID = args && args[6] != null ? normalizeNumber(args[6], null) : null;

    log.info(
      `[AccessGroupBookmarkMgr] AddFolder char=${charID} personal=${isPersonal} name="${folderName}"`,
    );

    try {
      const view = runtime.addFolder(charID, {
        isPersonal,
        folderName,
        description,
        adminGroupID,
        manageGroupID,
        useGroupID,
        viewGroupID,
      });
      return folderViewPayload(view);
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_UpdateFolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const folderName = normalizeText(args && args[1], "");
    const description = normalizeText(args && args[2], "");
    const adminGroupID = args && args[3] != null ? normalizeNumber(args[3], null) : null;
    const manageGroupID = args && args[4] != null ? normalizeNumber(args[4], null) : null;
    const useGroupID = args && args[5] != null ? normalizeNumber(args[5], null) : null;
    const viewGroupID = args && args[6] != null ? normalizeNumber(args[6], null) : null;

    log.info(
      `[AccessGroupBookmarkMgr] UpdateFolder char=${charID} folder=${folderID} name="${folderName}"`,
    );

    try {
      const result = runtime.updateFolder(charID, folderID, {
        folderName,
        description,
        adminGroupID,
        manageGroupID,
        useGroupID,
        viewGroupID,
      });
      if (!result.folder.isPersonal) {
        bookmarkNotifications.notifyFolderUpdated(folderID, result.folder, {
          excludeCharacterID: charID,
        });
      }
      return result.accessLevel;
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_DeleteFolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);

    log.info(
      `[AccessGroupBookmarkMgr] DeleteFolder char=${charID} folder=${folderID}`,
    );

    try {
      const result = runtime.deleteFolder(charID, folderID);
      if (!result.folder.isPersonal) {
        bookmarkNotifications.notifyFolderDeleted(folderID, { excludeCharacterID: charID });
      }
    } catch (error) {
      return rethrowAsUserError(error);
    }
    return null;
  }

  Handle_GetFolderInfo(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);

    log.debug(
      `[AccessGroupBookmarkMgr] GetFolderInfo char=${charID} folder=${folderID}`,
    );

    try {
      const view = runtime.getFolderInfo(charID, folderID);
      return folderViewPayload(view);
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_SearchFoldersWithAdminAccess(args, session) {
    const charID = session && session.characterID;

    log.debug(
      `[AccessGroupBookmarkMgr] SearchFoldersWithAdminAccess char=${charID}`,
    );

    try {
      const personalFolders = runtime
        .listFolderViews(charID)
        .filter((view) => view.folder.isPersonal);
      const adminSharedFolders = runtime.listFoldersWithAdminAccess(charID);
      const folders = [...personalFolders, ...adminSharedFolders];
      return buildList(folders.map(folderViewPayload));
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  // -----------------------------------------------------------------------
  // Known Shared Folder Management
  // -----------------------------------------------------------------------

  Handle_AddToKnownFolders(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const isActive = args && args[1] !== undefined ? Boolean(args[1]) : true;

    log.info(
      `[AccessGroupBookmarkMgr] AddToKnownFolders char=${charID} folder=${folderID} active=${isActive}`,
    );

    try {
      const result = runtime.addKnownFolder(charID, folderID, isActive);
      return [
        folderViewPayload(result.folder),
        buildList(result.bookmarks.map(buildBookmarkPayload)),
        buildList(result.subfolders.map(buildSubfolderPayload)),
      ];
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_RemoveFromKnownFolders(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);

    log.info(
      `[AccessGroupBookmarkMgr] RemoveFromKnownFolders char=${charID} folder=${folderID}`,
    );

    try {
      runtime.removeKnownFolder(charID, folderID);
    } catch (error) {
      return rethrowAsUserError(error);
    }
    return null;
  }

  Handle_UpdateKnownFolderState(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const isActive = args && args[1] !== undefined ? Boolean(args[1]) : true;

    log.info(
      `[AccessGroupBookmarkMgr] UpdateKnownFolderState char=${charID} folder=${folderID} active=${isActive}`,
    );

    try {
      const result = runtime.updateKnownFolderState(charID, folderID, isActive);
      return [
        folderViewPayload(result.folder),
        buildList(result.bookmarks.map(buildBookmarkPayload)),
        buildList(result.subfolders.map(buildSubfolderPayload)),
      ];
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  // -----------------------------------------------------------------------
  // Bookmark CRUD
  // -----------------------------------------------------------------------

  Handle_BookmarkStaticLocation(args, session) {
    const charID = session && session.characterID;
    const itemID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const comment = normalizeText(args && args[3], "");
    const expiryMode = normalizeNumber(args && args[4], 0);
    const subfolderID = getSubfolderArg(args && args[5]);

    log.info(
      `[AccessGroupBookmarkMgr] BookmarkStaticLocation char=${charID} item=${itemID} folder=${folderID} name="${name}"`,
    );

    const target = runtime.resolveStaticBookmarkTarget(itemID, session);
    if (!target) {
      log.warn(
        `[AccessGroupBookmarkMgr] BookmarkStaticLocation: could not resolve geometry for item=${itemID}`,
      );
      throwWrappedUserError("BookmarkNotAvailable");
    }

    try {
      const created = runtime.createBookmark(charID, {
        folderID,
        memo: name,
        note: comment,
        expiryMode,
        subfolderID,
        ...target,
      });
      bookmarkNotifications.notifyBookmarksAdded(folderID, [created.bookmark], {
        excludeCharacterID: charID,
      });
      return buildBookmarkReplyTuple(created.bookmark);
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_BookmarkLocation(args, session) {
    const charID = session && session.characterID;
    const itemID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const comment = normalizeText(args && args[3], "");
    const expiryMode = normalizeNumber(args && args[4], 0);
    const subfolderID = getSubfolderArg(args && args[5]);

    log.info(
      `[AccessGroupBookmarkMgr] BookmarkLocation char=${charID} item=${itemID} folder=${folderID} name="${name}"`,
    );

    const scene = spaceRuntime.getSceneForSession(session);
    const target = resolveLocationBookmarkTarget(itemID, session, scene);
    if (!target) {
      throwWrappedUserError("BookmarkNotAvailable");
    }

    try {
      const created = runtime.createBookmark(charID, {
        folderID,
        memo: name,
        note: comment,
        expiryMode,
        subfolderID,
        ...target,
      });
      bookmarkNotifications.notifyBookmarksAdded(folderID, [created.bookmark], {
        excludeCharacterID: charID,
      });
      return buildBookmarkReplyTuple(created.bookmark);
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_UpdateBookmark(args, session) {
    const charID = session && session.characterID;
    const bookmarkID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const note = normalizeText(args && args[3], "");
    const subfolderID = getSubfolderArg(args && args[4]);
    const newFolderID = normalizeNumber(args && args[5], folderID);
    const expiryCancel = args && args[6] ? Boolean(args[6]) : false;

    log.info(
      `[AccessGroupBookmarkMgr] UpdateBookmark char=${charID} bm=${bookmarkID} folder=${newFolderID} name="${name}" expiryCancel=${expiryCancel}`,
    );

    try {
      const result = runtime.updateBookmark(
        charID,
        bookmarkID,
        folderID,
        name,
        note,
        subfolderID,
        newFolderID,
        expiryCancel,
      );
      bookmarkNotifications.notifyBookmarksUpdated(result.newFolderID, [result.bookmark], {
        excludeCharacterID: charID,
      });
    } catch (error) {
      return rethrowAsUserError(error);
    }
    return null;
  }

  Handle_DeleteBookmarks(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const bookmarkIDs = normalizeIDSetArg(args && args[1]);

    log.info(
      `[AccessGroupBookmarkMgr] DeleteBookmarks char=${charID} folder=${folderID} ids=${JSON.stringify(bookmarkIDs)}`,
    );

    let deleted;
    try {
      deleted = runtime.deleteBookmarks(charID, folderID, bookmarkIDs);
    } catch (error) {
      return rethrowAsUserError(error);
    }
    if (deleted.length > 0) {
      bookmarkNotifications.notifyBookmarksRemoved(folderID, deleted, {
        excludeCharacterID: charID,
      });
    }
    return buildList(deleted);
  }

  Handle_MoveBookmarksToFolderAndSubfolder(args, session) {
    const charID = session && session.characterID;
    const oldFolderID = normalizeNumber(args && args[0], 0);
    const newFolderID = normalizeNumber(args && args[1], 0);
    const subfolderID = getSubfolderArg(args && args[2]);
    const bookmarkIDs = normalizeIDSetArg(args && args[3]);

    log.info(
      `[AccessGroupBookmarkMgr] MoveBookmarks char=${charID} from=${oldFolderID} to=${newFolderID} subfolder=${subfolderID} count=${bookmarkIDs.length}`,
    );

    let result;
    try {
      result = runtime.moveBookmarks(charID, oldFolderID, newFolderID, subfolderID, bookmarkIDs);
    } catch (error) {
      return rethrowAsUserError(error);
    }

    if (result.movedBookmarks.length > 0) {
      bookmarkNotifications.notifyBookmarksMoved(
        result.oldFolderID,
        result.newFolderID,
        result.movedBookmarks,
        { excludeCharacterID: charID },
      );
    }

    const rows = result.movedBookmarks.map((bookmark) =>
      buildBookmarkPayload(bookmark),
    );
    return [buildList(rows), null];
  }

  Handle_CopyBookmarksToFolderAndSubfolder(args, session) {
    const charID = session && session.characterID;
    const oldFolderID = normalizeNumber(args && args[0], 0);
    const newFolderID = normalizeNumber(args && args[1], 0);
    const subfolderID = getSubfolderArg(args && args[2]);
    const bookmarkIDs = normalizeIDSetArg(args && args[3]);

    log.info(
      `[AccessGroupBookmarkMgr] CopyBookmarks char=${charID} from=${oldFolderID} to=${newFolderID} subfolder=${subfolderID} count=${bookmarkIDs.length}`,
    );

    let createdBookmarks;
    try {
      createdBookmarks = runtime.copyBookmarks(
        charID,
        oldFolderID,
        newFolderID,
        subfolderID,
        bookmarkIDs,
      );
    } catch (error) {
      return rethrowAsUserError(error);
    }

    if (createdBookmarks.length > 0) {
      bookmarkNotifications.notifyBookmarksAdded(newFolderID, createdBookmarks, {
        excludeCharacterID: charID,
      });
    }

    const dictEntries = createdBookmarks.map((bookmark) => [
      bookmark.bookmarkID,
      buildBookmarkPayload(bookmark),
    ]);
    return [buildDict(dictEntries), null];
  }

  // -----------------------------------------------------------------------
  // Subfolder CRUD
  // -----------------------------------------------------------------------

  Handle_CreateSubfolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const subfolderName = normalizeText(args && args[1], "");

    log.info(
      `[AccessGroupBookmarkMgr] CreateSubfolder char=${charID} folder=${folderID} name="${subfolderName}"`,
    );

    try {
      const subfolder = runtime.createSubfolder(charID, folderID, subfolderName);
      bookmarkNotifications.notifySubfolderAdded(folderID, subfolder, {
        excludeCharacterID: charID,
      });
      return buildSubfolderPayload(subfolder);
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_UpdateSubfolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const subfolderID = normalizeNumber(args && args[1], 0);
    const subfolderName = normalizeText(args && args[2], "");

    log.info(
      `[AccessGroupBookmarkMgr] UpdateSubfolder char=${charID} folder=${folderID} subfolder=${subfolderID} name="${subfolderName}"`,
    );

    try {
      const updated = runtime.updateSubfolder(charID, folderID, subfolderID, subfolderName);
      if (updated) {
        bookmarkNotifications.notifySubfolderUpdated(folderID, subfolderID, subfolderName, {
          excludeCharacterID: charID,
        });
      }
      return updated;
    } catch (error) {
      return rethrowAsUserError(error);
    }
  }

  Handle_DeleteSubfolder(args, session) {
    const charID = session && session.characterID;
    const folderID = normalizeNumber(args && args[0], 0);
    const subfolderID = normalizeNumber(args && args[1], 0);

    log.info(
      `[AccessGroupBookmarkMgr] DeleteSubfolder char=${charID} folder=${folderID} subfolder=${subfolderID}`,
    );

    let deletedBmIDs;
    try {
      deletedBmIDs = runtime.deleteSubfolder(charID, folderID, subfolderID);
    } catch (error) {
      return rethrowAsUserError(error);
    }

    bookmarkNotifications.notifySubfolderRemoved(folderID, subfolderID, {
      excludeCharacterID: charID,
    });
    if (deletedBmIDs.length > 0) {
      bookmarkNotifications.notifyBookmarksRemoved(folderID, deletedBmIDs, {
        excludeCharacterID: charID,
      });
    }

    return buildList(deletedBmIDs);
  }
}

module.exports = AccessGroupBookmarkMgrService;
