import { CourseWithSectionDetails, TimeBlock } from "@types";
import MiniSchedulePreview from "./MiniSchedulePreview";
import { TextBadge } from "./TextBadge";
import Button from "./Button";

interface GeneratedSchedule {
  id: string;
  courses: CourseWithSectionDetails[];
  timeBlocks?: TimeBlock[];
  qualityScore: number;
  qualityLabel: string;
  reasoning: string;
  tags: string[];
}

interface ScheduleResultsProps {
  schedules: GeneratedSchedule[];
  onSelect: (schedule: GeneratedSchedule) => void;
  onRefine: () => void;
  onOptimize?: () => void;
  isOptimizing?: boolean;
  optimizationStatus?: string | null;
}

export const ScheduleResults: React.FC<ScheduleResultsProps> = ({
  schedules,
  onSelect,
  onRefine,
  onOptimize,
  isOptimizing,
  optimizationStatus,
}) => {
  if (schedules.length === 0) {
    return (
      <div className="schedule-results schedule-results--empty">
        <h2>No Schedules Found</h2>
        <p>
          We couldn&apos;t generate any schedules with your current constraints.
          Try adjusting your preferences.
        </p>
        <Button label="Refine Preferences" onClick={onRefine} />
      </div>
    );
  }

  return (
    <div className="schedule-results">
      <div className="schedule-results__header">
        <h2>Generated Schedules</h2>
        <span className="schedule-results__count">
          {schedules.length} options found
        </span>
      </div>

      <div className="schedule-results__list">
        {schedules.map((schedule, index) => (
          <div
            key={schedule.id}
            className="schedule-results__card"
            onClick={() => onSelect(schedule)}
          >
            <div className="schedule-results__preview">
              <MiniSchedulePreview
                courses={schedule.courses}
                timeBlocks={schedule.timeBlocks || []}
              />
            </div>
            <div className="schedule-results__info">
              <div className="schedule-results__rank">#{index + 1}</div>
              <div className="schedule-results__score">
                <span className="schedule-results__score-value">
                  {schedule.qualityScore}%
                </span>
                <span className="schedule-results__score-label">
                  {schedule.qualityLabel}
                </span>
              </div>
              <p className="schedule-results__reasoning">
                {schedule.reasoning}
              </p>
              <div className="schedule-results__tags">
                {schedule.tags.map((tag) => (
                  <TextBadge key={tag} content={tag} />
                ))}
              </div>
              <div className="schedule-results__courses">
                {schedule.courses.map((course) => (
                  <span
                    key={`${course.dept}-${course.number}`}
                    className="course-chip"
                  >
                    {course.dept} {course.number}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="schedule-results__footer">
        {isOptimizing && (
          <div className="schedule-results__optimizing">
            <div className="schedule-results__spinner" />
            <span>{optimizationStatus || "Optimizing..."}</span>
          </div>
        )}
        <div className="schedule-results__footer-buttons">
          {onOptimize && !isOptimizing && (
            <Button
              label="Optimize with CP-SAT"
              onClick={onOptimize}
              disabled={isOptimizing}
            />
          )}
          <Button
            label="Refine Preferences"
            type="secondary"
            onClick={onRefine}
          />
        </div>
      </div>
    </div>
  );
};

export default ScheduleResults;
