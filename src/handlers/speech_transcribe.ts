import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { speechInputs, speechOutputs } from "../provider/modules/speech/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function speechTranscribe(provider: Provider): MethodHandler {
  return {
    description: TEXTS.speech_transcribe,
    input: inputJson(speechInputs.transcribe),
    output: outputJson(speechOutputs.transcribe),
    run: guard((input, call) => provider.invoke("speech_transcribe", input, call.signal)),
  }
}
