import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeZones(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_zones,
    input: inputJson(timeInputs.list_timezones),
    output: outputJson(timeOutputs.list_timezones),
    run: guard((input, call) => provider.invoke("time_zones", input, call.signal)),
  }
}
