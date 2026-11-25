# Utilities

Local, offline-first tools for OpenCode: exact times and time zones, dates, holidays and working days, project timers,
Open-Meteo weather, on-device speech, and two read-only stopgaps over past sessions. Every call runs on this machine
except the weather request, and each tool says what it does and what it refuses.

Utilities is a tools-only plugin on the plugin contract: no accounts, no sources, no actions. Its methods are reached as
agent tools, in Code Mode and over RPC, and the two session stopgaps carry the OpenCode feature each is deleted by.

## Install

```sh
opencode plugin add github:we-the-rebel-alliance/utilities-plugin#v0.0.0
```

Then restart OpenCode. The time and weather programs and the speech engine are downloaded from the plugin's own GitHub
release, verified against the hashes in `manifest/`, by `native_install` and `speech_install`; nothing downloads until
one of them runs.

## Sign in

Nothing to sign in to: Utilities has no accounts. The one optional credential is an Open-Meteo commercial API key, which
is an OpenCode integration (`open-meteo`), not an account:

```sh
opencode auth login open-meteo
```

The free tier works without it and is for non-commercial use. `diagnose` shows the tier and whether the key was
accepted; every weather answer carries the attribution the licence asks for.

## Access

`access` is `all` (the default), `ask-changes` or `read-only`. Reads always run. A change — a timer write, a speech
file, an install — runs under `all`, asks under `ask-changes`, and is off under `read-only`. A later rule for one tool
wins, and a `deny` is final.

## Capabilities

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

## Errors

Every failure reads `CODE: What happened. Next step: What to do.` The provider's own code is kept at the front of the
sentence, so a tool can say `INPUT_INVALID: TIME_AMBIGUOUS: …` while the envelope stays on the contract's table.

<!-- generated:errors -->
| Code | Meaning |
|---|---|
| `NEEDS_SIGN_IN` | the account is not signed in |
| `SCOPE_MISSING` | the call needs a scope the person has not confirmed |
| `ACCOUNT_REQUIRED` | the plugin serves several accounts and the call names none |
| `ACCOUNT_UNKNOWN` | the call names an alias the plugin does not serve |
| `ACCOUNT_MISMATCH` | the item belongs to another account |
| `CURSOR_INVALID` | the cursor is malformed, or belongs to another source, account or scope |
| `CURSOR_EXPIRED` | the provider no longer keeps the history the cursor names |
| `RATE_LIMITED` | the provider asked the plugin to slow down |
| `BUDGET_EXCEEDED` | the read would cost more than the person allows |
| `SOURCE_DISABLED` | the person turned this source or action off |
| `TOO_LARGE` | the answer is larger than the source's maxBytes |
| `INPUT_INVALID` | the input does not match the method's schema |
| `SOURCE_UNKNOWN` | the plugin declares no such source |
| `SCHEMA_VIOLATION` | an answer does not keep the contract's shape |
| `PERMISSION_DENIED` | the person's grant does not cover the call |
| `PLAN_INVALID` | the plan is missing, or belongs to another method |
| `PLAN_USED` | the plan was already used by an earlier commit |
| `GRANT_INVALID` | the action grant did not verify, or was already spent |
| `HOST_UNTESTED` | OpenCode is outside the plugin's tested range |
| `OPTIONS_INVALID` | the plugin's options do not match their schema |
| `UNAVAILABLE` | the provider could not be reached |
<!-- /generated:errors -->

## Docs

- [Capabilities](docs/capabilities.md)
- [Configuration](docs/configuration.md)
- [Accounts](docs/accounts.md): why there are none
- [Automations](docs/automations.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)

## Stopgaps

`utilities_sessions` and `utilities_sessions_grep` are stopgaps for what OpenCode's session tools do not yet give an
agent. Each names the feature that deletes it: a session list or stats tool with outcome, cost and token fields;
exact-text search. To find or read a session, use `opencode.session.search` first.
