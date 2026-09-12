import {
  HttpError,
  assertSameOrigin,
  clearSessionCookie,
  errorResponse,
  jsonResponse,
  readGoogleSession,
} from "./_shared/google-auth.mjs";

export default async (request) => {
  try {
    if (request.method !== "POST") {
      throw new HttpError(405, "Method not allowed.");
    }
    assertSameOrigin(request);

    const session = readGoogleSession(request);
    const token = session?.refreshToken || session?.accessToken;
    if (token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch (error) {
        console.warn("Google token revocation failed", error);
      }
    }

    return jsonResponse({ disconnected: true }, 200, {
      "Set-Cookie": clearSessionCookie(request),
    });
  } catch (error) {
    return errorResponse(error);
  }
};
