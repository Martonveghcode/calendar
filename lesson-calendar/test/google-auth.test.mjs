import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_COOKIE,
  makeSessionCookie,
  openSession,
  parseCookies,
  sealSession,
  stateMatches,
} from "../netlify/functions/_shared/google-auth.mjs";

process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";

test("encrypted Google sessions round-trip without exposing token values", () => {
  const session = {
    refreshToken: "refresh-token-value",
    accessToken: "access-token-value",
    expiresAt: 123456789,
  };
  const sealed = sealSession(session);

  assert.deepEqual(openSession(sealed), session);
  assert.equal(sealed.includes(session.refreshToken), false);
  assert.equal(sealed.includes(session.accessToken), false);
});

test("tampered session cookies are rejected", () => {
  const sealed = sealSession({ refreshToken: "refresh" });
  const tampered = `${sealed.slice(0, -1)}${sealed.endsWith("a") ? "b" : "a"}`;
  assert.equal(openSession(tampered), null);
});

test("cookies are parsed and production sessions are secure", () => {
  const request = new Request("https://example.com/api/google-session", {
    headers: { cookie: "one=1; two=hello=world" },
  });
  assert.deepEqual(parseCookies(request), { one: "1", two: "hello=world" });

  const cookie = makeSessionCookie(request, { refreshToken: "refresh" });
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test("OAuth state comparison requires exact values", () => {
  assert.equal(stateMatches("same", "same"), true);
  assert.equal(stateMatches("same", "different"), false);
  assert.equal(stateMatches("", ""), false);
});
