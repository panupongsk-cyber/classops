import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { availableNow, evidenceRatio } from "../src/routes/practice-assignments.js";
import { importPracticePackage } from "../src/scripts/import-practice.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";
import { syntheticPracticePackage } from "./fixtures/synthetic-practice.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function createUserWithSession(pool: DatabasePool, email: string, isPlatformAdmin = false) {
  const userId = (await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, email_verified_at, is_platform_admin) VALUES ($1, $2, 'active', now(), $3) RETURNING id`,
    [email, email, isPlatformAdmin],
  )).rows[0]!.id;
  const token = generateOpaqueToken();
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [userId, hashToken(token)]);
  return { userId, cookie: `classops_session=${token}` };
}

function testConfig(url: string): AppConfig {
  return {
    nodeEnv: "test", host: "127.0.0.1", port: 3000, databaseUrl: url, appBaseUrl: "http://localhost:5173",
    trustedOrigins: ["http://localhost:5173"], trustProxy: false, sessionCookieName: "classops_session", sessionTtlDays: 14,
    sealedPayloadEncryptionKey: Buffer.alloc(32, 7).toString("base64"), adminGoogleEmail: "admin@example.com", googleOAuth: null, microsoftOAuth: null,
  };
}

test("availableNow and evidenceRatio follow the activity rules", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const at = (h: number) => new Date(`2026-09-26T${String(h).padStart(2, "0")}:00:00Z`);
  assert.equal(availableNow({ status: "open", opens_at: null, due_at: null }, now), true);
  assert.equal(availableNow({ status: "draft", opens_at: null, due_at: null }, now), false);
  assert.equal(availableNow({ status: "open", opens_at: at(11), due_at: null }, now), false, "not open yet");
  assert.equal(availableNow({ status: "open", opens_at: at(9), due_at: at(10) }, now), false, "due is exclusive");
  const attempts = [
    { id: "1", status: "finished", correct_count: 1, question_count: 4, started_at: at(1), finished_at: at(2) },
    { id: "2", status: "finished", correct_count: 3, question_count: 4, started_at: at(3), finished_at: at(4) },
    { id: "3", status: "in_progress", correct_count: null, question_count: 4, started_at: at(5), finished_at: null },
  ];
  assert.deepEqual((["first", "last", "best", "mean"] as const).map((p) => evidenceRatio(attempts, p)), [0.25, 0.75, 0.75, 0.5]);
  assert.equal(evidenceRatio([attempts[2]!], "best"), null);
});

// Synthetic packages only: real exam content never enters this repository.
test("Practice assignments: staff create, fixed sets, start/resume, due rules, review policy, key lock", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(`TRUNCATE practice_assignments, practice_bookmarks, practice_answers, practice_attempts, practice_questions, practice_figures, exam_sessions,
    section_roster_entries, audit_log, memberships, sections, courses, sessions, auth_identities, users RESTART IDENTITY CASCADE`);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    await importPracticePackage(pool, { ...syntheticPracticePackage("2099S_XX", true), family: "itpec-ip" });
    const other = syntheticPracticePackage("2098S_XX", false);
    other.exam.time_limit_minutes = null;
    await importPracticePackage(pool, other);
    const admin = await createUserWithSession(pool, "admin@example.com", true);
    const teacher = await createUserWithSession(pool, "teacher@example.com");
    const ta = await createUserWithSession(pool, "ta@example.com");
    const alice = await createUserWithSession(pool, "alice@example.com");
    const bob = await createUserWithSession(pool, "bob@example.com");
    const send = (who: { cookie: string }, method: "POST" | "PATCH" | "DELETE", url: string, payload: unknown = {}) =>
      app.inject({ method, url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const post = (who: { cookie: string }, url: string, payload: unknown = {}) => send(who, "POST", url, payload);
    const patch = (who: { cookie: string }, url: string, payload: unknown) => send(who, "PATCH", url, payload);
    const get = (who: { cookie: string }, url: string) => app.inject({ method: "GET", url, headers: { cookie: who.cookie } });
    const sectionId = (await post(admin, "/api/courses", { code: "ITP4", title: "IT Passport", type: "semester", term: "2569/1", ownerUserId: teacher.userId })).json().sectionId as string;
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId])).rows[0]!.join_code;
    for (const who of [ta, alice, bob]) await post(who, "/api/sections/join", { code: joinCode });
    await pool.query("UPDATE memberships SET roles = ARRAY['ta'] WHERE user_id = $1", [ta.userId]);
    const list = `/api/sections/${sectionId}/practice/assignments`;
    const practice = `/api/sections/${sectionId}/practice`;
    const exams = (await get(teacher, `${practice}/exams`)).json().exams as { id: string; content_id: string }[];
    const examA = exams.find((e) => e.content_id === "2099S_XX")!.id;
    const examB = exams.find((e) => e.content_id === "2098S_XX")!.id;
    const qA = (await pool.query<{ id: string }>("SELECT q.id FROM practice_questions q JOIN exam_sessions s ON s.id = q.exam_session_id WHERE s.content_id = '2099S_XX' ORDER BY seq")).rows.map((r) => r.id);
    const KEY = ["b", "c", "a", "d"];

    // Only staff create; a TA may. Drafts are invisible to learners.
    assert.equal((await post(alice, list, { title: "Nope", kind: "exam", examId: examA })).statusCode, 403);
    const created = await post(ta, list, { title: "Mock 1", kind: "exam", examId: examA });
    assert.equal(created.statusCode, 201);
    const mock = created.json().assignment;
    assert.deepEqual([mock.status, mock.questionCount, mock.timeLimitSeconds, mock.maxAttempts, mock.evidencePolicy, mock.reviewPolicy], ["draft", 4, 600, 1, "best", "after_due"]);
    assert.deepEqual((await get(alice, list)).json().assignments, []);
    assert.equal((await post(alice, `/api/practice-assignments/${mock.id}/attempts`)).statusCode, 404, "a draft does not exist for learners");
    assert.deepEqual((await post(teacher, list, { title: "Set", kind: "set", category: "Beta", count: 3 })).json(), { error: "TIME_LIMIT_REQUIRED" });
    const set = (await post(teacher, list, { title: "Beta set", kind: "set", category: "Beta", count: 3, timed: false })).json().assignment;
    assert.deepEqual([set.questionCount, set.timeLimitSeconds, set.examId], [3, null, null], "drawn from every session");
    assert.deepEqual((await post(teacher, list, { title: "No", kind: "exam" })).json(), { error: "EXAM_REQUIRED" });

    // Open it: available even though free practice is off for this Section.
    const due = new Date(Date.now() + 3600_000).toISOString();
    assert.equal((await patch(alice, `/api/practice-assignments/${mock.id}`, { status: "open" })).statusCode, 404, "a learner cannot even see a draft");
    assert.equal((await patch(teacher, `/api/practice-assignments/${mock.id}`, { status: "open", dueAt: due })).json().assignment.availableNow, true);
    assert.equal((await get(teacher, `/api/sections/${sectionId}`)).json().section.practice_assignment_count, 1);
    const started = await post(alice, `/api/practice-assignments/${mock.id}/attempts`, { lang: "th" });
    assert.deepEqual([started.statusCode, started.json().resumed], [201, false]);
    const attemptId = started.json().attemptId as string;
    assert.deepEqual((await post(alice, `/api/practice-assignments/${mock.id}/attempts`)).json(), { attemptId, resumed: true });
    const aUrl = `${practice}/attempts/${attemptId}`;
    let state = (await get(alice, aUrl)).json();
    assert.deepEqual([state.attempt.mode, state.attempt.assignmentId, state.questions.length, state.assignment.reviewOpen], ["exam", mock.id, 4, false]);
    assert.ok(state.attempt.deadlineAt, "timed: its own deadline");
    assert.equal((await get(alice, `${practice}/exams`)).statusCode, 403, "free practice is still off");

    // Key lock while it is open (free practice switched on to reach those paths).
    await patch(teacher, practice, { enabled: true });
    const browse = (await get(alice, `${practice}/exams/${examA}/questions?limit=4`)).json().questions;
    assert.deepEqual(browse.map((q: { answer?: string; locked?: boolean }) => [q.answer ?? null, q.locked ?? false]), [[null, true], [null, true], [null, true], [null, true]]);
    assert.equal((await get(teacher, `${practice}/exams/${examA}/questions?limit=1`)).json().questions[0].answer, "b", "staff are exempt");
    assert.deepEqual((await post(alice, `${practice}/attempts`, { mode: "practice", examId: examA })).json(), { error: "NO_QUESTIONS" });
    assert.deepEqual((await post(alice, `${practice}/attempts`, { mode: "exam", examId: examA })).json(), { error: "LOCKED_BY_ASSIGNMENT" });
    const quiz = (await post(alice, `${practice}/attempts`, { mode: "quiz", count: 10 })).json();
    const quizIds = (await pool.query<{ question_ids: string[] }>("SELECT question_ids FROM practice_attempts WHERE id = $1", [quiz.attemptId])).rows[0]!.question_ids;
    assert.ok(quizIds.length === 4 && quizIds.every((id) => !qA.includes(id)), "a quiz draws around the locked questions");

    // Take it: score now, key only after the due date (review policy after_due).
    for (const [i, sel] of [[0, "b"], [1, "c"], [2, "b"]] as const) await post(alice, `${aUrl}/answers`, { questionId: qA[i], selected: sel });
    assert.deepEqual((await post(alice, `${aUrl}/finish`)).json(), { correctCount: 2, answeredCount: 3, questionCount: 4 });
    state = (await get(alice, aUrl)).json();
    assert.deepEqual([state.result.correct, state.review, state.assignment.reviewOpen], [2, null, false]);
    assert.equal(state.result.pass, false, "a whole paper keeps the pass estimate");
    assert.ok(!JSON.stringify(state).includes('"answer"'));
    assert.equal((await get(teacher, aUrl)).json().review.length, 4, "staff see the review");
    const mine = (await get(alice, list)).json().assignments.find((a: { id: string }) => a.id === mock.id);
    assert.deepEqual([mine.myScoreRatio, mine.attemptsLeft, mine.myAttempts.length, "progress" in mine], [0.5, 0, 1, false]);
    assert.deepEqual((await post(alice, `/api/practice-assignments/${mock.id}/attempts`)).json(), { error: "NO_ATTEMPTS_LEFT" });
    assert.equal((await patch(alice, `/api/practice-assignments/${mock.id}`, { status: "closed" })).statusCode, 403, "learners cannot change an open one");
    const staffRow = (await get(teacher, list)).json().assignments.find((a: { id: string }) => a.id === mock.id);
    assert.deepEqual(staffRow.progress, { started: 1, submitted: 1 });
    await post(teacher, `/api/practice-assignments/${mock.id}/attempts`); // a teacher's preview
    assert.deepEqual((await get(teacher, list)).json().assignments.find((a: { id: string }) => a.id === mock.id).progress, { started: 1, submitted: 1 }, "staff previews are not progress");

    // Just past the due date, a timed attempt started before it may still run (up to the 10-minute
    // limit plus grace): starts stop, but the key stays locked and the review closed until then.
    await pool.query("UPDATE practice_assignments SET due_at = now() - interval '1 minute' WHERE id = $1", [mock.id]);
    assert.deepEqual((await post(bob, `/api/practice-assignments/${mock.id}/attempts`)).json(), { error: "NOT_AVAILABLE" });
    state = (await get(alice, aUrl)).json();
    assert.deepEqual([state.review, state.assignment.reviewOpen], [null, false]);
    assert.equal(new Date(state.assignment.reviewOpensAt).getTime() - new Date(state.assignment.dueAt).getTime(), 605_000, "due + limit + grace");
    assert.equal((await get(alice, `${practice}/exams/${examA}/questions?limit=1`)).json().questions[0].locked, true, "still locked");
    // Past due + limit + grace: the review opens, the lock lifts.
    await pool.query("UPDATE practice_assignments SET due_at = now() - interval '11 minutes' WHERE id = $1", [mock.id]);
    state = (await get(alice, aUrl)).json();
    assert.deepEqual([state.assignment.reviewOpen, state.review.length, state.review[2].question.answer, state.review[2].correct], [true, 4, "a", false]);
    assert.equal((await get(alice, `${practice}/exams/${examA}/questions?limit=1`)).json().questions[0].answer, "b", "unlocked");

    // Untimed: the attempt ends at the due date, follows a changed due date, and closing ends it.
    await patch(teacher, `/api/practice-assignments/${set.id}`, { status: "open", dueAt: due });
    const bobSet = (await post(bob, `/api/practice-assignments/${set.id}/attempts`)).json().attemptId as string;
    const aliceSet = (await post(alice, `/api/practice-assignments/${set.id}/attempts`)).json().attemptId as string;
    const setIds = await pool.query<{ question_ids: string[] }>("SELECT question_ids FROM practice_attempts WHERE id = ANY($1::uuid[])", [[bobSet, aliceSet]]);
    assert.deepEqual(setIds.rows[0]!.question_ids, setIds.rows[1]!.question_ids, "everyone gets the same set");
    const bobUrl = `${practice}/attempts/${bobSet}`;
    assert.equal(new Date((await get(bob, bobUrl)).json().attempt.deadlineAt).toISOString(), due);
    const later = new Date(Date.now() + 7200_000).toISOString();
    await patch(teacher, `/api/practice-assignments/${set.id}`, { dueAt: later });
    assert.equal(new Date((await get(bob, bobUrl)).json().attempt.deadlineAt).toISOString(), later);
    await patch(teacher, `/api/practice-assignments/${set.id}`, { status: "closed" });
    await pool.query("UPDATE practice_attempts SET deadline_at = deadline_at - interval '10 seconds' WHERE id = $1", [bobSet]);
    state = (await get(bob, bobUrl)).json();
    assert.deepEqual([state.attempt.status, state.attempt.finishReason, state.assignment.reviewOpen], ["finished", "time_up", true], "closed opens the review");
    assert.deepEqual([state.result.questions, state.result.pass], [3, null], "no pass estimate for a drawn set");

    // Several attempts and the evidence policy; review right after submission.
    const multi = (await post(teacher, list, { title: "Retry", kind: "exam", examId: examA, maxAttempts: 2, reviewPolicy: "after_submit", timed: false })).json().assignment;
    await patch(teacher, `/api/practice-assignments/${multi.id}`, { status: "open" });
    for (const right of [1, 3]) {
      const id = (await post(alice, `/api/practice-assignments/${multi.id}/attempts`)).json().attemptId as string;
      for (let i = 0; i < 4; i++) await post(alice, `${practice}/attempts/${id}/answers`, { questionId: qA[i], selected: i < right ? KEY[i] : KEY[i] === "a" ? "b" : "a" });
      await post(alice, `${practice}/attempts/${id}/finish`);
      assert.ok((await get(alice, `${practice}/attempts/${id}`)).json().review, "after_submit: review at once");
    }
    const ratio = async () => (await get(alice, list)).json().assignments.find((a: { id: string }) => a.id === multi.id).myScoreRatio;
    assert.equal(await ratio(), 0.75, "best");
    await patch(teacher, `/api/practice-assignments/${multi.id}`, { evidencePolicy: "first" });
    assert.equal(await ratio(), 0.25);
    await patch(teacher, `/api/practice-assignments/${multi.id}`, { evidencePolicy: "mean" });
    assert.equal(await ratio(), 0.5);

    // Delete only before anyone attempted it.
    assert.deepEqual((await send(teacher, "DELETE", `/api/practice-assignments/${multi.id}`)).json(), { error: "HAS_ATTEMPTS" });
    const spare = (await post(teacher, list, { title: "Spare", kind: "exam", examId: examB, timed: false })).json().assignment;
    assert.equal((await send(teacher, "DELETE", `/api/practice-assignments/${spare.id}`)).statusCode, 204);
    assert.deepEqual((await post(teacher, list, { title: "B timed", kind: "exam", examId: examB })).json(), { error: "TIME_LIMIT_REQUIRED" }, "a session without a limit");
    assert.equal((await pool.query("SELECT 1 FROM audit_log WHERE event_type = 'practice.assignment_created'")).rowCount, 4);
  } finally {
    await app.close();
  }
});

// Phase 3b (PS-TASK-20260926-789): results, CSV export, and gradebook sync. Synthetic packages only.
test("Practice assignment results, CSV export, and gradebook sync", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(`TRUNCATE practice_assignments, practice_bookmarks, practice_answers, practice_attempts, practice_questions, practice_figures, exam_sessions,
    scores, assignments, categories, section_roster_entries, audit_log, memberships, sections, courses, sessions, auth_identities, users RESTART IDENTITY CASCADE`);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    await importPracticePackage(pool, { ...syntheticPracticePackage("2099S_XX", true), family: "itpec-ip" });
    const admin = await createUserWithSession(pool, "admin@example.com", true);
    const teacher = await createUserWithSession(pool, "teacher@example.com");
    const ta = await createUserWithSession(pool, "ta@example.com");
    const [alice, bob, carol] = await Promise.all(["alice", "bob", "carol"].map((n) => createUserWithSession(pool, `${n}@example.com`))) as [typeof admin, typeof admin, typeof admin];
    const send = (who: { cookie: string }, method: "POST" | "PATCH", url: string, payload: unknown = {}) =>
      app.inject({ method, url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const post = (who: { cookie: string }, url: string, payload: unknown = {}) => send(who, "POST", url, payload);
    const patch = (who: { cookie: string }, url: string, payload: unknown) => send(who, "PATCH", url, payload);
    const get = (who: { cookie: string }, url: string) => app.inject({ method: "GET", url, headers: { cookie: who.cookie } });
    const course = (await post(admin, "/api/courses", { code: "ITP5", title: "IT Passport", type: "semester", term: "2569/1", ownerUserId: teacher.userId })).json();
    const sectionId = course.sectionId as string;
    const other = (await post(admin, "/api/courses", { code: "ITP6", title: "Other", type: "semester", term: "2569/1", ownerUserId: teacher.userId })).json().sectionId as string;
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId])).rows[0]!.join_code;
    for (const who of [ta, alice, bob, carol]) await post(who, "/api/sections/join", { code: joinCode });
    await pool.query("UPDATE memberships SET roles = ARRAY['ta'] WHERE user_id = $1", [ta.userId]);
    const exams = (await get(teacher, `/api/sections/${sectionId}/practice/exams`)).json().exams as { id: string }[];
    const qA = (await pool.query<{ id: string }>("SELECT id FROM practice_questions ORDER BY seq")).rows.map((r) => r.id);
    const KEY = ["b", "c", "a", "d"];
    const pa = (await post(teacher, `/api/sections/${sectionId}/practice/assignments`, { title: "Mock", kind: "exam", examId: exams[0]!.id, timed: false, maxAttempts: 2 })).json().assignment;
    const base = `/api/practice-assignments/${pa.id}`;
    await patch(teacher, base, { status: "open" });
    const take = async (who: typeof admin, right: number) => {
      const id = (await post(who, `${base}/attempts`)).json().attemptId as string;
      for (let i = 0; i < 4; i++) {
        await post(who, `/api/sections/${sectionId}/practice/attempts/${id}/answers`, { questionId: qA[i], selected: i < right ? KEY[i] : KEY[i] === "a" ? "b" : "a" });
      }
      await post(who, `/api/sections/${sectionId}/practice/attempts/${id}/finish`);
    };
    await take(alice, 1);
    await take(alice, 3);
    await take(bob, 2);
    await take(teacher, 4); // a preview: never a learner result
    await take(ta, 4);

    // Results: staff (a TA too) only; learners are the Section's students.
    assert.equal((await get(alice, `${base}/results`)).statusCode, 403);
    const results = (await get(ta, `${base}/results`)).json();
    assert.equal(results.canSync, false, "a TA sees results but cannot sync");
    assert.deepEqual(
      [results.summary.learners, results.summary.notStarted, results.summary.submitted, results.summary.mean, results.summary.median],
      [3, 1, 2, 0.625, 0.625],
    );
    assert.deepEqual(results.summary.distribution.map((b: { count: number }) => b.count), [0, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
    const row = (email: string) => results.learners.find((l: { email: string }) => l.email === email);
    assert.deepEqual([row("alice@example.com").attempts, row("alice@example.com").evidenceRatio, row("carol@example.com").status], [2, 0.75, "not_started"]);
    assert.equal(row("alice@example.com").evidenceAttemptId, row("alice@example.com").lastFinishedAttemptId, "best is her second (latest) attempt here");
    assert.deepEqual(row("alice@example.com").fields.map((f: { field: string; correct: number }) => [f.field, f.correct]).sort(), [["Strategy", 2], ["Technology", 1]]);
    assert.ok(!results.learners.some((l: { email: string }) => l.email.startsWith("teacher") || l.email.startsWith("ta@")));
    assert.equal(results.items.length, 4);
    assert.ok(results.items.every((i: { attempts: number }) => i.attempts === 3), "every finished learner attempt, no staff");
    assert.deepEqual(results.items.map((i: { correct: number }) => i.correct), [0, 1, 2, 3], "hardest first: q4 never right, q1 always");

    // CSV: points appear once a gradebook assignment is linked.
    let csv = (await get(teacher, `${base}/results/export`)).body.split("\n");
    assert.equal(csv[0], "Student ID,Student Name,Student Email,Status,Attempts,Score % (best),Last Finished At");
    assert.ok(csv.some((l) => l.includes("alice@example.com,submitted,2,75.00,")));

    // Linking: owner/teacher only, and only to this Section's gradebook.
    const cat = (await post(teacher, `/api/sections/${sectionId}/categories`, { name: "Practice", weight: 20 })).json().category.id as string;
    const cell = (await post(teacher, `/api/categories/${cat}/assignments`, { name: "Mock", maxPoints: 10 })).json().assignment.id as string;
    const otherCat = (await post(teacher, `/api/sections/${other}/categories`, { name: "X", weight: 1 })).json().category.id as string;
    const otherCell = (await post(teacher, `/api/categories/${otherCat}/assignments`, { name: "X", maxPoints: 5 })).json().assignment.id as string;
    assert.deepEqual((await get(teacher, `${base}/gradebook-sync`)).json(), { error: "NO_LINKED_ASSIGNMENT" });
    assert.equal((await patch(ta, base, { gradebookAssignmentId: cell })).statusCode, 403);
    assert.deepEqual((await patch(teacher, base, { gradebookAssignmentId: otherCell })).json(), { error: "GRADEBOOK_ASSIGNMENT_NOT_IN_SECTION" });
    assert.equal((await patch(teacher, base, { gradebookAssignmentId: cell })).json().assignment.gradebookAssignmentId, cell);
    csv = (await get(teacher, `${base}/results/export`)).body.split("\n");
    assert.ok(csv[0]!.endsWith(",Points (of 10)") && csv.some((l) => l.includes("alice@example.com,submitted,2,75.00,") && l.endsWith(",7.5")));

    // Sync: preview, then apply; blanks stay blank; hand edits are kept unless ticked.
    assert.equal((await get(ta, `${base}/gradebook-sync`)).statusCode, 403);
    const status = async () => Object.fromEntries(((await get(teacher, `${base}/gradebook-sync`)).json().rows as { email: string; status: string; newPoints: number | null }[])
      .map((r) => [r.email.split("@")[0], [r.status, r.newPoints]]));
    assert.deepEqual(await status(), { alice: ["new", 7.5], bob: ["new", 5], carol: ["no_attempt", null] });
    const applied = (await post(teacher, `${base}/gradebook-sync`, {})).json();
    assert.deepEqual([applied.written.length, applied.counts.no_attempt], [2, 1]);
    assert.equal((await pool.query("SELECT 1 FROM scores WHERE assignment_id = $1 AND user_id = $2", [cell, carol.userId])).rowCount, 0, "never zeroed");
    // A cell last written by something else (an activity sync clears this assignment's provenance)
    // is never taken for this assignment's own, even when it matches synced_points.
    await pool.query("UPDATE scores SET points_earned = 3, synced_points = 3, synced_from_practice_assignment_id = NULL WHERE assignment_id = $1 AND user_id = $2", [cell, alice.userId]);
    assert.deepEqual((await status()).alice, ["manual", 7.5]);
    await post(teacher, `${base}/gradebook-sync`, { overwriteUserIds: [alice.userId] });
    await post(teacher, `/api/assignments/${cell}/scores/${bob.userId}`, { pointsEarned: 6 }); // a hand edit
    await patch(teacher, base, { evidencePolicy: "first" });
    assert.deepEqual(await status(), { alice: ["changed", 2.5], bob: ["manual", 5], carol: ["no_attempt", null] });
    await post(teacher, `${base}/gradebook-sync`, {});
    const points = async (u: string) => Number((await pool.query<{ points_earned: string }>("SELECT points_earned FROM scores WHERE assignment_id = $1 AND user_id = $2", [cell, u])).rows[0]!.points_earned);
    assert.deepEqual([await points(alice.userId), await points(bob.userId)], [2.5, 6], "the hand edit is kept");
    await post(teacher, `${base}/gradebook-sync`, { overwriteUserIds: [bob.userId] });
    assert.equal(await points(bob.userId), 5, "ticked: overwritten");
    assert.equal((await pool.query("SELECT 1 FROM audit_log WHERE event_type = 'practice.assignment_gradebook_synced'")).rowCount, 4);
    const firstPolicy = (await get(teacher, `${base}/results`)).json().learners.find((l: { email: string }) => l.email === "alice@example.com");
    assert.notEqual(firstPolicy.evidenceAttemptId, firstPolicy.lastFinishedAttemptId, "under 'first' the score links to her first attempt");
  } finally {
    await app.close();
  }
});
