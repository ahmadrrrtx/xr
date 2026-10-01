/*
 * i18n (Phase 8) — minimal locale infrastructure.
 *
 * Scope: the Settings surface swaps live (tabs, groups, section headers,
 * common verbs) in all five launch locales; long-tail row labels stay
 * English until the full-app translation pass in a later phase. Urdu flips
 * the document to RTL. Persisted at `xr.locale` (write-through layer).
 */
import { create } from 'zustand';

import { writeSettingRaw } from '@/lib/persistent-store';
import { settingsChanged } from '@/lib/settingsApi';

export type LocaleId = 'en' | 'ur' | 'es' | 'fr' | 'zh';

export interface LocaleMeta {
  id: LocaleId;
  label: string;
  rtl?: boolean;
}

export const LOCALES: readonly LocaleMeta[] = [
  { id: 'en', label: 'English' },
  { id: 'ur', label: 'اردو', rtl: true },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'zh', label: '中文' },
];

const LOCALE_KEY = 'xr.locale';

function isLocaleId(value: unknown): value is LocaleId {
  return (
    typeof value === 'string' &&
    LOCALES.some((locale) => locale.id === value)
  );
}

/* ── String tables (settings surface only — see file header) ────────── */

type StringTable = Record<string, string>;

const en: StringTable = {
  'tab.general': 'General',
  'tab.appearance': 'Appearance',
  'tab.models': 'Models & Providers',
  'tab.shortcuts': 'Keyboard Shortcuts',
  'tab.notifications': 'Notifications',
  'tab.voice': 'Voice & Audio',
  'tab.privacy': 'Privacy & Data',
  'tab.updates': 'Updates',
  'tab.about': 'About XR',
  'group.account': 'Account',
  'group.app': 'App',
  'group.preferences': 'Preferences',
  'group.privacy': 'Privacy',
  'group.system': 'System',
  'settings.search': 'Search settings',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.edit': 'Edit',
  'common.test': 'Test',
  'common.reset': 'Reset',
  'common.remove': 'Remove',
  'common.default': '(Default)',
  'common.loading': 'Loading…',
  'common.addProvider': 'Add provider',
  'row.theme': 'Theme',
  'row.themeDescription': 'Choose how XR looks. The theme applies everywhere instantly.',
  'row.matchSystem': 'Match system',
  'row.density': 'Density',
  'row.fontSize': 'Body font size',
  'row.reduceMotion': 'Reduce motion',
  'row.glass': 'Glass effects',
  'row.glow': 'Glow effects',
  'row.launchAtLogin': 'Launch XR at login',
  'row.startMinimized': 'Start minimized to orb',
  'row.openTo': 'Open to',
  'row.language': 'UI language',
  'row.enableNotifications': 'Enable notifications',
  'row.quietHours': 'Quiet hours',
  'row.checkUpdates': 'Check for updates',
  'row.version': 'Version',
};

const ur: StringTable = {
  'tab.general': 'عمومی',
  'tab.appearance': 'ظاہری شکل',
  'tab.models': 'ماڈلز اور فراہم کنندگان',
  'tab.shortcuts': 'کی بورڈ شارٹ کٹس',
  'tab.notifications': 'اطلاعات',
  'tab.voice': 'آواز اور آڈیو',
  'tab.privacy': 'پرائیویسی اور ڈیٹا',
  'tab.updates': 'اپ ڈیٹس',
  'tab.about': 'XR کے بارے میں',
  'group.account': 'اکاؤنٹ',
  'group.app': 'ایپ',
  'group.preferences': 'ترجیحات',
  'group.privacy': 'پرائیویسی',
  'group.system': 'سسٹم',
  'settings.search': 'ترتیبات تلاش کریں',
  'settings.title': 'ترتیبات',
  'common.cancel': 'منسوخ',
  'common.save': 'محفوظ کریں',
  'common.edit': 'ترمیم',
  'common.test': 'آزمائیں',
  'common.reset': 'ری سیٹ',
  'common.remove': 'ہٹائیں',
  'common.default': '(پہلے سے طے شدہ)',
  'common.loading': 'لوڈ ہو رہا ہے…',
  'common.addProvider': 'فراہم کنندہ شامل کریں',
  'row.theme': 'تھیم',
  'row.themeDescription': 'منتخب کریں کہ XR کیسا دکھے۔ تھیم فوراً ہر جگہ لاگو ہوتی ہے۔',
  'row.matchSystem': 'سسٹم کے مطابق',
  'row.density': 'کثافت',
  'row.fontSize': 'متن کا حجم',
  'row.reduceMotion': 'حرکت کم کریں',
  'row.glass': 'شیشے کے اثرات',
  'row.glow': 'چمک کے اثرات',
  'row.launchAtLogin': 'لاگ اِن پر XR چالیں',
  'row.startMinimized': 'آرب پر شروع کریں',
  'row.openTo': 'کھولیں',
  'row.language': 'انٹرفیس کی زبان',
  'row.enableNotifications': 'اطلاعات فعال کریں',
  'row.quietHours': 'خاموشی کے اوقات',
  'row.checkUpdates': 'اپ ڈیٹس چیک کریں',
  'row.version': 'ورژن',
};

