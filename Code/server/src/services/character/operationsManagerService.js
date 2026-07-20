const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterTutorialSnapshot,
} = require(path.join(__dirname, "../npe/tutorialRuntime"));

const CATEGORY_STATE_LOCKED = 20;
const auditEvents = [];

const GOLDEN_LOGIN_CHARACTER_PROGRESS_ENTRIES = [
  [32, [
    [158, 0, [
      [347, 10, 0],
      [348, 10, 0],
    ]],
  ]],
  [2113, [
    [2401, 0, [
      [3792, 10, 0],
      [3794, 10, 0],
      [3795, 10, 0],
      [3796, 10, 0],
    ]],
    [2397, 0, [
      [3812, 10, 0],
      [3798, 10, 0],
      [3799, 10, 0],
      [3711, 10, 0],
      [3712, 10, 0],
      [3713, 10, 0],
      [3814, 10, 0],
      [3716, 10, 0],
      [3815, 10, 0],
      [3717, 10, 0],
      [3718, 10, 0],
    ]],
    [2395, 0, [
      [3705, 10, 0],
      [3706, 10, 0],
    ]],
    [2396, 0, [
      [3816, 10, 0],
      [3707, 10, 0],
      [3708, 10, 0],
    ]],
  ]],
  [2115, [
    [2402, 0, [
      [3817, 10, 0],
      [3733, 10, 0],
      [3734, 10, 0],
      [3735, 10, 0],
      [3736, 10, 0],
      [3737, 10, 0],
      [3738, 10, 0],
      [3739, 10, 0],
      [3807, 10, 0],
      [3740, 10, 0],
      [3741, 10, 0],
      [3742, 10, 0],
      [3818, 10, 0],
      [3743, 10, 0],
    ]],
    [2403, 0, [
      [3744, 10, 0],
      [3745, 10, 0],
      [3746, 10, 0],
      [3747, 10, 0],
      [3748, 10, 0],
      [3749, 10, 0],
      [3750, 10, 0],
      [3751, 10, 0],
      [3752, 10, 0],
      [3753, 10, 0],
      [3754, 10, 0],
    ]],
    [2404, 0, [
      [3801, 10, 0],
      [3755, 10, 0],
      [3756, 10, 0],
      [3757, 10, 0],
      [3758, 10, 0],
      [3800, 10, 0],
      [3759, 10, 0],
    ]],
    [2405, 0, [
      [3802, 10, 0],
      [3760, 10, 0],
      [3761, 10, 0],
      [3762, 10, 0],
      [3763, 10, 0],
      [3764, 10, 0],
      [3765, 10, 0],
      [3766, 10, 0],
      [3767, 10, 0],
    ]],
    [2406, 0, [
      [3768, 10, 0],
      [3769, 10, 0],
      [3770, 10, 0],
      [3771, 10, 0],
      [3772, 10, 0],
      [3773, 10, 0],
      [3774, 10, 0],
      [3775, 10, 0],
      [3776, 10, 0],
    ]],
    [2407, 0, [
      [3804, 10, 0],
      [3822, 10, 0],
      [3823, 10, 0],
      [3824, 10, 0],
      [3825, 10, 0],
      [3777, 10, 0],
      [3778, 10, 0],
    ]],
    [2408, 0, [
      [3780, 10, 0],
      [3781, 10, 0],
      [3782, 10, 0],
      [3783, 10, 0],
      [3784, 10, 0],
      [3785, 10, 0],
      [3786, 10, 0],
      [3787, 10, 0],
      [3788, 10, 0],
      [3779, 10, 0],
      [3820, 10, 0],
      [3821, 10, 0],
      [3791, 10, 0],
    ]],
  ]],
  [2122, [
    [2423, 0, [
      [3912, 10, 0],
      [4014, 10, 0],
      [4015, 10, 0],
      [4031, 10, 0],
    ]],
    [2433, 0, [
      [3908, 10, 0],
      [4179, 10, 0],
      [3950, 10, 0],
      [3943, 10, 0],
      [3946, 10, 0],
      [3947, 10, 0],
      [3948, 10, 0],
      [4178, 10, 0],
    ]],
    [2594, 0, [
      [4140, 10, 0],
      [4086, 10, 0],
      [4047, 10, 0],
      [4139, 10, 0],
    ]],
    [2674, 0, [
      [4176, 10, 0],
      [4177, 10, 0],
    ]],
  ]],
  [2126, [
    [2663, 0, []],
    [2664, 0, []],
    [2666, 0, []],
    [2667, 0, []],
    [2668, 0, []],
    [2669, 0, []],
    [2670, 0, []],
    [2671, 0, []],
    [2672, 0, []],
    [2673, 0, []],
    [2460, 0, [[3973, 10, 0]]],
    [2462, 0, [[3974, 10, 0]]],
    [2463, 0, [[3975, 10, 0]]],
    [2464, 0, [[3976, 10, 0]]],
    [2465, 0, [[3977, 10, 0]]],
    [2466, 0, [[3978, 10, 0]]],
    [2467, 0, [[3979, 10, 0]]],
    [2468, 0, [[3980, 10, 0]]],
    [2469, 0, [[3981, 10, 0]]],
    [2470, 0, [[3982, 10, 0]]],
    [2471, 0, [[3983, 10, 0]]],
    [2472, 0, [[3984, 10, 0]]],
    [2473, 0, [[3985, 10, 0]]],
    [2474, 0, [[3986, 10, 0]]],
    [2475, 0, [[3987, 10, 0]]],
    [2476, 0, [[3988, 10, 0]]],
    [2477, 0, [[3989, 10, 0]]],
    [2478, 0, [[3990, 10, 0]]],
    [2479, 0, [[3991, 10, 0]]],
  ]],
];

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

