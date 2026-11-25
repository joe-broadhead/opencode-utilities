import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Provider } from "../provider/index.js"
import { UtilitiesError } from "../domain/common.js"
import { weatherInputs, weatherOutputs } from "../provider/modules/weather/contracts.js"
import { guard } from "./refusal.js"
import { inputJson, outputJson } from "./schema.js"
import { TEXTS } from "./texts.js"

export function weatherCurrent(provider: Provider): MethodHandler {
  return {
    description: TEXTS.weather_current,
    input: inputJson(weatherInputs.current),
    output: outputJson(weatherOutputs.current),
    run: guard(async (input, call) => {
      try {
        const answer = await provider.invoke("weather_current", input, call.signal)
        await provider.settleWeather(false)
        return answer
      } catch (error) {
        if (error instanceof UtilitiesError && error.code === "WEATHER_KEY_REJECTED") await provider.settleWeather(true)
        throw error
      }
    }),
  }
}
