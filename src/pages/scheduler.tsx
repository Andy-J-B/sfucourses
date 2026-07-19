import { useState, useCallback } from "react";
import { useRouter } from "next/router";
import {
  TranscriptUpload,
  PreferenceForm,
  ScheduleResults,
  WeeklySchedule,
  ScheduleInsights,
  Button,
} from "@components";
import {
  useSchedulerStore,
  CompletedCourse,
  SchedulerPreferences,
} from "@store/useSchedulerStore";
import { generateSchedules } from "@utils/schedulerApi";
import { toShortenedTerm } from "@utils";
import toast from "react-hot-toast";

type Step = "transcript" | "preferences" | "results";

const SchedulerPage = () => {
  const router = useRouter();
  const [step, setStep] = useState<Step>("transcript");
  const {
    completedCourses,
    generatedSchedules,
    selectedSchedule,
    preferences,
    isGenerating,
    setCompletedCourses,
    setDetectedMajor,
    setPreferences,
    setGeneratedSchedules,
    setSelectedSchedule,
    setIsGenerating,
    setSectionsData,
    setError,
  } = useSchedulerStore();

  const handleTranscriptComplete = useCallback(
    (courses: CompletedCourse[], major?: string) => {
      setCompletedCourses(courses);
      if (major) setDetectedMajor(major);
      setStep("preferences");
    },
    [setCompletedCourses, setDetectedMajor]
  );

  const handlePreferencesComplete = useCallback(
    async (prefs: SchedulerPreferences) => {
      setPreferences(prefs);
      setIsGenerating(true);
      setError(null);

      try {
        const result = await generateSchedules(prefs, completedCourses);
        setGeneratedSchedules(result.schedules);
        setSectionsData(result.sectionsData);
        if (result.schedules.length > 0) {
          setSelectedSchedule(result.schedules[0]);
        }
        setStep("results");
        toast.success(`Generated ${result.schedules.length} schedule options`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to generate schedules";
        setError(message);
        toast.error(message);
      } finally {
        setIsGenerating(false);
      }
    },
    [
      completedCourses,
      setPreferences,
      setGeneratedSchedules,
      setSectionsData,
      setSelectedSchedule,
      setIsGenerating,
      setError,
    ]
  );

  return (
    <div className="page scheduler-page">
      <main className="scheduler-page__container">
        <div className="scheduler-page__steps">
          <div
            className={`step ${step === "transcript" ? "step--active" : ""} ${
              step === "preferences" || step === "results"
                ? "step--completed"
                : ""
            }`}
          >
            <span className="step__number">1</span>
            <span className="step__label">Transcript</span>
          </div>
          <div
            className={`step ${step === "preferences" ? "step--active" : ""} ${
              step === "results" ? "step--completed" : ""
            }`}
          >
            <span className="step__number">2</span>
            <span className="step__label">Preferences</span>
          </div>
          <div className={`step ${step === "results" ? "step--active" : ""}`}>
            <span className="step__number">3</span>
            <span className="step__label">Results</span>
          </div>
        </div>

        <div className="scheduler-page__layout">
          <div className="scheduler-page__input-panel">
            {step === "transcript" && (
              <TranscriptUpload onComplete={handleTranscriptComplete} />
            )}
            {step === "preferences" && (
              <PreferenceForm
                onComplete={handlePreferencesComplete}
                onBack={() => setStep("transcript")}
                isGenerating={isGenerating}
              />
            )}
            {step === "results" && (
              <ScheduleResults
                schedules={generatedSchedules}
                onSelect={setSelectedSchedule}
                onRefine={() => setStep("preferences")}
              />
            )}
          </div>

          <div className="scheduler-page__preview-panel">
            {selectedSchedule ? (
              <>
                <WeeklySchedule
                  coursesWithSections={selectedSchedule.courses}
                  setCoursesWithSections={() => {}}
                  timeBlocks={selectedSchedule.timeBlocks || []}
                />
                <ScheduleInsights
                  coursesWithSections={selectedSchedule.courses}
                />
                <Button
                  label="Open in Schedule Planner"
                  className="scheduler-page__open-schedule"
                  onClick={() => {
                    const classNums = selectedSchedule.courses.flatMap((c) =>
                      c.sections.map((s) => s.classNumber)
                    );
                    const termShort = preferences
                      ? toShortenedTerm(preferences.term)
                      : "";
                    router.push(
                      `/schedule?term=${termShort}&courses=${classNums.join("-")}`
                    );
                  }}
                />
              </>
            ) : (
              <div className="scheduler-page__empty-preview">
                <p>Select a schedule to preview</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default SchedulerPage;
