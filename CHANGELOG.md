# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `utilities_time_now` returns `machine_timezone`, the IANA time zone of the machine OpenCode runs on, so "what time is it here?" and a timer for "9 tomorrow" need no question first. On a remote server it is the server's zone, not necessarily the user's.

### Fixed

- The errors table in `docs/configuration.md` lists every code the plugin raises; 23 were missing, such as `TIMER_QUOTA`, `SOURCE_CHANGED` and `OPERATION_FAILED`. A test keeps it complete.

- `utilities_speech_transcribe` checks that the file is a WAV it can read before it asks to download the speech files. Before, a file such as an `.m4a` asked for the 105 MB download first and then failed with `WAV_INVALID`. The download is now asked on its own, after any file read prompt.
- `utilities_time_format`, `utilities_time_add` and `utilities_time_between` say that a date-time without `Z` or an offset is read as UTC. Before, nothing said so, and "3 pm my time as a Unix timestamp" came out hours off. Add the offset (`utilities_time_convert` gives it).

### Removed

- `utilities_speech_cleanup`, its tools RPC method `speech_cleanup` and its `jelly` entry. Its fixed English rules did worse than the model rewriting the text itself, which is what to do instead: ask the model to tidy a transcript or dictation. On macOS x64, which has no speech engine, Utilities now has no speech tools and no speech skill.

- The move of timers that 0.0.1 kept per folder. Timer reads and status no longer rename or copy timer stores, so they never write. 0.0.2 and later already moved those timers on first use in each folder; a 0.0.1 store that was never opened since stays on disk, unread, under `projects/` in the state folder.

### Changed

