import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timerList(provider: Provider): MethodHandler {
  return {
    description: TEXTS.timer_list,
    input: inputJson(timeInputs.timer_list),
    output: outputJson(timeOutputs.timer_list),
    run: guard((input, call) => provider.invoke("timer_list", input, call.signal)),
  }
}
