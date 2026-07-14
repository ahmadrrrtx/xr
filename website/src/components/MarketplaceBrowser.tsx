"use client";

import { useMemo, useState } from "react";
import { Download, Search as SearchIcon, Star, ExternalLink, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { marketplaceCategories, marketplaceItems, type MarketplaceItem } from "@/lib/data";
import { cn, formatNumber } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

type Tab = "all" | "skill" | "extension";

export function MarketplaceBrowser() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<"popular" | "rating" | "recent">("popular");
  const [selected, setSelected] = useState<MarketplaceItem | null>(null);

  const filtered = useMemo(() => {
    let items = marketplaceItems.filter((i) => {
      if (tab !== "all" && i.type !== tab) return false;
      if (cat !== "all" && i.category !== cat) return false;
      if (q && !`${i.name} ${i.tagline} ${i.description} ${i.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    if (sort === "rating") items = [...items].sort((a, b) => b.rating - a.rating);
    if (sort === "popular") items = [...items].sort((a, b) => b.downloads - a.downloads);
    return items;
  }, [q, cat, tab, sort]);

  return (
    <div>
      {/* Toolbar */}
      <div className="glass rounded-2xl p-3 md:p-4 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills, extensions, tags…"
              className="w-full bg-black/30 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-400/50 outline-none"
              aria-label="Search"
            />
          </div>
          <div className="flex items-center gap-2">
            <Segmented
              value={tab}
              onChange={(v) => setTab(v as Tab)}
              options={[
                { id: "all", label: "All" },
                { id: "skill", label: "Skills" },
                { id: "extension", label: "Extensions" },
              ]}
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "popular" | "rating" | "recent")}
              className="bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-violet-400/50"
              aria-label="Sort"
            >
              <option value="popular">Most popular</option>
              <option value="rating">Top rated</option>
              <option value="recent">Recently updated</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {marketplaceCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs transition-colors border",
                cat === c.id
                  ? "bg-white text-black border-white"
                  : "bg-white/[0.02] text-zinc-300 border-white/10 hover:border-white/20 hover:text-white"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((item) => (
          <ItemCard key={item.id} item={item} onOpen={() => setSelected(item)} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-20 text-zinc-500 text-sm">
            No items match your search.
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
    <div className="inline-flex p-1 rounded-xl bg-black/30 border border-white/10">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            value === o.id ? "bg-white text-black" : "text-zinc-300 hover:text-white"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ItemCard({ item, onOpen }: { item: MarketplaceItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="card p-5 text-left flex flex-col group"
    >
      <div className="flex items-start gap-3">
        <div
          className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
          style={{ background: item.iconBg }}
        >
          <item.icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="text-white font-semibold text-[15px] truncate">{item.name}</div>
            {item.verified && (
              <span title="Verified" aria-label="Verified">
                <CheckCircle2 className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 truncate">
            {item.type === "skill" ? "Skill" : "Extension"} · {item.author}
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm text-zinc-300 line-clamp-2 leading-relaxed">{item.tagline}</p>
      <div className="mt-4 flex flex-wrap gap-1">
        {item.tags.slice(0, 3).map((t) => (
          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/5">
            {t}
          </span>
        ))}
      </div>
      <div className="mt-5 pt-4 border-t border-white/5 flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
          {item.rating} <span className="text-zinc-600">({formatNumber(item.reviews)})</span>
        </span>
        <span className="flex items-center gap-1">
          <Download className="h-3.5 w-3.5" /> {item.installs}
        </span>
        <span className="ml-auto text-zinc-500">v{item.version}</span>
      </div>
    </button>
  );
}

function ItemModal({ item, onClose }: { item: MarketplaceItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto glass rounded-2xl p-6 md:p-8 shadow-2xl"
      >
        <div className="flex items-start gap-4">
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 shadow-xl"
            style={{ background: item.iconBg }}
          >
            <item.icon className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-xl font-semibold text-white">{item.name}</div>
              {item.verified && <CheckCircle2 className="h-4 w-4 text-sky-400" />}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              by {item.author} · {item.type === "skill" ? "Skill" : "Extension"}
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-zinc-400">
              <span className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" /> {item.rating} ({formatNumber(item.reviews)} reviews)
              </span>
              <span className="flex items-center gap-1">
                <Download className="h-3.5 w-3.5" /> {item.installs} installs
              </span>
              <span className="text-zinc-500">v{item.version}</span>
            </div>
          </div>
        </div>
        <p className="mt-6 text-zinc-300 leading-relaxed">{item.description}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <Info label="Version" value={item.version} />
          <Info label="Compatibility" value={item.compatibility} />
          <Info label="Updated" value={item.updated} />
          <Info label="Category" value={item.category} />
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {item.tags.map((t) => (
            <span key={t} className="text-[11px] px-2 py-1 rounded-full bg-white/5 text-zinc-400 border border-white/5">
              {t}
            </span>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-black/40 px-4 py-3 flex items-center gap-2 font-mono text-sm">
          <span className="text-violet-300 select-none">$</span>
          <code className="flex-1 text-zinc-100 truncate">{item.installCmd}</code>
          <CopyButton text={item.installCmd} />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn btn-primary">
            <Download className="h-4 w-4" /> Install
          </button>
          <Link href="/docs" className="btn btn-ghost">
            <ExternalLink className="h-4 w-4" /> Documentation
          </Link>
          <button onClick={onClose} className="btn btn-ghost ml-auto">Close</button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-zinc-200 text-sm mt-0.5">{value}</div>
    </div>
  );
}
