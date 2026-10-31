import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { getSectionRoles, hasAnyRole } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { FACE_EMBEDDING_DIM } from "../face.js";

// 3-5 enrollment samples, each a 128-D face descriptor computed in the browser. `liveness` is
// audit-only (which challenges the browser passed during capture); the server never sees an image.
const embeddingSchema = z.array(z.number()).length(FACE_EMBEDDING_DIM);
const faceEnrollmentSchema = z.object({
  embeddings: z.array(embeddingSchema).min(3).max(5),
  liveness: z.string().max(64).optional(),
});

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

export async function registerFaceEnrollmentRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  // Read-only status for the signed-in user's own enrollment -- never returns the vectors.
  app.get("/api/me/face-enrollment", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const result = await pool.query<{ enrolled_at: string | null }>(
      "SELECT enrolled_at FROM face_enrollments WHERE user_id = $1",
      [user.id],
    );
    const row = result.rows[0];
    return reply.send({ enrolled: row != null, enrolledAt: row?.enrolled_at ?? null });
  });

  // Self-enroll: replaces any prior enrollment for this account (1:1, never per-section).
  app.put("/api/me/face-enrollment", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const parsed = faceEnrollmentSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const result = await pool.query<{ enrolled_at: string }>(
      `INSERT INTO face_enrollments (user_id, embeddings, liveness)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET embeddings = EXCLUDED.embeddings, liveness = EXCLUDED.liveness, updated_at = now()
       RETURNING enrolled_at`,
      [user.id, JSON.stringify(parsed.data.embeddings), parsed.data.liveness ?? null],
    );
    return reply.send({ enrolled: true, enrolledAt: result.rows[0]?.enrolled_at });
  });

  // Teacher override: owner/teacher of the section may clear a member's enrollment to force
  // re-enrollment. Never self-service deletion of another user.
  app.delete(
    "/api/sections/:sectionId/students/:userId/face-enrollment",
    async (request, reply) => {
      const user = await requireCurrentUser(request, reply, pool, config);
      if (!user) return;
      const { sectionId, userId } = request.params as { sectionId: string; userId: string };

      if (!user.isPlatformAdmin) {
        const callerRoles = await getSectionRoles(pool, user.id, sectionId);
        if (!hasAnyRole(callerRoles, ["owner", "teacher"])) {
          return reply.code(403).send({ error: "FORBIDDEN" });
        }
      }

      // The target must be a member of this section -- a manager of another section cannot reach
      // this user's enrollment through this section's URL.
      const membership = await pool.query(
        "SELECT 1 FROM memberships WHERE user_id = $1 AND section_id = $2",
        [userId, sectionId],
      );
      if (!membership.rowCount) return reply.code(404).send({ error: "MEMBERSHIP_NOT_FOUND" });

      const deleted = await pool.query(
        "DELETE FROM face_enrollments WHERE user_id = $1 RETURNING user_id",
        [userId],
      );
      if (!deleted.rowCount) return reply.code(404).send({ error: "NOT_ENROLLED" });
      return reply.send({ deleted: true });
    },
  );
}
