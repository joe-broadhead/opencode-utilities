# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

## Tools and permissions

26 tools are declared (22 read-only). Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: `utilities_timer_set`, `utilities_timer_delete`, `utilities_weather_geocode`, `utilities_weather_current`, `utilities_weather_daily`, `utilities_weather_hourly`, `utilities_weather_demand_signal`, `utilities_weather_summary`, `utilities_speech_synthesize`, `utilities_speech_download`.
- Off: none.
- Everything else runs, as the plugin's own rules let it.

Weather is read-only but asks, as the plugin's own rules do: it sends a place to Open-Meteo. `utilities_speech_download` is declared too: it is not a tool, but the speech tools assert it before a download.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/**/jelly.test.ts` checks
each declared effect against the plugin's own default rules.

## Skills

Declared: `utilities-time`, `utilities-weather`, `utilities-speech`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own.

## Views

None yet.

## Signing in

No sign-in is needed. The optional Open-Meteo commercial key is OpenCode's key integration `open-meteo`; Jelly shows it as a sign-in card.

<!-- AUTH-PLACEHOLDER (Jelly rd152): settings and secrets for signing in from Jelly are being
designed by Jelly's auth lane. Until that lands this package declares no `contributes.settings`;
add the auth declarations here and in package.json when that design is agreed. -->
**Not yet declared for Jelly.** How this plugin's sign-in appears in Jelly (desktop and web,
expiry, reconnect and sign-out) is still being designed; this section and
`jelly.contributes.settings` will say it once it is.

## Versions

Jelly's curated catalogue pins an exact version. `latest` is `0.0.0`; publish each release
under a new version so a review in Jelly can tell the two apart.
