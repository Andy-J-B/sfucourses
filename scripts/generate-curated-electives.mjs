// Regenerate src/data/curatedElectives.json from live course-review data.
// Usage: node scripts/generate-curated-electives.mjs
//
// "Known-good electives" = well-reviewed, not-too-hard courses with enough
// ratings to trust. We score by rating, reward easier courses, add a small
// confidence/popularity bonus, and cap per department so the list stays
// diverse (the app excludes the student's own major at runtime).

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const SOURCE = "https://api.sfucourses.com/v1/rest/reviews/courses";
const MIN_REVIEWS = 10;
const MIN_RATING = 4.0;
const PER_DEPT_CAP = 6;
const MAX_TOTAL = 120;

function parseCode(courseCode) {
  const m = courseCode.toUpperCase().match(/^([A-Z]+)(\d.*)$/);
  if (!m) return null;
  const [, dept, number] = m;
  return { dept, number };
}

function score(c) {
  return (
    c.avg_rating +
    (5 - c.avg_difficulty) * 0.35 +
    (Math.min(c.total_reviews, 80) / 80) * 0.3
  );
}

async function main() {
  const res = await fetch(SOURCE, {
    headers: { "Accept-Encoding": "identity" },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const rows = await res.json();

  const ranked = rows
    .filter((c) => c.total_reviews >= MIN_REVIEWS && c.avg_rating >= MIN_RATING)
    .map((c) => {
      const parsed = parseCode(c.course_code);
      if (!parsed) return null;
      return {
        code: `${parsed.dept} ${parsed.number}`,
        dept: parsed.dept,
        number: parsed.number,
        level: Math.floor((parseInt(parsed.number) || 0) / 100) * 100,
        rating: c.avg_rating,
        difficulty: c.avg_difficulty,
        reviews: c.total_reviews,
        score: Math.round(score(c) * 1000) / 1000,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // Cap per department for diversity while preserving best-first order.
  const perDept = {};
  const electives = [];
  for (const e of ranked) {
    perDept[e.dept] = (perDept[e.dept] || 0) + 1;
    if (perDept[e.dept] > PER_DEPT_CAP) continue;
    electives.push(e);
    if (electives.length >= MAX_TOTAL) break;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    criteria: { MIN_REVIEWS, MIN_RATING, PER_DEPT_CAP, MAX_TOTAL },
    electives,
  };

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "data",
    "curatedElectives.json"
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${electives.length} electives to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
