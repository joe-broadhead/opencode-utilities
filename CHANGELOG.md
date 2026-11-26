# Changelog

## 0.0.0 (2026-11-25)

- Utilities for an OpenCode agent, on plugin-contract v0: 29 methods with no accounts, no sources and no actions.
- Exact times and time zones, dates, holidays, working days and project timers through the local `time-keep` program.
- Current, daily, hourly, planning-signal and summary weather through `weather-signal` and Open-Meteo, with the
  attribution every answer carries and an optional commercial key held by the `open-meteo` integration.
- On-device transcription and synthesis through the `utilities-speech` bridge; no audio leaves the machine.
- `native_install` and `speech_install` download the programs and speech files from this repository's release, pinned by
  SHA-256. When the installed package carries no `manifest/native.json`, the plugin fetches the release's `native.json`,
  checks it with the same parser and caches it under the plugin cache keyed by the tag. A read never downloads: with
  files missing it refuses with the install as the next step, so `read-only` stays read-only.
- `status` in the contract's shape and `diagnose` for the detailed state: module availability, the weather tier, the
  speech files and due timers.
- The two session stopgaps, `sessions` and `sessions_grep`: read-only status, spend, tokens and time windows over
  OpenCode's public session API, and exact-text search over OpenCode's SQLite database with masking and byte caps.
- `changed` after every write (`utilities.timers`, `utilities.speech`, `utilities.native`).
- The published JSON schema keeps a property named `format`: `time_now`'s answer includes it, and every zod-backed
  method's published schema is checked against its canonical property names. A real-binary matrix parses every offline
  time and timer answer with the register's own `z.fromJSONSchema` check.
- The real time-keep suite fails in CI when the native build is absent; a local checkout without Rust skips it with an
  explicit reason. CI runs the strict native build first.
- The release workflow attaches only `native.json` and the native programs from the tagged commit's native run. The
  release owner's bot carries the pinned speech engine/model bytes across a re-cut, and `native` runs on every master
  push so the run exists.
- Five skills (`utilities`, `utilities-time`, `utilities-weather`, `utilities-speech`, `utilities-sessions`), read from
  their `SKILL.md` front matter (YAML, including `>` and `|` block descriptions) and registered through
  `ctx.skill.transform` because OpenCode 2.4.1 does not load a plugin package's `skills/` folder itself.
- Generated documentation from the manifest, unit tests, a recorded conformance fixture, real 2.4.1 host tests for the
  skill descriptions, the block-scalar case and the parity test, and a pack test.
