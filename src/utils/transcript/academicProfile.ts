import {
  AVERSION_GPA_THRESHOLD,
  CREDITS_HEAVY,
  CREDITS_LIGHT,
  CREDITS_NORMAL,
  gradeToPoints,
  HIGH_GPA,
  isFailing,
  LOW_GPA,
} from "./gradeScale";

// Minimal shape needed from a completed (transcript) course. Matches
// CompletedCourse in the scheduler store.
export interface CompletedCourseLike {
  code: string;
  term?: string;
  grade?: string;
  units_completed?: number;
}

const DEFAULT_UNITS = 3;

// Department code from a course code: "PHIL 105" -> "PHIL". Generalizes the
// inline `code.split(" ")[0]` pattern used elsewhere so subject logic isn't
// hard-coded to any one department.
export function subjectOf(code: string): string {
  return code.trim().toUpperCase().split(/\s+/)[0] || "";
}

function unitsOf(c: CompletedCourseLike): number {
  return c.units_completed && c.units_completed > 0
    ? c.units_completed
    : DEFAULT_UNITS;
}

// Units-weighted GPA over the courses that carry a GPA-affecting letter grade.
// Returns null (and warns) when there is history but nothing gradeable, so
// callers skip GPA logic loudly instead of inventing a number.
export function computeGPA(completed: CompletedCourseLike[]): number | null {
  let points = 0;
  let units = 0;
  let graded = 0;
  for (const c of completed) {
    const gp = gradeToPoints(c.grade);
    if (gp === null) continue;
    const u = unitsOf(c);
    points += gp * u;
    units += u;
    graded += 1;
  }
  if (graded === 0) {
    if (completed.length > 0) {
      console.warn(
        "[academicProfile] No GPA-affecting letter grades found in transcript; skipping GPA-based recommendations."
      );
    }
    return null;
  }
  return points / units;
}

export interface SubjectStat {
  subject: string;
  avg: number;
  count: number;
  hasFail: boolean;
}

// Per-department average GPA and whether any course was failed.
export function subjectPerformance(
  completed: CompletedCourseLike[]
): Map<string, SubjectStat> {
  const acc = new Map<
    string,
    { points: number; units: number; count: number; hasFail: boolean }
  >();
  for (const c of completed) {
    const gp = gradeToPoints(c.grade);
    if (gp === null) continue;
    const subject = subjectOf(c.code);
    if (!subject) continue;
    const u = unitsOf(c);
    const cur = acc.get(subject) || {
      points: 0,
      units: 0,
      count: 0,
      hasFail: false,
    };
    cur.points += gp * u;
    cur.units += u;
    cur.count += 1;
    cur.hasFail = cur.hasFail || isFailing(c.grade);
    acc.set(subject, cur);
  }
  const out = new Map<string, SubjectStat>();
  for (const [subject, s] of acc) {
    out.set(subject, {
      subject,
      avg: s.points / s.units,
      count: s.count,
      hasFail: s.hasFail,
    });
  }
  return out;
}

export interface AversionOptions {
  gpaThreshold?: number; // avg dept GPA below this = averse
}

// Subjects the student should be steered away from for ELECTIVES: those where
// their average grade is below the threshold, or they failed any course.
// Generalized across all departments, not just the ticket's PHIL example.
export function detectAverseSubjects(
  completed: CompletedCourseLike[],
  options: AversionOptions = {}
): Set<string> {
  const threshold = options.gpaThreshold ?? AVERSION_GPA_THRESHOLD;
  const averse = new Set<string>();
  for (const stat of subjectPerformance(completed).values()) {
    if (stat.hasFail || stat.avg < threshold) averse.add(stat.subject);
  }
  return averse;
}

// Order SFU terms chronologically so we can isolate the most recent one.
const SEASON_ORDER: Record<string, number> = { Spring: 0, Summer: 1, Fall: 2 };
function termKey(term: string | undefined): number {
  if (!term) return -1;
  const [season, year] = term.split(/\s+/);
  const y = parseInt(year) || 0;
  return y * 10 + (SEASON_ORDER[season] ?? 0);
}

export type CreditTier = "light" | "normal" | "heavy";

export interface CreditLoadRecommendation {
  tier: CreditTier;
  credits: number;
  reason: string;
  cumulativeGpa: number;
  recentGpa: number | null;
}

const TIER_CREDITS: Record<CreditTier, number> = {
  light: CREDITS_LIGHT,
  normal: CREDITS_NORMAL,
  heavy: CREDITS_HEAVY,
};

const TIER_ORDER: CreditTier[] = ["light", "normal", "heavy"];

function downshift(tier: CreditTier): CreditTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, i - 1)];
}

// Graduated credit-load suggestion from cumulative GPA, with a one-tier
// downshift when the most recent term was itself poor (recent struggle → lighter
// next term even if the cumulative GPA looks fine). Returns null when GPA can't
// be computed so callers keep their existing default.
export function recommendCreditLoad(
  completed: CompletedCourseLike[]
): CreditLoadRecommendation | null {
  const gpa = computeGPA(completed);
  if (gpa === null) return null;

  let tier: CreditTier;
  if (gpa < LOW_GPA) tier = "light";
  else if (gpa < HIGH_GPA) tier = "normal";
  else tier = "heavy";

  // Most recent term's GPA.
  const maxKey = Math.max(...completed.map((c) => termKey(c.term)));
  const recentCourses =
    maxKey > 0 ? completed.filter((c) => termKey(c.term) === maxKey) : [];
  const recentGpa = recentCourses.length ? computeGPA(recentCourses) : null;

  let reason = `cumulative GPA ${gpa.toFixed(2)}`;
  if (recentGpa !== null && recentGpa < LOW_GPA && tier !== "light") {
    tier = downshift(tier);
    reason += `; recent term GPA ${recentGpa.toFixed(
      2
    )} was low, so a lighter load`;
  }

  return {
    tier,
    credits: TIER_CREDITS[tier],
    reason,
    cumulativeGpa: gpa,
    recentGpa,
  };
}
