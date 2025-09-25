export const EVENT_TYPES = [
  { value: "class", label: "Class" },
  { value: "test", label: "Test" },
  { value: "homework", label: "Homework" },
];

export const REMINDER_TIMES = [
  { value: "16:00", label: "4:00 PM" },
  { value: "22:00", label: "10:00 PM" },
];

export const DEFAULT_THEME = {
  background: "#020617",
  surface: "#0f172a",
  border: "#334155",
  accent: "#0ea5e9",
  text: "#e2e8f0",
};

export const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
