// SFU letter-grade → grade-point mapping (4.33 scale) and the tunable
// thresholds used by transcript-driven recommendations. Kept as named
// constants so grade/GPA cutoffs are never magic numbers scattered in logic.
//
// Assumption: the transcript parser only captures letter grades (A–F, with
// optional +/-), so all downstream GPA math derives from letters via this map,
// not from the numeric grade_points column (which is dropped before the store).

export const GRADE_POINTS: Record<string, number> = {
  "A+": 4.33,
  A: 4.0,
  "A-": 3.67,
  "B+": 3.33,
  B: 3.0,
  "B-": 2.67,
  "C+": 2.33,
  C: 2.0,
  "C-": 1.67,
  "D+": 1.33,
  D: 1.0,
  "D-": 0.67,
  F: 0.0,
};

// GPA thresholds for credit-load tiers and subject aversion.
export const LOW_GPA = 2.0; // below this = struggling → lighter load
export const HIGH_GPA = 3.0; // at/above this = can handle a heavier load
export const AVERSION_GPA_THRESHOLD = 2.0; // avg dept GPA below C → averse

// Credit-load tiers mapped to the loads the UI offers.
export const CREDITS_LIGHT = 9;
export const CREDITS_NORMAL = 12;
export const CREDITS_HEAVY = 15;

// Convert a letter grade to grade points, or null if it isn't a graded,
// GPA-affecting letter (e.g. "N", "W", "P" — which the parser already skips).
export function gradeToPoints(grade: string | undefined | null): number | null {
  if (!grade) return null;
  const key = grade.trim().toUpperCase();
  return key in GRADE_POINTS ? GRADE_POINTS[key] : null;
}

// A failing grade for aversion purposes (SFU: F = 0.0).
export function isFailing(grade: string | undefined | null): boolean {
  return gradeToPoints(grade) === 0;
}
