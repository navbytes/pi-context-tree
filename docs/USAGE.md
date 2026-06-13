# Using pi-context-tree

A hands-on guide. For the full feature inventory see [APP-FEATURES.md](APP-FEATURES.md); for the why see [PRESENTATION-FEATURES.md](PRESENTATION-FEATURES.md).

---

## 1. Install

```sh
# recommended — installs as a pi package (survives restarts, refresh by re-running):
pi install git:github.com/navbytes/pi-context-tree

# or load the dev tree from source (don't run both — duplicate commands):
pi remove git:github.com/navbytes/pi-context-tree   # if already installed
pi -e /path/to/pi-context-tree
```

You'll know it's loaded when you see a **`CONTEXT …%` gauge bar above your prompt** and `⎇ trunk · ctx N%` in the footer. Commands available: `/branch` `/merge` `/crop` `/panel` `/decisions` (and `Ctrl+Q`).

## 2. The idea in 30 seconds

Treat your pi session like a **git repo**: context entries are commits, the main line is `master`, and side-quests are branches.

- Keep the trunk **small, fresh, relevant** (5–15% of the window).
- Explore on a **branch**; fold only the *conclusion* back as a **decision record** — the noisy turns stay behind.
- Never `/compact` (it replaces source material with a lossy summary).
- When a single tool result or a whole exchange bloats context, **crop** it (the original stays recoverable).

The ambient signals keep you honest: the gauge bar goes **green → orange → red** as context fills.

## 3. Your first session — the core loop

A worked example. Say you're building a feature and context is filling up.

**a) See what's eating your context.** Open the panel and check Consumers:

```
/panel        → press  u
```
You'll see tokens grouped by source — usually a big MCP/tool result on top:
```
TOKENS BY SOURCE — CURRENT BRANCH CONTEXT
  chrome.snapshot · 2 entries · 61%   ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
  user messages   · 8 entries · 14%   ▰▰▰▰▰▰
  …
```

**b) Crop the big one.** From Consumers press `c` to jump into crop, `space` to mark the fat result, `⏎` to apply:
```
press c · space · ⏎
✂ cropped 1 entry → stubs · ~19.4k reclaimed · originals on the previous branch
```
The body is replaced by a stub; the gauge bar drops back into the green.

**c) Branch a side-quest onto a cheaper model.** Back at the prompt:
```
/branch fix-flaky-test haiku-4.5
⎇ branched: fix-flaky-test on anthropic/haiku-4.5 — /merge squashes it back to this point
```
Now do your 20 noisy turns — debugging, tool calls, dead ends — on the cheap branch model.

**d) Fold the conclusion back.** When the side-quest is solved:
```
/merge        → choose  squash
```
The branch model drafts a decision record; it opens in your editor. Edit it, **save to confirm** (closing it empty aborts the whole merge). One clean ◆ node lands at the label, the trunk model is restored, and the 20 noisy turns stay on the branch.

**e) Review your decisions any time:**
```
/decisions
```

That's the loop: **see → crop → branch → merge**. Repeat.

## 4. Commands by example

### `/branch <name> [model]`
```
/branch refactor-auth                 # branch here, same model
/branch refactor-auth haiku-4.5       # …and switch to a cheaper branch model (Tab completes ids)
```
The name is mirrored into pi's native label (it's also a checkpoint). The trunk model is recorded and restored when you merge.

### `/merge [mode] [note]`
Run `/merge` for a selector, or pass the mode directly:
```
/merge --squash            # branch model drafts a decision record → you edit/confirm → lands at the label
/merge --no-llm            # you write the record yourself (no LLM call)
/merge --discard dead end  # back to the label, nothing injected, branch marked rejected ("dead end" on the marker)
/merge --tournament        # winner's record + one-line epitaphs for sibling branches (needs open siblings)
```
The editor is a hard gate — **nothing lands until you save**. Merging never triggers pi's summarize-on-leave.

### `/crop …` — two granularities
Stub a fat tool result, or remove a whole Q&A turn. Both branch at an anchor and leave the originals recoverable.

```
/crop                                  # open the panel, review interactively
/crop --auto                           # pre-mark big/old/unprotected tool results, then review
/crop --auto --apply                   # headless: apply the rule-selected crops, no panel
/crop --auto --dry-run                 # show what it would crop, write nothing
/crop --auto --min-tokens 5000 --older-than 3 --keep chrome.*
```
Rules: ≥ `--min-tokens` (default 10k), older than `--older-than` turns (default 2), never the *latest* result per tool (those need an explicit double-mark), never `--keep` globs.

