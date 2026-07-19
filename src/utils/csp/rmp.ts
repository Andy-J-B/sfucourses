import {
  CourseReviewSummary,
  InstructorReviewSummary,
  SectionDetail,
} from "@types";
import { getInstructorReviewData } from "@utils/reviewUtils";

// Quality assigned to a section whose instructor has no RateMyProfessor match
// (TBA sections, unmatched names). Kept as a neutral mid-scale prior so missing
// data never zeroes out an otherwise-valid section.
export const NEUTRAL_QUALITY = 3.0;

export interface RmpIndex {
  sectionQuality(section: SectionDetail): {
    quality: number;
    confidence: number;
    hasRmp: boolean;
  };
  courseQuality(courseCode: string): { rating: number; reviews: number };
}

// Builds a lookup over the batch instructor-review summary + course-review
// summary so the solver/scorer never fan out per-instructor network calls.
export function buildRmpIndex(
  instructorReviews: InstructorReviewSummary[] | undefined,
  courseReviews: CourseReviewSummary[] | undefined
): RmpIndex {
  // A 200 response with a non-array body (backend shape change, error object)
  // must degrade gracefully rather than throw when iterated.
  const instructors = Array.isArray(instructorReviews) ? instructorReviews : [];
  const courses = Array.isArray(courseReviews) ? courseReviews : [];

  const courseMap = new Map<string, CourseReviewSummary>();
  for (const c of courses) {
    courseMap.set(c.course_code.toUpperCase().replace(/\s+/g, " "), c);
  }

  return {
    sectionQuality(section) {
      // A section can list multiple instructors; take the best-rated match.
      let best: { quality: number; confidence: number } | null = null;
      for (const inst of section.instructors || []) {
        const match = getInstructorReviewData(inst.name, instructors);
        if (!match) continue;
        const quality = parseFloat(match.Quality);
        const ratings = parseInt(match.Ratings) || 0;
        if (Number.isNaN(quality)) continue;
        // Confidence saturates with review volume (log-scaled).
        const confidence = Math.log2(ratings + 1);
        if (!best || quality > best.quality) best = { quality, confidence };
      }
      if (best) return { ...best, hasRmp: true };
      return { quality: NEUTRAL_QUALITY, confidence: 0, hasRmp: false };
    },
    courseQuality(courseCode) {
      const key = courseCode.toUpperCase().replace(/\s+/g, " ");
      const c = courseMap.get(key);
      if (!c) return { rating: 0, reviews: 0 };
      return { rating: c.avg_rating || 0, reviews: c.total_reviews || 0 };
    },
  };
}
