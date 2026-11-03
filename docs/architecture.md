# Architecture

`@joe-broadhead/opencode-utilities` is a JavaScript OpenCode plugin. Time, weather and speech run as bounded subprocesses. The plugin does not shell out with a user string, and it does not download the time or weather programs.

User-facing options, permission rules and limits are in [configuration.md](configuration.md). This page is the design those rules implement.

## Shape

`Plugin.define` registers, synchronously:

- a tool transform for the `utilities` namespace;
- default ask rules, inserted after each agent's base allow;
- the `open-meteo` key integration;
- `/utilities-status` and `/utilities-speech-install`;
- one RPC method, `status`;
- the tools RPC `utilities.tools.tools`, with one `evaluate` permission hook;
- three skills.

The tools RPC (`src/host/scripting.ts`, on the shared module `src/host/tools-rpc.ts`) gives scripts the tools that change nothing, with no model. Each method runs `runTool`, the same function the model's tool runs, after parsing the input with the tool's schema, because OpenCode does not check an RPC method's inner input. It refuses a tool the session's agent or session rules hide, as OpenCode hides it from the model; the tool's own asserts then carry the script call's source id, and the hook turns an ask on one of those ids into a deny, since no one can answer it. Methods are chosen by effect: `compute`, `read-state`, `network` and `read-file`, never `write-state` or `write-file`. `describe` reports a method unavailable with its module's code exactly when the model's tool is not registered. `src/host/tools-rpc.ts` is a copy of a module shared by several plugins; only its block between the `PLUGIN-SPECIFIC` markers is Utilities'.

The TUI part `utilities.tools.tui` is compiled at build time to `dist/tui.js`. It reads only `status`. OpenCode supplies `@opencode/plugin`, OpenTUI and Solid. The package has no peer dependencies and no install scripts.

`src/index.ts` and `src/tui.tsx` are bundled by esbuild (`scripts/build.mjs`, splitting off) into exactly `dist/index.js` and `dist/tui.js`. Each is self-contained and neither imports a relative path. The module adapters and zod are inlined in `dist/index.js` only. The RPC contract in `src/rpc.ts` is plain JSON Schema, so `dist/tui.js` carries no zod; the server keeps a zod copy (`src/host/status-schema.ts`) to validate its answer and to type the status tool, and a unit test keeps the two identical. OpenCode reloads an updated plugin in place but keeps module records it already holds, so a sibling file could be stale; with no siblings, that cannot happen. Both files sit in `dist/`, one level below the package root, so `manifest/`, `skills/` and the platform package resolve from there. First-party code and `zod` are inlined; the root `NOTICE` carries zod's licence, and the build fails if it stops matching the bundle. Sources import it as `import * as z from "zod"`, so the bundle keeps the English locale and not the other sixty-three. Only host-provided modules (`@opencode/plugin`, `@opentui/*`, `solid-js`) and `node:` built-ins stay external; the build fails on anything else. No declaration files ship: OpenCode loads the JavaScript, and nothing consumes plugin types. `exports` lists only `.` (the server part) and `./tui`. No `.tsx` file ships.

The runtime plans a call, asks for permission, then starts the module deadline. Compute and timer reads assert nothing. Weather, timer writes, synthesis, transcription of a file, and a missing speech download assert before any effect. A late approval cannot start work: the call is fenced against the tool signal after the assert settles. Host permission errors propagate unchanged.

Each module has its own queue. A child is a fixed argument array, `shell: false`, with a scrubbed environment rooted in a private job directory: empty `PATH`, fixed locale, no host credentials. The Open-Meteo key, when connected, is the only extra variable, `OPEN_METEO_API_KEY`. Stdout is capped at 1 MiB and stderr at 64 KiB. Stderr never reaches the model. Cancellation sends `SIGTERM`, then `SIGKILL` after 100 ms, and reaps the process group. Windows is not supported.

Integrity of a program or model file is checked once per process and cached by file identity (`dev`, `ino`, `size`, `mtimeMs`, `ctimeMs`). A symbolic link never passes. The state directory must be mode `0700` and owned by the user.

The plugin does not log tool input, paths, transcripts, timer text or child stderr.

## Backends

Time and weather have no public library entry point. Their CLIs are fixed command contracts, so the plugin ships those programs rather than another MCP transport. Speech uses a plugin-owned bridge over aurum-core, because the aurum CLI drops STT fields, has no request IDs, and loads ambient configuration.

Pins, not release tags:

| Program | Source | Commit |
| --- | --- | --- |
| time-keep | `https://github.com/joe-broadhead/time-keep` | `0dfc8892f43c7ad36d9fe204f9510e8a3cc3fec8` |
| weather-signal | `https://github.com/joe-broadhead/weather-signal` | `ae1dc3b644a37bc566e7d1d0de56576aa6ff45c5` |
| utilities-speech | `native/speech-bridge` over aurum-core `https://github.com/joe-broadhead/aurum` | `8e3b70fbb0c76add3cbcf7291098e88f2c8bea70` |

