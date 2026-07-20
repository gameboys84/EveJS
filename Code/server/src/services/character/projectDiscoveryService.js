const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const ACTIVE_PROJECT_ID = "mcgill-polyseg";
const LEGACY_SUBCELLULAR_PROJECT_ID = 1;
const PLAYER_NOT_IN_DATABASE_ERROR_CODE = 103010;
const DEFAULT_RANK = 1;
const DEFAULT_EXPERIENCE = 0;
const DEFAULT_ANALYSIS_KREDITS = 0;
const TUTORIAL_LEVEL_COUNT = 8;
const SYNTHETIC_TASK_ID = "evejs-project-discovery-placeholder";
const SYNTHETIC_TASK_IMAGE_URL =
  "res:/UI/Texture/classes/ProjectDiscovery/covid/tutorial/onegate.png";

const characterStates = new Map();
const auditEvents = [];

function getCharacterID(session) {
  return Number(
    session &&
      (
        session.characterID ||
        session.charid ||
        session.characterId
      ),
  ) || 0;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function recordAuditEvent(kind, args = [], session = null) {
  auditEvents.push({
    kind,
    args: Array.isArray(args) ? cloneArray(args) : [],
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

function createDefaultState() {
  return {
    rank: DEFAULT_RANK,
    experience: DEFAULT_EXPERIENCE,
    analysisKredits: DEFAULT_ANALYSIS_KREDITS,
    finishedTutorial: false,
    tutorialLevel: 0,
    fixedTaskId: null,
  };
}

function getStateForSession(session) {
  const characterID = getCharacterID(session);
  if (!characterID) {
    return createDefaultState();
  }

  if (!characterStates.has(characterID)) {
    characterStates.set(characterID, createDefaultState());
  }

  return characterStates.get(characterID);
}

function normalizeRank(rank) {
  const numericRank = Number(rank);
  if (!Number.isFinite(numericRank)) {
    return DEFAULT_RANK;
  }
  return Math.max(1, Math.trunc(numericRank));
}

function xpNeededForRank(rank) {
  const normalizedRank = normalizeRank(rank);
  return ((normalizedRank - 1) * normalizedRank * 100) / 2;
}

function buildPlayerState(state) {
  return buildKeyVal([
    ["rank", normalizeRank(state.rank)],
    ["experience", Math.max(0, Math.trunc(Number(state.experience) || 0))],
    ["analysisKredits", Math.max(0, Math.trunc(Number(state.analysisKredits) || 0))],
    ["finishedTutorial", Boolean(state.finishedTutorial)],
    ["tutorialLevel", Math.max(0, Math.trunc(Number(state.tutorialLevel) || 0))],
  ]);
}

function buildPlayerStatisticsUnavailable() {
  return buildDict([
    ["message", "Project Discovery API is not backed by live MMOS data in this emulator"],
    ["code", PLAYER_NOT_IN_DATABASE_ERROR_CODE],
    ["projectID", ACTIVE_PROJECT_ID],
  ]);
}

function buildCovidTask(taskId = SYNTHETIC_TASK_ID) {
  return buildDict([
    ["id", taskId],
    ["taskID", taskId],
    ["taskId", taskId],
    ["projectID", ACTIVE_PROJECT_ID],
    ["isTrainingSet", true],
    [
      "assets",
      buildDict([
        ["url", SYNTHETIC_TASK_IMAGE_URL],
        ["dimensions", buildList([512, 512])],
      ]),
    ],
    ["url", SYNTHETIC_TASK_IMAGE_URL],
    [
      "solution",
      buildDict([
        ["clusters", buildList([])],
        ["transits", buildList([])],
      ]),
    ],
    [
      "votes",
      buildDict([
        ["highScore", 0],
        ["avgScore", 0],
        ["stellarActivity", buildList([])],
      ]),
    ],
    ["classificationCount", 0],
  ]);
}

function buildTrainingTask(taskNumber) {
  const taskId = Number.isFinite(Number(taskNumber))
    ? Number(taskNumber)
    : SYNTHETIC_TASK_ID;
  return buildDict([
    ["taskId", taskId],
    ["taskID", taskId],
    ["id", taskId],
    ["projectID", LEGACY_SUBCELLULAR_PROJECT_ID],
    ["solution", buildList([])],
    ["votes", buildList([])],
  ]);
}

function buildClassificationResult(state) {
  return buildDict([
    ["isSolved", true],
    ["score", 0],
    ["classificationCount", 0],
    ["XP_Reward", 0],
    ["ISK_Reward", 0],
    ["AK_Reward", 0],
    ["loot_crates", buildList([])],
    ["tier_reward", null],
    ["gotBonusXP", false],
    ["bonusSamplesAfterClassification", 0],
    ["requiredSkillPoints", buildList([])],
    ["player", buildDict([["score", 0]])],
    ["playerState", buildPlayerState(state)],
    ["isTraining", false],
    ["task", buildCovidTask()],
  ]);
}

class ProjectDiscoveryService extends BaseService {
  constructor() {
    super("ProjectDiscovery");
  }

  Handle_initialize_tutorial_status(args, session) {
    log.debug("[ProjectDiscovery] initialize_tutorial_status called");
    return this.Handle_get_tutorial_completion_status(args, session);
  }

  Handle_is_enabled(args, session) {
    log.debug("[ProjectDiscovery] is_enabled called");
    return true;
  }

  Handle_get_player_state(args, session) {
    return buildPlayerState(getStateForSession(session));
  }

  Handle_get_player_statistics(args, session) {
    recordAuditEvent("get_player_statistics", args, session);
    return buildPlayerStatisticsUnavailable();
  }

  Handle_get_project_id() {
    return LEGACY_SUBCELLULAR_PROJECT_ID;
  }

  Handle_get_tutorial_completion_status(args, session) {
    return Boolean(getStateForSession(session).finishedTutorial);
  }

  Handle_get_tutorial_level(args, session) {
    return Math.max(0, Math.trunc(Number(getStateForSession(session).tutorialLevel) || 0));
  }

  Handle_get_tutorial_xp_reward() {
    return 0;
  }

  Handle_get_is_player_entitled_to_tutorial_reward() {
    return false;
  }

  Handle_give_tutorial_rewards(args, session) {
    recordAuditEvent("give_tutorial_rewards", args, session);
    return false;
  }

  Handle_reset_tutorial(args, session) {
    const state = getStateForSession(session);
    state.finishedTutorial = false;
    state.tutorialLevel = 0;
    recordAuditEvent("reset_tutorial", args, session);
    return buildPlayerState(state);
  }

  Handle_skip_tutorial(args, session) {
    const state = getStateForSession(session);
    state.finishedTutorial = true;
    state.tutorialLevel = TUTORIAL_LEVEL_COUNT;
    recordAuditEvent("skip_tutorial", args, session);
    return buildPlayerState(state);
  }

  Handle_increase_tutorial_level(args, session) {
    const state = getStateForSession(session);
    state.tutorialLevel = Math.min(
      TUTORIAL_LEVEL_COUNT,
      Math.max(0, Math.trunc(Number(state.tutorialLevel) || 0)) + 1,
    );
    if (state.tutorialLevel >= TUTORIAL_LEVEL_COUNT) {
      state.finishedTutorial = true;
    }
    recordAuditEvent("increase_tutorial_level", args, session);
    return buildPlayerState(state);
  }

  Handle_get_player_analysis_kredits(args, session) {
    return Math.max(
      0,
      Math.trunc(Number(getStateForSession(session).analysisKredits) || 0),
    );
  }

  Handle_get_total_needed_xp(args) {
    const rank = Array.isArray(args) ? args[0] : args;
    return xpNeededForRank(rank);
  }

  Handle_get_maximum_bonus_samples() {
    return 0;
  }

  Handle_get_remaining_bonus_samples() {
    return 0;
  }

  Handle_get_new_task(args, session) {
    const state = getStateForSession(session);
    const taskId = state.fixedTaskId || SYNTHETIC_TASK_ID;
    recordAuditEvent("get_new_task", args, session);
    return buildCovidTask(taskId);
  }

  Handle_new_training_task(args, session) {
    const taskNumber = Array.isArray(args) ? args[0] : null;
    recordAuditEvent("new_training_task", args, session);
    return buildTrainingTask(taskNumber);
  }

  Handle_post_classification(args, session) {
    recordAuditEvent("post_classification", args, session);
    return buildClassificationResult(getStateForSession(session));
  }

  Handle_fix_task_id(args, session) {
    const state = getStateForSession(session);
    const fixedTaskId = Array.isArray(args) ? Number(args[0]) : 0;
    state.fixedTaskId = fixedTaskId > 0 ? fixedTaskId : null;
    recordAuditEvent("fix_task_id", args, session);
    return null;
  }
}

ProjectDiscoveryService._testing = {
  getAuditEvents() {
    return auditEvents.slice();
  },
  getCharacterState(characterID) {
    return characterStates.get(Number(characterID));
  },
  resetForTests() {
    characterStates.clear();
    auditEvents.length = 0;
  },
  constants: {
    ACTIVE_PROJECT_ID,
    LEGACY_SUBCELLULAR_PROJECT_ID,
    PLAYER_NOT_IN_DATABASE_ERROR_CODE,
    SYNTHETIC_TASK_ID,
    TUTORIAL_LEVEL_COUNT,
  },
};

module.exports = ProjectDiscoveryService;
