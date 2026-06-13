# pi-context-tree — Architecture & Implementation Notes

**Companion to:** [pi-context-tree-spec.md](pi-context-tree-spec.md) v0.3 · **Pinned pi:** `@earendil-works/pi-coding-agent@0.79.1` + `@earendil-works/pi-tui@0.79.1` (repo verified at `/tmp/pi-mono`, matches local install)
**Status:** Reviewed source; all API claims below carry file references into the pinned repo.

---

## 1. Verified pi surface (the facts everything below stands on)

| Capability | API | Source |
|---|---|---|
| Full-screen overlay from extension | `ctx.ui.custom(factory, {overlay:true, overlayOptions, onHandle})` — factory gets `(tui, theme, keybindings, done)` | `extensions/types.ts:189-203`; docs "Overlay Mode (Experimental)" `extensions.md:~2408`; examples `examples/extensions/overlay-test.ts`, `overlay-qa-tests.ts` |
| Persist text INTO LLM context | `pi.sendMessage({customType, content, display, details}, {triggerTurn?, deliverAs?})` → `custom_message` entry; converted to user-role message in `buildSessionContext` | `types.ts:1215-1218`; `session-manager.ts:131-137, 391-393` |
| Persist state OUTSIDE LLM context | `pi.appendEntry(customType, data)` → `custom` entry, never sent to model | `types.ts:1230`; `session-manager.ts:100-104` |
| Custom rendering for our entries | `pi.registerMessageRenderer(customType, renderer)` | `types.ts:1208` |
| Native entry labels | `pi.setLabel(entryId, label \| undefined)` → `LabelEntry` (type `label`, in-memory index) | `types.ts:1243`; `session-manager.ts:107-111, 1122-1143` |
| Move the leaf (branch navigation) | `ctx.navigateTree(targetId, {summarize?, customInstructions?, replaceInstructions?, label?})`; low-level `branch(id)` is pointer-only | `types.ts:339-373`; `session-manager.ts:1241-1246` |
| Fork/new session | `ctx.fork(entryId, {position?, withSession?})`, `ctx.newSession`, `ctx.switchSession` | `types.ts:339-373` |
| Model switch + record | `pi.setModel(model)` (false if no key); model also implicit on every assistant message; `model_change` entry on path wins | `types.ts:1264-1265`; `session-manager.ts:369-379, 975-987` |
| Context gauge data | `ctx.getContextUsage()` → `{tokens, contextWindow, percent}`; **tokens is `null` right after compaction** until next assistant turn | `agent-session.ts:2968-3012` |
| Commands / shortcuts | `pi.registerCommand(name, {handler, getArgumentCompletions})`; `pi.registerShortcut("ctrl+q", {handler})` | `types.ts:1178-1188`; `keybindings.md` |
| Footer / title | `ctx.ui.setFooter(factory)` (gets `footerData.getGitBranch()` etc.); `ctx.ui.setTitle(string)`; `ctx.ui.setStatus(key, text)` | `types.ts:176-186`; examples `custom-footer.ts`, `titlebar-spinner.ts` |
| Dialogs | `ctx.ui.select / confirm / input / editor(title, prefill)` (multi-line modal editor), `ctx.ui.notify` | `types.ts:124-275` |
| Read session tree | `ctx.sessionManager` (read-only): `getEntries / getBranch / getTree / getChildren / getEntry / getLabel / buildSessionContext` | `extensions/types.ts:310`, ReadonlySessionManager |
| Summarize-on-leave | three-choice selector; skip via `settings.branchSummary.skipPrompt`; writes `BranchSummaryEntry {fromId, summary}`, which DOES enter context | `interactive-mode.ts:4450-4502`; `session-manager.ts:80-88` |
| Compaction | `CompactionEntry {summary, firstKeptEntryId, tokensBefore}` — context = summary + everything **from `firstKeptEntryId` forward**. **Prefix-only; cannot stub a single mid-history entry** | `session-manager.ts:69-78, 400-423`; `compaction.ts:121-125, 219-222` |
| RPC mode (testing) | `pi --mode rpc`, JSONL stdin/stdout; extension commands invokable via `{"type":"prompt","message":"/cmd args"}`; `get_commands` lists them | `docs/rpc.md` |
| Token estimation | pi's own heuristic is chars/4 (`ESTIMATED_IMAGE_CHARS=4800` per image) — matches our core estimator | `compaction.ts:250-290` |

