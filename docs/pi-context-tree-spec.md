# pi-context-tree — PRD & TRD

**Version:** 0.3
**Owner:** Naveen
**Target:** A coding agent (Claude Code / pi) building this autonomously
**Status:** Ready for implementation
**v0.3 changes (research pass, 2026-06-12):** pinned pi's canonical repo to `earendil-works/pi-mono` (badlogic URLs redirect); F2.5 now targets the verified `BranchSummaryEntry` summarize-on-leave mechanism; decision records gain an **Assumptions** field (Forky-inspired) and a ~1–2k-token size guideline (Anthropic's distilled-summary envelope); fork labels documented as doubling as named checkpoints (F1.6); added Part 3 (prior art & evidence); the 5–15% band is explicitly an opinionated heuristic.
**v0.2 changes:** Rich TUI panel is now the primary management surface (launchable from inside pi); adopted `/branch` `/merge` `/crop` vocabulary; added discard-merge, interactive crop, title-bar branding, context gauge with health band, context-consumer stats; web dashboard demoted to v2.

---

# Part 0 — Design philosophy (context for the building agent)

This tool exists because attention is a fixed budget: softmax forces all attention weights to sum to 1, so irrelevant tokens dilute attention and too many relevant tokens flatten it, with positional effects burying the middle of long contexts. Practical consequences this tool is built around:

- Keep the working context **small, fresh, relevant** — target band roughly **5–15% of the model's context window**.
- **Never replace source material with lossy auto-summaries** (no `/compact`-style trunk rewriting). The only summarization this tool performs is branch→decision-record, and it is always **human-confirmed** before entering the trunk.
- The session is a **git repo metaphor**: trunk = master, side work = branches, and master only receives clean, reviewed "commits" (decision records).
- Make context **visible**: per-entry token costs, a fullness gauge, and top-consumer stats (large MCP/tool outputs are the usual offenders).

Pi already provides the substrate: tree-structured sessions (`id`/`parentId`), `/tree` navigation with an optional summarize-on-leave flow, `/fork`, `/clone`, compaction entries, an extension API, and the pi-tui library. This project is the opinionated workflow + rich UI layer on top.

