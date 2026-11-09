# Repository rules

This repository builds `@joe-broadhead/opencode-utilities`, an unofficial OpenCode plugin for time, polled timers, Open-Meteo weather and on-device speech. The README is what users see. [docs/configuration.md](docs/configuration.md) is the contract for options, permissions and errors. [docs/architecture.md](docs/architecture.md) is the design. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks and the release.

## Design

- **Host.** Public `@opencode/plugin` APIs only. The host range is exactly `>=2.2.3 <2.3.0`, in `package.json` `opencode.host` and in the startup check; never `^2.2.3`.
- **Stable IDs.** Plugin `utilities.local`, TUI `utilities.local.tui`, namespace `utilities`, the status RPC `utilities.local` and the tools RPC `utilities.local.tools`.
- **Scripts.** The tools RPC (`src/host/scripting.ts`, on the shared `src/host/tools-rpc.ts`) makes a method of every tool, with its class: `compute`, `read-state`, `network` and `read-file` are reads, `write-state` is a write, `write-file` is an export. A call resolves the rule before dispatch: only an `allow` runs; an `ask` is refused with no tool call, and so is a `deny`. Each method runs the tool's own path (`runTool`), checks its own input, and keeps `available()` in step with the model's tool list.
- `src/host/tools-rpc.ts` is a copy of a module shared by several plugins: change only its block between the `PLUGIN-SPECIFIC` markers here, and the rest in the shared copy first.
- **Permissions.** Default ask rules go in through `ctx.agent.transform`, directly after each agent's base `* * allow`. Leave agents with no base allow alone, never change a deny, and add no policy layer or allow-list option. An agent is guarded when the whole block appears anywhere after its base allow, because other plugins insert at the same index. Agents without the block are named with the fix only when their own rules would run one of the block's actions without asking (the last matching rule is an allow): the block **first** in that agent's own `permissions`, followed by the user's top-level `utilities_*` rules. Never recommend the block at the top level.
- **Plain assert.** `ctx.permission.assert(input)` with one argument, raced locally against the tool signal and fenced after it settles. Host permission errors propagate unchanged.
- **One status model.** `/utilities-status`, the RPC `status` method and the TUI dialog render the same view. Its shared fields come first, with the names every plugin uses: `version`, `host` `{ version, range, tested }`, `state`, `unguardedAgents` and `nextStep`. The view has the S9 rows (Connection, Account, Access, the modules, Tools, Agents without default rules, OpenCode) and exactly one `Next step` line, `Nothing to do.` when nothing is needed. Status text is plain text. The dialog subscribes to events only while open. `utilities_status` renders it compactly, with the unguarded agents as a count. No `ctx.ui.slot` calls: the TUI has one palette command, "Utilities: Status" (`/utilities`), and its dialog.
- **Tools.** Register only available modules. Transcription and synthesis stay registered while their files are missing, so the first call can ask to download them. No tool is pinned: the Code Mode catalogue stays short, and the skills hold the call shapes.
- **Errors.** `CODE: what happened. Next step.` with one next step. No error, log or status text contains a key, user input or a signed URL.
- **Skills.** At most three, under `skills/<id>/SKILL.md`, with real tool and parameter names. A bad skill file must not fail setup.
- **Roots.** `stateRoot`, the cache, `speech.assetsDir` and the installed and platform packages are resolved once with `realpath` at startup. Links above them are the user's setup and are allowed; a link inside them is `UNSAFE_PATH`.
- **Timers** belong to the project (keyed by the project ID), never to a directory.
- **Native files are build outputs.** Binaries, the speech engine, models, notices, provenance and hash manifests are gitignored. `npm run check` runs `native:ensure` first.

## Forbidden

`npm run lint` (scripts/check-forbidden.mjs) enforces these in `src/`, `test/`, `scripts/` and `dist/`:

- a second argument, or a signal option, to `permission.assert`;
- `ctx.experimental.artifact`;
- imports of `@opencode/ai`, `@opencode-ai/*` or OpenCode host source;
- a permission `evaluate` hook, a hook that changes a permission effect, or a `policy` option. The one exception is the tools RPC's hook in `src/host/tools-rpc.ts`, allowed exactly once there and once in `dist/index.js`: it turns an `ask` on one of the RPC's own script calls in flight into a deny, because no one can answer it, and touches nothing else;
- a named `import { z } from "zod"` in `src/` (use `import * as z from "zod"`);
- install or pack scripts, and peer or bundled dependencies, in any `package.json`;
- absolute local paths in any tracked file;
- bundling anything into `dist/` except `zod`.

## Package

- Only the `release.yml` guard checks `"private"`; no test or script asserts it. CONTRIBUTING's Releasing section describes the release.
- No `peerDependencies`. `@opencode/plugin` is an exact `2.2.3` devDependency; OpenTUI and Solid are devDependencies.
- `dist/` is exactly `index.js` and `tui.js`, built by esbuild with splitting off. The RPC contract is plain JSON Schema, never zod, so `tui.js` has no zod; zod stays in the server bundle for tool schemas. Neither file imports, dynamically imports or requires a relative path, so an in-place plugin update cannot load a stale sibling; the build and the pack test enforce it.
- `files` is a whitelist: `dist`, the three icons Jelly and OpenCode read (`assets/icon.svg`, `assets/icon-128.png`, `assets/icon-256.png`), `skills`, `manifest`, `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`. The icons follow the family icon contract: `scripts/check-icons.mjs` is the kit's file, copied verbatim, and `npm run lint` runs it. `NOTICE` covers exactly the packages bundled into `dist/`; the build checks it. No `.d.ts` files. `exports` lists only `.` and `./tui`; the TUI imports the RPC contract from its own bundle. Licence texts ship with what they cover (see `licenses/README.md`).
- Every package is at the same version. Tests read it from `package.json`.

## Checks

- `npm run check` is the one command. Host and pack runs set `HOME`, the XDG variables, `OPENCODE_TEST_HOME` and `TMPDIR` inside a temp root that is never under the real home, and assert that OpenCode's paths stay there.
- The tested OpenCode releases are `TESTED_HOSTS` in `src/host/versions.ts`. The host, pack and stock stages, CI and the status's `tested` flag read that list; change it there only. The host stage runs the suite on each release's `@opencode/sdk` (`scripts/host-tests.mjs`, which installs the others into `/tmp` and sets `HOST_SDK_DIR`), and the pack stage loads each stock release. A release that fails or cannot be installed fails the run, so a subset is never a green run.
- Host tests pass `OpenCode.create({ app: { version } })`. Test doubles are narrow `Pick` types that typecheck against 2.2.3 and 2.2.4.
- The default checks call no network service. Live weather is behind `UTILITIES_LIVE_WEATHER=1`.
- Do not skip, weaken or delete a test to get green.

## Writing

- Never commit keys, audio, transcripts, personal data or absolute local paths.
- Commit messages use `type(scope): summary`, with a body line `Refs #<issue>`.
- No personal email in anything we publish. Every commit, tag and package is authored and committed as
  `joe-broadhead <91376460+joe-broadhead@users.noreply.github.com>`. Before committing or tagging, check that
  `git config user.email` is that address: a fresh clone inherits the machine's global identity, which is not that
  address. Never commit, tag or publish with a work or personal address, or with a local hostname.
- Keep the README, `docs/configuration.md`, `SECURITY.md`, `CONTRIBUTING.md` and `CHANGELOG.md` in step with the code.
