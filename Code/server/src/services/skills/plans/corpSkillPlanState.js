const path = require("path");

const database = require(path.join(__dirname, "../../../gameStore"));
const {
  MAX_LEN_DESC,
  MAX_NUM_MILESTONES,
  ZERO_UUID,
  assertPlanDescription,
  assertPlanName,
  canonicalizeSkillRequirements,
  createUuidString,
  normalizeMilestoneRecord,
  normalizeUuidString,
} = require(path.join(__dirname, "./skillPlanState"));

// Persistent storage for corporation skill plans. Mirrors the personal
// skillPlanState model but is keyed by corporationID and adds a `categoryID`
// (the loose career-path grouping used by the client) per plan. There is no
// per-corp "active" plan: tracking a corp plan is a personal action handled by
// the character skill-plan service. EVE allows up to 100 plans per corporation.
const CORP_SKILL_PLAN_TABLE = "corpSkillPlans";
const MAX_CORP_PLANS = 100;

let corpSkillPlanMutationVersion = 1;

// The corpSkillPlans table is runtime-owned and not pre-created by the database
// builder, so bootstrap its directory/data file on demand. Without this the first
// read/write fails with TABLE_NOT_FOUND and silently drops the plan.
function ensureCorpTable() {
  if (typeof database.ensureTable === "function") {
    database.ensureTable(CORP_SKILL_PLAN_TABLE);
  }
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function buildError(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function normalizeCategoryID(value) {
  const normalized = normalizeUuidString(value);
  if (!normalized || normalized === ZERO_UUID) {
    return null;
  }
  return normalized;
}

function readCorpTable() {
  ensureCorpTable();
  const result = database.read(CORP_SKILL_PLAN_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function writeCorpTable(nextTable) {
  ensureCorpTable();
  const result = database.write(CORP_SKILL_PLAN_TABLE, "/", nextTable);
  if (result && result.success) {
    corpSkillPlanMutationVersion += 1;
  }
  return result;
}

function normalizeCorpPlanRecord(planID, rawPlan = {}) {
  const normalizedPlanID = normalizeUuidString(planID);
  if (!normalizedPlanID) {
    return null;
  }

  const milestonesSource =
    rawPlan && rawPlan.milestones && typeof rawPlan.milestones === "object"
      ? rawPlan.milestones
      : {};
  const normalizedMilestones = {};
  for (const [milestoneID, milestone] of Object.entries(milestonesSource)) {
    const normalizedMilestone = normalizeMilestoneRecord(
      normalizedPlanID,
      milestoneID,
      milestone,
    );
    if (normalizedMilestone) {
      normalizedMilestones[normalizedMilestone.milestoneID] = normalizedMilestone;
    }
  }

  return {
    planID: normalizedPlanID,
    name: String(rawPlan.name || "").slice(0, 50),
    description: String(rawPlan.description || "").slice(0, MAX_LEN_DESC),
    requirements: canonicalizeSkillRequirements(rawPlan.requirements || []),
    categoryID: normalizeCategoryID(rawPlan.categoryID),
    milestones: normalizedMilestones,
    createdAt: Number(rawPlan.createdAt || Date.now()),
    updatedAt: Number(rawPlan.updatedAt || Date.now()),
  };
}

function normalizeCorporationPlanState(rawState = {}) {
  const plansSource =
    rawState && rawState.plans && typeof rawState.plans === "object"
      ? rawState.plans
      : {};
  const normalizedPlans = {};
  for (const [planID, plan] of Object.entries(plansSource)) {
    const normalizedPlan = normalizeCorpPlanRecord(planID, plan);
    if (normalizedPlan) {
      normalizedPlans[normalizedPlan.planID] = normalizedPlan;
    }
  }
  return { plans: normalizedPlans };
}

function getCorporationPlanState(corporationID) {
  const numericCorporationID = toInt(corporationID, 0);
  if (numericCorporationID <= 0) {
    return normalizeCorporationPlanState({});
  }
  const table = readCorpTable();
  return normalizeCorporationPlanState(table[String(numericCorporationID)] || {});
}

function setCorporationPlanState(corporationID, nextState) {
  const numericCorporationID = toInt(corporationID, 0);
  if (numericCorporationID <= 0) {
    return { success: false, errorMsg: "INVALID_CORPORATION" };
  }
  const table = readCorpTable();
  table[String(numericCorporationID)] = normalizeCorporationPlanState(nextState);
  return writeCorpTable(table);
}

function listCorpPlanIDs(corporationID) {
  return Object.keys(getCorporationPlanState(corporationID).plans);
}

function listCorpPlans(corporationID) {
  return Object.values(getCorporationPlanState(corporationID).plans).map((plan) =>
    cloneValue(plan),
  );
}

function getCorpPlan(corporationID, planID) {
  const normalizedPlanID = normalizeUuidString(planID);
  if (!normalizedPlanID) {
    return null;
  }
  return cloneValue(
    getCorporationPlanState(corporationID).plans[normalizedPlanID] || null,
  );
}

// Cross-corporation lookup used by GetShared, which can resolve a corp plan by id
// regardless of the requesting character's corporation (members share links).
function findCorpPlanByID(planID) {
  const normalizedPlanID = normalizeUuidString(planID);
  if (!normalizedPlanID) {
    return null;
  }
  const table = readCorpTable();
  for (const [corporationID, rawState] of Object.entries(table)) {
    const state = normalizeCorporationPlanState(rawState);
    if (state.plans[normalizedPlanID]) {
      return {
        corporationID: toInt(corporationID, 0),
        plan: cloneValue(state.plans[normalizedPlanID]),
      };
    }
  }
  return null;
}

function createCorpPlan(corporationID, attributes = {}) {
  const state = getCorporationPlanState(corporationID);
  if (Object.keys(state.plans).length >= MAX_CORP_PLANS) {
    throw buildError(
      "CORP_SKILL_PLAN_CAPACITY_REACHED",
      `Corporation already has ${MAX_CORP_PLANS} skill plans`,
      { maxPlans: MAX_CORP_PLANS },
    );
  }

  const planID = createUuidString();
  const nextPlan = normalizeCorpPlanRecord(planID, {
    name: assertPlanName(attributes.name),
    description: assertPlanDescription(attributes.description),
    requirements: attributes.requirements || [],
    categoryID: attributes.categoryID,
    milestones: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  state.plans[planID] = nextPlan;
  setCorporationPlanState(corporationID, state);
  return cloneValue(nextPlan);
}

function updateCorpPlan(corporationID, planID, updates = {}) {
  const normalizedPlanID = normalizeUuidString(planID);
  const state = getCorporationPlanState(corporationID);
  const existingPlan = state.plans[normalizedPlanID];
  if (!existingPlan) {
    throw buildError("CORP_SKILL_PLAN_NOT_FOUND", "Corporation skill plan not found");
  }

  const nextPlan = normalizeCorpPlanRecord(normalizedPlanID, {
    ...existingPlan,
    ...(Object.prototype.hasOwnProperty.call(updates, "name")
      ? { name: assertPlanName(updates.name) }
      : null),
    ...(Object.prototype.hasOwnProperty.call(updates, "description")
      ? { description: assertPlanDescription(updates.description) }
      : null),
    ...(Object.prototype.hasOwnProperty.call(updates, "requirements")
      ? { requirements: updates.requirements || [] }
      : null),
    ...(Object.prototype.hasOwnProperty.call(updates, "categoryID")
      ? { categoryID: updates.categoryID }
      : null),
    updatedAt: Date.now(),
  });
  state.plans[normalizedPlanID] = nextPlan;
  setCorporationPlanState(corporationID, state);
  return cloneValue(nextPlan);
}

function deleteCorpPlan(corporationID, planID) {
  const normalizedPlanID = normalizeUuidString(planID);
  const state = getCorporationPlanState(corporationID);
  if (!state.plans[normalizedPlanID]) {
    return false;
  }
  delete state.plans[normalizedPlanID];
  setCorporationPlanState(corporationID, state);
  return true;
}

function listCorpMilestones(corporationID, planID) {
  const plan = getCorpPlan(corporationID, planID);
  if (!plan) {
    throw buildError("CORP_SKILL_PLAN_NOT_FOUND", "Corporation skill plan not found");
  }
  return Object.values(plan.milestones || {}).map((milestone) => cloneValue(milestone));
}

function createCorpMilestone(corporationID, planID, attributes = {}) {
  const normalizedPlanID = normalizeUuidString(planID);
  const state = getCorporationPlanState(corporationID);
  const plan = state.plans[normalizedPlanID];
  if (!plan) {
    throw buildError("CORP_SKILL_PLAN_NOT_FOUND", "Corporation skill plan not found");
  }
  if (Object.keys(plan.milestones || {}).length >= MAX_NUM_MILESTONES) {
    throw buildError(
      "CORP_SKILL_PLAN_TOO_MANY_MILESTONES",
      `Corporation skill plan exceeds ${MAX_NUM_MILESTONES} milestones`,
      { maxMilestones: MAX_NUM_MILESTONES },
    );
  }

  const milestoneID = createUuidString();
  const nextMilestone = normalizeMilestoneRecord(normalizedPlanID, milestoneID, {
    description: assertPlanDescription(attributes.description || ""),
    trainToTypeID: attributes.trainToTypeID,
    skillTypeID: attributes.skillTypeID,
    level: attributes.level,
  });
  if (!nextMilestone) {
    throw buildError("CORP_SKILL_PLAN_INVALID_MILESTONE", "Milestone data is invalid");
  }

  plan.milestones[milestoneID] = nextMilestone;
  plan.updatedAt = Date.now();
  setCorporationPlanState(corporationID, state);
  return cloneValue(nextMilestone);
}

function updateCorpMilestoneDescription(corporationID, milestoneID, description) {
  const normalizedMilestoneID = normalizeUuidString(milestoneID);
  const state = getCorporationPlanState(corporationID);
  for (const plan of Object.values(state.plans)) {
    if (!plan.milestones || !plan.milestones[normalizedMilestoneID]) {
      continue;
    }
    plan.milestones[normalizedMilestoneID] = {
      ...plan.milestones[normalizedMilestoneID],
      description: assertPlanDescription(description || ""),
    };
    plan.updatedAt = Date.now();
    setCorporationPlanState(corporationID, state);
    return cloneValue(plan.milestones[normalizedMilestoneID]);
  }
  throw buildError(
    "CORP_SKILL_PLAN_MILESTONE_NOT_FOUND",
    "Corporation skill plan milestone not found",
  );
}

function deleteCorpMilestone(corporationID, milestoneID) {
  const normalizedMilestoneID = normalizeUuidString(milestoneID);
  const state = getCorporationPlanState(corporationID);
  for (const plan of Object.values(state.plans)) {
    if (!plan.milestones || !plan.milestones[normalizedMilestoneID]) {
      continue;
    }
    delete plan.milestones[normalizedMilestoneID];
    plan.updatedAt = Date.now();
    setCorporationPlanState(corporationID, state);
    return true;
  }
  return false;
}

function clearCorporationPlanState(corporationID) {
  const numericCorporationID = toInt(corporationID, 0);
  if (numericCorporationID <= 0) {
    return { success: false, errorMsg: "CORPORATION_NOT_FOUND" };
  }
  const table = readCorpTable();
  const corporationKey = String(numericCorporationID);
  if (!Object.prototype.hasOwnProperty.call(table, corporationKey)) {
    return { success: true, removed: false };
  }
  delete table[corporationKey];
  const writeResult = writeCorpTable(table);
  return {
    ...(writeResult || { success: false, errorMsg: "WRITE_ERROR" }),
    removed: Boolean(writeResult && writeResult.success),
  };
}

function getCorpSkillPlanMutationVersion() {
  return corpSkillPlanMutationVersion;
}

module.exports = {
  CORP_SKILL_PLAN_TABLE,
  MAX_CORP_PLANS,
  clearCorporationPlanState,
  createCorpMilestone,
  createCorpPlan,
  deleteCorpMilestone,
  deleteCorpPlan,
  findCorpPlanByID,
  getCorpPlan,
  getCorpSkillPlanMutationVersion,
  getCorporationPlanState,
  listCorpMilestones,
  listCorpPlanIDs,
  listCorpPlans,
  setCorporationPlanState,
  updateCorpMilestoneDescription,
  updateCorpPlan,
};
