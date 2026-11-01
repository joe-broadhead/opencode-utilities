import type { Plugin } from "@opencode/plugin"
import { NAMESPACE, toolRegistrable, type Runtime, type StatusView } from "../domain/contract.js"
import { NAMESPACE_DESCRIPTION, TOOL_DEFINITIONS } from "../domain/registry.js"
import { compactStatus, formatSummary } from "../rpc.js"
import { isFailure, mapFailures } from "./errors.js"
import type { WeatherKey } from "./weather.js"

type ToolEditor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]

export interface ToolSources {
  readonly runtime: Pick<Runtime, "invoke">
  readonly weather: Pick<WeatherKey, "settle">
  readonly status: () => Promise<StatusView>
  /** The latest module availability. Read synchronously on every rebuild. */
  readonly modules: () => StatusView["modules"]
}

/** The tool transform. It is synchronous and replayed on every rebuild, so `ctx.tool.reload()` picks up availability changes. */
export function toolTransform(sources: ToolSources) {
  return (editor: ToolEditor) => {
    editor.namespace({ name: NAMESPACE, description: NAMESPACE_DESCRIPTION })
    const modules = sources.modules()
    for (const tool of TOOL_DEFINITIONS) {
      const { name, module } = tool
      if (!toolRegistrable(name, modules)) continue
      editor.add({
        name,
        description: tool.description,
        input: tool.input,
        output: tool.output,
        options: { namespace: NAMESPACE, permission: `${NAMESPACE}_${name}`, ...(tool.pinned ? { pinned: true } : {}) },
        execute: (input, context) => mapFailures(async () => {
          if (name === "status") {
            const summary = compactStatus(await sources.status())
            return { output: summary, content: formatSummary(summary) }
          }
          const invocation = { sessionID: context.sessionID, agent: context.agent, messageID: context.messageID, id: context.id, signal: context.signal }
          if (module !== "weather") {
            const result = await sources.runtime.invoke(name, input, invocation)
            return { output: result.output, content: result.text }
          }
          try {
            const result = await sources.runtime.invoke(name, input, invocation)
            await sources.weather.settle(false)
            return { output: result.output, content: result.text }
          } catch (error) {
            if (isFailure(error) && error.code === "WEATHER_KEY_REJECTED") await sources.weather.settle(true)
            throw error
          }
        }),
      })
    }
  }
}
