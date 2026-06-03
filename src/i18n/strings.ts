/**
 * XR — minimal i18n. Most AI tools are English-only; XR ships multilingual
 * from day one (English, Urdu, Arabic, Spanish). Picks language from XR_LANG
 * or the OS locale, falling back to English. Dependency-free.
 */
export type Lang = "en" | "ur" | "ar" | "es";

type Dict = Record<string, string>;

const EN: Dict = {
  ready: "Ready",
  working: "working on it…",
  done: "done",
  approval_needed: "Approval needed",
  approve: "Approve",
  reject: "Reject",
  paused: "paused",
  resumed: "resumed",
  budget_set: "per-task ceiling set",
  over_budget: "PAUSED — budget guard",
  blocked: "blocked",
  allowed: "ALLOWED",
  audit_intact: "audit log intact",
};

const DICTS: Record<Lang, Dict> = {
  en: EN,
  ur: {
    ...EN,
    ready: "تیار",
    working: "کام جاری ہے…",
    done: "مکمل",
    approval_needed: "اجازت درکار ہے",
    approve: "منظور",
    reject: "مسترد",
    paused: "روکا گیا",
    resumed: "دوبارہ شروع",
    over_budget: "رُکا — بجٹ حد",
    blocked: "بلاک",
    audit_intact: "آڈٹ لاگ محفوظ",
  },
  ar: {
    ...EN,
    ready: "جاهز",
    working: "جارٍ العمل…",
    done: "تم",
    approval_needed: "مطلوب موافقة",
    approve: "موافقة",
    reject: "رفض",
    paused: "متوقف",
    resumed: "استؤنف",
    over_budget: "متوقف — حد الميزانية",
    blocked: "محظور",
    audit_intact: "سجل التدقيق سليم",
  },
  es: {
    ...EN,
    ready: "Listo",
    working: "trabajando…",
    done: "hecho",
    approval_needed: "Se necesita aprobación",
    approve: "Aprobar",
    reject: "Rechazar",
    paused: "pausado",
    resumed: "reanudado",
    over_budget: "PAUSA — límite de presupuesto",
    blocked: "bloqueado",
    audit_intact: "registro de auditoría intacto",
  },
};

export function pickLang(envLang?: string): Lang {
  const raw = (envLang ?? process.env.XR_LANG ?? process.env.LANG ?? "en").toLowerCase();
  if (raw.startsWith("ur")) return "ur";
  if (raw.startsWith("ar")) return "ar";
  if (raw.startsWith("es")) return "es";
  return "en";
}

export function t(key: string, lang: Lang = pickLang()): string {
  return DICTS[lang][key] ?? DICTS.en[key] ?? key;
}

export function isRTL(lang: Lang): boolean {
  return lang === "ur" || lang === "ar";
}
