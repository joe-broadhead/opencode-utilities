import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { sessionsInput, sessionsOutput } from "../provider/modules/sessions/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

/** The session stopgap over the public session API: status, outcome, cost, tokens and time windows. */
export function sessions(provider: Provider): MethodHandler {
  return {
    description: TEXTS.sessions,
    input: inputJson(sessionsInput),
    output: outputJson(sessionsOutput),
    run: guard(input => provider.sessions(input)),
  }
}
