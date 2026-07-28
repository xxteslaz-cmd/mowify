import { describe, it, expect } from "vitest";
import {
  isLocked,
  nextLockoutState,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
} from "./lockout";

describe("isLocked", () => {
  it("is false when never locked", () => {
    expect(isLocked({ lockedUntil: null })).toBe(false);
  });

  it("is true while the lock is in the future", () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
  });

  it("is false once the lock has passed", () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() - 1) })).toBe(false);
  });
});

describe("nextLockoutState", () => {
  it("counts up without locking below the threshold", () => {
    const state = nextLockoutState(0);
    expect(state.failedAttempts).toBe(1);
    expect(state.lockedUntil).toBeNull();
  });

  it("locks at exactly the threshold", () => {
    const state = nextLockoutState(MAX_FAILED_ATTEMPTS - 1);
    expect(state.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(state.lockedUntil).not.toBeNull();
  });

  it("locks for the configured duration", () => {
    const state = nextLockoutState(MAX_FAILED_ATTEMPTS - 1);
    const ms = state.lockedUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(LOCKOUT_MS - 5_000);
    expect(ms).toBeLessThanOrEqual(LOCKOUT_MS);
  });

  it("does not lock at one attempt below the threshold", () => {
    expect(nextLockoutState(MAX_FAILED_ATTEMPTS - 2).lockedUntil).toBeNull();
  });
});
