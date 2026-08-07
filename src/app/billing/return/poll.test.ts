import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startPolling, POLL_MS, GIVE_UP_MS } from "./poll";
import type { ClaimState } from "./actions";

describe("startPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps polling after claim() rejects instead of dying silently", async () => {
    // This is the actual bug that shipped: poll() had no try/catch around
    // the await, so one rejected call (a network blip, a mid-poll deploy, a
    // transient 500) ended the chain forever. Someone who had just been
    // charged would sit on "Confirming your payment" with nothing to click,
    // because the give-up branch that would have shown a recovery link lived
    // inside the same call the rejection skipped.
    let calls = 0;
    const claim = vi.fn(async (): Promise<ClaimState> => {
      calls += 1;
      if (calls === 1) throw new Error("network blip");
      return { status: "pending" };
    });
    const onState = vi.fn();

    startPolling(claim, { onState, onReady: vi.fn(), onTimeout: vi.fn() });

    await vi.advanceTimersByTimeAsync(0); // flush the first, rejecting call
    expect(calls).toBe(1);
    expect(onState).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_MS); // the retry the rejection must still schedule
    expect(calls).toBe(2);
    expect(onState).toHaveBeenCalledWith({ status: "pending" });
  });

  it("gives up after the deadline instead of polling forever", async () => {
    const claim = vi.fn(async (): Promise<ClaimState> => ({ status: "pending" }));
    const onTimeout = vi.fn();

    startPolling(claim, { onState: vi.fn(), onReady: vi.fn(), onTimeout });

    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + POLL_MS);

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("reaches the give-up deadline even when every attempt is a rejection", async () => {
    // The regression this whole fix targets: before it, a run of rejections
    // never reached the timeout branch at all, because that branch lived
    // inside the same code path the missing try/catch skipped.
    const claim = vi.fn(async (): Promise<ClaimState> => {
      throw new Error("still down");
    });
    const onTimeout = vi.fn();

    startPolling(claim, { onState: vi.fn(), onReady: vi.fn(), onTimeout });

    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + POLL_MS);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls.length).toBeGreaterThan(1);
  });

  it("stops scheduling further polls once cancelled", async () => {
    const claim = vi.fn(async (): Promise<ClaimState> => ({ status: "pending" }));
    const stop = startPolling(claim, {
      onState: vi.fn(),
      onReady: vi.fn(),
      onTimeout: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeCancel = claim.mock.calls.length;
    stop();

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(claim.mock.calls.length).toBe(callsBeforeCancel);
  });

  it("calls onReady and stops polling once the claim succeeds", async () => {
    const claim = vi.fn(async (): Promise<ClaimState> => ({ status: "ready" }));
    const onReady = vi.fn();

    startPolling(claim, { onState: vi.fn(), onReady, onTimeout: vi.fn() });

    await vi.advanceTimersByTimeAsync(0);
    expect(onReady).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("stops polling on a failed state without ever calling onTimeout", async () => {
    const claim = vi.fn(async (): Promise<ClaimState> => ({
      status: "failed",
      reason: "unknown",
    }));
    const onTimeout = vi.fn();

    startPolling(claim, { onState: vi.fn(), onReady: vi.fn(), onTimeout });

    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + POLL_MS);

    expect(claim).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
