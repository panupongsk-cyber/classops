-- Roster import from the registrar's student list (PS-TASK-20260925-744).
--
-- Students cannot be pre-created as `users`: a users row without an auth identity makes their
-- first Google sign-in fail as an email collision (oauth-flow.ts). So a roster row for someone
-- without an account waits here, and is claimed (turned into a student Membership) when that
-- email signs in, or when a joiner enters its student ID with the Section's join code.
CREATE TABLE section_roster_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  email citext NOT NULL,
  student_id text NOT NULL CHECK (student_id ~ '^[0-9A-Za-z-]{1,32}$'),
  name_th text CHECK (name_th IS NULL OR length(name_th) <= 200),
  name_en text CHECK (name_en IS NULL OR length(name_en) <= 200),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, email),
  UNIQUE (section_id, student_id)
);
CREATE INDEX section_roster_entries_email_idx ON section_roster_entries (email);

-- The official record a membership came from: names as the registrar spells them (shown to staff
-- instead of the Google display name), and the email the roster listed. A roster_email that
-- differs from the account's email means the student claimed the row by student ID from another
-- account (a personal Gmail); staff see that flagged.
ALTER TABLE memberships ADD COLUMN roster_name_th text CHECK (roster_name_th IS NULL OR length(roster_name_th) <= 200);
ALTER TABLE memberships ADD COLUMN roster_name_en text CHECK (roster_name_en IS NULL OR length(roster_name_en) <= 200);
ALTER TABLE memberships ADD COLUMN roster_email citext;
