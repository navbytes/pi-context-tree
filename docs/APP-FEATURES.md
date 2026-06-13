# pi-context-tree — App Features (and gaps vs the presentation)

> A complete inventory of what the app does today, with a **comparison against the presentation** ([PRESENTATION-FEATURES.md](PRESENTATION-FEATURES.md)) highlighting anything missing. Status legend: ✅ implemented · ⚠️ partial / approximated · ❌ missing · ➕ beyond the presentation · 🔵 delegated to pi-native.

**State:** all v1 milestones + the integration test layer + the mockup-consistency pass + turn removal. 162 tests, CI green on three lanes (lint/types/unit · pinned-pi integration · pi@latest drift).

---

## ⚠️ What's missing vs the presentation (read this first)

The app implements **every core workflow item in the deck and substantially more**. After the G1 work below, only two items differ, and both are deliberately delegated to pi:

| | Presentation item | Status | Detail |
|---|---|---|---|
| **G1** | Prompt-bar health gradient (green→red) — deck §"Customise the prompt bar" | ✅ **Implemented (as a gauge bar)** | A colored `CONTEXT ▓▓░ … N% band` bar is pinned **directly above the prompt** (via `setWidget`), green→red with band ticks — always-visible context health right where you type. **Note on the literal border:** the deck colors pi's *input border*. We tried it (pi's `CustomEditor` + a band-colored `borderColor`) and proved empirically that pi **owns that border for bash/thinking-mode indication** and re-asserts it on its own triggers — so an extension can't color it by health without losing the race or clobbering pi's mode indicator. The gauge bar is the faithful, conflict-free realization of the same intent. |
| **G2** | `/export` to view context — deck §"See the context" | 🔵 **pi-native** | The deck pairs `/tree` with `/export`. We replace `/tree` with the richer `/panel`; `/export` (HTML/share) remains pi's own `export_html` and isn't re-added by the extension. No loss — it's one command away. |
| **G3** | `/reset` — deck demo list | 🔵 **pi-native** | Context reset is pi's own command; the extension doesn't wrap it. |

Everything else in the deck is **implemented or exceeded** (see the comparison table at the bottom). There are no missing *concepts* — the git-style model, health visibility, and reuse-over-regenerate are all present.

---

## 1. Commands

