# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.0.0 (unreleased)

### Changed

- The repository moves to `we-the-rebel-alliance/utilities-plugin`, the package is
  `@we-the-rebel-alliance/utilities-plugin`, and the version restarts at `0.0.0`.
- OpenCode 2.4.1 only: the `@opencode/*` devDependencies are `2.4.1`, the supported range is `>=2.4.1 <2.5.0`, and the
  plugin is tested on 2.4.1. The test matrix and the code paths for earlier releases are gone.
- The fixed context is within the family budget: the namespace line is at most 400 characters, each skill description at
  most 300, nothing is pinned, and there are no per-request hooks.
- CI is one `ci` job on Node 24 with `permissions: contents: read`, pinned actions and the family runner rule; it runs
  the repository's full check.
- The README and AGENTS.md describe the rebuilt plugin; the full documentation follows with the plugin kit.

### Added

- `utilities_sessions`: past-session status, outcome, cost in USD, tokens and time windows, over OpenCode's public
  session list and get. Stopgap: deleted when OpenCode gives agents a session list or stats tool with these fields.
- `utilities_sessions_grep`: exact text in past sessions' tool calls, their outputs and file touches, read-only over
  OpenCode's SQLite database, with a clean refusal on an unknown schema. Matching is literal, never a regular
  expression; snippets and the answer are capped in bytes. Stopgap: deleted when OpenCode ships exact-text search.
- The `utilities-sessions` skill, and a status row naming each stopgap's deletion criterion.
- The `sessionsDatabasePath` option, for the database `utilities_sessions_grep` reads.

### Removed

- The deprecated RPC ids `utilities.tools` and `utilities.tools.tools`, the note they left in status, and the code that
  kept them answering.
- `docs/jelly.md` and the legacy notes about old app placements. The `jelly` package key stays for the plugin kit to
  replace.
