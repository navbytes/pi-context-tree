# pi-context-tree

Git-style `/branch` · `/merge` · `/crop` workflow and a rich context panel for [pi](https://github.com/earendil-works/pi-mono) sessions. Keep the trunk **small, fresh, relevant** (5–15% of the window — an opinionated heuristic, see the spec's evidence section); never let lossy auto-summaries touch source material; merge branches back as **human-confirmed decision records**.

**Docs:** `../pi-context-tree-spec.md` (PRD/TRD v0.3) · `../pi-context-tree-architecture.md` (verified pi APIs, design decisions) · `../pi-context-tree-mockup.html` (interactive TUI mockup — the visual reference).

**Pinned pi:** `@earendil-works/pi-coding-agent@0.79.1` + `@earendil-works/pi-tui@0.79.1`.

## Layout

| package | contents | status |
|---|---|---|
| `packages/core` | session JSONL parser (streaming, fault-tolerant), tree + context-slice model (compaction-aware), ctree fork/close status derivation, chars/4 estimator + gauge bands, consumers, decision-record template, crop planner, forest scanner, panel view-model. Zero runtime deps, zero pi deps. | **✅ 72 tests** |
| `packages/tui` | `ContextPanel` (tree/crop/consumers/decisions/inspect) + gauge on pi-tui; xterm-headless harness | **✅ 7 tests** |
| `packages/extension` | `/branch` `/merge` (squash · --no-llm · discard · tournament) `/crop` (--auto --dry-run) `/panel` (+Ctrl+T) `/decisions`, ambient status gauge + title, LLM drafting via pi-ai. Loaded from source by pi (jiti), no build. | **✅ 16 tests** (incl. real-pi RPC smoke) |
| `packages/pitree` | `pitree [--dangling --json]` forest CLI + `pitree ui` read-only panel | **✅ 4 tests** (zero-write asserted) |
| `fixtures/` | deterministic committed fixtures (`npm run fixtures` regenerates) | ✅ |

## Try it

```sh
# inside any project:
pi -e /Users/naveen/repos/ct/pi-context-tree/packages/extension/src/index.ts
#   /branch fix-flaky-test haiku-4.5 → work → /merge → squash → review → ⏎
#   /crop --auto · /panel or Ctrl+T · /decisions

# auto-discovery instead of -e:
ln -s /Users/naveen/repos/ct/pi-context-tree/packages/extension ~/.pi/agent/extensions/pi-context-tree

# forest:
node /Users/naveen/repos/ct/pi-context-tree/packages/pitree/dist/cli.js [--dangling] [--json]
node /Users/naveen/repos/ct/pi-context-tree/packages/pitree/dist/cli.js ui
```

## Develop

```sh
npm install
npm test            # vitest, all workspaces
npm run check       # tsc --noEmit + biome
npm run fixtures    # regenerate committed fixtures (deterministic)
```

TDD: every module in `core` was built test-first; `packages/core/src/testkit.ts` exports the deterministic `SessionBuilder` used by tests and fixtures (it mirrors pi's append semantics — `at(id)` moves the leaf, i.e. branches).
