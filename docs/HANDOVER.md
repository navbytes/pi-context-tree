# pi-context-tree — Handover (v1 complete → next phase)

**Date:** 2026-06-12 · **Repo:** https://github.com/navbytes/pi-context-tree (private) · **Owner:** Naveen
**State:** All v1 milestones (M1–M8) implemented test-first and pushed (16 commits on `main`). 99 unit/component tests + 1 real-pi RPC smoke, typecheck + biome clean. The package installs and loads end-to-end via `pi install git:github.com/navbytes/pi-context-tree` (verified on this machine). **Not yet done: human acceptance of the interactive flows (Scenario A–F) — that is the next phase's first item.**

---

## 1. Reference documents (read in this order)

| Doc | What it is |
|---|---|
| [pi-context-tree-spec.md](pi-context-tree-spec.md) | PRD + TRD v0.3 — requirements (F1–F7), goals, data design (`ctree/*` entries), milestones, prior-art appendix (Part 3). The contract. |
| [pi-context-tree-architecture.md](pi-context-tree-architecture.md) | Verified pi 0.79.1 API surface (file:line refs), the two load-bearing design decisions (§8 decision-record = `custom_message`; §9 crop = reconstruction block), testing strategy, §11 verify-at-impl items (partially resolved — see §4 below). |
| [pi-context-tree-mockup.html](pi-context-tree-mockup.html) | Interactive HTML mockup of the TUI panel — the visual reference. Open in a browser; keybindings match the implementation. |
| [../README.md](../README.md) | Package map, test counts, try-it commands. |
| `~/repos/ct/context-engineering/` *(local machine only, not in repo)* | The originating workflow: article + screenshots that define the visual language (prompt-border health colors, title pills, tree/crop look). |

Pinned upstream: `@earendil-works/pi-coding-agent@0.79.1`, `@earendil-works/pi-tui@0.79.1`, `@earendil-works/pi-ai@0.79.1`. Reference clone of pi-mono was at `/tmp/pi-mono` (re-clone `earendil-works/pi-mono` if gone). Local pi: 0.79.1 at `/opt/homebrew/bin/pi`; default model `ollama/gemma4` (drafting runs against local ollama, no API key).

## 2. What was built (per package; git history mirrors this)

- **`packages/core`** (72 tests, zero deps): streaming fault-tolerant JSONL parser (truncated/legacy/unknown-type tolerant); `SessionTree` + `contextSlice` reproducing pi's `buildSessionContext` exactly (leaf = last entry in file order; latest compaction, summary-first, `firstKeptEntryId` forward); ctree fork/close status derivation (active/dangling/squashed/rejected, latest-close-wins, tournament siblings, nesting); chars/4 estimator with pi image parity + 5/15/40 bands; consumers aggregation; §6 decision-record template (with Assumptions); crop planner (latest-per-tool protection, `--auto` rules, sha8 stubs, reconstruction block); forest scanner with dangling detection; `PanelVm` (all panel screens as pure reducers, read-only mode); exported `testkit` (deterministic `SessionBuilder` — also drives `fixtures/generate.ts`).
- **`packages/tui`** (7 tests): `ContextPanel` + band-ticked gauge on pi-tui; ANSI-16-first theme; tested via pi-mono's xterm-headless `VirtualTerminal` harness (copied — not exported upstream), incl. a full TUI mount.
- **`packages/extension`** (16 tests incl. real-pi smoke; loaded from source by pi/jiti — no build): `/branch` (native `setLabel` mirror, model tiering, trunk model recorded), `/merge` (squash drafts via pi-ai using branch model + auth from `ctx.modelRegistry`; **mandatory `ui.editor` gate** — cancel aborts everything; `--no-llm`; discard with note; tournament = ONE combined node + drafted epitaphs + per-sibling close markers; always `navigateTree(…, {summarize:false})`; decision **before** close markers; trunk-model restore), `/crop` (`--auto --dry-run --min-tokens --older-than --keep`; leaf re-validation before write; apply = branch at anchor + `ctree/crop-tail` `custom_message` + `ctree/crop` marker), `/panel` + Ctrl+T (`ui.custom({overlay:true})` host; one action per open, executed back in command context), `/decisions`, ambient footer status `⎇ branch · ctx N% band` + hashed title + one-time red nudge + `/compact` philosophy warning.
- **`packages/pitree`** (4 tests): `pitree [dir] [--dangling] [--json]` + `pitree ui` (session picker → read-only panel); zero-write asserted by mtime/size check.
- **Packaging:** valid pi package — `pi` manifest + `extensions/pi-context-tree.ts` shim + `prepare` build (toolchain in `dependencies` because **pi installs with `npm install --omit=dev`**).

