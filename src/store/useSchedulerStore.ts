import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CourseWithSectionDetails,
  GeneratedSchedule,
  SchedulerPreferences,
} from "@types";

interface CompletedCourse {
  code: string;
  name?: string;
  term: string;
  grade?: string;
  units_completed?: number;
}

interface SchedulerState {
  completedCourses: CompletedCourse[];
  detectedMajor: string | null;
  preferences: SchedulerPreferences | null;
  generatedSchedules: GeneratedSchedule[];
  selectedSchedule: GeneratedSchedule | null;
  isGenerating: boolean;
  isOptimizing: boolean;
  optimizationStatus: string | null;
  sectionsData: any[] | null;
  error: string | null;

  setCompletedCourses: (courses: CompletedCourse[]) => void;
  setDetectedMajor: (major: string | null) => void;
  setPreferences: (prefs: SchedulerPreferences) => void;
  setGeneratedSchedules: (schedules: GeneratedSchedule[]) => void;
  setSelectedSchedule: (schedule: GeneratedSchedule | null) => void;
  setIsGenerating: (loading: boolean) => void;
  setIsOptimizing: (optimizing: boolean) => void;
  setOptimizationStatus: (status: string | null) => void;
  setSectionsData: (data: any[] | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  completedCourses: [],
  detectedMajor: null,
  preferences: null,
  generatedSchedules: [],
  selectedSchedule: null,
  isGenerating: false,
  isOptimizing: false,
  optimizationStatus: null,
  sectionsData: null,
  error: null,
};

export const useSchedulerStore = create<SchedulerState>()(
  persist(
    (set) => ({
      ...initialState,

      setCompletedCourses: (courses) => set({ completedCourses: courses }),
      setDetectedMajor: (major) => set({ detectedMajor: major }),
      setPreferences: (prefs) => set({ preferences: prefs }),
      setGeneratedSchedules: (schedules) =>
        set({ generatedSchedules: schedules }),
      setSelectedSchedule: (schedule) => set({ selectedSchedule: schedule }),
      setIsGenerating: (loading) => set({ isGenerating: loading }),
      setIsOptimizing: (optimizing) => set({ isOptimizing: optimizing }),
      setOptimizationStatus: (status) => set({ optimizationStatus: status }),
      setSectionsData: (data) => set({ sectionsData: data }),
      setError: (error) => set({ error }),
      reset: () => set(initialState),
    }),
    {
      name: "scheduler-storage",
      partialize: (state) => ({
        completedCourses: state.completedCourses,
        detectedMajor: state.detectedMajor,
        preferences: state.preferences,
      }),
    }
  )
);

export type { CompletedCourse };
export type { SchedulerPreferences, GeneratedSchedule } from "@types";
