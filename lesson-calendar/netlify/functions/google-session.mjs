import {
  clearSessionCookie,
  errorResponse,
  getGoogleAccess,
  getGoogleConfig,
  jsonResponse,
  readGoogleSession,
} from "./_shared/google-auth.mjs";

export default async (request) => {
  try {
    getGoogleConfig();
    if (!readGoogleSession(request)?.refreshToken) {
      return jsonResponse({ connected: false });
    }

    const { sessionCookie } = await getGoogleAccess(request);
    return jsonResponse(
      { connected: true },
      200,
      sessionCookie ? { "Set-Cookie": sessionCookie } : {}
    );
  } catch (error) {
    const headers = error?.status === 401 ? { "Set-Cookie": clearSessionCookie(request) } : {};
    return errorResponse(error, headers);
  }
};
