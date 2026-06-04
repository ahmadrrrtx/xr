// Utility functions placeholder
// Using clsx and tailwind-merge for className merging in production
export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}