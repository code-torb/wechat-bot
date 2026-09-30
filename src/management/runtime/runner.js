import { compileStyles } from '../styles/compiler.js'
import { executeCommand } from '../commands/executor.js'

const RESET_REPLY = '已重置这段对话。'
const NEW_CHAT_REPLY = '好的，已开启一轮新的对话。'

export function createAgentRuntime({
  db,
  conversations,
  router,
  commandRegistry,
  policyEngine,
  scheduler,
  complete,
  tools,
  getModel,
  sessionQueue,
  refreshStaleRelations,
  refreshAllRelations,
  knowledge,
  logger = console,
}) {
  function matchingNodeIds(agentVersion, texts) {
    const nodes = db.prepare('SELECT id, name FROM character_nodes WHERE agent_id = ?').all(agentVersion.id)
    const found = new Set()
    for (const node of nodes) {
      if (!node.name) continue
      for (const text of texts) {
        if (typeof text === 'string' && text.includes(node.name)) {
          found.add(node.id)
          break
        }
      }
    }
    return Array.from(found)
  }

  function graphContext(agentVersion, query, extraAnchors = []) {
    const nodes = db.prepare('SELECT id, name, summary FROM character_nodes WHERE agent_id = ?').all(agentVersion.id)
    if (!nodes.length) return ''
    const edges = db
      .prepare(
        'SELECT id, source_id, target_id, relation_type, description, boundary FROM character_edges WHERE agent_id = ? ORDER BY updated_at DESC',
      )
      .all(agentVersion.id)
    if (!edges.length) return ''
    const nameById = new Map(nodes.map((node) => [node.id, node.name]))
    const protagonist = agentVersion.attributes?.name || ''
    const anchors = new Set()
    for (const node of nodes) {
      if (node.name && query && query.includes(node.name)) anchors.add(node.id)
    }
    for (const id of extraAnchors) anchors.add(id)
    const anchorIds = Array.from(anchors)
    if (!anchorIds.length && protagonist) {
      const node = nodes.find((item) => item.name === protagonist)
      if (node) anchorIds.push(node.id)
    }
    if (!anchorIds.length && nodes.length) anchorIds.push(nodes[0].id)
    const hop1 = edges.filter((edge) => anchorIds.includes(edge.source_id) || anchorIds.includes(edge.target_id))
    const hop1Nodes = new Set(hop1.flatMap((edge) => [edge.source_id, edge.target_id]))
    const hop2 = edges.filter((edge) => hop1Nodes.has(edge.source_id) || hop1Nodes.has(edge.target_id))
    const selected = Array.from(new Map([...hop1, ...hop2].map((edge) => [edge.id, edge])).values()).slice(0, 8)
    const summaries = nodes.filter((node) => anchorIds.includes(node.id) && node.summary).map((node) => `${node.name}：${node.summary}`)
    const edgeLines = selected.map((edge) => {
      const source = nameById.get(edge.source_id) || '未知'
      const target = nameById.get(edge.target_id) || '未知'
      const type = edge.relation_type ? `（${edge.relation_type}）` : ''
      return `${source}—${target}${type}：${edge.description || edge.boundary || ''}`
    })
    return [...summaries, ...edgeLines].join('\n')
  }

  async function personaContext(agentVersion, query) {
    const attributes = agentVersion.attributes || {}
    const lines = []
    const fields = [
      ['姓名', attributes.name],
      ['出生日期', attributes.birthDate],
      ['性别', attributes.gender],
      ['职业', attributes.occupation],
      ['爱好', attributes.hobbies],
    ]
    for (const [label, value] of fields) {
      if (typeof value === 'string' && value.trim()) lines.push(`${label}：${value.trim()}`)
    }
    const relations = db
      .prepare("SELECT person_name, context_doc FROM agent_relations WHERE agent_id = ? AND context_doc <> '' ORDER BY updated_at DESC")
      .all(agentVersion.id)
    for (const rel of relations) {
      lines.push(`人物关系（${rel.person_name}）：${rel.context_doc.slice(0, 700)}`)
    }
    const docs = db.prepare('SELECT title, content FROM agent_knowledge_docs WHERE agent_id = ? ORDER BY created_at DESC').all(agentVersion.id)
    let knowledgeLines = null
    let retrievedTexts = []
    if (knowledge && query) {
      try {
        const hits = await knowledge.retrieve({ agentId: agentVersion.id, query, topK: 3 })
        if (hits.length) {
          knowledgeLines = hits.map((hit) => `背景资料（${hit.title || '知识片段'}）：${hit.content.slice(0, 500)}`)
          retrievedTexts = hits.map((hit) => hit.content)
        }
      } catch {
        knowledgeLines = null
      }
    }
    if (!knowledgeLines) {
      knowledgeLines = docs.map((doc) => `背景资料（${doc.title}）：${doc.content.slice(0, 500)}`)
    }
    const graph = graphContext(agentVersion, query, matchingNodeIds(agentVersion, retrievedTexts))
    if (graph) lines.push(`人物图谱：\n${graph}`)
    lines.push(...knowledgeLines)
    return lines.length ? `角色档案：\n${lines.join('\n')}` : ''
  }

  async function buildSystem(agentVersion, query) {
    const persona = await personaContext(agentVersion, query)
    const prompt = persona ? `${persona}\n\n${agentVersion.prompt}` : agentVersion.prompt
    return compileStyles({
      prompt,
      definitions: (agentVersion.styleValues || []).map((value) => {
        const version = db
          .prepare('SELECT name, low_text, mid_text, high_text FROM style_definition_versions WHERE id = ?')
          .get(value.definitionVersionId)
        return {
          key: value.definitionId,
          name: version?.name || value.definitionId,
          value: value.value,
          lowText: version?.low_text || '低',
          midText: version?.mid_text || '中',
          highText: version?.high_text || '高',
          enabled: true,
        }
      }),
    }).systemText
  }

  function availableHelp(agentVersion, context) {
    const builtins = [
      { name: '/new', description: '开启一轮新的对话' },
      { name: '/reset', description: '清除当前会话上下文' },
      { name: '/refresh', description: '手动更新人物关系上下文' },
    ]
    const items = commandRegistry.definitions(agentVersion).map((definition) => ({
      name: `/${definition.name}`,
      description: definition.input_schema_json ? '可配置命令' : '可配置命令',
    }))
    return [...builtins, ...items]
  }

  async function runTurn({ message, route, conversationId, epoch, runId, agentVersion }) {
    const text = message.text
    const command = commandRegistry.match(agentVersion, text)
    const completeForAgent = (messages) => {
      const modelRow = getModel ? getModel(agentVersion.model.modelId) : null
      return complete({
        model: modelRow,
        modelName: agentVersion.model.name,
        messages,
      })
    }
    if (command?.builtin === 'reset' || command?.builtin === 'newchat') {
      const reset = conversations.reset({ conversationId, actor: null })
      scheduler.cancelForConversation({ conversationId, epoch, reason: 'reset' })
      db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
      return {
        text: command.builtin === 'newchat' ? NEW_CHAT_REPLY : RESET_REPLY,
        immediate: true,
        epoch: reset.epoch,
        requiredCapabilities: ['chat'],
      }
    }
    if (command?.builtin === 'help') {
      const result = executeCommand({
        command,
        args: [],
        policy: { authorize: () => ({ allowed: true }) },
        helpItems: availableHelp(agentVersion, { message }),
      })
      db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
      return { text: result.text, immediate: true, requiredCapabilities: ['chat'] }
    }
    if (command?.builtin === 'refresh-relations') {
      db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
      try {
        const updated = (await refreshAllRelations?.({ agentId: agentVersion.id })) ?? 0
        return {
          text: updated > 0 ? `已更新 ${updated} 位人物关系上下文。` : '没有可更新的人物关系，或模型不可用。',
          immediate: true,
          requiredCapabilities: ['chat'],
        }
      } catch (error) {
        logger.error({ err: error, agentId: agentVersion.id }, '手动刷新人物关系失败')
        return { text: '人物关系更新失败，请确认模型已配置。', immediate: true, requiredCapabilities: ['chat'] }
      }
    }
    if (command) {
      const context = {
        botAccountId: message.botAccountId,
        scene: message.scene,
        peerId: message.peerId,
        senderId: message.senderId,
      }
      const result = executeCommand({
        command,
        args: command.args,
        policy: {
          authorize: ({ capability }) =>
            policyEngine.authorize({
              agentCapabilities: agentVersion.capabilities || [],
              sceneMaxLevel: route.maxLevel,
              principalGrants: policyEngine.principalGrants(context),
              resourceGrants: agentVersion.resourceGrants || [],
              capability,
            }),
        },
        helpItems: [],
      })
      if (result.type === 'reset' || result.type === 'newchat') {
        const reset = conversations.reset({ conversationId, actor: null })
        scheduler.cancelForConversation({ conversationId, epoch, reason: 'reset' })
        db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
        return {
          text: result.type === 'newchat' ? NEW_CHAT_REPLY : RESET_REPLY,
          immediate: true,
          epoch: reset.epoch,
          requiredCapabilities: ['chat'],
        }
      }
      if (result.type === 'denied') {
        db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
        return { text: result.text, immediate: true, requiredCapabilities: ['chat'] }
      }
      if (result.type === 'text') {
        db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
        return { text: result.text, immediate: true, requiredCapabilities: ['chat'] }
      }
      if (result.type === 'model_task') {
        const system = await buildSystem(agentVersion, text)
        const contextMessages = conversations.getContext({ conversationId, epoch, maxTurns: agentVersion.styleValues?.length ? 10 : 10 })
        const userText = result.template.replace('{args}', result.args)
        const reply = await completeForAgent([{ role: 'system', content: system }, ...contextMessages, { role: 'user', content: userText }])
        db.prepare("UPDATE runs SET status = 'waiting_send', effective_config_json = ? WHERE id = ?").run(
          JSON.stringify({ agentVersionId: agentVersion.versionId }),
          runId,
        )
        return { text: reply.text, immediate: false, requiredCapabilities: ['chat'] }
      }
    }

    if (!command) {
      try {
        await refreshStaleRelations?.({ agentId: agentVersion.id })
      } catch (error) {
        logger.warn({ err: error, agentId: agentVersion.id }, '人物关系自动更新失败，本轮对话继续')
      }
    }

    const system = await buildSystem(agentVersion, text)
    let messages = [
      { role: 'system', content: system },
      ...conversations.getContext({ conversationId, epoch, maxTurns: 10 }),
      { role: 'user', content: text },
    ]
    let replyText = ''
    const assetIds = []
    for (let round = 0; round < 3; round += 1) {
      const result = await completeForAgent(messages)
      if (!result.toolCalls?.length) {
        replyText = result.text
        break
      }
      for (const call of result.toolCalls) {
        const toolResult = await tools.execute({
          context: { botAccountId: message.botAccountId, scene: message.scene, peerId: message.peerId, senderId: message.senderId },
          call,
          agentVersion,
          runId,
          sceneMaxLevel: route.maxLevel,
        })
        if (call.name === 'meme.select' && toolResult.status === 'ok' && toolResult.data?.assetId) {
          assetIds.push(toolResult.data.assetId)
        }
        messages.push({
          role: 'user',
          content: `工具 ${call.name} 结果：${toolResult.status === 'ok' ? JSON.stringify(toolResult.data) : toolResult.errorCode || toolResult.status}`,
        })
      }
    }
    db.prepare("UPDATE runs SET status = 'waiting_send', effective_config_json = ? WHERE id = ?").run(
      JSON.stringify({ agentVersionId: agentVersion.versionId }),
      runId,
    )
    return { text: replyText, immediate: false, assetIds, requiredCapabilities: ['chat'] }
  }

  return {
    async accept(message) {
      const route = router.resolve(message)
      if (!route.accepted) return { status: 'ignored', reason: route.reason }
      const accepted = conversations.accept({
        message,
        agentId: route.agentId,
        agentVersionId: route.agentVersion.versionId || '',
      })
      if (accepted.duplicate) return { status: 'duplicate' }
      const key = `${message.botAccountId}:${accepted.conversationId}`
      const queued = sessionQueue.enqueue(key, async () => {
        try {
          const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(route.agentId)
          if (!agent || agent.status !== 'active') {
            db.prepare("UPDATE runs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(Date.now(), accepted.runId)
            return
          }
          const reply = await runTurn({
            message,
            route,
            conversationId: accepted.conversationId,
            epoch: accepted.epoch,
            runId: accepted.runId,
            agentVersion: route.agentVersion,
          })
          if (reply.immediate) {
            const immediateParams = {
              message: { scene: message.scene, peerId: message.peerId, senderId: message.senderId, messageId: message.messageId },
              reply: { text: reply.text, assetIds: [], sourceLinks: [], requiredCapabilities: reply.requiredCapabilities },
              quote: route.quoteReply,
            }
            scheduler.schedule({
              runId: accepted.runId,
              generation: message.connectionGeneration,
              epoch: reply.epoch ?? accepted.epoch,
              reply: immediateParams.reply,
              pacing: { baseDelayMs: 0, charsPerSecond: 0, maxDelayMs: 0 },
            })
          } else {
            scheduler.schedule({
              runId: accepted.runId,
              generation: message.connectionGeneration,
              epoch: accepted.epoch,
              reply: { text: reply.text, assetIds: [], sourceLinks: [], requiredCapabilities: reply.requiredCapabilities },
              pacing: route.pacing,
            })
          }
        } catch (error) {
          db.prepare("UPDATE runs SET status = 'failed', error_code = 'AGENT_TURN_FAILED', updated_at = ? WHERE id = ?").run(
            Date.now(),
            accepted.runId,
          )
          logger.error({ err: error, runId: accepted.runId }, 'Agent 回复生成失败')
        }
      })
      return queued.queued ? { status: 'queued', runId: accepted.runId } : { status: 'limited' }
    },
  }
}
