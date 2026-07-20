const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { getLocalChannelForSession } = require("./chatHub");
const chatRuntime = require("../../_secondary/chat/chatRuntime");
const {
  getHelpChannelContract,
  getRookieHelpChannelContract,
  normalizeLanguageCode,
} = require("../../_secondary/chat/staticChannelContracts");
const {
  getXmppConnectHost,
} = require("./xmppConfig");
const {
  normalizeRoleValue,
} = require("../account/accountRoleProfiles");

const ROLE_CHTADMINISTRATOR = 2097152n;
const ROLE_GML = 18014398509481984n;
const CHANNEL_OWNERSHIP_GRANT_ROLES = ROLE_CHTADMINISTRATOR | ROLE_GML;

function getCorpChannelName(session) {
  const corpId = Number(
    (session && (session.corporationID || session.corpid)) || 0,
  );
  return `corp_${corpId}`;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(unwrapMarshalScalar(value));
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

function unwrapMarshalScalar(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapMarshalScalar(value.value);
    }
    if (
      value.type === "object" &&
      Object.prototype.hasOwnProperty.call(value, "name")
    ) {
      return unwrapMarshalScalar(value.name);
    }
  }
  return value;
}

function normalizeText(value, fallback = "") {
  const unwrappedValue = unwrapMarshalScalar(value);
  if (typeof unwrappedValue === "string") {
    return unwrappedValue;
  }
  if (unwrappedValue === null || unwrappedValue === undefined) {
    return fallback;
  }
  return String(unwrappedValue);
}

function getCharacterID(session) {
  return normalizePositiveInteger(
    session && (session.characterID || session.charid || session.userid),
    0,
  );
}

function getSessionLanguageID(session) {
  return normalizeLanguageCode(
    session &&
      (
        session.languageID ||
        session.languageId ||
        session.language ||
        session.lang
      ),
  );
}

function resolveChannelName(channelID, session) {
  const normalized = normalizeText(channelID, "").trim();
  if (!normalized || normalized === "local") {
    const channel = getLocalChannelForSession(session);
    return channel ? channel.comparisonKey : "";
  }
  return normalized;
}

function normalizeGrantableChannelName(channelID) {
  const normalized = normalizeText(channelID, "").trim();
  const roomName = normalized.split("@")[0].trim();
  if (/^player_\d+$/i.test(roomName)) {
    return roomName;
  }
  if (/^system_\d+(?:_\d+)+$/i.test(roomName)) {
    return roomName;
  }
  return "";
}

function hasChannelOwnershipGrantRole(session) {
  const role = normalizeRoleValue(session && session.role, 0n);
  return (role & CHANNEL_OWNERSHIP_GRANT_ROLES) !== 0n;
}

class XmppChatMgrService extends BaseService {
  constructor() {
    super("XmppChatMgr");
  }

  Handle_Hostname(args, session) {
    log.debug("[XmppChatMgr] Hostname called");
    return getXmppConnectHost();
  }

  Handle_GetDeprecatedPrefsFallback(args, session) {
    log.debug("[XmppChatMgr] GetDeprecatedPrefsFallback called");
    return getXmppConnectHost();
  }

  Handle_ResyncSystemChannelAccess(args, session) {
    const fallbackChannel = getLocalChannelForSession(session);
    const channels = chatRuntime.getChannelsForStaticAccess(session);
    if (channels.length === 0 && fallbackChannel) {
      channels.push(fallbackChannel.comparisonKey, getCorpChannelName(session));
    }
    log.debug(
      `[XmppChatMgr] ResyncSystemChannelAccess -> ${JSON.stringify(channels)}`,
    );
    return channels;
  }

  Handle_GetHelpChannel(args, session) {
    const contract = getHelpChannelContract(getSessionLanguageID(session));
    if (!contract) {
      return null;
    }
    chatRuntime.ensureChannel(contract.roomName);
    return contract.roomName;
  }

  Handle_GetRookieChannel(args, session) {
    const contract = getRookieHelpChannelContract();
    if (!contract) {
      return null;
    }
    chatRuntime.ensureChannel(contract.roomName);
    return contract.roomName;
  }

  Handle_GetRookieHelpChannel(args, session) {
    return this.Handle_GetRookieChannel(args, session);
  }

  Handle_GMMute(args, session) {
    const channelName = resolveChannelName(args && args[0], session);
    const characterID = normalizePositiveInteger(args && args[1], 0);
    const reason = normalizeText(args && args[2], "");
    const durationSeconds = Math.max(0, Number(args && args[3]) || 0);
    if (!channelName || !characterID) {
      return false;
    }
    chatRuntime.muteChannelCharacter(
      channelName,
      characterID,
      durationSeconds * 1000,
      reason,
      getCharacterID(session),
    );
    log.info(
      `[XmppChatMgr] GMMute channel=${channelName} characterID=${characterID} duration_seconds=${durationSeconds}`,
    );
    return true;
  }

