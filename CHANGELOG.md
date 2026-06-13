# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-06-13

First public release — a git-style branch/merge/crop workflow plus a full-screen context panel for [pi](https://github.com/earendil-works/pi) sessions. Append-only and recoverable; pinned to `@earendil-works/*@0.79.1`.

### Commands
- **`/branch <name> [model]`** — label the current point (mirrored into pi's native labels) and fork off, optionally onto a cheaper branch model; the trunk model is recorded and restored on merge. Tab-completes model ids.
- **`/merge [--pick | --no-llm | --discard | --tournament] [note]`** — **bare `/merge` squashes** the branch into a human-confirmed ◆ decision record (mandatory editor gate — nothing lands until you save). `--pick` opens the mode selector; `--no-llm` writes the record by hand; `--discard` rejects; `--tournament` keeps the winner's record + drafted epitaphs for the sibling branches. Always navigates `summarize:false` so pi's own summary never double-writes.
- **`/crop [--top] [--auto] [--apply] [--dry-run] [--min-tokens N] [--older-than N] [--keep glob]`** — surgically stub fat tool/MCP results (result mode) or drop a whole Q&A turn (turn mode), append-only. **`--top`** crops the single biggest unprotected result with one inline confirm; `--auto`/`--apply`/`--dry-run` for rule-based and headless crops; latest-per-tool protection. Originals always recoverable.
- **`/undo`** — one-key, append-only revert of the last mutation: re-open a squashed/discarded branch, restore a crop, or undo a `/branch`. Nothing is deleted.
- **`/panel` (`Ctrl+Q`)** — full-screen context panel: tree with per-node token costs, branch status colors, top consumers, decision cards, and an entry inspector.
- **`/decisions [--export path]`** — review decision records; `--export` writes them to portable markdown (PR / ADR / Slack).
- **`pitree`** — standalone, read-only forest CLI across all pi projects (`--dangling`, `--json`) plus `pitree ui`.

### Ambient UI
- Context-health gauge bar pinned above the prompt (green→red, band ticks at 5/15/40%) with a **`▲` trend** and **jump attribution** (`ctx 38% ▲ +24% (chrome.snapshot)`); stays honest while pi is still calibrating (band word + `~est`, never a fake-precise percent). Plus a footer status, a color-hashed terminal title, a one-time >40% nudge, and a `/compact` philosophy warning.

### Foundations
- **Append-only data model** (`ctree/*` markers) — session JSONL is never edited or deleted; every change is recoverable.
- **Layered, pi-light core** — `core` has zero pi deps; `tui` builds on pi-tui; `extension` is the only pi-facing surface; `pitree` is standalone.

### Project & tooling
- MIT license, `CONTRIBUTING.md`, issue/PR templates, an SVG banner, a demo GIF, and discovery metadata on the package manifest.
- **Tests** — `core` units + committed fixtures + a 50MB perf test; `tui` xterm-headless harness; `extension` fake-pi units, real-pi RPC goldens (squash/discard/tournament/crop) and a v0.2 e2e (bare-merge, `/undo`, `/crop --top`, `/decisions --export`), plus a real-TUI PTY walk; `pitree` zero-write assertion.
- **CI** — lint/types/unit per push, integration against the pinned pi (keyless), and a non-blocking `pi@latest` drift lane.
- **Release** — pushing a `vX.Y.Z` tag runs the gate and cuts a GitHub Release from this changelog.

[Unreleased]: https://github.com/navbytes/pi-context-tree/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/navbytes/pi-context-tree/releases/tag/v0.1.0
