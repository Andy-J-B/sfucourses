import {
  CourseWithSectionDetails,
  SectionDetail,
  SectionSchedule,
} from "@types";

interface SchedulerPreferences {
  term: string;
  desiredCourses: string[];
  maxCourses: number;
  maxCredits: number;
  minCredits: number;
  preferredTimeStart: string;
  preferredTimeEnd: string;
  avoidDays: string[];
  campusPreferences: string[];
}

interface GeneratedSchedule {
  id: string;
  courses: CourseWithSectionDetails[];
  qualityScore: number;
  qualityLabel: string;
  reasoning: string;
  tags: string[];
}

interface ScheduleSlot {
  course: CourseWithSectionDetails;
  section: SectionDetail;
  schedule: SectionSchedule;
  day: string;
  startTimeMinutes: number;
  endTimeMinutes: number;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function getDayMinutes(
  schedule: SectionSchedule
): { day: string; start: number; end: number }[] {
  const days = schedule.days.split(",").map((d) => d.trim());
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  return days.map((day) => ({ day, start, end }));
}

function hasConflict(a: ScheduleSlot, b: ScheduleSlot): boolean {
  if (a.day !== b.day) return false;
  return (
    a.startTimeMinutes < b.endTimeMinutes &&
    b.startTimeMinutes < a.endTimeMinutes
  );
}

function scoreSchedule(
  slots: ScheduleSlot[],
  preferences: SchedulerPreferences
): { score: number; tags: string[]; reasoning: string[] } {
  let score = 100;
  const tags: string[] = [];
  const reasoning: string[] = [];

  const preferredStart = timeToMinutes(preferences.preferredTimeStart);
  const preferredEnd = timeToMinutes(preferences.preferredTimeEnd);

  let outsidePreferredHours = 0;
  for (const slot of slots) {
    if (
      slot.startTimeMinutes < preferredStart ||
      slot.startTimeMinutes > preferredEnd
    ) {
      outsidePreferredHours++;
    }
  }
  if (outsidePreferredHours > 0) {
    score -= outsidePreferredHours * 5;
    reasoning.push(
      `${outsidePreferredHours} class(es) outside preferred hours`
    );
  } else {
    tags.push("within-preferred-hours");
    reasoning.push("All classes within preferred hours");
  }

  const daysSet = new Set(slots.map((s) => s.day));
  const avoidedDaysUsed = [...daysSet].filter((d) =>
    preferences.avoidDays.includes(d)
  );
  if (avoidedDaysUsed.length > 0) {
    score -= avoidedDaysUsed.length * 10;
    reasoning.push(`Classes on avoided days: ${avoidedDaysUsed.join(", ")}`);
  } else if (preferences.avoidDays.length > 0) {
    tags.push("respects-day-preference");
    reasoning.push("No classes on avoided days");
  }

  const campuses = new Set(slots.map((s) => s.schedule.campus));
  if (campuses.size > 1) {
    score -= (campuses.size - 1) * 8;
    reasoning.push(`Classes across ${campuses.size} campuses`);
  } else {
    tags.push("single-campus");
    reasoning.push("All classes on one campus");
  }

  const dailyHours: Record<string, number> = {};
  for (const slot of slots) {
    const hours = (slot.endTimeMinutes - slot.startTimeMinutes) / 60;
    dailyHours[slot.day] = (dailyHours[slot.day] || 0) + hours;
  }
  const hours = Object.values(dailyHours);
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

  score = Math.max(0, Math.min(100, score));

  let label = "Fair";
  if (score >= 90) label = "Excellent";
  else if (score >= 75) label = "Good";
  else if (score >= 60) label = "Fair";
  else label = "Poor";

  return { score, tags, reasoning };
}

function getSectionSlots(
  course: CourseWithSectionDetails,
  section: SectionDetail
): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  for (const sched of section.schedules) {
    if (!sched.startTime || !sched.endTime || !sched.days) continue;
    const dayMinutes = getDayMinutes(sched);
    for (const dm of dayMinutes) {
      slots.push({
        course,
        section,
        schedule: sched,
        day: dm.day,
        startTimeMinutes: dm.start,
        endTimeMinutes: dm.end,
      });
    }
  }
  return slots;
}

function getSectionsConflict(a: SectionDetail[], b: SectionDetail[]): boolean {
  const slotsA = a.flatMap((s) => {
    const result: { day: string; start: number; end: number }[] = [];
    for (const sched of s.schedules) {
      if (!sched.startTime || !sched.endTime || !sched.days) continue;
      for (const dm of getDayMinutes(sched)) {
        result.push(dm);
      }
    }
    return result;
  });
  const slotsB = b.flatMap((s) => {
    const result: { day: string; start: number; end: number }[] = [];
    for (const sched of s.schedules) {
      if (!sched.startTime || !sched.endTime || !sched.days) continue;
      for (const dm of getDayMinutes(sched)) {
        result.push(dm);
      }
    }
    return result;
  });

  for (const a of slotsA) {
    for (const b of slotsB) {
      if (a.day === b.day && a.start < b.end && b.start < a.end) {
        return true;
      }
    }
  }
  return false;
}

function groupSectionsByCode(
  sections: SectionDetail[]
): Map<string, SectionDetail[]> {
  const groups = new Map<string, SectionDetail[]>();
  for (const section of sections) {
    const code = section.schedules[0]?.sectionCode || "OTHER";
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push(section);
  }
  return groups;
}

