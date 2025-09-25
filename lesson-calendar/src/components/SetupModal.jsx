﻿import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";

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
        style={{
          backgroundColor: "var(--theme-background)",
          borderColor: "var(--theme-border)",
          color: "var(--theme-text)",
        }}
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

export default function SetupModal({ open, values, onSave, onClose, theme, onThemeChange, onThemeReset }) {
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
      <div
        className="w-full max-w-2xl rounded-3xl border p-8 shadow-soft"
        style={{ backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)" }}
      >
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
                style={{
                  backgroundColor: "var(--theme-background)",
                  borderColor: "var(--theme-border)",
                  color: "var(--theme-text)",
                }}
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
                style={{
                  backgroundColor: "var(--theme-background)",
                  borderColor: "var(--theme-border)",
                  color: "var(--theme-text)",
                }}
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
                Customize background, card, border, accent, and text.
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
                style={{
                  borderColor: "var(--theme-border)",
                  backgroundColor: "var(--theme-background)",
                  color: "var(--theme-text)",
                }}
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
