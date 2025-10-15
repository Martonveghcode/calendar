import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { LogIn, LogOut, Settings } from "lucide-react";
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
import { uid } from "./lib/ui";
import { DEFAULT_THEME, GOOGLE_COLOR_MAP } from "./lib/constants";
import { resolveLessonColorHex, resolveLessonColorId } from "./lib/events";
import LessonsPanel from "./components/LessonsPanel";
import CreateEventPanel from "./components/CreateEventPanel";
import CalendarGrid from "./components/CalendarGrid";
import SetupModal from "./components/SetupModal";
import LessonEditor from "./components/LessonEditor";

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

const normalizeLesson = (lesson) => {
  if (!lesson) return lesson;
  const colorId = resolveLessonColorId(lesson);
  return {
    ...lesson,
    colorId,
    color: resolveLessonColorHex({ ...lesson, colorId }),
  };
};

const sanitizeLessonSlots = (slots = [], lessonIndex) => {
  if (!Array.isArray(slots)) {
    return [];
  }
  return slots
    .map((slot, slotIndex) => {
      if (!slot || typeof slot !== "object") {
        console.warn(`[import] Ignoring invalid slot at index ${slotIndex} for lesson ${lessonIndex}`);
        return null;
      }
      const weekday = Number(slot.weekday);
      const start = typeof slot.start === "string" ? slot.start : "";
      const end = typeof slot.end === "string" ? slot.end : "";
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        console.warn(`[import] Ignoring slot with invalid weekday at index ${slotIndex} for lesson ${lessonIndex}`);
        return null;
      }
      if (!start || !end) {
        console.warn(`[import] Ignoring slot with missing time at index ${slotIndex} for lesson ${lessonIndex}`);
        return null;
      }
      return { weekday, start, end };
    })
    .filter(Boolean);
};

