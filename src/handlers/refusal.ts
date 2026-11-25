import { RegisterError, refusal } from "@we-the-rebel-alliance/plugin-contract/register"
import { UtilitiesError } from "../domain/common.js"
import type { FailureCode } from "../domain/contract.js"

type ContractCode = Parameters<typeof refusal>[0]

/**
 * The contract code each provider failure reports as. The contract's error table is closed (the manifest declares no
 * extra codes), so a provider code keeps its name and next step in the sentence while the envelope carries the closest
 * table code: a bad input or state is `INPUT_INVALID`, an oversized answer is `TOO_LARGE`, everything else is
 * `UNAVAILABLE`.
 */
const CONTRACT_CODE: Readonly<Partial<Record<FailureCode, ContractCode>>> = {
  TIME_NONEXISTENT: "INPUT_INVALID",
  TIME_AMBIGUOUS: "INPUT_INVALID",
  TIME_OFFSET_MISMATCH: "INPUT_INVALID",
  TIME_OUT_OF_RANGE: "INPUT_INVALID",
  HOLIDAY_COVERAGE: "INPUT_INVALID",
  TIMER_EXISTS: "INPUT_INVALID",
  TIMER_NOT_FOUND: "INPUT_INVALID",
  TIMER_QUOTA: "INPUT_INVALID",
  TIMER_BYTE_QUOTA: "INPUT_INVALID",
  SOURCE_REJECTED: "INPUT_INVALID",
  SOURCE_CHANGED: "INPUT_INVALID",
  WAV_INVALID: "INPUT_INVALID",
  WAV_UNSUPPORTED: "INPUT_INVALID",
  AUDIO_DURATION_LIMIT: "INPUT_INVALID",
  OUTPUT_EXISTS: "INPUT_INVALID",
  UNSAFE_PATH: "INPUT_INVALID",
  INPUT_INVALID: "INPUT_INVALID",
  INPUT_LIMIT: "INPUT_INVALID",
  OPTIONS_INVALID: "OPTIONS_INVALID",
  OUTPUT_LIMIT: "TOO_LARGE",
  STDOUT_LIMIT: "TOO_LARGE",
  STDERR_LIMIT: "TOO_LARGE",
}

const NEXT = "Retry the call; if it keeps failing, call tools.utilities.diagnose."

/**
 * Run one handler body, turning the provider's own refusal into the contract's: `CODE: what happened. Next step: what
 * to do.` A `RegisterError` and any other error pass through, so the register keeps its own mapping.
 */
export function guard<A extends unknown[], R>(body: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await body(...args)
    } catch (error) {
      if (error instanceof UtilitiesError) throw new RegisterError(refusal(CONTRACT_CODE[error.code] ?? "UNAVAILABLE", `${error.code}: ${error.message}`, error.hint ?? NEXT))
      throw error
    }
  }
}
