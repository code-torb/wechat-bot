import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { createConversationStore } from '../../src/management/conversations/repository.js'
import { createReplyPlanStore } from '../../src/management/runtime/reply-plans.js'
import { createReplyScheduler } from '../../src/management/runtime/scheduler.js'
import { createSessionQueue } from '../../src/management/runtime/session-queue.js'
import { createAgentRuntime } from '../../src/management/runtime/runner.js'
import { createQQRouter } from '../../src/management/qq/router.js'
import { createQQRuleRepository } from '../../src/management/qq/rules.js'
import { createAgentService } from '../../src/management/agents/service.js'
import { createAuditStore } from '../../src/management/audit/store.js'
import { createPolicyEngine } from '../../src/management/permissions/policy.js'
import { createCommandRegistry } from '../../src/management/commands/registry.js'
import { renderReply } from '../../src/platforms/onebot/render.js'
import { SecretStore } from '../../src/management/secrets/store.js'
import { createModelClient } from '../../src/chat/model-client.js'
import { RELATIONS_TTL_MS, createAgentProfileService } from '../../src/management/agents/profile-service.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 5) })
  const envelope = secretStore.encrypt({ record: { id: 'model-a', aad_kind: 'model', key_version: 1 }, plaintext: 'key' })
  db.prepare(
    `INSERT INTO models (id, name, base_url, aad_kind, api_key_cipher, api_key_nonce, api_key_tag, key_version,
       search_key_cipher, search_key_nonce, search_key_tag, search_key_version, embedding_model, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'model', ?, ?, ?, 1, NULL, NULL, NULL, NULL, '', 1, ?, ?)`,
  ).run('model-a', 'test-provider', 'https://model.example.test/v1', envelope.cipher, envelope.nonce, envelope.tag, now, now)
  const audit = createAuditStore(db)
  const service = createAgentService({ db, audit })
  const agent = service.create({ name: '助手' })
  service.updateDraft({
    agentId: agent.id,
    draft: {
      name: '助手',
      prompt: '你是一个测试助手。',
      model: { modelId: 'model-a', name: 'test-model', supportsTools: false },
      pacing: { baseDelayMs: 100, charsPerSecond: 0, maxDelayMs: 300 },
    },
    expectedRevision: 1,
    actorId: 'a',
  })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  const rules = createQQRuleRepository(db)
  rules.upsertAccount({ id: 'bot-a', platform: 'qq-onebot', selfId: '12345' })
  rules.upsertRule({ accountId: 'bot-a', scopeType: 'group', scopeKey: '34567', allow: true, trigger: { mention: true }, maxLevel: 0 })
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'group', scopeKey: '34567', agentId: agent.id })
  const router = createQQRouter({ db, service })
  const conversations = createConversationStore(db)
  const plans = createReplyPlanStore(db)
  const calls = []
  const client = {
    identity: { selfId: '12345', generation: 1 },
    call: async (action, params) => {
      calls.push({ action, params })
    },
  }
  return { db, service, router, conversations, plans, client, calls, agent, secretStore }
}

test('full runtime flow sends a paced reply and stores the delivered turn', async (t) => {
  const { db, router, conversations, plans, client, calls, agent } = fixture(t)
  const policyEngine = createPolicyEngine({ db })
  const scheduler = createReplyScheduler({
    db,
    plans,
    conversations,
    client,
    renderReply,
    policyEngine,
    router,
    intervalMs: 5,
    logger: { error() {} },
  })
  scheduler.start()
  t.after(() => scheduler.stop())
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine,
    scheduler,
    complete: async () => ({ text: '模型回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied', errorCode: 'UNKNOWN_TOOL' }) },
    sessionQueue: createSessionQueue(),
  })
  const result = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: '1',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  assert.equal(result.status, 'queued')
  const deadline = Date.now() + 3000
  while (calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.message[0].data.text, '模型回复')
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE delivery_status = 'sent'").get().count, 2)
  assert.equal(db.prepare('SELECT status FROM runs WHERE id = ?').get(db.prepare('SELECT id FROM runs LIMIT 1').get().id).status, 'sent')
})

