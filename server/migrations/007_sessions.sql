-- Phase 2a: Session scheduling, QR/Emoji check-in, roster. See
-- ps-work:projects/personal/engineering/ClassOps/phase2a-product-spec.md.
--
-- Deviation from the spec's literal naming: the domain table is `class_sessions`, not `sessions`
-- -- migration 001 already created a `sessions` table for login sessions, and the spec's `Session`
-- model didn't anticipate that collision. API routes still read as `/api/sessions/...` since a URL
-- path has no such collision; only the SQL identifier changes.
--
-- `day_of_week` follows Postgres's own `extract(dow from ...)` convention (0 = Sunday .. 6 =
-- Saturday), not ISO 8601 (1 = Monday .. 7 = Sunday), so the Session generator's date-matching
-- query needs no translation.

ALTER TABLE sections ADD COLUMN term_start_date date;
ALTER TABLE sections ADD COLUMN term_end_date date;
ALTER TABLE sections ADD CONSTRAINT sections_term_dates_check
  CHECK (term_start_date IS NULL OR term_end_date IS NULL OR term_start_date <= term_end_date);

CREATE TABLE session_schedule_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_time < end_time)
);
CREATE INDEX session_schedule_patterns_section_idx ON session_schedule_patterns (section_id);

CREATE TABLE class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  check_in_method text CHECK (check_in_method IN ('qr', 'emoji')),
  opened_at timestamptz,
  closed_at timestamptz,
  qr_code text,
  qr_code_expires_at timestamptz,
  active_emoji text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, scheduled_start),
  CHECK (scheduled_start < scheduled_end),
  CHECK (closed_at IS NULL OR opened_at IS NOT NULL)
);
CREATE INDEX class_sessions_section_idx ON class_sessions (section_id);

CREATE TABLE session_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX session_checkins_session_idx ON session_checkins (session_id);
