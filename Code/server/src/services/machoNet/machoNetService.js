/**
 * MachoNet Service
 *
 * Handles initial server info queries from the client.
 * This is one of the first services called after handshake.
 * The client calls machoNet.GetInitVals() to get server configuration.
 *
 * Based on NetService.cpp in EVEmu.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildDict,
  buildKeyVal,
  extractDictEntries,
  normalizeNumber,
  normalizeText,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildGlobalConfigDict,
  buildServerStatusResponse,
  getRuntimeGlobalConfigOverrides,
  getRuntimeGlobalConfigValue,
  resetRuntimeGlobalConfigForTests,
  setRuntimeGlobalConfigValue,
} = require(path.join(__dirname, "./globalConfig"));

const MAX_AUDIT_EVENTS = 100;
const auditEvents = [];
let clientCodeHashOverride = null;

function toText(value, fallback = "") {
  const unwrapped = unwrapMarshalValue(value);
  const text = normalizeText(unwrapped, fallback);
  return text === "" ? fallback : text;
}

function toInteger(value, fallback = 0) {
  const numericValue = normalizeNumber(unwrapMarshalValue(value), fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toBoolean(value, fallback = false) {
  const unwrapped = unwrapMarshalValue(value);
  if (typeof unwrapped === "boolean") {
    return unwrapped;
  }
  if (unwrapped === undefined || unwrapped === null) {
    return fallback;
  }
  if (typeof unwrapped === "number") {
    return unwrapped !== 0;
  }
  const normalized = String(unwrapped).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function getKwarg(kwargs, key, fallback = undefined) {
  for (const [entryKey, entryValue] of extractDictEntries(kwargs)) {
    if (toText(entryKey, "") === key) {
      return entryValue;
    }
  }

  const unwrapped = unwrapMarshalValue(kwargs);
  if (
    unwrapped &&
    typeof unwrapped === "object" &&
    !Array.isArray(unwrapped) &&
    Object.prototype.hasOwnProperty.call(unwrapped, key)
  ) {
    return unwrapped[key];
  }

  return fallback;
}

function recordAuditEvent(kind, session = null, extra = {}) {
  auditEvents.push({
    kind,
    accountID: toInteger(
      session && (session.userid || session.userID || session.accountID),
      0,
    ) || null,
    characterID: toInteger(
      session && (session.characterID || session.charID || session.charid),
      0,
    ) || null,
    ...extra,
    recordedAt: new Date().toISOString(),
  });
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
}

function normalizeClientCodeHashRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const hash = toText(record.hash, "").trim();
  if (!hash) {
    return null;
  }
  return {
    hash,
    fileurl: toText(record.fileurl || record.fileUrl, null),
    build: toInteger(record.build, config.clientBuild || 0),
  };
}

function buildClientCodeHashPayload(record) {
  const normalized = normalizeClientCodeHashRecord(record);
  if (!normalized) {
    return null;
  }
  return buildKeyVal([
    ["hash", normalized.hash],
    ["fileurl", normalized.fileurl],
    ["build", normalized.build],
  ]);
}

function notifySession(session, notificationName, payload) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  session.sendNotification(notificationName, "clientID", payload);
  return true;
}

class MachoNetService extends BaseService {
  constructor(options = {}) {
    super("machoNet");
    this.getSessions =
      typeof options.getSessions === "function"
        ? options.getSessions
        : () => sessionRegistry.getSessions();
    this.clientCodeHashProvider =
      typeof options.clientCodeHashProvider === "function"
        ? options.clientCodeHashProvider
        : null;
  }

  /**
   * GetInitVals — returns initial server values
   *
   * From NetService.cpp: Returns [serviceInfo, emptyDict]
   * serviceInfo is a dict mapping service names to their access level.
   * The client uses this at ServiceCallGPCS.py:197 to know where
   * to route service calls:
   *   where = self.machoNet.serviceInfo[service]
   *
   * Access levels from C++:
   *   None   = direct call (unbound services)
   *   "location" / "locationPreferred" / "solarsystem" / "solarsystem2"
   *   "station" / "character" / "corporation" / "bulk"
   */
  getServiceInfoDict() {
    return {
      type: "dict",
      entries: [
        ["machoNet", null],
        ["config", null],
        ["cache", null],
        ["objectCaching", null],
        ["alert", null],
        ["authentication", null],
        ["account", null],
        ["bannedwords", null],
        ["storeManager", null],
        ["vaultManager", null],
        ["FastCheckoutService", null],
        ["kiringMgr", null],
        ["contextualOfferMgr", null],
        ["charUnboundMgr", null],
        ["charMgr", null],
        ["characterEnergyMgr", null],
        ["home_station", null],
        ["homestation", null],
        ["homeStation", null],
        ["corpRegistry", null],
        ["allianceRegistry", null],
        ["corpmgr", null],
        ["corpRecProxy", null],
        ["fwCharacterEnlistmentMgr", null],
        ["corpStationMgr", null],
        ["officeManager", null],
        ["itemLocking", null],
        ["stationSvc", null],
        ["station", "station"],
        ["ship", "station"],
        ["map", null],
        ["dynamicBountyMgr", null],
        ["dynamicResourceCacheMgr", null],
        ["essMgr", null],
        ["marketProxy", null],
        ["structureDirectory", null],
        ["structureVulnerability", null],
        ["structureCargoDelivery", null],
        ["structureDeliveries", null],
        ["structure", null],
        ["structureCynoBeaconMgr", null],
        ["structureJumpBridgeMgr", null],
        ["structureDeployment", null],
        ["structureProfiles", null],
        ["structureControl", null],
        ["structureDocking", null],
        ["structureHangarViewMgr", null],
        ["fwWarzoneSolarsystem", null],
        ["localizationServer", null],
        ["serviceGatewayMgr", null],
        ["publicQaToolsServer", null],
        ["infoGatheringMgr", null],
        ["loadService", null],
        ["beyonce", "solarsystem2"],
        ["eject", "solarsystem2"],
        ["planetMgr", "solarsystem2"],
        ["planetOrbitalRegistryBroker", "solarsystem2"],
        ["posMgr", "solarsystem2"],
        ["scanMgr", null],
        ["miningScanMgr", null],
        ["characterMiningLedger", null],
        ["corpMiningLedger", null],
        ["inSpaceCompressionMgr", null],
        ["structureCompressionMgr", null],
        ["dogmaIM", "character"],
        ["invbroker", "station"],
        ["trademgr", "station"],
        ["tradeMgr", "station"],
        ["charFittingMgr", null],
        ["corpFittingMgr", null],
        ["allianceFittingMgr", null],
        ["superWeaponMgr", null],
        ["LSC", null],
        ["chatAuthenticationService", null],
        ["onlineStatus", null],
        ["billMgr", null],
        ["corporationSvc", null],
        ["voteManager", null],
        ["warRegistry", null],
        ["warStatisticMgr", null],
        ["warsInfoMgr", null],
        ["mutualWarInviteMgr", null],
        ["peaceTreatyMgr", null],
        ["lookupSvc", null],
        ["certificateMgr", null],
        ["tutorialSvc", null],
        ["operationsManager", null],
        ["air_npe", null],
        ["nes_intro", null],
        ["agentMgr", null],
        ["epicArcStatus", null],
        ["bookmarkMgr", null],
        ["accessGroupBookmarkMgr", null],
        ["ownerGroupManager", null],
        ["calendarMgr", null],
        ["calendarProxy", null],
        ["standing2", null],
        ["missionTrackerMgr", null],
        ["dungeonExplorationMgr", null],
        ["dungeonInstanceCacheMgr", null],
        ["RWManager", null],
        ["shipCasterLandingPadMgr", null],
        ["shipCasterLauncherMgr", null],
        ["shipcasterTravelMgr", null],
        ["starterShipcasterTravelMgr", null],
        ["randomJumpMgr", null],
        ["warpVectorMgr", null],
        ["encodedItems", null],
        ["shipStanceMgr", null],
        ["ingamereport", null],
        ["eveguard_report", null],
        ["petitioner", null],
        ["tourneyMgr", null],
        ["survey", null],
        ["userSvc", null],
        ["structureGuests", null],
        ["skillMgr", null],
        ["skillMgr2", null],
        ["skillHandler", null],
        ["wormholeMgr", null],
        ["alphaInjectorMgr", null],
        ["nonDiminishingInjectionMgr", null],
        ["contractMgr", null],
        ["blueprintManager", null],
        ["facilityManager", null],
        ["industryManager", null],
        ["industryMonitor", null],
        ["repairSvc", "station"],
        ["repackagingSvc", null],
        ["reprocessingSvc", "station"],
        ["insuranceSvc", "station"],
        ["jumpCloneSvc", null],
        ["LPSvc", "station"],
        ["LPStoreMgr", "station"],
        ["publicGatewaySvc", null],
        ["slash", null],
        ["subscriptionMgr", null],
        ["multiLoginBlocker", null],
        ["raffleProxy", null],
        ["raffleMgr", null],
        ["crateService", null],
        ["loginCampaignManager", null],
        ["seasonalLoginCampaignManager", null],
        ["loginRewardFacilities", null],
        ["rewardMgr", null],
      ],
    };
  }

  Handle_GetInitVals(args, session) {
    log.info("[MachoNet] GetInitVals");
    // Return [serviceInfo, globalConfig]
    // globalConfig is used by client for things like:
    //   machoNet.GetGlobalConfig().get('imageserverurl') - portrait/logo image server
    //   machoNet.GetGlobalConfig().get('defaultPortraitSaveSize') - portrait save size
    return [this.getServiceInfoDict(), buildGlobalConfigDict()];
  }

  Handle_GetServiceInfo(args, session) {
    log.debug("[MachoNet] GetServiceInfo");
    return this.getServiceInfoDict();
  }

  Handle_GetGlobalConfig(args, session) {
    log.debug("[MachoNet] GetGlobalConfig");
    return buildGlobalConfigDict();
  }

  Handle_GetGlobalConfigValue(args, session, kwargs) {
    const key = toText(
      (args && args[0]) || getKwarg(kwargs, "key", ""),
      "",
    ).trim();
    if (!key) {
      return ["", ""];
    }
    const value = getRuntimeGlobalConfigValue(key);
    return value === null || value === undefined ? ["", ""] : [key, value];
  }

  Handle_SetGlobalConfigValue(args, session, kwargs) {
    const key = toText(
      getKwarg(kwargs, "key", args && args[0]),
      "",
    ).trim();
    const rawValue = getKwarg(kwargs, "value", args && args[1]);
    const value = unwrapMarshalValue(rawValue);
    const isDelete = toBoolean(
      getKwarg(kwargs, "isDelete", args && args[2]),
      false,
    );
    const isUpdate = toBoolean(
      getKwarg(kwargs, "isUpdate", args && args[3]),
      true,
    );
    const isUpdateClients = toBoolean(
      getKwarg(kwargs, "isUpdateClients", args && args[4]),
      true,
    );

    if (!key) {
      recordAuditEvent("set_global_config_value_ignored", session, {
        reason: "missing_key",
      });
      return null;
    }

    setRuntimeGlobalConfigValue(key, value, { isDelete });
    const nextValue = isDelete ? null : value;
    let notifiedSessions = 0;
    if (isUpdateClients) {
      const seenSessions = new Set();
      const sessions = [
        session,
        ...(Array.isArray(this.getSessions()) ? this.getSessions() : []),
      ];
      for (const targetSession of sessions) {
        if (!targetSession || seenSessions.has(targetSession)) {
          continue;
        }
        seenSessions.add(targetSession);
        if (notifySession(targetSession, "OnGlobalConfigUpdated", [key, nextValue])) {
          notifiedSessions += 1;
        }
      }
    }

    recordAuditEvent("set_global_config_value", session, {
      key,
      value: nextValue,
      isDelete,
      isUpdate,
      isUpdateClients,
      notifiedSessions,
    });
    log.debug(
      `[MachoNet] SetGlobalConfigValue key=${key} deleted=${isDelete} notify=${notifiedSessions}`,
    );
    return null;
  }

  Handle_GetServerStatus(args, session) {
    log.debug("[MachoNet] GetServerStatus");
    return buildServerStatusResponse();
  }

  /**
   * GetTime — returns the current server time as a Win32 FILETIME
   */
  Handle_GetTime(args, session) {
    log.debug("[MachoNet] GetTime");
    // Convert to Win32 FILETIME (100-nanosecond intervals since 1601-01-01)
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    return { type: "long", value: now };
  }

  Handle_ReloadClientCodeHash(args, session) {
    const providerRecord = this.clientCodeHashProvider
      ? this.clientCodeHashProvider({ args, session })
      : null;
    const payload = buildClientCodeHashPayload(providerRecord || clientCodeHashOverride);
    recordAuditEvent("reload_client_code_hash", session, {
      hasUpdate: payload !== null,
    });
    return payload;
  }

  Handle_ForwardCharacterNotification(args, session) {
    const characterID = toInteger(args && args[0], 0);
    const methodName = toText(args && args[1], "").trim();
    const payload = Array.isArray(args) ? args.slice(2) : [];
    let forwardedCount = 0;

    if (characterID > 0 && methodName) {
      const sessions = Array.isArray(this.getSessions()) ? this.getSessions() : [];
      for (const targetSession of sessions) {
        const targetCharacterID = toInteger(
          targetSession && (
            targetSession.characterID ||
            targetSession.charID ||
            targetSession.charid
          ),
          0,
        );
        if (targetCharacterID !== characterID) {
          continue;
        }
        if (notifySession(targetSession, methodName, payload)) {
          forwardedCount += 1;
        }
      }
    }

    recordAuditEvent("forward_character_notification", session, {
      targetCharacterID: characterID || null,
      methodName: methodName || null,
      payloadCount: payload.length,
      forwardedCount,
    });
    return null;
  }

  Handle_GetNodeFromAddress(args) {
    const serviceID = (args && args[0]) || null;
    const address = args && args.length > 1 ? unwrapMarshalValue(args[1]) : null;
    recordAuditEvent("get_node_from_address", null, {
      serviceID: unwrapMarshalValue(serviceID),
      address,
      nodeID: config.proxyNodeId,
    });
    return config.proxyNodeId;
  }

  Handle_GetNodeID() {
    return config.proxyNodeId;
  }

  Handle_GetClusterGameStatisticsForClient(args, session) {
    log.debug("[MachoNet] GetClusterGameStatisticsForClient");
    // V23.02 mapSvc unpacks:
    //   sol, sta, statDivisor =
    //     sm.ProxySvc('machoNet').GetClusterGameStatisticsForClient('EVE', ({}, {}, 0))
    // and then iterates sol/sta as dict-like objects while dividing by
    // statDivisor. The safe empty-state contract is therefore:
    //   ({}, {}, 1)
    return [{}, {}, 1];
  }
}

module.exports = MachoNetService;
module.exports._testing = {
  getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }));
  },
  getRuntimeGlobalConfigOverrides,
  resetForTests() {
    auditEvents.length = 0;
    clientCodeHashOverride = null;
    resetRuntimeGlobalConfigForTests();
  },
  setClientCodeHash(record) {
    clientCodeHashOverride = normalizeClientCodeHashRecord(record);
  },
};
