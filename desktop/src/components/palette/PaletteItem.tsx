/*
 * One palette result row (Phase 5) — icon, title, subtitle, shortcut chip.
 * Display-only by design: the "Ask XR" and web-search rows are synthesized
 * and have no registry action. Selection styling rides cmdk's data-selected
 * attribute and the per-theme --palette-selected-* tokens (dark themes tint
 * the row, Paper/Arctic fill it — see themes.css).
 */
import type { LucideIcon } from 'lucide-react';

export interface PaletteItemProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  shortcut?: string;
}

export function PaletteItem({ icon: Icon, title, subtitle, shortcut }: PaletteItemProps) {
  return (
    <span data-testid="palette-item" className="flex h-10 items-center gap-3 px-3">
      <Icon
        size={18}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-text-secondary shrink-0"
      />
      <span className="text-text-primary min-w-0 flex-1 truncate text-[14px]">{title}</span>
      {subtitle ? (
        <span className="text-text-tertiary shrink-0 truncate text-[12px]">{subtitle}</span>
      ) : null}
      {shortcut ? (
        <kbd aria-hidden="true" className="xr-kbd text-text-tertiary shrink-0 font-mono text-[11px]">
          {shortcut}
        </kbd>
      ) : null}
    </span>
  );
}
