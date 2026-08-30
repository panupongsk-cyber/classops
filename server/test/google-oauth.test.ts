import assert from "node:assert/strict";
import test from "node:test";

import { oauthBrowserBindingMatches } from "../src/routes/google-oauth.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";

test("OAuth browser binding accepts only the browser that started the flow", () => {
  const browserBinding = generateOpaqueToken();
  const expectedHash = hashToken(browserBinding);

  assert.equal(oauthBrowserBindingMatches(browserBinding, expectedHash), true);
  assert.equal(oauthBrowserBindingMatches(undefined, expectedHash), false);
  assert.equal(oauthBrowserBindingMatches(generateOpaqueToken(), expectedHash), false);
  assert.equal(oauthBrowserBindingMatches(browserBinding, undefined), false);
});
