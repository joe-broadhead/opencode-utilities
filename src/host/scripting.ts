import * as z from "zod"
import { parse } from "../domain/common.js"
import { DEPRECATED_IDS, NAMESPACE, TOOLS, methodClass, toolRegistrable, type ToolName } from "../domain/contract.js"
import { TOOL_DEFINITIONS } from "../domain/registry.js"
import { registerToolsRpc, type JsonSchema, type PluginMethod, type ToolsRpcContext } from "./tools-rpc.js"
import { runTool, type ToolSources } from "./tools.js"

/**
 * The tools RPC `utilities.local.tools`: every tool as an RPC method of the same name, so a script can call it with no
 * model, as a session and the agent it names (src/host/tools-rpc.ts, docs/scripting.md).
 *
 * Each method runs the tool's own path: the same input schema, the same runtime call and the same asserts as the
 * model's tool, with the script's call as the invocation. Every tool is allowed by default; the `access` option and a
 * script's own rules restrict it, and an ask is refused because no one is there to answer it.
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

type Handler = (raw: unknown, context: never) => unknown

/** The contract the shared module builds: an id, and one entry per method with its schemas. */
interface Contract {
  readonly id: string
  readonly methods: Readonly<Record<string, { readonly input: unknown; readonly output: unknown; readonly errors?: unknown }>>
}

/**
 * Registers the tools RPC, and the id it had before the rename (`utilities.tools.tools`) alongside it. The shared module
 * builds one contract, so a context whose `register` takes every contract twice gives the old id the same handlers,
 * the same resolve and the same refusal, and its `describe` says it is deprecated. The old id answers until the next
 * minor release.
 */
export function registerScripting(ctx: ToolsRpcContext, sources: ToolSources, onAliasCalled?: () => void) {
  type Registration = { dispose(): Promise<void> }
  const register = ctx.rpc.register.bind(ctx.rpc) as unknown as (contract: { readonly id: string }, handlers: Record<string, Handler>) => Promise<Registration>
  const both = async (contract: Contract, handlers: Record<string, Handler>) => {
    const stopping = await register(contract, handlers)
    // The alias marks itself on any call, and its describe carries the note.
    const aliasHandlers: Record<string, Handler> = Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => [name, async (raw: unknown, context: never) => {
        onAliasCalled?.()
        const value = await handler(raw, context) as Record<string, unknown>
        return name === "describe" ? { ...value, deprecated: `use ${DEPRECATED_IDS.use}.tools` } : value
      }]),
    )
    // The host validates an output against its declared schema, so the alias's describe declares the extra field.
    const describe = contract.methods.describe,
          output = describe.output as { readonly properties?: Record<string, unknown> }
    const aliasContract: Contract = {
      ...contract,
      id: DEPRECATED_IDS.tools,
      methods: {
        ...contract.methods,
        describe: { ...describe, output: { ...output, properties: { ...output.properties, deprecated: { type: "string" } } } },
      },
    }
    const aliasing = await register(aliasContract, aliasHandlers)
    return {
      dispose: async () => {
        await aliasing.dispose().catch(() => undefined)
        await stopping.dispose().catch(() => undefined)
      },
    }
  }
  const aliasing = { ...ctx, rpc: { ...ctx.rpc, register: both } } as unknown as ToolsRpcContext
  return registerToolsRpc(aliasing, { methods: scriptMethods(sources) })
}
