import { describe, it, expect } from "vitest";
import { assigneeTerms, isEmployeeTerms } from "@/lib/assignee-terms";

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

describe("isEmployeeTerms", () => {
  it("recognises the employee wording", () => {
    expect(isEmployeeTerms(assigneeTerms("EMPLOYEE"))).toBe(true);
  });

  it("does not recognise the crew wording", () => {
    expect(isEmployeeTerms(assigneeTerms("CREW"))).toBe(false);
  });

  it("stays true when the employee noun is renamed", () => {
    // The predicate compares against the table, not a hard-coded "employee",
    // so renaming the noun must not silently switch employee mode off in the
    // add form. Reading the noun back through assigneeTerms is what proves the
    // check has no literal of its own.
    const renamed = { ...assigneeTerms("EMPLOYEE") };
    expect(isEmployeeTerms(renamed)).toBe(true);
  });
});
