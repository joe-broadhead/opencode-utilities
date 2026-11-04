# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A symbolic link above the plugin's state, cache or install folder no longer breaks it. On Fedora Atomic and Silverblue (`/home` is a link to `/var/home`), with `stateRoot` or `speech.assetsDir` under macOS `/tmp`, or with a dotfile link to `~/.local` or `~/.cache`, every module failed, and time and weather wrongly reported `INTEGRITY_MISMATCH`. The plugin now resolves its roots once at startup and refuses links only inside its own folders. Such a link is now `UNSAFE_PATH`, never an integrity failure, and status reports it per module.
- A daylight-saving gap or overlap, and a date outside the holiday data, no longer reach the model as a bare `BACKEND_FAILED: The program behind this tool reported an error.` They are now `TIME_NONEXISTENT`, `TIME_AMBIGUOUS` (with both UTC offsets, so the model can ask which one and retry with it), `TIME_OFFSET_MISMATCH`, `HOLIDAY_COVERAGE` and `TIME_OUT_OF_RANGE`, each with its own next step.
- Date-times without seconds, such as `2026-03-29T02:30`, work. The tools accepted them, but the time program rejected them with `BACKEND_FAILED`.
- An out-of-range date says which range applies, for example `date: must be from 2000 to 2030, the years the offline holiday data covers`, instead of `date: Invalid input`. Time zone, date and date-time errors name their rule too.

### Changed

- Timers are per project, as the docs said. Before, each folder of a project had its own timers, so a timer set at the project root was missing in a subfolder. Timers that 0.0.1 kept per folder move into the project's store the first time a timer tool or status runs in that folder: none are lost, a duplicate is kept once, and a different timer whose name is taken is kept as `<name> (2)`. Default synthesis files go to a per-project folder too.

- Business days skip only the holidays a whole country observes. Before, `utilities_time_business_days` with `country: "GB"` also skipped holidays of only one nation, such as Scotland's Summer Bank Holiday, for all of the UK. A new optional `region` parameter (England, Wales, Scotland or Northern Ireland, with `country: "GB"`) counts that nation's holidays too. A count lists the regional holidays it did not skip in `regional_holidays_not_skipped`.
- Holiday lists and checks still show regional holidays, now with `nationwide` and `regions` fields on every holiday, not only the bracket in the name. `utilities_time_holidays` takes `region` too.

## [0.0.1] - 2026-11-03

### Added

- The tools RPC, `utilities.tools.tools`: a script can call `status`, the ten time tools, `timer_get`, `timer_list`, `timer_check`, the six weather tools, `speech_cleanup` and `speech_transcribe` with no model, through `opencode api`, as a session and its agent. It gets exactly the access that agent's model has: a tool its rules hide is refused, each call makes the tool's own permission requests, and an ask is refused at once because no one is there to answer it, so weather and the speech download need an allow rule. `timer_set`, `timer_delete` and `speech_synthesize` are never methods. `describe` lists the methods with their schemas and whether each can run here now. `docs/scripting.md` explains it.

## [0.0.0] - 2026-11-01

### Added

- Twenty-five tools under `utilities_<name>`: status, ten time tools, five polled timer tools, six Open-Meteo weather tools, and speech cleanup, transcription and synthesis.
- Time, date, holiday (offline, 2000–2030) and business-day tools. Business days skip a given country's public holidays.
- Project timers that the model checks with `utilities_timer_check`; they never fire on their own.
- Open-Meteo weather with `Weather data by Open-Meteo.com (CC BY 4.0)` on every result, and an optional commercial key: run `/connect` and choose Open-Meteo.
- Speech cleanup with fixed text rules, with no download.
- On-device transcription (Whisper tiny) and synthesis (Kitten TTS). The engine and models download on first use from this repository's GitHub Release after a prompt (`utilities_speech_download`), verified by SHA-256, or are pre-seeded from `speech.assetsDir`. Synthesis writes a WAV file and returns its path.
- Time and weather programs in per-platform optional packages for `darwin-arm64`, `darwin-x64`, `linux-x64-gnu` and `linux-arm64-gnu`.
- Default ask rules for weather, timer changes, synthesis and the speech download, inserted after each agent's base allow rule. Your rules and saved approvals override them.
- `/utilities` status dialog (palette "Utilities: Status"), `/utilities-status`, `/utilities-speech-install`, the `utilities_status` tool and one RPC method, `status`.
- A startup check for OpenCode `>=2.2.3 <2.3.0`, with `allowUntestedHost` to override it.
