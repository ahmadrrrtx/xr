/**
 * XR — dashboard HTML (Block 5, elite redesign).
 * Design language: dark glassmorphism + ambient color orbs + neon-glow accents
 * + bento grid + animated SVG data-viz + micro-interactions. Self-contained
 * (inline CSS/SVG, no external assets → offline & sandbox-safe).
 */
export function dashboardHtml(token: string): string {
  return PAGE.replace("__TOKEN__", token);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>XR — Control Center</title>
<style>
  :root{
    --bg:#05070d; --ink:#eaf1f9; --dim:#7d8fa6; --faint:#4a5a70;
    --cyan:#22e0ff; --teal:#19f0c8; --violet:#9a6bff; --pink:#ff5db8;
    --green:#34e2a0; --amber:#ffc24b; --red:#ff5a6a;
    --glass:rgba(255,255,255,.045); --edge:rgba(255,255,255,.10);
    --glass2:rgba(255,255,255,.025);
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--ink);overflow-x:hidden;
    font:14px/1.55 ui-monospace,'SF Mono',Menlo,'Cascadia Code',Consolas,monospace;
    -webkit-font-smoothing:antialiased}
  /* ambient color orbs that the glass distorts */
  .orb{position:fixed;border-radius:50%;filter:blur(90px);opacity:.5;z-index:0;pointer-events:none}
  .orb.a{width:520px;height:520px;background:#0c6cff;top:-160px;left:-120px;opacity:.35}
  .orb.b{width:480px;height:480px;background:#9a3bff;bottom:-180px;right:-100px;opacity:.30}
  .orb.c{width:420px;height:420px;background:#12d6c0;top:40%;left:55%;opacity:.18}
  .grid-bg{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.35;
    background-image:linear-gradient(rgba(120,160,220,.06) 1px,transparent 1px),
      linear-gradient(90deg,rgba(120,160,220,.06) 1px,transparent 1px);
    background-size:46px 46px;
    mask-image:radial-gradient(circle at 50% 30%,#000 0%,transparent 75%)}
  .wrap{position:relative;z-index:1;max-width:1280px;margin:0 auto;padding:26px 22px 60px}

  header{display:flex;align-items:center;gap:16px;margin-bottom:24px}
  .brand{display:flex;align-items:center;gap:12px}
  .mark{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-weight:900;
    color:#031018;background:linear-gradient(135deg,var(--cyan),var(--teal));
    box-shadow:0 0 28px rgba(34,224,255,.45);font-size:18px;letter-spacing:-1px}
  .brand .name{font-weight:800;letter-spacing:3px;font-size:20px}
  .brand .name b{background:linear-gradient(90deg,var(--cyan),var(--violet));-webkit-background-clip:text;background-clip:text;color:transparent}
  .brand .tag{color:var(--dim);font-size:11px;letter-spacing:.5px}
  .live{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--green);
    background:var(--glass);border:1px solid var(--edge);padding:7px 13px;border-radius:99px;backdrop-filter:blur(10px)}
  .live .pulse{width:8px;height:8px;border-radius:50%;background:var(--green);
    box-shadow:0 0 0 0 rgba(52,226,160,.7);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,226,160,.55)}70%{box-shadow:0 0 0 10px rgba(52,226,160,0)}100%{box-shadow:0 0 0 0 rgba(52,226,160,0)}}

  .bento{display:grid;grid-template-columns:repeat(12,1fr);gap:18px}
  .card{position:relative;background:linear-gradient(180deg,var(--glass),var(--glass2));
    border:1px solid var(--edge);border-radius:18px;padding:20px;backdrop-filter:blur(16px);
    -webkit-backdrop-filter:blur(16px);overflow:hidden;transition:transform .25s,border-color .25s,box-shadow .25s}
  .card::before{content:"";position:absolute;inset:0;border-radius:18px;padding:1px;
    background:linear-gradient(135deg,rgba(255,255,255,.18),transparent 40%);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
    -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;opacity:.6}
  .card:hover{transform:translateY(-3px);border-color:rgba(34,224,255,.35);
    box-shadow:0 14px 40px rgba(0,0,0,.45),0 0 0 1px rgba(34,224,255,.12)}
  .card h3{margin:0 0 14px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);
    display:flex;align-items:center;gap:9px;font-weight:700}
  .card h3 .ic{filter:drop-shadow(0 0 6px rgba(34,224,255,.5))}
  .c3{grid-column:span 3}.c4{grid-column:span 4}.c5{grid-column:span 5}
  .c6{grid-column:span 6}.c7{grid-column:span 7}.c8{grid-column:span 8}.c12{grid-column:span 12}
  @media(max-width:1000px){.c3,.c4,.c5{grid-column:span 6}.c6,.c7,.c8{grid-column:span 12}}
  @media(max-width:620px){.c3,.c4,.c5,.c6{grid-column:span 12}}

  .big{font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1.05}
  .glow-cyan{text-shadow:0 0 22px rgba(34,224,255,.55)}
  .glow-green{text-shadow:0 0 22px rgba(52,226,160,.5)}
  .sub{color:var(--dim);font-size:12px;margin-top:4px}
  .unit{font-size:14px;color:var(--dim);font-weight:600}

  .track{height:9px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:14px;position:relative}
  .track>i{position:absolute;inset:0 auto 0 0;border-radius:99px;
    background:linear-gradient(90deg,var(--cyan),var(--violet));box-shadow:0 0 16px rgba(34,224,255,.5);
    transition:width .8s cubic-bezier(.2,.8,.2,1)}

  .spark{display:flex;align-items:flex-end;gap:4px;height:54px;margin-top:16px}
  .spark>span{flex:1;border-radius:3px 3px 0 0;min-height:3px;
    background:linear-gradient(180deg,var(--cyan),rgba(34,224,255,.15));transition:height .6s ease}

  .kvs{display:grid;grid-template-columns:1fr auto;gap:9px 14px;margin-top:14px}
  .kvs .lab{color:var(--dim)}
  .kvs b{font-weight:700;text-align:right}

  .chip{font-size:11px;font-weight:700;padding:3px 10px;border-radius:7px;display:inline-flex;align-items:center;gap:6px}
  .chip.ok{color:var(--green);background:rgba(52,226,160,.12);border:1px solid rgba(52,226,160,.25)}
  .chip.bad{color:var(--red);background:rgba(255,90,106,.12);border:1px solid rgba(255,90,106,.25)}
  .chip.warn{color:var(--amber);background:rgba(255,194,75,.12);border:1px solid rgba(255,194,75,.25)}

  .list{margin-top:6px;max-height:270px;overflow:auto}
  .list::-webkit-scrollbar{width:7px}.list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:99px}
  .item{display:flex;align-items:center;gap:11px;padding:9px 6px;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px}
  .item:last-child{border-bottom:0}
  .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
  .cat{color:var(--dim);width:182px;flex:0 0 auto;font-size:12px}
  .desc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .time{color:var(--faint);font-size:11px}
  .hash{color:var(--faint);font-size:11px;margin-left:auto}
  .muted{color:var(--dim)}
  .mrow{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}
  .mrow:last-child{border-bottom:0}
  footer{margin-top:30px;color:var(--faint);font-size:11px;text-align:center;letter-spacing:.4px}
  .shield{display:inline-block;vertical-align:-2px}
