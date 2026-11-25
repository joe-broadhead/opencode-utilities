import { NO_ACCOUNTS, redactReason, STATUS_SCHEMA, statusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { TEXTS } from "./texts.js"
import { NO_INPUT } from "./schema.js"
import { unguarded } from "./unguarded.js"

export interface StatusDeps {
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
  /** What setup could not finish, such as a skill file that was skipped; the contract's status reports it as `error`. */
  readonly problems: readonly string[]
}

/**
 * The contract's own status (contract §11): identity, host range, state, the empty account list and the agents the
 * generated rules miss. `statusAnswer` assembles the whole answer; this handler only supplies what it knows.
 */
export function status(deps: StatusDeps): MethodHandler {
  return {
    description: TEXTS.status,
    input: NO_INPUT,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const agents = await unguarded(call)
      return statusAnswer({
        manifest: deps.manifest,
        version: deps.version,
        hostVersion: deps.hostVersion,
        accounts: NO_ACCOUNTS,
        problems: [...deps.problems, ...(agents.problem === undefined ? [] : [redactReason(agents.problem)])],
        unguardedAgents: agents.agents,
      })
    },
  }
}
