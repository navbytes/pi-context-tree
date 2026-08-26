# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.2.0] — 2026-08-26

### Added
- `/branch` names can contain Chinese characters (CJK Unified Ideographs) — contributed by
  [@chaosorder010](https://github.com/chaosorder010), ported from their fork with authorship.
- Panel: `PageUp`/`PageDown` paging in every view; `x` clears all marks in the current crop mode;
  the tree footer now documents `g`/`G`.

### Fixed
- Panel: `Ctrl+Q` from a view-only pi context now opens the panel read-only up front (with a
  "run /panel to act" denial) instead of letting crop marks silently vanish when the action fails
  after close.
- Panel: applying a crop in one mode while the other mode (results vs whole-turns) still has marks
  now warns once — `⏎` again confirms — instead of silently dropping the other mode's marks.
- Panel: the overlay no longer shifts by one row when entering/leaving the inspect view.
- Panel: `a` (auto-select) reports only newly marked entries, and says so when nothing new matched
  instead of inviting an empty apply.
- Panel: first-line previews truncate by code points — emoji/CJK can no longer be split into
  mojibake at the cut.
- pitree: the gauge shows `~N est · window unknown` instead of a permanent
  "estimating… (awaiting next turn)" when the token estimate is known but no context window is.
- `/decisions --export` takes the token *after* the flag as the output path (not the first token)
  and expands a leading `~`.

### Changed
- `/merge` squash/tournament review (#33 flow 1): the decision record now confirms in a
  full-screen overlay preview — `Enter` accept · `e` edit in editor · `r` re-draft · `Esc` cancel —
  with the blast radius (entries closed, ~tokens, drafting model) in the header. The editor is one
  keypress away, and saving there still confirms; closing it without saving returns to the preview
  instead of aborting the merge. Headless/RPC hosts keep the original editor gate unchanged. Nothing
  lands without explicit confirmation either way (F2.2).
- Pinned pi bumped `0.79.1` → `@earendil-works/*@0.84.3`; golden files re-recorded for pi's
  additive session-format fields (`usage.reasoning`, `rawStopReason`) — no behavior change in
  what this extension writes.
- Toolchain: TypeScript 6, Vitest 4, Biome 2 (config migrated; the static docs mockup is excluded
  from lint, matching Biome 1.x's scope), `@types/node` 25, `@xterm/headless` 6, postcss 8.5.25,
  and GitHub Actions `checkout`/`setup-node` v7.
- The release workflow can also be run manually (`workflow_dispatch`): it gates and cuts the
  release for the version on `main`, creating the tag server-side — for maintainers working from
  environments that can't push tags.

### Security
- undici `8.5.0` → `8.9.0` (via the pi bump): fixes GHSA-4cwx-7wf7-3272 (high) and four
  medium-severity cache/cookie/header advisories.
- Transitive dev-dependency fixes: nanoid `3.3.18` (GHSA-2v37-7h3g-55p8, high) and protobufjs
  `7.6.5` (GHSA-j3f2-48v5-ccww, moderate); the vulnerable esbuild left the dependency tree
  entirely with Vitest 4. `npm audit`: 0 vulnerabilities.

## [0.1.1] — 2026-06-13

### Fixed
- Gallery preview media (`image` / `video`) now served via **jsDelivr** instead of `raw.githubusercontent.com` — which returned the demo MP4 as `application/octet-stream`, so pi.dev's gallery couldn't render it. jsDelivr serves the correct `video/mp4` and `image/gif` with CDN + CORS. (Packaging only; no behavior change.)

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

[Unreleased]: https://github.com/navbytes/pi-context-tree/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/navbytes/pi-context-tree/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/navbytes/pi-context-tree/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/navbytes/pi-context-tree/releases/tag/v0.1.0
