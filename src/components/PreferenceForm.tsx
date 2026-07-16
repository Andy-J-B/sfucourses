import { useState, useEffect } from "react";
import { getCurrentAndNextTerm, getCourseAPIData } from "@utils/index";
import { CourseCombobox, OutlineOption } from "./CourseCombobox";
import Button from "./Button";
import toast from "react-hot-toast";

interface SchedulerPreferences {
  term: string;
  desiredCourses: string[];
  maxCourses: number;
  maxCredits: number;
  preferredTimeStart: string;
  preferredTimeEnd: string;
  avoidDays: string[];
  campusPreferences: string[];
}

interface PreferenceFormProps {
  onComplete: (preferences: SchedulerPreferences) => void;
  onBack: () => void;
  isGenerating: boolean;
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr"];
const CAMPUSES = ["Burnaby", "Surrey", "Vancouver"];

export const PreferenceForm: React.FC<PreferenceFormProps> = ({
  onComplete,
  onBack,
  isGenerating,
}) => {
  const [subStep, setSubStep] = useState<1 | 2>(1);
  const [desiredCourses, setDesiredCourses] = useState<string[]>([""]);
  const [term, setTerm] = useState(() => getCurrentAndNextTerm()[0]);
  const [maxCredits, setMaxCredits] = useState(15);
  const [preferredTimeStart, setPreferredTimeStart] = useState("09:00");
  const [preferredTimeEnd, setPreferredTimeEnd] = useState("18:00");
  const [avoidDays, setAvoidDays] = useState<string[]>([]);
  const [campusPreferences, setCampusPreferences] = useState<string[]>([
    "Burnaby",
  ]);
  const [outlineOptions, setOutlineOptions] = useState<OutlineOption[]>([]);

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

  const addCourseSlot = () => {
    if (desiredCourses.length < 6) {
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

  const handleComplete = () => {
    const validCourses = desiredCourses.filter((c) => c.trim() !== "");
    if (validCourses.length === 0) {
      toast.error("Please add at least one course");
      return;
    }

    onComplete({
      term,
      desiredCourses: validCourses,
      maxCourses: 5,
      maxCredits,
      preferredTimeStart,
      preferredTimeEnd,
      avoidDays,
      campusPreferences,
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
            <label>What courses do you want to take?</label>
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
              {desiredCourses.length < 6 && (
                <button
                  className="preference-form__add-btn"
                  onClick={addCourseSlot}
                >
                  + Add another course
                </button>
              )}
            </div>
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
