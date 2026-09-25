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
    assert.deepEqual(state.byCategory, [{ category: "Alpha", field: "Strategy", answered: 2, correct: 1 }, { category: "Beta", field: "Technology", answered: 2, correct: 1 }]);
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
