const path = require("path");
const { toBigInt } = require("../character/characterState");
const {
  getCurrentSolarSystemID,
  getLocalChatRoomNameForSolarSystemID,
  isDelayedLocalChatRoomName,
  parseLocalChatRoomName,
} = require("./channelRules");
const {
  sendSessionSystemMessage,
  moveSessionToCurrentLocalRoom,
  unregisterCharacterSession: unregisterXmppCharacterSession,
  refreshSessionChatRolePresence: refreshXmppSessionChatRolePresence,
} = require("./xmppStubServer");
const {
  getXmppConferenceDomain,
} = require("./xmppConfig");
const chatRuntime = require(path.join(
  __dirname,
  "../../_secondary/chat/chatRuntime",
));

// Local/corp/fleet chat runs over XMPP MUC (member roster + messages) and the
// protobuf local-chat gateway (companion). The legacy LSC `OnLSC` push was
// removed: the V24 client has no live `OnLSC` consumer (the string exists only
// in eve/common/lib/marshalstrings.py; there is no `def OnLSC`, no LSC service
// registration, and no __notifyevents__ entry), and the golden "Logging In To
// Space" capture contains zero OnLSC/presence traffic for Local. All Local
// membership + delivery now flows through chatRuntime (gateway) and
// xmppStubServer (XMPP); this module only builds the LSC RPC response shapes
// (the LSC service is still advertised in machoNet.GetInitVals for parity, but
// the current client never calls it).

const CHANNEL_MODE_CONVERSATIONALIST = 3;
const CHANNEL_HEADERS = [
  "channelID",
  "ownerID",
  "displayName",
  "motd",
  "comparisonKey",
  "memberless",
  "password",
  "mailingList",
  "cspa",
  "temporary",
  "languageRestriction",
  "groupMessageID",
  "channelMessageID",
  "mode",
  "subscribed",
  "estimatedMemberCount",
];
const CHANNEL_MOD_HEADERS = [
  "accessor",
  "mode",
  "untilWhen",
  "originalMode",
  "admin",
  "reason",
];
const CHANNEL_CHAR_HEADERS = [
  "charID",
  "corpID",
  "mode",
  "allianceID",
  "warFactionID",
  "role",
  "extra",
];
const EXTRA_CHAR_HEADERS = ["ownerID", "ownerName", "typeID"];

function buildList(items) {
  return { type: "list", items };
}

function buildRowset(header, lines) {
  return {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", buildList(lines)],
      ],
    },
  };
}

function buildRow(header, line) {
  return {
    type: "object",
    name: "util.Row",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["line", buildList(line)],
      ],
    },
  };
}

function buildLocalChannel(channelID) {
  const normalizedChannelID = Number(channelID || 30000142) || 30000142;
  const channelName = getLocalChannelName(normalizedChannelID);
  const persistedRecord = chatRuntime.ensureChannel(channelName) || {};
  return {
    key: `solarsystemid2:${normalizedChannelID}`,
    id: normalizedChannelID,
    type: "solarsystemid2",
    ownerID: 1,
    displayName: persistedRecord.displayName || "Local",
    motd:
      persistedRecord.motd ||
      "<br>EveJS Elysian Local Chat<br>Commands: /help, /wallet, /where, /who, /ship <name|typeID>, /laser, /lesmis, /gmships, /gmskills, /backintime, /expertsystem",
    comparisonKey: channelName,
    memberless: false,
    password: null,
    mailingList: false,
    cspa: 0,
    temporary: false,
    languageRestriction: false,
    groupMessageID: 0,
    channelMessageID: 0,
    mode: CHANNEL_MODE_CONVERSATIONALIST,
    subscribed: true,
  };
}

function getLocalChannelForSession(session) {
  return buildLocalChannel(getCurrentSolarSystemID(session));
}

function getLocalChannelName(channelID) {
  return getLocalChatRoomNameForSolarSystemID(channelID);
}

function isDelayedLocalChannel(channel) {
  return isDelayedLocalChatRoomName(
    channel && (channel.comparisonKey || getLocalChannelName(channel.id)),
  );
}

// Authoritative Local occupant set for the LSC RPC response. chatRuntime is the
// single source of truth for who is visible in a Local room (all pilots in
// immediate systems; only speakers in delayed wormhole/Pochven/Zarzakh rooms).
function getLocalChannelMembers(channel) {
  return chatRuntime
    .getVisibleLocalSessions(channel.comparisonKey || getLocalChannelName(channel.id))
    .filter((session) => session && session.socket && !session.socket.destroyed);
}

function getEstimatedMemberCount(channel) {
  if (isDelayedLocalChannel(channel)) {
    return 0;
  }
  return chatRuntime.getEstimatedMemberCount(
    channel.comparisonKey || getLocalChannelName(channel.id),
  );
}

function buildChannelInfoLine(channel) {
  return buildList([
    channel.id,
    channel.ownerID,
    channel.displayName,
    channel.motd,
    channel.comparisonKey,
    channel.memberless,
    channel.password,
    channel.mailingList,
    channel.cspa,
    channel.temporary,
    channel.languageRestriction,
    channel.groupMessageID,
    channel.channelMessageID,
    channel.mode,
    channel.subscribed,
    getEstimatedMemberCount(channel),
  ]);
}

