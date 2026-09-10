-- Phase 2b-1: Exit Tickets + Random Picker. See
-- ps-work:projects/personal/engineering/ClassOps/phase2b1-product-spec.md.
--
-- Exit Ticket's open/close is independent of a class_sessions row's own opened_at/closed_at
-- (which track check-in, not the Exit Ticket) -- an Exit Ticket can be opened or closed
-- regardless of the Session's check-in state.

CREATE TABLE exit_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
CREATE INDEX exit_tickets_session_idx ON exit_tickets (session_id);
-- At most one open (closed_at IS NULL) Exit Ticket per Session at a time -- enforced here, not
-- only in the application, so a race between two requests can't create two open tickets.
CREATE UNIQUE INDEX exit_tickets_one_open_per_session ON exit_tickets (session_id)
  WHERE closed_at IS NULL;

-- Resubmission is an UPSERT (see the product spec's "Deviation from check-in's pattern"): a
-- student may revise their rating/comment until the ticket closes, unlike check-in's
-- idempotent-no-op.
CREATE TABLE exit_ticket_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_ticket_id uuid NOT NULL REFERENCES exit_tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exit_ticket_id, user_id)
);
CREATE INDEX exit_ticket_responses_ticket_idx ON exit_ticket_responses (exit_ticket_id);

-- One row per pick event (not a running counter) so pick history is directly queryable and the
-- "minimum pick count" fairness computation is a plain GROUP BY over real rows.
CREATE TABLE session_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  picked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_picks_session_idx ON session_picks (session_id);
