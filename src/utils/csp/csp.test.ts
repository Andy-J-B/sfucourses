import { describe, it, expect } from "vitest";
import {
  CourseWithSectionDetails,
  SchedulerPreferences,
  SectionDetail,
} from "@types";
import { sectionToSlots, slotsConflict } from "./overlap";
import { buildRmpIndex, NEUTRAL_QUALITY } from "./rmp";
import {
  buildCourseVariables,
  buildCspPool,
  selectCandidatePool,
  OutlineLite,
} from "./poolBuilder";
import { solveSchedules } from "./index";

function makeSection(
  section: string,
  sectionCode: string,
  days: string,
  startTime: string,
  endTime: string,
  campus = "Burnaby",
  instructor?: string
): SectionDetail {
  return {
    section,
    deliveryMethod: "In Person",
    classNumber: section,
    instructors: instructor ? [{ name: instructor, email: "" }] : [],
    schedules: [
      {
        startDate: "2026-09-04",
        endDate: "2026-12-04",
        campus,
        days,
        startTime,
        endTime,
        sectionCode,
      },
    ],
  };
}

function makeCourse(
  dept: string,
  number: string,
  units: string,
  sections: SectionDetail[]
): CourseWithSectionDetails {
  return {
    dept,
    number,
    units,
    title: `${dept} ${number}`,
    term: "Fall 2026",
    sections,
  };
}

const basePrefs: SchedulerPreferences = {
  term: "Fall 2026",
  desiredCourses: [],
  major: "CMPT",
  maxCourses: 5,
  maxCredits: 15,
  minCredits: 3,
  creditTarget: 15,
  preferredTimeStart: "09:00",
  preferredTimeEnd: "18:00",
  avoidDays: [],
  campusPreferences: ["Burnaby"],
  preferFewerDays: false,
};

const rmpEmpty = buildRmpIndex([], []);

describe("overlap", () => {
  it("flattens multi-day schedules into per-day minute slots", () => {
    const slots = sectionToSlots(
      makeSection("D100", "LEC", "Mo,We", "10:30", "11:20")
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ day: "Mo", start: 630, end: 680 });
  });

  it("skips blocks with missing time data", () => {
    const s = makeSection("D100", "LEC", "Mo", "", "");
    expect(sectionToSlots(s)).toHaveLength(0);
  });

  it("detects same-day time overlap only", () => {
    const a = [{ day: "Mo", start: 600, end: 660 }];
    const b = [{ day: "Mo", start: 650, end: 700 }];
    const c = [{ day: "Tu", start: 650, end: 700 }];
    expect(slotsConflict(a, b)).toBe(true);
    expect(slotsConflict(a, c)).toBe(false);
  });
});

describe("selectCandidatePool", () => {
  const outlines: OutlineLite[] = [
    { dept: "CMPT", number: "225", units: 3, title: "" },
    { dept: "CMPT", number: "307", units: 3, title: "" },
    { dept: "CMPT", number: "310", units: 3, title: "" },
    { dept: "MATH", number: "232", units: 3, title: "" },
    { dept: "ENGL", number: "105", units: 3, title: "" },
    { dept: "PHIL", number: "120", units: 3, title: "" },
  ];

  it("always includes anchors and excludes completed courses", () => {
    const pool = selectCandidatePool({
      anchors: ["CMPT 307"],
      major: "CMPT",
      completed: new Set(["CMPT 225"]),
      level: 300,
      outlines,
      courseQuality: () => ({ rating: 0, reviews: 0 }),
    });
    const codes = pool.map((c) => c.code);
    expect(codes).toContain("CMPT 307");
    expect(pool.find((c) => c.code === "CMPT 307")?.role).toBe("anchor");
    expect(codes).not.toContain("CMPT 225");
  });

  it("pulls same-dept major requirements at/above level and cross-dept electives", () => {
    const pool = selectCandidatePool({
      anchors: ["CMPT 307"],
      major: "CMPT",
      completed: new Set(),
      level: 300,
      outlines,
      courseQuality: (code) =>
        code === "ENGL 105"
          ? { rating: 4.8, reviews: 200 }
          : { rating: 2, reviews: 5 },
    });
    const majors = pool.filter((c) => c.role === "major").map((c) => c.code);
    expect(majors).toContain("CMPT 310");
    const electives = pool
      .filter((c) => c.role === "elective")
      .map((c) => c.code);
    // Highest-rated elective should rank first among electives.
    expect(electives[0]).toBe("ENGL 105");
    // A 100-level same-dept course below the student's level is not a major req.
    expect(majors).not.toContain("CMPT 225");
  });
});

