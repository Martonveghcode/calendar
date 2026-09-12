# Homework Calendar

Homework Calendar is a Vite + React + Tailwind single-page app that stores lesson data locally and creates Class, Test, and Homework events in Google Calendar.

## Persistent Google connection

The app uses Google's server-side OAuth authorization-code flow. A Netlify Function stores the refresh token inside an encrypted, HttpOnly, same-site cookie and refreshes short-lived Google access tokens automatically. Google credentials and refresh tokens are never stored in browser JavaScript or committed to Git.

Required Netlify environment variables:

- `GOOGLE_CLIENT_ID`: OAuth 2.0 Web application client ID.
- `GOOGLE_CLIENT_SECRET`: secret for the same OAuth client.
- `GOOGLE_SESSION_SECRET`: a random secret of at least 32 characters used to encrypt the session cookie.

In Google Cloud Console:

1. Enable the Google Calendar API.
2. Configure the Google Auth Platform consent screen and add your Google account as a test user if the app remains in Testing.
3. Create an OAuth 2.0 Client ID of type **Web application**.
4. Add `https://glittery-blini-4c6ea4.netlify.app/api/google-auth-callback` as an authorized redirect URI.
5. For local Netlify development, optionally add `http://localhost:8888/api/google-auth-callback` too.

Apps left in Google's Testing publishing status lose Calendar refresh-token authorization after seven days. Set the app to In production for a lasting connection. Google may still show an unverified-app warning for a personal app that uses Calendar scopes.

## Local development

1. Install dependencies with `npm install`.
2. Set the three environment variables above in a local `.env` file (never commit it).
3. Run `npx netlify dev` so the frontend and OAuth functions run together.

## Build and test

```sh
npm test
npm run build
```
