import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const courseTypeSchema = z.enum(["semester", "self_paced", "short_course"]);
const createCourseSchema = z.object({
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  type: courseTypeSchema,
  term: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(50).default("default"),
  ownerUserId: z.uuid().optional(),
});
const createSectionSchema = z.object({
  term: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(50).default("default"),
  ownerUserId: z.uuid().optional(),
});

function generateJoinCode() {
  return randomBytes(6).toString("base64url");
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

export async function registerCourseRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  app.get("/api/courses", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const result = await pool.query(
      "SELECT id, code, title, type FROM courses ORDER BY code",
    );
    return reply.send({ courses: result.rows });
  });

  app.get("/api/courses/:courseId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { courseId } = request.params as { courseId: string };
    const course = await pool.query(
      "SELECT id, code, title, type FROM courses WHERE id = $1",
      [courseId],
    );
    if (!course.rowCount) return reply.code(404).send({ error: "COURSE_NOT_FOUND" });
    const sections = await pool.query(
      "SELECT id, term, label, join_code FROM sections WHERE course_id = $1 ORDER BY term, label",
      [courseId],
    );
    return reply.send({ course: course.rows[0], sections: sections.rows });
  });

  // Platform-admin-only: bootstraps a Course together with its first Section and an owner
  // Membership in one atomic step, avoiding the chicken-and-egg problem of a Section needing an
  // owner that can only be granted by an existing member of that same Section.
  app.post("/api/courses", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    if (!user.isPlatformAdmin) return reply.code(403).send({ error: "FORBIDDEN" });

    const parsed = createCourseSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const ownerUserId = parsed.data.ownerUserId ?? user.id;
    const joinCode = generateJoinCode();

    try {
      const created = await withTransaction(pool, async (client) => {
        const course = await client.query<{ id: string }>(
          `INSERT INTO courses (code, title, type) VALUES ($1, $2, $3) RETURNING id`,
          [parsed.data.code, parsed.data.title, parsed.data.type],
        );
        const courseId = course.rows[0]?.id;
        if (!courseId) throw new Error("Course insert did not return an id");

        const section = await client.query<{ id: string }>(
          `INSERT INTO sections (course_id, term, label, join_code)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [courseId, parsed.data.term, parsed.data.label, joinCode],
        );
        const sectionId = section.rows[0]?.id;
        if (!sectionId) throw new Error("Section insert did not return an id");

        await client.query(
          `INSERT INTO memberships (user_id, section_id, roles) VALUES ($1, $2, ARRAY['owner'])`,
          [ownerUserId, sectionId],
        );
        return { courseId, sectionId };
      });
      return reply.code(201).send(created);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "COURSE_CODE_ALREADY_EXISTS" });
      }
      if ((error as { code?: string }).code === "23503") {
        return reply.code(400).send({ error: "OWNER_USER_NOT_FOUND" });
      }
      throw error;
    }
  });

  // Additional Section under an existing Course. Platform admin, or an existing owner of any
  // Section of this Course, may call this — someone must already hold owner authority over the
  // Course to add another offering of it.
  app.post("/api/courses/:courseId/sections", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { courseId } = request.params as { courseId: string };
    const parsed = createSectionSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    if (!user.isPlatformAdmin) {
      const ownsCourse = await pool.query(
        `SELECT 1 FROM memberships AS membership
         JOIN sections AS section ON section.id = membership.section_id
         WHERE section.course_id = $1 AND membership.user_id = $2
           AND 'owner' = ANY(membership.roles)
         LIMIT 1`,
        [courseId, user.id],
      );
      if (!ownsCourse.rowCount) return reply.code(403).send({ error: "FORBIDDEN" });
    }

    const ownerUserId = parsed.data.ownerUserId ?? user.id;
    const joinCode = generateJoinCode();
    try {
      const created = await withTransaction(pool, async (client) => {
        const section = await client.query<{ id: string }>(
          `INSERT INTO sections (course_id, term, label, join_code)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [courseId, parsed.data.term, parsed.data.label, joinCode],
        );
        const sectionId = section.rows[0]?.id;
        if (!sectionId) throw new Error("Section insert did not return an id");
        await client.query(
          `INSERT INTO memberships (user_id, section_id, roles) VALUES ($1, $2, ARRAY['owner'])`,
          [ownerUserId, sectionId],
        );
        return { sectionId };
      });
      return reply.code(201).send(created);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        return reply.code(404).send({ error: "COURSE_NOT_FOUND" });
      }
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "SECTION_ALREADY_EXISTS" });
      }
      throw error;
    }
  });
}
