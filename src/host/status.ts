import { DEFAULT_ASK, type Access, type Runtime, type StatusView } from "../domain/contract.js"
import { completeStatus } from "../rpc.js"
import type { HostCheck } from "./compat.js"
import { defaultRules, unguardedAgents } from "./permissions.js"
import type { WeatherKey } from "./weather.js"

export interface StatusSources {
  readonly version: string
  readonly host: HostCheck
  readonly runtime: Pick<Runtime, "status">
  readonly weather: Pick<WeatherKey, "status">
  /** Read lazily: OpenCode creates config-only agents after plugins set up. */
  readonly agents: () => Promise<readonly { readonly id: string; readonly permissions: readonly { action: string; resource: string; effect: "allow" | "ask" | "deny" }[] }[]>
  /** The plugin's own skills, by id and file. */
  readonly ownSkills: readonly { readonly name: string; readonly path: string }[]
  /** The skills OpenCode lists for this location. A list that fails only hides shadowed skills. */
  readonly skills: () => Promise<readonly { readonly id: string; readonly path: string }[]>
  /** What the generated default rules allow, from the plugin options. */
  readonly access?: Access
}

/** OpenCode loads one skill per id, so a user's skill with one of the plugin's ids takes the place of the plugin's own. */
const shadowed = (own: StatusSources["ownSkills"], listed: Awaited<ReturnType<StatusSources["skills"]>>) =>
  own.flatMap(skill => listed.filter(other => other.id === skill.name && other.path !== skill.path).map(other => ({ name: skill.name, path: other.path })))

/** Joins the runtime's items with the host's. The result has no undefined fields, so it crosses RPC as JSON. */
export async function buildStatus(sources: StatusSources): Promise<StatusView> {
  const [runtime, weather, agents, skills] = await Promise.all([sources.runtime.status(), sources.weather.status(), sources.agents(), sources.skills().catch(() => [])])
  const view = completeStatus({
    version: sources.version,
    host: sources.host,
    unguardedAgents: unguardedAgents(agents, sources.access ?? "all"),
    platform: runtime.platform,
    modules: runtime.modules,
    weather,
    speech: runtime.speech,
    timers: runtime.timers,
    shadowedSkills: shadowed(sources.ownSkills, skills),
    permissions: { askByDefault: (sources.access ?? "all") === "all" ? [] : [...DEFAULT_ASK], block: [...defaultRules(sources.access ?? "all")] },
    access: sources.access ?? "all",
  })
  return JSON.parse(JSON.stringify(view)) as StatusView
}
