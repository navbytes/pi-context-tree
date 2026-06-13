# Adoption plan — pi-context-tree

> Goal: get this from "complete v1, private repo" to "pi users find it, install it, and keep it."
> This doc is the research, the prioritized plan, and a turnkey owner checklist. Updated 2026-06-13.

## TL;DR — the one lever that dominates

**The repository is private.** `pi install git:github.com/navbytes/pi-context-tree` (the install command in every doc) **fails for everyone but the owner**, and a private package never appears in the npm-backed pi gallery. Nothing else on this list moves the needle until the repo is public. Make it public, then publish — everything below is sequenced around that.

## How pi users discover and install packages (research)

pi ([earendil-works/pi](https://github.com/earendil-works/pi), site [pi.dev](https://pi.dev/)) packages bundle extensions/skills/prompts/themes and are shared **via npm or git**. The discovery surfaces, in rough order of reach:

| Channel | How it works | What we need |
|---|---|---|
| **`pi install git:…`** | Clones a public GitHub repo, runs `npm install --omit=dev`, loads the `pi.extensions` manifest. | Repo **public**. ✅ manifest already correct. |
| **`pi install npm:@scope/pkg`** | Installs from npm. Lowest-friction, version-pinnable (`@1.0.0`). | Publish to npm (`private:true` removed; org/scope). |
| **pi gallery — pi.dev/packages** | Lists npm packages with the `pi-package` keyword; shows `image`/`video` metadata. | Published to npm + gallery media (PNG/GIF + MP4). |
| **Community extension lists** | e.g. [jayshah5696/pi-agent-extensions](https://github.com/jayshah5696/pi-agent-extensions), [rytswd/pi-agent-extensions](https://github.com/rytswd/pi-agent-extensions). | Open a PR adding this package. |
| **pi Discord** | Packages are shared/announced there. | Post an announcement with the GIF. |
| **Organic search / npm search** | Keywords + README. | ✅ keywords expanded; README hero added. |

Packaging rules that gate npm/gallery (from pi's `docs/packages.md`): core `@earendil-works/*` packages must be `peerDependencies: "*"` and not bundled (✅ fixed this pass); runtime deps in `dependencies` (prod install drops `devDependencies`); `pi-package` keyword required (✅).

## Prioritized plan

### P0 — unblock distribution (owner-gated; ~30 min)
1. **Flip the repo to public** (Settings → General → Danger Zone). *Single highest-impact action.*
2. **Confirm the license.** MIT is in place (max-adoption default); change now if you prefer Apache-2.0 (patent grant) — trivial while there are no external users.
3. **Tag and release `v0.1.0`** so `pi install git:…@v0.1.0` pins, and the GitHub Releases page signals "ready." (`git tag -a v0.1.0 -m … && git push origin v0.1.0`, then draft a release from CHANGELOG.)

### P1 — be discoverable (mostly owner-gated; ~1–2 h)
4. **Publish to npm.** Remove `private:true`, `npm publish` the package (and the `@pi-context-tree/*` workspace deps it needs, or bundle them). Gives `pi install npm:…` + the gallery.
5. **Record a demo.** A 15–30s GIF of the real loop (`/branch` → noisy turns → `/merge` squash → edit record → `/panel` → `/crop`) is the single biggest conversion asset. Drop it at `docs/assets/demo.gif`, point the README hero and the manifest `image` field at it; add a `video` (MP4) for the gallery. *(No raster/recording tooling in CI — this needs a real terminal; see the recording recipe below.)*
6. **List it.** PR to the community extension lists; announce in Discord. Drafts in the appendix.

### P2 — convert and retain (agent-doable)
7. **Sharpen the README "why."** ✅ Done — industry-standard layout (TOC, Why with the research, Features, Screenshots, Requirements, Usage, Roadmap, Acknowledgements), static panel screenshot. A before/after GIF is the remaining piece (P1.5, owner).
8. **Lower first-run friction.** A one-paragraph "uninstall the dev tree first" note already exists; verify the happy path on a clean machine after going public.
9. **Surface the panel.** `Ctrl+T` opens view-only today (pi 0.79.1 has no command-invoke API). Track upstream; when it lands, make the shortcut mutate.

### P3 — credibility & momentum (owner + agent)
10. **CI badge** once public (the workflow already runs).
11. **A short post / thread** tying to the "Context is the New Code" thesis (the spec's evidence section is the spine) — links the research to the tool.
12. **File the upstream pi PRs** already scoped in HANDOVER §4 P1.4 (`branchWithFilteredHistory`, `deliverAs:"nextTurn"` docs) — being a visible upstream contributor drives credibility and unblocks the crop compromise.

## Owner checklist (turnkey)

```sh
# 1. Make the repo public:  GitHub → Settings → General → Change visibility → Public

# 2. (optional) confirm/swap license — MIT is committed; edit LICENSE + package.json "license" if changing.

# 3. cut the release
git tag -a v0.1.0 -m "pi-context-tree v0.1.0"
git push origin v0.1.0
#    then: GitHub → Releases → Draft new release → tag v0.1.0 → paste CHANGELOG 0.1.0 section

# 4. (when ready) npm publish — remove "private": true from package.json first, then:
#    npm publish --access public   # for each publishable workspace, or bundle workspace deps

# 5. record the demo (see recipe below) → docs/assets/demo.gif, then add to package.json:
#      "image": "https://raw.githubusercontent.com/navbytes/pi-context-tree/main/docs/assets/demo.gif"

# 6. submit to community lists + Discord (drafts in the appendix)
```

### Demo recording recipe (≈ 5 min)
```sh
# asciinema → GIF is the cleanest path:
brew install asciinema agg          # or: cargo install --git https://github.com/asciinema/agg
asciinema rec demo.cast             # run the loop: /branch fix → 2 turns → /merge squash → edit → save → /panel → /crop
agg demo.cast docs/assets/demo.gif  # render GIF
```
Show, in order: the gauge bar above the prompt → `/branch fix-flaky-test haiku-4.5` → a couple of turns → `/merge` → squash → the editor with the drafted record → save → the ◆ card appears on the trunk → `/panel` tree → `/crop` stubbing a fat tool result.

## Done in this pass (2026-06-13)
- ✅ MIT `LICENSE` (legal blocker removed), `CONTRIBUTING.md`, `CHANGELOG.md`.
- ✅ README rebuilt to a standard OSS layout: banner, badges (incl. CI), table of contents, Why (with the research), Features, Screenshots (banner + static panel SVG), Requirements, Install (with release-pin + collapsible dev section), Quickstart, Usage, Panel, How it works, Development, Roadmap, Docs, Contributing, License, Acknowledgements.
- ✅ pi-package discovery metadata: `license`/`author`/`repository`/`bugs`/`homepage`, expanded `keywords`; version → 0.1.0.
- ✅ Packaging compliance: core `@earendil-works/*` → `peerDependencies: "*"` (extension + tui), pinned in devDeps; full suite incl. real-pi goldens stays green.
- ✅ GitHub issue/PR templates; [`PUBLISHING.md`](PUBLISHING.md) release/npm/gallery runbook.

## Appendix — copy-paste drafts

**Community list PR (one row):**
> `pi-context-tree` — Git-style `/branch` `/merge` `/crop` + a context panel for pi. Keep the trunk small/fresh/relevant; squash side-work back as human-confirmed decision records; surgically crop fat tool output. `pi install git:github.com/navbytes/pi-context-tree`

**Discord / social announcement:**
> Shipped **pi-context-tree** — git for your agent's context. `/branch` off for a side-quest (optionally on a cheaper model), `/merge` the conclusion back as a human-confirmed decision record, `/crop` out 40k-token tool dumps — all append-only, originals recoverable. Plus a green→red context-health gauge above your prompt. Built on the "context is the new code" idea: keep context small, fresh, relevant; never `/compact`. Install: `pi install git:github.com/navbytes/pi-context-tree` · [repo] · [30s demo]
