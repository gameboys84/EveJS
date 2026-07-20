const path = require("path");
const { performance } = require("perf_hooks");

// Phase 0 / 0.C: bounty domain state via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:bounty", { strict: true });
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  buildKeyVal,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const PENDING_TABLE_NAME = "pendingNpcBounties";

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const DEFAULT_PAYOUT_INTERVAL_MS = 20 * 60 * 1000;
const MAX_SOURCE_REFERENCES = 32;
const ATTRIBUTE_FAST_TALK_PERCENTAGE = 359;
const SECURITY_STATUS_RECOVERY_MODIFIER_PER_ISK = 1 / 100_000_000;
const SECURITY_STATUS_RECOVERY_MODIFIER_CAP = 0.0025;
const SECURITY_STATUS_RECOVERY_ROUND_DIGITS = 4;

let payoutIntervalMs = DEFAULT_PAYOUT_INTERVAL_MS;
let nowProvider = () => Date.now();
let timerEnabled = true;
let payoutTimer = null;
let nextDueAtMs = Number.POSITIVE_INFINITY;
let persistenceEnabled = true;
let persistenceLoaded = false;
let characterStateModule = null;
let crimewatchStateModule = null;
let standingRuntimeModule = null;

const bucketsByKey = new Map();

function getCharacterStateModule() {
  if (!characterStateModule) {
    characterStateModule = require(path.join(__dirname, "../character/characterState"));
  }
  return characterStateModule;
}

function getCrimewatchStateModule() {
  if (!crimewatchStateModule) {
    crimewatchStateModule = require(path.join(__dirname, "../security/crimewatchState"));
  }
  return crimewatchStateModule;
}

function getStandingRuntimeModule() {
  if (!standingRuntimeModule) {
    standingRuntimeModule = require(path.join(__dirname, "../character/standingRuntime"));
  }
  return standingRuntimeModule;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = null) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
}

function roundNumber(value, digits = 6) {
  const numeric = toFiniteNumber(value, 0);
  const factor = 10 ** Math.max(0, Math.trunc(toFiniteNumber(digits, 0)));
  return Math.round(numeric * factor) / factor;
}

function formatFiletime(whenMs) {
  const normalizedWhenMs = Number.isFinite(Number(whenMs))
    ? Math.trunc(Number(whenMs))
    : nowProvider();
  return (
    BigInt(normalizedWhenMs) * FILETIME_TICKS_PER_MS +
    FILETIME_EPOCH_OFFSET
  ).toString();
}

function resolvePayoutAtMs(nowMs = nowProvider()) {
  const interval = Math.max(1, toInt(payoutIntervalMs, DEFAULT_PAYOUT_INTERVAL_MS));
  const normalizedNowMs = Number.isFinite(Number(nowMs))
    ? Math.trunc(Number(nowMs))
    : nowProvider();
  return normalizedNowMs + interval;
}

function buildBucketKey(characterID, solarSystemID, payoutTime) {
  return `${toPositiveInt(characterID, 0) || 0}:${toPositiveInt(solarSystemID, 0) || 0}:${String(payoutTime || "")}`;
}

function findActivePayoutAtMsForCharacter(characterID, nowMs = nowProvider()) {
  const normalizedCharacterID = toPositiveInt(characterID, 0) || 0;
  const normalizedNowMs = Number.isFinite(Number(nowMs))
    ? Math.trunc(Number(nowMs))
    : nowProvider();
  if (normalizedCharacterID <= 0) {
    return null;
  }

  let activePayoutAtMs = Number.POSITIVE_INFINITY;
  for (const bucket of bucketsByKey.values()) {
    if (
      bucket &&
      toPositiveInt(bucket.characterID, 0) === normalizedCharacterID &&
      toFiniteNumber(bucket.payoutAtMs, 0) > normalizedNowMs &&
      toFiniteNumber(bucket.payoutAtMs, 0) < activePayoutAtMs
    ) {
      activePayoutAtMs = toFiniteNumber(bucket.payoutAtMs, 0);
    }
  }

  return Number.isFinite(activePayoutAtMs) ? activePayoutAtMs : null;
}

