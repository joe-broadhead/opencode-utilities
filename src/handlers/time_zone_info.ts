import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeZoneInfo(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_zone_info,
    input: inputJson(timeInputs.timezone_info),
    output: outputJson(timeOutputs.timezone_info),
    run: guard((input, call) => provider.invoke("time_zone_info", input, call.signal)),
  }
}
