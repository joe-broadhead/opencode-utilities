import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeNow(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_now,
    input: inputJson(timeInputs.current_time),
    output: outputJson(timeOutputs.current_time),
    run: guard((input, call) => provider.invoke("time_now", input, call.signal)),
  }
}
