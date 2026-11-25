import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { InstallOutputSchema } from "./install-output.js"
import { notify } from "./notify.js"
import { guard } from "./refusal.js"
import { NO_INPUT, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

/** Download the on-device speech engine and models. The speech tools refuse SPEECH_ASSETS_MISSING until this has run. */
export function speechInstall(provider: Provider): MethodHandler {
  return {
    description: TEXTS.speech_install,
    input: NO_INPUT,
    output: outputJson(InstallOutputSchema),
    run: guard(async (_input, call) => {
      const answer = await provider.installSpeech(call.signal)
      await notify(call, "utilities.speech", "install")
      return answer
    }),
  }
}
