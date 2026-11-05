# Configuration

Plugin ID: `utilities.tools`. Options live on the `plugins` entry in `opencode.json`. An invalid option fails setup with `OPTIONS_INVALID` and names every offending key. Values are not echoed.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "@joe-broadhead/opencode-utilities",
    "options": {
      "modules": { "weather": true, "time": true, "speech": true },
      "stateRoot": "<absolute path>",
      "speech": { "assetsDir": "<absolute path>" },
      "allowUntestedHost": false
    }
  }]
}
```

There is no `policy` option and no `allowActions` option. Permissions are OpenCode rules, described below.

## Options

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `modules.weather` | boolean | `true` | When `false`, weather tools are not registered. |
| `modules.time` | boolean | `true` | When `false`, time and timer tools are not registered. |
| `modules.speech` | boolean | `true` | When `false`, speech tools are not registered and `/utilities-speech-install` refuses. |
| `stateRoot` | absolute path | `$XDG_DATA_HOME/opencode-utilities`, or `~/.local/share/opencode-utilities` | Timer stores and the default speech output directory. Must be mode `0700` and owned by the user. See [Symbolic links](#symbolic-links). |
| `speech.assetsDir` | absolute path | unset | Flat pre-seed directory. See [Speech files](#speech-files). |
| `allowUntestedHost` | boolean | `false` | When `true`, an OpenCode version outside `>=2.2.3 <2.3.0` loads, and status shows `host untested` with a warning. When `false` or omitted, setup throws for such a version. |

Unknown keys are rejected. A relative path is rejected.

`stateRoot` layout:

| Path under `stateRoot` | Contents |
| --- | --- |
| `projects/<scope>/timers` | This project's SQLite timer store. `<scope>` is a hash of OpenCode's project ID, so every folder of a project shares one store. |
| `speech/<scope>/<id>.wav` | This project's default synthesis files. Removed at startup when older than 7 days. |
| `jobs/job-*` | Per-call scratch. Removed at startup when older than 10 minutes. |

Timers are per project: a timer set at the project root is the same timer in every subfolder. OpenCode's project is the git repository; a folder outside any repository belongs to OpenCode's shared `global` project.

The caches are not under `stateRoot`. They are under `$XDG_CACHE_HOME/opencode-utilities` (`~/.cache/opencode-utilities` when unset):

| Path under the cache | Contents |
| --- | --- |
| `<sha256>/<name>` | Speech engine and model files. |
| `weather/weather-signal/<hash>.json` | Open-Meteo responses, one file per request URL, mode `0600` in a `0700` folder. A forecast is reused for 30 minutes and a place search for 30 days, so repeated calls cost no extra requests. Files older than 31 days are removed at startup. |

### Symbolic links

At startup the plugin resolves each of its roots once with `realpath`: `stateRoot`, the speech cache, `speech.assetsDir`, the installed package and its platform package. A link above a root, or the root itself, is fine. Examples are macOS `/tmp` (a link to `/private/tmp`), Fedora Atomic and Silverblue `/home` (a link to `/var/home`), and a dotfile setup that links `~/.local` or `~/.cache`. Status shows the resolved paths.

Inside those roots, the plugin refuses every symbolic link: a timer store, a job folder, a cached or pre-seeded speech file, a program. The error is `UNSAFE_PATH`, never `INTEGRITY_MISMATCH`.

## Host check

`package.json` states `"opencode": { "host": ">=2.2.3 <2.3.0" }`. Setup compares `ctx.app.version` with that range.

| Version | Result |
| --- | --- |
| 2.2.3, 2.2.4, 2.2.5 | Load. These are the tested releases: status shows `tested`, and the status RPC `host.tested` is `true`. |
| 2.2.6 or a later 2.2 release | Load normally, untested. The OpenCode row shows `untested; supported range >=2.2.3 <2.3.0` and `host.tested` is `false`; `state` and the next step are unchanged. |
| 2.2.2, 2.3.0, 3.0.0, a prerelease, a dev build, `unknown` | Refused: setup fails, so there is no status. With `allowUntestedHost: true` the plugin loads, and the next step is a warning. |

Do not write the range as `^2.2.3`. That would accept 2.3.

The refusal text is: `HOST_UNTESTED: Utilities supports OpenCode >=2.2.3 <2.3.0, found <version>. Next step: Use OpenCode 2.2.3, 2.2.4 or 2.2.5, or set the plugin option allowUntestedHost: true to run anyway.`

## Tools

Effective name `utilities_<name>`. `options.permission` is that name, so a deny with resource `*` hides the tool. Code Mode is on. Pinned: `utilities_time_now`, `utilities_time_convert`, `utilities_weather_current`.

Only available modules are registered. Transcription and synthesis stay registered while their files are merely missing, so the first call can ask to download them. A disabled module, an unsupported platform, or a failed integrity check does not register that module's tools. Availability changes (a finished download, for example) reload the tool list.

| Tool | Effect | Permission |
| --- | --- | --- |
| `utilities_status` | compute | none |
| `utilities_time_now`, `utilities_time_zones`, `utilities_time_zone_info`, `utilities_time_convert`, `utilities_time_calendar`, `utilities_time_add`, `utilities_time_between`, `utilities_time_format`, `utilities_time_holidays`, `utilities_time_business_days` | compute | none |
| `utilities_timer_get`, `utilities_timer_list`, `utilities_timer_check` | read-state | none |
| `utilities_timer_set`, `utilities_timer_delete` | write-state | ask. Resource `timer:<name>`, save `timer:*`. |
| `utilities_weather_geocode`, `utilities_weather_current`, `utilities_weather_daily`, `utilities_weather_hourly`, `utilities_weather_demand_signal`, `utilities_weather_summary` | network | ask. Resource and save are the provider hosts. `metadata.location` is the place or query. |
| `utilities_speech_transcribe` | read-file | host `read`, and `external_directory` when the file is outside the location and the project |
| `utilities_speech_synthesize` | write-file | ask `utilities_speech_synthesize`. Resource `kitten-nano-int8/<voice>`, save `*`. A given `path` also asserts `edit`, and `external_directory` outside the project. |

`utilities_speech_download` is not a tool. It is the action asserted before a download, by the first transcription or synthesis call that needs files and by `/utilities-speech-install`. Resource and save are the release host (`github.com`). `metadata.bytes` is the total size. `metadata.files` lists the names.

### Holidays and regions

Holiday data is offline, from the `holidays` crate, and covers 2000–2030. Some rows are regional. In the UK (`GB`), a row may apply to only England, Wales, Scotland or Northern Ireland, which the data marks in the name, as in `Summer Bank Holiday [Scotland]`. The Isle of Man (`IM`) data repeats those UK rows. No other country in the data has regional rows; a bracket there holds an English name, as in `Año nuevo [New Year's Day]`.

- Every holiday in a result has `nationwide` (boolean) and `regions` (the nations, empty when nationwide). A row that joins a regional and a nationwide holiday on one date is nationwide.
- `utilities_time_holidays` lists and checks every holiday, regional ones included. With `region`, it keeps only that nation's holidays and the nationwide ones, and `check` answers `is_holiday: false` for another nation's holiday.
- `utilities_time_business_days` skips weekends (Saturday and Sunday) and, with `country`, the nationwide holidays. With `region`, it also skips that nation's own. A count lists the regional weekday holidays it did not skip in `regional_holidays_not_skipped`.
- `region` is only valid with `country: "GB"`. It takes `England`, `Wales`, `Scotland` or `Northern Ireland`.

### File resources

A path is resolved against the location directory. `~` is expanded.

- Inside the location directory, or inside the project directory (the git worktree root) when that directory is not the filesystem root: the `read` or `edit` resource is relative to the location. A file in a parent of the location but still in the project is a resource such as `../audio/in.wav`. `external_directory` is not asserted.
- Outside both: `external_directory` is asserted first, resource `<parent>/*`, saved as `<repository root of that parent, or the parent>/*`. Then `read` or `edit` is asserted on the absolute path.

The transcription source is identified before the prompt. It must be a regular file of at most 20 MiB, not a symbolic link. A file swapped while the prompt is open is refused. WAV ancillary chunks are accepted. The format is PCM16, one or two channels, 8–48 kHz, at most ten minutes.

### Weather sign-in

Integration ID `open-meteo`, method `key`, label "Open-Meteo commercial API key".

- No connection: free tier, non-commercial, rate-limited. Hosts `api.open-meteo.com` and `geocoding-api.open-meteo.com`.
- Connected key: commercial tier. Hosts `customer-api.open-meteo.com` and `customer-geocoding-api.open-meteo.com`. The key is the child environment variable `OPEN_METEO_API_KEY`, never an argument.
- Adding a key: run `/connect` and choose Open-Meteo; in the TUI, press `o` or Enter on it, then paste the key. On the CLI, `opencode auth login open-meteo` prompts for the key.
- Rejected key: `/connect` shows Open-Meteo as "Sign in required", and status says so. Next step: run `/connect` and choose Open-Meteo, then enter a valid key, or run `opencode auth logout open-meteo` to return to the free tier.

There is no `env` method.

Every weather output includes `attribution` with the value `Weather data by Open-Meteo.com (CC BY 4.0)`, and `cache`: `miss` for a fresh request, `hit` when the response came from the weather cache (see `stateRoot` layout above). The cache is shared by every project of this user. A connected key is never stored in it; requests with a key are cached apart from free-tier ones.

## Permissions

Default ask rules are inserted by `ctx.agent.transform`, immediately after each agent's base `{ "action": "*", "resource": "*", "effect": "allow" }`. This is the only mechanism. User rules and saved approvals win because they are evaluated later. A deny that comes later, including Plan's, is not weakened.

```jsonc
[
  { "action": "utilities_weather_*", "resource": "*", "effect": "ask" },
  { "action": "utilities_timer_set", "resource": "*", "effect": "ask" },
  { "action": "utilities_timer_delete", "resource": "*", "effect": "ask" },
  { "action": "utilities_speech_synthesize", "resource": "*", "effect": "ask" },
  { "action": "utilities_speech_download", "resource": "*", "effect": "ask" }
]
```

Every rule needs `"resource"`. Without it, OpenCode skips the rule.

### Allow and deny

Top-level `permissions` apply to every agent. OpenCode adds them after the agent's built-in rules and this plugin's ask rules, and before the agent's own `permissions` from your config. The last matching rule wins. An allow there skips the prompt for Build, and it also allows the action for Plan and Explore, whose restrictions are built in. Put an allow on one agent when a stricter agent must stay strict.

```jsonc
{
  "permissions": [
    { "action": "utilities_weather_*", "resource": "*", "effect": "allow" },
    { "action": "utilities_timer_set", "resource": "timer:*", "effect": "allow" },
    { "action": "utilities_timer_delete", "resource": "timer:*", "effect": "allow" },
    { "action": "utilities_speech_synthesize", "resource": "*", "effect": "allow" },
    { "action": "utilities_speech_download", "resource": "github.com", "effect": "allow" }
  ]
}
```

`utilities_timer_*` and `utilities_speech_*` also match, as in the README. A deny hides the tools:

```jsonc
{ "action": "utilities_speech_*", "resource": "*", "effect": "deny" }
```

A saved "Always allow" is project-wide. It applies to every agent in that project, Plan included. A directory with no git commit can belong to OpenCode's shared `global` project, so an approval saved there applies in every such directory. See [SECURITY.md](../SECURITY.md).

### Agents without the inserted rules

OpenCode creates agents that are defined only in user config, and agents added by later plugins, after this plugin's transform. They do not receive the ask rules. Status names such an agent only when its own rules would run a Utilities side effect (weather, a timer change, synthesis or the download) without asking: the last rule that matches is an allow. An agent whose rules ask or deny for all of them, such as one ending in `{ "action": "*", "resource": "*", "effect": "ask" }`, needs no fix and is not listed.

Status's next step is: Put the default rules shown by /utilities-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Utilities tools. That is, the block above goes **first** in that agent's own `permissions`, followed by any `utilities_*` rules you already have in the top-level `permissions`.

```jsonc
{
  "agents": {
    "reviewer": {
      "permissions": [
        { "action": "utilities_weather_*", "resource": "*", "effect": "ask" },
        { "action": "utilities_timer_set", "resource": "*", "effect": "ask" },
        { "action": "utilities_timer_delete", "resource": "*", "effect": "ask" },
        { "action": "utilities_speech_synthesize", "resource": "*", "effect": "ask" },
        { "action": "utilities_speech_download", "resource": "*", "effect": "ask" },
        { "action": "utilities_weather_*", "resource": "*", "effect": "allow" }
      ]
    }
  }
}
```

The last rule in that example is one you already had at the top level, repeated so it still wins for this agent. Omit it if you have no such rule.

Do not put the ask block in the top-level `permissions`. That would loosen Explore.

For a Markdown agent, the same array goes in the `permissions` front matter.

### Non-interactive runs

`opencode run` auto-rejects a prompt. Stderr:

```text
permission requested: utilities_weather_current (api.open-meteo.com, geocoding-api.open-meteo.com); auto-rejecting
```

The model is told: "This non-interactive run cannot ask the user for permission, so the request was rejected. Continue without this action."

`--auto` approves asks and does not override a deny. Allow rules, as above, skip the prompt. Pre-seed speech files in CI so the job does not need a download.

## Speech files

Manifest: `manifest/speech-assets.json`, generated by `npm run native:build`. It is a build output, not a committed file. Each entry has `name`, `url`, `sha256` and `bytes`. URLs are `https://github.com/joe-broadhead/opencode-utilities/releases/download/v<version>/<name>`.

| Role | Name | Needed by |
| --- | --- | --- |
| engine | `utilities-speech-<platform>` | transcription, synthesis |
| `tiny-q5_1` | `ggml-tiny-q5_1.bin` | transcription |
| `kitten-model` | `kitten_tts_nano_v0_8.onnx` | synthesis |
| `kitten-voices` | `kitten_tts_nano_v0_8-voices.npz` | synthesis |
| `kitten-config` | `kitten_tts_nano_v0_8-config.json` | synthesis |

About 105 MB in total. The engine must be executable. macOS x64 has no engine. Voices: Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo. Default voice: Luna.

Cache path: `$XDG_CACHE_HOME/opencode-utilities/<sha256>/<name>`. Delete that `opencode-utilities` directory to remove the cache. Uninstalling the plugin does not.

Pre-seed layout, all directly in `speech.assetsDir`:

```text
<assetsDir>/utilities-speech-darwin-arm64
<assetsDir>/ggml-tiny-q5_1.bin
<assetsDir>/kitten_tts_nano_v0_8.onnx
<assetsDir>/kitten_tts_nano_v0_8-voices.npz
<assetsDir>/kitten_tts_nano_v0_8-config.json
```

Use the engine name for the platform you run on. A hash mismatch or a missing file is `SPEECH_ASSETS_MISSING`. Pre-seed never falls back to a download.

## Commands, RPC and TUI

| Surface | What it does |
| --- | --- |
| `utilities_status` | Returns the status object, with the agents without default rules as a count and one next step. Compute. Does not ask. |
| `/utilities-status` | Posts the full status into the session: the rows Connection, Account, Access, the modules, Skills, Tools, Agents without default rules (names, then the block, one rule per line), OpenCode, and one Next step (`Nothing to do.` when nothing is needed). |
| `/utilities-speech-install` | Asserts `utilities_speech_download`, then downloads missing files. |
| `/utilities` | TUI dialog, palette "Utilities: Status". Reads the `status` RPC method only, when it opens, and on server, agent and Open-Meteo key events, which it hears only while open. Shows the same lines as `/utilities-status`. `r` refreshes, `Esc` closes. The key hint reads `r refresh · esc close`. |
| RPC `status` | The `utilities.tools` RPC's only method. Returns the same status object. The TUI imports its contract from its own bundle; the package does not export it. |
| RPC `utilities.tools.tools` | The tools RPC for scripts: `describe`, plus one method per tool that changes nothing, run as a session and its agent. Asks are refused, not prompted. Timer writes and synthesis are not methods. See [scripting.md](scripting.md). |

The status RPC starts with the fields every one of these plugins shares:

| Field | Meaning |
| --- | --- |
| `version` | The plugin's version. |
| `host` | `{ version, range, tested }`: OpenCode's version, the supported range `>=2.2.3 <2.3.0`, and whether the version is a tested release (2.2.3, 2.2.4, 2.2.5). `next` is added only for a version outside the range that runs because of `allowUntestedHost`. |
| `state` | `ready`; `failed` when every module that is on failed; `disabled` when every module is off. Utilities has no status-only mode, so the shared `host_untested` never occurs: an untested host shows only in `host.tested` and the OpenCode row. |
| `unguardedAgents` | The agents without the default rules whose own rules would run a Utilities side effect without asking. Always present; `[]` when none. |
| `nextStep` | Exactly the `Next step` row; `Nothing to do.` when nothing is needed. Missing speech files that download on first use, and the free weather tier, never set it. |

Then Utilities' own: the platform package, per-module availability, the weather tier and key, speech file states (`missing`, `cached` or `pre-seeded`), voices, whether files are pre-seeded, the cache and output directories, the due timer count and the timer store, `shadowedSkills` (each `{ name, path }`: a skill with one of the plugin's skill ids, such as one in `.opencode/skills/utilities-time/`, that OpenCode loads instead of the plugin's own; `[]` when none), and the ask-by-default actions. An item's own `next` is its own next step. The `utilities_status` tool has the same fields, with `unguardedAgents` as a count. For those agents, `nextStep` is: Put the default rules shown by /utilities-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Utilities tools.

## Bounds

| Limit | Value |
| --- | --- |
| Tool input / structured output | 32 KiB / 64 KiB |
| Native stdout / stderr | 1 MiB / 64 KiB |
| Deadline, after approval | time 10 s, weather 45 s, speech 120 s |
| Queue waiting | time 32, weather 16, speech 4 |
| Concurrent calls | time 4, weather 2, speech 1 |
| Timer store | 1,000 records. Name 128 characters. Description 2 KiB. 16 tags. |
| Holiday data | 2000–2030, offline |
| Calendar dates | 1900–2100 |
| Business-day window | at most 366 days |
| Speech text | 5,000 characters |
| Transcription | PCM16 WAV, 8–48 kHz, mono or stereo, 20 MiB, ten minutes. Ancillary chunks accepted. Not a symbolic link. |
| Synthesis WAV | at most 50 MiB. Default files older than 7 days are removed at startup. |

`DEADLINE_EXCEEDED` is distinct from `CANCELLED`. The deadline does not include time spent waiting for permission.

## Errors

A tool failure is `Tool.Error` with `message` set to `CODE: what happened. Next step: What to do.` and `metadata.code` plus `metadata.hint`. Host permission errors propagate unchanged and have no plugin code. Every code the plugin raises is in this table, and a unit test checks that both lists match.

| Code | Next step |
| --- | --- |
| `OPTIONS_INVALID` | Fix the named option in the Utilities plugin options in `opencode.json`. |
| `STATUS_UNAVAILABLE` | Run `/utilities-status` in a session to see the error, or check the OpenCode server log. |
| `SKILLS_INVALID` | A skill file is missing or malformed; setup skips it with this warning. Reinstall the plugin. |
| `HOST_UNTESTED` | OpenCode is outside `>=2.2.3 <2.3.0`. Use 2.2.3, 2.2.4 or 2.2.5, or set `allowUntestedHost`. |
| `DISABLED` | Set `modules.<name>` to `true`. |
| `CLOSED` | The plugin is shutting down. Retry after OpenCode has reloaded it. |
| `PLATFORM_PACKAGE_MISSING` | Reinstall so the platform package is present, or run `npm run native:build` in a checkout. |
| `UNSUPPORTED_PLATFORM` | No build for this platform. Time and weather are unaffected when only speech lacks an engine. |
| `BINARY_MISSING`, `INTEGRITY_MISMATCH` | Reinstall. For speech, delete the cache and run `/utilities-speech-install`. |
| `CONTRACT_MISMATCH` | The plugin's files, or a program's output, do not match this version. Reinstall; if it persists, report it with the `utilities_status` output. |
| `SPEECH_ASSETS_MISSING` | Approve the download, run `/utilities-speech-install`, or pre-seed. |
| `DOWNLOAD_FAILED` | Check the network and retry, or pre-seed. |
| `INPUT_INVALID` | Correct the named field. The message names the rule, such as the 2000–2030 holiday range, never the value. |
| `INPUT_LIMIT`, `OUTPUT_LIMIT` | The input is over 32 KiB, or the result over 64 KiB. Send less, or narrow the request (fewer days, hours or results). |
| `QUEUE_FULL` | Wait, then retry. Each module has its own queue. |
| `CANCELLED` | The call was cancelled. Call the tool again if you still need the result. |
| `DEADLINE_EXCEEDED` | The call ran past its time limit (see [Bounds](#bounds)). Retry, or narrow the request. |
| `SPAWN_FAILED` | The program behind the tool could not start. Call `utilities_status`; reinstall if a module is unavailable. |
| `BACKEND_FAILED` | A program reported another error. For weather the message says which: no such place, the rate limit, or a failed request. |
| `BACKEND_JSON_INVALID`, `STDOUT_LIMIT`, `STDERR_LIMIT` | The program's output was unreadable or too large. Narrow the request and retry; if it persists, reinstall. |
| `TIME_NONEXISTENT` | The local time is skipped by a daylight-saving change in `from_timezone`. Use a time outside the change, or add the UTC offset the user means. |
| `TIME_AMBIGUOUS` | The local time happens twice at a daylight-saving change. The message gives both UTC offsets and instants. Add the offset the user means, or ask which one. |
| `TIME_OFFSET_MISMATCH` | The `datetime` has an offset that `from_timezone` does not use at that moment. Remove it, or use the zone's own. |
| `HOLIDAY_COVERAGE` | The call needs holiday data outside 2000–2030, for example the next business day after 2030-12-31. Use dates in range, or leave out `country` to count weekends only. |
| `TIME_OUT_OF_RANGE` | The result is outside what the time engine supports. Use a smaller amount or a nearer date. |
| `TIMER_EXISTS` | Ask the user whether to overwrite it; then `utilities_timer_set` with `replace: true`, or another name. |
| `TIMER_NOT_FOUND` | `utilities_timer_list`. |
| `TIMER_QUOTA`, `TIMER_BYTE_QUOTA` | The project has 1,000 timers, or its store is full. Delete timers, or use shorter descriptions and tags. |
| `TIMER_STATE_UNKNOWN` | Read the timer before retrying. The change may or may not have been saved. |
| `STATE_FILE_UNSAFE` | A timer store file is a link or not a regular file. Remove it from the project's timer directory. |
| `WEATHER_KEY_REJECTED` | Reconnect, or log out for the free tier. |
| `SOURCE_REJECTED` | A regular `.wav` file, not a symbolic link, at most 20 MiB. |
| `SOURCE_CHANGED` | The audio file changed while the call waited for approval. Call the tool again. |
| `WAV_INVALID`, `WAV_UNSUPPORTED` | Convert to 16-bit PCM WAV. The hint includes an `ffmpeg` example. |
| `AUDIO_DURATION_LIMIT` | The audio is over ten minutes. Split it into shorter files. |
| `SPEECH_FAILED` | The speech engine failed; the message names the engine's code. Retry; if it persists, call `utilities_status`. |
| `BRIDGE_CORRELATION`, `OUTPUT_PATH_MISMATCH` | The speech engine answered another request, or wrote somewhere unexpected. Retry; if it persists, delete the speech cache and run `/utilities-speech-install`. |
| `OUTPUT_EXISTS` | Choose another path, or delete the file. The output is created exclusively. |
| `UNSAFE_PATH` | A file or folder inside the plugin's own directories is a symbolic link, or not the expected type. Replace the link with the real file or folder, or reinstall. Links above those directories are fine. See [Symbolic links](#symbolic-links). |
| `STATE_NOT_PRIVATE` | Run `chmod 700` on the `stateRoot` directory. |
| `FILE_REJECTED`, `FILE_CHANGED` | A file the plugin reads (its manifests or programs) is not a regular file, too large, or changed while being read. Retry; if it persists, reinstall. |
| `UNSAFE_CLEANUP`, `CLEANUP_FAILED` | The plugin refused to delete a path outside its own folders, or could not remove its temporary files. Retry; leftovers go at the next start. Report `UNSAFE_CLEANUP` with the `utilities_status` output. |
| `OPERATION_FAILED` | The tool failed unexpectedly. Retry; if it persists, call `utilities_status`. |
