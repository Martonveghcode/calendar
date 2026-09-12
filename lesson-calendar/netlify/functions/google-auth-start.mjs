import { randomBytes } from "node:crypto";
import {
  GOOGLE_SCOPES,
  errorResponse,
  getGoogleConfig,
  getRedirectUri,
  makeStateCookie,
} from "./_shared/google-auth.mjs";

export default async (request) => {
  try {
    const { clientId } = getGoogleConfig();
    const state = randomBytes(32).toString("base64url");
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getRedirectUri(request),
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();

    return new Response(null, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
        Location: authorizationUrl.toString(),
        "Set-Cookie": makeStateCookie(request, state),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
