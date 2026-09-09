-- Phase 1 shared-core primitive every future module (attendance, ITPE quiz-app, OmniQuizOps)
-- attaches to. See ps-work:projects/personal/engineering/ClassOps/phase1-product-spec.md.

ALTER TABLE users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  type text NOT NULL CHECK (type IN ('semester', 'self_paced', 'short_course')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term text NOT NULL,
  label text NOT NULL DEFAULT 'default',
  join_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, term, label)
);
CREATE INDEX sections_course_idx ON sections (course_id);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  roles text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, section_id),
  CHECK (cardinality(roles) > 0),
  CHECK (roles <@ ARRAY['owner', 'teacher', 'student', 'ta']::text[])
);
CREATE INDEX memberships_section_idx ON memberships (section_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);
