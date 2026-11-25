import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeAdd(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_add,
    input: inputJson(timeInputs.date_arithmetic),
    output: outputJson(timeOutputs.date_arithmetic),
    run: guard((input, call) => provider.invoke("time_add", input, call.signal)),
  }
}
