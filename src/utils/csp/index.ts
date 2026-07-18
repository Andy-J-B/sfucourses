import {
  CourseWithSectionDetails,
  GeneratedSchedule,
  SchedulerPreferences,
} from "@types";
import { CspCourse, CspSolution } from "./types";
import { solveCsp } from "./solver";
import { scoreSolution } from "./scorer";

export * from "./types";
export { buildRmpIndex } from "./rmp";
export {
  selectCandidatePool,
  buildCspPool,
  normalizeCode,
  DEFAULT_MAX_POOL,
} from "./poolBuilder";
export type {
  OutlineLite,
  CandidateCourse,
  FetchSections,
} from "./poolBuilder";
export { solveCsp } from "./solver";
export { scoreSolution } from "./scorer";

function signature(solution: CspSolution): string {
  return solution.assignments
    .map(
      (a) =>
        `${a.course.courseKey}:${a.values
          .map((v) => v.section.section)
          .sort()
          .join("+")}`
    )
    .sort()
    .join("|");
}

function toGeneratedSchedule(
  solution: CspSolution,
  preferences: SchedulerPreferences,
  index: number
): GeneratedSchedule {
  const { score, label, tags, reasoning } = scoreSolution(
    solution,
    preferences
  );
  const courses: CourseWithSectionDetails[] = solution.assignments.map((a) => ({
    ...a.course.course,
    sections: a.values.map((v) => v.section),
  }));
  return {
    id: `schedule-${index + 1}`,
    courses,
    timeBlocks: [],
    qualityScore: score,
    qualityLabel: label,
    reasoning,
    tags,
  };
}

// Run the CSP over an already-built candidate pool and return the top-ranked,
// de-duplicated schedules as the UI-facing GeneratedSchedule shape.
export function solveSchedules(
  courses: CspCourse[],
  preferences: SchedulerPreferences,
  maxResults = 5
): GeneratedSchedule[] {
  const solutions = solveCsp(courses, preferences);

  const seen = new Set<string>();
  const unique: CspSolution[] = [];
  for (const s of solutions) {
    const sig = signature(s);
    if (seen.has(sig)) continue;
    seen.add(sig);
    unique.push(s);
  }

  return unique
    .map((s, i) => ({ s, gen: toGeneratedSchedule(s, preferences, i) }))
    .sort((a, b) => b.gen.qualityScore - a.gen.qualityScore)
    .slice(0, maxResults)
    .map(({ gen }, i) => ({ ...gen, id: `schedule-${i + 1}` }));
}