function resolvePayoutAtMsForCharacter(characterID, nowMs = nowProvider()) {
  return findActivePayoutAtMsForCharacter(characterID, nowMs) || resolvePayoutAtMs(nowMs);
}

function isNpcVictim(entity) {
  if (!entity) {
    return false;
  }
  const npcEntityType = String(entity.npcEntityType || "").trim().toLowerCase();
  return (
    entity.nativeNpc === true ||
    entity.nativeNpcOccupied === true ||
    npcEntityType === "npc" ||
    npcEntityType === "concord"
  );
}

function isPlayerVictim(entity) {
  if (isNpcVictim(entity)) {
    return false;
  }
  return toPositiveInt(entity && (entity.pilotCharacterID ?? entity.characterID), null) !== null;
}

function resolveAttackerCharacterID(finalAttacker = {}, context = {}) {
  const attacker = finalAttacker || {};
  const candidates = [
    context.characterID,
    attacker.characterID,
    attacker.charID,
    attacker.charid,
    attacker.pilotCharacterID,
    attacker.ownerCharacterID,
    attacker.controllerOwnerID,
    attacker.sourceOwnerID,
    attacker.session && attacker.session.characterID,
    attacker.session && attacker.session.charID,
    attacker.session && attacker.session.charid,
  ];
  for (const candidate of candidates) {
    const characterID = toPositiveInt(candidate, null);
    if (characterID) {
      return characterID;
    }
  }
  return null;
}

function resolveAuthoredMultiplier(entity = {}, context = {}) {
  const candidates = [
    context.bountyPayoutMultiplier,
    context.bountyPayOutMultiplier,
    entity.bountyPayoutMultiplier,
    entity.bountyPayOutMultiplier,
    entity.spawnBountyPayoutMultiplier,
    entity.spawnBountyPayOutMultiplier,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }
  return 1;
}

function resolveSolarSystemBountyMultiplier(_solarSystemID, _context = {}) {
  return 1;
}

function resolveEssBountySplit(_solarSystemID, amount, _context = {}) {
  return {
    playerAmount: normalizeMoney(amount, 0),
    essMainBankAmount: 0,
    reserveBankAmount: 0,
    securityTaxAmount: 0,
  };
}

