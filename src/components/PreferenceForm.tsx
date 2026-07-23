import { useState, useEffect, useMemo } from "react";
import { getCurrentAndNextTerm, getCourseAPIData } from "@utils/index";
import { toTermCode } from "@utils/format";
import { CourseCombobox, OutlineOption } from "./CourseCombobox";
import Button from "./Button";
import toast from "react-hot-toast";
import { useSchedulerStore, CompletedCourse } from "@store/useSchedulerStore";
import { SchedulerPreferences } from "@types";
import { recommendCreditLoad } from "@utils/transcript/academicProfile";

interface PreferenceFormProps {
  onComplete: (preferences: SchedulerPreferences) => void;
  onBack: () => void;
  isGenerating: boolean;
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr"];
const CAMPUSES = ["Burnaby", "Surrey", "Vancouver"];
const CREDIT_TARGETS = [9, 12, 15];
const ELECTIVE_COUNTS = [0, 1, 2, 3];
const MAX_ANCHORS = 5;

function detectMajors(courses: CompletedCourse[]): string[] {
  const deptCounts: Record<string, number> = {};
  for (const course of courses) {
    const dept = course.code.split(" ")[0]?.toUpperCase();
    if (dept) deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  }
  return Object.entries(deptCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([dept]) => dept);
}

function detectLevel(courses: CompletedCourse[], major: string): number {
  const levelCounts: Record<number, number> = {};
  for (const course of courses) {
    const parts = course.code.toUpperCase().split(" ");
    if (parts[0] !== major) continue;
    const num = parseInt(parts[1]) || 0;
    const level = Math.floor(num / 100) * 100;
    if (level > 0) levelCounts[level] = (levelCounts[level] || 0) + 1;
  }
  const sorted = Object.entries(levelCounts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? parseInt(sorted[0][0]) : 100;
}

export const PreferenceForm: React.FC<PreferenceFormProps> = ({
  onComplete,
  onBack,
  isGenerating,
}) => {
  const completedCourses = useSchedulerStore((s) => s.completedCourses);
  const detectedMajorLabel = useSchedulerStore((s) => s.detectedMajor);
  const [subStep, setSubStep] = useState<1 | 2>(1);
  const [desiredCourses, setDesiredCourses] = useState<string[]>([""]);
  const [term, setTerm] = useState(() => {
    const terms = getCurrentAndNextTerm();
    return terms[terms.length - 1];
  });
  const [major, setMajor] = useState("");
  const [creditTarget, setCreditTarget] = useState(15);
  const [electiveCount, setElectiveCount] = useState(1);
  const [maxCredits, setMaxCredits] = useState(15);
  const [minCredits, setMinCredits] = useState(9);
  const [preferredTimeStart, setPreferredTimeStart] = useState("09:00");
  const [preferredTimeEnd, setPreferredTimeEnd] = useState("18:00");
  const [avoidDays, setAvoidDays] = useState<string[]>([]);
  const [preferFewerDays, setPreferFewerDays] = useState(false);
  const [campusPreferences, setCampusPreferences] = useState<string[]>([
    "Burnaby",
  ]);
  const [outlineOptions, setOutlineOptions] = useState<OutlineOption[]>([]);
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const [loadHint, setLoadHint] = useState<string | null>(null);
  const [loadApplied, setLoadApplied] = useState(false);
  const [assumePrereqsMet, setAssumePrereqsMet] = useState(false);
  const [customCreditTarget, setCustomCreditTarget] = useState("");
  const [customElectiveCount, setCustomElectiveCount] = useState("");

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const data = await getCourseAPIData("/outlines?short=true");
        if (Array.isArray(data)) {
          setOutlineOptions(
            data.map((o: any) => ({
              dept: o.dept || "",
              number: o.number || "",
              title: o.title || "",
              units: parseFloat(o.units) || 3,
            }))
          );
        }
      } catch (error) {
        console.error("Failed to fetch course options:", error);
      }
    };
    fetchOptions();
  }, []);

  // Department codes available as majors, sorted.
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of outlineOptions) if (o.dept) set.add(o.dept.toUpperCase());
    return Array.from(set).sort();
  }, [outlineOptions]);

  // Default the major to the student's most-taken department.
  useEffect(() => {
    if (major || completedCourses.length === 0) return;
    const detected = detectMajors(completedCourses)[0];
    if (detected) setMajor(detected);
  }, [completedCourses, major]);

  // Pre-fill a recommended credit load from GPA / recent performance. This is a
  // soft default — the student can still pick any load below.
  useEffect(() => {
    if (loadApplied || completedCourses.length === 0) return;
    const rec = recommendCreditLoad(completedCourses);
    if (rec) {
      setCreditTarget(rec.credits);
      setMaxCredits(rec.credits);
      setLoadHint(`Suggested ${rec.credits} credits (${rec.reason}).`);
    }
    setLoadApplied(true);
  }, [completedCourses, loadApplied]);

  // Suggest anchor courses from the detected major + level, restricted to
  // courses actually offered in the selected term (checked against /sections).
  useEffect(() => {
    if (
      outlineOptions.length === 0 ||
      completedCourses.length === 0 ||
      suggestionsApplied
    )
      return;

    const primaryMajor = major || detectMajors(completedCourses)[0];
    if (!primaryMajor) return;

    let cancelled = false;
    (async () => {
      // Which of this major's courses have sections this term?
      let offered = new Set<string>();
      try {
        const data = await getCourseAPIData(
          `/sections?term=${toTermCode(term)}&dept=${primaryMajor}`
        );
        if (Array.isArray(data)) {
          offered = new Set(
            data.map((c: any) => `${(c.dept || "").toUpperCase()} ${c.number}`)
          );
        }
      } catch {
        // If we can't confirm offerings, suggest nothing rather than risk
        // recommending a course that isn't offered this term.
      }
      if (cancelled || offered.size === 0) return;

      const level = detectLevel(completedCourses, primaryMajor);
      const maxLevel = Math.min(level + 100, 400);
      const completed = new Set(
        completedCourses.map((c) => c.code.toUpperCase().replace(/\s+/g, " "))
      );

      const suggestions = outlineOptions
        .filter((o) => o.dept.toUpperCase() === primaryMajor)
        .filter((o) => {
          const num = parseInt(o.number) || 0;
          const courseLevel = Math.floor(num / 100) * 100;
          return courseLevel >= level && courseLevel <= maxLevel;
        })
        .map((o) => `${o.dept.toUpperCase()} ${o.number}`)
        .filter((code) => !completed.has(code))
        .filter((code) => offered.has(code))
        .sort(
          (a, b) =>
            (parseInt(a.split(" ")[1]) || 0) - (parseInt(b.split(" ")[1]) || 0)
        )
        .slice(0, MAX_ANCHORS);

      if (suggestions.length > 0 && !cancelled) {
        setDesiredCourses(suggestions);
        setSuggestionsApplied(true);
        toast(
          `Suggested ${suggestions.length} ${primaryMajor} courses offered in ${term}`,
          { icon: "🎓" }
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [outlineOptions, completedCourses, suggestionsApplied, major, term]);

  const addCourseSlot = () => {
    if (desiredCourses.length < MAX_ANCHORS) {
      setDesiredCourses([...desiredCourses, ""]);
    }
  };

  const removeCourseSlot = (index: number) => {
    setDesiredCourses(desiredCourses.filter((_, i) => i !== index));
  };

  const updateCourse = (index: number, code: string) => {
    const updated = [...desiredCourses];
    updated[index] = code;
    setDesiredCourses(updated);
  };

  const selectCreditTarget = (target: number) => {
    setCreditTarget(target);
    setMaxCredits(target);
    setMinCredits((prev) => Math.min(prev, target));
  };

  const handleComplete = () => {
    const validCourses = desiredCourses.filter((c) => c.trim() !== "");
    if (validCourses.length === 0) {
      toast.error("Please add at least one course");
      return;
    }

    onComplete({
      term,
      desiredCourses: validCourses,
      major,
      maxCourses: Math.max(Math.ceil(maxCredits / 3), validCourses.length),
      maxCredits,
      minCredits,
      creditTarget,
      electiveCount,
      preferredTimeStart,
      preferredTimeEnd,
      avoidDays,
      campusPreferences,
      preferFewerDays,
      assumePrereqsMet,
    });
  };

  const terms = getCurrentAndNextTerm();

  return (
    <div className="preference-form">
      <h2>Schedule Preferences</h2>

      {subStep === 1 ? (
        <div className="preference-form__step">
          <div className="preference-form__field">
            <label>Which term are you scheduling for?</label>
            <div className="preference-form__term-selector">
              {terms.map((t) => (
                <button
                  key={t}
                  className={`term-btn ${term === t ? "term-btn--active" : ""}`}
                  onClick={() => setTerm(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="preference-form__field">
            <label>
              What&apos;s your major?
              {detectedMajorLabel && (
                <span className="preference-form__major-hint">
                  From transcript: {detectedMajorLabel}
                </span>
              )}
            </label>
            <select
              className="preference-form__select"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
            >
              <option value="">Select a department…</option>
              {deptOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <p className="preference-form__hint">
              Drives which major-requirement courses get pulled into the search.
            </p>
          </div>

          <div className="preference-form__field">
            <label>
              Anchor courses you definitely want (up to {MAX_ANCHORS})
            </label>
            <div className="preference-form__courses">
              {desiredCourses.map((course, i) => (
                <div key={i} className="preference-form__course-row">
                  <CourseCombobox
                    value={course}
                    onChange={(code) => updateCourse(i, code)}
                    options={outlineOptions}
                    placeholder="e.g., CMPT 307"
                  />
                  {desiredCourses.length > 1 && (
                    <button
                      className="preference-form__remove-btn"
                      onClick={() => removeCourseSlot(i)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {desiredCourses.length < MAX_ANCHORS && (
                <button
                  className="preference-form__add-btn"
                  onClick={addCourseSlot}
                >
                  + Add another course
                </button>
              )}
            </div>
            <p className="preference-form__hint">
              We&apos;ll build a schedule around these, then fill remaining
              credits with major requirements and top-rated electives.
            </p>
          </div>

          <div className="preference-form__field">
            <label className="preference-form__toggle-label">
              <button
                className={`preference-form__toggle ${
                  assumePrereqsMet ? "preference-form__toggle--active" : ""
                }`}
                onClick={() => setAssumePrereqsMet((v) => !v)}
              >
                {assumePrereqsMet ? "✓ " : ""}Assume all prerequisites are met
              </button>
            </label>
            <p className="preference-form__hint">
              Skip prerequisite checking — we won&apos;t filter courses based on
              your transcript.
            </p>
          </div>

          <div className="preference-form__actions">
            <Button label="Back" type="secondary" onClick={onBack} />
            <Button
              label="Next"
              onClick={() => {
                if (desiredCourses.filter((c) => c.trim()).length === 0) {
                  toast.error("Please add at least one course");
                  return;
                }
                setSubStep(2);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="preference-form__step">
          <h3>Schedule Constraints</h3>

          <div className="preference-form__field">
            <label>Target Credit Load</label>
            <div className="preference-form__inline-input">
              <div className="preference-form__term-selector">
                {CREDIT_TARGETS.map((t) => (
                  <button
                    key={t}
                    className={`term-btn ${
                      creditTarget === t && !customCreditTarget
                        ? "term-btn--active"
                        : ""
                    }`}
                    onClick={() => {
                      selectCreditTarget(t);
                      setCustomCreditTarget("");
                    }}
                  >
                    {t} credits
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={3}
                max={21}
                step={1}
                placeholder="Custom"
                className="preference-form__custom-input"
                value={customCreditTarget}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomCreditTarget(v);
                  if (v) {
                    const num = Number(v);
                    setCreditTarget(num);
                    setMaxCredits(num);
                    setMinCredits((prev) => Math.min(prev, num));
                  }
                }}
              />
            </div>
            {loadHint && <p className="preference-form__hint">{loadHint}</p>}
          </div>

          <div className="preference-form__field">
            <label>Electives to include</label>
            <div className="preference-form__inline-input">
              <div className="preference-form__term-selector">
                {ELECTIVE_COUNTS.map((n) => (
                  <button
                    key={n}
                    className={`term-btn ${
                      electiveCount === n && !customElectiveCount
                        ? "term-btn--active"
                        : ""
                    }`}
                    onClick={() => {
                      setElectiveCount(n);
                      setCustomElectiveCount("");
                    }}
                  >
                    {n === 0 ? "None" : n}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                max={10}
                step={1}
                placeholder="Custom"
                className="preference-form__custom-input"
                value={customElectiveCount}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomElectiveCount(v);
                  if (v) setElectiveCount(Number(v));
                }}
              />
            </div>
            <p className="preference-form__hint">
              High-rated, easier non-major courses to round out your schedule.
            </p>
          </div>

          <div className="preference-form__field">
            <label>Max Credits per Term</label>
            <input
              type="number"
              min={3}
              max={18}
              value={maxCredits}
              onChange={(e) => setMaxCredits(Number(e.target.value))}
            />
          </div>

          <div className="preference-form__field">
            <label>Min Credits per Term</label>
            <input
              type="number"
              min={3}
              max={18}
              value={minCredits}
              onChange={(e) => setMinCredits(Number(e.target.value))}
            />
          </div>

          <div className="preference-form__field">
            <label>Preferred Class Hours</label>
            <div className="preference-form__time-range">
              <input
                type="time"
                value={preferredTimeStart}
                onChange={(e) => setPreferredTimeStart(e.target.value)}
              />
              <span>to</span>
              <input
                type="time"
                value={preferredTimeEnd}
                onChange={(e) => setPreferredTimeEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="preference-form__field">
            <label>Days to Avoid</label>
            <div className="preference-form__days">
              {DAYS.map((day) => (
                <button
                  key={day}
                  className={`day-btn ${
                    avoidDays.includes(day) ? "day-btn--active" : ""
                  }`}
                  onClick={() =>
                    setAvoidDays((prev) =>
                      prev.includes(day)
                        ? prev.filter((d) => d !== day)
                        : [...prev, day]
                    )
                  }
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div className="preference-form__field">
            <label>Campus Days</label>
            <button
              className={`campus-btn ${
                preferFewerDays ? "campus-btn--active" : ""
              }`}
              onClick={() => setPreferFewerDays((v) => !v)}
            >
              {preferFewerDays ? "✓ " : ""}Minimize days on campus
            </button>
          </div>

          <div className="preference-form__field">
            <label>Campus Preference</label>
            <div className="preference-form__campus">
              {CAMPUSES.map((campus) => (
                <button
                  key={campus}
                  className={`campus-btn ${
                    campusPreferences.includes(campus)
                      ? "campus-btn--active"
                      : ""
                  }`}
                  onClick={() =>
                    setCampusPreferences((prev) =>
                      prev.includes(campus)
                        ? prev.filter((c) => c !== campus)
                        : [...prev, campus]
                    )
                  }
                >
                  {campus}
                </button>
              ))}
            </div>
          </div>

          <div className="preference-form__actions">
            <Button
              label="Back"
              type="secondary"
              onClick={() => setSubStep(1)}
            />
            <Button
              label={isGenerating ? "Generating..." : "Generate Schedules"}
              onClick={handleComplete}
              disabled={isGenerating}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PreferenceForm;
