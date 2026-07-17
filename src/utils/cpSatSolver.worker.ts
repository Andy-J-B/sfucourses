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

def parse_time(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m

def sched_minutes(s):
    if not s.get("startTime") or not s.get("endTime") or not s.get("days"):
        return None
    days = [d.strip() for d in s["days"].split(",")]
    start = parse_time(s["startTime"])
    end = parse_time(s["endTime"])
    return [(d, start, end) for d in days]

# Group sections by sectionCode for each course
# course_groups[ci] = { code: [si, ...], ... }
course_groups = []
for ci, course in enumerate(courses):
    groups = {}
    for si, section in enumerate(course["sections"]):
        code = "OTHER"
        if section.get("schedules"):
            code = section["schedules"][0].get("sectionCode", "OTHER")
        if code not in groups:
            groups[code] = []
        groups[code].append(si)
    course_groups.append(groups)

# Decision variables: x[(ci, si)] = BoolVar
model = cp_model.CpModel()
x = {}
for ci, course in enumerate(courses):
    for si in range(len(course["sections"])):
        x[(ci, si)] = model.NewBoolVar(f"x_{ci}_{si}")

# Hard: exactly one section per section-type group per course
for ci, groups in enumerate(course_groups):
    for code, sis in groups.items():
        model.Add(sum(x[(ci, si)] for si in sis) == 1)

# Hard: no time conflicts between sections of DIFFERENT courses
for ci1 in range(len(courses)):
    for si1 in range(len(courses[ci1]["sections"])):
        m1_all = []
        for sched in courses[ci1]["sections"][si1].get("schedules", []):
            ms = sched_minutes(sched)
            if ms:
                m1_all.extend(ms)
        if not m1_all:
            continue
        for ci2 in range(ci1 + 1, len(courses)):
            for si2 in range(len(courses[ci2]["sections"])):
                m2_all = []
                for sched in courses[ci2]["sections"][si2].get("schedules", []):
                    ms = sched_minutes(sched)
                    if ms:
                        m2_all.extend(ms)
                if not m2_all:
                    continue
                for (d1, s1, e1) in m1_all:
                    for (d2, s2, e2) in m2_all:
                        if d1 == d2 and s1 < e2 and s2 < e1:
                            model.Add(x[(ci1, si1)] + x[(ci2, si2)] <= 1)

# Hard: no conflicts between sections within the SAME course
for ci, groups in enumerate(course_groups):
    for code, sis in groups.items():
        for i in range(len(sis)):
            for j in range(i + 1, len(sis)):
                si_a, si_b = sis[i], sis[j]
                m_a = []
                for sched in courses[ci]["sections"][si_a].get("schedules", []):
                    ms = sched_minutes(sched)
                    if ms:
                        m_a.extend(ms)
                m_b = []
                for sched in courses[ci]["sections"][si_b].get("schedules", []):
                    ms = sched_minutes(sched)
                    if ms:
                        m_b.extend(ms)
                for (d1, s1, e1) in m_a:
                    for (d2, s2, e2) in m_b:
                        if d1 == d2 and s1 < e2 and s2 < e1:
                            model.Add(x[(ci, si_a)] + x[(ci, si_b)] <= 1)

# Hard: avoided days
avoided = set(prefs.get("avoidDays", []))
if avoided:
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            section_days = set()
            for sched in course["sections"][si].get("schedules", []):
                if sched.get("days"):
                    for d in sched["days"].split(","):
                        section_days.add(d.strip())
            if section_days & avoided:
                model.Add(x[(ci, si)] == 0)

# Hard: campus preference
campus_prefs = [p.lower() for p in prefs.get("campusPreferences", [])]
if campus_prefs:
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            campuses = [s.get("campus", "").lower() for s in course["sections"][si].get("schedules", [])]
            if campuses and not any(any(p in c for p in campus_prefs) for c in campuses):
                model.Add(x[(ci, si)] == 0)

# Hard: min credits
min_credits = prefs.get("minCredits", 0)
if min_credits > 0:
    credit_terms = []
    for ci, course in enumerate(courses):
        units = int(float(course.get("units", 3)))
        # Count each course once (sum of group selections = 1 per course)
        credit_terms.append(units * sum(x[(ci, si)] for si in range(len(course["sections"]))))
    model.Add(sum(credit_terms) >= min_credits)

# Hard: max credits
max_credits = prefs.get("maxCredits", 100)
credit_terms = []
for ci, course in enumerate(courses):
    units = int(float(course.get("units", 3)))
    credit_terms.append(units * sum(x[(ci, si)] for si in range(len(course["sections"]))))
model.Add(sum(credit_terms) <= max_credits)

# Soft: time preference bonus
obj_terms = []
if prefs.get("preferredTimeStart") and prefs.get("preferredTimeEnd"):
    pref_start = parse_time(prefs["preferredTimeStart"])
    pref_end = parse_time(prefs["preferredTimeEnd"])
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            section = course["sections"][si]
            all_good = True
            for sched in section.get("schedules", []):
                if not sched.get("startTime"):
                    continue
                t = parse_time(sched["startTime"])
                if t < pref_start or t > pref_end:
                    all_good = False
                    break
            if all_good:
                obj_terms.append(10 * x[(ci, si)])

# Soft: prefer fewer active days (+5 per day NOT used)
all_days_set = {"Mo", "Tu", "We", "Th", "Fr"}
day_used = {}
for day in all_days_set:
    day_used[day] = model.NewBoolVar(f"day_used_{day}")
    day_vars = []
    for ci, course in enumerate(courses):
        for si in range(len(course["sections"])):
            for sched in course["sections"][si].get("schedules", []):
                if sched.get("days") and day in sched["days"]:
                    day_vars.append(x[(ci, si)])
                    break
    if day_vars:
        model.AddMaxEquality(day_used[day], day_vars)
        obj_terms.append(5 * day_used[day])

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
