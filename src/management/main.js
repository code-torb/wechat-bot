import { openDatabase } from './db/index.js'
import { createApp } from './app.js'
import { SessionStore } from './auth/sessions.js'
import { SecretStore } from './secrets/store.js'
import { createAgentService } from './agents/service.js'
import { createAuditStore } from './audit/store.js'
import { createStyleRepository } from './styles/repository.js'
import { createQQRuleRepository } from './qq/rules.js'
import { createQQRouter } from './qq/router.js'
import { createConversationStore } from './conversations/repository.js'
import { createGrantRepository } from './permissions/grants.js'
import { registerManagementRoutes } from './routes.js'

const host = process.env.MANAGEMENT_HOST || '127.0.0.1'
const port = Number(process.env.MANAGEMENT_PORT || 6080)
const databaseFile = process.env.MANAGEMENT_DB || 'data/management.sqlite'

const db = openDatabase({ filename: databaseFile })
const sessions = new SessionStore({ db })
const secretStore = process.env.MANAGEMENT_KEY_FILE
  ? SecretStore.fromFile({ path: process.env.MANAGEMENT_KEY_FILE, keyVersion: Number(process.env.MANAGEMENT_KEY_VERSION || 1) })
  : null
const audit = createAuditStore(db)
const service = createAgentService({ db, audit })
const styles = createStyleRepository(db)
const qqRules = createQQRuleRepository(db)
const qqRouter = createQQRouter({ db, service })
const conversations = createConversationStore(db)
const grants = createGrantRepository(db)
const app = await createApp({ db, sessions })
registerManagementRoutes(app, { db, sessions, secretStore, service, audit, styles, qqRules, qqRouter, conversations, grants })

await app.listen({ host, port })
console.log(`agent management listening on http://${host}:${port}`)

async function shutdown(signal) {
  console.log(`received ${signal}, shutting down`)
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