function cloneArgs(args) {
  return Array.isArray(args) ? args.slice() : [];
}

function cloneProgressValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneProgressValue(entry));
  }
  return value;
}

function cloneProgressEntries(entries) {
  return Array.isArray(entries)
    ? entries.map(([categoryID, operations]) => [
        categoryID,
        cloneProgressValue(operations),
      ])
    : [];
}

function normalizeProgressEntries(source, fallbackEntries) {
  if (source && source.type === "dict" && Array.isArray(source.entries)) {
    return cloneProgressEntries(source.entries);
  }
  if (source instanceof Map) {
    return cloneProgressEntries(Array.from(source.entries()));
  }
  if (Array.isArray(source)) {
    return cloneProgressEntries(source);
  }
  if (source && typeof source === "object") {
    return Object.entries(source).map(([key, value]) => [
      Number.isFinite(Number(key)) ? Number(key) : key,
      cloneProgressValue(value),
    ]);
  }
  return cloneProgressEntries(fallbackEntries);
}

function recordAuditEvent(kind, args = [], session = null, kwargs = null) {
  auditEvents.push({
    kind,
    args: cloneArgs(args),
    kwargs: kwargs || null,
    characterID: getCharacterID(session) || null,
    timestamp: Date.now(),
  });
}

function resolveCharacterID(args, session) {
  const directArg = Array.isArray(args) ? Number(args[0]) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }
  return Number(session && (session.charid || session.characterID || 0)) || 0;
}

function resolveOperationProgressState(args, session) {
  const characterID = resolveCharacterID(args, session);
  let characterRecord = null;
  if (characterID) {
    const {
      getCharacterRecord,
    } = require(path.join(__dirname, "./characterState"));
    characterRecord = getCharacterRecord(characterID);
  }
  return (
    (session && (session.operationProgress || session.operationsProgress)) ||
    (
      characterRecord &&
      (characterRecord.operationProgress || characterRecord.operationsProgress)
    ) ||
    null
  );
}

class OperationsManagerService extends BaseService {
  constructor() {
    super("operationsManager");
  }

  Handle_can_character_play_the_tutorial(args, session) {
    log.debug("[OperationsManager] can_character_play_the_tutorial called");
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .canPlayTutorial;
  }

  Handle_get_tutorial_state(args, session) {
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .tutorialState;
  }

  Handle_is_main_tutorial_finished(args, session) {
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .isMainTutorialFinished;
  }

  Handle_has_skipped_tutorial(args, session) {
    return getCharacterTutorialSnapshot(resolveCharacterID(args, session))
      .hasSkippedTutorial;
  }

  Handle_get_character_progress(args, session) {
    recordAuditEvent("get_character_progress", args, session);
    return buildDict(
      normalizeProgressEntries(
        resolveOperationProgressState(args, session),
        GOLDEN_LOGIN_CHARACTER_PROGRESS_ENTRIES,
      ),
    );
  }

  Handle_get_active_category_id(args, session) {
    return null;
  }

  Handle_start_site(args, session) {
    recordAuditEvent("start_site", args, session);
    return null;
  }

  Handle_process_client_event(args, session, kwargs) {
    recordAuditEvent("process_client_event", args, session, kwargs);
    return null;
  }

  Handle_activate_operation_in_solar_system(args, session) {
    recordAuditEvent("activate_operation_in_solar_system", args, session);
    return false;
  }

  Handle_block_task(args, session) {
    recordAuditEvent("block_task", args, session);
    return null;
  }

  Handle_complete_category_for_character(args, session) {
    recordAuditEvent("complete_category_for_character", args, session);
    return false;
  }

  Handle_get_category_state(args, session) {
    recordAuditEvent("get_category_state", args, session);
    return CATEGORY_STATE_LOCKED;
  }

  Handle_get_mission_avoidance_systems(args, session) {
    recordAuditEvent("get_mission_avoidance_systems", args, session);
    return buildList([]);
  }

  Handle_get_operations_completed_at_least_once(args, session) {
    recordAuditEvent("get_operations_completed_at_least_once", args, session);
    return buildList([]);
  }

  Handle_is_category_complete(args, session) {
    recordAuditEvent("is_category_complete", args, session);
    return false;
  }

  Handle_skip_task(args, session) {
    recordAuditEvent("skip_task", args, session);
    return false;
  }

  Handle_unblock_task(args, session) {
    recordAuditEvent("unblock_task", args, session);
    return null;
  }

  Handle_cancel_current_treatment_operation(args, session) {
    recordAuditEvent("cancel_current_treatment_operation", args, session);
    return null;
  }
}

OperationsManagerService._testing = {
  getAuditEvents() {
    return auditEvents.slice();
  },
  resetForTests() {
    auditEvents.length = 0;
  },
  constants: {
    CATEGORY_STATE_LOCKED,
  },
  GOLDEN_LOGIN_CHARACTER_PROGRESS_ENTRIES,
};

module.exports = OperationsManagerService;