test('runtime passes the published Agent model name to the model client', async (t) => {
  const { db, router, conversations } = fixture(t)
  let queuedTask
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: { schedule() {} },
    complete: async ({ provider }) => {
      assert.equal(provider.modelName, 'test-model')
      return { text: '模型回复', toolCalls: [] }
    },
    tools: { execute: async () => ({ status: 'denied' }) },
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  const result = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'model-name',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  assert.equal(result.status, 'queued')
  await queuedTask()
})

test('QQ message reaches the model client and sends its reply with token usage', async (t) => {
  const { db, router, conversations, plans, client, calls, secretStore } = fixture(t)
  const policyEngine = createPolicyEngine({ db })
  const scheduler = createReplyScheduler({ db, plans, conversations, client, renderReply, policyEngine, router, intervalMs: 5 })
  scheduler.start()
  t.after(() => scheduler.stop())
  let requestBody
  const modelClient = createModelClient({ secretStore })
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine,
    scheduler,
    complete: (args) =>
      modelClient({
        ...args,
        transport: async (_url, options) => {
          requestBody = JSON.parse(options.body)
          return new Response(
            JSON.stringify({
              id: 'model-reply',
              object: 'chat.completion',
              choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '你好！' } }],
              usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        },
      }),
    tools: { execute: async () => ({ status: 'denied' }) },
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
    sessionQueue: createSessionQueue(),
  })
  const result = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'full-model',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  assert.equal(result.status, 'queued')
  const deadline = Date.now() + 3000
  while (calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls[0]?.params.message[0].data.text, '你好！')
  assert.equal(requestBody.model, 'test-model')
})

test('model failures are recorded and logged instead of leaving a queued run', async (t) => {
  const { db, router, conversations } = fixture(t)
  let queuedTask
  const errors = []
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: { schedule() {} },
    complete: async () => {
      throw new Error('provider unavailable')
    },
    tools: { execute: async () => ({ status: 'denied' }) },
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
    logger: { error: (...args) => errors.push(args) },
  })
  const accepted = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'model-failure',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  const run = db.prepare('SELECT status, error_code FROM runs WHERE id = ?').get(accepted.runId)
  assert.deepEqual(run, { status: 'failed', error_code: 'AGENT_TURN_FAILED' })
  assert.equal(errors.length, 1)
  assert.match(errors[0][1], /Agent 回复生成失败/)
})

test('model-task commands call the same configured model as ordinary chat', async (t) => {
  const { db, router, conversations } = fixture(t)
  let queuedTask
  let scheduled
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: {
      match: () => ({ executionType: 'model_task', args: ['你好'], capabilities: [], steps: [{ template: '解释 {args}' }] }),
      definitions: () => [],
    },
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule: (plan) => {
        scheduled = plan
      },
    },
    complete: async ({ model, modelName, messages }) => {
      assert.equal(modelName, 'test-model')
      assert.equal(model.id, 'model-a')
      assert.equal(messages.at(-1).content, '解释 你好')
      return { text: '模型任务回复', toolCalls: [] }
    },
    tools: { execute: async () => ({ status: 'denied' }) },
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
    logger: { error() {} },
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'model-task',
    text: '/explain 你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.equal(scheduled?.reply.text, '模型任务回复')
})

test('/reset cancels the pending reply and answers immediately', async (t) => {
  const { db, router, conversations, plans, client, calls, agent } = fixture(t)
  const policyEngine = createPolicyEngine({ db })
  const scheduler = createReplyScheduler({
    db,
    plans,
    conversations,
    client,
    renderReply,
    policyEngine,
    router,
    intervalMs: 5,
    logger: { error() {} },
  })
  scheduler.start()
  t.after(() => scheduler.stop())
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine,
    scheduler,
    complete: async () => ({ text: '慢回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied', errorCode: 'UNKNOWN_TOOL' }) },
    sessionQueue: createSessionQueue(),
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: '1',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const reset = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: '2',
    text: '/reset',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  assert.equal(reset.status, 'queued')
  const deadline = Date.now() + 2000
  while (calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.message[0].data.text, '已重置这段对话。')
})

