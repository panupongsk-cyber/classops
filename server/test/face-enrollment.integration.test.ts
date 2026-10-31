import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { FACE_EMBEDDING_DIM } from "../src/face.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

// A deterministic 128-D vector that varies with `seed`, so "same person" (same seed) matches and a
// different seed is a different, near-orthogonal vector.
function faceVector(seed: number): number[] {
  let s = seed >>> 0 || 1;
  const v: number[] = [];
  for (let i = 0; i < FACE_EMBEDDING_DIM; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    v.push((s / 0xffffffff) * 2 - 1);
  }
  return v;
}

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

test("Face check-in: enroll, override, nonce+challenge, matching, authorization", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(
    `TRUNCATE audit_log, face_checkin_nonces, face_enrollments, session_checkins, class_sessions,
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
    const otherTeacher = await createUserWithSession(pool, {
      email: "other-teacher@example.com",
      displayName: "Other Teacher",
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

    async function createCourseWithSection(code: string) {
      const response = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: { code, title: code, type: "short_course", term: "2569/1", ownerUserId: teacher.userId },
      });
      assert.equal(response.statusCode, 201);
      return response.json().sectionId as string;
    }

    async function grant(sectionId: string, email: string, roles: string[]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { email, roles },
      });
      assert.equal(response.statusCode, 201);
    }

    const sectionId = await createCourseWithSection("FACE101");
    const otherSectionId = await createCourseWithSection("FACE102");
    await grant(sectionId, "student@example.com", ["student"]);
    await grant(sectionId, "student2@example.com", ["student"]);
    await grant(otherSectionId, "other-teacher@example.com", ["teacher"]);

    const manualCreate = await app.inject({
      method: "POST",
      url: `/api/sections/${sectionId}/sessions`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { scheduledStart: "2026-03-01T09:00:00Z", scheduledEnd: "2026-03-01T12:00:00Z" },
    });
    assert.equal(manualCreate.statusCode, 201);
    const sessionId = manualCreate.json().session.id as string;

    // --- Enrollment ---

    const notEnrolledYet = await app.inject({
      method: "GET",
      url: "/api/me/face-enrollment",
      headers: { cookie: student.cookie },
    });
    assert.equal(notEnrolledYet.statusCode, 200);
    assert.equal(notEnrolledYet.json().enrolled, false);

    const wrongDim = await app.inject({
      method: "PUT",
      url: "/api/me/face-enrollment",
      headers: { cookie: student.cookie, ...origin },
      payload: { embeddings: [[1, 2, 3], [1, 2, 3], [1, 2, 3]] },
    });
    assert.equal(wrongDim.statusCode, 400);

    const enrolled = await app.inject({
      method: "PUT",
      url: "/api/me/face-enrollment",
      headers: { cookie: student.cookie, ...origin },
      payload: { embeddings: [faceVector(1), faceVector(1), faceVector(1)], liveness: "blink,turn-left" },
    });
    assert.equal(enrolled.statusCode, 200);
    assert.equal(enrolled.json().enrolled, true);

    const enrolledNow = await app.inject({
      method: "GET",
      url: "/api/me/face-enrollment",
      headers: { cookie: student.cookie },
    });
    assert.equal(enrolledNow.json().enrolled, true);
    assert.ok(enrolledNow.json().enrolledAt);

    // Teacher override authorization: a student cannot clear (their own or anyone's) enrollment.
    const overrideForbidden = await app.inject({
      method: "DELETE",
      url: `/api/sections/${sectionId}/students/${student.userId}/face-enrollment`,
      headers: { cookie: student.cookie, ...origin },
    });
    assert.equal(overrideForbidden.statusCode, 403);

    // A teacher of a *different* section cannot reach this section's students.
    const overrideCrossSection = await app.inject({
      method: "DELETE",
      url: `/api/sections/${sectionId}/students/${student.userId}/face-enrollment`,
      headers: { cookie: otherTeacher.cookie, ...origin },
    });
    assert.equal(overrideCrossSection.statusCode, 403);

    // A non-member target is rejected.
    const overrideNonMemberTarget = await app.inject({
      method: "DELETE",
      url: `/api/sections/${sectionId}/students/${nonMember.userId}/face-enrollment`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(overrideNonMemberTarget.statusCode, 404);

    // --- Open with face + challenge ---

    const openFace = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/open`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { checkInMethod: "face" },
    });
    assert.equal(openFace.statusCode, 200);
    assert.equal(openFace.json().session.check_in_method, "face");

    // Method-specific endpoints refuse a face session.
    const codeOnFace = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/current-code`,
      headers: { cookie: teacher.cookie },
    });
    assert.equal(codeOnFace.statusCode, 400);

    const challengeForbidden = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/face-challenge`,
      headers: { cookie: nonMember.cookie },
    });
    assert.equal(challengeForbidden.statusCode, 403);

    async function challenge(cookie: string) {
      const response = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/face-challenge`,
        headers: { cookie },
      });
      return response;
    }

    async function faceCheckIn(cookie: string, nonce: string, seed: number) {
      return app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/check-in`,
        headers: { cookie, ...origin },
        payload: { face: { nonce, embedding: faceVector(seed) } },
      });
    }

    // --- Matching check-in ---

    const challenge1 = await challenge(student.cookie);
    assert.equal(challenge1.statusCode, 200);
    assert.equal(typeof challenge1.json().nonce, "string");
    assert.ok(["blink", "turn-left", "turn-right"].includes(challenge1.json().challenge));
    assert.ok(challenge1.json().expiresAt);

    const checkInOk = await faceCheckIn(student.cookie, challenge1.json().nonce, 1);
    assert.equal(checkInOk.statusCode, 200);
    assert.equal(checkInOk.json().checkedIn, true);

    // Replaying the same nonce is rejected even with a matching embedding.
    const replay = await faceCheckIn(student.cookie, challenge1.json().nonce, 1);
    assert.equal(replay.statusCode, 400);
    assert.equal(replay.json().error, "NONCE_USED");

    // A garbage nonce is rejected.
    const garbage = await faceCheckIn(student.cookie, "does-not-exist", 1);
    assert.equal(garbage.statusCode, 400);
    assert.equal(garbage.json().error, "NONCE_INVALID");

    // --- Mismatch ---

    const challenge2 = await challenge(student.cookie);
    const mismatch = await faceCheckIn(student.cookie, challenge2.json().nonce, 999);
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.json().error, "FACE_MISMATCH");

    // --- Not enrolled ---

    const challenge3 = await challenge(student2.cookie);
    const notEnrolled = await faceCheckIn(student2.cookie, challenge3.json().nonce, 1);
    assert.equal(notEnrolled.statusCode, 400);
    assert.equal(notEnrolled.json().error, "NOT_ENROLLED");

    // --- Nonce binding: a nonce issued to student2 is rejected for student ---

    const boundToOther = await faceCheckIn(student.cookie, challenge3.json().nonce, 1);
    assert.equal(boundToOther.statusCode, 400);
    assert.equal(boundToOther.json().error, "NONCE_INVALID");

    // --- Expiry ---

    const challenge4 = await challenge(student.cookie);
    await pool.query(
      "UPDATE face_checkin_nonces SET expires_at = now() - interval '1 second' WHERE session_id = $1 AND user_id = $2",
      [sessionId, student.userId],
    );
    const expired = await faceCheckIn(student.cookie, challenge4.json().nonce, 1);
    assert.equal(expired.statusCode, 400);
    assert.equal(expired.json().error, "NONCE_INVALID");

    // --- Teacher override succeeds and clears enrollment ---

    const override = await app.inject({
      method: "DELETE",
      url: `/api/sections/${sectionId}/students/${student.userId}/face-enrollment`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(override.statusCode, 200);
    assert.equal(override.json().deleted, true);

    const cleared = await app.inject({
      method: "GET",
      url: "/api/me/face-enrollment",
      headers: { cookie: student.cookie },
    });
    assert.equal(cleared.json().enrolled, false);

    // Overriding again (nothing enrolled) is a 404.
    const overrideAgain = await app.inject({
      method: "DELETE",
      url: `/api/sections/${sectionId}/students/${student.userId}/face-enrollment`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(overrideAgain.statusCode, 404);
  } finally {
    await app.close();
  }
});
