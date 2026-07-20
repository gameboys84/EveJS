"use strict";

const path = require("path");

const { buildCorpSkillPlanProtoRoot } = require("./corpSkillPlanProto");
const {
  encodePayload,
  getActiveCharacterID,
  uuidStringToBuffer,
  uuidBufferToString,
} = require("./gatewayServiceHelpers");
const corpSkillPlanState = require(path.join(
  __dirname,
  "../../../services/skills/plans/corpSkillPlanState",
));
const {
  getCorporationIDForCharacter,
} = require(path.join(
  __dirname,
  "../../../services/corporation/corpColorsState",
));
const {
  CORP_ROLE_DIRECTOR,
  getCorporationMember,
  toRoleMaskBigInt,
} = require(path.join(
  __dirname,
  "../../../services/corporation/corporationRuntimeState",
));

// appConst.corpRoleSkillPlanManager (bit 62). EVE gates corp skill-plan
// create/edit/delete behind CEO, Director, or the dedicated Skill Plan Manager
// role; members without it may only read and share.
const CORP_ROLE_SKILL_PLAN_MANAGER = 4611686018427387904n;

// Corp skill plans are addressed by a shared skill.plan.Identifier; the corp
// scope is resolved from the requesting character's corporation, so the request
// family maps 1:1 onto its responses.
const RESPONSE_BY_REQUEST = Object.freeze({
  "eve_public.corporation.skill.plan.GetAllRequest":
    "eve_public.corporation.skill.plan.GetAllResponse",
  "eve_public.corporation.skill.plan.GetRequest":
    "eve_public.corporation.skill.plan.GetResponse",
  "eve_public.corporation.skill.plan.GetSharedRequest":
    "eve_public.corporation.skill.plan.GetSharedResponse",
  "eve_public.corporation.skill.plan.CreateRequest":
    "eve_public.corporation.skill.plan.CreateResponse",
  "eve_public.corporation.skill.plan.DeleteRequest":
    "eve_public.corporation.skill.plan.DeleteResponse",
  "eve_public.corporation.skill.plan.SetNameRequest":
    "eve_public.corporation.skill.plan.SetNameResponse",
  "eve_public.corporation.skill.plan.SetDescriptionRequest":
    "eve_public.corporation.skill.plan.SetDescriptionResponse",
  "eve_public.corporation.skill.plan.SetSkillRequirementsRequest":
    "eve_public.corporation.skill.plan.SetSkillRequirementsResponse",
  "eve_public.corporation.skill.plan.SetCategoryRequest":
    "eve_public.corporation.skill.plan.SetCategoryResponse",
  "eve_public.corporation.skill.plan.milestone.GetAllRequest":
    "eve_public.corporation.skill.plan.milestone.GetAllResponse",
  "eve_public.corporation.skill.plan.milestone.CreateRequest":
    "eve_public.corporation.skill.plan.milestone.CreateResponse",
  "eve_public.corporation.skill.plan.milestone.DeleteRequest":
    "eve_public.corporation.skill.plan.milestone.DeleteResponse",
  "eve_public.corporation.skill.plan.milestone.SetDescriptionRequest":
    "eve_public.corporation.skill.plan.milestone.SetDescriptionResponse",
});

const HANDLED_REQUEST_TYPES = Object.freeze(Object.keys(RESPONSE_BY_REQUEST));

