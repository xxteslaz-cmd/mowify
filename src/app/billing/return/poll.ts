import type { ClaimState } from "./actions";

export const POLL_MS = 1_500;
export const GIVE_UP_MS = 60_000;

export type PollCallbacks = {
  onState: (state: ClaimState) => void;
  onReady: () => void;
  onTimeout: () => void;
};

/**
 * Drives the claimAccount poll loop as a plain function rather than inline
 * inside the component's effect, so its retry-on-failure and give-up
 * behaviour can be unit tested with fake timers — this repo has no
 * DOM-rendering test infrastructure (no jsdom or @testing-library/react
 * anywhere in the tree), and standing one up for a single effect is a bigger
 * call than this fix warrants.
 *
 * A rejected `claim()` call — a network blip, a mid-poll deploy, a transient
 * 500 — is treated exactly like a "pending" result: logged and retried on
 * the same schedule, never fatal. The alternative, letting the rejection end
 * the chain silently, is the bug this function exists to fix: someone who
 * has just been charged would be stranded on "confirming your payment"
 * forever, with the give-up affordance never reachable because it lived
 * inside the same branch the rejection skipped.
 *
 * Returns a cancel function; the caller (the effect) invokes it on cleanup so
 * a poll in flight when the component unmounts does not call back into a
 * component that is gone.
 */
export function startPolling(
  claim: () => Promise<ClaimState>,
  callbacks: PollCallbacks,
  now: () => number = Date.now,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
    setTimeout(fn, ms);
  },
): () => void {
  let cancelled = false;
  const startedAt = now();

  function scheduleNextOrGiveUp() {
    if (cancelled) return;
    if (now() - startedAt > GIVE_UP_MS) {
      callbacks.onTimeout();
      return;
    }
    schedule(poll, POLL_MS);
  }

  async function poll() {
    if (cancelled) return;

    let state: ClaimState | undefined;
    try {
      state = await claim();
    } catch (err) {
      console.error(
        "claimAccount failed, will retry:",
        err instanceof Error ? err.message : String(err),
      );
    }
    if (cancelled) return;

    if (state) {
      callbacks.onState(state);

      if (state.status === "ready") {
        callbacks.onReady();
        return;
      }

      if (state.status === "failed") return;
    }

    scheduleNextOrGiveUp();
  }

  poll();

  return () => {
    cancelled = true;
  };
}
