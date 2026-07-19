import {
  CourseReviewSummary,
  CourseWithSectionDetails,
  GeneratedSchedule,
  InstructorReviewSummary,
  SchedulerPreferences,
} from "@types";
import { toTermCode } from "@utils/format";
import { getCourseAPIData } from "@utils/index";
import {
  parseTranscriptText,
  parseTextTranscript,
  ParsedCourse,
} from "./transcriptParser";
import {
  buildCspPool,
  buildRmpIndex,
  normalizeCode,
  OutlineLite,
  selectCandidatePool,
  solveSchedules,
} from "./csp";
import curatedElectivesData from "../data/curatedElectives.json";
import { detectAverseSubjects } from "./transcript/academicProfile";

const CURATED_ELECTIVES = curatedElectivesData.electives.map((e) => e.code);

export type { ParsedCourse, SchedulerPreferences };

interface ParseTranscriptResponse {
  courses: ParsedCourse[];
  major?: string;
}

interface GenerateScheduleResponse {
  schedules: GeneratedSchedule[];
  total: number;
  sectionsData: CourseWithSectionDetails[];
  timing: {
    total_ms: number;
  };
}

export interface CompletedCourseLite {
  code: string;
  term?: string;
  grade?: string;
  units_completed?: number;
}

/**
 * Parse a PDF transcript file by sending it to a server-side API route.
 * The API route uses pdf-parse (Node.js) to extract text from the PDF.
 */
export async function parseTranscriptFile(
  file: File
): Promise<ParseTranscriptResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/transcript/parse", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to parse transcript");
  }

  return response.json();
}

// Most common course level (100/200/…) the student has taken in a department,
// used to bias the pool toward requirement courses they're ready for.
function detectLevel(completedCodes: string[], major: string): number {
  const counts: Record<number, number> = {};
  for (const code of completedCodes) {
    const [dept, number] = normalizeCode(code).split(" ");
    if (major && dept !== major.toUpperCase()) continue;
    const level = Math.floor((parseInt(number) || 0) / 100) * 100;
    if (level > 0) counts[level] = (counts[level] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? parseInt(sorted[0][0]) : 100;
}

export function inferMajor(
  preferenceMajor: string,
  completedCodes: string[],
  anchors: string[]
): string {
  if (preferenceMajor) return preferenceMajor.toUpperCase();
  const deptCounts: Record<string, number> = {};
  for (const code of [...completedCodes, ...anchors]) {
    const dept = normalizeCode(code).split(" ")[0];
    if (dept) deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  }
  const sorted = Object.entries(deptCounts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : "";
}

/**
 * Expand the candidate pool from the student's anchor courses (major
 * requirements + electives + section variants) and run the CSP engine to find
 * the best conflict-free, preference-satisfying schedules.
 */
export async function generateSchedules(
  preferences: SchedulerPreferences,
  completedCourses: CompletedCourseLite[] = []
): Promise<GenerateScheduleResponse> {
  const startTime = performance.now();

  const termCode = toTermCode(preferences.term);
  const anchors = preferences.desiredCourses.map(normalizeCode).filter(Boolean);
  const completedCodes = completedCourses.map((c) => c.code);
  const major = inferMajor(preferences.major, completedCodes, anchors);
  const level = detectLevel(completedCodes, major);

  // Fetch the reference data the pool builder needs, in parallel.
  const [outlinesRaw, courseReviews, instructorReviews] = await Promise.all([
    getCourseAPIData("/outlines?short=true").catch(() => []),
    getCourseAPIData("/reviews/courses").catch(
      () => [] as CourseReviewSummary[]
    ),
    getCourseAPIData("/reviews/instructors").catch(
      () => [] as InstructorReviewSummary[]
    ),
  ]);

  const outlines: OutlineLite[] = (
    Array.isArray(outlinesRaw) ? outlinesRaw : []
  )
    .map((o: any) => ({
      dept: o.dept || "",
      number: o.number || "",
      title: o.title || "",
      units: parseFloat(o.units) || 3,
    }))
    .filter((o: OutlineLite) => o.dept && o.number);

  const rmp = buildRmpIndex(instructorReviews, courseReviews);

  // Subjects the student performed poorly in are steered away from for
  // electives (never for anchors or major requirements).
  const averseSubjects = detectAverseSubjects(completedCourses);

  const candidates = selectCandidatePool({
    anchors,
    major,
    completed: new Set(completedCodes.map(normalizeCode)),
    level,
    outlines,
    courseQuality: (code) => rmp.courseQuality(code),
    curatedElectives: CURATED_ELECTIVES,
    averseSubjects,
  });

  const fetchSections = async (dept: string, number: string) => {
    const data = await getCourseAPIData(
      `/sections?term=${encodeURIComponent(termCode)}&dept=${encodeURIComponent(
        dept
      )}&number=${encodeURIComponent(number)}`
    );
    return (data?.[0] as CourseWithSectionDetails) || null;
  };

  const { courses: pool, diagnostics } = await buildCspPool({
    candidates,
    preferences,
    rmp,
    fetchSections,
  });

  if (diagnostics.anchorsNotOffered.length > 0) {
    throw new Error(
      `These anchor courses aren't offered in ${
        preferences.term
      }: ${diagnostics.anchorsNotOffered.join(
        ", "
      )}. Remove them or pick a different term.`
    );
  }

  // An offered anchor whose every section is filtered out by the day/campus
  // preferences would be silently dropped from the pool — surface it instead.
  if (diagnostics.anchorsUnplaceable.length > 0) {
    throw new Error(
      `No section of ${diagnostics.anchorsUnplaceable.join(
        ", "
      )} fits your avoided-days / campus filters. Loosen those to include ${
        diagnostics.anchorsUnplaceable.length > 1
          ? "these anchors"
          : "this anchor"
      }.`
    );
  }

  // Anchors are mandatory; if their combined units already exceed the credit
  // cap, no schedule can include them all — say so instead of blaming conflicts.
  const anchorUnits = pool
    .filter((c) => c.role === "anchor")
    .reduce((sum, c) => sum + c.units, 0);
  if (anchorUnits > preferences.maxCredits) {
    throw new Error(
      `Your anchor courses total ${anchorUnits} credits, above your ${preferences.maxCredits}-credit maximum. Raise max credits or remove an anchor.`
    );
  }

  const schedules = solveSchedules(pool, preferences);

  if (schedules.length === 0) {
    throw new Error(
      `No valid schedule found: your anchor courses could not be combined into ${preferences.minCredits}–${preferences.maxCredits} credits without a time conflict. Try loosening avoided days, campus, or the credit range.`
    );
  }

  const elapsed = performance.now() - startTime;

  return {
    schedules,
    total: schedules.length,
    sectionsData: pool.map((c) => c.course),
    timing: { total_ms: Math.round(elapsed) },
  };
}

export { parseTextTranscript };
