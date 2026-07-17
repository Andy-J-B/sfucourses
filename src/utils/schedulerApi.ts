import { CourseWithSectionDetails } from "@types";
import {
  parseTranscriptText,
  parseTextTranscript,
  ParsedCourse,
} from "./transcriptParser";
import {
  generateSchedules as generateSchedulesLocal,
  SchedulerPreferences,
} from "./scheduleGenerator";

export type { ParsedCourse, SchedulerPreferences };

interface ParseTranscriptResponse {
  courses: ParsedCourse[];
  major?: string;
}

interface GenerateScheduleResponse {
  schedules: ReturnType<typeof generateSchedulesLocal>;
  total: number;
  timing: {
    total_ms: number;
  };
}

/**
 * Parse a PDF transcript file by sending it to a server-side API route.
 * The API route uses pdf-parse (Node.js) to extract text from the PDF.
 */
export async function parseTranscriptFile(
  file: File
): Promise<ParseTranscriptResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/transcript/parse", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to parse transcript");
  }

  return response.json();
}

/**
 * Generate optimized schedules using client-side backtracking algorithm.
 * Fetches available sections from the existing API, then runs the optimizer.
 */
export async function generateSchedules(
  desiredCourses: string[],
  preferences: SchedulerPreferences
): Promise<GenerateScheduleResponse> {
  const startTime = performance.now();

  const sectionsPromises = desiredCourses.map(async (courseCode) => {
    const [dept, number] = courseCode.split(" ");
    if (!dept || !number) return null;
    try {
      const data = await import("./index").then((mod) =>
        mod.getCourseAPIData(
          `/sections?term=${encodeURIComponent(
            preferences.term
          )}&dept=${encodeURIComponent(dept)}&number=${encodeURIComponent(
            number
          )}`
        )
      );
      return data?.[0] || null;
    } catch (error) {
      console.error(`Failed to fetch sections for ${courseCode}:`, error);
      return null;
    }
  });

  const results = await Promise.all(sectionsPromises);
  const sectionsData = results.filter(Boolean) as CourseWithSectionDetails[];
  const failed = desiredCourses.filter((_, i) => !results[i]);

  if (sectionsData.length === 0) {
    throw new Error(
      failed.length > 0
        ? `No sections found for: ${failed.join(
            ", "
          )}. These courses may not be offered in ${preferences.term}.`
        : "No sections found for the specified courses"
    );
  }

  const schedules = generateSchedulesLocal(sectionsData, preferences);

  const elapsed = performance.now() - startTime;

  return {
    schedules,
    total: schedules.length,
    timing: {
      total_ms: Math.round(elapsed),
    },
  };
}

export { parseTextTranscript };