The commits and the Rust toolchain (`1.96.0`) are in `native/sources.json` and `native/speech-bridge/Cargo.toml`. Lockfiles are in `native/locks/` and `native/speech-bridge/Cargo.lock`. Version strings do not identify the bytes. `manifest/backends.json` records the SHA-256 of the built programs.

Weather reads may follow redirects from the fixed starting URLs. Those URLs are always passed on the command line, including the unused historical archive, so the CLI cannot fall back to a default host. A commercial key switches the three URLs to the `customer-*` hosts. The free tier stays on `api.open-meteo.com` and `geocoding-api.open-meteo.com`.

Time's holiday data covers 2000–2030. Timer set is an upstream upsert; the adapter holds the store lock across the existence check and the write so `replace: false` is real. Timer reads can create the database. The timer lock is never stolen. The download lock may be taken over only after the install deadline, because a download is idempotent once the hash matches.

Do not set `AURUM_CACHE`. The pinned aurum core does not implement it. The bridge receives explicit paths and `local_only` behaviour: a missing model fails, it does not download.

## Platform packages

One optional npm package per platform holds `bin/time-keep` and `bin/weather-signal`:

| Package | OS | CPU | libc |
| --- | --- | --- | --- |
| `@joe-broadhead/opencode-utilities-bin-darwin-arm64` | darwin | arm64 | |
| `@joe-broadhead/opencode-utilities-bin-darwin-x64` | darwin | x64 | |
| `@joe-broadhead/opencode-utilities-bin-linux-x64-gnu` | linux | x64 | glibc |
| `@joe-broadhead/opencode-utilities-bin-linux-arm64-gnu` | linux | arm64 | glibc |

Versions match the main package. None has scripts. `files` is `bin/`, `LICENSE`, `NOTICE` and `provenance.json`.

The runtime resolves `@joe-broadhead/opencode-utilities-bin-<platform>/package.json` with `createRequire` from the installed plugin, then checks the path in `manifest/backends.json` (`bin/time-keep`, `bin/weather-signal`): exact SHA-256, executable mode, not a symbolic link. If the package is absent, time and weather tools are not registered and status reports `PLATFORM_PACKAGE_MISSING`. There is no download fallback.

musl and Windows have no package. macOS x64 has time and weather only.

In a checkout the packages are npm workspaces under `npm/`. Their `bin/`, `NOTICE` and `provenance.json` are build outputs. They are not in git. Their checked-in `package.json` files have no `os`, `cpu` or `libc`, so `npm ci --ignore-scripts` installs the whole workspace on any machine. `scripts/pack.mjs` adds those fields from `PLATFORMS` in `src/domain/contract.ts` when it packs a platform package, and drops `workspaces` from the main package.

## Speech assets

The engine and four models are release files, not npm files and not git files. `manifest/speech-assets.json` is generated with each file's name, SHA-256, size and URL:

`https://github.com/joe-broadhead/opencode-utilities/releases/download/v<version>/<name>`

Names are unique, so a pre-seed directory is flat. The engine is `utilities-speech-<platform>` and must be executable. The models are `ggml-tiny-q5_1.bin` (MIT), `kitten_tts_nano_v0_8.onnx`, `kitten_tts_nano_v0_8-voices.npz` and `kitten_tts_nano_v0_8-config.json` (Apache-2.0). About 105 MB together. macOS x64 has no engine: ONNX Runtime has no prebuilt static library for that target (`native/onnx-provenance.json`).

Speech cleanup is plain TypeScript (`src/modules/speech/cleanup.ts`), ported from the pinned engine's rule-based cleanup with the same output. It needs no engine or file, so it is registered whenever the speech module is on. The transcription and synthesis tools stay registered while files are missing, on a platform that has an engine. The first call that needs a missing file, and `/utilities-speech-install`, assert `utilities_speech_download` first. The resource is the release host. `metadata.bytes` is the size. Transcription needs the engine and the Whisper model. Synthesis also needs the three Kitten files.

A download goes to a private temporary file in the destination directory, never above the pinned size. Only a file whose size and SHA-256 match is given its mode and renamed into `$XDG_CACHE_HOME/opencode-utilities/<sha256>/<name>`. A cross-instance lock covers each file. Unverified bytes are never executed. `fetch` is the runtime's fetch; a proxy has to be visible to that fetch. The call's abort signal applies. A stall of 60 seconds with no bytes fails the download.

`speech.assetsDir` skips the network. Each `<assetsDir>/<name>` is hash-checked. A miss or a mismatch is `SPEECH_ASSETS_MISSING`, not a download.

