import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { createApp } from '../../src/management/app.js'
import { registerManagementRoutes } from '../../src/management/routes.js'
import { SessionStore } from '../../src/management/auth/sessions.js'
import { SecretStore } from '../../src/management/secrets/store.js'
import { createAgentService } from '../../src/management/agents/service.js'
import { createAuditStore } from '../../src/management/audit/store.js'
import { createStyleRepository } from '../../src/management/styles/repository.js'
import { createQQRuleRepository } from '../../src/management/qq/rules.js'
import { createQQRouter } from '../../src/management/qq/router.js'
import { createConversationStore } from '../../src/management/conversations/repository.js'
import { createGrantRepository } from '../../src/management/permissions/grants.js'
import { hashPassword } from '../../src/management/auth/passwords.js'

const SESSION_COOKIE = 'mgmt_session'

function cookieOf(res) {
  const header = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'][0] : res.headers['set-cookie']
  return header.split(';')[0].replace(`${SESSION_COOKIE}=`, '')
}

async function build(t) {
  const dir = mkdtempSync(join(tmpdir(), 'api-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare('INSERT INTO admin_users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    'x',
    'owner',
    now,
    now,
  )
  db.prepare(
    'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-a', 'test', 'https://model.example.test/v1', '{}', now, now)
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 3) })
  const envelope = secretStore.encrypt({
    record: { id: 'cred-a', provider_id: 'provider-a', purpose: 'model', key_version: 1 },
    plaintext: 'fixture-key',
  })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('cred-a', 'provider-a', 'model', envelope.cipher, envelope.nonce, envelope.tag, 1, now, now)
  const sessions = new SessionStore({ db })
  const audit = createAuditStore(db)
  const service = createAgentService({ db, audit })
  const styles = createStyleRepository(db)
  const qqRules = createQQRuleRepository(db)
  const qqRouter = createQQRouter({ db, service })
  const conversations = createConversationStore(db)
  const grants = createGrantRepository(db)
  const app = await createApp({ db, sessions, logger: false })
  registerManagementRoutes(app, { db, sessions, secretStore, service, audit, styles, qqRules, qqRouter, conversations, grants })
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(await hashPassword('pw'), 'owner-1')
  return { app, db }
}

async function login(app, withCsrf = true) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'pw' } })
  return { cookie: cookieOf(res), csrf: withCsrf ? res.json().data.csrf : '' }
}

test('full agent API flow: create, publish, rollback and audit', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie, csrf } = await login(app)
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    payload: { name: '助手' },
  })
  assert.equal(created.statusCode, 201)
  const agentId = created.json().data.id
  const draft = {
    name: '助手',
    prompt: '你是一个测试助手。',
    model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
  }
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/v1/agents/${agentId}`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'if-match': '1' },
    payload: draft,
  })
  assert.equal(patched.statusCode, 200)
  const published = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${agentId}/publish`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    payload: { expectedRevision: 2 },
  })
  assert.equal(published.statusCode, 200)
  assert.equal(published.json().data.prompt, '你是一个测试助手。')
  const versions = await app.inject({ method: 'GET', url: `/api/v1/agents/${agentId}/versions`, cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(versions.json().data.length, 1)
  const rollback = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${agentId}/rollback`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    payload: { versionId: versions.json().data[0].id, expectedRevision: 3 },
  })
  assert.equal(rollback.statusCode, 200)
  const audit = await app.inject({ method: 'GET', url: '/api/v1/audit-events', cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(audit.statusCode, 200)
  const actions = audit.json().data.map((row) => row.action)
  assert.equal(actions.includes('agent.create'), true)
  assert.equal(actions.includes('agent.publish'), true)
  assert.equal(actions.includes('agent.rollback'), true)
})

test('agent creation returns a useful error for an empty name', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie, csrf } = await login(app)
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    payload: { name: '' },
  })
  assert.equal(response.statusCode, 422)
  assert.deepEqual(response.json().error, { code: 'VALIDATION', message: 'agent name is required' })
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    payload: {},
  })
  assert.equal(missing.statusCode, 400)
  assert.equal(missing.json().error.code, 'VALIDATION')
  assert.match(missing.json().error.message, /name/)
})

test('invalid Agent request fields identify the failing field instead of Fastify internals', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie } = await login(app)
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/agents?status=inactive',
    cookies: { [SESSION_COOKIE]: cookie },
  })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error.code, 'VALIDATION')
  assert.match(response.json().error.message, /status/)
})

test('new agents accept prompt and model edits separately before publish', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie, csrf } = await login(app)
  const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf }
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { name: '助手' },
  })
  assert.equal(created.statusCode, 201)
  const id = created.json().data.id
  const listed = await app.inject({
    method: 'GET',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
  })
  assert.equal(listed.statusCode, 200)
  assert.equal(
    listed.json().data.some((agent) => agent.id === id),
    true,
  )
  const prompt = await app.inject({
    method: 'PATCH',
    url: `/api/v1/agents/${id}`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { ...headers, 'if-match': '1' },
    payload: { prompt: '你是一个测试助手。' },
  })
  assert.equal(prompt.statusCode, 200, prompt.body)
  const model = await app.inject({
    method: 'PATCH',
    url: `/api/v1/agents/${id}`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { ...headers, 'if-match': '2' },
    payload: { model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false } },
  })
  assert.equal(model.statusCode, 200, model.body)
  assert.equal(model.json().data.draft.name, '助手')
  assert.equal(model.json().data.draft.prompt, '你是一个测试助手。')
  const published = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${id}/publish`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { expectedRevision: 3 },
  })
  assert.equal(published.statusCode, 200, published.body)
})

