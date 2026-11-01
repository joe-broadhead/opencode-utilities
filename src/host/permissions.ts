import type { Plugin } from "@opencode/plugin"
import { fence } from "../domain/common.js"
import { DEFAULT_ASK, type Authorize, type PermissionRequest } from "../domain/contract.js"

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

/**
 * Agents with a base allow that lack the inserted rules. OpenCode creates agents defined only in user config,
 * and agents added by later plugins, after this plugin's transform runs, so side effects there do not ask.
 * Other plugins insert their own blocks at the same index, so the block counts anywhere after the base allow.
 */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]) {
  return agents.filter(agent => {
    const rules = agent.permissions, base = rules.findIndex(isBaseAllow)
    if (base === -1) return false
    for (let start = base + 1; start + DEFAULT_RULES.length <= rules.length; start++)
      if (DEFAULT_RULES.every((rule, offset) => sameRule(rules[start + offset]!, rule))) return false
    return true
  }).map(agent => agent.id)
}

/** The fix for unguarded agents: the block first in each agent's own list, followed by the user's existing utilities rules. */
export function unguardedNext(agents: readonly string[]) {
  if (agents.length === 0) return undefined
  return `Weather, timer changes, speech synthesis and the speech download run without asking in ${agents.join(", ")}, because agents defined only in your config, or added by other plugins, do not get the default ask rules. `
    + "Put the block shown with them first in each of those agents' own permissions (agents.<name>.permissions in opencode.json, or permissions in the agent's markdown front matter), "
    + "followed by any rules you already have for utilities_* actions in the top-level permissions, so yours keep winning."
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
