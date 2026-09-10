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

// Shares TEST_DATABASE_URL with the other DB-backed integration test files -- relies on
// `npm test`'s --test-concurrency=1 (see package.json) so TRUNCATE/insert cycles never race.
test(
  "Stats Dashboard: attendance rate, grade summary, feed totals, personal view authorization",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, likes, comments, posts, scores, assignments, categories,
                session_picks, exit_ticket_responses, exit_tickets, session_checkins,
                class_sessions, session_schedule_patterns, memberships, sections, courses,
                oauth_transactions, sessions, auth_identities, users
       RESTART IDENTITY CASCADE`,
    );

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
      adminGoogleEmail: "admin@example.com",
      googleOAuth: null,
      microsoftOAuth: null,
    };
    const app = await buildApp({ config, pool });
    const origin = { origin: "http://localhost:5173" };

    try {
      const admin = await createUserWithSession(pool, {
        email: "admin@example.com",
        displayName: "Admin",
        isPlatformAdmin: true,
      });
      const teacher = await createUserWithSession(pool, {
        email: "teacher@example.com",
        displayName: "Teacher",
      });
      const student = await createUserWithSession(pool, {
        email: "student@example.com",
        displayName: "Student",
      });
      const student2 = await createUserWithSession(pool, {
        email: "student2@example.com",
        displayName: "Student Two",
      });
      const nonMember = await createUserWithSession(pool, {
        email: "non-member@example.com",
        displayName: "Non Member",
      });

      const createSection = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "STATS101",
          title: "Stats Course",
          type: "short_course",
          term: "2569/1",
          ownerUserId: teacher.userId,
        },
      });
      assert.equal(createSection.statusCode, 201);
      const sectionId = createSection.json().sectionId as string;

      async function grant(email: string, roles: string[]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/memberships`,
          headers: { cookie: teacher.cookie, ...origin },
          payload: { email, roles },
        });
        assert.equal(response.statusCode, 201);
      }
      await grant("student@example.com", ["student"]);
      await grant("student2@example.com", ["student"]);

      // --- Zero opened Sessions: every rate is null, not 0 ---

      const statsBeforeAnySession = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(statsBeforeAnySession.statusCode, 200);
      assert.equal(statsBeforeAnySession.json().summary.averageAttendanceRate, null);
      for (const row of statsBeforeAnySession.json().students) {
        assert.equal(row.attendanceRate, null);
      }

      // --- Build up Sessions: two opened (one checked into by student, one not), one never opened ---

      async function createManualSession(start: string, end: string) {
        const response = await app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/sessions`,
          headers: { cookie: teacher.cookie, ...origin },
          payload: { scheduledStart: start, scheduledEnd: end },
        });
        assert.equal(response.statusCode, 201);
        return response.json().session.id as string;
      }

      const session1Id = await createManualSession("2026-03-01T09:00:00Z", "2026-03-01T10:00:00Z");
      const openSession1 = await app.inject({
        method: "POST",
        url: `/api/sessions/${session1Id}/open`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { checkInMethod: "qr" },
      });
      assert.equal(openSession1.statusCode, 200);
      const code1 = openSession1.json().session.qr_code as string;
      const checkIn1 = await app.inject({
        method: "POST",
        url: `/api/sessions/${session1Id}/check-in`,
        headers: { cookie: student.cookie, ...origin },
        payload: { value: code1 },
      });
      assert.equal(checkIn1.statusCode, 200);
      await app.inject({
        method: "POST",
        url: `/api/sessions/${session1Id}/close`,
        headers: { cookie: teacher.cookie, ...origin },
      });

      const session2Id = await createManualSession("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z");
      const openSession2 = await app.inject({
        method: "POST",
        url: `/api/sessions/${session2Id}/open`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { checkInMethod: "qr" },
      });
      assert.equal(openSession2.statusCode, 200);
      // Neither student checks in to session2.
      await app.inject({
        method: "POST",
        url: `/api/sessions/${session2Id}/close`,
        headers: { cookie: teacher.cookie, ...origin },
      });

      // A third Session exists but is never opened -- must not count in the denominator at all.
      await createManualSession("2026-03-03T09:00:00Z", "2026-03-03T10:00:00Z");

      // --- Gradebook fixture: student scored, student2 never scored ---

      const createCategory = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/categories`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "Homework", weight: 100 },
      });
      const categoryId = createCategory.json().category.id as string;
      const createAssignment = await app.inject({
        method: "POST",
        url: `/api/categories/${categoryId}/assignments`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "HW1", maxPoints: 10 },
      });
      const assignmentId = createAssignment.json().assignment.id as string;
      await app.inject({
        method: "POST",
        url: `/api/assignments/${assignmentId}/scores/${student.userId}`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { pointsEarned: 10 },
      });
      // student2 never scored -- their finalGrade must be null.

      // --- Feed fixture ---

      const createPost = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/posts`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { body: "Welcome!" },
      });
      const postId = createPost.json().post.id as string;
      await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/comments`,
        headers: { cookie: student.cookie, ...origin },
        payload: { body: "Thanks!" },
      });
      await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/like`,
        headers: { cookie: student.cookie, ...origin },
      });

      // --- Class-wide view ---

      const statsForbidden = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats`,
        headers: { cookie: student.cookie },
      });
      assert.equal(statsForbidden.statusCode, 403);

      const stats = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(stats.statusCode, 200);
      const statsBody = stats.json();

      const studentRow = statsBody.students.find((r: { userId: string }) => r.userId === student.userId);
      const student2Row = statsBody.students.find((r: { userId: string }) => r.userId === student2.userId);
      // student checked in to 1 of 2 opened Sessions (the never-opened third doesn't count).
      assert.equal(studentRow.attendanceRate, 0.5);
      assert.equal(student2Row.attendanceRate, 0);
      assert.equal(studentRow.finalGrade, 100);
      assert.equal(student2Row.finalGrade, null);

      // The class-wide average is the plain mean of the SAME per-student rows in this response.
      const rates = statsBody.students.map((r: { attendanceRate: number }) => r.attendanceRate);
      const expectedAverage = rates.reduce((a: number, b: number) => a + b, 0) / rates.length;
      assert.equal(statsBody.summary.averageAttendanceRate, expectedAverage);

      // Grade summary computed only over the one student with a defined grade.
      assert.equal(statsBody.summary.averageFinalGrade, 100);
      assert.equal(statsBody.summary.minFinalGrade, 100);
      assert.equal(statsBody.summary.maxFinalGrade, 100);

      // Feed totals are always-defined counts.
      assert.equal(statsBody.summary.totalPosts, 1);
      assert.equal(statsBody.summary.totalComments, 1);
      assert.equal(statsBody.summary.totalLikes, 1);

      // Cross-check against Gradebook's own endpoint for the same fixture -- never duplicated logic.
      const gradebook = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/gradebook`,
        headers: { cookie: teacher.cookie },
      });
      const gradebookStudentRow = gradebook
        .json()
        .students.find((r: { userId: string }) => r.userId === student.userId);
      assert.equal(gradebookStudentRow.finalGrade, studentRow.finalGrade);

      // --- A fresh Section with zero Posts reports 0, not null ---

      const createEmptySection = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "STATS102",
          title: "Empty Stats Course",
          type: "short_course",
          term: "2569/1",
          ownerUserId: teacher.userId,
        },
      });
      const emptySectionId = createEmptySection.json().sectionId as string;
      const emptyStats = await app.inject({
        method: "GET",
        url: `/api/sections/${emptySectionId}/stats`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(emptyStats.json().summary.totalPosts, 0);
      assert.equal(emptyStats.json().summary.totalComments, 0);
      assert.equal(emptyStats.json().summary.totalLikes, 0);

      // --- Personal view ---

      const selfView = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats/students/${student.userId}`,
        headers: { cookie: student.cookie },
      });
      assert.equal(selfView.statusCode, 200);
      assert.equal(selfView.json().attendanceRate, 0.5);
      assert.equal(selfView.json().finalGrade, 100);

      const otherStudentForbidden = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats/students/${student2.userId}`,
        headers: { cookie: student.cookie },
      });
      assert.equal(otherStudentForbidden.statusCode, 403);

      // A manager can view any Section member's personal view, including one with no grade data.
      const managerViewsStudent2 = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats/students/${student2.userId}`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(managerViewsStudent2.statusCode, 200);
      assert.equal(managerViewsStudent2.json().attendanceRate, 0);
      assert.equal(managerViewsStudent2.json().finalGrade, null);

      const nonMemberClassWide = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats`,
        headers: { cookie: nonMember.cookie },
      });
      assert.equal(nonMemberClassWide.statusCode, 403);

      const nonMemberSelfView = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats/students/${nonMember.userId}`,
        headers: { cookie: nonMember.cookie },
      });
      assert.equal(nonMemberSelfView.statusCode, 403);

      // A manager requesting a personal view for a real user who isn't actually a Section member.
      const managerViewsNonMember = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats/students/${nonMember.userId}`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(managerViewsNonMember.statusCode, 404);
    } finally {
      await app.close();
    }
  },
);
