-- Section-scoped Python code exercises (pilot). Code runs on a Piston execution API; see
-- src/code-runner.ts. Tests are visible to students in this slice (no hidden tests).

CREATE TABLE code_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  prompt text NOT NULL DEFAULT '',
  starter_code text NOT NULL DEFAULT '',
  -- Array of {name?, stdin, expected_stdout}, 1..10 entries, validated by the API.
  tests jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(tests) = 'array')
);
CREATE INDEX code_exercises_section_idx ON code_exercises (section_id);

-- One latest submission per student per exercise: resubmitting upserts (like exit tickets).
CREATE TABLE code_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES code_exercises(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  results jsonb NOT NULL,
  passed_count integer NOT NULL CHECK (passed_count >= 0),
  total_count integer NOT NULL CHECK (total_count >= 0 AND passed_count <= total_count),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exercise_id, user_id)
);
CREATE INDEX code_submissions_exercise_idx ON code_submissions (exercise_id);
