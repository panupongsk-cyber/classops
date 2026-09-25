import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { importPracticePackage } from "../src/scripts/import-practice.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";
import { syntheticPracticePackage, TINY_PNG } from "./fixtures/synthetic-practice.js";

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

// Synthetic packages only (test/fixtures/synthetic-practice.ts): real exam content never enters this repository.
test("Exam practice: per-Section opt-in, browse, practice, quick quiz, no key before the answer, figures", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(`TRUNCATE practice_answers, practice_attempts, practice_questions, practice_figures, exam_sessions, section_roster_entries,
    audit_log, memberships, sections, courses, sessions, auth_identities, users RESTART IDENTITY CASCADE`);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    await importPracticePackage(pool, syntheticPracticePackage("2099S_XX", true));
    await importPracticePackage(pool, syntheticPracticePackage("2099A_XX", false));
    const admin = await createUserWithSession(pool, "admin@example.com", true);
    const teacher = await createUserWithSession(pool, "teacher@example.com");
    const alice = await createUserWithSession(pool, "alice@example.com");
    const bob = await createUserWithSession(pool, "bob@example.com");
    const post = (who: { cookie: string }, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const get = (who: { cookie: string } | null, url: string) => app.inject({ method: "GET", url, headers: who ? { cookie: who.cookie } : {} });
    const sectionId = (await post(admin, "/api/courses", { code: "ITP1", title: "IT Passport", type: "semester", term: "2569/1", ownerUserId: teacher.userId })).json().sectionId as string;
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId])).rows[0]!.join_code;
    for (const who of [alice, bob]) await post(who, "/api/sections/join", { code: joinCode });
    const base = `/api/sections/${sectionId}/practice`;

    // Off by default: students are refused; staff may preview; only owner/teacher/admin toggles.
    assert.deepEqual((await get(alice, `${base}/exams`)).json(), { error: "PRACTICE_NOT_ENABLED" });
    const preview = (await get(teacher, `${base}/exams`)).json();
    assert.deepEqual([preview.enabled, preview.canManage, preview.exams.length], [false, true, 2]);
    assert.deepEqual(preview.exams.map((e: { content_id: string }) => e.content_id), ["2099A_XX", "2099S_XX"], "October (A) before April (S) of the same year");
    assert.equal((await app.inject({ method: "PATCH", url: base, headers: { cookie: alice.cookie, ...origin }, payload: { enabled: true } })).statusCode, 403);
    assert.equal((await app.inject({ method: "PATCH", url: base, headers: { cookie: teacher.cookie, ...origin }, payload: { enabled: true } })).statusCode, 200);
    assert.equal((await get(teacher, `/api/sections/${sectionId}`)).json().section.practice_enabled, true);
    const catalogue = (await get(alice, `${base}/exams`)).json();
    const examTh = catalogue.exams.find((e: { content_id: string }) => e.content_id === "2099S_XX");
    assert.deepEqual([catalogue.enabled, catalogue.canManage, examTh.languages, examTh.category_provenance], [true, false, ["en", "th"], "analyst-inferred"]);
    assert.ok(!JSON.stringify(catalogue).includes('"answer"'));

    // Browse: answers shown, category filter, paging.
    const browse = (await get(alice, `${base}/exams/${examTh.id}/questions?category=Beta&limit=1`)).json();
    assert.deepEqual([browse.total, browse.questions.length, browse.questions[0].seq, browse.questions[0].answer], [2, 1, 3, "a"]);
    const withFigure = (await get(alice, `${base}/exams/${examTh.id}/questions?limit=4`)).json().questions[1];
    assert.deepEqual([withFigure.figure.en, withFigure.stem.th], ["/api/practice/figures/2099S_XX_Q002_en", "คำถามสังเคราะห์ 2"]);

    // Practice: one at a time, in order, key only after answering.
    assert.deepEqual((await post(alice, `${base}/attempts`, { mode: "practice" })).json(), { error: "EXAM_REQUIRED" });
    const started = await post(alice, `${base}/attempts`, { mode: "practice", examId: examTh.id, lang: "th" });
    assert.deepEqual([started.statusCode, started.json().questionCount], [201, 4]);
    const attemptUrl = `${base}/attempts/${started.json().attemptId}`;
    let state = (await get(alice, attemptUrl)).json();
    assert.equal(state.next.seq, 1);
    assert.ok(!("answer" in state.next) && !JSON.stringify(state).includes('"answer"'), "no key before the answer");
    const q = await pool.query<{ id: string; seq: number }>("SELECT q.id, q.seq FROM practice_questions q JOIN exam_sessions s ON s.id = q.exam_session_id WHERE s.content_id = '2099S_XX' ORDER BY seq");
    const qid = (seq: number) => q.rows[seq - 1]!.id;
    assert.equal((await post(alice, `${attemptUrl}/answers`, { questionId: qid(2), selected: "c" })).json().error, "OUT_OF_ORDER");
    assert.equal((await post(bob, `${attemptUrl}/answers`, { questionId: qid(1), selected: "b" })).statusCode, 403, "not bob's attempt");
    const wrong = (await post(alice, `${attemptUrl}/answers`, { questionId: qid(1), selected: "a" })).json();
    assert.deepEqual([wrong.correct, wrong.answer, wrong.next.seq, "answer" in wrong.next], [false, "b", 2, false]);
    assert.equal((await post(alice, `${attemptUrl}/answers`, { questionId: qid(1), selected: "b" })).json().error, "ALREADY_ANSWERED");
    assert.equal((await post(alice, `${attemptUrl}/answers`, { questionId: qid(2), selected: "z" })).json().error, "NOT_AN_OPTION");
    for (const [seq, sel] of [[2, "c"], [3, "a"], [4, "a"]] as const) await post(alice, `${attemptUrl}/answers`, { questionId: qid(seq), selected: sel });
    const finished = (await post(alice, `${attemptUrl}/finish`)).json();
    assert.deepEqual(finished, { correctCount: 2, answeredCount: 4, questionCount: 4 }, "scored against the key: b, c, a, d");
    assert.equal((await post(alice, `${attemptUrl}/finish`)).statusCode, 409);
    state = (await get(alice, attemptUrl)).json();
    assert.deepEqual([state.attempt.status, state.attempt.correctCount, state.review.length, state.review[0].selected, state.review[0].question.answer], ["finished", 2, 4, "a", "b"]);
    assert.deepEqual(state.byCategory, [{ category: "Alpha", field: "Strategy", questions: 2, answered: 2, correct: 1 }, { category: "Beta", field: "Technology", questions: 2, answered: 2, correct: 1 }]);
    assert.equal((await get(bob, attemptUrl)).statusCode, 403, "a classmate cannot read it");
    assert.equal((await get(teacher, attemptUrl)).statusCode, 200, "staff can");

    // Quick quiz across all sessions, and with a category filter.
    const quiz = await post(alice, `${base}/attempts`, { mode: "quiz", count: 3 });
    assert.equal(quiz.json().questionCount, 3);
    const quizIds = (await pool.query<{ question_ids: string[] }>("SELECT question_ids FROM practice_attempts WHERE id = $1", [quiz.json().attemptId])).rows[0]!.question_ids;
    assert.equal(new Set(quizIds).size, 3);
    const betaOnly = await post(alice, `${base}/attempts`, { mode: "quiz", count: 10, category: "Beta" });
    assert.equal(betaOnly.json().questionCount, 4, "both sessions' Beta questions");
    assert.deepEqual((await post(alice, `${base}/attempts`, { mode: "quiz", category: "Nope" })).json(), { error: "NO_QUESTIONS" });

    const history = (await get(alice, `${base}/attempts`)).json().attempts as { mode: string; status: string }[];
    assert.deepEqual(history.map((h) => h.mode).sort(), ["practice", "quiz", "quiz"]);
    assert.equal((await get(bob, `${base}/attempts`)).json().attempts.length, 0, "only the caller's own");

    // Figures: signed-in only, PNG bytes, private caching.
    assert.equal((await get(null, "/api/practice/figures/2099S_XX_Q002_en")).statusCode, 401);
    const fig = await get(alice, "/api/practice/figures/2099S_XX_Q002_en");
    assert.deepEqual([fig.statusCode, fig.headers["content-type"], fig.headers["cache-control"]], [200, "image/png", "private, max-age=86400"]);
    assert.ok(fig.rawPayload.equals(TINY_PNG));
    assert.equal((await get(alice, "/api/practice/figures/nope")).statusCode, 404);

    // Turning it off again locks students out, not staff.
    await app.inject({ method: "PATCH", url: base, headers: { cookie: teacher.cookie, ...origin }, payload: { enabled: false } });
    assert.equal((await get(alice, `${base}/exams`)).statusCode, 403);
    assert.equal((await pool.query("SELECT 1 FROM audit_log WHERE event_type = 'practice.section_toggled'")).rowCount, 2);
  } finally {
    await app.close();
  }
});

