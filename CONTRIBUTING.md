# Contributing

## Setup

You need Node.js 24 or later, npm, [Bun](https://bun.sh) 1.4.4 (the Bun inside stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6) and [Rust](https://rustup.rs) 1.96.0 (`rustup toolchain install 1.96.0`).

```sh
git clone https://github.com/joe-broadhead/opencode-utilities.git
cd opencode-utilities
npm ci --ignore-scripts
npm run check
```

The time and weather programs, the speech engine, the models, their notices and the hash manifests are build outputs, not in git. `npm run check` builds this platform's missing or stale native files first (`npm run native:build` does it explicitly), so the first run takes a while. Set `NATIVE_BUILD_ROOT` to a directory outside the repository to keep Cargo's work between clones.

`npm run build` uses esbuild to write exactly two self-contained files, `dist/index.js` (server) and `dist/tui.js` (TUI, compiled from Solid JSX first). Neither imports a relative file, so an in-place update cannot load a stale sibling; the pack test checks this.

The root `NOTICE` holds the licence of every package bundled into `dist/` (zod). `npm run build` fails when it no longer matches the bundle; run `node scripts/build.mjs --notice` to rewrite it, then commit it. The native notices ship with the GitHub Release assets; see `licenses/README.md`.

The time and weather programs are built with `npm run native:build` into `build/native/<platform>/`, which is gitignored. `scripts/native-files.mjs` writes `manifest/native.json` and `manifest/speech-assets.json` from those files.

To try a checkout in OpenCode, point a `plugins` entry's `package` at the repository directory. Until a release has them, the time and weather tools cannot download their programs in a checkout: copy `build/native/<platform>/<program>` into the plugin cache (`$XDG_CACHE_HOME/opencode-utilities/native/v<version>/<program>/<platform>/`) to try them.

## Checks

`npm run check` runs, in order: the native ensure step, the typecheck of `src` and `test`, the unit tests, the JS build, the host tests on the embedded `@opencode/sdk` for each tested release (`scripts/host-tests.mjs`; `HOST_SDK_DIR` runs one), the TUI test, the forbidden-API scan (`npm run lint`) and the pack test, which runs every tested release. The pack test packs the plugin and this platform's package, installs them into an empty project with scripts off, and loads them in each tested stock OpenCode release. The tested releases are one list, `TESTED_HOSTS` in `src/host/versions.ts` (2.2.3, 2.2.4, 2.2.5 and 2.2.6); the status, the tests and CI all read it.

- Set `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4`, `OPENCODE_BIN_2_2_5` and `OPENCODE_BIN_2_2_6` to stock `opencode` binaries to skip installing them. Unset, the pack test installs each release into its own temp folder, as CI and the release do.
- Host and pack tests put their temp roots under `/private/tmp` on macOS (the system temp folder elsewhere), never under your home, because OpenCode searches upward for `.opencode/` folders. Each stock server gets its own free port.
- The unit tests in `test/unit/time-keep.test.ts` run this platform's real `time-keep`, which `npm run check` builds first.
- The README's default-rules and code tables are generated from the source: run `UPDATE_DOCS=1 npm test` after changing `DEFAULT_ASK` or a failure code, and `test/unit/docs.test.ts` fails while they differ.
- `npm run lint` runs actionlint over `.github/workflows` when it is on `PATH` (set `ACTIONLINT_BIN` for another path) and prints a notice when it is not. CI runs it in its own job.
- The default checks make no network calls to Open-Meteo or GitHub. Live weather runs only with `UTILITIES_LIVE_WEATHER=1`.
- `npm run drift` is a manual check, not part of `npm run check`. It compares the Jelly declaration's tool list with the tools the code registers, prints each difference by name and exits 1 when there is one.

Commit messages use `type(scope): summary`. Keep the README, `docs/configuration.md`, `SECURITY.md` and this file in step with the code. See [AGENTS.md](AGENTS.md) for the design rules.

## Release

### Releasing

Every plugin releases as `v0.0.0`, and it installs from that GitHub tag. The release is one commit on top of a `master`
head that CI passed, and the tag points at it.

1. Set `version` to `0.0.0` in `package.json`, date the `## [0.0.0]` entry in `CHANGELOG.md`, then run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. In a clean checkout of `master` at that commit, run `node scripts/release-commit.mjs --ci-sha <its full sha>`. It builds
   `dist/`, removes the lifecycle scripts, and creates the signed commit and the signed annotated tag `v0.0.0`. It never
   pushes; `--dry-run` shows the change first.
4. Push the tag only: `git push origin v0.0.0`.
5. Approve the run in the `release` environment. The release workflow checks the tag and its commit, installs the tag on
   each stock OpenCode host (2.2.3 to 2.2.6), packs it, and creates the GitHub Release with the notes, the tarball and
   `SHA256SUMS`.

A tag that already exists stops step 3. Delete the old tag and its Release first, then start again.


Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-utilities#v0.0.0`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-utilities#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-utilities#v0.0.0" }] }
```
