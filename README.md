<p align="center">
  <img src="docs/assets/banner.svg" alt="pi-context-tree — git-style /branch, /merge, /crop plus a context panel for pi" width="820">
</p>

<h1 align="center">pi-context-tree</h1>

<p align="center"><b>Git for your agent's context.</b> Branch off for side-quests, squash the conclusion back as a human-confirmed decision record, and surgically crop bloated tool output — all inside <a href="https://github.com/earendil-works/pi">pi</a>.</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  <img src="https://img.shields.io/badge/node-%E2%89%A522.19-339933?logo=node.js&logoColor=white" alt="Node >= 22.19">
  <img src="https://img.shields.io/badge/pi-0.79.1-8957e5" alt="pi 0.79.1">
  <img src="https://img.shields.io/badge/tests-162%20passing-2ea043" alt="162 tests passing">
  <img src="https://img.shields.io/badge/built%20with-TDD-ff69b4" alt="Built with TDD">
</p>

---

**Why.** A model's attention is a fixed budget: as the context window fills, retrieval degrades — measurably and non-uniformly ("context rot"; NoLiMa; LongMemEval — see the [spec's evidence section](docs/pi-context-tree-spec.md#part-0--design-philosophy-context-for-the-building-agent)). pi-context-tree treats the session like a **git repo**: keep the trunk **small, fresh, relevant**, never let lossy auto-summaries (`/compact`) touch source material, and merge side-work back only as **clean, reviewed commits**.

**What you get** — five commands and an ambient health gauge:

| | |
|---|---|
| `/branch <name> [model]` | Label the spot and fork off — optionally onto a cheaper model for the side-quest. |
| `/merge` | Close a branch: **squash** to a human-confirmed ◆ decision record, **discard**, or run a **tournament** between sibling approaches. |
| `/crop` | Stub out fat tool/MCP results (or drop a whole Q&A turn) — append-only, originals always recoverable. |
| `/panel` (`Ctrl+T`) | Full-screen TUI: the tree with per-node token costs, branch status colors, consumers, decisions, inspector. |
| gauge bar | A green→red context-health bar pinned above your prompt, so you act before context rots. |

## Quickstart (30 seconds)

```sh
# 1. install into pi (survives restarts; re-run to update)
pi install git:github.com/navbytes/pi-context-tree

# 2. inside a pi session, fork off for a side-quest (optionally on a cheaper model)
/branch fix-flaky-test haiku-4.5

#    …do the noisy exploration…

# 3. fold just the conclusion back to the trunk as a reviewed decision record
/merge            # pick "squash" → edit the drafted record → save

# 4. see and prune what's in context any time
/panel            # browse the tree;  /crop to stub a 40k-token tool dump
```

> New to the workflow? The hands-on [**USAGE guide**](docs/USAGE.md) walks the full loop with examples.

## Install

```sh
# as a pi package (recommended — survives pi restarts, auto-updates on reinstall):
pi install git:github.com/navbytes/pi-context-tree

# development tree instead (don't combine with the installed package — duplicate commands):
pi remove git:github.com/navbytes/pi-context-tree   # if previously installed
pi -e /path/to/pi-context-tree                       # loads packages/extension from source

# standalone forest CLI (read-only, never writes):
node packages/pitree/dist/cli.js [dir] [--dangling] [--json]
node packages/pitree/dist/cli.js ui                  # session picker → read-only panel
```

## Commands

### `/branch <name> [model]`
Labels the current point (mirrored into pi's native labels — it doubles as a checkpoint) and opens a branch, optionally switching to a cheaper model for the side-quest. The trunk model is recorded and restored on merge.

```
/branch fix-flaky-test               # branch at the current leaf
/branch fix-flaky-test haiku-4.5     # …and run the branch on haiku (bare id or provider/id; Tab completes)
```

### `/merge [--squash | --no-llm | --discard | --tournament] [note…]`
Closes the nearest open branch at or above the leaf. With no flag, a selector offers the modes:

- **squash** — the branch model drafts a decision record from the branch transcript; it opens in your editor. **Nothing lands until you save** — closing the editor empty aborts everything. The confirmed record becomes one ◆ `custom_message` node at the branch label; the noisy turns stay on the branch (history is append-only, never deleted).
- **squash `--no-llm`** — same flow, but you write the record into the template yourself (no LLM call).
- **`--discard [note]`** — back to the label, nothing injected, branch marked rejected. The note lands on the close marker.
- **`--tournament`** — needs open sibling branches forked from the same point. The current branch wins: ONE combined record (winner + one-line drafted epitaphs for each loser), per-sibling close markers. Epitaphs keep the trunk model from re-proposing rejected approaches.

Merging never triggers pi's summarize-on-leave (`summarize:false` everywhere) — a decision record and a `BranchSummaryEntry` can never double-write.

### `/crop [--auto] [--apply] [--dry-run] [--min-tokens N] [--older-than N] [--keep glob]`
Surgically stubs out fat tool/MCP results. Interactive by default: opens the panel's crop view with rule-based pre-marking when `--auto` is given. `--auto --apply` skips the panel entirely (scriptable; the only mode available where pi has no TUI). `--dry-run` always wins — it reports and writes nothing.

Auto rules: ≥ `--min-tokens` (default 10k), older than `--older-than` assistant turns (default 2), never the latest result per tool (cropping those needs an explicit double-mark in the panel), never `--keep` matches.

**Two granularities, one mechanism.** The crop panel has a `t` toggle:
- **result mode** (default) — stub individual fat tool/MCP results, replaced by `[cropped: tool arg, ~tokens, sha8]`.
- **turn mode** — remove a whole **Q&A turn** (a user question + every answer/tool entry it spawned) *together*. Removing only the answer would orphan `tool_call`/`tool_result` pairs and break user/assistant alternation, so turns drop as a unit. A removed turn collapses to one label-free `[dropped turn — N entries, ~tokens, recoverable: sha8]` note (the question text is **not** re-injected; the readable label is kept in the marker). The current/leaf turn is protected; ◆ decision records can never be swept up. Turn removal is panel-only (it's a "pick this specific exchange" action, not a bulk rule).

Both apply the same way: branch at the anchor, write ONE `ctree/crop-tail` reconstruction block plus a `ctree/crop` marker (`stubbed[]` and/or `dropped[]`). Originals stay in the JSONL, recoverable forever.

### `/panel` (also `Ctrl+T`) and `/decisions`
The full-screen context panel (an overlay over pi). `/decisions` opens it straight on the decisions view (and prints a text listing where no TUI is available, e.g. RPC mode). The panel stays up across actions: pick a mutation (jump/branch/merge/crop-apply), it executes in command context after re-validating the session, and the panel reopens with fresh state until you close it. `Ctrl+T` opens view-only in 0.79.1 (shortcuts get no command context and pi has no command-invoke API) — use `/panel` for mutations.

#### Panel keys (all views: `q` close · `esc` back/close · `↑↓`/`j k` move · `g G` top/bottom)

| view | keys |
|---|---|
| **tree** | `⏎` fold/unfold fork, jump leaf to entry · `b` branch from entry · `m` merge flow · `c` crop · `i` inspect entry · `D` decisions · `u` consumers |
| **crop** | `t` toggle result ⇄ turn mode · `space` mark/unmark (result: `space space` overrides latest-per-tool protection; turn: marks the whole Q&A turn) · `a` apply --auto rules (result mode) · `⏎` apply plan |
| **consumers** | `c` jump to crop |
| **decisions** | `⏎` jump to the ◆ record on the trunk |
| **inspect** | `c` pre-mark this entry for cropping |

#### Reading the panel

- Glyphs: `●` user · `○` assistant · `⚙` tool/MCP result · `◆` decision record · `⎇` branch label · `✂` crop stub · `⚠` ≥10k-token entry.
- Branch status colors: open green · dangling yellow (open fork, no close marker — branch hygiene smell) · squashed blue · rejected/discarded red.
- Gauge bands at 5/15/40%: `<5%` low · `5–15%` healthy · `15–40%` filling · `>40%` red.
- `← you are here` marks the open fork you'd merge; `◀ leaf` marks the entry context currently ends at.
- In the chat itself, ◆ decision records render as cards (title · date · human-confirmed ✓ · outcome · red ✗ epitaphs).

### Ambient (outside the panel)
A **context-health gauge bar pinned above the prompt** (`CONTEXT ▓▓░ … N% band`, green→red, band ticks at 5/15/40%) — the deck's "prompt bar shows how full your context is." Plus a footer status `⎇ branch · ctx N% band`, terminal title `project (branch) (pi)` color-hashed per branch, a one-time nudge when context crosses 40%, and a philosophy warning on `/compact`.

> The deck colors pi's input *border* by health; pi owns that border for bash/thinking-mode indication and re-asserts it, so an extension can't color it without fighting pi. The gauge bar (pinned via `setWidget`) is the safe, faithful realization — same always-visible green→red signal, directly above where you type.

## Develop

```sh
npm install
npm test            # builds core/tui/pitree dist, then vitest in all workspaces (162 tests)
npm run check       # tsc --noEmit ×4 packages + biome
npm run fixtures    # regenerate committed fixtures (deterministic, byte-identical)
```

Layout: `core` (parser, tree, estimator, crop planner, panel view-model — zero pi deps) · `tui` (ContextPanel on pi-tui) · `extension` (the pi-facing surface, loaded from source via jiti) · `pitree` (standalone CLI/panel).

TDD throughout; `packages/core/src/testkit.ts` exports the deterministic `SessionBuilder` used by tests and fixtures (it mirrors pi's append semantics, including the `usage` blocks pi's TUI requires on assistant messages).

**Golden integration tests** (`packages/extension/test/golden/`): the real pinned pi runs in `--mode rpc` against a mock OpenAI endpoint; squash / discard / tournament / crop scenarios pin the resulting session JSONL byte-for-byte (normalized ids/timestamps). **Real-TUI test**: `tui-pty.test.ts` boots actual pi in a pseudo-terminal via `expect(1)`, opens the `/panel` overlay and walks the mockup keymap, asserting every screen paints. Both self-skip when `pi` (or `expect`) is missing; re-record intended golden changes with `UPDATE_GOLDENS=1 npm test -w @pi-context-tree/extension`.

CI (`.github/workflows/ci.yml`): lint+types+unit per push · integration against the pinned pi (keyless) · non-blocking `pi@latest` drift lane.

## Docs

- [**USAGE.md**](docs/USAGE.md) — hands-on guide (install, the core loop, commands by example, panel keys, recipes). **Start here.**
- [APP-FEATURES.md](docs/APP-FEATURES.md) — full feature inventory.
- [pi-context-tree-spec.md](docs/pi-context-tree-spec.md) — PRD/TRD v0.3 + the evidence/positioning section.
- [pi-context-tree-architecture.md](docs/pi-context-tree-architecture.md) — verified pi APIs (file:line) + design decisions.
- [pi-context-tree-mockup.html](docs/pi-context-tree-mockup.html) — interactive TUI mockup (open in a browser).

## Contributing & license

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the TDD/commit conventions and the dev loop, and [CHANGELOG.md](CHANGELOG.md) for release notes.

Licensed under the [MIT License](LICENSE). Built for [pi](https://github.com/earendil-works/pi), pinned to `@earendil-works/pi-coding-agent@0.79.1` + `pi-tui@0.79.1` + `pi-ai@0.79.1`.
