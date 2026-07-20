const path = require("path");

// Phase 0 / 0.C: bounty domain state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:bounty", { strict: true });
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

const TABLE_NAME = "playerBounties";

const OWNER_KIND = Object.freeze({
  CHARACTER: "character",
  CORPORATION: "corporation",
  ALLIANCE: "alliance",
  UNKNOWN: "unknown",
});

const OWNER_RANGES = Object.freeze({
  CHARACTER_GEN2_MIN: 90000000,
  CHARACTER_GEN2_MAX: 97999999,
  CHARACTER_GEN3_MIN: 2100000000,
  CHARACTER_GEN3_MAX: 2129999999,
  CORPORATION_MIN: 98000000,
  CORPORATION_MAX: 98999999,
  ALLIANCE_MIN: 99000000,
  ALLIANCE_MAX: 99999999,
});

const MINIMUM_BOUNTY_BY_KIND = Object.freeze({
  [OWNER_KIND.CHARACTER]: 1000000,
  [OWNER_KIND.CORPORATION]: 20000000,
  [OWNER_KIND.ALLIANCE]: 100000000,
});
const PLAYER_BOUNTY_PAYOUT_LOSS_RATIO = 0.2;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
}

function emptyState() {
  return {
    nextContributionID: 1,
    pools: {},
    contributions: {},
    hunterStats: emptyHunterStats(),
  };
}

function emptyHunterStats() {
  return {
    [OWNER_KIND.CHARACTER]: {},
    [OWNER_KIND.CORPORATION]: {},
    [OWNER_KIND.ALLIANCE]: {},
  };
}

function normalizeHunterStat(stat = {}, ownerKind = OWNER_KIND.UNKNOWN) {
  const bountyHunterID = toInteger(stat.bountyHunterID ?? stat.ownerID, 0);
  return {
    bountyHunterID,
    ownerKind,
    corporationID: toInteger(stat.corporationID, 0) || null,
    allianceID: toInteger(stat.allianceID, 0) || null,
    bountiesClaimed: Math.max(0, normalizeMoney(stat.bountiesClaimed, 0)),
    numberOfKills: Math.max(0, toInteger(stat.numberOfKills, 0)),
    updatedAt: String(stat.updatedAt || currentFileTime()),
  };
}

function normalizeHunterStats(rawStats = {}) {
  const normalized = emptyHunterStats();
  for (const ownerKind of [
    OWNER_KIND.CHARACTER,
    OWNER_KIND.CORPORATION,
    OWNER_KIND.ALLIANCE,
  ]) {
    const bucket = rawStats && rawStats[ownerKind] && typeof rawStats[ownerKind] === "object"
      ? rawStats[ownerKind]
      : {};
    for (const [bountyHunterID, stat] of Object.entries(bucket)) {
      const normalizedStat = normalizeHunterStat(
        {
          ...stat,
          bountyHunterID: stat && stat.bountyHunterID !== undefined
            ? stat.bountyHunterID
            : bountyHunterID,
        },
        ownerKind,
      );
      if (normalizedStat.bountyHunterID > 0) {
        normalized[ownerKind][String(normalizedStat.bountyHunterID)] = normalizedStat;
      }
    }
  }
  return normalized;
}

function normalizeState(rawState = {}) {
  const state = rawState && typeof rawState === "object"
    ? cloneValue(rawState)
    : {};
  const normalized = emptyState();
  normalized.nextContributionID = Math.max(
    1,
    toInteger(state.nextContributionID, 1),
  );
  normalized.pools = state.pools && typeof state.pools === "object"
    ? state.pools
    : {};
  normalized.contributions =
    state.contributions && typeof state.contributions === "object"
      ? state.contributions
      : {};
  normalized.hunterStats = normalizeHunterStats(state.hunterStats);
  return normalized;
}

function readState() {
  const result = repo.read(TABLE_NAME, "/");
  if (!result.success) {
    return emptyState();
  }
  return normalizeState(result.data);
}

