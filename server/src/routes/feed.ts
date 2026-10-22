import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_POST,
  cleanFileName,
  contentDisposition,
  detectAttachmentType,
  kindOf,
} from "../attachments.js";
import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import { withTransaction, type DatabasePool } from "../db.js";
import { sessionRateLimitKey } from "../rate-limit-key.js";

const createPostSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  linkUrl: z.url().optional(),
});
// linkUrl is nullable (not just optional) here, unlike createPostSchema: PATCH must be able to
// distinguish "field omitted, leave it alone" (undefined) from "explicitly clear it" (null) --
// otherwise a teacher who posted a broken link would have no way to remove it without deleting
// and recreating the whole Post.
const updatePostSchema = z.object({
  body: z.string().trim().min(1).max(5000).optional(),
  linkUrl: z.url().nullable().optional(),
});
const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

const ATTACHMENT_SLICE_BYTES = 1024 * 1024;
const ATTACHMENT_READ_CONCURRENCY = 3;
// The uploader, set by the upload route's onRequest hook once it has authorized the caller.
const uploaders = new WeakMap<FastifyRequest, string>();

/** At most `limit` callbacks run at once; the rest wait their turn. */
class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

interface PostRow {
  id: string;
  section_id: string;
  author_user_id: string;
  body: string;
  link_url: string | null;
  created_at: string;
  updated_at: string;
}

async function getPost(pool: DatabasePool, postId: string) {
  const result = await pool.query<PostRow>(
    `SELECT id, section_id, author_user_id, body, link_url, created_at, updated_at
     FROM posts WHERE id = $1`,
    [postId],
  );
  return result.rows[0] ?? null;
}

interface CommentRow {
  id: string;
  post_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
}

// A cheap fingerprint of everything the feed page shows for a Section (#2439): posts, comments,
// likes and attachments. Counts catch deletions; the newest timestamps catch a deletion and an
// addition that cancel out, an edit, or an unlike followed by a like. The browser polls it and
// refetches the feed only when it changes.
async function feedVersion(pool: DatabasePool, sectionId: string) {
  const result = await pool.query<{ version: string }>(
    `SELECT md5(concat_ws('|',
       (SELECT count(*) FROM posts WHERE section_id = $1),
       (SELECT max(updated_at) FROM posts WHERE section_id = $1),
       (SELECT count(*) FROM comments AS c JOIN posts AS p ON p.id = c.post_id WHERE p.section_id = $1),
       (SELECT max(c.created_at) FROM comments AS c JOIN posts AS p ON p.id = c.post_id WHERE p.section_id = $1),
       (SELECT count(*) FROM likes AS l JOIN posts AS p ON p.id = l.post_id WHERE p.section_id = $1),
       (SELECT max(l.created_at) FROM likes AS l JOIN posts AS p ON p.id = l.post_id WHERE p.section_id = $1),
       (SELECT count(*) FROM post_attachments AS a JOIN posts AS p ON p.id = a.post_id WHERE p.section_id = $1),
       (SELECT max(a.created_at) FROM post_attachments AS a JOIN posts AS p ON p.id = a.post_id WHERE p.section_id = $1)
     )) AS version`,
    [sectionId],
  );
  return result.rows[0]!.version;
}

async function getComment(pool: DatabasePool, commentId: string) {
  const result = await pool.query<CommentRow & { section_id: string }>(
    `SELECT comment.id, comment.post_id, comment.author_user_id, comment.body, comment.created_at,
            post.section_id
     FROM comments AS comment
     JOIN posts AS post ON post.id = comment.post_id
     WHERE comment.id = $1`,
    [commentId],
  );
  return result.rows[0] ?? null;
}

