-- Exam practice Phase 3b (PS-TASK-20260926-789): gradebook sync for practice assignments.
--
-- As for learning activities (013): which practice assignment last wrote this score. With
-- scores.synced_points, a later sync can tell a cell it wrote itself (safe to update) from one a
-- teacher edited by hand (left alone unless explicitly ticked).
ALTER TABLE scores ADD COLUMN synced_from_practice_assignment_id uuid REFERENCES practice_assignments(id) ON DELETE SET NULL;