function resolveCharacterRecord(characterID) {
  const characterState = getCharacterStateModule();
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function resolveExplicitSecurityStatusRecoveryModifier(victimEntity = {}, context = {}) {
  const candidates = [
    context.securityStatusRecoveryModifier,
    context.securityStatusGainModifier,
    victimEntity.securityStatusRecoveryModifier,
    victimEntity.securityStatusGainModifier,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }
  return null;
}

function resolveSecurityStatusRecoveryBaseModifier(victimEntity = {}, resolution = {}, context = {}) {
  const explicitModifier = resolveExplicitSecurityStatusRecoveryModifier(victimEntity, context);
  if (explicitModifier !== null) {
    return explicitModifier;
  }

  const amount = Math.max(0, normalizeMoney(resolution && resolution.amount, 0));
  if (!(amount > 0)) {
    return 0;
  }
  return Math.min(
    SECURITY_STATUS_RECOVERY_MODIFIER_CAP,
    amount * SECURITY_STATUS_RECOVERY_MODIFIER_PER_ISK,
  );
}

function resolveFastTalkSecurityStatusMultiplier(characterID) {
  const standingRuntime = getStandingRuntimeModule();
  if (
    !standingRuntime ||
    typeof standingRuntime.getCharacterSocialAttribute !== "function"
  ) {
    return 1;
  }
  const multiplier = toFiniteNumber(
    standingRuntime.getCharacterSocialAttribute(
      characterID,
      ATTRIBUTE_FAST_TALK_PERCENTAGE,
      1,
    ),
    1,
  );
  return Math.max(0, multiplier);
}

function findSessionForCharacter(characterID, finalAttacker = {}, context = {}) {
  const directSession =
    context.session ||
    context.attackerSession ||
    finalAttacker.session ||
    null;
  if (
    directSession &&
    toPositiveInt(
      directSession.characterID ?? directSession.charID ?? directSession.charid,
      0,
    ) === characterID
  ) {
    return directSession;
  }

  if (typeof sessionRegistry.findSessionByCharacterID === "function") {
    return sessionRegistry.findSessionByCharacterID(characterID) || null;
  }

  return sessionRegistry
    .getSessions()
    .find((session) =>
      toPositiveInt(session && (session.characterID ?? session.charID ?? session.charid), 0) ===
        characterID
    ) || null;
}

function buildSecurityStatusRecoveryResult({
  applied = false,
  reason = "NOT_APPLIED",
  characterID = 0,
  previousSecurityStatus = 0,
  nextSecurityStatus = previousSecurityStatus,
  baseModifier = 0,
  fastTalkMultiplier = 1,
  modifier = 0,
} = {}) {
  return {
    applied,
    reason,
    characterID: toPositiveInt(characterID, 0) || 0,
    previousSecurityStatus: roundNumber(previousSecurityStatus, SECURITY_STATUS_RECOVERY_ROUND_DIGITS),
    nextSecurityStatus: roundNumber(nextSecurityStatus, SECURITY_STATUS_RECOVERY_ROUND_DIGITS),
    deltaSecurityStatus: roundNumber(
      toFiniteNumber(nextSecurityStatus, 0) - toFiniteNumber(previousSecurityStatus, 0),
      SECURITY_STATUS_RECOVERY_ROUND_DIGITS,
    ),
    baseModificationPercent: roundNumber(toFiniteNumber(baseModifier, 0) * 100, 6),
    fastTalkMultiplier: roundNumber(fastTalkMultiplier, 6),
    modificationPercent: roundNumber(toFiniteNumber(modifier, 0) * 100, 6),
  };
}

function applySecurityStatusRecovery(characterID, victimEntity, finalAttacker, resolution, context = {}) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!normalizedCharacterID || context.applySecurityStatusRecovery === false) {
    return null;
  }

  if (!resolveCharacterRecord(normalizedCharacterID)) {
    return null;
  }

  const baseModifier = resolveSecurityStatusRecoveryBaseModifier(victimEntity, resolution, context);
  const fastTalkMultiplier = resolveFastTalkSecurityStatusMultiplier(normalizedCharacterID);
  const modifier = baseModifier * fastTalkMultiplier;
  const crimewatchState = getCrimewatchStateModule();
  const previousSecurityStatus = crimewatchState.getCharacterSecurityStatus(normalizedCharacterID, 0);
  if (!(modifier > 0)) {
    return buildSecurityStatusRecoveryResult({
      reason: "NO_RECOVERY_MODIFIER",
      characterID: normalizedCharacterID,
      previousSecurityStatus,
      baseModifier,
      fastTalkMultiplier,
      modifier,
    });
  }

  const maxSecurityStatus = toFiniteNumber(crimewatchState.SECURITY_STATUS_MAX, 10);
  const nextSecurityStatus = Math.min(
    maxSecurityStatus,
    previousSecurityStatus + ((maxSecurityStatus - previousSecurityStatus) * modifier),
  );
  if (
    Number(roundNumber(nextSecurityStatus, SECURITY_STATUS_RECOVERY_ROUND_DIGITS)) ===
      Number(roundNumber(previousSecurityStatus, SECURITY_STATUS_RECOVERY_ROUND_DIGITS))
  ) {
    return buildSecurityStatusRecoveryResult({
      reason: "SECURITY_STATUS_CEILING_REACHED",
      characterID: normalizedCharacterID,
      previousSecurityStatus,
      nextSecurityStatus: previousSecurityStatus,
      baseModifier,
      fastTalkMultiplier,
      modifier,
    });
  }

  const updateResult = crimewatchState.setCharacterSecurityStatus(
    normalizedCharacterID,
    nextSecurityStatus,
    {
      scene: context.scene || finalAttacker.scene || null,
      entity: context.entity || finalAttacker.entity || finalAttacker.attackerEntity || null,
      session: findSessionForCharacter(normalizedCharacterID, finalAttacker, context),
      now: context.nowMs,
    },
  );
  if (!updateResult || updateResult.success !== true) {
    return buildSecurityStatusRecoveryResult({
      reason: updateResult && updateResult.errorMsg ? updateResult.errorMsg : "WRITE_ERROR",
      characterID: normalizedCharacterID,
      previousSecurityStatus,
      nextSecurityStatus: previousSecurityStatus,
      baseModifier,
      fastTalkMultiplier,
      modifier,
    });
  }

  return buildSecurityStatusRecoveryResult({
    applied: true,
    reason: "APPLIED",
    characterID: normalizedCharacterID,
    previousSecurityStatus:
      updateResult.data && updateResult.data.previousSecurityStatus !== undefined
        ? updateResult.data.previousSecurityStatus
        : previousSecurityStatus,
    nextSecurityStatus:
      updateResult.data && updateResult.data.securityStatus !== undefined
        ? updateResult.data.securityStatus
        : nextSecurityStatus,
    baseModifier,
    fastTalkMultiplier,
    modifier,
  });
}

