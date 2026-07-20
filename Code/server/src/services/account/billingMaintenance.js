const path = require("path");

const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  processDueOfficeRentalBills,
} = require(path.join(__dirname, "../corporation/officeRentalBilling"));

const DEFAULT_OFFICE_RENTAL_MAX_CYCLES = 24;

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(numericValue));
}

function accumulateActionCounts(actionCounts, processed = []) {
  for (const entry of Array.isArray(processed) ? processed : []) {
    const action = entry && typeof entry.action === "string" ? entry.action : "unknown";
    actionCounts[action] = Number(actionCounts[action] || 0) + 1;
  }
}

function runDueOfficeRentalBillingCatchup(options = {}) {
  const nowFileTime = options.nowFileTime || currentFileTime();
  const maxCycles = normalizePositiveInteger(
    options.maxCycles,
    DEFAULT_OFFICE_RENTAL_MAX_CYCLES,
  );
  const cycles = [];
  const actionCounts = {};
  let processedCount = 0;
  let capped = false;

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const result = processDueOfficeRentalBills({
      ...options,
      nowFileTime,
    });
    const cycleProcessed = Number(result && result.processedCount) || 0;
    if (cycleProcessed <= 0) {
      break;
    }

    processedCount += cycleProcessed;
    accumulateActionCounts(actionCounts, result.processed);
    cycles.push({
      cycle,
      processedCount: cycleProcessed,
      processed: result.processed || [],
    });

    if (cycle === maxCycles) {
      capped = true;
    }
  }

  return {
    nowFileTime: String(nowFileTime),
    maxCycles,
    capped,
    cycleCount: cycles.length,
    processedCount,
    actionCounts,
    cycles,
  };
}

function runStartupBillingMaintenance(options = {}) {
  const startedAtMs = Date.now();
  const nowFileTime = options.nowFileTime || currentFileTime();
  const officeRental = runDueOfficeRentalBillingCatchup({
    ...options,
    reason: options.reason || "startup",
    nowFileTime,
    maxCycles: options.officeRentalMaxCycles || options.maxCycles,
  });

  return {
    success: true,
    reason: options.reason || "startup",
    nowFileTime: String(nowFileTime),
    elapsedMs: Date.now() - startedAtMs,
    officeRental,
  };
}

module.exports = {
  DEFAULT_OFFICE_RENTAL_MAX_CYCLES,
  runDueOfficeRentalBillingCatchup,
  runStartupBillingMaintenance,
};
