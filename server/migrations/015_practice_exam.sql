-- Exam practice Phase 2a (PS-TASK-20260925-767): the timed mock exam.
--
-- A mock exam is a whole session in exam order with no feedback until it is submitted. Answers can
-- be changed and questions flagged while it runs. A timed attempt gets a server-side deadline:
-- answers after it are refused, and the attempt is finished (reason 'time_up') the next time it is
-- read. Untimed attempts leave the deadline NULL.
ALTER TABLE practice_attempts DROP CONSTRAINT practice_attempts_mode_check;
ALTER TABLE practice_attempts ADD CONSTRAINT practice_attempts_mode_check
  CHECK (mode IN ('browse', 'practice', 'quiz', 'exam'));

ALTER TABLE practice_attempts
  ADD COLUMN time_limit_seconds integer CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0),
  ADD COLUMN deadline_at timestamptz,
  ADD COLUMN flagged_question_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN finish_reason text CHECK (finish_reason IS NULL OR finish_reason IN ('submitted', 'time_up')),
  ADD CONSTRAINT practice_attempts_deadline_check
    CHECK ((time_limit_seconds IS NULL) = (deadline_at IS NULL)),
  ADD CONSTRAINT practice_attempts_exam_only_check
    CHECK (mode = 'exam' OR (time_limit_seconds IS NULL AND cardinality(flagged_question_ids) = 0));

-- In a mock exam an answer can be changed until submission; answered_at is its last change.