function writeState(state) {
  return repo.write(TABLE_NAME, "/", normalizeState(state));
}

function readCorporationRecord(corporationID) {
  const recordsResult = repo.read("corporations", "/records");
  if (recordsResult.success && recordsResult.data) {
    const record = recordsResult.data[String(corporationID)];
    if (record) {
      return record;
    }
  }

  const directResult = repo.read("corporations", `/${corporationID}`);
  return directResult.success ? directResult.data : null;
}

function readAllianceRecord(allianceID) {
  const recordsResult = repo.read("alliances", "/records");
  if (recordsResult.success && recordsResult.data) {
    const record = recordsResult.data[String(allianceID)];
    if (record) {
      return record;
    }
  }

  const directResult = repo.read("alliances", `/${allianceID}`);
  return directResult.success ? directResult.data : null;
}

function isInRange(value, min, max) {
  return value >= min && value <= max;
}

function inferOwnerKind(ownerID) {
  const numericOwnerID = toInteger(ownerID, 0);
  if (numericOwnerID <= 0) {
    return OWNER_KIND.UNKNOWN;
  }

  if (getCharacterRecord(numericOwnerID)) {
    return OWNER_KIND.CHARACTER;
  }
  if (readCorporationRecord(numericOwnerID)) {
    return OWNER_KIND.CORPORATION;
  }
  if (readAllianceRecord(numericOwnerID)) {
    return OWNER_KIND.ALLIANCE;
  }
  if (
    isInRange(
      numericOwnerID,
      OWNER_RANGES.CHARACTER_GEN2_MIN,
      OWNER_RANGES.CHARACTER_GEN2_MAX,
    ) ||
    isInRange(
      numericOwnerID,
      OWNER_RANGES.CHARACTER_GEN3_MIN,
      OWNER_RANGES.CHARACTER_GEN3_MAX,
    )
  ) {
    return OWNER_KIND.CHARACTER;
  }
  if (
    isInRange(
      numericOwnerID,
      OWNER_RANGES.CORPORATION_MIN,
      OWNER_RANGES.CORPORATION_MAX,
    )
  ) {
    return OWNER_KIND.CORPORATION;
  }
  if (
    isInRange(
      numericOwnerID,
      OWNER_RANGES.ALLIANCE_MIN,
      OWNER_RANGES.ALLIANCE_MAX,
    )
  ) {
    return OWNER_KIND.ALLIANCE;
  }
  return OWNER_KIND.UNKNOWN;
}

function getMinimumBountyAmount(ownerID) {
  return MINIMUM_BOUNTY_BY_KIND[inferOwnerKind(ownerID)] || 0;
}

function resolveOwnerAffiliation(ownerID) {
  const targetID = toInteger(ownerID, 0);
  const targetKind = inferOwnerKind(targetID);
  let corporationID = null;
  let allianceID = null;

  if (targetKind === OWNER_KIND.CHARACTER) {
    const characterRecord = getCharacterRecord(targetID);
    corporationID =
      toInteger(characterRecord && characterRecord.corporationID, 0) || null;
    allianceID =
      toInteger(characterRecord && characterRecord.allianceID, 0) || null;
  } else if (targetKind === OWNER_KIND.CORPORATION) {
    corporationID = targetID;
    const corporationRecord = readCorporationRecord(targetID);
    allianceID =
      toInteger(corporationRecord && corporationRecord.allianceID, 0) || null;
  } else if (targetKind === OWNER_KIND.ALLIANCE) {
    allianceID = targetID;
  }

  return {
    targetID,
    targetKind,
    corporationID,
    allianceID,
  };
}

function normalizePool(pool = {}) {
  const targetID = toInteger(pool.targetID, 0);
  const affiliation = resolveOwnerAffiliation(targetID);
  return {
    ...affiliation,
    bounty: Math.max(0, normalizeMoney(pool.bounty, 0)),
    updatedAt: String(pool.updatedAt || currentFileTime()),
  };
}

