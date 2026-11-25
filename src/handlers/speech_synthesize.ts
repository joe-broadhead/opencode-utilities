import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { speechInputs, speechOutputs } from "../provider/modules/speech/contracts.js"
import { guard } from "./refusal.js"
import { notify } from "./notify.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function speechSynthesize(provider: Provider): MethodHandler {
  return {
    description: TEXTS.speech_synthesize,
    input: inputJson(speechInputs.synthesize),
    output: outputJson(speechOutputs.synthesize),
    run: guard(async (input, call) => {
      const answer = await provider.invoke("speech_synthesize", input, call.signal)
      await notify(call, "utilities.speech", "write")
      return answer
    }),
  }
}
