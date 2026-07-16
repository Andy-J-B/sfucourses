import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

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
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024,
      filter: ({ mimetype }) => mimetype === "application/pdf",
    });

    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const fileBuffer = fs.readFileSync(file.filepath);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([fileBuffer], { type: "application/pdf" }),
      file.originalFilename || "transcript.pdf"
    );

    const response = await fetch(`${PYTHON_SERVICE_URL}/ocr`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (error) {
    console.error("Transcript parse error:", error);
    return res.status(500).json({ error: "Failed to process transcript" });
  }
}
