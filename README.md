# pi-context-tree

Git-style `/branch` · `/merge` · `/crop` workflow and a rich context panel for [pi](https://github.com/earendil-works/pi-mono) sessions. Keep the trunk **small, fresh, relevant** (5–15% of the window — an opinionated heuristic, see the spec's evidence section); never let lossy auto-summaries touch source material; merge branches back as **human-confirmed decision records**.

**Docs:** [docs/pi-context-tree-spec.md](docs/pi-context-tree-spec.md) (PRD/TRD v0.3) · [docs/pi-context-tree-architecture.md](docs/pi-context-tree-architecture.md) (verified pi APIs, design decisions) · [docs/pi-context-tree-mockup.html](docs/pi-context-tree-mockup.html) (interactive TUI mockup — the visual contract; open in a browser) · [docs/HANDOVER.md](docs/HANDOVER.md) (state + next phase).

**Pinned pi:** `@earendil-works/pi-coding-agent@0.79.1` + `@earendil-works/pi-tui@0.79.1` + `@earendil-works/pi-ai@0.79.1`.

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

Applying branches at the anchor and writes ONE `ctree/crop-tail` reconstruction block (kept content + `[cropped: tool arg, ~tokens, sha8]` stubs) plus a `ctree/crop` marker. Originals stay in the JSONL, recoverable forever.

### `/panel` (also `Ctrl+T`) and `/decisions`
The full-screen context panel (an overlay over pi). `/decisions` opens it straight on the decisions view (and prints a text listing where no TUI is available, e.g. RPC mode). The panel stays up across actions: pick a mutation (jump/branch/merge/crop-apply), it executes in command context after re-validating the session, and the panel reopens with fresh state until you close it. `Ctrl+T` opens view-only in 0.79.1 (shortcuts get no command context and pi has no command-invoke API) — use `/panel` for mutations.

#### Panel keys (all views: `q` close · `esc` back/close · `↑↓`/`j k` move · `g G` top/bottom)

| view | keys |
|---|---|
| **tree** | `⏎` fold/unfold fork, jump leaf to entry · `b` branch from entry · `m` merge flow · `c` crop · `i` inspect entry · `D` decisions · `u` consumers |
| **crop** | `space` mark/unmark (`space space` to override latest-per-tool protection) · `a` apply --auto rules · `⏎` apply plan |
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
Footer status `⎇ branch · ctx N% band`, terminal title `project (branch) (pi)` color-hashed per branch, a one-time nudge when context crosses 40%, and a philosophy warning on `/compact` (compaction summarizes lossily — consider `/branch`/`/merge`/`/crop` instead).

## Develop

```sh
npm install
npm test            # builds core/tui/pitree dist, then vitest in all workspaces (128 tests)
npm run check       # tsc --noEmit ×4 packages + biome
npm run fixtures    # regenerate committed fixtures (deterministic, byte-identical)
```

Layout: `core` (parser, tree, estimator, crop planner, panel view-model — zero pi deps) · `tui` (ContextPanel on pi-tui) · `extension` (the pi-facing surface, loaded from source via jiti) · `pitree` (standalone CLI/panel).

TDD throughout; `packages/core/src/testkit.ts` exports the deterministic `SessionBuilder` used by tests and fixtures (it mirrors pi's append semantics, including the `usage` blocks pi's TUI requires on assistant messages).

**Golden integration tests** (`packages/extension/test/golden/`): the real pinned pi runs in `--mode rpc` against a mock OpenAI endpoint; squash / discard / tournament / crop scenarios pin the resulting session JSONL byte-for-byte (normalized ids/timestamps). **Real-TUI test**: `tui-pty.test.ts` boots actual pi in a pseudo-terminal via `expect(1)`, opens the `/panel` overlay and walks the mockup keymap, asserting every screen paints. Both self-skip when `pi` (or `expect`) is missing; re-record intended golden changes with `UPDATE_GOLDENS=1 npm test -w @pi-context-tree/extension`.

CI (`.github/workflows/ci.yml`): lint+types+unit per push · integration against the pinned pi (keyless) · non-blocking `pi@latest` drift lane.
