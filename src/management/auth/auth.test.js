import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createApp } from '../app.js'
import { SessionStore } from './sessions.js'
import { registerAuthRoutes, SESSION_COOKIE } from './routes.js'
import { registerCredentialRoutes } from '../secrets/routes.js'
import { SecretStore } from '../secrets/store.js'
import { hashPassword } from './passwords.js'
import { canAccess } from './authorization.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'auth-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare('INSERT INTO admin_users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    'unused',
    'owner',
    now,
    now,
  )
  db.prepare('INSERT INTO admin_users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'operator-1',
    'operator',
    'unused',
    'operator',
    now,
    now,
  )
  db.prepare('INSERT INTO admin_scopes (id, user_id, resource_type, resource_id, operation) VALUES (?, ?, ?, ?, ?)').run(
    'scope-1',
    'operator-1',
    'agents',
    'agent-a',
    'read:agents',
  )
  db.prepare(
    'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-a', 'test', 'https://model.example.test/v1', '{}', now, now)
  const key = Buffer.alloc(32, 9)
  const secretStore = new SecretStore({ key })
  const sessions = new SessionStore({ db, now: () => now + 1 })
  return { db, secretStore, sessions }
}

async function buildApp(f) {
  const app = await createApp({ db: f.db, clock: f.sessions.now, sessions: f.sessions })
  registerAuthRoutes(app, { db: f.db, sessions: f.sessions, now: f.sessions.now })
  registerCredentialRoutes(app, { db: f.db, secretStore: f.secretStore })
  return app
}

async function setPassword(app, username, password) {
  const user = app.db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username)
  app.db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id)
}

function login(app, username = 'owner', password = 'pw') {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } })
}

function sessionCookie(res) {
  const header = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'][0] : res.headers['set-cookie']
  return header.split(';')[0].replace(`${SESSION_COOKIE}=`, '')
}

test('login succeeds and me returns the session identity', async (t) => {
  const f = fixture(t)
  const app = await buildApp(f)
  t.after(() => app.close())
  await setPassword(app, 'owner', 'pw')
  const res = await login(app)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().data.csrf.length > 0, true)
  const cookie = sessionCookie(res)
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(me.statusCode, 200)
  assert.equal(me.json().data.role, 'owner')
})

test('a refreshed page receives a usable csrf token and accepts its own origin with a port', async (t) => {
  const f = fixture(t)
  const app = await buildApp(f)
  t.after(() => app.close())
  await setPassword(app, 'owner', 'pw')
  const loginResponse = await login(app)
  const cookie = sessionCookie(loginResponse)
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(typeof me.json().data.csrf, 'string')
  const otherTab = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(otherTab.json().data.csrf, me.json().data.csrf)
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/credentials',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: {
      host: '127.0.0.1:6080',
      origin: 'http://127.0.0.1:6080',
      'x-csrf-token': me.json().data.csrf,
    },
    payload: { providerId: 'provider-a', purpose: 'model', value: 'fixture-secret-value' },
  })
  assert.equal(created.statusCode, 201)
  const devProxy = await app.inject({
    method: 'POST',
    url: '/api/v1/credentials',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: {
      host: '127.0.0.1:5173',
      origin: 'http://127.0.0.1:5173',
      'x-csrf-token': me.json().data.csrf,
    },
    payload: { providerId: 'provider-a', purpose: 'search', value: 'fixture-search-secret' },
  })
  assert.equal(devProxy.statusCode, 201)
  const foreignOrigin = await app.inject({
    method: 'POST',
    url: '/api/v1/credentials',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: {
      host: '127.0.0.1:5173',
      origin: 'http://localhost:5173',
      'x-csrf-token': me.json().data.csrf,
    },
    payload: { providerId: 'provider-a', purpose: 'search', value: 'must-not-write' },
  })
  assert.equal(foreignOrigin.statusCode, 403)
})

test('invalid password and revoked session are rejected', async (t) => {
  const f = fixture(t)
  const app = await buildApp(f)
  t.after(() => app.close())
  await setPassword(app, 'owner', 'pw')
  const bad = await login(app, 'owner', 'wrong')
  assert.equal(bad.statusCode, 401)
  const good = await login(app)
  const cookie = sessionCookie(good)
  const csrf = good.json().data.csrf
  await app.inject({
    method: 'DELETE',
    url: '/api/v1/auth/session',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'x-csrf-token': csrf },
  })
  const afterRevoke = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(afterRevoke.statusCode, 401)
})

test('owner-only credential routes never expose the plaintext value', async (t) => {
  const f = fixture(t)
  const app = await buildApp(f)
  t.after(() => app.close())
  await setPassword(app, 'owner', 'pw')
  const owner = await login(app)
  const cookie = sessionCookie(owner)
  const csrf = owner.json().data.csrf
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/credentials',
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    payload: { providerId: 'provider-a', purpose: 'model', value: 'fixture-secret-value' },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(JSON.stringify(created.json()).includes('fixture-secret-value'), false)
  const list = await app.inject({ method: 'GET', url: '/api/v1/credentials', cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(list.statusCode, 200)
  assert.equal(JSON.stringify(list.json()).includes('fixture-secret-value'), false)
  assert.equal(list.json().data[0].cipher, undefined)
  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/credentials/${created.json().data.id}`,
    cookies: { [SESSION_COOKIE]: cookie },
  })
  assert.equal(JSON.stringify(detail.json()).includes('fixture-secret-value'), false)
})

test('operator cannot manage credentials even when logged in', async (t) => {
  const f = fixture(t)
  const app = await buildApp(f)
  t.after(() => app.close())
  await setPassword(app, 'operator', 'pw')
  const res = await login(app, 'operator', 'pw')
  const cookie = sessionCookie(res)
  const list = await app.inject({ method: 'GET', url: '/api/v1/credentials', cookies: { [SESSION_COOKIE]: cookie } })
  assert.equal(list.statusCode, 403)
})

test('canAccess respects explicit scopes and operator boundaries', () => {
  const owner = { role: 'owner', scopes: [] }
  const operator = { role: 'operator', scopes: [{ resourceType: 'agents', resourceId: 'agent-a', operation: 'read:agents' }] }
  const viewer = { role: 'viewer', scopes: [{ resourceType: 'conversations', resourceId: '', operation: 'read:conversations' }] }
  assert.equal(canAccess(owner, { resourceType: 'credentials', operation: 'write:credentials' }), true)
  assert.equal(canAccess(operator, { resourceType: 'agents', resourceId: 'agent-b', operation: 'read:agents' }), false)
  assert.equal(canAccess(operator, { resourceType: 'agents', resourceId: 'agent-a', operation: 'read:agents' }), true)
  assert.equal(canAccess(operator, { resourceType: 'credentials', operation: 'read:credentials' }), false)
  assert.equal(canAccess(viewer, { resourceType: 'conversations', resourceId: 'conversation-x', operation: 'read:conversations' }), true)
  assert.equal(canAccess(viewer, { resourceType: 'conversations', operation: 'write:conversations' }), false)
})