test('/new starts a fresh context and replies immediately', async (t) => {
  const { db, router, conversations } = fixture(t)
  let queuedTask
  let scheduled
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule: (plan) => {
        scheduled = plan
      },
      cancelForConversation: () => {},
    },
    complete: async () => ({ text: '旧回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied' }) },
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  const accepted = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'new-1',
    text: '/新对话',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  assert.equal(accepted.status, 'queued')
  await queuedTask()
  assert.equal(scheduled.reply.text, '好的，已开启一轮新的对话。')
  const run = db.prepare('SELECT status, conversation_id FROM runs WHERE id = ?').get(accepted.runId)
  assert.equal(run.status, 'sent')
  const oldRow = db.prepare('SELECT active FROM conversations WHERE id = ?').get(run.conversation_id)
  assert.equal(oldRow.active, 0)
  const fresh = db.prepare('SELECT active, current_epoch FROM conversations WHERE active = 1 LIMIT 1').get()
  assert.equal(fresh.active, 1)
  assert.equal(fresh.current_epoch, 1)
  assert.equal(scheduled.epoch, 1)
})

test('/help lists the built-in new chat command', async (t) => {
  const { db, router, conversations } = fixture(t)
  let queuedTask
  let scheduled
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule: (plan) => {
        scheduled = plan
      },
      cancelForConversation: () => {},
    },
    complete: async () => ({ text: '', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied' }) },
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  const accepted = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'help-1',
    text: '/help',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.match(scheduled.reply.text, /\/new - 开启一轮新的对话/)
  assert.match(scheduled.reply.text, /\/reset - 清除当前会话上下文/)
})

test('persona attributes, relations and knowledge enter the system prompt', async (t) => {
  const { db, service, router, conversations, agent } = fixture(t)
  service.updateDraft({
    agentId: agent.id,
    draft: {
      attributes: { name: '林安宁', birthDate: '1988-05-06', gender: '女', occupation: '编辑', hobbies: '读书' },
    },
    expectedRevision: 3,
    actorId: 'a',
  })
  service.publish({ agentId: agent.id, expectedRevision: 4, actorId: 'a' })
  const now = Date.now()
  db.prepare(
    'INSERT INTO agent_relations (id, agent_id, person_name, relation_json, context_doc, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('rel-1', agent.id, '周叙', JSON.stringify({ description: '丈夫' }), '他是丈夫，习惯独自决定家里大事。', now, now)
  db.prepare('INSERT INTO agent_knowledge_docs (id, agent_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'doc-1',
    agent.id,
    '上海往事',
    '她年轻时在出版社工作。',
    now,
    now,
  )
  let queuedTask
  let system
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule() {},
      cancelForConversation() {},
    },
    complete: async ({ messages }) => {
      system = messages[0].content
      return { text: '回复', toolCalls: [] }
    },
    tools: { execute: async () => ({ status: 'denied' }) },
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'persona-1',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.match(system, /角色档案/)
  assert.match(system, /姓名：林安宁/)
  assert.match(system, /职业：编辑/)
  assert.match(system, /人物关系（周叙）/)
  assert.match(system, /背景资料（上海往事）/)
})

test('stale relations refresh automatically before a normal turn', async (t) => {
  const { db, service, router, conversations, agent } = fixture(t)
  const profileService = createAgentProfileService({
    db,
    service,
    audit: createAuditStore(db),
    complete: async () => ({ text: '生成的关系文档', toolCalls: [] }),
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
  })
  const now = Date.now()
  db.prepare(
    'INSERT INTO agent_relations (id, agent_id, person_name, relation_json, context_doc, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('rel-stale', agent.id, '周叙', '{}', '', now - RELATIONS_TTL_MS - 1000, now)
  let queuedTask
  let replyText
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule: (plan) => {
        replyText = plan.reply.text
      },
      cancelForConversation() {},
    },
    complete: async () => ({ text: '对话回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied' }) },
    refreshStaleRelations: ({ agentId }) => profileService.refreshStaleRelations({ agentId }),
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'stale-1',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.equal(db.prepare('SELECT context_doc FROM agent_relations WHERE id = ?').get('rel-stale').context_doc, '生成的关系文档')
  assert.equal(replyText, '对话回复')
})

