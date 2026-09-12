const API_BASE = "/api";
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export class GoogleConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoogleConnectionError";
  }
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (_) {
    throw new Error("Could not reach the calendar service. Check your connection and try again.");
  }

  const data = await readJson(response);
  if (!response.ok) {
    const message = data?.error || "Google Calendar request failed";
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("google-connection-expired", { detail: message }));
      throw new GoogleConnectionError(message);
    }
    throw new Error(message);
  }

  return data;
}

export async function getGoogleSession() {
  const data = await apiRequest("google-session");
  return Boolean(data?.connected);
}

export function signIn() {
  window.location.assign(`${API_BASE}/google-auth-start`);
}

export async function signOut() {
  await apiRequest("google-disconnect", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function calendarRequest(operation, payload = {}) {
  const data = await apiRequest("google-calendar", {
    method: "POST",
    body: JSON.stringify({ operation, ...payload }),
  });
  return data?.result;
}

export async function listMonthEvents({ timeMin, timeMax, calendarId = "primary" }) {
  return calendarRequest("listEvents", { timeMin, timeMax, calendarId });
}

export async function insertEvent({
  summary,
  description,
  startISO,
  endISO,
  reminders,
  colorId,
  calendarId = "primary",
}) {
  return calendarRequest("insertEvent", {
    summary,
    description,
    startISO,
    endISO,
    reminders,
    colorId,
    calendarId,
    timeZone: TIME_ZONE,
  });
}

export async function listCalendars() {
  return calendarRequest("listCalendars");
}
