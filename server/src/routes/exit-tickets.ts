import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";

const openSchema = z.object({ prompt: z.string().trim().min(1).max(500) });
const responseSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

interface ExitTicketRow {
  id: string;
  session_id: string;
  prompt: string;
  opened_at: string;
  closed_at: string | null;
}

async function getSectionIdForSession(pool: DatabasePool, sessionId: string) {
  const result = await pool.query<{ section_id: string }>(
    "SELECT section_id FROM class_sessions WHERE id = $1",
    [sessionId],
  );
  return result.rows[0]?.section_id ?? null;
}

async function getExitTicket(pool: DatabasePool, exitTicketId: string) {
  const result = await pool.query<ExitTicketRow>(
    `SELECT id, session_id, prompt, opened_at, closed_at FROM exit_tickets WHERE id = $1`,
    [exitTicketId],
  );
  return result.rows[0] ?? null;
}

export async function registerExitTicketRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  // Opening is independent of the Session's own check-in opened_at/closed_at -- an Exit Ticket
  // can be opened whether check-in is currently open, already closed, or never opened at all.
  app.post("/api/sessions/:sessionId/exit-tickets", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sessionId } = request.params as { sessionId: string };
    const parsed = openSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const sectionId = await getSectionIdForSession(pool, sessionId);
    if (sectionId === null) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }

    const existing = await pool.query(
      "SELECT 1 FROM exit_tickets WHERE session_id = $1 AND closed_at IS NULL",
      [sessionId],
    );
    if (existing.rowCount) return reply.code(409).send({ error: "EXIT_TICKET_ALREADY_OPEN" });

    try {
      const result = await pool.query<ExitTicketRow>(
        `INSERT INTO exit_tickets (session_id, prompt) VALUES ($1, $2)
         RETURNING id, session_id, prompt, opened_at, closed_at`,
        [sessionId, parsed.data.prompt],
      );
      return reply.code(201).send({ exitTicket: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "EXIT_TICKET_ALREADY_OPEN" });
      }
      throw error;
    }
  });

  async function requireExitTicketManager(
    request: FastifyRequest,
    reply: FastifyReply,
    exitTicketId: string,
  ) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    const ticket = await getExitTicket(pool, exitTicketId);
    if (!ticket) {
      await reply.code(404).send({ error: "EXIT_TICKET_NOT_FOUND" });
      return null;
    }
    const sectionId = await getSectionIdForSession(pool, ticket.session_id);
    if (sectionId === null) {
      await reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      return null;
    }
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) {
        await reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      }
    }
    return ticket;
  }

  app.post("/api/exit-tickets/:exitTicketId/close", async (request, reply) => {
    const { exitTicketId } = request.params as { exitTicketId: string };
    const ticket = await requireExitTicketManager(request, reply, exitTicketId);
    if (!ticket) return;
    if (ticket.closed_at !== null) {
      return reply.code(409).send({ error: "EXIT_TICKET_NOT_OPEN" });
    }
    const result = await pool.query<ExitTicketRow>(
      `UPDATE exit_tickets SET closed_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id, session_id, prompt, opened_at, closed_at`,
      [exitTicketId],
    );
    return reply.send({ exitTicket: result.rows[0] });
  });

  app.get("/api/exit-tickets/:exitTicketId/responses", async (request, reply) => {
    const { exitTicketId } = request.params as { exitTicketId: string };
    const ticket = await requireExitTicketManager(request, reply, exitTicketId);
    if (!ticket) return;
    const result = await pool.query(
      `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name,
              response.rating, response.comment, response.submitted_at, response.updated_at
       FROM exit_ticket_responses AS response
       JOIN users AS app_user ON app_user.id = response.user_id
       WHERE response.exit_ticket_id = $1
       ORDER BY response.submitted_at`,
      [exitTicketId],
    );
    return reply.send({ responses: result.rows });
  });

  // Any Section member needs this to find the open Exit Ticket (if any) and see their own prior
  // response, since resubmission is an edit -- mirrors sessions.ts's `/sessions/open` pattern.
  app.get("/api/sessions/:sessionId/exit-tickets/open", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sessionId } = request.params as { sessionId: string };
    const sectionId = await getSectionIdForSession(pool, sessionId);
    if (sectionId === null) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const ticketResult = await pool.query<ExitTicketRow>(
      `SELECT id, session_id, prompt, opened_at, closed_at FROM exit_tickets
       WHERE session_id = $1 AND closed_at IS NULL
       ORDER BY opened_at DESC LIMIT 1`,
      [sessionId],
    );
    const ticket = ticketResult.rows[0] ?? null;
    if (!ticket) return reply.send({ exitTicket: null, myResponse: null });

    const responseResult = await pool.query(
      "SELECT rating, comment, submitted_at, updated_at FROM exit_ticket_responses WHERE exit_ticket_id = $1 AND user_id = $2",
      [ticket.id, user.id],
    );
    return reply.send({ exitTicket: ticket, myResponse: responseResult.rows[0] ?? null });
  });

  // Route-level override, same reasoning as check-in's in Phase 2a (phase2b1-qa-spec.md §5): a
  // student resubmitting rapidly, or a script probing, shouldn't ride the global 100/min limit.
  app.post(
    "/api/exit-tickets/:exitTicketId/responses",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await requireCurrentUser(request, reply, pool, config);
      if (!user) return;
      const { exitTicketId } = request.params as { exitTicketId: string };
      const parsed = responseSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error);

      const ticket = await getExitTicket(pool, exitTicketId);
      if (!ticket) return reply.code(404).send({ error: "EXIT_TICKET_NOT_FOUND" });
      const sectionId = await getSectionIdForSession(pool, ticket.session_id);
      if (sectionId === null) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });

      if (!user.isPlatformAdmin) {
        const roles = await getSectionRoles(pool, user.id, sectionId);
        if (roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
      }
      if (ticket.closed_at !== null) {
        return reply.code(409).send({ error: "EXIT_TICKET_NOT_OPEN" });
      }

      // Identity is always the authenticated caller, never a value from the request body -- same
      // rule as check-in. Resubmission upserts (see the product spec's deviation from check-in's
      // idempotent-no-op pattern): a student may revise their rating/comment until the ticket
      // closes.
      const result = await pool.query(
        `INSERT INTO exit_ticket_responses (exit_ticket_id, user_id, rating, comment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (exit_ticket_id, user_id) DO UPDATE
         SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()
         RETURNING rating, comment, submitted_at, updated_at`,
        [exitTicketId, user.id, parsed.data.rating, parsed.data.comment ?? null],
      );
      return reply.send({ response: result.rows[0] });
    },
  );
}
