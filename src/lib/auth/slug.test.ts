import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Lawn Care")).toBe("acme-lawn-care");
  });

  it("strips punctuation", () => {
    expect(slugify("Bob's Mowing, LLC.")).toBe("bobs-mowing-llc");
  });

  it("collapses repeated separators", () => {
    expect(slugify("Green   &   Clean")).toBe("green-clean");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  !Yard Guys!  ")).toBe("yard-guys");
  });

  it("falls back when a name has no usable characters", () => {
    expect(slugify("!!!")).toBe("company");
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug when it is free", async () => {
    expect(await uniqueSlug("Acme Lawn", async () => false)).toBe("acme-lawn");
  });

  it("appends a counter when taken", async () => {
    const taken = new Set(["acme-lawn", "acme-lawn-2"]);
    expect(await uniqueSlug("Acme Lawn", async (s) => taken.has(s))).toBe(
      "acme-lawn-3",
    );
  });
});