function getPool(state = null, targetID = null) {
  let sourceState = state;
  let sourceTargetID = targetID;
  if (sourceTargetID === null || sourceTargetID === undefined) {
    sourceTargetID = sourceState;
    sourceState = readState();
  }
  if (!sourceState || typeof sourceState !== "object") {
    sourceState = readState();
  }
  const numericTargetID = toInteger(sourceTargetID, 0);
  if (numericTargetID <= 0) {
    return normalizePool({ targetID: numericTargetID, bounty: 0 });
  }
  return normalizePool(
    sourceState.pools[String(numericTargetID)] || {
      targetID: numericTargetID,
      bounty: 0,
    },
  );
}

function listPools(options = {}) {
  const state = options.state || readState();
  return Object.values(state.pools || {})
    .map((pool) => normalizePool(pool))
    .filter((pool) => pool.targetID > 0 && pool.bounty > 0);
}

function listPoolsByKind(ownerKind, options = {}) {
  return listPools(options)
    .filter((pool) => pool.targetKind === ownerKind)
    .sort((left, right) => right.bounty - left.bounty || left.targetID - right.targetID);
}

function listContributionsForContributor(contributorID, options = {}) {
  const numericContributorID = toInteger(contributorID, 0);
  if (numericContributorID <= 0) {
    return [];
  }
  const state = options.state || readState();
  return Object.values(state.contributions || {})
    .filter(
      (contribution) =>
        toInteger(contribution && contribution.contributorID, 0) ===
        numericContributorID,
    )
    .map((contribution) => ({
      ...resolveOwnerAffiliation(contribution.targetID),
      contributionID: toInteger(contribution.contributionID, 0),
      contributorID: numericContributorID,
      amount: Math.max(0, normalizeMoney(contribution.amount, 0)),
      createdAt: String(contribution.createdAt || currentFileTime()),
    }))
    .filter((contribution) => contribution.contributionID > 0)
    .sort((left, right) => right.contributionID - left.contributionID);
}

function listBountyHuntersByKind(ownerKind, options = {}) {
  const state = options.state || readState();
  const bucket =
    state.hunterStats &&
    state.hunterStats[ownerKind] &&
    typeof state.hunterStats[ownerKind] === "object"
      ? state.hunterStats[ownerKind]
      : {};
  return Object.values(bucket)
    .map((stat) => normalizeHunterStat(stat, ownerKind))
    .filter((stat) => stat.bountyHunterID > 0 && stat.bountiesClaimed > 0)
    .sort(
      (left, right) =>
        right.bountiesClaimed - left.bountiesClaimed ||
        right.numberOfKills - left.numberOfKills ||
        left.bountyHunterID - right.bountyHunterID,
    )
    .map((stat, index) => ({
      ...stat,
      rowNumber: index + 1,
    }));
}

function collectVictimBountyPools(state, victim = {}) {
  const targetIDs = [
    victim.victimCharacterID,
    victim.characterID,
    victim.victimCorporationID,
    victim.corporationID,
    victim.victimAllianceID,
    victim.allianceID,
  ]
    .map((value) => toInteger(value, 0))
    .filter((value, index, values) => value > 0 && values.indexOf(value) === index);

  return targetIDs
    .map((targetID) => getPool(state, targetID))
    .filter((pool) => pool.targetID > 0 && pool.bounty > 0);
}

function allocatePayoutAcrossPools(pools, payoutAmount) {
  const totalBounty = normalizeMoney(
    pools.reduce((sum, pool) => sum + Math.max(0, normalizeMoney(pool.bounty, 0)), 0),
    0,
  );
  let remainingPayout = Math.min(normalizeMoney(payoutAmount, 0), totalBounty);
  const allocations = [];

  pools.forEach((pool) => {
    if (remainingPayout <= 0) {
      return;
    }
    const poolBounty = Math.max(0, normalizeMoney(pool.bounty, 0));
    const amount = normalizeMoney(Math.min(poolBounty, remainingPayout), 0);
    if (amount > 0) {
      allocations.push({
        targetID: pool.targetID,
        amount,
      });
      remainingPayout = normalizeMoney(remainingPayout - amount, 0);
    }
  });

  return allocations.filter((allocation) => allocation.amount > 0);
}

