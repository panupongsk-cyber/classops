-- Phase 1 drops password authentication and the transactional mail worker entirely (not merely
-- deferred): v2 has no migrated users, so there is nothing to preserve, and no Phase 1 feature
-- sends email. See ps-work:projects/personal/engineering/ClassOps/phase1-product-spec.md.

DROP TABLE email_verification_tokens;
DROP TABLE password_reset_tokens;
DROP TABLE email_outbox;

ALTER TABLE auth_identities DROP CONSTRAINT auth_identities_check;
ALTER TABLE auth_identities DROP COLUMN password_hash;
ALTER TABLE auth_identities DROP CONSTRAINT auth_identities_provider_check;
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider_check
  CHECK (provider IN ('google'));

-- 'pending_verification' existed only for unverified password registrations; Google sign-in
-- always creates an 'active' user (its email_verified claim is checked before account creation).
UPDATE users SET status = 'active' WHERE status = 'pending_verification';
ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended'));
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
