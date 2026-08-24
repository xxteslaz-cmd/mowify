import { describe, it, expect } from "vitest";
import { assigneeTerms } from "@/lib/assignee-terms";

describe("assigneeTerms", () => {
  it("uses crew wording in CREW mode", () => {
    expect(assigneeTerms("CREW")).toEqual({
      one: "crew",
      many: "crews",
      One: "Crew",
      Many: "Crews",
    });
  });

  it("uses employee wording in EMPLOYEE mode", () => {
    expect(assigneeTerms("EMPLOYEE")).toEqual({
      one: "employee",
      many: "employees",
      One: "Employee",
      Many: "Employees",
    });
  });

  it("falls back to crew wording for an unrecognised mode", () => {
    // Fail closed to the default the schema declares, so a future enum value
    // shows the existing wording rather than rendering "undefined" at users.
    expect(assigneeTerms("SOMETHING_ELSE" as never).One).toBe("Crew");
  });
});
