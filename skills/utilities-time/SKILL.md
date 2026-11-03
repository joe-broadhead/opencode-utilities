---
name: utilities-time
description: Answer time zone, date, holiday and business-day questions exactly, and keep simple project timers.
---

# Time, dates and timers

Use these tools instead of mental arithmetic whenever a date or time matters.

## Times and time zones

- "What time is it in Tokyo?": `utilities_time_now` with `timezones: ["Asia/Tokyo"]`. It defaults to UTC, so always pass the zones the user means.
- Converting a meeting time: `utilities_time_convert` with the local `datetime` and both zones. A local time that does not exist or is ambiguous at a daylight-saving change fails; ask the user which time they mean.
- Unsure of a zone name: `utilities_time_zones` with a `region` such as `Europe`, then `utilities_time_zone_info` for offsets and the next change.

## Dates

- Weekday, ISO week or quarter of a date: `utilities_time_calendar`.
- "90 days from today", "3 months before the deadline": `utilities_time_add`. Month and year steps land on the month's last day when needed, and the result says so.
- Time between two dates: `utilities_time_between`.
- Changing a format, for example to a Unix timestamp: `utilities_time_format`.

## Holidays and business days

- `utilities_time_holidays` checks a date or lists a year for a country code such as `GB`. The offline calendar covers 2000 to 2030 only; outside that range, say so rather than guess.
- `utilities_time_business_days` counts working days between two dates (both included), or finds the next or previous working day. Pass `country` to skip that country's holidays.

## Timers

Timers belong to the current project and never alert on their own. To remind the user, they must ask, or you check:

1. `utilities_timer_set` with a `name` and a `deadline` that includes a zone offset, for example `2026-11-02T09:00:00+01:00`. It asks for permission first. An existing name is an error unless you pass `replace: true`.
2. `utilities_timer_check` shows which timers are due or overdue. Call it when the user asks about reminders or at the start of a session they resume.
3. `utilities_timer_get`, `utilities_timer_list` (optionally by `tag`) and `utilities_timer_delete` manage them.

If an error says the timer state is unknown, read the timer with `utilities_timer_get` before trying again.

If the user needs an alert that fires by itself, explain that these timers are polled and suggest OpenCode's experimental schedules instead (the `schedule_*` tools, turned on with `experimental.schedules` in opencode.json).

## Scripts

When the user wants a job that runs without you, such as a cron job that checks due timers, it can call these tools through the OpenCode server with no model. The RPC `utilities.tools.tools` has one method per tool that changes nothing, named without the `utilities_` prefix (`time_now`, `timer_check`, and so on), and `describe`, which lists them with their schemas. Each call is `opencode api post /api/rpc/utilities.tools.tools/<method>` with the body `{"input":{"sessionID":"<session>","input":<the tool's input>}}`. The script runs as that session's agent, so have it create its session once with `opencode api post /api/session` and a body such as `{"title":"timer check","agent":"build"}`. A script cannot set or delete timers. The details are in the plugin's `docs/scripting.md`.
