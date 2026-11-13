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

The time and weather programs are built with `npm run native:build` into `build/native/<platform>/`, which is gitignored. `scripts/native-files.mjs` writes `manifest/native.json` from those files. `manifest/speech-assets.json` is committed, pinned to the seven speech files at v0.0.0 (`test/unit/speech-manifest.test.ts`). Only the maintainer command `npm run speech:manifest -- --from <folder>` writes it, from a folder of the release files; build, pack and release never run it. The release files are attached to the Release after the release run, checked against that manifest.

To try a checkout in OpenCode, point a `plugins` entry's `package` at the repository directory. Until a release has them, the time and weather tools cannot download their programs in a checkout: copy `build/native/<platform>/<program>` into the plugin cache (`$XDG_CACHE_HOME/opencode-utilities/native/v<version>/<program>/<platform>/`) to try them.

## Checks

`npm run check` runs, in order: the native ensure step, the typecheck of `src` and `test`, the unit tests, the JS build, the host tests on the embedded `@opencode/sdk` for each tested release (`scripts/host-tests.mjs`; `HOST_SDK_DIR` runs one), the TUI test, the forbidden-API scan (`npm run lint`) and the pack test, which runs every tested release. The pack test packs the plugin and this platform's package, installs them into an empty project with scripts off, and loads them in each tested stock OpenCode release. The tested releases are one list, `TESTED_HOSTS` in `src/host/versions.ts` (2.2.3, 2.2.4, 2.2.5 and 2.2.6); the status, the tests and CI all read it.

- The pack test needs no program and no `build/native`: it checks the tarball, and that status reports each program as not installed, with its next step. The tool runs that need a program are in the host tests, which `npm run check` runs after `native:ensure`.
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

Each release is the GitHub tag `v<version>`, where `<version>` is the `version` in `package.json`, and users install from
that tag. The release is one commit on top of a `master` head that CI passed, and the tag points at it. The release
workflow makes both, in GitHub Actions: nobody builds, commits or tags a release on their own machine, and no personal
key signs it.

While changes land, their notes go under `## [Unreleased]` at the top of `CHANGELOG.md`. Each earlier GitHub release is
a `## [x.y.z] - YYYY-MM-DD` heading below it, newest first, and the npm history stays last, under
`## Earlier releases on npm`.

1. On `master`, set `version` in `package.json` to the new version, and change every install spec in the README,
   `CONTRIBUTING.md` and `docs/` to `#v<version>` (`test/docs.test.ts` fails until they match). Then run
   `node scripts/changelog.mjs release`: it turns `## [Unreleased]` into `## [<version>] - <today>`, above the earlier
   releases, and refuses a CHANGELOG it cannot shape. Run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. Run the `native` workflow on that commit (`gh workflow run native.yml --ref master`), and wait for it to pass. It
   builds the release files for `v<version>`.
4. Start the release with that commit's full sha and the native run's id:
   `gh workflow run release.yml --ref master -f sha=<full sha> -f native_run=<native run id>`, or from Actions → release →
   Run workflow, on `master`.
5. Read the run's summary, then approve the `release` environment. The summary is on the run page, under the `stage`
   job: the tag, the parent and its CI run, the release commit and its tree, the sha256 of `SHA256SUMS` and the staged
   artifact's id, `SHA256SUMS` itself, and the notes. Open the release commit on `release/v<version>` and read them
   before approving: the approval releases exactly those bytes. Only the owner approves a release. Agents never approve
   one, never call the deployment-approval API, and never bypass a ruleset or the environment; the kit's scripts make
   only their own GitHub calls and refuse every other.
6. Check the published Release: not a draft, its notes, and every asset against `SHA256SUMS`.

Before the approval, the workflow:
- **plans:** refuses a run that is not on `master`, a sha that is not `master`'s head, a sha without a successful `ci.yml`
  push run, a version that is not `x.y.z`, a CHANGELOG whose newest release is not this version, a release that does not
  move forward from the last published Release, a leftover `release/v<version>` branch, a native run that did not build
  this sha on `master`, by hand, with success, and a missing `native_run` (or one given to a plugin that is not native);
- **builds** `dist/` with `npm ci --ignore-scripts` and `npm run build`, with a read-only token, and writes the release
  files: `dist/`, `package.json` without its lifecycle scripts, and the vetted native manifest;
- **commits** them on a temporary branch `release/v<version>` at the parent, through GitHub's API with the workflow's token,
  so GitHub signs the commit (author `github-actions[bot]`, committer GitHub). This job runs no npm. It refuses a commit
  that GitHub does not verify, or whose parent or tree is not the one the files give;
