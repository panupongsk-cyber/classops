-- Where a membership's student ID came from (#2447). `student_id` is written both by roster
-- enrolment and by the learner (join with a student ID, or PUT /me/student-id), and the learner
-- may overwrite a roster ID. `roster_student_id` keeps the ID the registrar's roster gave, so the
-- gradebook import can warn when a row matches only by an ID the learner typed.
--
-- Backfill: every roster enrolment also wrote roster_email, so a membership with roster_email
-- came from the roster. Its current student_id is taken as the roster's; a learner change made
-- before this migration cannot be told apart and counts as roster-backed.

ALTER TABLE memberships
  ADD COLUMN roster_student_id text
  CHECK (roster_student_id IS NULL OR roster_student_id ~ '^[0-9A-Za-z-]{1,32}$');

UPDATE memberships SET roster_student_id = student_id
WHERE roster_email IS NOT NULL AND student_id IS NOT NULL;
