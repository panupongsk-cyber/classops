import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance } from "fastify";
import * as oidc from "openid-client";

import type { AppConfig } from "../config.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { decryptMailPayload, encryptMailPayload } from "../email/payload-crypto.js";
import { generateOpaqueToken, hashToken, normalizeEmail } from "../security.js";
import { issueSession } from "../session.js";

const googleIssuer = new URL("https://accounts.google.com");

interface GoogleClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export function oauthBrowserBindingMatches(
  browserBinding: string | undefined,
  expectedBindingHash: unknown,
) {
  if (!browserBinding || typeof expectedBindingHash !== "string") return false;
  const actualBindingHash = hashToken(browserBinding);
  return (
    actualBindingHash.length === expectedBindingHash.length &&
    timingSafeEqual(Buffer.from(actualBindingHash), Buffer.from(expectedBindingHash))
  );
}

export async function registerGoogleOAuthRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;
  const googleOAuth = config.googleOAuth;
  const browserBindingCookieName = `${config.sessionCookieName}_oauth`;
  const browserBindingCookieOptions = {
    path: "/api/auth/google/callback",
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax" as const,
  };

  if (!googleOAuth) {
    app.get("/api/auth/google", async (_request, reply) =>
      reply.code(503).send({ error: "GOOGLE_OAUTH_NOT_CONFIGURED" }),
    );
    app.get("/api/auth/google/callback", async (_request, reply) =>
      reply.code(503).send({ error: "GOOGLE_OAUTH_NOT_CONFIGURED" }),
    );
    return;
  }

  const googleConfigPromise = oidc.discovery(
    googleIssuer,
    googleOAuth.clientId,
    googleOAuth.clientSecret,
  );

  app.get(
    "/api/auth/google",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (_request, reply) => {
      const client = await googleConfigPromise;
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const browserBinding = generateOpaqueToken();
      await pool.query(
        `DELETE FROM oauth_transactions
         WHERE expires_at < now() - interval '1 day'
            OR used_at < now() - interval '1 day'`,
      );
      await pool.query(
        `INSERT INTO oauth_transactions (state_hash, sealed_context, expires_at)
         VALUES ($1, $2, now() + interval '10 minutes')`,
        [
          hashToken(state),
          encryptMailPayload(
            { nonce, codeVerifier, browserBindingHash: hashToken(browserBinding) },
            config.outboxEncryptionKey,
          ),
        ],
      );
      reply.setCookie(browserBindingCookieName, browserBinding, {
        ...browserBindingCookieOptions,
        maxAge: 10 * 60,
      });

      const authorizationUrl = oidc.buildAuthorizationUrl(client, {
        redirect_uri: googleOAuth.redirectUri,
        scope: "openid email profile",
        response_type: "code",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });

      // Deliberately no `hd` parameter: ClassOps accepts any Google account.
      return reply.redirect(authorizationUrl.href);
    },
  );

  app.get("/api/auth/google/callback", async (request, reply) => {
    const requestUrl = new URL(request.raw.url ?? "", "http://localhost");
    const state = requestUrl.searchParams.get("state");
    if (!state) return reply.redirect(`${config.appBaseUrl}/login?oauth=invalid_state`);

    const transaction = await withTransaction(pool, async (databaseClient) => {
      const result = await databaseClient.query<{ id: string; sealed_context: string }>(
        `SELECT id, sealed_context
         FROM oauth_transactions
         WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(state)],
      );
      const row = result.rows[0];
      if (!row) return null;
      await databaseClient.query("UPDATE oauth_transactions SET used_at = now() WHERE id = $1", [
        row.id,
      ]);
      return decryptMailPayload(row.sealed_context, config.outboxEncryptionKey) as {
        nonce: string;
        codeVerifier: string;
        browserBindingHash: string;
      };
    });
    if (!transaction) return reply.redirect(`${config.appBaseUrl}/login?oauth=invalid_state`);

    const browserBinding = request.cookies[browserBindingCookieName];
    reply.clearCookie(browserBindingCookieName, browserBindingCookieOptions);
    if (!oauthBrowserBindingMatches(browserBinding, transaction.browserBindingHash)) {
      return reply.redirect(`${config.appBaseUrl}/login?oauth=invalid_state`);
    }

    try {
      const client = await googleConfigPromise;
      const callbackUrl = new URL(googleOAuth.redirectUri);
      callbackUrl.search = requestUrl.search;
      const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims() as GoogleClaims | undefined;
      if (!claims?.sub || !claims.email || claims.email_verified !== true) {
        return reply.redirect(`${config.appBaseUrl}/login?oauth=unverified_email`);
      }

      const email = normalizeEmail(claims.email);
      const displayName = claims.name?.trim().slice(0, 100) || email.split("@")[0] || "Google user";
      const result = await withTransaction(pool, async (databaseClient) => {
        const existingIdentity = await databaseClient.query<{ user_id: string }>(
          `SELECT user_id FROM auth_identities
           WHERE provider = 'google' AND provider_subject = $1
           FOR UPDATE`,
          [claims.sub],
        );
        const existingUserId = existingIdentity.rows[0]?.user_id;
        if (existingUserId) {
          await databaseClient.query(
            `UPDATE users
             SET email = $2, display_name = $3, email_verified_at = COALESCE(email_verified_at, now()),
                 status = CASE WHEN status = 'pending_verification' THEN 'active' ELSE status END,
                 updated_at = now()
             WHERE id = $1`,
            [existingUserId, email, displayName],
          );
          return { userId: existingUserId, linkRequired: false };
        }

        const emailOwner = await databaseClient.query<{ id: string }>(
          "SELECT id FROM users WHERE email = $1 FOR UPDATE",
          [email],
        );
        if (emailOwner.rowCount) {
          return { userId: "", linkRequired: true };
        }

        const inserted = await databaseClient.query<{ id: string }>(
          `INSERT INTO users (email, display_name, status, email_verified_at)
           VALUES ($1, $2, 'active', now())
           RETURNING id`,
          [email, displayName],
        );
        const userId = inserted.rows[0]?.id;
        if (!userId) throw new Error("Google user insert did not return an id");
        await databaseClient.query(
          `INSERT INTO auth_identities (user_id, provider, provider_subject)
           VALUES ($1, 'google', $2)`,
          [userId, claims.sub],
        );
        await databaseClient.query(
          `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id)
           VALUES ($1::uuid, 'auth.google_registered', 'user', $1::uuid::text)`,
          [userId],
        );
        return { userId, linkRequired: false };
      });

      if (result.linkRequired) {
        return reply.redirect(`${config.appBaseUrl}/login?oauth=account_link_required`);
      }
      await issueSession(request, reply, pool, config, result.userId);
      return reply.redirect(`${config.appBaseUrl}/login?oauth=success`);
    } catch (error) {
      request.log.warn({ err: error }, "Google OAuth callback failed");
      return reply.redirect(`${config.appBaseUrl}/login?oauth=failed`);
    }
  });
}
