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
import { createOneBotClient } from '../platforms/onebot/client.js'
import { createOneBotConsumer } from './qq/consumer.js'
import { acquireOneBotConsumerLease } from '../platforms/onebot/consumer-lease.js'
import { createCommandRegistry } from './commands/registry.js'
import { createPolicyEngine } from './permissions/policy.js'
import { createAgentRuntime } from './runtime/runner.js'
import { createSessionQueue } from './runtime/session-queue.js'
import { createReplyPlanStore } from './runtime/reply-plans.js'
import { createReplyScheduler } from './runtime/scheduler.js'
import { createToolRegistry } from './tools/registry.js'
import { createMemeService } from './tools/memes.js'
import { createSearchTool } from './tools/search.js'
import { createFileClient } from './tools/file-client.js'
import { createModelClient } from '../chat/model-client.js'
import { renderReply } from '../platforms/onebot/render.js'

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
const policyEngine = createPolicyEngine({ db })
const commandRegistry = createCommandRegistry({ db })
const memes = createMemeService({ db, storageDir: process.env.MANAGEMENT_MEME_DIR || 'data/memes' })
const searchWeb = secretStore ? createSearchTool({ secretStore, fetchFn: globalThis.fetch }) : null
const fileClient =
  process.env.FILE_EXECUTOR_SOCKET && process.env.FILE_EXECUTOR_SECRET
    ? createFileClient({ socketPath: process.env.FILE_EXECUTOR_SOCKET, secret: process.env.FILE_EXECUTOR_SECRET })
    : null
const tools = createToolRegistry({ db, policyEngine, searchWeb, memes })
const getCredential = (credentialRef) => db.prepare('SELECT * FROM credentials WHERE id = ?').get(credentialRef)
const getProvider = (providerId) => db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId)
const modelClient = secretStore ? createModelClient({ secretStore }) : null
const app = await createApp({ db, sessions })
registerManagementRoutes(app, { db, sessions, secretStore, service, audit, styles, qqRules, qqRouter, conversations, grants })

let scheduler = null
let consumer = null
let lease = null
if (process.env.ONEBOT_ACCESS_TOKEN && modelClient && secretStore) {
  lease = await acquireOneBotConsumerLease({ directory: process.env.MANAGEMENT_LEASE_DIR || 'data/lease' })
  const client = createOneBotClient({
    url: process.env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001',
    accessToken: process.env.ONEBOT_ACCESS_TOKEN,
    expectedSelfId: process.env.ONEBOT_SELF_ID || '',
  })
  const plans = createReplyPlanStore(db)
  scheduler = createReplyScheduler({
    db,
    plans,
    conversations,
    client,
    renderReply,
    policyEngine,
    router: qqRouter,
    readAsset: ({ assetId }) => memes.readAuthorizedAsset({ assetId }),
    intervalMs: 250,
  })
  const runtime = createAgentRuntime({
    db,
    conversations,
    router: qqRouter,
    commandRegistry,
    policyEngine,
    scheduler,
    complete: modelClient,
    tools,
    getCredential,
    getProvider,
    sessionQueue: createSessionQueue(),
  })
  consumer = createOneBotConsumer({ client, botAccountId: process.env.ONEBOT_BOT_ACCOUNT_ID || '', runtime })
  consumer.client = client
  scheduler.start()
  client.start()
  console.log('management consumer started')
} else {
  console.log('management API only mode (no ONEBOT_ACCESS_TOKEN or model credential)')
}

await app.listen({ host, port })
console.log(`agent management listening on http://${host}:${port}`)

async function shutdown(signal) {
  console.log(`received ${signal}, shutting down`)
  if (consumer) consumer.client.stop?.()
  if (scheduler) await scheduler.stop()
  if (lease) await lease.release()
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
