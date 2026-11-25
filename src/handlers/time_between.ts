import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeBetween(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_between,
    input: inputJson(timeInputs.date_diff),
    output: outputJson(timeOutputs.date_diff),
    run: guard((input, call) => provider.invoke("time_between", input, call.signal)),
  }
}