function buildChannelInfo(channel) {
  return buildRow(CHANNEL_HEADERS, [
    channel.id,
    channel.ownerID,
    channel.displayName,
    channel.motd,
    channel.comparisonKey,
    channel.memberless,
    channel.password,
    channel.mailingList,
    channel.cspa,
    channel.temporary,
    channel.languageRestriction,
    channel.groupMessageID,
    channel.channelMessageID,
    channel.mode,
    channel.subscribed,
    getEstimatedMemberCount(channel),
  ]);
}

function buildChannelMods() {
  return buildRowset(CHANNEL_MOD_HEADERS, []);
}

function buildCharacterExtra(session) {
  return buildRow(EXTRA_CHAR_HEADERS, [
    session.characterID || session.userid || 0,
    session.characterName || session.userName || "Unknown",
    session.characterTypeID || 1373,
  ]);
}

function buildChannelChars(channel) {
  const lines = getLocalChannelMembers(channel).map((session) =>
    buildList([
      session.characterID || session.userid || 0,
      session.corporationID || 0,
      CHANNEL_MODE_CONVERSATIONALIST,
      session.allianceID || 0,
      session.warFactionID || 0,
      { type: "long", value: toBigInt(session.role || 0) },
      buildCharacterExtra(session),
    ]),
  );

  return buildRowset(CHANNEL_CHAR_HEADERS, lines);
}

function buildChannelDescriptor(channel) {
  return [[channel.type, channel.id]];
}

function getChannelsForSession(session) {
  const channel = getLocalChannelForSession(session);
  return buildRowset(CHANNEL_HEADERS, [buildChannelInfoLine(channel)]);
}

function joinLocalChannel(session) {
  const channel = getLocalChannelForSession(session);
  chatRuntime.joinLocalLsc(session);

  return {
    channel,
    result: [
      buildChannelDescriptor(channel),
      1,
      [buildChannelInfo(channel), buildChannelMods(), buildChannelChars(channel)],
    ],
  };
}

function leaveLocalChannel(session) {
  const channel = getLocalChannelForSession(session);
  chatRuntime.leaveLocalLsc(session);
  return channel;
}

function moveLocalSession(session, previousChannelID = 0) {
  if (!session || !session.socket || session.socket.destroyed) {
    return null;
  }

  const newChannel = getLocalChannelForSession(session);
  const runtimeResult = chatRuntime.moveLocalLsc(session, previousChannelID);
  moveSessionToCurrentLocalRoom(session);

  return {
    previousChannelID: Number(previousChannelID || 0) || 0,
    newChannel,
    moved: Boolean(runtimeResult && runtimeResult.moved),
  };
}

function unregisterSession(session) {
  chatRuntime.unregisterSession(session);
  unregisterXmppCharacterSession(session);
}

function broadcastLocalMessage(session, message) {
  chatRuntime.broadcastLocalMessage(session, message);
}

function refreshSessionChatRolePresence(session) {
  chatRuntime.publishLocalMembershipRefresh(session);
  return refreshXmppSessionChatRolePresence(session);
}

function buildRoomJid(roomNameOrJid) {
  const trimmed = String(roomNameOrJid || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("@")) {
    return trimmed;
  }
  return `${trimmed}@${getXmppConferenceDomain()}`;
}

function resolveSystemMessageTarget(session, specificChannel = null) {
  if (!specificChannel) {
    const channel = getLocalChannelForSession(session);
    return {
      channel,
      roomJid: buildRoomJid(
        channel.comparisonKey || getLocalChannelName(channel.id),
      ),
    };
  }

  if (typeof specificChannel === "string") {
    const trimmed = specificChannel.trim();
    if (!trimmed) {
      return resolveSystemMessageTarget(session, null);
    }

    const parsedLocalChannel = parseLocalChatRoomName(trimmed);
    if (parsedLocalChannel) {
      const channel = buildLocalChannel(parsedLocalChannel.solarSystemID);
      return {
        channel,
        roomJid: buildRoomJid(channel.comparisonKey),
      };
    }

    return {
      channel: null,
      roomJid: buildRoomJid(trimmed),
    };
  }

  const channel = specificChannel;
  return {
    channel,
    roomJid: buildRoomJid(
      channel.comparisonKey || getLocalChannelName(channel.id),
    ),
  };
}

function sendSystemMessage(session, message, specificChannel = null) {
  const { roomJid } = resolveSystemMessageTarget(session, specificChannel);
  sendSessionSystemMessage(session, message, roomJid);
}

module.exports = {
  getChannelsForSession,
  joinLocalChannel,
  leaveLocalChannel,
  moveLocalSession,
  unregisterSession,
  broadcastLocalMessage,
  refreshSessionChatRolePresence,
  sendSystemMessage,
  getLocalChannelForSession,
  getLocalChannelName,
};
