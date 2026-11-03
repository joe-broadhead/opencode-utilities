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
| `stateRoot` | absolute path | `$XDG_DATA_HOME/opencode-utilities`, or `~/.local/share/opencode-utilities` | Timer stores and the default speech output directory. Must be mode `0700`, owned by the user, and not a symbolic link. |
| `speech.assetsDir` | absolute path | unset | Flat pre-seed directory. See [Speech files](#speech-files). |
| `allowUntestedHost` | boolean | `false` | When `true`, an untested OpenCode version loads and status shows `HOST_UNTESTED` with a warning. When `false` or omitted, setup throws. |

Unknown keys are rejected. A relative path is rejected.

`stateRoot` layout:

| Path under `stateRoot` | Contents |
| --- | --- |
| `projects/<scope>/timers` | This project's SQLite timer store. `<scope>` is a hash of the project ID and the location directory. |
| `speech/<scope>/<id>.wav` | Default synthesis files. Removed at startup when older than 7 days. |
| `jobs/job-*` | Per-call scratch. Removed at startup when older than 10 minutes. |

The speech cache is not under `stateRoot`. It is `$XDG_CACHE_HOME/opencode-utilities` (`~/.cache/opencode-utilities` when unset).

## Host check

`package.json` states `"opencode": { "host": ">=2.2.3 <2.3.0" }`. Setup compares `ctx.app.version` with that range.

| Version | Result |
| --- | --- |
| 2.2.3, 2.2.4, 2.2.10 | Load. Tested line. The plugin is tested on 2.2.3 and 2.2.4. |
| 2.2.2, 2.3.0, 3.0.0 | Refused, unless `allowUntestedHost` is `true`. |
| Prerelease, dev build, `unknown` | Untested. Refused, unless `allowUntestedHost` is `true`. |

Do not write the range as `^2.2.3`. That would accept 2.3.

The refusal text is: `HOST_UNTESTED: Utilities is tested on OpenCode >=2.2.3 <2.3.0, found <version>. Next step: Use OpenCode 2.2.3 or a later 2.2.x release, or set the plugin option allowUntestedHost: true to run anyway.`

## Tools

Effective name `utilities_<name>`. `options.permission` is that name, so a deny with resource `*` hides the tool. Code Mode is on. Pinned: `utilities_time_now`, `utilities_time_convert`, `utilities_weather_current`.

Only available modules are registered. Transcription and synthesis stay registered while their files are merely missing, so the first call can ask to download them. A disabled module, an unsupported platform, or a failed integrity check does not register that module's tools. `utilities_speech_cleanup` needs no engine, so it is registered whenever `modules.speech` is on. Availability changes (a finished download, for example) reload the tool list.

| Tool | Effect | Permission |
| --- | --- | --- |
| `utilities_status` | compute | none |
| `utilities_time_now`, `utilities_time_zones`, `utilities_time_zone_info`, `utilities_time_convert`, `utilities_time_calendar`, `utilities_time_add`, `utilities_time_between`, `utilities_time_format`, `utilities_time_holidays`, `utilities_time_business_days` | compute | none |
| `utilities_timer_get`, `utilities_timer_list`, `utilities_timer_check` | read-state | none |
| `utilities_timer_set`, `utilities_timer_delete` | write-state | ask. Resource `timer:<name>`, save `timer:*`. |
| `utilities_weather_geocode`, `utilities_weather_current`, `utilities_weather_daily`, `utilities_weather_hourly`, `utilities_weather_demand_signal`, `utilities_weather_summary` | network | ask. Resource and save are the provider hosts. `metadata.location` is the place or query. |
| `utilities_speech_cleanup` | compute | none. It needs no engine or download. |
| `utilities_speech_transcribe` | read-file | host `read`, and `external_directory` when the file is outside the location and the project |
| `utilities_speech_synthesize` | write-file | ask `utilities_speech_synthesize`. Resource `kitten-nano-int8/<voice>`, save `*`. A given `path` also asserts `edit`, and `external_directory` outside the project. |

`utilities_speech_download` is not a tool. It is the action asserted before a download, by the first transcription or synthesis call that needs files and by `/utilities-speech-install`. Resource and save are the release host (`github.com`). `metadata.bytes` is the total size. `metadata.files` lists the names.

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

Every weather output includes `attribution` with the value `Weather data by Open-Meteo.com (CC BY 4.0)`.

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

OpenCode creates agents that are defined only in user config, and agents added by later plugins, after this plugin's transform. They do not receive the ask rules. Status names them.

Fix: put the block above **first** in that agent's own `permissions`, followed by any `utilities_*` rules you already have in the top-level `permissions`.

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
| `/utilities-status` | Posts the full status into the session: the rows Connection, Account, Access, the modules, Tools, Agents without default rules (names, then the block, one rule per line), OpenCode, and one Next step (`Nothing to do.` when nothing is needed). |
| `/utilities-speech-install` | Asserts `utilities_speech_download`, then downloads missing files. |
| `/utilities` | TUI dialog, palette "Utilities: Status". Reads the `status` RPC method only, when it opens, and on server, agent and Open-Meteo key events, which it hears only while open. Shows the same lines as `/utilities-status`. `r` refreshes, `Esc` closes. The key hint reads `r refresh · esc close`. |
| RPC `status` | The `utilities.tools` RPC's only method. Returns the same status object. The TUI imports its contract from its own bundle; the package does not export it. |
| RPC `utilities.tools.tools` | The tools RPC for scripts: `describe`, plus one method per tool that changes nothing, run as a session and its agent. Asks are refused, not prompted. Timer writes and synthesis are not methods. See [scripting.md](scripting.md). |

Status fields: host check (`required`, `found`, `availability`, optional `next`), platform package, per-module availability, weather tier and key, speech file states (`missing`, `cached` or `pre-seeded`), voices, cache directory, output directory, due timer count, ask-by-default actions, and agents that did not receive the ask rules.

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

A tool failure is `Tool.Error` with `message` set to `CODE: what happened. Next step: What to do.` and `metadata.code` plus `metadata.hint`. Host permission errors propagate unchanged and have no plugin code.

| Code | Next step |
| --- | --- |
| `OPTIONS_INVALID` | Fix the named option. |
| `STATUS_UNAVAILABLE` | Run `/utilities-status` in a session to see the error, or check the OpenCode server log. |
| `SKILLS_INVALID` | A skill file is missing or malformed; setup skips it with this warning. Reinstall the plugin. |
| `HOST_UNTESTED` | Use a tested 2.2.x release, or set `allowUntestedHost`. |
| `DISABLED` | Set `modules.<name>` to `true`. |
| `PLATFORM_PACKAGE_MISSING` | Reinstall so the platform package is present, or run `npm run native:build` in a checkout. |
| `UNSUPPORTED_PLATFORM` | No build for this platform. Time and weather are unaffected when only speech lacks an engine. |
| `BINARY_MISSING`, `INTEGRITY_MISMATCH` | Reinstall. For speech, delete the cache and run `/utilities-speech-install`. |
| `SPEECH_ASSETS_MISSING` | Approve the download, run `/utilities-speech-install`, or pre-seed. |
| `DOWNLOAD_FAILED` | Check the network and retry, or pre-seed. |
| `TIMER_EXISTS` | `utilities_timer_set` with `replace: true`. |
| `TIMER_NOT_FOUND` | `utilities_timer_list`. |
| `TIMER_STATE_UNKNOWN` | Read the timer before retrying. The change may or may not have been saved. |
| `WEATHER_KEY_REJECTED` | Reconnect, or log out for the free tier. |
| `SOURCE_REJECTED` | A regular `.wav` file, not a symbolic link, at most 20 MiB. |
| `WAV_INVALID`, `WAV_UNSUPPORTED` | Convert to 16-bit PCM WAV. The hint includes an `ffmpeg` example. |
| `OUTPUT_EXISTS` | Choose another path, or delete the file. The output is created exclusively. |
| `QUEUE_FULL` | Wait, then retry. Each module has its own queue. |
