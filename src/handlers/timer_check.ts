import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timerCheck(provider: Provider): MethodHandler {
  return {
    description: TEXTS.timer_check,
    input: inputJson(timeInputs.timer_check),
    output: outputJson(timeOutputs.timer_check),
    run: guard((input, call) => provider.invoke("timer_check", input, call.signal)),
  }
}