const prepareLessonsFromFile = (lessons) => {
  if (!Array.isArray(lessons)) {
    throw new Error("Lessons must be an array.");
  }
  return lessons.map((lesson, index) => {
    if (!lesson || typeof lesson !== "object") {
      throw new Error(`Lesson at index ${index} is not a valid object.`);
    }
    const name = typeof lesson.name === "string" ? lesson.name.trim() : "";
    if (!name) {
      throw new Error(`Lesson at index ${index} is missing a name.`);
    }
    const sanitized = {
      ...lesson,
      id: typeof lesson.id === "string" && lesson.id.trim() ? lesson.id.trim() : uid("lesson"),
      name,
      slots: sanitizeLessonSlots(lesson.slots, index),
    };
    return normalizeLesson(sanitized);
  });
};
export default function App() {
  const [cfg, setCfgState] = useState(() => getCfg());
  const [setupOpen, setSetupOpen] = useState(() => {
    const stored = getCfg();
    return !stored?.clientId || !stored?.apiKey;
  });
  const [lessons, setLessonsState] = useState(() => getLessons().map(normalizeLesson));
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
  const dataSnapshot = useMemo(
    () => ({
      cfg: cfg ? { ...cfg } : null,
      lessons: lessons.map((lesson) => ({ ...lesson })),
      prefs: prefs ? { ...prefs } : null,
    }),
    [cfg, lessons, prefs]
  );

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
          if (!cancelled) setGoogleReady(true);
        })
        .catch((error) => {
          if (!cancelled) {
            setGoogleError(error.message || "Failed to load Google libraries");
            setGoogleReady(false);
          }
        })
        .finally(() => {
          if (!cancelled) setGoogleLoading(false);
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
          const colorId = item.colorId || null;
          const colorHex = colorId ? GOOGLE_COLOR_MAP[colorId]?.hex || null : null;
          return {
            id: item.id,
            summary: item.summary || "(No title)",
            description: item.description || "",
            startISO,
            endISO,
            isAllDay: !item.start.dateTime,
            colorId,
            colorHex,
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

  const handleDisconnect = useCallback(() => {
    try {
      signOut();
    } catch (_) {
      /* ignore */
    }
    setConnected(false);
    setCalendarEvents([]);
  }, []);

  const handleSaveCfg = useCallback(
    (nextCfg) => {
      setCfgState(nextCfg);
      setSetupOpen(false);
      handleDisconnect();
    },
    [handleDisconnect]
  );

  const handleThemeChange = useCallback(
    (nextTheme) => {
      updatePrefs((prev) => ({ ...prev, theme: { ...prev.theme, ...nextTheme } }));
    },
    [updatePrefs]
  );

  const handleThemeReset = useCallback(() => {
    updatePrefs((prev) => ({ ...prev, theme: { ...DEFAULT_THEME } }));
  }, [updatePrefs]);

  const handleCreateLesson = useCallback(() => {
    const now = dayjs();
    const start = now.add(1, "hour").startOf("hour");
    const end = start.add(1, "hour");
    const defaultColorId = "9";
    const defaultColor = GOOGLE_COLOR_MAP[defaultColorId]?.hex || "#5484ed";
    setEditingLesson({
      id: null,
      name: "",
      colorId: defaultColorId,
      color: defaultColor,
      slots: [
        {
          weekday: now.day(),
          start: start.format("HH:mm"),
          end: end.format("HH:mm"),
        },
      ],
    });
  }, []);

  const handleSaveLesson = useCallback((draft) => {
    const colorId = resolveLessonColorId(draft);
    const color = resolveLessonColorHex({ ...draft, colorId });
    const lesson = {
      ...draft,
      id: draft.id || uid("lesson"),
      name: draft.name.trim(),
      colorId,
      color,
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
  }, []);

  const handleDeleteLesson = useCallback((lessonId) => {
    setLessonsState((prev) => prev.filter((item) => item.id !== lessonId));
    setEditingLesson(null);
  }, []);

  const handleImportData = useCallback(
    (payload) => {
      if (!payload || typeof payload !== "object") {
        throw new Error("The file must contain a JSON object.");
      }

      const applied = [];

      if (Object.prototype.hasOwnProperty.call(payload, "cfg")) {
        const incomingCfg = payload.cfg;
        if (incomingCfg === null) {
          setCfgState(null);
          applied.push("credentials");
          handleDisconnect();
        } else if (incomingCfg && typeof incomingCfg === "object") {
          const clientId = typeof incomingCfg.clientId === "string" ? incomingCfg.clientId.trim() : "";
          const apiKey = typeof incomingCfg.apiKey === "string" ? incomingCfg.apiKey.trim() : "";
          if (!clientId || !apiKey) {
            throw new Error("Credentials must include non-empty clientId and apiKey strings.");
          }
          setCfgState({ clientId, apiKey });
          applied.push("credentials");
          handleDisconnect();
        } else {
          throw new Error("Credentials section must be an object with clientId and apiKey.");
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, "lessons")) {
        const nextLessons = prepareLessonsFromFile(payload.lessons);
        setLessonsState(nextLessons);
        setEditingLesson(null);
        applied.push("lessons");
      }

      if (Object.prototype.hasOwnProperty.call(payload, "prefs")) {
        const incomingPrefs = payload.prefs;
        if (incomingPrefs !== null && typeof incomingPrefs !== "object") {
          throw new Error("Preferences section must be an object or null.");
        }
        setPrefsState(hydratePrefs(incomingPrefs));
        applied.push("preferences");
      }

      if (!applied.length) {
        throw new Error("The file does not include any recognized sections (cfg, lessons, prefs).");
      }

      return applied;
    },
    [handleDisconnect]
  );

  const handleCreateEvent = useCallback(
    async ({ summary, description, startISO, endISO, reminders, colorId }) => {
      setEventSubmitting(true);
      setEventFeedback(null);
      let success = false;
      try {
        await insertEvent({ summary, description, startISO, endISO, reminders, colorId });
        setEventFeedback({ type: "success", message: "Event created in Google Calendar" });
        success = true;
        refreshEvents(true);
      } catch (error) {
        setEventFeedback({ type: "error", message: error.message || "Failed to create event" });
      } finally {
        setEventSubmitting(false);
      }
      return success;
    },
    [refreshEvents]
  );

  const surfaceStyle = useMemo(
    () => ({ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" }),
    []
  );

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
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-border)",
                color: "var(--theme-text)",
              }}
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
            <LessonsPanel
              lessons={sortedLessons}
              onCreate={handleCreateLesson}
              onEdit={setEditingLesson}
              onDelete={handleDeleteLesson}
            />
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
        dataSnapshot={dataSnapshot}
        onImportData={handleImportData}
      />

      {editingLesson && (
        <LessonEditor
          lesson={editingLesson}
          onSave={handleSaveLesson}
          onCancel={() => setEditingLesson(null)}
          onDelete={editingLesson?.id ? handleDeleteLesson : undefined}
        />
      )}
    </div>
  );
}