function resolveNpcBountyAmount(victimEntity = {}, context = {}) {
  if (!victimEntity || isPlayerVictim(victimEntity)) {
    return {
      eligible: false,
      amount: 0,
      baseAmount: 0,
      isModified: false,
    };
  }

  const baseAmount = Math.max(0, normalizeMoney(victimEntity.bounty, 0));
  if (baseAmount <= 0) {
    return {
      eligible: false,
      amount: 0,
      baseAmount,
      isModified: false,
    };
  }

  const solarSystemID = toPositiveInt(
    context.solarSystemID,
    toPositiveInt(victimEntity.systemID, 0),
  ) || 0;
  const authoredMultiplier = resolveAuthoredMultiplier(victimEntity, context);
  const solarSystemMultiplier = resolveSolarSystemBountyMultiplier(solarSystemID, context);
  const grossAmount = normalizeMoney(baseAmount * authoredMultiplier * solarSystemMultiplier, 0);
  const split = resolveEssBountySplit(solarSystemID, grossAmount, context);
  const amount = Math.max(0, normalizeMoney(split.playerAmount, 0));

  return {
    eligible: amount > 0,
    amount,
    baseAmount,
    grossAmount,
    solarSystemID,
    authoredMultiplier,
    solarSystemMultiplier,
    essMainBankAmount: normalizeMoney(split.essMainBankAmount, 0),
    reserveBankAmount: normalizeMoney(split.reserveBankAmount, 0),
    securityTaxAmount: normalizeMoney(split.securityTaxAmount, 0),
    isModified:
      normalizeMoney(baseAmount, 0) !== amount ||
      authoredMultiplier !== 1 ||
      solarSystemMultiplier !== 1 ||
      normalizeMoney(split.essMainBankAmount, 0) > 0 ||
      normalizeMoney(split.reserveBankAmount, 0) > 0 ||
      normalizeMoney(split.securityTaxAmount, 0) > 0,
  };
}

function notifyBountyAdded(characterID, payload) {
  const sessions = sessionRegistry
    .getSessions()
    .filter((session) => Number((session && session.characterID) || 0) === Number(characterID || 0));

  // OnBountyAddedToPayout ships a util.KeyVal on the wire (per golden-log
  // parity), not a bare JS object — the marshaller rejects untyped objects.
  // `payoutTime` is a win32 FILETIME beyond the JS safe-integer range, so send
  // it as an int64 long rather than a string.
  const wirePayload = buildKeyVal([
    ["enemyTypeID", toInt(payload && payload.enemyTypeID, 0)],
    ["amount", toInt(payload && payload.amount, 0)],
    ["payoutTime", { type: "long", value: String((payload && payload.payoutTime) || "0") }],
    ["isModified", Boolean(payload && payload.isModified)],
  ]);

  for (const session of sessions) {
    if (session && typeof session.sendNotification === "function") {
      session.sendNotification("OnBountyAddedToPayout", "charid", [wirePayload]);
    }
  }
}

