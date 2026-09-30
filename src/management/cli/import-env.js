import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { openDatabase } from '../db/index.js'
import { SecretStore } from '../secrets/store.js'
import { validateProviderBaseUrl } from '../secrets/provider-network.js'
import { createAgentService } from '../agents/service.js'
import { createAuditStore } from '../audit/store.js'
import { createQQRuleRepository } from '../qq/rules.js'
import { createStyleRepository } from '../styles/repository.js'
import { DEFAULT_ROLE_BACKGROUND } from '../agents/default-role.js'

const DEFAULT_STYLE_PRESETS = [
  {
    key: 'flirtiness',
    name: '暧昧程度',
    defaultValue: 0.1,
    lowText: '中性、不主动暧昧',
    midText: '友好亲近',
    highText: '在适宜语境中更亲昵、带轻度暧昧表达',
  },
  { key: 'brevity', name: '简短程度', defaultValue: 0.65, lowText: '解释充分', midText: '简洁', highText: '倾向一两句回答' },
  { key: 'warmth', name: '温暖程度', defaultValue: 0.65, lowText: '克制客观', midText: '温和', highText: '温柔、关心感明显' },
  { key: 'humor', name: '幽默程度', defaultValue: 0.3, lowText: '严肃直接', midText: '轻松', highText: '更偏轻松有趣' },
  { key: 'formality', name: '正式程度', defaultValue: 0.25, lowText: '日常口语', midText: '适中', highText: '正式规范' },
  { key: 'empathy', name: '共情程度', defaultValue: 0.6, lowText: '以解决问题为主', midText: '回应感受', highText: '更主动回应用户感受' },
  { key: 'memeFrequency', name: '表情包频率', defaultValue: 0.2, lowText: '不自动发送', midText: '偶尔使用', highText: '合适场景更常使用' },
]

function sourceHash(content) {
  return createHash('sha256').update(content).digest('hex')
}

export async function importLegacyConfig({ db, envFile, secretKeyPath, dryRun = false }) {
  const content = readFileSync(envFile, 'utf8')
  const env = dotenv.parse(content)
  const hash = sourceHash(content)
  const prior = db.prepare("SELECT value_json FROM settings WHERE key = 'legacy_import'").get()
  if (prior && JSON.parse(prior.value_json).sourceHash === hash) {
    return { imported: false, reason: 'same source already imported' }
  }
  const summary = {
    models: 1,
    agents: 1,
    botAccounts: 1,
    groupRules: (env.ONEBOT_GROUP_ALLOWLIST || '').split(',').filter(Boolean).length,
    privateRules: (env.ONEBOT_PRIVATE_ALLOWLIST || '').split(',').filter(Boolean).length,
    styleDefinitions: DEFAULT_STYLE_PRESETS.length,
  }
  if (dryRun) return { imported: false, dryRun: true, summary }

  const secretStore = new SecretStore({ key: Buffer.from(readFileSync(secretKeyPath, 'utf8').trim(), 'hex') })
  const audit = createAuditStore(db)
  const service = createAgentService({ db, audit })
  const qqRules = createQQRuleRepository(db)
  const styles = createStyleRepository(db)

  db.transaction(() => {
    const baseUrl = validateProviderBaseUrl(env.CHAT_BASE_URL || 'https://api.openai.com/v1')
    const modelId = 'imported-model'
    const now = Date.now()
    const modelRecord = {
      id: modelId,
      name: 'imported',
      base_url: baseUrl,
      embedding_model: '',
      enabled: 1,
      key_version: secretStore.keyVersion,
      aad_kind: 'model',
      created_at: now,
      updated_at: now,
    }
    const envelope = secretStore.encrypt({ record: modelRecord, plaintext: env.CHAT_API_KEY || '' })
    db.prepare(
      `INSERT INTO models (id, name, base_url, aad_kind, api_key_cipher, api_key_nonce, api_key_tag, key_version,
         search_key_cipher, search_key_nonce, search_key_tag, search_key_version, embedding_model, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      modelId,
      modelRecord.name,
      baseUrl,
      'model',
      envelope.cipher,
      envelope.nonce,
      envelope.tag,
      envelope.keyVersion,
      null,
      null,
      null,
      null,
      '',
      now,
      now,
    )

    const agent = service.create({ name: '默认 Agent', description: '由旧配置导入' })
    service.updateDraft({
      agentId: agent.id,
      draft: {
        name: '默认 Agent',
        prompt: DEFAULT_ROLE_BACKGROUND,
        model: { modelId, name: env.CHAT_MODEL || '', supportsTools: false },
        pacing: {
          baseDelayMs: Number(env.CHAT_REPLY_DELAY_MS || 0),
          charsPerSecond: Number(env.CHAT_REPLY_CHARS_PER_SECOND || 0),
          maxDelayMs: Number(env.CHAT_REPLY_MAX_DELAY_MS || 15000),
        },
        capabilities: [],
        searchMode: 'off',
        resourceGrants: [],
        commandRefs: [],
      },
      expectedRevision: 1,
      actorId: 'legacy-import',
    })
    service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'legacy-import' })

    const selfId = String(env.ONEBOT_SELF_ID || '')
    if (selfId) {
      const botId = 'imported-bot'
      qqRules.upsertAccount({ id: botId, platform: 'qq-onebot', selfId, defaultAgentId: agent.id })
      for (const group of (env.ONEBOT_GROUP_ALLOWLIST || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        qqRules.upsertRule({
          accountId: botId,
          scopeType: 'group',
          scopeKey: group,
          allow: true,
          trigger: { mode: 'any', mention: true },
          maxLevel: 0,
        })
        qqRules.upsertBinding({ accountId: botId, scopeType: 'group', scopeKey: group, agentId: agent.id })
      }
      for (const user of (env.ONEBOT_PRIVATE_ALLOWLIST || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        qqRules.upsertRule({ accountId: botId, scopeType: 'private', scopeKey: user, allow: true, trigger: {}, maxLevel: 0 })
        qqRules.upsertBinding({ accountId: botId, scopeType: 'private', scopeKey: user, agentId: agent.id })
      }
    }

    for (const preset of DEFAULT_STYLE_PRESETS) {
      try {
        styles.create(preset)
      } catch {
        // preset already exists; keep existing definition and defaults
      }
    }
    db.prepare('INSERT INTO settings (key, value_json, revision, updated_at) VALUES (?, ?, 1, ?)').run(
      'legacy_import',
      JSON.stringify({ sourceHash: hash, importedAt: Date.now() }),
      Date.now(),
    )
  })()
  return { imported: true, summary }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const db = openDatabase({ filename: process.env.MANAGEMENT_DB || 'data/management.sqlite' })
  const result = await importLegacyConfig({
    db,
    envFile: process.argv[2] || '.env',
    secretKeyPath: process.env.MANAGEMENT_KEY_FILE,
    dryRun: process.argv.includes('--dry-run'),
  })
  console.log(JSON.stringify(result, null, 2))
  db.close()
}
