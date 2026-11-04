import { formatFailure } from "../domain/common.js"
import { HOST_RANGE, inRange, TESTED_TEXT, tested, type HostCheck } from "./versions.js"

export { HOST_RANGE, TESTED_HOSTS, inRange, tested, type HostCheck } from "./versions.js"

/**
 * A tested release runs. Another release inside the range runs too, untested, with a next step. Outside the range
 * setup refuses, unless `allowUntestedHost` is set; then status keeps a warning and the next step.
 */
export function checkHost(found: string, allowUntestedHost: boolean): HostCheck {
  if (tested(found)) return { version: found, range: HOST_RANGE, tested: true }
  if (inRange(found)) return { version: found, range: HOST_RANGE, tested: false, next: `If something fails, use ${TESTED_TEXT}, the tested releases.` }
  if (!allowUntestedHost) throw new Error(formatFailure({ code: "HOST_UNTESTED", message: `Utilities supports OpenCode ${HOST_RANGE}, found ${found}.`, hint: `Use ${TESTED_TEXT}, or set the plugin option allowUntestedHost: true to run anyway.` }))
  return { version: found, range: HOST_RANGE, tested: false, next: `This OpenCode version is outside ${HOST_RANGE} and runs only because allowUntestedHost is set. If something fails, use ${TESTED_TEXT}.` }
}
