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

// This TRUNCATEs shared tables against TEST_DATABASE_URL, same as
// oauth-flow.integration.test.ts — both rely on `npm test`'s --test-concurrency=1 (see
// package.json) so their TRUNCATE/insert cycles never race against each other on the one real
// database. Do not remove that flag without giving DB-backed test files another way to avoid
// trampling each other's data.
test(
  "Course/Section/Membership CRUD, authorization, and join-code enrollment",
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
      const teacher = await createUserWithSession(pool, {
        email: "teacher@example.com",
        displayName: "Teacher",
      });
      const student = await createUserWithSession(pool, {
        email: "student@example.com",
        displayName: "Student",
      });
      const another = await createUserWithSession(pool, {
        email: "another@example.com",
        displayName: "Another Student",
      });
      const plainTeacher = await createUserWithSession(pool, {
        email: "plain-teacher@example.com",
        displayName: "Plain Teacher",
      });
      const taTarget = await createUserWithSession(pool, {
        email: "ta-target@example.com",
        displayName: "TA Target",
      });

      // is_platform_admin flows through the session to /api/auth/me.
      const meResponse = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: admin.cookie },
      });
      assert.equal(meResponse.statusCode, 200);
      assert.equal(meResponse.json().user.isPlatformAdmin, true);

      // Reject a Section under a nonexistent Course.
      const missingCourseResponse = await app.inject({
        method: "POST",
        url: "/api/courses/00000000-0000-0000-0000-000000000000/sections",
        headers: { cookie: admin.cookie, ...origin },
        payload: { term: "2569/1" },
      });
      assert.equal(missingCourseResponse.statusCode, 404);

      // Platform admin creates a Course + its first Section, granting the teacher as owner.
      const createCourseResponse = await app.inject({
        method: "POST",
        url: "/api/courses",
        headers: { cookie: admin.cookie, ...origin },
        payload: {
          code: "316121",
          title: "Computer Programming",
          type: "semester",
          term: "2569/1",
          label: "801",
          ownerUserId: teacher.userId,
        },
      });
      assert.equal(createCourseResponse.statusCode, 201);
      const { courseId, sectionId } = createCourseResponse.json();
      assert.ok(courseId);
      assert.ok(sectionId);

      const sectionDetail = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(sectionDetail.statusCode, 200);
      const joinCode = sectionDetail.json().section.join_code as string;
      assert.ok(joinCode);

      // A non-member (not admin, not section member) cannot read the section.
      const forbiddenRead = await app.inject({
        method: "GET",
        url: `/api/sections/${sectionId}`,
        headers: { cookie: student.cookie },
      });
      assert.equal(forbiddenRead.statusCode, 403);

      // GET /api/courses/:courseId never leaks a Section's join_code to a non-member -- the
      // Section itself is still listed (id/term/label, catalog-level info), but join_code is
      // null unless the caller is a member or a platform admin. This is the fix for the
      // authorization gap found during PS-TASK-20260910-657's adversarial spec review: any
      // authenticated user could previously read a real join_code here and self-enroll via
      // POST /api/sections/join, bypassing every Section's actual membership boundary.
      const courseDetailAsNonMember = await app.inject({
        method: "GET",
        url: `/api/courses/${courseId}`,
        headers: { cookie: student.cookie },
      });
      assert.equal(courseDetailAsNonMember.statusCode, 200);
      const nonMemberSection = courseDetailAsNonMember
        .json()
        .sections.find((section: { id: string }) => section.id === sectionId);
      assert.ok(nonMemberSection, "the Section itself is still listed for a non-member");
      assert.equal(nonMemberSection.join_code, null);

      // The Section's owner (a member) sees the real join_code through the same endpoint.
      const courseDetailAsMember = await app.inject({
        method: "GET",
        url: `/api/courses/${courseId}`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(courseDetailAsMember.statusCode, 200);
      const memberSection = courseDetailAsMember
        .json()
        .sections.find((section: { id: string }) => section.id === sectionId);
      assert.equal(memberSection.join_code, joinCode);

      // A platform admin sees the real join_code too, without being a Section member.
      const courseDetailAsAdmin = await app.inject({
        method: "GET",
        url: `/api/courses/${courseId}`,
        headers: { cookie: admin.cookie },
      });
      assert.equal(courseDetailAsAdmin.statusCode, 200);
      const adminSection = courseDetailAsAdmin
        .json()
        .sections.find((section: { id: string }) => section.id === sectionId);
      assert.equal(adminSection.join_code, joinCode);

      // Per-Section isolation within the same Course: a caller who is a member of one Section
      // must not see a sibling Section's join_code just because they belong to the same Course.
      // A single-Section fixture can't distinguish correct per-Section correlation from a broken
      // implementation that accidentally scoped membership at the Course level instead -- add a
      // second Section under the same Course, owned by a different user, and confirm the first
      // Section's owner sees null for it.
      const secondSectionResponse = await app.inject({
        method: "POST",
        url: `/api/courses/${courseId}/sections`,
        headers: { cookie: admin.cookie, ...origin },
        payload: { term: "2569/1", label: "802", ownerUserId: another.userId },
      });
      assert.equal(secondSectionResponse.statusCode, 201);
      const secondSectionId = secondSectionResponse.json().sectionId as string;

      const courseDetailAfterSecondSection = await app.inject({
        method: "GET",
        url: `/api/courses/${courseId}`,
        headers: { cookie: teacher.cookie },
      });
      assert.equal(courseDetailAfterSecondSection.statusCode, 200);
      const sections = courseDetailAfterSecondSection.json().sections as Array<{
        id: string;
        join_code: string | null;
      }>;
      const ownSectionAfter = sections.find((section) => section.id === sectionId);
      const siblingSection = sections.find((section) => section.id === secondSectionId);
      assert.ok(ownSectionAfter && siblingSection, "both Sections are listed");
      assert.equal(ownSectionAfter?.join_code, joinCode, "still sees their own Section's join_code");
      assert.equal(
        siblingSection?.join_code,
        null,
        "does not see the sibling Section's join_code just for sharing a Course",
      );

      // Teacher (owner of this section) grants the student role to `student` by email.
      const grantResponse = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { email: "student@example.com", roles: ["student"] },
      });
      assert.equal(grantResponse.statusCode, 201);
      assert.deepEqual(grantResponse.json().roles, ["student"]);

      // Granting again with an additional role merges into the existing row, not a new one.
      const grantAgainResponse = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { email: "student@example.com", roles: ["ta"] },
      });
      assert.equal(grantAgainResponse.statusCode, 201);
      assert.deepEqual(new Set(grantAgainResponse.json().roles), new Set(["student", "ta"]));
      const membershipCount = await pool.query(
        "SELECT count(*)::int AS count FROM memberships WHERE user_id = $1 AND section_id = $2",
        [student.userId, sectionId],
      );
      assert.equal(membershipCount.rows[0]?.count, 1);

      // `teacher.cookie` above belongs to the section's *owner* (granted at course creation), not
      // someone holding the plain `teacher` role — owner legitimately can grant owner, so testing
      // "a teacher cannot grant owner" against them would trivially pass 201, not exercise the
      // rule at all. Grant a genuinely separate user only the `teacher` role, then test them.
      const grantTeacherRoleResponse = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { email: "plain-teacher@example.com", roles: ["teacher"] },
      });
      assert.equal(grantTeacherRoleResponse.statusCode, 201);
      assert.deepEqual(grantTeacherRoleResponse.json().roles, ["teacher"]);

      // A plain teacher (not owner) can manage student/ta...
      const plainTeacherGrantsStudent = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: plainTeacher.cookie, ...origin },
        payload: { email: "ta-target@example.com", roles: ["ta"] },
      });
      assert.equal(plainTeacherGrantsStudent.statusCode, 201);
      assert.deepEqual(plainTeacherGrantsStudent.json().roles, ["ta"]);

      // ...but cannot grant the owner role.
      const plainTeacherGrantsOwner = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: plainTeacher.cookie, ...origin },
        payload: { email: "student@example.com", roles: ["owner"] },
      });
      assert.equal(plainTeacherGrantsOwner.statusCode, 403);

      // A student cannot manage anyone's membership.
      const studentManages = await app.inject({
        method: "POST",
        url: `/api/sections/${sectionId}/memberships`,
        headers: { cookie: student.cookie, ...origin },
        payload: { email: "another@example.com", roles: ["student"] },
      });
      assert.equal(studentManages.statusCode, 403);

      // Teacher revokes the ta role from the student, leaving them a plain student.
      const revokeResponse = await app.inject({
        method: "DELETE",
        url: `/api/sections/${sectionId}/memberships/${student.userId}`,
        headers: { cookie: teacher.cookie, ...origin },
        payload: { roles: ["ta"] },
      });
      assert.equal(revokeResponse.statusCode, 200);
      assert.deepEqual(revokeResponse.json().roles, ["student"]);

      // Only an owner may revoke the owner role — the platform admin (not a section member) can,
      // since admin bypasses section-level authorization entirely.
      const revokeOwnerByAdmin = await app.inject({
        method: "DELETE",
        url: `/api/sections/${sectionId}/memberships/${teacher.userId}`,
        headers: { cookie: admin.cookie, ...origin },
        payload: { roles: ["owner"] },
      });
      assert.equal(revokeOwnerByAdmin.statusCode, 200);
      assert.deepEqual(revokeOwnerByAdmin.json().roles, []);
      // Roles emptying out deletes the membership row entirely.
      const teacherMembership = await pool.query(
        "SELECT 1 FROM memberships WHERE user_id = $1 AND section_id = $2",
        [teacher.userId, sectionId],
      );
      assert.equal(teacherMembership.rowCount, 0);

      // Join-code enrollment grants `student` only, is idempotent, and never grants other roles.
      const invalidJoin = await app.inject({
        method: "POST",
        url: "/api/sections/join",
        headers: { cookie: another.cookie, ...origin },
        payload: { code: "not-a-real-code" },
      });
      assert.equal(invalidJoin.statusCode, 400);

      const joinResponse = await app.inject({
        method: "POST",
        url: "/api/sections/join",
        headers: { cookie: another.cookie, ...origin },
        payload: { code: joinCode },
      });
      assert.equal(joinResponse.statusCode, 200);
      assert.deepEqual(joinResponse.json().roles, ["student"]);

      const joinAgainResponse = await app.inject({
        method: "POST",
        url: "/api/sections/join",
        headers: { cookie: another.cookie, ...origin },
        payload: { code: joinCode },
      });
      assert.equal(joinAgainResponse.statusCode, 200);
      const anotherMembership = await pool.query<{ roles: string[] }>(
        "SELECT roles FROM memberships WHERE user_id = $1 AND section_id = $2",
        [another.userId, sectionId],
      );
      assert.equal(anotherMembership.rowCount, 1);
      assert.deepEqual(anotherMembership.rows[0]?.roles, ["student"]);

      // GET /api/me/sections lists every Section the caller has a Membership in, with the
      // joined Course/Section fields the v2 "My Sections" screen needs. `another` is a member of
      // two Sections at this point: `owner` of `secondSectionId` (granted directly at that
      // Section's creation above) and `student` of `sectionId` (via the join-code redemption
      // above) -- asserting both, rather than just a count, also confirms the join scoping is
      // per-membership, not per-course (both Sections share the same Course).
      const myOwnSections = await app.inject({
        method: "GET",
        url: "/api/me/sections",
        headers: { cookie: another.cookie },
      });
      assert.equal(myOwnSections.statusCode, 200);
      const listedSections = myOwnSections.json().sections as Array<{
        section_id: string;
        course_code: string;
        roles: string[];
      }>;
      assert.equal(listedSections.length, 2);
      const joinedSection = listedSections.find((section) => section.section_id === sectionId);
      const ownedSection = listedSections.find((section) => section.section_id === secondSectionId);
      assert.equal(joinedSection?.course_code, "316121");
      assert.deepEqual(joinedSection?.roles, ["student"]);
      assert.equal(ownedSection?.course_code, "316121");
      assert.deepEqual(ownedSection?.roles, ["owner"]);

      // A user with no memberships at all gets an empty list, not an error -- the platform admin
      // never took a Membership row themselves in this test (ownerUserId was always someone
      // else), which also confirms this endpoint does not implicitly show every Section to an
      // admin the way other endpoints' `isPlatformAdmin` bypass does.
      const noSections = await app.inject({
        method: "GET",
        url: "/api/me/sections",
        headers: { cookie: admin.cookie },
      });
      assert.equal(noSections.statusCode, 200);
      assert.deepEqual(noSections.json().sections, []);
    } finally {
      await app.close();
    }
  },
);
