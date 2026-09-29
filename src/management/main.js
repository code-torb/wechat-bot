import { openDatabase } from './db/index.js'
import { createApp } from './app.js'

const host = process.env.MANAGEMENT_HOST || '127.0.0.1'
const port = Number(process.env.MANAGEMENT_PORT || 6080)
const databaseFile = process.env.MANAGEMENT_DB || 'data/management.sqlite'

const db = openDatabase({ filename: databaseFile })
const app = await createApp({ db })

await app.listen({ host, port })
console.log(`agent management listening on http://${host}:${port}`)

async function shutdown(signal) {
  console.log(`received ${signal}, shutting down`)
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
