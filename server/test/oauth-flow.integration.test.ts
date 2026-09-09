import assert from "node:assert/strict";
import test from "node:test";

import { createDatabasePool } from "../src/db.js";
import { upsertOAuthUser } from "../src/oauth-flow.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

// Exercises upsertOAuthUser directly against real PostgreSQL rather than driving the full OIDC
// handshake through HTTP — this is the exact logic phase1-5-qa-spec.md's fresh/repeat sign-in and
// email-collision tests care about; mocking openid-client's discovery/token exchange to reach it
// via HTTP would add real complexity for no additional coverage of what's actually at risk here.
//
// This TRUNCATEs shared tables against TEST_DATABASE_URL, same as
// courses-sections-memberships.integration.test.ts — both rely on `npm test`'s
// --test-concurrency=1 (see package.json) so their TRUNCATE/insert cycles never race against each
// other on the one real database. Do not remove that flag without giving DB-backed test files
// another way to avoid trampling each other's data.
test(
  "upsertOAuthUser: fresh sign-in, repeat sign-in, admin bootstrap, and no cross-provider linking",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, memberships, sections, courses, oauth_transactions, sessions,
                auth_identities, users
       RESTART IDENTITY CASCADE`,
    );

    try {
      // Fresh Google sign-in creates a new user.
      const googleFirst = await upsertOAuthUser(pool, {
        provider: "google",
        providerSubject: "google-sub-1",
        email: "alex@example.com",
        displayName: "Alex",
        isAdmin: false,
        auditEventType: "auth.google_registered",
      });
      assert.equal(googleFirst.emailCollision, false);
      assert.ok(googleFirst.userId);

      // Repeat Google sign-in with the same subject reuses the row, no duplicate.
      const googleRepeat = await upsertOAuthUser(pool, {
        provider: "google",
        providerSubject: "google-sub-1",
        email: "alex@example.com",
        displayName: "Alex Updated",
        isAdmin: false,
        auditEventType: "auth.google_registered",
      });
      assert.equal(googleRepeat.userId, googleFirst.userId);
      const userCount = await pool.query("SELECT count(*)::int AS count FROM users");
      assert.equal(userCount.rows[0]?.count, 1);

      // A fresh Microsoft sign-in with a *different* email creates its own separate user.
      const microsoftFresh = await upsertOAuthUser(pool, {
        provider: "microsoft",
        providerSubject: "ms-oid-1",
        email: "sam@example.com",
        displayName: "Sam",
        isAdmin: false,
        auditEventType: "auth.microsoft_registered",
      });
      assert.equal(microsoftFresh.emailCollision, false);
      assert.notEqual(microsoftFresh.userId, googleFirst.userId);

      // A Microsoft sign-in whose email collides with the existing Google user is rejected, not
      // linked — no new user or identity row, the existing Google user is untouched.
      const microsoftCollision = await upsertOAuthUser(pool, {
        provider: "microsoft",
        providerSubject: "ms-oid-collides-with-alex",
        email: "alex@example.com",
        displayName: "Alex via Microsoft",
        isAdmin: false,
        auditEventType: "auth.microsoft_registered",
      });
      assert.equal(microsoftCollision.emailCollision, true);
      assert.equal(microsoftCollision.userId, "");
      const alexIdentities = await pool.query(
        "SELECT provider FROM auth_identities WHERE user_id = $1",
        [googleFirst.userId],
      );
      assert.deepEqual(
        alexIdentities.rows.map((row) => row.provider).sort(),
        ["google"],
      );
      const alexRow = await pool.query("SELECT display_name FROM users WHERE id = $1", [
        googleFirst.userId,
      ]);
      assert.equal(alexRow.rows[0]?.display_name, "Alex Updated"); // untouched by the collision

      // The reverse: a Google sign-in whose email collides with the existing Microsoft user
      // (Sam) is rejected the same way.
      const googleCollision = await upsertOAuthUser(pool, {
        provider: "google",
        providerSubject: "google-sub-collides-with-sam",
        email: "sam@example.com",
        displayName: "Sam via Google",
        isAdmin: false,
        auditEventType: "auth.google_registered",
      });
      assert.equal(googleCollision.emailCollision, true);
      assert.equal(googleCollision.userId, "");

      // Admin bootstrap: isAdmin flows through identically regardless of provider.
      const microsoftAdmin = await upsertOAuthUser(pool, {
        provider: "microsoft",
        providerSubject: "ms-oid-admin",
        email: "admin@example.com",
        displayName: "Admin",
        isAdmin: true,
        auditEventType: "auth.microsoft_registered",
      });
      const adminRow = await pool.query("SELECT is_platform_admin FROM users WHERE id = $1", [
        microsoftAdmin.userId,
      ]);
      assert.equal(adminRow.rows[0]?.is_platform_admin, true);

      // Total user count: alex, sam, admin — the two collision attempts created nothing.
      const finalUserCount = await pool.query("SELECT count(*)::int AS count FROM users");
      assert.equal(finalUserCount.rows[0]?.count, 3);
    } finally {
      await pool.end();
    }
  },
);
