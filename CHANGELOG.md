# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `LICENSE` (MIT), `CONTRIBUTING.md`, and this changelog.
- Discovery metadata on the package manifest (`license`, `author`, `repository`, `bugs`, `homepage`, expanded `keywords`) and an SVG banner.
- README restructured to a standard OSS layout (banner, badges incl. CI, table of contents, Why, Features, Screenshots, Requirements, Install, Quickstart, Usage, Panel, How it works, Roadmap, Acknowledgements) + a static panel "screenshot" SVG.
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) — release/npm/gallery runbook.
- GitHub issue and pull-request templates.
- Demo GIF placeholder in the README + [`docs/RECORDING.md`](docs/RECORDING.md) recording guide (one-line swap once recorded).

### Changed
- Core `@earendil-works/*` packages moved to `peerDependencies` (`*`) per pi's packaging rules; pinned copies kept in `devDependencies` for local build/test.

## [0.1.0] — 2026-06-13

First tagged release. All v1 milestones (M1–M8) complete; CI green on three lanes.

### Added
- **`/branch <name> [model]`** — label the current point (mirrored into pi's native labels) and fork, optionally onto a cheaper branch model; trunk model recorded and restored on merge; model/branch-name autocomplete.
- **`/merge [--squash | --no-llm | --discard | --tournament] [note]`** — close the nearest open branch as a human-confirmed ◆ decision record (squash), a manual record (`--no-llm`), a rejection (`--discard`), or a tournament (winner record + drafted epitaphs for sibling branches). Always navigates `summarize:false`.
- **`/crop [--auto] [--apply] [--dry-run] [--min-tokens N] [--older-than N] [--keep glob]`** — append-only crop of fat tool/MCP results (result mode) or whole Q&A turns (turn mode); rule-based `--auto`; headless `--auto --apply`; latest-per-tool protection. Originals always recoverable.
- **`/panel` (`Ctrl+Q`) and `/decisions`** — full-screen context TUI: tree with per-node token costs, branch status colors, consumers, decisions, and entry inspector; reopens across actions.
- **Ambient UI** — a green→red context-health gauge bar pinned above the prompt (band ticks at 5/15/40%), a footer status, a color-hashed terminal title, a one-time >40% nudge, and a philosophy warning on `/compact`.
- **`pitree`** — standalone, read-only forest CLI across all pi projects (`--dangling`, `--json`) plus `pitree ui`.
- **Test layers** — `core` unit tests + committed fixtures + a 50MB perf test; `tui` xterm-headless harness; `extension` fake-pi units, real-pi RPC smoke, byte-stable RPC goldens (squash/discard/tournament/crop), and a real-TUI PTY walk; `pitree` zero-write assertion.
- **CI** — lint/types/unit per push, integration against the pinned pi (keyless), non-blocking `pi@latest` drift lane.

[Unreleased]: https://github.com/navbytes/pi-context-tree/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/navbytes/pi-context-tree/releases/tag/v0.1.0
