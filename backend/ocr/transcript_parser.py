import pdfplumber
import re
from typing import List, Dict, Optional
from io import BytesIO


LAPARAMS_SETTINGS = {
    "line_overlap": 0.3,
    "char_margin": 0.5,
    "word_margin": 0.1,
    "line_margin": 0.1,
    "boxes_flow": 1,
}


def parse_transcript_pdf(pdf_bytes: bytes) -> List[Dict]:
    """
    Parse SFU transcript PDF using pdfplumber.
    Returns list of completed courses with metadata.
    """
    courses = []
    current_term = None

    with pdfplumber.open(BytesIO(pdf_bytes), laparams=LAPARAMS_SETTINGS) as pdf:
        in_course_section = False

        for page in pdf.pages:
            for line in page.extract_text_lines():
                text = line["text"].strip()

                if not text or len(text) < 3:
                    continue

                term_match = re.search(r"(Fall|Spring|Summer)\s+Semester", text)
                if term_match:
                    year_match = re.search(r"(\d{4})", text)
                    if year_match:
                        current_term = f"{term_match.group(1)} {year_match.group(1)}"
                    in_course_section = False
                    continue

                if text.startswith("Attempted"):
                    in_course_section = True
                    continue

                if in_course_section and (
                    text.startswith("Term Points")
                    or text.startswith("Term GPA")
                    or text.startswith("Attempted:")
                    or text.startswith("Completed:")
                    or text.startswith("Transfer:")
                ):
                    in_course_section = False
                    continue

                if in_course_section and current_term:
                    course = parse_course_line(text)
                    if course:
                        course["term"] = current_term
                        courses.append(course)

    return courses


def parse_course_line(line: str) -> Optional[Dict]:
    """
    Parse a single course line from SFU transcript.
    Format: DEPT NUMBER COURSE_NAME UNITS_ATTEMPTED UNITS_COMPLETED GRADE GRADE_POINTS AVG ENROLLMENT
    """
    parts = line.split()

    if len(parts) < 9:
        return None

    dept = parts[0]
    if not re.match(r"^[A-Z]{2,6}$", dept):
        return None

    number = parts[1]
    if not re.match(r"^\d{3}[A-Z]?$", number):
        return None

    try:
        units_attempted = float(parts[-6].replace(",", ""))
        units_completed = float(parts[-5].replace(",", ""))
        grade = parts[-4]
        grade_points = float(parts[-3].replace(",", ""))
        class_average = parts[-2]
        enrollment = int(parts[-1].replace(",", ""))
    except (ValueError, IndexError):
        return None

    course_name = " ".join(parts[2:-6])

    if "Attempted" in course_name or "Completed" in course_name:
        return None

    return {
        "code": f"{dept} {number}",
        "name": course_name,
        "units_completed": units_completed,
        "grade": grade if grade != "-" else None,
        "grade_points": grade_points,
        "class_average": class_average if class_average != "-" else None,
        "enrollment": enrollment,
    }
