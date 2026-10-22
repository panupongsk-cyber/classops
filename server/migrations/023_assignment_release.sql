-- Student-facing grade view (#2436). A student sees an Assignment's score only once a manager
-- releases that Assignment. NULL means not released; every existing Assignment starts hidden,
-- so turning this feature on never exposes a score a teacher was still marking.

ALTER TABLE assignments ADD COLUMN released_at timestamptz;
