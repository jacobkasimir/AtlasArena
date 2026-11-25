// History bookkeeping shared by the phone overlays (BottomSheet's useBackToClose) and the round guard
// (useBackGuard). Both add same-URL history entries so the device Back button / gesture can be handled in the
// page; this module makes sure the entries they add are removed again exactly once.
import { useCallback, useEffect, useId, useRef, useState } from "react";

type HistoryState = Record<string, unknown>;

const DEPTH_KEY = "phoneDepth";
const GUARD_KEY = "phoneBackGuard";
/** If a history.go() of ours never reports back, stop waiting for it after this long. */
const SETTLE_FALLBACK_MS = 600;

// history.go() calls we make ourselves must not count as the player's Back. A listener registered at module
// load runs before every component listener and marks those pops as ours. Our pops are coalesced and sent one
// at a time: browsers differ in whether a second history.go() queued behind the first counts from the old or
// the new entry, so there is never more than one of ours on its way.
let inFlight = 0; // entries the history.go() on its way removes
let queued = 0; // entries to remove once it has landed
let flushScheduled = false;
let fallbackTimer: number | undefined;
let currentPopIsOwn = false;
const settleWaiters = new Set<() => void>();

function pendingDepth() {
  return inFlight + queued;
}

function flush() {
  flushScheduled = false;
  if (inFlight || !queued) return;
  inFlight = queued;
  queued = 0;
  // If the pop never arrives (some browsers drop it while the page is hidden), stop waiting for it.
  fallbackTimer = window.setTimeout(landed, SETTLE_FALLBACK_MS);
  window.history.go(-inFlight);
}

function landed() {
  window.clearTimeout(fallbackTimer);
  inFlight = 0;
  if (queued) flush();
  if (pendingDepth() === 0 && settleWaiters.size) {
    const waiters = [...settleWaiters];
    settleWaiters.clear();
    // After this event: the router's own popstate listener sees the restored entry first.
    window.setTimeout(() => waiters.forEach((run) => run()), 0);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    currentPopIsOwn = inFlight > 0;
    if (currentPopIsOwn) landed();
  });
}

function readState(): HistoryState {
  const state = window.history.state as unknown;
  return state && typeof state === "object" ? (state as HistoryState) : {};
}

/** True while the current popstate event was caused by one of our own history.go() calls. */
export function isOwnPop(): boolean {
  return currentPopIsOwn;
}

/** How many of our entries are above the router's entry, once our pending back navigations have landed. */
export function settledDepth(): number {
  const depth = readState()[DEPTH_KEY];
  return Math.max(0, (typeof depth === "number" ? depth : 0) - pendingDepth());
}

/** Adds one same-URL entry (router state kept) and returns its depth. */
export function pushOwnEntry(extra: HistoryState): number {
  const depth = settledDepth() + 1;
  window.history.pushState({ ...readState(), ...extra, [DEPTH_KEY]: depth }, "");
  return depth;
}

/** Removes `count` of our entries (marked as our own; calls in the same task become one history.go()). */
export function popOwnEntries(count: number) {
  if (count <= 0) return;
  queued += count;
  if (flushScheduled || inFlight) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

/** Runs `then` once no back navigation of ours is still on its way (at once if none is). */
function whenSettled(then: () => void) {
  if (pendingDepth() === 0) then();
  else settleWaiters.add(then);
}

/**
 * Like whenSettled, for adding entries: a pushState while one of our pops is on its way would cancel that pop
 * in some engines. Returns a function that cancels a push that hasn't happened yet.
 */
export function afterOwnPops(run: () => void): () => void {
  if (pendingDepth() === 0) {
    run();
    return () => undefined;
  }
  settleWaiters.add(run);
  return () => settleWaiters.delete(run);
}

export type BackGuard = {
  /**
   * Leave the round on purpose: removes the guard's entry (and an open sheet's) from history, then runs `then`
   * (usually `navigate(target, { replace: true })`, so the round's entry becomes the target and Back goes to
   * where the player was before the round). Calls after the first one are ignored, so a double tap or Back
   * pressed at the same time can't navigate twice.
   */
  release: (then: () => void) => void;
  /** True once `release` was called: disable the sheet's actions. */
  releasing: boolean;
};

/**
 * While `active` (a round is running), the device Back button, Back key or iOS swipe-back doesn't leave the
 * page: one same-URL "sentinel" entry is added, and when Back removes it the sentinel is put back and
 * `onBack` runs (open the round's "Pause or leave" sheet). Sheets above the sentinel close with Back as usual.
 *
 * When the round ends (`active` turns false) or the screen unmounts, the sentinel is removed again. Navigate
 * away from a guarded screen only through `release(() => navigate(...))`, so no stale entry stays behind.
 */
export function useBackGuard(active: boolean, onBack: () => void): BackGuard {
  const callback = useRef(onBack);
  callback.current = onBack;
  const marker = useId();
  const control = useRef<{ base: number; url: string; releasing: boolean; timer?: number }>({
    base: 0,
    url: "",
    releasing: false,
  });
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const c = control.current;
    if (c.releasing) return;
    // StrictMode runs effect → cleanup → effect: the deferred removal below is cancelled and the sentinel kept.
    window.clearTimeout(c.timer);
    c.timer = undefined;
    const onGuard = () => readState()[GUARD_KEY] === marker;
    let cancelPush: () => void = () => undefined;
    const pushSentinel = () => {
      cancelPush = afterOwnPops(() => {
        if (c.releasing || onGuard()) return;
        c.base = pushOwnEntry({ [GUARD_KEY]: marker }) - 1;
        c.url = window.location.href;
      });
    };
    if (!onGuard()) pushSentinel();

    const onPop = () => {
      if (c.releasing || isOwnPop() || onGuard()) return; // ours, or a sheet above the sentinel closed
      // Back went further than this page (history jump): let it go.
      if (window.location.href !== c.url) return;
      pushSentinel();
      callback.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      cancelPush();
      window.removeEventListener("popstate", onPop);
      if (c.releasing) return;
      c.timer = window.setTimeout(() => {
        c.timer = undefined;
        if (onGuard()) popOwnEntries(settledDepth() - c.base);
      }, 0);
    };
  }, [active, marker]);

  const release = useCallback(
    (then: () => void) => {
      const c = control.current;
      if (c.releasing) return;
      c.releasing = true;
      setReleasing(true);
      window.clearTimeout(c.timer);
      c.timer = undefined;
      if (readState()[GUARD_KEY] === marker) popOwnEntries(settledDepth() - c.base);
      whenSettled(then);
    },
    [marker],
  );

  return { release, releasing };
}
