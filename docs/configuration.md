# Configuration

Utilities' options live in the plugin's entry in the `plugins` list of `opencode.json` (or `opencode.jsonc`). Every
option is optional, and the defaults are the narrowest that work for a fresh install.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do: reads always run; a change runs under all, asks under ask-changes, and is off under read-only. |
| `allowUntestedHost` | boolean | `false` | Start on an OpenCode release outside the tested range, instead of refusing with HOST_UNTESTED. |
| `modules` | object | `{"time":true,"weather":true,"speech":true}` | Turn a module off; its methods refuse with DISABLED and its programs are never inspected. |
| `stateRoot` | string | — | Where timers and default speech files are kept. Default: $XDG_DATA_HOME/utilities. |
| `speech` | object | — | Speech file options. |
| `sessionsDatabasePath` | string | — | OpenCode's SQLite database, opened read-only by sessions_grep. Default: $XDG_DATA_HOME/opencode/opencode.db. |
<!-- /generated:configuration -->

## Examples

Every module on, changes asked for:

```json
{
  "plugins": [
    { "package": "github:we-the-rebel-alliance/utilities-plugin#v0.0.8", "options": { "access": "ask-changes" } }
  ]
}
```

Reads only, with time and weather on and speech off, and timers under a chosen folder:

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/utilities-plugin#v0.0.8",
      "options": {
        "access": "read-only",
        "modules": { "speech": false },
        "stateRoot": "/home/me/.local/share/utilities"
      }
    }
  ]
}
```

A folder of pre-seeded speech files, so nothing is ever downloaded:

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/utilities-plugin#v0.0.8",
      "options": { "speech": { "assetsDir": "/srv/utilities-speech" } }
    }
  ]
}
```

With `speech.assetsDir` set, `speech_install` refuses rather than downloading, and a missing file is reported by
`diagnose` with the file's name.

## Notes

- `stateRoot` holds this project's timers (`projects/<hash>/timers`) and the default synthesised WAVs
  (`speech/<hash>/`). It must be private (mode 700); a wider one is refused with `STATE_NOT_PRIVATE` before any state is
  created. `$XDG_DATA_HOME/utilities` when unset.
- The cache (`$XDG_CACHE_HOME/utilities`) holds the verified programs, the speech files and Open-Meteo's
  response cache. It is not an option.
- `sessionsDatabasePath` is OpenCode's own database, opened read-only by `sessions_grep`. An unknown schema is refused
  cleanly; the plugin never writes it.
- `allowUntestedHost` exists for a release OpenCode has not tested. It covers the host version only: a database or a
  program that does not match is still refused.
