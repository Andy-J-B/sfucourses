import { SectionDetail } from "@types";
import { getDayCodes, timeToMinutes } from "@utils/conflictFilter";
import { MinuteSlot } from "./types";

// Flatten a section's meeting schedules into minute-based slots, skipping any
// block missing time/day data (async/TBA sections contribute no constraints).
export function sectionToSlots(section: SectionDetail): MinuteSlot[] {
  const slots: MinuteSlot[] = [];
  for (const sched of section.schedules) {
    if (!sched.startTime || !sched.endTime || !sched.days) continue;
    const start = timeToMinutes(sched.startTime);
    const end = timeToMinutes(sched.endTime);
    for (const day of getDayCodes(sched.days)) {
      slots.push({ day, start, end });
    }
  }
  return slots;
}

export function sectionCampuses(section: SectionDetail): string[] {
  return section.schedules.map((s) => s.campus).filter(Boolean);
}

// Half-open overlap on a shared day: [start, end).
export function slotsConflict(a: MinuteSlot[], b: MinuteSlot[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.day === y.day && x.start < y.end && y.start < x.end) {
        return true;
      }
    }
  }
  return false;
}
