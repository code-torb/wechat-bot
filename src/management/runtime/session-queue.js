export function createSessionQueue({ maxPerSession = 8, maxTotal = 256 } = {}) {
  const chains = new Map()
  let total = 0
  return {
    enqueue(key, task) {
      const entry = chains.get(key) || { pending: 0, tail: Promise.resolve() }
      if (entry.pending >= maxPerSession || total >= maxTotal) return { queued: false, reason: 'queue_full' }
      entry.pending += 1
      total += 1
      const run = entry.tail.then(task).finally(() => {
        entry.pending -= 1
        total -= 1
        if (entry.pending === 0) chains.delete(key)
      })
      entry.tail = run.catch(() => {})
      chains.set(key, entry)
      return { queued: true, promise: run }
    },
    size() {
      return total
    },
  }
}
