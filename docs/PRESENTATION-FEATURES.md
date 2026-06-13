# The Presentation — *Context is the New Code* (reference feature set)

> Distilled from the originating deck `context-engineering.md` / `.html` (the "presentation"), plus the live feedback that followed it. This is the **reference** — the intended capabilities pi-context-tree is measured against. The companion [APP-FEATURES.md](APP-FEATURES.md) lists what the app actually does and flags every gap.

**Assumption:** "the presentation" = the `context-engineering` deck in `~/repos/ct/context-engineering/`. If a different deck was meant, swap the reference and the gap table in APP-FEATURES.md follows.

---

## 1. The thesis (the *why*)

The deck argues that context quality, not model size, determines output quality:

- **Attention is a fixed budget.** Softmax forces all attention weights to sum to 1, so every token competes for a slice.
- **Irrelevant context dilutes attention**; **too much relevant context flattens it** — both degrade sharp retrieval.
- **Lost in the middle** — causal masking, attention sinks, positional decay → a U-shaped curve: strong at the start and end, weak in the middle.
- **Quantization** (fp8/int4 KV cache) smears already-tiny weights into noise.
- **Agent teams don't escape it** — they trade the problem for lossy summaries or orchestrator bloat.
- **`/compact` is harmful** — it replaces source material with a model-generated hallucination of it.
- **Bigger context windows don't fix it** — "attention IS limited, it's math."

**The prescription:** keep context **small, fresh, relevant (5–15%)**, never `/compact`, and **reuse your context** — treat the session like a git repo where context entries are commits, branches are explorations, and only clean commits reach master.

## 2. The prescribed workflow (the *what* — actionable features)

| # | Deck feature | What the deck says | App status |
|---|---|---|---|
| P1 | **See the context** | "`/tree` or `/export` to see exactly what's in your context." Session = git repo, entries = commits. | ✅ **Exceeded** — the `/panel` is a richer `/tree` (tree + crop + consumers + decisions + inspector). `/export` itself is 🔵 pi-native, not re-added. |
| P2 | **Customise the title** | Title shows "git repo" + current "branch", **color hashed from the name**; branch set by `/branch`. | ✅ **Implemented** — `project (branch) (pi)`, color hashed per branch. |
| P3 | **Customise the prompt bar** | Prompt bar shows how full context is, **gradient green→red**, with states low / healthy / filling / red. | ⚠️ **Approximated** — footer status `⎇ branch · ctx N% band` + the panel's band-ticked gauge + a one-time red nudge. **Not** the literal prompt-*input border* gradient the deck screenshots. (See gap G1.) |
| P4 | **Keep context clean** | "main context is master." `/branch` labels the spot; `/merge` does your "git merge" back to the label; squash; discard. | ✅ **Exceeded** — `/branch` (+ model tiering), `/merge` squash / `--no-llm` / discard / **tournament**, durable decision records. |
| P5 | **Surgically remove huge tool invocations** | `/crop` to manually remove specific entries; shows per-node token estimates. "Useful for very large tool/MCP calls." | ✅ **Exceeded** — `/crop` (token estimates, latest-per-tool protection, `--auto`/`--apply`/`--dry-run`) **+ turn mode** (P7). |
| P6 | **Prefer CLIs over MCPs** | Advice: CLIs pipe/extract exactly what's needed; MCP output is dumped into context wholesale. | ➖ **Philosophy, not a tool feature** — the app makes MCP bloat *visible* (Consumers view) but doesn't replace MCPs. |
| P7 | **Delete a message set** *(live feedback)* | A friend noted you should be able to **select a question + its answers and delete them together** — deleting only the answer corrupts context (orphaned tool pairs, broken alternation). | ✅ **Implemented** — crop panel **turn mode** (`t` toggle); removes a whole Q&A turn via the same append-only reconstruction; current turn & decision records protected. |
| P8 | **Never `/compact`** | `/compact` is "disastrous — replaces source material with a hallucination of it." | ✅ **Implemented** — a one-time philosophy warning fires on `/compact` (never blocks). |
| P9 | **`/reset`** | Listed in the demo as a context-management tool. | 🔵 **pi-native** — not re-added by the extension. |

## 3. Conceptual model the deck establishes

- **Session = git repo, entries = commits, branches = explorations, squash-merge back to master.** This is the spine of the whole tool.
- **Health as a first-class signal** — context fullness shown ambiently (title + prompt bar) so you act before it rots.
- **Reuse over regenerate** — branch, explore, and fold the *conclusion* back, leaving the noise on the branch.

These three ideas are fully adopted by the app; the gaps are only in *surface* (the prompt-bar border) and in commands the deck delegates to pi itself (`/export`, `/reset`).
