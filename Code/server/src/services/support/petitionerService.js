const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildList,
  normalizeNumber,
  normalizeText,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const HELP_CENTER_URL = "https://support.eveonline.com/hc/en-us";
const SUBMIT_REQUEST_URL = `${HELP_CENTER_URL}/requests/new`;
const MAY_PETITION_DISABLED = -4;
const MAX_AUDIT_EVENTS = 200;
const auditEvents = [];

function toPositiveInteger(value, fallback = 0) {
  const numeric = Math.trunc(normalizeNumber(unwrapMarshalValue(value), fallback));
  return numeric > 0 ? numeric : fallback;
}

function toText(value, fallback = "") {
  return normalizeText(unwrapMarshalValue(value), fallback);
}

function safeClone(value) {
  try {
    return value === undefined ? null : JSON.parse(JSON.stringify(unwrapMarshalValue(value)));
  } catch (error) {
    return null;
  }
}

function getSessionCharacterID(session) {
  return toPositiveInteger(
    session && (session.characterID || session.charid || session.clientID),
    0,
  );
}

function getSessionAccountID(session) {
  return toPositiveInteger(
    session && (session.userid || session.userID || session.accountID),
    0,
  );
}

function kwargsToObject(kwargs) {
  const unwrapped = unwrapMarshalValue(kwargs);
  return unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
    ? unwrapped
    : {};
}

function recordAuditEvent(kind, args = [], session = null, extra = {}) {
  const event = {
    eventID: auditEvents.length + 1,
    kind,
    characterID: getSessionCharacterID(session),
    accountID: getSessionAccountID(session),
    args: safeClone(args),
    recordedAt: new Date().toISOString(),
    ...extra,
  };
  auditEvents.push(event);
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
  log.debug(
    `[Petitioner] ${kind} char=${event.characterID || "?"} account=${event.accountID || "?"}`,
  );
  return event;
}

function buildZendeskLink(kwargs = null) {
  const ticketID = toPositiveInteger(kwargsToObject(kwargs).ticketID, 0);
  if (ticketID) {
    return `${HELP_CENTER_URL}/requests/${ticketID}`;
  }
  return SUBMIT_REQUEST_URL;
}

function emptyList() {
  return buildList([]);
}

function emptyDict() {
  return buildDict([]);
}

class PetitionerService extends BaseService {
  constructor() {
    super("petitioner");
  }

  Handle_IsSerenity(args, session) {
    recordAuditEvent("is_serenity", args, session);
    return false;
  }

  Handle_IsZendeskEnabled(args, session) {
    recordAuditEvent("is_zendesk_enabled", args, session);
    return true;
  }

  Handle_IsZendeskSwapEnabled(args, session) {
    recordAuditEvent("is_zendesk_swap_enabled", args, session);
    return true;
  }

  Handle_HasOpenTickets(args, session) {
    recordAuditEvent("has_open_tickets", args, session);
    return false;
  }

  Handle_GetZendeskJwtLink(args, session, kwargs) {
    const url = buildZendeskLink(kwargs);
    recordAuditEvent("get_zendesk_jwt_link", args, session, { url });
    return url;
  }

  Handle_GetUnreadMessages(args, session) {
    recordAuditEvent("get_unread_messages_empty", args, session);
    return emptyList();
  }

  Handle_MarkAsRead(args, session) {
    recordAuditEvent("mark_as_read_ack", args, session, {
      messageID: toPositiveInteger(args && args[0], 0),
    });
    return null;
  }

  Handle_GetMyPetitionsEx(args, session) {
    recordAuditEvent("get_my_petitions_empty", args, session);
    return emptyList();
  }

  Handle_GetClaimedPetitions(args, session) {
    recordAuditEvent("get_claimed_petitions_empty", args, session);
    return emptyList();
  }

  Handle_GetPetitionQueue(args, session) {
    recordAuditEvent("get_petition_queue_empty", args, session, {
      queueID: toPositiveInteger(args && args[0], 0),
    });
    return emptyList();
  }