function clearTimer() {
  if (payoutTimer) {
    clearTimeout(payoutTimer);
    payoutTimer = null;
  }
}

function refreshNextDueAt() {
  nextDueAtMs = Number.POSITIVE_INFINITY;
  for (const bucket of bucketsByKey.values()) {
    if (bucket.payoutAtMs < nextDueAtMs) {
      nextDueAtMs = bucket.payoutAtMs;
    }
  }
}

function scheduleTimer() {
  clearTimer();
  if (!timerEnabled || !Number.isFinite(nextDueAtMs)) {
    return;
  }
  const delayMs = Math.max(1, nextDueAtMs - nowProvider());
  payoutTimer = setTimeout(() => {
    payoutTimer = null;
    flushDuePayouts();
  }, delayMs);
  if (typeof payoutTimer.unref === "function") {
    payoutTimer.unref();
  }
}

function noteBucketDueAt(payoutAtMs) {
  if (payoutAtMs < nextDueAtMs) {
    nextDueAtMs = payoutAtMs;
    scheduleTimer();
  }
}

function getOrCreateBucket(characterID, solarSystemID, payoutAtMs) {
  const payoutTime = formatFiletime(payoutAtMs);
  const key = buildBucketKey(characterID, solarSystemID, payoutTime);
  const existing = bucketsByKey.get(key);
  if (existing) {
    return existing;
  }

  const bucket = {
    key,
    characterID,
    solarSystemID,
    payoutAtMs,
    payoutTime,
    amount: 0,
    kills: 0,
    npcTypes: {},
    sourceReferences: [],
  };
  bucketsByKey.set(key, bucket);
  noteBucketDueAt(payoutAtMs);
  return bucket;
}

function addToBucket(bucket, award = {}) {
  bucket.amount = normalizeMoney(bucket.amount + normalizeMoney(award.amount, 0), 0);
  bucket.kills += 1;

  const typeID = toPositiveInt(award.enemyTypeID, 0) || 0;
  if (typeID > 0) {
    bucket.npcTypes[String(typeID)] = (toInt(bucket.npcTypes[String(typeID)], 0) || 0) + 1;
  }

  const sourceReference = toPositiveInt(award.referenceID, null);
  if (sourceReference && bucket.sourceReferences.length < MAX_SOURCE_REFERENCES) {
    bucket.sourceReferences.push(sourceReference);
  }
}

function findBucketBySourceReference(referenceID) {
  const normalizedReferenceID = toPositiveInt(referenceID, null);
  if (!normalizedReferenceID) {
    return null;
  }

  return Array.from(bucketsByKey.values()).find((bucket) => (
    bucket &&
    Array.isArray(bucket.sourceReferences) &&
    bucket.sourceReferences.some(
      (sourceReference) => toPositiveInt(sourceReference, null) === normalizedReferenceID,
    )
  )) || null;
}

function serializeBucket(bucket) {
  return {
    key: bucket.key,
    characterID: bucket.characterID,
    solarSystemID: bucket.solarSystemID,
    payoutAtMs: bucket.payoutAtMs,
    payoutTime: bucket.payoutTime,
    amount: bucket.amount,
    kills: bucket.kills,
    npcTypes: { ...bucket.npcTypes },
    sourceReferences: [...bucket.sourceReferences],
  };
}

function ensurePendingTable() {
  if (typeof repo.ensureTable === "function") {
    repo.ensureTable(PENDING_TABLE_NAME);
  }
}