### `/branch <name> [model]`
Labels the current point (mirrored into pi's native labels — doubles as a checkpoint) and forks, optionally onto a cheaper **branch model**; the trunk model is recorded and restored on merge. Tab-completes model ids from the registry (via a remembered-context bridge, since pi 0.79.1 gives completions no context).

### `/merge [--squash | --no-llm | --discard | --tournament] [note]`
Closes the nearest open branch:
- **squash** — the branch model drafts a decision record from the transcript; opens in your editor; **nothing lands until you save** (cancel aborts everything). Becomes one ◆ node at the label; noisy turns stay on the branch.
- **`--no-llm`** — you write the record into the template yourself.
- **discard** — back to the label, nothing injected, branch marked rejected (note on the close marker).
- **tournament** — needs open sibling branches off one label; the winner's record + one-line drafted epitaphs for each loser, merged as ONE node, siblings closed rejected.

Always navigates `summarize:false`, so pi's own summarize-on-leave never double-writes against a decision record.

### `/crop [--auto] [--apply] [--dry-run] [--min-tokens N] [--older-than N] [--keep glob]`
Surgically removes context via an append-only reconstruction block. **Two granularities** (panel `t` toggle):
- **result mode** — stub individual fat tool/MCP results → `[cropped: tool arg, ~tokens, sha8]`. `--auto` pre-marks by rules; `--auto --apply` is headless (works without a TUI); `--dry-run` reports and writes nothing; latest-per-tool needs an explicit double-mark.
- **turn mode** ➕ — remove a whole **Q&A turn** (question + its answers) together; collapses to a label-free `[dropped turn — N entries, ~tokens, recoverable: sha8]` note. Current/leaf turn protected; decision records never swept up.

### `/panel` (and `Ctrl+T`) · `/decisions`
The full-screen context panel (overlay). `/decisions` opens it on the decisions view (text listing when no TUI). Panel **stays up across actions** — pick a mutation, it executes in command context after re-validating the session, then reopens with fresh state until you close it. `Ctrl+T` is view-only in 0.79.1 (shortcuts get no command context, and pi has no command-invoke API).

## 2. The context panel (views)

| View | What it shows |
|---|---|
| **Tree** | Every entry with glyph + token estimate; fork labels colored by status (open/dangling/squashed/rejected); `← you are here` on the open fork, `◀ leaf`, `⚠` on ≥10k-token entries; fold/unfold; jump leaf to node; branch / merge / inspect from a node. |
| **Crop** | result mode (mark fat tool results) ⇄ turn mode (`t`, mark whole turns); live reclaim total. |
| **Consumers** ➕ | Tokens aggregated by source (tool / message type), bars scaled to the dominant consumer — makes MCP bloat visible. |
| **Decisions** ➕ | ◆ records as cards (date · drafted-by model · human-confirmed ✓ · outcome · red ✗ epitaphs); jump to a record. |
| **Inspector** ➕ | Full content of any entry + metadata (id · type · tool · ~tokens · chars). |

Header carries the gauge (band ticks at 5/15/40%, falls back to a chars/4 estimate when pi reports zero usage on a fresh session). Full-screen overlay, constant height.

## 3. Ambient UI (outside the panel)

- **Footer status** `⎇ branch · ctx N% band` (low/healthy/filling/red), estimate-marked with `~` when pi usage is zero.
- **Terminal title** `project (branch) (pi)`, color hashed per branch.
- **One-time red nudge** when context crosses 40% → suggests `/branch`, `/merge`, `/crop`.
- **`/compact` philosophy warning** (never blocks).

## 4. Forest — `pitree` ➕ (beyond the deck)

`pitree [dir] [--dangling] [--json]` prints every project's trees with dangling branches flagged; `pitree ui` opens the panel standalone, **read-only** (zero-write, test-enforced). Streams 50MB session files.

## 5. Data model & invariants

Append-only `custom`/`custom_message` entries (schema-versioned `v:1`): `ctree/fork`, `ctree/close` (squashed/rejected/discarded), `ctree/decision` (the durable record, enters LLM context, rendered as a card), `ctree/crop` + `ctree/crop-tail` (with `stubbed[]` and/or `dropped[]`). **Invariants:** never mutate JSONL; never write both a `BranchSummaryEntry` and a decision record for one close; latest-per-tool crop needs a double-mark; whole-turn removal only (never half a turn); pitree/standalone panel never writes. Everything is recoverable — removals branch and reconstruct; originals stay on the previous branch forever.

## 6. Quality

TDD throughout; 162 tests across core (engine), tui (xterm-headless harness), extension (fake-pi units + **real-pi RPC golden files** for squash/discard/tournament/crop + a **real-TUI PTY walk** driving the actual panel via `expect(1)`), and pitree (zero-write). CI: lint/types/unit per push · pinned-pi integration (keyless) · non-blocking pi@latest drift lane.

---

## Comparison vs the presentation (full)

| Deck item | App | Notes |
|---|---|---|
| See the context (`/tree`) | ✅ Exceeded | `/panel` = tree + crop + consumers + decisions + inspector |
| See the context (`/export`) | 🔵 pi-native (G2) | Not re-added |
| Customise title (hashed color) | ✅ Implemented | `project (branch) (pi)` |
| Customise prompt bar (health gradient) | ✅ Implemented (G1) | Colored gauge bar pinned above the prompt; literal input-border is pi-owned (bash/thinking) |
| `/branch` (label) | ✅ Exceeded | + model tiering + autocomplete |
| `/merge` (git-merge to label, squash, discard) | ✅ Exceeded | + `--no-llm` + tournament + durable decision records |
| `/crop` (per-node token estimates) | ✅ Exceeded | + turn mode + `--auto`/`--apply`/`--dry-run` |
| Delete a message set (Q + answers) | ✅ Implemented | crop turn mode (the friend's feedback) |
| Never `/compact` | ✅ Implemented | one-time philosophy warning |
| `/reset` | 🔵 pi-native (G3) | Not re-added |
| Prefer CLIs over MCPs | ➖ Philosophy | Consumers view surfaces MCP bloat |
| — | ➕ Tournament merge | not in the deck |
| — | ➕ Durable decision records + ◆ cards | not in the deck |
| — | ➕ Consumers / Inspector views | not in the deck |
| — | ➕ Forest / `pitree` (cross-project, dangling) | not in the deck |
| — | ➕ Model tiering + trunk restore | not in the deck |
| — | ➕ Append-only recoverability (sha8, reconstruction) | not in the deck |

**Verdict:** the app covers 100% of the deck's workflow concepts and adds a substantial second layer (tournament, decision records, forest, consumers/inspector, model tiering, recoverability, turn removal). The prompt-health signal (G1) ships as a colored gauge bar above the prompt; the literal input-*border* recolor is owned by pi (bash/thinking mode) and can't be cleanly taken over by an extension. `/export` and `/reset` are deliberately left to pi. **No remaining gaps in the deck's intent.**
