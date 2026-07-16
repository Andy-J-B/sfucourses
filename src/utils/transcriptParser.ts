interface ParsedCourse {
  code: string;
  name: string;
  term: string;
  grade?: string;
  units_completed: number;
  grade_points: number;
  class_average?: string;
  enrollment: number;
}

interface TranscriptParseResult {
  courses: ParsedCourse[];
  major?: string;
}

/**
 * Extract course info from a single transcript line.
 * Ported from SFU-Smart-Schedule transcript_controller.py
 *
 * Format: DEPT NUMBER COURSE_NAME UNITS_ATTEMPTED UNITS_COMPLETED GRADE GRADE_POINTS AVG ENROLLMENT
 */
function extractCourseInfo(line: string): string[] | null {
  const parts = line.split(" ", 2);
  if (parts.length < 2) return null;

  const dept = parts[0];
  const number = parts[1];

  if (!/^[A-Z]{2,6}$/.test(dept) || !/^\d{3}[A-Z]?$/.test(number)) {
    return null;
  }

  const rest = line.substring(parts[0].length + parts[1].length + 2);
  const lastParts = rest.trim().rsplit(" ", 6);

  if (lastParts.length < 6) return null;

  const courseName = lastParts.slice(0, -6).join(" ").trim();
  const fields = lastParts.slice(-6);

  return [dept, number, courseName || "", ...fields];
}

/**
 * Parse course data from transcript text lines.
 * Ported from SFU-Smart-Schedule transcript_controller.py
 */
function parseCourseLines(lines: string[]): ParsedCourse[] {
  const courses: ParsedCourse[] = [];

  for (const line of lines) {
    const parts = extractCourseInfo(line);
    if (!parts || parts.length < 9) continue;

    const [
      dept,
      number,
      name,
      unitsAttempted,
      unitsCompleted,
      gradeOrDash,
      gradePoints,
      avg,
      enrollment,
    ] = parts;

    const grade = gradeOrDash === "-" ? undefined : gradeOrDash;
    const classAverage = avg === "-" ? undefined : avg;

    courses.push({
      code: `${dept} ${number}`,
      name,
      term: "",
      grade,
      units_completed: parseFloat(unitsCompleted.replace(/[^\d.]/g, "")) || 0,
      grade_points: parseFloat(gradePoints.replace(/[^\d.]/g, "")) || 0,
      class_average: classAverage,
      enrollment: parseInt(enrollment.replace(/[^\d.]/g, "")) || 0,
    });
  }

  return courses;
}

/**
 * Extract text from PDF buffer using pdf-parse.
 * This runs server-side in a Next.js API route.
 */
export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

/**
 * Parse SFU transcript text into structured course data.
 * Handles term detection and course extraction.
 */
export function parseTranscriptText(text: string): TranscriptParseResult {
  const lines = text.split("\n");
  const courses: ParsedCourse[] = [];
  let currentTerm = "";
  let major = "";
  let inCourseSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.length < 3) continue;

    if (line.startsWith("Major in ")) {
      major = line;
      continue;
    }

    const termMatch = line.match(/(Fall|Spring|Summer)\s+Semester/i);
    if (termMatch) {
      const yearMatch = line.match(/(\d{4})/);
      if (yearMatch) {
        currentTerm = `${termMatch[1]} ${yearMatch[1]}`;
      }
      inCourseSection = false;
      continue;
    }

    if (line.startsWith("Attempted")) {
      inCourseSection = true;
      continue;
    }

    if (
      inCourseSection &&
      (line.startsWith("Term Points") ||
        line.startsWith("Term GPA") ||
        line.startsWith("Attempted:") ||
        line.startsWith("Completed:") ||
        line.startsWith("Transfer:"))
    ) {
      inCourseSection = false;
      continue;
    }

    if (inCourseSection && currentTerm) {
      const course = extractCourseInfo(line);
      if (course && course.length >= 9) {
        const [
          dept,
          number,
          name,
          ,
          unitsCompleted,
          gradeOrDash,
          gradePoints,
          avg,
          enrollment,
        ] = course;

        const parsed: ParsedCourse = {
          code: `${dept} ${number}`,
          name,
          term: currentTerm,
          grade: gradeOrDash === "-" ? undefined : gradeOrDash,
          units_completed:
            parseFloat(unitsCompleted.replace(/[^\d.]/g, "")) || 0,
          grade_points: parseFloat(gradePoints.replace(/[^\d.]/g, "")) || 0,
          class_average: avg === "-" ? undefined : avg,
          enrollment: parseInt(enrollment.replace(/[^\d.]/g, "")) || 0,
        };

        if (
          !parsed.code.includes("Attempted") &&
          !parsed.code.includes("Completed")
        ) {
          courses.push(parsed);
        }
      }
    }
  }

  return { courses, major };
}

/**
 * Parse pasted text transcript (fallback for non-PDF input).
 * Supports both structured and simple formats.
 */
export function parseTextTranscript(text: string): ParsedCourse[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const courses: ParsedCourse[] = [];
  let currentTerm = "";

  for (const line of lines) {
    const termMatch = line.match(/(Fall|Spring|Summer)\s+(\d{4})/i);
    if (termMatch) {
      currentTerm = `${termMatch[1]} ${termMatch[2]}`;
      continue;
    }

    const courseMatch = line.match(/^([A-Z]{2,6})\s+(\d{3}[A-Z]?)\s+/);
    if (courseMatch && currentTerm) {
      const dept = courseMatch[1];
      const number = courseMatch[2];
      const rest = line.substring(courseMatch[0].length);

      const gradeMatch = rest.match(
        /\b(A[A+-]?|B[+-]?|C[+-]?|D[+-]?|F|P|N|W|I)\b/
      );
      const unitsMatch = rest.match(/(\d+\.?\d*)\s+\d+\.?\d*\s+[A-F]/);

      courses.push({
        code: `${dept} ${number}`,
        name: rest.split(/\d/)[0].trim(),
        term: currentTerm,
        grade: gradeMatch ? gradeMatch[1] : undefined,
        units_completed: unitsMatch ? parseFloat(unitsMatch[1]) : 3,
        grade_points: 0,
        enrollment: 0,
      });
    }
  }

  return courses;
}

// String.prototype.rsplit polyfill (matches Python's str.rsplit)
declare global {
  interface String {
    rsplit(separator: string, limit: number): string[];
  }
}

if (!String.prototype.rsplit) {
  String.prototype.rsplit = function (sep: string, maxsplit: number): string[] {
    const parts = this.split(sep);
    if (maxsplit === undefined || maxsplit <= 0) return parts;

    if (parts.length <= maxsplit) return parts;

    const result = parts.slice(0, -maxsplit + 1);
    result.push(parts.slice(-maxsplit + 1).join(sep));
    return result;
  };
}

export type { ParsedCourse, TranscriptParseResult };
