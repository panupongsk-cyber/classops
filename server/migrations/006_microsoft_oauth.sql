-- Phase 1.5 adds Microsoft as a second OAuth provider alongside Google. See
-- ps-work:projects/personal/engineering/ClassOps/phase1-5-product-spec.md.

ALTER TABLE auth_identities DROP CONSTRAINT auth_identities_provider_check;
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider_check
  CHECK (provider IN ('google', 'microsoft'));
