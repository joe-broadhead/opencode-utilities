# Licence records

Software licences for the native programs are separate from Open-Meteo data terms. Weather results and the README carry `Weather data by Open-Meteo.com (CC BY 4.0)`. The free tier is non-commercial.

## Committed texts

`upstream/` holds the licence texts for the pinned sources. The commits are in `native/sources.json` and `native/speech-bridge/Cargo.toml`, not in a hash manifest.

| Text | What it covers |
| --- | --- |
| `time-keep-MIT.txt`, `weather-signal-MIT.txt`, `aurum-MIT.txt` | The three pinned program sources, MIT. |
| `Whisper-MIT.txt`, `whisper-model-card.md` | Whisper tiny-q5_1 weights. The model card says MIT. The file is the OpenAI licence text. |
| `KittenTTS-Apache-2.0.txt`, `kitten-model-card.md` | Kitten nano int8. The model card says Apache-2.0. The file is the KittenTTS licence text. |
| `misaki-original-LICENSE.txt`, `misaki-original-README.md.txt` | The original Misaki lexicon, Apache-2.0. The Rust port is MIT and points readers here for dictionary licensing. The port does not link or run eSpeak. |
| `onnxruntime-LICENSE.txt`, `onnxruntime-ThirdPartyNotices.txt` | ONNX Runtime 1.28.0, linked statically into the speech engine. `native/onnx-provenance.json` records the source commit and the pinned Pyke static library. The vendor archive is not an attestation of that source commit. |
| `model-license-sources.json` | Pinned URLs for the model cards and the Misaki texts. |
| `cargo-extra-sources.json`, `cargo-extra/` | Licence texts for Cargo packages whose published archives omit a workspace licence. Each path is a source commit from that crate's `.cargo_vcs_info.json`, not a branch. |

These texts are build inputs. They are not in the npm package: each licence ships with the thing it covers.

## Where each licence ships

| Package or file | Licences beside it |
| --- | --- |
| `@joe-broadhead/opencode-utilities` (npm) | `LICENSE` (MIT) for the plugin, and `NOTICE` with the licence of every third-party package bundled into `dist/`, naming the bundle it is in (zod, in `dist/index.js` only; the TUI bundle has no third-party code). The build fails when `NOTICE` and the bundled packages stop matching. Nothing else third-party is in that package. |
| `@joe-broadhead/opencode-utilities-bin-<platform>` (npm) | `NOTICE`: time-keep and weather-signal, then the licence files of their locked Cargo graph for that platform. |
| `utilities-speech-<platform>` (GitHub Release) | `utilities-speech-NOTICE.txt` in the same release: the bridge, aurum, ONNX Runtime and its third-party notices, the original Misaki lexicon, and the bridge's locked Cargo graph. |
| The four model files (GitHub Release) | `Whisper-MIT.txt`, `whisper-model-card.md`, `KittenTTS-Apache-2.0.txt`, `kitten-model-card.md`, `misaki-original-LICENSE.txt` and `misaki-original-README.md.txt`, uploaded to the same release. |

## Generated notices

`npm run native:build` writes the two `NOTICE` files from the texts above and the locked Cargo graphs, including build and development dependencies. They are build outputs and are not in git. A licence text that is identical to one printed earlier in the same notice is printed once; later crates name it and point to the first copy.

`provenance.json` in each platform package is also generated. It records the source repository, commit, SHA-256 and toolchain for the binaries just built.

The speech engine contains `/Users/<vendor>/work/ort-artifacts/…` source paths. They come from Pyke's prebuilt static ONNX Runtime (`native/onnx-provenance.json`), not from our build machines, and we accept them rather than build ONNX Runtime from source.