describe("buildCourseVariables", () => {
  it("groups sections by section code (LEC vs TUT)", () => {
    const course = makeCourse("CMPT", "225", "3", [
      makeSection("D100", "LEC", "Mo,We", "10:30", "11:20"),
      makeSection("D101", "TUT", "Fr", "12:30", "13:20"),
      makeSection("D102", "TUT", "Fr", "14:30", "15:20"),
    ]);
    const { variables, feasible } = buildCourseVariables(
      course,
      basePrefs,
      rmpEmpty
    );
    expect(feasible).toBe(true);
    expect(variables).toHaveLength(2);
    const tut = variables.find((v) => v.groupCode === "TUT");
    expect(tut?.domain).toHaveLength(2);
  });

  it("prunes sections on avoided days", () => {
    const course = makeCourse("CMPT", "225", "3", [
      makeSection("D100", "LEC", "Mo", "10:30", "11:20"),
      makeSection("D200", "LEC", "Fr", "10:30", "11:20"),
    ]);
    const prefs = { ...basePrefs, avoidDays: ["Fr"] };
    const { variables } = buildCourseVariables(course, prefs, rmpEmpty);
    const lec = variables.find((v) => v.groupCode === "LEC");
    expect(lec?.domain).toHaveLength(1);
    expect(lec?.domain[0].section.section).toBe("D100");
  });

  it("marks a course infeasible when campus filter empties a required group", () => {
    const course = makeCourse("CMPT", "225", "3", [
      makeSection("D100", "LEC", "Mo", "10:30", "11:20", "Surrey"),
    ]);
    const prefs = { ...basePrefs, campusPreferences: ["Burnaby"] };
    const { feasible } = buildCourseVariables(course, prefs, rmpEmpty);
    expect(feasible).toBe(false);
  });
});

describe("rmp", () => {
  it("uses a neutral prior when the instructor has no rating", () => {
    const idx = buildRmpIndex([], []);
    const q = idx.sectionQuality(
      makeSection("D100", "LEC", "Mo", "10:30", "11:20")
    );
    expect(q.hasRmp).toBe(false);
    expect(q.quality).toBe(NEUTRAL_QUALITY);
  });

  it("matches an instructor and parses their quality", () => {
    const idx = buildRmpIndex(
      [
        {
          URL: "",
          Quality: "4.5",
          Ratings: "30",
          Name: "Jane Doe",
          WouldTakeAgain: "90%",
          Difficulty: "2.5",
          Department: "CMPT",
        },
      ],
      []
    );
    const q = idx.sectionQuality(
      makeSection("D100", "LEC", "Mo", "10:30", "11:20", "Burnaby", "Jane Doe")
    );
    expect(q.hasRmp).toBe(true);
    expect(q.quality).toBeCloseTo(4.5);
  });
});

async function poolFrom(
  candidates: Parameters<typeof buildCspPool>[0]["candidates"],
  courseMap: Record<string, CourseWithSectionDetails>,
  prefs: SchedulerPreferences
) {
  return buildCspPool({
    candidates,
    preferences: prefs,
    rmp: rmpEmpty,
    fetchSections: async (dept, number) =>
      courseMap[`${dept} ${number}`] || null,
  });
}

