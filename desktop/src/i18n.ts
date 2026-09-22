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
  Workbench: { en: "Workbench", es: "Espacio de trabajo", ur: "ورک بینچ" },
  "Work (chat)": { en: "Work (chat)", es: "Trabajo (chat)", ur: "کام (چیٹ)" },
  "Workspace (files)": { en: "Workspace (files)", es: "Espacio (archivos)", ur: "ورک اسپیس (فائلیں)" },
  Builder: { en: "Builder", es: "Constructor", ur: "بلڈر" },
  Projects: { en: "Projects", es: "Proyectos", ur: "پروجیکٹس" },
  Research: { en: "Research", es: "Investigación", ur: "تحقیق" },
  Agents: { en: "Agents", es: "Agentes", ur: "ایجنٹس" },
  Trust: { en: "Trust", es: "Confianza", ur: "اعتماد" },
  "Trust Center": { en: "Trust Center", es: "Centro de confianza", ur: "اعتماد مرکز" },
  Settings: { en: "Settings", es: "Ajustes", ur: "ترتیبات" },
  Voice: { en: "Voice", es: "Voz", ur: "آواز" },
  "Voice mode": { en: "Voice mode", es: "Modo voz", ur: "آواز موڈ" },
  Control: { en: "Control", es: "Control", ur: "کنٹرول" },
  Library: { en: "Library", es: "Biblioteca", ur: "لائبریری" },
  Memory: { en: "Memory", es: "Memoria", ur: "یاداشت" },
  "Runs history": { en: "Runs history", es: "Historial", ur: "رن ہسٹری" },
  Diagnostics: { en: "Diagnostics", es: "Diagnósticos", ur: "تشخیص" },
  "Computer Control": { en: "Computer Control", es: "Control del equipo", ur: "کمپیوٹر کنٹرول" },
  Continue: { en: "Continue", es: "Continuar", ur: "جاری رکھیں" },
  "Skip for now": { en: "Skip for now", es: "Omitir por ahora", ur: "فی الحال چھوڑیں" },
  "Enter XR": { en: "Enter XR", es: "Entrar a XR", ur: "XR میں داخل ہوں" },
  Back: { en: "Back", es: "Atrás", ur: "واپس" },
  Engine: { en: "Engine", es: "Motor", ur: "انجن" },
  Online: { en: "Online", es: "En línea", ur: "آن لائن" },
  Offline: { en: "Offline", es: "Desconectado", ur: "آف لائن" },
  approvals: { en: "approvals", es: "aprobaciones", ur: "منظوریاں" },
  "OFFLINE VOICE": { en: "OFFLINE VOICE", es: "VOZ OFFLINE", ur: "آف لائن آواز" },
  "Search or ask XR…": { en: "Search or ask XR…", es: "Buscar o preguntar a XR…", ur: "تلاش کریں یا XR سے پوچھیں…" },
  cloud: { en: "cloud", es: "nube", ur: "کلاؤڈ" },
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