**Hard absences (0.79.1):** no extension API appends `message`-type entries; no API removes/edits individual entries; the internal `TreeSelectorComponent` used by `/tree` is not exported (copy its flatten-pattern, don't import).

---

## 2. Stack & tooling

- **Language/runtime:** TypeScript 5.x, ESM only, Node ≥ 22.19 (pi-tui's floor). **Bun considered and rejected:** `extension`/`tui` run inside pi's Node process (extensions loaded as TS source via jiti — `loader.ts:15` — so Bun APIs would crash there, and no build step is needed); `pitree` could run on bun but pi users already have Node ≥22.19, its startup is parse-bound not boot-bound, and it shares code with the in-pi packages; pi-mono itself is npm + vitest/`node --test` + biome, and matching that toolchain keeps the VirtualTerminal harness and upstream PRs frictionless. Revisit only if `pitree` ever wants `bun build --compile` single-binary distribution.
- **Workspace:** npm workspaces, `packages/{core,tui,extension,pitree,dashboard}` per TRD §1 — confirmed viable, no changes.
- **Deps:** `@earendil-works/pi-tui@0.79.1` (published, standalone-capable: `TUI` + `ProcessTerminal` + components). Extension package type-imports `@earendil-works/pi-coding-agent@0.79.1`. LLM drafting reuses `@earendil-works/ai` (`completeSimple` — same path pi's branch-summarization takes; verify export name at impl).
- **Test:** vitest everywhere; pi-tui's **`VirtualTerminal`** (xterm.js headless) pattern for TUI tests — instantiate `TUI(vterm)`, `vterm.sendInput(...)`, assert on viewport lines (copy the harness from `packages/tui/test/virtual-terminal.ts`, it is not exported).
- **Lint/format:** biome (pi-mono uses it; zero-config familiarity for upstream PRs).

---

## 3. Package architecture (confirms TRD §1, now concrete)

```
core/        zero pi deps. jsonl streaming parser → EntryNode tree; forest scanner;
             chars/4 estimator; ctree status derivation (open/dangling/squashed/rejected);
             crop planner (selection rules, reconstruction-block builder);
             decision-record template render/parse; ALL view-models (pure data + reducers).
tui/         pi-tui components fed by core view-models:
             TreePanel, CropPanel, MergeSelector, RecordEditorPanel, DecisionList,
             ConsumersTable, GaugeBar, InspectorPanel, ForestPanel.
             No pi-coding-agent imports. Testable with VirtualTerminal.
extension/   index.ts (registration) + session-adapter.ts (THE ONLY file calling pi APIs)
             + commands/{branch,merge,crop,decisions,panel}.ts + ui/{footer,title}.ts
             + renderers/decision-renderer.ts.
pitree/      bin: forest scan over ~/.pi/agent/sessions (core) + standalone panel host
             (tui + ProcessTerminal), read-only — enforced by depending only on core+tui.
```

**View-model pattern (the load-bearing design rule):** every panel is `(state, key) → state` pure reducers in `core`, rendered by dumb `tui` components. The mockup (`pi-context-tree-mockup.html`) is the visual reference; its keymap and screens transcribe 1:1 into view-model tests that never touch a terminal.

---

## 4. session-adapter (the only pi-coupled file)

```ts
// extension/src/session-adapter.ts — wraps ExtensionAPI + contexts; everything mockable.
export interface SessionPort {
  // reads
  tree(): EntryNode[];                       // from ctx.sessionManager.getTree()
  branchPath(): SessionEntry[];              // getBranch()
  label(id: string): string | undefined;
  contextUsage(): { tokens: number | null; window: number; percent: number | null } | undefined;
  currentModel(): { provider: string; id: string } | undefined;
  // writes (all preceded by waitForIdle, all re-validate leaf id)
  navigateTo(id: string): Promise<boolean>;          // navigateTree(id, {summarize:false})
  appendMarker<T>(customType: CtreeType, data: T): void;        // pi.appendEntry
  appendDecision(md: string, details: DecisionDetails): void;   // pi.sendMessage({display:true, triggerTurn:false})
  mirrorLabel(id: string, name: string | undefined): void;      // pi.setLabel
  setModel(idOrAlias: string): Promise<boolean>;
  notify(msg: string, kind?: "info" | "warning" | "error"): void;
}
```

Golden-file tests run the real adapter under RPC mode; everything above it tests against a fake `SessionPort`.

---

## 5. Command flows (exact pi calls)

### /branch `<name> [model]`
1. `ctx.waitForIdle()`
2. `pi.appendEntry("ctree/fork", {v:1, name, parentEntryId: leaf, trunkModel, branchModel, createdAt, status:"open"})`
3. `pi.setLabel(forkEntryId, name)` — pi's own `/tree` now shows it (F1.2)
4. optional `pi.setModel(branchModel)`
5. `ctx.ui.setTitle(...)` + footer refresh.
No leaf movement: the fork entry itself is the label point; subsequent turns are the branch.

### /merge (squash path)
1. Find nearest open `ctree/fork` on `getBranch()` (walk leaf→root) — error w/ guidance if none (F2.1).
2. Draft record: `completeSimple(branchModel, serializeBranch(entries since fork, budget))` — reuse pi's serialization approach incl. its 2000-char tool-result truncation for the *draft prompt only*.
3. **Confirm/edit gate:** `RecordEditorPanel` (overlay; pi-tui `Editor` component) — or `ctx.ui.editor()` dialog as the no-panel fallback. `e` edit / `⏎` accept / `r` redraft with instructions / `esc` abort.
4. On accept, batched writes in this order (§5 TRD invariant: decision before close):
   a. `ctx.navigateTree(forkEntryId, {summarize:false})` ← suppresses pi's own summarize-on-leave (F2.5; double-check `branchSummary.skipPrompt` interplay at impl)
   b. `pi.sendMessage({customType:"ctree/decision", content: recordMd, display:true, details:{v:1, forkEntryId, branchName, siblings}}, {triggerTurn:false, deliverAs:"nextTurn"})`
   c. `pi.appendEntry("ctree/close", {v:1, forkEntryId, status:"squashed", decisionEntryId})`
   d. `pi.setModel(trunkModel)`; `pi.setLabel(forkEntryId, undefined)`? — **no**: keep label, panel shows status color instead.
5. `registerMessageRenderer("ctree/decision", …)` renders the ◆ card (markdown via pi-tui `Markdown`).

**Discard:** steps 1, 4a, 4c with `status:"rejected", note` — nothing else. **Tournament:** same as squash but siblings = open forks sharing `parentEntryId`; one combined record (winner + epitaph lines); close markers for every sibling; all appends batched.

### /crop (v1 semantics — see decision record §9)
1. Candidates = tool/MCP results on current path with est tokens; protections: latest-per-tool requires explicit double-mark (F3.3).
2. Review in `CropPanel` (`--auto` pre-marks; `--dry-run` prints table, exits).
3. Apply: `anchor` = parent of first cropped entry → `ctx.navigateTree(anchor, {summarize:false})` → `pi.sendMessage({customType:"ctree/crop-tail", content: reconstructionBlock, display:true, details})` → `pi.appendEntry("ctree/crop", {v:1, sourceLeafId, stubbed:[…]})`.
4. `reconstructionBlock` = kept tail verbatim (role-prefixed), cropped bodies replaced by `[cropped: <tool> <arg>, <size>, <sha-8>]`. Old branch keeps originals (G4).

### Panel `/panel` + Ctrl+Q
`ctx.ui.custom((tui, theme, keybindings, done) => new TreePanel(vm, theme, keybindings, done), {overlay:true, overlayOptions:{anchor:"center", width:"100%", height:"100%"}})` — exact full-screen `overlayOptions` are the M2 spike's deliverable. Mutations happen **after** `done(action)` resolves, back in the command handler (overlay returns an action descriptor; handler re-validates tree state then executes via SessionPort) — this respects pi's "mutate from command context" model and the spec's re-validate-on-apply invariant (TRD §6).

### Footer gauge + title (always on)
`setFooter` component reads `getContextUsage()` per render: `percent==null` → render `est…` state (post-compaction unknown is a real state, handle it); else band color at 5/15/40. `setTitle(`${project} ⎇ ${branch}`)` on every fork/close/session_start event.

---

## 6. TUI specifics (from pi-tui source)

- **Tree rendering:** copy the flatten-pattern from internal `tree-selector.ts` (`modes/interactive/components/`): flatten visible nodes with `├─ └─ │` guides into a list, then a `SelectList`-style component with `maxVisible ≈ 30` window. No virtualization exists; never render more than the visible slice (10k-entry sessions must stay O(visible)).
- **Width contract:** every `render(width)` line must be pre-truncated (`truncateToWidth`) — overflow corrupts the screen (gotcha #1 from source).
- **Overlay focus:** use `OverlayHandle.unfocus({target})` deliberately when opening nested modals (merge selector → record editor); focus-restore is stateful and the documented sharp edge.
- **Record editing:** embed pi-tui `Editor` (the chat-input component: wrap, scroll, undo, kill-ring) inside `RecordEditorPanel`; read text via `getExpandedText()` (paste markers!).
- **Theme:** consume the `Theme` handed to the overlay factory; chalk-based, truecolor with auto-fallback — gauge gradient degrades to band colors automatically. Never hardcode hex outside the theme adapter.
- **Markdown:** pi-tui `Markdown` renders decision records in Decisions view and the ◆ message renderer.

---

## 7. Testing strategy (concretized)

| Layer | Harness | What |
|---|---|---|
| core | vitest + fixtures | parser (linear/branched/tournament/truncated/legacy/50MB stream), estimator, status derivation, crop planner, **all view-model reducers** (the mockup's flows as table tests) |
| tui | `VirtualTerminal` (xterm headless, copied harness) | render + key-handling per panel; assert viewport lines |
| extension | pi **RPC mode** + mock OpenAI endpoint | golden JSONL after `/branch → turns → /merge --squash`, discard, tournament, crop; assert: entry order (decision before close), model restore, no `BranchSummaryEntry` + record double-write |
| pitree | vitest + fs watch | forest on fixtures; **zero-write assertion** (open files readonly + fs spy) |

---

## 8. Decision record: vehicle for decision records = `custom_message`, not `BranchSummaryEntry`

Considered: (a) native `BranchSummaryEntry` via `navigateTree(..., {summarize:true, customInstructions})` — rejected: its content is generated inside pi's pipeline (async, unreviewed; we need confirm-before-write), and extensions cannot write one with pre-made text; (b) `custom_message` — chosen: extension-writable with exact confirmed text, enters LLM context (verified `session-manager.ts:391-393`), carries `details` metadata for indexing, gets custom rendering, and `display:true` shows it in the transcript. Consequence: `/merge` must always call `navigateTree` with `summarize:false` so pi doesn't also emit a `BranchSummaryEntry` (invariant tested in goldens).

## 9. Decision record: /crop v1 = reconstruction block (+ upstream PR track)

Options considered:
1. **Ride compaction** (spec ≤0.2 assumption) — impossible: prefix-only (`firstKeptEntryId`), verified.
2. **Re-append copied `message` entries with stubs** — impossible via public API: no extension append of `message` entries.
3. **Direct JSONL writes by the extension** — rejected: concurrent-writer hazard, violates "mutate only via pi context" (TRD §6).
4. **Reconstruction block** (chosen): branch at anchor, one `custom_message` carrying the kept tail with stub lines. Append-only, recoverable, works today; granularity loss limited to the post-crop tail and visible in the review screen.
5. **Upstream PR** to pi: `branchWithFilteredHistory(fromId, excludeIds)` or extension-level message append — the clean end-state; file early, adopt at M6 if merged.

## 10. Revised milestone notes

- **M2** is now a *validation* spike (overlay is public API, flagged Experimental): prove `width/height: 100%` overlayOptions, key scoping vs main editor, clean close, behavior during streaming (panel must refuse mutations unless idle). Keep the Ink fallback paragraph until this passes.
- **M3** gains: native `setLabel` mirror; footer `percent==null` state.
- **M4** gains: goldens asserting exactly one of {`BranchSummaryEntry`, decision record} per close.
- **M6** is the reconstruction-block crop; reassess upstream PR status first.

## 11. Open items to verify at implementation start

1. ~~`pi.sendMessage(..., {triggerTurn:false, deliverAs:"nextTurn"})` while idle: confirm it persists the entry immediately at the current leaf (vs queuing until next turn).~~ **RESOLVED (squash golden, 2026-06-12): it does NOT persist** — `deliverAs:"nextTurn"` only stages the message in the in-memory `_pendingNextTurnMessages` (agent-session.ts), written with (and after) the *next user prompt*, lost on quit. The correct call is `{triggerTurn:false}` with **no** `deliverAs`: agent-session's not-streaming/no-trigger branch appends the `custom_message` entry to state + session immediately, no turn fired. merge.ts/crop-cmd.ts use this now; the RPC goldens pin the resulting write order.
2. ~~Exact `completeSimple` export/signature in `@earendil-works/ai` + auth reuse from inside an extension.~~ **RESOLVED (M4):** `complete(model, context, {apiKey, headers})` from `@earendil-works/pi-ai` with auth from `ctx.modelRegistry.getApiKeyAndHeaders(model)` — see extension/src/draft.ts; exercised against a custom provider in the RPC goldens.
3. `overlayOptions` full-screen semantics (M2 spike). **Still open for human review** — overlay opens/closes cleanly in tests, but sizing/feel needs eyes (P0).
4. `navigateTree(..., {summarize:false})` fully bypasses the three-choice prompt regardless of `branchSummary.skipPrompt`. **Verified in RPC mode** (goldens: no `branch_summary` entry, no dialog ui-request during merge/crop navigation); confirm once in the TUI during P0.
5. Whether `custom_message` content is counted by `getContextUsage()` immediately (gauge correctness right after merge). **Still open** (P0 — needs the TUI gauge).
