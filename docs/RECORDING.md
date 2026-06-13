# Recording the demo GIF

Goal: produce `docs/assets/demo.gif` (a 15–30s loop of the core workflow) and optionally `docs/assets/demo.mp4` for the pi gallery. Run this on a **real terminal** with pi installed and a working model — it can't be done in CI.

## Prerequisites
- `pi` installed and configured with a model that can drive a couple of turns.
- [`asciinema`](https://asciinema.org/) (record) and [`agg`](https://github.com/asciinema/agg) (render GIF). On macOS: `brew install asciinema agg`. For an MP4 you also need `ffmpeg`.
- This repo installed into pi so the commands exist: `pi install git:github.com/navbytes/pi-context-tree` (or `pi -e .` from the repo root; remove the installed copy first to avoid duplicate commands).

## Shot list (≈ 20–30s)
Record a small real project so the tree is believable. In order:
1. Open pi — show the **green→red gauge bar above the prompt**.
2. `/branch fix-flaky-test haiku-4.5` — show the title/footer flip to the branch.
3. Two short turns of "exploration" (anything that adds a tool call or two).
4. `/merge` → choose **squash** → the drafted decision record opens in the editor → save.
5. Show the ◆ **decision card** that lands on the trunk, and the gauge dropping back to healthy.
6. `/panel` → scroll the tree → `c` to **crop** a fat tool result → apply.
7. `q` to close. End on a clean, healthy gauge.

Keep it tight — trim dead air; viewers decide in the first 3 seconds.

## Commands
```sh
asciinema rec demo.cast            # perform the shot list, then exit the shell (Ctrl-D) to stop
agg demo.cast docs/assets/demo.gif # render the GIF
# optional MP4 for the gallery:
agg demo.cast demo.frames.gif && ffmpeg -i demo.frames.gif -movflags faststart -pix_fmt yuv420p docs/assets/demo.mp4
```
Tuning: `agg --speed 1.4 --idle-time-limit 1.5 --font-size 18 demo.cast docs/assets/demo.gif` keeps it snappy and legible. Aim for < ~5 MB so it loads fast in the README.

## Wire it in
1. Replace the placeholder in `README.md` — swap `docs/assets/demo-placeholder.svg` for `docs/assets/demo.gif` (there's a `TODO` comment at the spot) and delete `docs/assets/demo-placeholder.svg`.
2. (For the gallery) add to the root `package.json`:
   ```jsonc
   "image": "https://raw.githubusercontent.com/navbytes/pi-context-tree/main/docs/assets/demo.gif",
   "video": "https://raw.githubusercontent.com/navbytes/pi-context-tree/main/docs/assets/demo.mp4"
   ```
3. Commit: `git add docs/assets README.md package.json && git commit -m "docs: add demo GIF"`.