function buildHunterIdentity(hunterCharacterID) {
  const characterID = toInteger(hunterCharacterID, 0);
  const characterRecord = characterID > 0 ? getCharacterRecord(characterID) : null;
  return {
    characterID,
    corporationID:
      toInteger(characterRecord && characterRecord.corporationID, 0) || null,
    allianceID:
      toInteger(characterRecord && characterRecord.allianceID, 0) || null,
  };
}

function incrementHunterStat(state, ownerKind, bountyHunterID, amount, affiliation = {}) {
  const numericBountyHunterID = toInteger(bountyHunterID, 0);
  const normalizedAmount = normalizeMoney(amount, 0);
  if (numericBountyHunterID <= 0 || !(normalizedAmount > 0)) {
    return;
  }

  if (!state.hunterStats || typeof state.hunterStats !== "object") {
    state.hunterStats = emptyHunterStats();
  }
  if (!state.hunterStats[ownerKind]) {
    state.hunterStats[ownerKind] = {};
  }

  const currentStat = normalizeHunterStat(
    state.hunterStats[ownerKind][String(numericBountyHunterID)] || {
      bountyHunterID: numericBountyHunterID,
    },
    ownerKind,
  );
  state.hunterStats[ownerKind][String(numericBountyHunterID)] = {
    ...currentStat,
    bountyHunterID: numericBountyHunterID,
    corporationID:
      toInteger(affiliation.corporationID, 0) ||
      currentStat.corporationID ||
      null,
    allianceID:
      toInteger(affiliation.allianceID, 0) ||
      currentStat.allianceID ||
      null,
    bountiesClaimed: normalizeMoney(currentStat.bountiesClaimed + normalizedAmount, 0),
    numberOfKills: currentStat.numberOfKills + 1,
    updatedAt: String(currentFileTime()),
  };
}

function recordHunterPayout(state, hunterCharacterID, payoutAmount) {
  const hunter = buildHunterIdentity(hunterCharacterID);
  if (hunter.characterID <= 0 || !(normalizeMoney(payoutAmount, 0) > 0)) {
    return;
  }

  incrementHunterStat(
    state,
    OWNER_KIND.CHARACTER,
    hunter.characterID,
    payoutAmount,
    {
      corporationID: hunter.corporationID,
      allianceID: hunter.allianceID,
    },
  );
  if (hunter.corporationID) {
    incrementHunterStat(
      state,
      OWNER_KIND.CORPORATION,
      hunter.corporationID,
      payoutAmount,
      {
        corporationID: hunter.corporationID,
        allianceID: hunter.allianceID,
      },
    );
  }
  if (hunter.allianceID) {
    incrementHunterStat(
      state,
      OWNER_KIND.ALLIANCE,
      hunter.allianceID,
      payoutAmount,
      {
        allianceID: hunter.allianceID,
      },
    );
  }
}

