import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { DiagnoseSchema, diagnoseView } from "../provider/diagnostics.js"
import { guard } from "./refusal.js"
import { NO_INPUT, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export interface DiagnoseDeps {
  readonly provider: Provider
  readonly version: string
  readonly hostVersion: string
  readonly range: string
  readonly tested: readonly string[]
  readonly access: "all" | "ask-changes" | "read-only"
  /** What setup could not finish, such as a skill file that was skipped. */
  readonly problems: readonly string[]
}

/** What this machine can do with Utilities, and why not: the module files, the weather key, the timers. */
export function diagnose(deps: DiagnoseDeps): MethodHandler {
  return {
    description: TEXTS.diagnose,
    input: NO_INPUT,
    output: outputJson(DiagnoseSchema),
    run: guard(async (_input, call) => {
      const [runtime, weather] = await Promise.all([deps.provider.runtimeStatus(call.signal), deps.provider.weatherStatus()])
      return DiagnoseSchema.parse(diagnoseView({
        version: deps.version,
        host: { version: deps.hostVersion, range: deps.range, tested: deps.tested.includes(deps.hostVersion) },
        access: deps.access,
        runtime,
        weather,
        problems: deps.problems,
      }))
    }),
  }
}
