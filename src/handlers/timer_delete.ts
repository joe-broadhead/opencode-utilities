import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { notify } from "./notify.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timerDelete(provider: Provider): MethodHandler {
  return {
    description: TEXTS.timer_delete,
    input: inputJson(timeInputs.timer_delete),
    output: outputJson(timeOutputs.timer_delete),
    run: guard(async (input, call) => {
      const answer = await provider.invoke("timer_delete", input, call.signal)
      await notify(call, "utilities.timers", "write")
      return answer
    }),
  }
}
