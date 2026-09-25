-- Exam practice: ITPEC IT Passport (PS-TASK-20260925-751). See
-- ../../itpec-ip-practice-development-plan.md. The number 012 was reserved for this module; the
-- runner applies unapplied files in name order, so it lands after 013/014 on existing databases.
--
-- Content arrives as ps-practice-package/v1 files imported from outside this repository
-- (scripts/import-practice.ts). None of it -- question text, answer keys, figures -- lives in app/,
-- which is mirrored to a public repository. Figures are stored here and served by an
-- authenticated route instead of static files.

CREATE TABLE exam_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id text NOT NULL UNIQUE CHECK (content_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  family text NOT NULL,
  title text NOT NULL,
  subtitle text,
  provider text NOT NULL,
  session_label text,
  item_count integer NOT NULL CHECK (item_count > 0),
  time_limit_minutes integer CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  languages text[] NOT NULL CHECK (cardinality(languages) > 0 AND languages <@ ARRAY['en', 'th']::text[]),
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_provenance text NOT NULL,
  answer_key_provenance text NOT NULL,
  attribution text NOT NULL,
  translation_note text,
  content_hash char(64) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE practice_figures (
  id text PRIMARY KEY CHECK (id ~ '^[0-9A-Za-z_-]{1,80}$'),
  exam_session_id uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  mime text NOT NULL CHECK (mime IN ('image/png')),
  sha256 char(64) NOT NULL,
  data bytea NOT NULL
);
CREATE INDEX practice_figures_session_idx ON practice_figures (exam_session_id);

CREATE TABLE practice_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_session_id uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  content_id text NOT NULL UNIQUE,
  seq integer NOT NULL CHECK (seq > 0),
  stem jsonb NOT NULL,        -- {en, th?}
  options jsonb NOT NULL,     -- [{label, text: {en, th?}}]
  answer text NOT NULL,       -- an option label; server-only, never sent before the answer
  category text NOT NULL,
  field text NOT NULL,
  figure_en text REFERENCES practice_figures(id),
  figure_th text REFERENCES practice_figures(id),
  UNIQUE (exam_session_id, seq)
);
CREATE INDEX practice_questions_category_idx ON practice_questions (category);

-- Practice is opt-in per Section (decision 4, 2026-09-25): a teacher enables it.
ALTER TABLE sections ADD COLUMN practice_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE practice_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('browse', 'practice', 'quiz')),
  exam_session_id uuid REFERENCES exam_sessions(id) ON DELETE CASCADE, -- NULL: every session (quiz)
  category text,                                                      -- NULL: every category
  lang text NOT NULL CHECK (lang IN ('en', 'th')),
  question_ids uuid[] NOT NULL CHECK (cardinality(question_ids) > 0), -- fixed at start, in order
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'finished')),
  correct_count integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((status = 'finished') = (finished_at IS NOT NULL))
);
CREATE INDEX practice_attempts_section_user_idx ON practice_attempts (section_id, user_id, started_at DESC);

CREATE TABLE practice_answers (
  attempt_id uuid NOT NULL REFERENCES practice_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES practice_questions(id) ON DELETE CASCADE,
  selected text NOT NULL,
  is_correct boolean NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);
