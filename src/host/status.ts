import { DEFAULT_ASK, type Runtime, type StatusView } from "../domain/contract.js"
import { completeStatus } from "../rpc.js"
import type { HostCheck } from "./compat.js"
import { unguardedAgents } from "./permissions.js"
import type { WeatherKey } from "./weather.js"

export interface StatusSources {
  readonly version: string
  readonly host: HostCheck
  readonly runtime: Pick<Runtime, "status">
  readonly weather: Pick<WeatherKey, "status">
  /** Read lazily: OpenCode creates config-only agents after plugins set up. */
  readonly agents: () => Promise<readonly { readonly id: string; readonly permissions: readonly { action: string; resource: string; effect: "allow" | "ask" | "deny" }[] }[]>
}

/** Joins the runtime's items with the host's. The result has no undefined fields, so it crosses RPC as JSON. */
export async function buildStatus(sources: StatusSources): Promise<StatusView> {
  const [runtime, weather, agents] = await Promise.all([sources.runtime.status(), sources.weather.status(), sources.agents()])
  const view = completeStatus({
    version: sources.version,
    host: sources.host,
    unguardedAgents: unguardedAgents(agents),
    platform: runtime.platform,
    modules: runtime.modules,
    weather,
    speech: runtime.speech,
    timers: runtime.timers,
    permissions: { askByDefault: [...DEFAULT_ASK] },
  })
  return JSON.parse(JSON.stringify(view)) as StatusView
}