</style>
</head>
<body>
<div class="orb a"></div><div class="orb b"></div><div class="orb c"></div>
<div class="grid-bg"></div>

<div class="wrap">
  <header>
    <div class="brand">
      <div class="mark">XR</div>
      <div>
        <div class="name"><b>XR</b> CONTROL CENTER</div>
        <div class="tag">the AI agent you can actually trust · by rrrtx</div>
      </div>
    </div>
    <div class="live"><span class="pulse" id="pulse"></span><span id="health">connecting…</span></div>
  </header>

  <div class="bento">

    <!-- COST COCKPIT -->
    <section class="card c5">
      <h3><span class="ic">💰</span> Cost Cockpit</h3>
      <div class="big glow-cyan"><span id="cost-usd">$0.0000</span></div>
      <div class="sub" id="cost-tok">0 tokens · this machine</div>
      <div class="track"><i id="cost-bar" style="width:0%"></i></div>
      <div class="sub" id="cost-cap" style="margin-top:8px"></div>
      <div class="spark" id="cost-spark"></div>
    </section>

    <!-- SECURITY POSTURE -->
    <section class="card c4">
      <h3><span class="ic">🛡️</span> Security Posture</h3>
      <div style="display:flex;align-items:center;gap:20px">
        <svg viewBox="0 0 130 130" width="118" height="118">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#22e0ff"/><stop offset="1" stop-color="#34e2a0"/>
            </linearGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="3.2" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <circle cx="65" cy="65" r="52" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="11"/>
          <circle id="sec-arc" cx="65" cy="65" r="52" fill="none" stroke="url(#g1)" stroke-width="11"
            stroke-linecap="round" stroke-dasharray="327" stroke-dashoffset="327"
            transform="rotate(-90 65 65)" filter="url(#glow)" style="transition:stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)"/>
          <text id="sec-score" x="65" y="60" text-anchor="middle" fill="#eaf1f9" font-size="30" font-weight="800">--</text>
          <text x="65" y="80" text-anchor="middle" fill="#7d8fa6" font-size="10" letter-spacing="2">SCORE</text>
        </svg>
        <div>
          <div class="sub">injection block-rate</div>
          <div class="big glow-green" id="sec-rate">--</div>
          <div class="sub" id="sec-line"></div>
        </div>
      </div>
    </section>

    <!-- AUDIT INTEGRITY -->
    <section class="card c3">
      <h3><span class="ic">🔒</span> Audit Integrity</h3>
      <div class="big" id="audit-status" style="font-size:26px">checking…</div>
      <div class="sub" id="audit-count">0 entries</div>
      <div class="kvs">
        <span class="lab">hash chain</span><b id="audit-chain" class="chip ok">verifying</b>
        <span class="lab">skills learned</span><b id="kv-skills">0</b>
        <span class="lab">frozen baselines</span><b id="kv-frozen">0</b>
        <span class="lab">RAG chunks</span><b id="kv-rag">0</b>
      </div>
    </section>

    <!-- INJECTION LAB -->
    <section class="card c7">
      <h3><span class="ic">🔬</span> Injection Test Lab <span id="lab-badge" class="chip ok" style="margin-left:auto">--</span></h3>
      <div class="list" id="att-list"></div>
    </section>

    <!-- PROJECT + COST BY MODEL -->
    <section class="card c5">
      <h3><span class="ic">📦</span> Project</h3>
      <div class="big" id="proj-name" style="font-size:24px">—</div>
      <div class="kvs">
        <span class="lab">files indexed</span><b id="proj-files">0</b>
        <span class="lab">frameworks</span><b id="proj-fw">—</b>
        <span class="lab">test coverage</span><b id="proj-tests">—</b>
      </div>
      <h3 style="margin-top:20px"><span class="ic">📊</span> Cost by Model</h3>
      <div id="by-model"></div>
    </section>

    <!-- AUDIT EXPLORER -->
    <section class="card c7">
      <h3><span class="ic">📜</span> Audit Explorer <span class="muted" style="margin-left:auto;font-size:11px;letter-spacing:0">tamper-evident · hash-chained</span></h3>
      <div class="list" id="audit-list"></div>
    </section>

    <!-- COMPUTER CONTROL (v0.8.1) -->
    <section class="card c12" id="ctrl-card">
      <h3>
        <span class="ic">🖥️</span> Computer Control
        <span id="ctrl-state" class="chip warn" style="margin-left:auto">checking…</span>
      </h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div>
          <div class="sub">Capabilities</div>
          <div class="kvs" id="ctrl-caps">
            <span class="lab">platform</span><b id="ctrl-os">—</b>
            <span class="lab">keyboard</span><b id="ctrl-kbd">—</b>
            <span class="lab">mouse</span><b id="ctrl-mouse">—</b>
            <span class="lab">launcher</span><b id="ctrl-launcher">—</b>
            <span class="lab">browser (playwright)</span><b id="ctrl-browser">—</b>
          </div>
          <div class="sub" style="margin-top:18px">Plan a task (preview only)</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="ctrl-task" placeholder='e.g. open github.com and search for "ahmadrrrtx"'
              style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--edge);color:var(--ink);
                     border-radius:9px;padding:9px 12px;font:inherit;outline:none" />
            <button id="ctrl-plan-btn"
              style="background:linear-gradient(135deg,var(--cyan),var(--violet));color:#031018;border:0;
                     border-radius:9px;padding:9px 16px;font-weight:700;cursor:pointer;font:inherit">Plan</button>
          </div>
          <pre id="ctrl-plan-out" class="muted" style="margin-top:10px;max-height:160px;overflow:auto;
            font-size:11px;background:rgba(0,0,0,.25);padding:10px;border-radius:9px;
            border:1px solid var(--edge);white-space:pre-wrap;display:none"></pre>
        </div>
        <div>
          <div class="sub">Pending approvals <span id="ctrl-pending-count" class="muted">(0)</span></div>
          <div class="list" id="ctrl-pending" style="max-height:200px;margin-top:8px"></div>
          <div class="sub" style="margin-top:18px">Recent control events</div>
          <div class="list" id="ctrl-events" style="max-height:200px;margin-top:8px"></div>

          <div class="sub" style="margin-top:18px">
            🧠 Remembered plans <span id="ctrl-mem-count" class="muted">(0)</span>
            <button id="ctrl-mem-clear" style="float:right;background:rgba(255,90,106,.1);color:var(--red);
              border:1px solid rgba(255,90,106,.25);padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;font:inherit">clear all</button>
          </div>
          <div class="list" id="ctrl-mem" style="max-height:160px;margin-top:8px"></div>
        </div>
      </div>
    </section>

    <section class="card c12" id="memory-card">
      <h3>
        <span class="ic">🧠</span> Durable Memory
        <span id="mem-state" class="chip ok" style="margin-left:auto">checking…</span>
      </h3>
      <div class="kvs" id="mem-stats" style="margin-bottom:10px">
        <span class="lab">entries</span><b id="mem-count">0</b>
      </div>
      <div class="sub" style="margin-top:6px">
        Saved preferences, project context &amp; facts — only what you asked XR to remember.
        <button id="mem-clear" style="float:right;background:rgba(255,90,106,.1);color:var(--red);
          border:1px solid rgba(255,90,106,.25);padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;font:inherit">clear all</button>
      </div>
      <div class="list" id="mem-list" style="max-height:240px;margin-top:10px"></div>
      <div class="sub muted" style="margin-top:10px;font-size:11px">
        Read-only viewer · add/edit from the CLI: <code>xr memory add "…"</code> · do-not-remember rules are hidden here.
      </div>
    </section>

  </div>
  <footer>🔐 127.0.0.1 only · token-authed · read-mostly · every state change is approval-gated & recorded in the hash chain</footer>
