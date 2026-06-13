# Design note — v0.2 "friction-killers"

> **Status: proposal for review. No code written yet.**
> Visual mockups: [v0.2-friction-killers-mockup.html](v0.2-friction-killers-mockup.html) (open in a browser).

## The problem (from a pi user's feedback)

> "Append-only is safe, but recovery is a treasure hunt; the gap between *safe* and *feels safe* is exactly this. If undo is a chore, I crop timidly — and timid cropping means I don't crop."

The tool is **safe but under-used**: the core loop has friction and the gauge isn't fully trusted, so a user reaches for `/branch` `/merge` `/crop` less than they should. The three HIGH items aren't three features — they're one thesis: **lower the activation energy of the core loop**, without adding knobs or weakening the editor gate.

## Scope this round

The three HIGH items + two cheap MED wins. **Explicit non-goals** (the user's "would NOT add" list, which we honor as a hard fence): auto-merge/crop without a gate · web dashboard · analytics/vanity charts · a crop-rules DSL/config · AI "auto-organize" / suggested branches · tournament brackets/scoring · turn-mode beyond drop-last.

---

## 1. `/undo` — one-key revert of the last mutation  [HIGH]

**Why:** make recovery one keystroke so crop/merge *feel* reversible → people actually do them.

**Model (append-only is preserved — nothing is deleted).** Every ctree mutation already branches at an anchor and leaves the originals on the previous branch. `/undo` is **guided navigation back to the anchor of the most recent `ctree/*` mutation**, restoring the pre-mutation leaf. The appended entries stay in the JSONL (auditable, re-doable); they're just no longer on the active path. This is the *same* recovery that's a treasure-hunt today — as one keystroke.

**Last-mutation detection:** walk the session tail for the most recent extension-written marker and use the anchor it already records:

| Last mutation | `/undo` restores |
|---|---|
| squash / discard close | re-opens the branch — navigate the leaf back to the branch leaf (decision record + close marker stay in history, off-path) |
| crop (result or turn) | navigate back to the pre-crop branch — the original fat result / Q&A turn returns to context |
| `/branch` (fork) | navigate back to the parent; the fork is left dangling (surfaced by the dangling-branch signal) |

**UX:** a confirm that names exactly what reverts —
`↩ undo: re-open 'fix-flaky-test' at its leaf? (the squash decision record stays in history) [y/N]`

**Decision needed from you:** *last mutation only* (simplest, matches the feedback, no new mental model — my recommendation) vs *a small undo stack*. I propose last-only to start.

---

## 2. Gauge: honest estimate + trend + jump attribution  [HIGH]

Three sub-changes to the ambient gauge (`ambient.ts` + `tui/gauge.ts`).

**(a) Kill the fake precision.** Today, before pi reports real usage, the gauge prints `~0.1% low` / `~38.2% filling` — three significant figures of a `chars/4` guess. **Proposed:** while estimated, show **no point-percent** — just the band + a coarse `~Nk est`:
`CONTEXT ░░░ ~30k est · filling`
Once pi reports real usage, switch to the exact `38.2% filling`. We don't *calibrate a guess to look precise* — we stop pretending. ("Never show three significant figures of a quantity you're guessing at.")

**(b) Trend, not just level.** Track last-turn percent (module state). If it rose meaningfully since the last turn, append `▲` (filling fast): `ctx 38% ▲`. Falling shows nothing (stay calm). Proposed threshold: `▲` at **≥ +3 pts/turn** — tuned in code, not user config.

**(c) Jump attribution** — the user's "highest value-per-pixel idea." Track the last-turn consumers snapshot (`aggregateConsumers()` already exists). On a jump, name the bucket that grew the most:
`ctx 38% ▲ +24% (chrome.snapshot)`
This is the one line that tells him *what to crop*, right where he'll see it. Proposed threshold: attribute at **≥ +5 pts/turn**.

---

## 3. Bare `/merge` = squash; selector becomes `--pick`  [HIGH]

Today `/merge` with no flag **always** opens the mode selector (`merge.ts`: `parsed.mode ?? pickMode()`). **Proposed:** bare `/merge` → **squash** straight into the editor draft (the 99% path). `/merge --pick` opens the selector; `--discard` / `--tournament` / `--no-llm` unchanged. **The editor gate is untouched** — nothing lands until you save. One-line handler change + TDD test updates.

**One-key merge from the red nudge** [HIGH — but pi-blocked]. The feedback wants a keystroke in the nudge to jump into the squash draft. ⚠️ That means invoking a command from an ambient surface, which **pi 0.79.1 doesn't allow** (shortcuts/widgets get no command context — the same wall that makes `Ctrl+Q` view-only).
- **Ships now:** the nudge becomes a one-word call to action — `context 41% ▲ — type /merge to squash this branch`.
- **Waits on pi:** the literal one-key. Tracked alongside the existing `Ctrl+Q` roadmap item.

---

## Cheap wins (MED, same round)

**`/crop --top`** — crop the single biggest *unprotected* consumer with one inline prompt:
`✂ chrome.snapshot ~61k (2 entries) → crop? [y/N]`
Reuses `aggregateConsumers()` + the crop planner + the existing latest-per-tool/decision-record protections. Turns the "blind `--auto` sweep he'd never trust" into one trusted decision.

**`/decisions --export [path]`** — serialize all ◆ decision records to portable, ADR-style markdown for a PR / Slack / ADR. A pure serializer over existing records; no new state. "90% of the collab value at 5% of the cost."

---

## Proposed sequencing (each its own small PR, TDD, gate intact)

1. **Bare `/merge` = squash** — smallest change, highest-frequency win.
2. **Gauge honesty (a) + trend (b)** — render change (this mockup gates it).
3. **Jump attribution (c)** — adds the per-turn consumers snapshot.
4. **`/undo`** — the meatiest; its own PR.
5. **`/crop --top` + `/decisions --export`** — cheap, batched.

Nothing here weakens the editor gate, mutates JSONL, or adds a config knob.
