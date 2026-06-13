# Contributing to pi-context-tree

Thanks for your interest! This project is a [pi](https://github.com/earendil-works/pi) package: a TypeScript ESM monorepo (`core` · `tui` · `extension` · `pitree`) built with strict TDD. Please read the [architecture doc](docs/pi-context-tree-architecture.md) and [spec](docs/pi-context-tree-spec.md) before a substantial change — they capture the load-bearing invariants.

## Dev loop

```sh
npm install
npm test       # builds core/tui/pitree dist, then vitest across all workspaces
npm run check  # tsc --noEmit ×4 packages + biome
npm run fixtures  # regenerate committed fixtures (must stay byte-identical)
```

Run the extension against real pi from source:

```sh
pi remove git:github.com/navbytes/pi-context-tree   # if the published package is installed (avoids duplicate commands)
pi -e /path/to/pi-context-tree                       # loads packages/extension via jiti
```

The golden + real-TUI tests need `pi` (and `expect(1)`) on `PATH`; they self-skip otherwise. Re-record intended golden changes deliberately: `UPDATE_GOLDENS=1 npm test -w @pi-context-tree/extension`, then eyeball the diff — **the goldens are the write-order/data-design contract.**

## Hard rules (do not regress)

- **TDD** — write the failing test first, then implement. Every `core` module was built red→green.
- **Commit after every step/feature** with [Conventional Commits](https://www.conventionalcommits.org/) (`feat(core): …`, `fix(extension): …`); each commit self-consistent.
- **Mockup before UI** — any new UI surface gets an HTML mockup review (see `docs/pi-context-tree-mockup.html`) before TUI code.
- **Append-only invariants** — never mutate session JSONL; `/merge` navigates with `summarize:false` and never produces both a `BranchSummaryEntry` and a decision record; latest-per-tool crop protection needs an explicit double-mark; `pitree`/standalone panel never writes (test-enforced).
- **Layering** — `core` imports nothing of pi; `tui` = pi-tui + core; only `extension/src/adapter.ts` defines the pi-facing surface; `pitree` = core + tui.

## Style / toolchain

TypeScript 5.x ESM, Node ≥ 22.19. Relative imports use `.ts` specifiers (`rewriteRelativeImportExtensions`). biome formatting: tabs, 120 columns, double quotes (`npm run check:lint`). Core `@earendil-works/*` packages are peer dependencies (`*`) and are provided by pi at runtime — never bundle them.

## Pull requests

1. Fork and branch from `main`.
2. Keep `npm run check` and `npm test` green.
3. Use conventional commit messages; squash noise.
4. Describe the user-visible change and link any relevant spec/architecture section.

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
