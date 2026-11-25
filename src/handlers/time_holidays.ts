import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeHolidays(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_holidays,
    input: inputJson(timeInputs.holidays),
    output: outputJson(timeOutputs.holidays),
    run: guard((input, call) => provider.invoke("time_holidays", input, call.signal)),
  }
}
