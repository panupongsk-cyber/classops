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
  "Gradebook: Category/Assignment/Score CRUD, upsert, JSON/CSV consistency, authorization",
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

      const createSectionA = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "GRADE101",
          title: "Gradebook Course",
          type: "short_course",
          term: "2569/1",
          ownerUserId: teacher.userId,
        },
      });
      assert.equal(createSectionA.statusCode, 201);
      const sectionId = createSectionA.json().sectionId as string;

      const createSectionB = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "GRADE102",
          title: "Other Section",
          type: "short_course",
          term: "2569/1",
          ownerUserId: teacher.userId,
        },
      });
      assert.equal(createSectionB.statusCode, 201);
      const otherSectionId = createSectionB.json().sectionId as string;
      const otherTeacher = await createUserWithSession(pool, {
        email: "other-teacher@example.com",
        displayName: "Other Teacher",
      });
      await app.inject({
        method: "POST",
        url: `/api/sections/${otherSectionId}/memberships`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { email: "other-teacher@example.com", roles: ["teacher"] },
      });

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

      // --- Category/Assignment CRUD ---

      const invalidWeight = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/categories`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "Homework", weight: 0 },
      });
      assert.equal(invalidWeight.statusCode, 400);

      const createCategory1 = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/categories`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "Homework", weight: 20 },
      });
      assert.equal(createCategory1.statusCode, 201);
      const category1Id = createCategory1.json().category.id as string;

      const createCategory2 = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/categories`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "Midterm", weight: 30 },
      });
      assert.equal(createCategory2.statusCode, 201);
      const category2Id = createCategory2.json().category.id as string;

      // A teacher of a DIFFERENT Section cannot create an Assignment under this Category, even
      // knowing its id -- the Category's real Section is what's checked, not any caller claim.
      const crossSectionAttempt = await app.inject({
        method: "POST",
        url: `/api/categories/${category1Id}/assignments`,
        headers: { cookie: otherTeacher.cookie, ...origin },
        payload: { name: "HW1", maxPoints: 50 },
      });
      assert.equal(crossSectionAttempt.statusCode, 403);

      const invalidMaxPoints = await app.inject({
        method: "POST",
        url: `/api/categories/${category1Id}/assignments`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "HW1", maxPoints: 0 },
      });
      assert.equal(invalidMaxPoints.statusCode, 400);

      const createAssignment1 = await app.inject({
        method: "POST",
        url: `/api/categories/${category1Id}/assignments`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "HW1", maxPoints: 50 },
      });
      assert.equal(createAssignment1.statusCode, 201);
      const assignment1Id = createAssignment1.json().assignment.id as string;

      const createAssignment2 = await app.inject({
        method: "POST",
        url: `/api/categories/${category2Id}/assignments`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "Midterm Exam", maxPoints: 100 },
      });
      assert.equal(createAssignment2.statusCode, 201);
      const assignment2Id = createAssignment2.json().assignment.id as string;

      // --- Score upsert (single) ---

      const scoreForbidden = await app.inject({
        method: "POST",
        url: `/api/assignments/${assignment1Id}/scores/${student.userId}`,
        headers: { cookie: student.cookie, ...origin },
        payload: { pointsEarned: 45 },
      });
      assert.equal(scoreForbidden.statusCode, 403);

      const setScore = await app.inject({
        method: "POST",
        url: `/api/assignments/${assignment1Id}/scores/${student.userId}`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { pointsEarned: 45 },
      });
      assert.equal(setScore.statusCode, 200);

      const updateScore = await app.inject({
        method: "POST",
        url: `/api/assignments/${assignment1Id}/scores/${student.userId}`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { pointsEarned: 48 },
      });
      assert.equal(updateScore.statusCode, 200);
      assert.equal(updateScore.json().score.points_earned, "48");
      const scoreCount = await pool.query(
        "SELECT count(*)::int AS count FROM scores WHERE assignment_id = $1 AND user_id = $2",
        [assignment1Id, student.userId],
      );
      assert.equal(scoreCount.rows[0]?.count, 1);

      // --- Bulk upsert ---

      const bulkWithNonMember = await app.inject({
        method: "POST",
        url: `/api/assignments/${assignment2Id}/scores/bulk`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: {
          scores: [
            { userId: student.userId, pointsEarned: 80 },
            { userId: nonMember.userId, pointsEarned: 50 },
          ],
        },
      });
      assert.equal(bulkWithNonMember.statusCode, 400);
      assert.equal(bulkWithNonMember.json().error, "NOT_A_SECTION_MEMBER");
      // Rejected as a whole -- student's score from this batch was not written either.
      const partialCheck = await pool.query(
        "SELECT count(*)::int AS count FROM scores WHERE assignment_id = $1",
        [assignment2Id],
      );
      assert.equal(partialCheck.rows[0]?.count, 0);

      const bulkOk = await app.inject({
        method: "POST",
        url: `/api/assignments/${assignment2Id}/scores/bulk`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: {
          scores: [
            { userId: student.userId, pointsEarned: 80 },
            { userId: student2.userId, pointsEarned: 60 },
          ],
        },
      });
      assert.equal(bulkOk.statusCode, 200);
      assert.equal(bulkOk.json().scores.length, 2);

      // --- Category deletion cascades ---

      const scratchCategory = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/categories`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "Scratch", weight: 10 },
      });
      const scratchCategoryId = scratchCategory.json().category.id as string;
      const scratchAssignment = await app.inject({
        method: "POST",
        url: `/api/categories/${scratchCategoryId}/assignments`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { name: "Scratch Assignment", maxPoints: 10 },
      });
      const scratchAssignmentId = scratchAssignment.json().assignment.id as string;
      await app.inject({
        method: "POST",
        url: `/api/assignments/${scratchAssignmentId}/scores/${student.userId}`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { pointsEarned: 5 },
      });
      const deleteCategory = await app.inject({
        method: "DELETE",
        url: `/api/categories/${scratchCategoryId}`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(deleteCategory.statusCode, 200);
      const orphanCheck = await pool.query(
        "SELECT (SELECT count(*) FROM assignments WHERE category_id = $1) AS assignments, (SELECT count(*) FROM scores WHERE assignment_id = $2) AS scores",
        [scratchCategoryId, scratchAssignmentId],
      );
      assert.equal(Number(orphanCheck.rows[0]?.assignments), 0);
      assert.equal(Number(orphanCheck.rows[0]?.scores), 0);

      // --- JSON gradebook view and CSV export consistency ---

      const gradebookForbidden = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/gradebook`,
        headers: { cookie: student.cookie },
      });
      assert.equal(gradebookForbidden.statusCode, 403);

      const gradebook = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/gradebook`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(gradebook.statusCode, 200);
      const gradebookBody = gradebook.json();
      // Only student/ta members appear -- not the owner/teacher.
      assert.equal(gradebookBody.students.length, 2);

      const studentRow = gradebookBody.students.find(
        (row: { userId: string }) => row.userId === student.userId,
      );
      // student: HW1 48/50 (96%) in Homework (weight 20), Midterm 80/100 (80%) in Midterm (weight 30).
      // finalGrade = (96*20 + 80*30) / (20+30) = (1920+2400)/50 = 86.4
      assert.equal(studentRow.categoryPercentages[category1Id], 96);
      assert.equal(studentRow.categoryPercentages[category2Id], 80);
      assert.equal(studentRow.finalGrade, 86.4);

      const csvResponse = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/gradebook/export`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(csvResponse.statusCode, 200);
      assert.match(csvResponse.headers["content-type"] as string, /text\/csv/);
      const csvLines = csvResponse.body.trim().split("\n");
      const header = csvLines[0]?.split(",") ?? [];
      assert.ok(header.includes("HW1 (Homework)"));
      assert.ok(header.includes("Midterm Exam (Midterm)"));
      assert.ok(header.includes("Homework %"));
      assert.ok(header.includes("Midterm %"));
      assert.ok(header.includes("Final Grade"));

      const studentLine = csvLines.find((line) => line.startsWith("Student,"));
      assert.ok(studentLine, "expected a CSV row for Student");
      const cells = studentLine?.split(",") ?? [];
      // Cross-check the CSV's computed columns against the JSON view's numbers -- both must come
      // from the same computation, never allowed to drift.
      assert.equal(cells[cells.length - 1], "86.40");
      assert.ok(cells.includes("96.00"));
      assert.ok(cells.includes("80.00"));

      const student2Row = gradebookBody.students.find(
        (row: { userId: string }) => row.userId === student2.userId,
      );
      // student2 has no Homework score -- Homework is inactive for them; only Midterm (60%)
      // counts, so finalGrade equals 60 regardless of Homework's weight.
      assert.equal(student2Row.categoryPercentages[category1Id], undefined);
      assert.equal(student2Row.finalGrade, 60);
      const student2Line = csvLines.find((line) => line.startsWith("Student Two,"));
      const student2Cells = student2Line?.split(",") ?? [];
      // The Homework column (HW1) is blank for student2 -- never graded.
      assert.equal(student2Cells[2], "");
    } finally {
      await app.close();
    }
  },
);
