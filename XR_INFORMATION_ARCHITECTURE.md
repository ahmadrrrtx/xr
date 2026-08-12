# XR Information Architecture

**Version:** 1.0
**Based on:** Phase 0 UX Audit

---

## 1. CORE PRINCIPLE

**The XR Chat Interface is the heart of the product.**

From chat, users can access everything. Navigation leads to chat. Chat leads to navigation. Every surface ultimately connects to the conversation.

---

## 2. NAVIGATION STRUCTURE

### 2.1 Sidebar Groups

```
┌─────────────────────────────────────┐
│           XR SHELL                 │
├─────────────────────────────────────┤
│  NAVIGATION                         │
│  ├─ 💬 Chat           [g c]        │
│  ├─ 📋 Sessions       [g s]        │
│  └─ 🔬 Research               │
│                                     │
│  AGENTS                             │
│  ├─ 🤖 Agents         [g a]        │
│  ├─ ⚡ Workflows      [g w]        │
│  └─ 🔄 Automations          │
│                                     │
│  KNOWLEDGE                          │
│  ├─ 🧠 Memory         [g m]        │
│  ├─ 📁 Files          [g f]        │
│  └─ 🛠 Skills         [g k]        │
│                                     │
│  SETUP                              │
│  ├─ ☁ Providers       [g p]        │
│  ├─ 💾 Models         [g mdl]      │
│  └─ ⚙ Settings        [g sgt]      │
│                                     │
│  SYSTEM                             │
│  ├─ 📊 Dashboard      [g d]        │
│  ├─ 🔒 Security       [g sec]      │
│  └─ 💰 Usage          [g u]        │
│                                     │
│  ─────────────────────────────      │
│  ☁ Gemini / gemini-1.5-flash       │
│  Alt+P change model  │  ? help     │
└─────────────────────────────────────┘
```

### 2.2 Navigation Items

| View | ID | Keyboard | Section | Description |
|------|-----|----------|---------|-------------|
| Chat | `chat` | `g c` | navigation | Main conversation |
| Sessions | `sessions` | `g s` | navigation | Recent tasks |
| Research | `research` | `g r` | navigation | Reports |
| Agents | `agents` | `g a` | agents | Agent management |
| Workflows | `workflows` | `g wf` | agents | Multi-agent workflows |
| Automations | `automation` | `g auto` | agents | Scheduled tasks |
| Memory | `memory` | `g m` | knowledge | What XR remembers |
| Files | `files` | `g f` | knowledge | File access |
| Skills | `skills` | `g k` | knowledge | Available skills |
| Providers | `providers` | `g p` | setup | Cloud providers |
| Models | `models` | `g mdl` | setup | Local models |
| Settings | `settings` | `g sgt` | setup | Preferences |
| Dashboard | `dashboard` | `g d` | system | Overview |
| Security | `security` | `g sec` | system | Security status |
| Usage | `usage` | `g u` | system | Spending/usage |

### 2.3 View Access from Chat

From the chat composer, users can access views via:
- Slash commands: `/agents`, `/memory`, `/settings`, etc.
- Keyboard shortcuts: `Alt+P` (provider), `Ctrl+K` (palette)
- Command palette: `Ctrl+K` with search

---

## 3. INFO ARCHITECTURE PRINCIPLES

### 3.1 Progressive Disclosure

- **Default view:** Simple, focused, task-oriented
- **Advanced features:** Discoverable but not prominent
- **Power user features:** Accessible but not overwhelming

### 3.2 Mental Models

Users should understand:

| Concept | Simple Explanation |
|---------|-------------------|
| Provider | "Where XR gets its intelligence" |
| Model | "Which brain XR is using" |
| Local | "Runs on your computer, no internet needed" |
| Cloud | "Uses internet to access powerful models" |
| Skill | "What XR can do" |
| Memory | "What XR remembers about you" |
| Agent | "A specialized XR assistant" |
| Workflow | "Multiple XR working together" |

### 3.3 Command Palette

`Ctrl+K` (or `Cmd+K` on macOS) opens command palette:

```
┌─────────────────────────────────┐
│  Command Palette  [search...]   │
├─────────────────────────────────┤
│  Navigtion                      │
│  › Open Chat          [g c]     │
│   Open Sessions       [g s]     │
│   Open Research       [g r]     │
│                                 │
│  Agents                         │
│   Manage Agents       [g a]     │
│   Workflows           [g wf]    │
│                                 │
│  Setup                          │
│   Providers           [g p]     │
│   Models              [g mdl]   │
│   Settings            [g sgt]   │
│                                 │
│  Actions                        │
│   Change Provider     [Alt+P]   │
│   Switch Model        [/model]  │
│   New Session         [/new]    │
└─────────────────────────────────┘
```

