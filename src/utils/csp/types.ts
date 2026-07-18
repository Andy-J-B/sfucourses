import { CourseWithSectionDetails, SectionDetail } from "@types";

// Where a candidate course came from. Drives mandatory-vs-optional handling
// in the solver and the elective-balance ranking signal.
export type CourseRole = "anchor" | "major" | "elective";

// A single meeting block flattened to minutes-since-midnight for fast overlap.
export interface MinuteSlot {
  day: string; // "Mo"
  start: number; // minutes
  end: number; // minutes
}

// One assignable section (a domain value), with its meeting times precomputed
// and unary constraints (avoid-days / campus) already applied upstream.
export interface CspSectionValue {
  section: SectionDetail;
  slots: MinuteSlot[];
  campuses: string[];
  rmpQuality: number; // 0..5, neutral prior when instructor unrated
  rmpConfidence: number; // >=0, grows with rating count; 0 when no data
  hasRmp: boolean;
}

// One CSP variable = a required section group within a course (LEC / TUT / LAB).
// A course with a lecture and a lab yields two variables that must both be
// assigned when the course is included.
export interface CspVariable {
  key: string; // "CMPT 225::LEC"
  groupCode: string; // "LEC"
  domain: CspSectionValue[];
}

// A candidate course in the expanded pool. Course *inclusion* is itself a
// decision the solver makes (this is what the old fixed-set engine could not do).
export interface CspCourse {
  courseKey: string; // "CMPT 225"
  course: CourseWithSectionDetails;
  role: CourseRole;
  units: number;
  variables: CspVariable[];
  rmpQuality: number; // best section quality, for pool ranking
  reviewCount: number;
}

export interface CspAssignment {
  course: CspCourse;
  values: CspSectionValue[]; // one chosen section per variable/group
  slots: MinuteSlot[];
}

export interface CspSolution {
  assignments: CspAssignment[];
  totalCredits: number;
}

// Explains an infeasible search so the UI can fail loudly and usefully.
export interface CspDiagnostics {
  anchorsNotOffered: string[]; // requested but no sections in term
  anchorsUnplaceable: string[]; // offered but cannot fit alongside others
  poolSize: number;
  reason?: string;
}
