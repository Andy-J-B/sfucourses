/* eslint-disable no-restricted-globals */
// @ts-nocheck - Web Worker, loaded at runtime from CDN

let pyodide: any = null;

async function initPyodide(): Promise<void> {
  if (pyodide) return;
  const pyodideModule = await import(
    /* webpackIgnore: true */ "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.mjs"
  );
  pyodide = await pyodideModule.loadPyodide();
  await pyodide.loadPackage("ortools");
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, data } = e.data;

  if (type !== "solve") return;

  try {
    self.postMessage({ type: "progress", id, message: "Loading OR-Tools..." });
    await initPyodide();

    self.postMessage({
      type: "progress",
      id,
      message: "Building constraint model...",
    });

    pyodide.globals.set("courses_json", JSON.stringify(data.courses));
    pyodide.globals.set("prefs_json", JSON.stringify(data.preferences));
    pyodide.globals.set("max_results", data.maxResults || 5);

    const result = pyodide.runPython(`
import json
from ortools.sat.python import cp_model

courses = json.loads(courses_json)
prefs = json.loads(prefs_json)
max_results = max_results

model = cp_model.CpModel()

# --- Decision variables ---
x = {}  # x[(ci, si)] = BoolVar
for ci, course in enumerate(courses):
    for si in range(len(course["sections"])):
        x[(ci, si)] = model.NewBoolVar(f"x_{ci}_{si}")

# --- Hard constraints ---

# Exactly one section per course
for ci, course in enumerate(courses):
    model.Add(sum(x[(ci, si)] for si in range(len(course["sections"]))) == 1)

# No time conflicts between sections
for ci1 in range(len(courses)):
    for si1 in range(len(courses[ci1]["sections"])):
        for ci2 in range(ci1 + 1, len(courses)):
            for si2 in range(len(courses[ci2]["sections"])):
                s1 = courses[ci1]["sections"][si1]
                s2 = courses[ci2]["sections"][si2]
                for sched1 in s1.get("schedules", []):
                    if not sched1.get("startTime") or not sched1.get("endTime") or not sched1.get("days"):
                        continue
                    days1 = [d.strip() for d in sched1["days"].split(",")]
                    for sched2 in s2.get("schedules", []):
                        if not sched2.get("startTime") or not sched2.get("endTime") or not sched2.get("days"):
                            continue
                        days2 = [d.strip() for d in sched2["days"].split(",")]
                        common = set(days1) & set(days2)
                        if not common:
                            continue
                        h1, m1 = map(int, sched1["startTime"].split(":"))
                        s1min = h1 * 60 + m1
                        h2, m2 = map(int, sched1["endTime"].split(":"))
                        e1min = h2 * 60 + m2
                        h3, m3 = map(int, sched2["startTime"].split(":"))
                        s2min = h3 * 60 + m3
                        h4, m4 = map(int, sched2["endTime"].split(":"))
                        e2min = h4 * 60 + m4
                        if s1min < e2min and s2min < e1min:
                            model.Add(x[(ci1, si1)] + x[(ci2, si2)] <= 1)

# Max courses
num_courses = len(courses)
if num_courses > prefs.get("maxCourses", 10):
    model.Add(sum(x[(ci, si)] for ci in range(len(courses))
                  for si in range(len(courses[ci]["sections"]))) <= prefs.get("maxCourses", 10))

# Avoided days (hard filter)
avoided = set(prefs.get("avoidDays", []))
if avoided:
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            section = course["sections"][si]
            section_days = set()
            for sched in section.get("schedules", []):
                if sched.get("days"):
                    for d in sched["days"].split(","):
                        section_days.add(d.strip())
            if section_days & avoided:
                model.Add(x[(ci, si)] == 0)

# Campus preference (hard filter)
campus_prefs = [p.lower() for p in prefs.get("campusPreferences", [])]
if campus_prefs:
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            section = course["sections"][si]
            campuses = [s.get("campus", "").lower() for s in section.get("schedules", [])]
            if campuses and not any(any(p in c for p in campus_prefs) for c in campuses):
                model.Add(x[(ci, si)] == 0)

# --- Soft objectives (maximize) ---

obj_terms = []

# Time preference bonus: +10 per class within preferred window
if prefs.get("preferredTimeStart") and prefs.get("preferredTimeEnd"):
    ph, pm = map(int, prefs["preferredTimeStart"].split(":"))
    pref_start = ph * 60 + pm
    qh, qm = map(int, prefs["preferredTimeEnd"].split(":"))
    pref_end = qh * 60 + qm
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            section = course["sections"][si]
            good = True
            for sched in section.get("schedules", []):
                if not sched.get("startTime"):
                    continue
                h, m = map(int, sched["startTime"].split(":"))
                t = h * 60 + m
                if t < pref_start or t > pref_end:
                    good = False
                    break
            if good:
                obj_terms.append(10 * x[(ci, si)])

# Single campus bonus: +8 if only one campus used
all_campuses = set()
for course in courses:
    for section in course["sections"]:
        for sched in section.get("schedules", []):
            if sched.get("campus"):
                all_campuses.add(sched["campus"])

campus_vars = {}
for ci, course in enumerate(courses):
    for si in range(len(course["sections"])):
        section = course["sections"][si]
        campuses = set()
        for sched in section.get("schedules", []):
            if sched.get("campus"):
                campuses.add(sched["campus"])
        campus_vars[(ci, si)] = campuses

if len(all_campuses) > 1:
    for campus in all_campuses:
        c_used = model.NewBoolVar(f"campus_used_{campus}")
        using = []
        for ci in range(len(courses)):
            for si in range(len(courses[ci]["sections"])):
                if campus in campus_vars.get((ci, si), set()):
                    using.append(x[(ci, si)])
        if using:
            model.AddMaxEquality(c_used, using)
            obj_terms.append(8 * c_used)

# Prefer fewer active days: +5 per day NOT used
all_days = {"Mo", "Tu", "We", "Th", "Fr"}
day_used = {}
for day in all_days:
    day_used[day] = model.NewBoolVar(f"day_used_{day}")
    day_vars = []
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            section = course["sections"][si]
            for sched in section.get("schedules", []):
                if sched.get("days") and day in sched["days"]:
                    day_vars.append(x[(ci, si)])
                    break
    if day_vars:
        model.AddMaxEquality(day_used[day], day_vars)
        obj_terms.append(5 * day_used[day])

# Balance bonus: +3 per active day pair with similar hours
active_days = list(all_days)
for i in range(len(active_days)):
    for j in range(i + 1, len(active_days)):
        d1, d2 = active_days[i], active_days[j]
        h1 = model.NewIntVar(0, 720, f"hours_{d1}")
        h2 = model.NewIntVar(0, 720, f"hours_{d2}")
        h1_terms = []
        h2_terms = []
        for ci, course in enumerate(courses):
            for si in range(len(course["sections"])):
                section = course["sections"][si]
                for sched in section.get("schedules", []):
                    if not sched.get("startTime") or not sched.get("endTime") or not sched.get("days"):
                        continue
                    days_list = [d.strip() for d in sched["days"].split(",")]
                    h_s, m_s = map(int, sched["startTime"].split(":"))
                    h_e, m_e = map(int, sched["endTime"].split(":"))
                    dur = (h_e * 60 + m_e) - (h_s * 60 + m_s)
                    if d1 in days_list:
                        h1_terms.append(dur * x[(ci, si)])
                    if d2 in days_list:
                        h2_terms.append(dur * x[(ci, si)])
        if h1_terms:
            model.Add(h1 == sum(h1_terms))
        if h2_terms:
            model.Add(h2 == sum(h2_terms))

# Min credits constraint
min_credits = prefs.get("minCredits", 0)
if min_credits > 0:
    credit_terms = []
    for ci, course in enumerate(courses):
        units = int(float(course.get("units", 3)))
        credit_terms.append(units * sum(x[(ci, si)] for si in range(len(course["sections"]))))
    model.Add(sum(credit_terms) >= min_credits)

# Max credits constraint
max_credits = prefs.get("maxCredits", 100)
credit_terms = []
for ci, course in enumerate(courses):
    units = int(float(course.get("units", 3)))
    credit_terms.append(units * sum(x[(ci, si)] for si in range(len(course["sections"]))))
model.Add(sum(credit_terms) <= max_credits)

# --- Solve ---
if obj_terms:
    model.Maximize(sum(obj_terms))

solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 10.0

solutions = []
for _ in range(max_results):
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        break

    selected = []
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            if solver.Value(x[(ci, si)]):
                selected.append({"courseIndex": ci, "sectionIndex": si})
    solutions.append(selected)

    # Block this exact solution
    model.Add(sum(x[(sel["courseIndex"], sel["sectionIndex"])] for sel in selected) <= len(selected) - 1)

json.dumps(solutions)
`);

    const solutions = JSON.parse(result);

    self.postMessage({
      type: "progress",
      id,
      message: "Scoring solutions...",
    });

    self.postMessage({
      type: "result",
      id,
      solutions,
      courses: data.courses,
      preferences: data.preferences,
    });
  } catch (err: any) {
    self.postMessage({
      type: "error",
      id,
      message: err?.message || "Solver failed",
    });
  }
};