test('one Agent publish request saves the role and selected styles together', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie, csrf } = await login(app)
  const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf }
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { name: '助手' },
  })
  const id = created.json().data.id
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${id}/publish`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: {
      expectedRevision: 1,
      draft: {
        prompt: '林安宁曾是一名编辑，如今在上海照顾儿子。',
        model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
        styleValues: [],
      },
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().data.prompt, '林安宁曾是一名编辑，如今在上海照顾儿子。')
  const saved = await app.inject({ method: 'GET', url: `/api/v1/agents/${id}`, cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(saved.json().data.draft.prompt, response.json().data.prompt)
  assert.deepEqual(saved.json().data.draft.styleValues, [])
})

test('default role background is available to an authorized Agent editor', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie } = await login(app)
  const result = await app.inject({
    method: 'GET',
    url: '/api/v1/agents/default-role-background',
    cookies: { [SESSION_COOKIE]: cookie },
  })
  assert.equal(result.statusCode, 200, result.body)
  assert.match(result.json().data.background, /林安宁/)
  assert.match(result.json().data.background, /儿子/)
})

test('mutations without csrf token are rejected', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie } = await login(app, false)
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json' },
    payload: { name: '助手' },
  })
  assert.equal(created.statusCode, 403)
})

test('style definition and agent pacing routes update drafts and publish snapshots', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie, csrf } = await login(app)
  const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf }
  const definition = await app.inject({
    method: 'POST',
    url: '/api/v1/style-definitions',
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { key: 'curiosity', name: '好奇程度', defaultValue: 0.5, lowText: '收尾', midText: '追问', highText: '探索' },
  })
  assert.equal(definition.statusCode, 201)
  const defId = definition.json().data.id
  const versionId = definition.json().data.currentVersion.id
  const agent = await app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { name: '助手' },
  })
  const agentId = agent.json().data.id
  const draft = {
    name: '助手',
    prompt: '你是一个测试助手。',
    model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
  }
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/agents/${agentId}`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { ...headers, 'if-match': '1' },
    payload: draft,
  })
  const styles = await app.inject({
    method: 'PUT',
    url: `/api/v1/agents/${agentId}/style-settings`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { expectedRevision: 2, values: [{ definitionId: defId, definitionVersionId: versionId, value: 0.7 }] },
  })
  assert.equal(styles.statusCode, 200)
  const pacing = await app.inject({
    method: 'PUT',
    url: `/api/v1/agents/${agentId}/reply-pacing`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { expectedRevision: 3, pacing: { baseDelayMs: 1500, charsPerSecond: 12, maxDelayMs: 12000 } },
  })
  assert.equal(pacing.statusCode, 200)
  const published = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${agentId}/publish`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { expectedRevision: 4 },
  })
  assert.equal(published.statusCode, 200)
  const snapshot = published.json().data
  assert.equal(snapshot.styleValues[0].value, 0.7)
  assert.equal(snapshot.styleValues[0].activationGeneration, 1)
  assert.deepEqual(snapshot.pacing, { baseDelayMs: 1500, charsPerSecond: 12, maxDelayMs: 12000 })
})

test('style definitions expose readable anchors and can edit a version with a zero default', async (t) => {
  const { app } = await build(t)
  t.after(() => app.close())
  const { cookie, csrf } = await login(app)
  const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf }
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/style-definitions',
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: {
      key: 'curiosity',
      name: '好奇程度',
      description: '决定是否主动追问。',
      defaultValue: 0.5,
      lowText: '直接回答，不主动追问',
      midText: '在必要时追问',
      highText: '主动探索对方的意图',
    },
  })
  assert.equal(created.statusCode, 201)
  const id = created.json().data.id
  const listed = await app.inject({
    method: 'GET',
    url: '/api/v1/style-definitions',
    cookies: { [SESSION_COOKIE]: cookie },
  })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json().data[0].currentVersion.defaultValue, 0.5)
  assert.equal(listed.json().data[0].currentVersion.lowText, '直接回答，不主动追问')

  const edited = await app.inject({
    method: 'PATCH',
    url: `/api/v1/style-definitions/${id}`,
    cookies: { [SESSION_COOKIE]: cookie },
    headers,
    payload: { name: '探索程度', description: '控制追问主动性。', defaultValue: 0, highText: '更主动地提出一个贴切问题' },
  })
  assert.equal(edited.statusCode, 200)
  assert.equal(edited.json().data.currentVersion.name, '探索程度')
  assert.equal(edited.json().data.currentVersion.description, '控制追问主动性。')
  assert.equal(edited.json().data.currentVersion.defaultValue, 0)
  assert.equal(edited.json().data.currentVersion.lowText, '直接回答，不主动追问')
  assert.equal(edited.json().data.currentVersion.highText, '更主动地提出一个贴切问题')
  assert.notEqual(edited.json().data.currentVersion.id, created.json().data.currentVersion.id)
})
