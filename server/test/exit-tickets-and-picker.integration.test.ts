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
  "Exit Tickets and Random Picker: lifecycle, upsert, fairness, authorization",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, session_picks, exit_ticket_responses, exit_tickets, session_checkins,
                class_sessions, session_schedule_patterns, memberships, sections, courses,
                oauth_transactions, sessions, auth_identities, users
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
      const student3 = await createUserWithSession(pool, {
        email: "student3@example.com",
        displayName: "Student Three",
      });
      const nonMember = await createUserWithSession(pool, {
        email: "non-member@example.com",
        displayName: "Non Member",
      });

      const createCourseResponse = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "SHORT201",
          title: "Short Course",
          type: "short_course",
          term: "2569/1",
          ownerUserId: teacher.userId,
        },
      });
      assert.equal(createCourseResponse.statusCode, 201);
      const sectionId = createCourseResponse.json().sectionId as string;

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
      await grant("student3@example.com", ["student"]);

      const createSessionResponse = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/sessions`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { scheduledStart: "2026-03-01T09:00:00Z", scheduledEnd: "2026-03-01T12:00:00Z" },
      });
      assert.equal(createSessionResponse.statusCode, 201);
      const sessionId = createSessionResponse.json().session.id as string;

      // --- Exit Ticket lifecycle ---

      const openForbidden = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/exit-tickets`,
        headers: { cookie: student.cookie, ...origin },
        payload: { prompt: "How did today go?" },
      });
      assert.equal(openForbidden.statusCode, 403);

      const openTicket = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/exit-tickets`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { prompt: "How did today go?" },
      });
      assert.equal(openTicket.statusCode, 201);
      const exitTicketId = openTicket.json().exitTicket.id as string;

      const openSecondWhileFirstOpen = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/exit-tickets`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { prompt: "A second one?" },
      });
      assert.equal(openSecondWhileFirstOpen.statusCode, 409);
      assert.equal(openSecondWhileFirstOpen.json().error, "EXIT_TICKET_ALREADY_OPEN");

      const openCheck = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/exit-tickets/open`,
        headers: { cookie: student.cookie },
      });
      assert.equal(openCheck.statusCode, 200);
      assert.equal(openCheck.json().exitTicket.id, exitTicketId);
      assert.equal(openCheck.json().myResponse, null);

      const respondForbidden = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/responses`,
        headers: { cookie: nonMember.cookie, ...origin },
        payload: { rating: 3 },
      });
      assert.equal(respondForbidden.statusCode, 403);

      const respondInvalidRating = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/responses`,
        headers: { cookie: student.cookie, ...origin },
        payload: { rating: 6 },
      });
      assert.equal(respondInvalidRating.statusCode, 400);

      const respondFirst = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/responses`,
        headers: { cookie: student.cookie, ...origin },
        payload: { rating: 4 },
      });
      assert.equal(respondFirst.statusCode, 200);
      assert.equal(respondFirst.json().response.rating, 4);
      assert.equal(respondFirst.json().response.comment, null);

      const openCheckAfterResponse = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/exit-tickets/open`,
        headers: { cookie: student.cookie },
      });
      assert.equal(openCheckAfterResponse.json().myResponse.rating, 4);

      // Resubmission upserts (deliberate deviation from check-in's idempotent-no-op).
      const respondAgain = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/responses`,
        headers: { cookie: student.cookie, ...origin },
        payload: { rating: 2, comment: "actually confusing" },
      });
      assert.equal(respondAgain.statusCode, 200);
      assert.equal(respondAgain.json().response.rating, 2);
      assert.equal(respondAgain.json().response.comment, "actually confusing");
      const responseCount = await pool.query(
        "SELECT count(*)::int AS count FROM exit_ticket_responses WHERE exit_ticket_id = $1 AND user_id = $2",
        [exitTicketId, student.userId],
      );
      assert.equal(responseCount.rows[0]?.count, 1);

      const closeForbidden = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/close`,
        headers: { cookie: student.cookie, ...origin },
      });
      assert.equal(closeForbidden.statusCode, 403);

      const closeTicket = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/close`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(closeTicket.statusCode, 200);

      const closeAgain = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/close`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(closeAgain.statusCode, 409);

      const respondAfterClose = await app.inject({
        method: "POST",
        url: `/api/exit-tickets/${exitTicketId}/responses`,
        headers: { cookie: student2.cookie, ...origin },
        payload: { rating: 3 },
      });
      assert.equal(respondAfterClose.statusCode, 409);
      assert.equal(respondAfterClose.json().error, "EXIT_TICKET_NOT_OPEN");

      const responsesForbidden = await app.inject({
        method: "GET",
        url: `/api/exit-tickets/${exitTicketId}/responses`,
        headers: { cookie: student.cookie },
      });
      assert.equal(responsesForbidden.statusCode, 403);

      const responses = await app.inject({
        method: "GET",
        url: `/api/exit-tickets/${exitTicketId}/responses`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(responses.statusCode, 200);
      assert.equal(responses.json().responses.length, 1);
      assert.equal(responses.json().responses[0].rating, 2);

      // Multiple Exit Tickets allowed per Session, only one open at a time -- a new one can open
      // now that the first is closed.
      const openSecondAfterClose = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/exit-tickets`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { prompt: "End of class check" },
      });
      assert.equal(openSecondAfterClose.statusCode, 201);
      assert.notEqual(openSecondAfterClose.json().exitTicket.id, exitTicketId);

      // --- Random Picker: check three students in, verify one full round has no repeats ---

      const openQr = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/open`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { checkInMethod: "qr" },
      });
      assert.equal(openQr.statusCode, 200);
      const qrCode = openQr.json().session.qr_code as string;

      for (const checkingUser of [student, student2, student3]) {
        const checkIn = await app.inject({
          method: "POST",
          url: `/api/sessions/${sessionId}/check-in`,
          headers: { cookie: checkingUser.cookie, ...origin },
          payload: { value: qrCode },
        });
        assert.equal(checkIn.statusCode, 200);
      }

      const pickForbidden = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/pick`,
        headers: { cookie: student.cookie, ...origin },
      });
      assert.equal(pickForbidden.statusCode, 403);

      const round1: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const pick = await app.inject({
          method: "POST",
          url: `/api/sessions/${sessionId}/pick`,
          headers: { cookie: teacher.cookie, ...origin },
        });
        assert.equal(pick.statusCode, 200);
        round1.push(pick.json().picked.userId);
      }
      // No repeats within the first full round -- the set of three picks must equal the set of
      // three checked-in students.
      assert.deepEqual(
        new Set(round1),
        new Set([student.userId, student2.userId, student3.userId]),
      );

      // A fourth pick starts a new round: still one of the three, not a dead end.
      const pick4 = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/pick`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(pick4.statusCode, 200);
      assert.ok([student.userId, student2.userId, student3.userId].includes(pick4.json().picked.userId));

      // A late check-in is immediately eligible: after round 1, everyone else is at pick count 1
      // (or entering their second round); the newly-checked-in student is at 0 and must be
      // picked next, deterministically.
      const lateStudent = await createUserWithSession(pool, {
        email: "late-student@example.com",
        displayName: "Late Student",
      });
      await grant("late-student@example.com", ["student"]);
      const lateCheckIn = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/check-in`,
        headers: { cookie: lateStudent.cookie, ...origin },
        payload: { value: qrCode },
      });
      assert.equal(lateCheckIn.statusCode, 200);
      const pickAfterLateCheckIn = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/pick`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(pickAfterLateCheckIn.statusCode, 200);
      assert.equal(pickAfterLateCheckIn.json().picked.userId, lateStudent.userId);

      const pickHistoryForbidden = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/picks`,
        headers: { cookie: student.cookie },
      });
      assert.equal(pickHistoryForbidden.statusCode, 403);

      const pickHistory = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/picks`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(pickHistory.statusCode, 200);
      assert.equal(pickHistory.json().picks.length, 5);

      // Closing the Session's check-in rejects further picks.
      const closeSession = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/close`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(closeSession.statusCode, 200);
      const pickAfterClose = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/pick`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(pickAfterClose.statusCode, 409);
      assert.equal(pickAfterClose.json().error, "SESSION_NOT_OPEN");

      // --- Random Picker: per-Session isolation and the no-eligible-students case ---

      const secondSessionResponse = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/sessions`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { scheduledStart: "2026-03-08T09:00:00Z", scheduledEnd: "2026-03-08T12:00:00Z" },
      });
      assert.equal(secondSessionResponse.statusCode, 201);
      const secondSessionId = secondSessionResponse.json().session.id as string;

      const openSecondSession = await app.inject({
        method: "POST",
        url: `/api/sessions/${secondSessionId}/open`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { checkInMethod: "qr" },
      });
      assert.equal(openSecondSession.statusCode, 200);

      const pickNoOneCheckedIn = await app.inject({
        method: "POST",
        url: `/api/sessions/${secondSessionId}/pick`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(pickNoOneCheckedIn.statusCode, 400);
      assert.equal(pickNoOneCheckedIn.json().error, "NO_ELIGIBLE_STUDENTS");

      // `student` was picked heavily in the first Session; in this fresh Session they start at 0
      // picks like everyone else -- per-Session isolation, not a Section-wide rotation.
      const secondQrCode = openSecondSession.json().session.qr_code as string;
      const checkInSecondSession = await app.inject({
        method: "POST",
        url: `/api/sessions/${secondSessionId}/check-in`,
        headers: { cookie: student.cookie, ...origin },
        payload: { value: secondQrCode },
      });
      assert.equal(checkInSecondSession.statusCode, 200);
      const pickInSecondSession = await app.inject({
        method: "POST",
        url: `/api/sessions/${secondSessionId}/pick`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(pickInSecondSession.statusCode, 200);
      assert.equal(pickInSecondSession.json().picked.userId, student.userId);
    } finally {
      await app.close();
    }
  },
);
