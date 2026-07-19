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

// Order pool so mandatory courses are decided first (anchors, then major
// requirements), electives last and best-rated first. This front-loads the hard
// constraints and lets credit/target pruning cut the optional tail.
function orderCourses(courses: CspCourse[]): CspCourse[] {
  const roleRank = { anchor: 0, major: 1, elective: 2 } as const;
  return [...courses].sort((a, b) => {
    if (roleRank[a.role] !== roleRank[b.role]) {
      return roleRank[a.role] - roleRank[b.role];
    }
    return b.rmpQuality - a.rmpQuality;
  });
}

// Backtracking search where BOTH course inclusion and section choice are
// decisions. Anchors are mandatory (no skip branch); majors/electives are
// optional. Returns every feasible schedule found within the search budget.
export function solveCsp(
  courses: CspCourse[],
  preferences: SchedulerPreferences
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

  const record = (credits: number) => {
    if (chosen.length < 1) return;
    if (credits < preferences.minCredits || credits > preferences.maxCredits) {
      return;
    }
    if (!allAnchorsPlaced()) return;
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
    if (allAnchorsPlaced() && (reachedTarget || atLimit)) {
      record(credits);
      return;
    }
    if (index === n) {
      record(credits);
      return;
    }

    const course = ordered[index];

    // Branch 1: include this course (pick a conflict-free section combo).
    if (credits + course.units <= preferences.maxCredits && !atLimit) {
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