describe("solveSchedules (end-to-end CSP)", () => {
  it("builds a conflict-free schedule for an anchor with LEC + TUT", async () => {
    const courseMap = {
      "CMPT 225": makeCourse("CMPT", "225", "3", [
        makeSection("D100", "LEC", "Mo,We", "10:30", "11:20"),
        makeSection("D101", "TUT", "Fr", "12:30", "13:20"),
      ]),
    };
    const prefs = {
      ...basePrefs,
      minCredits: 3,
      creditTarget: 3,
      maxCredits: 3,
    };
    const { courses } = await poolFrom(
      [
        {
          code: "CMPT 225",
          dept: "CMPT",
          number: "225",
          units: 3,
          role: "anchor",
        },
      ],
      courseMap,
      prefs
    );
    const schedules = solveSchedules(courses, prefs);
    expect(schedules.length).toBeGreaterThan(0);
    expect(schedules[0].courses).toHaveLength(1);
  });

  it("returns no schedule when two anchors always conflict", async () => {
    const courseMap = {
      "CMPT 225": makeCourse("CMPT", "225", "3", [
        makeSection("D100", "LEC", "Mo", "10:30", "11:20"),
      ]),
      "CMPT 307": makeCourse("CMPT", "307", "3", [
        makeSection("D100", "LEC", "Mo", "10:30", "11:20"),
      ]),
    };
    const prefs = {
      ...basePrefs,
      minCredits: 6,
      creditTarget: 6,
      maxCredits: 6,
    };
    const { courses } = await poolFrom(
      [
        {
          code: "CMPT 225",
          dept: "CMPT",
          number: "225",
          units: 3,
          role: "anchor",
        },
        {
          code: "CMPT 307",
          dept: "CMPT",
          number: "307",
          units: 3,
          role: "anchor",
        },
      ],
      courseMap,
      prefs
    );
    const schedules = solveSchedules(courses, prefs);
    expect(schedules).toHaveLength(0);
  });

  it("injects electives to reach the credit target beyond the anchor", async () => {
    const courseMap = {
      "CMPT 225": makeCourse("CMPT", "225", "3", [
        makeSection("D100", "LEC", "Mo", "10:30", "11:20"),
      ]),
      "ENGL 105": makeCourse("ENGL", "105", "3", [
        makeSection("D100", "LEC", "Tu", "10:30", "11:20"),
      ]),
      "PHIL 120": makeCourse("PHIL", "120", "3", [
        makeSection("D100", "LEC", "We", "10:30", "11:20"),
      ]),
    };
    const prefs = {
      ...basePrefs,
      minCredits: 9,
      creditTarget: 9,
      maxCredits: 9,
    };
    const { courses } = await poolFrom(
      [
        {
          code: "CMPT 225",
          dept: "CMPT",
          number: "225",
          units: 3,
          role: "anchor",
        },
        {
          code: "ENGL 105",
          dept: "ENGL",
          number: "105",
          units: 3,
          role: "elective",
        },
        {
          code: "PHIL 120",
          dept: "PHIL",
          number: "120",
          units: 3,
          role: "elective",
        },
      ],
      courseMap,
      prefs
    );
    const schedules = solveSchedules(courses, prefs);
    expect(schedules.length).toBeGreaterThan(0);
    const best = schedules[0];
    expect(best.courses).toHaveLength(3);
    const codes = best.courses.map((c) => `${c.dept} ${c.number}`);
    expect(codes).toContain("CMPT 225");
  });

  it("never exceeds maxCredits", async () => {
    const courseMap = {
      "CMPT 225": makeCourse("CMPT", "225", "3", [
        makeSection("D100", "LEC", "Mo", "10:30", "11:20"),
      ]),
      "ENGL 105": makeCourse("ENGL", "105", "3", [
        makeSection("D100", "LEC", "Tu", "10:30", "11:20"),
      ]),
      "PHIL 120": makeCourse("PHIL", "120", "3", [
        makeSection("D100", "LEC", "We", "10:30", "11:20"),
      ]),
    };
    const prefs = {
      ...basePrefs,
      minCredits: 3,
      creditTarget: 6,
      maxCredits: 6,
    };
    const { courses } = await poolFrom(
      [
        {
          code: "CMPT 225",
          dept: "CMPT",
          number: "225",
          units: 3,
          role: "anchor",
        },
        {
          code: "ENGL 105",
          dept: "ENGL",
          number: "105",
          units: 3,
          role: "elective",
        },
        {
          code: "PHIL 120",
          dept: "PHIL",
          number: "120",
          units: 3,
          role: "elective",
        },
      ],
      courseMap,
      prefs
    );
    const schedules = solveSchedules(courses, prefs);
    for (const s of schedules) {
      expect(s.courses.length).toBeLessThanOrEqual(2);
    }
  });
});
