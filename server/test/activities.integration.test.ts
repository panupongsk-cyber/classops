import assert from "node:assert/strict";
import test from "node:test";

import { optionToken, rowToken } from "../src/activities/engine.js";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { importActivityPackage, ImportRefused } from "../src/scripts/import-activity.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";
import { syntheticPackage } from "./fixtures/synthetic-activity.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function createUserWithSession(pool: DatabasePool, input: { email: string; displayName: string; isPlatformAdmin?: boolean }) {
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, email_verified_at, is_platform_admin)
     VALUES ($1, $2, 'active', now(), $3) RETURNING id`,
    [input.email, input.displayName, input.isPlatformAdmin ?? false],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) throw new Error("test user insert did not return an id");
  await pool.query(`INSERT INTO auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', $2)`, [
    userId,
    `test-sub-${userId}`,
  ]);
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

// Nothing a GET returns may carry a key, the seed, or the raw package.
function assertNoLeak(label: string, body: string) {
  for (const leak of ["answer_key", "shuffle_seed", "\"spec\"", "scoring", "\"weight\""]) {
    assert.ok(!body.includes(leak), `${label} leaks ${leak}`);
  }
}

const TRUNCATE = `TRUNCATE activity_responses, activity_attempts, section_activities, activity_packages,
  audit_log, likes, comments, posts, scores, assignments, categories, session_picks,
  exit_ticket_responses, exit_tickets, session_checkins, class_sessions, session_schedule_patterns,
  memberships, sections, courses, oauth_transactions, sessions, auth_identities, users
  RESTART IDENTITY CASCADE`;

