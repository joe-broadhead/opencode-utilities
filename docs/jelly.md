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

24 tools are declared (21 read-only): every tool the plugin registers. Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Every tool is allowed by
default, the speech download included, so those agents run everything Utilities offers; the person restricts it with
Jelly's own tool settings, or with this plugin's `access` option where the plugin's rules do apply. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: none: every declared tool is allowed.
- Off: none.

Weather sends a place to Open-Meteo and is read-only by class; `utilities_speech_download` is not declared: it is not a
tool but the consent the speech tools assert before a download, and Jelly's declaration has no place for a permission. To make the changes ask instead, set `access: "ask-changes"` in
the plugin options.

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

## Settings

`jelly.contributes.settings` declares one setting, `access`, the option of the same name, as a choice of three:
**Allowed** (`all`, the default), **Ask before changes** (`ask-changes`) and **Read only** (`read-only`), with Jelly's
own line for each. Jelly draws it as a choice, never as free text, and saves only one of the three, the options
parser's own set. A Jelly that does not know declared choices (before app#1301) refuses the whole declaration.
`test/unit/jelly.test.ts` checks the setting against Jelly's setting rules, restated in `test/support/jelly-settings.ts`,
and each declared value against the options parser.

## Versions

Jelly's curated catalogue pins an exact version. Each release is published under a new version, so a review in
Jelly can tell the two apart.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit, Jelly's setting rules (`test/support/jelly-settings.ts`) and the shared part of the tools RPC (`src/host/tools-rpc.ts`), equal to the copies every plugin carries.
