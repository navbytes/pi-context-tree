# pi-context-tree — Handover (v1 + integration layer complete → P0 human acceptance)

**Date:** 2026-06-12 · **Repo:** https://github.com/navbytes/pi-context-tree (private) · **Owner:** Naveen
**State:** All v1 milestones (M1–M8) + RPC golden tests + CI + a **mockup-consistency pass** (decisions cards, section headers with live crop reclaim, share-scaled consumer bars, you-are-here marker) + a **real-TUI PTY walk** (expect(1) drives actual pi: /panel overlay opens, all mockup screens paint, no crash — automates most of the old P0 overlay smoke). 128 tests green. Two real bugs found & fixed by the harnesses: the deliverAs:"nextTurn" data-loss bug (§4a) and testkit sessions crashing pi's TUI footer (assistant messages must carry usage). **Still needs Naveen: the subjective half of P0 — overlay sizing/feel and gauge behavior (§4 items b/d) — plus a quick Scenario A drive with a real model.**

---

## 1. Reference documents (read in this order)

| Doc | What it is |
|---|---|
| [pi-context-tree-spec.md](pi-context-tree-spec.md) | PRD + TRD v0.3 — requirements (F1–F7), goals, data design (`ctree/*` entries), milestones, prior-art appendix (Part 3). The contract. |
| [pi-context-tree-architecture.md](pi-context-tree-architecture.md) | Verified pi 0.79.1 API surface (file:line refs), the two load-bearing design decisions (§8 decision-record = `custom_message`; §9 crop = reconstruction block), testing strategy, §11 verify-at-impl items (1, 2, 4 now resolved — annotated in place). |
| [pi-context-tree-mockup.html](pi-context-tree-mockup.html) | Interactive HTML mockup of the TUI panel — the visual reference. Open in a browser; keybindings match the implementation. |
| [../README.md](../README.md) | Package map, test counts, try-it commands, golden-test how-to. |
| `~/repos/ct/context-engineering/` *(local machine only, not in repo)* | The originating workflow: article + screenshots that define the visual language (prompt-border health colors, title pills, tree/crop look). |

Pinned upstream: `@earendil-works/pi-coding-agent@0.79.1`, `@earendil-works/pi-tui@0.79.1`, `@earendil-works/pi-ai@0.79.1`. Reference clone of pi-mono at `/tmp/pi-mono` (re-clone `earendil-works/pi-mono` if gone). Local pi: 0.79.1 at `/opt/homebrew/bin/pi`; default model `ollama/gemma4`.

## 2. What was built (per package; git history mirrors this)

- **`packages/core`** (79 tests, zero deps): streaming fault-tolerant JSONL parser; `SessionTree` + `contextSlice` reproducing pi's `buildSessionContext`; ctree fork/close status derivation; chars/4 estimator + 5/15/40 bands; consumers; §6 decision-record template; crop planner (latest-per-tool protection, `--auto` rules, sha8 stubs, reconstruction block); forest scanner; `PanelVm` (pure reducers); exported `testkit` (`@pi-context-tree/core/testkit`).
- **`packages/tui`** (9 tests): `ContextPanel` + band-ticked gauge on pi-tui; xterm-headless `VirtualTerminal` harness.
- **`packages/extension`** (36 tests): `/branch` (label mirror, model tiering), `/merge` (squash via pi-ai draft + **mandatory `ui.editor` gate**; `--no-llm`; discard; tournament = ONE combined node + epitaphs + per-sibling closes; always `navigateTree(…,{summarize:false})`; decision **before** close markers; trunk-model restore), `/crop` (`--auto --apply --dry-run --min-tokens --older-than --keep`; **`--apply` = headless apply of the rule-selected plan**, works without the TUI panel), `/panel` + Ctrl+Q, `/decisions`, ambient footer/title.
  - **Test layers:** fake-pi unit tests · real-pi RPC smoke · **RPC goldens** (`test/golden/`): mock OpenAI SSE endpoint (`mock-openai.ts`), sandboxed pi driver (`rpc-driver.ts` — `PI_CODING_AGENT_DIR` isolation + `--session-dir`, answers `extension_ui` dialogs), `normalizeSession` (ids→e00N everywhere incl. content strings; timestamps/dates/cwd/responseId → placeholders), committed goldens in `test/golden/__goldens__/`.
- **`packages/pitree`** (4 tests): forest CLI + read-only panel; zero-write asserted.
- **CI:** `.github/workflows/ci.yml` — see README.

**Real-world validations:** extension loads in `pi --mode rpc` (all five commands; full merge/crop flows drive real session files in the goldens); `pi install git:…` e2e verified earlier; `pitree` parsed a real session.

## 3. Conventions in force (do not regress)

