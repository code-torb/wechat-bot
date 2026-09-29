import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { importLegacyConfig } from '../../src/management/cli/import-env.js'
import { acquireConsumerLease } from '../../src/management/operations/lease.js'

const ENV = `
CHAT_API_KEY='fixture-key'
CHAT_BASE_URL='https://api.deepseek.com'
CHAT_MODEL='deepseek-chat'
CHAT_SYSTEM_PROMPT='你是群里的小助手。'
ONEBOT_SELF_ID='12345'
ONEBOT_GROUP_ALLOWLIST='34567,45678'
ONEBOT_PRIVATE_ALLOWLIST='23456'
CHAT_REPLY_DELAY_MS='1500'
CHAT_REPLY_CHARS_PER_SECOND='0'
CHAT_REPLY_MAX_DELAY_MS='12000'
`

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'migration-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, '.env'), ENV)
  writeFileSync(join(dir, 'master.key'), Buffer.alloc(32, 8).toString('hex'))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  return { dir, db }
}

test('legacy import is idempotent and preserves allowlists with L0 defaults', async (t) => {
  const { dir, db } = fixture(t)
  const first = await importLegacyConfig({ db, envFile: join(dir, '.env'), promptRoot: dir, secretKeyPath: join(dir, 'master.key') })
  assert.equal(first.imported, true)
  const second = await importLegacyConfig({ db, envFile: join(dir, '.env'), promptRoot: dir, secretKeyPath: join(dir, 'master.key') })
  assert.equal(second.imported, false)
  const groups = db
    .prepare("SELECT scope_key FROM qq_access_rules WHERE scope_type = 'group'")
    .all()
    .map((row) => row.scope_key)
  assert.deepEqual(groups, ['34567', '45678'])
  const privateRules = db
    .prepare("SELECT scope_key FROM qq_access_rules WHERE scope_type = 'private'")
    .all()
    .map((row) => row.scope_key)
  assert.deepEqual(privateRules, ['23456'])
  const grants = db.prepare('SELECT COUNT(*) AS count FROM principal_grants').get().count
  assert.equal(grants, 0)
  const credential = db.prepare('SELECT cipher, nonce FROM credentials WHERE purpose = ?').get('model')
  assert.equal(JSON.stringify(credential).includes('fixture-key'), false)
})

test('dry run imports nothing and reports counts', async (t) => {
  const { dir, db } = fixture(t)
  const result = await importLegacyConfig({ db, envFile: join(dir, '.env'), promptRoot: dir, secretKeyPath: join(dir, 'master.key'), dryRun: true })
  assert.equal(result.dryRun, true)
  assert.equal(result.summary.groupRules, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count, 0)
})

test('consumer lease is exclusive', async (t) => {
  const { dir } = fixture(t)
  const first = await acquireConsumerLease({ directory: dir, onCompromised: () => {} })
  t.after(() => first.release())
  await assert.rejects(() => acquireConsumerLease({ directory: dir, onCompromised: () => {} }), /lock|held|ELOCKED/i)
  await first.release()
  const second = await acquireConsumerLease({ directory: dir, onCompromised: () => {} })
  await second.release()
})
