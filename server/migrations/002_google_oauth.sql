CREATE TABLE oauth_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash char(64) NOT NULL UNIQUE,
  sealed_context text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_transactions_active_idx
  ON oauth_transactions (expires_at)
  WHERE used_at IS NULL;