function persistBuckets() {
  if (!persistenceEnabled) {
    return;
  }
  ensurePendingTable();
  const payload = {};
  for (const [key, bucket] of bucketsByKey.entries()) {
    payload[key] = serializeBucket(bucket);
  }
  repo.write(PENDING_TABLE_NAME, "/", payload);
}

function loadPersistedBuckets() {
  persistenceLoaded = true;
  ensurePendingTable();
  const result = repo.read(PENDING_TABLE_NAME, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return;
  }
  for (const [key, raw] of Object.entries(result.data)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const characterID = toPositiveInt(raw.characterID, 0) || 0;
    const amount = normalizeMoney(raw.amount, 0);
    if (!(characterID > 0) || !(amount > 0)) {
      continue;
    }
    const payoutAtMs = toFiniteNumber(raw.payoutAtMs, 0);
    bucketsByKey.set(key, {
      key,
      characterID,
      solarSystemID: toPositiveInt(raw.solarSystemID, 0) || 0,
      payoutAtMs,
      payoutTime: String(raw.payoutTime || formatFiletime(payoutAtMs)),
      amount,
      kills: Math.max(0, toInt(raw.kills, 0)),
      npcTypes:
        raw.npcTypes && typeof raw.npcTypes === "object" ? { ...raw.npcTypes } : {},
      sourceReferences: Array.isArray(raw.sourceReferences)
        ? raw.sourceReferences.slice(0, MAX_SOURCE_REFERENCES)
        : [],
    });
  }
  refreshNextDueAt();
  scheduleTimer();
}

function ensureLoaded() {
  if (persistenceLoaded || !persistenceEnabled) {
    return;
  }
  loadPersistedBuckets();
}

function recordNpcBountyKill(victimEntity = {}, finalAttacker = {}, context = {}) {
  ensureLoaded();
  const characterID = resolveAttackerCharacterID(finalAttacker, context);
  if (!characterID) {
    return null;
  }

  const resolution = resolveNpcBountyAmount(victimEntity, context);
  if (!resolution.eligible) {
    return null;
  }

  const solarSystemID = toPositiveInt(
    resolution.solarSystemID,
    toPositiveInt(victimEntity && victimEntity.systemID, 0),
  ) || 0;
  // Schedule the payout against the wall clock (not sim time) so a persisted
  // bucket stays comparable after a restart, when the scene's sim clock resets.
  // The first kill starts the character's payout window; later kills before the
  // bucket comes due reuse that same payout time instead of snapping to a
  // cluster-wide wall-clock boundary.
  const payoutAtMs = Number.isFinite(Number(context.payoutAtMs))
    ? Math.trunc(Number(context.payoutAtMs))
    : resolvePayoutAtMsForCharacter(characterID, nowProvider());
  const enemyTypeID = toPositiveInt(victimEntity && victimEntity.typeID, 0) || 0;
  const referenceID = toPositiveInt(victimEntity && victimEntity.itemID, null);
  const existingReferenceBucket = findBucketBySourceReference(referenceID);
  const existingPayload = existingReferenceBucket
    ? {
        enemyTypeID,
        amount: resolution.amount,
        payoutTime: existingReferenceBucket.payoutTime,
        isModified: Boolean(resolution.isModified),
      }
    : null;
  if (existingReferenceBucket) {
    return {
      ...resolution,
      characterID,
      solarSystemID,
      payoutAtMs: existingReferenceBucket.payoutAtMs,
      payoutTime: existingReferenceBucket.payoutTime,
      bucketKey: existingReferenceBucket.key,
      notification: existingPayload,
      alreadyRecorded: true,
      securityStatusRecovery: null,
    };
  }

  const bucket = getOrCreateBucket(characterID, solarSystemID, payoutAtMs);
  addToBucket(bucket, {
    amount: resolution.amount,
    enemyTypeID,
    referenceID,
  });
  persistBuckets();

  const payload = {
    enemyTypeID,
    amount: resolution.amount,
    payoutTime: bucket.payoutTime,
    isModified: Boolean(resolution.isModified),
  };
  notifyBountyAdded(characterID, payload);
  const securityStatusRecovery = applySecurityStatusRecovery(
    characterID,
    victimEntity,
    finalAttacker,
    resolution,
    context,
  );

  return {
    ...resolution,
    characterID,
    solarSystemID,
    payoutAtMs,
    payoutTime: bucket.payoutTime,
    bucketKey: bucket.key,
    notification: payload,
    securityStatusRecovery,
  };
}

