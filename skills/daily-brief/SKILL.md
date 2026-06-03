---
id: daily-brief
version: 1
source: preloaded
tools: [read_file, write_file]
verifier: "output file exists and is non-empty"
signed: false
---

# Daily Brief

A reusable SOP the agent can follow to produce a morning summary.
*(In Phase 1+ this gains web_fetch with egress allow-listing; for now it
summarizes local sources. Inspired by Ahmad's "$0 Gemma news monitor".)*

## Steps
1. Read the configured source files (e.g. `notes.md`, `inbox.md`).
2. Summarize the top items concisely with the cheap/local model.
3. Write the summary to `brief-<date>.md` and present it to the user
   (write requires approval).

## Success check
The file `brief-<date>.md` exists and is non-empty.
