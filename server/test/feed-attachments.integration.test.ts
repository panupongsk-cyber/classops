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
  "Feed attachments: staff upload, member download, safe headers, limits, authorization, cascade",
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
      const ta = await createUserWithSession(pool, { email: "ta@example.com", displayName: "TA" });
      const student = await createUserWithSession(pool, { email: "student@example.com", displayName: "Student" });
      const otherTeacher = await createUserWithSession(pool, { email: "other@example.com", displayName: "Other" });

      async function createSection(code: string, ownerUserId: string) {
        const response = await app.inject({
          method: "POST",
          url: "/api/courses",
          headers: { cookie: admin.cookie, ...origin },
          payload: { code, title: code, type: "short_course", term: "2569/1", ownerUserId },
        });
        assert.equal(response.statusCode, 201);
        return response.json().sectionId as string;
      }
      const sectionId = await createSection("FEED201", teacher.userId);
      await createSection("FEED202", otherTeacher.userId);
      for (const [email, roles] of [["student@example.com", ["student"]], ["ta@example.com", ["ta"]]] as const) {
        const grant = await app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/memberships`,
          headers: { cookie: teacher.cookie, ...origin },
          payload: { email, roles },
        });
        assert.equal(grant.statusCode, 201);
      }
      const created = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/posts`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { body: "Week 1 slides" },
      });
      const postId = created.json().post.id as string;

      const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic image")]);
      const PDF = Buffer.from("%PDF-1.7\nsynthetic\n%%EOF");
      async function upload(cookie: string, name: string, data: Buffer, contentType = "application/octet-stream") {
        return app.inject({
          method: "POST",
          url: `/api/posts/${postId}/attachments?name=${encodeURIComponent(name)}`,
          headers: { cookie, ...origin, "content-type": contentType },
          payload: data,
        });
      }

      // Staff (teacher and TA) upload; a student may not.
      const png = await upload(teacher.cookie, "รูป week1.png", PNG);
      assert.equal(png.statusCode, 201, png.body);
      assert.deepEqual(png.json().attachment.contentType, "image/png");
      const pngId = png.json().attachment.id as string;
      const pdf = await upload(ta.cookie, "C:\\fakepath\\slides.pdf", PDF);
      assert.equal(pdf.statusCode, 201, pdf.body);
      assert.equal(pdf.json().attachment.fileName, "slides.pdf", "the directory part is dropped");
      const pdfId = pdf.json().attachment.id as string;
      assert.equal((await upload(student.cookie, "x.png", PNG)).statusCode, 403);
      assert.equal((await upload(otherTeacher.cookie, "x.png", PNG)).statusCode, 403);

      // Refusals: wrong bytes for the name, an unlisted type, no name, empty, JSON instead of bytes.
      assert.equal((await upload(teacher.cookie, "photo.jpg", PNG)).json().error, "UNSUPPORTED_FILE_TYPE");
      assert.equal((await upload(teacher.cookie, "x.svg", Buffer.from("<svg/>"))).json().error, "UNSUPPORTED_FILE_TYPE");
      assert.equal((await upload(teacher.cookie, "", PNG)).json().error, "INVALID_FILE_NAME");
      assert.equal((await upload(teacher.cookie, "e.png", Buffer.alloc(0))).json().error, "EMPTY_FILE");
      assert.equal((await upload(teacher.cookie, "j.png", Buffer.from("{}"), "application/json")).statusCode, 415);

      // Before any body is read: an anonymous caller or a non-staff member is refused, whatever the
      // body, and a large JSON body is never parsed (it used to be, at the route's 10 MB limit).
      const bigJson = Buffer.from(`[${"{},".repeat(3_000_000)}{}]`);
      const anonymousJson = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/attachments?name=x.pdf`,
        headers: { ...origin, "content-type": "application/json" },
        payload: bigJson,
      });
      assert.equal(anonymousJson.statusCode, 401);
      const studentBytes = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/attachments?name=x.pdf`,
        headers: { cookie: student.cookie, ...origin, "content-type": "application/octet-stream" },
        payload: Buffer.alloc(9 * 1024 * 1024),
      });
      assert.equal(studentBytes.statusCode, 403);

      // Size: just over 10 MB is refused by the route's body limit; other routes keep 1 MB.
      const tooBig = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
      assert.equal((await upload(teacher.cookie, "big.pdf", tooBig)).statusCode, 413);
      const twoMegOtherRoute = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/posts`,
        headers: { cookie: teacher.cookie, ...origin, "content-type": "application/octet-stream" },
        payload: Buffer.alloc(2 * 1024 * 1024),
      });
      assert.equal(twoMegOtherRoute.statusCode, 415, "only the upload route accepts octet-stream at all");

      // The feed lists metadata only, in upload order.
      const feed = await app.inject({ method: "GET", url: `/api/sections/${sectionId}/feed`, headers: { cookie: student.cookie } });
      const listed = feed.json().posts[0].attachments;
      assert.deepEqual(
        listed.map((a: { id: string; fileName: string; contentType: string; sizeBytes: number }) => [a.id, a.fileName, a.contentType, a.sizeBytes]),
        [[pngId, "รูป week1.png", "image/png", PNG.length], [pdfId, "slides.pdf", "application/pdf", PDF.length]],
      );
      assert.ok(!feed.body.includes("synthetic"), "no file bytes in the feed");

      // A member downloads the exact bytes with safe headers.
      const download = async (id: string, cookie: string | null, query = "") =>
        app.inject({ method: "GET", url: `/api/attachments/${id}${query}`, headers: cookie ? { cookie } : {} });
      const got = await download(pdfId, student.cookie);
      assert.equal(got.statusCode, 200);
      assert.deepEqual(got.rawPayload, PDF);
      assert.equal(got.headers["content-type"], "application/pdf");
      assert.equal(got.headers["x-content-type-options"], "nosniff");
      assert.equal(got.headers["content-security-policy"], "default-src 'none'; sandbox");
      assert.match(String(got.headers["content-disposition"]), /^attachment; /);
      assert.match(String((await download(pdfId, student.cookie, "?inline=1")).headers["content-disposition"]), /^attachment; /, "only images go inline");
      const image = await download(pngId, student.cookie, "?inline=1");
      assert.match(String(image.headers["content-disposition"]), /^inline; .*filename\*=UTF-8''%E0%B8%A3/);
      assert.equal((await download(pngId, otherTeacher.cookie)).statusCode, 403);
      assert.equal((await download(pngId, null)).statusCode, 401);
      assert.equal((await download("00000000-0000-4000-8000-000000000000", student.cookie)).statusCode, 404);

      // A file bigger than one 1 MB slice streams back byte for byte.
      const BIG_PDF = Buffer.concat([PDF, Buffer.from(Array.from({ length: 2_600_000 }, (_, i) => i % 251))]);
      const big = await upload(teacher.cookie, "big.pdf", BIG_PDF);
      assert.equal(big.statusCode, 201, big.body);
      const bigBack = await download(big.json().attachment.id, student.cookie);
      assert.equal(bigBack.headers["content-length"], String(BIG_PDF.length));
      assert.ok(bigBack.rawPayload.equals(BIG_PDF), "multi-slice download is identical");

      // At most five per post, even when the fifth+1 comes from another staff member.
      for (const n of [4, 5]) assert.equal((await upload(teacher.cookie, `p${n}.pdf`, PDF)).statusCode, 201);
      const sixth = await upload(ta.cookie, "p6.pdf", PDF);
      assert.deepEqual([sixth.statusCode, sixth.json().error], [409, "TOO_MANY_ATTACHMENTS"]);

      // No HEAD route: it would read the whole file only to discard it.
      assert.equal((await app.inject({ method: "HEAD", url: `/api/attachments/${pdfId}`, headers: { cookie: student.cookie } })).statusCode, 404);

      // Delete: staff only; deleting the Post removes the rest.
      const del = (id: string, cookie: string) => app.inject({ method: "DELETE", url: `/api/attachments/${id}`, headers: { cookie, ...origin } });
      assert.equal((await del(pngId, student.cookie)).statusCode, 403);
      assert.equal((await del(pngId, ta.cookie)).statusCode, 200);
      assert.equal((await download(pngId, student.cookie)).statusCode, 404);
      await app.inject({ method: "DELETE", url: `/api/posts/${postId}`, headers: { cookie: teacher.cookie, ...origin } });
      const left = await pool.query("SELECT count(*)::int AS n FROM post_attachments");
      assert.equal(left.rows[0].n, 0);

      // Refused upload attempts still count toward the rate limit: authorization runs after the
      // limiter (preParsing), so an anonymous caller is eventually told to slow down.
      let limited = false;
      for (let i = 0; i < 110 && !limited; i += 1) {
        const attempt = await app.inject({
          method: "POST",
          url: `/api/posts/00000000-0000-4000-8000-000000000000/attachments?name=x.pdf`,
          headers: { ...origin, "content-type": "application/octet-stream" },
          payload: PDF,
        });
        limited = attempt.statusCode === 429;
      }
      assert.ok(limited, "anonymous upload attempts reach 429");
    } finally {
      await app.close();
    }
  },
);