function buildWalletDescription(bucket) {
  const npcTypeLines = Object.entries(bucket.npcTypes || {})
    .map(([typeID, count]) => [
      toPositiveInt(typeID, 0) || 0,
      Math.max(0, toInt(count, 0)),
    ])
    .filter(([typeID, count]) => typeID > 0 && count > 0)
    .sort((left, right) => left[0] - right[0])
    .map(([typeID, count]) => `  ${typeID}: ${count}`);

  const lines = ["NBL:"];
  if (npcTypeLines.length > 0) {
    lines.push(...npcTypeLines);
  } else {
    lines[0] = "NBL: {}";
  }
  lines.push(`solarSystemID: ${toPositiveInt(bucket.solarSystemID, 0) || 0}`);
  lines.push(`kills: ${Math.max(0, toInt(bucket.kills, 0))}`);
  return lines.join("\n");
}

function resolveSingleVictimTypeID(bucket) {
  const entries = Object.entries(bucket && bucket.npcTypes || {})
    .map(([typeID, count]) => [
      toPositiveInt(typeID, 0) || 0,
      Math.max(0, toInt(count, 0)),
    ])
    .filter(([typeID, count]) => typeID > 0 && count > 0);
  return entries.length === 1 && entries[0][1] === 1 ? entries[0][0] : null;
}

function resolveBountyJournalReferenceID(bucket) {
  if (Math.max(0, toInt(bucket && bucket.kills, 0)) <= 1) {
    return (
      resolveSingleVictimTypeID(bucket) ||
      toPositiveInt(bucket && bucket.sourceReferences && bucket.sourceReferences[0], 0) ||
      -1
    );
  }
  return (
    toPositiveInt(bucket && bucket.solarSystemID, 0) ||
    toPositiveInt(bucket && bucket.sourceReferences && bucket.sourceReferences[0], 0) ||
    -1
  );
}

function payoutBucket(bucket) {
  if (!bucket || !(bucket.amount > 0) || !(bucket.characterID > 0)) {
    return {
      success: false,
      errorMsg: "INVALID_BOUNTY_BUCKET",
    };
  }

  return adjustCharacterBalance(bucket.characterID, bucket.amount, {
    entryTypeID: bucket.kills > 1
      ? JOURNAL_ENTRY_TYPE.NPC_BOUNTY_PRIZES
      : JOURNAL_ENTRY_TYPE.NPC_BOUNTY_PRIZE,
    description: buildWalletDescription(bucket),
    ownerID1: bucket.characterID,
    ownerID2: bucket.characterID,
    referenceID: resolveBountyJournalReferenceID(bucket),
  });
}

function flushDuePayouts(nowMs = nowProvider()) {
  ensureLoaded();
  if (nowMs < nextDueAtMs) {
    return {
      flushed: 0,
      amount: 0,
      due: false,
    };
  }

  let flushed = 0;
  let amount = 0;
  let mutated = false;
  const results = [];
  for (const [key, bucket] of bucketsByKey.entries()) {
    if (bucket.payoutAtMs > nowMs) {
      continue;
    }
    let result;
    try {
      result = payoutBucket(bucket);
    } catch (error) {
      result = { success: false, errorMsg: error && error.message ? error.message : "PAYOUT_THREW" };
    }
    results.push({
      key,
      result,
      amount: bucket.amount,
      kills: bucket.kills,
    });
    if (result && result.success === true) {
      // Only drop the pending entry once the credit is confirmed. A failed
      // payout (or a thrown error) leaves the bucket in place to retry on the
      // next tick instead of silently destroying the ISK.
      bucketsByKey.delete(key);
      mutated = true;
      flushed += 1;
      amount = normalizeMoney(amount + bucket.amount, 0);
    }
  }

  if (mutated) {
    persistBuckets();
  }
  refreshNextDueAt();
  scheduleTimer();
  return {
    flushed,
    amount,
    due: true,
    results,
  };
}

