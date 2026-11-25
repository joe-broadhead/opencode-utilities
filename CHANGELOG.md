# Changelog

## 0.0.0 (2026-11-25)

- Utilities for an OpenCode agent, on plugin-contract v0: 29 methods with no accounts, no sources and no actions.
- Exact times and time zones, dates, holidays, working days and project timers through the local `time-keep` program.
- Current, daily, hourly, planning-signal and summary weather through `weather-signal` and Open-Meteo, with the
  attribution every answer carries and an optional commercial key held by the `open-meteo` integration.
- On-device transcription and synthesis through the `utilities-speech` bridge; no audio leaves the machine.
- `native_install` and `speech_install` download the programs and speech files from this repository's release, pinned by
  SHA-256. A read never downloads: with files missing it refuses with the install as the next step, so `read-only` stays
  read-only.
- `status` in the contract's shape and `diagnose` for the detailed state: module availability, the weather tier, the
  speech files and due timers.
- The two session stopgaps, `sessions` and `sessions_grep`: read-only status, spend, tokens and time windows over
  OpenCode's public session API, and exact-text search over OpenCode's SQLite database with masking and byte caps.
- `changed` after every write (`utilities.timers`, `utilities.speech`, `utilities.native`).
- Five skills (`utilities`, `utilities-time`, `utilities-weather`, `utilities-speech`, `utilities-sessions`), registered
  through `ctx.skill.transform` because OpenCode 2.4.1 does not load a plugin package's `skills/` folder itself.
- Generated documentation from the manifest, unit tests, a recorded conformance fixture, real 2.4.1 host tests for the
  skills and the parity with v0.0.7, and a pack test.

### Removed since v0.0.7

- The `/utilities` TUI dialog (id `utilities.local.tui`): the status dialog is optional in the plugin standard, and the
  status is on RPC now. `diagnose` is the detailed view for an agent.
- The `/utilities-status` command: its job is `status` (the contract's own answer) and `diagnose`, reachable as a tool,
  in Code Mode, over RPC and from automations.
- The `/utilities-install` command: its job is `native_install`, which an agent, a script or an automation can call.
- The `/utilities-speech-install` command: its job is `speech_install`, with the same reach.
- The `utilities.local` and `utilities.local.tools` RPC ids: renamed to `utilities` (one RPC id for every method, as
  contract §3 requires), not removed. The deprecated `utilities.tools` alias from v0.0.7 is gone with the contract-1
  compatibility paths.
