import process from "node:process";

import nodemailer from "nodemailer";

import { loadAppConfig, loadMailConfig } from "../config.js";
import { createDatabasePool } from "../db.js";
import { claimMailBatch, markMailFailed, markMailSent } from "../email/outbox.js";
import { decryptMailPayload } from "../email/payload-crypto.js";
import { renderMailTemplate } from "../email/templates.js";

const appConfig = loadAppConfig();
const mailConfig = loadMailConfig();
const pool = createDatabasePool(appConfig.databaseUrl);
const transporter = nodemailer.createTransport({
  host: mailConfig.host,
  port: mailConfig.port,
  secure: mailConfig.port === 465,
  requireTLS: mailConfig.port !== 465,
  auth: { user: mailConfig.user, pass: mailConfig.key },
  pool: true,
  maxConnections: 2,
  maxMessages: 50,
});

let stopping = false;
const once = process.argv.includes("--once");

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

async function processBatch() {
  const batch = await claimMailBatch(pool);
  for (const mail of batch) {
    try {
      const payload = decryptMailPayload(mail.payload_encrypted, appConfig.outboxEncryptionKey);
      const rendered = renderMailTemplate(mail.template, payload);
      const result = await transporter.sendMail({
        from: { name: mailConfig.fromName, address: mailConfig.fromAddress },
        replyTo: mailConfig.replyTo,
        to: mail.recipient_email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await markMailSent(pool, mail.id, result.messageId);
      console.info(JSON.stringify({ event: "mail.sent", outboxId: mail.id, template: mail.template }));
    } catch (error) {
      await markMailFailed(pool, mail, error);
      console.error(
        JSON.stringify({
          event: "mail.failed",
          outboxId: mail.id,
          template: mail.template,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }
  return batch.length;
}

try {
  do {
    const count = await processBatch();
    if (once) break;
    if (count === 0) await new Promise((resolve) => setTimeout(resolve, 5_000));
  } while (!stopping);
} finally {
  transporter.close();
  await pool.end();
}