**Real-world validations already done:** extension loads in `pi --mode rpc` (all 5 commands; ambient hooks fired through pi's real pipeline); `pi install git:…` e2e on this machine (clone → omit-dev install → prepare build → global load, no `-e`); `pitree` parsed Naveen's real session correctly.

## 3. Conventions in force (do not regress)

TDD (tests before implementation, red→green per module) · **commit after every step/feature** (conventional messages) · HTML mockup review before any new UI surface · `.ts` relative import specifiers + `rewriteRelativeImportExtensions` (pi-mono style; enables jiti/plain-node TS) · biome (tabs, 120 cols) · append-only invariants: never mutate JSONL, never write both a `BranchSummaryEntry` and a decision record for one close, never crop latest-per-tool without explicit double-mark, pitree never writes.

## 4. Next phase

**P0 — manual acceptance (needs Naveen's terminal, ~15 min, spec §4 Scenarios A–F):**
1. Scenario A end-to-end in a real project: `/branch test-drive` → 2–3 turns → `/merge` → squash → edit record → save. Watch for: (a) **overlay full-screen sizing/feel** (`panel-cmd.ts:openPanel` `overlayOptions` — never human-reviewed; "Overlay Mode" is flagged Experimental upstream); (b) **does the ◆ record appear in context immediately after squash** — if not, it's the `sendMessage(…, deliverAs:"nextTurn")`-while-idle semantics (architecture §11.1); switch deliver mode in `merge.ts`/`crop-cmd.ts`; (c) **no pi summarize-on-leave prompt** during merge (architecture §11.4); (d) gauge correctness right after merge/crop (§11.5).
2. Scenario D/E: `/crop` on a session with a fat tool result; `/panel` keybindings sweep.
3. File issues for whatever feels wrong; fix; commit per fix.

**P1 — engineering backlog (priority order):**
1. **RPC golden-file integration tests** (TRD §7, the one test layer not built): drive real `pi --mode rpc` against a mock OpenAI-compatible endpoint; goldens on session JSONL after `/branch → turns → /merge --squash`, discard, tournament, crop. The RPC smoke test (`packages/extension/test/rpc-smoke.test.ts`) is the starting harness.
2. **CI** (TRD §7): lint+types+unit per push; pinned-pi integration job (smoke needs no API key); non-blocking `pi@latest` lane to catch upstream drift.
3. Polish from known v1 limitations: Ctrl+T opens the panel with a non-command context → mutating actions denied with a notify (use `/panel` for full power) — investigate a command-bridge; `registerMessageRenderer` for pretty ◆ decision cards (currently plain `custom_message` rendering); model-name autocomplete for `/branch` (needs ctx in completion API); panel reopen-after-action (currently one action per open); `/decisions` outside TUI mode.
4. **Upstream PR to pi**: `branchWithFilteredHistory(fromId, excludeIds)` (or extension-level message append) — replaces the crop reconstruction-block compromise with true per-entry filtered history (architecture §9, option 5). File early; adopt when merged.
5. Publishing: npm / pi package gallery needs `peerDependencies: "*"` for `@earendil-works/*` (per pi packages.md — currently pinned hard deps, fine for git installs), `pi-package` gallery metadata (image/video), and a decision on repo visibility (currently private).

**P2 — spec v2 (explicitly out of v1 scope):** web dashboard; RPC-attach mutation for the standalone panel; LibreChat-style scope selector for export; Loom-style zoom-out global view; non-pi log ingestion for forest (SillyTavern dedup trick).

## 5. Operational notes / gotchas for the next session

- **Dev vs installed copy collision:** the git package is installed globally (`~/.pi/agent/settings.json` → `~/.pi/agent/git/github.com/navbytes/pi-context-tree`). Loading the dev tree too (`pi -e ~/repos/ct/pi-context-tree`) registers duplicate commands (pi suffixes them). For dev runs: `pi remove git:github.com/navbytes/pi-context-tree` first, or test with `-e` and reinstall after. After pushing fixes, refresh the installed copy with `pi install git:github.com/navbytes/pi-context-tree` (moves the pinned ref).
- `npm test` at root builds dist first (tui/pitree tests consume built core). `npm run check` = tsc ×4 + biome. `npm run fixtures` regenerates committed fixtures byte-identically (no `Date.now()` in generators — testkit timestamps are fixed).
- The 50MB perf test generates its file in tmp at runtime (~300ms total — that's real, assertions prove it).
- Session-format facts the code depends on are documented with file:line into pi-mono 0.79.1 in the architecture doc — **re-verify against the pinned version after any `pi update`** (risk table, spec §8).