---

## 4. USER JOURNEYS

### 4.1 First-Time User

```
1. Launch XR
   ↓
2. Visual welcome with avatar
   ↓
3. "XR detects your computer" — hardware shown
   ↓
4. Choose: Local (Ollama) or Cloud provider
   ↓
5. If local: See recommended models as cards
   ↓
6. If cloud: Select provider, enter API key
   ↓
7. Name your workspace
   ↓
8. XR is ready — chat opens
   ↓
9. "Ask me anything" — first task
```

### 4.2 Daily Use

```
1. Open XR (Shell or dashboard)
   ↓
2. See: current model, recent activity, status
   ↓
3. Ask question or task
   ↓
4. XR responds — streaming, tool execution visible
   ↓
5. Review result, continue or close
```

### 4.3 Provider Switch

```
1. Alt+P or /providers
   ↓
2. See provider list with status
   ↓
3. Select new provider
   ↓
4. If new: enter API key (masked)
   ↓
5. Select model
   ↓
6. "Switched to Claude / claude-3-5-sonnet"
```

### 4.4 Local Model Setup

```
1. Go to Models view or during onboarding
   ↓
2. See: "Your Computer" — detected hardware
   ↓
3. See: Recommended models as cards
   ↓
4. Each card shows:
   - Model name
   - Why recommended
   - Download size
   - VRAM/RAM estimate
   - Offline capability
   ↓
5. Select model → download begins
   ↓
6. Progress shown
   ↓
7. "Model ready — running locally"
```

### 4.5 Voice Interaction

```
1. Activate voice (button or hotkey)
   ↓
2. Avatar prominent, "Listening..."
   ↓
3. User speaks
   ↓
4. Avatar → "Thinking..."
   ↓
5. Avatar → speaks response
   ↓
6. Avatar → "Working" if executing
   ↓
7. Avatar → "Complete" when done
```

### 4.6 Error Recovery

```
1. Something fails
   ↓
2. Clear error state shown:
   - What happened
   - Why (if known)
   - What to do
   ↓
3. Suggested actions:
   - "Try again"
   - "Check your API key"
   - "Switch provider"
   - "View logs"
```

---

## 5. STATE MENTAL MODELS

### 5.1 XR States

| State | User sees | User understands |
|-------|-----------|-----------------|
| Idle | Avatar neutral, "Ready" | XR is waiting for input |
| Listening | Avatar attentive, "Listening..." | XR is capturing voice |
| Thinking | Avatar contemplative, "Thinking..." | XR is processing |
| Working | Avatar focused, tool progress | XR is doing something |
| Speaking | Avatar active, voice output | XR is talking |
| Complete | Avatar satisfied, "Done" | Task finished |
| Error | Avatar concerned, error message | Something went wrong |

### 5.2 Connection States

| State | Indicator | Meaning |
|-------|-----------|---------|
| Local | Green ⬡, "Local" | Running on this computer |
| Cloud | Amber ☁, "Cloud" | Using internet |
| Offline | Gray ●, "Offline" | No internet, local only |
| Error | Red ✗, error message | Connection failed |

### 5.3 Budget States

| State | Indicator | Meaning |
|-------|-----------|---------|
| Normal | Default | Within budget |
| Warning | Amber ●, "50% used" | Halfway to limit |
| Critical | Amber ●●, "90% used" | Near limit |
| Exceeded | Red ✗, "Budget reached" | Stopped, can increase |

---

## 6. CROSS-SURFACE MAPPING

| Concept | Shell (TUI) | CLI | Daemon (Web) |
|---------|-------------|-----|--------------|
| Chat | Fullscreen chat view | `xr "task"` | Chat page |
| Navigation | Sidebar | Commands | Sidebar |
| Provider | Alt+P, /providers | `xr providers` | Providers page |
| Model | Alt+P, /model | `xr models` | Models page |
| Settings | /settings | `xr config` | Settings page |
| Onboarding | `xr onboarding` | `xr onboarding` | First-run flow |
| Voice | Voice mode | `xr voice` | Voice button |
| Dashboard | Home view | `xr dashboard` | Dashboard page |
| Security | /security | `xr security` | Security page |

---

*End of Information Architecture*
