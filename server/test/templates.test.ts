import assert from "node:assert/strict";
import test from "node:test";

import { renderMailTemplate } from "../src/email/templates.js";

test("renders a verification email without exposing unsafe HTML", () => {
  const rendered = renderMailTemplate("verify_email", {
    actionUrl: "https://classops.pshomelab.dev/verify-email?token=abc&next=%3Cscript%3E",
    expiryMinutes: 60,
  });
  assert.match(rendered.subject, /ClassOps/);
  assert.match(rendered.text, /60/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&amp;/);
});

test("rejects action links outside trusted schemes", () => {
  assert.throws(
    () =>
      renderMailTemplate("reset_password", {
        actionUrl: "javascript:alert(1)",
        expiryMinutes: 30,
      }),
    /not trusted/,
  );
});
