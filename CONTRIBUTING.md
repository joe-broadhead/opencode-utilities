# Contributing

This repository builds `@we-the-rebel-alliance/utilities-plugin`. Read [AGENTS.md](AGENTS.md) first: it holds the design
rules, the forbidden APIs and the check the CI runs. [README.md](README.md) is what users see.

## Setup

```sh
git clone https://github.com/we-the-rebel-alliance/utilities-plugin.git
cd utilities-plugin
npm ci --ignore-scripts
```

Node 24, npm 11 and Bun 1.4 or later. The native tools need the Rust 1.96.0 toolchain from rustup, a C toolchain,
`libclang-dev`, `cmake` and `pkg-config`. `npm run check` builds the native files this machine needs
(`scripts/native-ensure.mjs`) and does nothing when they are current.

The committed speech manifest (`manifest/speech-assets.json`) is written only by
`npm run speech:manifest -- --from <folder of the release files>`; no build or release step writes it.

To try a checkout in OpenCode, point a `plugins` entry's `package` at the repository directory. Until a release has
them, the time and weather tools cannot download their programs in a checkout: copy `build/native/<platform>/<program>`
into the plugin cache (`$XDG_CACHE_HOME/opencode-utilities/native/v<version>/<program>/<platform>/`) to try them.

## Checks

`npm run check` is the one command, and CI runs exactly it:

```sh
npm run check
```

It runs `native:ensure`, the typecheck, the unit tests, the build, the host tests on the tested OpenCode release, the
TUI tests, the lint (forbidden APIs, copied files, icons, workflows) and the pack test. The copied release kit's own
tests (`npm run test:kit`) are not in it while the kit is replaced by the plugin kit. Host and
pack tests bind ports, so run one repository's check at a time. Do not skip, weaken or delete a test to get green.

Smaller loops:

```sh
npx tsc --noEmit
npm test              # unit tests
npm run test:host     # the host suite on the tested release
npm run build
```

## Pull requests

- One change per pull request; conventional commit messages with a `Refs #<issue>` body line.
- Never push to `master`, never merge, never tag or release, never change repository settings.
- Keep `package-lock.json` in step with `package.json`: change dependencies with `npm install`, never by hand.
- Keep the README, `docs/`, `SECURITY.md`, the skills and `CHANGELOG.md` in step with the code. The CHANGELOG starts at
  `## 0.0.0 (unreleased)`.
- No keys, audio, transcripts, personal data or absolute local paths in anything committed.

## Releasing

Releases arrive with the family's plugin kit, and a release commit carries the built `dist/` and the pinned native
manifest. Do not tag, publish or push a release branch by hand.