**Remove a whole exchange (turn mode):** open `/crop`, press `t` to switch to turn mode, `space` to mark a question (its answers come with it), `⏎` to apply. Removing only the answer would orphan tool pairs, so turns drop together. The current turn and decision records are protected.

### `/panel` · `/decisions` · `Ctrl+Q`
`/panel` opens the full-screen context panel; `/decisions` opens it on the decisions view (and prints a text list when there's no TUI). The panel stays up across actions and reopens with fresh state until you close it. `Ctrl+Q` opens it **view-only** (a pi limitation — shortcuts get no command context) — use `/panel` to mutate.

## 5. The context panel — keys

All views: `↑↓` / `j k` move · `g`/`G` top/bottom · `q` close · `esc` back.

| View | What it shows · keys |
|---|---|
| **tree** | every entry with token cost; fork status colors; `← you are here`, `◀ leaf`, `⚠` on ≥10k entries. <br>`⏎` jump/fold · `b` branch from entry · `m` merge · `c` crop · `i` inspect · `D` decisions · `u` consumers |
| **crop** | `space` mark · `a` auto · `⏎` apply · **`t` toggle result ⇄ turn mode** · in turn mode `space` marks a whole Q&A turn |
| **consumers** | tokens by source, bars scaled to the biggest. `c` jump to crop |
| **decisions** | ◆ records as cards (date · model · human-confirmed ✓ · outcome · ✗ epitaphs). `⏎` jump to the record |
| **inspect** | full content of any entry. `c` pre-mark this entry for cropping |

Reading the tree: `●` user · `○` assistant · `⚙` tool/MCP · `◆` decision · `⎇` branch · `✂` crop stub. Fork colors: open **green** · dangling **yellow** · squashed **blue** · rejected **red**.

## 6. The ambient signals (no panel needed)

- **Gauge bar above the prompt** — `CONTEXT ▓▓▓░ … N% band`, green→red, ticks at 5/15/40% (the bands: `<5%` low · `5–15%` healthy · `15–40%` filling · `>40%` red). Your at-a-glance context health.
- **Footer status** — `⎇ branch · ctx N% band`.
- **Terminal title** — `project (branch) (pi)`, color hashed from the branch name.
- **Red nudge** — a one-time gentle warning when context crosses 40%, suggesting `/branch`, `/merge`, or `/crop`.
- **`/compact` warning** — if you invoke pi's `/compact`, a one-time note explains why this tool prefers branch/merge/crop (it never blocks you).

A `~` in front of the percentage means it's the chars/4 *estimate* (pi reports zero usage right after a session loads, before the first fresh turn).

## 7. Recovering cropped or dropped content

Nothing is ever destroyed. A crop or turn-removal **branches at an anchor** and writes a reconstruction block; the originals stay on the **previous branch**. Open `/panel`, find the pre-crop fork in the tree, and `⏎` to jump back to it — the full original content is there. The `sha8` in each `[cropped: …]` / `[dropped turn — …]` marker is the recovery handle.

## 8. Forest — across all your projects

```sh
pitree                 # list every project's session trees, dangling branches flagged
pitree --dangling      # only sessions with open-but-unmerged branches
pitree --json          # machine-readable
pitree ui              # pick a session → open the panel read-only (never writes)
```
"Dangling" = an open fork with no close marker — a branch you started and forgot to merge. The forest makes that hygiene visible.

## 9. Tips & gotchas

- **Squash is the 99% path.** `/branch` + `/merge` keeps the trunk clean. Reach for `/crop` only for the occasional giant tool/MCP result.
- **The editor gate is real.** Save the decision record to confirm a squash; close it empty to abort.
- **Branch onto a cheap model** for grind work; the trunk model is restored on merge automatically.
- **Watch the gauge bar.** When it turns orange, branch or crop *before* it goes red.
- **Dev vs installed copy:** don't load `-e` and the installed package at once (pi suffixes the duplicate commands). Refresh the installed copy after pulling: `pi install git:github.com/navbytes/pi-context-tree`.

## 10. What this tool leaves to pi

- **`/export`** — pi's own HTML/share export.
- **`/reset`** — pi's own context reset.
- **`/compact`** — pi's compaction (this tool warns against it but never blocks it).
- The **input-box border color** for bash/thinking mode is pi's; this tool's health signal is the gauge bar above the prompt instead.
