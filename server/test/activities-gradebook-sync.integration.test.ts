import assert from "node:assert/strict";
import test from "node:test";

import { correctAnswer, findItem, optionToken, rowToken, type ActivityPackage } from "../src/activities/engine.js";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { importActivityPackage } from "../src/scripts/import-activity.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";
import { syntheticPackage } from "./fixtures/synthetic-activity.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function createUserWithSession(pool: DatabasePool, input: { email: string; displayName: string; isPlatformAdmin?: boolean }) {
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, email_verified_at, is_platform_admin)
     VALUES ($1, $2, 'active', now(), $3) RETURNING id`,
    [input.email, input.displayName, input.isPlatformAdmin ?? false],
  );
  const userId = userResult.rows[0]!.id;
  const token = generateOpaqueToken();
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [
    userId,
    hashToken(token),
  ]);
  return { userId, cookie: `classops_session=${token}` };
}

function testConfig(url: string): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3000,
    databaseUrl: url,
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
}

const TRUNCATE = `TRUNCATE activity_responses, activity_attempts, section_activities, activity_packages,
  audit_log, likes, comments, posts, scores, assignments, categories, session_picks,
  exit_ticket_responses, exit_tickets, session_checkins, class_sessions, session_schedule_patterns,
  memberships, sections, courses, oauth_transactions, sessions, auth_identities, users
  RESTART IDENTITY CASCADE`;

type SyncRow = { userId: string; status: string; currentPoints: number | null; newPoints: number | null; evidence: { attemptCount: number; attemptId: string | null } | null };

// Synthetic package only (test/fixtures). Phase 2: the `mean` policy, the teacher-triggered
// gradebook sync with its overwrite rules, and staff verification of an attempt.
test("Learning activities: mean policy, gradebook sync preview/apply/overwrite rules, attempt verification", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(TRUNCATE);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    const pkg: ActivityPackage = syntheticPackage();
    const packageId = (await importActivityPackage(pool, pkg)).id;
    const admin = await createUserWithSession(pool, { email: "admin@example.com", displayName: "Admin", isPlatformAdmin: true });
    const teacher = await createUserWithSession(pool, { email: "teacher@example.com", displayName: "Teacher" });
    const alice = await createUserWithSession(pool, { email: "alice@example.com", displayName: "Alice" });
    const bob = await createUserWithSession(pool, { email: "bob@example.com", displayName: "Bob" });
    const carol = await createUserWithSession(pool, { email: "carol@example.com", displayName: "Carol" });

    const newSection = async (code: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: { code, title: code, type: "semester", term: "2569/1", ownerUserId: teacher.userId },
      });
      return res.json().sectionId as string;
    };
    const sectionId = await newSection("SYNC1");
    const otherSectionId = await newSection("SYNC2");
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId])).rows[0]!.join_code;
    for (const [who, studentId] of [[alice, "65000001"], [bob, "65000002"], [carol, undefined]] as const) {
      const joined = await app.inject({ method: "POST", url: "/api/sections/join", headers: { cookie: who.cookie, ...origin }, payload: { code: joinCode, ...(studentId ? { studentId } : {}) } });
      assert.equal(joined.statusCode, 200);
    }

    const post = (who: { cookie: string }, url: string, payload: unknown) =>
      app.inject({ method: "POST", url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const patch = (who: { cookie: string }, url: string, payload: unknown) =>
      app.inject({ method: "PATCH", url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const get = (who: { cookie: string }, url: string) => app.inject({ method: "GET", url, headers: { cookie: who.cookie } });

    // Gradebook assignment, max 20 points, in this Section; and one in another Section.
    const assignmentIn = async (sid: string) => {
      const category = await post(teacher, `/api/sections/${sid}/categories`, { name: "Games", weight: 1 });
      const categoryId = (category.json().category?.id ?? category.json().id) as string;
      const assignment = await post(teacher, `/api/categories/${categoryId}/assignments`, { name: "Game 1", maxPoints: 20 });
      return (assignment.json().assignment?.id ?? assignment.json().id) as string;
    };
    const assignmentId = await assignmentIn(sectionId);
    const foreignAssignmentId = await assignmentIn(otherSectionId);

    const attached = await post(teacher, `/api/sections/${sectionId}/activities`, { packageId, status: "open", evidencePolicy: "mean" });
    assert.equal(attached.statusCode, 201);
    const activityId = attached.json().activity.id as string;
    assert.equal(attached.json().activity.evidencePolicy, "mean");
    assert.equal((await patch(teacher, `/api/section-activities/${activityId}`, { evidencePolicy: "median" })).statusCode, 400);

    const syncUrl = `/api/section-activities/${activityId}/gradebook-sync`;
    assert.deepEqual([(await get(teacher, syncUrl)).statusCode, (await get(teacher, syncUrl)).json().error], [409, "NO_LINKED_ASSIGNMENT"]);
    const foreign = await patch(teacher, `/api/section-activities/${activityId}`, { assignmentId: foreignAssignmentId });
    assert.deepEqual([foreign.statusCode, foreign.json().error], [400, "ASSIGNMENT_NOT_IN_SECTION"]);
    const linked = await patch(teacher, `/api/section-activities/${activityId}`, { assignmentId });
    assert.equal(linked.json().activity.assignmentId, assignmentId);

    // Play: a fully wrong attempt and a fully correct one for Alice, one correct for Bob; Carol never plays.
    const play = async (who: { cookie: string }, correct: boolean) => {
      const started = await post(who, `/api/section-activities/${activityId}/attempts`, { lang: "en" });
      const attemptId = started.json().attempt.id as string;
      const seed = (await pool.query<{ shuffle_seed: string }>("SELECT shuffle_seed FROM activity_attempts WHERE id = $1", [attemptId])).rows[0]!.shuffle_seed;
      const wrong: Record<string, unknown> = {
        i1: { one: optionToken(seed, "i1", "one", "a"), rows: { [rowToken(seed, "i1", "rows", "r1")]: "Y", [rowToken(seed, "i1", "rows", "r2")]: "X" } },
        i2: { pair: [optionToken(seed, "i2", "pair", "p"), optionToken(seed, "i2", "pair", "q")], many: [optionToken(seed, "i2", "many", "m4")] },
        i3: { v: { [rowToken(seed, "i3", "v", "c1")]: "CANNOT", [rowToken(seed, "i3", "v", "c2")]: "CAN" } },
      };
      for (const key of ["i1", "i2", "i3"]) {
        const answer = correct ? correctAnswer(findItem(pkg, key).item, seed) : wrong[key];
        assert.equal((await post(who, `/api/activity-attempts/${attemptId}/responses`, { itemKey: key, answer })).statusCode, 200);
      }
      const finished = await post(who, `/api/activity-attempts/${attemptId}/finish`, {});
      return { attemptId, ratio: finished.json().result.scoreRatio as number };
    };
    const a1 = await play(alice, false);
    const a2 = await play(alice, true);
    const b1 = await play(bob, true);
    assert.equal(a1.ratio, 0);
    assert.equal(a2.ratio, 1);

    // A value the teacher typed for Carol before any sync: she never plays, so it must survive.
    await post(teacher, `/api/assignments/${assignmentId}/scores/${carol.userId}`, { pointsEarned: 5 });

    const preview = async () => {
      const res = await get(teacher, syncUrl);
      assert.equal(res.statusCode, 200);
      return Object.fromEntries((res.json().rows as SyncRow[]).map((r) => [r.userId, r]));
    };
    const apply = async (overwriteUserIds: string[] = []) => post(teacher, syncUrl, { overwriteUserIds });
    const cell = async (userId: string) =>
      (await pool.query<{ points_earned: string }>("SELECT points_earned FROM scores WHERE assignment_id = $1 AND user_id = $2", [assignmentId, userId])).rows[0]?.points_earned;

    // mean: Alice (0 + 1) / 2 = 0.5 -> 10 points over 2 attempts; Bob 20; Carol no attempt.
    let p = await preview();
    assert.deepEqual([p[alice.userId]!.status, p[alice.userId]!.newPoints, p[alice.userId]!.evidence!.attemptCount, p[alice.userId]!.evidence!.attemptId], ["new", 10, 2, null]);
    assert.deepEqual([p[bob.userId]!.status, p[bob.userId]!.newPoints], ["new", 20]);
    assert.deepEqual([p[carol.userId]!.status, p[carol.userId]!.currentPoints, p[carol.userId]!.newPoints], ["no_attempt", 5, null]);
    const firstSync = await apply();
    assert.equal(firstSync.statusCode, 200);
    assert.equal(firstSync.json().written.length, 2);
    assert.deepEqual([Number(await cell(alice.userId)), Number(await cell(bob.userId)), Number(await cell(carol.userId))], [10, 20, 5]);
    const audit = await pool.query<{ metadata: { counts: Record<string, number>; written: number; policy: string } }>(
      "SELECT metadata FROM audit_log WHERE event_type = 'activity.gradebook_synced' AND subject_id = $1",
      [activityId],
    );
    assert.equal(audit.rowCount, 1);
    assert.deepEqual([audit.rows[0]!.metadata.policy, audit.rows[0]!.metadata.written, audit.rows[0]!.metadata.counts.no_attempt], ["mean", 2, 1]);

    p = await preview();
    assert.deepEqual([p[alice.userId]!.status, p[bob.userId]!.status], ["unchanged", "unchanged"]);

    // Policy change -> the synced cell follows it ("changed"); best = Alice's correct attempt.
    await patch(teacher, `/api/section-activities/${activityId}`, { evidencePolicy: "best" });
    p = await preview();
    assert.deepEqual([p[alice.userId]!.status, p[alice.userId]!.newPoints, p[alice.userId]!.evidence!.attemptId], ["changed", 20, a2.attemptId]);

    // A hand edit after a sync is protected: "manual", kept unless explicitly ticked.
    await post(teacher, `/api/assignments/${assignmentId}/scores/${bob.userId}`, { pointsEarned: 15 });
    p = await preview();
    assert.deepEqual([p[bob.userId]!.status, p[bob.userId]!.currentPoints, p[bob.userId]!.newPoints], ["manual", 15, 20]);
    await apply();
    assert.deepEqual([Number(await cell(alice.userId)), Number(await cell(bob.userId)), Number(await cell(carol.userId))], [20, 15, 5]);
    const ticked = await apply([bob.userId]);
    assert.deepEqual(ticked.json().written.map((w: { userId: string }) => w.userId), [bob.userId]);
    assert.equal(Number(await cell(bob.userId)), 20);
    assert.equal(Number(await cell(carol.userId)), 5, "a learner with no attempt keeps their cell, never zeroed");

    // Staff only.
    assert.equal((await get(alice, syncUrl)).statusCode, 403);
    assert.equal((await post(alice, syncUrl, {})).statusCode, 403);

    // CSV names the attempts counted.
    const csv = await get(teacher, `/api/section-activities/${activityId}/evidence/export`);
    assert.ok(csv.body.split("\n")[0]!.includes("Evidence Attempts Counted"));

    // Verification: staff see who, which package, and a re-score of the stored answers.
    const verified = (await get(teacher, `/api/activity-attempts/${b1.attemptId}`)).json().verification;
    assert.deepEqual(
      [verified.learner.studentId, verified.package.specHashMatches, verified.storedScoreRatio, verified.rescoredScoreRatio, verified.matches],
      ["65000002", true, 1, 1, true],
    );
    assert.equal((await get(bob, `/api/activity-attempts/${b1.attemptId}`)).json().verification, undefined, "not for the learner");
    await pool.query("UPDATE activity_responses SET ratio = 0 WHERE attempt_id = $1 AND item_key = 'i1'", [b1.attemptId]);
    assert.equal((await get(teacher, `/api/activity-attempts/${b1.attemptId}`)).json().verification.matches, false, "a tampered stored ratio is caught");
  } finally {
    await app.close();
  }
});
