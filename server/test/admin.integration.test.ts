import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function createUserWithSession(
  pool: DatabasePool,
  input: { email: string; displayName: string; isPlatformAdmin?: boolean },
) {
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, email_verified_at, is_platform_admin)
     VALUES ($1, $2, 'active', now(), $3) RETURNING id`,
    [input.email, input.displayName, input.isPlatformAdmin ?? false],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) throw new Error("test user insert did not return an id");
  await pool.query(
    `INSERT INTO auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', $2)`,
    [userId, `test-sub-${userId}`],
  );
  const token = generateOpaqueToken();
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
    [userId, hashToken(token)],
  );
  return { userId, cookie: `classops_session=${token}` };
}

test(
  "Admin Console: overview metrics, user directory, role delegation, and safety guards",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, likes, comments, posts, scores, assignments, categories,
                session_picks, exit_ticket_responses, exit_tickets, session_checkins,
                class_sessions, session_schedule_patterns, activity_responses, activity_attempts,
                section_activities, activity_packages, memberships, sections, courses,
                oauth_transactions, sessions, auth_identities, users
       RESTART IDENTITY CASCADE`,
    );

    const rootAdminEmail = "root.admin@example.edu";
    const config: AppConfig = {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 3000,
      databaseUrl,
      appBaseUrl: "http://localhost:5173",
      trustedOrigins: ["http://localhost:5173"],
      trustProxy: false,
      sessionCookieName: "classops_session",
      sessionTtlDays: 14,
      sealedPayloadEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
      adminGoogleEmail: rootAdminEmail,
      googleOAuth: null,
      microsoftOAuth: null,
    };

    const app = await buildApp({ config, pool });

    // Seed root admin, secondary admin, and normal student
    const rootAdmin = await createUserWithSession(pool, {
      email: rootAdminEmail,
      displayName: "Root Admin",
      isPlatformAdmin: true,
    });
    const secondaryAdmin = await createUserWithSession(pool, {
      email: "sec.admin@example.edu",
      displayName: "Secondary Admin",
      isPlatformAdmin: true,
    });
    const normalUser = await createUserWithSession(pool, {
      email: "student1@example.edu",
      displayName: "Alice Student",
      isPlatformAdmin: false,
    });

    // 1. Authorization checks: unauthenticated & non-admin rejection
    const unauthOverview = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
    });
    assert.equal(unauthOverview.statusCode, 401);

    const nonAdminOverview = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: { cookie: normalUser.cookie },
    });
    assert.equal(nonAdminOverview.statusCode, 403);

    const nonAdminUsers = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: normalUser.cookie },
    });
    assert.equal(nonAdminUsers.statusCode, 403);

    const nonAdminRoleUpdate = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${normalUser.userId}/role`,
      headers: { cookie: normalUser.cookie },
      payload: { isPlatformAdmin: true },
    });
    assert.equal(nonAdminRoleUpdate.statusCode, 403);

    // 2. Admin overview metrics
    const adminOverview = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(adminOverview.statusCode, 200);
    const overviewBody = adminOverview.json();
    assert.equal(overviewBody.metrics.totalUsers, 3);
    assert.equal(overviewBody.metrics.activeUsers, 3);
    assert.equal(overviewBody.metrics.totalCourses, 0);
    assert.equal(overviewBody.metrics.totalSections, 0);
    assert.equal(overviewBody.recentUsers.length, 3);

    // 3. User directory: pagination and search
    const usersList = await app.inject({
      method: "GET",
      url: "/api/admin/users?page=1&limit=10",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(usersList.statusCode, 200);
    const usersBody = usersList.json();
    assert.equal(usersBody.total, 3);
    assert.equal(usersBody.users.length, 3);

    // Search by name
    const searchByName = await app.inject({
      method: "GET",
      url: "/api/admin/users?search=Alice",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(searchByName.statusCode, 200);
    const searchBody = searchByName.json();
    assert.equal(searchBody.total, 1);
    assert.equal(searchBody.users[0]?.displayName, "Alice Student");

    // Filter by admin role
    const filterAdmins = await app.inject({
      method: "GET",
      url: "/api/admin/users?role=admin",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(filterAdmins.statusCode, 200);
    assert.equal(filterAdmins.json().total, 2);

    // 4. Role delegation: Self-demotion guard
    const selfDemote = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${rootAdmin.userId}/role`,
      headers: { cookie: rootAdmin.cookie },
      payload: { isPlatformAdmin: false },
    });
    assert.equal(selfDemote.statusCode, 400);
    assert.equal(selfDemote.json().error, "CANNOT_DEMOTE_SELF");

    // Root admin protection: secondary admin cannot demote root admin
    const demoteRoot = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${rootAdmin.userId}/role`,
      headers: { cookie: secondaryAdmin.cookie },
      payload: { isPlatformAdmin: false },
    });
    assert.equal(demoteRoot.statusCode, 400);
    assert.equal(demoteRoot.json().error, "CANNOT_DEMOTE_ROOT_ADMIN");

    // Promote normal user to admin
    const promoteUser = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${normalUser.userId}/role`,
      headers: { cookie: rootAdmin.cookie },
      payload: { isPlatformAdmin: true },
    });
    assert.equal(promoteUser.statusCode, 200);
    assert.equal(promoteUser.json().isPlatformAdmin, true);

    // Verify user is now platform admin in DB and audit log was written
    const updatedUserRow = await pool.query<{ is_platform_admin: boolean }>(
      "SELECT is_platform_admin FROM users WHERE id = $1",
      [normalUser.userId],
    );
    assert.equal(updatedUserRow.rows[0]?.is_platform_admin, true);

    const auditLog = await pool.query<{ event_type: string; subject_id: string }>(
      "SELECT event_type, subject_id FROM audit_log WHERE event_type = 'admin.promoted'",
    );
    assert.equal(auditLog.rowCount, 1);
    assert.equal(auditLog.rows[0]?.subject_id, normalUser.userId);

    // Demote user back
    const demoteUser = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${normalUser.userId}/role`,
      headers: { cookie: rootAdmin.cookie },
      payload: { isPlatformAdmin: false },
    });
    assert.equal(demoteUser.statusCode, 200);
    assert.equal(demoteUser.json().isPlatformAdmin, false);

    // 5. User status management
    const selfSuspend = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${rootAdmin.userId}/status`,
      headers: { cookie: rootAdmin.cookie },
      payload: { status: "suspended" },
    });
    assert.equal(selfSuspend.statusCode, 400);
    assert.equal(selfSuspend.json().error, "CANNOT_SUSPEND_SELF");

    const suspendRoot = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${rootAdmin.userId}/status`,
      headers: { cookie: secondaryAdmin.cookie },
      payload: { status: "suspended" },
    });
    assert.equal(suspendRoot.statusCode, 400);
    assert.equal(suspendRoot.json().error, "CANNOT_SUSPEND_ROOT_ADMIN");

    // Suspend normal user and check session revocation
    const suspendUser = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${normalUser.userId}/status`,
      headers: { cookie: rootAdmin.cookie },
      payload: { status: "suspended" },
    });
    assert.equal(suspendUser.statusCode, 200);

    const activeSessions = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
      [normalUser.userId],
    );
    assert.equal(activeSessions.rows[0]?.count, "0");

    // 6. Course & Section Catalog and Governance
    // First, create a course and section
    const createCourseRes = await app.inject({
      method: "POST",
      url: "/api/courses",
      headers: { cookie: rootAdmin.cookie },
      payload: {
        code: "CS201",
        title: "Algorithms",
        type: "semester",
        term: "2026/1",
        label: "Sec 801",
        ownerUserId: secondaryAdmin.userId,
      },
    });
    assert.equal(createCourseRes.statusCode, 201);
    // POST /api/courses answers { courseId, sectionId }; the join code is read back from the row.
    const createdSectionId = createCourseRes.json().sectionId as string;
    const initialJoinCode = (
      await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [createdSectionId])
    ).rows[0]!.join_code;

    // Reactivate normalUser so they can enroll and later become owner
    await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${normalUser.userId}/status`,
      headers: { cookie: rootAdmin.cookie },
      payload: { status: "active" },
    });
    // Suspension revoked normalUser's sessions, so they sign in again (a fresh session).
    const rejoinToken = generateOpaqueToken();
    await pool.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [
      normalUser.userId,
      hashToken(rejoinToken),
    ]);
    normalUser.cookie = `classops_session=${rejoinToken}`;

    // Student joins with join code
    const joinRes = await app.inject({
      method: "POST",
      url: "/api/sections/join",
      headers: { cookie: normalUser.cookie },
      payload: { code: initialJoinCode },
    });
    assert.equal(joinRes.statusCode, 200);

    // GET /api/admin/courses
    const coursesRes = await app.inject({
      method: "GET",
      url: "/api/admin/courses",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(coursesRes.statusCode, 200);
    const coursesData = coursesRes.json().courses;
    assert.ok(Array.isArray(coursesData));
    const cs201 = coursesData.find((c: any) => c.code === "CS201");
    assert.ok(cs201);
    assert.equal(cs201.title, "Algorithms");
    assert.equal(cs201.sections.length, 1);
    assert.equal(cs201.sections[0].id, createdSectionId);
    assert.equal(cs201.sections[0].studentCount, 1);
    assert.equal(cs201.sections[0].owner.id, secondaryAdmin.userId);

    // Non-admin cannot access /api/admin/courses
    const nonAdminCourses = await app.inject({
      method: "GET",
      url: "/api/admin/courses",
      headers: { cookie: normalUser.cookie },
    });
    assert.equal(nonAdminCourses.statusCode, 403);

    // POST /api/admin/sections/:sectionId/reset-join-code
    const resetCodeRes = await app.inject({
      method: "POST",
      url: `/api/admin/sections/${createdSectionId}/reset-join-code`,
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(resetCodeRes.statusCode, 200);
    const newJoinCode = resetCodeRes.json().joinCode;
    assert.notEqual(newJoinCode, initialJoinCode);

    // Old join code now rejected
    const oldJoinAttempt = await app.inject({
      method: "POST",
      url: "/api/sections/join",
      headers: { cookie: rootAdmin.cookie },
      payload: { code: initialJoinCode },
    });
    assert.equal(oldJoinAttempt.statusCode, 400);

    // PATCH /api/admin/sections/:sectionId/owner - reassign to normalUser
    const reassignRes = await app.inject({
      method: "PATCH",
      url: `/api/admin/sections/${createdSectionId}/owner`,
      headers: { cookie: rootAdmin.cookie },
      payload: { newOwnerUserId: normalUser.userId },
    });
    assert.equal(reassignRes.statusCode, 200);
    assert.equal(reassignRes.json().newOwner.id, normalUser.userId);

    // Verify in database: normalUser has 'owner', secondaryAdmin only has 'teacher'
    const updatedMemberships = await pool.query<{ user_id: string; roles: string[] }>(
      "SELECT user_id, roles FROM memberships WHERE section_id = $1",
      [createdSectionId],
    );
    const normalUserMem = updatedMemberships.rows.find((m: any) => m.user_id === normalUser.userId);
    const secAdminMem = updatedMemberships.rows.find((m: any) => m.user_id === secondaryAdmin.userId);
    assert.ok(normalUserMem?.roles.includes("owner"));
    assert.ok(!secAdminMem?.roles.includes("owner"));
    assert.ok(secAdminMem?.roles.includes("teacher"));

    // 7. Live Sessions and Audit Trail (Phase 4)
    // Create an open class session
    const createSessionRes = await pool.query<{ id: string }>(
      `INSERT INTO class_sessions (section_id, scheduled_start, scheduled_end, check_in_method, opened_at)
       VALUES ($1, now(), now() + interval '2 hours', 'qr', now())
       RETURNING id`,
      [createdSectionId],
    );
    const sessionId = createSessionRes.rows[0]?.id!;

    // GET /api/admin/sessions/live
    const liveSessionsRes = await app.inject({
      method: "GET",
      url: "/api/admin/sessions/live",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(liveSessionsRes.statusCode, 200);
    const liveSessions = liveSessionsRes.json().sessions;
    assert.ok(Array.isArray(liveSessions));
    assert.equal(liveSessions.length, 1);
    assert.equal(liveSessions[0].id, sessionId);
    assert.equal(liveSessions[0].courseCode, "CS201");
    assert.equal(liveSessions[0].checkInMethod, "qr");

    // Non-admin rejected from live sessions
    const nonAdminLive = await app.inject({
      method: "GET",
      url: "/api/admin/sessions/live",
      headers: { cookie: normalUser.cookie },
    });
    assert.equal(nonAdminLive.statusCode, 403);

    // POST /api/admin/sessions/:sessionId/close
    const closeSessionRes = await app.inject({
      method: "POST",
      url: `/api/admin/sessions/${sessionId}/close`,
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(closeSessionRes.statusCode, 200);
    assert.equal(closeSessionRes.json().sessionId, sessionId);

    // Live sessions is now empty
    const liveAfterClose = await app.inject({
      method: "GET",
      url: "/api/admin/sessions/live",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(liveAfterClose.json().sessions.length, 0);

    // Already closed returns 400
    const closeAgainRes = await app.inject({
      method: "POST",
      url: `/api/admin/sessions/${sessionId}/close`,
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(closeAgainRes.statusCode, 400);

    // GET /api/admin/audit-logs
    const auditLogsRes = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs?category=all&page=1&limit=25",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(auditLogsRes.statusCode, 200);
    const auditBody = auditLogsRes.json();
    assert.ok(Array.isArray(auditBody.logs));
    assert.ok(auditBody.total >= 3);
    const forceCloseLog = auditBody.logs.find((l: any) => l.eventType === "session.force_closed");
    assert.ok(forceCloseLog);
    assert.equal(forceCloseLog.actor.id, rootAdmin.userId);

    // Filter audit logs by category=session
    const sessionCategoryLogs = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs?category=session",
      headers: { cookie: rootAdmin.cookie },
    });
    assert.equal(sessionCategoryLogs.statusCode, 200);
    assert.ok(sessionCategoryLogs.json().logs.every((l: any) => l.eventType.startsWith("session.")));

    // Non-admin rejected from audit logs
    const nonAdminAudit = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie: normalUser.cookie },
    });
    assert.equal(nonAdminAudit.statusCode, 403);

    await app.close(); // its onClose hook ends the pool
  },
);
