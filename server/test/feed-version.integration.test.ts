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
  "Feed version: changes with every visible feed change and nothing else; members only",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, post_attachments, likes, comments, posts, scores, assignments, categories, session_picks,
                exit_ticket_responses, exit_tickets, session_checkins, class_sessions,
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
      const admin = await createUserWithSession(pool, { email: "admin@example.com", displayName: "Admin", isPlatformAdmin: true });
      const teacher = await createUserWithSession(pool, { email: "teacher@example.com", displayName: "Teacher" });
      const student = await createUserWithSession(pool, { email: "student@example.com", displayName: "Student" });
      const student2 = await createUserWithSession(pool, { email: "student2@example.com", displayName: "Student Two" });
      const outsider = await createUserWithSession(pool, { email: "outsider@example.com", displayName: "Outsider" });
      const sectionId = (await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: { code: "POLL101", title: "Polling", type: "short_course", term: "2569/1", ownerUserId: teacher.userId },
      })).json().sectionId as string;
      const otherSectionId = (await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: { code: "POLL102", title: "Other", type: "short_course", term: "2569/1", ownerUserId: teacher.userId },
      })).json().sectionId as string;
      for (const email of ["student@example.com", "student2@example.com"]) {
        await app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/memberships`,
          headers: { cookie: teacher.cookie, ...origin },
          payload: { email, roles: ["student"] },
        });
      }

      const version = async (cookie = student.cookie, id = sectionId) =>
        (await app.inject({ method: "GET", url: `/api/sections/${id}/feed/version`, headers: { cookie } })).json().version as string;
      const send = (method: "POST" | "PATCH" | "DELETE", url: string, cookie: string, payload?: object) =>
        app.inject({ method, url, headers: { cookie, ...origin }, ...(payload ? { payload } : {}) });

      // Each change must move the version away from the one the page last saw. (An unlike can
      // bring back an earlier version: the feed is then identical to that earlier state.)
      let previous: string | null = null;
      const expectChange = async (what: string) => {
        const v = await version();
        assert.notEqual(v, previous, `version changes after: ${what}`);
        previous = v;
        return v;
      };
      await expectChange("start (empty feed)");
      assert.equal(await version(), await version(), "stable while nothing happens");

      const postId = (await send("POST", `/api/sections/${sectionId}/posts`, teacher.cookie, { body: "Hello" })).json().post.id as string;
      const afterPost = await expectChange("a new post");
      // The feed itself carries the same version, so the page starts from it.
      const feed = await app.inject({ method: "GET", url: `/api/sections/${sectionId}/feed`, headers: { cookie: student.cookie } });
      assert.equal(feed.json().version, afterPost);

      await send("PATCH", `/api/posts/${postId}`, teacher.cookie, { body: "Hello, edited" });
      await expectChange("a post edit");
      const commentId = (await send("POST", `/api/posts/${postId}/comments`, student.cookie, { body: "Hi" })).json().comment.id as string;
      await expectChange("a comment");
      await send("POST", `/api/posts/${postId}/like`, student.cookie);
      await expectChange("a like");
      await send("POST", `/api/posts/${postId}/like`, student2.cookie);
      await expectChange("a second like");
      await send("DELETE", `/api/posts/${postId}/like`, student2.cookie);
      await expectChange("an unlike");
      await send("DELETE", `/api/comments/${commentId}`, student.cookie);
      await expectChange("a comment deletion");
      const pdf = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/attachments?name=a.pdf`,
        headers: { cookie: teacher.cookie, ...origin, "content-type": "application/octet-stream" },
        payload: Buffer.from("%PDF-1.7\nx"),
      });
      assert.equal(pdf.statusCode, 201);
      await expectChange("an attachment");
      await send("DELETE", `/api/attachments/${pdf.json().attachment.id}`, teacher.cookie);
      await expectChange("an attachment removal");

      // Activity in another Section does not move this one.
      const before = await version();
      await send("POST", `/api/sections/${otherSectionId}/posts`, teacher.cookie, { body: "Elsewhere" });
      assert.equal(await version(), before, "another Section's post leaves this version alone");

      await send("DELETE", `/api/posts/${postId}`, teacher.cookie);
      await expectChange("a post deletion");

      // Members only.
      assert.equal((await app.inject({ method: "GET", url: `/api/sections/${sectionId}/feed/version`, headers: { cookie: outsider.cookie } })).statusCode, 403);
      assert.equal((await app.inject({ method: "GET", url: `/api/sections/${sectionId}/feed/version` })).statusCode, 401);
      assert.equal((await app.inject({ method: "GET", url: `/api/sections/not-a-uuid/feed/version`, headers: { cookie: student.cookie } })).statusCode, 400);
    } finally {
      await app.close();
    }
  },
);
