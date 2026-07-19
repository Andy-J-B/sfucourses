import { CourseWithSectionDetails, SchedulerPreferences } from "@types";
import {
  CspCourse,
  CspPackage,
  CspSectionValue,
  CourseRole,
  CspDiagnostics,
} from "./types";
import { sectionCampuses, sectionToSlots, slotsConflict } from "./overlap";
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
  curatedElectives?: string[]; // ordered best-first "known-good" codes
  maxPool?: number;
}): CandidateCourse[] {
  const maxPool = params.maxPool ?? DEFAULT_MAX_POOL;
  const major = params.major.toUpperCase();
  const completed = params.completed;

  const anchorCodes = Array.from(new Set(params.anchors.map(normalizeCode)));
  const anchorSet = new Set(anchorCodes);

  // Rank of each curated elective (lower = better); non-curated fall back to
  // live review score.
  const curatedRank = new Map(
    (params.curatedElectives ?? []).map((c, i) => [normalizeCode(c), i])
  );

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

  // Electives: cross-dept, level-appropriate. Curated "known-good" courses rank
  // first (in curated order); the rest fall back to live course-review quality.
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
        curatedRank: curatedRank.get(code) ?? Infinity,
        score: q.rating * Math.log2(q.reviews + 2),
      };
    })
    .sort((a, b) => {
      if (a.curatedRank !== b.curatedRank) return a.curatedRank - b.curatedRank;
      return b.score - a.score;
    })
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

// SFU groups a lecture with its tutorials/labs by the hundreds digit of the
// section code: lecture D100 ↔ tutorials D101..D199, lecture D200 ↔ D2xx. The
// data has no explicit associatedClass field, so this prefix is the best signal
// for which sections must be taken together.
function associationKey(sectionName: string): string {
  const m = sectionName.match(/^([A-Za-z]*)(\d+)/);
  if (!m) return sectionName;
  const [, prefix, num] = m;
  return `${prefix}${Math.floor((parseInt(num) || 0) / 100)}`;
}

function hasInternalConflict(values: CspSectionValue[]): boolean {
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (slotsConflict(values[i].slots, values[j].slots)) return true;
    }
  }
  return false;
}

// Apply unary constraints (avoid-days, campus) then build the course's
// enrollable packages: within each association group, take one section per
// component type (LEC + TUT + LAB). This guarantees a lecture is only ever
// paired with its own tutorials/labs. A group whose pruning wiped out a
// required component yields no package; a course with no packages is infeasible.
export function buildCoursePackages(
  course: CourseWithSectionDetails,
  preferences: SchedulerPreferences,
  rmp: RmpIndex
): { packages: CspPackage[]; feasible: boolean } {
  const avoid = new Set(preferences.avoidDays);
  const campusPrefs = preferences.campusPreferences.map((c) => c.toLowerCase());

  // association group -> { required component types, surviving sections }
  const groups = new Map<
    string,
    { required: Set<string>; byComponent: Map<string, CspSectionValue[]> }
  >();

  for (const section of course.sections) {
    const groupCode = section.schedules[0]?.sectionCode || "OTHER";
    const assoc = associationKey(section.section);
    if (!groups.has(assoc)) {
      groups.set(assoc, { required: new Set(), byComponent: new Map() });
    }
    const info = groups.get(assoc)!;
    info.required.add(groupCode);

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

    const quality = rmp.sectionQuality(section);
    const value: CspSectionValue = {
      section,
      slots,
      campuses,
      rmpQuality: quality.quality,
      rmpConfidence: quality.confidence,
      hasRmp: quality.hasRmp,
    };
    if (!info.byComponent.has(groupCode)) info.byComponent.set(groupCode, []);
    info.byComponent.get(groupCode)!.push(value);
  }

  const packages: CspPackage[] = [];
  for (const info of groups.values()) {
    const components = Array.from(info.required);
    // Skip a group where pruning removed every section of a required component.
    if (components.some((c) => (info.byComponent.get(c)?.length ?? 0) === 0)) {
      continue;
    }
    // Cartesian product across component types within this association group.
    let combos: CspSectionValue[][] = [[]];
    for (const component of components) {
      const domain = info.byComponent.get(component)!;
      const next: CspSectionValue[][] = [];
      for (const combo of combos) {
        for (const value of domain) next.push([...combo, value]);
      }
      combos = next;
    }
    for (const combo of combos) {
      if (hasInternalConflict(combo)) continue;
      packages.push({ values: combo, slots: combo.flatMap((v) => v.slots) });
    }
  }

  return { packages, feasible: packages.length > 0 };
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
    const { packages, feasible } = buildCoursePackages(
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
      ...packages.flatMap((p) => p.values.map((v) => v.rmpQuality))
    );
    courses.push({
      courseKey: cand.code,
      course,
      role: cand.role,
      units: parseFloat(course.units) || cand.units || 3,
      packages,
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