**Evidence & positioning (use in user-facing docs).** Cite the documented failure modes this tool prevents: **"context rot"** (Chroma 2025, adopted by Anthropic's context-engineering guidance) — degradation with input length is real and non-uniform even on minimal tasks; **NoLiMa** (ICML 2025) — of 13 models claiming ≥128k windows, 11 fall below 50% of their short-context baseline by 32k tokens, with effective lengths ≤8k (best model) and ≤2k (most); **LongMemEval** — every model family tested scores higher on a focused prompt than on the same task buried in ~113k tokens, i.e. pruning is a *quality* feature, and it assumes a relevance oracle — which is exactly what the human confirm/edit gate provides; **"logical context poisoning"** (Conversation Tree Architecture, arXiv 2603.21278) — the literature's name for flat append-only context degrading multi-thread sessions. **The 5–15% band is this tool's own opinionated heuristic** — motivated by the above, prescribed by none of it; docs must present it as a design choice, not a measured threshold.

---

# Part 1 — PRD

## 1. Problem statement

Pi sessions are trees, but the workflow around them is manual: labels, branch hygiene, merging findings back, and pruning bulk are all ad-hoc. There is no single panel where the user can *see* the tree with token costs and *act* on it (branch, merge, crop, jump). This tool adds:

1. **`/branch <name> [model]`** — label the current point and branch off (optionally onto a cheaper model).
2. **`/merge`** — interactive flow to close a branch: **squash** (decision record to the label point), **discard** (return, inject nothing), or **tournament** (winner record + epitaphs for sibling branches).
3. **`/crop`** — surgically remove specific context entries (huge tool/MCP results) with per-entry token estimates; rule-based `--auto` mode.
4. **Context Panel** — a full-screen rich TUI, launched from inside pi or standalone, to browse and manage the tree.
5. **Ambient UI** — title bar showing project+branch (color derived from name), context gauge with green→red gradient and health band.
6. **`pitree`** — forest CLI across all projects (dangling-branch detection), with `pitree ui` opening the panel standalone.

## 2. Goals

- G1: Trunk context stays in the 5–15% band during normal work on a real project.
- G2: One-command expensive-trunk/cheap-branch tiering.
- G3: Rejected approaches leave durable epitaphs; the trunk model stops re-proposing them.
- G4: Zero data loss — append-only; originals always recoverable.
- G5: Every core action reachable in ≤2 keystrokes from the panel.

## 3. Non-goals (v1)

No Claude Code support; no web UI (v2); no automatic/heuristic squashing or auto-crop without explicit invocation; no cloud/sync; never mutate existing JSONL lines.

## 4. Primary scenarios

### A — side task
Trunk on Opus-class hits a flaky test. `/branch fix-flaky-test haiku` → labeled branch on cheap model. 30 noisy turns later: `/merge` → choose **squash** → branch model drafts decision record → user edits/confirms → back at label on trunk model with one clean node.

### B — tournament
Three sibling branches (`storage-a/b/c`) off one label. From the winner: `/merge` → **tournament** → winner's record + one-line epitaphs (`Rejected storage-b: breaks on MV3 event-page suspension`) merged as ONE node; siblings marked rejected.

### C — dead end
Branch went nowhere. `/merge` → **discard** → return to label, nothing injected, branch marked rejected (history kept).

### D — surgical crop
Before branching, two giant MCP results (40k tokens) sit in the trunk. `/crop` opens the panel in crop mode: entries listed with token estimates, space to mark, shows total reclaimed, enter to apply. Result: stubs replace bodies on a new branch point; originals untouched.

### E — panel-driven session
`Ctrl+Q` (or `/panel`) inside pi → full-screen tree: nodes sized/annotated with tokens, branch labels colored by status, gauge in header. Navigate, jump to a node, start a branch from any node, open merge flow, inspect any entry's content, view all decision records, see top context consumers by tool.

### F — forest review
`pitree` prints all projects' trees with dangling branches flagged; `pitree ui` opens the same panel standalone in read-only forest mode.

## 5. Functional requirements

### F1 `/branch <name> [model]`
- F1.1 `waitForIdle()` before mutation; create branch at current leaf (pi-native, same file).
- F1.2 Append fork label: name, parent id, trunk model, branch model, timestamp, status open. Also mirror the name via pi's native `setLabel(entryId, name)` so pi's built-in `/tree` shows it.
- F1.3 Optional model switch; trunk model recorded for restore on merge.
- F1.4 Autocomplete model names + recent branch names.
- F1.5 Nesting allowed; panel and title show depth.
- F1.6 A fork label doubles as a named checkpoint (one concept, git-style): jumping back to a label *is* rewind. No separate checkpoint/undo notion is introduced.

### F2 `/merge` (interactive; flags `--squash|--discard|--tournament|--no-llm` for non-interactive)
- F2.1 Locate nearest open fork label; error with guidance if none.
- F2.2 **Squash:** branch's own model drafts the Decision Record (template §6, free-text extra instructions allowed) → mandatory confirm/edit in TUI → navigate to label, restore trunk model, append record + markers, close branch. Drafts target **~1,000–2,000 tokens** (Anthropic's published distilled-summary envelope for subagent→coordinator handoffs); guidance in the draft prompt, not a hard cap — the user's edit is final.
- F2.3 **Discard:** navigate to label, restore trunk model, close branch as rejected with optional one-line user note.
- F2.4 **Tournament:** siblings = open fork labels sharing `parentEntryId`. Winner = current branch (full record); each sibling gets an epitaph generated from its content (ask the user for one line if low-signal). ONE combined node; all siblings closed.
- F2.5 Integrate with (do not fight) pi's native summarize-on-leave in `/tree`. Verified mechanism (pi HEAD, 2026-06-12): leaving a branch offers *No summary / Summarize / Summarize with custom prompt* and appends an **unreviewed** `BranchSummaryEntry` (`id`, `parentId`, `summary`, `fromId`); a skip-prompt setting exists (default: no summary). `/merge` must suppress this prompt via that setting (or pre-fill it) when driving navigation, and must never produce both a `BranchSummaryEntry` and a decision record for the same close. `/merge` is, precisely, "branch summary — but structured, human-confirmed, and squashed". Re-verify these interfaces at implementation start (see Risks).
- F2.6 `--no-llm`: user writes the record manually.

