import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { getSectionRoles, hasAnyRole } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";

const joinSchema = z.object({ code: z.string().trim().min(1).max(64) });

function generateJoinCode() {
  return randomBytes(6).toString("base64url");
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

export async function registerSectionRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  app.get("/api/sections/:sectionId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const roles = await getSectionRoles(pool, user.id, sectionId);
    if (!user.isPlatformAdmin && roles.length === 0) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT id, course_id, term, label, join_code FROM sections WHERE id = $1`,
      [sectionId],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    return reply.send({ section: result.rows[0] });
  });

  // Redeems a join code: grants the caller `student` only, never `teacher`/`ta`/`owner`.
  // Idempotent — redeeming an already-redeemed code does not duplicate the row or add roles.
  app.post("/api/sections/join", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const parsed = joinSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const section = await pool.query<{ id: string }>(
      "SELECT id FROM sections WHERE join_code = $1",
      [parsed.data.code],
    );
    const sectionId = section.rows[0]?.id;
    if (!sectionId) return reply.code(400).send({ error: "INVALID_JOIN_CODE" });

    await pool.query(
      `INSERT INTO memberships (user_id, section_id, roles)
       VALUES ($1, $2, ARRAY['student'])
       ON CONFLICT (user_id, section_id) DO UPDATE
       SET roles = CASE WHEN 'student' = ANY(memberships.roles) THEN memberships.roles
                        ELSE array_append(memberships.roles, 'student') END,
           updated_at = now()`,
      [user.id, sectionId],
    );
    return reply.send({ sectionId, roles: ["student"] });
  });

  app.post("/api/sections/:sectionId/join-code/regenerate", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const roles = await getSectionRoles(pool, user.id, sectionId);
    if (!user.isPlatformAdmin && !hasAnyRole(roles, ["owner", "teacher"])) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const joinCode = generateJoinCode();
    const result = await pool.query(
      "UPDATE sections SET join_code = $2, updated_at = now() WHERE id = $1 RETURNING join_code",
      [sectionId, joinCode],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    return reply.send({ joinCode: result.rows[0]?.join_code });
  });
}
