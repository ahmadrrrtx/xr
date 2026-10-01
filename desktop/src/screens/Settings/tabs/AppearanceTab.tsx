/*
 * Settings → Appearance (Phase 8) — theme swatches, sidebar, density,
 * typography, motion & effects. Every control applies instantly, app-wide,
 * through CSS variables and the theme store (no reload, no flash).
 */
import { ThemeSwatch } from '@/components/settings/dialogs';
import { Segmented, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { useT } from '@/lib/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSidebarStore } from '@/stores/sidebar';
import { THEME_LABELS, THEMES, useThemeStore } from '@/stores/theme';

export function AppearanceTab() {
  const t = useT();
  const appearance = useSettingsStore((state) => state.settings.appearance);
  const update = useSettingsStore((state) => state.update);
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const sidebarCollapsed = useSidebarStore((state) => state.collapsed);
  const setSidebarCollapsed = useSidebarStore((state) => state.setCollapsed);

  return (
    <div>
      {/* ── Theme ── */}
      <SettingsSection>
        <div className="px-3.5 py-3.5">
          <p className="text-text-primary text-sm font-semibold">{t('row.theme')}</p>
          <p className="text-text-tertiary mt-0.5 text-xs">
            {t('row.themeDescription')}
          </p>
          <div
            role="radiogroup"
            aria-label={t('row.theme')}
            className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-4"
          >
            {THEMES.map((theme) => (
              <ThemeSwatch
                key={theme}
                id={theme}
                label={THEME_LABELS[theme]}
                selected={preference === theme}
                onSelect={setPreference}
              />
            ))}
            <ThemeSwatch
              id="system"
              label={t('row.matchSystem')}
              selected={preference === 'system'}
              onSelect={setPreference}
            />
          </div>
        </div>
      </SettingsSection>

      {/* ── Sidebar ── */}
      <SettingsSection title="Sidebar">
        <SettingRow label="Default sidebar state" description="Takes effect immediately and persists.">
          <Segmented
            ariaLabel="Default sidebar state"
            value={sidebarCollapsed ? 'collapsed' : 'expanded'}
            options={[
              { value: 'expanded', label: 'Expanded' },
              { value: 'collapsed', label: 'Collapsed' },
            ]}
            onChange={(value) => setSidebarCollapsed(value === 'collapsed')}
          />
        </SettingRow>
        <SettingRow label="Sidebar icon size" htmlFor="xr-icon-size">
          <Segmented
            ariaLabel="Sidebar icon size"
            value={appearance.iconSize}
            options={[
              { value: 's', label: 'S' },
              { value: 'm', label: 'M' },
              { value: 'l', label: 'L' },
            ]}
            onChange={(value) => update('appearance', { iconSize: value })}
          />
        </SettingRow>
      </SettingsSection>

      {/* ── Density ── */}
      <SettingsSection title="Density">
        <SettingRow
          label={t('row.density')}
          description="Row heights and padding across the sidebar, chat and settings."
        >
          <Segmented
            ariaLabel={t('row.density')}
            value={appearance.density}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'spacious', label: 'Spacious' },
            ]}
            onChange={(value) => update('appearance', { density: value })}
          />
        </SettingRow>
      </SettingsSection>

      {/* ── Typography ── */}
      <SettingsSection title="Typography">
        <SettingRow
          label={t('row.fontSize')}
          htmlFor="xr-font-size"
          description="Body text everywhere — labels and code scale with it."
        >
          <Segmented
            ariaLabel={t('row.fontSize')}
            value={String(appearance.fontSize)}
            options={[
              { value: '12', label: '12' },
              { value: '13', label: '13' },
              { value: '14', label: '14' },
              { value: '15', label: '15' },
              { value: '16', label: '16' },
            ]}
            onChange={(value) =>
              update('appearance', {
                fontSize: Number.parseInt(value, 10) as typeof appearance.fontSize,
              })
            }
          />
        </SettingRow>
        <SettingRow label="Code font" description="JetBrains Mono, built in. Model names, code and shortcuts use it.">
          <span className="text-text-tertiary font-mono text-xs">Mono</span>
        </SettingRow>
      </SettingsSection>

      {/* ── Motion & effects ── */}
      <SettingsSection title="Motion & Effects">
        <SettingRow
          label={t('row.reduceMotion')}
          htmlFor="xr-reduce-motion"
          description="In addition to your OS setting. Fades only, no slides or glows."
        >
          <Toggle
            id="xr-reduce-motion"
            checked={appearance.reduceMotion}
            onCheckedChange={(v) => update('appearance', { reduceMotion: v })}
          />
        </SettingRow>
        <SettingRow
          label={t('row.glass')}
          htmlFor="xr-glass"
          description="Backdrop blur on the palette and popovers. Turn off for maximum performance."
        >
          <Toggle
            id="xr-glass"
            checked={appearance.glass}
            onCheckedChange={(v) => update('appearance', { glass: v })}
          />
        </SettingRow>
        <SettingRow
          label={t('row.glow')}
          htmlFor="xr-glow"
          description="Cyan glow shadows on active elements. Flat borders replace them when off."
        >
          <Toggle
            id="xr-glow"
            checked={appearance.glow}
            onCheckedChange={(v) => update('appearance', { glow: v })}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