</div>

<script>
const TOKEN="__TOKEN__";
const H={headers:{authorization:"Bearer "+TOKEN}};
const $=id=>document.getElementById(id);
const money=n=>"$"+Number(n||0).toFixed(4);
const k=n=>n>=1000?(n/1000).toFixed(1)+"k":String(Math.round(n||0));
async function get(p){try{const r=await fetch(p,H);return r.ok?await r.json():null}catch(e){return null}}

async function load(){
  const health=await get("/api/health");
  $("health").textContent=health?"LIVE":"OFFLINE";
  $("pulse").style.background=health?"var(--green)":"var(--red)";

  const ov=await get("/api/overview");
  if(ov){
    $("proj-name").textContent=ov.project;
    $("proj-files").textContent=ov.ragChunks?ov.fingerprint.files:ov.fingerprint.files;
    $("proj-fw").textContent=(ov.fingerprint.frameworks||[]).join(", ")||"—";
    $("proj-tests").textContent=ov.fingerprint.hasTests?"detected":"none";
    $("audit-count").textContent=ov.audit.count+" entries";
    const intact=ov.audit.chain.valid;
    $("audit-status").textContent=intact?"✓ INTACT":"✗ BROKEN";
    $("audit-status").style.color=intact?"var(--green)":"var(--red)";
    const ac=$("audit-chain");ac.textContent=intact?"verified":"BROKEN";ac.className="chip "+(intact?"ok":"bad");
    $("kv-skills").textContent=ov.skills.learned;$("kv-frozen").textContent=ov.skills.frozen;$("kv-rag").textContent=ov.ragChunks;
    window.__cap=ov.budget;
  }

  const cost=await get("/api/cost");
  if(cost){
    $("cost-usd").textContent=money(cost.totalUsd);
    $("cost-tok").textContent=k(cost.totalTokens)+" tokens · this machine";
    const cap=(window.__cap&&window.__cap.perTaskUsd)||0.25;
    const pct=Math.min(100,(cost.totalUsd/cap)*100);
    const bar=$("cost-bar");bar.style.width=pct+"%";
    bar.style.background=pct>85?"linear-gradient(90deg,var(--amber),var(--red))":"linear-gradient(90deg,var(--cyan),var(--violet))";
    $("cost-cap").textContent="per-task cap "+money(cap)+"  ·  "+pct.toFixed(0)+"% used";
    const sp=$("cost-spark");sp.innerHTML="";
    const rec=(cost.recent||[]).slice().reverse();const mx=Math.max(1,...rec.map(r=>r.tokens||0));
    (rec.length?rec:[{tokens:0}]).forEach(r=>{const s=document.createElement("span");s.style.height=((r.tokens||0)/mx*100)+"%";sp.appendChild(s)});
    const bm=$("by-model");bm.innerHTML="";
    (cost.byModel||[]).forEach(m=>{const d=document.createElement("div");d.className="mrow";
      d.innerHTML='<span>'+m.model+'</span><span class="muted">'+k(m.tokens)+' · '+money(m.usd)+'</span>';bm.appendChild(d)});
    if(!(cost.byModel||[]).length)bm.innerHTML='<div class="muted" style="padding:10px 0">no spend yet — run a task</div>';
  }

  const sec=await get("/api/security");
  if(sec){
    const pct=Math.round(sec.rate*100);
    $("sec-rate").textContent=pct+"%";$("sec-line").textContent=sec.blocked+" / "+sec.total+" attacks blocked";
    const arc=$("sec-arc"),C=327;arc.style.strokeDashoffset=C-(C*sec.rate);$("sec-score").textContent=pct;
    const lb=$("lab-badge");lb.textContent=sec.blocked+"/"+sec.total;lb.className="chip "+(pct>=90?"ok":pct>=70?"warn":"bad");
    const list=$("att-list");list.innerHTML="";
    (sec.outcomes||[]).forEach(o=>{const d=document.createElement("div");d.className="item";
      d.innerHTML='<span class="dot" style="background:'+(o.blocked?"var(--green)":"var(--red)")+';box-shadow:0 0 8px '+(o.blocked?"rgba(52,226,160,.7)":"rgba(255,90,106,.7)")+'"></span>'
        +'<span class="cat">'+o.category+'</span><span class="desc">'+o.description+'</span>'
        +'<span class="chip '+(o.blocked?"ok":"bad")+'" style="margin-left:auto">'+(o.blocked?"blocked":"ALLOWED")+'</span>';
      list.appendChild(d)});
  }

  const aud=await get("/api/audit?limit=40");
  if(aud){
    const list=$("audit-list");list.innerHTML="";
    (aud.entries||[]).forEach(e=>{const t=new Date(e.created_at).toLocaleTimeString();
      const d=document.createElement("div");d.className="item";
      d.innerHTML='<span class="time">'+t+'</span><span class="desc">'+e.event+'</span>'
        +'<span class="hash" title="'+e.hash+'">#'+e.hash.slice(0,10)+'</span>';
      list.appendChild(d)});
    if(!(aud.entries||[]).length)list.innerHTML='<div class="muted" style="padding:10px 0">no activity yet</div>';
  }

  // ── Computer Control (v0.8.1) ────────────────────────────────────────────
  const cs = await get("/api/control/status");
  if (cs) {
    const st = $("ctrl-state");
    if (cs.enabled) { st.textContent = "enabled"; st.className = "chip ok"; }
    else { st.textContent = "disabled"; st.className = "chip bad"; st.title = cs.disabledReason || ""; }
    $("ctrl-os").textContent = cs.capabilities.os;
    const yn = (b) => b ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>';
    $("ctrl-kbd").innerHTML = yn(cs.capabilities.tools.keyboard);
    $("ctrl-mouse").innerHTML = yn(cs.capabilities.tools.mouse);
    $("ctrl-launcher").innerHTML = yn(cs.capabilities.tools.launcher);
    $("ctrl-browser").innerHTML = cs.browser?.installed
      ? '<span style="color:var(--green)">✓ installed</span>' + (cs.browser.active ? ' <span class="muted">· session open</span>' : '')
      : '<span style="color:var(--amber)">not installed</span>';
  }

  const pend = await get("/api/control/pending");
  if (pend) {
    const list = $("ctrl-pending"); list.innerHTML = "";
    $("ctrl-pending-count").textContent = "(" + (pend.pending || []).length + ")";
    (pend.pending || []).forEach((p) => {
      const ageS = Math.round((Date.now() - p.createdAt) / 1000);
      const riskColor = p.risk.level === "destructive" ? "var(--red)"
        : p.risk.level === "sensitive" ? "var(--amber)" : "var(--green)";
      const row = document.createElement("div");
      row.className = "item";
      row.style.flexWrap = "wrap";
      row.innerHTML =
        '<span class="dot" style="background:' + riskColor + '"></span>' +
        '<span class="desc"><b>' + p.risk.level + '</b> · ' + escapeHtml(stripAnsi(p.preview)) + '</span>' +
        '<span class="time">' + ageS + 's</span>' +
        '<div style="margin-left:auto;display:flex;gap:6px">' +
          '<button class="btn-approve" data-id="' + p.id + '" style="background:rgba(52,226,160,.15);color:var(--green);border:1px solid rgba(52,226,160,.35);padding:4px 10px;border-radius:7px;font-weight:700;cursor:pointer;font:inherit">Approve</button>' +
          '<button class="btn-deny"    data-id="' + p.id + '" style="background:rgba(255,90,106,.15);color:var(--red);border:1px solid rgba(255,90,106,.35);padding:4px 10px;border-radius:7px;font-weight:700;cursor:pointer;font:inherit">Deny</button>' +
        '</div>' +
        '<div class="muted" style="flex-basis:100%;font-size:11px;margin-top:4px">why: ' + escapeHtml(p.risk.reason) + '</div>';
      list.appendChild(row);
    });
    if (!(pend.pending || []).length) list.innerHTML = '<div class="muted" style="padding:10px 0">no pending approvals</div>';
    list.querySelectorAll(".btn-approve").forEach((b) => b.addEventListener("click", () => answer(b.dataset.id, true)));
    list.querySelectorAll(".btn-deny").forEach((b) => b.addEventListener("click", () => answer(b.dataset.id, false)));
  }

  const ev = await get("/api/control/events?limit=20");
  if (ev) {
    const list = $("ctrl-events"); list.innerHTML = "";
    (ev.events || []).forEach((e) => {
      const t = new Date(e.created_at).toLocaleTimeString();
      const eventColor = e.event === "control.exec" ? "var(--green)"
        : e.event === "control.denied" ? "var(--red)"
        : e.event === "control.disabled" ? "var(--dim)"
        : e.event === "control.memory.hit" ? "var(--violet)"
        : e.event === "control.memory.stored" ? "var(--teal)"
        : "var(--cyan)";
      let detailObj = {}; try { detailObj = JSON.parse(e.detail); } catch (_) {}
      const action = detailObj.action ? (detailObj.action.type || "?") : "";
      const meta = detailObj.risk ? (" · " + detailObj.risk) : (detailObj.ok === false ? " · failed" : "");
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = '<span class="time">' + t + '</span>'
        + '<span class="dot" style="background:' + eventColor + '"></span>'
        + '<span class="desc">' + e.event + ' <span class="muted">' + action + meta + '</span></span>';
      list.appendChild(row);
    });
    if (!(ev.events || []).length) list.innerHTML = '<div class="muted" style="padding:10px 0">no control events yet</div>';
  }

  // 🧠 Remembered plans
  const mem = await get("/api/control/memory");
  if (mem) {
    $("ctrl-mem-count").textContent = "(" + (mem.entries || []).length + ")";
    const list = $("ctrl-mem"); list.innerHTML = "";
    if (!mem.enabled) {
      list.innerHTML = '<div class="muted" style="padding:10px 0">memory disabled in config</div>';
    } else if (!(mem.entries || []).length) {
      list.innerHTML = '<div class="muted" style="padding:10px 0">nothing remembered yet</div>';
    } else {
      (mem.entries || []).slice(0, 8).forEach((m) => {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML =
          '<span class="dot" style="background:var(--violet)"></span>'
          + '<span class="desc"><b>' + escapeHtml(m.task) + '</b> '
          + '<span class="muted">· ' + m.steps + ' steps · ' + m.hits + ' hit' + (m.hits === 1 ? "" : "s") + '</span></span>'
          + '<button class="btn-forget" data-id="' + m.baselineId + '" style="margin-left:auto;background:rgba(255,90,106,.1);color:var(--red);border:1px solid rgba(255,90,106,.25);padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;font:inherit">forget</button>';
        list.appendChild(row);
      });
      list.querySelectorAll(".btn-forget").forEach((b) => b.addEventListener("click", () => forgetMem(b.dataset.id)));
    }
  }

  // ── v0.9 durable memory viewer ──────────────────────────────────────────
  const umem = await get("/api/memory");
  if (umem) {
    const st = $("mem-state");
    st.textContent = umem.enabled ? "enabled" : "disabled";
    st.className = "chip " + (umem.enabled ? "ok" : "warn");
    $("mem-count").textContent = umem.count || 0;
    const sv = $("mem-stats"); sv.innerHTML = '<span class="lab">entries</span><b id="mem-count">' + (umem.count || 0) + '</b>';
    (umem.stats || []).forEach((s) => {
      if (s.category === "exclusion") return;
      sv.innerHTML += '<span class="lab">' + escapeHtml(s.category) + '</span><b>' + s.c + '</b>';
    });
    const list = $("mem-list"); list.innerHTML = "";
    if (!umem.enabled) {
      list.innerHTML = '<div class="muted" style="padding:10px 0">memory disabled — enable with memory.enabled in config</div>';
    } else if (!(umem.entries || []).length) {
      list.innerHTML = '<div class="muted" style="padding:10px 0">nothing remembered yet — try <code>xr memory add "I prefer TypeScript"</code></div>';
    } else {
      const catColor = { preference: "var(--green)", project: "var(--cyan)", workflow: "var(--amber)", fact: "var(--violet)" };
      (umem.entries || []).slice(0, 40).forEach((m) => {
        const row = document.createElement("div");
        row.className = "item";
        const stars = "\\u2605".repeat(m.importance) + "\\u2606".repeat(5 - m.importance);
        row.innerHTML =
          '<span class="dot" style="background:' + (catColor[m.category] || "var(--violet)") + '"></span>'
          + '<span class="desc">' + escapeHtml(m.content) + ' '
          + '<span class="muted">· ' + escapeHtml(m.category) + ' · ' + escapeHtml(m.scope)
          + (m.tags && m.tags.length ? ' · ' + escapeHtml(m.tags.join(",")) : "")
          + ' · <span title="importance">' + stars + '</span></span></span>'
          + '<button class="btn-mem-forget" data-id="' + m.id + '" style="margin-left:auto;background:rgba(255,90,106,.1);color:var(--red);border:1px solid rgba(255,90,106,.25);padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;font:inherit">forget</button>';
        list.appendChild(row);
      });
      list.querySelectorAll(".btn-mem-forget").forEach((b) => b.addEventListener("click", () => forgetMemoryEntry(b.dataset.id)));
    }
  }
}

