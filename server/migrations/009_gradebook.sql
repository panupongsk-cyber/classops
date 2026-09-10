-- Phase 2b-2: Gradebook (weighted categories) + CSV export. See
-- ps-work:projects/personal/engineering/ClassOps/phase2b2-product-spec.md.
--
-- Entirely separate from attendance (class_sessions/session_checkins) -- Category/Assignment/
-- Score are Section-scoped, the same primitive Session already uses, but nothing here reads
-- check-in data.

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  name text NOT NULL,
  weight numeric NOT NULL CHECK (weight > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_section_idx ON categories (section_id);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  max_points numeric NOT NULL CHECK (max_points > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignments_category_idx ON assignments (category_id);

-- Extra credit is allowed (see the product spec's "Extra credit is allowed" note): pointsEarned
-- is not capped at the assignment's maxPoints, only floored at zero.
CREATE TABLE scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points_earned numeric NOT NULL CHECK (points_earned >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, user_id)
);
CREATE INDEX scores_assignment_idx ON scores (assignment_id);
CREATE INDEX scores_user_idx ON scores (user_id);
