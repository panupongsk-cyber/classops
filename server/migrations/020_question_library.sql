-- Private browse library; no foreign keys to Practice's historical content or attempts.
CREATE TABLE library_exams (
  source_id text PRIMARY KEY,
  revision char(64) NOT NULL,
  source_commit text NOT NULL,
  source_path text NOT NULL,
  metadata jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE library_questions (
  exam_id text NOT NULL REFERENCES library_exams(source_id) ON DELETE CASCADE,
  source_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  content jsonb NOT NULL,
  PRIMARY KEY (exam_id, source_id),
  UNIQUE (exam_id, seq)
);
CREATE TABLE library_figures (
  exam_id text NOT NULL REFERENCES library_exams(source_id) ON DELETE CASCADE,
  source_id text NOT NULL,
  sha256 char(64) NOT NULL,
  data bytea NOT NULL,
  PRIMARY KEY (exam_id, source_id)
);
