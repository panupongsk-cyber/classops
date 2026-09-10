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
  "Class Feed: Post/Comment/Like CRUD, cross-author management, idempotency, authorization",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, likes, comments, posts, scores, assignments, categories,
                session_picks, exit_ticket_responses, exit_tickets, session_checkins,
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
      const plainTeacher = await createUserWithSession(pool, {
        email: "plain-teacher@example.com",
        displayName: "Plain Teacher",
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

      const createSection = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "FEED101",
          title: "Feed Course",
          type: "short_course",
          term: "2569/1",
          ownerUserId: teacher.userId,
        },
      });
      assert.equal(createSection.statusCode, 201);
      const sectionId = createSection.json().sectionId as string;

      async function grant(email: string, roles: string[]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/sections/${sectionId}/memberships`,
          headers: { cookie: teacher.cookie, ...origin },
          payload: { email, roles },
        });
        assert.equal(response.statusCode, 201);
      }
      await grant("plain-teacher@example.com", ["teacher"]);
      await grant("student@example.com", ["student"]);
      await grant("student2@example.com", ["student"]);

      // --- Post CRUD ---

      const feedForbidden = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/feed`,
        headers: { cookie: nonMember.cookie },
      });
      assert.equal(feedForbidden.statusCode, 403);

      const createPostForbidden = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/posts`,
        headers: { cookie: student.cookie, ...origin },
        payload: { body: "I am not allowed to post this" },
      });
      assert.equal(createPostForbidden.statusCode, 403);

      const invalidLink = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/posts`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { body: "Bad link", linkUrl: "not-a-url" },
      });
      assert.equal(invalidLink.statusCode, 400);

      const createPost = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/posts`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { body: "Welcome to the class!", linkUrl: "https://example.com/slides" },
      });
      assert.equal(createPost.statusCode, 201);
      const postId = createPost.json().post.id as string;

      // A no-link Post also succeeds -- linkUrl is genuinely optional.
      const createPostNoLink = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/posts`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { body: "Second announcement" },
      });
      assert.equal(createPostNoLink.statusCode, 201);

      // plainTeacher did not author `postId` but is still owner/teacher/ta -- can edit/delete it.
      const editByNonAuthorManager = await app.inject({
        method: "PATCH",
        url: `/api/posts/${postId}`,
        headers: { cookie: plainTeacher.cookie, ...origin },
        payload: { body: "Welcome to the class! (edited)" },
      });
      assert.equal(editByNonAuthorManager.statusCode, 200);
      assert.equal(editByNonAuthorManager.json().post.body, "Welcome to the class! (edited)");
      // Editing only `body` must leave the existing linkUrl untouched -- not clear it.
      assert.equal(editByNonAuthorManager.json().post.link_url, "https://example.com/slides");

      // Explicitly sending linkUrl: null clears it -- distinct from omitting the field entirely,
      // which the assertion above already confirmed leaves it alone.
      const clearLink = await app.inject({
        method: "PATCH",
        url: `/api/posts/${postId}`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { linkUrl: null },
      });
      assert.equal(clearLink.statusCode, 200);
      assert.equal(clearLink.json().post.link_url, null);
      // Body from the previous edit is untouched by this linkUrl-only update.
      assert.equal(clearLink.json().post.body, "Welcome to the class! (edited)");

      const editForbidden = await app.inject({
        method: "PATCH",
        url: `/api/posts/${postId}`,
        headers: { cookie: student.cookie, ...origin },
        payload: { body: "hijacked" },
      });
      assert.equal(editForbidden.statusCode, 403);

      // --- Comment tests ---

      const commentFromNonMember = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/comments`,
        headers: { cookie: nonMember.cookie, ...origin },
        payload: { body: "I should not be able to comment" },
      });
      assert.equal(commentFromNonMember.statusCode, 403);

      const studentComment = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/comments`,
        headers: { cookie: student.cookie, ...origin },
        payload: { body: "When is the first assignment due?" },
      });
      assert.equal(studentComment.statusCode, 201);
      const studentCommentId = studentComment.json().comment.id as string;

      const teacherComment = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/comments`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { body: "Next Friday!" },
      });
      assert.equal(teacherComment.statusCode, 201);

      // A different plain student cannot delete student's comment.
      const deleteByOtherStudent = await app.inject({
        method: "DELETE",
        url: `/api/comments/${studentCommentId}`,
        headers: { cookie: student2.cookie, ...origin },
      });
      assert.equal(deleteByOtherStudent.statusCode, 403);

      // The comment's own author CAN delete it.
      const deleteByAuthor = await app.inject({
        method: "DELETE",
        url: `/api/comments/${studentCommentId}`,
        headers: { cookie: student.cookie, ...origin },
      });
      assert.equal(deleteByAuthor.statusCode, 200);

      // A fresh comment, this time deleted by a manager who is not its author (moderation).
      const secondStudentComment = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/comments`,
        headers: { cookie: student2.cookie, ...origin },
        payload: { body: "inappropriate content" },
      });
      const secondStudentCommentId = secondStudentComment.json().comment.id as string;
      const moderatorDelete = await app.inject({
        method: "DELETE",
        url: `/api/comments/${secondStudentCommentId}`,
        headers: { cookie: plainTeacher.cookie, ...origin },
      });
      assert.equal(moderatorDelete.statusCode, 200);

      const commentsList = await app.inject({
        method: "GET",
        url: `/api/posts/${postId}/comments`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(commentsList.statusCode, 200);
      // Only the teacher's reply remains: student's own-delete and the moderator's delete both
      // succeeded, leaving exactly one comment.
      assert.equal(commentsList.json().comments.length, 1);

      // --- Like tests ---

      const likeFromNonMember = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/like`,
        headers: { cookie: nonMember.cookie, ...origin },
      });
      assert.equal(likeFromNonMember.statusCode, 403);

      const likeOnce = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/like`,
        headers: { cookie: student.cookie, ...origin },
      });
      assert.equal(likeOnce.statusCode, 200);

      // Liking again is idempotent -- no duplicate row.
      const likeAgain = await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/like`,
        headers: { cookie: student.cookie, ...origin },
      });
      assert.equal(likeAgain.statusCode, 200);
      const likeCount = await pool.query(
        "SELECT count(*)::int AS count FROM likes WHERE post_id = $1 AND user_id = $2",
        [postId, student.userId],
      );
      assert.equal(likeCount.rows[0]?.count, 1);

      await app.inject({
        method: "POST",
        url: `/api/posts/${postId}/like`,
        headers: { cookie: student2.cookie, ...origin },
      });

      // --- Feed consistency ---

      const feedAsStudent = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/feed`,
        headers: { cookie: student.cookie },
      });
      assert.equal(feedAsStudent.statusCode, 200);
      const posts = feedAsStudent.json().posts as Array<{
        id: string;
        like_count: number;
        liked_by_me: boolean;
        comment_count: number;
      }>;
      // Newest-first: "Second announcement" (created after postId) comes before postId.
      assert.equal(posts[0]?.id === postId, false);
      const feedPost = posts.find((p) => p.id === postId);
      assert.equal(feedPost?.like_count, 2);
      assert.equal(feedPost?.liked_by_me, true);
      assert.equal(feedPost?.comment_count, 1);

      // A different Section member who never liked it sees likedByMe: false.
      const feedAsStudent2Viewer = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/feed`,
        headers: { cookie: plainTeacher.cookie },
      });
      const plainTeacherView = feedAsStudent2Viewer.json().posts.find(
        (p: { id: string }) => p.id === postId,
      );
      assert.equal(plainTeacherView.liked_by_me, false);

      // Unlike, then re-check the count drops by exactly one.
      const unlike = await app.inject({
        method: "DELETE",
        url: `/api/posts/${postId}/like`,
        headers: { cookie: student.cookie, ...origin },
      });
      assert.equal(unlike.statusCode, 200);
      const feedAfterUnlike = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}/feed`,
        headers: { cookie: student.cookie },
      });
      const afterUnlikePost = feedAfterUnlike.json().posts.find((p: { id: string }) => p.id === postId);
      assert.equal(afterUnlikePost.like_count, 1);
      assert.equal(afterUnlikePost.liked_by_me, false);

      // Unliking a Post never liked by this user is a clean no-op.
      const unlikeNeverLiked = await app.inject({
        method: "DELETE",
        url: `/api/posts/${postId}/like`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(unlikeNeverLiked.statusCode, 200);

      // --- Post deletion cascades ---

      const deletePost = await app.inject({
        method: "DELETE",
        url: `/api/posts/${postId}`,
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(deletePost.statusCode, 200);
      const orphanCheck = await pool.query(
        "SELECT (SELECT count(*) FROM comments WHERE post_id = $1) AS comments, (SELECT count(*) FROM likes WHERE post_id = $1) AS likes",
        [postId],
      );
      assert.equal(Number(orphanCheck.rows[0]?.comments), 0);
      assert.equal(Number(orphanCheck.rows[0]?.likes), 0);

      const deleteNonexistent = await app.inject({
        method: "DELETE",
        url: "/api/posts/00000000-0000-0000-0000-000000000000",
        headers: { cookie: teacher.cookie, ...origin },
      });
      assert.equal(deleteNonexistent.statusCode, 404);
    } finally {
      await app.close();
    }
  },
);
