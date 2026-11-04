import type { Plugin } from "@opencode/plugin"
import { fence } from "../domain/common.js"
import { DEFAULT_ASK, SPEECH_DOWNLOAD_ACTION, TOOLS, type Authorize, type PermissionRequest, type ToolName } from "../domain/contract.js"

const WEATHER_TOOLS = (Object.keys(TOOLS) as ToolName[]).filter(tool => "module" in TOOLS[tool] && TOOLS[tool].module === "weather")

type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
type Assert = Plugin.Context["permission"]["assert"]

/** Inserted directly after each agent's base `* * allow`, so user rules, agent rules and saved approvals still win. */
export const DEFAULT_RULES: readonly Rule[] = DEFAULT_ASK.map(action => ({ action, resource: "*", effect: "ask" }))
const isBaseAllow = (rule: Rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow"

/** The agent transform. Agents without a base allow, such as those that deny everything, are left alone. */
export function insertDefaultRules(editor: { list(): readonly { readonly id: string }[]; update(id: string, update: (agent: { permissions: Rule[] }) => void): void }) {
  for (const agent of editor.list()) editor.update(agent.id, item => {
    const index = item.permissions.findIndex(isBaseAllow)
    if (index !== -1) item.permissions.splice(index + 1, 0, ...DEFAULT_RULES.map(rule => ({ ...rule })))
  })
}

const sameRule = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect

/** Host wildcards: `*` matches any run of characters and `?` one character, over the whole string. */
const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value)
/** The effect of `rules` for one request: the last matching rule wins, and no match asks. */
export function evaluate(rules: readonly Rule[], action: string, resource: string): Rule["effect"] {
  return rules.findLast(rule => matches(rule.action, action) && matches(rule.resource, resource))?.effect ?? "ask"
}
/** One request for each action the block asks, with a resource like the ones the tools assert. */
const ASKED: readonly (readonly [action: string, resource: string])[] = [
  ...WEATHER_TOOLS.map(tool => [`utilities_${tool}`, "api.open-meteo.com"] as const),
  ["utilities_timer_set", "timer:name"], ["utilities_timer_delete", "timer:name"],
  ["utilities_speech_synthesize", "kitten-nano-int8/Luna"], [SPEECH_DOWNLOAD_ACTION, "github.com"],
]

/**
 * Agents that need the fix: a base allow, no block after it, and rules of their own that would run at least one of
 * the block's actions without asking. OpenCode creates agents defined only in user config, and agents added by
 * later plugins, after this plugin's transform runs. Other plugins insert their own blocks at the same index, so the
 * block counts anywhere after the base allow. An agent whose rules already ask or deny every one is not listed.
 */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]) {
  return agents.filter(agent => {
    const rules = agent.permissions, base = rules.findIndex(isBaseAllow)
    if (base === -1) return false
    for (let start = base + 1; start + DEFAULT_RULES.length <= rules.length; start++)
      if (DEFAULT_RULES.every((rule, offset) => sameRule(rules[start + offset]!, rule))) return false
    return ASKED.some(([action, resource]) => evaluate(rules, action, resource) === "allow")
  }).map(agent => agent.id)
}

/** Waits for one plain assert, but gives up when `signal` aborts. A late approval cannot cause an effect: the fence rejects it. */
async function assertOne(assert: Assert, input: Parameters<Assert>[0], signal: AbortSignal) {
  fence(signal)
  await new Promise<void>((resolve, reject) => {
    const abort = () => { try { fence(signal) } catch (error) { reject(error) } }
    signal.addEventListener("abort", abort, { once: true })
    assert(input).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
  fence(signal)
}
const request = (item: PermissionRequest) => ({
  action: item.action,
  resources: [...item.resources],
  ...(item.save ? { save: [...item.save] } : {}),
  ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
})

/** Tool calls: each request is asserted in order as the calling tool. Host permission errors propagate unchanged. */
export function createAuthorize(assert: Assert): Authorize {
  return async (requests, invocation) => {
    for (const item of requests) await assertOne(assert, {
      sessionID: invocation.sessionID,
      agent: invocation.agent,
      source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
      ...request(item),
    }, invocation.signal)
  }
}

/** Commands have no tool call, so they assert as the session's current agent. OpenCode prompts the same way. */
export function commandAuthorize(assert: Assert, sessionID: string, signal: AbortSignal) {
  return async (requests: readonly PermissionRequest[]) => {
    for (const item of requests) await assertOne(assert, { sessionID, ...request(item) }, signal)
  }
}
