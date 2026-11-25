# Accounts

Utilities signs in to nothing, so it has no accounts: `capabilities.accounts` is absent, every method is
`accounts: "none"`, no method takes an `account` field, and `status` reports an empty account list. There is no
`accounts` option and no `probe` method.

The one optional credential is an **OpenCode integration**, not an account:

| Integration | Holds | Signed in with |
|---|---|---|
| `open-meteo` | an Open-Meteo commercial API key | `/connect`, or `opencode auth login open-meteo` |

OpenCode keeps the key; the plugin resolves it at call time and passes it to `weather-signal` in the environment. A key
Open-Meteo rejects is reported by `diagnose` (`weather.key: "rejected"`) and cleared on the next successful call.
Without a key the free tier is used, which is for non-commercial use.

## Picking an account in a call

There is none to pick: no method takes `account`, and one passed to a method is refused with `INPUT_INVALID`. The
bus `changed` event carries the contract's `default` alias, because a method with no account runs as it.
