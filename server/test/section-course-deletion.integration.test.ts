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

// TRUNCATEs shared tables against TEST_DATABASE_URL, same as the other DB-backed suites; `npm
// test` runs with --test-concurrency=1 so they never race on the one real database.
test(
  "Course and Section deletion is guarded by teaching data",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, memberships, sections, courses, oauth_transactions, sessions,
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
      const owner = await createUserWithSession(pool, {
        email: "owner@example.com",
        displayName: "Owner",
      });
      const student = await createUserWithSession(pool, {
        email: "student@example.com",
        displayName: "Student",
      });

      const created = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "316121",
          title: "Computer Programming",
          type: "semester",
          term: "2569/1",
          label: "801",
          ownerUserId: owner.userId,
        },
      });
      assert.equal(created.statusCode, 201);
      const { courseId, sectionId } = created.json() as { courseId: string; sectionId: string };

      const deleteSectionAs = (cookie: string, id = sectionId) =>
        app.inject({ method: "DELETE", url: `/api/sections/${id}`, headers: { cookie, ...origin } });

      // A non-member cannot delete, and gets the same 403 as any other Section read.
      const outsider = await deleteSectionAs(student.cookie);
      assert.deepEqual([outsider.statusCode, outsider.json().error], [403, "FORBIDDEN"]);

      // The owner can delete their empty Section; its Membership cascades with it.
      const deleted = await deleteSectionAs(owner.cookie);
      assert.equal(deleted.statusCode, 204);
      const gone = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}`,
        headers: { cookie: admin.cookie },
      });
      assert.equal(gone.statusCode, 404);
      const sectionAudit = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM audit_log WHERE subject_type = 'section' AND subject_id = $1",
        [sectionId],
      );
      assert.deepEqual(sectionAudit.rows.map((row) => row.event_type), ["section.deleted"]);

      // A second Section, this time with a student in it: the owner is refused and nothing is lost.
      const second = await app.inject({
        method: "POST",
        url: `/api/courses/${courseId}/sections`,
        headers: { cookie: admin.cookie, ...origin },
        payload: { term: "2569/1", label: "802", ownerUserId: owner.userId },
      });
      assert.equal(second.statusCode, 201);
      const occupiedSectionId = second.json().sectionId as string;

      const grant = await app.inject({
        method: "POST",
        url: `/api/sections/${occupiedSectionId}/memberships`,
        headers: { cookie: owner.cookie, ...origin },
        payload: { email: "student@example.com", roles: ["student"] },
      });
      assert.equal(grant.statusCode, 201);

      const blockedByMember = await deleteSectionAs(owner.cookie, occupiedSectionId);
      assert.equal(blockedByMember.statusCode, 409);
      assert.equal(blockedByMember.json().error, "SECTION_NOT_EMPTY");
      assert.deepEqual(blockedByMember.json().blockers, [{ resource: "students", count: 1 }]);

      // The refusal is a refusal, not a partial delete.
      const stillThere = await app.inject({
        method: "GET",
        url: `/api/sections/${occupiedSectionId}`,
        headers: { cookie: admin.cookie },
      });
      assert.equal(stillThere.statusCode, 200);

      // Remove the member, then add teaching history directly: the guard covers it too.
      await pool.query("DELETE FROM memberships WHERE section_id = $1 AND user_id = $2", [
        occupiedSectionId,
        student.userId,
      ]);
      await pool.query(
        `INSERT INTO class_sessions (section_id, scheduled_start, scheduled_end)
         VALUES ($1, now(), now() + interval '90 minutes')`,
        [occupiedSectionId],
      );

      const blockedBySession = await deleteSectionAs(owner.cookie, occupiedSectionId);
      assert.equal(blockedBySession.statusCode, 409);
      assert.deepEqual(blockedBySession.json().blockers, [{ resource: "sessions", count: 1 }]);

      // Course deletion is platform-admin-only, and one non-empty Section refuses the whole Course.
      const courseAsOwner = await app.inject({
        method: "DELETE",
        url: `/api/courses/${courseId}`,
        headers: { cookie: owner.cookie, ...origin },
      });
      assert.deepEqual([courseAsOwner.statusCode, courseAsOwner.json().error], [403, "FORBIDDEN"]);

      const courseBlocked = await app.inject({
        method: "DELETE",
        url: `/api/courses/${courseId}`,
        headers: { cookie: admin.cookie, ...origin },
      });
      assert.equal(courseBlocked.statusCode, 409);
      const blockedBody = courseBlocked.json() as {
        error: string;
        sections: Array<{ sectionId: string; blockers: Array<{ resource: string; count: number }> }>;
      };
      assert.equal(blockedBody.error, "COURSE_NOT_EMPTY");
      assert.deepEqual(blockedBody.sections.map((section) => section.sectionId), [occupiedSectionId]);
      assert.deepEqual(blockedBody.sections[0]?.blockers, [{ resource: "sessions", count: 1 }]);

      // Once the last Section is empty, the Course deletes with its Sections in one step.
      await pool.query("DELETE FROM class_sessions WHERE section_id = $1", [occupiedSectionId]);
      const courseDeleted = await app.inject({
        method: "DELETE",
        url: `/api/courses/${courseId}`,
        headers: { cookie: admin.cookie, ...origin },
      });
      assert.equal(courseDeleted.statusCode, 204);

      const remainingSections = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM sections WHERE course_id = $1",
        [courseId],
      );
      assert.equal(remainingSections.rows[0]?.count, 0);
      const courseAudit = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM audit_log WHERE subject_type = 'course' AND subject_id = $1",
        [courseId],
      );
      assert.deepEqual(courseAudit.rows.map((row) => row.event_type), ["course.deleted"]);

      // An unknown Course is a 404, not a silent success.
      const unknownCourse = await app.inject({
        method: "DELETE",
        url: "/api/courses/00000000-0000-0000-0000-000000000000",
        headers: { cookie: admin.cookie, ...origin },
      });
      assert.equal(unknownCourse.statusCode, 404);
    } finally {
      await pool.end();
    }
  },
);
