import { describe, it, expect } from "vitest";
import {
  addMonths,
  earliestEarlyResume,
  parseResumeDate,
  resumeDateLimits,
} from "./pause-window";

const now = new Date("2026-10-23T15:00:00Z");

describe("pause window", () => {
  it("clamps month arithmetic to the end of the month", () => {
    expect(addMonths(new Date("2027-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("offers one to six months out", () => {
    expect(resumeDateLimits(now)).toEqual({ min: "2026-11-23", max: "2027-04-23" });
  });

  it("accepts the boundaries and rejects anything outside them", () => {
    expect(parseResumeDate("2026-11-23", now)?.toISOString()).toBe(
      "2026-11-23T00:00:00.000Z",
    );
    expect(parseResumeDate("2027-04-23", now)).not.toBeNull();
    expect(parseResumeDate("2026-11-22", now)).toBeNull();
    expect(parseResumeDate("2027-04-24", now)).toBeNull();
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseResumeDate("2027-02-30", now)).toBeNull();
    expect(parseResumeDate("next spring", now)).toBeNull();
    expect(parseResumeDate("", now)).toBeNull();
  });

  it("holds an early resume back for a month", () => {
    expect(earliestEarlyResume(now).toISOString()).toBe("2026-11-23T15:00:00.000Z");
  });
});
