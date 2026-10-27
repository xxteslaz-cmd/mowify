import { describe, it, expect, vi, afterEach } from "vitest";
import { getRainyDays } from "@/lib/weather";

afterEach(() => vi.unstubAllGlobals());

describe("getRainyDays", () => {
  it("returns only the days over the rain threshold", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        daily: {
          time: ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"],
          precipitation_probability_max: [10, 80, 20, null],
          precipitation_sum: [0, 1, 7, null],
        },
      }),
    );
    expect(await getRainyDays(40, -76, "2026-10-27", "2026-10-30")).toEqual([
      "2026-10-28",
      "2026-10-29",
    ]);
  });

  it("returns no days when the service fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    expect(await getRainyDays(40, -76, "2026-10-27", "2026-10-30")).toEqual([]);
  });
});
