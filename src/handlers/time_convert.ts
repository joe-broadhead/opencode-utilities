import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeConvert(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_convert,
    input: inputJson(timeInputs.convert_timezone),
    output: outputJson(timeOutputs.convert_timezone),
    run: guard((input, call) => provider.invoke("time_convert", input, call.signal)),
  }
}
