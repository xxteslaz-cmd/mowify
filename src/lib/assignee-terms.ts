import type { AssigneeMode } from "@prisma/client";

/**
 * The noun a company uses for the thing work is assigned to.
 *
 * Kept as a single source rather than ternaries at each call site: this
 * wording appears in seventeen places, and scattering it makes it impossible
 * to change in one edit or to verify it is consistent.
 */
export type AssigneeTerms = {
  one: string;
  many: string;
  One: string;
  Many: string;
};

const TERMS: Record<AssigneeMode, AssigneeTerms> = {
  CREW: { one: "crew", many: "crews", One: "Crew", Many: "Crews" },
  EMPLOYEE: {
    one: "employee",
    many: "employees",
    One: "Employee",
    Many: "Employees",
  },
};

export function assigneeTerms(mode: AssigneeMode): AssigneeTerms {
  // Fall back rather than index blindly: an enum value added later should
  // show the existing wording, not render "undefined" at a customer.
  return TERMS[mode] ?? TERMS.CREW;
}

/**
 * Whether these terms are the employee wording.
 *
 * Compared against the table rather than a bare "employee" literal at the call
 * site: the whole point of this module is that the noun lives in one place, and
 * a literal elsewhere would silently stop matching the day the wording changes.
 */
export function isEmployeeTerms(terms: AssigneeTerms): boolean {
  return terms.one === TERMS.EMPLOYEE.one;
}
