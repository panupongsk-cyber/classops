import type { FastifyInstance } from "fastify";
import * as oidc from "openid-client";

import type { AppConfig } from "../config.js";
import type { DatabasePool } from "../db.js";
import { startOAuthTransaction, upsertOAuthUser, verifyOAuthTransaction } from "../oauth-flow.js";
import { normalizeEmail } from "../security.js";
import { issueSession } from "../session.js";

// `common` accepts both organizational (work/school) and personal Microsoft accounts, matching
// Google's no-domain-lock policy — no tenant restriction. See phase1-5-product-spec.md.
const microsoftIssuer = new URL("https://login.microsoftonline.com/common/v2.0");
const callbackPath = "/api/auth/microsoft/callback";

interface MicrosoftClaims {
  // `oid` (not `sub`) is Microsoft's documented stable identifier for a user account — see
  // phase1-5-product-spec.md's "Read this first" section.
  oid?: string;
  // Microsoft has no `email_verified` claim at all, and its own docs caution against trusting
  // `email` for authorization. ClassOps trusts it anyway (see the same spec section) as the only
  // way to keep the existing invite-by-email flow working for Microsoft users — a deliberately
  // weaker guarantee than Google's, accepted as a known trade-off, not an oversight.
  email?: string;
  name?: string;
}

export async function registerMicrosoftOAuthRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;
  const microsoftOAuth = config.microsoftOAuth;
  const browserBindingCookieName = `${config.sessionCookieName}_oauth_microsoft`;

  if (!microsoftOAuth) {
    app.get("/api/auth/microsoft", async (_request, reply) =>
      reply.code(503).send({ error: "MICROSOFT_OAUTH_NOT_CONFIGURED" }),
    );
    app.get(callbackPath, async (_request, reply) =>
      reply.code(503).send({ error: "MICROSOFT_OAUTH_NOT_CONFIGURED" }),
    );
    return;
  }

  const microsoftConfigPromise = oidc.discovery(
    microsoftIssuer,
    microsoftOAuth.clientId,
    microsoftOAuth.clientSecret,
  );

  app.get(
    "/api/auth/microsoft",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (_request, reply) => {
      const client = await microsoftConfigPromise;
      const { state, nonce, codeChallenge } = await startOAuthTransaction(pool, config, reply, {
        cookieName: browserBindingCookieName,
        callbackPath,
      });

      const authorizationUrl = oidc.buildAuthorizationUrl(client, {
        redirect_uri: microsoftOAuth.redirectUri,
        // `email` requested explicitly rather than relying on default inclusion — Microsoft only
        // includes it by default for guest accounts (see phase1-5-product-spec.md).
        scope: "openid profile email",
        response_type: "code",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });

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
      const client = await microsoftConfigPromise;
      const callbackUrl = new URL(microsoftOAuth.redirectUri);
      callbackUrl.search = requestUrl.search;
      const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims() as MicrosoftClaims | undefined;
      if (!claims?.oid || !claims.email) {
        return reply.redirect(`${config.appBaseUrl}/login?oauth=unverified_email`);
      }

      const email = normalizeEmail(claims.email);
      const displayName =
        claims.name?.trim().slice(0, 100) || email.split("@")[0] || "Microsoft user";
      const result = await upsertOAuthUser(pool, {
        provider: "microsoft",
        providerSubject: claims.oid,
        email,
        displayName,
        isAdmin: email === config.adminGoogleEmail,
        auditEventType: "auth.microsoft_registered",
      });

      if (result.emailCollision) {
        return reply.redirect(`${config.appBaseUrl}/login?oauth=email_registered_elsewhere`);
      }
      await issueSession(request, reply, pool, config, result.userId);
      return reply.redirect(`${config.appBaseUrl}/login?oauth=success`);
    } catch (error) {
      request.log.warn({ err: error }, "Microsoft OAuth callback failed");
      return reply.redirect(`${config.appBaseUrl}/login?oauth=failed`);
    }
  });
}