  Handle_GetQueues(args, session) {
    recordAuditEvent("get_queues_empty", args, session);
    return emptyList();
  }

  Handle_GetCategories(args, session) {
    recordAuditEvent("get_categories_empty", args, session);
    return emptyList();
  }

  Handle_GetCategoryHierarchicalInfo(args, session) {
    recordAuditEvent("get_category_hierarchical_info_empty", args, session);
    return [emptyDict(), emptyDict(), emptyDict(), emptyDict()];
  }

  Handle_GetCategoryProperties(args, session) {
    recordAuditEvent("get_category_properties_empty", args, session, {
      categoryID: toPositiveInteger(args && args[0], 0),
    });
    return emptyList();
  }

  Handle_PropertyPopulationInfo(args, session) {
    recordAuditEvent("property_population_info_empty", args, session, {
      propertyName: toText(args && args[0], ""),
    });
    return emptyList();
  }

  Handle_GetClientPickerInfo(args, session) {
    recordAuditEvent("get_client_picker_info_empty", args, session, {
      filterString: toText(args && args[0], ""),
      elementName: toText(args && args[1], ""),
    });
    return emptyList();
  }

  Handle_GetUserCatalogCountry(args, session) {
    recordAuditEvent("get_user_catalog_country", args, session);
    return "US";
  }

  Handle_MayPetition(args, session) {
    recordAuditEvent("may_petition_disabled", args, session, {
      categoryID: toPositiveInteger(args && args[0], 0),
      oocCharacterID: toPositiveInteger(args && args[1], 0),
    });
    return MAY_PETITION_DISABLED;
  }

  Handle_CreatePetition(args, session, kwargs) {
    recordAuditEvent("create_petition_rejected", args, session, {
      subject: toText(args && args[0], ""),
      categoryID: toPositiveInteger(args && args[2], 0),
      kwargs: safeClone(kwargs),
    });
    return false;
  }

  Handle_GetLog(args, session) {
    recordAuditEvent("get_log_empty", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return emptyList();
  }

  Handle_GetPetitionMessages(args, session) {
    recordAuditEvent("get_petition_messages_empty", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return emptyList();
  }

  Handle_PetitionerChat(args, session) {
    recordAuditEvent("petitioner_chat_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
      message: toText(args && args[1], ""),
    });
    return null;
  }

  Handle_PetitioneeChat(args, session) {
    recordAuditEvent("petitionee_chat_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
      message: toText(args && args[1], ""),
    });
    return null;
  }

  Handle_DeletePetition(args, session) {
    recordAuditEvent("delete_petition_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return null;
  }

  Handle_CancelPetition(args, session) {
    recordAuditEvent("cancel_petition_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return null;
  }

  Handle_ClosePetition(args, session) {
    recordAuditEvent("close_petition_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return null;
  }

  Handle_UnClaimPetition(args, session) {
    recordAuditEvent("unclaim_petition_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return null;
  }

  Handle_EscalatePetition(args, session) {
    recordAuditEvent("escalate_petition_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
      escalatesTo: toPositiveInteger(args && args[1], 0),
    });
    return null;
  }

  Handle_ClaimPetition(args, session) {
    recordAuditEvent("claim_petition_rejected", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return 0;
  }

  Handle_AddPetitionRating(args, session) {
    recordAuditEvent("add_petition_rating_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return null;
  }

  Handle_UpdatePetitionRating(args, session) {
    recordAuditEvent("update_petition_rating_ack", args, session, {
      petitionID: toPositiveInteger(args && args[0], 0),
    });
    return null;
  }
}

module.exports = PetitionerService;
module.exports._testing = {
  HELP_CENTER_URL,
  SUBMIT_REQUEST_URL,
  MAY_PETITION_DISABLED,
  getAuditEvents() {
    return auditEvents.map((event) => JSON.parse(JSON.stringify(event)));
  },
  resetForTests() {
    auditEvents.length = 0;
  },
};
