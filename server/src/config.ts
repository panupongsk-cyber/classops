import "dotenv/config";

import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

// Compose/shell environments commonly pass an unset variable through as an empty string rather
// than omitting the key entirely (e.g. `${GOOGLE_CLIENT_ID}` in a Compose `environment:` block
// with no value in the env file) — treat "" the same as "not provided" for optional fields.
function optionalNonEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

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
  SEALED_PAYLOAD_ENCRYPTION_KEY: z.string().min(1).refine((value) => {
    try {
      const decoded = Buffer.from(value, "base64");
      return decoded.length === 32 && decoded.toString("base64") === value;
    } catch {
      return false;
    }
  }, "SEALED_PAYLOAD_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),
  GOOGLE_CLIENT_ID: optionalNonEmpty(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optionalNonEmpty(z.string().min(1)),
  GOOGLE_REDIRECT_URI: optionalNonEmpty(z.url()),
  ADMIN_GOOGLE_EMAIL: z.email(),
});

export type AppConfig = ReturnType<typeof loadAppConfig>;

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
    sealedPayloadEncryptionKey: env.SEALED_PAYLOAD_ENCRYPTION_KEY,
    adminGoogleEmail: env.ADMIN_GOOGLE_EMAIL.trim().toLowerCase(),
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