### F3 `/crop`
- F3.1 Interactive mode (default): panel in crop mode — current branch's context entries with type, age (turns), est. tokens; multi-select; running total of reclaimed tokens; confirm to apply. (This is the primary mode — per the originating workflow, manual crop of a few huge entries is the common case.)
- F3.2 `--auto [--older-than N] [--min-tokens M] [--keep <glob>...]`: rule-based selection, then the same review screen pre-marked; `--dry-run` prints the table and exits.
- F3.3 Apply = branch-with-filtered-history at the same point; stub format `[cropped: <tool> <primary-arg>, <size>, <sha-8>]`; `tool_use`/`tool_result` pairing always preserved; never crop the latest result of any tool unless explicitly marked.

### F4 Context Panel (the rich TUI)
- F4.1 Launch: `/panel` command and a registered shortcut (default `Ctrl+Q`, configurable) inside pi; `pitree ui` standalone.
- F4.2 Views: **Tree** (current session), **Forest** (standalone: all projects), **Decisions** (all decision records on trunk), **Consumers** (tokens aggregated by tool/entry type — makes MCP bloat visible), **Entry inspector** (full content of any node).
- F4.3 Tree rendering: glyph per entry type; est. tokens per node; branch labels with status color (active/dangling/squashed/rejected); current leaf highlighted; collapsed-by-default closed branches.
- F4.4 Keybindings (single keystroke): navigate ↑↓/jk, expand/collapse, `enter` jump leaf to node, `b` branch here, `m` merge flow, `c` crop mode, `i` inspect, `D` decisions, `u` consumers, `q`/`esc` close. Help footer always visible.
- F4.5 Header: session name · branch · context gauge (see F5) · model.
- F4.6 In-pi mutations go through `ExtensionCommandContext` after `waitForIdle()`; standalone panel is **read-only** in v1 (mutation via RPC attach is v2).

### F5 Ambient UI
- F5.1 Title bar (terminal title + header line): `project ⎇ branch`, color deterministically hashed from name.
- F5.2 Context gauge in footer/prompt bar: current branch tokens vs. model window, gradient green→red; band markers at 5% and 15%; states: low (<5%), healthy (5–15%), filling (15–40%), red (>40%).
- F5.3 Gauge crossing into red triggers a one-time gentle notify suggesting `/branch`, `/merge`, or `/crop` (never auto-acts).
- F5.4 If the user invokes pi's `/compact` on the trunk, show a warning (configurable off) explaining the philosophy; never block.

### F6 `pitree` CLI
As v0.1 (scan `~/.pi/agent/sessions`, streaming parse, `--dangling`, `--json`, read-only) plus `pitree ui` (F4 standalone) and per-tree context-band summary.

### F7 `/decisions`
List decision records on the current trunk (also a panel view).

## 6. Decision Record template — v0.3: added **Assumptions** (completes the facts/decisions/assumptions triple from Forky's merge schema)

```markdown
## Decision: <branch-name>
**Date:** <iso> · **Model:** <branch model> · **Branch:** <branch id>
**Outcome:** <1–3 sentences>
**Why:** <≤5 bullets>
**Assumptions:** <taken as true but not verified on the branch — the trunk model must know these>
**Changes:** <files + commit sha | "none">
**Gotchas:** <…>
**Open questions:** <…>
**Confidence / revisit-if:** <…>
### Rejected alternatives   <!-- tournament/discard -->
- **<name>:** <one-line reason>
```

## 7. Success metrics
- M1 Trunk tokens/turn within 5–15% band ≥80% of working time on one real project.
- M2 Dangling branches trend to ~0 within a week.
- M3 Panel actions replace manual `/tree` navigation for branch/merge work.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Name collisions with pi built-ins or other extensions (`/branch`, `/merge`, `/crop`) | Command names configurable (settings file); pi suffixes duplicates — document this; defaults chosen to match the originating workflow |
| pi internals shift | Pin pi version against `earendil-works/pi-mono`; single session-adapter module; re-verify `BranchSummaryEntry` + compaction interfaces (F2.5, TRD §3) before M3; non-blocking CI lane vs `pi@latest` |
| pi-tui API insufficient for full-screen panel | **Largely retired (0.79.1):** `ctx.ui.custom({overlay:true})` is public, documented ("Overlay Mode (Experimental)", extensions.md), with working examples (`examples/extensions/overlay-test.ts`). M2 spike now *validates* full-screen sizing/key-scoping/lifecycle rather than discovering capability; Ink child-process fallback kept only as contingency for the Experimental flag |
| Summary quality on cheap models | Mandatory confirm/edit (F2.2) |
| Concurrent writers | Extension mutates only via pi context; pitree/standalone panel read-only |

