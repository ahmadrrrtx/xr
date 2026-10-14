import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Third-party notices",
  description: "Open-source fonts, icons and libraries XR is built with, and their licences.",
};

const NOTICES: ReadonlyArray<{ name: string; usedIn: string; license: string; href: string }> = [
  { name: "Inter", usedIn: "Website and desktop interface typeface", license: "SIL Open Font License 1.1", href: "https://rsms.me/inter/" },
  { name: "JetBrains Mono", usedIn: "Code and console typeface", license: "Apache License 2.0", href: "https://www.jetbrains.com/mono/" },
  { name: "Orbitron", usedIn: "Desktop logo and display accents", license: "SIL Open Font License 1.1", href: "https://fonts.google.com/specimen/Orbitron" },
  { name: "Lucide", usedIn: "Icon set across website, desktop and console", license: "ISC License", href: "https://lucide.dev" },
  { name: "Shiki", usedIn: "Syntax highlighting in desktop and mobile code views", license: "MIT License", href: "https://shiki.style" },
];

/**
 * `/legal/notices` (Phase 31 · Bucket B · B10) — the page form of
 * website/ATTRIBUTION.md. The desktop app ships its own full licence list
 * in Settings → About → Third-party licenses; this page covers the named
 * assets people ask about and mirrors the attribution file.
 */
export default function NoticesPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Legal</p>
        <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-native-text">
          Third-party notices
        </h1>
        <p className="mt-5 text-[14px] leading-relaxed text-native-text-muted">
          XR is built on other people&rsquo;s open work. The fonts, icons and libraries below are the
          named pieces; the desktop app lists its dependency licences in Settings → About →
          Third-party licenses, and every source repository carries its own licence file.
        </p>

        <div className="mt-12 space-y-px overflow-hidden rounded-xl border border-native-border bg-native-border">
          {NOTICES.map((n) => (
            <div key={n.name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-native-bg px-5 py-4">
              <span className="text-[13.5px] font-medium text-native-text">{n.name}</span>
              <span className="text-[12px] text-native-text-muted">{n.usedIn}</span>
              <span className="console-mono ml-auto text-[11px] text-native-text-dim">{n.license}</span>
              <a
                href={n.href}
                target="_blank"
                rel="noreferrer"
                className="console-mono text-[11px] text-native-cyan hover:underline"
              >
                {n.href.replace("https://", "")}
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
