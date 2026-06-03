/**
 * Generates dashboard-preview.html — the live dashboard template with inlined
 * mock data so it renders fully offline (workspace preview / no daemon).
 * Mirrors the production loader in src/daemon/dashboard.ts (same selectors).
 */
import { dashboardHtml } from "../src/daemon/dashboard.ts";
import { writeFileSync } from "node:fs";

let html = dashboardHtml("PREVIEW");

const mock = `
<script>
const $=id=>document.getElementById(id);
const money=n=>"$"+Number(n||0).toFixed(4);
const k=n=>n>=1000?(n/1000).toFixed(1)+"k":String(Math.round(n||0));

const ov={project:"my-saas-app",fingerprint:{files:214,frameworks:["next","react","zod"],hasTests:true},
  audit:{count:1287,chain:{valid:true}},skills:{learned:7,frozen:5},ragChunks:842,budget:{perTaskUsd:0.25}};
const cost={totalUsd:0.0312,totalTokens:418000,
  byModel:[{model:"Groq · llama-3.3-70b",usd:0.0241,tokens:301000},{model:"Ollama · qwen2.5 (local)",usd:0,tokens:117000}],
  recent:[1200,3400,800,5200,2100,900,4300,1500,6100,2800,1700,3900,2200,900,4800].map(t=>({tokens:t}))};
const sec={rate:0.9,blocked:9,total:10,outcomes:[
  {category:"instruction_override",description:"classic instruction override",blocked:true},
  {category:"instruction_override",description:"fake system directive",blocked:true},
  {category:"system_prompt_extraction",description:"system prompt extraction",blocked:true},
  {category:"tool_hijack",description:"embedded shell command",blocked:true},
  {category:"tool_hijack",description:"credentials path access",blocked:true},
  {category:"data_exfiltration",description:"exfiltrate secrets to external domain",blocked:true},
  {category:"data_exfiltration",description:"leak secrets in the reply",blocked:true},
  {category:"ascii_smuggling",description:"zero-width / smuggled instruction",blocked:true},
  {category:"destructive_action",description:"plain-English mass delete",blocked:false},
  {category:"destructive_action",description:"curl | bash RCE",blocked:true}]};
const now=Date.now();
const aud={entries:[
 ["session.start","a91f2c7e10"],["web_search","b3d8e91a44"],["fetch_url","c7f1029bd2"],
 ["write_file.applied","d4a8b71e09"],["budget.pause","e1c93af772"],["skill.frozen","f8201ab3cd"],
 ["shell.blocked","0a7e44c1b9"],["read_file","12bd9f7a3e"],["check_package","7be1c0a934"],
 ["session.done","9cf3e2a880"]
].map(function(e,i){return {event:e[0],hash:e[1],created_at:now-i*54000}})};

// header / live
$("health").textContent="LIVE";
document.getElementById("pulse").style.background="var(--green)";

// project + audit integrity
$("proj-name").textContent=ov.project;
$("proj-files").textContent=ov.fingerprint.files;
$("proj-fw").textContent=ov.fingerprint.frameworks.join(", ");
$("proj-tests").textContent="detected";
$("audit-count").textContent=ov.audit.count+" entries";
$("audit-status").textContent="\u2713 INTACT";$("audit-status").style.color="var(--green)";
$("audit-chain").textContent="verified";$("audit-chain").className="chip ok";
$("kv-skills").textContent=ov.skills.learned;
$("kv-frozen").textContent=ov.skills.frozen;
$("kv-rag").textContent=ov.ragChunks;

// cost cockpit
$("cost-usd").textContent=money(cost.totalUsd);
$("cost-tok").textContent=k(cost.totalTokens)+" tokens \u00b7 this machine";
var pct=(cost.totalUsd/ov.budget.perTaskUsd)*100;$("cost-bar").style.width=pct+"%";
$("cost-cap").textContent="per-task cap "+money(ov.budget.perTaskUsd)+"  \u00b7  "+pct.toFixed(0)+"% used";
var sp=$("cost-spark");var mx=Math.max.apply(null,cost.recent.map(function(r){return r.tokens}));
cost.recent.forEach(function(r){var s=document.createElement("span");s.style.height=(r.tokens/mx*100)+"%";sp.appendChild(s)});
var bm=$("by-model");cost.byModel.forEach(function(m){var d=document.createElement("div");d.className="mrow";
  d.innerHTML='<span>'+m.model+'</span><span class="muted">'+k(m.tokens)+' \u00b7 '+money(m.usd)+'</span>';bm.appendChild(d)});

// security gauge + lab
var spct=Math.round(sec.rate*100);$("sec-rate").textContent=spct+"%";
$("sec-line").textContent=sec.blocked+" / "+sec.total+" attacks blocked";
var arc=$("sec-arc"),CIRC=327;arc.style.strokeDashoffset=CIRC-(CIRC*sec.rate);
$("sec-score").textContent=spct;
var lb=$("lab-badge");lb.textContent=sec.blocked+"/"+sec.total;lb.className="chip "+(spct>=90?"ok":spct>=70?"warn":"bad");
var al=$("att-list");sec.outcomes.forEach(function(o){var d=document.createElement("div");d.className="item";
  d.innerHTML='<span class="dot" style="background:'+(o.blocked?"var(--green)":"var(--red)")
    +';box-shadow:0 0 8px '+(o.blocked?"rgba(52,226,160,.7)":"rgba(255,90,106,.7)")+'"></span>'
    +'<span class="cat">'+o.category+'</span><span class="desc">'+o.description+'</span>'
    +'<span class="chip '+(o.blocked?"ok":"bad")+'" style="margin-left:auto">'+(o.blocked?"blocked":"ALLOWED")+'</span>';
  al.appendChild(d)});

// audit explorer
var al2=$("audit-list");aud.entries.forEach(function(e){var t=new Date(e.created_at).toLocaleTimeString();
  var d=document.createElement("div");d.className="item";
  d.innerHTML='<span class="time">'+t+'</span><span class="desc">'+e.event+'</span>'
    +'<span class="hash" title="'+e.hash+'">#'+e.hash.slice(0,10)+'</span>';
  al2.appendChild(d)});
</script>`;

html = html.replace(/<script>[\s\S]*?<\/script>\s*<\/body>/, "</body>");
html = html.replace("</body>", mock + "\n</body>");
writeFileSync("dashboard-preview.html", html);
console.log("wrote dashboard-preview.html (" + html.length + " bytes)");
