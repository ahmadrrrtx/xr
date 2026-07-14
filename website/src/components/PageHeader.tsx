import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  center = true,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <section className="relative pt-36 pb-16 md:pt-44 md:pb-24 overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-60" aria-hidden />
      <div className="mx-auto max-w-7xl px-6 relative">
        <div className={cn(center ? "text-center max-w-3xl mx-auto" : "max-w-3xl")}>
          {eyebrow && (
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-4">
              {eyebrow}
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight text-gradient leading-[1.05]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-5 text-zinc-400 text-lg leading-relaxed">{subtitle}</p>
          )}
        </div>
      </div>
    </section>
  );
}
