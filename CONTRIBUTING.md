# Contributing

This repository builds `@we-the-rebel-alliance/utilities-plugin`. Read [AGENTS.md](AGENTS.md) first: it holds the design
rules and the layout. [README.md](README.md) is what users see.

## Setup

```sh
git clone https://github.com/we-the-rebel-alliance/utilities-plugin.git
cd utilities-plugin
npm ci --ignore-scripts
```

Node 24 and Bun 1.4 or later. The native part needs the Rust 1.96.0 toolchain from rustup, a C toolchain, `libclang-dev`,
`cmake` and `pkg-config`. `npm run check` builds the native files this machine needs (`scripts/native-ensure.mjs`) and
does nothing when they are current.

The committed speech manifest (`manifest/speech-assets.json`) is written only by
`npm run speech:manifest -- --from <folder of the release files>`; no build or check step writes it.

## Checks

`npm run check` is the one command, and CI runs exactly it:

```sh
npm run check
```

It runs `native:ensure`, the typecheck, the build, the unit tests, the pack test, and `plugin-kit check` (T0, T1 on
OpenCode 2.4.1, the generated docs, the forbidden patterns and the no-bundled-kit check). Host and pack tests read
and write an isolated home, but run one repository's check at a time.

Smaller loops:

```sh
npx tsc --noEmit
npm test
npm run bundle
npm run test:pack
npm run kit:check
```

Do not skip, weaken or delete a test to get green.

## Pull requests

Conventional commits, one topic per pull request, `npx plugin-kit docs` run when the manifest changes. The release is the
owner's step: `npx plugin-kit release 0.0.x` cuts a local tag on `master`, and CI publishes it. The tag is the approval;
there is no `release` environment in the way, so the release bot can publish once the tag exists.

## Release assets

The Release carries the pinned native programs and speech files because `native_install` and `speech_install` download
them from it: `time-keep` and `weather-signal` (gzipped, per platform), the `utilities-speech` engine for each platform,
and the Whisper and Kitten model files. Each one is verified against the SHA-256 pins in `manifest/native.json` and
`manifest/speech-assets.json` before it is staged, and `gh release create` receives every file by its exact manifest
name (`scripts/release-assets.mjs`) — never a directory, `release/*` or a `find` listing. `release/conformance.json`,
`release/SHA256SUMS` and the tarball are named directly as well; `SHA256SUMS` covers the tarball and the report.
