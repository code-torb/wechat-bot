import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDatabase } from '../db/index.js'
import { createApp } from '../app.js'
import { SessionStore } from '../auth/sessions.js'
import { registerAuthRoutes } from '../auth/routes.js'
import { hashPassword } from '../auth/passwords.js'
import { SecretStore } from '../secrets/store.js'
import { createAuditStore } from '../audit/store.js'
import { createAgentService } from '../agents/service.js'
import { createQQRuleRepository } from './rules.js'
import { createQQRouter } from './router.js'
import { registerQQRoutes } from './routes.js'

test('only an owner can see QR status and change the logged-in account agent', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'qq-login-routes-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  const now = Date.now()
  db.prepare('INSERT INTO admin_users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    await hashPassword('pw'),
    'owner',
    now,
    now,
  )
  db.prepare('INSERT INTO admin_users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'viewer-1',
    'viewer',
    await hashPassword('pw'),
    'viewer',
    now,
    now,
  )
  db.prepare(
    'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-a', 'model', 'https://example.test/v1', '{}', now, now)
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 2) })
  const encrypted = secretStore.encrypt({ record: { id: 'cred-a', provider_id: 'provider-a', purpose: 'model', key_version: 1 }, plaintext: 'key' })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('cred-a', 'provider-a', 'model', encrypted.cipher, encrypted.nonce, encrypted.tag, 1, now, now)
  const sessions = new SessionStore({ db })
  const qqRules = createQQRuleRepository(db)
  const service = createAgentService({ db, audit: createAuditStore(db) })
  const napcatWebUi = {
    status: async () => ({ isLogin: true, isOffline: false, loginPhase: 'online', qrcodeUrl: '', selfId: '12345' }),
    refresh: async () => ({ qrcodeUrl: 'qq://scan' }),
  }
  let identity = { selfId: '12345' }
  const app = await createApp({ db, sessions, logger: false })
  t.after(() => app.close())
  registerAuthRoutes(app, { db, sessions })
  registerQQRoutes(app, {
    qqRules,
    qqRouter: createQQRouter({ db, service }),
    service,
    napcatWebUi,
    getOneBotClient: () => ({ identity }),
    ensureBotAccount: (selfId) => {
      const existing = qqRules.accountBySelf('qq-onebot', selfId)
      if (!existing) qqRules.upsertAccount({ id: 'bot-a', platform: 'qq-onebot', selfId })
      return 'bot-a'
    },
  })
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'pw' } })
  const viewer = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'viewer', password: 'pw' } })
  const cookieOf = (response) => {
    const header = response.headers['set-cookie']
    return (Array.isArray(header) ? header[0] : header).split(';')[0].split('=')[1]
  }
  const ownerCookie = cookieOf(owner)
  const viewerCookie = cookieOf(viewer)
  const denied = await app.inject({ method: 'GET', url: '/api/v1/qq/login', cookies: { mgmt_session: viewerCookie } })
  assert.equal(denied.statusCode, 403)
  const status = await app.inject({ method: 'GET', url: '/api/v1/qq/login', cookies: { mgmt_session: ownerCookie } })
  assert.equal(status.statusCode, 200)
  assert.equal(status.json().data.accountId, 'bot-a')
  assert.equal(status.json().data.oneBotReady, true)
  identity = { selfId: '67890' }
  const switching = await app.inject({ method: 'GET', url: '/api/v1/qq/login', cookies: { mgmt_session: ownerCookie } })
  assert.equal(switching.json().data.selfId, '12345')
  assert.equal(switching.json().data.oneBotReady, false)
  identity = { selfId: '12345' }
  const agent = service.create({ name: '切换到此 Agent' })
  service.updateDraft({
    agentId: agent.id,
    draft: { name: '切换到此 Agent', prompt: '测试', model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model' } },
    expectedRevision: 1,
    actorId: 'owner-1',
  })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'owner-1' })
  const patch = await app.inject({
    method: 'PATCH',
    url: '/api/v1/qq/accounts/bot-a',
    cookies: { mgmt_session: ownerCookie },
    headers: { 'x-csrf-token': owner.json().data.csrf },
    payload: { defaultAgentId: agent.id },
  })
  assert.equal(patch.statusCode, 200)
  assert.equal(qqRules.account('bot-a').default_agent_id, agent.id)
  qqRules.upsertRule({
    accountId: 'bot-a',
    scopeType: 'private',
    scopeKey: '9876',
    allow: true,
    trigger: {},
    maxLevel: 0,
  })
  const preview = await app.inject({
    method: 'POST',
    url: '/api/v1/qq/accounts/bot-a/route-preview',
    cookies: { mgmt_session: ownerCookie },
    headers: { 'x-csrf-token': owner.json().data.csrf },
    payload: { scene: 'private', peerId: '9876', senderId: '9876', text: 'hi' },
  })
  assert.equal(preview.json().data.accepted, true)
  assert.equal(preview.json().data.agentId, agent.id)
})
