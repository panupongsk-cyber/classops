-- Exam practice Phase 2b (PS-TASK-20260925-770): personal progress.
--
-- Bookmarks are per learner and per Section, like the rest of practice. Mistakes, statistics, and
-- the most-missed ranking are computed from practice_answers, so they need no table. They never
-- count answers from a mock exam still in progress, whose correctness is hidden until it ends.
CREATE TABLE practice_bookmarks (
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES practice_questions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, user_id, question_id)
);

-- Per-Section answer lookups (statistics, ranking) go through the attempt.
CREATE INDEX practice_answers_question_idx ON practice_answers (question_id);
