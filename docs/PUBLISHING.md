# Publishing & release runbook

The deferred end-steps (going public + npm), captured so they're one pass when you're ready.

## 0. Prerequisites
- Repo is **public** (GitHub → Settings → General → Change visibility).
- `npm run check` and `npm test` are green on `main`.
- Working tree clean; you're on `main` with the release commit merged.

## 1. Cut the release tag
```sh
git checkout main && git pull
git tag -a v0.1.0 -m "pi-context-tree v0.1.0"
git push origin v0.1.0
```
Then GitHub → **Releases → Draft new release** → choose tag `v0.1.0` → paste the `[0.1.0]` section from [CHANGELOG.md](../CHANGELOG.md). This alone enables version-pinned installs:
```sh
pi install git:github.com/navbytes/pi-context-tree@v0.1.0
```

## 2. (Optional) Publish to npm — enables `pi install npm:…` and the pi.dev gallery

The repo is a workspace monorepo. pi loads the **extension TypeScript source** via jiti, so an npm package must *ship that source* and have its runtime deps resolvable. Recommended approach — publish the scoped workspace packages, then the root pi-package:

1. Remove `"private": true` from the package(s) you publish, and add to each:
   ```jsonc
   "publishConfig": { "access": "public" }
   ```
2. Make sure `files` includes what ships: `core`/`tui`/`pitree` ship `dist` (already set); the **extension** must ship `src` + the root must ship `extensions/`.
3. Build and publish bottom-up (deps first):
   ```sh
   npm run build
   npm publish -w @pi-context-tree/core --access public
   npm publish -w @pi-context-tree/tui  --access public
   npm publish -w @pi-context-tree/pitree --access public
   npm publish -w @pi-context-tree/extension --access public
   # finally the root pi-package (after switching its workspace deps to the published versions, or bundling them):
   npm publish --access public
   ```
   - The core `@earendil-works/*` packages are already `peerDependencies: "*"` — pi provides them at runtime, so they are **not** bundled. ✅
   - The internal `@pi-context-tree/*` deps are `"*"` workspace links. For an npm consumer they must resolve to published versions — either pin them to `^0.1.0` before publishing the root/extension, or list them in `bundledDependencies`. **Decide this once; pinning to published versions is simpler.**
4. Verify a clean install in a scratch dir: `pi install npm:pi-context-tree` → open pi → confirm `/branch`, `/merge`, `/crop`, `/panel`.

## 3. Land in the pi gallery (pi.dev/packages)
The gallery indexes npm packages with the `pi-package` keyword (already set). To get media:
1. Record the demo (see [RECORDING.md](RECORDING.md)) → `docs/assets/demo.gif` and an MP4.
2. Add to the root `package.json`:
   ```jsonc
   "image": "https://raw.githubusercontent.com/navbytes/pi-context-tree/main/docs/assets/demo.gif",
   "video": "https://raw.githubusercontent.com/navbytes/pi-context-tree/main/docs/assets/demo.mp4"
   ```
   (`image`: PNG/JPEG/GIF/WebP · `video`: MP4 only.)

## 4. Announce
- PR the package into the community extension lists; post in the pi Discord with a link to the demo.

## Versioning
[SemVer](https://semver.org/). Bump versions + update [CHANGELOG.md](../CHANGELOG.md) in the same commit; tag `vX.Y.Z` after merge to `main`.