test('/refresh manually refreshes all relations and replies', async (t) => {
  const { db, service, router, conversations, agent } = fixture(t)
  const profileService = createAgentProfileService({
    db,
    service,
    audit: createAuditStore(db),
    complete: async () => ({ text: '生成的关系文档', toolCalls: [] }),
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
  })
  const now = Date.now()
  db.prepare(
    'INSERT INTO agent_relations (id, agent_id, person_name, relation_json, context_doc, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('rel-a', agent.id, '周叙', '{}', '', now, now)
  db.prepare(
    'INSERT INTO agent_relations (id, agent_id, person_name, relation_json, context_doc, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('rel-b', agent.id, '陈屿', '{}', '', now, now)
  let queuedTask
  let replyText
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule: (plan) => {
        replyText = plan.reply.text
      },
      cancelForConversation() {},
    },
    complete: async () => ({ text: '', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied' }) },
    refreshAllRelations: ({ agentId }) => profileService.refreshAllRelations({ agentId }),
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'refresh-1',
    text: '/更新关系',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.equal(replyText, '已更新 2 位人物关系上下文。')
})

test('knowledge retrieval injects only matched chunks when configured', async (t) => {
  const { db, router, conversations, agent } = fixture(t)
  const now = Date.now()
  db.prepare('INSERT INTO agent_knowledge_docs (id, agent_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'doc-a',
    agent.id,
    '上海往事',
    '她在出版社工作。',
    now,
    now,
  )
  db.prepare('INSERT INTO agent_knowledge_docs (id, agent_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'doc-b',
    agent.id,
    '童年',
    '她小时候住在乡下。',
    now,
    now,
  )
  const knowledge = {
    retrieve: async ({ query }) => (query === '你记得出版社吗' ? [{ title: '上海往事', content: '她在出版社工作。', score: 0.9 }] : []),
  }
  let queuedTask
  let system
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule() {},
      cancelForConversation() {},
    },
    complete: async ({ messages }) => {
      system = messages[0].content
      return { text: '回复', toolCalls: [] }
    },
    tools: { execute: async () => ({ status: 'denied' }) },
    knowledge,
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'knowledge-1',
    text: '你记得出版社吗',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.match(system, /背景资料（上海往事）：她在出版社工作。/)
  assert.doesNotMatch(system, /童年/)
})

test('character graph subgraph is injected around the mentioned person', async (t) => {
  const { db, router, conversations, agent } = fixture(t)
  const now = Date.now()
  db.prepare(
    "INSERT INTO character_nodes (id, agent_id, name, attributes_json, summary, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?)",
  ).run('n-main', agent.id, '林安宁', '主角', now, now)
  db.prepare(
    "INSERT INTO character_nodes (id, agent_id, name, attributes_json, summary, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?)",
  ).run('n-son', agent.id, '儿子', '孩子', now, now)
  db.prepare(
    "INSERT INTO character_nodes (id, agent_id, name, attributes_json, summary, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?)",
  ).run('n-zhou', agent.id, '周叙', '分居中的丈夫', now, now)
  db.prepare(
    'INSERT INTO character_edges (id, agent_id, source_id, target_id, relation_type, description, boundary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('e-son', agent.id, 'n-main', 'n-son', '母子', '她照顾儿子。', '注意孩子感受。', now, now)
  db.prepare(
    'INSERT INTO character_edges (id, agent_id, source_id, target_id, relation_type, description, boundary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('e-zhou', agent.id, 'n-main', 'n-zhou', '分居的丈夫', '两人已经分开。', '尊重彼此边界。', now, now)
  let queuedTask
  let system
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule() {},
      cancelForConversation() {},
    },
    complete: async ({ messages }) => {
      system = messages[0].content
      return { text: '回复', toolCalls: [] }
    },
    tools: { execute: async () => ({ status: 'denied' }) },
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'graph-1',
    text: '我是周叙',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.match(system, /人物图谱/)
  assert.match(system, /林安宁—周叙/)
  assert.match(system, /林安宁—儿子/)
})

test('retrieved knowledge entities expand the character graph', async (t) => {
  const { db, router, conversations, agent } = fixture(t)
  const now = Date.now()
  db.prepare(
    "INSERT INTO character_nodes (id, agent_id, name, attributes_json, summary, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?)",
  ).run('n-main', agent.id, '林安宁', '主角', now, now)
  db.prepare(
    "INSERT INTO character_nodes (id, agent_id, name, attributes_json, summary, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?)",
  ).run('n-zhou', agent.id, '周叙', '分居中的丈夫', now, now)
  db.prepare(
    'INSERT INTO character_edges (id, agent_id, source_id, target_id, relation_type, description, boundary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('e-zhou', agent.id, 'n-main', 'n-zhou', '分居的丈夫', '两人已经分开。', '尊重彼此边界。', now, now)
  const knowledge = {
    retrieve: async () => [{ title: '最近动向', content: '周叙最近从外地回来，两人还没有见面。', score: 0.8 }],
  }
  let queuedTask
  let system
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule() {},
      cancelForConversation() {},
    },
    complete: async ({ messages }) => {
      system = messages[0].content
      return { text: '回复', toolCalls: [] }
    },
    tools: { execute: async () => ({ status: 'denied' }) },
    knowledge,
    sessionQueue: {
      enqueue(_key, task) {
        queuedTask = task
        return { queued: true }
      },
    },
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'graph-fusion-1',
    text: '他还好吗',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await queuedTask()
  assert.match(system, /人物图谱/)
  assert.match(system, /周叙：分居中的丈夫/)
  assert.match(system, /林安宁—周叙/)
  assert.match(system, /背景资料（最近动向）/)
})

test('idle messages start a new conversation automatically without a special reply', async (t) => {
  const { db, router, conversations, agent } = fixture(t)
  let tasks = []
  let scheduled
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule: (plan) => {
        scheduled = plan
      },
      cancelForConversation() {},
    },
    complete: async () => ({ text: '自动新会话的回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied' }) },
    idleConversationMs: 10000,
    sessionQueue: {
      enqueue(_key, task) {
        tasks.push(task)
        return { queued: true }
      },
    },
  })
  const first = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'idle-1',
    text: '第一条',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await tasks[0]()
  const firstRun = db.prepare('SELECT conversation_id FROM runs WHERE id = ?').get(first.runId)
  const firstConversation = firstRun.conversation_id
  db.prepare('UPDATE messages SET created_at = ? WHERE conversation_id = ?').run(Date.now() - 20000, firstConversation)
  const second = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'idle-2',
    text: '第二条',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await tasks[1]()
  const secondRun = db.prepare('SELECT conversation_id FROM runs WHERE id = ?').get(second.runId)
  assert.notEqual(secondRun.conversation_id, firstConversation)
  assert.equal(db.prepare('SELECT active FROM conversations WHERE id = ?').get(firstConversation).active, 0)
  const fresh = db.prepare('SELECT active FROM conversations WHERE id = ?').get(secondRun.conversation_id)
  assert.equal(fresh.active, 1)
  const firstTexts = db.prepare('SELECT content_json FROM messages WHERE conversation_id = ? AND role = ?').all(firstConversation, 'user')
  const secondTexts = db.prepare('SELECT content_json FROM messages WHERE conversation_id = ? AND role = ?').all(secondRun.conversation_id, 'user')
  assert.deepEqual(
    firstTexts.map((row) => JSON.parse(row.content_json).text),
    ['第一条'],
  )
  assert.deepEqual(
    secondTexts.map((row) => JSON.parse(row.content_json).text),
    ['第二条'],
  )
  assert.equal(scheduled.reply.text, '自动新会话的回复')
})

test('recent messages reuse the active conversation', async (t) => {
  const { db, router, conversations } = fixture(t)
  let tasks = []
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine: createPolicyEngine({ db }),
    scheduler: {
      schedule() {},
      cancelForConversation() {},
    },
    complete: async () => ({ text: '回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied' }) },
    idleConversationMs: 60000,
    sessionQueue: {
      enqueue(_key, task) {
        tasks.push(task)
        return { queued: true }
      },
    },
  })
  const first = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'recent-1',
    text: '第一条',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await tasks[0]()
  const second = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: 'recent-2',
    text: '第二条',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await tasks[1]()
  const firstRun = db.prepare('SELECT conversation_id FROM runs WHERE id = ?').get(first.runId)
  const secondRun = db.prepare('SELECT conversation_id FROM runs WHERE id = ?').get(second.runId)
  assert.equal(firstRun.conversation_id, secondRun.conversation_id)
})
