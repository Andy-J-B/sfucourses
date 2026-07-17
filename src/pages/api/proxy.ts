import type { NextApiRequest, NextApiResponse } from "next";
import { fetchWithCache } from "../../lib/api-wrapper";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { path } = req.query;

  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Path parameter is required" });
  }

  // Build the full target URL relative to the API root
  const targetUrl = `https://api.sfucourses.com${path}`;

  try {
    const data = await fetchWithCache(targetUrl);
    res.status(200).json(data);
  } catch (error: any) {
    const msg = error.message || "Internal server error";
    const statusMatch = msg.match(/error:\s*(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 502;
    console.error(`Proxy error ${status}:`, msg);
    res.status(status).json({ error: msg });
  }
}