export async function registerFeedRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  async function requireMember(request: FastifyRequest, reply: FastifyReply, sectionId: string) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (roles.length === 0) {
        await reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      }
    }
    return user;
  }

  // Author emails are staff-only, as on the roster (memberships.ts): anyone else sees null except
  // on their own posts and comments.
  async function seesEmails(user: { id: string; isPlatformAdmin: boolean }, sectionId: string) {
    return user.isPlatformAdmin || canManageSessions(await getSectionRoles(pool, user.id, sectionId));
  }

  async function requireManager(request: FastifyRequest, reply: FastifyReply, sectionId: string) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) {
        await reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      }
    }
    return user;
  }

  // Newest-first, with each Post's like count, whether the caller has liked it, and its comment
  // count -- Comments themselves are fetched separately, on demand, not embedded here.
  app.get("/api/sections/:sectionId/feed", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    const user = await requireMember(request, reply, sectionId);
    if (!user) return;

    // The version is read BEFORE the posts: a change landing between the two reads then leaves the
    // page holding an older version, so the next poll refetches. The other order would pair new
    // version with old posts and the change would never be fetched.
    const version = await feedVersion(pool, sectionId);
    const result = await pool.query(
      `SELECT post.id, post.body, post.link_url, post.created_at, post.updated_at,
              author.id AS author_user_id,
              CASE WHEN $3 OR author.id = $2 THEN author.email::text END AS author_email,
              author.display_name AS author_display_name,
              (SELECT count(*)::int FROM likes WHERE likes.post_id = post.id) AS like_count,
              EXISTS(
                SELECT 1 FROM likes WHERE likes.post_id = post.id AND likes.user_id = $2
              ) AS liked_by_me,
              (SELECT count(*)::int FROM comments WHERE comments.post_id = post.id) AS comment_count,
              -- With the count, tells an open comment list that a delete-and-repost happened (#2439).
              (SELECT max(created_at) FROM comments WHERE comments.post_id = post.id) AS last_comment_at,
              -- Attachment metadata only (#2438); the bytes come from GET /api/attachments/:id.
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', a.id, 'fileName', a.file_name, 'contentType', a.content_type,
                         'sizeBytes', a.size_bytes
                       ) ORDER BY a.created_at, a.id)
                FROM post_attachments AS a WHERE a.post_id = post.id
              ), '[]'::json) AS attachments
       FROM posts AS post
       JOIN users AS author ON author.id = post.author_user_id
       WHERE post.section_id = $1
       ORDER BY post.created_at DESC`,
      [sectionId, user.id, await seesEmails(user, sectionId)],
    );
    return reply.send({ posts: result.rows, version });
  });

  // Polled by the open Feed page every ~20 s while it is visible (#2439, Panupong's choice over
  // server push): one small query, no long-lived connection through Cloudflare and nginx.
  app.get("/api/sections/:sectionId/feed/version", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!z.uuid().safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const user = await requireMember(request, reply, sectionId);
    if (!user) return;
    return reply.send({ version: await feedVersion(pool, sectionId) });
  });

  app.post("/api/sections/:sectionId/posts", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    const user = await requireManager(request, reply, sectionId);
    if (!user) return;
    const parsed = createPostSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const result = await pool.query<PostRow>(
      `INSERT INTO posts (section_id, author_user_id, body, link_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, section_id, author_user_id, body, link_url, created_at, updated_at`,
      [sectionId, user.id, parsed.data.body, parsed.data.linkUrl ?? null],
    );
    return reply.code(201).send({ post: result.rows[0] });
  });

  // Any owner/teacher/ta may edit or delete a Post, not only the one who authored it --
  // consistent with how Category/Assignment management already works in this codebase.
  app.patch("/api/posts/:postId", async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const post = await getPost(pool, postId);
    if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" });
    const user = await requireManager(request, reply, post.section_id);
    if (!user) return;
    const parsed = updatePostSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    // COALESCE can't tell "field omitted" from "explicitly set to null" -- build the SET clause
    // from which keys the client actually sent, so `{ linkUrl: null }` really clears the link
    // instead of being indistinguishable from not sending linkUrl at all.
    const rawBody = (request.body ?? {}) as Record<string, unknown>;
    const setClauses = ["updated_at = now()"];
    const values: unknown[] = [postId];
    if (parsed.data.body !== undefined) {
      values.push(parsed.data.body);
      setClauses.push(`body = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(rawBody, "linkUrl")) {
      values.push(parsed.data.linkUrl ?? null);
      setClauses.push(`link_url = $${values.length}`);
    }

    const result = await pool.query<PostRow>(
      `UPDATE posts SET ${setClauses.join(", ")} WHERE id = $1
       RETURNING id, section_id, author_user_id, body, link_url, created_at, updated_at`,
      values,
    );
    return reply.send({ post: result.rows[0] });
  });

  app.delete("/api/posts/:postId", async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const post = await getPost(pool, postId);
    if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" });
    const user = await requireManager(request, reply, post.section_id);
    if (!user) return;
    await pool.query("DELETE FROM posts WHERE id = $1", [postId]);
    return reply.send({ deleted: true });
  });

  app.get("/api/posts/:postId/comments", async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const post = await getPost(pool, postId);
    if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" });
    const user = await requireMember(request, reply, post.section_id);
    if (!user) return;

    const result = await pool.query(
      `SELECT comment.id, comment.body, comment.created_at,
              author.id AS author_user_id,
              CASE WHEN $3 OR author.id = $2 THEN author.email::text END AS author_email,
              author.display_name AS author_display_name
       FROM comments AS comment
       JOIN users AS author ON author.id = comment.author_user_id
       WHERE comment.post_id = $1
       ORDER BY comment.created_at`,
      [postId, user.id, await seesEmails(user, post.section_id)],
    );
    return reply.send({ comments: result.rows });
  });

  // Any Section member -- including a plain student -- may comment; this is the genuine two-way
  // part of an otherwise one-way broadcast feed.
  app.post("/api/posts/:postId/comments", async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const post = await getPost(pool, postId);
    if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" });
    const user = await requireMember(request, reply, post.section_id);
    if (!user) return;
    const parsed = commentSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const result = await pool.query<CommentRow>(
      `INSERT INTO comments (post_id, author_user_id, body) VALUES ($1, $2, $3)
       RETURNING id, post_id, author_user_id, body, created_at`,
      [postId, user.id, parsed.data.body],
    );
    return reply.code(201).send({ comment: result.rows[0] });
  });

  // A comment's own author may delete it; owner/teacher/ta may delete any comment
  // (moderation) -- a different plain member may delete neither.
  app.delete("/api/comments/:commentId", async (request, reply) => {
    const { commentId } = request.params as { commentId: string };
    const comment = await getComment(pool, commentId);
    if (!comment) return reply.code(404).send({ error: "COMMENT_NOT_FOUND" });
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;

    if (!user.isPlatformAdmin && user.id !== comment.author_user_id) {
      const roles = await getSectionRoles(pool, user.id, comment.section_id);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    await pool.query("DELETE FROM comments WHERE id = $1", [commentId]);
    return reply.send({ deleted: true });
  });

  // Idempotent: liking an already-liked Post is a no-op, not an error or a duplicate row.
  app.post("/api/posts/:postId/like", async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const post = await getPost(pool, postId);
    if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" });
    const user = await requireMember(request, reply, post.section_id);
    if (!user) return;

    await pool.query(
      `INSERT INTO likes (post_id, user_id) VALUES ($1, $2)
       ON CONFLICT (post_id, user_id) DO NOTHING`,
      [postId, user.id],
    );
    return reply.send({ liked: true });
  });

  // Idempotent: unliking a Post that was never liked by this user is a clean no-op.
  app.delete("/api/posts/:postId/like", async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const post = await getPost(pool, postId);
    if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" });
    const user = await requireMember(request, reply, post.section_id);
    if (!user) return;

    await pool.query("DELETE FROM likes WHERE post_id = $1 AND user_id = $2", [postId, user.id]);
    return reply.send({ liked: false });
  });

  // --- Attachments (#2438) ---------------------------------------------------------------------
  // Upload is the raw file body (application/octet-stream), with the name in `?name=`. The route
  // lives in its own plugin scope: it accepts only octet-stream (every other body type gets 415
  // unparsed), the 10 MB limit exists only here, and the caller is authorized in preParsing --
  // after the rate limiter's onRequest hook has counted the request, before a single body byte is
  // read -- so an anonymous or non-staff caller can neither make the API buffer or parse a large
  // body nor make unlimited attempts.
  await app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES },
      (_request, body, done) => done(null, body),
    );

    upload.post(
      "/api/posts/:postId/attachments",
      {
        // Returning nothing keeps the original payload stream; a sent reply stops the request.
        preParsing: async (request, reply) => {
          const { postId } = request.params as { postId: string };
          if (!z.uuid().safeParse(postId).success) {
            await reply.code(400).send({ error: "INVALID_REQUEST" });
            return;
          }
          const post = await getPost(pool, postId);
          if (!post) {
            await reply.code(404).send({ error: "POST_NOT_FOUND" });
            return;
          }
          const user = await requireManager(request, reply, post.section_id);
          if (user) uploaders.set(request, user.id);
        },
      },
      async (request, reply) => {
        const { postId } = request.params as { postId: string };
        const userId = uploaders.get(request);
        if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });

        const fileName = cleanFileName(String((request.query as { name?: unknown }).name ?? ""));
        if (!fileName) return reply.code(400).send({ error: "INVALID_FILE_NAME" });
        if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: "UNSUPPORTED_MEDIA_TYPE" });
        const bytes = request.body;
        if (bytes.length === 0) return reply.code(400).send({ error: "EMPTY_FILE" });
        const type = detectAttachmentType(fileName, bytes);
        if (!type) return reply.code(400).send({ error: "UNSUPPORTED_FILE_TYPE" });

        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const created = await withTransaction(pool, async (client) => {
          // Lock the Post so two concurrent uploads cannot both pass the per-post count.
          const locked = await client.query("SELECT id FROM posts WHERE id = $1 FOR UPDATE", [postId]);
          if (!locked.rowCount) return { error: "POST_NOT_FOUND" as const };
          const count = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM post_attachments WHERE post_id = $1", [postId]);
          if ((count.rows[0]?.n ?? 0) >= MAX_ATTACHMENTS_PER_POST) return { error: "TOO_MANY_ATTACHMENTS" as const };
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO post_attachments (post_id, file_name, content_type, size_bytes, sha256, data, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [postId, fileName, type.contentType, bytes.length, sha256, bytes, userId],
          );
          return { id: inserted.rows[0]!.id };
        });
        if ("error" in created) return reply.code(created.error === "POST_NOT_FOUND" ? 404 : 409).send({ error: created.error });
        return reply.code(201).send({
          attachment: { id: created.id, fileName, contentType: type.contentType, sizeBytes: bytes.length },
        });
      },
    );
  });

  // Any member of the Post's Section may read. Images may be shown inline (`?inline=1`); every
  // other type, and any image without that flag, downloads. The response can never run script:
  // nosniff (helmet), a sandboxing CSP, and only the content types the upload allowed.
  //
  // The bytes are streamed in 1 MB slices (the column is stored uncompressed, so a slice reads
  // only its own pages), and at most a few slice queries run at once: a download never holds a
  // pool client or a whole file in memory, however slow the reader. Image previews have their own
  // rate-limit bucket, so a feed full of images cannot use up a learner's general API budget.
  const fileReads = new Semaphore(ATTACHMENT_READ_CONCURRENCY);
  app.get(
    "/api/attachments/:attachmentId",
    {
      // No automatic HEAD: it would run this handler, read the whole file and throw it away.
      exposeHeadRoute: false,
      config: { rateLimit: { max: 600, timeWindow: "1 minute", keyGenerator: sessionRateLimitKey(pool, config) } },
    },
    async (request, reply) => {
      const { attachmentId } = request.params as { attachmentId: string };
      if (!z.uuid().safeParse(attachmentId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
      const meta = await pool.query<{ section_id: string; file_name: string; content_type: string; size_bytes: number; sha256: string }>(
        `SELECT post.section_id, a.file_name, a.content_type, a.size_bytes, a.sha256
         FROM post_attachments AS a JOIN posts AS post ON post.id = a.post_id WHERE a.id = $1`,
        [attachmentId],
      );
      const row = meta.rows[0];
      if (!row) return reply.code(404).send({ error: "ATTACHMENT_NOT_FOUND" });
      if (!(await requireMember(request, reply, row.section_id))) return;

      let offset = 0;
      const stream = new Readable({
        highWaterMark: ATTACHMENT_SLICE_BYTES,
        read() {
          if (this.destroyed) return;
          if (offset >= row.size_bytes) {
            this.push(null);
            return;
          }
          const from = offset;
          offset += ATTACHMENT_SLICE_BYTES;
          fileReads
            .run(() =>
              pool.query<{ chunk: Buffer | null }>(
                "SELECT substring(data FROM $2 FOR $3) AS chunk FROM post_attachments WHERE id = $1",
                [attachmentId, from + 1, ATTACHMENT_SLICE_BYTES],
              ),
            )
            .then((slice) => {
              const chunk = slice.rows[0]?.chunk;
              // Deleted mid-download: end the response short rather than hang.
              if (!chunk || chunk.length === 0) this.destroy(new Error("attachment removed during download"));
              else this.push(chunk);
            })
            .catch((error: unknown) => this.destroy(error as Error));
        },
      });
      const inline = (request.query as { inline?: unknown }).inline === "1" && kindOf(row.content_type) === "image";
      return reply
        .header("Content-Type", row.content_type)
        .header("Content-Length", String(row.size_bytes))
        .header("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", row.file_name))
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("Cache-Control", "private, max-age=300")
        .send(stream);
    },
  );

  app.delete("/api/attachments/:attachmentId", async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    if (!z.uuid().safeParse(attachmentId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const meta = await pool.query<{ section_id: string }>(
      `SELECT post.section_id FROM post_attachments AS a JOIN posts AS post ON post.id = a.post_id WHERE a.id = $1`,
      [attachmentId],
    );
    const sectionId = meta.rows[0]?.section_id;
    if (!sectionId) return reply.code(404).send({ error: "ATTACHMENT_NOT_FOUND" });
    if (!(await requireManager(request, reply, sectionId))) return;
    await pool.query("DELETE FROM post_attachments WHERE id = $1", [attachmentId]);
    return reply.send({ deleted: true });
  });
}