function tickScene(_scene, _nowMs) {
  // Driven from the space-runtime scene tick so payouts do not depend solely on
  // a single in-process timer. Wall-clock based so it stays correct across
  // restarts and regardless of the scene's sim clock.
  return flushDuePayouts(nowProvider());
}

function listPendingBuckets() {
  ensureLoaded();
  return Array.from(bucketsByKey.values()).map((bucket) => ({
    ...bucket,
    npcTypes: { ...bucket.npcTypes },
    sourceReferences: [...bucket.sourceReferences],
  }));
}

function resetForTests() {
  clearTimer();
  bucketsByKey.clear();
  payoutIntervalMs = DEFAULT_PAYOUT_INTERVAL_MS;
  nowProvider = () => Date.now();
  timerEnabled = true;
  nextDueAtMs = Number.POSITIVE_INFINITY;
  // Tests opt into persistence explicitly so the default in-memory suites do
  // not read or write the shared pendingNpcBounties table.
  persistenceEnabled = false;
  persistenceLoaded = true;
}

function configureForTests(options = {}) {
  if (Number.isFinite(Number(options.payoutIntervalMs))) {
    payoutIntervalMs = Math.max(1, Math.trunc(Number(options.payoutIntervalMs)));
  }
  if (typeof options.nowProvider === "function") {
    nowProvider = options.nowProvider;
  }
  if (options.timerEnabled !== undefined) {
    timerEnabled = options.timerEnabled === true;
  }
  if (options.persistenceEnabled !== undefined) {
    persistenceEnabled = options.persistenceEnabled === true;
    // Force a reload from the table the next time it is needed.
    persistenceLoaded = !persistenceEnabled;
  }
  scheduleTimer();
}

function benchmarkAccrual(count = 1000) {
  resetForTests();
  configureForTests({
    timerEnabled: false,
    nowProvider: () => 1_000,
    payoutIntervalMs: DEFAULT_PAYOUT_INTERVAL_MS,
  });
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    recordNpcBountyKill(
      {
        itemID: 90_000_000 + index,
        typeID: 16994,
        bounty: 1000,
        systemID: 30000142,
      },
      {
        characterID: 99_000_001,
      },
      {
        nowMs: 1_000,
      },
    );
  }
  return {
    count,
    elapsedMs: performance.now() - started,
    pendingBuckets: bucketsByKey.size,
  };
}

function benchmarkBucketAggregation(count = 1000) {
  resetForTests();
  configureForTests({
    timerEnabled: false,
    nowProvider: () => 1_000,
    payoutIntervalMs: DEFAULT_PAYOUT_INTERVAL_MS,
  });
  const bucket = getOrCreateBucket(99_000_001, 30000142, resolvePayoutAtMs(1_000));
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    addToBucket(bucket, {
      amount: 1000,
      enemyTypeID: 16994,
      referenceID: 90_000_000 + index,
    });
  }
  return {
    count,
    elapsedMs: performance.now() - started,
    pendingBuckets: bucketsByKey.size,
    amount: bucket.amount,
  };
}

module.exports = {
  DEFAULT_PAYOUT_INTERVAL_MS,
  PENDING_TABLE_NAME,
  formatFiletime,
  resolvePayoutAtMs,
  resolveNpcBountyAmount,
  recordNpcBountyKill,
  flushDuePayouts,
  tickScene,
  listPendingBuckets,
  benchmarkAccrual,
  benchmarkBucketAggregation,
  _testing: {
    resetForTests,
    configureForTests,
    buildBucketKey,
    buildWalletDescription,
    loadPersistedBuckets,
    persistBuckets,
  },
};