---

# Part 2 — TRD

## 1. Architecture

```
pi-context-tree/                  (npm workspaces, TypeScript, ESM)
├── packages/
│   ├── core/        # pi-independent: jsonl-reader (streaming tree parse),
│   │                # forest model, token estimator, decision-record template,
│   │                # crop scoring, status derivation. Fully unit-tested vs fixtures.
│   ├── tui/         # panel components built on pi-tui (pi-mono's TUI library):
│   │                # TreeView, GaugeBar, ConsumersTable, EntryInspector,
│   │                # MergeFlow, CropSelect, DecisionList. Depends on core + pi-tui ONLY.
│   ├── extension/   # pi extension: command handlers, labels, summarize,
│   │                # session-adapter (ALL SessionManager access), title/footer
│   │                # widgets, panel host (mounts tui components as pi overlay).
│   ├── pitree/      # CLI + standalone panel host (read-only). Depends on core + tui.
│   └── dashboard/   # v2 placeholder, empty.
└── fixtures/        # real + synthetic session JSONL trees
```

Dependency rules: `core` imports nothing of pi; `tui` imports pi-tui + core; `extension` imports pi extension API + core + tui; `pitree` imports core + tui. The session-adapter is the only file touching `SessionManager`.

## 2. TUI stack decision

Use **pi-tui** for all panel components. Rationale: it ships in pi-mono, the in-pi panel must render inside pi's TUI anyway (overlay/widget APIs, `registerMessageRenderer`, `setWidget`, shortcuts), and reusing it standalone gives one component set and a native look. Pi's own `/tree` picker is the existence proof of a full-screen interactive overlay. The building agent must read pi-tui's source/docs and pi's `/tree` implementation as the reference for overlay lifecycle, key handling, and differential rendering. Ink is the documented fallback **only** for the standalone host if pi-tui proves unergonomic outside pi — never for the in-pi panel.

## 3. pi integration points

As v0.1 (registerCommand/Shortcut, ExtensionCommandContext + waitForIdle, sessionManager via adapter, appendEntry custom entries, labels, setModel, ui.notify, message renderers), plus:
- **Overlay/panel hosting:** whatever mechanism pi's `/tree` and `-r` session picker use — replicate it. Verify against the pinned version; if extensions cannot open full-screen overlays, fall back to the child-process panel (Risks table).
- **Footer/title customization:** community-documented pattern (custom footer extensions exist); use the same APIs for gauge + title.
- **Summarize-on-leave interop (F2.5):** read pi's compaction/tree-switch code; either hook it or bypass it cleanly when `/merge` navigates.
- Source of truth: pinned pi repo — **canonical at `earendil-works/pi-mono`** (legacy `badlogic/pi-mono` URLs redirect) — `docs/extensions.md`, `docs/session-format.md`, `docs/tree.md`, `packages/coding-agent/docs/compaction.md`, `examples/extensions/`. Verified interop surface as of 2026-06-12: `BranchSummaryEntry` (session-manager); the three-choice summarize-on-leave selector + skip-prompt setting (interactive-mode); `DEFAULT_COMPACTION_SETTINGS` (`reserveTokens: 16384`, `keepRecentTokens: 20000`) with trigger `contextTokens > contextWindow − reserveTokens` — the gauge rides this native token accounting; `TOOL_RESULT_MAX_CHARS = 2000` applies only in the summarizer path, and nothing in pi removes tool results from live context (`/crop` is new, not a duplicate). Where this TRD disagrees with pi docs, **pi docs win**; report discrepancies.

## 4. Data design — custom entries (append-only, schema-versioned `"v":1`)

