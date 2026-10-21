import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import { CodeRunnerError, type RunCode } from "../src/code-runner.js";
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
const runnerCalls: string[] = [];
const stubRunCode: RunCode = async (code, tests) => {
  runnerCalls.push(code);
  if (code.includes("BUSY")) throw new CodeRunnerError("CODE_RUNNER_BUSY");
  const results = tests.map((t, index) => {
    const passed = code.includes("good") || (code.includes("half") && index === 0);
    return { name: t.name ?? null, passed, ran: true, stdout: passed ? t.expected_stdout : "", stderr: "", exitCode: 0, signal: null, timedOut: false };
  });
  return { results, passedCount: results.filter((r) => r.passed).length, totalCount: results.length };
};

test("Code exercises: lifecycle, visibility, run/submit upsert, authorization", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(
    `TRUNCATE audit_log, code_submissions, code_exercises, memberships, sections, courses,
              oauth_transactions, sessions, auth_identities, users RESTART IDENTITY CASCADE`,
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
  const app = await buildApp({ config, pool, deps: { runCode: stubRunCode } });
  const origin = { origin: "http://localhost:5173" };

  try {
    const admin = await createUserWithSession(pool, { email: "admin@example.com", displayName: "Admin", isPlatformAdmin: true });
    const teacher = await createUserWithSession(pool, { email: "teacher@example.com", displayName: "Teacher" });
    const student = await createUserWithSession(pool, { email: "student@example.com", displayName: "Student" });
    const student2 = await createUserWithSession(pool, { email: "student2@example.com", displayName: "Student Two" });
    const nonMember = await createUserWithSession(pool, { email: "non-member@example.com", displayName: "Non Member" });

    const course = await app.inject({
      method: "POST",
      url: "/api/courses",
      headers: { cookie: admin.cookie, ...origin },
      payload: { code: "PY101", title: "Python", type: "short_course", term: "2569/1", ownerUserId: teacher.userId },
    });
    assert.equal(course.statusCode, 201);
    const sectionId = course.json().sectionId as string;
    for (const email of ["student@example.com", "student2@example.com"]) {
      const grant = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { email, roles: ["student"] },
      });
      assert.equal(grant.statusCode, 201);
    }

    const as = (who: { cookie: string }, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
      app.inject({ method, url, headers: { cookie: who.cookie, ...origin }, ...(payload === undefined ? {} : { payload: payload as object }) });

    // Validation
    const invalid = await as(teacher, "POST", `/api/sections/${sectionId}/code-exercises`, { title: "", tests: [] });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "INVALID_REQUEST");
    assert.ok(invalid.json().fields.some((f: { path: string }) => f.path === "tests"));
    const tooMany = await as(teacher, "POST", `/api/sections/${sectionId}/code-exercises`, {
      title: "x",
      tests: Array.from({ length: 11 }, () => ({ stdin: "", expected_stdout: "" })),
    });
    assert.equal(tooMany.statusCode, 400);

    // Students cannot create.
    const studentCreate = await as(student, "POST", `/api/sections/${sectionId}/code-exercises`, {
      title: "x",
      tests: [{ stdin: "", expected_stdout: "" }],
    });
    assert.equal(studentCreate.statusCode, 403);

    const created = await as(teacher, "POST", `/api/sections/${sectionId}/code-exercises`, {
      title: "Echo",
      prompt: "Print the input",
      starter_code: "print(input())",
      tests: [
        { name: "one", stdin: "a\n", expected_stdout: "a" },
        { stdin: "b\n", expected_stdout: "b" },
      ],
    });
    assert.equal(created.statusCode, 201);
    const exercise = created.json().exercise;
    assert.equal(exercise.status, "draft");

    // Draft is invisible to students.
    const draftList = await as(student, "GET", `/api/sections/${sectionId}/code-exercises`);
    assert.equal(draftList.statusCode, 200);
    assert.equal(draftList.json().exercises.length, 0);
    assert.equal(draftList.json().canManage, false);
    assert.equal((await as(student, "GET", `/api/code-exercises/${exercise.id}`)).statusCode, 404);
    assert.equal((await as(student, "POST", `/api/code-exercises/${exercise.id}/run`, { code: "good" })).statusCode, 404);

    // Teacher can run a draft to check the reference.
    const teacherRun = await as(teacher, "POST", `/api/code-exercises/${exercise.id}/run`, { code: "good" });
    assert.equal(teacherRun.statusCode, 200);
    assert.equal(teacherRun.json().passedCount, 2);

    const opened = await as(teacher, "PATCH", `/api/code-exercises/${exercise.id}`, { status: "open" });
    assert.equal(opened.statusCode, 200);
    assert.equal(opened.json().exercise.status, "open");
    assert.equal(opened.json().exercise.title, "Echo");
    assert.equal((await as(student, "PATCH", `/api/code-exercises/${exercise.id}`, { status: "closed" })).statusCode, 403);
    assert.equal((await as(teacher, "PATCH", `/api/code-exercises/${exercise.id}`, { status: "bogus" })).statusCode, 400);

    const openList = await as(student, "GET", `/api/sections/${sectionId}/code-exercises`);
    assert.equal(openList.json().exercises.length, 1);
    const detail = await as(student, "GET", `/api/code-exercises/${exercise.id}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().exercise.tests.length, 2);
    assert.equal(detail.json().mySubmission, null);

    // Run is not stored.
    const run = await as(student, "POST", `/api/code-exercises/${exercise.id}/run`, { code: "half" });
    assert.equal(run.statusCode, 200);
    assert.equal(run.json().passedCount, 1);
    assert.equal(run.json().results[0].name, "one");
    assert.equal((await as(student, "GET", `/api/code-exercises/${exercise.id}/submissions`)).json().submissions.length, 0);

    // Code length cap
    const tooLong = await as(student, "POST", `/api/code-exercises/${exercise.id}/run`, { code: "x".repeat(20_001) });
    assert.equal(tooLong.statusCode, 400);

    // Runner errors map to 503.
    const busy = await as(student, "POST", `/api/code-exercises/${exercise.id}/run`, { code: "BUSY" });
    assert.equal(busy.statusCode, 503);
    assert.equal(busy.json().error, "CODE_RUNNER_BUSY");

    // Submit, then resubmit replaces.
    const first = await as(student, "POST", `/api/code-exercises/${exercise.id}/submissions`, { code: "half" });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().submission.passed_count, 1);
    assert.equal(first.json().submission.total_count, 2);
    const second = await as(student, "POST", `/api/code-exercises/${exercise.id}/submissions`, { code: "good" });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().submission.passed_count, 2);
    assert.equal(second.json().submission.code, "good");
    await as(student2, "POST", `/api/code-exercises/${exercise.id}/submissions`, { code: "half" });

    const count = await pool.query("SELECT count(*)::int AS n FROM code_submissions WHERE exercise_id = $1", [exercise.id]);
    assert.equal(count.rows[0].n, 2);

    // Teacher sees everyone's latest; a student sees only their own.
    const teacherSubs = await as(teacher, "GET", `/api/code-exercises/${exercise.id}/submissions`);
    assert.equal(teacherSubs.statusCode, 200);
    assert.equal(teacherSubs.json().submissions.length, 2);
    const studentRow = teacherSubs.json().submissions.find((s: { user_id: string }) => s.user_id === student.userId);
    assert.equal(studentRow.code, "good");
    assert.equal(studentRow.passed_count, 2);
    const ownSubs = await as(student, "GET", `/api/code-exercises/${exercise.id}/submissions`);
    assert.deepEqual(ownSubs.json().submissions.map((s: { user_id: string }) => s.user_id), [student.userId]);
    assert.equal((await as(student, "GET", `/api/code-exercises/${exercise.id}`)).json().mySubmission.passed_count, 2);

    // Non-members are refused.
    assert.equal((await as(nonMember, "GET", `/api/sections/${sectionId}/code-exercises`)).statusCode, 403);
    assert.equal((await as(nonMember, "GET", `/api/code-exercises/${exercise.id}`)).statusCode, 403);
    assert.equal((await as(nonMember, "POST", `/api/code-exercises/${exercise.id}/run`, { code: "good" })).statusCode, 403);
    assert.equal((await as(nonMember, "POST", `/api/code-exercises/${exercise.id}/submissions`, { code: "good" })).statusCode, 403);

    // Closed: visible, but students can neither run nor submit.
    assert.equal((await as(teacher, "PATCH", `/api/code-exercises/${exercise.id}`, { status: "closed" })).statusCode, 200);
    assert.equal((await as(student, "GET", `/api/code-exercises/${exercise.id}`)).statusCode, 200);
    const closedRun = await as(student, "POST", `/api/code-exercises/${exercise.id}/run`, { code: "good" });
    assert.equal(closedRun.statusCode, 409);
    assert.equal(closedRun.json().error, "CODE_EXERCISE_NOT_OPEN");
    assert.equal((await as(student, "POST", `/api/code-exercises/${exercise.id}/submissions`, { code: "good" })).statusCode, 409);

    // Unknown ids.
    assert.equal((await as(teacher, "GET", "/api/code-exercises/not-a-uuid")).statusCode, 404);
    assert.equal((await as(teacher, "GET", "/api/sections/00000000-0000-0000-0000-000000000000/code-exercises")).statusCode, 404);
  } finally {
    await app.close();
  }
});
