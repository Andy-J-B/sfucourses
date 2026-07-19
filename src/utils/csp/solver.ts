import { SchedulerPreferences } from "@types";
import {
  CspAssignment,
  CspCourse,
  CspSectionValue,
  CspSolution,
  MinuteSlot,
} from "./types";
import { slotsConflict } from "./overlap";

const NODE_BUDGET = 2_000_000;
const SOLUTION_CAP = 400;

// The enrollable packages of a course that don't collide with the slots already
// committed by other courses. Association-valid combinations (lecture + its own
// tutorials/labs) are precomputed in the pool builder, so this is a simple
// forward-checking filter.
function courseAssignments(
  course: CspCourse,
  committed: MinuteSlot[]
): { values: CspSectionValue[]; slots: MinuteSlot[] }[] {
  const out: { values: CspSectionValue[]; slots: MinuteSlot[] }[] = [];
  for (const pkg of course.packages) {
    if (slotsConflict(pkg.slots, committed)) continue;
    out.push({ values: pkg.values, slots: pkg.slots });
  }
  return out;
}

// Order pool so anchors are decided first (mandatory), then electives (so the
// requested number gets pulled toward the credit target), then major
// requirements to fill the remainder. Within a role, best-rated first.
function orderCourses(courses: CspCourse[]): CspCourse[] {
  const roleRank = { anchor: 0, elective: 1, major: 2 } as const;
  return [...courses].sort((a, b) => {
    if (roleRank[a.role] !== roleRank[b.role]) {
      return roleRank[a.role] - roleRank[b.role];
    }
    return b.rmpQuality - a.rmpQuality;
  });
}

// One backtracking pass. Anchors are mandatory (no skip branch); electives are
// capped at electiveCap; majors/electives are otherwise optional. When
// requireExact is set, only schedules with exactly electiveCap electives are
// recorded — the caller relaxes this if no such schedule exists.
function search(
  courses: CspCourse[],
  preferences: SchedulerPreferences,
  electiveCap: number,
  requireExact: boolean
): CspSolution[] {
  const ordered = orderCourses(courses);
  const anchorKeys = new Set(
    ordered.filter((c) => c.role === "anchor").map((c) => c.courseKey)
  );
  const maxCourses = Math.max(preferences.maxCourses, anchorKeys.size);
  const n = ordered.length;

  const solutions: CspSolution[] = [];
  let nodes = 0;

  const chosen: CspAssignment[] = [];
  const committed: MinuteSlot[] = [];

  const allAnchorsPlaced = () =>
    [...anchorKeys].every((k) => chosen.some((a) => a.course.courseKey === k));
  const electivesChosen = () =>
    chosen.filter((a) => a.course.role === "elective").length;

  const record = (credits: number) => {
    if (chosen.length < 1) return;
    if (credits < preferences.minCredits || credits > preferences.maxCredits) {
      return;
    }
    if (!allAnchorsPlaced()) return;
    if (requireExact && electivesChosen() !== electiveCap) return;
    solutions.push({
      assignments: chosen.map((a) => ({
        course: a.course,
        values: [...a.values],
        slots: [...a.slots],
      })),
      totalCredits: credits,
    });
  };

  const backtrack = (index: number, credits: number) => {
    if (nodes++ > NODE_BUDGET || solutions.length >= SOLUTION_CAP) return;

    const atLimit = chosen.length >= maxCourses;
    const reachedTarget = credits >= preferences.creditTarget;
    // In exact mode, don't stop at the credit target until the elective quota
    // is met, so electives aren't skipped once majors alone reach the target.
    const quotaMet = !requireExact || electivesChosen() >= electiveCap;
    if (allAnchorsPlaced() && quotaMet && (reachedTarget || atLimit)) {
      record(credits);
      return;
    }
    if (index === n) {
      record(credits);
      return;
    }

    const course = ordered[index];
    const electiveOk =
      course.role !== "elective" || electivesChosen() < electiveCap;

    // Branch 1: include this course (pick a conflict-free section package).
    if (
      credits + course.units <= preferences.maxCredits &&
      !atLimit &&
      electiveOk
    ) {
      for (const combo of courseAssignments(course, committed)) {
        chosen.push({ course, values: combo.values, slots: combo.slots });
        committed.push(...combo.slots);
        backtrack(index + 1, credits + course.units);
        committed.length -= combo.slots.length;
        chosen.pop();
        if (solutions.length >= SOLUTION_CAP) return;
      }
    }

    // Branch 2: skip — only permitted for optional (non-anchor) courses.
    if (course.role !== "anchor") {
      backtrack(index + 1, credits);
    }
  };

  backtrack(0, 0);
  return solutions;
}

// Backtracking search where BOTH course inclusion and section choice are
// decisions. Prefers schedules with exactly the requested number of electives;
// if none are feasible, falls back to as many (up to that cap) as fit.
export function solveCsp(
  courses: CspCourse[],
  preferences: SchedulerPreferences
): CspSolution[] {
  const desired = Math.max(0, Math.floor(preferences.electiveCount || 0));
  const exact = search(courses, preferences, desired, true);
  if (exact.length > 0) return exact;
  return search(courses, preferences, desired, false);
}
