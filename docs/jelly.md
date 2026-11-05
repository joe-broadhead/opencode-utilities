# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Utilities** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. A Jelly whose declaration schema lacks `summary` or `icon` refuses this
declaration, because that schema accepts no unknown keys.

## Tools and permissions

25 tools are declared (21 read-only): the 24 tools and the speech download. Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: `utilities_timer_set`, `utilities_timer_delete`, `utilities_weather_geocode`, `utilities_weather_current`, `utilities_weather_daily`, `utilities_weather_hourly`, `utilities_weather_demand_signal`, `utilities_weather_summary`, `utilities_speech_synthesize`, `utilities_speech_download`.
- Off: none.
- Everything else runs, as the plugin's own rules let it.

Weather is read-only but asks, as the plugin's own rules do: it sends a place to Open-Meteo. `utilities_speech_download` is declared too: it is not a tool, but the speech tools assert it before a download.

The declaration lists the tools of this version. Keep `jelly.tools` in step with the tool table in
`src/domain/contract.ts`; `test/unit/jelly.test.ts` checks each declared effect against the plugin's own
default rules, and the list and its `readOnly` marks against that table.

## Skills

Declared: `utilities-time`, `utilities-weather`, `utilities-speech`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own.

## Views and scripts

None: `jelly.views` and `jelly.rpc` are empty.

## Signing in

Nothing is required. `jelly.signIns` declares one optional sign-in, `open-meteo`: OpenCode's key integration for Open-Meteo's commercial key (`required: false`). The free tier works without it, so the card stays Connected and the row reads Optional, with a link to Open-Meteo's pricing. A key that Open-Meteo turns down shows this plugin's `needs_auth` message on the row, with Replace the key.

Jelly folds the declared sign-ins into this plugin's one card, which shows each as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of each. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version. Each release is published under a new version, so a review in
Jelly can tell the two apart.
