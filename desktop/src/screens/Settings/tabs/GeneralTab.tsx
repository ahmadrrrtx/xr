/*
 * Settings → General (Phase 8) — profile, startup, defaults, language, data.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';

import { Avatar } from '@/components/brand/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ConfirmDialog,
} from '@/components/settings/dialogs';
import { LabeledSlider, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { LOCALES, useI18nStore, useT } from '@/lib/i18n';
import {
  clearCache,
  exportAllData,
  getAutostart,
  importAllData,
  resetApp,
  restartApp,
  setAutostart,
} from '@/lib/settingsApi';
import { isTauri } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { useUIStore } from '@/stores/ui';

const MAX_AVATAR_BYTES = 1_500_000;

const BUDGETS = [
  { value: 'auto', label: 'Auto' },
  { value: '2', label: '$2 / month' },
  { value: '5', label: '$5 / month' },
  { value: '10', label: '$10 / month' },
  { value: '20', label: '$20 / month' },
  { value: '50', label: '$50 / month' },
  { value: 'custom', label: 'Custom' },
];

export function GeneralTab() {
  const t = useT();
  const navigate = useNavigate();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const userName = useUIStore((state) => state.userName);
  const setUserName = useUIStore((state) => state.setUserName);
  const locale = useI18nStore((state) => state.locale);
  const setLocale = useI18nStore((state) => state.setLocale);

  // Profile editor (inline, animated open/close).
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(userName);
  const [emailDraft, setEmailDraft] = useState(settings.profile.email);
  const [avatarDraft, setAvatarDraft] = useState(settings.profile.avatar);
  const fileRef = useRef<HTMLInputElement>(null);

  // Autostart truth comes from the OS (mirrored in settings for the browser).
  const [osAutostart, setOsAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void getAutostart().then((enabled) => {
      if (alive) setOsAutostart(enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const onPickPhoto = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Photo too large', {
        description: 'Pick an image under 1.5 MB.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarDraft(String(reader.result));
    reader.readAsDataURL(file);
  };

  const saveProfile = (): void => {
    const name = nameDraft.trim();
    setUserName(name.length > 0 ? name : 'You');
    update('profile', {
      email: emailDraft.trim(),
      avatar: avatarDraft,
    });
    setEditing(false);
  };

  const toggleAutostart = (enabled: boolean): void => {
    update('startup', { launchAtLogin: enabled });
    void setAutostart(enabled).then((ok) => {
      if (ok) {
        setOsAutostart(enabled);
      } else {
        update('startup', { launchAtLogin: !enabled });
        toast.error('Could not change launch-at-login', {
          description: 'Your OS refused the autostart change.',
        });
      }
    });
  };

  const providers = settings.models.providers;
  const hasProviders = providers.length > 0;

  return (
    <div>
      {/* ── Profile ── */}
      <SettingsSection>
        <div className="flex items-center gap-3.5 px-3.5 py-3">
          {settings.profile.avatar ? (
            <img
              src={settings.profile.avatar}
              alt=""
              className="border-border-subtle h-12 w-12 rounded-full border object-cover"
            />
          ) : (
            <Avatar size="lg" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-text-primary truncate text-sm font-semibold">
                {userName}
              </span>
              <Badge
                variant="outline"
                className="border-border-subtle text-text-tertiary text-[10px] tracking-[0.06em] uppercase"
              >
                {settings.profile.accountType === 'pro' ? 'Pro' : 'Personal'}
              </Badge>
            </div>
            <p className="text-text-tertiary truncate text-xs">
              {settings.profile.email || 'No email set'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Close' : t('common.edit')}
          </Button>
        </div>
        <AnimatePresence initial={false}>
          {editing ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="border-border-subtle border-t px-3.5 py-3.5">
                <div className="grid gap-3">
                  <div>
                    <label
                      htmlFor="xr-profile-name"
                      className="text-text-tertiary mb-1 block text-xs"
                    >
                      Display name
                    </label>
                    <Input
                      id="xr-profile-name"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      className="bg-bg-raised h-8"
                      placeholder="You"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="xr-profile-email"
                      className="text-text-tertiary mb-1 block text-xs"
                    >
                      Email
                    </label>
                    <Input
                      id="xr-profile-email"
                      type="email"
                      value={emailDraft}
                      onChange={(event) => setEmailDraft(event.target.value)}
                      className="bg-bg-raised h-8"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={onPickPhoto}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileRef.current?.click()}
                    >
                      Change photo
                    </Button>
                    {avatarDraft ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAvatarDraft(null)}
                      >
                        Remove photo
                      </Button>
                    ) : null}
                    <span className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={saveProfile}>
                      {t('common.save')}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SettingsSection>

      {/* ── Startup ── */}
      <SettingsSection title="Startup">
        <SettingRow
          label="Launch XR at login"
          htmlFor="xr-autostart"
          description="XR starts with your computer, minimized to the orb."
        >
          <Toggle
            id="xr-autostart"
            checked={osAutostart ?? settings.startup.launchAtLogin}
            onCheckedChange={toggleAutostart}
          />
        </SettingRow>
        <SettingRow
          label="Start minimized to orb"
          htmlFor="xr-start-minimized"
          description="Skip the main window; the orb is there when you need it."
        >
          <Toggle
            id="xr-start-minimized"
            checked={settings.startup.startMinimized}
            onCheckedChange={(v) => update('startup', { startMinimized: v })}
          />
        </SettingRow>
        <SettingRow label="Open to" htmlFor="xr-open-to">
          <Select
            value={settings.startup.openTo}
            onValueChange={(value) =>
              update('startup', {
                openTo: value as typeof settings.startup.openTo,
              })
            }
          >
            <SelectTrigger id="xr-open-to" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chat">Chat</SelectItem>
              <SelectItem value="last-session">Last session</SelectItem>
              <SelectItem value="workspaces">Workspaces</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsSection>

      {/* ── Defaults ── */}
      <SettingsSection title="Defaults">
        {hasProviders ? (
          <>
            <SettingRow label="Default model" htmlFor="xr-default-model">
              <Select
                value={settings.defaults.model || 'auto'}
                onValueChange={(value) =>
                  update('defaults', { model: value === 'auto' ? '' : value })
                }
              >
                <SelectTrigger id="xr-default-model" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (recommended)</SelectItem>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              label="Fallback model"
              htmlFor="xr-fallback-model"
              description="Used when the default model fails."
            >
              <Select
                value={settings.defaults.fallbackModel || 'none'}
                onValueChange={(value) =>
                  update('defaults', { fallbackModel: value === 'none' ? '' : value })
                }
              >
                <SelectTrigger id="xr-fallback-model" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </>
        ) : (
          <SettingRow
            label="Default model"
            description="No providers configured yet — models arrive with your first provider."
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/settings#models')}
            >
              {t('common.addProvider')}
            </Button>
          </SettingRow>
        )}
        <SettingRow
          label="Default workspace"
          htmlFor="xr-default-workspace"
          description="More workspaces arrive in Phase 10."
        >
          <Select
            value={settings.defaults.workspace}
            onValueChange={(value) => update('defaults', { workspace: value })}
          >
            <SelectTrigger id="xr-default-workspace" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="personal">Personal</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label="Default budget"
          htmlFor="xr-default-budget"
          description="Enforced by the Budget governor before every call. Fine-tune under Budget › Settings."
        >
          <Select
            value={settings.defaults.budget}
            onValueChange={(value) => {
              update('defaults', {
                budget: value as typeof settings.defaults.budget,
              });
              const limit =
                value === 'auto'
                  ? 5
                  : value === 'custom'
                    ? settings.defaults.budgetCustom
                    : Number(value);
              if (Number.isFinite(limit))
                void useBudgetStore.getState().updateSettings({ monthlyLimit: limit });
            }}
          >
            <SelectTrigger id="xr-default-budget" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUDGETS.map((budget) => (
                <SelectItem key={budget.value} value={budget.value}>
                  {budget.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {settings.defaults.budget === 'custom' ? (
          <SettingRow label="Custom monthly cap" htmlFor="xr-budget-custom">
            <LabeledSlider
              label="Custom monthly budget"
              min={1}
              max={200}
              value={settings.defaults.budgetCustom}
              onChange={(value) => {
                update('defaults', { budgetCustom: value });
                void useBudgetStore.getState().updateSettings({ monthlyLimit: value }, { quiet: true });
              }}
              format={(value) => `$${value}`}
            />
          </SettingRow>
        ) : null}
      </SettingsSection>

      {/* ── Language & region ── */}
      <SettingsSection title="Language & Region">
        <SettingRow
          label="UI language"
          htmlFor="xr-locale"
          description="The Settings surface translates today; the whole app follows in a later phase."
        >
          <Select value={locale} onValueChange={(value) => setLocale(value as typeof locale)}>
            <SelectTrigger id="xr-locale" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsSection>

      {/* ── Data ── */}
      <SettingsSection title="Data">
        <SettingRow label="Data folder" description="Everything XR stores on this machine.">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void import('@/lib/settingsApi').then((m) => m.revealDataFolder())}
          >
            Open data folder
          </Button>
        </SettingRow>
        <SettingRow
          label="Export all data"
          description="A zip of your settings and conversations."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              void exportAllData()
                .then((path) => {
                  if (path) {
                    toast.success('Data exported', { description: path });
                  } else {
                    toast('Export cancelled');
                  }
                })
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? 'Exporting…' : 'Export…'}
          </Button>
        </SettingRow>
        <SettingRow
          label="Import data"
          description="Restores a previous export over the current data."
        >
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            Import…
          </Button>
        </SettingRow>
        <SettingRow label="Cache" description="Thumbnails and webview caches. Safe to clear.">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!isTauri()) {
                toast('Cache clearing needs the desktop app');
                return;
              }
              void clearCache().then((bytes) => {
                const mb = (bytes / 1_000_000).toFixed(1);
                toast.success('Cache cleared', { description: `${mb} MB freed` });
              });
            }}
          >
            Clear cache
          </Button>
        </SettingRow>
        <SettingRow
          label="Reset XR to defaults"
          danger
          description="Erases every setting, remembered rule and conversation, then restarts."
        >
          <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
            Reset…
          </Button>
        </SettingRow>
      </SettingsSection>

      <ConfirmDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import data"
        body="This replaces your current settings and conversations with the contents of the export you pick. Continue with a saved .zip export file."
        confirmLabel="Choose file…"
        onConfirm={() => {
          setImportOpen(false);
          void importAllData().then((restored) => {
            if (!restored) {
              toast('Import cancelled');
              return;
            }
            toast.success('Data imported', {
              description: 'Restart XR to apply the imported data.',
              action: { label: 'Restart', onClick: () => void restartApp() },
            });
          });
        }}
      />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset XR to defaults"
        body="This erases all settings, remembered approval rules and conversations, then restarts the app. There is no undo."
        confirmLabel="Reset and restart"
        requireText="DELETE"
        busy={resetBusy}
        onConfirm={() => {
          setResetBusy(true);
          void resetApp(true);
        }}
      />
    </div>
  );
}
