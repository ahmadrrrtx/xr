import type { SVGProps } from "react";

/**
 * XR V2.1 icon set — Lucide-style 1.5px stroke, currentColor.
 * All icons share a 24px viewBox; use `width`/`height` to size.
 */

type IP = SVGProps<SVGSVGElement>;

const base = (p: IP) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const Icon = {
  Home: (p: IP) => (
    <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>
  ),
  Code: (p: IP) => (
    <svg {...base(p)}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
  ),
  Bolt: (p: IP) => (
    <svg {...base(p)}><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>
  ),
  Folder: (p: IP) => (
    <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
  ),
  Search: (p: IP) => (
    <svg {...base(p)}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
  ),
  Bot: (p: IP) => (
    <svg {...base(p)}><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4"/><circle cx="9" cy="13" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M9 17h6"/></svg>
  ),
  Book: (p: IP) => (
    <svg {...base(p)}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/></svg>
  ),
  Shield: (p: IP) => (
    <svg {...base(p)}><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></svg>
  ),
  Mic: (p: IP) => (
    <svg {...base(p)}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>
  ),
  Settings: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
  ),
  User: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
  ),
  Help: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>
  ),
  Send: (p: IP) => (
    <svg {...base(p)}><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
  ),
  Plus: (p: IP) => (
    <svg {...base(p)}><path d="M12 5v14M5 12h14"/></svg>
  ),
  X: (p: IP) => (
    <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12"/></svg>
  ),
  Check: (p: IP) => (
    <svg {...base(p)}><polyline points="20 6 9 17 4 12"/></svg>
  ),
  ChevronRight: (p: IP) => (
    <svg {...base(p)}><polyline points="9 18 15 12 9 6"/></svg>
  ),
  ChevronDown: (p: IP) => (
    <svg {...base(p)}><polyline points="6 9 12 15 18 9"/></svg>
  ),
  ChevronLeft: (p: IP) => (
    <svg {...base(p)}><polyline points="15 18 9 12 15 6"/></svg>
  ),
  Terminal: (p: IP) => (
    <svg {...base(p)}><polyline points="4 17 10 11 4 5"/><path d="M12 19h8"/></svg>
  ),
  GitBranch: (p: IP) => (
    <svg {...base(p)}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
  ),
  File: (p: IP) => (
    <svg {...base(p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  ),
  Files: (p: IP) => (
    <svg {...base(p)}><path d="M14 2H8a2 2 0 0 0-2 2v12"/><path d="M16 2h-4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6z"/></svg>
  ),
  Play: (p: IP) => (
    <svg {...base(p)}><polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/></svg>
  ),
  Pause: (p: IP) => (
    <svg {...base(p)}><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
  ),
  Square: (p: IP) => (
    <svg {...base(p)}><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>
  ),
  Stop: (p: IP) => (
    <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
  ),
  AlertTriangle: (p: IP) => (
    <svg {...base(p)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>
  ),
  Info: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9"/><path d="M12 8v.01"/><path d="M11 12h1v4h1"/></svg>
  ),
  Clock: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
  ),
  Download: (p: IP) => (
    <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/></svg>
  ),
  Upload: (p: IP) => (
    <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><path d="M12 3v12"/></svg>
  ),
  Trash: (p: IP) => (
    <svg {...base(p)}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
  ),
  Edit: (p: IP) => (
    <svg {...base(p)}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
  ),
  Refresh: (p: IP) => (
    <svg {...base(p)}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0 0 20.5 15"/></svg>
  ),
  More: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/></svg>
  ),
  Pin: (p: IP) => (
    <svg {...base(p)}><path d="M12 17v5"/><path d="M9 10.8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5.8l2.3 3.2H6.7z"/></svg>
  ),
  Paperclip: (p: IP) => (
    <svg {...base(p)}><path d="M21.4 11 12.7 19.7a5.5 5.5 0 0 1-7.8-7.8l8.7-8.7a3.7 3.7 0 0 1 5.2 5.2L10.1 17a1.8 1.8 0 1 1-2.6-2.6l8-8"/></svg>
  ),
  Sparkles: (p: IP) => (
    <svg {...base(p)}><path d="m12 3-1.9 4.6L5.5 9.5l4.6 1.9L12 16l1.9-4.6 4.6-1.9-4.6-1.9z"/><path d="M5 3v2M3 4h4M19 17v2M18 18h2"/></svg>
  ),
  Globe: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
  ),
  Wallet: (p: IP) => (
    <svg {...base(p)}><path d="M20 12V8H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>
  ),
  Bell: (p: IP) => (
    <svg {...base(p)}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>
  ),
  Activity: (p: IP) => (
    <svg {...base(p)}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  ),
  Layers: (p: IP) => (
    <svg {...base(p)}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
  ),
  PanelRight: (p: IP) => (
    <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>
  ),
  PanelBottom: (p: IP) => (
    <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15h18"/></svg>
  ),
  Menu: (p: IP) => (
    <svg {...base(p)}><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
  ),
  Device: {
    Desktop: (p: IP) => (
      <svg {...base(p)}><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    ),
    Tablet: (p: IP) => (
      <svg {...base(p)}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>
    ),
    Mobile: (p: IP) => (
      <svg {...base(p)}><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/></svg>
    ),
  },
  ExternalLink: (p: IP) => (
    <svg {...base(p)}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
  ),
  Eye: (p: IP) => (
    <svg {...base(p)}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  EyeOff: (p: IP) => (
    <svg {...base(p)}><path d="M17.9 17.9A10.5 10.5 0 0 1 12 19c-6 0-10-7-10-7a18 18 0 0 1 4-4.9M9.9 4.2A10 10 0 0 1 12 4c6 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/></svg>
  ),
  Minus: (p: IP) => (
    <svg {...base(p)}><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
  Grip: (p: IP) => (
    <svg {...base(p)}><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></svg>
  ),
  Loader: (p: IP) => (
    <svg {...base(p)}><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
  ),
  Dashboard: (p: IP) => (
    <svg {...base(p)}><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
  ),
  History: (p: IP) => (
    <svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
  ),
  Cpu: (p: IP) => (
    <svg {...base(p)}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
  ),
  RotateCw: (p: IP) => (
    <svg {...base(p)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
  ),
  StopCircle: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/></svg>
  ),
  Copy: (p: IP) => (
    <svg {...base(p)}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
  ),
  Wrench: (p: IP) => (
    <svg {...base(p)}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/></svg>
  ),
  Plug: (p: IP) => (
    <svg {...base(p)}><path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/></svg>
  ),
  PanelLeft: (p: IP) => (
    <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
  ),
  Maximize2: (p: IP) => (
    <svg {...base(p)}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
  ),
  List: (p: IP) => (
    <svg {...base(p)}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
  ),
  Bookmark: (p: IP) => (
    <svg {...base(p)}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
  ),
  Database: (p: IP) => (
    <svg {...base(p)}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
  ),
  ArrowLeft: (p: IP) => (
    <svg {...base(p)}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  Users: (p: IP) => (
    <svg {...base(p)}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  Crosshair: (p: IP) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/>
    </svg>
  ),
};

export type IconName = keyof typeof Icon;
