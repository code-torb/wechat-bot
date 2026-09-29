import lockfile from 'proper-lockfile'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

export async function acquireConsumerLease({ directory, onCompromised }) {
  mkdirSync(directory, { recursive: true })
  const target = `${directory}/consumer.lock`
  if (!existsSync(target)) writeFileSync(target, '')
  const release = await lockfile.lock(target, {
    stale: 30000,
    update: 10000,
    retries: { retries: 2, minTimeout: 50, factor: 2 },
    onCompromised,
  })
  return {
    release: async () => {
      if (release) {
        try {
          await release()
        } catch {
          // already released or lock file removed; treat as released
        }
      }
    },
    compromised: false,
  }
}
