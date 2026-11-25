import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"

/**
 * The agents whose own rules no longer give the generated access rules their effect. The call asks the host's agent
 * list when it runs, so status reads no state kept at setup.
 *
 * A failure here is unknown, never zero: the caller records the reason instead. The freeze change to
 * `{ ok, agents | error }` replaces the try/catch in this one helper.
 */
export async function unguarded(call: Pick<MethodCall, "unguardedAgents">): Promise<{ readonly agents: readonly string[]; readonly problem?: string }> {
  try {
    return { agents: await call.unguardedAgents() }
  } catch (error) {
    return { agents: [], problem: error instanceof Error ? error.message : String(error) }
  }
}
