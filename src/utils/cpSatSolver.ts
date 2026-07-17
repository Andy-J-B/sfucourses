import { CourseWithSectionDetails } from "@types";
import { SchedulerPreferences, GeneratedSchedule } from "./scheduleGenerator";

interface SolveRequest {
  courses: CourseWithSectionDetails[];
  preferences: SchedulerPreferences;
  maxResults?: number;
}

interface SolveProgress {
  type: "progress";
  id: string;
  message: string;
}

interface SolveResult {
  type: "result";
  id: string;
  solutions: Array<Array<{ courseIndex: number; sectionIndex: number }>>;
  courses: CourseWithSectionDetails[];
  preferences: SchedulerPreferences;
}

interface SolveError {
  type: "error";
  id: string;
  message: string;
}

type SolveResponse = SolveProgress | SolveResult | SolveError;

let worker: Worker | null = null;
let requestId = 0;
let pendingResolves: Map<
  string,
  {
    resolve: (schedules: GeneratedSchedule[]) => void;
    reject: (err: Error) => void;
    onProgress?: (message: string) => void;
  }
> = new Map();

function getWorker(): Worker {
  if (worker) return worker;

  // @ts-expect-error - webpack handles import.meta.url at build time
  worker = new Worker(new URL("./cpSatSolver.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    const { id } = e.data;
    const pending = pendingResolves.get(id);
    if (!pending) return;

    if (e.data.type === "progress") {
      pending.onProgress?.(e.data.message);
      return;
    }

    if (e.data.type === "error") {
      pending.reject(new Error(e.data.message));
      pendingResolves.delete(id);
      return;
    }

    if (e.data.type === "result") {
      const schedules = convertSolutions(
        e.data.solutions,
        e.data.courses,
        e.data.preferences
      );
      pending.resolve(schedules);
      pendingResolves.delete(id);
    }
  };

  worker.onerror = (e) => {
    console.error("CP-SAT worker error:", e);
    for (const [id, pending] of pendingResolves) {
      pending.reject(new Error("Worker crashed"));
      pendingResolves.delete(id);
    }
    worker = null;
  };

  return worker;
}

function convertSolutions(
  solutions: Array<Array<{ courseIndex: number; sectionIndex: number }>>,
  courses: CourseWithSectionDetails[],
  preferences: SchedulerPreferences
): GeneratedSchedule[] {
  return solutions.map((solution, idx) => {
    const selectedCourses = solution.map(({ courseIndex, sectionIndex }) => ({
      ...courses[courseIndex],
      sections: [courses[courseIndex].sections[sectionIndex]],
    }));

    const slots = selectedCourses.flatMap((course) =>
      course.sections.flatMap((section) =>
        section.schedules
          .filter((s) => s.startTime && s.endTime && s.days)
          .flatMap((sched) =>
            sched.days.split(",").map((day) => ({
              day: day.trim(),
              startTimeMinutes: timeToMinutes(sched.startTime),
              endTimeMinutes: timeToMinutes(sched.endTime),
              campus: sched.campus,
              duration:
                timeToMinutes(sched.endTime) - timeToMinutes(sched.startTime),
            }))
          )
      )
    );

    let score = 100;
    const tags: string[] = [];
    const reasoning: string[] = [];

    const preferredStart = timeToMinutes(preferences.preferredTimeStart);
    const preferredEnd = timeToMinutes(preferences.preferredTimeEnd);
    let outsidePreferred = 0;
    for (const slot of slots) {
      if (
        slot.startTimeMinutes < preferredStart ||
        slot.startTimeMinutes > preferredEnd
      ) {
        outsidePreferred++;
      }
    }
    if (outsidePreferred > 0) {
      score -= outsidePreferred * 5;
      reasoning.push(`${outsidePreferred} class(es) outside preferred hours`);
    } else {
      tags.push("within-preferred-hours");
      reasoning.push("All classes within preferred hours");
    }

    if (preferences.avoidDays.length > 0) {
      tags.push("respects-day-preference");
      reasoning.push("No classes on avoided days");
    }

    const campuses = new Set(slots.map((s) => s.campus));
    if (campuses.size > 1) {
      score -= (campuses.size - 1) * 8;
      reasoning.push(`Classes across ${campuses.size} campuses`);
    } else {
      tags.push("single-campus");
      reasoning.push("All classes on one campus");
    }

    const dailyHours: Record<string, number> = {};
    for (const slot of slots) {
      const hours = slot.duration / 60;
      dailyHours[slot.day] = (dailyHours[slot.day] || 0) + hours;
    }
    const hours = Object.values(dailyHours);
    if (hours.length > 0) {
      const maxDaily = Math.max(...hours);
      const minDaily = Math.min(...hours.filter((h) => h > 0));
      if (maxDaily - minDaily > 3) {
        score -= 5;
        reasoning.push("Unbalanced daily schedule");
      } else {
        tags.push("balanced-schedule");
        reasoning.push("Balanced daily schedule");
      }
      if (maxDaily > 6) {
        score -= 5;
        reasoning.push(`${maxDaily.toFixed(1)} hours on busiest day`);
      }
    }

    if (slots.length > 0) {
      const daysUsed = new Set(slots.map((s) => s.day)).size;
      if (daysUsed <= 3) {
        tags.push("compact-schedule");
        reasoning.push(`${daysUsed} days per week`);
      }
    }

    score = Math.max(0, Math.min(100, score));

    let label = "Fair";
    if (score >= 90) label = "Excellent";
    else if (score >= 75) label = "Good";
    else if (score >= 60) label = "Fair";
    else label = "Poor";

    return {
      id: `cp-sat-${idx + 1}`,
      courses: selectedCourses,
      qualityScore: score,
      qualityLabel: label,
      reasoning: reasoning.join("; ") || "Optimized by CP-SAT solver",
      tags,
    };
  });
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function solveWithCPSAT(
  courses: CourseWithSectionDetails[],
  preferences: SchedulerPreferences,
  onProgress?: (message: string) => void
): Promise<GeneratedSchedule[]> {
  return new Promise((resolve, reject) => {
    const id = String(++requestId);
    const w = getWorker();

    pendingResolves.set(id, { resolve, reject, onProgress });

    w.postMessage({
      type: "solve",
      id,
      data: {
        courses,
        preferences,
        maxResults: 5,
      },
    });
  });
}
