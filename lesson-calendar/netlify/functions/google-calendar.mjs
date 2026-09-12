import {
  HttpError,
  assertSameOrigin,
  clearSessionCookie,
  errorResponse,
  getGoogleAccess,
  jsonResponse,
} from "./_shared/google-auth.mjs";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function requiredString(value, name, maxLength = 4096) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${name} is required.`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, `${name} is too long.`);
  }
  return value;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch (_) {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
}

async function readGoogleBody(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

function createGoogleClient(request) {
  let sessionCookie = null;
  let auth = null;

  const call = async (url, options = {}) => {
    if (!auth) {
      auth = await getGoogleAccess(request);
      sessionCookie = auth.sessionCookie || sessionCookie;
    }

    const send = (accessToken) => fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });

    let response = await send(auth.accessToken);
    if (response.status === 401) {
      auth = await getGoogleAccess(request, { forceRefresh: true });
      sessionCookie = auth.sessionCookie || sessionCookie;
      response = await send(auth.accessToken);
    }

    const data = await readGoogleBody(response);
    if (!response.ok) {
      if (response.status === 401) {
        throw new HttpError(401, "Your Google connection expired or was revoked. Please connect again.");
      }
      throw new HttpError(response.status >= 500 ? 502 : response.status, data?.error?.message || "Google Calendar rejected the request.");
    }
    return data;
  };

  return {
    call,
    getSessionCookie: () => sessionCookie,
  };
}

async function listEvents(client, payload) {
  const calendarId = requiredString(payload.calendarId || "primary", "calendarId", 1024);
  const timeMin = requiredString(payload.timeMin, "timeMin", 128);
  const timeMax = requiredString(payload.timeMax, "timeMax", 128);
  const query = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: "2500",
    showDeleted: "false",
  });
  const data = await client.call(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
  return data?.items || [];
}

async function insertEvent(client, payload) {
  const calendarId = requiredString(payload.calendarId || "primary", "calendarId", 1024);
  const summary = requiredString(payload.summary, "summary", 1024);
  const startISO = requiredString(payload.startISO, "startISO", 128);
  const endISO = requiredString(payload.endISO, "endISO", 128);
  const timeZone = requiredString(payload.timeZone, "timeZone", 128);

  if (Number.isNaN(Date.parse(startISO)) || Number.isNaN(Date.parse(endISO))) {
    throw new HttpError(400, "Event dates must be valid ISO date strings.");
  }
  if (Date.parse(endISO) <= Date.parse(startISO)) {
    throw new HttpError(400, "The event end time must be after its start time.");
  }

  const reminders = Array.isArray(payload.reminders)
    ? payload.reminders
        .filter((reminder) => reminder && ["email", "popup"].includes(reminder.method))
        .map((reminder) => ({ method: reminder.method, minutes: Number(reminder.minutes) }))
        .filter((reminder) => Number.isInteger(reminder.minutes) && reminder.minutes >= 0 && reminder.minutes <= 40320)
        .slice(0, 5)
    : [];

  const resource = {
    summary,
    description: typeof payload.description === "string" ? payload.description.slice(0, 8192) : "",
    start: { dateTime: startISO, timeZone },
    end: { dateTime: endISO, timeZone },
    ...(payload.colorId ? { colorId: String(payload.colorId) } : {}),
    ...(reminders.length ? { reminders: { useDefault: false, overrides: reminders } } : {}),
  };

  return client.call(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resource),
  });
}

async function listCalendars(client) {
  const calendars = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({
      maxResults: "250",
      showDeleted: "false",
      minAccessRole: "reader",
      ...(pageToken ? { pageToken } : {}),
    });
    const data = await client.call(`${CALENDAR_API}/users/me/calendarList?${query}`);
    calendars.push(...(data?.items || []));
    pageToken = data?.nextPageToken || "";
  } while (pageToken);

  return calendars;
}

export default async (request) => {
  try {
    if (request.method !== "POST") {
      throw new HttpError(405, "Method not allowed.");
    }
    assertSameOrigin(request);

    const payload = await readBody(request);
    const client = createGoogleClient(request);
    let result;

    switch (payload.operation) {
      case "listEvents":
        result = await listEvents(client, payload);
        break;
      case "insertEvent":
        result = await insertEvent(client, payload);
        break;
      case "listCalendars":
        result = await listCalendars(client);
        break;
      default:
        throw new HttpError(400, "Unknown calendar operation.");
    }

    const sessionCookie = client.getSessionCookie();
    return jsonResponse({ result }, 200, sessionCookie ? { "Set-Cookie": sessionCookie } : {});
  } catch (error) {
    const headers = error?.status === 401 ? { "Set-Cookie": clearSessionCookie(request) } : {};
    return errorResponse(error, headers);
  }
};