function backtrack(
  courses: CourseWithSectionDetails[],
  currentIndex: number,
  currentSections: SectionDetail[][],
  currentSlots: ScheduleSlot[],
  results: GeneratedSchedule[],
  preferences: SchedulerPreferences,
  maxResults: number
): void {
  if (results.length >= maxResults) return;

  if (currentIndex === courses.length) {
    if (currentSlots.length === 0) return;

    const courseCount = new Set(
      currentSlots.map((s) => s.course.dept + s.course.number)
    ).size;
    if (courseCount > preferences.maxCourses) return;

    const totalCredits = [
      ...new Set(currentSlots.map((s) => s.course.dept + s.course.number)),
    ].reduce((sum, key) => {
      const course = currentSlots.find(
        (s) => s.course.dept + s.course.number === key
      )!.course;
      return sum + (parseFloat(course.units) || 3);
    }, 0);
    if (totalCredits < preferences.minCredits) {
      console.log(
        `[Backtrack] REJECTED: credits ${totalCredits} < min ${preferences.minCredits}`
      );
      return;
    }

    const { score, tags, reasoning } = scoreSchedule(currentSlots, preferences);

    const selectedCourses: CourseWithSectionDetails[] = [];
    for (let i = 0; i < courses.length; i++) {
      const pickedSections = currentSections[i];
      if (pickedSections && pickedSections.length > 0) {
        selectedCourses.push({
          ...courses[i],
          sections: pickedSections,
        });
      }
    }

    results.push({
      id: `schedule-${results.length + 1}`,
      courses: selectedCourses,
      qualityScore: score,
      qualityLabel:
        score >= 90
          ? "Excellent"
          : score >= 75
          ? "Good"
          : score >= 60
          ? "Fair"
          : "Poor",
      reasoning: reasoning.join("; "),
      tags,
    });
    console.log(
      `[Backtrack] ACCEPTED schedule #${
        results.length
      } score=${score} courses=${selectedCourses
        .map((c) => `${c.dept} ${c.number}`)
        .join(", ")}`
    );

    return;
  }

  const course = courses[currentIndex];
  const groups = groupSectionsByCode(course.sections);
  const groupEntries = Array.from(groups.entries());

  function pickGroup(groupIndex: number, picked: SectionDetail[]): void {
    if (results.length >= maxResults) return;

    if (groupIndex === groupEntries.length) {
      const sectionSlots = picked.flatMap((s) => getSectionSlots(course, s));
      const pickedLabel = picked.map((s) => s.section).join("+");
      const courseLabel = `${course.dept} ${course.number}`;

      if (sectionSlots.length === 0) {
        console.log(
          `[Backtrack] REJECTED ${courseLabel} [${pickedLabel}]: no valid time slots`
        );
        return;
      }

      let hasConflictFlag = false;
      for (const newSlot of sectionSlots) {
        for (const existingSlot of currentSlots) {
          if (hasConflict(newSlot, existingSlot)) {
            hasConflictFlag = true;
            break;
          }
        }
        if (hasConflictFlag) break;
      }
      if (hasConflictFlag) {
        console.log(
          `[Backtrack] REJECTED ${courseLabel} [${pickedLabel}]: time conflict`
        );
        return;
      }

      if (preferences.avoidDays.length > 0) {
        const sectionDays = sectionSlots.map((s) => s.day);
        const hasAvoidedDay = sectionDays.some((d) =>
          preferences.avoidDays.includes(d)
        );
        if (hasAvoidedDay) {
          console.log(
            `[Backtrack] REJECTED ${courseLabel} [${pickedLabel}]: avoided days`
          );
          return;
        }
      }

      if (preferences.campusPreferences.length > 0) {
        const campuses = picked.flatMap((s) =>
          s.schedules.map((sc) => sc.campus)
        );
        const hasPreferredCampus = campuses.some((c) =>
          preferences.campusPreferences.some((p) =>
            c.toLowerCase().includes(p.toLowerCase())
          )
        );
        if (!hasPreferredCampus && campuses.length > 0) {
          console.log(
            `[Backtrack] REJECTED ${courseLabel} [${pickedLabel}]: campus ${campuses} not in ${preferences.campusPreferences}`
          );
          return;
        }
      }

      const newSections = [...currentSections];
      newSections[currentIndex] = picked;

      backtrack(
        courses,
        currentIndex + 1,
        newSections,
        [...currentSlots, ...sectionSlots],
        results,
        preferences,
        maxResults
      );
      return;
    }

    const [, groupSections] = groupEntries[groupIndex];
    for (const section of groupSections) {
      pickGroup(groupIndex + 1, [...picked, section]);
    }
  }

  pickGroup(0, []);
}

export function generateSchedules(
  courses: CourseWithSectionDetails[],
  preferences: SchedulerPreferences
): GeneratedSchedule[] {
  console.log("[Backtrack] Starting with", courses.length, "courses");
  for (const course of courses) {
    const groups = groupSectionsByCode(course.sections);
    const groupInfo = Array.from(groups.entries())
      .map(
        ([code, secs]) => `${code}: [${secs.map((s) => s.section).join(", ")}]`
      )
      .join(" | ");
    console.log(
      `[Backtrack] ${course.dept} ${course.number} (${course.units} units): ${groupInfo}`
    );
  }

  const results: GeneratedSchedule[] = [];
  const maxResults = 5;

  backtrack(courses, 0, [], [], results, preferences, maxResults);
  console.log(`[Backtrack] Done: ${results.length} schedules found`);

  results.sort((a, b) => b.qualityScore - a.qualityScore);

  results.forEach((r, i) => {
    r.id = `schedule-${i + 1}`;
  });

  return results;
}

export type { SchedulerPreferences, GeneratedSchedule };
