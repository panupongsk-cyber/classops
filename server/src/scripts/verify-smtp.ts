import nodemailer from "nodemailer";

import { loadMailConfig } from "../config.js";

const config = loadMailConfig();
const transporter = nodemailer.createTransport({
  host: config.host,
  port: config.port,
  secure: config.port === 465,
  requireTLS: config.port !== 465,
  auth: { user: config.user, pass: config.key },
});

try {
  await transporter.verify();
  console.info("Brevo SMTP connection and authentication succeeded.");
} finally {
  transporter.close();
}
