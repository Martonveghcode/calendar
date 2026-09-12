import {
  STATE_COOKIE,
  clearStateCookie,
  exchangeAuthorizationCode,
  makeSessionCookie,
  parseCookies,
  stateMatches,
} from "./_shared/google-auth.mjs";

function appRedirect(request, result) {
  const url = new URL("/", request.url);
  url.searchParams.set("google", result);
  return url.toString();
}

export default async (request) => {
  const url = new URL(request.url);
  const cookies = parseCookies(request);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (url.searchParams.has("error") || !code || !stateMatches(cookies[STATE_COOKIE], state)) {
    return new Response(null, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
        Location: appRedirect(request, "error"),
        "Set-Cookie": clearStateCookie(request),
      },
    });
  }

  try {
    const session = await exchangeAuthorizationCode(request, code);
    const headers = new Headers({
      "Cache-Control": "no-store",
      Location: appRedirect(request, "connected"),
    });
    headers.append("Set-Cookie", clearStateCookie(request));
    headers.append("Set-Cookie", makeSessionCookie(request, session));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error(error);
    return new Response(null, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
        Location: appRedirect(request, "error"),
        "Set-Cookie": clearStateCookie(request),
      },
    });
  }
};
