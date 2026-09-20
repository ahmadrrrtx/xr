/**
 * Phase 5 · i18n — en / es / ur catalog for the CORE CHROME.
 *
 * Scope honesty: this catalog covers the navigation chrome, onboarding verbs
 * and statusbar (the strings a first-time user meets before reading any
 * domain copy). Domain screens remain English for now — that is recorded in
 * docs/xr-rebuild/KNOWN-LIMITATIONS.md, not hidden. Urdu ships LTR-rendered:
 * full RTL mirroring of the grid is a separate design pass (also recorded).
 */
export type Locale = "en" | "es" | "ur";

const KEY = "xr.locale";

type Entry = { en: string; es: string; ur: string };

/** Keys are the English string; t() looks the locale up. */
const CATALOG: Record<string, Entry> = {
  Home: { en: "Home", es: "Inicio", ur: "ہوم" },
  "Work (chat)": { en: "Work (chat)", es: "Trabajo (chat)", ur: "کام (چیٹ)" },
  "Workspace (files)": { en: "Workspace (files)", es: "Espacio (archivos)", ur: "ورک اسپیس (فائلیں)" },
  "Multi-agent": { en: "Multi-agent", es: "Multi-agente", ur: "ملٹی ایجنٹ" },
  Library: { en: "Library", es: "Biblioteca", ur: "لائبریری" },
  "Team runs": { en: "Team runs", es: "Ejecuciones", ur: "ٹیم رنز" },
  "Trust Center": { en: "Trust Center", es: "Centro de confianza", ur: "اعتماد مرکز" },
  Settings: { en: "Settings", es: "Ajustes", ur: "ترتیبات" },
  "Voice mode": { en: "Voice mode", es: "Modo voz", ur: "آواز موڈ" },
  Continue: { en: "Continue", es: "Continuar", ur: "جاری رکھیں" },
  "Skip for now": { en: "Skip for now", es: "Omitir por ahora", ur: "فی الحال چھوڑیں" },
  "Enter XR": { en: "Enter XR", es: "Entrar a XR", ur: "XR میں داخل ہوں" },
  Back: { en: "Back", es: "Atrás", ur: "واپس" },
  Engine: { en: "Engine", es: "Motor", ur: "انجن" },
  approvals: { en: "approvals", es: "aprobaciones", ur: "منظوریاں" },
  "OFFLINE VOICE": { en: "OFFLINE VOICE", es: "VOZ OFFLINE", ur: "آف لائن آواز" },
};

let current: Locale = readStored();
const listeners = new Set<() => void>();

function readStored(): Locale {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "es" || v === "ur") return v;
  } catch { /* locked-down webview */ }
  return "en";
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  current = l;
  try { window.localStorage.setItem(KEY, l); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate a chrome string; unknown strings pass through (English). */
export function t(s: string): string {
  const e = CATALOG[s];
  if (!e) return s;
  return e[current] || e.en;
}

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "ur", label: "اردو (Urdu)" },
];
