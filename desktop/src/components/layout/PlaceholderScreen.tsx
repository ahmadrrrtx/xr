import { NAV_ITEMS } from '@/lib/nav';

/**
 * Phase-0 placeholder for every screen: a centered card naming the screen,
 * its delivery phase, and one honest line about what it will do.
 * No fake panels, no fake data (Constitution: truth in pixels).
 */
export function PlaceholderScreen({ id }: { id: string }) {
  const item = NAV_ITEMS.find((entry) => entry.id === id);
  if (!item) return null;
  const Icon = item.icon;

  return (
    <div className="border-border-subtle bg-bg-ink mx-auto my-20 max-w-md rounded-lg border p-8 text-center">
      <div className="bg-bg-raised text-accent mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-md">
        <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="text-text-primary text-2xl font-semibold">{item.label}</h2>
      <p className="text-text-tertiary mt-2 text-xs font-medium tracking-[0.08em] uppercase">
        Coming in Phase {item.phase}
      </p>
      <p className="text-text-secondary mt-4">{item.description}</p>
    </div>
  );
}
