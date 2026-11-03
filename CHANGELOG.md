# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
