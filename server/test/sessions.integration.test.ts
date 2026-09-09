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
test("Sessions: generation, QR/Emoji check-in, roster, authorization", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(
    `TRUNCATE audit_log, session_checkins, class_sessions, session_schedule_patterns,
              memberships, sections, courses, oauth_transactions, sessions,
              auth_identities, users
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
    const plainTeacher = await createUserWithSession(pool, {
      email: "plain-teacher@example.com",
      displayName: "Plain Teacher",
    });
    const ta = await createUserWithSession(pool, { email: "ta@example.com", displayName: "TA" });
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

    async function createCourseWithSection(type: "semester" | "self_paced" | "short_course", code: string) {
      const response = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: { code, title: code, type, term: "2569/1", ownerUserId: teacher.userId },
      });
      assert.equal(response.statusCode, 201);
      return response.json().sectionId as string;
    }

    const semesterSectionId = await createCourseWithSection("semester", "SEM101");
    const shortCourseSectionId = await createCourseWithSection("short_course", "SHORT101");
    const selfPacedSectionId = await createCourseWithSection("self_paced", "SELF101");

    async function grant(sectionId: string, email: string, roles: string[]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { email, roles },
      });
      assert.equal(response.statusCode, 201);
    }
    await grant(semesterSectionId, "plain-teacher@example.com", ["teacher"]);
    await grant(semesterSectionId, "ta@example.com", ["ta"]);
    await grant(semesterSectionId, "student@example.com", ["student"]);
    await grant(semesterSectionId, "student2@example.com", ["student"]);
    await grant(shortCourseSectionId, "student@example.com", ["student"]);

    // --- Session generation: semester (recurring pattern generator) ---

    const patternNotApplicable = await app.inject({
      method: "POST",
      url: `/api/sections/${shortCourseSectionId}/schedule-patterns`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { dayOfWeek: 1, startTime: "09:00", endTime: "10:30" },
    });
    assert.equal(patternNotApplicable.statusCode, 400);
    assert.equal(patternNotApplicable.json().error, "SCHEDULE_PATTERNS_NOT_APPLICABLE");

    const patternForbidden = await app.inject({
      method: "POST",
      url: `/api/sections/${semesterSectionId}/schedule-patterns`,
      headers: { cookie: student.cookie, ...origin },
      payload: { dayOfWeek: 1, startTime: "09:00", endTime: "10:30" },
    });
    assert.equal(patternForbidden.statusCode, 403);

    const invalidTimeRange = await app.inject({
      method: "POST",
      url: `/api/sections/${semesterSectionId}/schedule-patterns`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { dayOfWeek: 1, startTime: "10:00", endTime: "09:00" },
    });
    assert.equal(invalidTimeRange.statusCode, 400);
    assert.equal(invalidTimeRange.json().error, "INVALID_TIME_RANGE");

    // Monday 09:00-10:30 and Wednesday 13:00-14:30 -- two patterns on the same Section.
    const mondayPattern = await app.inject({
      method: "POST",
      url: `/api/sections/${semesterSectionId}/schedule-patterns`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { dayOfWeek: 1, startTime: "09:00", endTime: "10:30" },
    });
    assert.equal(mondayPattern.statusCode, 201);
    const wednesdayPattern = await app.inject({
      method: "POST",
      url: `/api/sections/${semesterSectionId}/schedule-patterns`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { dayOfWeek: 3, startTime: "13:00", endTime: "14:30" },
    });
    assert.equal(wednesdayPattern.statusCode, 201);

    const invalidTermDates = await app.inject({
      method: "PATCH",
      url: `/api/sections/${semesterSectionId}/term-dates`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { termStartDate: "2026-01-21", termEndDate: "2026-01-01" },
    });
    assert.equal(invalidTermDates.statusCode, 400);
    assert.equal(invalidTermDates.json().error, "INVALID_TERM_DATE_RANGE");

    const termDates = await app.inject({
      method: "PATCH",
      url: `/api/sections/${semesterSectionId}/term-dates`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { termStartDate: "2026-01-01", termEndDate: "2026-01-21" },
    });
    assert.equal(termDates.statusCode, 200);

    // 2026-01-01..2026-01-21: Mondays Jan 5/12/19, Wednesdays Jan 7/14/21 -> 6 Sessions.
    const generate1 = await app.inject({
      method: "POST",
      url: `/api/sections/${semesterSectionId}/generate-sessions`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(generate1.statusCode, 200);
    assert.equal(generate1.json().createdCount, 6);

    // Re-running for the same range is a no-op -- no duplicates.
    const generateAgain = await app.inject({
      method: "POST",
      url: `/api/sections/${semesterSectionId}/generate-sessions`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(generateAgain.statusCode, 200);
    assert.equal(generateAgain.json().createdCount, 0);

    // Extending the range fills in only the newly-covered dates (Jan 26 Mon, Jan 28 Wed).
    const extendTermDates = await app.inject({
      method: "PATCH",
      url: `/api/sections/${semesterSectionId}/term-dates`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { termStartDate: "2026-01-01", termEndDate: "2026-01-28" },
    });
    assert.equal(extendTermDates.statusCode, 200);
    const generateExtended = await app.inject({
      method: "POST",
      url: `/api/sections/${semesterSectionId}/generate-sessions`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(generateExtended.statusCode, 200);
    assert.equal(generateExtended.json().createdCount, 2);

    const semesterSessions = await app.inject({
      method: "GET",
      url: `/api/sections/${semesterSectionId}/sessions`,
      headers: { cookie: teacher.cookie },
    });
    assert.equal(semesterSessions.statusCode, 200);
    assert.equal(semesterSessions.json().sessions.length, 8);
    const qrSessionId = semesterSessions.json().sessions[0].id as string;

    const generateOnShortCourse = await app.inject({
      method: "POST",
      url: `/api/sections/${shortCourseSectionId}/generate-sessions`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(generateOnShortCourse.statusCode, 400);
    assert.equal(generateOnShortCourse.json().error, "SESSION_GENERATION_NOT_APPLICABLE");

    const generateOnSelfPaced = await app.inject({
      method: "POST",
      url: `/api/sections/${selfPacedSectionId}/generate-sessions`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(generateOnSelfPaced.statusCode, 400);
    assert.equal(generateOnSelfPaced.json().error, "SESSION_GENERATION_NOT_APPLICABLE");

    // --- Session generation: short_course (manual) and self_paced (rejected) ---

    const manualCreate = await app.inject({
      method: "POST",
      url: `/api/sections/${shortCourseSectionId}/sessions`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { scheduledStart: "2026-02-01T09:00:00Z", scheduledEnd: "2026-02-01T12:00:00Z" },
    });
    assert.equal(manualCreate.statusCode, 201);
    const emojiSessionId = manualCreate.json().session.id as string;

    const manualCreateDuplicate = await app.inject({
      method: "POST",
      url: `/api/sections/${shortCourseSectionId}/sessions`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { scheduledStart: "2026-02-01T09:00:00Z", scheduledEnd: "2026-02-01T12:00:00Z" },
    });
    assert.equal(manualCreateDuplicate.statusCode, 409);

    const manualCreateForbidden = await app.inject({
      method: "POST",
      url: `/api/sections/${shortCourseSectionId}/sessions`,
      headers: { cookie: student.cookie, ...origin },
      payload: { scheduledStart: "2026-02-02T09:00:00Z", scheduledEnd: "2026-02-02T12:00:00Z" },
    });
    assert.equal(manualCreateForbidden.statusCode, 403);

    const manualCreateOnSelfPaced = await app.inject({
      method: "POST",
      url: `/api/sections/${selfPacedSectionId}/sessions`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { scheduledStart: "2026-02-01T09:00:00Z", scheduledEnd: "2026-02-01T12:00:00Z" },
    });
    assert.equal(manualCreateOnSelfPaced.statusCode, 400);
    assert.equal(manualCreateOnSelfPaced.json().error, "SESSION_NOT_APPLICABLE");

    // --- QR check-in ---

    const codeBeforeOpen = await app.inject({
      method: "GET",
      url: `/api/sessions/${qrSessionId}/current-code`,
      headers: { cookie: teacher.cookie },
    });
    assert.equal(codeBeforeOpen.statusCode, 400);
    assert.equal(codeBeforeOpen.json().error, "QR_NOT_ACTIVE");

    const openForbidden = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/open`,
      headers: { cookie: student.cookie, ...origin },
      payload: { checkInMethod: "qr" },
    });
    assert.equal(openForbidden.statusCode, 403);

    const openQr = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/open`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { checkInMethod: "qr" },
    });
    assert.equal(openQr.statusCode, 200);
    const qrCode = openQr.json().session.qr_code as string;
    assert.ok(qrCode);

    const openAgain = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/open`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { checkInMethod: "qr" },
    });
    assert.equal(openAgain.statusCode, 409);

    // Any Section member can find the open Session; a non-member cannot even read that endpoint.
    const openSessionAsStudent = await app.inject({
      method: "GET",
      url: `/api/sections/${semesterSectionId}/sessions/open`,
      headers: { cookie: student.cookie },
    });
    assert.equal(openSessionAsStudent.statusCode, 200);
    assert.equal(openSessionAsStudent.json().session.id, qrSessionId);
    const openSessionAsNonMember = await app.inject({
      method: "GET",
      url: `/api/sections/${semesterSectionId}/sessions/open`,
      headers: { cookie: nonMember.cookie },
    });
    assert.equal(openSessionAsNonMember.statusCode, 403);

    const checkInNonMember = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/check-in`,
      headers: { cookie: nonMember.cookie, ...origin },
      payload: { value: qrCode },
    });
    assert.equal(checkInNonMember.statusCode, 403);

    const checkInWrongCode = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/check-in`,
      headers: { cookie: student.cookie, ...origin },
      payload: { value: "not-the-real-code" },
    });
    assert.equal(checkInWrongCode.statusCode, 400);
    assert.equal(checkInWrongCode.json().error, "INVALID_CODE");

    const checkInCorrect = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/check-in`,
      headers: { cookie: student.cookie, ...origin },
      payload: { value: qrCode },
    });
    assert.equal(checkInCorrect.statusCode, 200);
    assert.equal(checkInCorrect.json().checkedIn, true);

    // Idempotent: submitting the same valid code again does not create a second row.
    const checkInAgain = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/check-in`,
      headers: { cookie: student.cookie, ...origin },
      payload: { value: qrCode },
    });
    assert.equal(checkInAgain.statusCode, 200);
    assert.equal(checkInAgain.json().checkedInAt, checkInCorrect.json().checkedInAt);
    const checkinCount = await pool.query(
      "SELECT count(*)::int AS count FROM session_checkins WHERE session_id = $1 AND user_id = $2",
      [qrSessionId, student.userId],
    );
    assert.equal(checkinCount.rows[0]?.count, 1);

    // Simulate the code having expired -- a submission with the old (now expired) code is
    // rejected even though it was correct at generation time.
    await pool.query("UPDATE class_sessions SET qr_code_expires_at = now() - interval '1 second' WHERE id = $1", [
      qrSessionId,
    ]);
    const checkInExpired = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/check-in`,
      headers: { cookie: student2.cookie, ...origin },
      payload: { value: qrCode },
    });
    assert.equal(checkInExpired.statusCode, 400);
    assert.equal(checkInExpired.json().error, "INVALID_CODE");

    // Reading the current code after expiry rotates it (lazy rotation) rather than returning the
    // stale value.
    const rotatedCode = await app.inject({
      method: "GET",
      url: `/api/sessions/${qrSessionId}/current-code`,
      headers: { cookie: teacher.cookie },
    });
    assert.equal(rotatedCode.statusCode, 200);
    assert.notEqual(rotatedCode.json().code, qrCode);

    const checkInRotated = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/check-in`,
      headers: { cookie: student2.cookie, ...origin },
      payload: { value: rotatedCode.json().code },
    });
    assert.equal(checkInRotated.statusCode, 200);

    // --- Roster ---

    const rosterForbidden = await app.inject({
      method: "GET",
      url: `/api/sessions/${qrSessionId}/roster`,
      headers: { cookie: student.cookie },
    });
    assert.equal(rosterForbidden.statusCode, 403);

    const roster = await app.inject({
      method: "GET",
      url: `/api/sessions/${qrSessionId}/roster`,
      headers: { cookie: teacher.cookie },
    });
    assert.equal(roster.statusCode, 200);
    const rosterEntries = roster.json().roster as Array<{
      user_id: string;
      roles: string[];
      checked_in_at: string | null;
    }>;
    // Only student/ta members appear -- not the owner/teacher/plain-teacher.
    assert.equal(rosterEntries.length, 3);
    const studentEntry = rosterEntries.find((entry) => entry.user_id === student.userId);
    const student2Entry = rosterEntries.find((entry) => entry.user_id === student2.userId);
    const taEntry = rosterEntries.find((entry) => entry.user_id === ta.userId);
    assert.ok(studentEntry?.checked_in_at);
    assert.ok(student2Entry?.checked_in_at);
    assert.equal(taEntry?.checked_in_at, null);

    const closeQr = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/close`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(closeQr.statusCode, 200);

    const checkInAfterClose = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/check-in`,
      headers: { cookie: ta.cookie, ...origin },
      payload: { value: rotatedCode.json().code },
    });
    assert.equal(checkInAfterClose.statusCode, 409);
    assert.equal(checkInAfterClose.json().error, "SESSION_NOT_OPEN");

    const closeAgain = await app.inject({
      method: "POST",
      url: `/api/sessions/${qrSessionId}/close`,
      headers: { cookie: teacher.cookie, ...origin },
    });
    assert.equal(closeAgain.statusCode, 409);

    // --- Emoji check-in ---

    const emojiBeforeOpen = await app.inject({
      method: "GET",
      url: `/api/sessions/${emojiSessionId}/current-emoji`,
      headers: { cookie: teacher.cookie },
    });
    assert.equal(emojiBeforeOpen.statusCode, 400);
    assert.equal(emojiBeforeOpen.json().error, "EMOJI_NOT_ACTIVE");

    const openEmoji = await app.inject({
      method: "POST",
      url: `/api/sessions/${emojiSessionId}/open`,
      headers: { cookie: teacher.cookie, ...origin },
      payload: { checkInMethod: "emoji" },
    });
    assert.equal(openEmoji.statusCode, 200);
    const activeEmoji = openEmoji.json().session.active_emoji as string;
    assert.ok(activeEmoji);

    // Fixed for the open window: two reads return the same value, not a rotated one.
    const emojiRead1 = await app.inject({
      method: "GET",
      url: `/api/sessions/${emojiSessionId}/current-emoji`,
      headers: { cookie: teacher.cookie },
    });
    const emojiRead2 = await app.inject({
      method: "GET",
      url: `/api/sessions/${emojiSessionId}/current-emoji`,
      headers: { cookie: teacher.cookie },
    });
    assert.equal(emojiRead1.json().emoji, activeEmoji);
    assert.equal(emojiRead2.json().emoji, activeEmoji);

    const wrongEmoji = activeEmoji === "🐶" ? "🐱" : "🐶";
    const emojiWrongGuess = await app.inject({
      method: "POST",
      url: `/api/sessions/${emojiSessionId}/check-in`,
      headers: { cookie: student.cookie, ...origin },
      payload: { value: wrongEmoji },
    });
    assert.equal(emojiWrongGuess.statusCode, 400);
    assert.equal(emojiWrongGuess.json().error, "INVALID_EMOJI");

    const emojiCorrect = await app.inject({
      method: "POST",
      url: `/api/sessions/${emojiSessionId}/check-in`,
      headers: { cookie: student.cookie, ...origin },
      payload: { value: activeEmoji },
    });
    assert.equal(emojiCorrect.statusCode, 200);

    const emojiCheckinCount = await pool.query(
      "SELECT count(*)::int AS count FROM session_checkins WHERE session_id = $1 AND user_id = $2",
      [emojiSessionId, student.userId],
    );
    assert.equal(emojiCheckinCount.rows[0]?.count, 1);
  } finally {
    await app.close();
  }
});
