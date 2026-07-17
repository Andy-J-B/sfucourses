import { useState, useCallback } from "react";
import {
  TranscriptUpload,
  PreferenceForm,
  ScheduleResults,
  WeeklySchedule,
  ScheduleInsights,
} from "@components";
import {
  useSchedulerStore,
  CompletedCourse,
  SchedulerPreferences,
} from "@store/useSchedulerStore";
import { generateSchedules } from "@utils/schedulerApi";
import { solveWithCPSAT } from "@utils/cpSatSolver";
import toast from "react-hot-toast";

type Step = "transcript" | "preferences" | "results";

const SchedulerPage = () => {
  const [step, setStep] = useState<Step>("transcript");
  const {
    completedCourses,
    generatedSchedules,
    selectedSchedule,
    isGenerating,
    isOptimizing,
    optimizationStatus,
    sectionsData,
    setCompletedCourses,
    setPreferences,
    setGeneratedSchedules,
    setSelectedSchedule,
    setIsGenerating,
    setIsOptimizing,
    setOptimizationStatus,
    setSectionsData,
    setError,
  } = useSchedulerStore();

  const handleTranscriptComplete = useCallback(
    (courses: CompletedCourse[]) => {
      setCompletedCourses(courses);
      setStep("preferences");
    },
    [setCompletedCourses]
  );

  const handlePreferencesComplete = useCallback(
    async (prefs: SchedulerPreferences) => {
      setPreferences(prefs);
      setIsGenerating(true);
      setError(null);

      try {
        const result = await generateSchedules(prefs.desiredCourses, prefs);
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
      setPreferences,
      setGeneratedSchedules,
      setSectionsData,
      setSelectedSchedule,
      setIsGenerating,
      setError,
    ]
  );

  const handleOptimize = useCallback(async () => {
    if (!sectionsData || !useSchedulerStore.getState().preferences) return;

    setIsOptimizing(true);
    setOptimizationStatus("Loading OR-Tools...");

    try {
      const prefs = useSchedulerStore.getState().preferences!;
      const optimized = await solveWithCPSAT(sectionsData, prefs, (message) =>
        setOptimizationStatus(message)
      );
      if (optimized.length > 0) {
        setGeneratedSchedules(optimized);
        setSelectedSchedule(optimized[0]);
        toast.success(`CP-SAT found ${optimized.length} optimized schedules`);
      } else {
        toast.error("CP-SAT found no feasible schedules");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Optimization failed";
      toast.error(message);
    } finally {
      setIsOptimizing(false);
      setOptimizationStatus(null);
    }
  }, [
    sectionsData,
    setIsOptimizing,
    setOptimizationStatus,
    setGeneratedSchedules,
    setSelectedSchedule,
  ]);

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
                onOptimize={handleOptimize}
                isOptimizing={isOptimizing}
                optimizationStatus={optimizationStatus}
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
