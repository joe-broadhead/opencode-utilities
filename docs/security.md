# Security

## What leaves the machine

| Destination | What | When |
|---|---|---|
| Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`, and their `customer-` hosts with a key) | the place or query the call asks about, over HTTPS | a `weather_*` call |
| This repository's GitHub release (`github.com`) | nothing; a download, not an upload | `native_install`, `speech_install` |
| The model provider | tool descriptions and every tool answer the agent reads, including transcripts, weather and timer text | as OpenCode sends them |

Nothing else leaves the machine. Transcription and synthesis run locally. The plugin has no telemetry and does not read
OpenCode's credential store except through the `open-meteo` connection.

## The key

The Open-Meteo commercial key is held by OpenCode's `open-meteo` integration. At call time it is resolved and passed to
`weather-signal` in `OPEN_METEO_API_KEY`, never in argv, never in an answer, never in a log. With a key, the call uses
Open-Meteo's `customer-` hosts; without one, the free tier (non-commercial, rate-limited). A rejected key is reported by
`diagnose` and cleared once a call succeeds.

## Downloads

Every release file is pinned by size and SHA-256 in `manifest/native.json` or `manifest/speech-assets.json`. A download
goes to a temporary file and is checked as it arrives, and for a program again after decompression; it is renamed into
place only when every check matches, and a failed check is discarded and never executed. A cached program is checked again before every run: it must be
a regular file, executable, and the pinned bytes. A symbolic link inside the plugin's folders is `UNSAFE_PATH`.

A read never downloads. With the programs or speech files missing, the read refuses `NATIVE_FILES_MISSING` or
`SPEECH_ASSETS_MISSING` and names `native_install` or `speech_install`, so `read-only` stays read-only and a download is
always a person's decision under `ask-changes`.

## Files

Paths are resolved the way the host's own file tools resolve them: `~` expanded, relative to the location directory,
and a file under the project directory counts as inside. The state root and every cache directory must be owned by this
user and private (mode 700); a wider one is refused with `STATE_NOT_PRIVATE` before any state exists. A timer store
file that is a link or not a regular file is refused (`STATE_FILE_UNSAFE`), checked again between a timer's preflight
and its write.

## Redaction

`diagnose` reasons, the provider's failure messages and the refuse path are cut to one line and redacted by the
contract's `redactReason`. Timer text, transcripts, weather locations, file paths and keys are never put into a reason.
`sessions_grep` masks credentials in every field and in its echoed query before returning, and caps its answer in
bytes.

## Trust

- **Untrusted data:** session text, tool outputs, weather text, transcripts. An agent must treat them as data, never as
  instructions, and never use them to choose a tool or a recipient.
- **Access:** the plugin's `access` level is the ceiling. A later rule may narrow it; a `deny` is final. An agent that
  lacks the generated rules is named in `status.unguardedAgents`, never patched.
- **The session database:** read-only, schema-checked, and the one documented exception to public APIs only (standard
  §4 rule 1).

## Reporting

See [SECURITY.md](../SECURITY.md).
