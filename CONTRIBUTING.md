# Contributing

## Setup

You need Node.js 24 or later, npm, [Bun](https://bun.sh) 1.4.4 (the Bun inside stock OpenCode 2.2.3, 2.2.4 and 2.2.5) and [Rust](https://rustup.rs) 1.96.0 (`rustup toolchain install 1.96.0`).

```sh
git clone https://github.com/joe-broadhead/opencode-utilities.git
cd opencode-utilities
npm ci --ignore-scripts
npm run check
```

The time and weather programs, the speech engine, the models, their notices and the hash manifests are build outputs, not in git. `npm run check` builds this platform's missing or stale native files first (`npm run native:build` does it explicitly), so the first run takes a while. Set `NATIVE_BUILD_ROOT` to a directory outside the repository to keep Cargo's work between clones.

`npm run build` uses esbuild to write exactly two self-contained files, `dist/index.js` (server) and `dist/tui.js` (TUI, compiled from Solid JSX first). Neither imports a relative file, so an in-place update cannot load a stale sibling; the pack test checks this.

The root `NOTICE` holds the licence of every package bundled into `dist/` (zod). `npm run build` fails when it no longer matches the bundle; run `node scripts/build.mjs --notice` to rewrite it, then commit it. The native notices ship in the platform packages and with the GitHub Release assets; see `licenses/README.md`.

The platform packages under `npm/` are npm workspaces. Their `package.json` files have no `os`, `cpu` or `libc`, so `npm ci` installs on any machine; `scripts/pack.mjs` adds those fields from `PLATFORMS` in `src/domain/contract.ts` when it packs one, and drops the dev-only `workspaces` field from the main package.

To try a checkout in OpenCode, point a `plugins` entry's `package` at the repository directory. The workspace links this machine's platform package, so the plugin finds its programs.

## Checks

`npm run check` runs, in order: the native ensure step, the typecheck of `src` and `test`, the unit tests, the JS build, the host tests on embedded OpenCode 2.2.3, the TUI test, the forbidden-API scan (`npm run lint`) and the pack test, which runs every tested release. The pack test packs the plugin and this platform's package, installs them into an empty project with scripts off, and loads them in each tested stock OpenCode release. The tested releases are one list, `TESTED_HOSTS` in `src/host/versions.ts` (2.2.3, 2.2.4 and 2.2.5); the status, the tests and CI all read it.

- Set `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4` and `OPENCODE_BIN_2_2_5` to stock `opencode` binaries to skip installing them. Unset, the pack test installs each release into its own temp folder, as CI and the release do.
- Host and pack tests put their temp roots under `/private/tmp` on macOS (the system temp folder elsewhere), never under your home, because OpenCode searches upward for `.opencode/` folders. Each stock server gets its own free port.
- The unit tests in `test/unit/time-keep.test.ts` run this platform's real `time-keep`, which `npm run check` builds first.
- The default checks make no network calls to Open-Meteo or GitHub. Live weather runs only with `UTILITIES_LIVE_WEATHER=1`.

Commit messages use `type(scope): summary`. Keep the README, `docs/configuration.md`, `SECURITY.md` and this file in step with the code. See [AGENTS.md](AGENTS.md) for the design rules.

## Releasing

A release is a `vX.Y.Z` tag on `master` whose version equals `package.json`. The `release` environment's reviewers approve the run; then `.github/workflows/release.yml` publishes from CI with npm trusted publishing and provenance:

1. A guard refuses a package marked `private`, a tag that differs from the version, a platform package at another version, and any install or pack script.
2. The four platforms build their native files on hosted runners, and the files are attested.
3. The manifests are regenerated from those bytes, `npm run check` runs, the platform packages and the main package are packed, the pack test runs against those exact tarballs, and they are attested.
4. The four platform packages are published with `npm publish <tarball> --provenance --access public`.
5. The GitHub Release for the tag is published with the speech engines, the models, `utilities-speech-NOTICE.txt` and the model licences. Speech downloads point at it.
6. The main package is published the same way.

Each publish skips a version that is already on npm, so a failed run can be rerun.
