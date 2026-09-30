import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { importLegacyConfig } from '../../src/management/cli/import-env.js'
import { DEFAULT_ROLE_BACKGROUND, upgradeUntouchedDefaultRole } from '../../src/management/agents/default-role.js'
import { createAgentService } from '../../src/management/agents/service.js'
import { createAuditStore } from '../../src/management/audit/store.js'
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
  const first = await importLegacyConfig({ db, envFile: join(dir, '.env'), secretKeyPath: join(dir, 'master.key') })
  assert.equal(first.imported, true)
  const second = await importLegacyConfig({ db, envFile: join(dir, '.env'), secretKeyPath: join(dir, 'master.key') })
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
  const model = db.prepare('SELECT api_key_cipher, api_key_nonce FROM models WHERE id = ?').get('imported-model')
  assert.equal(JSON.stringify(model).includes('fixture-key'), false)
  const published = db.prepare('SELECT snapshot_json FROM agent_versions WHERE version = 1').get()
  assert.equal(JSON.parse(published.snapshot_json).prompt, DEFAULT_ROLE_BACKGROUND)
  assert.deepEqual(JSON.parse(published.snapshot_json).styleValues, [])
})

test('upgrades only untouched generic imported roles, preserving customized backgrounds', async (t) => {
  const { dir, db } = fixture(t)
  await importLegacyConfig({ db, envFile: join(dir, '.env'), secretKeyPath: join(dir, 'master.key') })
  const row = db.prepare("SELECT id, draft_json FROM agents WHERE name = '默认 Agent'").get()
  const service = createAgentService({ db, audit: createAuditStore(db) })
  assert.equal(upgradeUntouchedDefaultRole({ db, service }), 0)
  db.prepare('UPDATE agents SET draft_json = ? WHERE id = ?').run(
    JSON.stringify({ ...JSON.parse(row.draft_json), prompt: '你是一个友好、简洁的中文聊天助手。请用纯文本回答，避免过长的回复。' }),
    row.id,
  )
  db.prepare('UPDATE models SET enabled = 0 WHERE id = ?').run('imported-model')
  assert.equal(upgradeUntouchedDefaultRole({ db, service, logger: { warn() {} } }), 0)
  assert.equal(service.get(row.id).revision, 3)
  db.prepare('UPDATE models SET enabled = 1 WHERE id = ?').run('imported-model')
  assert.equal(upgradeUntouchedDefaultRole({ db, service }), 1)
  assert.equal(service.getPublished(row.id).prompt, DEFAULT_ROLE_BACKGROUND)
  assert.equal(service.versions(row.id).length, 2)
  assert.equal(upgradeUntouchedDefaultRole({ db, service }), 0)
})

test('dry run imports nothing and reports counts', async (t) => {
  const { dir, db } = fixture(t)
  const result = await importLegacyConfig({ db, envFile: join(dir, '.env'), secretKeyPath: join(dir, 'master.key'), dryRun: true })
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
