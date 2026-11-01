# Repository rules

This repository builds `@joe-broadhead/opencode-utilities`, an unofficial OpenCode plugin for time, polled timers, Open-Meteo weather and on-device speech. The README is what users see. [docs/configuration.md](docs/configuration.md) is the contract for options, permissions and errors. [docs/architecture.md](docs/architecture.md) is the design. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks and the release.

## Design

- **Host.** Public `@opencode/plugin` APIs only. The host range is exactly `>=2.2.3 <2.3.0`, in `package.json` `opencode.host` and in the startup check; never `^2.2.3`.
- **Stable IDs.** Plugin `utilities.tools`, TUI `utilities.tools.tui`, namespace `utilities`.
- **Permissions.** Default ask rules go in through `ctx.agent.transform`, directly after each agent's base `* * allow`. Leave agents with no base allow alone, never change a deny, and add no policy layer or allow-list option. An agent is guarded when the whole block appears anywhere after its base allow, because other plugins insert at the same index. Agents without the block are named with the fix: the block **first** in that agent's own `permissions`, followed by the user's top-level `utilities_*` rules. Never recommend the block at the top level.
- **Plain assert.** `ctx.permission.assert(input)` with one argument, raced locally against the tool signal and fenced after it settles. Host permission errors propagate unchanged.
- **One status model.** `/utilities-status`, the RPC `status` method and the TUI dialog render the same view with the S9 rows (Connection, Account, Access, the modules, Tools, Agents without default rules, OpenCode) and exactly one `Next step` line, `Nothing to do.` when nothing is needed. Status text is plain text. The dialog subscribes to events only while open. `utilities_status` renders it compactly, with the unguarded agents as a count. No `ctx.ui.slot` calls: the TUI has one palette command, "Utilities: Status" (`/utilities`), and its dialog.
- **Tools.** Register only available modules. Transcription and synthesis stay registered while their files are missing, so the first call can ask to download them. `speech_cleanup` is TypeScript and needs no engine. `pinned: true` only on `utilities_time_now`, `utilities_time_convert` and `utilities_weather_current`.
- **Errors.** `CODE: what happened. Next step.` with one next step. No error, log or status text contains a key, user input or a signed URL.
- **Skills.** At most three, under `skills/<id>/SKILL.md`, with real tool and parameter names. A bad skill file must not fail setup.
- **Native files are build outputs.** Binaries, the speech engine, models, notices, provenance and hash manifests are gitignored. `npm run check` runs `native:ensure` first.

## Forbidden

`npm run lint` (scripts/check-forbidden.mjs) enforces these in `src/`, `test/`, `scripts/` and `dist/`:

- a second argument, or a signal option, to `permission.assert`;
- `ctx.experimental.artifact`;
- imports of `@opencode/ai`, `@opencode-ai/*` or OpenCode host source;
- a permission `evaluate` hook, a hook that changes a permission effect, or a `policy` option;
- a named `import { z } from "zod"` in `src/` (use `import * as z from "zod"`);
- install or pack scripts, and peer or bundled dependencies, in any `package.json`;
- absolute local paths in any tracked file;
- bundling anything into `dist/` except `zod`.

## Package

- Only the `release.yml` guard checks `"private"`; no test or script asserts it. CONTRIBUTING's Releasing section describes the release.
- No `peerDependencies`. `@opencode/plugin` is an exact `2.2.3` devDependency; OpenTUI and Solid are devDependencies.
- `dist/` is exactly `index.js` and `tui.js`, built by esbuild with splitting off. The RPC contract is plain JSON Schema, never zod, so `tui.js` has no zod; zod stays in the server bundle for tool schemas. Neither file imports, dynamically imports or requires a relative path, so an in-place plugin update cannot load a stale sibling; the build and the pack test enforce it.
- `files` is a whitelist: `dist`, `skills`, `manifest`, `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`. `NOTICE` covers exactly the packages bundled into `dist/`; the build checks it. No `.d.ts` files. `exports` lists only `.` and `./tui`; the TUI imports the RPC contract from its own bundle. Licence texts ship with what they cover (see `licenses/README.md`).
- Every package is at the same version. Tests read it from `package.json`.

## Checks

- `npm run check` is the one command. Host and pack runs set `HOME`, the XDG variables, `OPENCODE_TEST_HOME` and `TMPDIR` inside the temp root, and assert that OpenCode's paths stay there.
- Host tests pass `OpenCode.create({ app: { version } })`. Test doubles are narrow `Pick` types that typecheck against 2.2.3 and 2.2.4.
- The default checks call no network service. Live weather is behind `UTILITIES_LIVE_WEATHER=1`.
- Do not skip, weaken or delete a test to get green.

## Writing

- Never commit keys, audio, transcripts, personal data or absolute local paths.
- Commit messages use `type(scope): summary`, with a body line `Refs #<issue>`.
- Keep the README, `docs/configuration.md`, `SECURITY.md`, `CONTRIBUTING.md` and `CHANGELOG.md` in step with the code.
