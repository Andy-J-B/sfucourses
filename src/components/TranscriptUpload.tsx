import { useState, useRef } from "react";
import { parseTranscriptFile, parseTextTranscript } from "@utils/schedulerApi";
import Button from "./Button";
import toast from "react-hot-toast";

interface ParsedCourse {
  code: string;
  name?: string;
  term: string;
  grade?: string;
  units_completed?: number;
}

interface TranscriptUploadProps {
  onComplete: (courses: ParsedCourse[]) => void;
}

export const TranscriptUpload: React.FC<TranscriptUploadProps> = ({
  onComplete,
}) => {
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [parsedCourses, setParsedCourses] = useState<ParsedCourse[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".pdf")) {
      toast.error("Please upload a PDF file");
      return;
    }

    setIsProcessing(true);
    try {
      const result = await parseTranscriptFile(file);
      setParsedCourses(result.courses);
      toast.success(`Parsed ${result.courses.length} courses`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to parse transcript"
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleTextPaste = (text: string) => {
    if (!text.trim()) {
      setParsedCourses([]);
      return;
    }
    const courses = parseTextTranscript(text);
    setParsedCourses(courses);
  };

  const handleConfirm = () => {
    if (parsedCourses.length === 0) {
      toast.error("No courses to import");
      return;
    }
    onComplete(parsedCourses);
  };

  return (
    <div className="transcript-upload">
      <h2>Import Your Transcript</h2>
      <p className="transcript-upload__subtitle">
        Upload your SFU transcript PDF or paste your course history
      </p>

      <div className="transcript-upload__mode-toggle">
        <button
          className={`mode-btn ${mode === "upload" ? "mode-btn--active" : ""}`}
          onClick={() => setMode("upload")}
        >
          Upload PDF
        </button>
        <button
          className={`mode-btn ${mode === "paste" ? "mode-btn--active" : ""}`}
          onClick={() => setMode("paste")}
        >
          Paste Text
        </button>
      </div>

      {mode === "upload" && (
        <div
          className={`transcript-upload__dropzone ${
            dragActive ? "transcript-upload__dropzone--active" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="transcript-upload__file-input"
            onChange={(e) =>
              e.target.files?.[0] && handleFile(e.target.files[0])
            }
          />
          <div className="transcript-upload__dropzone-content">
            <svg
              className="transcript-upload__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <p>Drag & drop your transcript PDF here</p>
            <span>or click to browse</span>
          </div>
        </div>
      )}

      {mode === "paste" && (
        <textarea
          className="transcript-upload__paste-area"
          placeholder={`Paste your course history here.\n\nExample format:\nFall 2023\nCMPT 120 Introduction to Computing I 3.00 3.00 A 4.00 B+ 300\nMATH 150 Calculus I 4.00 4.00 A- 3.70 B 450`}
          rows={12}
          onChange={(e) => handleTextPaste(e.target.value)}
        />
      )}

      {isProcessing && (
        <div className="transcript-upload__loading">
          <div className="spinner" />
          <span>Processing transcript...</span>
        </div>
      )}

      {parsedCourses.length > 0 && !isProcessing && (
        <div className="transcript-upload__preview">
          <h3>Preview ({parsedCourses.length} courses found)</h3>
          <div className="transcript-upload__table-wrapper">
            <table className="transcript-upload__table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Term</th>
                  <th>Grade</th>
                  <th>Credits</th>
                </tr>
              </thead>
              <tbody>
                {parsedCourses.map((course, i) => (
                  <tr key={i}>
                    <td>{course.code}</td>
                    <td>{course.term}</td>
                    <td>{course.grade || "-"}</td>
                    <td>{course.units_completed || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="transcript-upload__actions">
            <Button
              label="Clear"
              type="secondary"
              onClick={() => setParsedCourses([])}
            />
            <Button label="Confirm & Continue" onClick={handleConfirm} />
          </div>
        </div>
      )}

      <div className="transcript-upload__skip">
        <button className="link-button" onClick={() => onComplete([])}>
          Skip - I&apos;ll enter courses manually
        </button>
      </div>
    </div>
  );
};

export default TranscriptUpload;