TDD (tests before implementation, red→green per module) · **commit after every step/feature** (conventional messages) · HTML mockup review before any new UI surface · `.ts` relative import specifiers + `rewriteRelativeImportExtensions` · biome (tabs, 120 cols) · append-only invariants: never mutate JSONL, never write both a `BranchSummaryEntry` and a decision record for one close, never crop latest-per-tool without explicit double-mark, pitree never writes · golden changes must be intentional (`UPDATE_GOLDENS=1`, eyeball the diff, commit).

## 4. Next phase

**P0 — manual acceptance (needs Naveen's terminal, ~15 min, spec §4 Scenarios A–F):**
1. Scenario A end-to-end in a real project: `/branch test-drive` → 2–3 turns → `/merge` → squash → edit record → save. Watch for:
   (a) ~~does the ◆ record appear immediately after squash~~ — **RESOLVED**: `deliverAs:"nextTurn"` never persisted it (in-memory only, lost on quit); fixed to plain `{triggerTurn:false}` and pinned by the squash golden (architecture §11.1).
   (b) ~~overlay sizing/feel~~ — **RESOLVED**: full-screen now (width 100%, body padded to terminal rows, constant height); margin bleed seen in the first acceptance screenshots is gone. Resize behavior remains a quick eyeball.
   (c) ~~no pi summarize-on-leave prompt during merge in the TUI~~ — **RESOLVED** (§11.4): the PTY walk drives a real-TUI /merge --discard; no prompt, close marker lands in the file.
   (d) ~~gauge correctness right after merge/crop~~ — **RESOLVED** (§11.5): pi reports zero usage until a fresh assistant turn; both the panel gauge and the ambient footer now fall back to the chars/4 estimate (marked ~) on non-empty sessions.
2. Scenario D/E: `/crop` on a session with a fat tool result (try both the panel flow and `/crop --auto --apply`); `/panel` keybindings sweep against the mockup.
3. File issues for whatever feels wrong; fix; commit per fix.

**P1 — engineering backlog (priority order):**
1. ~~RPC golden-file integration tests~~ **DONE** — squash/discard/tournament/crop goldens, byte-stable, keyless.
2. ~~CI~~ **DONE** — three lanes; first run happens on push (check Actions tab; private repo consumes minutes quota).
3. ~~Polish from known v1 limitations~~ **DONE** except the Ctrl+Q command-bridge: ◆ decision cards via registerMessageRenderer ✓; /branch model autocomplete via a remembered-ctx bridge ✓; panel reopens after actions ✓; /decisions text fallback outside the TUI ✓. **Command-bridge conclusion (investigated):** pi 0.79.1 has no command-invoke API and `sendUserMessage` bypasses slash-command parsing — Ctrl+Q stays view-only until upstream adds one (file alongside item 4).
4. **Upstream PR to pi**: `branchWithFilteredHistory(fromId, excludeIds)` (or extension-level message append) — replaces the crop reconstruction-block compromise with true per-entry filtered history (architecture §9, option 5). File early; adopt when merged. *(Also worth filing: the `deliverAs:"nextTurn"` while-idle semantics are easy to misuse — docs or API tweak.)*
5. Publishing: npm / pi package gallery needs `peerDependencies: "*"` for `@earendil-works/*` (per pi packages.md — currently pinned hard deps, fine for git installs), `pi-package` gallery metadata (image/video), and a decision on repo visibility (currently private).

**P2 — spec v2 (explicitly out of v1 scope):** web dashboard; RPC-attach mutation for the standalone panel; LibreChat-style scope selector for export; Loom-style zoom-out global view; non-pi log ingestion for forest (SillyTavern dedup trick).

## 5. Operational notes / gotchas for the next session

- **Dev vs installed copy collision:** the git package is installed globally (`~/.pi/agent/settings.json` → `~/.pi/agent/git/github.com/navbytes/pi-context-tree`). Loading the dev tree too (`pi -e ~/repos/ct/pi-context-tree`) registers duplicate commands (pi suffixes them). For dev runs: `pi remove git:github.com/navbytes/pi-context-tree` first, or test with `-e` and reinstall after. After pushing fixes, refresh the installed copy with `pi install git:github.com/navbytes/pi-context-tree` (moves the pinned ref). *Tests are immune: smoke + goldens isolate via `PI_CODING_AGENT_DIR`.*
- **Goldens:** run with pi on PATH (`npm test -w @pi-context-tree/extension`); they self-skip otherwise. Re-record intended diffs with `UPDATE_GOLDENS=1`; never re-record blind — the goldens ARE the write-order/data-design contract. Each scenario boots a sandboxed pi (~0.7s each).
- `npm test` at root builds dist first (tui/pitree/extension-goldens consume built core). `npm run check` = tsc ×4 + biome. `npm run fixtures` regenerates committed fixtures byte-identically.
- The 50MB perf test generates its file in tmp at runtime (~300ms total).
- Session-format facts the code depends on are documented with file:line into pi-mono 0.79.1 in the architecture doc — **re-verify against the pinned version after any `pi update`** (risk table, spec §8). The CI `pi@latest` lane automates the early warning.
