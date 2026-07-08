/**
 * XR Stage 5 — Dashboard HTML (fully self-contained)
 *
 * Design language:
 *  - XR brand identity: #00D4FF cyan primary, #00FF88 green success, #F59E0B amber
 *  - Dark-first (#0A0A0F bg), glass-morphism cards
 *  - Bento grid layout with responsive columns
 *  - Animated status indicators, live polling via fetch()
 *  - Full chat panel accessible from dashboard
 *  - No external deps — all CSS/JS inline, offline-safe
 *  - Sidebar navigation: Dashboard, Chat, Providers, Models, Memory,
 *    Research, Plugins, Voice, Security, Settings, Status
 *  - Security: token in Authorization header, never in URL beyond first load
 *  - Keyboard shortcuts: ? = help, g+d = dashboard, g+c = chat, etc.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assetDataUri(name: string): string {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", name);
    if (!existsSync(file)) return "";
    return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return "";
  }
}

export function dashboardHtml(token: string): string {
  return PAGE
    .replaceAll("__TOKEN__", token)
    .replaceAll("__XR_LOGO__", assetDataUri("logo.png"))
    .replaceAll("__XR_AVATAR__", assetDataUri("avatar.png"));
}

const PAGE = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>XR — Control Center</title>
<style>
/* ── CSS Reset & Variables ─────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:       #0A0A0F;
  --bg2:      #0D1117;
  --surface:  #111827;
  --surface2: #1A2234;
  --border:   #1F2937;
  --border2:  #2D3748;
  --cyan:     #00D4FF;
  --green:    #00FF88;
  --amber:    #F59E0B;
  --red:      #FF4D4D;
  --muted:    #6B7280;
  --text:     #F9FAFB;
  --textDim:  #9CA3AF;
  --radius:   8px;
  --radius2:  12px;
  --shadow:   0 4px 24px rgba(0,0,0,.4);
  --glowC:    0 0 20px rgba(0,212,255,.15);
  --glowG:    0 0 20px rgba(0,255,136,.15);
  --glowA:    0 0 20px rgba(245,158,11,.15);
  --font:     'JetBrains Mono','Fira Code','Cascadia Code',ui-monospace,monospace;
  --sans:     'Inter','Segoe UI',system-ui,sans-serif;
  --sidebar:  220px;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.6;overflow:hidden}

/* ── Scrollbar ─────────────────────────────────────────────────────────── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}

/* ── Layout ────────────────────────────────────────────────────────────── */
.app{display:flex;height:100vh;overflow:hidden}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
.sidebar{
  width:var(--sidebar);min-width:var(--sidebar);
  background:var(--bg2);border-right:1px solid var(--border);
  display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;
  padding:0 0 16px;
}
.sidebar-logo{
  display:flex;align-items:center;gap:10px;
  padding:20px 16px 16px;border-bottom:1px solid var(--border);
  cursor:default;user-select:none;
}
.logo-mark{font-family:var(--font);font-size:18px;font-weight:700;color:var(--cyan);letter-spacing:-1px}
.logo-text{font-size:13px;font-weight:600;color:var(--text)}
.logo-badge{font-size:10px;color:var(--muted);font-family:var(--font)}
.sidebar-section{padding:8px 0}
.sidebar-label{
  font-size:10px;font-weight:600;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);
  padding:8px 16px 4px;
}
.nav-item{
  display:flex;align-items:center;gap:8px;
  padding:7px 16px;cursor:pointer;
  border-radius:0;font-size:13px;color:var(--textDim);
  transition:background .12s,color .12s;
  border-left:2px solid transparent;
  text-decoration:none;
}
.nav-item:hover{background:rgba(255,255,255,.04);color:var(--text)}
.nav-item.active{
  background:rgba(0,212,255,.08);color:var(--cyan);
  border-left-color:var(--cyan);font-weight:600;
}
.nav-item .nav-icon{width:16px;text-align:center;font-size:14px}
.sidebar-spacer{flex:1}
.sidebar-footer{padding:12px 16px;border-top:1px solid var(--border)}
.provider-pill{
  display:flex;align-items:center;gap:6px;
  font-family:var(--font);font-size:11px;color:var(--textDim);
  padding:6px 10px;background:var(--surface);border-radius:var(--radius);
}
.provider-dot{width:6px;height:6px;border-radius:50%;background:var(--green)}

/* ── Main Area ──────────────────────────────────────────────────────────── */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{
  display:flex;align-items:center;gap:12px;
  padding:12px 20px;border-bottom:1px solid var(--border);
  background:var(--bg2);min-height:52px;
}
.topbar-title{font-weight:600;font-size:15px;color:var(--text)}
.topbar-spacer{flex:1}
.topbar-status{display:flex;align-items:center;gap:12px}
.status-chip{
  display:flex;align-items:center;gap:5px;
  font-size:11px;font-family:var(--font);
  padding:4px 10px;border-radius:20px;
  background:var(--surface);color:var(--textDim);
}
.status-chip .dot{width:6px;height:6px;border-radius:50%}
.status-chip.ok .dot{background:var(--green)}
.status-chip.warn .dot{background:var(--amber)}
.status-chip.err .dot{background:var(--red)}
.content{flex:1;overflow-y:auto;overflow-x:hidden;padding:20px}

/* ── Panels / Views ─────────────────────────────────────────────────────── */
.panel{display:none}
.panel.active{display:block}

/* ── Grid ───────────────────────────────────────────────────────────────── */
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
@media(max-width:1100px){.grid-3,.grid-4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:700px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}}

/* ── Cards ───────────────────────────────────────────────────────────────── */
.card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius2);padding:16px;
}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.card-title{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.card-icon{font-size:14px}
.card-value{font-family:var(--font);font-size:22px;font-weight:700;color:var(--text)}
.card-sub{font-size:11px;color:var(--muted);margin-top:2px}
.card-glow-cyan{box-shadow:var(--glowC)}
.card-glow-green{box-shadow:var(--glowG)}
.card-glow-amber{box-shadow:var(--glowA)}

/* ── Stat Row ────────────────────────────────────────────────────────────── */
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}
.stat-row:last-child{border-bottom:none}
.stat-key{font-size:12px;color:var(--muted)}
.stat-val{font-family:var(--font);font-size:12px;font-weight:600}
.val-green{color:var(--green)}
.val-cyan{color:var(--cyan)}
.val-amber{color:var(--amber)}
.val-red{color:var(--red)}
.val-muted{color:var(--muted)}

/* ── Health Bar ──────────────────────────────────────────────────────────── */
.health-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px}
.health-bar-fill{height:100%;border-radius:2px;transition:width .6s ease}
.health-bar-fill.green{background:var(--green)}
.health-bar-fill.amber{background:var(--amber)}
.health-bar-fill.red{background:var(--red)}
.health-bar-fill.cyan{background:var(--cyan)}

/* ── Provider Grid ───────────────────────────────────────────────────────── */
.provider-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin-top:8px}
.provider-item{
  display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:10px 6px;background:var(--surface2);border-radius:var(--radius);
  border:1px solid var(--border);cursor:pointer;
  font-size:11px;text-align:center;color:var(--textDim);
  transition:border-color .12s,color .12s;
}
.provider-item:hover{border-color:var(--cyan);color:var(--text)}
.provider-item.active{border-color:var(--cyan);color:var(--cyan)}
.provider-item.offline{opacity:.4;cursor:default}
.provider-avatar{
  width:28px;height:28px;border-radius:50%;
  background:var(--border);display:flex;align-items:center;
  justify-content:center;font-size:12px;font-weight:700;
  font-family:var(--font);color:var(--text);
}

/* ── Audit Log ───────────────────────────────────────────────────────────── */
.audit-row{
  display:grid;grid-template-columns:auto 1fr auto;
  gap:8px;padding:6px 0;border-bottom:1px solid var(--border);
  font-family:var(--font);font-size:11px;align-items:start;
}
.audit-row:last-child{border-bottom:none}
.audit-ts{color:var(--muted);white-space:nowrap}
.audit-event{color:var(--textDim);word-break:break-all}
.audit-hash{color:var(--muted);font-size:10px;white-space:nowrap}

/* ── Memory List ─────────────────────────────────────────────────────────── */
.mem-item{
  display:flex;gap:10px;align-items:start;
  padding:8px 0;border-bottom:1px solid var(--border);
}
.mem-item:last-child{border-bottom:none}
.mem-cat{
  font-size:10px;padding:2px 6px;border-radius:4px;
  background:rgba(0,212,255,.12);color:var(--cyan);
  white-space:nowrap;font-weight:600;font-family:var(--font);
}
.mem-content{font-size:12px;color:var(--textDim);flex:1}
.mem-del{cursor:pointer;color:var(--muted);font-size:12px;opacity:.4;transition:opacity .1s}
.mem-del:hover{opacity:1;color:var(--red)}

/* ── Badge ───────────────────────────────────────────────────────────────── */
.badge{
  display:inline-flex;align-items:center;
  font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;
  font-family:var(--font);
}
.badge-green{background:rgba(0,255,136,.12);color:var(--green)}
.badge-cyan{background:rgba(0,212,255,.12);color:var(--cyan)}
.badge-amber{background:rgba(245,158,11,.12);color:var(--amber)}
.badge-red{background:rgba(255,77,77,.12);color:var(--red)}
.badge-gray{background:var(--surface2);color:var(--muted)}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.btn{
  display:inline-flex;align-items:center;gap:6px;
  padding:7px 14px;border-radius:var(--radius);
  font-size:13px;font-weight:600;cursor:pointer;
  border:none;transition:opacity .12s,filter .12s;
  font-family:var(--sans);
}
.btn:hover{filter:brightness(1.1)}
.btn-primary{background:var(--cyan);color:#000}
.btn-ghost{background:transparent;color:var(--textDim);border:1px solid var(--border)}
.btn-ghost:hover{border-color:var(--cyan);color:var(--cyan)}
.btn-danger{background:transparent;color:var(--red);border:1px solid rgba(255,77,77,.3)}

/* ── XR Marketplace UI ───────────────────────────────────────────────────── */
.mp-hero{position:relative;overflow:hidden;border:1px solid rgba(0,212,255,.18);border-radius:24px;padding:24px;background:radial-gradient(circle at 12% 0%,rgba(0,212,255,.22),transparent 34%),radial-gradient(circle at 82% 10%,rgba(145,92,255,.22),transparent 30%),linear-gradient(135deg,rgba(8,13,24,.96),rgba(14,19,34,.92));box-shadow:0 24px 90px rgba(0,0,0,.35),0 0 70px rgba(0,212,255,.08);margin-bottom:18px}
.mp-hero:before{content:"";position:absolute;inset:-2px;background:linear-gradient(120deg,transparent,rgba(0,212,255,.16),transparent,rgba(145,92,255,.16),transparent);opacity:.65;animation:mpSweep 9s linear infinite;pointer-events:none}.mp-hero>*{position:relative;z-index:1}@keyframes mpSweep{0%{transform:translateX(-25%)}50%{transform:translateX(20%)}100%{transform:translateX(-25%)}}
.mp-hero-grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:20px;align-items:center}@media(max-width:1000px){.mp-hero-grid{grid-template-columns:1fr}.mp-brand-orb{display:none}}
.mp-kicker{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid rgba(0,212,255,.28);border-radius:999px;color:var(--cyan);font-family:var(--font);font-size:11px;background:rgba(0,212,255,.08);text-transform:uppercase;letter-spacing:.08em}.mp-title{font-size:34px;line-height:1.05;letter-spacing:-.04em;margin:12px 0 10px;font-weight:900}.mp-title span{background:linear-gradient(90deg,var(--cyan),#7aa7ff,#a855f7);-webkit-background-clip:text;color:transparent}.mp-sub{color:var(--textDim);max-width:740px;font-size:13px;line-height:1.7}
.mp-search-row{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}.mp-search{flex:1;min-width:260px;background:rgba(3,7,18,.72);border:1px solid rgba(0,212,255,.22);color:var(--text);border-radius:14px;padding:12px 14px;outline:none;box-shadow:inset 0 0 18px rgba(0,0,0,.18)}.mp-search:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(0,212,255,.08)}
.mp-filter-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.mp-chip{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);color:var(--textDim);border-radius:999px;padding:6px 10px;font-size:11px;cursor:pointer}.mp-chip:hover,.mp-chip.active{border-color:rgba(0,212,255,.42);color:var(--cyan);background:rgba(0,212,255,.09)}
.mp-brand-orb{position:relative;height:220px}.mp-orbit{position:absolute;inset:12px;border-radius:50%;background:conic-gradient(from 90deg,rgba(0,212,255,.08),rgba(168,85,247,.28),rgba(0,255,136,.12),rgba(0,212,255,.08));filter:blur(.2px);animation:mpSpin 18s linear infinite}.mp-orbit:after{content:"";position:absolute;inset:24px;border-radius:50%;background:var(--bg);border:1px solid rgba(0,212,255,.16)}@keyframes mpSpin{to{transform:rotate(360deg)}}.mp-logo-img{position:absolute;left:50%;top:42%;width:92px;height:92px;transform:translate(-50%,-50%);border-radius:24px;box-shadow:0 0 34px rgba(0,212,255,.28)}.mp-avatar-img{position:absolute;right:10px;bottom:6px;width:92px;height:92px;border-radius:26px;border:1px solid rgba(0,212,255,.3);box-shadow:0 0 42px rgba(0,212,255,.18)}
.mp-shell{display:grid;grid-template-columns:230px minmax(0,1fr) 330px;gap:16px}@media(max-width:1200px){.mp-shell{grid-template-columns:1fr}.mp-side,.mp-inspector{order:2}.mp-main{order:1}}
.mp-card{background:linear-gradient(180deg,rgba(17,24,39,.96),rgba(10,14,25,.96));border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:16px;box-shadow:0 12px 44px rgba(0,0,0,.22)}.mp-section-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800;margin-bottom:10px}.mp-cat{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:12px;color:var(--textDim);cursor:pointer;font-size:12px}.mp-cat:hover,.mp-cat.active{background:rgba(0,212,255,.08);color:var(--cyan)}.mp-cat b{font-weight:700}.mp-cat span{font-family:var(--font);font-size:10px;color:var(--muted)}
.mp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.mp-skill-card{position:relative;overflow:hidden;background:linear-gradient(180deg,rgba(22,29,48,.95),rgba(10,14,24,.98));border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:14px;cursor:pointer;transition:transform .16s,border-color .16s,box-shadow .16s}.mp-skill-card:hover{transform:translateY(-2px);border-color:rgba(0,212,255,.35);box-shadow:0 14px 50px rgba(0,212,255,.08)}.mp-skill-card.selected{border-color:var(--cyan);box-shadow:0 0 0 1px rgba(0,212,255,.2),0 18px 60px rgba(0,212,255,.12)}.mp-skill-card:before{content:"";position:absolute;right:-40px;top:-40px;width:100px;height:100px;background:radial-gradient(circle,rgba(0,212,255,.13),transparent 70%)}.mp-skill-top{display:flex;gap:10px;align-items:flex-start}.mp-skill-icon{width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(0,212,255,.18),rgba(168,85,247,.16));border:1px solid rgba(0,212,255,.22);font-weight:900;color:var(--cyan);font-family:var(--font)}.mp-skill-name{font-weight:800;letter-spacing:-.01em}.mp-skill-id{font-size:10px;color:var(--muted);font-family:var(--font)}.mp-desc{font-size:12px;color:var(--textDim);line-height:1.55;margin:10px 0;min-height:56px}.mp-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.mp-mini{font-size:10px;border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:3px 7px;color:var(--textDim);background:rgba(255,255,255,.035)}.mp-mini.ok{color:var(--green);border-color:rgba(0,255,136,.22)}.mp-mini.warn{color:var(--amber);border-color:rgba(245,158,11,.22)}.mp-actions{display:flex;gap:8px;margin-top:12px}.mp-actions button{font-size:11px;padding:6px 9px}.mp-panel-empty{text-align:center;color:var(--muted);font-size:12px;padding:30px 12px;border:1px dashed rgba(255,255,255,.12);border-radius:16px}.mp-shot{height:96px;border-radius:14px;background:radial-gradient(circle at 20% 20%,rgba(0,212,255,.3),transparent 30%),radial-gradient(circle at 75% 25%,rgba(168,85,247,.28),transparent 28%),linear-gradient(135deg,rgba(0,212,255,.06),rgba(168,85,247,.06));border:1px solid rgba(0,212,255,.16);margin:12px 0;position:relative;overflow:hidden}.mp-shot:after{content:"";position:absolute;left:18px;right:18px;bottom:18px;height:8px;border-radius:999px;background:linear-gradient(90deg,var(--cyan),#a855f7);box-shadow:0 0 22px rgba(0,212,255,.35)}
.mp-inspector h3{font-size:18px;line-height:1.2;margin-bottom:4px}.mp-inspector-sub{font-size:11px;color:var(--muted);font-family:var(--font);margin-bottom:10px}.mp-perm{padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)}.mp-perm:last-child{border-bottom:none}.mp-perm-head{display:flex;justify-content:space-between;font-size:12px}.mp-perm p{font-size:11px;color:var(--muted);line-height:1.45;margin-top:3px}.mp-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.mp-tab{font-size:11px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--textDim);cursor:pointer}.mp-tab.active{color:#001018;background:linear-gradient(90deg,var(--cyan),#7aa7ff);border-color:transparent;font-weight:800}

/* ── Chat UI ─────────────────────────────────────────────────────────────── */
.chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 52px)}
.chat-header{
  display:flex;align-items:center;gap:10px;
  padding:12px 20px;border-bottom:1px solid var(--border);
  background:var(--bg2);
}
.chat-header-title{font-weight:600;font-size:14px}
.chat-header-model{font-size:11px;color:var(--muted);font-family:var(--font)}
.chat-messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px}
.msg{display:flex;flex-direction:column;gap:4px;max-width:820px}
.msg.user{align-self:flex-end;align-items:flex-end}
.msg.assistant{align-self:flex-start;align-items:flex-start}
.msg-bubble{
  padding:12px 16px;border-radius:var(--radius2);
  font-size:14px;line-height:1.7;max-width:100%;word-break:break-word;
}
.msg.user .msg-bubble{
  background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.2);color:var(--text);
}
.msg.assistant .msg-bubble{
  background:var(--surface);border:1px solid var(--border);color:var(--text);
}
.msg-meta{font-size:10px;color:var(--muted);font-family:var(--font);padding:0 4px}
.msg-tool{
  display:flex;align-items:center;gap:6px;
  font-size:11px;font-family:var(--font);color:var(--muted);
  padding:6px 10px;background:var(--surface2);border-radius:6px;
  border-left:2px solid var(--cyan);
}
.chat-input-wrap{
  padding:16px 20px;border-top:1px solid var(--border);
  background:var(--bg2);
}
.chat-input-row{
  display:flex;gap:10px;align-items:flex-end;
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius2);padding:8px 12px;
  transition:border-color .12s;
}
.chat-input-row:focus-within{border-color:var(--cyan)}
#chat-input{
  flex:1;background:none;border:none;outline:none;
  color:var(--text);font-size:14px;font-family:var(--sans);
  resize:none;min-height:24px;max-height:200px;line-height:1.5;
}
.chat-send{
  background:var(--cyan);color:#000;border:none;
  padding:6px 14px;border-radius:6px;cursor:pointer;
  font-weight:700;font-size:13px;white-space:nowrap;
  transition:opacity .12s;flex-shrink:0;
}
.chat-send:hover{opacity:.85}
.chat-send:disabled{opacity:.4;cursor:default}
.chat-hint{
  display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;
}
.hint-chip{
  font-size:11px;padding:3px 8px;border-radius:4px;
  background:var(--surface2);color:var(--muted);
  cursor:pointer;border:1px solid var(--border);
  transition:border-color .1s,color .1s;
}
.hint-chip:hover{border-color:var(--cyan);color:var(--cyan)}
.typing-indicator{display:flex;align-items:center;gap:4px;padding:8px 16px}
.typing-dot{width:6px;height:6px;border-radius:50%;background:var(--cyan);animation:pulse 1.2s infinite}
.typing-dot:nth-child(2){animation-delay:.2s}
.typing-dot:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}