const es: StringTable = {
  'tab.general': 'General',
  'tab.appearance': 'Apariencia',
  'tab.models': 'Modelos y proveedores',
  'tab.shortcuts': 'Atajos de teclado',
  'tab.notifications': 'Notificaciones',
  'tab.voice': 'Voz y audio',
  'tab.privacy': 'Privacidad y datos',
  'tab.updates': 'Actualizaciones',
  'tab.about': 'Acerca de XR',
  'group.account': 'Cuenta',
  'group.app': 'Aplicación',
  'group.preferences': 'Preferencias',
  'group.privacy': 'Privacidad',
  'group.system': 'Sistema',
  'settings.search': 'Buscar ajustes',
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.edit': 'Editar',
  'common.test': 'Probar',
  'common.reset': 'Restablecer',
  'common.remove': 'Quitar',
  'common.default': '(Predeterminado)',
  'common.loading': 'Cargando…',
  'common.addProvider': 'Añadir proveedor',
  'row.theme': 'Tema',
  'row.themeDescription': 'Elige el aspecto de XR. Se aplica al instante en toda la app.',
  'row.matchSystem': 'Según el sistema',
  'row.density': 'Densidad',
  'row.fontSize': 'Tamaño del texto',
  'row.reduceMotion': 'Reducir movimiento',
  'row.glass': 'Efectos de cristal',
  'row.glow': 'Efectos de brillo',
  'row.launchAtLogin': 'Iniciar XR al iniciar sesión',
  'row.startMinimized': 'Iniciar minimizado en el orbe',
  'row.openTo': 'Abrir en',
  'row.language': 'Idioma de la interfaz',
  'row.enableNotifications': 'Activar notificaciones',
  'row.quietHours': 'Horas de silencio',
  'row.checkUpdates': 'Buscar actualizaciones',
  'row.version': 'Versión',
};

const fr: StringTable = {
  'tab.general': 'Général',
  'tab.appearance': 'Apparence',
  'tab.models': 'Modèles et fournisseurs',
  'tab.shortcuts': 'Raccourcis clavier',
  'tab.notifications': 'Notifications',
  'tab.voice': 'Voix et audio',
  'tab.privacy': 'Confidentialité et données',
  'tab.updates': 'Mises à jour',
  'tab.about': 'À propos de XR',
  'group.account': 'Compte',
  'group.app': 'Application',
  'group.preferences': 'Préférences',
  'group.privacy': 'Confidentialité',
  'group.system': 'Système',
  'settings.search': 'Rechercher dans les réglages',
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.edit': 'Modifier',
  'common.test': 'Tester',
  'common.reset': 'Réinitialiser',
  'common.remove': 'Retirer',
  'common.default': '(Par défaut)',
  'common.loading': 'Chargement…',
  'common.addProvider': 'Ajouter un fournisseur',
  'row.theme': 'Thème',
  'row.themeDescription': 'Choisissez l’apparence de XR. Appliquée instantanément partout.',
  'row.matchSystem': 'Suivre le système',
  'row.density': 'Densité',
  'row.fontSize': 'Taille du texte',
  'row.reduceMotion': 'Réduire les animations',
  'row.glass': 'Effets de verre',
  'row.glow': 'Effets lumineux',
  'row.launchAtLogin': 'Lancer XR à la connexion',
  'row.startMinimized': 'Démarrer réduit sur l’orbe',
  'row.openTo': 'Ouvrir sur',
  'row.language': 'Langue de l’interface',
  'row.enableNotifications': 'Activer les notifications',
  'row.quietHours': 'Heures calmes',
  'row.checkUpdates': 'Rechercher des mises à jour',
  'row.version': 'Version',
};

