import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { redactReason } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { UnguardedAgentsResult } from "@we-the-rebel-alliance/plugin-contract/access"

/**
 * The agents whose own rules no longer give the generated access rules their effect, asked when status runs. The host
 * answers `{ ok, agents | error }` and never throws: `ok` is the list, and a failure is one redacted line the status
 * answer reports as a problem, with an empty list rather than a zero it did not read.
 */
export async function unguarded(call: Pick<MethodCall, "unguardedAgents">): Promise<UnguardedAgentsResult> {
  const result = await call.unguardedAgents()
  return result.ok ? { ok: true, agents: [...result.agents] } : { ok: false, error: redactReason(result.error) }
}
