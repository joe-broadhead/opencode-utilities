import { UtilitiesError, fail } from "../../../domain/common.js"

/** One resolved window, epoch milliseconds or null for an open end. */
export interface Window {
  readonly from: number | null
  readonly to: number | null
}

/** The window shapes `windowInput` accepts: an explicit range, or a length ending now. */
export type WindowValue =
  | { readonly from?: number | string | undefined; readonly to?: number | string | undefined }
  | { readonly days: number }
  | { readonly hours: number }

/**
 * Epoch milliseconds for an instant. A date-time without Z or an offset is read as UTC, as every Utilities date input
 * is; `Date` never rolls an impossible day over, because the schemas checked the calendar first (`date`'s round trip).
 */
export function epoch(value: number | string): number {
  if (typeof value === "number") return value
  const iso = value.replace(" ", "T")
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/u.test(iso) ? iso : `${value.length === 10 ? `${value}T00:00:00` : iso}Z`
  const ms = Date.parse(zoned)
  if (!Number.isFinite(ms)) fail("INPUT_INVALID", { message: "The tool input is invalid. A date is outside the range a date can hold." })
  return ms
}

/** The window a call means, and a refusal when its two ends are the wrong way round. */
export function windowOf(window: WindowValue | undefined, now: number): Window {
  if (window === undefined) return { from: null, to: null }
  if ("days" in window) return { from: now - window.days * 86_400_000, to: now }
  if ("hours" in window) return { from: now - window.hours * 3_600_000, to: now }
  const from = window.from === undefined ? null : epoch(window.from)
  const to = window.to === undefined ? null : epoch(window.to)
  if (from !== null && to !== null && from > to) fail("INPUT_INVALID", { message: "The tool input is invalid. The window's from is after its to." })
  return { from, to }
}

/** Whether an instant is inside the window. Open ends accept everything. */
export const within = (at: number, window: Window) => (window.from === null || at >= window.from) && (window.to === null || at <= window.to)

/** An ISO 8601 instant, for rendered text. */

/** An error a caller can report unchanged: its code, message and next step. */
export const isUtilitiesFailure = (error: unknown): error is UtilitiesError => error instanceof UtilitiesError
