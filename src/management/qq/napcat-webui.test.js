import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createNapCatWebUi } from './napcat-webui.js'

test('reads the mounted WebUI token and returns only QR and account status', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napcat-webui-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const tokenFile = join(dir, 'webui.json')
  writeFileSync(tokenFile, JSON.stringify({ token: 'webui-secret' }))
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    const path = new URL(url).pathname
    const data = path.endsWith('/auth/login')
      ? { Credential: 'signed-credential' }
      : path.endsWith('/CheckLoginStatus')
        ? { isLogin: true, isOffline: false, loginPhase: 'online', qrcodeurl: 'qq://scan/123' }
        : { uin: '12345678', nickname: 'QQ User' }
    return { ok: true, json: async () => ({ code: 0, data }) }
  }
  const webui = createNapCatWebUi({ tokenFile, token: 'stale-fallback-token', fetchFn })
  const status = await webui.status()
  assert.deepEqual(status, {
    isLogin: true,
    isOffline: false,
    loginPhase: 'online',
    loginError: '',
    qrcodeUrl: 'qq://scan/123',
    selfId: '12345678',
  })
  assert.equal(JSON.stringify(status).includes('webui-secret'), false)
  assert.equal(calls[0].url, 'http://napcat:6099/api/auth/login')
  assert.equal(JSON.parse(calls[0].init.body).hash, createHash('sha256').update('webui-secret.napcat').digest('hex'))
  assert.equal(calls[1].init.headers.authorization, 'Bearer signed-credential')
  assert.equal(calls[2].url, 'http://napcat:6099/api/QQLogin/GetQQLoginInfo')
  writeFileSync(tokenFile, JSON.stringify({ token: 'rotated-webui-secret' }))
  await webui.status()
  assert.equal(JSON.parse(calls[3].init.body).hash, createHash('sha256').update('rotated-webui-secret.napcat').digest('hex'))
})

test('requires a WebUI token and supports optional two-factor verification', async () => {
  const missing = createNapCatWebUi({
    tokenFile: '/missing-webui-token-file',
    fetchFn: () => {
      throw new Error('should not fetch')
    },
  })
  await assert.rejects(missing.status(), { code: 'NAPCAT_WEBUI_CONFIG', statusCode: 503 })
  const calls = []
  const webui = createNapCatWebUi({
    token: 'test-token',
    fetchFn: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: url.endsWith('/auth/login')
            ? JSON.parse(init.body).totpCode
              ? { Credential: 'credential' }
              : { require2FA: true }
            : { qrcodeurl: 'qq://new' },
        }),
      }
    },
  })
  await assert.rejects(webui.status(), { code: 'NAPCAT_TOTP_REQUIRED', statusCode: 409 })
  await webui.verify('123456')
  assert.equal(calls[1].body.totpCode, '123456')
  assert.deepEqual(await webui.refresh(), { qrcodeUrl: 'qq://new', restarting: false })
  assert.equal(calls.length, 3)
})

test('renews an expired WebUI credential once and does not expose the token on auth failure', async () => {
  let logins = 0
  const webui = createNapCatWebUi({
    token: 'private-webui-token',
    fetchFn: async (url, init) => {
      const path = new URL(url).pathname
      if (path.endsWith('/auth/login')) {
        logins += 1
        return { ok: true, status: 200, json: async () => ({ code: 0, data: { Credential: `credential-${logins}` } }) }
      }
      if (init.headers.authorization === 'Bearer credential-1') {
        return { ok: false, status: 401, json: async () => ({ code: 401, message: 'private-webui-token' }) }
      }
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { isLogin: false } }) }
    },
  })
  assert.equal((await webui.status()).isLogin, false)
  assert.equal(logins, 2)
})
