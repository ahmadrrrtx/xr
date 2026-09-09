"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search as SearchIcon,
  ExternalLink,
  ArrowRight,
  CheckCircle2,
  X,
} from "lucide-react";
import { marketplaceCategories, marketplaceItems, type MarketplaceItem } from "@/lib/data";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

type Tab = "all" | "skill" | "extension";

export function MarketplaceBrowser() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<MarketplaceItem | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of marketplaceItems) c[i.type] = (c[i.type] ?? 0) + 1;
    return c;
  }, []);

  const filtered = useMemo(() => {
    let items = marketplaceItems.filter((i) => {
      if (tab !== "all" && i.type !== tab) return false;
      if (cat !== "all" && i.category !== cat) return false;
      if (
        q &&
        !`${i.name} ${i.tagline} ${i.description} ${i.tags.join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase())
      )
        return false;
      return true;
    });
    return items;
  }, [q, cat, tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div>
      {/* Toolbar */}
      <div className="glass rounded-2xl p-3 shadow-[var(--shadow-card)] md:p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills, plugins, tags…"
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-9 pr-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-cyan-400/50 focus:shadow-[0_0_0_3px_rgba(0,212,255,0.08)]"
              aria-label="Search the marketplace"
            />
          </div>
          <Segmented
            value={tab}
            onChange={(v) => {
              setTab(v as Tab);
              setCat("all");
            }}
            options={[
              { id: "all", label: `All (${marketplaceItems.length})` },
              { id: "skill", label: `Skills (${counts.skill ?? 0})` },
              { id: "extension", label: `Plugins (${counts.extension ?? 0})` },
            ]}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {marketplaceCategories.map((c) => {
            const n = c.id === "all" ? filtered.length : undefined;
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-all",
                  cat === c.id
                    ? "border-cyan-400/40 bg-cyan-400/10 font-medium text-cyan-200 shadow-[0_0_16px_-4px_rgba(0,212,255,0.5)]"
                    : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/25 hover:text-zinc-100"
                )}
              >
                {c.label}
                {c.id !== "all" && (
                  <span className="ml-1.5 text-[10px] text-zinc-500">
                    {marketplaceItems.filter((i) => i.category === c.id).length}
                  </span>
                )}
                {c.id === "all" && n !== undefined && (
                  <span className="ml-1.5 text-[10px] text-zinc-500">{n}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Meta line */}
      <div className="mt-6 flex items-center justify-between text-xs text-zinc-500">
        <span>
          Generated from the real bundled inventory —{" "}
          <a
            href={`${site.github}/tree/main/skills`}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 hover:underline"
          >
            skills/
          </a>{" "}
          and{" "}
          <a
            href={`${site.github}/tree/main/plugins`}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 hover:underline"
          >
            plugins/
          </a>{" "}
          in the repository.
        </span>
        <span className="hidden sm:block">
          {filtered.length} item{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Grid */}
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <ItemCard key={item.id} item={item} onOpen={() => setSelected(item)} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-white/10 py-20 text-center text-sm text-zinc-500">
            No items match your search — try clearing filters.
          </div>
        )}
      </div>

      {selected && <ItemModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="inline-flex self-start rounded-xl border border-white/10 bg-black/30 p-1 md:self-auto">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            value === o.id
              ? "bg-white text-black shadow-[0_4px_14px_-4px_rgba(255,255,255,0.4)]"
              : "text-zinc-400 hover:text-white"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { skill: "Bundled skill", extension: "Reference plugin" };

function ItemCard({ item, onOpen }: { item: MarketplaceItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="card card-hover group flex flex-col p-5 text-left"
      aria-label={`Open details for ${item.name}`}
    >
      <div className="flex items-start gap-3.5">
        <div
          className="h-12 w-12 shrink-0 rounded-xl shadow-[0_8px_20px_-8px_rgba(0,0,0,0.7)] ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105"
          style={{ background: item.iconBg }}
        >
          <div className="flex h-full w-full items-center justify-center">
            <item.icon className="h-5 w-5 text-white drop-shadow" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-[15px] font-semibold text-white">{item.name}</div>
            {item.verified && (
              <span title="Official — ships with XR" aria-label="Official">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {TYPE_LABEL[item.type]} · {item.author}
          </div>
        </div>
      </div>
      <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-zinc-300">{item.tagline}</p>
      <div className="mt-4 flex flex-wrap gap-1">
        {item.tags.slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-full border border-white/6 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400"
          >
            {t}
          </span>
        ))}
        {item.tags.length === 0 && (
          <span className="rounded-full border border-white/6 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-500">
            {item.category}
          </span>
        )}
      </div>
      <div className="mt-5 flex items-center gap-3 border-t border-white/5 pt-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1 text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" /> Bundled with XR
        </span>
        <span className="text-zinc-600">v{item.version}</span>
        <span className="ml-auto font-mono text-zinc-500 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-cyan-300">
          details
        </span>
      </div>
    </button>
  );
}

function ItemModal({ item, onClose }: { item: MarketplaceItem; onClose: () => void }) {
  const sourcePath = item.type === "skill" ? `skills/${item.id}` : `plugins/${item.id}`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} details`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1117] p-6 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.04)] md:p-8"
      >
        <div className="flex items-start gap-4">
          <div
            className="h-14 w-14 shrink-0 rounded-2xl shadow-lg ring-1 ring-white/10"
            style={{ background: item.iconBg }}
          >
            <div className="flex h-full w-full items-center justify-center">
              <item.icon className="h-6 w-6 text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-xl font-semibold text-white">{item.name}</div>
              {item.verified && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {TYPE_LABEL[item.type]} by {item.author}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                Bundled with XR
              </span>
              <span className="font-mono text-[11px] text-zinc-500">v{item.version}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-6 leading-relaxed text-zinc-300">{item.description}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Type" value={TYPE_LABEL[item.type]} />
          <Info label="Category" value={item.category} />
          <Info label="Author" value={item.author} />
          <Info label="Version" value={item.version} />
        </div>

        {item.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {item.tags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-white/6 bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-white/8 bg-black/40 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            {item.type === "skill" ? "Inspect in your terminal" : "Explore with the CLI"}
          </div>
          <div className="mt-1.5 flex items-center gap-2 font-mono text-sm">
            <span className="select-none text-cyan-300">$</span>
            <code className="min-w-0 flex-1 truncate text-zinc-100">{item.installCmd}</code>
            <CopyButton text={item.installCmd} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <a
            href={`${site.github}/tree/main/${sourcePath}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            <ExternalLink className="h-4 w-4" /> Source on GitHub
          </a>
          <button onClick={onClose} className="btn btn-ghost ml-auto">
            Close
          </button>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <ArrowRight className="h-3 w-3 rotate-90 text-cyan-400/70" />
          Skills ship with XR — nothing here downloads at install time, and nothing is enabled
          until you say so.
        </p>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-sm text-zinc-200" title={value}>
        {value}
      </div>
    </div>
  );
}