function canManageCorpSkillPlans(characterID, corporationID) {
  const numericCharacterID = Number(characterID || 0) || 0;
  const numericCorporationID = Number(corporationID || 0) || 0;
  if (!numericCharacterID || !numericCorporationID) {
    return false;
  }
  const member = getCorporationMember(numericCorporationID, numericCharacterID);
  if (!member) {
    return false;
  }
  if (member.isCEO) {
    return true;
  }
  const roles = toRoleMaskBigInt(member.roles, 0n);
  return (
    (roles & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (roles & CORP_ROLE_SKILL_PLAN_MANAGER) === CORP_ROLE_SKILL_PLAN_MANAGER
  );
}

function decodePayload(messageType, requestEnvelope) {
  return messageType.decode(
    Buffer.from(
      requestEnvelope &&
        requestEnvelope.payload &&
        requestEnvelope.payload.value
        ? requestEnvelope.payload.value
        : Buffer.alloc(0),
    ),
  );
}

function buildPlanIdentifier(planID) {
  return { uuid: uuidStringToBuffer(planID) };
}

function extractPlanID(identifier) {
  return identifier && identifier.uuid
    ? uuidBufferToString(identifier.uuid)
    : null;
}

function extractCategoryID(identifier) {
  return identifier && identifier.uuid
    ? uuidBufferToString(identifier.uuid)
    : null;
}

function buildCategoryField(categoryID) {
  return categoryID ? { category: { uuid: uuidStringToBuffer(categoryID) } } : {};
}

function buildRequirementPayload(requirement) {
  return {
    skill_type: { sequential: Number(requirement.typeID || 0) },
    level: Number(requirement.level || 0),
  };
}

function decodePlanRequirements(requirements = []) {
  return Array.isArray(requirements)
    ? requirements.map((requirement) => ({
        typeID: Number(
          requirement &&
            requirement.skill_type &&
            requirement.skill_type.sequential
            ? requirement.skill_type.sequential
            : 0,
        ),
        level: Number(requirement && requirement.level ? requirement.level : 0),
      }))
    : [];
}

function buildPlanAttributes(plan) {
  if (!plan) {
    return undefined;
  }
  return {
    name: String(plan.name || ""),
    description: String(plan.description || ""),
    skill_requirements: (plan.requirements || []).map(buildRequirementPayload),
    ...buildCategoryField(plan.categoryID),
  };
}

function buildPlanSummary(plan) {
  return {
    name: String(plan.name || ""),
    description: String(plan.description || ""),
    ...buildCategoryField(plan.categoryID),
  };
}

function buildMilestoneAttributes(milestone) {
  if (!milestone) {
    return undefined;
  }
  const payload = {
    skill_plan: buildPlanIdentifier(milestone.planID),
    description: String(milestone.description || ""),
  };
  if (Number(milestone.trainToTypeID || 0) > 0) {
    payload.train_to_type = { sequential: Number(milestone.trainToTypeID) };
  } else if (Number(milestone.skillTypeID || 0) > 0) {
    payload.skill = {
      skill_type: { sequential: Number(milestone.skillTypeID) },
      level: Number(milestone.level || 0),
    };
  }
  return payload;
}

function buildErrorResponse(responseTypeName, error) {
  if (error && error.code === "CORP_SKILL_PLAN_NOT_FOUND") {
    return {
      statusCode: 404,
      statusMessage: error.message || "",
      responseTypeName,
      responsePayloadBuffer: Buffer.alloc(0),
    };
  }
  if (error && error.code === "CORP_SKILL_PLAN_MILESTONE_NOT_FOUND") {
    return {
      statusCode: 404,
      statusMessage: error.message || "",
      responseTypeName,
      responsePayloadBuffer: Buffer.alloc(0),
    };
  }
  return {
    statusCode: 400,
    statusMessage: error && error.message ? error.message : "",
    responseTypeName,
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function createCorpSkillPlanGatewayService(context) {
  const protoRoot = buildCorpSkillPlanProtoRoot();
  const publishGatewayNotice =
    context && typeof context.publishGatewayNotice === "function"
      ? context.publishGatewayNotice
      : null;
  const lookup = (name) =>
    protoRoot.lookupType(`eve_public.corporation.skill.plan.${name}`);
  const types = {
    getAllResponse: lookup("GetAllResponse"),
    getRequest: lookup("GetRequest"),
    getResponse: lookup("GetResponse"),
    getSharedRequest: lookup("GetSharedRequest"),
    getSharedResponse: lookup("GetSharedResponse"),
    createRequest: lookup("CreateRequest"),
    createResponse: lookup("CreateResponse"),
    deleteRequest: lookup("DeleteRequest"),
    setNameRequest: lookup("SetNameRequest"),
    setDescriptionRequest: lookup("SetDescriptionRequest"),
    setSkillRequirementsRequest: lookup("SetSkillRequirementsRequest"),
    setCategoryRequest: lookup("SetCategoryRequest"),
    createdNotice: lookup("CreatedNotice"),
    deletedNotice: lookup("DeletedNotice"),
    nameUpdatedNotice: lookup("NameUpdatedNotice"),
    descriptionUpdatedNotice: lookup("DescriptionUpdatedNotice"),
    skillRequirementsUpdatedNotice: lookup("SkillRequirementsUpdatedNotice"),
    categoryUpdatedNotice: lookup("CategoryUpdatedNotice"),
    milestoneGetAllRequest: lookup("milestone.GetAllRequest"),
    milestoneGetAllResponse: lookup("milestone.GetAllResponse"),
    milestoneCreateRequest: lookup("milestone.CreateRequest"),
    milestoneCreateResponse: lookup("milestone.CreateResponse"),
    milestoneDeleteRequest: lookup("milestone.DeleteRequest"),
    milestoneSetDescriptionRequest: lookup("milestone.SetDescriptionRequest"),
  };

  function publishNotice(noticeTypeName, messageType, payload, corporationID) {
    if (!publishGatewayNotice || !corporationID) {
      return;
    }
    publishGatewayNotice(
      noticeTypeName,
      encodePayload(messageType, payload),
      { corporation: Number(corporationID) },
    );
  }

  function ok(responseTypeName, payloadBuffer) {
    return {
      statusCode: 200,
      statusMessage: "",
      responseTypeName,
      responsePayloadBuffer: payloadBuffer || Buffer.alloc(0),
    };
  }

  function forbidden(responseTypeName) {
    return {
      statusCode: 403,
      statusMessage: "",
      responseTypeName,
      responsePayloadBuffer: Buffer.alloc(0),
    };
  }

  return {
    name: "corporation-skill-plans",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType(requestTypeName) {
      return RESPONSE_BY_REQUEST[requestTypeName] || null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      const responseTypeName = RESPONSE_BY_REQUEST[requestTypeName];
      if (!responseTypeName) {
        return null;
      }

      const activeCharacterID = getActiveCharacterID(requestEnvelope);
      const corporationID = getCorporationIDForCharacter(activeCharacterID) || 0;
      const canManage = canManageCorpSkillPlans(activeCharacterID, corporationID);

      try {
        if (requestTypeName === "eve_public.corporation.skill.plan.GetAllRequest") {
          const plans = corporationID
            ? corpSkillPlanState.listCorpPlans(corporationID)
            : [];
          return ok(
            responseTypeName,
            encodePayload(types.getAllResponse, {
              skill_plans: plans.map((plan) => ({
                identifier: buildPlanIdentifier(plan.planID),
                skill_plan: buildPlanSummary(plan),
              })),
            }),
          );
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.GetRequest") {
          const decoded = decodePayload(types.getRequest, requestEnvelope);
          const plan = corporationID
            ? corpSkillPlanState.getCorpPlan(
                corporationID,
                extractPlanID(decoded.skill_plan),
              )
            : null;
          if (!plan) {
            return {
              statusCode: 404,
              statusMessage: "",
              responseTypeName,
              responsePayloadBuffer: Buffer.alloc(0),
            };
          }
          return ok(
            responseTypeName,
            encodePayload(types.getResponse, {
              skill_plan: buildPlanAttributes(plan),
            }),
          );
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.GetSharedRequest") {
          const decoded = decodePayload(types.getSharedRequest, requestEnvelope);
          const shared = corpSkillPlanState.findCorpPlanByID(
            extractPlanID(decoded.skill_plan),
          );
          return ok(
            responseTypeName,
            encodePayload(
              types.getSharedResponse,
              shared ? { skill_plan: buildPlanAttributes(shared.plan) } : {},
            ),
          );
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.CreateRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(types.createRequest, requestEnvelope);
          const attributes = decoded.skill_plan || {};
          const created = corpSkillPlanState.createCorpPlan(corporationID, {
            name: attributes.name,
            description: attributes.description,
            requirements: decodePlanRequirements(attributes.skill_requirements),
            categoryID: extractCategoryID(attributes.category),
          });
          publishNotice(
            "eve_public.corporation.skill.plan.CreatedNotice",
            types.createdNotice,
            {
              identifier: buildPlanIdentifier(created.planID),
              skill_plan: buildPlanAttributes(created),
            },
            corporationID,
          );
          return ok(
            responseTypeName,
            encodePayload(types.createResponse, {
              skill_plan: buildPlanIdentifier(created.planID),
            }),
          );
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.DeleteRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(types.deleteRequest, requestEnvelope);
          const planID = extractPlanID(decoded.skill_plan);
          corpSkillPlanState.deleteCorpPlan(corporationID, planID);
          publishNotice(
            "eve_public.corporation.skill.plan.DeletedNotice",
            types.deletedNotice,
            { skill_plan: buildPlanIdentifier(planID) },
            corporationID,
          );
          return ok(responseTypeName);
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.SetNameRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(types.setNameRequest, requestEnvelope);
          const planID = extractPlanID(decoded.skill_plan);
          corpSkillPlanState.updateCorpPlan(corporationID, planID, {
            name: decoded.name,
          });
          publishNotice(
            "eve_public.corporation.skill.plan.NameUpdatedNotice",
            types.nameUpdatedNotice,
            { identifier: buildPlanIdentifier(planID), name: String(decoded.name || "") },
            corporationID,
          );
          return ok(responseTypeName);
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.SetDescriptionRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(types.setDescriptionRequest, requestEnvelope);
          const planID = extractPlanID(decoded.skill_plan);
          corpSkillPlanState.updateCorpPlan(corporationID, planID, {
            description: decoded.description,
          });
          publishNotice(
            "eve_public.corporation.skill.plan.DescriptionUpdatedNotice",
            types.descriptionUpdatedNotice,
            {
              identifier: buildPlanIdentifier(planID),
              description: String(decoded.description || ""),
            },
            corporationID,
          );
          return ok(responseTypeName);
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.SetSkillRequirementsRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(
            types.setSkillRequirementsRequest,
            requestEnvelope,
          );
          const planID = extractPlanID(decoded.skill_plan);
          const updated = corpSkillPlanState.updateCorpPlan(corporationID, planID, {
            requirements: decodePlanRequirements(decoded.requirements),
          });
          publishNotice(
            "eve_public.corporation.skill.plan.SkillRequirementsUpdatedNotice",
            types.skillRequirementsUpdatedNotice,
            {
              identifier: buildPlanIdentifier(planID),
              requirements: (updated.requirements || []).map(buildRequirementPayload),
            },
            corporationID,
          );
          return ok(responseTypeName);
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.SetCategoryRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(types.setCategoryRequest, requestEnvelope);
          const planID = extractPlanID(decoded.skill_plan);
          const categoryID = extractCategoryID(decoded.category);
          corpSkillPlanState.updateCorpPlan(corporationID, planID, { categoryID });
          publishNotice(
            "eve_public.corporation.skill.plan.CategoryUpdatedNotice",
            types.categoryUpdatedNotice,
            {
              identifier: buildPlanIdentifier(planID),
              ...buildCategoryField(categoryID),
            },
            corporationID,
          );
          return ok(responseTypeName);
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.milestone.GetAllRequest") {
          const decoded = decodePayload(types.milestoneGetAllRequest, requestEnvelope);
          const planID = extractPlanID(decoded.skill_plan);
          const plan = corporationID
            ? corpSkillPlanState.getCorpPlan(corporationID, planID)
            : null;
          const milestones = plan
            ? corpSkillPlanState.listCorpMilestones(corporationID, planID)
            : [];
          return ok(
            responseTypeName,
            encodePayload(types.milestoneGetAllResponse, {
              milestones: milestones.map((milestone) => ({
                identifier: { uuid: uuidStringToBuffer(milestone.milestoneID) },
                data: buildMilestoneAttributes(milestone),
              })),
            }),
          );
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.milestone.CreateRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(types.milestoneCreateRequest, requestEnvelope);
          const milestoneData = decoded.milestone || {};
          const created = corpSkillPlanState.createCorpMilestone(
            corporationID,
            extractPlanID(milestoneData.skill_plan),
            {
              description: milestoneData.description,
              trainToTypeID:
                milestoneData.train_to_type &&
                milestoneData.train_to_type.sequential,
              skillTypeID:
                milestoneData.skill &&
                milestoneData.skill.skill_type &&
                milestoneData.skill.skill_type.sequential,
              level: milestoneData.skill && milestoneData.skill.level,
            },
          );
          return ok(
            responseTypeName,
            encodePayload(types.milestoneCreateResponse, {
              milestone: { uuid: uuidStringToBuffer(created.milestoneID) },
            }),
          );
        }

        if (requestTypeName === "eve_public.corporation.skill.plan.milestone.DeleteRequest") {
          if (!canManage) {
            return forbidden(responseTypeName);
          }
          const decoded = decodePayload(types.milestoneDeleteRequest, requestEnvelope);
          corpSkillPlanState.deleteCorpMilestone(
            corporationID,
            decoded && decoded.milestone
              ? uuidBufferToString(decoded.milestone.uuid)
              : null,
          );
          return ok(responseTypeName);
        }

        // eve_public.corporation.skill.plan.milestone.SetDescriptionRequest
        if (!canManage) {
          return forbidden(responseTypeName);
        }
        const decoded = decodePayload(
          types.milestoneSetDescriptionRequest,
          requestEnvelope,
        );
        corpSkillPlanState.updateCorpMilestoneDescription(
          corporationID,
          decoded && decoded.identifier
            ? uuidBufferToString(decoded.identifier.uuid)
            : null,
          decoded.description,
        );
        return ok(responseTypeName);
      } catch (error) {
        return buildErrorResponse(responseTypeName, error);
      }
    },
  };
}

module.exports = {
  HANDLED_REQUEST_TYPES,
  RESPONSE_BY_REQUEST,
  CORP_ROLE_SKILL_PLAN_MANAGER,
  canManageCorpSkillPlans,
  createCorpSkillPlanGatewayService,
};
