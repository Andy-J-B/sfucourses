import type { NextApiRequest, NextApiResponse } from "next";
import { getCourseAPIData } from "@utils/index";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { completedCourses, desiredCourses, preferences, term } = req.body;

    if (!desiredCourses || desiredCourses.length === 0) {
      return res.status(400).json({ error: "No courses specified" });
    }

    const sectionsPromises = desiredCourses.map(async (courseCode: string) => {
      const [dept, number] = courseCode.split(" ");
      if (!dept || !number) return null;
      try {
        const data = await getCourseAPIData(
          `/sections?term=${encodeURIComponent(term)}&dept=${encodeURIComponent(
            dept
          )}&number=${encodeURIComponent(number)}`
        );
        return data?.[0] || null;
      } catch (error) {
        console.error(`Failed to fetch sections for ${courseCode}:`, error);
        return null;
      }
    });

    const sectionsData = (await Promise.all(sectionsPromises)).filter(Boolean);

    if (sectionsData.length === 0) {
      return res
        .status(404)
        .json({ error: "No sections found for the specified courses" });
    }

    const response = await fetch(`${PYTHON_SERVICE_URL}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courses: sectionsData,
        completed_courses: completedCourses,
        preferences,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (error) {
    console.error("Schedule optimize error:", error);
    return res.status(500).json({ error: "Failed to generate schedules" });
  }
}
