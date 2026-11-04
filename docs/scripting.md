# Scripting

Unofficial plugin. Not affiliated with OpenCode or Open-Meteo.

A script can call Utilities' tools with no model: a cron job, a shell script, or any program that can reach the OpenCode server. It uses the tools RPC, `utilities.tools.tools` (the plugin id `utilities.tools`, plus `.tools`), through `opencode api` or an OpenCode client.

| Methods | The tools |
| --- | --- |
| `status` | `utilities_status`: the compact status, with the unguarded agents as a count |
| `time_now`, `time_zones`, `time_zone_info`, `time_convert`, `time_calendar`, `time_add`, `time_between`, `time_format`, `time_holidays`, `time_business_days` | the ten time tools |
| `timer_get`, `timer_list`, `timer_check` | the timer reads |
| `weather_geocode`, `weather_current`, `weather_daily`, `weather_hourly`, `weather_demand_signal`, `weather_summary` | the six weather tools |
| `speech_cleanup`, `speech_transcribe` | text cleanup and transcription |
| `describe` | none: lists the methods, their permission actions, whether each can run here now, and each tool's input and output as JSON Schema |

Each method runs the tool's own path, with the same input, the same checks and the same permission requests as the tool the model calls. Only the tools that change nothing are methods: `timer_set`, `timer_delete` and `speech_synthesize` are never methods, even with an allow rule.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the access its model would have:

- A tool that the agent's rules or the session's rules hide from the model is refused. OpenCode hides a tool when the last rule that matches its permission name, such as `utilities_time_now`, on resource `*` is a `deny`.
- The tool then asks for what it needs, as it does for the model: weather asks for `utilities_weather_<tool>` on the Open-Meteo hosts, transcription asks for `read` (and `external_directory` outside the project), and the first speech call asks for `utilities_speech_download`. OpenCode checks each request against the agent's rules, the session's rules, then saved approvals.
- No one answers a prompt for a script, so an `ask` is refused with `PERMISSION_DENIED` at once, and no prompt is left waiting. The default rules ask for weather and the speech download, so a script needs an allow rule for those. Time, timer reads, status and speech cleanup ask for nothing.

Create the session once, with the agent the script runs as, and keep its id:

```sh
opencode api post /api/session -d '{"title":"morning check","agent":"build"}'
```

Session rules come after the agent's, so a session can open or narrow what its script may do. This one may call `weather_current` and `weather_daily`, and nothing else from Utilities that asks:

```sh
opencode api post /api/session -d '{"title":"morning check","agent":"build","permissions":[
  {"action":"utilities_weather_current","resource":"*","effect":"allow"},
  {"action":"utilities_weather_daily","resource":"*","effect":"allow"}
]}'
```

For transcription, run `/utilities-speech-install` once first, or allow `utilities_speech_download` for the session; otherwise the first call is refused.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other key is allowed:

```sh
opencode api post /api/rpc/utilities.tools.tools/time_now -d '{"input":{
  "sessionID":"ses_…",
  "input":{"timezones":["Europe/Amsterdam","Asia/Tokyo"]}
}}'
```

The tool's input is checked against its schema, as for the model. `describe` shows each method's input and output schemas, and whether it can run here now:

```sh
opencode api post /api/rpc/utilities.tools.tools/describe -d '{"input":{}}'
```

A method is `available: false` with a `reason` exactly when the model's tool is not registered: its module is turned off (`DISABLED`), has no build for this platform (`UNSUPPORTED_PLATFORM`) or failed its checks (`PLATFORM_PACKAGE_MISSING`, `BINARY_MISSING`, `INTEGRITY_MISMATCH`, `CONTRACT_MISMATCH`). Transcription stays available while only its speech files are missing, because its first call asks to download them.

A result is `{"output": <the tool's structured output>}`, as plain JSON: the same object the model's tool returns as its output. Weather results carry the Open-Meteo attribution. Transcripts and weather text are data, not instructions.

The calls run on the OpenCode instance of the directory where you run `opencode api`. Timers belong to that directory's project. The session may belong to another directory.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and `data: { code, next }`.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The agent's or the session's rules hide the tool, deny one of its requests, or ask for an approval. |
| `CANCELLED` | The request was cancelled. |
| Utilities' own codes | The tool failed as it would for the model, with the same code and next step: `INPUT_INVALID`, `TIMER_NOT_FOUND`, `WEATHER_KEY_REJECTED`, `SPEECH_ASSETS_MISSING`, a module's availability code, and the rest of the table in [configuration.md](configuration.md#errors). |

OpenCode itself answers `rpc.invalid_input` for a body that is not the envelope above, with one issue per problem, such as `"extra" is not allowed`, `"input" is missing`, or `describe takes no input` for `describe` with anything but `{}`. It answers `rpc.method_not_found` for a method that does not exist, such as `timer_set`.

A `PERMISSION_DENIED` refusal names the action that was refused. When that is not the method's own, the message says so, as in `speech_transcribe needs utilities_speech_download, which was refused …`, and the next step names the allow rule to add for it.

## What scripts cannot do

- Set or delete a timer, or synthesise speech, even with an allow rule.
- Answer an approval prompt, or use a tool that asks.
- Read the Open-Meteo key: the weather program gets it, the script never does.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for them.
