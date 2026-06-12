# pi-context-tree — agent notes

Git-style `/branch` `/merge` `/crop` + context panel for pi sessions. **Start with [docs/HANDOVER.md](docs/HANDOVER.md)** (state + next phase), then [docs/pi-context-tree-spec.md](docs/pi-context-tree-spec.md) (PRD/TRD, the contract) and [docs/pi-context-tree-architecture.md](docs/pi-context-tree-architecture.md) (verified pi APIs with file:line refs).

## Commands

```sh
npm test            # builds core/tui/pitree dist, then vitest in all workspaces
npm run check       # tsc --noEmit ×4 packages + biome
npm run fixtures    # regenerate committed fixtures (deterministic, byte-identical)
npx vitest --run    # from a package dir, tests only (build core/tui first if stale)
```

Run the extension against real pi: `pi -e <repo-root>` (directory form uses package rules). RPC smoke: `packages/extension/test/rpc-smoke.test.ts` (skips if pi missing).

## Hard rules

- **TDD**: write the failing test first, then implement. Every module in `core` was built red→green.
- **Commit after every step/feature** with conventional messages (`feat(core): …`, `fix(extension): …`); each commit self-consistent. Push when a feature lands.
- **Mockup before UI**: any new UI surface gets reviewed in an HTML mockup (see docs/pi-context-tree-mockup.html) before TUI code.
- **Append-only invariants**: never mutate session JSONL; `/merge` navigates with `summarize:false` and never produces both a `BranchSummaryEntry` and a decision record; latest-per-tool crop protection needs explicit double-mark; pitree/standalone panel never writes (test-enforced).
- **Layering** (TRD §1): `core` imports nothing of pi; `tui` = pi-tui + core; only `extension/src/adapter.ts` defines the pi-facing surface; `pitree` = core + tui.

## Style / toolchain

TypeScript 5.x ESM, Node ≥22.19. Relative imports use `.ts` specifiers (`rewriteRelativeImportExtensions`) — pi loads extension TS source via jiti, plain `node` runs scripts, tsc emits dist for core/tui/pitree. biome: tabs, 120 cols, double quotes. Pinned to `@earendil-works/*@0.79.1` — pi installs packages with `npm install --omit=dev`, so the build toolchain stays in root `dependencies` and `prepare` builds dist.

## Test layout

`core`: vitest vs `testkit.ts` builders + committed `fixtures/` (linear/branched/tournament/truncated/legacy) + 50MB tmp perf test. `tui`: xterm-headless `VirtualTerminal` harness (copied from pi-mono, not exported upstream). `extension`: fake pi surface in `test/fake-pi.ts` + real-pi RPC smoke. `pitree`: zero-write mtime assertion.