const zh: StringTable = {
  'tab.general': '通用',
  'tab.appearance': '外观',
  'tab.models': '模型与提供商',
  'tab.shortcuts': '键盘快捷键',
  'tab.notifications': '通知',
  'tab.voice': '语音与音频',
  'tab.privacy': '隐私与数据',
  'tab.updates': '更新',
  'tab.about': '关于 XR',
  'group.account': '账户',
  'group.app': '应用',
  'group.preferences': '偏好设置',
  'group.privacy': '隐私',
  'group.system': '系统',
  'settings.search': '搜索设置',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.edit': '编辑',
  'common.test': '测试',
  'common.reset': '重置',
  'common.remove': '移除',
  'common.default': '（默认）',
  'common.loading': '加载中…',
  'common.addProvider': '添加提供商',
  'row.theme': '主题',
  'row.themeDescription': '选择 XR 的外观，立即应用于整个应用。',
  'row.matchSystem': '跟随系统',
  'row.density': '密度',
  'row.fontSize': '正文字体大小',
  'row.reduceMotion': '减弱动态效果',
  'row.glass': '玻璃效果',
  'row.glow': '发光效果',
  'row.launchAtLogin': '登录时启动 XR',
  'row.startMinimized': '启动时最小化到悬浮球',
  'row.openTo': '打开至',
  'row.language': '界面语言',
  'row.enableNotifications': '启用通知',
  'row.quietHours': '免打扰时段',
  'row.checkUpdates': '检查更新',
  'row.version': '版本',
};

const TABLES: Record<LocaleId, StringTable> = { en, ur, es, fr, zh };

/* ── Store ──────────────────────────────────────────────────────────── */

interface I18nState {
  locale: LocaleId;
  setLocale: (locale: LocaleId) => void;
  applyRemote: (locale: LocaleId) => void;
}

function readInitialLocale(): LocaleId {
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    return isLocaleId(stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

function applyDocumentLocale(locale: LocaleId): void {
  const meta = LOCALES.find((l) => l.id === locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = meta?.rtl ? 'rtl' : 'ltr';
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: readInitialLocale(),

  setLocale: (locale) => {
    if (locale === get().locale) return;
    writeSettingRaw(LOCALE_KEY, locale);
    applyDocumentLocale(locale);
    set({ locale });
    void settingsChanged('locale', locale);
  },

  /** Cross-window `settings:changed` merge — no re-broadcast. */
  applyRemote: (locale) => {
    if (!isLocaleId(locale) || locale === get().locale) return;
    applyDocumentLocale(locale);
    set({ locale });
  },
}));

/** Translate a settings-surface key (English fallback, then the key). */
export function t(key: string): string {
  const { locale } = useI18nStore.getState();
  return TABLES[locale][key] ?? TABLES.en[key] ?? key;
}

/** Hook flavor for reactive components. */
export function useT(): (key: string) => string {
  const locale = useI18nStore((state) => state.locale);
  return (key: string) => TABLES[locale][key] ?? TABLES.en[key] ?? key;
}

/** Startup hydration from the durable store. */
export async function hydrateLocale(): Promise<void> {
  const { readSettingRaw } = await import('@/lib/persistent-store');
  const stored = await readSettingRaw(LOCALE_KEY);
  if (isLocaleId(stored)) {
    useI18nStore.getState().applyRemote(stored);
  } else {
    applyDocumentLocale(useI18nStore.getState().locale);
  }
}
