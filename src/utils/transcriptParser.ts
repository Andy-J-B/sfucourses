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

export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

const COURSE_REGEX =
  /^([A-Z]{2,6})\s+(\d{3}[A-Z]?)\s+(.+?)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+([A-F][+-]?)\s+(\d+\.?\d*)\s+([A-F][+-]?)\s+(\d+)\s*$/;

function parseCourseLine(line: string, term: string): ParsedCourse | null {
  const m = line.match(COURSE_REGEX);
  if (!m) return null;

  const [
    ,
    dept,
    number,
    name,
    ,
    unitsCompleted,
    grade,
    gradePoints,
    avg,
    enrollment,
  ] = m;

  return {
    code: `${dept} ${number}`,
    name: name.trim(),
    term,
    grade: grade === "-" ? undefined : grade,
    units_completed: parseFloat(unitsCompleted) || 0,
    grade_points: parseFloat(gradePoints) || 0,
    class_average: avg === "-" ? undefined : avg,
    enrollment: parseInt(enrollment) || 0,
  };
}

export function parseTranscriptText(text: string): TranscriptParseResult {
  const lines = text.split("\n");
  const courses: ParsedCourse[] = [];
  let currentTerm = "";
  let major = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const termMatch = line.match(/^(\d{4})\s+(Fall|Spring|Summer)/i);
    if (termMatch) {
      currentTerm = `${termMatch[2]} ${termMatch[1]}`;
      continue;
    }

    if (line.startsWith("Major in ") && !major) {
      major = line;
    }

    if (!currentTerm) continue;

    const course = parseCourseLine(line, currentTerm);
    if (course) {
      courses.push(course);
    }
  }

  return { courses, major };
}

export function parseTextTranscript(text: string): ParsedCourse[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const courses: ParsedCourse[] = [];
  let currentTerm = "";

  for (const line of lines) {
    const termMatch = line.match(/(\d{4})\s+(Fall|Spring|Summer)/i);
    if (termMatch) {
      currentTerm = `${termMatch[2]} ${termMatch[1]}`;
      continue;
    }

    const course = parseCourseLine(line, currentTerm);
    if (course) {
      courses.push(course);
    }
  }

  return courses;
}

export type { ParsedCourse, TranscriptParseResult };
