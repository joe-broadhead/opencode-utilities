// Retries a task that fails with a retryable failure: a connection that fails, or a transfer cut short. Any other error
// is thrown at once. The native model download uses it; that script runs in the release CI as well.
export function retryFailure(message) {
  throw Object.assign(new Error(message), { retryable: true });
}

export async function withRetry(task, { attempts = 3, delaysMs = [2000, 5000], pause = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= attempts || error?.retryable !== true) throw error;
      await pause(delaysMs[Math.min(attempt - 1, delaysMs.length - 1)]);
    }
  }
}
