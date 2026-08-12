# XR End-to-End Product Testing

**Version:** 1.0
**Purpose:** Test scenarios for verifying the complete user experience

---

## Testing Personas

| Persona | Description | Priority |
|---------|-------------|----------|
| 10-year-old | First-time user, no technical knowledge | HIGH |
| Non-technical adult | Uses computers but not developers | HIGH |
| Developer | Comfortable with CLI, code, technical concepts | MEDIUM |
| Power user | Uses all features, keyboard shortcuts | MEDIUM |
| Security engineer | Focuses on security, audit, permissions | LOW |
| Product reviewer | Evaluates UX, polish, first impression | LOW |
| Release engineer | Verifies installation, updates, packaging | LOW |

---

## Test Scenarios

### Scenario 1: First-Time User Journey

**Persona:** 10-year-old
**Goal:** Get XR running and complete a simple task

```
Steps:
1. Launch XR
2. See welcome screen with avatar
3. Understand "this is XR"
4. See hardware detected
5. Choose local or cloud
6. If local: see model recommendations
7. Name workspace
8. Open to chat
9. Type a simple question
10. See XR respond
11. Understand what happened

Pass criteria:
- Avatar visible at each step
- No technical jargon unexplained
- Can complete in < 60 seconds
- First response clear and helpful
- Knows what to do next
```

**Test file:** `test/e2e/first-run.ts` (to be created when XR runtime available)

---

### Scenario 2: Provider Setup

**Persona:** Non-technical adult
**Goal:** Connect a cloud provider

```
Steps:
1. Open XR
2. Navigate to Providers (Alt+P or g p)
3. See provider list with status
4. Select a provider (e.g., Claude)
5. Enter API key (masked input)
6. See validation/test
7. Select model
8. See "Connected" confirmation
9. Return to chat
10. Use new provider

Pass criteria:
- Provider cards show type (local/cloud), status, default model
- API key input is masked
- Validation result clear (success/failure)
- Switching back to chat uses new provider
- No technical errors unexplained
```

---

### Scenario 3: Local Model Setup

**Persona:** Developer
**Goal:** Set up local model for offline use

```
Steps:
1. Open XR
2. Navigate to Models (g mdl)
3. See hardware profile
4. See recommended models as cards
5. View model details (size, RAM, context)
6. Select model
7. See download progress
8. Model ready confirmation
9. Switch to local model
10. Test offline capability

Pass criteria:
- Hardware detection accurate
- Model cards show all specs
- Download progress visible
- Local indicator clear
- Can run task without internet
```

---

### Scenario 4: Chat Experience

**Persona:** Power user
**Goal:** Complete a multi-step task

```
Steps:
1. Open XR to chat
2. Ask a multi-step question
3. See XR thinking state
4. See tool execution cards
5. Watch progress
6. See final response
7. Continue conversation
8. Switch model mid-chat (Alt+P)
9. Continue with new model
10. Review session history

Pass criteria:
- State changes visible (thinking → working → complete)
- Tool execution shows name, args, progress, result
- Streaming feels responsive
- Model switch is quick
- Conversation history accessible
```

---

### Scenario 5: Error Recovery

**Persona:** Non-technical adult
**Goal:** Recover from an error

```
Steps:
1. Have invalid API key configured
2. Try to execute a task
3. See clear error message
4. See suggestion for fixing
5. Follow suggestion (reconfigure provider)
6. Retry task
7. Success

Pass criteria:
- Error shows what happened (not just "error")
- Suggestion is actionable
- Following suggestion resolves issue
- No technical jargon without explanation
```

---

### Scenario 6: Voice Interaction

**Persona:** Non-technical adult
**Goal:** Use voice to interact with XR

```
Steps:
1. Open XR
2. Activate voice (button or shortcut)
3. See avatar change to listening
4. Speak a request
5. See avatar change to thinking
6. Hear response (or see transcription)
7. See avatar change to speaking/complete
8. Continue or exit voice

Pass criteria:
- Avatar states clear (listening/thinking/speaking)
- Voice activation is discoverable
- State changes visible during interaction
- Can exit voice easily
```

---

### Scenario 7: Security Review

**Persona:** Security engineer
**Goal:** Verify security posture

```
Steps:
1. Open XR
2. Navigate to Security (g sec)
3. See overall security status
4. Review active protections
5. Check recent security events
6. Review audit chain status
7. Check isolation state
8. Review permissions

Pass criteria:
- Security status accurate
- All protections listed with status
- Recent events visible
- Audit chain verification works
- Honest about limitations
```

---

### Scenario 8: Spending Awareness

**Persona:** Budget-conscious user
**Goal:** Monitor and control spending

```
Steps:
1. Open XR
2. Navigate to Usage (g u)
3. See current spending
4. See budget setting
5. Set a budget limit
6. Execute a task that uses budget
7. See budget progress
8. Budget reached → task stops
9. See clear "budget reached" message

Pass criteria:
- Spending visible (today/week/month/total)
- Budget setting clear
- Budget progress visible during task
- Budget stop is clear and actionable
- Can increase budget easily
```

---

### Scenario 9: Navigation & Discovery

**Persona:** First-time user
**Goal:** Find and use features

```
Steps:
1. Open XR
2. See sidebar with sections
3. Understand sections (Navigation, Agents, Knowledge, Setup, System)
4. Use keyboard shortcuts (g c, g p, etc.)
5. Use command palette (Ctrl+K)
6. Search for a feature
7. Find and open it

Pass criteria:
- Sidebar sections labeled and logical
- Keyboard shortcuts visible/available
- Command palette searchable
- Can find any feature within 2 actions
```

---

### Scenario 10: Multiple Sessions

**Persona:** Developer
**Goal:** Manage multiple work sessions

```
Steps:
1. Open XR
2. Complete a task in chat
3. Open Sessions (g s)
4. See completed session
5. Start new session
6. Complete different task
7. Return to Sessions
8. Resume previous session
9. Switch between sessions

Pass criteria:
- Sessions list shows recent activity
- Can resume previous session
- Session switching clear
- Session content preserved
```

---

## Regression Tests

These tests verify we didn't break existing functionality:

| Test | Command | Expected |
|------|---------|----------|
| Version check | `xr --version` | Shows version, exits 0 |
| Help | `xr --help` | Shows help, exits 0 |
| Doctor | `xr doctor` | Health check, exits appropriately |
| Provider list | `xr providers list` | Lists providers |
| Onboarding | `xr onboarding --yes` | Non-interactive setup |
| Memory recall | `xr memory recall "test"` | Returns memories |
| Audit verify | `xr audit verify` | Verifies chain |

---

## Visual Regression Tests

| Test | Check |
|------|-------|
| Avatar visible in Shell | Avatar glyph shown in sidebar/header |
| Avatar states change | State changes reflected in avatar |
| Provider cards display | Card layout correct |
| Model cards display | Card layout correct |
| Error display | Error with suggestion shown |
| Success display | Success confirmation shown |
| Keyboard help | Help overlay shows shortcuts |
| Status bar | Status shows provider/model/budget |

---

## Performance Tests

| Metric | Target | Current |
|--------|--------|---------|
| Shell startup | < 1s | Needs measurement |
| Command response | < 100ms | Needs measurement |
| Avatar render | < 16ms | Needs measurement |
| Chat render | < 50ms | Needs measurement |

---

*End of E2E Test Plan*
