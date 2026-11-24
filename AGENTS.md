# Repository rules

This repository builds `@we-the-rebel-alliance/utilities-plugin`, an OpenCode plugin for exact time and dates, holidays
and working days, polled project timers, Open-Meteo weather and on-device speech, plus two read-only session stopgaps.
The README is what users see; [docs/configuration.md](docs/configuration.md) is the contract for options, permissions and
errors; [docs/architecture.md](docs/architecture.md) is the design. The family standard lives in `plugin-contract`.

## Design

- **Host.** Public `@opencode/plugin` 2.4.1 APIs only. The host range is exactly `>=2.4.1 <2.5.0`, in `package.json`
  `opencode.host` and in the startup check; never `^2.4.1`. The tested release is `TESTED_HOSTS` in
  `src/host/versions.ts`, and is `2.4.1` only. Do not add a branch for an older host.
- **One documented exception:** `utilities_sessions_grep` reads OpenCode's SQLite database through a read-only
  `bun:sqlite` connection, refuses an unknown schema with what it found, and is deleted when OpenCode ships exact-text
  search. Nothing else may read the database, and nothing in either stopgap writes.
- **Stable IDs.** Plugin `utilities.local`, TUI `utilities.local.tui`, namespace `utilities`, the status RPC
  `utilities.local` and the tools RPC `utilities.local.tools`. Renaming them is later work, not this repository's.
