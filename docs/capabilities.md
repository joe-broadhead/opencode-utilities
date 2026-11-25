# Capabilities

Every method and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `diagnose` | read | none | — |
| `sessions` | read | none | `sessions.list` |
| `sessions_grep` | read | none | `sessions.database` |
| `time_now` | read | none | `time.local` |
| `time_zones` | read | none | `time.local` |
| `time_zone_info` | read | none | `time.local` |
| `time_convert` | read | none | `time.local` |
| `time_calendar` | read | none | `time.local` |
| `time_add` | read | none | `time.local` |
| `time_between` | read | none | `time.local` |
| `time_format` | read | none | `time.local` |
| `time_holidays` | read | none | `time.local` |
| `time_business_days` | read | none | `time.local` |
| `timer_set` | write | none | `time.timers.write` |
| `timer_get` | read | none | `time.timers.read` |
| `timer_list` | read | none | `time.timers.read` |
| `timer_check` | read | none | `time.timers.read` |
| `timer_delete` | delete | none | `time.timers.delete` |
| `native_install` | admin | none | `native.files` |
| `weather_geocode` | read | none | `weather.geocode` |
| `weather_current` | read | none | `weather.forecast` |
| `weather_daily` | read | none | `weather.forecast` |
| `weather_hourly` | read | none | `weather.forecast` |
| `weather_demand_signal` | read | none | `weather.forecast` |
| `weather_summary` | read | none | `weather.forecast` |
| `speech_transcribe` | read | none | `speech.transcribe` |
| `speech_synthesize` | export | none | `speech.synthesize` |
| `speech_install` | admin | none | `speech.files` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|

### Actions

None.

### Bus events

`rpc.utilities.changed`
<!-- /generated:capabilities -->

## Notes

- **The provider methods** (`time_*`, `timer_*`, `weather_*`, `speech_*`) run a local program after parsing the input
  with the provider's own schema. `time-keep` runs time, date, holiday and timer calls; `weather-signal` runs the
  Open-Meteo calls; the `utilities-speech` bridge runs transcription and synthesis. The time and weather programs are
  installed by `native_install`, the speech engine and models by `speech_install`.
- **`timer_set` is `write` and `timer_delete` is `delete`.** Both change this project's timer store and both emit
  `rpc.utilities.changed` (`utilities.timers`) after the change. `speech_synthesize` is `export`: the WAV leaves the
  plugin, and it emits `changed` for `utilities.speech`.
- **`native_install` and `speech_install` are `admin`.** They download pinned files from this repository's release. A
  read never downloads: it refuses with `NATIVE_FILES_MISSING` or `SPEECH_ASSETS_MISSING` and names the install method.
- **The two session stopgaps are `read`.** `sessions` uses OpenCode's public session list and get; `sessions_grep` opens
  OpenCode's SQLite database read-only, refuses on an unknown schema, masks secrets and caps its answer in bytes.
- **`status` and `diagnose`.** `status` is the contract's own answer (§11). `diagnose` is the detailed one: module
  availability, the weather tier, the speech files, due timers, the access level and each stopgap's deletion criterion.
- **No pinned methods.** Every call shape lives in a skill, so Code Mode sends no signature on every turn.
- **No sources and no actions.** A tools-only plugin declares empty lists; an app has nothing to bind, and the methods
  still work as tools, in Code Mode and over RPC.
