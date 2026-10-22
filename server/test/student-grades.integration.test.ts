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
  "Student grade view: own scores only, released Assignments only, totals from released work",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, scores, assignments, categories, session_picks,
                exit_ticket_responses, exit_tickets, session_checkins, class_sessions,
                session_schedule_patterns, memberships, sections, courses, oauth_transactions,
                sessions, auth_identities, users
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
      const teacher = await createUserWithSession(pool, { email: "teacher@example.com", displayName: "Teacher" });
      const student = await createUserWithSession(pool, { email: "student@example.com", displayName: "Student" });
      const student2 = await createUserWithSession(pool, { email: "student2@example.com", displayName: "Student Two" });
      const nonMember = await createUserWithSession(pool, { email: "non-member@example.com", displayName: "Non Member" });

      const createSection = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: { code: "GRADE201", title: "Grade View", type: "short_course", term: "2569/1", ownerUserId: teacher.userId },
      });
      assert.equal(createSection.statusCode, 201);
      const sectionId = createSection.json().sectionId as string;
      for (const email of ["student@example.com", "student2@example.com"]) {
        const grant = await app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/memberships`,
          headers: { cookie: teacher.cookie, ...origin },
          payload: { email, roles: ["student"] },
        });
        assert.equal(grant.statusCode, 201);
      }

      async function post(url: string, payload: Record<string, unknown>) {
        const response = await app.inject({ method: "POST", url, headers: { cookie: teacher.cookie, ...origin }, payload });
        assert.ok(response.statusCode < 300, `${url}: ${response.statusCode} ${response.body}`);
        return response.json();
      }
      const homework = (await post(`/api/sections/${sectionId}/categories`, { name: "Homework", weight: 40 })).category.id;
      const exams = (await post(`/api/sections/${sectionId}/categories`, { name: "Exams", weight: 60 })).category.id;
      const hw1 = (await post(`/api/categories/${homework}/assignments`, { name: "HW1", maxPoints: 10 })).assignment;
      const hw2 = (await post(`/api/categories/${homework}/assignments`, { name: "HW2", maxPoints: 10 })).assignment.id;
      const midterm = (await post(`/api/categories/${exams}/assignments`, { name: "Midterm", maxPoints: 100 })).assignment.id;
      assert.equal(hw1.released_at, null, "a new Assignment starts unreleased");
      await post(`/api/assignments/${hw1.id}/scores/bulk`, {
        scores: [{ userId: student.userId, pointsEarned: 8 }, { userId: student2.userId, pointsEarned: 3 }],
      });
      await post(`/api/assignments/${hw2}/scores/bulk`, { scores: [{ userId: student.userId, pointsEarned: 4 }] });
      await post(`/api/assignments/${midterm}/scores/bulk`, { scores: [{ userId: student.userId, pointsEarned: 90 }] });

      async function myGrades(cookie: string) {
        return app.inject({ method: "GET", url: `/api/sections/${sectionId}/my-grades`, headers: { cookie } });
      }

      // Nothing released yet: no assignments, no percentages, no final grade.
      const none = (await myGrades(student.cookie)).json();
      assert.deepEqual(none.assignments, []);
      assert.equal(none.finalGrade, null);
      assert.ok(none.categories.every((category: { percent: number | null }) => category.percent === null));

      async function setReleased(assignmentId: string, released: boolean, cookie = teacher.cookie) {
        return app.inject({
          method: "PATCH",
          url: `/api/assignments/${assignmentId}`,
          headers: { cookie, ...origin },
          payload: { released },
        });
      }
      assert.equal((await setReleased(hw1.id, true, student.cookie)).statusCode, 403, "a student cannot release");
      const released = await setReleased(hw1.id, true);
      assert.equal(released.statusCode, 200);
      const releasedAt = released.json().assignment.released_at;
      assert.ok(releasedAt);
      // Releasing again keeps the first release time; a rename leaves the release untouched.
      assert.equal((await setReleased(hw1.id, true)).json().assignment.released_at, releasedAt);
      const renamed = await app.inject({
        method: "PATCH",
        url: `/api/assignments/${hw1.id}`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "HW1 (revised)" },
      });
      assert.equal(renamed.json().assignment.released_at, releasedAt);
      await setReleased(midterm, true);

      // Only HW1 and Midterm count; HW2's 4/10 must not pull Homework down from 80%.
      const mine = (await myGrades(student.cookie)).json();
      assert.deepEqual(
        mine.assignments.map((a: { name: string; pointsEarned: number | null }) => [a.name, a.pointsEarned]),
        [["HW1 (revised)", 8], ["Midterm", 90]],
      );
      const percentByName = Object.fromEntries(
        mine.categories.map((category: { name: string; percent: number | null }) => [category.name, category.percent]),
      );
      assert.equal(percentByName.Homework, 80);
      assert.equal(percentByName.Exams, 90);
      assert.ok(Math.abs(mine.finalGrade - (80 * 40 + 90 * 60) / 100) < 1e-9);

      // Student Two sees only their own score, and an unscored released Assignment as null.
      const theirs = (await myGrades(student2.cookie)).json();
      assert.deepEqual(
        theirs.assignments.map((a: { name: string; pointsEarned: number | null }) => [a.name, a.pointsEarned]),
        [["HW1 (revised)", 3], ["Midterm", null]],
      );
      assert.equal(theirs.finalGrade, 30);
      assert.ok(!JSON.stringify(theirs).includes(student.userId), "no other student's id leaks");

      // The personal stats view agrees: a student's own final grade excludes unreleased work,
      // while a manager looking at the same student still sees the full grade.
      const ownStats = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats/students/${student.userId}`,
        headers: { cookie: student.cookie },
      });
      assert.equal(ownStats.statusCode, 200);
      assert.ok(Math.abs(ownStats.json().finalGrade - mine.finalGrade) < 1e-9);
      const managerStats = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/stats/students/${student.userId}`,
        headers: { cookie: teacher.cookie },
      });
      // Homework over HW1+HW2 is 12/20 = 60%; Exams 90%.
      assert.ok(Math.abs(managerStats.json().finalGrade - (60 * 40 + 90 * 60) / 100) < 1e-9);

      // A query-string userId is ignored: the endpoint is always scoped to the caller.
      const spoof = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/my-grades?userId=${student.userId}`,
        headers: { cookie: student2.cookie },
      });
      assert.equal(spoof.json().finalGrade, 30);

      assert.equal((await myGrades(nonMember.cookie)).statusCode, 403);
      assert.equal(
        (await app.inject({ method: "GET", url: `/api/sections/${sectionId}/my-grades` })).statusCode,
        401,
      );

      // Un-releasing hides the score again.
      const unreleased = await setReleased(midterm, false);
      assert.equal(unreleased.json().assignment.released_at, null);
      const after = (await myGrades(student.cookie)).json();
      assert.deepEqual(after.assignments.map((a: { name: string }) => a.name), ["HW1 (revised)"]);
      assert.equal(after.finalGrade, 80);

      // The manager's assignment list reports release state.
      const list = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/assignments`,
        headers: { cookie: teacher.cookie },
      });
      const releaseByName = Object.fromEntries(
        list.json().assignments.map((a: { name: string; released_at: string | null }) => [a.name, a.released_at !== null]),
      );
      assert.deepEqual(releaseByName, { "HW1 (revised)": true, HW2: false, Midterm: false });
    } finally {
      await app.close();
    }
  },
);
