import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeBusinessDays(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_business_days,
    input: inputJson(timeInputs.business_days),
    output: outputJson(timeOutputs.business_days),
    run: guard((input, call) => provider.invoke("time_business_days", input, call.signal)),
  }
}
