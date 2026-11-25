import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { timeInputs, timeOutputs } from "../provider/modules/time/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function timeFormat(provider: Provider): MethodHandler {
  return {
    description: TEXTS.time_format,
    input: inputJson(timeInputs.date_format),
    output: outputJson(timeOutputs.date_format),
    run: guard((input, call) => provider.invoke("time_format", input, call.signal)),
  }
}
