import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { MembershipRole } from "../authz.js";
import { canManageMembership, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { normalizeEmail } from "../security.js";

const roleSchema = z.enum(["owner", "teacher", "student", "ta"]);
const grantSchema = z.object({
  email: z.email().transform(normalizeEmail),
  roles: z.array(roleSchema).min(1),
});
const revokeSchema = z.object({ roles: z.array(roleSchema).min(1) });

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

export async function registerMembershipRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  app.get("/api/sections/:sectionId/memberships", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const callerRoles = await getSectionRoles(pool, user.id, sectionId);
    if (!user.isPlatformAdmin && callerRoles.length === 0) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name, membership.roles
       FROM memberships AS membership
       JOIN users AS app_user ON app_user.id = membership.user_id
       WHERE membership.section_id = $1
       ORDER BY app_user.display_name`,
      [sectionId],
    );
    return reply.send({ memberships: result.rows });
  });

  // Grants one or more roles to a user (by email) in a section. Merges into an existing
  // membership row rather than creating a duplicate for the same (user, section) pair.
  app.post("/api/sections/:sectionId/memberships", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const parsed = grantSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    if (!user.isPlatformAdmin) {
      const callerRoles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageMembership(callerRoles, parsed.data.roles)) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
    }

    const targetUser = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [parsed.data.email],
    );
    const targetUserId = targetUser.rows[0]?.id;
    if (!targetUserId) return reply.code(404).send({ error: "USER_NOT_FOUND" });

    const result = await pool.query<{ roles: MembershipRole[] }>(
      `INSERT INTO memberships (user_id, section_id, roles)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, section_id) DO UPDATE
       SET roles = (
             SELECT array_agg(DISTINCT role)
             FROM unnest(memberships.roles || $3) AS role
           ),
           updated_at = now()
       RETURNING roles`,
      [targetUserId, sectionId, parsed.data.roles],
    );
    return reply.code(201).send({ userId: targetUserId, roles: result.rows[0]?.roles ?? [] });
  });

  // Removes one or more roles from a user's membership in a section. Deletes the row entirely
  // once no roles remain.
  app.delete("/api/sections/:sectionId/memberships/:userId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId, userId } = request.params as { sectionId: string; userId: string };
    const parsed = revokeSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    if (!user.isPlatformAdmin) {
      const callerRoles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageMembership(callerRoles, parsed.data.roles)) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
    }

    // The `roles` CHECK constraint forbids an empty array, so an UPDATE can never write the
    // zero-roles case — compute the remainder first and DELETE the row outright when it's empty.
    const remainingRoles = await withTransaction(pool, async (client) => {
      const current = await client.query<{ roles: MembershipRole[] }>(
        "SELECT roles FROM memberships WHERE user_id = $1 AND section_id = $2 FOR UPDATE",
        [userId, sectionId],
      );
      const existingRoles = current.rows[0]?.roles;
      if (!existingRoles) return null;
      const remaining = existingRoles.filter((role) => !parsed.data.roles.includes(role));
      if (remaining.length === 0) {
        await client.query("DELETE FROM memberships WHERE user_id = $1 AND section_id = $2", [
          userId,
          sectionId,
        ]);
      } else {
        await client.query(
          "UPDATE memberships SET roles = $3, updated_at = now() WHERE user_id = $1 AND section_id = $2",
          [userId, sectionId, remaining],
        );
      }
      return remaining;
    });
    if (remainingRoles === null) return reply.code(404).send({ error: "MEMBERSHIP_NOT_FOUND" });
    return reply.send({ userId, roles: remainingRoles });
  });
}
