import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { loadGradebookInputs } from "./gradebook.js";

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// The denominator (Sessions with opened_at IS NOT NULL) is a single Section-wide count, not
// recomputed per student -- so the null case ("this Section has never opened check-in for any
// Session yet") is identical for every student in the Section, never a source of one student's
// rate being null while another's isn't for an unrelated reason. See phase2b4-product-spec.md.
async function getAttendanceData(pool: DatabasePool, sectionId: string) {
  const openedResult = await pool.query<{ count: string }>(
    "SELECT count(*)::int AS count FROM class_sessions WHERE section_id = $1 AND opened_at IS NOT NULL",
    [sectionId],
  );
  const openedSessionsCount = Number(openedResult.rows[0]?.count ?? 0);

  const checkedInResult = await pool.query<{ user_id: string; checked_in_count: string }>(
    `SELECT checkin.user_id, count(*)::int AS checked_in_count
     FROM session_checkins AS checkin
     JOIN class_sessions AS session ON session.id = checkin.session_id
     WHERE session.section_id = $1 AND session.opened_at IS NOT NULL
     GROUP BY checkin.user_id`,
    [sectionId],
  );
  const checkedInByUser = new Map(
    checkedInResult.rows.map((row) => [row.user_id, Number(row.checked_in_count)]),
  );

  return { openedSessionsCount, checkedInByUser };
}

function attendanceRateFor(
  userId: string,
  attendance: { openedSessionsCount: number; checkedInByUser: Map<string, number> },
) {
  if (attendance.openedSessionsCount <= 0) return null;
  const checkedIn = attendance.checkedInByUser.get(userId) ?? 0;
  return checkedIn / attendance.openedSessionsCount;
}

// Always-defined counts (0 is a real answer) -- unlike attendance rate and grade summary, there
// is no "not enough data yet" null case here.
async function getFeedTotals(pool: DatabasePool, sectionId: string) {
  const result = await pool.query<{
    total_posts: string;
    total_comments: string;
    total_likes: string;
  }>(
    `SELECT
       (SELECT count(*) FROM posts WHERE section_id = $1) AS total_posts,
       (SELECT count(*) FROM comments AS comment
          JOIN posts AS post ON post.id = comment.post_id
          WHERE post.section_id = $1) AS total_comments,
       (SELECT count(*) FROM likes AS like_row
          JOIN posts AS post ON post.id = like_row.post_id
          WHERE post.section_id = $1) AS total_likes`,
    [sectionId],
  );
  const row = result.rows[0];
  return {
    totalPosts: Number(row?.total_posts ?? 0),
    totalComments: Number(row?.total_comments ?? 0),
    totalLikes: Number(row?.total_likes ?? 0),
  };
}

export async function registerStatsRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  async function requireManager(request: FastifyRequest, reply: FastifyReply, sectionId: string) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) {
        await reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      }
    }
    return user;
  }

  // Class-wide view: a Section-wide summary plus a per-student breakdown, in one response --
  // mirrors how Gradebook's own JSON view already combines a summary-shaped computation with a
  // per-student list, not two disconnected features. owner/teacher/ta only.
  app.get("/api/sections/:sectionId/stats", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    const user = await requireManager(request, reply, sectionId);
    if (!user) return;

    const [{ students, gradeByUserId }, attendance, feedTotals] = await Promise.all([
      loadGradebookInputs(pool, sectionId),
      getAttendanceData(pool, sectionId),
      getFeedTotals(pool, sectionId),
    ]);

    const studentRows = students.map((student) => {
      const grade = gradeByUserId.get(student.user_id);
      return {
        userId: student.user_id,
        displayName: student.display_name,
        email: student.email,
        attendanceRate: attendanceRateFor(student.user_id, attendance),
        finalGrade: grade?.finalGrade ?? null,
      };
    });

    const definedAttendanceRates = studentRows
      .map((row) => row.attendanceRate)
      .filter((value): value is number => value !== null);
    const definedFinalGrades = studentRows
      .map((row) => row.finalGrade)
      .filter((value): value is number => value !== null);

    return reply.send({
      summary: {
        averageAttendanceRate: average(definedAttendanceRates),
        averageFinalGrade: average(definedFinalGrades),
        minFinalGrade: definedFinalGrades.length ? Math.min(...definedFinalGrades) : null,
        maxFinalGrade: definedFinalGrades.length ? Math.max(...definedFinalGrades) : null,
        ...feedTotals,
      },
      students: studentRows,
    });
  });

  // Personal view: the caller may always view their own; owner/teacher/ta may view any Section
  // member's -- a plain member requesting a different member's personal view is rejected. No
  // feed-engagement numbers here, per the product spec.
  app.get("/api/sections/:sectionId/stats/students/:userId", async (request, reply) => {
    const { sectionId, userId } = request.params as { sectionId: string; userId: string };
    const caller = await requireCurrentUser(request, reply, pool, config);
    if (!caller) return;

    if (!caller.isPlatformAdmin) {
      const callerRoles = await getSectionRoles(pool, caller.id, sectionId);
      if (callerRoles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
      if (caller.id !== userId && !canManageSessions(callerRoles)) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
    }

    const targetRoles = await getSectionRoles(pool, userId, sectionId);
    if (targetRoles.length === 0) {
      return reply.code(404).send({ error: "SECTION_MEMBER_NOT_FOUND" });
    }

    const [{ gradeByUserId }, attendance] = await Promise.all([
      loadGradebookInputs(pool, sectionId),
      getAttendanceData(pool, sectionId),
    ]);
    const grade = gradeByUserId.get(userId);

    return reply.send({
      userId,
      attendanceRate: attendanceRateFor(userId, attendance),
      finalGrade: grade?.finalGrade ?? null,
    });
  });
}
