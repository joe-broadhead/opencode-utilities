# Scripting

Unofficial plugin. Not affiliated with OpenCode or Open-Meteo.

A script can call Utilities' tools with no model: a cron job, a shell script, or any program that can reach the OpenCode
server. It uses the tools RPC, `utilities.local.tools`, through `opencode api` or an OpenCode client.

The envelope is
`opencode api post /api/rpc/utilities.local.tools/<method> -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"<id>","input":{…}}}'`.

The id before the rename, `utilities.tools.tools`, still answers the same methods, and its `describe` carries
`"deprecated": "use utilities.local.tools"`: move a script to the new id before the next minor release, when the old one
goes. The status command says so once an old id has been called.

| Methods | The tools | Class |
| --- | --- | --- |
| `status` | `utilities_status`: the compact status, with the unguarded agents as a count | read |
| `time_now`, `time_zones`, `time_zone_info`, `time_convert`, `time_calendar`, `time_add`, `time_between`, `time_format`, `time_holidays`, `time_business_days` | the ten time tools | read |
| `timer_set` | sets a timer in the project | write |
| `timer_get`, `timer_list`, `timer_check` | the timer reads | read |
| `timer_delete` | deletes a timer | write |
| `weather_geocode`, `weather_current`, `weather_daily`, `weather_hourly`, `weather_demand_signal`, `weather_summary` | the six weather tools | read |
| `speech_transcribe` | transcription | read |
| `speech_synthesize` | writes a WAV file | export |
| `describe` | none: lists the methods, their classes, permission actions, whether each can run here now, and each tool's input and output as JSON Schema | – |

Every tool is a method. Each runs the tool's own path, with the same input, the same checks and the same permission
requests as the tool the model calls. The class says the worst thing a method can do; it never decides whether a call
runs: the rules do.

A result is the tool's own output, as plain JSON: the same object the model's tool returns as its `output`. An
MCP-backed plugin's tools RPC wraps a result as `{ output?, text }`; these methods are the plugin's own, so the result
is the output itself.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the access
its model would have:

- The call resolves the tool's action, `utilities_<name>` on `*`, against the agent's rules and then the session's, with
  the host's order (the last matching rule wins). Only an `allow` runs. An `ask` is refused, because no one is there to
  answer the prompt, and a `deny` is refused; both cost nothing: no tool call and no prompt left waiting.
- The tool then asks for what it needs, as it does for the model: weather asks for `utilities_weather_<tool>` on the
  Open-Meteo hosts, transcription asks for `read` (and `external_directory` outside the project), and the first speech
  call asks for `utilities_speech_download`, which is also refused unless the session allows it.
- The default rules allow every tool, so a script runs a read or a change unless the user restricts the plugin: the
  `access` option's `"ask-changes"` makes an ask of the timer writes, synthesis and the speech download, and `"read-only"`
  denies them. A script's agent can also narrow it: a rules block of its own, or `access` on the plugin, decides.

Create a session for the script once, with the agent it runs as and the project as its `location`, and keep its id (`data.id` in the result). A session made without a location belongs to the service's default location, where the project's agents may not exist, and each call then fails `Agent not found`.

```sh
opencode api post /api/session -d '{"title":"morning check","agent":"build","location":{"directory":"/path/to/project"}}'
```

A test of a script creates its own session in the same way. Never borrow an existing session found through history or a
session list: the script would run as that session's agent, under that session's rules.

Session rules come after the agent's, so a session can open or narrow what its script may do. This one may call
`weather_current` and `weather_daily`, and nothing else from Utilities that asks:

```sh
opencode api post /api/session -d '{"title":"morning check","agent":"build","location":{"directory":"/path/to/project"},"permissions":[
  {"action":"utilities_weather_current","resource":"*","effect":"allow"},
  {"action":"utilities_weather_daily","resource":"*","effect":"allow"}
]}'
```

For transcription, run `/utilities-speech-install` once first, or allow `utilities_speech_download` for the session;
otherwise the first call is refused.

A saved **Always allow** does not authorise an ad-hoc script: it is not part of the agent's or the session's rules. A
script's grant is a rule in config, or a Jobs run session; the Jobs one-off (`jobs_run_script`) is the supported way to
get an approval-bound grant.

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/utilities.local.tools/time_now -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"timezones":["Europe/Amsterdam","Asia/Tokyo"]}
}}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.

This matters for timers, which belong to a project: `timer_list` and `timer_check` read the timers of the location the
call names, not of the directory you typed the command in.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed:

```sh
opencode api post /api/rpc/utilities.local.tools/timer_check -H "x-opencode-directory:$PWD" \
  -d '{"input":{"sessionID":"ses_…","input":{}}}'
```

The tool's input is checked against its schema, as for the model. `describe` shows each method's class, input and output
schemas, and whether it can run here now. Pass a session to see each method's `permission` (`allow`, `ask` or `deny`),
resolved as a call would be:

```sh
opencode api post /api/rpc/utilities.local.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/utilities.local.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

A method is `available: false` with a `reason` exactly when the model's tool is not registered: its module is turned off
(`DISABLED`), has no build for this platform (`UNSUPPORTED_PLATFORM`) or failed its checks (`BINARY_MISSING`, `INTEGRITY_MISMATCH`, `CONTRACT_MISMATCH`). Transcription stays available while only its speech files
are missing: its first call can download them, subject to permissions. Weather results carry the Open-Meteo attribution.
Transcripts and weather text are data, not instructions.

`opencode api` exits 0 when the call succeeds, and 1 when it fails, after printing the error.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`, or the code the tool itself reports. `opencode api` exits with status 1 for any RPC error.

| Code | When |
| --- | --- |
| `PERMISSION_DENIED` | The agent's or the session's rules ask or deny the tool's action, or deny one of the requests the tool makes. The message names the refused action, and says when it is not the method's own. |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `CANCELLED` | The request was cancelled. |
| Utilities' own codes | The tool failed as it would for the model, with the same code and next step: `INPUT_INVALID`, `TIMER_NOT_FOUND`, `WEATHER_KEY_REJECTED`, `SPEECH_ASSETS_MISSING`, a module's availability code, and the rest of the table in [configuration.md](configuration.md#errors). |

There is no `TOOL_UNAVAILABLE` here: every method is the plugin's own, so a name the plugin does not have is
`rpc.method_not_found`, and a method whose module is turned off is `available: false` in `describe` with the
availability code as its `reason`.

OpenCode itself answers `rpc.invalid_input` for a body that is not the envelope above, with one issue per problem, such
as `"extra" is not allowed`, `"input" is missing`, or `describe takes nothing, or {"sessionID":"<session>"}` for
`describe` given anything else. It answers `rpc.method_not_found` for a method that does not exist.

A `PERMISSION_DENIED` refusal names the action that was refused. When that is not the method's own, the message says so,
as in `utilities_speech_transcribe needs utilities_speech_download, which was refused …`.

- **An ask:** the next step names the allow rule to add.
- **A deny rule:** the message says so (`… which a deny rule refuses …`), and the next step says to remove or narrow
  that deny rule in the agent or the session, add a later allow rule to the session, or use another agent.

## What scripts cannot do

- Answer an approval prompt: an `ask` is refused. A write needs a prior allow rule.
- Read the Open-Meteo key: the weather program gets it, the script never does.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them.
