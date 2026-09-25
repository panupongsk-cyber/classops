import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const updateRoleSchema = z.object({
  isPlatformAdmin: z.boolean(),
});

const updateStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

const reassignOwnerSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});

function generateJoinCode() {
  return randomBytes(6).toString("base64url");
}

const listUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  role: z.enum(["all", "admin"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const listAuditLogsQuerySchema = z.object({
  search: z.string().trim().optional(),
  category: z.enum(["all", "auth", "admin", "section", "session", "user"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

async function requirePlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: DatabasePool,
  config: AppConfig,
) {
  const user = await requireCurrentUser(request, reply, pool, config);
  if (!user) return null;
  if (!user.isPlatformAdmin) {
    await reply.code(403).send({ error: "FORBIDDEN" });
    return null;
  }
  return user;
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  // GET /api/admin/overview - System KPI metrics and telemetry
  app.get("/api/admin/overview", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const [
      usersCountResult,
      activeUsersCountResult,
      coursesCountResult,
      sectionsCountResult,
      liveSessionsCountResult,
      todayCheckinsResult,
      recentUsersResult,
    ] = await Promise.all([
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM users"),
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE status = 'active'"),
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM courses"),
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM sections"),
      pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM class_sessions WHERE opened_at IS NOT NULL AND closed_at IS NULL",
      ),
      pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM session_checkins WHERE checked_in_at >= CURRENT_DATE",
      ),
      pool.query<{
        id: string;
        email: string;
        display_name: string;
        is_platform_admin: boolean;
        status: string;
        created_at: Date;
      }>(
        `SELECT id, email::text, display_name, is_platform_admin, status, created_at
         FROM users
         ORDER BY created_at DESC
         LIMIT 5`,
      ),
    ]);

    return reply.send({
      metrics: {
        totalUsers: Number.parseInt(usersCountResult.rows[0]?.count ?? "0", 10),
        activeUsers: Number.parseInt(activeUsersCountResult.rows[0]?.count ?? "0", 10),
        totalCourses: Number.parseInt(coursesCountResult.rows[0]?.count ?? "0", 10),
        totalSections: Number.parseInt(sectionsCountResult.rows[0]?.count ?? "0", 10),
        liveSessionsCount: Number.parseInt(liveSessionsCountResult.rows[0]?.count ?? "0", 10),
        todayCheckinsCount: Number.parseInt(todayCheckinsResult.rows[0]?.count ?? "0", 10),
      },
      recentUsers: recentUsersResult.rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        isPlatformAdmin: row.is_platform_admin,
        status: row.status,
        createdAt: row.created_at.toISOString(),
      })),
    });
  });

  // GET /api/admin/users - Paginated user directory with search and role filter
  app.get("/api/admin/users", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const parsedQuery = listUsersQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return validationError(reply, parsedQuery.error);

    const { search, role, page, limit } = parsedQuery.data;
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const params: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (search) {
      whereClauses.push(
        `(u.email ILIKE $${paramIndex} OR u.display_name ILIKE $${paramIndex})`,
      );
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (role === "admin") {
      whereClauses.push(`u.is_platform_admin = true`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countQuery = `SELECT count(*)::text AS total FROM users u ${whereSql}`;
    const countResult = await pool.query<{ total: string }>(countQuery, params);
    const total = Number.parseInt(countResult.rows[0]?.total ?? "0", 10);

    const dataParams = [...params, limit, offset];
    const dataQuery = `
      SELECT
        u.id,
        u.email::text,
        u.display_name,
        u.is_platform_admin,
        u.status,
        u.created_at,
        s.last_seen_at,
        COUNT(m.id)::int AS section_count
      FROM users u
      LEFT JOIN (
        SELECT user_id, MAX(last_seen_at) AS last_seen_at
        FROM sessions
        GROUP BY user_id
      ) s ON s.user_id = u.id
      LEFT JOIN memberships m ON m.user_id = u.id
      ${whereSql}
      GROUP BY u.id, u.email, u.display_name, u.is_platform_admin, u.status, u.created_at, s.last_seen_at
      ORDER BY u.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataResult = await pool.query<{
      id: string;
      email: string;
      display_name: string;
      is_platform_admin: boolean;
      status: string;
      created_at: Date;
      last_seen_at: Date | null;
      section_count: number;
    }>(dataQuery, dataParams);

    return reply.send({
      users: dataResult.rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        isPlatformAdmin: row.is_platform_admin,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
        sectionCount: Number(row.section_count || 0),
      })),
      total,
      page,
      limit,
    });
  });

  // PATCH /api/admin/users/:userId/role - Delegate or revoke platform admin role
  app.patch("/api/admin/users/:userId/role", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const { userId } = request.params as { userId: string };
    const parsedBody = updateRoleSchema.safeParse(request.body);
    if (!parsedBody.success) return validationError(reply, parsedBody.error);

    const { isPlatformAdmin } = parsedBody.data;

    // Self-demotion guard
    if (userId === admin.id && !isPlatformAdmin) {
      return reply.code(400).send({
        error: "CANNOT_DEMOTE_SELF",
        message: "You cannot remove your own platform admin privilege",
      });
    }

    // Lookup target user
    const targetUser = await pool.query<{ id: string; email: string; is_platform_admin: boolean }>(
      "SELECT id, email::text, is_platform_admin FROM users WHERE id = $1",
      [userId],
    );
    if (!targetUser.rowCount) {
      return reply.code(404).send({ error: "USER_NOT_FOUND" });
    }

    const target = targetUser.rows[0]!;

    // Root admin protection
    if (
      target.email.toLowerCase() === config.adminGoogleEmail.toLowerCase() &&
      !isPlatformAdmin
    ) {
      return reply.code(400).send({
        error: "CANNOT_DEMOTE_ROOT_ADMIN",
        message: "Root admin configured in environment cannot be demoted",
      });
    }

    await pool.query(
      "UPDATE users SET is_platform_admin = $1, updated_at = now() WHERE id = $2",
      [isPlatformAdmin, userId],
    );

    // Record in audit log
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES ($1::uuid, $2, 'user', $3, $4::jsonb)`,
      [
        admin.id,
        isPlatformAdmin ? "admin.promoted" : "admin.demoted",
        userId,
        JSON.stringify({ targetEmail: target.email, previous: target.is_platform_admin }),
      ],
    );

    return reply.send({
      success: true,
      userId,
      isPlatformAdmin,
    });
  });

  // PATCH /api/admin/users/:userId/status - Activate or suspend user account
  app.patch("/api/admin/users/:userId/status", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const { userId } = request.params as { userId: string };
    const parsedBody = updateStatusSchema.safeParse(request.body);
    if (!parsedBody.success) return validationError(reply, parsedBody.error);

    const { status } = parsedBody.data;

    // Self-suspension guard
    if (userId === admin.id && status === "suspended") {
      return reply.code(400).send({
        error: "CANNOT_SUSPEND_SELF",
        message: "You cannot suspend your own account",
      });
    }

    const targetUser = await pool.query<{ id: string; email: string; status: string }>(
      "SELECT id, email::text, status FROM users WHERE id = $1",
      [userId],
    );
    if (!targetUser.rowCount) {
      return reply.code(404).send({ error: "USER_NOT_FOUND" });
    }

    const target = targetUser.rows[0]!;

    if (
      target.email.toLowerCase() === config.adminGoogleEmail.toLowerCase() &&
      status === "suspended"
    ) {
      return reply.code(400).send({
        error: "CANNOT_SUSPEND_ROOT_ADMIN",
        message: "Root admin configured in environment cannot be suspended",
      });
    }

    await pool.query(
      "UPDATE users SET status = $1, updated_at = now() WHERE id = $2",
      [status, userId],
    );

    // If suspended, revoke all active sessions immediately
    if (status === "suspended") {
      await pool.query(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [userId],
      );
    }

    await pool.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES ($1::uuid, $2, 'user', $3, $4::jsonb)`,
      [
        admin.id,
        status === "suspended" ? "user.suspended" : "user.reactivated",
        userId,
        JSON.stringify({ targetEmail: target.email, previousStatus: target.status }),
      ],
    );

    return reply.send({
      success: true,
      userId,
      status,
    });
  });

  // GET /api/admin/courses - Global course and section catalog hierarchy
  app.get("/api/admin/courses", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const [coursesResult, sectionsResult] = await Promise.all([
      pool.query<{
        id: string;
        code: string;
        title: string;
        type: string;
        created_at: Date;
      }>(
        "SELECT id, code, title, type, created_at FROM courses ORDER BY code ASC",
      ),
      pool.query<{
        id: string;
        course_id: string;
        term: string;
        label: string;
        join_code: string;
        created_at: Date;
        student_count: number;
        total_members_count: number;
        owner_id: string | null;
        owner_email: string | null;
        owner_display_name: string | null;
      }>(
        `SELECT
           s.id,
           s.course_id,
           s.term,
           s.label,
           s.join_code,
           s.created_at,
           COALESCE(sc.student_count, 0)::int AS student_count,
           COALESCE(mc.total_members_count, 0)::int AS total_members_count,
           o.user_id AS owner_id,
           o.email::text AS owner_email,
           o.display_name AS owner_display_name
         FROM sections s
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS student_count
           FROM memberships m
           WHERE m.section_id = s.id AND 'student' = ANY(m.roles)
         ) sc ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS total_members_count
           FROM memberships m
           WHERE m.section_id = s.id
         ) mc ON true
         LEFT JOIN LATERAL (
           SELECT m.user_id, u.email, u.display_name
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.section_id = s.id AND 'owner' = ANY(m.roles)
           ORDER BY m.created_at ASC
           LIMIT 1
         ) o ON true
         ORDER BY s.term DESC, s.label ASC`,
      ),
    ]);

    const sectionsByCourse = new Map<string, any[]>();
    for (const s of sectionsResult.rows) {
      const list = sectionsByCourse.get(s.course_id) ?? [];
      list.push({
        id: s.id,
        term: s.term,
        label: s.label,
        joinCode: s.join_code,
        createdAt: s.created_at,
        studentCount: s.student_count,
        totalMembersCount: s.total_members_count,
        owner: s.owner_id
          ? {
              id: s.owner_id,
              email: s.owner_email,
              displayName: s.owner_display_name,
            }
          : null,
      });
      sectionsByCourse.set(s.course_id, list);
    }

    const courses = coursesResult.rows.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      type: c.type,
      createdAt: c.created_at,
      sections: sectionsByCourse.get(c.id) ?? [],
    }));

    return reply.send({ courses });
  });

  // PATCH /api/admin/sections/:sectionId/owner - Reassign section owner
  app.patch("/api/admin/sections/:sectionId/owner", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const { sectionId } = request.params as { sectionId: string };
    const parsedBody = reassignOwnerSchema.safeParse(request.body);
    if (!parsedBody.success) return validationError(reply, parsedBody.error);

    const { newOwnerUserId } = parsedBody.data;

    const sectionResult = await pool.query<{ id: string; course_id: string; term: string; label: string }>(
      "SELECT id, course_id, term, label FROM sections WHERE id = $1",
      [sectionId],
    );
    if (!sectionResult.rowCount) {
      return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    }
    const section = sectionResult.rows[0]!;

    const userResult = await pool.query<{ id: string; email: string; display_name: string; status: string }>(
      "SELECT id, email::text, display_name, status FROM users WHERE id = $1",
      [newOwnerUserId],
    );
    if (!userResult.rowCount) {
      return reply.code(404).send({ error: "USER_NOT_FOUND" });
    }
    const newOwner = userResult.rows[0]!;
    if (newOwner.status === "suspended") {
      return reply.code(400).send({
        error: "CANNOT_ASSIGN_SUSPENDED_USER",
        message: "Suspended users cannot be assigned as section owners",
      });
    }

    const previousOwners = await withTransaction(pool, async (client) => {
      const currentOwnersResult = await client.query<{
        user_id: string;
        email: string;
        display_name: string;
        roles: string[];
      }>(
        `SELECT m.user_id, u.email::text, u.display_name, m.roles
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.section_id = $1 AND 'owner' = ANY(m.roles)`,
        [sectionId],
      );

      await client.query(
        `UPDATE memberships
         SET roles = CASE
           WHEN array_remove(roles, 'owner') = '{}'::text[] THEN ARRAY['teacher']::text[]
           ELSE array_remove(roles, 'owner')
         END,
         updated_at = now()
         WHERE section_id = $1 AND 'owner' = ANY(roles) AND user_id != $2`,
        [sectionId, newOwnerUserId],
      );

      await client.query(
        `INSERT INTO memberships (user_id, section_id, roles)
         VALUES ($1, $2, ARRAY['owner', 'teacher']::text[])
         ON CONFLICT (user_id, section_id) DO UPDATE
         SET roles = CASE
           WHEN 'owner' = ANY(memberships.roles) THEN memberships.roles
           ELSE array_append(memberships.roles, 'owner')
         END,
         updated_at = now()`,
        [newOwnerUserId, sectionId],
      );

      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
         VALUES ($1::uuid, 'section.owner_reassigned', 'section', $2, $3::jsonb)`,
        [
          admin.id,
          sectionId,
          JSON.stringify({
            section: { id: section.id, term: section.term, label: section.label },
            previousOwners: currentOwnersResult.rows.map((o) => ({
              id: o.user_id,
              email: o.email,
              displayName: o.display_name,
            })),
            newOwner: {
              id: newOwner.id,
              email: newOwner.email,
              displayName: newOwner.display_name,
            },
          }),
        ],
      );

      return currentOwnersResult.rows;
    });

    return reply.send({
      success: true,
      sectionId,
      newOwner: {
        id: newOwner.id,
        email: newOwner.email,
        displayName: newOwner.display_name,
      },
      previousOwners: previousOwners.map((o) => ({
        id: o.user_id,
        email: o.email,
        displayName: o.display_name,
      })),
    });
  });

  // POST /api/admin/sections/:sectionId/reset-join-code - Regenerate section join code
  app.post("/api/admin/sections/:sectionId/reset-join-code", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const { sectionId } = request.params as { sectionId: string };

    const sectionResult = await pool.query<{ id: string; join_code: string; term: string; label: string }>(
      "SELECT id, join_code, term, label FROM sections WHERE id = $1",
      [sectionId],
    );
    if (!sectionResult.rowCount) {
      return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    }
    const section = sectionResult.rows[0]!;
    const oldJoinCode = section.join_code;
    const newJoinCode = generateJoinCode();

    await pool.query(
      "UPDATE sections SET join_code = $1, updated_at = now() WHERE id = $2",
      [newJoinCode, sectionId],
    );

    await pool.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES ($1::uuid, 'section.join_code_reset', 'section', $2, $3::jsonb)`,
      [
        admin.id,
        sectionId,
        JSON.stringify({
          section: { id: section.id, term: section.term, label: section.label },
          oldJoinCode,
          newJoinCode,
        }),
      ],
    );

    return reply.send({
      success: true,
      sectionId,
      joinCode: newJoinCode,
    });
  });

  // GET /api/admin/sessions/live - Active attendance sessions across all sections
  app.get("/api/admin/sessions/live", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const liveSessionsResult = await pool.query<{
      id: string;
      section_id: string;
      course_code: string;
      course_title: string;
      term: string;
      section_label: string;
      check_in_method: string | null;
      opened_at: Date;
      scheduled_start: Date;
      scheduled_end: Date;
      active_emoji: string | null;
      host_id: string | null;
      host_email: string | null;
      host_display_name: string | null;
      checked_in_count: number;
      total_students_count: number;
    }>(
      `SELECT
         cs.id,
         cs.section_id,
         c.code AS course_code,
         c.title AS course_title,
         sec.term,
         sec.label AS section_label,
         cs.check_in_method,
         cs.opened_at,
         cs.scheduled_start,
         cs.scheduled_end,
         cs.active_emoji,
         u.user_id AS host_id,
         u.email::text AS host_email,
         u.display_name AS host_display_name,
         COALESCE(ck.checked_in_count, 0)::int AS checked_in_count,
         COALESCE(st.total_students_count, 0)::int AS total_students_count
       FROM class_sessions cs
       JOIN sections sec ON sec.id = cs.section_id
       JOIN courses c ON c.id = sec.course_id
       LEFT JOIN LATERAL (
         SELECT m.user_id, u2.email, u2.display_name
         FROM memberships m
         JOIN users u2 ON u2.id = m.user_id
         WHERE m.section_id = sec.id AND 'owner' = ANY(m.roles)
         ORDER BY m.created_at ASC
         LIMIT 1
       ) u ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS checked_in_count
         FROM session_checkins sc
         WHERE sc.session_id = cs.id
       ) ck ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total_students_count
         FROM memberships m
         WHERE m.section_id = sec.id AND 'student' = ANY(m.roles)
       ) st ON true
       WHERE cs.opened_at IS NOT NULL AND cs.closed_at IS NULL
       ORDER BY cs.opened_at DESC`,
    );

    const sessions = liveSessionsResult.rows.map((s) => ({
      id: s.id,
      sectionId: s.section_id,
      courseCode: s.course_code,
      courseTitle: s.course_title,
      term: s.term,
      sectionLabel: s.section_label,
      checkInMethod: s.check_in_method,
      openedAt: s.opened_at,
      scheduledStart: s.scheduled_start,
      scheduledEnd: s.scheduled_end,
      activeEmoji: s.active_emoji,
      host: s.host_id
        ? {
            id: s.host_id,
            email: s.host_email,
            displayName: s.host_display_name,
          }
        : null,
      checkedInCount: s.checked_in_count,
      totalStudentsCount: s.total_students_count,
    }));

    return reply.send({ sessions });
  });

  // POST /api/admin/sessions/:sessionId/close - Emergency close active class session
  app.post("/api/admin/sessions/:sessionId/close", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const { sessionId } = request.params as { sessionId: string };

    const sessionResult = await pool.query<{
      id: string;
      section_id: string;
      opened_at: Date | null;
      closed_at: Date | null;
    }>(
      "SELECT id, section_id, opened_at, closed_at FROM class_sessions WHERE id = $1",
      [sessionId],
    );

    if (!sessionResult.rowCount) {
      return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    }

    const session = sessionResult.rows[0]!;
    if (session.closed_at !== null) {
      return reply.code(400).send({
        error: "SESSION_ALREADY_CLOSED",
        message: "Session is already closed",
      });
    }

    await pool.query(
      "UPDATE class_sessions SET closed_at = now(), updated_at = now() WHERE id = $1",
      [sessionId],
    );

    await pool.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES ($1::uuid, 'session.force_closed', 'class_session', $2, $3::jsonb)`,
      [
        admin.id,
        sessionId,
        JSON.stringify({
          sectionId: session.section_id,
          openedAt: session.opened_at,
        }),
      ],
    );

    return reply.send({
      success: true,
      sessionId,
    });
  });

  // GET /api/admin/audit-logs - Query audit trail with pagination and filters
  app.get("/api/admin/audit-logs", async (request, reply) => {
    const admin = await requirePlatformAdmin(request, reply, pool, config);
    if (!admin) return;

    const parsed = listAuditLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) return validationError(reply, parsed.error);

    const { search, category, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (category !== "all") {
      params.push(`${category}.%`);
      conditions.push(`a.event_type LIKE $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const pIdx = params.length;
      conditions.push(
        `(a.event_type ILIKE $${pIdx} OR a.subject_id ILIKE $${pIdx} OR u.email::text ILIKE $${pIdx} OR u.display_name ILIKE $${pIdx} OR a.metadata::text ILIKE $${pIdx})`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countQuery = `
      SELECT count(*)::text AS count
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${whereClause}
    `;
    const countResult = await pool.query<{ count: string }>(countQuery, params);
    const total = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);

    const dataParams = [...params, limit, offset];
    const dataQuery = `
      SELECT
        a.id,
        a.actor_user_id,
        u.email::text AS actor_email,
        u.display_name AS actor_display_name,
        a.event_type,
        a.subject_type,
        a.subject_id,
        a.metadata,
        a.created_at
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;

    const logsResult = await pool.query<{
      id: string;
      actor_user_id: string | null;
      actor_email: string | null;
      actor_display_name: string | null;
      event_type: string;
      subject_type: string;
      subject_id: string | null;
      metadata: Record<string, any>;
      created_at: Date;
    }>(dataQuery, dataParams);

    return reply.send({
      logs: logsResult.rows.map((row) => ({
        id: row.id,
        actor: row.actor_user_id
          ? {
              id: row.actor_user_id,
              email: row.actor_email,
              displayName: row.actor_display_name,
            }
          : null,
        eventType: row.event_type,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      })),
      total,
      page,
      limit,
    });
  });
}
