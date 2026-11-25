import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timerGet(provider: Provider): MethodHandler {
  return {
    description: TEXTS.timer_get,
    input: inputJson(timeInputs.timer_get),
    output: outputJson(timeOutputs.timer_get),
    run: guard((input, call) => provider.invoke("timer_get", input, call.signal)),
  }
}