async function forgetMemoryEntry(id) {
  if (!confirm("Permanently forget this memory entry?")) return;
  await fetch("/api/memory/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: { "authorization": "Bearer " + TOKEN },
  });
  load();
}

async function forgetMem(id) {
  await fetch("/api/control/memory/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: { "authorization": "Bearer " + TOKEN },
  });
  load();
}

document.addEventListener("click", async (ev) => {
  if (ev.target && ev.target.id === "ctrl-mem-clear") {
    if (!confirm("Forget ALL remembered control plans?")) return;
    await fetch("/api/control/memory/all", {
      method: "DELETE",
      headers: { "authorization": "Bearer " + TOKEN },
    });
    load();
  }
  if (ev.target && ev.target.id === "mem-clear") {
    if (!confirm("Permanently delete ALL durable memory? This cannot be undone.")) return;
    await fetch("/api/memory/all", {
      method: "DELETE",
      headers: { "authorization": "Bearer " + TOKEN },
    });
    load();
  }
});

async function answer(id, approved) {
  await fetch("/api/control/approve", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + TOKEN },
    body: JSON.stringify({ id, approved }),
  });
  load(); // refresh immediately
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function stripAnsi(s) { return String(s).replace(/\\x1b\\[[0-9;]*m/g, "").replace(/\u001b\[[0-9;]*m/g, ""); }

document.addEventListener("click", async (ev) => {
  if (ev.target && ev.target.id === "ctrl-plan-btn") {
    const task = (document.getElementById("ctrl-task")).value.trim();
    const out = document.getElementById("ctrl-plan-out");
    if (!task) return;
    out.style.display = "block";
    out.textContent = "planning…";
    const res = await fetch("/api/control/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + TOKEN },
      body: JSON.stringify({ task }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) { out.textContent = "error: " + data.error; return; }
    out.textContent = JSON.stringify(data.plan, null, 2);
  }
});

load();setInterval(load,4000);
</script>
</body>
</html>`;
