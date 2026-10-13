-- ITPE IP practice Phase 4 (PS-TASK-20261013-1777): supplementary answer explanations.
--
-- ITPEC's official answer PDFs publish only the letter, so practice never explained an answer.
-- Explanations are this course's own supplementary text (never ITPEC content) and are served to a
-- browser only when the key is already revealed, following the same lock rules as the answer
-- itself (see questionView in src/routes/practice.ts).
ALTER TABLE practice_questions ADD COLUMN explanation jsonb;
