# Contributing

This repository builds `@we-the-rebel-alliance/utilities-plugin`. Read [AGENTS.md](AGENTS.md) first: it holds the design
rules and the layout. [README.md](README.md) is what users see.

## Setup

```sh
git clone https://github.com/we-the-rebel-alliance/utilities-plugin.git
cd utilities-plugin
npm ci --ignore-scripts
```

Node 24 and Bun 1.4 or later. The full native gate needs the Rust 1.96.0 toolchain from rustup, a C toolchain,
`libclang-dev`, `cmake` and `pkg-config`; install them and run `npm run native:ensure` once, then `npm run check`. A clean
clone without them still runs `npm run check`: `native:ensure:optional` prints a `NATIVE_FILES_MISSING` notice and
continues, and the tests that need the real programs skip with that reason. CI (and the release job) installs the same
prerequisites and runs the strict `npm run native:ensure` first, so nothing skips there.

The committed speech manifest (`manifest/speech-assets.json`) is written only by
`npm run speech:manifest -- --from <folder of the release files>`; no build or check step writes it.

## Checks

`npm run check` is the one command, and CI runs exactly it:

```sh
npm run check
```

It runs `native:ensure:optional` (the strict `native:ensure` when the toolchain is there), the typecheck, the build,
the unit tests, the pack test, `plugin-kit record --check` (the redacted conformance fixture is current) and
`plugin-kit check` (T0, T1 on OpenCode 2.4.1, the generated docs, the forbidden patterns and the no-bundled-kit check).
Host and pack tests read and write an isolated home, but run one repository's check at a time.

Smaller loops:

```sh
npx tsc --noEmit
npm test
npm run bundle
npm run test:pack
npm run kit:check
```

Do not skip, weaken or delete a test to get green. The only skip is automatic when the native build is absent; CI and the release always build it.

## Pull requests

Conventional commits, one topic per pull request, `npx plugin-kit docs` run when the manifest changes. The release is the
owner's step: `npx plugin-kit release 0.0.x` cuts a local tag on `master`, and CI publishes it. The tag is the approval;
there is no `release` environment in the way, so the release bot can publish once the tag exists.

## Release assets

The Release carries the native programs and the manifest that pins them. `native_install` downloads `time-keep` and
`weather-signal` from it. A tag installed with `github:we-the-rebel-alliance/utilities-plugin#v<version>` has no
`manifest/native.json` in its tree, so `readNativeManifest` also fetches the release's `native.json`, checks it with the
same parser and caches it under `<cacheRoot>/native/<tag>/native.json`. A 404, an offline fetch or invalid JSON is a
clean `NATIVE_FILES_MISSING`/`CONTRACT_MISMATCH` refusal with the install next step.

The `native` workflow runs on every push to master (and manually), so the tagged commit has a native run. The release job
finds that successful run, downloads its `native-manifest` artifact, checks it names this tag, repository and commit,
attaches it as `release/native.json`, and stages the native programs from that run's artifacts, verified against the
SHA-256 pins in `manifest/native.json`. A tag whose commit has no successful native run attaches only the tarball,
`release/conformance.json` and `release/SHA256SUMS`.

Speech files are not attached by the release workflow. The release owner's bot carries the pinned `utilities-speech`
engines and model files across a re-cut, verified against `manifest/speech-assets.json`; the native run still builds and
attests them for its own checks, but the release job ignores those artifacts. `scripts/release-assets.mjs` names only the
native and manifest files. `gh release create` receives `release/*.tgz`, `release/conformance.json`,
`release/SHA256SUMS` and, when the native run exists, `release/native.json` plus every native file by its exact manifest
name — never a directory, `release/*` or a `find` listing. `SHA256SUMS` covers the tarball and the report.
