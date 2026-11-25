import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { grepInput, grepOutput } from "../provider/modules/sessions/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

/**
 * The session stopgap over OpenCode's own SQLite database: a read-only connection, a clean refusal on an unknown
 * schema (the documented exception to public APIs only, standard §4 rule 1).
 */
export function sessionsGrep(provider: Provider): MethodHandler {
  return {
    description: TEXTS.sessions_grep,
    input: inputJson(grepInput),
    output: outputJson(grepOutput),
    run: guard(input => provider.grep(input)),
  }
}
