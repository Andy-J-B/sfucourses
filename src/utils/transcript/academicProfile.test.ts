import { describe, it, expect } from "vitest";
import {
  computeGPA,
  detectAverseSubjects,
  recommendCreditLoad,
  subjectOf,
  CompletedCourseLike,
} from "./academicProfile";
import { inferMajor } from "../schedulerApi";

const c = (
  code: string,
  grade?: string,
  term = "Fall 2023",
  units_completed = 3
): CompletedCourseLike => ({ code, grade, term, units_completed });

describe("subjectOf", () => {
  it("extracts the department from a course code", () => {
    expect(subjectOf("PHIL 105")).toBe("PHIL");
    expect(subjectOf("cmpt 225")).toBe("CMPT");
  });
});

describe("computeGPA", () => {
  it("computes a units-weighted GPA from letter grades", () => {
    const gpa = computeGPA([
      c("CMPT 120", "A", "Fall 2023", 3), // 4.0 * 3
      c("MATH 100", "C", "Fall 2023", 4), // 2.0 * 4
    ]);
    expect(gpa).toBeCloseTo((4.0 * 3 + 2.0 * 4) / 7); // ≈ 2.857
  });

  it("returns null when there are no gradeable courses", () => {
    expect(computeGPA([c("CMPT 120", undefined)])).toBeNull();
    expect(computeGPA([])).toBeNull();
  });
});

describe("detectAverseSubjects", () => {
  it("flags a subject with a failing grade (generalized, not just PHIL)", () => {
    const averse = detectAverseSubjects([
      c("PHIL 100", "F"),
      c("CMPT 120", "A"),
    ]);
    expect(averse.has("PHIL")).toBe(true);
    expect(averse.has("CMPT")).toBe(false);
  });

  it("flags a subject with a sub-C average across passing grades", () => {
    const averse = detectAverseSubjects([
      c("CHEM 121", "D"), // 1.0
      c("CHEM 122", "C-"), // 1.67  -> avg 1.335 < 2.0
    ]);
    expect(averse.has("CHEM")).toBe(true);
  });

  it("does not flag a strong subject", () => {
    const averse = detectAverseSubjects([
      c("CMPT 120", "A"),
      c("CMPT 125", "B+"),
    ]);
    expect(averse.has("CMPT")).toBe(false);
  });
});

describe("recommendCreditLoad", () => {
  it("recommends a light load for a low GPA", () => {
    const rec = recommendCreditLoad([c("CMPT 120", "D"), c("MATH 100", "D")]);
    expect(rec?.tier).toBe("light");
    expect(rec?.credits).toBe(9);
  });

  it("recommends a normal load for a mid GPA", () => {
    const rec = recommendCreditLoad([c("CMPT 120", "B-"), c("MATH 100", "B-")]);
    expect(rec?.tier).toBe("normal");
    expect(rec?.credits).toBe(12);
  });

  it("recommends a heavy load for a high GPA", () => {
    const rec = recommendCreditLoad([c("CMPT 120", "A"), c("MATH 100", "A")]);
    expect(rec?.tier).toBe("heavy");
    expect(rec?.credits).toBe(15);
  });

  it("downshifts one tier after a poor recent term", () => {
    const rec = recommendCreditLoad([
      c("CMPT 120", "A", "Fall 2022"),
      c("CMPT 125", "A", "Fall 2022"),
      c("CMPT 225", "F", "Fall 2024"), // recent term tanks
    ]);
    // cumulative ≈ 2.67 (normal) but recent term GPA 0 → downshift to light.
    expect(rec?.tier).toBe("light");
  });

  it("returns null when GPA can't be computed", () => {
    expect(recommendCreditLoad([c("CMPT 120", undefined)])).toBeNull();
  });
});

describe("major detection regression (inferMajor)", () => {
  it("uses the explicit preference major when provided", () => {
    expect(inferMajor("bus", ["CMPT 225"], [])).toBe("BUS");
  });

  it("falls back to the most-taken department from completed courses", () => {
    expect(inferMajor("", ["CMPT 225", "CMPT 120", "MATH 100"], [])).toBe(
      "CMPT"
    );
  });

  it("uses anchors when there is no completed history", () => {
    expect(inferMajor("", [], ["PHIL 100"])).toBe("PHIL");
  });
});
