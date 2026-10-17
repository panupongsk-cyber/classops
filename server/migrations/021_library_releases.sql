-- Immutable archive plus transactional active projection; entirely separate from Practice.
CREATE TABLE library_media_blobs (
 sha256 char(64) PRIMARY KEY, mime text NOT NULL CHECK(mime='image/png'), data bytea NOT NULL
);
CREATE TABLE library_paper_revisions (
 revision char(64) PRIMARY KEY, paper_id text NOT NULL, metadata jsonb NOT NULL,
 questions jsonb NOT NULL, figures jsonb NOT NULL, source_commit text NOT NULL,
 source_path text NOT NULL, package_format text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE library_releases (
 revision char(64) PRIMARY KEY, manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE library_release_papers (
 release_revision char(64) NOT NULL REFERENCES library_releases(revision),
 paper_id text NOT NULL, paper_revision char(64) NOT NULL REFERENCES library_paper_revisions(revision),
 PRIMARY KEY(release_revision,paper_id)
);
CREATE TABLE library_release_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 active_revision char(64) NOT NULL REFERENCES library_releases(revision), activated_at timestamptz NOT NULL
);
CREATE TABLE library_activation_history (
 id bigserial PRIMARY KEY, revision char(64) NOT NULL REFERENCES library_releases(revision),
 previous_revision char(64) REFERENCES library_releases(revision), operator text NOT NULL,
 reason text NOT NULL, activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION library_archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Library archive is immutable'; END;
$$;
CREATE TRIGGER immutable_library_blobs BEFORE UPDATE OR DELETE ON library_media_blobs FOR EACH ROW EXECUTE FUNCTION library_archive_immutable();
CREATE TRIGGER immutable_library_papers BEFORE UPDATE OR DELETE ON library_paper_revisions FOR EACH ROW EXECUTE FUNCTION library_archive_immutable();
CREATE TRIGGER immutable_library_releases BEFORE UPDATE OR DELETE ON library_releases FOR EACH ROW EXECUTE FUNCTION library_archive_immutable();
CREATE TRIGGER immutable_library_release_papers BEFORE UPDATE OR DELETE ON library_release_papers FOR EACH ROW EXECUTE FUNCTION library_archive_immutable();
CREATE TRIGGER immutable_library_activation_history BEFORE UPDATE OR DELETE ON library_activation_history FOR EACH ROW EXECUTE FUNCTION library_archive_immutable();
