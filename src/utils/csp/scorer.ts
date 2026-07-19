import { SchedulerPreferences } from "@types";
import { timeToMinutes } from "@utils/conflictFilter";
import { CspSolution } from "./types";

export interface ScoreResult {
  score: number;
  label: string;
  tags: string[];
  reasoning: string;
}

function label(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  return "Poor";
}

// Soft scoring over a feasible solution. All hard constraints are already
// satisfied by the solver; this only ranks feasible schedules against the
// student's stated preferences plus professor quality.
export function scoreSolution(
  solution: CspSolution,
  preferences: SchedulerPreferences
): ScoreResult {
  const slots = solution.assignments.flatMap((a) => a.slots);
  const tags: string[] = [];
  const reasoning: string[] = [];
  let score = 100;

  const preferredStart = timeToMinutes(preferences.preferredTimeStart);
  const preferredEnd = timeToMinutes(preferences.preferredTimeEnd);

  const outside = slots.filter(
    (s) => s.start < preferredStart || s.end > preferredEnd
  ).length;
  if (outside > 0) {
    score -= outside * 5;
    reasoning.push(`${outside} class(es) outside preferred hours`);
  } else {
    tags.push("within-preferred-hours");
    reasoning.push("All classes within preferred hours");
  }

  const daysUsed = new Set(slots.map((s) => s.day));
  if (preferences.preferFewerDays) {
    // Penalize each day on campus beyond the ideal minimum.
    const extraDays = Math.max(daysUsed.size - 1, 0);
    if (extraDays > 0) score -= extraDays * 6;
    if (daysUsed.size <= 3) {
      tags.push("few-days-on-campus");
      reasoning.push(`Only ${daysUsed.size} day(s) on campus`);
    }
  }

  const campusNames = new Set(
    solution.assignments.flatMap((a) => a.values.flatMap((v) => v.campuses))
  );
  if (campusNames.size > 1) {
    score -= (campusNames.size - 1) * 8;
    reasoning.push(`Classes across ${campusNames.size} campuses`);
  } else if (campusNames.size === 1) {
    tags.push("single-campus");
    reasoning.push("All classes on one campus");
  }

  // Credit-target closeness.
  const creditGap = Math.abs(solution.totalCredits - preferences.creditTarget);
  if (creditGap > 0) {
    score -= Math.min(creditGap * 3, 15);
    reasoning.push(
      `${solution.totalCredits} credits (target ${preferences.creditTarget})`
    );
  } else {
    tags.push("hits-credit-target");
  }

  // Daily-balance heuristic.
  const dailyHours: Record<string, number> = {};
  for (const s of slots) {
    dailyHours[s.day] = (dailyHours[s.day] || 0) + (s.end - s.start) / 60;
  }
  const hours = Object.values(dailyHours);
  if (hours.length > 0) {
    const maxDaily = Math.max(...hours);
    const minDaily = Math.min(...hours);
    if (maxDaily - minDaily > 3) {
      score -= 5;
      reasoning.push("Unbalanced daily schedule");
    } else {
      tags.push("balanced-schedule");
    }
    if (maxDaily > 6) {
      score -= 5;
      reasoning.push(`${maxDaily.toFixed(1)} hours on busiest day`);
    }
  }

  // RateMyProfessor: soft ranking signal over sections that have data.
  const rated = solution.assignments
    .flatMap((a) => a.values)
    .filter((v) => v.hasRmp);
  if (rated.length > 0) {
    const avgQuality =
      rated.reduce((sum, v) => sum + v.rmpQuality, 0) / rated.length;
    score += Math.round((avgQuality - 3) * 5);
    if (avgQuality >= 4) {
      tags.push("top-rated-profs");
      reasoning.push(`Avg professor rating ${avgQuality.toFixed(1)}/5`);
    } else if (avgQuality < 2.5) {
      reasoning.push(`Low avg professor rating ${avgQuality.toFixed(1)}/5`);
    }
  } else {
    tags.push("prof-ratings-unavailable");
  }

  // Reward matching the requested number of electives.
  const electiveN = solution.assignments.filter(
    (a) => a.course.role === "elective"
  ).length;
  const electiveGap = Math.abs(electiveN - preferences.electiveCount);
  if (electiveGap > 0) {
    score -= electiveGap * 6;
    reasoning.push(
      `${electiveN} elective(s), wanted ${preferences.electiveCount}`
    );
  } else if (electiveN > 0) {
    tags.push(`${electiveN} elective${electiveN > 1 ? "s" : ""}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: label(score), tags, reasoning: reasoning.join("; ") };
}
