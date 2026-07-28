import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  expiredSessionCookie,
  readSessionToken,
  sessionCookie,
} from "./session-cookie";

describe("session cookie", () => {
  it("uses an HTTP-only cookie and requires HTTPS in production", () => {
    const cookie = sessionCookie("opaque-token", {
      NODE_ENV: "production",
      AUTH_SESSION_TTL_HOURS: 168,
    });

    assert.match(cookie, /^mensaly_session=opaque-token;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Max-Age=604800/);
  });

  it("reads and clears only the dedicated session cookie", () => {
    assert.equal(
      readSessionToken("theme=dark; mensaly_session=opaque-token; language=pt-BR"),
      "opaque-token",
    );
    assert.equal(readSessionToken(undefined), undefined);
    assert.match(
      expiredSessionCookie({ NODE_ENV: "test", AUTH_SESSION_TTL_HOURS: 168 }),
      /Max-Age=0/,
    );
  });
});
