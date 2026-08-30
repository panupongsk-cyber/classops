import type { DatabaseClient, DatabasePool } from "../db.js";
import { encryptMailPayload } from "./payload-crypto.js";
import type { MailTemplateName } from "./templates.js";

export interface OutboxMail {
  id: string;
  recipient_email: string;
  template: MailTemplateName;
  payload_encrypted: string;
  attempts: number;
}

export async function enqueueMail(
  client: DatabaseClient,
  input: {
    recipientEmail: string;
    template: MailTemplateName;
    payload: Record<string, unknown>;
    encryptionKey: string;
  },
) {
  await client.query(
    `INSERT INTO email_outbox (recipient_email, template, payload_encrypted)
     VALUES ($1, $2, $3)`,
    [
      input.recipientEmail,
      input.template,
      encryptMailPayload(input.payload, input.encryptionKey),
    ],
  );
}

export async function claimMailBatch(pool: DatabasePool, limit = 10) {
  const result = await pool.query<OutboxMail>(
    `WITH claimable AS (
       SELECT id
       FROM email_outbox
       WHERE status = 'pending' AND available_at <= now()
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE email_outbox AS mail
     SET status = 'sending', locked_at = now(), attempts = attempts + 1
     FROM claimable
     WHERE mail.id = claimable.id
     RETURNING mail.id::text, mail.recipient_email::text, mail.template,
               mail.payload_encrypted, mail.attempts`,
    [limit],
  );
  return result.rows;
}

export async function markMailSent(pool: DatabasePool, id: string, providerMessageId?: string) {
  await pool.query(
    `UPDATE email_outbox
     SET status = 'sent', sent_at = now(), locked_at = NULL, provider_message_id = $2,
         last_error = NULL, payload_encrypted = ''
     WHERE id = $1`,
    [id, providerMessageId ?? null],
  );
}

export async function markMailFailed(pool: DatabasePool, mail: OutboxMail, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown mail error";
  const permanentlyFailed = mail.attempts >= 8;
  const retrySeconds = Math.min(3_600, 30 * 2 ** Math.min(mail.attempts, 7));
  await pool.query(
    `UPDATE email_outbox
     SET status = $2,
         available_at = CASE WHEN $2 = 'pending' THEN now() + ($3 * interval '1 second') ELSE available_at END,
         locked_at = NULL,
         last_error = $4
     WHERE id = $1`,
    [mail.id, permanentlyFailed ? "failed" : "pending", retrySeconds, message],
  );
}
