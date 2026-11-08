import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { formatFailure, UtilitiesError } from "../domain/common.js"
import { loadConfig } from "../domain/config.js"
import { MODULES, PLUGIN_ID, TOOLS, registrable, toolRegistrable, type CreateRuntime, type Module, type StatusView, type ToolName } from "../domain/contract.js"
import { Utilities } from "../rpc.js"
import { StatusSchema } from "./status-schema.js"
import { commandTransform } from "./commands.js"
import { checkHost } from "./compat.js"
import { createAuthorize, insertDefaultRules } from "./permissions.js"
import { registerScripting } from "./scripting.js"
import { loadSkills, skillTransform } from "./skills.js"
import { buildStatus } from "./status.js"
import { toolTransform } from "./tools.js"
import { createWeatherKey, registerWeatherIntegration } from "./weather.js"

export interface PluginSources {
  readonly createRuntime: CreateRuntime
  /** The installed package root, which holds package.json, manifest/ and skills/. */
  readonly packageRoot: string
}

export function createPlugin({ createRuntime, packageRoot }: PluginSources): Plugin.Plugin {
  return {
    id: PLUGIN_ID,
    async setup(ctx) {
      const config = loadConfig(ctx.options)
      const host = checkHost(ctx.app.version, config.allowUntestedHost)
      if (host.next) console.warn(formatFailure({ code: "HOST_UNTESTED", message: `OpenCode ${host.version} is not a tested host for Utilities (supported range ${host.range}).`, hint: host.next }))
      const version = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version
      const weather = createWeatherKey(ctx.integration)
      const runtime = await createRuntime({
        location: { project: ctx.location.project.id, directory: ctx.location.directory, projectDirectory: ctx.location.project.directory },
        authorize: createAuthorize(input => ctx.permission.assert(input)),
        modules: config.modules,
        stateRoot: config.stateRoot,
        cacheRoot: config.cacheRoot,
        ...(config.speechAssetsDir ? { speechAssetsDir: config.speechAssetsDir } : {}),
        weatherKey: weather.key,
        packageRoot,
      })
      const shutdown = new AbortController()
      let unsubscribe = () => {}, stopScripting = async () => {}
      const close = async () => { shutdown.abort(); unsubscribe(); await stopScripting(); await runtime.close() }
      try {
        let modules = (await runtime.status()).modules
        const enabled = (module: Module) => registrable(module, modules[module].availability)
        const skills = await loadSkills(packageRoot)
        const status = (): Promise<StatusView> => buildStatus({
          version, host, runtime, weather, agents: async () => (await ctx.agent.list()).data,
          ownSkills: skills.map(skill => ({ name: skill.id, path: skill.info.path })),
          skills: async () => (await ctx.skill.list({ location: { directory: ctx.location.directory } })).data,
          access: config.access,
        })
        await registerWeatherIntegration(ctx.integration)
        await ctx.agent.transform(insertDefaultRules(config.access))
        const sources = { runtime, weather, status, modules: () => modules }
        await ctx.tool.transform(toolTransform(sources))
        await ctx.rpc.register(Utilities, {
          status: async (_input, context) => {
            try { return StatusSchema.parse(await status()) }
            catch {
              const failure = new UtilitiesError("STATUS_UNAVAILABLE")
              return context.error("unavailable", formatFailure(failure), { nextStep: failure.hint! })
            }
          },
        })
        // Scripts call the tools that change nothing with no model, as a session and its agent (docs/scripting.md).
        stopScripting = await registerScripting(ctx, sources)
        await ctx.command.transform(commandTransform({ assert: input => ctx.permission.assert(input), synthetic: input => ctx.session.synthetic(input), runtime, status, signal: shutdown.signal }))
        await ctx.skill.transform(skillTransform(skills, enabled))
        // Availability changes, such as a finished speech download, rebuild the tool and skill lists.
        let refreshing = Promise.resolve()
        unsubscribe = runtime.onAvailabilityChange(() => {
          refreshing = refreshing.then(async () => {
            if (shutdown.signal.aborted) return
            const next = (await runtime.status()).modules
            const same = MODULES.every(m => enabled(m) === registrable(m, next[m].availability))
              && (Object.keys(TOOLS) as ToolName[]).every(tool => toolRegistrable(tool, modules) === toolRegistrable(tool, next))
            if (same) { modules = next; return }
            modules = next
            await ctx.tool.reload()
            await ctx.skill.reload()
          }).catch(() => console.warn(formatFailure({ code: "OPERATION_FAILED", message: "The Utilities tool list could not be refreshed after a module changed.", hint: "Restart OpenCode." })))
        })
        return close
      } catch (error) {
        await close().catch(() => undefined)
        throw error
      }
    },
  }
}
