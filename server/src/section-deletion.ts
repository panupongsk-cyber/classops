import type { DatabasePool } from "./db.js";

/**
 * One reason a Section cannot be deleted yet. `resource` is a stable key the browser translates;
 * `count` lets the message say how much is in the way without exposing row contents.
 */
export interface DeletionBlocker {
  resource: string;
  count: number;
}

type Queryable = Pick<DatabasePool, "query">;

/**
 * Everything that makes a Section non-empty. Deleting a Section cascades to every one of these
 * tables, so an unguarded delete would silently destroy teaching history.
 *
 * Memberships block only when they belong to a learner (`student`) other than the caller. Staff
 * memberships are assignments to the Section, not learning records, and a platform admin deleting
 * an unused Course has to be able to remove the empty Sections a teacher owns.
 */
export async function sectionDeletionBlockers(
  db: Queryable,
  sectionId: string,
  callerUserId: string,
): Promise<DeletionBlocker[]> {
  const result = await db.query<DeletionBlocker>(
    `SELECT 'students' AS resource, count(*)::int AS count
       FROM memberships WHERE section_id = $1 AND user_id <> $2 AND 'student' = ANY(roles)
     UNION ALL SELECT 'sessions', count(*)::int FROM class_sessions WHERE section_id = $1
     UNION ALL SELECT 'schedule', count(*)::int FROM session_schedule_patterns WHERE section_id = $1
     UNION ALL SELECT 'activities', count(*)::int FROM section_activities WHERE section_id = $1
     UNION ALL SELECT 'posts', count(*)::int FROM posts WHERE section_id = $1
     UNION ALL SELECT 'gradebook', count(*)::int FROM categories WHERE section_id = $1
     UNION ALL SELECT 'practiceAttempts', count(*)::int FROM practice_attempts WHERE section_id = $1
     UNION ALL SELECT 'practiceAssignments', count(*)::int FROM practice_assignments WHERE section_id = $1
     UNION ALL SELECT 'bookmarks', count(*)::int FROM practice_bookmarks WHERE section_id = $1 AND user_id <> $2
     UNION ALL SELECT 'roster', count(*)::int FROM section_roster_entries WHERE section_id = $1
     ORDER BY resource`,
    [sectionId, callerUserId],
  );
  return result.rows.filter((row) => row.count > 0);
}