// Phase 2a (PS-TASK-20260925-767): the mock exam. Synthetic packages only.
test("Mock exam: whole paper, no key until finished, changeable answers and flags, server deadline, pass estimate", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(`TRUNCATE practice_answers, practice_attempts, practice_questions, practice_figures, exam_sessions, section_roster_entries,
    audit_log, memberships, sections, courses, sessions, auth_identities, users RESTART IDENTITY CASCADE`);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    await importPracticePackage(pool, { ...syntheticPracticePackage("2099S_XX", true), family: "itpec-ip" });
    const untimedPkg = syntheticPracticePackage("2098S_XX", false);
    untimedPkg.exam.time_limit_minutes = null;
    await importPracticePackage(pool, untimedPkg);
    const admin = await createUserWithSession(pool, "admin@example.com", true);
    const teacher = await createUserWithSession(pool, "teacher@example.com");
    const alice = await createUserWithSession(pool, "alice@example.com");
    const bob = await createUserWithSession(pool, "bob@example.com");
    const post = (who: { cookie: string }, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const get = (who: { cookie: string }, url: string) => app.inject({ method: "GET", url, headers: { cookie: who.cookie } });
    const sectionId = (await post(admin, "/api/courses", { code: "ITP2", title: "IT Passport", type: "semester", term: "2569/1", ownerUserId: teacher.userId })).json().sectionId as string;
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId])).rows[0]!.join_code;
    for (const who of [alice, bob]) await post(who, "/api/sections/join", { code: joinCode });
    await app.inject({ method: "PATCH", url: `/api/sections/${sectionId}/practice`, headers: { cookie: teacher.cookie, ...origin }, payload: { enabled: true } });
    const base = `/api/sections/${sectionId}/practice`;
    const exams = (await get(alice, `${base}/exams`)).json().exams as { id: string; content_id: string }[];
    const examId = exams.find((e) => e.content_id === "2099S_XX")!.id;
    const untimedExamId = exams.find((e) => e.content_id === "2098S_XX")!.id;
    const q = await pool.query<{ id: string }>("SELECT q.id FROM practice_questions q JOIN exam_sessions s ON s.id = q.exam_session_id WHERE s.content_id = '2099S_XX' ORDER BY seq");
    const qid = (seq: number) => q.rows[seq - 1]!.id; // keys: b, c, a, d; fields: 1-2 Strategy, 3-4 Technology

    assert.deepEqual((await post(alice, `${base}/attempts`, { mode: "exam" })).json(), { error: "EXAM_REQUIRED" });
    const started = await post(alice, `${base}/attempts`, { mode: "exam", examId, category: "Beta" });
    assert.deepEqual([started.statusCode, started.json().questionCount, started.json().timeLimitSeconds], [201, 4, 600], "the whole paper, category ignored");
    const url = `${base}/attempts/${started.json().attemptId}`;
    let state = (await get(alice, url)).json();
    assert.deepEqual([state.questions.length, state.questions.map((x: { seq: number }) => x.seq), state.selections, state.flagged, state.attempt.correctCount], [4, [1, 2, 3, 4], {}, [], null]);
    assert.ok(state.attempt.deadlineAt && state.serverNow);
    assert.ok(!JSON.stringify(state).includes('"answer"'), "no key while the exam runs");

    // Any order, changeable, clearable; the response never says whether it was right.
    const saved = (await post(alice, `${url}/answers`, { questionId: qid(3), selected: "a" })).json();
    assert.deepEqual(saved, { saved: true, answeredCount: 1 });
    await post(alice, `${url}/answers`, { questionId: qid(1), selected: "a" });
    assert.deepEqual((await post(alice, `${url}/answers`, { questionId: qid(1), selected: "b" })).json(), { saved: true, answeredCount: 2 }, "changed, not added");
    assert.deepEqual((await post(alice, `${url}/answers`, { questionId: qid(3), selected: null })).json(), { saved: true, answeredCount: 1 }, "cleared");
    await post(alice, `${url}/answers`, { questionId: qid(3), selected: "a" });
    assert.equal((await post(alice, `${url}/answers`, { questionId: qid(2), selected: "z" })).json().error, "NOT_AN_OPTION");
    assert.equal((await post(bob, `${url}/answers`, { questionId: qid(2), selected: "c" })).statusCode, 403);

    // Flags.
    assert.deepEqual((await post(alice, `${url}/flags`, { questionId: qid(2), flagged: true })).json(), { flagged: [qid(2)] });
    await post(alice, `${url}/flags`, { questionId: qid(2), flagged: true });
    await post(alice, `${url}/flags`, { questionId: qid(4), flagged: true });
    assert.deepEqual((await post(alice, `${url}/flags`, { questionId: qid(2), flagged: false })).json(), { flagged: [qid(4)] });
    state = (await get(alice, url)).json();
    assert.deepEqual([state.selections[qid(1)], state.selections[qid(3)], state.flagged], ["b", "a", [qid(4)]], "resume restores selections and flags");
    const staffView = (await get(teacher, url)).json();
    assert.ok(!("questions" in staffView) && !JSON.stringify(staffView).includes('"answer"'), "staff see progress, not the paper or keys");
    const listed = (await get(alice, `${base}/attempts`)).json().attempts[0];
    assert.deepEqual([listed.mode, listed.status, listed.correct_count], ["exam", "in_progress", null]);

    // Finish: the score, per field, and the ITPEC pass estimate (60% total, 30% per field).
    assert.deepEqual((await post(alice, `${url}/finish`)).json(), { correctCount: 2, answeredCount: 2, questionCount: 4 });
    state = (await get(alice, url)).json();
    assert.deepEqual([state.attempt.status, state.attempt.finishReason, state.attempt.correctCount], ["finished", "submitted", 2]);
    assert.deepEqual(
      [state.result.correct, state.result.questions, state.result.pass, state.result.rule],
      [2, 4, false, { total: 0.6, perField: 0.3 }],
      "50% total is below 60%",
    );
    assert.deepEqual(state.result.fields.map((f: { field: string; correct: number; questions: number; pass: boolean }) => [f.field, f.correct, f.questions, f.pass]), [["Strategy", 1, 2, true], ["Technology", 1, 2, true]]);
    assert.deepEqual([state.review[3].flagged, state.review[0].question.answer, state.review[1].selected], [true, "b", null]);
    assert.equal((await post(alice, `${url}/answers`, { questionId: qid(2), selected: "c" })).json().error, "ATTEMPT_FINISHED");
    assert.equal((await post(alice, `${url}/finish`)).statusCode, 409);

    // The deadline is the server's: past it (plus 5 s grace) answers are refused and it finishes.
    const late = (await post(alice, `${base}/attempts`, { mode: "exam", examId })).json().attemptId as string;
    const lateUrl = `${base}/attempts/${late}`;
    await post(alice, `${lateUrl}/answers`, { questionId: qid(1), selected: "b" });
    await pool.query("UPDATE practice_attempts SET deadline_at = now() - interval '2 seconds' WHERE id = $1", [late]);
    assert.deepEqual((await post(alice, `${lateUrl}/answers`, { questionId: qid(2), selected: "c" })).json(), { saved: true, answeredCount: 2 }, "inside the grace window");
    await pool.query("UPDATE practice_attempts SET deadline_at = now() - interval '30 seconds' WHERE id = $1", [late]);
    assert.deepEqual((await post(alice, `${lateUrl}/answers`, { questionId: qid(3), selected: "a" })).json(), { error: "ATTEMPT_FINISHED" }, "settled on read");
    state = (await get(alice, lateUrl)).json();
    assert.deepEqual([state.attempt.status, state.attempt.finishReason, state.attempt.correctCount, state.attempt.answeredCount], ["finished", "time_up", 2, 2]);
    assert.equal(new Date(state.attempt.finishedAt).getTime(), new Date(state.attempt.deadlineAt).getTime(), "finished at the deadline, not when read");

    // Another expired exam is settled by the history list too.
    const idle = (await post(alice, `${base}/attempts`, { mode: "exam", examId })).json().attemptId as string;
    await pool.query("UPDATE practice_attempts SET deadline_at = now() - interval '1 hour' WHERE id = $1", [idle]);
    const history = (await get(alice, `${base}/attempts`)).json().attempts as { id: string; status: string; finish_reason: string }[];
    assert.deepEqual(history.filter((h) => h.id === idle).map((h) => [h.status, h.finish_reason]), [["finished", "time_up"]]);

    // Untimed by choice, and a session without a time limit can only be untimed.
    const untimed = (await post(alice, `${base}/attempts`, { mode: "exam", examId, timed: false })).json();
    assert.equal(untimed.timeLimitSeconds, null);
    assert.equal((await get(alice, `${base}/attempts/${untimed.attemptId}`)).json().attempt.deadlineAt, null);
    assert.deepEqual((await post(alice, `${base}/attempts`, { mode: "exam", examId: untimedExamId })).json(), { error: "NO_TIME_LIMIT" });
    const noRule = (await post(alice, `${base}/attempts`, { mode: "exam", examId: untimedExamId, timed: false })).json().attemptId as string;
    await post(alice, `${base}/attempts/${noRule}/finish`);
    const noRuleResult = (await get(alice, `${base}/attempts/${noRule}`)).json().result;
    assert.deepEqual([noRuleResult.pass, noRuleResult.rule], [null, null], "no pass rule for a family without one");

    // Flags belong to the mock exam only.
    const practice = (await post(alice, `${base}/attempts`, { mode: "practice", examId })).json().attemptId as string;
    assert.deepEqual((await post(alice, `${base}/attempts/${practice}/flags`, { questionId: qid(1), flagged: true })).json(), { error: "NOT_AN_EXAM" });
  } finally {
    await app.close();
  }
});

