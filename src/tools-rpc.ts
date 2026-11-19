/**
 * Utilities' part of the tools RPC (`utilities.local.tools`): the plugin value and the method table that the source
 * contract's `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport the plugin family shares:
 *
 *   POST /api/rpc/utilities.local.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the method's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. Utilities has no MCP server, so every method is plugin-owned and built in setup.
 */
import { toolsRpcId, type Failure, type McpResult, type MethodSpec, type NextSteps, type ShapeCall, type ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { FAILURES } from "./domain/common.js"
import { PLUGIN_ID as UTILITIES_ID } from "./domain/contract.js"
import { isFailure } from "./host/errors.js"

/** The plugin's id. The RPC id is `<PLUGIN_ID>.tools`: `utilities.local.tools`. */
export const PLUGIN_ID = UTILITIES_ID

/** The RPC's id: the plugin's id and `.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Utilities has no MCP server, so every method is a plugin-owned tool: the table is `TOOL_DEFINITIONS`, whose classes
 * come from each tool's effect (src/domain/contract.ts `methodClass`). `scriptMethods` (src/host/scripting.ts) builds
 * the methods from that table in setup, where they have the runtime and the plugin's context.
 */
export const METHODS: readonly MethodSpec[] = []

/** Utilities has no `execute.before` hook: a script's arguments reach the tool exactly as a model's do. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/** Utilities has no `execute.after` hook: a tool's own rendering is inside its run, so a script reads the same. */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  return result
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the action to the session's agent or to the session, or use a session whose agent allows it.",
  CANCELLED: "Call the method again if you still need the result.",
}

/**
 * A Utilities failure from a tool's own run: its code, what happened and its next step, as the model reads them. The
 * messages never carry input values, keys or signed URLs (AGENTS.md, Errors).
 */
export function pluginError(error: unknown): Failure | undefined {
  if (!isFailure(error)) return undefined
  return { code: error.code, what: error.message, next: error.hint ?? FAILURES.OPERATION_FAILED[1]! }
}

/** The plugin value the transport takes. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
