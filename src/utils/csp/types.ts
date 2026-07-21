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

// One enrollable option for a course: a lecture plus its associated
// tutorial/lab sections (one per component, all from the same association
// group), with meeting times merged. Packages are precomputed so the solver
// never pairs a lecture with a tutorial that belongs to a different lecture.
export interface CspPackage {
  values: CspSectionValue[]; // one section per component in the group
  slots: MinuteSlot[];
}

// A candidate course in the expanded pool. Course *inclusion* is itself a
// decision the solver makes (this is what the old fixed-set engine could not do).
export interface CspCourse {
  courseKey: string; // "CMPT 225"
  course: CourseWithSectionDetails;
  role: CourseRole;
  units: number;
  packages: CspPackage[];
  rmpQuality: number; // best section quality, for pool ranking
  reviewCount: number;
}

export interface CspAssignment {
  course: CspCourse;
  values: CspSectionValue[]; // the sections of the chosen enrollable package
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
  prereqExcluded: string[]; // skipped because prereqs not met
  poolSize: number;
  reason?: string;
}
