import type { Action, RiskAssessment } from "./types.ts";

const DANGEROUS_OPEN = [
  /^file:\/\//i,
  /\.(sh|bat|cmd|ps1|exe|app|dmg|pkg|msi|deb|rpm|appimage)(\?|$)/i,
  /^javascript:/i, /^data:/i,
];
const DESTRUCTIVE_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ["enter"],["return"],
  ["cmd","delete"],["cmd","backspace"],
  ["shift","delete"],["ctrl","shift","delete"],
];
const TERMINAL_LIKE = [
  /^\s*(sudo|rm |rm -|mv |dd |chmod|chown|kill|shutdown|reboot|halt|format)\b/i,
  /\|\s*(sh|bash|zsh|pwsh|powershell)\b/i,
  /^\s*(curl|wget)\b.*\|\s*(sh|bash)/i,
  /^\s*(npm|pip|brew|apt|yum|dnf|choco)\s+(install|uninstall|remove)/i,
];
function keysEqual(a: string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  return a.every((v,i)=>v.toLowerCase()===b[i].toLowerCase());
}

export function classify(action: Action): RiskAssessment {
  switch(action.type){
    case "move":
    case "scroll":
    case "wait_ms":
      return { level:"safe", reason:`${action.type} is non-destructive`, reversible:true };
    case "focus":
      return { level:"safe", reason:"focus window", reversible:true };
    case "screenshot":
      return { level:"safe", reason:`screenshot ${action.target}`, reversible:true };
    case "system":
      if(action.op==="clipboard_read"||action.op==="volume_get") return {level:"safe",reason:action.op,reversible:true};
      if(action.op==="notify") return {level:"safe",reason:"system notification",reversible:true};
      return { level:"sensitive", reason:`system ${action.op}`, reversible:true };
    case "app":
      return { level:"sensitive", reason:`launches ${action.name}`, reversible:true };
    case "close":
      return { level:"sensitive", reason:`closes ${action.name}`, reversible:true };
    case "open": {
      const t = action.target.trim();
      if(DANGEROUS_OPEN.some(re=>re.test(t))) return { level:"destructive", reason:`target can execute code: ${t.slice(0,80)}`, reversible:false };
      return { level:"sensitive", reason:`opens ${t.slice(0,80)}`, reversible:true };
    }
    case "type": {
      if(action.sensitive) return { level:"destructive", reason:"typing sensitive value", reversible:false };
      if(TERMINAL_LIKE.some(re=>re.test(action.text))) return { level:"destructive", reason:"text resembles shell command", reversible:false };
      return { level:"sensitive", reason:`types ${action.text.length} chars`, reversible:true };
    }
    case "click":
      return { level:"sensitive", reason: action.target ? `clicks ${action.target}` : `click (${action.x},${action.y})`, reversible:false };
    case "drag_drop":
      return { level:"sensitive", reason:`drag (${action.x1},${action.y1}) → (${action.x2},${action.y2})`, reversible:true };
    case "key": {
      const keys = action.keys.map(k=>k.toLowerCase());
      if(DESTRUCTIVE_KEYS.some(d=>keysEqual(keys,d))) return { level:"destructive", reason:`key ${keys.join("+")} commonly submits/deletes`, reversible:false };
      return { level:"sensitive", reason:`press ${keys.join("+")}`, reversible:true };
    }
    case "browser": {
      if(action.sensitive) return { level:"destructive", reason:"browser fill sensitive", reversible:false };
      if(action.op==="submit") return { level:"destructive", reason:"submits form", reversible:false };
      if(action.op==="press" && action.value && /^(enter|return)$/i.test(action.value)) return { level:"destructive", reason:"browser Enter submits", reversible:false };
      if(action.op==="goto"){
        const t=(action.value||"").trim();
        if(DANGEROUS_OPEN.some(re=>re.test(t))) return {level:"destructive", reason:"dangerous navigation", reversible:false};
        return {level:"sensitive", reason:`navigates to ${t.slice(0,60)}`, reversible:true};
      }
      if(["fill","type","click","upload","drag"].includes(action.op)) return {level:"sensitive", reason:`browser ${action.op} ${action.selector||""}`, reversible:true};
      return { level:"safe", reason:`browser ${action.op} read-only`, reversible:true };
    }
    case "file": {
      if(action.op==="read"||action.op==="list") return { level:"sensitive", reason:`file ${action.op} ${action.path}`, reversible:true };
      return { level:"destructive", reason:`file ${action.op} ${action.path}`, reversible:false };
    }
    case "editor":
      return { level:"sensitive", reason:`open editor ${action.editor} ${action.file||""}`, reversible:true };
    case "computer_use":
      return { level:"destructive", reason:`computer-use: ${action.task.slice(0,80)}`, reversible:false };
  }
}
