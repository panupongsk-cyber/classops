-- Learning activities, Phase 2 (PS-TASK-20260925-734): the `mean` evidence policy, and the
-- provenance a teacher-triggered gradebook sync needs. 012 stays reserved for the ITPEC practice
-- plan; the runner applies any unapplied file in name order, so the gap is harmless.

ALTER TABLE section_activities DROP CONSTRAINT section_activities_evidence_policy_check;
ALTER TABLE section_activities ADD CONSTRAINT section_activities_evidence_policy_check
  CHECK (evidence_policy IN ('first', 'best', 'last', 'mean'));

-- Which activity last wrote this score, and the exact points it wrote. A score whose
-- points_earned no longer equals synced_points was edited by hand after that sync (or was never
-- synced), and a later sync leaves it alone unless the teacher explicitly ticks it.
ALTER TABLE scores ADD COLUMN synced_from_activity_id uuid REFERENCES section_activities(id) ON DELETE SET NULL;
ALTER TABLE scores ADD COLUMN synced_points numeric;
ALTER TABLE scores ADD COLUMN synced_at timestamptz;
