-- Class Feed attachments (#2438). Staff attach files to a Post; files live here, in PostgreSQL,
-- so the existing pg_dump backup and the rehearsed restore cover them with no new volume.
-- The server decides the content type from the file's bytes (src/attachments.ts); the CHECKs
-- repeat its limits so no other path can store something larger or of another type.

CREATE TABLE post_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (content_type IN (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain; charset=utf-8'
  )),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 char(64) NOT NULL,
  data bytea NOT NULL CHECK (octet_length(data) = size_bytes),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_attachments_post_idx ON post_attachments (post_id, created_at);

-- Stored out of line and uncompressed (the allowed types are mostly compressed already), so the
-- download route's substring() reads only the slice it asks for instead of detoasting the file.
ALTER TABLE post_attachments ALTER COLUMN data SET STORAGE EXTERNAL;