  Handle_GMUnmute(args, session) {
    const channelName = resolveChannelName(args && args[0], session);
    const characterID = normalizePositiveInteger(args && args[1], 0);
    if (!channelName || !characterID) {
      return false;
    }
    chatRuntime.unmuteChannelCharacter(channelName, characterID);
    log.info(
      `[XmppChatMgr] GMUnmute channel=${channelName} characterID=${characterID}`,
    );
    return true;
  }

  Handle_EnsureResourceWarsChannelExists(args, session) {
    const instanceID = normalizePositiveInteger(args && args[0], 0);
    if (!instanceID) {
      return null;
    }
    const record = chatRuntime.ensureResourceWarsChannel(instanceID);
    log.info(
      `[XmppChatMgr] EnsureResourceWarsChannelExists instanceID=${instanceID} room=${record ? record.roomName : ""}`,
    );
    return record ? record.roomName : null;
  }

  Handle_CreatePlayerOwnedChannel(args, session) {
    const displayName = normalizeText(args && args[0], "").trim();
    if (!displayName) {
      return null;
    }

    const created = chatRuntime.createPlayerChannel(session, {
      displayName,
    });
    log.info(
      `[XmppChatMgr] CreatePlayerOwnedChannel displayName=${displayName} channelID=${created ? created.channelID : 0} room=${created && created.roomName ? created.roomName : ""}`,
    );
    return created ? created.roomName : null;
  }

  Handle_CreatePrivateChannel(args, session) {
    // "Open Conversation": the client calls XmppChat.Invite(charid) ->
    // CreatePrivateChannel(charid), which RPCs here to allocate the private
    // room. Returning null makes the client raise "Could not create channel for
    // private chat", so the conversation never opens.
    const targetCharacterID = normalizePositiveInteger(args && args[0], 0);
    const callerCharacterID = getCharacterID(session);
    if (
      !targetCharacterID ||
      !callerCharacterID ||
      targetCharacterID === callerCharacterID
    ) {
      log.debug(
        `[XmppChatMgr] CreatePrivateChannel rejected caller=${callerCharacterID || 0} target=${targetCharacterID || 0}`,
      );
      return null;
    }

    const record = chatRuntime.ensurePrivateChannelForCharacters(
      callerCharacterID,
      targetCharacterID,
    );
    const roomName = record ? record.roomName : null;
    log.info(
      `[XmppChatMgr] CreatePrivateChannel caller=${callerCharacterID} target=${targetCharacterID} room=${roomName || ""}`,
    );
    return roomName;
  }

  Handle_AddCharacterToChannel(args, session) {
    // Elevated callers (CHTADMINISTRATOR/GML/LEGIONEER) invite through this RPC
    // instead of a mediated MUC invite. Persist the invite and push the XMPP
    // invite so the target's client opens the channel window.
    const channelName = normalizeText(args && args[0], "")
      .split("@")[0]
      .trim();
    const targetCharacterID = normalizePositiveInteger(args && args[1], 0);
    const reason = normalizeText(args && args[2], "");
    if (!channelName || !targetCharacterID) {
      return false;
    }

    const inviterCharacterID = getCharacterID(session);
    const { inviteCharacterToRoom } = require("./xmppStubServer");
    inviteCharacterToRoom(
      channelName,
      inviterCharacterID,
      targetCharacterID,
      reason,
    );
    log.info(
      `[XmppChatMgr] AddCharacterToChannel channel=${channelName} target=${targetCharacterID} inviter=${inviterCharacterID}`,
    );
    return true;
  }

  Handle_GrantChannelOwnership(args, session) {
    const channelName = normalizeGrantableChannelName(args && args[0]);
    const characterID = getCharacterID(session);
    if (!channelName || !characterID || !hasChannelOwnershipGrantRole(session)) {
      log.debug(
        `[XmppChatMgr] GrantChannelOwnership denied channel=${channelName || "invalid"} characterID=${characterID || 0}`,
      );
      return false;
    }

    chatRuntime.setChannelOwner(channelName, characterID);
    const updatedRecord = chatRuntime.updateChannel(channelName, (record) => {
      const bannedCharacters = { ...(record.bannedCharacters || {}) };
      delete bannedCharacters[String(characterID)];

      return {
        ...record,
        denyCharacterIDs: (record.denyCharacterIDs || []).filter(
          (candidate) => candidate !== characterID,
        ),
        bannedCharacters,
      };
    });

    log.info(
      `[XmppChatMgr] GrantChannelOwnership channel=${channelName} characterID=${characterID}`,
    );
    return Boolean(updatedRecord);
  }
}

XmppChatMgrService._testing = {
  hasChannelOwnershipGrantRole,
  normalizeGrantableChannelName,
};

module.exports = XmppChatMgrService;
