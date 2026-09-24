import type { FastifyInstance } from "fastify";
import * as oidc from "openid-client";

import type { AppConfig } from "../config.js";
import type { DatabasePool } from "../db.js";
import {
  OAUTH_START_RATE_LIMIT,
  startOAuthTransaction,
  upsertOAuthUser,
  verifyOAuthTransaction,
} from "../oauth-flow.js";
import { normalizeEmail } from "../security.js";
import { issueSession } from "../session.js";

const googleIssuer = new URL("https://accounts.google.com");
const callbackPath = "/api/auth/google/callback";

interface GoogleClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export async function registerGoogleOAuthRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;
  const googleOAuth = config.googleOAuth;
  const browserBindingCookieName = `${config.sessionCookieName}_oauth_google`;

  if (!googleOAuth) {
    app.get("/api/auth/google", async (_request, reply) =>
      reply.code(503).send({ error: "GOOGLE_OAUTH_NOT_CONFIGURED" }),
    );
    app.get(callbackPath, async (_request, reply) =>
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
    { config: { rateLimit: OAUTH_START_RATE_LIMIT } },
    async (_request, reply) => {
      const client = await googleConfigPromise;
      const { state, nonce, codeChallenge } = await startOAuthTransaction(pool, config, reply, {
        cookieName: browserBindingCookieName,
        callbackPath,
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

  app.get(callbackPath, async (request, reply) => {
    const requestUrl = new URL(request.raw.url ?? "", "http://localhost");
    const state = requestUrl.searchParams.get("state");
    if (!state) return reply.redirect(`${config.appBaseUrl}/login?oauth=invalid_state`);

    const transaction = await verifyOAuthTransaction(pool, config, request, reply, state, {
      cookieName: browserBindingCookieName,
      callbackPath,
    });
    if (!transaction) return reply.redirect(`${config.appBaseUrl}/login?oauth=invalid_state`);

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
      const result = await upsertOAuthUser(pool, {
        provider: "google",
        providerSubject: claims.sub,
        email,
        displayName,
        isAdmin: email === config.adminGoogleEmail,
        auditEventType: "auth.google_registered",
      });

      if (result.emailCollision) {
        return reply.redirect(`${config.appBaseUrl}/login?oauth=email_registered_elsewhere`);
      }
      await issueSession(request, reply, pool, config, result.userId);
      return reply.redirect(`${config.appBaseUrl}/login?oauth=success`);
    } catch (error) {
      request.log.warn({ err: error }, "Google OAuth callback failed");
      return reply.redirect(`${config.appBaseUrl}/login?oauth=failed`);
    }
  });
}
