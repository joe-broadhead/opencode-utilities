import * as z from "zod"
import { parse } from "../domain/common.js"
import { NAMESPACE, TOOLS, toolRegistrable, type Effect, type ToolName } from "../domain/contract.js"
import { TOOL_DEFINITIONS } from "../domain/registry.js"
import { registerToolsRpc, type JsonSchema, type OwnedMethod, type ToolsRpcContext } from "./tools-rpc.js"
import { runTool, type ToolSources } from "./tools.js"

/**
 * The tools RPC `utilities.tools.tools`: the tools that change nothing as RPC methods of the same name, so a script can
 * call them with no model, as a session and the agent it names (src/host/tools-rpc.ts, docs/scripting.md).
 *
 * Each method runs the tool's own path: the same input schema, the same runtime call and the same asserts as the
 * model's tool, with the script's call as the invocation. Weather and the speech download ask by default, so a script
 * is refused them until an allow rule exists. Writes (timer_set, timer_delete) and the file write (speech_synthesize)
 * are never methods, whatever the rules say.
 */

/** The effects a script may run. write-state and write-file are left out, so a new tool that writes is never a method. */
export const SCRIPT_EFFECTS: ReadonlySet<Effect> = new Set(["compute", "read-state", "network", "read-file"])

/** The tools that are methods, in the registry's order. */
export const SCRIPT_TOOLS: readonly ToolName[] = TOOL_DEFINITIONS.map(tool => tool.name).filter(name => SCRIPT_EFFECTS.has(TOOLS[name].effect))

const schema = (type: z.ZodType, io: "input" | "output") => z.toJSONSchema(type, { io, unrepresentable: "any" }) as JsonSchema

/** One method per scriptable tool. `available` follows the tool list: a method is available when the model's tool is registered. */
export function scriptMethods(sources: ToolSources): OwnedMethod[] {
  return TOOL_DEFINITIONS.filter(tool => SCRIPT_TOOLS.includes(tool.name)).map(tool => ({
    name: tool.name,
    action: `${NAMESPACE}_${tool.name}`,
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
  return registerToolsRpc(ctx, { owned: scriptMethods(sources) })
}
