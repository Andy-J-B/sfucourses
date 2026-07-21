import { describe, it, expect } from "vitest";
import {
  CourseWithSectionDetails,
  SchedulerPreferences,
  SectionDetail,
} from "@types";
import { sectionToSlots, slotsConflict } from "./overlap";
import { buildRmpIndex, NEUTRAL_QUALITY } from "./rmp";
import {
  buildCoursePackages,
  buildCspPool,
  selectCandidatePool,
  OutlineLite,
} from "./poolBuilder";
import { scoreSolution } from "./scorer";
import { solveCsp } from "./solver";
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
  electiveCount: 2,
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
    const { candidates: pool } = selectCandidatePool({
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
    const { candidates: pool } = selectCandidatePool({
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

describe("buildCoursePackages", () => {
  it("pairs a single lecture with each of its tutorials", () => {
    const course = makeCourse("CMPT", "225", "3", [
      makeSection("D100", "LEC", "Mo,We", "10:30", "11:20"),
      makeSection("D101", "TUT", "Fr", "12:30", "13:20"),
      makeSection("D102", "TUT", "Fr", "14:30", "15:20"),
    ]);
    const { packages, feasible } = buildCoursePackages(
      course,
      basePrefs,
      rmpEmpty
    );
    expect(feasible).toBe(true);
    expect(packages).toHaveLength(2); // D100+D101, D100+D102
    for (const p of packages) {
      const codes = p.values.map((v) => v.section.section);
      expect(codes).toContain("D100");
      expect(codes).toHaveLength(2);
    }
  });

  it("never pairs a lecture with another lecture's tutorial", () => {
    const course = makeCourse("CMPT", "225", "3", [
      makeSection("D100", "LEC", "Mo", "10:30", "11:20"),
      makeSection("D101", "TUT", "Tu", "10:30", "11:20"),
      makeSection("D200", "LEC", "We", "10:30", "11:20"),
      makeSection("D201", "TUT", "Th", "10:30", "11:20"),
    ]);
    const { packages } = buildCoursePackages(course, basePrefs, rmpEmpty);
    const pairs = packages
      .map((p) =>
        p.values
          .map((v) => v.section.section)
          .sort()
          .join("+")
      )
      .sort();
    expect(pairs).toEqual(["D100+D101", "D200+D201"]);
  });

  it("drops an association group whose required component is pruned away", () => {
    const course = makeCourse("CMPT", "225", "3", [
      makeSection("D100", "LEC", "Mo", "10:30", "11:20"),
      makeSection("D200", "LEC", "Fr", "10:30", "11:20"),
    ]);
    const prefs = { ...basePrefs, avoidDays: ["Fr"] };
    const { packages } = buildCoursePackages(course, prefs, rmpEmpty);
    expect(packages).toHaveLength(1);
    expect(packages[0].values[0].section.section).toBe("D100");
  });

  it("marks a course infeasible when campus filter empties a required group", () => {
    const course = makeCourse("CMPT", "225", "3", [
      makeSection("D100", "LEC", "Mo", "10:30", "11:20", "Surrey"),
    ]);
    const prefs = { ...basePrefs, campusPreferences: ["Burnaby"] };
    const { feasible } = buildCoursePackages(course, prefs, rmpEmpty);
    expect(feasible).toBe(false);
  });
});

describe("scorer", () => {
  it("flags a class ending after preferredEnd as outside preferred hours", () => {
    const solution = {
      totalCredits: 3,
      assignments: [
        {
          course: { role: "anchor" } as any,
          values: [
            {
              section: {} as any,
              slots: [],
              campuses: ["Burnaby"],
              rmpQuality: 3,
              rmpConfidence: 0,
              hasRmp: false,
            },
          ],
          // 17:30–20:20: starts within 09:00–18:00 but ends well after.
          slots: [{ day: "Mo", start: 17 * 60 + 30, end: 20 * 60 + 20 }],
        },
      ],
    };
    const res = scoreSolution(solution as any, basePrefs);
    expect(res.tags).not.toContain("within-preferred-hours");
    expect(res.reasoning).toContain("outside preferred hours");
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

  it("degrades gracefully on a non-array review payload", () => {
    const idx = buildRmpIndex({ error: "boom" } as any, { data: [] } as any);
    const q = idx.sectionQuality(
      makeSection("D100", "LEC", "Mo", "10:30", "11:20", "Burnaby", "Jane Doe")
    );
    expect(q.hasRmp).toBe(false);
    expect(idx.courseQuality("CMPT 225")).toEqual({ rating: 0, reviews: 0 });
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

describe("elective count", () => {
  const lecOn = (dept: string, num: string, day: string) =>
    makeCourse(dept, num, "3", [
      makeSection("D100", "LEC", day, "10:30", "11:20"),
    ]);

  it("caps the number of electives at electiveCount", async () => {
    const courseMap = {
      "CMPT 225": lecOn("CMPT", "225", "Mo"),
      "ENGL 105": lecOn("ENGL", "105", "Tu"),
      "PHIL 120": lecOn("PHIL", "120", "We"),
      "HIST 101": lecOn("HIST", "101", "Th"),
    };
    const prefs = {
      ...basePrefs,
      electiveCount: 1,
      minCredits: 3,
      creditTarget: 6,
      maxCredits: 12,
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
        {
          code: "HIST 101",
          dept: "HIST",
          number: "101",
          units: 3,
          role: "elective",
        },
      ],
      courseMap,
      prefs
    );
    const sols = solveCsp(courses, prefs);
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) {
      const electives = s.assignments.filter(
        (a) => a.course.role === "elective"
      ).length;
      expect(electives).toBe(1);
    }
  });

  it("includes no electives when electiveCount is 0", async () => {
    const courseMap = {
      "CMPT 225": lecOn("CMPT", "225", "Mo"),
      "CMPT 301": lecOn("CMPT", "301", "Tu"),
      "ENGL 105": lecOn("ENGL", "105", "We"),
    };
    const prefs = {
      ...basePrefs,
      electiveCount: 0,
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
          code: "CMPT 301",
          dept: "CMPT",
          number: "301",
          units: 3,
          role: "major",
        },
        {
          code: "ENGL 105",
          dept: "ENGL",
          number: "105",
          units: 3,
          role: "elective",
        },
      ],
      courseMap,
      prefs
    );
    const sols = solveCsp(courses, prefs);
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) {
      const electives = s.assignments.filter(
        (a) => a.course.role === "elective"
      ).length;
      expect(electives).toBe(0);
    }
  });
});

describe("curated electives", () => {
  it("ranks curated electives ahead of higher live-score non-curated ones", () => {
    const outlines: OutlineLite[] = [
      { dept: "CMPT", number: "307", units: 3, title: "" },
      { dept: "ENGL", number: "105", units: 3, title: "" },
      { dept: "PHIL", number: "120", units: 3, title: "" },
    ];
    const { candidates: pool } = selectCandidatePool({
      anchors: ["CMPT 307"],
      major: "CMPT",
      completed: new Set(),
      level: 300,
      outlines,
      // PHIL has the better live score, but ENGL is curated and should win.
      courseQuality: (code) =>
        code === "PHIL 120"
          ? { rating: 5, reviews: 500 }
          : { rating: 2, reviews: 5 },
      curatedElectives: ["ENGL 105"],
    });
    const electives = pool
      .filter((c) => c.role === "elective")
      .map((c) => c.code);
    expect(electives[0]).toBe("ENGL 105");
  });
});
