import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CourseWithSectionDetails, TimeBlock } from "@types";

interface CompletedCourse {
  code: string;
  name?: string;
  term: string;
  grade?: string;
  units_completed?: number;
}

interface SchedulerPreferences {
  term: string;
  desiredCourses: string[];
  maxCourses: number;
  maxCredits: number;
  minCredits: number;
  preferredTimeStart: string;
  preferredTimeEnd: string;
  avoidDays: string[];
  campusPreferences: string[];
}

interface GeneratedSchedule {
  id: string;
  courses: CourseWithSectionDetails[];
  timeBlocks?: TimeBlock[];
  qualityScore: number;
  qualityLabel: string;
  reasoning: string;
  tags: string[];
}

interface SchedulerState {
  completedCourses: CompletedCourse[];
  preferences: SchedulerPreferences | null;
  generatedSchedules: GeneratedSchedule[];
  selectedSchedule: GeneratedSchedule | null;
  isGenerating: boolean;
  error: string | null;

  setCompletedCourses: (courses: CompletedCourse[]) => void;
  setPreferences: (prefs: SchedulerPreferences) => void;
  setGeneratedSchedules: (schedules: GeneratedSchedule[]) => void;
  setSelectedSchedule: (schedule: GeneratedSchedule | null) => void;
  setIsGenerating: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  completedCourses: [],
  preferences: null,
  generatedSchedules: [],
  selectedSchedule: null,
  isGenerating: false,
  error: null,
};

export const useSchedulerStore = create<SchedulerState>()(
  persist(
    (set) => ({
      ...initialState,

      setCompletedCourses: (courses) => set({ completedCourses: courses }),
      setPreferences: (prefs) => set({ preferences: prefs }),
      setGeneratedSchedules: (schedules) =>
        set({ generatedSchedules: schedules }),
      setSelectedSchedule: (schedule) => set({ selectedSchedule: schedule }),
      setIsGenerating: (loading) => set({ isGenerating: loading }),
      setError: (error) => set({ error }),
      reset: () => set(initialState),
    }),
    {
      name: "scheduler-storage",
      partialize: (state) => ({
        completedCourses: state.completedCourses,
        preferences: state.preferences,
      }),
    }
  )
);

export type { CompletedCourse, SchedulerPreferences, GeneratedSchedule };
