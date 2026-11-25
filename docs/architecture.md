# Architecture

## Layers

| Layer | Files | Does |
|---|---|---|
| Entry | `src/index.ts` | `assertHost`, load the options, create the provider, one `register` call, register the skills, dispose everything |
| Skills | `src/skills.ts` | reads every `skills/<name>/SKILL.md`, parses the front matter as YAML, checks it, and registers each skill through `ctx.skill.transform` |
| Handlers | `src/handlers/` | one file per method: its description, its input and output schemas, and its work |
| Provider | `src/provider/` | the only code that runs a program, calls Open-Meteo, reads OpenCode's database or downloads a release file |
| Domain | `src/domain/` | shared types, the error table and options validation |

`src/handlers/` never touches tools, RPC, permissions or the bus directly: `register` wires every door, and a handler
reads `call.bus` only to emit `changed`. Every provider endpoint is named in `src/provider/` and only there: the
Open-Meteo hosts are in `provider/modules/weather/argv.ts` and the release URL in `provider/process/install.ts`. The
program names (`time-keep`, `weather-signal`, `utilities-speech`) also sit in the native distribution table in
`src/domain/contract.ts`, because the native build scripts read that table too.

## Skills

The package ships five skills (`skills/utilities`, `-time`, `-weather`, `-speech`, `-sessions`). OpenCode 2.4.1 does not
scan an installed plugin package's `skills/` folder: its skill roots are the config and agent directories, and
`ctx.skill.transform` is the only loader a plugin has. `readSkills` reads every directory under `skills/` before
anything registers, parses each `SKILL.md` front matter with the `yaml` package, and checks the name, the description
and the body. YAML block scalars (`>`, `|`, `>-`, `|-`) therefore register their folded or literal text, never the
marker; a plain description containing `': '` must be quoted, because YAML is strict. A missing or malformed file fails
setup with `SCHEMA_VIOLATION` before a partial registration exists. `registerSkills` then adds every checked skill in
`ctx.skill.transform` and returns its disposer, which setup disposes on unload. The contract has no skill wiring and the
manifest has no skills key, so this is the plugin's own code.

## The provider client

`createProvider` builds the runtime once per plugin instance:

- **The runtime** (`provider/runtime.ts`) parses the input with the module's zod schema, checks availability, admits the
  call to a per-module queue, starts the module's deadline, stages a private job directory, runs the program and removes
  the job. A timer write that fails after the program started is `TIMER_STATE_UNKNOWN`, never a retryable failure.
- **The programs** (`provider/backends.ts`) are read from `manifest/native.json` when the installed package has one;
  otherwise `readNativeManifest` fetches `native.json` from this version's release, checks it with the same parser, and
  caches it under `<cacheRoot>/native/<release tag>/native.json`. The programs are cached under
  `<cacheRoot>/native/<release tag>/<module>/<platform>/<name>`, and verified against their pinned SHA-256 before every
  run. A linked or non-executable file is refused; a changed one is not the program.
- **The speech files** (`provider/speech-assets/`) are read from `manifest/speech-assets.json`, cached under
  `<cacheRoot>/<sha256>/<name>`, and verified the same way. `speech.assetsDir` makes them pre-seeded: nothing is
  downloaded.
- **The weather key** (`provider/weather.ts`) is the `open-meteo` OpenCode integration. It is resolved at call time and
  passed in `OPEN_METEO_API_KEY`; the provider marks it rejected after a 401/403 and clears that after a success.
- **The session sources** (`provider/modules/sessions/`) bind `ctx.session.list`/`get` and a read-only SQLite
  connection. The connection is the documented exception to public APIs only (standard §4 rule 1): `readonly: true`,
  only a schema check and `SELECT`s, a clean `CONTRACT_MISMATCH` on an unknown schema, and masking before anything is
  returned.

## What is cached

| Cache | Keeps | For |
|---|---|---|
| `<stateRoot>/projects/<hash>/timers` | this project's timers | until deleted |
| `<stateRoot>/speech/<hash>/*.wav` | default synthesised WAVs | 7 days (swept at setup) |
| `<cacheRoot>/native/...` | the verified programs | until the release changes |
| `<cacheRoot>/<sha256>/...` | the verified speech files | until deleted |
| `<cacheRoot>/weather/weather-signal` | Open-Meteo responses | 30 minutes (forecast), 30 days (places); swept at 31 days |
| `<stateRoot>/jobs/job-*` | a call's staging | removed when the call ends; a crash leaves one, swept at 10 minutes |

## OpenCode APIs

Only the public `@opencode/plugin` 2.4.1 context: `ctx.app.version`, `ctx.options`, `ctx.location`, `ctx.session.list`
and `ctx.session.get`, `ctx.integration` (the `open-meteo` connection), `ctx.skill.transform` for the skills, and what
`register` uses (`agent`, `tool`, `rpc`, `permission`). The bundle keeps `@opencode/plugin` external and inlines everything else, so a hot reload cannot mix a
new entry with an old sibling module.

## Errors

`src/domain/common.ts` holds the provider's codes and their one-line messages and next steps. `src/handlers/refusal.ts`
maps each to the closest contract code (`INPUT_INVALID`, `TOO_LARGE`, `OPTIONS_INVALID`, otherwise `UNAVAILABLE`) and
keeps the provider's code at the front of the sentence, so the agent sees both. A `RegisterError` and any other error
pass through untouched.
