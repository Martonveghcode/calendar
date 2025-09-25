import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  LogIn,
  LogOut,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  loadGoogle,
  signIn,
  signOut,
  listMonthEvents,
  insertEvent,
} from "./lib/google";
import {
  getCfg,
  setCfg,
  getLessons,
  setLessons,
  getPrefs,
  setPrefs,
} from "./lib/storage";
import { clsx, uid, WEEKDAYS } from "./lib/ui";

const EVENT_TYPES = [
  { value: "class", label: "Class" },
  { value: "test", label: "Test" },
  { value: "homework", label: "Homework" },
];

const REMINDER_TIMES = [
  { value: "16:00", label: "4:00 PM" },
  { value: "22:00", label: "10:00 PM" },
];

const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const DEFAULT_THEME = {
  background: "#020617",
  surface: "#0f172a",
  border: "#334155",
  accent: "#0ea5e9",
  text: "#e2e8f0",
};

const defaultPrefs = () => ({
  monthCursor: dayjs().startOf("month").format("YYYY-MM-DD"),
  theme: { ...DEFAULT_THEME },
});

const hydratePrefs = (stored) => {
  const base = defaultPrefs();
  if (!stored) {
    return base;
  }
  return {
    ...base,
    ...stored,
    theme: {
      ...DEFAULT_THEME,
      ...(stored.theme || {}),
    },
  };
};

function generateUpcomingDates(slot, count = 12) {
  if (!slot) return [];
  const now = dayjs();
  const startOfToday = now.startOf("day");
  const weekday = Number(slot.weekday);
  if (Number.isNaN(weekday)) return [];
  const [hour, minute] = slot.start.split(":").map(Number);
  let firstCandidate = startOfToday.add((weekday - startOfToday.day() + 7) % 7, "day");
  let firstDate = firstCandidate
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);
  if (firstDate.isBefore(now)) {
    firstCandidate = firstCandidate.add(7, "day");
    firstDate = firstCandidate
      .hour(hour)
      .minute(minute)
      .second(0)
      .millisecond(0);
  }
  const dates = [];
  for (let index = 0; index < count; index += 1) {
    dates.push(firstDate.add(index * 7, "day"));
  }
  return dates;
}

