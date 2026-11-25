---
name: utilities
description: Local tools for exact times, dates, holidays, working days, project timers, Open-Meteo weather, on-device speech and read-only past-session lookups. Load a topic skill for call shapes. To find a session, use opencode.session.search first.
---
# Utilities

Utilities answers the small questions an agent gets wrong by guessing: what time it is somewhere, which weekday a date
is, whether a day is a holiday, how many working days are between two dates, when a timer is due, what the weather is,
and what a recording says. The time, timer and speech work runs on this machine; only weather leaves it.

## The topic skills

| Skill | For |
|---|---|
| `utilities-time` | `time_*` and `timer_*`: zones, dates, holidays, working days, project timers |
| `utilities-weather` | `weather_*`: geocoding, current, daily, hourly, planning signals, a short summary |
| `utilities-speech` | `speech_transcribe`, `speech_synthesize`, `speech_install` |
| `utilities-sessions` | `sessions`, `sessions_grep`: read-only past-session status and exact-text search |

`tools.utilities.diagnose` answers "what works here, and why not": module availability, the weather tier, the speech
files, due timers and the access level. Call it when a Utilities tool is missing or fails.

## Owners

- **Finding or reading a past session:** `opencode.session.search` and `opencode.session.read` first. The two session
  methods are stopgaps for status, spend and exact text only.
- **Remembering something across sessions:** Memory, not Utilities.
- **Scheduled or recurring work:** an OpenCode automation that calls a Utilities method; timers themselves never alert.
- **Weather:** Open-Meteo through `weather_*`; do not fetch a weather site for the same answer.

## Access and errors

Reads always run. A change runs under `access: all`, asks under `ask-changes`, and is off under `read-only`. A read that
needs a program or a speech file refuses `NATIVE_FILES_MISSING` or `SPEECH_ASSETS_MISSING` and names the install method;
it never downloads by itself.

Every failure reads `CODE: What happened. Next step: What to do.` Do what the next step says, and do not retry a
refusal unchanged: `INPUT_INVALID` names the field and rule, `PERMISSION_DENIED` means the person's rules refuse it,
and `UNAVAILABLE` is the catch-all with the provider's own code at the front.