```jsonc
{ "type":"custom","customType":"ctree/fork",
  "data":{"v":1,"name":"fix-flaky-test","parentEntryId":"…","trunkModel":"…","branchModel":"…","createdAt":0,"status":"open"} }
{ "type":"custom","customType":"ctree/close",
  "data":{"v":1,"forkEntryId":"…","status":"squashed|rejected|discarded","decisionEntryId":"…?","note":"…?"} }
{ "type":"custom_message","customType":"ctree/decision","display":true,
  "content":"## Decision: … (template §6 markdown — this text DOES enter LLM context)",
  "details":{"v":1,"forkEntryId":"…","branchName":"…","siblings":[{"name":"…","reason":"…"}]} }
{ "type":"custom","customType":"ctree/crop",
  "data":{"v":1,"sourceLeafId":"…","stubbed":[{"entryId":"…","tool":"…","estTokens":0,"sha8":"…"}]} }
```

Forest status: dangling = open fork with no close. Unknown versions/types: skip + warn.

Note (verified 0.79.1): the decision record rides pi's native `custom_message` entry type — extensions persist it via `pi.sendMessage({customType:"ctree/decision", content, display:true, details})`, it enters LLM context as a user-role message, and `registerMessageRenderer("ctree/decision", …)` gives it the ◆ rendering. `ctree/fork`, `ctree/close`, `ctree/crop` are state-only `custom` entries via `pi.appendEntry()` (never sent to the LLM). `ctree/close.decisionEntryId` points at the `custom_message` entry.

## 5. Algorithms

- **Merge/squash & tournament:** as v0.1 §4.1–4.2, with the added discard path (no LLM call) and the F2.5 interop step. Write decision before close markers; batch the appends.
- **Crop (revised after source verification):** pi's compaction replaces a contiguous **prefix** only (everything before `firstKeptEntryId`) — per-entry filtered history CANNOT ride the compaction mechanism, and no extension API appends `message`-type entries or removes individual ones. v1 design: score → interactive review (pre-marked if `--auto`) → apply = `navigateTree` to the entry *before* the first cropped entry, then append ONE `custom_message` reconstruction block carrying the kept tail content with stub lines (`[cropped: <tool> <primary-arg>, <size>, <sha-8>]`) in place of cropped bodies, plus a `ctree/crop` custom entry recording {sourceLeafId, stubbed[]}. Append-only; originals stay on the abandoned branch, fully recoverable. Trade-off: the reconstructed tail collapses message granularity into one block — acceptable because the common case (Scenario D) crops near-tail giants with little after them, and the crop review screen shows exactly what gets reconstructed. Better long-term path: small upstream PR to pi exposing branch-with-filtered-history (or extension-level message append); revisit at M6. Invariants unchanged: `tool_use`/`tool_result` pairing represented in the stub; latest-per-tool protected; dry-run side-effect-free.
- **Token estimation:** chars/4, labeled `~`; per-node cached in the panel's view model; gauge denominators from pi's model catalog context-window field.
- **Tree layout (panel):** indent-based tree (not graph) with collapse state in panel memory; forest mode lazy-loads file headers first, full parse on expand (50MB file must not block the UI thread — stream + incremental render).

## 6. Invariants & errors

As v0.1 (append-only; waitForIdle; leaf-id recheck; actionable errors; no half-written close states; pitree tolerates truncated/legacy files) plus: panel never blocks pi's agent loop; all panel mutations re-validate tree state on apply (tree may have changed while panel open); standalone panel asserts read-only (test watches for writes).

## 7. Testing

- Unit: full `core` coverage vs fixtures (linear, branched, tournament, truncated tail, legacy version, 50MB synthetic).
- TUI: pi-tui components render-tested with snapshot harness (pi-tui has its own testing approach — reuse it); key-handling unit tests on view-model level.
- Integration: pi in **RPC mode** against a mock OpenAI-compatible endpoint (canned completions). Golden-file assertions on JSONL after `/branch → work → /merge --squash`, tournament, discard, crop. Panel integration limited to view-model level (full PTY e2e optional, non-blocking).
- Manual acceptance script: Scenarios A–F, 15 minutes.
- CI: lint+types+unit per commit; pinned-pi integration; non-blocking `pi@latest` lane.

## 8. Build environment

