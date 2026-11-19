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

Weather sends a place to Open-Meteo and is read-only by class. To make the changes ask instead, set
`access: "ask-changes"` in the plugin options.

### The first-use downloads

Two consents are not declared: `utilities_native_download`, which the first time or weather call (and
`/utilities-install`) asserts before it downloads that program, and `utilities_speech_download`, which the first
transcription or synthesis (and `/utilities-speech-install`) asserts before it downloads the speech files. They are not
tools, and Jelly's declaration has no place for a consent that is not a tool, so Jelly decides them by the plugin's
`utilities_*` namespace, as it does any undeclared action:

- At **Allowed** they run, so the first call downloads what it needs.
- At **Ask before changes** each one asks before its download.
- At **Read only** each one is **denied**. A time or weather tool whose program is not cached yet then fails on its
  first call, even though the tool itself is a read, and so do `/utilities-install` and the speech tools. Download the
  programs once at **Allowed** (or run `/utilities-install` there), or pre-seed the speech files with
  `speech.assetsDir`, before choosing Read only. A program or file already in the cache needs no download, so it keeps
  working at Read only.

The declaration lists the tools of this version. Keep `jelly.tools` in step with the tool table in
`src/domain/contract.ts`; `test/unit/jelly.test.ts` checks each declared effect against the plugin's own
default rules, and the list and its `readOnly` marks against that table.

Jelly's shared rules for every plugin of the family, word for word:

<!-- family-block:start -->
- At Allowed (`all`), the default, every tool runs without asking, declared or not, whatever its `effect`.
- At Ask before changes (`ask-changes`), a `readOnly` tool runs, and every other tool asks first, including a tool this plugin does not declare.
- At Read only (`read-only`), a `readOnly` tool runs, and every other tool is off, including a tool this plugin does not declare.
- A declared `effect` of `allow` changes nothing: the tool follows the access choice and its `readOnly`.
- A declared `effect` of `ask` makes the tool ask at Ask before changes, even when it is `readOnly`, and changes nothing at Allowed or Read only.
- A declared `effect` of `deny` turns the tool off at Ask before changes and at Read only, and changes nothing at Allowed.
- An action listed in `asks` asks first at Ask before changes and at Read only, and never at Allowed.
- A tool named with one `*`, such as another account's `plaud-*.get_file`, follows the same rules as a tool named in full.
- A choice the person makes for one tool wins over the access choice and the declared `effect`.
- jelly leaves out a key it does not know at the top level of the `jelly` block, and reads the rest.
- jelly refuses the plugin for a key it does not know inside anything it reads, such as a tool, a sign-in or a setting.
- jelly refuses the plugin, with one plain line, when `requires` names a field or a feature it does not read.
<!-- family-block:end -->

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

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit and Jelly's setting rules (`test/support/jelly-settings.ts`), equal to the copies every plugin carries. The tools RPC's transport is the source contract package, pinned in `package-lock.json` and bundled into `dist/index.js`.