Synthesis writes a PCM16 WAV. The default path is `$XDG_DATA_HOME/opencode-utilities/speech/<project-scope>/<id>.wav`. Files there older than 7 days, and `jobs/job-*` directories older than 10 minutes, are removed at startup. A path the caller chose is not swept. The tool returns the path, size, hash, duration, sample rate, channels and voice. There is no artifact broker.

Transcription identifies the source before the prompt, re-checks it after approval, and refuses a symbolic link or a file that changed. The WAV parser accepts ancillary chunks (`JUNK`, `LIST`, `FLLR`, `bext` and others) and rejects compressed, float, extensible and malformed files. The bridge does not call ffmpeg.

## Bridge protocol

One process reads one UTF-8 JSON line from stdin and writes one JSON line. The line limit is 32 KiB in and 1 MiB out, including the newline. Unknown fields fail. Native stdout and stderr are diverted; the response uses a saved descriptor, so native diagnostics are not the protocol.

```json
{"protocolVersion":1,"requestId":"<uuid>","operation":"synthesize","cacheRoot":"<job cache>","payload":{"text":"Example","outputPath":"<job>/output.wav","modelPath":"<model>","voicesPath":"<voices>","configPath":"<config>"}}
```

`operation` is `transcribe` or `synthesize`. There is no capabilities call. Administrative paths come from the verified manifest or the private job directory, never from an unsanitised tool argument.

| Operation | Payload | Result |
| --- | --- | --- |
| `transcribe` | `{inputPath, modelPath, language?}` | Core STT DTO, `schema_version` 2 |
| `synthesize` | `{text, outputPath, modelPath, voicesPath, configPath, voice?}` | `{meta, outputPath}` with core TTS metadata, `schema_version` 1 |

The three Kitten files are separate paths. The content-addressed cache keeps each file in its own directory, so there is no shared `modelRoot`.

A success is `{"protocolVersion":1,"requestId":"<uuid>","ok":true,"result":...}`. A failure is `{"ok":false,"error":{"code":"..."}}` with the same protocol and request ID. An invalid envelope has an empty request ID. The TypeScript adapter checks the request ID and the output schema. Error codes do not contain input text or paths.

Transcription language defaults to detection. Synthesis defaults to the voice `Luna`. The bridge accepts at most 5,000 characters and writes at most 50 MiB. It also applies a 115-second core deadline. The parent enforces the 120-second module deadline, escalates to `SIGKILL`, and reaps the child. The bridge is not an authorisation boundary.

## Native build

Programs, the speech engine, the models, `NOTICE`, `provenance.json` and both manifests are build outputs. They are gitignored. A clone does not contain them. Contributors need the Rust 1.96.0 toolchain from rustup, plus a C toolchain. `npm run native:build` builds the host platform. It refuses to run without that toolchain.

```sh
npm run native:build
```

`NATIVE_BUILD_ROOT` holds source checkouts and Cargo's target directory. It must be outside the repository and must not contain spaces. The default is `$XDG_CACHE_HOME/opencode-utilities-native-build` (or `~/.cache/opencode-utilities-native-build`). Rust and C paths are remapped (`/cargo`, `/build`, `/utilities`) so a binary we compile does not embed a builder's home directory. Strings already compiled into the pinned ONNX Runtime static library are not rewritten. macOS builds set `MACOSX_DEPLOYMENT_TARGET=14.0` and `GGML_NATIVE=OFF`.

The script checks the pinned commits and lockfiles, builds time-keep and weather-signal into `npm/opencode-utilities-bin-<platform>/bin/`, and, where ONNX Runtime has a static library, builds `utilities-speech-<platform>` into `build/speech-assets/`. `scripts/native-models.mjs` fetches the four pinned models into that same directory and checks size and SHA-256. `scripts/native-onnx.mjs` does the same for the ONNX static library. Neither runs on install or during a tool call. The recipe does not claim byte-identical output across linkers. The manifests record the hashes of the bytes just built.

`npm run check` runs `native:ensure` first. That builds this platform when an output is missing or an input changed, and does nothing when the files are current. Without Rust it fails and names `rustup toolchain install 1.96.0`. CI still runs `npm run native:build` before check, so the ensure step finds the files already built. `release.yml` builds the four platforms on hosted runners, attests the artifacts, uploads the speech engine, models and model licences to the GitHub Release, publishes the platform packages, then the GitHub Release, then the main package. [CONTRIBUTING.md](../CONTRIBUTING.md#releasing) lists the release steps.

## Licences

`licenses/upstream/` holds the committed licence texts for the pinned programs, models and ONNX Runtime. The platform `NOTICE` and `build/speech-assets/utilities-speech-NOTICE.txt` are generated at build time from those texts and the locked Cargo graphs, including build dependencies. They are not committed. Identical texts in one notice are printed once. The npm package does not carry `licenses/`: each licence ships with what it covers. See [licenses/README.md](../licenses/README.md).

Weather data terms are separate from the software licences. Results and the README carry `Weather data by Open-Meteo.com (CC BY 4.0)`.