Unchanged from v0.1: the building agent needs **no** pre-existing local pi and **no API keys** — pi installs from npm into the dev environment; all automated tests use fixtures + mock LLM. The agent must begin by reading the pinned pi package's docs and the `/tree`/compaction/footer-extension source. Final acceptance (Scenario A+E with a real key) runs on Naveen's laptop.

## 9. Milestones

| # | Deliverable | Acceptance |
|---|---|---|
| M1 | `core`: parser, forest, estimator, fixtures | unit green incl. truncated/legacy/50MB |
| M2 | **Spike:** full-screen `ui.custom({overlay:true})` panel host (hello-world via `/panel` + `Ctrl+Q`) | overlay API verified public in 0.79.1 but flagged Experimental — spike validates full-screen sizing, key scoping, clean open/close during idle; fallback decision recorded |
| M3 | `/branch` + labels + model switch + title bar + gauge | integration: fork, label, model switch/restore verified |
| M4 | `/merge` squash + discard + `--no-llm` + confirm/edit UI | golden files; trunk model restored; F2.5 interop verified |
| M5 | Panel: Tree view + inspector + jump + branch-from-node | scenario E keybindings work; no agent-loop blocking |
| M6 | `/crop` interactive + `--auto` + `--dry-run` | golden files; pairing intact; originals untouched |
| M7 | Tournament + `/decisions` + Consumers view | golden files; one combined record |
| M8 | `pitree` + `pitree ui` (read-only forest) | runs on fixtures; zero-write assertion |

## 10. Out of scope for the building agent

No auto-squash/auto-crop heuristics firing without invocation; no writes from pitree/standalone panel; no Claude Code; no web UI; no JSONL line mutation; no invented pi APIs — if an expected capability is missing in the pinned version (notably overlay hosting), stop at the M2 gate and report with options rather than reverse-engineering private internals.

---

# Part 3 — Prior art & evidence (research pass 2026-06-12; claims 3-vote adversarially verified)

**Closest precedents — borrow shape, not code:**
- **Forky** (`ishandhanani/forky`; SQLite conversation DAG, ~33 stars — design reference, not a dependency): three-way semantic merge = LCA → per-branch LLM extraction of *facts / decisions / assumptions* → diff vs LCA → combine. No human gate, no TUI, no token costs. Informs §6 (Assumptions field) and the squash draft prompt's extraction framing.
- **pi itself**: already ships `/tree` + summarize-on-leave (`BranchSummaryEntry`), threshold auto-compaction with native token accounting, and summarizer-path tool-result truncation. This project extends that machinery; it is not greenfield (TRD §3).
- **Anthropic context editing** (`clear_tool_uses_20250919`): automatic oldest-first tool-result clearing with placeholder text, characterized by Anthropic as "one of the safest, lightest touch forms of compaction". `/crop` is its interactive, user-targeted counterpart; the F3.3 stub format mirrors the placeholder pattern. Anthropic's multi-agent system returns 1–2k-token distilled summaries per subagent — the F2.2 size envelope.
- **Loom** (`socketteer/loom`): expand/collapse and zoom-out-to-global-view as first-class tree navigation; merge-with-parent as a node operation. Candidate panel niceties post-M5.
- **SillyTavern Timelines**: "a checkpoint is just a named branch" (adopted as F1.6); colored-ring rendering for special nodes; tree reconstruction via content-dedup at equal depth (only relevant if forest ever ingests non-pi logs — pi has real `id`/`parentId`).
- **LibreChat fork scopes** (visible path / + related branches / everything): scope-selector pattern to reuse if branch-from-node or `/export` grows options (v2).
- **Conversation Tree Architecture** (arXiv 2603.21278; unreviewed 6-page preprint, no empirical eval): names "logical context poisoning"; formalizes context flowing downstream on branch and upstream on merge; explicitly lists *condensation granularity* as an open problem — the human-confirmed squash is the literature's named gap. Positioning language for the README.

**Confirmed novel (nothing surveyed does these):** human-confirmed squash-merge into durable decision records; interactive user-directed crop of live context; per-entry token costs in a tree view plus a health-band gauge; cross-project forest with dangling-branch detection. Survey bound: Cursor/Codex CLI/Aider/opencode/goose/amp and lazygit/tig/k9s idioms produced no verified claims; amp's "handoff" feature is conceptually adjacent to decision records and unexamined.