// Phase 2b (PS-TASK-20260925-770): bookmarks, mistakes, statistics, most-missed. Synthetic packages only.
test("Practice progress: bookmarks, mistakes quiz, statistics, most-missed ranking, no mid-exam leak", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(`TRUNCATE practice_bookmarks, practice_answers, practice_attempts, practice_questions, practice_figures, exam_sessions, section_roster_entries,
    audit_log, memberships, sections, courses, sessions, auth_identities, users RESTART IDENTITY CASCADE`);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    await importPracticePackage(pool, { ...syntheticPracticePackage("2099S_XX", true), family: "itpec-ip" });
    const admin = await createUserWithSession(pool, "admin@example.com", true);
    const teacher = await createUserWithSession(pool, "teacher@example.com");
    const learners = await Promise.all(["alice", "bob", "carol", "dan", "erin"].map((n) => createUserWithSession(pool, `${n}@example.com`)));
    const [alice, bob, carol, dan, erin] = learners as [typeof admin, typeof admin, typeof admin, typeof admin, typeof admin];
    const post = (who: { cookie: string }, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const get = (who: { cookie: string }, url: string) => app.inject({ method: "GET", url, headers: { cookie: who.cookie } });
    const sectionId = (await post(admin, "/api/courses", { code: "ITP3", title: "IT Passport", type: "semester", term: "2569/1", ownerUserId: teacher.userId })).json().sectionId as string;
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId])).rows[0]!.join_code;
    for (const who of learners) await post(who, "/api/sections/join", { code: joinCode });
    await app.inject({ method: "PATCH", url: `/api/sections/${sectionId}/practice`, headers: { cookie: teacher.cookie, ...origin }, payload: { enabled: true } });
    const base = `/api/sections/${sectionId}/practice`;
    const examId = (await get(alice, `${base}/exams`)).json().exams[0].id as string;
    const q = await pool.query<{ id: string }>("SELECT id FROM practice_questions ORDER BY seq");
    const qid = (seq: number) => q.rows[seq - 1]!.id; // keys: b, c, a, d
    const seqOf = (id: string) => q.rows.findIndex((r) => r.id === id) + 1;
    const KEY: Record<number, string> = { 1: "b", 2: "c", 3: "a", 4: "d" };
    const WRONG: Record<number, string> = { 1: "a", 2: "a", 3: "b", 4: "a" };
    /** Runs a quick quiz to the end; `right(seq)` decides whether each answer is correct. */
    const quiz = async (who: typeof admin, payload: object, right: (seq: number) => boolean) => {
      const started = await post(who, `${base}/attempts`, { mode: "quiz", count: 10, ...payload });
      if (started.statusCode !== 201) return started.json();
      const url = `${base}/attempts/${started.json().attemptId}`;
      let next = (await get(who, url)).json().next as { id: string } | null;
      const seen: number[] = [];
      while (next) {
        const seq = seqOf(next.id);
        seen.push(seq);
        next = (await post(who, `${url}/answers`, { questionId: next.id, selected: right(seq) ? KEY[seq] : WRONG[seq] })).json().next;
      }
      await post(who, `${url}/finish`);
      return { seen: seen.sort() };
    };

    // Bookmarks: per learner, toggled, and a quiz drawn from them.
    assert.deepEqual((await post(alice, `${base}/bookmarks`, { questionId: qid(1), bookmarked: true })).json(), { bookmarked: true, count: 1 });
    await post(alice, `${base}/bookmarks`, { questionId: qid(1), bookmarked: true });
    await post(alice, `${base}/bookmarks`, { questionId: qid(3), bookmarked: true });
    assert.deepEqual((await post(alice, `${base}/bookmarks`, { questionId: qid(3), bookmarked: false })).json(), { bookmarked: false, count: 1 });
    assert.deepEqual((await get(alice, `${base}/bookmarks`)).json(), { questionIds: [qid(1)] });
    assert.deepEqual((await get(bob, `${base}/bookmarks`)).json(), { questionIds: [] }, "only the caller's own");
    assert.equal((await post(alice, `${base}/bookmarks`, { questionId: "00000000-0000-4000-8000-000000000000", bookmarked: true })).statusCode, 404);
    assert.deepEqual(await quiz(alice, { source: "bookmarks" }, () => true), { seen: [1] });
    assert.deepEqual(await quiz(bob, { source: "bookmarks" }, () => true), { error: "NO_BOOKMARKS" });

    // Mistakes: the latest counted answer per question is wrong; answering it right removes it.
    assert.deepEqual(await quiz(alice, { source: "mistakes" }, () => true), { error: "NO_MISTAKES" });
    await quiz(alice, {}, (seq) => seq === 2 || seq === 4); // wrong on 1 and 3
    assert.deepEqual(await quiz(alice, { source: "mistakes" }, (seq) => seq === 1), { seen: [1, 3] });
    let stats = (await get(alice, `${base}/stats`)).json();
    assert.deepEqual([stats.mistakeCount, stats.bookmarkCount], [1, 1], "q1 fixed, q3 still wrong");

    // A mock exam in progress never leaks correctness into mistakes or statistics.
    const before = stats.overall;
    const exam = (await post(alice, `${base}/attempts`, { mode: "exam", examId })).json().attemptId as string;
    await post(alice, `${base}/attempts/${exam}/answers`, { questionId: qid(4), selected: "a" });
    await post(alice, `${base}/attempts/${exam}/answers`, { questionId: qid(1), selected: "b" });
    stats = (await get(alice, `${base}/stats`)).json();
    assert.deepEqual([stats.mistakeCount, stats.overall, stats.examTrend.length], [1, before, 0], "the running exam is not counted");
    assert.deepEqual(await quiz(alice, { source: "mistakes" }, () => false), { seen: [3] });
    await post(alice, `${base}/attempts/${exam}/finish`);
    stats = (await get(alice, `${base}/stats`)).json();
    assert.equal(stats.mistakeCount, 2, "after the exam: q3 and q4");
    assert.equal(stats.examTrend.length, 1);
    const trend = stats.examTrend[0];
    assert.deepEqual(
      [trend.correct, trend.questions, trend.pass, trend.fields.map((f: { field: string; correct: number; questions: number }) => [f.field, f.correct, f.questions])],
      [1, 4, false, [["Strategy", 1, 2], ["Technology", 0, 2]]],
    );
    const alpha = stats.byCategory.find((c: { category: string }) => c.category === "Alpha");
    assert.deepEqual([alpha.field, alpha.answered > 0], ["Strategy", true]);
    assert.ok(stats.overall.answered > before.answered);

    // An expired exam is settled before statistics are read.
    const expired = (await post(bob, `${base}/attempts`, { mode: "exam", examId })).json().attemptId as string;
    await post(bob, `${base}/attempts/${expired}/answers`, { questionId: qid(2), selected: "a" });
    await pool.query("UPDATE practice_attempts SET deadline_at = now() - interval '1 hour' WHERE id = $1", [expired]);
    const bobStats = (await get(bob, `${base}/stats`)).json();
    assert.deepEqual([bobStats.examTrend.length, bobStats.examTrend[0].finishReason, bobStats.mistakeCount], [1, "time_up", 1]);

    // Most-missed: at least 10 counted answers from at least 3 learners; hardest first.
    for (const [who, times] of [[bob, 4], [carol, 3], [dan, 3]] as const) {
      for (let i = 0; i < times; i++) await quiz(who, { category: "Alpha" }, (seq) => seq === 1); // q2 always wrong
    }
    for (let i = 0; i < 10; i++) await quiz(erin, { category: "Beta" }, () => false); // many answers, too few learners
    const missed = (await get(carol, `${base}/most-missed`)).json();
    assert.deepEqual([missed.minAnswers, missed.minLearners], [10, 3]);
    assert.deepEqual(missed.questions.map((m: { question: { seq: number } }) => m.question.seq), [2, 1], "q3/q4 have 10+ answers but only 2 learners");
    const top = missed.questions[0];
    assert.deepEqual([top.question.answer, top.answers - top.correct > top.correct], ["c", true]);
    assert.ok(!JSON.stringify(missed).match(/example\.com|user_id/), "anonymous");
    assert.equal((await get(teacher, `${base}/most-missed?examId=${examId}&limit=1`)).json().questions.length, 1);
  } finally {
    await app.close();
  }
});