function claimBountyPayout({ victim = {}, iskLost = 0, hunterCharacterID = 0 } = {}) {
  const numericHunterCharacterID = toInteger(hunterCharacterID, 0);
  const victimCharacterID = toInteger(
    victim.victimCharacterID ?? victim.characterID,
    0,
  );
  if (
    numericHunterCharacterID <= 0 ||
    (victimCharacterID > 0 && numericHunterCharacterID === victimCharacterID)
  ) {
    return {
      eligible: false,
      amount: 0,
      reason: "NO_ELIGIBLE_HUNTER",
    };
  }

  const cappedByLoss = normalizeMoney(
    Math.max(0, normalizeMoney(iskLost, 0)) * PLAYER_BOUNTY_PAYOUT_LOSS_RATIO,
    0,
  );
  if (!(cappedByLoss > 0)) {
    return {
      eligible: false,
      amount: 0,
      reason: "NO_LOSS_VALUE",
    };
  }

  const state = readState();
  const pools = collectVictimBountyPools(state, victim);
  if (pools.length <= 0) {
    return {
      eligible: false,
      amount: 0,
      reason: "NO_BOUNTY_POOL",
    };
  }

  const totalBounty = normalizeMoney(
    pools.reduce((sum, pool) => sum + Math.max(0, normalizeMoney(pool.bounty, 0)), 0),
    0,
  );
  const payoutAmount = normalizeMoney(Math.min(cappedByLoss, totalBounty), 0);
  const allocations = allocatePayoutAcrossPools(pools, payoutAmount);
  if (allocations.length <= 0) {
    return {
      eligible: false,
      amount: 0,
      reason: "NO_ALLOCATION",
    };
  }

  const now = String(currentFileTime());
  for (const allocation of allocations) {
    const pool = getPool(state, allocation.targetID);
    const nextBounty = normalizeMoney(
      Math.max(0, normalizeMoney(pool.bounty, 0) - allocation.amount),
      0,
    );
    state.pools[String(allocation.targetID)] = {
      ...pool,
      bounty: nextBounty,
      updatedAt: now,
    };
  }
  recordHunterPayout(state, numericHunterCharacterID, payoutAmount);

  const writeResult = writeState(state);
  if (!writeResult.success) {
    return {
      eligible: false,
      amount: 0,
      reason: writeResult.errorMsg || "WRITE_ERROR",
    };
  }

  return {
    eligible: true,
    amount: normalizeMoney(
      allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
      0,
    ),
    lossValue: normalizeMoney(iskLost, 0),
    capAmount: cappedByLoss,
    allocations,
  };
}

function placeBounty({ targetID, amount, contributorID }) {
  const numericTargetID = toInteger(targetID, 0);
  const numericContributorID = toInteger(contributorID, 0);
  const normalizedAmount = normalizeMoney(amount, 0);
  const minimumAmount = getMinimumBountyAmount(numericTargetID);
  if (numericTargetID <= 0 || inferOwnerKind(numericTargetID) === OWNER_KIND.UNKNOWN) {
    return {
      success: false,
      errorMsg: "INVALID_TARGET",
      minimumAmount,
    };
  }
  if (!(normalizedAmount > 0) || normalizedAmount < minimumAmount) {
    return {
      success: false,
      errorMsg: "AMOUNT_TOO_LOW",
      minimumAmount,
    };
  }
  if (numericContributorID <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
      minimumAmount,
    };
  }

  const state = readState();
  const contributionID = Math.max(1, toInteger(state.nextContributionID, 1));
  const now = String(currentFileTime());
  const affiliation = resolveOwnerAffiliation(numericTargetID);
  const currentPool = getPool(state, numericTargetID);
  const nextPool = {
    ...affiliation,
    bounty: normalizeMoney(currentPool.bounty + normalizedAmount, 0),
    updatedAt: now,
  };
  const contribution = {
    ...affiliation,
    contributionID,
    contributorID: numericContributorID,
    amount: normalizedAmount,
    createdAt: now,
  };

  state.nextContributionID = contributionID + 1;
  state.pools[String(numericTargetID)] = nextPool;
  state.contributions[String(contributionID)] = contribution;

  const writeResult = writeState(state);
  if (!writeResult.success) {
    return writeResult;
  }

  return {
    success: true,
    pool: normalizePool(nextPool),
    contribution,
  };
}

function resetStateForTests(nextState = emptyState()) {
  return writeState(normalizeState(nextState));
}

module.exports = {
  TABLE_NAME,
  OWNER_KIND,
  getMinimumBountyAmount,
  inferOwnerKind,
  resolveOwnerAffiliation,
  getPool,
  listPools,
  listPoolsByKind,
  listContributionsForContributor,
  listBountyHuntersByKind,
  claimBountyPayout,
  placeBounty,
  _testing: {
    emptyState,
    readState,
    writeState,
    resetStateForTests,
  },
};
