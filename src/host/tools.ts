import type { Plugin } from "@opencode/plugin"
import { NAMESPACE, TOOLS, toolRegistrable, type AdapterResult, type Invocation, type Runtime, type StatusSummary, type StatusView, type ToolName } from "../domain/contract.js"
import { namespaceDescription, TOOL_DEFINITIONS } from "../domain/registry.js"
import { grep, sessions, type GrepSource, type SessionSource } from "../modules/sessions/adapter.js"
import { compactStatus, formatSummary } from "../rpc.js"
import { isFailure, mapFailures } from "./errors.js"
import type { WeatherKey } from "./weather.js"

type ToolEditor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]

/** The two session stopgaps' sources: the public session API, and OpenCode's database for the read-only search. */
export interface SessionTools {
  readonly read: SessionSource
  readonly grep: GrepSource
}

export interface ToolSources {
  readonly runtime: Pick<Runtime, "invoke">
  readonly weather: Pick<WeatherKey, "settle">
  readonly status: () => Promise<StatusView>
  readonly sessions: SessionTools
  /** The latest module availability. Read synchronously on every rebuild. */
  readonly modules: () => StatusView["modules"]
}

/**
 * One tool call, the same for the model's tool and a script's RPC method: `status` is the compact view, the session
 * stopgaps read OpenCode through their own sources, and every other tool runs its module through the runtime, which
 * checks the input and asserts what the tool needs as `invocation`.
 */
export async function runTool(sources: Omit<ToolSources, "modules">, name: ToolName, input: unknown, invocation: Invocation): Promise<AdapterResult> {
  if (name === "status") {
    const summary: StatusSummary = compactStatus(await sources.status())
    return { output: summary, text: formatSummary(summary) }
  }
  if (name === "sessions") return sessions(input, sources.sessions.read)
  if (name === "sessions_grep") return grep(input, sources.sessions.grep)
  if (TOOLS[name].module !== "weather") return sources.runtime.invoke(name, input, invocation)
  try {
    const result = await sources.runtime.invoke(name, input, invocation)
    await sources.weather.settle(false)
    return result
  } catch (error) {
    if (isFailure(error) && error.code === "WEATHER_KEY_REJECTED") await sources.weather.settle(true)
    throw error
  }
}

/** The tool transform. It is synchronous and replayed on every rebuild, so `ctx.tool.reload()` picks up availability changes. */
export function toolTransform(sources: ToolSources) {
  return (editor: ToolEditor) => {
    const modules = sources.modules()
    editor.namespace({ name: NAMESPACE, description: namespaceDescription((Object.keys(TOOLS) as ToolName[]).filter(name => toolRegistrable(name, modules))) })
    for (const tool of TOOL_DEFINITIONS) {
      const { name } = tool
      if (!toolRegistrable(name, modules)) continue
      editor.add({
        name,
        description: tool.description,
        input: tool.input,
        output: tool.output,
        options: { namespace: NAMESPACE, permission: `${NAMESPACE}_${name}`, ...(tool.pinned ? { pinned: true } : {}) },
        execute: (input, context) => mapFailures(async () => {
          const invocation = { sessionID: context.sessionID, agent: context.agent, messageID: context.messageID, id: context.id, signal: context.signal }
          const result = await runTool(sources, name, input, invocation)
          return { output: result.output, content: result.text }
        }),
      })
    }
  }
}
