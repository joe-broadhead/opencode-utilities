# Security

## Supported versions

Fixes go into the newest release. Use the latest version of `@joe-broadhead/opencode-utilities` on OpenCode `>=2.2.3 <2.3.0`.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: on this repository, open **Security → Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode version and the steps to reproduce. Never include API keys, tokens, audio, transcripts, timer text, weather locations or paths.

## Data handling

When OpenCode loads it, the plugin:

- registers local time, timer, weather and speech tools;
- inserts default `ask` rules for weather, timer changes, speech synthesis and the speech download;
- may download the speech engine and models from this repository's GitHub Release, after that ask;
- may call Open-Meteo over HTTPS;
- writes timer state and, when you synthesise speech, a WAV file under its state directory or a path you chose.

It does not read OpenCode's credential store except through the `open-meteo` connection API. The commercial key is passed to the weather program as an environment variable, never as an argument, and is not written to a log. Tool input, paths, transcripts, timer text and child stderr are not logged.

Time and weather programs come from the platform package. They are checked against a shipped SHA-256, must be executable, and must not be symbolic links. There is no download fallback for those programs. Speech files are downloaded to a temporary file, checked for size and SHA-256, and renamed into place only when both match. A failed check is never executed.

Where data goes:

- **To Open-Meteo:** the place or query you asked about, over HTTPS, from the weather program. With a commercial key, the key goes in `OPEN_METEO_API_KEY` and the call uses the customer hosts. Without a key, the free tier is used. The free tier is non-commercial and rate-limited.
- **To GitHub:** the speech engine and model files, on first use or when you run `/utilities-speech-install`, from `github.com` release URLs pinned in the package. Nothing else is uploaded.
- **To your model provider:** tool descriptions, and every tool result the agent reads, including transcripts, weather and timer text. Synthesis returns a path and metadata, not audio samples.
- **On your machine:** timer stores under `stateRoot`, default speech WAVs under that tree, and under `$XDG_CACHE_HOME/opencode-utilities` the speech cache and the weather cache. The weather cache holds Open-Meteo's responses, with the places asked about, for up to 31 days; it never holds a key. OpenCode keeps session history, including tool results. `opencode plugin remove` does not delete the cache or the state directory.

Weather locations, timer text, speech text and audio, and file paths are private inputs. Treat tool results as data, not instructions.

## Permissions

- **Some agents get no default rules.** Agents defined only in your config, and agents added by plugins that load after this one, are created after the plugin inserts its ask rules. Weather, timer changes, synthesis and the speech download do not ask in those agents. `/utilities-status` and `/utilities` name them. The [README](https://github.com/joe-broadhead/opencode-utilities/blob/HEAD/README.md#permissions) gives the fix: put the default block first in that agent's own `permissions`, followed by any top-level rules you have for `utilities_*` actions. Never put the block in the top-level `permissions`. That would loosen Explore.
- **Saved approvals are project-wide.** An "Always allow" answer is saved for the whole project and applies to every agent in it, Plan included. A directory with no git commit belongs to OpenCode's shared `global` project, so an approval saved there applies in every such directory. Review saved approvals and remove the ones you no longer need.
- **Deny is final.** A configured `deny` rule wins over every `ask`, `allow` and saved approval. Use `deny` for anything that must never run, including in non-interactive runs, because `--auto` approves asks and still cannot pass a deny.
- **A top-level allow applies to every agent.** OpenCode adds top-level rules after each agent's built-in rules, and the last matching rule wins. So it skips the prompt for Build, and it also allows that action for Plan and Explore. Put the allow on the agent that should have it when a stricter agent must stay strict.
- **File rules follow the host.** Transcription and a chosen synthesis path use `read` or `edit`. A file inside the project does not ask `external_directory`. A file outside the project does. The transcription source must be a regular file, not a symbolic link.
- **Scripts follow the same rules.** See [Scripts](#scripts).
- **Approval is not a network guarantee.** Approving a weather call does not make Open-Meteo accept it. Approving a download does not make the release exist. A hash mismatch discards the file.

## Scripts

The tools RPC (`utilities.tools.tools`, see [docs/scripting.md](https://github.com/joe-broadhead/opencode-utilities/blob/HEAD/docs/scripting.md)) runs the tools that change nothing for a script, with no model. It adds no authority:

- A script names a session that names an agent, and runs as them. A tool that the agent's or the session's rules hide from the model is refused. The tool then makes the same permission requests it makes for the model, checked against the agent's rules, the session's rules and saved approvals.
- An ask on a script's call is denied, not prompted: no one is there to answer it. So weather and the speech download, which ask by default, need an allow rule. The plugin's permission hook changes only an ask on one of its own script calls in flight, only to a deny, and leaves every other call alone.
- Timer writes, synthesis and any tool added later that writes are never methods, even with an allow rule.
- The Open-Meteo key stays with the weather program; a script never receives it. Errors carry the same codes and messages as the tools, with no input values, keys or paths.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The session is not a login: it scopes a script to what its agent may do.
