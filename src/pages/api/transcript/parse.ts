import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import fs from "fs";
import { parseTranscriptText } from "@utils/transcriptParser";

export const config = { api: { bodyParser: false } };

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
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
    const pdfResult = await parser.getText();
    await parser.destroy();
    const data = { text: pdfResult.text };

    const result = parseTranscriptText(data.text);

    return res.status(200).json({
      courses: result.courses,
      major: result.major,
    });
  } catch (error) {
    console.error("Transcript parse error:", error);
    return res.status(500).json({ error: "Failed to process transcript" });
  }
}
