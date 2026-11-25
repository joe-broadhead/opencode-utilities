import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { InstallOutputSchema } from "./install-output.js"
import { notify } from "./notify.js"
import { guard } from "./refusal.js"
import { NO_INPUT, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

/** Download the time and weather programs. A read that needs one refuses NATIVE_FILES_MISSING until this has run. */
export function nativeInstall(provider: Provider): MethodHandler {
  return {
    description: TEXTS.native_install,
    input: NO_INPUT,
    output: outputJson(InstallOutputSchema),
    run: guard(async (_input, call) => {
      const answer = await provider.installNatives(call.signal)
      await notify(call, "utilities.native", "install")
      return answer
    }),
  }
}
