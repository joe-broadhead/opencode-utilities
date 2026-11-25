# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0]

The first release on plugin-contract v0.

### Added

- The `capabilities` manifest: 29 methods, no accounts, no sources, no actions, and one bus event (`changed`). The
  namespace line, the methods' classes, their operations and the options are all declared there, and `plugin-kit docs`
  generates the tables.
- `status` in the contract's shape and `diagnose`: module availability, the Open-Meteo tier and key, the speech files and
  voices, due timers, the access level and each stopgap's deletion criterion.
- `native_install` and `speech_install`: the time and weather programs and the speech engine and models are downloaded
  from this repository's release, pinned by SHA-256. A read that needs them refuses with the install as its next step,
  so `read-only` never downloads.
- `changed` after every write: `utilities.timers` for a timer write, `utilities.speech` for synthesis and a speech
  install, `utilities.native` for a program install.
- The five skills are registered on the host through `ctx.skill.transform`, because OpenCode 2.4.1 does not load a
  plugin package's `skills/` folder itself. A missing or malformed skill is skipped and reported in status.

### Changed

- The plugin id, tool namespace and RPC id are `utilities` (they were `utilities.local`, `utilities.local.tui` and
  `utilities.local.tools`). Every method is reachable as a tool, in Code Mode and over RPC through one `register` call.
- Doors, access rules, accounts resolution, input and output checks, the bus and the error mapping come from
  `@we-the-rebel-alliance/plugin-contract`; the plugin keeps only its provider, its handlers and its options.
- `status` is the contract's own answer; the previous detailed status is now `diagnose`.
- Time and weather no longer download on first use; `native_install` does, explicitly.

### Removed

- The legacy app declaration key, the `opencode` key and the old `sources` key: everything an app needs is in
  `capabilities`.
- The copied release, drift, copies, icons, forbidden, tested-hosts and changelog scripts, `check-copies.mjs`, the
  family block note, and the tools RPC transport and its `describe` method. `plugin-kit` replaced them.
- The TUI status dialog: the contract's status is on RPC and `diagnose` is the text view. `/utilities-status`,
  `/utilities-install` and `/utilities-speech-install` are gone; the methods replaced them.
- Contract-1 code, permission shims, compatibility aliases and dead code.
