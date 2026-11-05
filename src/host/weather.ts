import type { Plugin } from "@opencode/plugin"
import { WEATHER_ATTRIBUTION, WEATHER_INTEGRATION, type StatusView } from "../domain/contract.js"

type Integration = Plugin.Context["integration"]
type Connection = NonNullable<Awaited<ReturnType<Integration["connection"]["active"]>>>

const CONNECT = "Run /connect and choose Open-Meteo"
const REJECTED = `Open-Meteo rejected the API key. ${CONNECT}, then enter a valid key, or run opencode auth logout open-meteo to use the free tier.`

/** The optional commercial key: a public `key` method, so users add it from /connect, or with `opencode auth login open-meteo`. */
export function registerWeatherIntegration(integration: Pick<Integration, "transform">) {
  return integration.transform(editor => {
    editor.update(WEATHER_INTEGRATION, item => { item.name = "Open-Meteo" })
    editor.method.update({ integrationID: WEATHER_INTEGRATION, method: { type: "key", label: "Open-Meteo commercial API key" } })
  })
}

export function createWeatherKey(integration: Pick<Integration, "connection">) {
  let last: Connection | undefined
  return {
    /** The runtime's `weatherKey`: the connected key, or undefined for the free tier. */
    async key() {
      last = await integration.connection.active(WEATHER_INTEGRATION)
      if (!last) return undefined
      const credential = await integration.connection.resolve(last)
      return credential?.type === "key" ? credential.key : undefined
    },
    /** After a weather call: mark the key as needing sign-in when Open-Meteo rejected it, and clear that once it works. Best effort. */
    async settle(rejected: boolean) {
      const connection = last
      if (!connection || (!rejected && !connection.status)) return
      await integration.connection.status({ integrationID: WEATHER_INTEGRATION, connection, status: rejected ? { status: "needs_auth", message: REJECTED } : undefined }).catch(() => undefined)
    },
    async status(): Promise<StatusView["weather"]> {
      const connection = await integration.connection.active(WEATHER_INTEGRATION)
      if (!connection) return { tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION, next: `The free tier is for non-commercial use only and is rate-limited. For commercial use, add an API key: run /connect and choose Open-Meteo.` }
      if (connection.status) return { tier: "commercial", key: "rejected", attribution: WEATHER_ATTRIBUTION, next: REJECTED }
      return { tier: "commercial", key: "connected", attribution: WEATHER_ATTRIBUTION }
    },
  }
}
export type WeatherKey = ReturnType<typeof createWeatherKey>
