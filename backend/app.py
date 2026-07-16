from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
from ocr.transcript_parser import parse_transcript_pdf
from scheduler.constraint_model import optimize_schedule
import time

app = FastAPI(title="SFU Course Scheduler API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://sfucourses.com", "http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class ScheduleRequest(BaseModel):
    courses: List[Dict[str, Any]]
    completed_courses: List[str]
    preferences: Dict[str, Any]


@app.post("/ocr")
async def ocr_transcript(file: UploadFile):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")

    courses = parse_transcript_pdf(contents)
    return {"courses": courses, "confidence": 0.95}


@app.post("/optimize")
async def schedule_optimization(request: ScheduleRequest):
    start_time = time.time()

    result = optimize_schedule(
        courses_data=request.courses,
        completed=request.completed_courses,
        preferences=request.preferences,
    )

    elapsed = time.time() - start_time
    result["timing"] = {"total_seconds": round(elapsed, 3)}

    return result


@app.get("/health")
async def health():
    return {"status": "ok"}
