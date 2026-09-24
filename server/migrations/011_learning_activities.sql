-- Learning activities (server-scored games) + learner student IDs. See
-- personalschema:work/projects/personal/engineering/ClassOps/classops-learning-games-development-plan.md
-- (PS-TASK-20260924-683 plan, PS-TASK-20260925-687 implementation).
--
-- Packages are imported at runtime from a private source (src/scripts/import-activity.ts);
-- `spec` holds the full package including answer keys and is never returned raw by any route.
-- The schema is generic on purpose: a new item type is a scorer + package change, never a new
-- migration.

-- Learner-entered student ID, per Section membership. Not treated as sensitive data (decision
-- recorded in the plan, 2026-09-25), but still only returned to Section managers.
ALTER TABLE memberships
  ADD COLUMN student_id text CHECK (student_id IS NULL OR student_id ~ '^[0-9A-Za-z-]{1,32}$');

CREATE TABLE activity_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9-]{1,64}$'),
  version integer NOT NULL CHECK (version > 0),
  content_hash char(64) NOT NULL,
  title jsonb NOT NULL,
  languages text[] NOT NULL CHECK (cardinality(languages) > 0 AND languages <@ ARRAY['th', 'en']::text[]),
  spec jsonb NOT NULL,
  imported_by uuid REFERENCES users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

CREATE TABLE section_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES activity_packages(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  opens_at timestamptz,
  due_at timestamptz,
  max_attempts integer CHECK (max_attempts IS NULL OR max_attempts > 0),
  evidence_policy text NOT NULL DEFAULT 'first' CHECK (evidence_policy IN ('first', 'best', 'last')),
  -- Opt-in gradebook link for the later teacher-triggered sync; unused by Phase 1 routes.
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at IS NULL OR due_at IS NULL OR due_at > opens_at)
);
CREATE INDEX section_activities_section_idx ON section_activities (section_id);
CREATE INDEX section_activities_package_idx ON section_activities (package_id);

-- Each attempt pins its package version and a secret shuffle/token seed, so results can be
-- re-scored from stored responses after a scorer fix.
CREATE TABLE activity_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_activity_id uuid NOT NULL REFERENCES section_activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES activity_packages(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  shuffle_seed text NOT NULL CHECK (shuffle_seed ~ '^[0-9a-f]{32,128}$'),
  lang text NOT NULL CHECK (lang IN ('th', 'en')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'finished', 'abandoned')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  score_ratio numeric CHECK (score_ratio IS NULL OR (score_ratio >= 0 AND score_ratio <= 1)),
  band_index integer CHECK (band_index IS NULL OR band_index >= 0),
  stage_results jsonb,
  scorer_version text NOT NULL,
  UNIQUE (section_activity_id, user_id, attempt_no),
  CHECK ((status = 'finished') = (finished_at IS NOT NULL))
);
CREATE INDEX activity_attempts_section_activity_idx ON activity_attempts (section_activity_id);
CREATE INDEX activity_attempts_user_idx ON activity_attempts (user_id);
CREATE UNIQUE INDEX activity_attempts_one_open_idx
  ON activity_attempts (section_activity_id, user_id) WHERE status = 'in_progress';

CREATE TABLE activity_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES activity_attempts(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  answer jsonb NOT NULL,
  ratio numeric NOT NULL CHECK (ratio >= 0 AND ratio <= 1),
  flags text[] NOT NULL DEFAULT '{}',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, item_key)
);
CREATE INDEX activity_responses_attempt_idx ON activity_responses (attempt_id);
