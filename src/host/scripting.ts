import * as z from "zod"
import { parse } from "../domain/common.js"
import { NAMESPACE, TOOLS, methodClass, toolRegistrable, type ToolName } from "../domain/contract.js"
import { TOOL_DEFINITIONS } from "../domain/registry.js"
import { registerToolsRpc, type JsonSchema, type PluginMethod, type ToolsRpcContext } from "./tools-rpc.js"
import { runTool, type ToolSources } from "./tools.js"

/**
 * The tools RPC `utilities.local.tools`: every tool as an RPC method of the same name, so a script can call it with no
 * model, as a session and the agent it names (src/host/tools-rpc.ts, docs/scripting.md).
 *
 * Each method runs the tool's own path: the same input schema, the same runtime call and the same asserts as the
 * model's tool, with the script's call as the invocation. Weather, the timer writes and the speech write ask by
 * default, so a script is refused them until a prior allow rule exists: an ask cannot be answered here.
 */

/** The tools that are methods, in the registry's order: every tool. */
export const SCRIPT_TOOLS: readonly ToolName[] = TOOL_DEFINITIONS.map(tool => tool.name)

const schema = (type: z.ZodType, io: "input" | "output") => z.toJSONSchema(type, { io, unrepresentable: "any" }) as JsonSchema

/** One method per tool. `available` follows the tool list: a method is available when the model's tool is registered. */
export function scriptMethods(sources: ToolSources): PluginMethod[] {
  return TOOL_DEFINITIONS.map(tool => ({
    kind: "plugin",
    name: tool.name,
    action: `${NAMESPACE}_${tool.name}`,
    class: methodClass(tool.name),
    description: tool.description,
    input: schema(tool.input, "input"),
    output: schema(tool.output, "output"),
    available() {
      const modules = sources.modules()
      return tool.module === undefined || toolRegistrable(tool.name, modules) ? undefined : modules[tool.module].availability
    },
    // OpenCode does not check an RPC method's inner input, so it is parsed here as the host parses the tool's.
    run: async (input, call) => (await runTool(sources, tool.name, parse(tool.input, input, "INPUT_INVALID"), call)).output,
  }))
}

export function registerScripting(ctx: ToolsRpcContext, sources: ToolSources) {
  return registerToolsRpc(ctx, { methods: scriptMethods(sources) })
}