function formatDateOption(dateInstance) {
  return dateInstance.format("ddd, MMM D, YYYY");
}
export default function App() {
  const [cfg, setCfgState] = useState(() => getCfg());
  const [setupOpen, setSetupOpen] = useState(() => {
    const stored = getCfg();
    return !stored?.clientId || !stored?.apiKey;
  });
  const [lessons, setLessonsState] = useState(() => getLessons());
  const [prefs, setPrefsState] = useState(() => hydratePrefs(getPrefs()));
  const [editingLesson, setEditingLesson] = useState(null);

  const [googleReady, setGoogleReady] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const [calendarEvents, setCalendarEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");

  const [eventFeedback, setEventFeedback] = useState(null);
  const [eventSubmitting, setEventSubmitting] = useState(false);

  const theme = useMemo(() => ({ ...DEFAULT_THEME, ...(prefs?.theme || {}) }), [prefs?.theme]);

  const updatePrefs = useCallback((updater) => {
    setPrefsState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return hydratePrefs(next);
    });
  }, []);

  const month = useMemo(() => {
    const cursor = prefs?.monthCursor || dayjs().startOf("month").format("YYYY-MM-DD");
    return dayjs(cursor).startOf("month");
  }, [prefs]);

  const sortedLessons = useMemo(() => {
    return [...lessons].sort((a, b) => a.name.localeCompare(b.name));
  }, [lessons]);

  useEffect(() => {
    setCfg(cfg);
  }, [cfg]);

  useEffect(() => {
    setLessons(lessons);
  }, [lessons]);

  useEffect(() => {
    setPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme).forEach(([key, value]) => {
      root.style.setProperty(`--theme-${key}`, value);
    });
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    if (cfg?.clientId && cfg?.apiKey) {
      setGoogleLoading(true);
      setGoogleError("");
      loadGoogle(cfg)
        .then(() => {
          if (!cancelled) {
            setGoogleReady(true);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setGoogleError(error.message || "Failed to load Google libraries");
            setGoogleReady(false);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setGoogleLoading(false);
          }
        });
    } else {
      setGoogleReady(false);
    }
    return () => {
      cancelled = true;
    };
  }, [cfg]);

  useEffect(() => {
    if (!cfg?.clientId || !cfg?.apiKey) {
      try {
        signOut();
      } catch (_) {
        /* ignore */
      }
      setConnected(false);
      setCalendarEvents([]);
    }
  }, [cfg]);

  const changeMonth = useCallback(
    (delta) => {
      updatePrefs((prev) => {
        const current = dayjs(prev?.monthCursor || dayjs().startOf("month"));
        const next = current.add(delta, "month").startOf("month");
        return { ...prev, monthCursor: next.format("YYYY-MM-DD") };
      });
    },
    [updatePrefs]
  );

  const refreshEvents = useCallback(
    async (force = false) => {
      if (!googleReady || (!connected && !force)) return;
      setEventsLoading(true);
      setEventsError("");
      try {
        const rangeStart = month.startOf("month").startOf("week");
        const rangeEnd = month.endOf("month").endOf("week");
        const items = await listMonthEvents({
          timeMin: rangeStart.toISOString(),
          timeMax: rangeEnd.toISOString(),
        });
        const mapped = (items || []).map((item) => {
          const startISO = item.start.dateTime || item.start.date;
          const endISO = item.end?.dateTime || item.end?.date || startISO;
          return {
            id: item.id,
            summary: item.summary || "(No title)",
            description: item.description || "",
            startISO,
            endISO,
            isAllDay: !item.start.dateTime,
          };
        });
        mapped.sort((a, b) => dayjs(a.startISO).valueOf() - dayjs(b.startISO).valueOf());
        setCalendarEvents(mapped);
      } catch (error) {
        setEventsError(error.message || "Failed to load calendar events");
      } finally {
        setEventsLoading(false);
      }
    },
    [connected, googleReady, month]
  );

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  useEffect(() => {
    if (!eventFeedback) return;
    const timer = window.setTimeout(() => setEventFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [eventFeedback]);

  const connectGoogle = useCallback(async () => {
    if (!googleReady) {
      setGoogleError("Add your Google API credentials first");
      setSetupOpen(true);
      return;
    }
    setConnecting(true);
    setGoogleError("");
    try {
      await signIn();
      setConnected(true);
      refreshEvents(true);
    } catch (error) {
      setGoogleError(error.message || "Failed to connect to Google Calendar");
    } finally {
      setConnecting(false);
    }
  }, [googleReady, refreshEvents]);

  const handleDisconnect = () => {
    try {
      signOut();
    } catch (_) {
      /* ignore */
    }
    setConnected(false);
    setCalendarEvents([]);
  };

  const handleSaveCfg = (nextCfg) => {
    setCfgState(nextCfg);
    setSetupOpen(false);
    handleDisconnect();
  };

  const handleThemeChange = (nextTheme) => {
    updatePrefs((prev) => ({ ...prev, theme: { ...prev.theme, ...nextTheme } }));
  };

  const handleThemeReset = () => {
    updatePrefs((prev) => ({ ...prev, theme: { ...DEFAULT_THEME } }));
  };

  const handleCreateLesson = () => {
    const now = dayjs();
    const start = now.add(1, "hour").startOf("hour");
    const end = start.add(1, "hour");
    setEditingLesson({
      id: null,
      name: "",
      color: "#38bdf8",
      slots: [
        {
          weekday: now.day(),
          start: start.format("HH:mm"),
          end: end.format("HH:mm"),
        },
      ],
    });
  };

  const handleSaveLesson = (draft) => {
    const lesson = {
      ...draft,
      id: draft.id || uid("lesson"),
      name: draft.name.trim(),
      slots: draft.slots.map((slot) => ({
        weekday: Number(slot.weekday),
        start: slot.start,
        end: slot.end,
      })),
    };
    setLessonsState((prev) => {
      const existing = prev.find((item) => item.id === lesson.id);
      if (existing) {
        return prev.map((item) => (item.id === lesson.id ? lesson : item));
      }
      return [...prev, lesson];
    });
    setEditingLesson(null);
  };

  const handleDeleteLesson = (lessonId) => {
    setLessonsState((prev) => prev.filter((item) => item.id !== lessonId));
    setEditingLesson(null);
  };
  const handleCreateEvent = async ({ summary, description, startISO, endISO, reminders }) => {
    setEventSubmitting(true);
    setEventFeedback(null);
    let success = false;
    try {
      await insertEvent({ summary, description, startISO, endISO, reminders });
      setEventFeedback({ type: "success", message: "Event created in Google Calendar" });
      success = true;
      refreshEvents(true);
    } catch (error) {
      setEventFeedback({ type: "error", message: error.message || "Failed to create event" });
    } finally {
      setEventSubmitting(false);
    }
    return success;
  };

  const surfaceStyle = { backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" };
  const chipStyle = { backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--theme-background)", color: "var(--theme-text)" }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Lesson Calendar</h1>
            <p className="text-sm text-slate-300/80">
              Define lessons, plan sessions, and send them straight to Google Calendar.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition"
              style={surfaceStyle}
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
            {connected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                className="btn-accent flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-soft transition"
              >
                <LogOut className="h-4 w-4" />
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={connectGoogle}
                disabled={connecting || googleLoading}
                className="btn-accent flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-soft transition disabled:cursor-not-allowed disabled:opacity-80"
              >
                <LogIn className="h-4 w-4" />
                {connecting ? "Connecting..." : "Connect Google"}
              </button>
            )}
          </div>
        </header>

        {googleError && (
          <div className="rounded-2xl border px-4 py-3 text-sm" style={{ ...surfaceStyle, borderColor: "#f43f5e7f", color: "#fecdd3" }}>
            {googleError}
          </div>
        )}

        <main className="grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <section className="rounded-2xl border p-6 shadow-soft" style={surfaceStyle}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Your lessons</h2>
                <button
                  type="button"
                  onClick={handleCreateLesson}
                  className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium transition"
                  style={surfaceStyle}
                >
                  <Plus className="h-4 w-4" />
                  New
                </button>
              </div>
              {sortedLessons.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-slate-300/80" style={surfaceStyle}>
                  Add your first lesson to start planning recurring slots.
                </p>
              ) : (
                <ul className="space-y-4">
                  {sortedLessons.map((lesson) => (
                    <li key={lesson.id} className="rounded-2xl border p-4 transition" style={surfaceStyle}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-flex h-3 w-3 rounded-full"
                              style={{ backgroundColor: lesson.color }}
                            />
                            <h3 className="text-base font-semibold">{lesson.name}</h3>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {lesson.slots.map((slot, index) => (
                              <span
                                key={index}
                                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                                style={chipStyle}
                              >
                                <Clock className="h-3 w-3 text-slate-300/80" />
                                {WEEKDAYS[slot.weekday]} | {slot.start} - {slot.end}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingLesson(lesson)}
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition"
                            style={surfaceStyle}
                          >
                            <Edit3 className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLesson(lesson.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition"
                            style={{ ...surfaceStyle, borderColor: "#f43f5e7f", color: "#fecdd3" }}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <CreateEventPanel
              lessons={sortedLessons}
              onCreate={handleCreateEvent}
              isConnected={connected}
              isSubmitting={eventSubmitting}
              feedback={eventFeedback}
            />
          </div>

          <CalendarGrid
            month={month}
            events={calendarEvents}
            loading={eventsLoading}
            error={eventsError}
            connected={connected}
            googleReady={googleReady}
            onPrev={() => changeMonth(-1)}
            onNext={() => changeMonth(1)}
          />
        </main>
      </div>

      <SetupModal
        open={setupOpen}
        values={cfg}
        onSave={handleSaveCfg}
        onClose={!cfg ? undefined : () => setSetupOpen(false)}
        theme={theme}
        onThemeChange={handleThemeChange}
        onThemeReset={handleThemeReset}
      />

      {editingLesson && (
        <LessonEditor
          lesson={editingLesson}
          onSave={handleSaveLesson}
          onCancel={() => setEditingLesson(null)}
          onDelete={editingLesson.id ? handleDeleteLesson : undefined}
        />
      )}
    </div>
  );
}
function SetupModal({ open, values, onSave, onClose, theme, onThemeChange, onThemeReset }) {
  const [clientId, setClientId] = useState(values?.clientId || "");
  const [apiKey, setApiKey] = useState(values?.apiKey || "");
  const [error, setError] = useState("");
  const [draftTheme, setDraftTheme] = useState(theme);

  useEffect(() => {
    if (!open) return;
    setClientId(values?.clientId || "");
    setApiKey(values?.apiKey || "");
    setDraftTheme(theme);
    setError("");
  }, [open, values, theme]);

  if (!open) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!clientId.trim() || !apiKey.trim()) {
      setError("Both fields are required");
      return;
    }
    onSave({ clientId: clientId.trim(), apiKey: apiKey.trim() });
  };

  const handleThemeSubmit = (event) => {
    event.preventDefault();
    onThemeChange(draftTheme);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur">
      <div className="w-full max-w-2xl rounded-3xl border p-8 shadow-soft" style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" }}>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Settings</h2>
            <p className="mt-1 text-sm text-slate-300/80">
              Manage Google credentials and personalize the interface.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border px-2 py-2"
              style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)" }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="space-y-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <h3 className="text-lg font-semibold">Google API setup</h3>
              <p className="text-sm text-slate-300/80">
                Add your OAuth Client ID and API Key so the app can access Google Calendar.
              </p>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="clientId">
                OAuth Client ID (Web)
              </label>
              <input
                id="clientId"
                type="text"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="w-full rounded-xl border px-4 py-2 text-sm"
                style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                placeholder="xxxxxxxx.apps.googleusercontent.com"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="apiKey">
                API Key
              </label>
              <input
                id="apiKey"
                type="text"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className="w-full rounded-xl border px-4 py-2 text-sm"
                style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                placeholder="AIza..."
              />
            </div>
            {error && (
              <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#f43f5e7f", color: "#fecdd3" }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              className="btn-accent flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-soft transition"
            >
              <Save className="h-4 w-4" />
              Save credentials
            </button>
          </form>

          <form onSubmit={handleThemeSubmit} className="space-y-5">
            <div>
              <h3 className="text-lg font-semibold">Appearance</h3>
              <p className="text-sm text-slate-300/80">
                Customize background, card, border, accent, and text colors.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ThemeInput
                label="Background"
                value={draftTheme.background}
                onChange={(value) => setDraftTheme((prev) => ({ ...prev, background: value }))}
              />
              <ThemeInput
                label="Card surface"
                value={draftTheme.surface}
                onChange={(value) => setDraftTheme((prev) => ({ ...prev, surface: value }))}
              />
              <ThemeInput
                label="Border"
                value={draftTheme.border}
                onChange={(value) => setDraftTheme((prev) => ({ ...prev, border: value }))}
              />
              <ThemeInput
                label="Accent"
                value={draftTheme.accent}
                onChange={(value) => setDraftTheme((prev) => ({ ...prev, accent: value }))}
              />
              <ThemeInput
                label="Text"
                value={draftTheme.text}
                onChange={(value) => setDraftTheme((prev) => ({ ...prev, text: value }))}
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  setDraftTheme(theme);
                  onThemeReset();
                }}
                className="rounded-xl border px-4 py-2 text-sm font-medium transition"
                style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)", color: "var(--theme-text)" }}
              >
                Reset to default
              </button>
              <button
                type="submit"
                className="btn-accent flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-soft transition"
              >
                <Save className="h-4 w-4" /> Apply appearance
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ThemeInput({ label, value, onChange }) {
  const normalized = value.startsWith("#") && (value.length === 4 || value.length === 7) ? value : "#000000";
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border px-4 py-2 text-sm"
        style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
      />
      <input
        type="color"
        value={normalized}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full cursor-pointer rounded-xl border"
        style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)" }}
      />
    </div>
  );
}
function LessonEditor({ lesson, onSave, onCancel, onDelete }) {
  const [draft, setDraft] = useState(() => cloneLesson(lesson));
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(cloneLesson(lesson));
    setError("");
  }, [lesson]);

  const isNew = !lesson?.id;

  const updateSlot = (index, patch) => {
    setDraft((prev) => {
      const slots = prev.slots.map((slot, slotIndex) => {
        if (slotIndex !== index) return slot;
        return { ...slot, ...patch, weekday: Number(patch.weekday ?? slot.weekday) };
      });
      return { ...prev, slots };
    });
  };

  const removeSlot = (index) => {
    setDraft((prev) => ({
      ...prev,
      slots: prev.slots.filter((_, slotIndex) => slotIndex !== index),
    }));
  };

  const addSlot = () => {
    setDraft((prev) => ({
      ...prev,
      slots: [
        ...prev.slots,
        { weekday: 1, start: "09:00", end: "10:00" },
      ],
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      setError("Lesson name is required");
      return;
    }
    if (!draft.slots.length) {
      setError("Add at least one weekly slot");
      return;
    }
    const invalidSlot = draft.slots.find((slot) => !slot.start || !slot.end || slot.start >= slot.end);
    if (invalidSlot) {
      setError("Each slot needs a valid start/end time");
      return;
    }
    onSave({
      ...draft,
      name,
      color: draft.color || "#38bdf8",
      slots: draft.slots.map((slot) => ({
        weekday: Number(slot.weekday),
        start: slot.start,
        end: slot.end,
      })),
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 backdrop-blur">
      <div className="w-full max-w-2xl rounded-3xl border p-6 shadow-soft" style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isNew ? "New lesson" : "Edit lesson"}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border px-2 py-2"
            style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="lesson-name">
                Lesson name
              </label>
              <input
                id="lesson-name"
                type="text"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-xl border px-4 py-2 text-sm"
                style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                placeholder="Biology"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="lesson-color">
                Accent color
              </label>
              <input
                id="lesson-color"
                type="color"
                value={draft.color}
                onChange={(event) => setDraft((prev) => ({ ...prev, color: event.target.value }))}
                className="h-10 w-full cursor-pointer rounded-xl border"
                style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)" }}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Weekly slots</span>
              <button
                type="button"
                onClick={addSlot}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition"
                style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)", color: "var(--theme-text)" }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add slot
              </button>
            </div>
            {draft.slots.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-slate-300/80" style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)" }}>
                No slots yet. Add at least one weekday/time range.
              </p>
            ) : (
              <div className="space-y-3">
                {draft.slots.map((slot, index) => (
                  <div
                    key={index}
                    className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[1fr_1fr_1fr_auto]"
                    style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)" }}
                  >
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-slate-300/80">Weekday</label>
                      <select
                        value={slot.weekday}
                        onChange={(event) => updateSlot(index, { weekday: Number(event.target.value) })}
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                      >
                        {WEEKDAYS.map((day, value) => (
                          <option key={day} value={value}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-slate-300/80">Start</label>
                      <input
                        type="time"
                        value={slot.start}
                        onChange={(event) => updateSlot(index, { start: event.target.value })}
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-slate-300/80">End</label>
                      <input
                        type="time"
                        value={slot.end}
                        onChange={(event) => updateSlot(index, { end: event.target.value })}
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                      />
                    </div>
                    <div className="flex items-end justify-end">
                      <button
                        type="button"
                        onClick={() => removeSlot(index)}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition"
                        style={{ borderColor: "#f43f5e7f", color: "#fecdd3" }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#f43f5e7f", color: "#fecdd3" }}>
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {onDelete && lesson?.id ? (
              <button
                type="button"
                onClick={() => onDelete(lesson.id)}
                className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition"
                style={{ borderColor: "#f43f5e7f", color: "#fecdd3" }}
              >
                <Trash2 className="h-4 w-4" /> Delete lesson
              </button>
            ) : (
              <span className="text-xs uppercase tracking-wide text-slate-300/80">
                {draft.slots.length} slot(s)
              </span>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border px-4 py-2 text-sm font-medium transition"
                style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)", color: "var(--theme-text)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-accent inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold shadow-soft transition"
              >
                <Save className="h-4 w-4" />
                Save lesson
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
function CreateEventPanel({ lessons, onCreate, isConnected, isSubmitting, feedback }) {
  const [lessonId, setLessonId] = useState(() => lessons[0]?.id || "");
  const [slotIndex, setSlotIndex] = useState("0");
  const [date, setDate] = useState("");
  const [eventType, setEventType] = useState(EVENT_TYPES[0].value);
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [reminderDaysBefore, setReminderDaysBefore] = useState(2);
  const [reminderTime, setReminderTime] = useState(REMINDER_TIMES[0].value);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!lessons.length) {
      setLessonId("");
      setSlotIndex("");
      setDate("");
      return;
    }
    if (!lessons.some((lesson) => lesson.id === lessonId)) {
      const first = lessons[0];
      setLessonId(first.id);
      setSlotIndex(first.slots.length ? "0" : "");
      return;
    }
    const lesson = lessons.find((item) => item.id === lessonId);
    if (!lesson) return;
    if (!lesson.slots.length) {
      setSlotIndex("");
      setDate("");
      return;
    }
    if (!lesson.slots[Number(slotIndex)]) {
      setSlotIndex("0");
    }
  }, [lessons, lessonId, slotIndex]);

  const selectedLesson = lessons.find((lesson) => lesson.id === lessonId);
  const slots = selectedLesson?.slots || [];
  const chosenSlot = slots[Number(slotIndex)] || null;

  const availableDates = useMemo(() => generateUpcomingDates(chosenSlot), [chosenSlot]);

  useEffect(() => {
    if (!availableDates.length) {
      setDate("");
      return;
    }
    const options = availableDates.map((item) => item.format("YYYY-MM-DD"));
    if (!options.includes(date)) {
      setDate(options[0]);
    }
  }, [availableDates, date]);

  useEffect(() => {
    if (eventType === "test") {
      if (![1, 2].includes(reminderDaysBefore)) {
        setReminderDaysBefore(2);
      }
    } else if (eventType === "homework") {
      if (reminderDaysBefore !== 1) {
        setReminderDaysBefore(1);
      }
    }
  }, [eventType, reminderDaysBefore]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (!isConnected) {
      setError("Connect to Google Calendar first");
      return;
    }
    if (!selectedLesson) {
      setError("Add a lesson before creating events");
      return;
    }
    if (!slots.length) {
      setError("This lesson needs at least one weekly slot");
      return;
    }
    if (!chosenSlot) {
      setError("Select a time slot");
      return;
    }
    if (!date) {
      setError("Choose a date");
      return;
    }
    const slotWeekday = Number(chosenSlot.weekday);
    const selectedDate = dayjs(date);
    if (selectedDate.day() !== slotWeekday) {
      setError(`Selected date must be a ${WEEKDAYS[slotWeekday]}`);
      return;
    }
    if (chosenSlot.start >= chosenSlot.end) {
      setError("Slot end time must be after start time");
      return;
    }
    const [startHour, startMinute] = chosenSlot.start.split(":").map(Number);
    const [endHour, endMinute] = chosenSlot.end.split(":").map(Number);
    const start = selectedDate.hour(startHour).minute(startMinute).second(0).millisecond(0);
    const end = selectedDate.hour(endHour).minute(endMinute).second(0).millisecond(0);
    if (!end.isAfter(start)) {
      setError("End time must be after start time");
      return;
    }

    const summary = buildSummary(selectedLesson.name, eventType, topic);
    const description = buildDescription({
      lesson: selectedLesson,
      eventType,
      topic,
      notes,
    });

    let reminders = null;
    if (eventType === "test" || eventType === "homework") {
      const leadDays = eventType === "homework" ? 1 : reminderDaysBefore;
      const [remHour, remMinute] = reminderTime.split(":").map(Number);
      const reminderMoment = start
        .subtract(leadDays, "day")
        .hour(remHour)
        .minute(remMinute)
        .second(0)
        .millisecond(0);
      if (reminderMoment.isBefore(start)) {
        const minutesBefore = Math.max(0, Math.round(start.diff(reminderMoment, "minute")));
        reminders = [{ method: "popup", minutes: minutesBefore }];
      }
    }

    const success = await onCreate({
      summary,
      description,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      reminders,
    });

    if (success) {
      setTopic("");
      setNotes("");
    }
  };

  const reminderDayOptions = eventType === "test" ? [1, 2] : [1];

  return (
    <section className="rounded-2xl border p-6 shadow-soft" style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" }}>
      <h2 className="text-lg font-semibold">Create event</h2>
      <p className="mt-1 text-xs text-slate-300/80">
        Insert a Class, Test, or Homework into Google Calendar. Times use {LOCAL_TIMEZONE}.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="event-lesson">
            Lesson
          </label>
          <select
            id="event-lesson"
            value={lessonId}
            onChange={(event) => setLessonId(event.target.value)}
            className="w-full rounded-xl border px-4 py-2 text-sm disabled:opacity-60"
            style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
            disabled={!lessons.length}
          >
            {!lessons.length && <option value="">No lessons yet</option>}
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="event-slot">
              Weekly slot
            </label>
            <select
              id="event-slot"
              value={slotIndex}
              onChange={(event) => setSlotIndex(event.target.value)}
              className="w-full rounded-xl border px-4 py-2 text-sm"
              style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
              disabled={!slots.length}
            >
              {!slots.length && <option value="">No slots available</option>}
              {slots.map((slot, index) => (
                <option key={`${slot.weekday}-${slot.start}-${slot.end}`} value={index}>
                  {WEEKDAYS[slot.weekday]} | {slot.start} - {slot.end}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="event-date">
              Date
            </label>
            <select
              id="event-date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-xl border px-4 py-2 text-sm"
              style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
              disabled={!availableDates.length}
            >
              {!availableDates.length && <option value="">No upcoming dates</option>}
              {availableDates.map((dateOption) => {
                const value = dateOption.format("YYYY-MM-DD");
                return (
                  <option key={value} value={value}>
                    {formatDateOption(dateOption)}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            <div className="flex gap-2">
              {EVENT_TYPES.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  onClick={() => setEventType(item.value)}
                  className={clsx(
                    "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition",
                    eventType === item.value ? "btn-accent" : "border"
                  )}
                  style={
                    eventType === item.value
                      ? undefined
                      : { borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)" }
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="event-topic">
              Topic (optional)
            </label>
            <input
              id="event-topic"
              type="text"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="w-full rounded-xl border px-4 py-2 text-sm"
              style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
              placeholder="DNA"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="event-notes">
            Description (optional)
          </label>
          <textarea
            id="event-notes"
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="w-full rounded-xl border px-4 py-2 text-sm"
            style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
            placeholder="Homework details, resources, room number..."
          />
        </div>

        {eventType !== "class" && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Reminder</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs uppercase tracking-wide text-slate-300/80">Days before</span>
                <select
                  value={reminderDaysBefore}
                  onChange={(event) => setReminderDaysBefore(Number(event.target.value))}
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                  disabled={eventType === "homework"}
                >
                  {reminderDayOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} day{option === 1 ? "" : "s"} before
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-xs uppercase tracking-wide text-slate-300/80">Reminder time</span>
                <select
                  value={reminderTime}
                  onChange={(event) => setReminderTime(event.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ backgroundColor: "var(--theme-background)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                >
                  {REMINDER_TIMES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#f43f5e7f", color: "#fecdd3" }}>
            {error}
          </div>
        )}

        {feedback && (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={feedback.type === "success" ? { border: "1px solid rgba(16, 185, 129, 0.4)", backgroundColor: "rgba(16, 185, 129, 0.15)", color: "#bbf7d0" } : { border: "1px solid #f43f5e7f", backgroundColor: "rgba(244, 63, 94, 0.15)", color: "#fecdd3" }}
          >
            {feedback.message}
          </div>
        )}

        <button
          type="submit"
          disabled={!isConnected || isSubmitting || !lessons.length || !availableDates.length}
          className="btn-accent flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-soft transition disabled:cursor-not-allowed disabled:opacity-80"
        >
          <Calendar className="h-4 w-4" />
          {isSubmitting ? "Creating..." : "Insert into Google Calendar"}
        </button>

        {!isConnected && (
          <p className="text-xs text-slate-300/80">
            Connect to Google Calendar to enable event creation.
          </p>
        )}
      </form>
    </section>
  );
}
function CalendarGrid({ month, events, loading, error, connected, googleReady, onPrev, onNext }) {
  const days = useMemo(() => {
    const start = month.startOf("month").startOf("week");
    const end = month.endOf("month").endOf("week");
    const result = [];
    let cursor = start;
    while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
      result.push(cursor);
      cursor = cursor.add(1, "day");
    }
    return result;
  }, [month]);

  const eventsByDate = useMemo(() => {
    const map = new Map();
    events.forEach((event) => {
      const key = dayjs(event.startISO).format("YYYY-MM-DD");
      const bucket = map.get(key) || [];
      bucket.push(event);
      map.set(key, bucket);
    });
    return map;
  }, [events]);

  const today = dayjs();

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border shadow-soft" style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" }}>
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--theme-border)" }}>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Calendar className="h-5 w-5" />
          {month.format("MMMM YYYY")}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            className="rounded-xl border p-2 transition"
            style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)", color: "var(--theme-text)" }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl border p-2 transition"
            style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-background)", color: "var(--theme-text)" }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 border-b px-6 py-3 text-xs uppercase tracking-wide text-slate-300/80" style={{ borderColor: "var(--theme-border)" }}>
        {WEEKDAYS.map((day) => (
          <span key={day} className="text-center">
            {day}
          </span>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 gap-3 px-6 py-6">
        {days.map((day) => {
          const key = day.format("YYYY-MM-DD");
          const dayEvents = eventsByDate.get(key) || [];
          const overflow = Math.max(0, dayEvents.length - 3);
          const isCurrentMonth = day.month() === month.month();
          const isToday = day.isSame(today, "day");
          return (
            <div
              key={key}
              className="flex min-h-[130px] flex-col gap-2 rounded-2xl border px-3 py-3"
              style={{
                backgroundColor: isToday ? "rgba(14, 165, 233, 0.2)" : "var(--theme-background)",
                borderColor: isToday ? "rgba(14, 165, 233, 0.5)" : "var(--theme-border)",
                opacity: isCurrentMonth ? 1 : 0.6,
              }}
            >
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--theme-text)" }}>
                <span className="text-sm font-semibold">{day.date()}</span>
                {isToday && (
                  <span className="text-[11px] font-medium uppercase" style={{ color: "var(--theme-accent)" }}>
                    Today
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {dayEvents.slice(0, 3).map((event) => (
                  <div
                    key={event.id}
                    className="rounded-xl border px-3 py-2 text-xs"
                    title={event.summary}
                    style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
                  >
                    <div className="font-medium">{event.summary}</div>
                    <div className="mt-1 text-[11px] text-slate-300/80">
                      {event.isAllDay ? "All day" : dayjs(event.startISO).format("HH:mm")}
                    </div>
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="text-center text-[11px] text-slate-300/80">+{overflow} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t px-6 py-3 text-xs" style={{ borderColor: "var(--theme-border)", color: "var(--theme-text)" }}>
        {!googleReady && "Add Google credentials to load your calendar."}
        {googleReady && !connected && "Connect to Google Calendar to view events."}
        {loading && " Loading events..."}
        {error && <span style={{ color: "#fecdd3" }}> {error}</span>}
      </div>
    </section>
  );
}

function buildSummary(lessonName, type, topic) {
  const trimmedTopic = topic.trim();
  if (type === "class") {
    return lessonName;
  }
  if (type === "test") {
    return `${lessonName} Test${trimmedTopic ? `: ${trimmedTopic}` : ""}`;
  }
  if (type === "homework") {
    return `${lessonName} Homework${trimmedTopic ? `: ${trimmedTopic}` : ""}`;
  }
  return lessonName;
}

function buildDescription({ lesson, eventType, topic, notes }) {
  const lines = [
    `Lesson: ${lesson.name}`,
    `Type: ${EVENT_TYPES.find((item) => item.value === eventType)?.label || eventType}`,
  ];
  if (topic.trim()) {
    lines.push(`Topic: ${topic.trim()}`);
  }
  if (notes.trim()) {
    lines.push("", notes.trim());
  }
  lines.push("", "Created with Lesson Calendar");
  return lines.join("\n");
}

function cloneLesson(lesson) {
  if (!lesson) {
    return {
      id: null,
      name: "",
      color: "#38bdf8",
      slots: [],
    };
  }
  return {
    ...lesson,
    slots: (lesson.slots || []).map((slot) => ({ ...slot })),
  };
}
