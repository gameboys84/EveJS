"use strict";

/**
 * DOGMA INVALIDATION VERSION (zero-dependency leaf):
 *
 * A single global monotonic counter bumped ONLY on changes that affect dogma
 * attribute resolution — fitting (fit/unfit, online/offline, charge load/unload,
 * mutaplasmid/abyssal mutation), implants (plug/unplug/swap/pod-death), and
 * boosters (inject/expiry). It is deliberately NOT bumped by routine item writes
 * such as drone/NPC state persistence.
 *
 * Purpose: the dogma context fingerprint (droneDogma.buildControllerDogmaFinger-
 * print) currently embeds the GLOBAL itemMutationVersion (itemStore), which the
 * drones' own per-tick state writes bump — defeating the cross-tick context
 * cache. Keying the fingerprint on this dogma-scoped counter instead (composed
 * with the existing skill + expert-system counters) lets the context hold across
 * ticks and only rebuild on a real refit/skill/implant/booster change.
 *
 * This module has NO requires so any mutation site (itemStore, boosterRuntime,
 * implantRuntime, ...) can import it without a circular dependency. Coarse on
 * purpose: any character's dogma change bumps it for everyone — acceptable
 * because such changes are rare relative to the 10 Hz tick and the post-cache
 * rebuild is cheap.
 */

let version = 1;

function bumpDogmaInvalidationVersion() {
  version += 1;
}

function getDogmaInvalidationVersion() {
  return version;
}

module.exports = {
  bumpDogmaInvalidationVersion,
  getDogmaInvalidationVersion,
};
