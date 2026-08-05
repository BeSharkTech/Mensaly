import { describe, expect, it } from "vitest";

import { filterBillableStudents, toggleVisibleStudentSelection } from "./billing-selection";

const students = [
  { id: "a", status: "ACTIVE", enrollmentId: "ea", planId: "plan-a" },
  { id: "b", status: "ACTIVE", enrollmentId: "eb", planId: "plan-b" },
  { id: "c", status: "INACTIVE", enrollmentId: "ec", planId: "plan-a" },
  { id: "d", status: "ACTIVE", enrollmentId: null, planId: "plan-a" },
];

describe("billing student selection", () => {
  it("shows only active enrolled students from the selected plan", () => {
    expect(filterBillableStudents(students, "plan-a").map(({ id }) => id)).toEqual(["a"]);
    expect(filterBillableStudents(students, "ALL").map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("selects and clears only students visible through the current filter", () => {
    expect(toggleVisibleStudentSelection(["b"], ["a"], true)).toEqual(["b", "a"]);
    expect(toggleVisibleStudentSelection(["a", "b"], ["a"], false)).toEqual(["b"]);
  });
});
