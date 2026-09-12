import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "hwcal_google_session";
export const STATE_COOKIE = "hwcal_google_oauth_state";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function errorResponse(error, extraHeaders = {}) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : "The Google service is temporarily unavailable.";
  if (!(error instanceof HttpError)) {
    console.error(error);
  }
  return jsonResponse({ error: message }, status, extraHeaders);
}

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const sessionSecret = process.env.GOOGLE_SESSION_SECRET?.trim();

  if (!clientId || !clientSecret || !sessionSecret) {
    throw new HttpError(503, "Google connection is not configured on Netlify yet.");
  }
  if (sessionSecret.length < 32) {
    throw new HttpError(503, "The Google session secret must be at least 32 characters.");
  }

  return { clientId, clientSecret, sessionSecret };
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return header.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

function sessionKey() {
  const { sessionSecret } = getGoogleConfig();
  return createHash("sha256").update(sessionSecret).digest();
}

export function sealSession(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function openSession(value) {
  if (!value) return null;
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const session = JSON.parse(plaintext.toString("utf8"));
    return session && typeof session === "object" ? session : null;
  } catch (_) {
    return null;
  }
}

function cookieSecurity(request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function makeSessionCookie(request, session) {
  return `${SESSION_COOKIE}=${sealSession(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${cookieSecurity(request)}`;
}

export function clearSessionCookie(request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecurity(request)}`;
}

export function makeStateCookie(request, state) {
  return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${cookieSecurity(request)}`;
}

export function clearStateCookie(request) {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecurity(request)}`;
}

export function getRedirectUri(request) {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || new URL("/api/google-auth-callback", request.url).toString();
}

export function stateMatches(expected, actual) {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertSameOrigin(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== requestOrigin) || fetchSite === "cross-site") {
    throw new HttpError(403, "Cross-site request blocked.");
  }
}

async function readGoogleError(response) {
  try {
    const data = await response.json();
    return data?.error_description || data?.error?.message || data?.error || "Google rejected the request.";
  } catch (_) {
    return "Google rejected the request.";
  }
}

export async function exchangeAuthorizationCode(request, code) {
  const { clientId, clientSecret } = getGoogleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(request),
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new HttpError(502, await readGoogleError(response));
  }

  const tokens = await response.json();
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new HttpError(502, "Google did not return a refresh token. Remove the app from your Google Account connections, then connect again.");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  };
}

export function readGoogleSession(request) {
  return openSession(parseCookies(request)[SESSION_COOKIE]);
}

export async function getGoogleAccess(request, { forceRefresh = false } = {}) {
  const { clientId, clientSecret } = getGoogleConfig();
  const session = readGoogleSession(request);
  if (!session?.refreshToken) {
    throw new HttpError(401, "Connect Google Calendar to continue.");
  }

  if (!forceRefresh && session.accessToken && Number(session.expiresAt) > Date.now() + 60_000) {
    return { accessToken: session.accessToken, sessionCookie: null };
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: session.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new HttpError(401, "Your Google connection expired or was revoked. Please connect again.");
  }

  const tokens = await response.json();
  if (!tokens.access_token) {
    throw new HttpError(401, "Google did not renew the connection. Please connect again.");
  }

  const refreshedSession = {
    ...session,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  };

  return {
    accessToken: refreshedSession.accessToken,
    sessionCookie: makeSessionCookie(request, refreshedSession),
  };
}
