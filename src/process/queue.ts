import { LIMITS, fail, fence, UtilitiesError, abortCode } from "../domain/common.js"
import type { Module } from "../domain/contract.js"

interface Waiter { signal: AbortSignal; resolve: () => void; abort: () => void }
/** Bounded concurrency per module, with a separate waiting bound per module, so one busy module cannot starve another. */
export class Queue {
  private active: Record<Module, number> = { weather: 0, time: 0, speech: 0 }
  private waiting: Record<Module, Waiter[]> = { weather: [], time: [], speech: [] }
  async acquire(module: Module, signal: AbortSignal) {
    fence(signal)
    if (this.active[module] < LIMITS.concurrency[module]) this.active[module]++
    else {
      const waiting = this.waiting[module]
      if (waiting.length >= LIMITS.queued[module]) fail("QUEUE_FULL")
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { signal, resolve, abort: () => {
          const index = waiting.indexOf(waiter); if (index >= 0) waiting.splice(index, 1)
          reject(new UtilitiesError(abortCode(signal)))
        } }
        waiting.push(waiter); signal.addEventListener("abort", waiter.abort, { once: true })
      })
    }
    let released = false
    return () => {
      if (released) return; released = true
      const next = this.waiting[module].shift()
      if (!next) { this.active[module]--; return }
      next.signal.removeEventListener("abort", next.abort); next.resolve()
    }
  }
}
