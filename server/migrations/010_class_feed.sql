-- Phase 2b-3: Class Feed (Posts + Comments + Likes). See
-- ps-work:projects/personal/engineering/ClassOps/phase2b3-product-spec.md.
--
-- Entirely independent of the Session/check-in/Exit-Ticket and Category/Assignment/Score tables
-- -- nothing here reads attendance or gradebook data, and nothing there reads this.

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  link_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_section_idx ON posts (section_id, created_at DESC);

-- No edit column set -- Comments are delete-and-repost only, per the product spec.
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at);

-- A plain toggle, not a count of repeated likes -- UNIQUE enforces at most one Like row per
-- (post, user). Posts only; there is no comment_id column here by design.
CREATE TABLE likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
CREATE INDEX likes_post_idx ON likes (post_id);