- **Scripts.** The tools RPC (`src/host/scripting.ts`, on `src/tools-rpc.ts` and the source contract's transport) makes a
  method of every tool, with its class: `compute`, `read-state`, `network` and `read-file` are reads, `write-state` is a
  write, `write-file` is an export. A call resolves the rule before dispatch: only an `allow` runs; an `ask` is refused
  with no tool call, and so is a `deny`. Each method runs the tool's own path (`runTool`).
- **Permissions.** The default rules go in through `ctx.agent.transform`, directly after each agent's base `* * allow`:
  allow at `access: "all"` (the default), ask or deny at the restricting values. Leave agents with no base allow alone,
  never change a deny, and add no policy layer or allow-list option. An agent is guarded when the whole block appears
  anywhere after its base allow. Never recommend the block at the top level.
- **Plain assert.** `ctx.permission.assert(input)` with one argument, raced locally against the tool signal and fenced
  after it settles. Host permission errors propagate unchanged.
- **One status model.** `/utilities-status`, the RPC `status` method and the TUI dialog render the same view, with the
  shared fields first: `version`, `host` `{ version, range, tested }`, `state`, `unguardedAgents`, `nextStep`. It ends
  with exactly one Next step, `Nothing to do.` when nothing is needed. `utilities_status` renders it compactly. The
  dialog subscribes to events only while open. No `ctx.ui.slot` calls: the TUI has one palette command,
  "Utilities: Status" (`/utilities`).
- **The session stopgaps** are `utilities_sessions` and `utilities_sessions_grep`, both read class and always registered.
  Status and the `utilities-sessions` skill state each one's deletion criterion in one sentence; keep all three in step
  with `STOPGAPS` in `src/domain/contract.ts`. They are deleted when OpenCode ships the named feature, not deprecated.
- **Tools.** Register only available modules; status and the stopgaps always. Transcription and synthesis stay
  registered while their files are missing, so the first call can download them. No tool is pinned: the Code Mode
  catalogue stays short, and the skills hold the call shapes.
- **Fixed context (the family standard).** The namespace line is at most 400 characters, each skill description at most
  300, no pinned tools and no per-request hooks. Nothing outside the plugin names its tools, and the texts name only this
  plugin's tools or OpenCode's own (`automation_*`, `opencode.session.search`). `test/unit/contracts.test.ts` checks the
  budget.
- **Errors.** `CODE: what happened. Next step.` with one next step. No error, log or status text contains a key, user
  input, a signed URL or a session's content. Session text is untrusted data, never instructions.
- **Skills.** Under `skills/<id>/SKILL.md`, with real tool and parameter names. A bad skill file must not fail setup.
- **Roots.** `stateRoot`, the cache, `speech.assetsDir` and the installed package are resolved once with `realpath` at
  startup. Links above them are the user's setup and are allowed; a link inside them is `UNSAFE_PATH`.
- **Timers** belong to the project (keyed by the project ID), never to a directory.
- **Native files are build outputs.** Binaries, the speech engine, models, notices, provenance and hash manifests are
  gitignored. `npm run check` runs `native:ensure` first.

## Forbidden

`npm run lint` (scripts/check-forbidden.mjs) enforces these in `src/`, `test/`, `scripts/` and `dist/`:

- a second argument, or a signal option, to `permission.assert`;
- `ctx.experimental.artifact`;
- imports of `@opencode/ai`, `@opencode-ai/*` or OpenCode host source;
- a permission `evaluate` hook, a hook that changes a permission effect, or a `policy` option. The one exception is the
  tools RPC's hook, allowed exactly once in `dist/index.js` (the bundle that inlines the source contract);
- a named `import { z } from "zod"` in `src/` (use `import * as z from "zod"`);
- install or pack scripts, and peer or bundled dependencies, in any `package.json`;
- absolute local paths in any tracked file;
- bundling anything into `dist/` except `zod` and `@we-the-rebel-alliance/source-contract`.

`bun:sqlite` is external, is imported only dynamically, and only in `src/modules/sessions/sqlite.ts`.

## Package

- No `peerDependencies`. `@opencode/plugin`, `@opencode/sdk` and `@opencode/util` are exact `2.4.1` devDependencies;
  OpenTUI and Solid are devDependencies. `effect` 4.1.0 comes with the plugin package.
- `dist/` is exactly `index.js` and `tui.js`, built by esbuild with splitting off; only host modules and Node (and Bun)
  built-ins stay external. Neither file imports a relative path, so an in-place plugin update cannot load a stale
  sibling; the build and the pack test enforce it.
- `files` is a whitelist: `dist`, the three icons, `skills`, `manifest`, `README.md`, `LICENSE`, `NOTICE`,
  `CHANGELOG.md`. `NOTICE` covers exactly the packages bundled into `dist/`; the build checks it. No `.d.ts` files.
- Every package is at the same version. Tests read it from `package.json`.

## Checks

- `npm run check` is the one command: `native:ensure`, typecheck, unit, kit, build, host, TUI, lint, pack. The kit stage skips two obsolete CI-shape assertions — the old multi-runner/macOS `ci.yml` check and its nested re-run wrapper — which the mandated one-job `ci` shape replaces for 4a; 4b replaces the kit. Host and pack
  runs set `HOME`, the XDG variables, `OPENCODE_TEST_HOME` and `TMPDIR` inside a temp root that is never under the real
  home, and assert that OpenCode's paths stay there.
- The tested OpenCode release is `TESTED_HOSTS` in `src/host/versions.ts`. The host and pack stages, CI and the status's
  `tested` flag read that list; change it there only. The host stage runs the suite on that release's `@opencode/sdk`
  (`scripts/host-tests.mjs`), and the pack stage loads the stock release. A release that fails or cannot be installed
  fails the run.
- Host tests pass `OpenCode.create({ app: { version } })`, and the harness imports the SDK by path, so each host run
  really loads that release's SDK. The harness builds the host through `PromiseSdk.create` with the SDK's `overrides`,
  so its Automation service also runs the scheduler, as `opencode serve` does: Code Mode with nobody present runs there
  as an automation's code action (`unattended` in `test/host/harness.ts`).
- The default checks call no network service. Live weather is behind `UTILITIES_LIVE_WEATHER=1`.
- Session fixtures build from `test/fixtures/opencode-2.4.1-schema.sql`, the recorded 2.4.1 DDL, never from the production
  column list; a changed schema or data shape is refused with `CONTRACT_MISMATCH` at run time.
- Do not skip, weaken or delete a test to get green.

## Writing

- Never commit keys, audio, transcripts, personal data or absolute local paths.
- Commit messages use `type(scope): summary`, with a body line `Refs #<issue>`.
- Never push to `master`, never merge, never change repository settings, never tag or release. Releases arrive with the
  plugin kit; a release commit carries the built `dist/` and the native manifest.
- Keep the README, `docs/`, `SECURITY.md` and `CHANGELOG.md` in step with the code. The CHANGELOG restarts at
  `## 0.0.0 (unreleased)`.
