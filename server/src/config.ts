import "dotenv/config";

import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.url(),
  TRUSTED_ORIGINS: z.string().min(1),
  TRUST_PROXY: booleanFromString,
  SESSION_COOKIE_NAME: z.string().min(1).default("classops_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(10).max(1_440).default(60),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(240).default(30),
  OUTBOX_ENCRYPTION_KEY: z.string().min(1).refine((value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  }, "OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),
});

const mailSchema = z.object({
  BREVO_SMTP_HOST: z.string().min(1),
  BREVO_SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
  BREVO_SMTP_USER: z.string().min(1),
  BREVO_SMTP_KEY: z.string().min(1),
  MAIL_FROM_NAME: z.string().min(1),
  MAIL_FROM_ADDRESS: z.email(),
  MAIL_REPLY_TO: z.email(),
});

export type AppConfig = ReturnType<typeof loadAppConfig>;
export type MailConfig = ReturnType<typeof loadMailConfig>;

export function loadAppConfig() {
  const env = baseSchema.parse(process.env);
  const googleValues = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI];
  const configuredGoogleValues = googleValues.filter(Boolean).length;
  if (configuredGoogleValues !== 0 && configuredGoogleValues !== googleValues.length) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be configured together",
    );
  }
  const trustedOrigins = env.TRUSTED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    appBaseUrl: env.APP_BASE_URL.replace(/\/$/, ""),
    trustedOrigins,
    trustProxy: env.TRUST_PROXY,
    sessionCookieName: env.SESSION_COOKIE_NAME,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    emailVerificationTtlMinutes: env.EMAIL_VERIFICATION_TTL_MINUTES,
    passwordResetTtlMinutes: env.PASSWORD_RESET_TTL_MINUTES,
    outboxEncryptionKey: env.OUTBOX_ENCRYPTION_KEY,
    googleOAuth:
      configuredGoogleValues === googleValues.length
        ? {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
            redirectUri: env.GOOGLE_REDIRECT_URI as string,
          }
        : null,
  } as const;
}

export function loadMailConfig() {
  const env = mailSchema.parse(process.env);
  return {
    host: env.BREVO_SMTP_HOST,
    port: env.BREVO_SMTP_PORT,
    user: env.BREVO_SMTP_USER,
    key: env.BREVO_SMTP_KEY,
    fromName: env.MAIL_FROM_NAME,
    fromAddress: env.MAIL_FROM_ADDRESS,
    replyTo: env.MAIL_REPLY_TO,
  } as const;
}
