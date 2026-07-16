from ortools.sat.python import cp_model
from typing import List, Dict, Any


def optimize_schedule(
    courses_data: List[Dict],
    completed: List[str],
    preferences: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Generate optimized schedule using OR-Tools CP-SAT solver.
    Returns ranked schedule options.
    """
    model = cp_model.CpModel()
    section_vars = {}
    time_stats = {"solutions_found": 0}

    max_credits = preferences.get("maxCredits", 15)
    max_courses = preferences.get("maxCourses", 5)
    preferred_start = preferences.get("preferredTimeStart", "08:00")
    preferred_end = preferences.get("preferredTimeEnd", "18:00")

    def time_to_minutes(t: str) -> int:
        h, m = map(int, t.split(":"))
        return h * 60 + m

    preferred_start_min = time_to_minutes(preferred_start)
    preferred_end_min = time_to_minutes(preferred_end)

    for course in courses_data:
        for section in course.get("sections", []):
            key = f"{course.get('dept', '')}_{course.get('number', '')}_{section.get('section', '')}"
            section_vars[key] = model.NewBoolVar(key)

    for course in courses_data:
        course_keys = [
            f"{course.get('dept', '')}_{course.get('number', '')}_{s.get('section', '')}"
            for s in course.get("sections", [])
        ]
        if course_keys:
            model.Add(sum(section_vars[k] for k in course_keys) == 1)

    for i, course_i in enumerate(courses_data):
        for section_i in course_i.get("sections", []):
            key_i = f"{course_i.get('dept', '')}_{course_i.get('number', '')}_{section_i.get('section', '')}"
            for sched_i in section_i.get("schedules", []):
                if not sched_i.get("startTime") or not sched_i.get("endTime"):
                    continue
                start_i = time_to_minutes(sched_i["startTime"])
                end_i = time_to_minutes(sched_i["endTime"])
                days_i = set(sched_i.get("days", "").split(","))

                for j in range(i + 1, len(courses_data)):
                    course_j = courses_data[j]
                    for section_j in course_j.get("sections", []):
                        key_j = f"{course_j.get('dept', '')}_{course_j.get('number', '')}_{section_j.get('section', '')}"
                        for sched_j in section_j.get("schedules", []):
                            if not sched_j.get("startTime") or not sched_j.get("endTime"):
                                continue
                            start_j = time_to_minutes(sched_j["startTime"])
                            end_j = time_to_minutes(sched_j["endTime"])
                            days_j = set(sched_j.get("days", "").split(","))

                            if days_i & days_j:
                                if start_i < end_j and start_j < end_i:
                                    model.AddBoolOr(
                                        [section_vars[key_i].Not(), section_vars[key_j].Not()]
                                    )

    penalties = []
    for course in courses_data:
        for section in course.get("sections", []):
            key = f"{course.get('dept', '')}_{course.get('number', '')}_{section.get('section', '')}"
            if key not in section_vars:
                continue
            for sched in section.get("schedules", []):
                if sched.get("startTime"):
                    start = time_to_minutes(sched["startTime"])
                    if start < preferred_start_min:
                        penalties.append(
                            section_vars[key] * (preferred_start_min - start)
                        )
                    elif start > preferred_end_min:
                        penalties.append(section_vars[key] * (start - preferred_end_min))

    if penalties:
        model.Minimize(sum(penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0

    solutions = []

    class SolutionCollector(cp_model.CpSolverSolutionCallback):
        def __init__(self):
            super().__init__()
            self._solution_count = 0

        def on_solution_callback(self):
            if self._solution_count >= 5:
                return
            self._solution_count += 1
            selected = []
            for key, var in section_vars.items():
                if self.Value(var):
                    selected.append(key)
            solutions.append(selected)

    collector = SolutionCollector()
    status = solver.Solve(model, collector)

    time_stats["solutions_found"] = len(solutions)
    time_stats["solver_status"] = cp_model.SolverName(status)

    formatted_solutions = []
    for idx, solution in enumerate(solutions):
        schedule_courses = []
        for key in solution:
            parts = key.rsplit("_", 2)
            if len(parts) == 3:
                dept, number, section_code = parts
                for course in courses_data:
                    if course.get("dept") == dept and course.get("number") == number:
                        for section in course.get("sections", []):
                            if section.get("section") == section_code:
                                schedule_courses.append(
                                    {**course, "sections": [section]}
                                )
                                break

        quality_score = max(0, 100 - idx * 10)
        formatted_solutions.append(
            {
                "id": f"schedule-{idx + 1}",
                "courses": schedule_courses,
                "qualityScore": quality_score,
                "qualityLabel": "Excellent" if quality_score >= 90 else "Good" if quality_score >= 70 else "Fair",
                "reasoning": f"Optimized schedule #{idx + 1} based on your preferences",
                "tags": ["optimized"],
            }
        )

    return {
        "schedules": formatted_solutions,
        "total": len(formatted_solutions),
        "timing": time_stats,
    }
