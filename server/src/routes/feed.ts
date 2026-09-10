import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";

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

    const result = await pool.query(
      `SELECT post.id, post.body, post.link_url, post.created_at, post.updated_at,
              author.id AS author_user_id, author.email::text AS author_email,
              author.display_name AS author_display_name,
              (SELECT count(*)::int FROM likes WHERE likes.post_id = post.id) AS like_count,
              EXISTS(
                SELECT 1 FROM likes WHERE likes.post_id = post.id AND likes.user_id = $2
              ) AS liked_by_me,
              (SELECT count(*)::int FROM comments WHERE comments.post_id = post.id) AS comment_count
       FROM posts AS post
       JOIN users AS author ON author.id = post.author_user_id
       WHERE post.section_id = $1
       ORDER BY post.created_at DESC`,
      [sectionId, user.id],
    );
    return reply.send({ posts: result.rows });
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
              author.id AS author_user_id, author.email::text AS author_email,
              author.display_name AS author_display_name
       FROM comments AS comment
       JOIN users AS author ON author.id = comment.author_user_id
       WHERE comment.post_id = $1
       ORDER BY comment.created_at`,
      [postId],
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
}
