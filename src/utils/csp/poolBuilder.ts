import { CourseWithSectionDetails, SchedulerPreferences } from "@types";
import { CspCourse, CspVariable, CourseRole, CspDiagnostics } from "./types";
import { sectionCampuses, sectionToSlots } from "./overlap";
import { RmpIndex } from "./rmp";

export const DEFAULT_MAX_POOL = 22;
// Reserve pool slots for electives so the solver always has balance options,
// even when a student's major supplies plenty of required courses.
export const ELECTIVE_RESERVE = 10;

export interface OutlineLite {
  dept: string;
  number: string;
  units: number;
  title: string;
}

export interface CandidateCourse {
  code: string; // "CMPT 225"
  dept: string;
  number: string;
  units: number;
  role: CourseRole;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, " ").trim();
}

function courseLevel(number: string): number {
  return Math.floor((parseInt(number) || 0) / 100) * 100;
}

// Pure candidate selection: given the transcript-derived context, decide which
// course codes enter the pool and label each anchor / major-requirement /
// elective. Network-free so it can be unit-tested directly.
export function selectCandidatePool(params: {
  anchors: string[];
  major: string;
  completed: Set<string>;
  level: number;
  outlines: OutlineLite[];
  courseQuality: (code: string) => { rating: number; reviews: number };
  maxPool?: number;
}): CandidateCourse[] {
  const maxPool = params.maxPool ?? DEFAULT_MAX_POOL;
  const major = params.major.toUpperCase();
  const completed = params.completed;

  const anchorCodes = Array.from(new Set(params.anchors.map(normalizeCode)));
  const anchorSet = new Set(anchorCodes);

  const outlineByCode = new Map<string, OutlineLite>();
  for (const o of params.outlines) {
    outlineByCode.set(normalizeCode(`${o.dept} ${o.number}`), o);
  }

  const anchors: CandidateCourse[] = anchorCodes.map((code) => {
    const o = outlineByCode.get(code);
    const [dept, number] = code.split(" ");
    return {
      code,
      dept: o?.dept.toUpperCase() || dept,
      number: o?.number || number,
      units: o?.units ?? 3,
      role: "anchor",
    };
  });

  const isEligible = (o: OutlineLite, code: string) =>
    !completed.has(code) && !anchorSet.has(code);

  // Major requirements: same-dept courses at or slightly above the student's
  // current level (heuristic — no real requirement graph exists in the data).
  const maxLevel = Math.min(params.level + 100, 400);
  const majorCandidates: CandidateCourse[] = params.outlines
    .filter((o) => o.dept.toUpperCase() === major)
    .filter((o) => {
      const lvl = courseLevel(o.number);
      return lvl >= params.level && lvl <= maxLevel;
    })
    .map((o) => ({ o, code: normalizeCode(`${o.dept} ${o.number}`) }))
    .filter(({ o, code }) => isEligible(o, code))
    .sort((a, b) => (parseInt(a.o.number) || 0) - (parseInt(b.o.number) || 0))
    .map(({ o, code }) => ({
      code,
      dept: o.dept.toUpperCase(),
      number: o.number,
      units: o.units,
      role: "major" as CourseRole,
    }));

  // Electives: cross-dept, level-appropriate, ranked by course review quality
  // weighted by review volume.
  const electiveCandidates: CandidateCourse[] = params.outlines
    .filter((o) => o.dept.toUpperCase() !== major)
    .filter((o) => courseLevel(o.number) >= 100)
    .map((o) => ({ o, code: normalizeCode(`${o.dept} ${o.number}`) }))
    .filter(({ o, code }) => isEligible(o, code))
    .map(({ o, code }) => {
      const q = params.courseQuality(code);
      return {
        candidate: {
          code,
          dept: o.dept.toUpperCase(),
          number: o.number,
          units: o.units,
          role: "elective" as CourseRole,
        },
        score: q.rating * Math.log2(q.reviews + 2),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.candidate);

  // Compose within the pool budget, guaranteeing elective headroom.
  const budget = Math.max(maxPool - anchors.length, 0);
  const majorTake = Math.min(
    majorCandidates.length,
    Math.max(budget - ELECTIVE_RESERVE, 0)
  );
  const majors = majorCandidates.slice(0, majorTake);
  const electiveTake = Math.max(budget - majors.length, 0);
  const electives = electiveCandidates.slice(0, electiveTake);

  return [...anchors, ...majors, ...electives];
}

// Apply unary constraints (avoid-days, campus) to a course's sections and group
// them into CSP variables. Returns null domains when a required group is wiped
// out — meaning the course cannot satisfy the preferences and must be excluded.
export function buildCourseVariables(
  course: CourseWithSectionDetails,
  preferences: SchedulerPreferences,
  rmp: RmpIndex
): { variables: CspVariable[]; feasible: boolean } {
  const avoid = new Set(preferences.avoidDays);
  const campusPrefs = preferences.campusPreferences.map((c) => c.toLowerCase());
  const courseKey = normalizeCode(`${course.dept} ${course.number}`);

  const groups = new Map<string, CspVariable>();
  for (const section of course.sections) {
    const slots = sectionToSlots(section);
    const campuses = sectionCampuses(section);

    // Unary: drop sections meeting on avoided days.
    if (slots.some((s) => avoid.has(s.day))) continue;
    // Unary: drop sections whose campus is outside the preferred set.
    if (
      campusPrefs.length > 0 &&
      campuses.length > 0 &&
      !campuses.some((c) =>
        campusPrefs.some((p) => c.toLowerCase().includes(p))
      )
    ) {
      continue;
    }

    const groupCode = section.schedules[0]?.sectionCode || "OTHER";
    const key = `${courseKey}::${groupCode}`;
    const quality = rmp.sectionQuality(section);
    const value = {
      section,
      slots,
      campuses,
      rmpQuality: quality.quality,
      rmpConfidence: quality.confidence,
      hasRmp: quality.hasRmp,
    };
    const existing = groups.get(groupCode);
    if (existing) existing.domain.push(value);
    else groups.set(groupCode, { key, groupCode, domain: [value] });
  }

  const variables = Array.from(groups.values());
  // Feasible only if every discovered group still has at least one section.
  const feasible =
    variables.length > 0 && variables.every((v) => v.domain.length > 0);
  return { variables, feasible };
}

export type FetchSections = (
  dept: string,
  number: string
) => Promise<CourseWithSectionDetails | null>;

// Async pool assembly: select candidates, fetch their sections in parallel,
// prune, and build CSP courses. Records why anchors dropped out for fail-loud
// error reporting.
export async function buildCspPool(params: {
  candidates: CandidateCourse[];
  preferences: SchedulerPreferences;
  rmp: RmpIndex;
  fetchSections: FetchSections;
}): Promise<{ courses: CspCourse[]; diagnostics: CspDiagnostics }> {
  const { candidates, preferences, rmp, fetchSections } = params;

  const fetched = await Promise.all(
    candidates.map(async (cand) => {
      try {
        const course = await fetchSections(cand.dept, cand.number);
        return { cand, course };
      } catch {
        return { cand, course: null };
      }
    })
  );

  const anchorsNotOffered: string[] = [];
  const anchorsUnplaceable: string[] = [];
  const courses: CspCourse[] = [];

  for (const { cand, course } of fetched) {
    if (!course || course.sections.length === 0) {
      if (cand.role === "anchor") anchorsNotOffered.push(cand.code);
      continue;
    }
    const { variables, feasible } = buildCourseVariables(
      course,
      preferences,
      rmp
    );
    if (!feasible) {
      if (cand.role === "anchor") anchorsUnplaceable.push(cand.code);
      continue;
    }
    const bestQuality = Math.max(
      0,
      ...variables.flatMap((v) => v.domain.map((d) => d.rmpQuality))
    );
    courses.push({
      courseKey: cand.code,
      course,
      role: cand.role,
      units: parseFloat(course.units) || cand.units || 3,
      variables,
      rmpQuality: bestQuality,
      reviewCount: rmp.courseQuality(cand.code).reviews,
    });
  }

  return {
    courses,
    diagnostics: {
      anchorsNotOffered,
      anchorsUnplaceable,
      poolSize: courses.length,
    },
  };
}
