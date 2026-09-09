import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import * as oidc from "openid-client";

import type { AppConfig } from "./config.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";
import { generateOpaqueToken, hashToken } from "./security.js";
import { decryptPayload, encryptPayload } from "./sealed-payload.js";

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

interface OAuthTransactionContext {
  nonce: string;
  codeVerifier: string;
  browserBindingHash: string;
}

function browserBindingCookieOptions(config: AppConfig, callbackPath: string) {
  return {
    path: callbackPath,
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax" as const,
  };
}

/**
 * Starts a new OAuth authorization-code+PKCE transaction: generates state/nonce/PKCE verifier,
 * seals them (plus a browser-binding hash) into `oauth_transactions`, and sets the browser-binding
 * cookie on the reply. `cookieName` and `callbackPath` are provider-specific so two providers'
 * flows started in the same browser session never collide with each other.
 */
export async function startOAuthTransaction(
  pool: DatabasePool,
  config: AppConfig,
  reply: FastifyReply,
  options: { cookieName: string; callbackPath: string },
) {
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
      encryptPayload(
        { nonce, codeVerifier, browserBindingHash: hashToken(browserBinding) },
        config.sealedPayloadEncryptionKey,
      ),
    ],
  );
  reply.setCookie(options.cookieName, browserBinding, {
    ...browserBindingCookieOptions(config, options.callbackPath),
    maxAge: 10 * 60,
  });

  return { state, nonce, codeChallenge, codeVerifier };
}

/**
 * Verifies and consumes an OAuth callback's `state`: looks up the sealed transaction, marks it
 * used, and checks the browser-binding cookie. Returns `null` if anything doesn't check out — the
 * caller should treat every failure identically (redirect to the same generic error) rather than
 * distinguishing reasons, so a would-be attacker can't use error specificity to narrow down what
 * they got wrong.
 */
export async function verifyOAuthTransaction(
  pool: DatabasePool,
  config: AppConfig,
  request: FastifyRequest,
  reply: FastifyReply,
  state: string,
  options: { cookieName: string; callbackPath: string },
): Promise<OAuthTransactionContext | null> {
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
    return decryptPayload(
      row.sealed_context,
      config.sealedPayloadEncryptionKey,
    ) as unknown as OAuthTransactionContext;
  });
  if (!transaction) return null;

  const browserBinding = request.cookies[options.cookieName];
  reply.clearCookie(options.cookieName, browserBindingCookieOptions(config, options.callbackPath));
  if (!oauthBrowserBindingMatches(browserBinding, transaction.browserBindingHash)) {
    return null;
  }
  return transaction;
}

export interface OAuthUserResult {
  userId: string;
  /** True if `email` already belongs to a *different* provider identity — the sign-in was
   * rejected, not linked. See phase1-5-product-spec.md: ClassOps never auto-links providers. */
  emailCollision: boolean;
}

/**
 * Finds-or-creates the `users`/`auth_identities` rows for a verified OAuth identity. Never links
 * across providers: if `email` already belongs to a user this `(provider, providerSubject)` pair
 * doesn't own, the sign-in is rejected (`emailCollision: true`) rather than merged.
 */
export async function upsertOAuthUser(
  pool: DatabasePool,
  options: {
    provider: string;
    providerSubject: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
    auditEventType: string;
  },
): Promise<OAuthUserResult> {
  return withTransaction(pool, async (databaseClient: DatabaseClient) => {
    const existingIdentity = await databaseClient.query<{ user_id: string }>(
      `SELECT user_id FROM auth_identities
       WHERE provider = $1 AND provider_subject = $2
       FOR UPDATE`,
      [options.provider, options.providerSubject],
    );
    const existingUserId = existingIdentity.rows[0]?.user_id;
    if (existingUserId) {
      await databaseClient.query(
        `UPDATE users
         SET email = $2, display_name = $3, email_verified_at = COALESCE(email_verified_at, now()),
             is_platform_admin = $4, updated_at = now()
         WHERE id = $1`,
        [existingUserId, options.email, options.displayName, options.isAdmin],
      );
      return { userId: existingUserId, emailCollision: false };
    }

    const emailOwner = await databaseClient.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 FOR UPDATE",
      [options.email],
    );
    if (emailOwner.rowCount) {
      return { userId: "", emailCollision: true };
    }

    const inserted = await databaseClient.query<{ id: string }>(
      `INSERT INTO users (email, display_name, status, email_verified_at, is_platform_admin)
       VALUES ($1, $2, 'active', now(), $3)
       RETURNING id`,
      [options.email, options.displayName, options.isAdmin],
    );
    const userId = inserted.rows[0]?.id;
    if (!userId) throw new Error(`${options.provider} user insert did not return an id`);
    await databaseClient.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject)
       VALUES ($1, $2, $3)`,
      [userId, options.provider, options.providerSubject],
    );
    await databaseClient.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id)
       VALUES ($1::uuid, $2, 'user', $1::uuid::text)`,
      [userId, options.auditEventType],
    );
    return { userId, emailCollision: false };
  });
}
