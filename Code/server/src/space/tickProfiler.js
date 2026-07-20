"use strict";

/**
 * TICK PROFILER (opt-in):
 *
 * Per-subsystem timing for the 10 Hz space tick. The runtime already tracks
 * per-SCENE tick cost (scene._lastTickWorkMs); this adds the per-SUBSYSTEM
 * breakdown WITHIN a scene tick (npc/drone/fighter/mining/...), so a live-load
 * run reveals which subsystem actually dominates the combat tick — the data
 * that should drive the rest of the scaling work.
 *
 * Enable with EVEJS_TICK_PROFILE=1 (default off → section() is a pass-through
 * with a single boolean check, no measurable overhead). Tune the log cadence
 * with EVEJS_TICK_PROFILE_EVERY (runtime ticks per report; default 100 ≈ 10s).
 *
 * Usage:
 *   tickProfiler.section("npc", () => npcService.tickScene(scene, now));   // per subsystem
 *   tickProfiler.tickBoundary();                                           // once per runtime tick
 */

const log = require("../utils/logger");

const ENABLED = process.env.EVEJS_TICK_PROFILE === "1";
const LOG_EVERY_TICKS = Math.max(1, Number(process.env.EVEJS_TICK_PROFILE_EVERY) || 100);

const totals = new Map(); // label → { totalMs, calls }
let tickCount = 0;
let sceneTotalMs = 0; // sum of full per-scene tick cost across the window

function isEnabled() {
  return ENABLED;
}

// Record the full cost of one scene's tick (the runtime already measures this).
// The breakdown derives an "other" bucket = sceneTotal − instrumented sections,
// which is the inline movement/combat/destiny work not wrapped in section().
function recordSceneTotal(ms) {
  if (!ENABLED) {
    return;
  }
  sceneTotalMs += Math.max(0, Number(ms) || 0);
}

// Time fn() under `label` and accumulate. When disabled, calls fn() directly so
// the wrapped call sites are behavior- and cost-neutral.
function section(label, fn) {
  if (!ENABLED) {
    return fn();
  }
  const start = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    let entry = totals.get(label);
    if (!entry) {
      entry = { totalMs: 0, calls: 0 };
      totals.set(label, entry);
    }
    entry.totalMs += elapsedMs;
    entry.calls += 1;
  }
}

// Inline phase timing for large blocks that cannot be wrapped in a section()
// closure without rewriting control flow (e.g. the multi-hundred-line per-entity
// movement/destiny loop). Usage:
//   const t = tickProfiler.now();
//   ...phase work...
//   tickProfiler.add("mv.entityLoop", t);
// No-ops (and returns a cheap sentinel) when disabled, so call sites stay
// behavior- and cost-neutral.
function now() {
  return ENABLED ? process.hrtime.bigint() : 0n;
}

function add(label, startBigint) {
  if (!ENABLED) {
    return;
  }
  const elapsedMs = Number(process.hrtime.bigint() - startBigint) / 1e6;
  let entry = totals.get(label);
  if (!entry) {
    entry = { totalMs: 0, calls: 0 };
    totals.set(label, entry);
  }
  entry.totalMs += elapsedMs;
  entry.calls += 1;
}

// Call once per runtime tick. Every LOG_EVERY_TICKS ticks it logs the
// accumulated breakdown for that window and resets.
function tickBoundary() {
  if (!ENABLED) {
    return;
  }
  tickCount += 1;
  if (tickCount < LOG_EVERY_TICKS) {
    return;
  }
  logBreakdown();
  totals.clear();
  tickCount = 0;
  sceneTotalMs = 0;
}

function logBreakdown() {
  const rows = [...totals.entries()]
    .map(([label, entry]) => ({ label, totalMs: entry.totalMs, calls: entry.calls }))
    .sort((left, right) => right.totalMs - left.totalMs);
  if (rows.length === 0 && sceneTotalMs <= 0) {
    return;
  }
  const instrumentedTotal = rows.reduce((sum, row) => sum + row.totalMs, 0);
  // "other" = the inline movement/combat/destiny/visibility work in the scene
  // tick that isn't wrapped in a section(). Denominator is the real scene-tick
  // cost when we have it, else just the instrumented sum.
  if (sceneTotalMs > 0) {
    rows.push({ label: "other(movement/destiny)", totalMs: Math.max(0, sceneTotalMs - instrumentedTotal), calls: 0 });
    rows.sort((left, right) => right.totalMs - left.totalMs);
  }
  const haveSceneTotal = sceneTotalMs > 0;
  const grandTotal = haveSceneTotal ? sceneTotalMs : instrumentedTotal;
  const lines = rows.map((row) => {
    const msPerTick = (row.totalMs / tickCount).toFixed(3);
    const pct = grandTotal > 0 ? ((row.totalMs / grandTotal) * 100).toFixed(1) : "0.0";
    const callNote = row.calls > 0 ? `${row.calls} calls / ${tickCount} ticks` : `${tickCount} ticks`;
    return `  ${row.label.padEnd(24)} ${String(msPerTick).padStart(8)} ms/tick ${pct.padStart(5)}%  (${callNote})`;
  });
  const totalLabel = haveSceneTotal ? "total scene work" : "instrumented subsystems";
  log.info(
    `[TickProfile] last ${tickCount} ticks — ${(grandTotal / tickCount).toFixed(3)} ms/tick ${totalLabel} (sum across loaded scenes):\n${lines.join("\n")}`,
  );
}

module.exports = { isEnabled, section, now, add, recordSceneTotal, tickBoundary };
