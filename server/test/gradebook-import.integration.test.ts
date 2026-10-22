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
  "Gradebook CSV import: round trip, preview vs confirm, matching, authorization, audit",
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
      const admin = await createUserWithSession(pool, { email: "admin@example.com", displayName: "Admin", isPlatformAdmin: true });
      const teacher = await createUserWithSession(pool, { email: "teacher@example.com", displayName: "Teacher" });
      const ta = await createUserWithSession(pool, { email: "ta@example.com", displayName: "TA" });
      const student = await createUserWithSession(pool, { email: "student@example.com", displayName: "Student" });
      const student2 = await createUserWithSession(pool, { email: "student2@example.com", displayName: "Student Two" });
      const otherTeacher = await createUserWithSession(pool, { email: "other@example.com", displayName: "Other Teacher" });

      async function createSection(code: string, ownerUserId: string) {
        const response = await app.inject({
          method: "POST",
          url: "/api/courses",
          headers: { cookie: admin.cookie, ...origin },
          payload: { code, title: code, type: "short_course", term: "2569/1", ownerUserId },
        });
        assert.equal(response.statusCode, 201);
        return response.json().sectionId as string;
      }
      const sectionId = await createSection("IMPORT101", teacher.userId);
      await createSection("IMPORT102", otherTeacher.userId);
      for (const [email, roles] of [["student@example.com", ["student"]], ["student2@example.com", ["student"]], ["ta@example.com", ["ta"]]] as const) {
        const grant = await app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/memberships`,
          headers: { cookie: teacher.cookie, ...origin },
          payload: { email, roles },
        });
        assert.equal(grant.statusCode, 201);
      }
      // A roster student ID for Student only; Student Two has none and must match by email.
      await pool.query("UPDATE memberships SET student_id = '65000001' WHERE user_id = $1 AND section_id = $2", [student.userId, sectionId]);

      async function post(url: string, payload: Record<string, unknown>) {
        const response = await app.inject({ method: "POST", url, headers: { cookie: teacher.cookie, ...origin }, payload });
        assert.ok(response.statusCode < 300, `${url}: ${response.statusCode} ${response.body}`);
        return response.json();
      }
      const homework = (await post(`/api/sections/${sectionId}/categories`, { name: "การบ้าน", weight: 40 })).category.id;
      const exams = (await post(`/api/sections/${sectionId}/categories`, { name: "Exams", weight: 60 })).category.id;
      const hw1 = (await post(`/api/categories/${homework}/assignments`, { name: "HW1", maxPoints: 10 })).assignment.id;
      const midterm = (await post(`/api/categories/${exams}/assignments`, { name: "Midterm", maxPoints: 100 })).assignment.id;
      await post(`/api/assignments/${hw1}/scores/bulk`, {
        scores: [{ userId: student.userId, pointsEarned: 8.125 }, { userId: student2.userId, pointsEarned: 3 }],
      });
      await post(`/api/assignments/${midterm}/scores/bulk`, { scores: [{ userId: student.userId, pointsEarned: 90 }] });

      const exported = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/gradebook/export`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(exported.statusCode, 200);
      const csv = exported.body;
      assert.match(csv.split("\n")[0]!, /^Student Name,Student Email,Student ID,HW1 \(การบ้าน\),Midterm \(Exams\)/);

      const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
      async function preview(fileBase64: string, cookie = teacher.cookie, encoding = "auto") {
        return app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/gradebook/import/preview`,
          headers: { cookie, ...origin },
          payload: { fileBase64, encoding },
        });
      }
      async function apply(fileBase64: string, cookie = teacher.cookie) {
        return app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/gradebook/import`,
          headers: { cookie, ...origin },
          payload: { fileBase64 },
        });
      }
      async function storedScores() {
        const result = await pool.query<{ assignment_id: string; user_id: string; points_earned: string; updated_at: Date }>(
          "SELECT assignment_id, user_id, points_earned, updated_at FROM scores ORDER BY assignment_id, user_id",
        );
        return result.rows.map((r) => `${r.assignment_id}:${r.user_id}=${Number(r.points_earned)}@${r.updated_at.toISOString()}`);
      }

      // 1. The unedited export changes nothing -- not even updated_at.
      const before = await storedScores();
      const roundTrip = await preview(b64(csv));
      assert.equal(roundTrip.statusCode, 200, roundTrip.body);
      assert.deepEqual(roundTrip.json().counts, { change: 0, unchanged: 3, rejected: 0, cells: 0, selfEnteredId: 0 });
      assert.deepEqual(roundTrip.json().unknownColumns, []);
      assert.equal((await apply(b64(csv))).json().counts.cells, 0);
      assert.deepEqual(await storedScores(), before);

      // 2. Edit one cell (Student Two's Midterm, blank -> 75) and blank another (Student's HW1).
      const lines = csv.split("\n");
      const edited = lines
        .map((line) => {
          const cells = line.split(",");
          if (cells[1] === "student2@example.com") cells[4] = "75";
          if (cells[1] === "student@example.com") cells[3] = "";
          return cells.join(",");
        })
        .join("\r\n");
      const editedPreview = (await preview(b64(edited))).json();
      assert.deepEqual(editedPreview.counts, { change: 1, unchanged: 2, rejected: 0, cells: 1, selfEnteredId: 0 });
      const changedRow = editedPreview.rows.find((r: { status: string }) => r.status === "change");
      assert.equal(changedRow.userId, student2.userId);
      assert.deepEqual(changedRow.changes, [{ assignmentId: midterm, header: "Midterm (Exams)", from: null, to: 75, overMax: false }]);
      // The preview wrote nothing.
      assert.deepEqual(await storedScores(), before);

      const applied = await apply(b64(edited));
      assert.equal(applied.statusCode, 200);
      assert.equal(applied.json().counts.cells, 1);
      const midtermTwo = await pool.query("SELECT points_earned FROM scores WHERE assignment_id = $1 AND user_id = $2", [midterm, student2.userId]);
      assert.equal(Number(midtermTwo.rows[0].points_earned), 75);
      const hw1One = await pool.query("SELECT points_earned FROM scores WHERE assignment_id = $1 AND user_id = $2", [hw1, student.userId]);
      assert.equal(Number(hw1One.rows[0].points_earned), 8.125, "a blank cell left the stored score alone");
      const audit = await pool.query("SELECT actor_user_id, subject_id, metadata FROM audit_log WHERE event_type = 'gradebook.imported' ORDER BY id");
      assert.equal(audit.rows.length, 2);
      assert.equal(audit.rows[1].actor_user_id, teacher.userId);
      assert.equal(audit.rows[1].subject_id, sectionId);
      assert.equal(audit.rows[1].metadata.counts.cells, 1);

      // 3. Rejected rows are reported and skipped; valid rows still apply.
      const mixed = [
        "Student Email,Student ID,Midterm (Exams),Quiz 9 (Exams)",
        ",65000001,91,1",
        "student2@example.com,65000001,50,",
        "nobody@example.com,,50,",
        "teacher@example.com,,50,",
        "ta@example.com,,-4,",
      ].join("\n");
      const mixedPreview = (await preview(b64(mixed))).json();
      assert.deepEqual(mixedPreview.unknownColumns, ["Quiz 9 (Exams)"]);
      assert.deepEqual(
        mixedPreview.rows.map((r: { status: string; reason: string | null }) => r.reason ?? r.status),
        ["change", "ID_EMAIL_MISMATCH", "UNKNOWN_EMAIL", "NOT_A_STUDENT", "INVALID_SCORE"],
      );
      assert.equal((await apply(b64(mixed))).json().counts.cells, 1);
      const midtermOne = await pool.query("SELECT points_earned FROM scores WHERE assignment_id = $1 AND user_id = $2", [midterm, student.userId]);
      assert.equal(Number(midtermOne.rows[0].points_earned), 91);

      // 3b. An ID-only row matched by an ID the learner typed is flagged; a roster ID is not (#2447).
      await pool.query("UPDATE memberships SET roster_student_id = student_id WHERE user_id = $1 AND section_id = $2", [student.userId, sectionId]);
      const typedId = await app.inject({
        method: "PUT",
        url: `/api/sections/${sectionId}/me/student-id`,
        headers: { cookie: student2.cookie, ...origin },
        payload: { studentId: "65000002" },
      });
      assert.equal(typedId.statusCode, 200);
      const idOnly = (await preview(b64("Student ID,Midterm (Exams)\n65000001,92\n65000002,76"))).json();
      assert.deepEqual(
        idOnly.rows.map((r: { userId: string; selfEnteredId: boolean }) => [r.userId, r.selfEnteredId]),
        [[student.userId, false], [student2.userId, true]],
      );
      assert.equal(idOnly.counts.selfEnteredId, 1);

      // 4. A Thai Excel save (TIS-620 bytes) of the export is read back.
      const tis = Buffer.from(
        [...edited].map((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 0x0e01 && code <= 0x0e5b ? code - 0x0e01 + 0xa1 : code;
        }),
      ).toString("base64");
      const tisPreview = (await preview(tis)).json();
      assert.equal(tisPreview.encoding, "tis-620");
      assert.ok(tisPreview.matchedColumns.some((c: { header: string }) => c.header === "HW1 (การบ้าน)"));

      // 5. Authorization: a TA may import (as with score entry); a student, another Section's
      // teacher, and an anonymous caller may not.
      assert.equal((await preview(b64(csv), ta.cookie)).statusCode, 200);
      assert.equal((await preview(b64(csv), student.cookie)).statusCode, 403);
      assert.equal((await apply(b64(csv), student.cookie)).statusCode, 403);
      assert.equal((await preview(b64(csv), otherTeacher.cookie)).statusCode, 403);
      assert.equal(
        (await app.inject({ method: "POST", url: `/api/sections/${sectionId}/gradebook/import/preview`, headers: origin, payload: { fileBase64: b64(csv) } })).statusCode,
        401,
      );

      // 6. Malformed requests.
      assert.equal((await preview(b64("Student Name,HW1 (การบ้าน)\nOne,1"))).json().error, "NO_IDENTITY_COLUMN");
      assert.equal((await preview(Buffer.alloc(600 * 1024, 65).toString("base64"))).statusCode, 400);
      assert.equal((await preview(b64(csv), teacher.cookie, "utf-8")).statusCode, 200);
    } finally {
      await app.close();
    }
  },
);