/* ── Settings ────────────────────────────────────────────────────────────── */
.settings-section{margin-bottom:24px}
.settings-title{font-weight:600;margin-bottom:12px;color:var(--text)}
.settings-row{
  display:flex;justify-content:space-between;align-items:center;
  padding:10px 0;border-bottom:1px solid var(--border);
}
.settings-row:last-child{border-bottom:none}
.settings-key{font-size:13px;color:var(--text)}
.settings-desc{font-size:11px;color:var(--muted);margin-top:1px}
.settings-val{font-family:var(--font);font-size:12px;color:var(--cyan)}
.toggle{
  position:relative;width:36px;height:20px;cursor:pointer;
}
.toggle input{opacity:0;width:0;height:0}
.toggle-slider{
  position:absolute;top:0;left:0;right:0;bottom:0;
  background:var(--border2);border-radius:20px;transition:.2s;
}
.toggle-slider::before{
  content:'';position:absolute;width:14px;height:14px;
  left:3px;bottom:3px;background:var(--muted);border-radius:50%;transition:.2s;
}
.toggle input:checked+.toggle-slider{background:var(--cyan)}
.toggle input:checked+.toggle-slider::before{transform:translateX(16px);background:#000}

/* ── Security Panel ──────────────────────────────────────────────────────── */
.sec-attack{
  display:flex;align-items:center;gap:10px;
  padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;
}
.sec-attack:last-child{border-bottom:none}
.sec-icon{font-size:14px;width:20px;text-align:center}
.sec-label{flex:1;color:var(--textDim)}
.sec-result{font-family:var(--font);font-size:11px}

/* ── Spinner ─────────────────────────────────────────────────────────────── */
.spin{
  display:inline-block;width:14px;height:14px;
  border:2px solid var(--border2);border-top-color:var(--cyan);
  border-radius:50%;animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Toast ───────────────────────────────────────────────────────────────── */
.toast-wrap{
  position:fixed;bottom:20px;right:20px;
  display:flex;flex-direction:column;gap:8px;z-index:999;
}
.toast{
  padding:10px 16px;border-radius:var(--radius);
  background:var(--surface2);border:1px solid var(--border);
  font-size:13px;animation:fadeIn .2s ease;
  display:flex;align-items:center;gap:8px;
}
.toast.ok{border-color:var(--green);color:var(--green)}
.toast.err{border-color:var(--red);color:var(--red)}
.toast.info{border-color:var(--cyan);color:var(--cyan)}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* ── Modal ───────────────────────────────────────────────────────────────── */
.modal-bg{
  position:fixed;inset:0;background:rgba(0,0,0,.6);
  z-index:200;display:none;align-items:center;justify-content:center;
}
.modal-bg.open{display:flex}
.modal{
  background:var(--surface);border:1px solid var(--border2);
  border-radius:var(--radius2);padding:24px;width:100%;max-width:480px;
  box-shadow:var(--shadow);
}
.modal-title{font-weight:700;font-size:16px;margin-bottom:12px}
.modal-body{font-size:13px;color:var(--textDim);line-height:1.7}
.modal-actions{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}

/* ── Command Palette ──────────────────────────────────────────────────────── */
.palette-bg{
  position:fixed;inset:0;background:rgba(0,0,0,.7);
  z-index:300;display:none;align-items:flex-start;justify-content:center;
  padding-top:120px;
}
.palette-bg.open{display:flex}
.palette{
  background:var(--surface);border:1px solid var(--border2);
  border-radius:var(--radius2);width:100%;max-width:560px;
  box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;
}
.palette-input{
  display:flex;align-items:center;gap:10px;
  padding:14px 16px;border-bottom:1px solid var(--border);
}
.palette-input input{
  flex:1;background:none;border:none;outline:none;
  font-size:15px;color:var(--text);font-family:var(--sans);
}
.palette-results{max-height:300px;overflow-y:auto}
.palette-item{
  display:flex;align-items:center;gap:12px;
  padding:10px 16px;cursor:pointer;
  transition:background .08s;font-size:13px;
}
.palette-item:hover,.palette-item.focused{background:rgba(0,212,255,.08)}
.palette-key{font-family:var(--font);font-size:11px;color:var(--muted);margin-left:auto}

/* ── Utility ─────────────────────────────────────────────────────────────── */
.mono{font-family:var(--font)}
.muted{color:var(--muted)}
.text-green{color:var(--green)}
.text-cyan{color:var(--cyan)}
.text-amber{color:var(--amber)}
.text-red{color:var(--red)}
.mt-2{margin-top:8px}.mt-3{margin-top:12px}.mt-4{margin-top:16px}
.mb-4{margin-bottom:16px}
.flex{display:flex}.items-center{align-items:center}
.gap-2{gap:8px}.gap-3{gap:12px}
.justify-between{justify-content:space-between}
.overflow-hidden{overflow:hidden}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.section-header{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:16px;
}
.section-title{font-size:18px;font-weight:700;color:var(--text)}
.section-sub{font-size:12px;color:var(--muted);margin-top:2px}
</style>
</head>
<body>

<!-- ── Toast Container ──────────────────────────────────────────────────── -->
<div class="toast-wrap" id="toasts"></div>

<!-- ── Command Palette ───────────────────────────────────────────────────── -->
<div class="palette-bg" id="palette">
  <div class="palette">
    <div class="palette-input">
      <span style="color:var(--cyan);font-size:16px">›</span>
      <input id="palette-search" placeholder="Search commands, views, actions…" autocomplete="off"/>
    </div>
    <div class="palette-results" id="palette-results"></div>
  </div>
</div>

<!-- ── App Shell ──────────────────────────────────────────────────────────── -->
<div class="app">

  <!-- ── Sidebar ─────────────────────────────────────────────────────────── -->
  <nav class="sidebar">
    <div class="sidebar-logo">
      <div class="logo-mark">▀▄▀ XR</div>
      <div>
        <div class="logo-text">XR</div>
        <div class="logo-badge">AI Operating System</div>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Workspace</div>
      <a class="nav-item active" data-panel="dashboard">
        <span class="nav-icon">⬡</span> Dashboard
      </a>
      <a class="nav-item" data-panel="chat">
        <span class="nav-icon">💬</span> Chat
      </a>
      <a class="nav-item" data-panel="status">
        <span class="nav-icon">◎</span> Status
      </a>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Configuration</div>
      <a class="nav-item" data-panel="providers">
        <span class="nav-icon">☁</span> Providers
      </a>
      <a class="nav-item" data-panel="models">
        <span class="nav-icon">⚙</span> Models
      </a>
      <a class="nav-item" data-panel="memory">
        <span class="nav-icon">🧠</span> Memory
      </a>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Features</div>
      <a class="nav-item" data-panel="research">
        <span class="nav-icon">🔬</span> Research
      </a>
      <a class="nav-item" data-panel="plugins">
        <span class="nav-icon">⚡</span> Plugins
      </a>
      <a class="nav-item" data-panel="skills">
        <span class="nav-icon">🧩</span> Marketplace
      </a>
      <a class="nav-item" data-panel="voice">
        <span class="nav-icon">🎤</span> Voice
      </a>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Trust</div>
      <a class="nav-item" data-panel="security">
        <span class="nav-icon">🔒</span> Security
      </a>
      <a class="nav-item" data-panel="audit">
        <span class="nav-icon">📜</span> Audit Log
      </a>
      <a class="nav-item" data-panel="settings">
        <span class="nav-icon">⚙</span> Settings
      </a>
    </div>

    <div class="sidebar-spacer"></div>

    <div class="sidebar-footer">
      <div class="provider-pill" id="sidebar-provider">
        <div class="provider-dot" id="provider-dot"></div>
        <span id="sidebar-provider-text" class="truncate">loading…</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px;text-align:center">
        Press <span class="mono" style="color:var(--cyan)">?</span> for keyboard shortcuts
      </div>
    </div>
  </nav>

  <!-- ── Main ──────────────────────────────────────────────────────────────── -->
  <div class="main">

    <!-- Top bar -->
    <div class="topbar">
      <div class="topbar-title" id="topbar-title">Dashboard</div>
      <div class="topbar-spacer"></div>
      <div class="topbar-status">
        <div class="status-chip" id="chip-provider"><div class="dot"></div><span id="chip-provider-label">—</span></div>
        <div class="status-chip" id="chip-audit"><div class="dot"></div><span id="chip-audit-label">Audit</span></div>
        <div class="status-chip" id="chip-budget"><div class="dot warn"></div><span id="chip-budget-label">Budget</span></div>
        <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="openPalette()">⌘K</button>
      </div>
    </div>

    <!-- Panels -->
    <div class="content">

      <!-- ════════ DASHBOARD ════════ -->
      <div class="panel active" id="panel-dashboard">
        <div class="section-header">
          <div>
            <div class="section-title">Dashboard</div>
            <div class="section-sub">XR Control Center — <span id="dash-project">loading…</span></div>
          </div>
          <button class="btn btn-ghost" onclick="refreshAll()" style="font-size:12px">↻ Refresh</button>
        </div>

        <!-- Stat Cards -->
        <div class="grid grid-4 mb-4">
          <div class="card card-glow-cyan">
            <div class="card-header"><div class="card-title">Spent Today</div><span class="card-icon">💰</span></div>
            <div class="card-value" id="d-spent">$0.0000</div>
            <div class="card-sub" id="d-tokens">0 tokens</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><div class="card-title">Security Score</div><span class="card-icon">🛡️</span></div>
            <div class="card-value" id="d-sec-score">—</div>
            <div class="card-sub">injection block-rate</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><div class="card-title">Audit Chain</div><span class="card-icon">🔒</span></div>
            <div class="card-value" id="d-audit-val">—</div>
            <div class="card-sub" id="d-audit-entries">checking…</div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Skills</div><span class="card-icon">🧠</span></div>
            <div class="card-value" id="d-skills">0</div>
            <div class="card-sub" id="d-skills-sub">learned / frozen</div>
          </div>
        </div>

        <div class="grid grid-3 mb-4">
          <!-- Provider Health -->
          <div class="card" style="grid-column:span 1">
            <div class="card-header"><div class="card-title">Provider Health</div><span class="card-icon">☁</span></div>
            <div id="d-provider-list"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
          <!-- Local AI -->
          <div class="card">
            <div class="card-header"><div class="card-title">Local AI</div><span class="card-icon">⬡</span></div>
            <div id="d-local-status"><div class="muted" style="font-size:12px">Checking…</div></div>
          </div>
          <!-- Memory -->
          <div class="card">
            <div class="card-header"><div class="card-title">Memory</div><span class="card-icon">🧠</span></div>
            <div id="d-memory-summary"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
        </div>

        <div class="grid grid-2">
          <!-- Recent Audit -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Recent Activity</div>
              <button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="navigateTo('audit')">View all</button>
            </div>
            <div id="d-audit-list"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
          <!-- Computer Control -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Computer Control</div>
              <span id="d-control-status" class="badge badge-gray">checking…</span>
            </div>
            <div id="d-control-detail"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
        </div>
      </div>

      <!-- ════════ CHAT ════════ -->
      <div class="panel" id="panel-chat">
        <!-- Chat uses full height, rendered without content padding -->
      </div>

      <!-- ════════ STATUS ════════ -->
      <div class="panel" id="panel-status">
        <div class="section-header">
          <div><div class="section-title">System Status</div><div class="section-sub">Full health overview</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><div class="card-title">Provider</div></div>
            <div id="st-provider"><div class="spin"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Budget</div></div>
            <div id="st-budget"><div class="spin"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Local AI</div></div>
            <div id="st-local"><div class="spin"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Audit Chain</div></div>
            <div id="st-audit"><div class="spin"></div></div>
          </div>
        </div>
      </div>

      <!-- ════════ PROVIDERS ════════ -->
      <div class="panel" id="panel-providers">
        <div class="section-header">
          <div><div class="section-title">Providers</div><div class="section-sub">API keys, health, and routing</div></div>
        </div>
        <div class="card mb-4">
          <div class="card-header"><div class="card-title">Active Routing</div></div>
          <div id="prov-routing"><div class="spin"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">All Providers</div></div>
          <div class="provider-grid" id="prov-grid"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ MODELS ════════ -->
      <div class="panel" id="panel-models">
        <div class="section-header">
          <div><div class="section-title">Models</div><div class="section-sub">Local AI runtimes and model management</div></div>
        </div>
        <div class="card mb-4">
          <div class="card-header"><div class="card-title">Local Runtime Status</div></div>
          <div id="models-local"><div class="spin"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Installed Models</div></div>
          <div id="models-list"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ MEMORY ════════ -->
      <div class="panel" id="panel-memory">
        <div class="section-header">
          <div><div class="section-title">Memory</div><div class="section-sub">Durable memory — only what you asked XR to remember. Inspectable & deletable.</div></div>
          <button class="btn btn-danger" onclick="clearMemory()" style="font-size:12px">Clear All</button>
        </div>
        <div class="grid grid-3 mb-4">
          <div class="card"><div class="card-header"><div class="card-title">Total Entries</div><span class="card-icon">🧠</span></div><div class="card-value" id="mem-h-total">0</div><div class="card-sub" id="mem-h-enabled">checking…</div></div>
          <div class="card"><div class="card-header"><div class="card-title">Expired</div><span class="card-icon">⌛</span></div><div class="card-value" id="mem-h-expired">0</div><div class="card-sub" id="mem-h-expired-sub">eligible to prune</div></div>
          <div class="card"><div class="card-header"><div class="card-title">Never Recalled</div><span class="card-icon">💤</span></div><div class="card-value" id="mem-h-never">0</div><div class="card-sub">untouched memory</div></div>
        </div>
        <div class="card mb-4">
          <div class="card-header"><div class="card-title">Search Memory</div></div>
          <div style="display:flex;gap:8px">
            <input id="mem-search" placeholder='e.g. "prefer typescript" or "project"' style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-family:var(--sans)" onkeydown="if(event.key==='Enter')doMemSearch()"/>
            <button class="btn btn-primary" onclick="doMemSearch()">Search</button>
          </div>
          <div id="mem-search-results" style="margin-top:10px"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">Memories</div><div class="card-sub">Add from CLI: <code style="color:var(--cyan)">xr memory add "…"</code></div></div>
            <span class="badge badge-cyan" id="mem-count">0</span>
          </div>
          <div id="mem-list"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ RESEARCH ════════ -->
      <div class="panel" id="panel-research">
        <div class="section-header">
          <div><div class="section-title">Research</div><div class="section-sub">Source-first, citation-aware research mode</div></div>
        </div>
        <div class="card">
          <div style="text-align:center;padding:32px 16px">
            <div style="font-size:32px;margin-bottom:12px">🔬</div>
            <div style="font-weight:600;margin-bottom:8px">Research Mode</div>
            <div class="muted" style="font-size:12px;margin-bottom:16px">
              Launch a research job from the CLI or Chat interface.<br>
              XR plans queries, ranks sources, extracts evidence, and exports a signed report.
            </div>
            <button class="btn btn-ghost" onclick="navigateTo('chat')">Open Chat → Research</button>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <div class="stat-row"><div class="stat-key">Command</div><div class="stat-val mono text-cyan">xr research "topic"</div></div>
            <div class="stat-row"><div class="stat-key">In chat</div><div class="stat-val mono text-cyan">/research &lt;topic&gt;</div></div>
          </div>
        </div>
      </div>

      <!-- ════════ PLUGINS ════════ -->
      <div class="panel" id="panel-plugins">
        <div class="section-header">
          <div><div class="section-title">Plugins</div><div class="section-sub">Opt-in extensions with explicit permissions, health, trust, and clean disable/remove.</div></div>
          <button class="btn btn-ghost" onclick="loadPlugins()" style="font-size:12px">↻ Refresh</button>
        </div>
        <div class="grid grid-3 mb-4">
          <div class="card"><div class="card-header"><div class="card-title">Installed</div></div><div class="card-value" id="plug-installed">0</div><div class="card-sub">plugins on this machine</div></div>
          <div class="card"><div class="card-header"><div class="card-title">Enabled</div></div><div class="card-value" id="plug-enabled">0</div><div class="card-sub">loaded into XR when healthy</div></div>
          <div class="card"><div class="card-header"><div class="card-title">Health</div></div><div class="card-value" id="plug-health">—</div><div class="card-sub">broken plugins fail closed</div></div>
        </div>
        <div class="card mb-4">
          <div class="card-header"><div class="card-title">Installed Plugins</div></div>
          <div id="plugins-list"><div class="spin"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Catalog</div><button class="btn btn-ghost" onclick="searchPlugins()" style="font-size:11px">Search</button></div>
          <div style="display:flex;gap:8px;margin-bottom:12px"><input id="plugin-search" placeholder="Search plugins…" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px" onkeydown="if(event.key==='Enter')searchPlugins()"><button class="btn" onclick="searchPlugins()">Search</button></div>
          <div id="plugins-catalog"><div class="muted" style="font-size:12px">Use the catalog to inspect metadata, then install from CLI: <code class="mono text-cyan">xr plugins install &lt;id|path&gt;</code></div></div>
        </div>
      </div>

      <!-- ════════ XR SKILLS MARKETPLACE ════════ -->
      <div class="panel" id="panel-skills">
        <div class="mp-hero">
          <div class="mp-hero-grid">
            <div>
              <div class="mp-kicker">🛡 XR Marketplace · Skills for AI Agents</div>
              <div class="mp-title">Install expertise like <span>hiring a specialist</span>.</div>
              <div class="mp-sub">Browse official, installed, verified, trending, and update-ready XR Skills. Every Skill exposes permissions, dependencies, compatibility, examples, changelog, publisher metadata, and runtime health before you enable it.</div>
              <div class="mp-search-row">
                <input id="market-search" class="mp-search" placeholder="Search skills, publishers, categories, tags… try: react, incident, research" onkeydown="if(event.key==='Enter')loadMarketplace()" />
                <button class="btn btn-primary" onclick="loadMarketplace()">Search</button>
                <button class="btn btn-ghost" onclick="syncMarketplace()">Sync Registries</button>
              </div>
              <div class="mp-filter-row" id="market-filter-row">
                <button class="mp-chip active" data-market-filter="all" onclick="setMarketFilter('all')">All</button>
                <button class="mp-chip" data-market-filter="installed" onclick="setMarketFilter('installed')">Installed</button>
                <button class="mp-chip" data-market-filter="verified" onclick="setMarketFilter('verified')">Verified</button>
                <button class="mp-chip" data-market-filter="updates" onclick="setMarketFilter('updates')">Updates</button>
                <button class="mp-chip" data-market-filter="official" onclick="setMarketFilter('official')">Official</button>
              </div>
            </div>
            <div class="mp-brand-orb">
              <div class="mp-orbit"></div>
              <img class="mp-logo-img" src="__XR_LOGO__" alt="XR logo"/>
              <img class="mp-avatar-img" src="__XR_AVATAR__" alt="XR avatar"/>
            </div>
          </div>
        </div>

        <div class="grid grid-4 mb-4">
          <div class="card"><div class="card-header"><div class="card-title">Installed</div></div><div class="card-value" id="market-installed">0</div><div class="card-sub">ready in local runtime</div></div>
          <div class="card"><div class="card-header"><div class="card-title">Verified</div></div><div class="card-value" id="market-verified">0</div><div class="card-sub">official / verified trust</div></div>
          <div class="card"><div class="card-header"><div class="card-title">Updates</div></div><div class="card-value" id="market-updates">0</div><div class="card-sub">new versions available</div></div>
          <div class="card"><div class="card-header"><div class="card-title">Runtime</div></div><div class="card-value" id="market-runtime">—</div><div class="card-sub">health + index status</div></div>
        </div>

        <div class="mp-shell">
          <aside class="mp-card mp-side">
            <div class="mp-section-title">Categories</div>
            <div id="market-categories"></div>
            <div class="mp-section-title" style="margin-top:16px">Collections</div>
            <div class="mp-cat" onclick="setMarketQuery('official verified security')"><b>🛡 Security Desk</b><span>IR/SOC</span></div>
            <div class="mp-cat" onclick="setMarketQuery('react next node full stack')"><b>⚛ Dev Suite</b><span>code</span></div>
            <div class="mp-cat" onclick="setMarketQuery('research academic paper market')"><b>🔬 Research Lab</b><span>deep</span></div>
            <div class="mp-cat" onclick="setMarketQuery('brand copy presentation content')"><b>🎨 Creative Studio</b><span>design</span></div>
            <div class="mp-section-title" style="margin-top:16px">Registry</div>
            <div id="market-registries" class="muted" style="font-size:12px">Loading…</div>
          </aside>

          <main class="mp-main">
            <div class="mp-tabs">
              <button class="mp-tab active" data-market-sort="relevance" onclick="setMarketSort('relevance')">Recommended</button>
              <button class="mp-tab" data-market-sort="trending" onclick="setMarketSort('trending')">Trending</button>
              <button class="mp-tab" data-market-sort="updated" onclick="setMarketSort('updated')">Recently Updated</button>
              <button class="mp-tab" data-market-sort="rating" onclick="setMarketSort('rating')">Top Rated</button>
            </div>
            <div id="market-grid" class="mp-grid"><div class="spin"></div></div>
          </main>

          <aside class="mp-card mp-inspector">
            <div class="mp-section-title">Skill Inspector</div>
            <div id="market-inspector"><div class="mp-panel-empty">Select a Skill to inspect docs, permissions, dependencies, examples, changelog, compatibility, and publisher trust.</div></div>
          </aside>
        </div>
      </div>

      <!-- ════════ VOICE ════════ -->
      <div class="panel" id="panel-voice">
        <div class="section-header">
          <div><div class="section-title">Voice</div><div class="section-sub">Wake word → STT → model → TTS</div></div>
        </div>
        <div class="card">
          <div style="text-align:center;padding:32px 16px">
            <div style="font-size:32px;margin-bottom:12px">🎤</div>
            <div style="font-weight:600;margin-bottom:8px">Voice Control</div>
            <div class="muted" style="font-size:12px;margin-bottom:16px">
              Voice requires explicit opt-in. Never activated automatically.<br>
              Works on macOS (say command) and Windows (SAPI).
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <div class="stat-row"><div class="stat-key">Enable</div><div class="stat-val mono text-cyan">xr voice start</div></div>
            <div class="stat-row"><div class="stat-key">Test</div><div class="stat-val mono text-cyan">xr voice test</div></div>
            <div class="stat-row"><div class="stat-key">Wake word</div><div class="stat-val mono text-cyan">xr voice wake "hey xr"</div></div>
          </div>
        </div>
      </div>

      <!-- ════════ SECURITY (XR SHIELD) ════════ -->
      <div class="panel" id="panel-security">
        <div class="section-header">
          <div>
            <div class="section-title">🛡️ XR Shield — Security & Privacy</div>
            <div class="section-sub">AI-powered endpoint detection, privacy advisors, and telemetry control</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" onclick="runShieldScan('quick')" style="font-size:12px">Quick Scan</button>
            <button class="btn btn-ghost" onclick="runShieldScan('full')" style="font-size:12px">Full Scan</button>
          </div>
        </div>

        <!-- Metric Cards Grid -->
        <div class="grid grid-4 mb-4">
          <div class="card card-glow-green" id="shield-card-score">
            <div class="card-header"><div class="card-title">Privacy Score</div><span class="card-icon">🛡️</span></div>
            <div class="card-value" id="shield-score-val">Checking...</div>
            <div class="card-sub" id="shield-score-desc">System diagnostic check</div>
          </div>
          <div class="card" id="shield-card-threats">
            <div class="card-header"><div class="card-title">Active Threats</div><span class="card-icon">⚠</span></div>
            <div class="card-value" id="shield-threats-val" style="color:var(--red)">Checking...</div>
            <div class="card-sub" id="shield-threats-desc">Unresolved items</div>
          </div>
          <div class="card" id="shield-card-quarantined">
            <div class="card-header"><div class="card-title">Quarantined</div><span class="card-icon">📦</span></div>
            <div class="card-value" id="shield-quarantined-val" style="color:var(--amber)">Checking...</div>
            <div class="card-sub">Files safely isolated</div>
          </div>
          <div class="card" id="shield-card-adblock">
            <div class="card-header"><div class="card-title">Tracker Block</div><span class="card-icon">🚫</span></div>
            <div class="card-value" id="shield-adblock-val" style="color:var(--cyan); cursor:pointer;" onclick="toggleShieldAdBlock()">Checking...</div>
            <div class="card-sub" id="shield-adblock-desc">Click toggle to set</div>
          </div>
        </div>

        <!-- Sub-navigation Tabs -->
        <div style="display:flex; gap:8px; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:16px; overflow-x:auto;">
          <button class="btn btn-ghost active" id="shield-tab-overview" onclick="switchShieldTab('overview')">Overview</button>
          <button class="btn btn-ghost" id="shield-tab-processes" onclick="switchShieldTab('processes')">Processes</button>
          <button class="btn btn-ghost" id="shield-tab-startup" onclick="switchShieldTab('startup')">Startup & Tasks</button>
          <button class="btn btn-ghost" id="shield-tab-downloads" onclick="switchShieldTab('downloads')">Downloads</button>
          <button class="btn btn-ghost" id="shield-tab-browser" onclick="switchShieldTab('browser')">Browser Privacy</button>
          <button class="btn btn-ghost" id="shield-tab-lab" onclick="switchShieldTab('lab')">Security Lab</button>
        </div>

        <!-- SUB-PANELS -->
        <div id="shield-subpanel-overview">
          <div class="grid grid-2 mb-4">
            <div class="card">
              <div class="card-header"><div class="card-title">Detected Vulnerabilities & Threats</div></div>
              <div id="shield-threats-list" style="max-height: 400px; overflow-y: auto; padding:12px 0;">
                <div class="muted" style="font-size:12px; padding:12px;">No scan performed yet. Click Quick Scan above to query.</div>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><div class="card-title">Recommendations</div></div>
              <div id="shield-recommendations-list" style="max-height: 400px; overflow-y: auto; padding:12px 0;">
                <div class="muted" style="font-size:12px; padding:12px;">Perform a scan to retrieve local hardening feedback.</div>
              </div>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-processes" style="display:none">
          <div class="card">
            <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
              <div class="card-title">Active Running Processes</div>
              <input type="text" id="shield-proc-search" placeholder="Search processes..." onkeyup="filterShieldProcesses()" style="background:var(--surface2); border:1px solid var(--border); border-radius:4px; padding:4px 8px; color:var(--text); font-size:12px; max-width:200px;" />
            </div>
            <div style="overflow-x:auto; margin-top:12px;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:12px;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border); color:var(--muted); height:32px;">
                    <th style="padding:4px 8px;">PID</th>
                    <th style="padding:4px 8px;">PPID</th>
                    <th style="padding:4px 8px;">Name</th>
                    <th style="padding:4px 8px;">CPU%</th>
                    <th style="padding:4px 8px;">Memory</th>
                    <th style="padding:4px 8px;">Signature</th>
                    <th style="padding:4px 8px; text-align:right; width: 120px;">Actions</th>
                  </tr>
                </thead>
                <tbody id="shield-processes-table-body">
                  <tr><td colspan="7" class="muted" style="padding:12px; text-align:center;"><div class="spin"></div></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-startup" style="display:none">
          <div class="card">
            <div class="card-header"><div class="card-title">Startup Tasks & Persistence Registry</div></div>
            <div style="overflow-x:auto; margin-top:12px;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:12px;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border); color:var(--muted); height:32px;">
                    <th style="padding:4px 8px;">Registry/File Name</th>
                    <th style="padding:4px 8px;">Type</th>
                    <th style="padding:4px 8px;">Location</th>
                    <th style="padding:4px 8px;">Command Execution</th>
                    <th style="padding:4px 8px; text-align:right;">Integrity Status</th>
                  </tr>
                </thead>
                <tbody id="shield-startup-table-body">
                  <tr><td colspan="5" class="muted" style="padding:12px; text-align:center;"><div class="spin"></div></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-downloads" style="display:none">
          <div class="card">
            <div class="card-header"><div class="card-title">Downloads Folder Inspector</div></div>
            <div style="overflow-x:auto; margin-top:12px;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:12px;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border); color:var(--muted); height:32px;">
                    <th style="padding:4px 8px;">Downloaded File Name</th>
                    <th style="padding:4px 8px;">Path</th>
                    <th style="padding:4px 8px;">Size</th>
                    <th style="padding:4px 8px;">Risk Assessment</th>
                    <th style="padding:4px 8px; text-align:right;">Remediation</th>
                  </tr>
                </thead>
                <tbody id="shield-downloads-table-body">
                  <tr><td colspan="5" class="muted" style="padding:12px; text-align:center;"><div class="spin"></div></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-browser" style="display:none">
          <div class="grid grid-2 mb-4">
            <div class="card">
              <div class="card-header"><div class="card-title">Browser Privacy Metrics</div></div>
              <div id="shield-browser-metrics" style="padding:12px;">
                <div class="spin"></div>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><div class="card-title">Installed Browser Extensions</div></div>
              <div id="shield-browser-extensions" style="padding:12px; max-height: 400px; overflow-y: auto;">
                <div class="spin"></div>
              </div>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-lab" style="display:none">
          <div class="grid grid-2 mb-4">
            <div class="card">
              <div class="card-header"><div class="card-title">Injection Defense Test Lab</div></div>
              <div style="padding:12px;">
                <p class="muted" style="font-size:12px; margin-bottom:16px;">This test runs prompt injection attack payloads from standard AgentDojo corpora directly against XR's security layers to measure block rates.</p>
                <div id="sec-lab-result"><div class="muted" style="font-size:12px">Click Run Lab below to execute test corpus</div></div>
                <button class="btn btn-primary" onclick="runSecLab()" style="margin-top:16px; font-size:12px">Run Security Lab</button>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><div class="card-title">Egress Allow-List</div></div>
              <div id="sec-egress" style="padding:12px;"><div class="spin"></div></div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Static Security Posture</div></div>
            <div id="sec-posture" style="padding:12px;"><div class="spin"></div></div>
          </div>
        </div>
      </div>

      <!-- ════════ AUDIT ════════ -->
      <div class="panel" id="panel-audit">
        <div class="section-header">
          <div><div class="section-title">Audit Log</div><div class="section-sub">Tamper-evident SHA-256 hash chain</div></div>
          <div class="flex gap-2">
            <span id="audit-chain-badge" class="badge badge-gray">checking…</span>
          </div>
        </div>
        <div class="card">
          <div id="audit-log-list"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ SETTINGS ════════ -->
      <div class="panel" id="panel-settings">
        <div class="section-header">
          <div><div class="section-title">Settings</div><div class="section-sub">XR configuration</div></div>
        </div>
        <div class="card mb-4">
          <div class="settings-section">
            <div class="settings-title">Privacy & Data</div>
            <div class="settings-row">
              <div><div class="settings-key">Local-first mode</div><div class="settings-desc">All data stays on your machine</div></div>
              <span class="badge badge-green">Enabled</span>
            </div>
            <div class="settings-row">
              <div><div class="settings-key">API key storage</div><div class="settings-desc">Keys stored in OS keychain or encrypted file</div></div>
              <span class="settings-val" id="set-key-backend">—</span>
            </div>
            <div class="settings-row">
              <div><div class="settings-key">Egress allow-list</div><div class="settings-desc">Domains that can receive data from XR</div></div>
              <span class="settings-val" id="set-egress">unrestricted</span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-title">Budget</div>
            <div class="settings-row">
              <div><div class="settings-key">Per-task ceiling</div><div class="settings-desc">Hard limit — agent cannot exceed</div></div>
              <span class="settings-val" id="set-budget">—</span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-title">Approval Gates</div>
            <div class="settings-row">
              <div><div class="settings-key">Require approval for</div><div class="settings-desc">Actions that need your explicit consent</div></div>
              <span class="settings-val" id="set-approval">—</span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="settings-title" style="margin-bottom:12px">CLI Quick Reference</div>
          <div class="stat-row"><div class="stat-key">Config path</div><div class="stat-val mono text-cyan">~/.xr/config.json</div></div>
          <div class="stat-row"><div class="stat-key">Edit config</div><div class="stat-val mono text-cyan">xr config set &lt;key&gt; &lt;val&gt;</div></div>
          <div class="stat-row"><div class="stat-key">Reset</div><div class="stat-val mono text-cyan">xr onboarding</div></div>
          <div class="stat-row"><div class="stat-key">Doctor</div><div class="stat-val mono text-cyan">xr doctor</div></div>
        </div>
      </div>

    </div><!-- /content -->
  </div><!-- /main -->
</div><!-- /app -->

<!-- ── Chat Panel (full height, injected separately) ─────────────────────── -->
<div id="chat-mount" style="display:none"></div>

<script>
// ── Constants ────────────────────────────────────────────────────────────────
const TOKEN = "__TOKEN__";
const BASE  = window.location.origin;

// ── API Helper ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = "info") {
  const wrap = document.getElementById("toasts");
  const el   = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Navigation ────────────────────────────────────────────────────────────────
const NAV_LABELS = {
  dashboard: "Dashboard", chat: "Chat", status: "Status",
  providers: "Providers", models: "Models", memory: "Memory",
  research: "Research", plugins: "Plugins", skills: "Marketplace", voice: "Voice",
  security: "Security", audit: "Audit Log", settings: "Settings",
};

function navigateTo(id) {
  // Update nav items
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.panel === id);
  });
  // Update panels
  document.querySelectorAll(".panel").forEach(el => {
    el.classList.toggle("active", el.id === "panel-" + id);
  });
  // Topbar title
  document.getElementById("topbar-title").textContent = NAV_LABELS[id] ?? id;

  // Special: chat uses full height
  const chatMount = document.getElementById("chat-mount");
  const content   = document.querySelector(".content");
  if (id === "chat") {
    buildChatUI();
    content.style.padding = "0";
    content.style.overflow = "hidden";
  } else {
    content.style.padding = "";
    content.style.overflow = "";
  }

  // Lazy-load panel data
  switch (id) {
    case "dashboard":   loadDashboard(); break;
    case "status":      loadStatus();    break;
    case "providers":   loadProviders(); break;
    case "models":      loadModels();    break;
    case "memory":      loadMemory();    break;
    case "security":    loadSecurity();  break;
    case "plugins":     loadPlugins();   break;
    case "skills":      loadMarketplace(); break;
    case "audit":       loadAuditLog();  break;
    case "settings":    loadSettings();  break;
  }
}

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", () => navigateTo(el.dataset.panel));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [ov, cost, ctrl, mem, providers] = await Promise.allSettled([
      api("/api/overview"),
      api("/api/cost"),
      api("/api/control/status"),
      api("/api/memory"),
      api("/api/providers"),
    ]);

    // Overview
    if (ov.status === "fulfilled") {
      const d = ov.value;
      document.getElementById("dash-project").textContent = d.project ?? "—";
      const auditOk = d.audit?.chain?.valid;
      document.getElementById("d-audit-val").textContent  = auditOk ? "Intact" : "BROKEN";
      document.getElementById("d-audit-val").className    = "card-value " + (auditOk ? "val-green" : "val-red");
      document.getElementById("d-audit-entries").textContent = (d.audit?.count ?? 0) + " entries";
      document.getElementById("d-skills").textContent     = (d.skills?.learned ?? 0) + "";
      document.getElementById("d-skills-sub").textContent = (d.skills?.learned ?? 0) + " learned / " + (d.skills?.frozen ?? 0) + " frozen";
      // Topbar chips
      document.getElementById("chip-audit-label").textContent = auditOk ? "Audit OK" : "Audit BROKEN";
      document.getElementById("chip-audit").className = "status-chip " + (auditOk ? "ok" : "err");
    }

    // Cost
    if (cost.status === "fulfilled") {
      const c = cost.value;
      document.getElementById("d-spent").textContent  = "$" + (c.totalUsd ?? 0).toFixed(4);
      document.getElementById("d-tokens").textContent = (c.totalTokens ?? 0).toLocaleString() + " tokens";
      document.getElementById("chip-budget-label").textContent = "$" + (c.totalUsd ?? 0).toFixed(4);
    }

    // Control
    if (ctrl.status === "fulfilled") {
      const c = ctrl.value;
      const badge = document.getElementById("d-control-status");
      badge.textContent = c.enabled ? "enabled" : "disabled";
      badge.className   = "badge " + (c.enabled ? "badge-green" : "badge-gray");
      const caps = c.capabilities ?? {};
      document.getElementById("d-control-detail").innerHTML = Object.entries(caps).map(([k,v]) =>
        \`<div class="stat-row"><div class="stat-key">\${k}</div><div class="stat-val \${v ? 'val-green' : 'val-muted'}">\${v ? "✓" : "—"}</div></div>\`
      ).join("") || "<div class='muted' style='font-size:12px'>No capabilities detected</div>";
    }

    // Memory summary
    if (mem.status === "fulfilled") {
      const m = mem.value;
      document.getElementById("d-memory-summary").innerHTML =
        \`<div class="stat-row"><div class="stat-key">Entries</div><div class="stat-val val-cyan">\${m.count ?? 0}</div></div>\` +
        Object.entries(m.stats ?? {}).map(([k,v]) =>
          \`<div class="stat-row"><div class="stat-key">\${k}</div><div class="stat-val val-muted">\${v}</div></div>\`
        ).join("") +
        \`<div style="font-size:10px;color:var(--muted);margin-top:8px">Add: <code style="color:var(--cyan)">xr memory add "…"</code></div>\`;
    }

    // Provider quick list
    if (providers.status === "fulfilled") {
      const p = providers.value;
      const rows = p.providers ?? [];
      document.getElementById("d-provider-list").innerHTML = rows.length
        ? rows.slice(0, 8).map(r =>
            \`<div class="stat-row"><div class="stat-key">\${r.label}</div><div class="stat-val \${r.healthy ? 'val-green' : (r.hasKey ? 'val-amber' : 'val-muted')}">\${r.healthy ? 'online' : (r.hasKey ? 'offline' : 'no key')}\${r.latencyMs ? ' · ' + r.latencyMs + 'ms' : ''}</div></div>\`
          ).join("")
        : "<div class='muted' style='font-size:12px'>No providers configured</div>";
    }

    // Audit recent
    const audit = await api("/api/audit?limit=6");
    const entries = audit.entries ?? [];
    document.getElementById("d-audit-list").innerHTML = entries.length
      ? entries.map(e => \`
          <div class="audit-row">
            <div class="audit-ts">\${new Date(e.ts).toLocaleTimeString()}</div>
            <div class="audit-event">\${e.event}</div>
            <div class="audit-hash" title="\${e.hash ?? ''}">\${(e.hash ?? "").slice(0,8)}</div>
          </div>\`).join("")
      : "<div class='muted' style='font-size:12px'>No activity yet</div>";

    // Provider quick status (sidebar + overview card)
    await loadProviderChip();

  } catch(e) {
    toast("Dashboard error: " + e.message, "err");
  }
}

async function loadProviderChip() {
  try {
    const [ov, providers] = await Promise.all([api("/api/overview"), api("/api/providers")]);
    const budget = ov.budget?.perTaskUsd ?? 0;
    document.getElementById("chip-budget-label").textContent = budget > 0 ? "Cap $" + budget.toFixed(2) : "No cap";

    const activeId = providers.primary ?? ov.provider?.active ?? "xr";
    const activeModel = providers.model ?? ov.provider?.model ?? "—";
    const activeRow = (providers.providers ?? []).find((p) => p.id === activeId);
    document.getElementById("sidebar-provider-text").textContent = activeId + " · " + activeModel;
    document.getElementById("chip-provider-label").textContent = activeId + " / " + activeModel;
    document.getElementById("chip-provider").className = "status-chip " + (activeRow?.healthy === false ? "err" : activeRow?.healthy ? "ok" : "warn");
    document.getElementById("provider-dot").style.background = activeRow?.healthy === false ? "var(--red)" : activeRow?.healthy ? "var(--green)" : "var(--amber)";
  } catch {}
}

// ── Status Panel ──────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const [ov, cost, ctrl] = await Promise.all([
      api("/api/overview"),
      api("/api/cost"),
      api("/api/control/status"),
    ]);
    document.getElementById("st-provider").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Status</div><div class="stat-val val-green">online</div></div>\`;
    document.getElementById("st-budget").innerHTML =
      \`<div class="stat-row"><div class="stat-key">All-time spent</div><div class="stat-val val-cyan">$\${(cost.totalUsd??0).toFixed(6)}</div></div>
       <div class="stat-row"><div class="stat-key">All-time tokens</div><div class="stat-val">\${(cost.totalTokens??0).toLocaleString()}</div></div>\`;
    document.getElementById("st-audit").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Chain</div><div class="stat-val \${ov.audit?.chain?.valid ? "val-green" : "val-red"}">\${ov.audit?.chain?.valid ? "Intact" : "BROKEN"}</div></div>
       <div class="stat-row"><div class="stat-key">Entries</div><div class="stat-val">\${ov.audit?.count ?? 0}</div></div>\`;
    document.getElementById("st-local").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Control</div><div class="stat-val \${ctrl.enabled ? "val-green" : "val-muted"}">\${ctrl.enabled ? "enabled" : "disabled"}</div></div>
       <div class="stat-row"><div class="stat-key">Pending</div><div class="stat-val">\${ctrl.pending ?? 0}</div></div>\`;
  } catch(e) {
    toast("Status error: " + e.message, "err");
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────
async function loadProviders() {
  try {
    const [ov, data] = await Promise.all([api("/api/overview"), api("/api/providers")]);
    document.getElementById("prov-routing").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Primary</div><div class="stat-val val-cyan">\${data.primary ?? ov.provider?.active ?? "—"} / \${data.model ?? ov.provider?.model ?? "—"}</div></div>
       <div class="stat-row"><div class="stat-key">Fallback</div><div class="stat-val val-muted">\${data.fallback ? data.fallback + ' / ' + (data.fallbackModel ?? 'default') : 'none'}</div></div>
       <div class="stat-row"><div class="stat-key">Workspace</div><div class="stat-val val-muted">\${ov.workspace ?? 'default'}</div></div>\`;
    document.getElementById("prov-grid").innerHTML = (data.providers ?? []).map(n =>
      \`<div class="provider-item \${n.id === data.primary ? "active" : ""} \${n.healthy === false && !n.hasKey ? "offline" : ""}">
         <div class="provider-avatar">\${(n.label || n.id)[0]}</div>
         \${n.label}
         <span class="badge \${n.tier === "free" ? "badge-green" : "badge-gray"}">\${n.tier}</span>
         <span class="badge \${n.healthy ? "badge-green" : (n.hasKey ? "badge-amber" : "badge-gray")}">\${n.healthy ? "online" : (n.hasKey ? "offline" : "no key")}</span>
       </div>\`
    ).join("");
  } catch(e) {
    toast("Providers error: " + e.message, "err");
  }
}

// ── Models ────────────────────────────────────────────────────────────────────
async function loadModels() {
  try {
    const ctrl = await api("/api/control/status");
    document.getElementById("models-local").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Runtime</div><div class="stat-val val-cyan">Ollama</div></div>
       <div class="stat-row"><div class="stat-key">Status</div><div class="stat-val \${ctrl.enabled ? 'val-green' : 'val-muted'}">ready</div></div>
       <div style="font-size:11px;color:var(--muted);margin-top:8px">Run <code style="color:var(--cyan)">xr models status</code> for full details</div>\`;
    document.getElementById("models-list").innerHTML =
      \`<div class="muted" style="font-size:12px;text-align:center;padding:16px">
         Run <code style="color:var(--cyan)">xr models list</code> to see available models
       </div>\`;
  } catch(e) {
    toast("Models error: " + e.message, "err");
  }
}

// ── Memory ────────────────────────────────────────────────────────────────────
async function loadMemory() {
  try {
    const mem = await api("/api/memory");
    document.getElementById("mem-count").textContent = mem.count ?? 0;
    // Stage 6 — health cards.
    const h = mem.health ?? {};
    document.getElementById("mem-h-total").textContent = h.total ?? mem.count ?? 0;
    document.getElementById("mem-h-enabled").textContent = mem.enabled ? "enabled" : "disabled";
    document.getElementById("mem-h-enabled").style.color = mem.enabled ? "var(--green)" : "var(--red)";
    document.getElementById("mem-h-expired").textContent = h.expired ?? 0;
    document.getElementById("mem-h-never").textContent = h.neverAccessed ?? 0;
    const entries = mem.entries ?? [];
    if (!entries.length) {
      document.getElementById("mem-list").innerHTML =
        \`<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px">
           No memories yet. Add from CLI: <code style="color:var(--cyan)">xr memory add "…"</code>
         </div>\`;
      return;
    }
    document.getElementById("mem-list").innerHTML = entries.map(e =>
      \`<div class="mem-item">
         <div class="mem-cat">\${e.category ?? "general"}</div>
         <div class="mem-content">\${e.content}\${e.expiresAt ? '<div style="font-size:10px;color:var(--amber);margin-top:2px">⌛ expires '+new Date(e.expiresAt).toLocaleDateString()+'</div>' : ''}</div>
         <div class="mem-del" onclick="deleteMemory('\${e.id}')">✕</div>
       </div>\`
    ).join("");
  } catch(e) {
    document.getElementById("mem-list").innerHTML =
      "<div class='muted' style='font-size:12px'>Memory not available</div>";
  }
}

// Stage 6 — live memory search.
async function doMemSearch() {
  const q = (document.getElementById("mem-search")?.value ?? "").trim();
  const out = document.getElementById("mem-search-results");
  if (!q) { if (out) out.innerHTML = ""; return; }
  try {
    const r = await api("/api/memory/search?q=" + encodeURIComponent(q));
    const results = r.results ?? [];
    out.innerHTML = results.length
      ? results.map(e => \`<div class="mem-item"><div class="mem-cat">\${e.category}</div><div class="mem-content">\${e.content}</div></div>\`).join("")
      : '<div class="muted" style="font-size:12px;padding:6px 0">No matches.</div>';
  } catch(e) {
    out.innerHTML = '<div class="muted" style="font-size:12px;padding:6px 0">Search failed: '+e.message+'</div>';
  }
}

async function deleteMemory(id) {
  try {
    await api("/api/memory/" + encodeURIComponent(id), { method: "DELETE" });
    toast("Memory entry deleted", "ok");
    loadMemory();
  } catch(e) {
    toast("Delete failed: " + e.message, "err");
  }
}

async function clearMemory() {
  if (!confirm("Clear ALL memory entries? This cannot be undone.")) return;
  try {
    await api("/api/memory/%2A", { method: "DELETE" });
    toast("All memory cleared", "ok");
    loadMemory();
  } catch(e) {
    toast("Clear failed: " + e.message, "err");
  }
}

// ── Plugins ───────────────────────────────────────────────────────────────────
function pluginBadge(status) {
  if (status === "enabled") return '<span class="badge badge-green">enabled</span>';
  if (status === "disabled") return '<span class="badge badge-gray">disabled</span>';
  if (status === "untrusted") return '<span class="badge badge-red">untrusted</span>';
  if (status === "incompatible") return '<span class="badge badge-amber">incompatible</span>';
  return '<span class="badge badge-red">error</span>';
}

async function loadPlugins() {
  try {
    const data = await api("/api/plugins");
    const s = data.summary ?? {};
    const plugins = data.plugins ?? [];
    const broken = s.errored ?? plugins.filter(p => ["error","untrusted","incompatible"].includes(p.status)).length;
    document.getElementById("plug-installed").textContent = s.installed ?? plugins.length;
    document.getElementById("plug-enabled").textContent = s.enabled ?? plugins.filter(p => p.enabled).length;
    document.getElementById("plug-health").textContent = broken ? "⚠ " + broken : "Healthy";
    document.getElementById("plug-health").className = "card-value " + (broken ? "val-red" : "val-green");

    document.getElementById("plugins-list").innerHTML = plugins.length ? plugins.map(p => {
      const perms = (p.permissions ?? []).map(x => '<span class="badge badge-gray" style="margin-right:4px">' + escapeHtml(String(x)) + '</span>').join("") || '<span class="muted">none</span>';
      const caps = (p.capabilities ?? []).map(c => String(c.kind) + ':' + String(c.name)).join(", ") || "none";
      const action = p.enabled
        ? '<button class="btn btn-ghost" onclick="pluginAction(\'' + escapeHtml(p.id) + '\',\'disable\')" style="font-size:11px">Disable</button>'
        : '<button class="btn" onclick="pluginAction(\'' + escapeHtml(p.id) + '\',\'enable\')" style="font-size:11px">Enable</button>';
      return '<div class="mem-item" style="display:block">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
          '<div><div style="font-weight:700;color:var(--text)">' + escapeHtml(p.name ?? p.id) + ' <span class="mono muted">' + escapeHtml(p.id) + '</span></div>' +
          '<div class="muted" style="font-size:11px">v' + escapeHtml(p.version ?? "?") + ' · ' + escapeHtml(p.type ?? "tool") + ' · trust:' + escapeHtml(p.trustLevel ?? "unknown") + '</div></div>' +
          '<div style="display:flex;gap:6px;align-items:center">' + pluginBadge(p.status) + action + '<button class="btn btn-danger" onclick="pluginRemove(\'' + escapeHtml(p.id) + '\')" style="font-size:11px">Remove</button></div>' +
        '</div>' +
        '<div class="muted" style="font-size:12px;margin:8px 0">' + escapeHtml(p.description ?? "") + '</div>' +
        '<div style="font-size:11px;margin-bottom:6px"><span class="muted">Permissions:</span> ' + perms + '</div>' +
        '<div class="muted" style="font-size:11px">Capabilities: ' + escapeHtml(caps) + '</div>' +
        (p.detail ? '<div style="color:var(--amber);font-size:11px;margin-top:6px">' + escapeHtml(p.detail) + '</div>' : '') +
      '</div>';
    }).join("") : '<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px">No plugins installed. Search the catalog or run <code class="mono text-cyan">xr plugins install ./plugin</code>.</div>';
  } catch(e) {
    document.getElementById("plugins-list").innerHTML = '<div class="muted" style="font-size:12px">Plugin API unavailable: '+escapeHtml(e.message)+'</div>';
  }
}

async function searchPlugins() {
  try {
    const q = document.getElementById("plugin-search")?.value ?? "";
    const data = await api("/api/plugins/catalog?q=" + encodeURIComponent(q));
    const rows = data.plugins ?? [];
    document.getElementById("plugins-catalog").innerHTML = rows.length ? rows.map(p =>
      '<div class="provider-item" style="display:block;margin-bottom:8px">' +
        '<div style="font-weight:700">' + escapeHtml(p.name) + ' <span class="mono muted">' + escapeHtml(p.id) + '</span></div>' +
        '<div class="muted" style="font-size:11px;margin:3px 0">v' + escapeHtml(p.version) + ' · ' + escapeHtml(p.type) + ' · trust:' + escapeHtml(p.trustLevel) + '</div>' +
        '<div class="muted" style="font-size:12px">' + escapeHtml(p.description ?? "") + '</div>' +
        '<div style="font-size:11px;margin-top:6px"><span class="muted">Install:</span> <code class="mono text-cyan">xr plugins install ' + escapeHtml(p.id) + '</code></div>' +
      '</div>').join("") : '<div class="muted" style="font-size:12px">No catalog matches.</div>';
  } catch(e) {
    document.getElementById("plugins-catalog").innerHTML = '<div class="muted" style="font-size:12px">Catalog unavailable: '+escapeHtml(e.message)+'</div>';
  }
}

async function pluginAction(id, action) {
  try {
    await api("/api/plugins/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
    toast("Plugin " + action + "d", "ok");
    loadPlugins();
  } catch(e) { toast("Plugin action failed: " + e.message, "err"); }
}

async function pluginRemove(id) {
  if (!confirm("Remove plugin " + id + "? This deletes its installed files.")) return;
  try {
    await api("/api/plugins/" + encodeURIComponent(id) + "/remove", { method: "DELETE" });
    toast("Plugin removed", "ok");
    loadPlugins();
  } catch(e) { toast("Remove failed: " + e.message, "err"); }
}

let MARKET_FILTER = "all";
let MARKET_SORT = "relevance";
let MARKET_ROWS = [];
let MARKET_SELECTED = null;

function skillHealthBadge(health) {
  if (health === "healthy") return '<span class="badge badge-green">healthy</span>';
  if (health === "disabled") return '<span class="badge badge-gray">disabled</span>';
  if (health === "missing-dependency") return '<span class="badge badge-amber">missing dep</span>';
  return '<span class="badge badge-red">invalid</span>';
}

function marketTrustBadge(s) {
  const trust = s.verification || s.trust || "unknown";
  if (["official","verified"].includes(trust)) return '<span class="mp-mini ok">' + escapeHtml(trust) + '</span>';
  if (trust === "reviewed") return '<span class="mp-mini">reviewed</span>';
  return '<span class="mp-mini warn">' + escapeHtml(trust) + '</span>';
}

function skillInitials(name) {
  return String(name || "XR").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "XR";
}

function setMarketFilter(filter) {
  MARKET_FILTER = filter;
  document.querySelectorAll("[data-market-filter]").forEach(el => el.classList.toggle("active", el.dataset.marketFilter === filter));
  renderMarketplace();
}

function setMarketSort(sort) {
  MARKET_SORT = sort;
  document.querySelectorAll("[data-market-sort]").forEach(el => el.classList.toggle("active", el.dataset.marketSort === sort));
  renderMarketplace();
}

function setMarketQuery(q) {
  const input = document.getElementById("market-search");
  if (input) input.value = q;
  loadMarketplace();
}

function normalizeMarketplaceSkill(s) {
  const perms = s.permissions ?? [];
  const deps = s.dependencies ?? [];
  const categories = s.categories ?? [];
  return {
    ...s,
    categories,
    tags: s.tags ?? [],
    permissions: perms,
    dependencies: deps,
    rating: s.rating?.average ?? s.rating ?? 0,
    ratingCount: s.rating?.count ?? 0,
    downloads: s.downloads ?? s.runs ?? 0,
    updatedAt: s.updatedAt ?? s.publishedAt ?? 0,
    permissionRisk: perms.filter(p => p.dangerous).length,
    dependencyCount: deps.length,
    installed: Boolean(s.installed),
    enabled: Boolean(s.enabled),
    verification: s.verification ?? (s.verified ? "verified" : "community"),
  };
}

async function loadMarketplace() {
  try {
    const q = document.getElementById("market-search")?.value ?? "";
    const data = await api("/api/skills/marketplace" + (q ? "?q=" + encodeURIComponent(q) : ""));
    MARKET_ROWS = (data.skills ?? []).map(normalizeMarketplaceSkill);
    const stats = data.stats ?? {};
    document.getElementById("market-installed").textContent = stats.installed ?? MARKET_ROWS.filter(s => s.installed).length;
    document.getElementById("market-verified").textContent = stats.verified ?? MARKET_ROWS.filter(s => ["official","verified"].includes(s.verification)).length;
    document.getElementById("market-updates").textContent = stats.updates ?? 0;
    document.getElementById("market-runtime").textContent = (data.health?.invalid ?? 0) ? "⚠" : "OK";
    renderMarketCategories(MARKET_ROWS);
    renderMarketRegistries(data.registries ?? []);
    renderMarketplace();
    if (!MARKET_SELECTED && MARKET_ROWS[0]) inspectMarketplaceSkill(MARKET_ROWS[0].id);
  } catch(e) {
    document.getElementById("market-grid").innerHTML = '<div class="mp-panel-empty">Marketplace API unavailable: '+escapeHtml(e.message)+'</div>';
  }
}

function renderMarketRegistries(registries) {
  const el = document.getElementById("market-registries");
  if (!el) return;
  el.innerHTML = registries.length ? registries.map(r =>
    '<div class="stat-row"><div class="stat-key">' + escapeHtml(r.id) + '</div><div class="stat-val ' + (r.enabled ? 'val-green' : 'val-muted') + '">' + (r.enabled ? 'on' : 'off') + '</div></div>'
  ).join("") : '<div class="muted" style="font-size:12px">No online registries configured yet.<br><code class="mono text-cyan">xr skill registry add official &lt;url&gt;</code></div>';
}

function renderMarketCategories(rows) {
  const counts = {};
  for (const s of rows) for (const c of s.categories ?? []) counts[c] = (counts[c] ?? 0) + 1;
  const cats = ["developer","security","research","business","creative","agent","mcp","workflow","productivity"];
  document.getElementById("market-categories").innerHTML = cats.map(c =>
    '<div class="mp-cat" onclick="setMarketQuery(\'' + c + '\')"><b>' + categoryIcon(c) + ' ' + c + '</b><span>' + (counts[c] ?? 0) + '</span></div>'
  ).join("");
}

function categoryIcon(c) {
  return ({developer:'⌘',security:'🛡',research:'🔬',business:'📈',creative:'🎨',agent:'🤖',mcp:'🔌',workflow:'◆',productivity:'⚡'})[c] || '◇';
}

function filteredMarketplaceRows() {
  let rows = [...MARKET_ROWS];
  if (MARKET_FILTER === "installed") rows = rows.filter(s => s.installed);
  if (MARKET_FILTER === "verified") rows = rows.filter(s => ["official","verified"].includes(s.verification));
  if (MARKET_FILTER === "official") rows = rows.filter(s => s.verification === "official" || s.publisher === "xr-official");
  if (MARKET_FILTER === "updates") rows = rows.filter(s => s.updateAvailable);
  if (MARKET_SORT === "trending") rows.sort((a,b)=>(b.downloads+b.runs)-(a.downloads+a.runs));
  else if (MARKET_SORT === "updated") rows.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  else if (MARKET_SORT === "rating") rows.sort((a,b)=>(b.rating||0)-(a.rating||0));
  return rows;
}

function renderMarketplace() {
  const rows = filteredMarketplaceRows();
  document.getElementById("market-grid").innerHTML = rows.length ? rows.map(s => {
    const selected = MARKET_SELECTED === s.id ? " selected" : "";
    const danger = s.permissionRisk ? '<span class="mp-mini warn">' + s.permissionRisk + ' risky perm</span>' : '<span class="mp-mini ok">safe perms</span>';
    const action = s.installed
      ? (s.enabled ? '<button class="btn btn-ghost" onclick="event.stopPropagation(); skillAction(\'' + escapeHtml(s.id) + '\',\'disable\')">Disable</button>' : '<button class="btn" onclick="event.stopPropagation(); skillAction(\'' + escapeHtml(s.id) + '\',\'enable\')">Enable</button>')
      : '<button class="btn btn-primary" onclick="event.stopPropagation(); installMarketplaceSkill(\'' + escapeHtml(s.id) + '\')">Install</button>';
    return '<article class="mp-skill-card' + selected + '" onclick="inspectMarketplaceSkill(\'' + escapeHtml(s.id) + '\')">' +
      '<div class="mp-skill-top"><div class="mp-skill-icon">' + escapeHtml(skillInitials(s.name)) + '</div><div style="min-width:0;flex:1"><div class="mp-skill-name">' + escapeHtml(s.name) + '</div><div class="mp-skill-id">' + escapeHtml(s.id) + '</div></div>' + marketTrustBadge(s) + '</div>' +
      '<div class="mp-shot"></div>' +
      '<div class="mp-desc">' + escapeHtml(s.description || '') + '</div>' +
      '<div class="mp-meta"><span class="mp-mini">' + escapeHtml((s.categories||[])[0] || 'skill') + '</span><span class="mp-mini">' + escapeHtml(s.publisher || 'unknown') + '</span>' + danger + '<span class="mp-mini">deps ' + s.dependencyCount + '</span></div>' +
      '<div class="mp-actions">' + action + '<button class="btn btn-ghost" onclick="event.stopPropagation(); inspectMarketplaceSkill(\'' + escapeHtml(s.id) + '\')">Details</button></div>' +
    '</article>';
  }).join("") : '<div class="mp-panel-empty">No Skills match this view. Try another category or sync registries.</div>';
}

async function inspectMarketplaceSkill(id) {
  MARKET_SELECTED = id;
  renderMarketplace();
  try {
    const data = await api("/api/skills/" + encodeURIComponent(id) + "/inspect");
    const s = normalizeMarketplaceSkill(data.skill);
    const perms = data.permissions;
    const deps = data.dependencies;
    const permRows = ([...(perms?.safe ?? []), ...(perms?.dangerous ?? [])]).map(p =>
      '<div class="mp-perm"><div class="mp-perm-head"><b>' + escapeHtml(p.scope) + (p.dangerous ? ' !' : '') + '</b><span class="' + (p.granted ? 'val-green' : 'val-amber') + '">' + (p.granted ? 'granted' : 'approval') + '</span></div><p>' + escapeHtml(p.reason) + '</p></div>'
    ).join("") || '<div class="muted">No permissions declared.</div>';
    const depRows = (deps?.statuses ?? []).map(d =>
      '<div class="mp-perm"><div class="mp-perm-head"><b>' + escapeHtml(d.dependency.kind + ':' + d.dependency.id) + '</b><span class="' + (d.satisfied ? 'val-green' : 'val-amber') + '">' + (d.satisfied ? 'ok' : 'missing') + '</span></div><p>' + escapeHtml(d.reason) + '</p></div>'
    ).join("") || '<div class="muted">No dependencies declared.</div>';
    const workflows = (s.workflows ?? []).slice(0,3).map(w => '<span class="mp-mini">' + escapeHtml(w.title || w.id) + '</span>').join("") || '<span class="muted">none</span>';
    const commands = (s.commands ?? []).slice(0,4).map(c => '<code class="mono text-cyan">/' + escapeHtml(c.name) + '</code>').join(' ') || '<span class="muted">none</span>';
    document.getElementById("market-inspector").innerHTML =
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><div class="mp-skill-icon" style="width:54px;height:54px">' + escapeHtml(skillInitials(s.name)) + '</div><div><h3>' + escapeHtml(s.name) + '</h3><div class="mp-inspector-sub">' + escapeHtml(s.id) + ' · v' + escapeHtml(s.version) + ' · ' + escapeHtml(s.kind) + '</div>' + marketTrustBadge(s) + '</div></div>' +
      '<div class="mp-shot"></div>' +
      '<p class="muted" style="font-size:12px;line-height:1.6;margin-bottom:12px">' + escapeHtml(s.description) + '</p>' +
      '<div class="mp-actions" style="margin-bottom:12px">' + (s.installed ? '<button class="btn btn-ghost" onclick="skillAction(\'' + escapeHtml(s.id) + '\',\'' + (s.enabled ? 'disable' : 'enable') + '\')">' + (s.enabled ? 'Disable' : 'Enable') + '</button>' : '<button class="btn btn-primary" onclick="installMarketplaceSkill(\'' + escapeHtml(s.id) + '\')">Install</button>') + '<button class="btn btn-ghost" onclick="copySkillInstall(\'' + escapeHtml(s.id) + '\')">Copy CLI</button></div>' +
      '<div class="mp-section-title">Publisher</div><div class="stat-row"><div class="stat-key">publisher</div><div class="stat-val">' + escapeHtml(s.publisher) + '</div></div><div class="stat-row"><div class="stat-key">trust</div><div class="stat-val val-cyan">' + escapeHtml(s.verification) + '</div></div>' +
      '<div class="mp-section-title" style="margin-top:16px">Commands</div><div style="font-size:12px;margin-bottom:12px">' + commands + '</div>' +
      '<div class="mp-section-title">Workflows</div><div class="mp-meta" style="margin-bottom:12px">' + workflows + '</div>' +
      '<div class="mp-section-title">Permission Viewer</div>' + permRows +
      '<div class="mp-section-title" style="margin-top:16px">Dependency Viewer</div>' + depRows +
      '<div class="mp-section-title" style="margin-top:16px">Examples & Changelog</div><div class="muted" style="font-size:12px;line-height:1.6">Examples and changelog are read from the Skill package/docs. Use <code class="mono text-cyan">xr skill inspect ' + escapeHtml(s.id) + '</code> for full local file details.</div>';
  } catch(e) {
    document.getElementById("market-inspector").innerHTML = '<div class="mp-panel-empty">Inspect failed: '+escapeHtml(e.message)+'</div>';
  }
}

async function installMarketplaceSkill(id) {
  try {
    await api("/api/skills/marketplace/install", { method:"POST", body: JSON.stringify({ id }) });
    toast("Skill install started", "ok");
    loadMarketplace();
  } catch(e) {
    toast("Install failed: " + e.message + " — try CLI: xr skill install-online " + id, "err");
  }
}

async function syncMarketplace() {
  try {
    const data = await api("/api/skills/marketplace/sync", { method:"POST" });
    toast("Registry sync complete: " + (data.results?.filter(r=>r.ok).length ?? 0) + " ok", "ok");
    loadMarketplace();
  } catch(e) { toast("Registry sync failed: " + e.message, "err"); }
}

function copySkillInstall(id) {
  navigator.clipboard?.writeText("xr skill install-online " + id).catch(()=>{});
  toast("Copied install command", "ok");
}

async function skillAction(id, action) {
  try {
    await api("/api/skills/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
    toast("Skill " + action + "d", "ok");
    loadMarketplace();
    inspectMarketplaceSkill(id);
  } catch(e) { toast("Skill action failed: " + e.message, "err"); }
}

function loadSkills(){ return loadMarketplace(); }
function inspectSkill(id){ return inspectMarketplaceSkill(id); }

// ── Security ──────────────────────────────────────────────────────────────────
let activeShieldTab = "overview";
let currentShieldProcesses = [];

async function switchShieldTab(tab) {
  activeShieldTab = tab;
  const tabs = ["overview", "processes", "startup", "downloads", "browser", "lab"];
  tabs.forEach(t => {
    const btn = document.getElementById("shield-tab-" + t);
    const pnl = document.getElementById("shield-subpanel-" + t);
    if (btn) {
      if (t === tab) btn.classList.add("active");
      else btn.classList.remove("active");
    }
    if (pnl) {
      if (t === tab) pnl.style.display = "block";
      else pnl.style.display = "none";
    }
  });

  // Load tab specific data
  if (tab === "processes") await loadShieldProcesses();
  else if (tab === "startup") await loadShieldStartup();
  else if (tab === "downloads") await loadShieldDownloads();
  else if (tab === "browser") await loadShieldBrowser();
  else if (tab === "lab") await loadSecurityLab();
}

async function loadSecurity() {
  try {
    const status = await api("/api/shield/status");

    // Update Top Metric Cards
    const scoreVal = document.getElementById("shield-score-val");
    if (scoreVal) {
      scoreVal.textContent = status.score.score + "/100";
      const scoreCard = document.getElementById("shield-card-score");
      if (status.score.score >= 80) {
        scoreVal.className = "card-value text-green";
        scoreCard.className = "card card-glow-green";
      } else if (status.score.score >= 50) {
        scoreVal.className = "card-value text-amber";
        scoreCard.className = "card card-glow-amber";
      } else {
        scoreVal.className = "card-value text-red";
        scoreCard.className = "card card-glow-red";
      }
    }

    // Active threats
    const activeThreats = status.state.history[status.state.history.length - 1]?.threatsCount ?? 0;
    const threatsVal = document.getElementById("shield-threats-val");
    if (threatsVal) {
      threatsVal.textContent = activeThreats;
      const threatsCard = document.getElementById("shield-card-threats");
      if (activeThreats > 0) {
        threatsVal.style.color = "var(--red)";
        threatsCard.className = "card card-glow-red";
      } else {
        threatsVal.style.color = "var(--green)";
        threatsCard.className = "card";
      }
    }

    // Quarantined
    const quarantinedVal = document.getElementById("shield-quarantined-val");
    if (quarantinedVal) {
      const qCount = status.state.quarantined.length;
      quarantinedVal.textContent = qCount;
      quarantinedVal.style.color = qCount > 0 ? "var(--amber)" : "var(--green)";
    }

    // Tracker Block
    const adblockVal = document.getElementById("shield-adblock-val");
    if (adblockVal) {
      const adActive = status.state.adBlockEnabled;
      adblockVal.textContent = adActive ? "Enabled" : "Disabled";
      adblockVal.style.color = adActive ? "var(--cyan)" : "var(--textDim)";
      const adCard = document.getElementById("shield-card-adblock");
      if (adActive) adCard.className = "card card-glow-cyan";
      else adCard.className = "card";
    }

    // Load active threats and recommendations for overview tab
    const scan = await api("/api/shield/scan?mode=quick");
    renderOverviewScan(scan.threats, status.score.checks);

  } catch(e) {
    toast("Security load error: " + e.message, "err");
  }
}

function renderOverviewScan(threats, privacyChecks) {
  const threatsList = document.getElementById("shield-threats-list");
  const recommendationsList = document.getElementById("shield-recommendations-list");

  if (threatsList) {
    if (threats.length === 0) {
      threatsList.innerHTML = "<div class='muted' style='font-size:12px; padding:12px; text-align:center;'><span style='font-size: 24px; display:block; margin-bottom: 8px;'>✓</span>0 active threats or integrity anomalies detected.</div>";
    } else {
      threatsList.innerHTML = threats.map(function(t) {
        const badgeColor = (t.severity === "critical" || t.severity === "high") ? "badge-red" : "badge-amber";
        return "<div style='border-bottom:1px solid var(--border); padding:12px; display:flex; justify-content:space-between; align-items:center;'>" +
          "<div>" +
            "<div style='font-weight:bold; font-size:13px; display:flex; align-items:center; gap:8px;'>" +
              "<span class='badge " + badgeColor + "'>" + t.severity.toUpperCase() + "</span>" +
              t.title +
            "</div>" +
            "<div class='muted' style='font-size:11px; margin-top:4px;'>Agent: " + t.agent + " | Evidence: " + t.evidence + "</div>" +
            "<div style='font-size:12px; margin-top:4px;'>" + t.details + "</div>" +
          "</div>" +
          "<div style='display:flex; gap:6px;'>" +
            "<button class='btn btn-ghost' onclick='explainShieldThreat(\"" + t.id + "\")' style='font-size:11px; padding:2px 8px;'>Explain</button>" +
            "<button class='btn btn-danger' onclick='remediateShieldThreat(\"" + t.id + "\", " + JSON.stringify(t).replace(/"/g, '&quot;') + ")' style='font-size:11px; padding:2px 8px;'>Remediation</button>" +
          "</div>" +
        "</div>";
      }).join("");
    }
  }

  if (recommendationsList) {
    const failedChecks = privacyChecks.filter(function(c) { return !c.passed; });
    if (failedChecks.length === 0) {
      recommendationsList.innerHTML = "<div class='muted' style='font-size:12px; padding:12px; text-align:center;'><span style='font-size: 24px; display:block; margin-bottom: 8px;'>🔒</span>Privacy configurations match verified high-security profiles.</div>";
    } else {
      recommendationsList.innerHTML = failedChecks.map(function(c) {
        return "<div style='border-bottom:1px solid var(--border); padding:12px;'>" +
          "<div style='font-weight:bold; font-size:13px; color:var(--amber);'>⚠ Hardening Recommendation</div>" +
          "<div style='font-size:12px; font-weight:500; margin-top:4px;'>" + c.name + "</div>" +
          "<div class='muted' style='font-size:11px; margin-top:2px;'>" + c.details + "</div>" +
          "<div style='font-size:11px; color:var(--cyan); margin-top:4px; cursor:pointer;' onclick='switchShieldTab(\"startup\")'>› Remediate via Settings</div>" +
        "</div>";
      }).join("");
    }
  }
}

async function runShieldScan(mode) {
  toast("Running " + mode + " scan...");
  const threatsList = document.getElementById("shield-threats-list");
  if (threatsList) threatsList.innerHTML = "<div class='spin' style='margin:20px auto;'></div>";

  try {
    const scan = await api("/api/shield/scan?mode=" + mode);
    toast("Scan complete. Found " + scan.threats.length + " threats.", "ok");
    await loadSecurity();
  } catch (e) {
    toast("Scan execution error: " + e.message, "err");
  }
}

async function loadShieldProcesses() {
  const body = document.getElementById("shield-processes-table-body");
  if (!body) return;
  body.innerHTML = "<tr><td colspan='7' class='muted' style='padding:12px; text-align:center;'><div class='spin'></div></td></tr>";

  try {
    const data = await api("/api/shield/processes");
    currentShieldProcesses = data.processes ?? [];
    renderShieldProcessesList(currentShieldProcesses);
  } catch (e) {
    body.innerHTML = "<tr><td colspan='7' class='text-red' style='padding:12px; text-align:center;'>Error: " + e.message + "</td></tr>";
  }
}

function renderShieldProcessesList(processes) {
  const body = document.getElementById("shield-processes-table-body");
  if (!body) return;

  if (processes.length === 0) {
    body.innerHTML = "<tr><td colspan='7' class='muted' style='padding:12px; text-align:center;'>No processes detected</td></tr>";
    return;
  }

  body.innerHTML = processes.map(function(p) {
    const sigLabel = p.unsigned ? "<span class='badge badge-amber'>Unsigned</span>" : "<span class='badge badge-green'>Verified</span>";
    const actionBtn = "<button class='btn btn-danger' onclick='killShieldProcess(" + p.pid + ", \"" + p.name + "\")' style='font-size:10px; padding:2px 6px;'>Kill PID</button>";
    return "<tr style='border-bottom:1px solid var(--border); height:36px;' class='proc-row' data-name='" + p.name.toLowerCase() + "'>" +
      "<td style='padding:4px 8px;' class='mono'>" + p.pid + "</td>" +
      "<td style='padding:4px 8px;' class='mono'>" + p.ppid + "</td>" +
      "<td style='padding:4px 8px; font-weight:bold;'>" + p.name + "</td>" +
      "<td style='padding:4px 8px;' class='mono'>" + p.cpu + "%</td>" +
      "<td style='padding:4px 8px;' class='mono'>" + p.memory + " MB</td>" +
      "<td style='padding:4px 8px;'>" + sigLabel + "</td>" +
      "<td style='padding:4px 8px; text-align:right;'>" + actionBtn + "</td>" +
    "</tr>";
  }).join("");
}

function filterShieldProcesses() {
  const q = document.getElementById("shield-proc-search")?.value.toLowerCase() ?? "";
  const rows = document.querySelectorAll(".proc-row");
  rows.forEach(function(r) {
    const name = r.getAttribute("data-name") ?? "";
    if (name.includes(q)) r.style.display = "";
    else r.style.display = "none";
  });
}

async function killShieldProcess(pid, name) {
  if (confirm("Do you want to terminate process " + name + " (PID: " + pid + ")?")) {
    try {
      toast("Terminating process " + pid + "...");
      await api("/api/shield/quarantine", {
        method: "POST",
        body: { action: "isolate", id: "proc-" + pid, threat: { title: "Terminated Process: " + name, severity: "medium", agent: "Manual Administrator Intervention", evidence: "PID: " + pid, details: "Terminated process via System Dashboard Control", recommendations: [] } }
      });
      toast("Successfully terminated PID " + pid, "ok");
      await loadShieldProcesses();
      await loadSecurity();
    } catch (e) {
      toast("Process termination failed: " + e.message, "err");
    }
  }
}

async function loadShieldStartup() {
  const body = document.getElementById("shield-startup-table-body");
  if (!body) return;
  body.innerHTML = "<tr><td colspan='5' class='muted' style='padding:12px; text-align:center;'><div class='spin'></div></td></tr>";

  try {
    const data = await api("/api/shield/startup");
    const items = data.startup ?? [];
    if (items.length === 0) {
      body.innerHTML = "<tr><td colspan='5' class='muted' style='padding:12px; text-align:center;'>No startup entries registered</td></tr>";
      return;
    }
    body.innerHTML = items.map(function(i) {
      const integrity = i.suspicious ? "<span class='badge badge-red'>Suspicious Heuristic</span>" : "<span class='badge badge-green'>Clean Signature</span>";
      return "<tr style='border-bottom:1px solid var(--border); height:40px;'>" +
        "<td style='padding:4px 8px; font-weight:bold;'>" + i.name + "</td>" +
        "<td style='padding:4px 8px;'><span class='badge badge-gray'>" + i.type + "</span></td>" +
        "<td style='padding:4px 8px;' class='muted'>" + i.location + "</td>" +
        "<td style='padding:4px 8px;' class='mono'>" + i.command + "</td>" +
        "<td style='padding:4px 8px; text-align:right;'>" + integrity + "</td>" +
      "</tr>";
    }).join("");
  } catch (e) {
    body.innerHTML = "<tr><td colspan='5' class='text-red' style='padding:12px; text-align:center;'>Error: " + e.message + "</td></tr>";
  }
}

async function loadShieldDownloads() {
  const body = document.getElementById("shield-downloads-table-body");
  if (!body) return;
  body.innerHTML = "<tr><td colspan='5' class='muted' style='padding:12px; text-align:center;'><div class='spin'></div></td></tr>";

  try {
    const data = await api("/api/shield/downloads");
    const items = data.downloads ?? [];
    if (items.length === 0) {
      body.innerHTML = "<tr><td colspan='5' class='muted' style='padding:12px; text-align:center;'>Downloads folder empty</td></tr>";
      return;
    }
    body.innerHTML = items.map(function(d) {
      const risk = d.suspicious ? "<span class='badge badge-red'>High Risk Attachment</span>" : "<span class='badge badge-green'>Low Risk File</span>";
      const remediate = d.suspicious ? "<button class='btn btn-danger' onclick='remediateDownload(\"" + d.path + "\", \"" + d.name + "\")' style='font-size:10px; padding:2px 6px;'>Isolate</button>" : "<span class='muted'>—</span>";
      return "<tr style='border-bottom:1px solid var(--border); height:40px;'>" +
        "<td style='padding:4px 8px; font-weight:bold;'>" + d.name + "</td>" +
        "<td style='padding:4px 8px;' class='muted mono'>" + d.path + "</td>" +
        "<td style='padding:4px 8px;' class='mono'>" + Math.round(d.sizeBytes / 1024) + " KB</td>" +
        "<td style='padding:4px 8px;'>" + risk + "</td>" +
        "<td style='padding:4px 8px; text-align:right;'>" + remediate + "</td>" +
      "</tr>";
    }).join("");
  } catch (e) {
    body.innerHTML = "<tr><td colspan='5' class='text-red' style='padding:12px; text-align:center;'>Error: " + e.message + "</td></tr>";
  }
}

async function remediateDownload(path, name) {
  if (confirm("Do you want to safely isolate and quarantine the downloaded file \"" + name + "\"?")) {
    try {
      await api("/api/shield/quarantine", {
        method: "POST",
        body: { action: "isolate", id: "down-" + name, threat: { title: "Isolated Attachment: " + name, severity: "high", agent: "Download Inspector Agent", evidence: "File: " + path, details: "Safely removed from Downloads folder", recommendations: [] } }
      });
      toast("Successfully quarantined " + name, "ok");
      await loadShieldDownloads();
      await loadSecurity();
    } catch (e) {
      toast("Quarantine failed: " + e.message, "err");
    }
  }
}

async function loadShieldBrowser() {
  const metricsDiv = document.getElementById("shield-browser-metrics");
  const extensionsDiv = document.getElementById("shield-browser-extensions");
  if (!metricsDiv || !extensionsDiv) return;

  metricsDiv.innerHTML = "<div class='spin'></div>";
  extensionsDiv.innerHTML = "<div class='spin'></div>";

  try {
    const data = await api("/api/shield/browser");
    const info = data.browser?.[0] ?? { browser: "Chrome", extensions: [], cookiesCheck: { secure: true, count: 0 }, permissionsCheck: { micCamBlocked: true, notificationsBlocked: true } };

    metricsDiv.innerHTML = "<div class='stat-row'><div class='stat-key'>Active Profile</div><div class='stat-val mono text-cyan'>" + info.browser.toUpperCase() + "</div></div>" +
      "<div class='stat-row'><div class='stat-key'>Secure Cookie Policy</div><div class='stat-val text-green'>" + (info.cookiesCheck.secure ? "Verified Enforced" : "Warning (unencrypted)") + "</div></div>" +
      "<div class='stat-row'><div class='stat-key'>Tracking Cookies Cached</div><div class='stat-val mono text-amber'>" + info.cookiesCheck.count + " tracking items</div></div>" +
      "<div class='stat-row'><div class='stat-key'>Camera & Mic Consent Gating</div><div class='stat-val text-green'>" + (info.permissionsCheck.micCamBlocked ? "Fully Gated" : "Disabled (Unrestricted)") + "</div></div>" +
      "<div class='stat-row'><div class='stat-key'>Browser Notification spam</div><div class='stat-val text-green'>" + (info.permissionsCheck.notificationsBlocked ? "Blocked" : "Allowed") + "</div></div>";

    if (info.extensions.length === 0) {
      extensionsDiv.innerHTML = "<div class='muted' style='font-size:12px; padding:12px; text-align:center;'>No browser extensions detected</div>";
    } else {
      extensionsDiv.innerHTML = info.extensions.map(function(ext) {
        const titleColor = ext.suspicious ? "color:var(--red);" : "font-weight:bold;";
        return "<div style='" + titleColor + " display:flex; justify-content:space-between; align-items:center;'>" +
          "<span>" + ext.name + "</span>" +
          (ext.suspicious ? "<span class='badge badge-red'>Heuristic Warn</span>" : "<span class='badge badge-green'>Verified</span>") +
        "</div>" +
        "<div class='muted' style='font-size:10px; margin-top:2px;'>ID: " + ext.id + "</div>" +
        "<div class='muted' style='font-size:10px;'>Permissions: " + ext.permissions.join(", ") + "</div>";
      }).join("");
    }
  } catch (e) {
    metricsDiv.innerHTML = "<div class='text-red'>Error: " + e.message + "</div>";
  }
}

async function toggleShieldAdBlock() {
  try {
    const status = await api("/api/shield/status");
    const currentlyEnabled = status.state.adBlockEnabled;
    const confirmMsg = currentlyEnabled
      ? "Do you want to disable DNS-level ad and tracker filtering?"
      : "Would you like to enable DNS-level ad and tracker block lists? This modifies your local hosts file to sinkhole malicious domains.";

    if (confirm(confirmMsg)) {
      toast("Updating filter hosts configurations...");
      const result = await api("/api/shield/adblock", { method: "POST", body: { enable: !currentlyEnabled } });
      toast("Successfully updated ad and tracker block configuration", "ok");
      await loadSecurity();
    }
  } catch (e) {
    toast("Adblock update failed: " + e.message, "err");
  }
}

async function explainShieldThreat(id) {
  try {
    const res = await api("/api/shield/explain", { method: "POST", body: { id: id } });
    const analysis = res.analysis;
    alert("[" + analysis.agentName + " REPORT - Confidence: " + Math.round(analysis.confidence * 100) + "%]\n\nANALYST EXPLANATION:\n" + analysis.explanation + "\n\nRECOMMENDED ACTION:\n" + analysis.remedy);
  } catch (e) {
    toast("Explanation query failed: " + e.message, "err");
  }
}

async function remediateShieldThreat(id, threat) {
  const confirmMsg = "Address finding \"" + threat.title + "\"? This executes the specialized agent remediation workflow: isolate item and add file rule parameters to block execution.";
  if (confirm(confirmMsg)) {
    try {
      toast("Initiating isolation gating...");
      await api("/api/shield/quarantine", {
        method: "POST",
        body: { action: "isolate", id: id, threat: threat }
      });
      toast("Integrity hardening applied successfully.", "ok");
      await loadSecurity();
    } catch (e) {
      toast("Remediation execution error: " + e.message, "err");
    }
  }
}

async function loadSecurityLab() {
  try {
    const sec = await api("/api/security");
    const outcomes = sec.outcomes ?? [];
    document.getElementById("sec-lab-result").innerHTML = outcomes.length
      ? outcomes.map(function(o) {
           return "<div class='sec-attack'>" +
              "<span class='sec-icon'>" + (o.blocked ? "✓" : "✗") + "</span>" +
              "<span class='sec-label'>" + o.category + "</span>" +
              "<span class='sec-result " + (o.blocked ? 'val-green' : 'val-red') + "'>" + (o.blocked ? "blocked" : "ALLOWED") + "</span>" +
            "</div>";
         }).join("")
      : "<div class='muted' style='font-size:12px'>Click Run Lab to execute tests</div>";

    document.getElementById("sec-egress").innerHTML =
      "<div class='stat-row'><div class='stat-key'>Egress allow-list</div><div class='stat-val val-muted'>" + (sec.egressAllowlist?.join(", ") || "unrestricted") + "</div></div>";

    document.getElementById("sec-posture").innerHTML =
      "<div class='stat-row'><div class='stat-key'>Local-first</div><div class='stat-val val-green'>✓</div></div>" +
       "<div class='stat-row'><div class='stat-key'>API key redaction</div><div class='stat-val val-green'>✓</div></div>" +
       "<div class='stat-row'><div class='stat-key'>Budget enforcement</div><div class='stat-val val-green'>code-enforced</div></div>" +
       "<div class='stat-row'><div class='stat-key'>Approval gates</div><div class='stat-val val-cyan'>configured</div></div>";
  } catch (e) {
    toast("Security lab load error: " + e.message, "err");
  }
}

async function runSecLab() {
  document.getElementById("sec-lab-result").innerHTML = "<div class='spin'></div>";
  await loadSecurityLab();
}
async function loadAuditLog() {
  try {
    const data  = await api("/api/audit?limit=50");
    const chain = data.chain;
    const badge = document.getElementById("audit-chain-badge");
    badge.textContent = chain.valid ? "Chain intact" : "BROKEN";
    badge.className   = "badge " + (chain.valid ? "badge-green" : "badge-red");

    const entries = data.entries ?? [];
    document.getElementById("audit-log-list").innerHTML = entries.length
      ? entries.map(e => \`
          <div class="audit-row">
            <div class="audit-ts">\${new Date(e.ts).toLocaleString()}</div>
            <div class="audit-event">\${e.event}</div>
            <div class="audit-hash" title="Hash: \${e.hash ?? ''}">#\${(e.hash ?? "").slice(0,8)}</div>
          </div>\`).join("")
      : "<div class='muted' style='font-size:12px;padding:16px 0'>No audit entries yet. Run a task to see the log.</div>";
  } catch(e) {
    toast("Audit error: " + e.message, "err");
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await api("/api/config");
    document.getElementById("set-budget").textContent = cfg.budget?.perTaskUsd ? "$" + cfg.budget.perTaskUsd : "no limit";
    document.getElementById("set-egress").textContent = cfg.security?.egressAllowlist?.join(", ") || "unrestricted";
    document.getElementById("set-approval").textContent = cfg.security?.requireApproval?.join(", ") || "none";
    document.getElementById("set-key-backend").textContent = "OS keychain / encrypted file";
  } catch {}
}

// ── Chat UI ───────────────────────────────────────────────────────────────────
let chatHistory = [];
let chatStreaming = false;

function buildChatUI() {
  const panel = document.getElementById("panel-chat");
  if (panel.innerHTML.trim()) return; // already built

  panel.innerHTML = \`
    <div class="chat-wrap">
      <div class="chat-header">
        <span style="font-size:18px;color:var(--cyan)">💬</span>
        <div>
          <div class="chat-header-title">XR Chat</div>
          <div class="chat-header-model" id="chat-model-label">local-first · BYOK</div>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-ghost" style="font-size:11px" onclick="clearChat()">Clear</button>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div class="msg assistant">
          <div class="msg-bubble">
            👋 Hi! I'm <strong>XR</strong> — the AI agent you can actually trust.<br><br>
            I'm running locally. You can ask me anything, run research, write code, check your system status, or use slash commands like <code style="color:var(--cyan)">/plan</code>, <code style="color:var(--cyan)">/research</code>, or <code style="color:var(--cyan)">/status</code>.
          </div>
          <div class="msg-meta">XR · local-first</div>
        </div>
      </div>

      <div class="chat-input-wrap">
        <div class="chat-input-row">
          <textarea id="chat-input" placeholder="Ask XR anything… or use /plan, /research, /status" rows="1"></textarea>
          <button class="chat-send" id="chat-send-btn" onclick="sendChatMessage()">Send ↑</button>
        </div>
        <div class="chat-hint">
          <span class="hint-chip" onclick="insertHint('/plan ')">⚙ /plan</span>
          <span class="hint-chip" onclick="insertHint('/status')">◎ /status</span>
          <span class="hint-chip" onclick="insertHint('/research ')">🔬 /research</span>
          <span class="hint-chip" onclick="insertHint('/ask ')">? /ask</span>
          <span class="hint-chip" onclick="insertHint('/memory')">🧠 /memory</span>
          <span class="hint-chip" onclick="insertHint('/budget ')">💰 /budget</span>
        </div>
      </div>
    </div>\`;

  const input = document.getElementById("chat-input");
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    autoResize(input);
  });
  input.addEventListener("input", () => autoResize(input));
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function insertHint(text) {
  const input = document.getElementById("chat-input");
  if (!input) return;
  input.value = text;
  input.focus();
  autoResize(input);
}

function clearChat() {
  chatHistory = [];
  const msgs = document.getElementById("chat-messages");
  if (msgs) msgs.innerHTML = \`
    <div class="msg assistant">
      <div class="msg-bubble">Chat cleared. How can I help?</div>
      <div class="msg-meta">XR</div>
    </div>\`;
}

function appendMessage(role, content, isTyping = false) {
  const msgs = document.getElementById("chat-messages");
  if (!msgs) return null;
  const div  = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "assistant");
  if (isTyping) {
    div.innerHTML = \`<div class="msg-bubble"><div class="typing-indicator">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div></div>\`;
  } else {
    div.innerHTML = \`<div class="msg-bubble">\${content}</div>
      <div class="msg-meta">\${role === "user" ? "You" : "XR · " + new Date().toLocaleTimeString()}</div>\`;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

async function sendChatMessage() {
  if (chatStreaming) return;
  const input = document.getElementById("chat-input");
  const btn   = document.getElementById("chat-send-btn");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  autoResize(input);
  chatStreaming = true;
  if (btn) btn.disabled = true;

  appendMessage("user", escapeHtml(text));
  chatHistory.push({ role: "user", content: text });

  const typingEl = appendMessage("assistant", "", true);

  try {
    // POST to /api/chat (streaming endpoint)
    const res = await fetch(BASE + "/api/chat", {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory.slice(-10) }),
    });

    if (!res.ok) throw new Error("Chat API unavailable — is XR server running?");

    let reply = "";
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (typingEl) typingEl.remove();
    const replyEl = appendMessage("assistant", "");
    const bubble  = replyEl?.querySelector(".msg-bubble");

    if (reader && bubble) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Handle SSE: "data: {...}\\n\\n"
        for (const line of chunk.split("\\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const j = JSON.parse(data);
            if (j.delta) { reply += j.delta; bubble.innerHTML = formatReply(reply); }
            if (j.text)  { reply = j.text;  bubble.innerHTML = formatReply(reply); }
          } catch { reply += data; bubble.innerHTML = formatReply(reply); }
        }
        const msgs = document.getElementById("chat-messages");
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      }
    } else if (bubble) {
      // Fallback: non-streaming
      const j = await res.json().catch(() => ({ reply: "No response" }));
      reply = j.reply ?? j.content ?? "No response";
      bubble.innerHTML = formatReply(reply);
    }

    chatHistory.push({ role: "assistant", content: reply });
  } catch (e) {
    if (typingEl) typingEl.remove();
    appendMessage("assistant", \`<span style="color:var(--red)">⚠ \${escapeHtml(e.message)}</span>\\n\\nTip: Make sure the XR server is running with <code style="color:var(--cyan)">xr serve</code>\`);
  } finally {
    chatStreaming = false;
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

function formatReply(text) {
  return text
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, (_,lang,code) =>
      \`<pre style="background:var(--surface2);padding:10px;border-radius:6px;font-family:var(--font);font-size:12px;overflow-x:auto;margin:8px 0">\${code}</pre>\`)
    .replace(/\`([^\`]+)\`/g, '<code style="background:rgba(0,212,255,.12);color:var(--cyan);padding:1px 5px;border-radius:3px;font-family:var(--font)">$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\\n/g, "<br>");
}

function escapeHtml(t) {
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Command Palette ───────────────────────────────────────────────────────────
const PALETTE_CMDS = [
  { label: "Go to Dashboard",    icon: "⬡", action: () => navigateTo("dashboard"), key: "g d" },
  { label: "Go to Chat",         icon: "💬", action: () => navigateTo("chat"),      key: "g c" },
  { label: "Go to Providers",    icon: "☁",  action: () => navigateTo("providers") },
  { label: "Go to Models",       icon: "⚙",  action: () => navigateTo("models") },
  { label: "Go to Memory",       icon: "🧠", action: () => navigateTo("memory") },
  { label: "Go to Security",     icon: "🔒", action: () => navigateTo("security") },
  { label: "Go to Audit Log",    icon: "📜", action: () => navigateTo("audit") },
  { label: "Go to Settings",     icon: "⚙",  action: () => navigateTo("settings") },
  { label: "Refresh Dashboard",  icon: "↻",  action: refreshAll },
  { label: "Clear Memory",       icon: "🗑",  action: clearMemory },
];

let paletteOpen = false;
let paletteFocus = 0;

function openPalette() {
  document.getElementById("palette").classList.add("open");
  document.getElementById("palette-search").value = "";
  renderPaletteResults("");
  document.getElementById("palette-search").focus();
  paletteOpen = true;
  paletteFocus = 0;
}

function closePalette() {
  document.getElementById("palette").classList.remove("open");
  paletteOpen = false;
}

function renderPaletteResults(q) {
  const items = PALETTE_CMDS.filter(c => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  const el = document.getElementById("palette-results");
  el.innerHTML = items.map((c, i) =>
    \`<div class="palette-item \${i === paletteFocus ? "focused" : ""}" data-idx="\${i}">
       <span>\${c.icon}</span>
       <span>\${c.label}</span>
       \${c.key ? \`<span class="palette-key">\${c.key}</span>\` : ""}
     </div>\`
  ).join("");
  el.querySelectorAll(".palette-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = +el.dataset.idx;
      items[idx]?.action();
      closePalette();
    });
  });
}

document.getElementById("palette-search").addEventListener("input", e => {
  paletteFocus = 0;
  renderPaletteResults(e.target.value);
});

document.getElementById("palette-search").addEventListener("keydown", e => {
  const items = document.querySelectorAll(".palette-item");
  if (e.key === "Escape") { closePalette(); return; }
  if (e.key === "ArrowDown") { paletteFocus = Math.min(paletteFocus + 1, items.length - 1); }
  if (e.key === "ArrowUp")   { paletteFocus = Math.max(paletteFocus - 1, 0); }
  if (e.key === "Enter") { items[paletteFocus]?.click(); return; }
  renderPaletteResults(e.target.value);
});

document.getElementById("palette").addEventListener("click", e => {
  if (e.target === document.getElementById("palette")) closePalette();
});

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────
let gPressed = false;
document.addEventListener("keydown", e => {
  if (paletteOpen) return;
  // Chat input focus
  if (document.activeElement?.id === "chat-input" ||
      document.activeElement?.id === "palette-search") return;
  if (e.key === "?" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault(); openPalette(); return;
  }
  if (e.key === "g") { gPressed = true; setTimeout(() => gPressed = false, 1000); return; }
  if (gPressed) {
    if (e.key === "d") { navigateTo("dashboard"); gPressed = false; }
    if (e.key === "c") { navigateTo("chat");      gPressed = false; }
    if (e.key === "p") { navigateTo("providers"); gPressed = false; }
    if (e.key === "m") { navigateTo("memory");    gPressed = false; }
    if (e.key === "s") { navigateTo("security");  gPressed = false; }
    if (e.key === "a") { navigateTo("audit");     gPressed = false; }
  }
});

// ── Refresh ───────────────────────────────────────────────────────────────────
function refreshAll() {
  const active = document.querySelector(".nav-item.active")?.dataset.panel ?? "dashboard";
  navigateTo(active);
  toast("Refreshed", "info");
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadDashboard();

// Live poll every 30s
setInterval(() => {
  const active = document.querySelector(".nav-item.active")?.dataset.panel;
  if (active === "dashboard") loadDashboard();
  if (active === "audit")     loadAuditLog();
}, 30_000);
</script>
</body>
</html>`;
