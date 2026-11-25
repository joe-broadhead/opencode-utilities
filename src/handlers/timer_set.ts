import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { notify } from "./notify.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timerSet(provider: Provider): MethodHandler {
  return {
    description: TEXTS.timer_set,
    input: inputJson(timeInputs.timer_set),
    output: outputJson(timeOutputs.timer_set),
    run: guard(async (input, call) => {
      const answer = await provider.invoke("timer_set", input, call.signal)
      await notify(call, "utilities.timers", "write")
      return answer
    }),
  }
}