- The next step for agents without the default rules is one fixed sentence, the same in every plugin of this family: "Put the default rules shown by /utilities-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Utilities tools." It is the same in `/utilities-status`, the status RPC's `nextStep`, the `/utilities` dialog and the `utilities_status` tool, which used to say "N agents lack the default ask rules …". The Agents without default rules row still lists the agents.
- `TIMER_EXISTS` tells the model to ask the user before it overwrites the timer with `replace: true`.
- The status RPC's module and platform `availability` no longer lists `HOST_UNTESTED`, which no module ever reported. A host outside the range is still refused with `HOST_UNTESTED` at setup.
- `utilities_speech_transcribe` returns only `text`, `language`, `duration_secs` and `segments` (`start`, `end`, `text`). The engine metadata it used to pass through (`schema_version`, `model`, `provider`, `backend_kind`, `timestamps_reliable`, the cleanup fields, `request_id` and each segment's `timestamp_source`) is gone; it made the tool's schema large and the cleanup fields never applied.
- `utilities_speech_synthesize` takes `voice` as one of the eight voices (Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo; default Luna). An unknown voice now fails with `INPUT_INVALID`, naming them, before any prompt; it used to ask first and then fail in the engine.
- Holiday and business-day `country` is a two-letter code pattern instead of a 100-value list in the schema. An unsupported code still fails with `INPUT_INVALID`, and the message lists the supported codes.
- Tool descriptions teach what the models got wrong: weather tools say to stop when the user declines the network prompt, and never to fetch weather another way; a place name several places share goes to `utilities_weather_geocode` first; for the UK, business days need `region`, because Easter Monday and the August bank holiday are regional; `utilities_speech_transcribe` says which prompt comes when; `utilities_speech_synthesize` says a file without `path` is deleted after 7 days. Speech paths are described as relative to the directory OpenCode runs in, which is how they resolve.
- Next steps for options name "the Utilities plugin options in opencode.json" instead of "the utilities.tools plugin options".
- The three skills are rewritten around the decisions models got wrong. Their descriptions name real requests ("how many working days in March", "will it rain this weekend", "transcribe clip.wav"). They teach: pass `region` for UK working days; stop when the user declines a weather prompt; geocode a shared place name first; make the transcription call and let its prompt ask for the download; tidy dictation without a tool. They link to the scripting guide on GitHub instead of a file the package does not ship.
- `utilities_time_format` no longer takes `output_format: "unix-timestamp"`, which gave the same result as `epoch`. Use `epoch`.

- Scripts: a tools RPC refusal by a deny rule now names the denied action and says to remove or narrow that rule (or add a later allow rule to the session). Before, it gave the same next step as an unanswered ask. The code is still `PERMISSION_DENIED`.

## [0.0.4] - 2026-11-04

### Added

- Jelly shows the plugin's one-line summary and icon. The package declares them in its `jelly` section and ships the icon as `assets/icon.svg`.

## [0.0.3] - 2026-11-04

### Added

- A `jelly` section in `package.json`, which [Jelly](https://heyjelly.ai) reads without loading the plugin:
  - all 25 tools and the speech download, each with its permission, the effect the plugin's default rules give it
    and whether it only reads, so that Jelly's agents, which have no base allow rule for those rules to follow,
    still ask before weather calls, timer changes, speech output and speech downloads;
  - the skill ids, the name Jelly shows on the plugin's card, and the optional Open-Meteo key, with a link to
    Open-Meteo's pricing.

  [docs/jelly.md](https://github.com/joe-broadhead/opencode-utilities/blob/HEAD/docs/jelly.md) explains each part.

## [0.0.2] - 2026-11-04

### Added

- README sections for what to do after `plugin add` (`opencode reload`, then `/utilities-status`) and for updating with `opencode plugin update`. Uninstall now signs out of Open-Meteo first, while the plugin is installed, and names both data folders.

### Changed

- The tools RPC's envelope errors use the wording shared by every plugin in this family. `describe` with any input but `{}` now says `describe takes no input` (before: `Expected never at ["sessionID"]`), and an envelope that is not an object says `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` (before: `Expected an object`).
- The status RPC (`utilities.tools` `status`) has the fields every plugin in this family now shares, with the same names and meanings: `version`, `host` `{ version, range, tested }`, `state`, `unguardedAgents` and `nextStep`. Renamed: `host.found` → `host.version`, `host.required` → `host.range`, `host.availability` → `host.tested`, `permissions.unguardedAgents` → `unguardedAgents`, `permissions.next` → `nextStep`, which is now always present and equals the `Next step` row. New: `state` and `speech.preseeded`. The `utilities_status` tool and the `status` script method follow: `permissions.unguardedAgents` (a count) → `unguardedAgents`, `next` → `nextStep`.
- OpenCode 2.2.5 is a tested host, with 2.2.3 and 2.2.4. Another 2.2 release still runs normally, but status now calls it untested (`2.2.6 (untested; supported range >=2.2.3 <2.3.0)`, `host.tested: false`) instead of tested.
- Status lists an agent without the default rules only when its own rules would run a Utilities side effect without asking. An agent whose rules already ask or deny for every one, such as an agent that ends with `* * ask`, is no longer listed.
- A fresh install's status reads `Next step: Nothing to do.` It used to send every user to the 105 MB speech download, or to the Open-Meteo key. The Speech files row still says how to install the speech files, and missing pre-seeded files still set the next step.
- Timers are per project, as the docs said. Before, each folder of a project had its own timers, so a timer set at the project root was missing in a subfolder. Timers that 0.0.1 kept per folder move into the project's store the first time a timer tool or status runs in that folder: none are lost, a duplicate is kept once, and a different timer whose name is taken is kept as `<name> (2)`. Default synthesis files go to a per-project folder too.
- Business days skip only the holidays a whole country observes. Before, `utilities_time_business_days` with `country: "GB"` also skipped holidays of only one nation, such as Scotland's Summer Bank Holiday, for all of the UK. A new optional `region` parameter (England, Wales, Scotland or Northern Ireland, with `country: "GB"`) counts that nation's holidays too. A count lists the regional holidays it did not skip in `regional_holidays_not_skipped`.
- Holiday lists and checks still show regional holidays, now with `nationwide` and `regions` fields on every holiday, not only the bracket in the name. `utilities_time_holidays` takes `region` too.

### Fixed

- The scripting docs gave the wrong place for `opencode api` calls. They run in the service's default location, your home folder, not the directory you run them in, so a script's timer reads see the home folder's project. `docs/scripting.md` shows how to call a project through the HTTP API with `?location[directory]=`, and that `opencode api` exits 1 when a call fails.
- The README's Speech files section overstated pre-seeding: a file missing from `speech.assetsDir` is taken from the cache when a verified copy is there.
- A symbolic link above the plugin's state, cache or install folder no longer breaks it. On Fedora Atomic and Silverblue (`/home` is a link to `/var/home`), with `stateRoot` or `speech.assetsDir` under macOS `/tmp`, or with a dotfile link to `~/.local` or `~/.cache`, every module failed, and time and weather wrongly reported `INTEGRITY_MISMATCH`. The plugin now resolves its roots once at startup and refuses links only inside its own folders. Such a link is now `UNSAFE_PATH`, never an integrity failure, and status reports it per module.
- A daylight-saving gap or overlap, and a date outside the holiday data, no longer reach the model as a bare `BACKEND_FAILED: The program behind this tool reported an error.` They are now `TIME_NONEXISTENT`, `TIME_AMBIGUOUS` (with both UTC offsets, so the model can ask which one and retry with it), `TIME_OFFSET_MISMATCH`, `HOLIDAY_COVERAGE` and `TIME_OUT_OF_RANGE`, each with its own next step.
- Date-times without seconds, such as `2026-03-29T02:30`, work. The tools accepted them, but the time program rejected them with `BACKEND_FAILED`.
- The weather cache works. Each call ran weather-signal with a cache folder that was deleted afterwards, so every call re-fetched the place and the forecast (two requests against the free tier's 10,000 a day) and every result said `"cache": "miss"`. The cache now lives in `~/.cache/opencode-utilities/weather` (`$XDG_CACHE_HOME`), private to you: a forecast is reused for 30 minutes and a place search for 30 days. Entries older than 31 days are removed at startup.
- A script's refusal names the action that was refused. `speech_transcribe` with the speech files missing said `utilities_speech_transcribe was refused`, though the refused ask was the download, and its next step pointed at the wrong rule. It now says `utilities_speech_transcribe needs utilities_speech_download, which was refused …`, with `Add an allow rule for utilities_speech_download …` as the next step.
- An out-of-range date says which range applies, for example `date: must be from 2000 to 2030, the years the offline holiday data covers`, instead of `date: Invalid input`. Time zone, date and date-time errors name their rule too.

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
