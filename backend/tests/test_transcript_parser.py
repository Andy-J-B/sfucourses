import pytest
from ocr.transcript_parser import parse_course_line


def test_parse_course_line():
    line = "CMPT 120 Introduction to Computing I 3.00 3.00 A 4.00 B+ 300"
    result = parse_course_line(line)

    assert result is not None
    assert result["code"] == "CMPT 120"
    assert result["name"] == "Introduction to Computing I"
    assert result["units_completed"] == 3.0
    assert result["grade"] == "A"
    assert result["grade_points"] == 4.0


def test_parse_course_line_with_grade_dash():
    line = "CMPT 499 Co-op Work Term 0.00 0.00 - 0.00 - 0"
    result = parse_course_line(line)

    assert result is not None
    assert result["grade"] is None


def test_parse_course_line_invalid():
    line = "Term Points: 28.30"
    result = parse_course_line(line)
    assert result is None


def test_parse_course_line_with_comma_in_enrollment():
    line = "MATH 150 Calculus I 4.00 4.00 A- 3.70 B 1,200"
    result = parse_course_line(line)

    assert result is not None
    assert result["code"] == "MATH 150"
    assert result["enrollment"] == 1200
