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
  MICROSOFT_CLIENT_ID: optionalNonEmpty(z.string().min(1)),
  MICROSOFT_CLIENT_SECRET: optionalNonEmpty(z.string().min(1)),
  MICROSOFT_REDIRECT_URI: optionalNonEmpty(z.url()),
  ADMIN_GOOGLE_EMAIL: z.email(),
});

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Each provider's three values (client ID, secret, redirect URI) must be configured together or
// not at all — a partially-configured provider is almost certainly a deployment mistake, not an
// intentionally-disabled one, so it fails loudly rather than silently disabling the provider.
function resolveOAuthConfig(
  providerName: string,
  clientId: string | undefined,
  clientSecret: string | undefined,
  redirectUri: string | undefined,
): OAuthClientConfig | null {
  const values = [clientId, clientSecret, redirectUri];
  const configuredCount = values.filter(Boolean).length;
  if (configuredCount === 0) return null;
  if (configuredCount !== values.length) {
    throw new Error(
      `${providerName}_CLIENT_ID, ${providerName}_CLIENT_SECRET, and ${providerName}_REDIRECT_URI must be configured together`,
    );
  }
  return { clientId: clientId as string, clientSecret: clientSecret as string, redirectUri: redirectUri as string };
}

export type AppConfig = ReturnType<typeof loadAppConfig>;

export function loadAppConfig() {
  const env = baseSchema.parse(process.env);
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
    googleOAuth: resolveOAuthConfig(
      "GOOGLE",
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    ),
    microsoftOAuth: resolveOAuthConfig(
      "MICROSOFT",
      env.MICROSOFT_CLIENT_ID,
      env.MICROSOFT_CLIENT_SECRET,
      env.MICROSOFT_REDIRECT_URI,
    ),
  } as const;
}
