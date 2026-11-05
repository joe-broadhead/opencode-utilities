---
name: utilities-speech
description: Transcribe WAV recordings and turn text into a WAV file, all on this machine.
---

# Speech

Speech runs on this machine. Nothing is sent to a speech service.

## First use

Transcription and synthesis need an engine and models (about 105 MB), downloaded the first time one of those tools needs them. The call asks the user for permission first. If the user declines, or the machine is offline, say so and mention:

- `/utilities-speech-install` downloads them ahead of time;
- the `speech.assetsDir` plugin option uses copies that are already on disk.

`utilities_status` shows what is downloaded.

## Transcribe

`utilities_speech_transcribe` with `path`, relative to the project or absolute. The file must be a PCM16 WAV file, mono or stereo, 8 to 48 kHz, up to 20 MiB and ten minutes. Reading a file outside the project asks first. For other formats, ask the user to convert the file to WAV first.

Pass `language` (for example `en`) when you know it. Otherwise it is detected.

## Speak

`utilities_speech_synthesize` with `text` (up to 5,000 characters) writes a WAV file and returns its `path`. It asks for permission first.

- Pass `path` to choose where the file goes. The path must end in `.wav` and must not exist yet.
- Pass `voice` to choose a voice from the list in `utilities_status`.

Tell the user where the file is and how to play it, for example `afplay <path>` on macOS.
