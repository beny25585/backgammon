// All bracket waiters share one in-flight request and one refresh per second.
export function createSharedProgress(fetchProgress, intervalMs = 1000) {
  let pending = null
  let snapshot
  let nextFetchAt = 0
  return async () => {
    if (pending) return pending
    if (snapshot && Date.now() < nextFetchAt) return snapshot
    pending = Promise.resolve().then(fetchProgress).then(value => {
      snapshot = value
      nextFetchAt = Date.now() + intervalMs
      return value
    }).finally(() => { pending = null })
    return pending
  }
}
