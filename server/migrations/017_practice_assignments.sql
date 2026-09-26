-- Exam practice Phase 3a (PS-TASK-20260926-785): practice assignments a teacher sets for a Section.
--
-- They follow section_activities: draft/open/closed, opens/due dates, max attempts, and an
-- evidence policy. An assignment's questions are fixed when it is created: a whole session in
-- order, or a set drawn once for everyone. Each attempt is an 'exam'-mode practice_attempt tied to
-- the assignment, so the mock-exam engine (no key until finished, a server deadline) is reused.
CREATE TABLE practice_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('exam', 'set')),
  exam_session_id uuid REFERENCES exam_sessions(id) ON DELETE RESTRICT, -- NULL: a set drawn from every session
  category text,
  question_ids uuid[] NOT NULL CHECK (cardinality(question_ids) > 0),
  time_limit_seconds integer CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  opens_at timestamptz,
  due_at timestamptz,
  max_attempts integer CHECK (max_attempts IS NULL OR max_attempts > 0),
  evidence_policy text NOT NULL DEFAULT 'best' CHECK (evidence_policy IN ('first', 'best', 'last', 'mean')),
  review_policy text NOT NULL DEFAULT 'after_due' CHECK (review_policy IN ('after_due', 'after_submit')),
  -- Opt-in gradebook link for the teacher-triggered sync (Phase 3b).
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at IS NULL OR due_at IS NULL OR due_at > opens_at),
  CHECK (kind <> 'exam' OR exam_session_id IS NOT NULL)
);
CREATE INDEX practice_assignments_section_idx ON practice_assignments (section_id, created_at DESC);

ALTER TABLE practice_attempts
  ADD COLUMN practice_assignment_id uuid REFERENCES practice_assignments(id) ON DELETE CASCADE,
  ADD CONSTRAINT practice_attempts_assignment_mode_check
    CHECK (practice_assignment_id IS NULL OR mode = 'exam');
CREATE INDEX practice_attempts_assignment_idx ON practice_attempts (practice_assignment_id, user_id);

-- An untimed assignment attempt still ends at the assignment's due date, so a deadline no longer
-- implies a time limit (a time limit still implies a deadline).
ALTER TABLE practice_attempts DROP CONSTRAINT practice_attempts_deadline_check;
ALTER TABLE practice_attempts ADD CONSTRAINT practice_attempts_deadline_check
  CHECK (time_limit_seconds IS NULL OR deadline_at IS NOT NULL);
