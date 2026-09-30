import { THEME_LABELS, THEMES, useThemeStore } from '@/stores/theme';
import { cn } from '@/lib/utils';

/**
 * Dev-only theme switcher (Phase 0). Phase 8 replaces this with the real
 * Settings → Appearance section (swatches, live preview, "match system").
 * Keyboard: Cmd/Ctrl+Shift+T cycles themes from anywhere.
 */
export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div className="border-border-subtle bg-bg-ink mx-auto mt-8 max-w-md rounded-lg border p-6">
      <p className="text-text-tertiary text-xs font-medium tracking-[0.08em] uppercase">
        Dev tools
      </p>
      <h3 className="text-text-primary mt-1 text-lg font-semibold">Theme</h3>
      <p className="text-text-secondary mt-1 text-sm">
        Active: <span className="text-accent">{THEME_LABELS[theme]}</span> ·
        switch with{' '}
        <kbd className="border-border-default bg-bg-raised rounded-sm border px-1.5 py-0.5 font-mono text-xs">
          Cmd/Ctrl+Shift+T
        </kbd>
      </p>
      <div
        className="mt-4 flex flex-wrap gap-2"
        role="group"
        aria-label="Theme"
      >
        {THEMES.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={theme === id}
            onClick={() => setTheme(id)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm',
              theme === id
                ? 'border-accent text-accent'
                : 'border-border-default text-text-secondary hover:text-text-primary'
            )}
          >
            {THEME_LABELS[id]}
          </button>
        ))}
      </div>
    </div>
  );
}
