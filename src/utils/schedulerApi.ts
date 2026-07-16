import { CourseWithSectionDetails } from "@types";

interface CompletedCourse {
  code: string;
  term: string;
  grade?: string;
}

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

interface ParsedTranscriptCourse {
  code: string;
  name: string;
  term: string;
  grade?: string;
  units_completed: number;
  grade_points: number;
  class_average?: string;
  enrollment: number;
}

interface ParseTranscriptResponse {
  courses: ParsedTranscriptCourse[];
  confidence: number;
}

interface GeneratedSchedule {
  id: string;
  courses: CourseWithSectionDetails[];
  qualityScore: number;
  qualityLabel: string;
  reasoning: string;
  tags: string[];
}

interface OptimizeScheduleResponse {
  schedules: GeneratedSchedule[];
  total: number;
  timing: {
    total_seconds: number;
    solutions_found: number;
    solver_status: string;
  };
}

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

export async function generateSchedules(
  completedCourses: CompletedCourse[],
  preferences: SchedulerPreferences
): Promise<OptimizeScheduleResponse> {
  const response = await fetch("/api/schedule/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completedCourses, ...preferences }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to generate schedules");
  }

  return response.json();
}

export function parseTextTranscript(text: string): CompletedCourse[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const courses: CompletedCourse[] = [];
  let currentTerm = "";

  for (const line of lines) {
    const termMatch = line.match(/(Fall|Spring|Summer)\s+(\d{4})/);
    if (termMatch) {
      currentTerm = `${termMatch[1]} ${termMatch[2]}`;
      continue;
    }

    const courseMatch = line.match(/([A-Z]{2,6})\s+(\d{3}[A-Z]?)/);
    if (courseMatch && currentTerm) {
      const gradeMatch = line.match(
        /\b(A[A+-]?|B[+-]?|C[+-]?|D[+-]?|F|P|N|W|I)\b/
      );
      courses.push({
        code: `${courseMatch[1]} ${courseMatch[2]}`,
        term: currentTerm,
        grade: gradeMatch ? gradeMatch[1] : undefined,
      });
    }
  }

  return courses;
}
