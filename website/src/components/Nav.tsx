"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, Menu, X, ArrowRight } from "lucide-react";
import { GithubIcon } from "@/components/icons";
import { site } from "@/lib/site";
import { XrLogo } from "@/components/Logo";
import { cn } from "@/lib/utils";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Note: mobile menu is closed via onClick on each link (see below)
  // rather than an effect, to avoid cascading renders on route change.

  return (
    <header
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-300",
        scrolled ? "py-2" : "py-4"
      )}
    >
      <div className="mx-auto max-w-7xl px-5">
        <nav
          className={cn(
            "flex items-center justify-between rounded-full transition-all duration-300",
            scrolled
              ? "glass px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
              : "px-3 py-2"
          )}
          aria-label="Primary"
        >
          <div className="flex items-center gap-8">
            <Link href="/" className="pl-2">
              <XrLogo />
            </Link>
            <ul className="hidden md:flex items-center gap-1 text-[13.5px] text-zinc-300">
              <li
                className="relative"
                onMouseEnter={() => setProductsOpen(true)}
                onMouseLeave={() => setProductsOpen(false)}
              >
                <button
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full hover:text-white transition-colors"
                  aria-expanded={productsOpen}
                  aria-haspopup="true"
                >
                  Product <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {productsOpen && (
                  <div className="absolute top-full left-0 pt-2 w-[520px]">
                    <div className="glass rounded-2xl p-3 grid grid-cols-2 gap-1 shadow-2xl">
                      {[
                        { href: "/features", title: "Features", desc: "What XR can do" },
                        { href: "/marketplace", title: "Marketplace", desc: "Skills & extensions" },
                        { href: "/models", title: "Models", desc: "Every major model" },
                        { href: "/enterprise", title: "Enterprise", desc: "Security & scale" },
                        { href: "/security", title: "Security", desc: "Capability model" },
                        { href: "/downloads", title: "Downloads", desc: "CLI, editor builds" },
                      ].map((i) => (
                        <Link
                          key={i.href}
                          href={i.href}
                          onClick={() => { setProductsOpen(false); setOpen(false); }}
                          className="rounded-xl px-3 py-2 hover:bg-white/5 transition-colors"
                        >
                          <div className="text-white text-sm font-medium">{i.title}</div>
                          <div className="text-zinc-500 text-xs mt-0.5">{i.desc}</div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </li>
              {site.nav.slice(4).map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 rounded-full hover:text-white transition-colors"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <a
              href={site.github}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost !px-3"
              aria-label="GitHub"
            >
              <GithubIcon className="h-4 w-4" />
            </a>
            <Link href="/docs" className="btn btn-ghost">
              Docs
            </Link>
            <Link href="/downloads" className="btn btn-primary">
              Download <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <button
            className="md:hidden p-2 rounded-lg text-zinc-200"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>

        {open && (
          <div className="md:hidden mt-2 glass rounded-2xl p-3 shadow-2xl">
            <ul className="flex flex-col text-sm">
              {[
                { href: "/features", label: "Features" },
                { href: "/marketplace", label: "Marketplace" },
                { href: "/models", label: "Models" },
                { href: "/enterprise", label: "Enterprise" },
                { href: "/pricing", label: "Pricing" },
                { href: "/docs", label: "Docs" },
                { href: "/blog", label: "Blog" },
                { href: "/downloads", label: "Downloads" },
              ].map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2.5 rounded-lg hover:bg-white/5 text-zinc-200"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
              <li className="pt-2 mt-2 border-t border-white/5 flex gap-2 px-1">
                <Link href="/docs" className="btn btn-ghost flex-1">
                  Docs
                </Link>
                <Link href="/downloads" className="btn btn-primary flex-1">
                  Download
                </Link>
              </li>
            </ul>
          </div>
        )}
      </div>
    </header>
  );
}
