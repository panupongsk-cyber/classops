-- Face check-in: a third check_in_method ('face') for the Phase 2a attendance module.
-- 1:1 identity verification: a signed-in student's browser computes a 128-D face embedding and
-- submits it with a single-use nonce; the server matches it against the account's own enrollment
-- by cosine similarity. See face-checkin-product-spec.md (PS-TASK-20261030-2890).

-- Extend the check_in_method domain from ('qr','emoji') to include 'face'. The constraint name is
-- Postgres's auto-generated <table>_<column>_check (same convention as migrations 004/006/013/017).
ALTER TABLE class_sessions DROP CONSTRAINT class_sessions_check_in_method_check;
ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_check_in_method_check
  CHECK (check_in_method IN ('qr', 'emoji', 'face'));

-- Enrollment is per account, not per section: face verification is 1:1 against the signed-in user.
-- `embeddings` holds 3-5 x 128-D vectors as a JSON array of arrays (validated by the API), never
-- raw images. `liveness` is audit-only (challenge types the browser passed during capture).
CREATE TABLE face_enrollments (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embeddings jsonb NOT NULL,
  liveness text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Single-use, short-lived challenges bound to (session, user). Re-issuing a challenge replaces the
-- row (ON CONFLICT upsert in the route), so the table is bounded by open sessions x members, and
-- rows cascade away with the session/user.
CREATE TABLE face_checkin_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  challenge text NOT NULL CHECK (challenge IN ('blink', 'turn-left', 'turn-right')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX face_checkin_nonces_session_idx ON face_checkin_nonces (session_id);