- **verifies** on a fresh runner: the commit's identity, one parent on `master`, `package.json` exactly the parent's
  without the lifecycle scripts, only regular files in the allowed paths, no `package.json` under `dist/`, and a second,
  independent build of the parent (its own job) equal to the committed `dist/` byte for byte;
- **installs** the release commit with `plugin add` on each stock OpenCode host (2.2.3 to 2.2.6);
- **packs** the commit before installing anything and keeps that tarball, then runs the pack stage against a copy;
- **stages** the Release: verifies the attested native files, writes `SHA256SUMS` and the notes (the version's CHANGELOG
  section), and shows them all in the run summary with the sha256 of `SHA256SUMS`.

A job either runs repository or dependency code (`npm ci`, the build, the pack stage, a host install) and has no write
token, or uses the API and runs only the kit's scripts on a fresh checkout, after checking that the release commit's
`scripts/` and `.github/` are the parent's. The first kind is not token-free: `actions/checkout` fetches with the job's
read-only (`contents: read`) token, and its post step and the artifact uploads run after repository code on the same
runner, so that code could reach a read-only token for this public repository and the runner's artifact token. Jobs
pass files as artifacts downloaded by the id the uploading job gave, and each is checked again on arrival.

After the approval, it downloads the staged artifact by the id the summary names, and refuses unless `SHA256SUMS` has
the sha256 the summary shows and every staged file matches it, and every native file is the one the release commit's
`manifest/native.json` pins, size and sha256, with each gzip holding the pinned executable. Then it checks everything again, creates the annotated tag
`v<version>` on the release commit (tagger `github-actions[bot]`, unsigned), checks the tag, creates the Release with the
notes, the tarball, the native files and `SHA256SUMS`, and deletes `release/v<version>`. The tag keeps the commit.

GitHub's signature and the bot identity show only that GitHub made the commit through its API for the workflow; anyone
with write access can make such a commit. What ties the release to `master` is its content: one parent CI passed, the
exact `package.json`, the allowed paths and the byte-for-byte rebuild. Never relax those because the commit is signed.

**A rejected, expired or failed run** leaves nothing behind: the `cleanup` job deletes `release/v<version>` when it points
at the parent or at that run's commit, and never touches another branch. No tag exists before the approval, so the
version is not burned: fix `master` and start again. If `cleanup` itself failed, the next run refuses until the branch
is deleted: `gh api -X DELETE repos/joe-broadhead/opencode-utilities/git/refs/heads/release/v<version>`.

**Resume.** If the run fails after creating the tag and before the Release is complete, start it again with the same `sha`
and `native_run`. The plan finds the kit's tag on a release commit on that sha with no published Release, and resumes:
it makes no new commit, checks and installs the tagged commit, stages the files, and after a new approval reuses the tag
and adds what the Release lacks. Delete a draft Release a failed upload left first: the publish step refuses a draft.
Any other existing tag is refused: release the next version.

The repository's tag ruleset keeps a `v*` tag from being moved or deleted. A stray `v*` tag, one that never became a
Release, does not block later releases: only published Releases count, and drafts do not. Its version cannot be
released, so release the next one. To remove the tag anyway, an admin disables the `release tags` ruleset, deletes the
tag, and restores the ruleset exactly as it was.

**Known limit: a `v*` tag pushed by hand.** No ruleset limits who creates a `v*` tag, so anyone with write access can
push one by hand, pointing at any commit. Such a tag has no published Release, the forward-only check ignores it, and
Jelly installs only a published Release whose `SHA256SUMS` it verifies. But a user who installs
`github:joe-broadhead/opencode-utilities#v<x>` directly gets whatever that tag points at. Only the release workflow makes
release tags; never push one by hand.

The release kit is these files, the same in every plugin: `scripts/release-rules.mjs`, `scripts/release-commit.mjs`,
`scripts/release-github.mjs`, `scripts/check-release-shape.mjs`, `scripts/changelog.mjs`, `scripts/release-version.mjs`,
`scripts/release-pack.mjs`, `scripts/publish-release.mjs`, `scripts/attach-native.mjs`, `scripts/native-manifest.mjs`,
`scripts/tested-hosts.mjs`, `scripts/check-release-plugin-add.sh`, `scripts/release-kit.test.mjs` and
`.github/workflows/release.yml`. Do not re-run the older `apply-release-kit.mjs`: it writes back the kit that could
release only `v0.0.0`.

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-utilities#v<old version>`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-utilities#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-utilities#v0.0.2" }] }
```
