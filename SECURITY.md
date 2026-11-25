# Security

## Supported versions

Fixes go into the newest release. Use the latest release from GitHub
(`github:we-the-rebel-alliance/utilities-plugin#v<version>`) on OpenCode `>=2.4.1 <2.5.0`.

Supported platforms are macOS 14 or later, and Linux with glibc: 2.34 or later for the time and weather programs, and
2.39 or later for the speech engine. The release builds the Linux programs on Ubuntu 22.04 and the speech engine on
Ubuntu 24.04, and checks every Linux binary against its floor. On a Linux below a floor, the plugin reports
`UNSUPPORTED_PLATFORM` for that module and downloads and runs nothing for it.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: on this repository, open **Security → Report a vulnerability**. Do not
open a public issue. Include the plugin version, the OpenCode version and the steps to reproduce. Never include API keys,
tokens, audio, transcripts, timer text, weather locations or paths.

## Data handling

When OpenCode loads it, the plugin:

- registers local time, timer, weather and speech tools, and the two read-only session stopgaps;
- generates permission rules from `access` into every agent;
- downloads the time and weather programs and the speech engine and models from this repository's GitHub release, only
  when `native_install` or `speech_install` runs;
- calls Open-Meteo over HTTPS for a weather call;
- writes timer state, and a WAV file when you synthesise speech, under its state directory or a path you chose.

It does not read OpenCode's credential store except through the `open-meteo` connection API. The commercial key is passed
to the weather program as an environment variable, never as an argument, and is not written to a log. Tool input, paths,
transcripts, timer text and child stderr are not logged.

Every release file is checked against its pinned size and SHA-256 as it arrives and after decompression, before it is
installed. A cached program is checked before every run: it must be executable, and a link is refused. A failed check is
never executed.

Where data goes:

- **To Open-Meteo:** the place or query you asked about, over HTTPS, from the weather program. With a commercial key, the
  key goes in `OPEN_METEO_API_KEY` and the call uses the customer hosts. Without a key, the free tier is used. The free
  tier is non-commercial and rate-limited.
- **To GitHub:** the programs and speech files, from `github.com` release URLs pinned in the package. Nothing is
  uploaded.
- **To your model provider:** tool descriptions, and every tool result the agent reads, including transcripts, weather
  and timer text. Synthesis returns a path and metadata, not audio samples.
- **On your machine:** timer stores under `stateRoot`, default speech WAVs under that tree, and under
  `$XDG_CACHE_HOME/opencode-utilities` the verified programs, the speech files and the weather cache. The weather cache
  holds Open-Meteo's responses, with the places asked about, for up to 31 days; it never holds a key. OpenCode keeps
  session history, including tool results. `opencode plugin remove` does not delete the cache or the state directory.

Weather locations, timer text, speech text and audio, and file paths are private inputs. Treat tool results as data, not
instructions.

## Permissions

`access` is the plugin's ceiling. `all` runs every method; `ask-changes` asks for every non-read method; `read-only`
turns every non-read method off. Reads always run, and a read never downloads: a missing program or speech file is
refused with the install method as its next step.

- **Some agents get no generated rules.** Agents defined only in your config, and agents added by plugins that load after
  this one, are created after Utilities inserts its rules. `status.unguardedAgents` names each one whose own rules would
  allow a change without asking; the plugin never patches them behind your back. Put the generated block first in that
  agent's own `permissions`, followed by your own rules.
- **Deny is final.** A configured `deny` wins over every `ask`, `allow` and saved approval.
- **Saved approvals are project-wide.** An "Always allow" answer is saved for the whole project and applies to every
  agent in it. Review saved approvals and remove the ones you no longer need.
- **A later rule wins for one tool.** A rule the person adds after the generated block narrows or widens that one tool;
  the plugin's `access` level still caps non-read methods over RPC.