// Every package here is synthetic (test/fixtures): real packages carry answer keys and never
// enter this public repository. Shares TEST_DATABASE_URL with the other integration tests and
// relies on --test-concurrency=1.
test("Learning activities: import, attach, play, score, evidence, and access control", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(TRUNCATE);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };

  try {
    // --- Import ---
    const pkg = syntheticPackage();
    const imported = await importActivityPackage(pool, pkg);
    assert.equal(imported.status, "imported");
    assert.equal((await importActivityPackage(pool, syntheticPackage())).status, "unchanged");
    const changed = syntheticPackage();
    changed.title = { en: "Changed" };
    await assert.rejects(importActivityPackage(pool, changed), ImportRefused);
    await assert.rejects(importActivityPackage(pool, { format: "nope" }), ImportRefused);
    const packageId = imported.id;

    // --- People and Section ---
    const admin = await createUserWithSession(pool, { email: "admin@example.com", displayName: "Admin", isPlatformAdmin: true });
    const teacher = await createUserWithSession(pool, { email: "teacher@example.com", displayName: "Teacher" });
    const alice = await createUserWithSession(pool, { email: "alice@example.com", displayName: "=HYPERLINK(\"x\")" });
    const bob = await createUserWithSession(pool, { email: "bob@example.com", displayName: "Bob" });
    const outsider = await createUserWithSession(pool, { email: "outsider@example.com", displayName: "Outsider" });

    const course = await app.inject({
      method: "POST",
      url: "/api/courses",
      headers: { cookie: admin.cookie, ...origin },
      payload: { code: "SEC331", title: "Security", type: "semester", term: "2569/1", ownerUserId: teacher.userId },
    });
    assert.equal(course.statusCode, 201);
    const sectionId = course.json().sectionId as string;
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId]))
      .rows[0]?.join_code as string;

    const join = (who: { cookie: string }, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/sections/join", headers: { cookie: who.cookie, ...origin }, payload });
    assert.equal((await join(alice, { code: joinCode, studentId: "bad id!" })).statusCode, 400);
    assert.equal((await join(alice, { code: joinCode, studentId: "65012345" })).statusCode, 200);
    assert.equal((await join(bob, { code: joinCode })).statusCode, 200);
    const setBob = await app.inject({
      method: "PUT",
      url: `/api/sections/${sectionId}/me/student-id`,
      headers: { cookie: bob.cookie, ...origin },
      payload: { studentId: "65099999" },
    });
    assert.deepEqual([setBob.statusCode, setBob.json().studentId], [200, "65099999"]);
    const outsiderId = await app.inject({
      method: "GET",
      url: `/api/sections/${sectionId}/me/student-id`,
      headers: { cookie: outsider.cookie },
    });
    assert.equal(outsiderId.statusCode, 403);
    // Classmates' student IDs never appear in the member-visible roster.
    const roster = await app.inject({ method: "GET", url: `/api/sections/${sectionId}/memberships`, headers: { cookie: bob.cookie } });
    assert.equal(roster.statusCode, 200);
    assert.ok(!roster.body.includes("65012345"));
    // A student still sees classmates by name, but no email except their own.
    type RosterRow = { user_id: string; email: string | null; display_name: string };
    const rosterRows = roster.json().memberships as RosterRow[];
    assert.ok(rosterRows.length >= 3 && rosterRows.some((m) => m.user_id === alice.userId));
    for (const m of rosterRows) assert.equal(m.email, m.user_id === bob.userId ? "bob@example.com" : null, m.display_name);
    assert.ok(!roster.body.includes("alice@example.com") && !roster.body.includes("teacher@example.com"));
    const staffRoster = await app.inject({ method: "GET", url: `/api/sections/${sectionId}/memberships`, headers: { cookie: teacher.cookie } });
    assert.ok((staffRoster.json().memberships as RosterRow[]).every((m) => typeof m.email === "string"), "staff still see every email");

    // --- Catalog and attach ---
    const catalogAsStudent = await app.inject({ method: "GET", url: "/api/activity-packages", headers: { cookie: alice.cookie } });
    assert.equal(catalogAsStudent.statusCode, 403);
    const catalog = await app.inject({ method: "GET", url: "/api/activity-packages", headers: { cookie: teacher.cookie } });
    assert.equal(catalog.statusCode, 200);
    assert.deepEqual(catalog.json().packages.map((p: { slug: string; itemCount: number }) => [p.slug, p.itemCount]), [["synthetic-demo", 3]]);
    assert.ok(!catalog.body.includes("answer_key"));

    const attach = (who: { cookie: string }, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/api/sections/${sectionId}/activities`, headers: { cookie: who.cookie, ...origin }, payload });
    assert.equal((await attach(alice, { packageId })).statusCode, 403);
    assert.equal((await attach(teacher, { packageId: "not-a-uuid" })).statusCode, 400);
    assert.equal(
      (await attach(teacher, { packageId, opensAt: "2026-01-02T00:00:00Z", dueAt: "2026-01-01T00:00:00Z" })).statusCode,
      400,
    );
    const created = await attach(teacher, { packageId });
    assert.equal(created.statusCode, 201);
    const activityId = created.json().activity.id as string;
    assert.equal(created.json().activity.status, "draft");

    const listAs = async (who: { cookie: string }) =>
      (await app.inject({ method: "GET", url: `/api/sections/${sectionId}/activities`, headers: { cookie: who.cookie } })).json();
    assert.equal((await listAs(alice)).activities.length, 0, "students do not see drafts");
    assert.equal((await listAs(teacher)).activities.length, 1);
    const outsiderList = await app.inject({ method: "GET", url: `/api/sections/${sectionId}/activities`, headers: { cookie: outsider.cookie } });
    assert.equal(outsiderList.statusCode, 403);

    const start = (who: { cookie: string }, payload: Record<string, unknown> = {}) =>
      app.inject({
        method: "POST",
        url: `/api/section-activities/${activityId}/attempts`,
        headers: { cookie: who.cookie, ...origin },
        payload,
      });
    assert.equal((await start(alice)).statusCode, 404, "a draft cannot be started");
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: "PATCH", url: `/api/section-activities/${activityId}`, headers: { cookie: teacher.cookie, ...origin }, payload });
    assert.equal((await patch({ status: "open", maxAttempts: 2 })).statusCode, 200);
    assert.equal((await start(teacher)).statusCode, 403, "staff without the student role do not play");
    assert.equal((await start(outsider)).statusCode, 403);
    assert.equal((await start(alice, { lang: "th" })).statusCode, 400, "package offers en only");

    // --- Play ---
    // Two concurrent starts (double click, two tabs) resolve to one attempt, never an error.
    const [raceA, raceB] = await Promise.all([start(alice), start(alice)]);
    assert.deepEqual([raceA.statusCode, raceB.statusCode].sort(), [200, 201]);
    assert.equal(raceA.json().attempt.id, raceB.json().attempt.id);
    const started = await start(alice);
    assert.equal(started.statusCode, 200);
    const attemptId = started.json().attempt.id as string;
    assert.equal(started.json().next.key, "i1");
    const exposed = JSON.stringify(started.json());
    for (const leak of ["answer_key", "shuffle_seed", "scoring", "weight", "Because.", '"b"', '"r1"']) {
      assert.ok(!exposed.includes(leak), `start response leaks ${leak}`);
    }
    const resumed = await start(alice);
    assert.deepEqual([resumed.statusCode, resumed.json().attempt.id, resumed.json().resumed], [200, attemptId, true]);

    const seed = (await pool.query<{ shuffle_seed: string }>("SELECT shuffle_seed FROM activity_attempts WHERE id = $1", [attemptId]))
      .rows[0]?.shuffle_seed as string;
    const tok = (item: string, part: string, id: string) => optionToken(seed, item, part, id);
    const rows = (item: string, part: string, map: Record<string, string>) =>
      Object.fromEntries(Object.entries(map).map(([id, c]) => [rowToken(seed, item, part, id), c]));
    // The tokens the browser got are exactly the ones the server derives from the seed.
    const shownTokens = started.json().next.parts[0].options.map((o: { token: string }) => o.token).sort();
    assert.deepEqual(shownTokens, ["a", "b", "c"].map((id) => tok("i1", "one", id)).sort());

    const respond = (who: { cookie: string }, itemKey: string, answer: unknown) =>
      app.inject({
        method: "POST",
        url: `/api/activity-attempts/${attemptId}/responses`,
        headers: { cookie: who.cookie, ...origin },
        payload: { itemKey, answer },
      });
    const i1 = { one: tok("i1", "one", "b"), rows: rows("i1", "rows", { r1: "X", r2: "Y" }) };
    assert.equal((await respond(alice, "i2", {})).statusCode, 409, "items are answered in order");
    assert.equal((await respond(bob, "i1", i1)).statusCode, 403, "another student cannot answer my attempt");
    assert.equal((await respond(teacher, "i1", i1)).statusCode, 403, "staff cannot answer a learner's attempt");
    const invalid = await respond(alice, "i1", { one: "b", rows: i1.rows });
    assert.deepEqual([invalid.statusCode, invalid.json().error], [400, "INVALID_ANSWER"]);
    const r1 = await respond(alice, "i1", i1);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.json().feedback.ratio, 1);
    assert.equal(r1.json().feedback.explanation, "Because.");
    assert.equal(r1.json().feedback.correct, undefined, "reveal: none");
    assert.equal(r1.json().next.key, "i2");
    assert.equal((await respond(alice, "i1", i1)).statusCode, 409);

    const r2 = await respond(alice, "i2", {
      pair: [tok("i2", "pair", "p"), tok("i2", "pair", "q")],
      many: [tok("i2", "many", "m1"), tok("i2", "many", "m4")],
    });
    assert.deepEqual([r2.json().feedback.ratio, r2.json().feedback.flags[0].key], [0, "bad"]);
    const r3 = await respond(alice, "i3", { v: rows("i3", "v", { c1: "CAN", c2: "CAN" }) });
    assert.equal(r3.json().feedback.ratio, 0.5);
    assert.equal(r3.json().next, null);

    const finish = (who: { cookie: string }, id = attemptId) =>
      app.inject({ method: "POST", url: `/api/activity-attempts/${id}/finish`, headers: { cookie: who.cookie, ...origin } });
    assert.equal((await finish(bob)).statusCode, 403);
    const finished = await finish(alice);
    assert.equal(finished.statusCode, 200);
    // stage_mean: s1 = 1, s2 = (0 + 0.5) / 2 = 0.25 -> 0.625 -> "Mid" (>= 50).
    assert.equal(finished.json().result.scoreRatio, 0.625);
    assert.equal(finished.json().result.band.title, "Mid");
    assert.equal((await finish(alice)).statusCode, 409);

    const review = async (who: { cookie: string }) =>
      app.inject({ method: "GET", url: `/api/activity-attempts/${attemptId}`, headers: { cookie: who.cookie } });
    assert.equal((await review(bob)).statusCode, 403);
    const asTeacher = await review(teacher);
    assert.equal(asTeacher.statusCode, 200);
    assert.equal(asTeacher.json().responses.length, 3);
    assert.equal(asTeacher.json().next, undefined);
    assert.equal(asTeacher.json().review, undefined, "reveal: none shows no review");
    assertNoLeak("teacher attempt view", asTeacher.body);
    assertNoLeak("owner attempt view", (await review(alice)).body);
    assertNoLeak("teacher activity list", JSON.stringify(await listAs(teacher)));
    assertNoLeak("student activity list", JSON.stringify(await listAs(alice)));

    // Second attempt (max 2) scores higher; third is refused.
    const second = await start(alice);
    assert.equal(second.statusCode, 201);
    const secondId = second.json().attempt.id as string;
    const seed2 = (await pool.query<{ shuffle_seed: string }>("SELECT shuffle_seed FROM activity_attempts WHERE id = $1", [secondId]))
      .rows[0]?.shuffle_seed as string;
    assert.notEqual(seed2, seed);
    const answers2: [string, unknown][] = [
      ["i1", { one: optionToken(seed2, "i1", "one", "b"), rows: { [rowToken(seed2, "i1", "rows", "r1")]: "X", [rowToken(seed2, "i1", "rows", "r2")]: "Y" } }],
      ["i2", { pair: ["p", "q"].map((id) => optionToken(seed2, "i2", "pair", id)), many: ["m1", "m2", "m3"].map((id) => optionToken(seed2, "i2", "many", id)) }],
      ["i3", { v: { [rowToken(seed2, "i3", "v", "c1")]: "CAN", [rowToken(seed2, "i3", "v", "c2")]: "CANNOT" } }],
    ];
    for (const [itemKey, answer] of answers2) {
      const res = await app.inject({
        method: "POST",
        url: `/api/activity-attempts/${secondId}/responses`,
        headers: { cookie: alice.cookie, ...origin },
        payload: { itemKey, answer },
      });
      assert.equal(res.statusCode, 200, `second attempt ${itemKey}`);
    }
    assert.equal((await finish(alice, secondId)).json().result.scoreRatio, 1);
    assert.equal((await start(alice)).json().error, "ATTEMPT_LIMIT_REACHED");

    // --- Evidence ---
    const evidenceUrl = `/api/section-activities/${activityId}/evidence`;
    assert.equal((await app.inject({ method: "GET", url: evidenceUrl, headers: { cookie: alice.cookie } })).statusCode, 403);
    const ev = await app.inject({ method: "GET", url: evidenceUrl, headers: { cookie: teacher.cookie } });
    assert.equal(ev.statusCode, 200);
    assertNoLeak("evidence", ev.body);
    const aliceRow = ev.json().students.find((s: { email: string }) => s.email === "alice@example.com");
    assert.equal(aliceRow.studentId, "65012345");
    assert.deepEqual(
      [aliceRow.attempts, aliceRow.first.scoreRatio, aliceRow.best.scoreRatio, aliceRow.last.scoreRatio, aliceRow.evidence.scoreRatio],
      [2, 0.625, 1, 1, 0.625],
      "evidence policy defaults to the first finished attempt",
    );
    const bobRow = ev.json().students.find((s: { email: string }) => s.email === "bob@example.com");
    assert.deepEqual([bobRow.attempts, bobRow.evidence, bobRow.studentId], [0, null, "65099999"]);
    assert.equal((await patch({ evidencePolicy: "best" })).statusCode, 200);
    const evBest = await app.inject({ method: "GET", url: evidenceUrl, headers: { cookie: teacher.cookie } });
    assert.equal(evBest.json().students.find((s: { email: string }) => s.email === "alice@example.com").evidence.scoreRatio, 1);

    const csv = await app.inject({ method: "GET", url: `${evidenceUrl}/export`, headers: { cookie: teacher.cookie } });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.headers["content-type"] as string, /text\/csv/);
    const lines = csv.body.split("\n");
    assert.equal(lines[0], "Student Name,Student Email,Student ID,Attempts,First Finished At,First Score %,Best Score %,Last Score %,Evidence Score % (best),Evidence Band");
    const aliceLine = lines.find((l) => l.includes("alice@example.com")) ?? "";
    assert.ok(aliceLine.startsWith(`"'=HYPERLINK(""x"")"`), `formula-injection guard: ${aliceLine}`);
    assert.match(aliceLine, /,65012345,2,[^,]+,62\.50,100\.00,100\.00,100\.00,High$/);
    assert.equal((await app.inject({ method: "GET", url: `${evidenceUrl}/export`, headers: { cookie: alice.cookie } })).statusCode, 403);

    // A closed activity accepts no new attempts or answers.
    assert.equal((await patch({ status: "closed" })).statusCode, 200);
    assert.equal((await start(bob)).json().error, "ACTIVITY_NOT_AVAILABLE");
  } finally {
    await app.close();
  }
});

test("Learning activities: play routes are rate-limited per signed-in user, not per IP", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(TRUNCATE);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    const a = await createUserWithSession(pool, { email: "a@example.com", displayName: "A" });
    const b = await createUserWithSession(pool, { email: "b@example.com", displayName: "B" });
    const hit = (who: { cookie: string }) =>
      app.inject({
        method: "POST",
        url: "/api/activity-attempts/00000000-0000-4000-8000-000000000000/finish",
        headers: { cookie: who.cookie, ...origin },
      });
    // Every inject shares 127.0.0.1, as a whole class does behind the tunnel.
    for (let i = 0; i < 60; i += 1) assert.equal((await hit(a)).statusCode, 404);
    assert.equal((await hit(a)).statusCode, 429);
    assert.equal((await hit(b)).statusCode, 404, "a classmate on the same IP is unaffected");
  } finally {
    await app.close();
  }
});
