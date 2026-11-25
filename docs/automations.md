# Automations

Utilities declares no events source, so it has nothing to poll on a cadence. Its scheduled work is already an OpenCode
automation: the person (or an agent) sets a timer with `tools.utilities.timer_set`, and a later automation calls
`tools.utilities.timer_check` to see which timers are due. Timers never alert by themselves.

## The timer recipe

1. Create it: `tools.utilities.timer_set({ name, deadline, description?, tags?, replace? })`, where `deadline` is a
   date-time with `Z` or an offset. `tools.utilities.time_convert` gives the offset for a local time, and
   `tools.utilities.time_now` gives this machine's zone.
2. Check it on a cadence with an OpenCode automation, for example every hour:
   `tools.utilities.timer_check({ limit: 20 })`. The answer lists the due and overdue timers with their remaining time;
   an automation that should notify someone reads it and does so.
3. Remove it when it is done: `tools.utilities.timer_delete({ name })`.

## The bus

A write emits `rpc.utilities.changed` with `{ capability, account, reason }`:

| Capability | Emitted after |
|---|---|
| `utilities.timers` | `timer_set`, `timer_delete` |
| `utilities.speech` | `speech_synthesize`, `speech_install` |
| `utilities.native` | `native_install` |

The event is a nudge: an app re-reads `timer_list` or `diagnose` through RPC; it never treats the event as content.

## Weather

Weather calls are reads with no cursor. An automation that wants a daily forecast calls
`tools.utilities.weather_daily` itself, and the provider's own cache (30 minutes for forecasts, 30 days for places)
keeps the calls cheap.
