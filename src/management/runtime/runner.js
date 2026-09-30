import { compileStyles } from '../styles/compiler.js'
import { executeCommand } from '../commands/executor.js'

const RESET_REPLY = '已重置这段对话。'

export function createAgentRuntime({
  db,
  conversations,
  router,
  commandRegistry,
  policyEngine,
  scheduler,
  complete,
  tools,
  getCredential,
  getProvider,
  sessionQueue,
  logger = console,
}) {
  function buildSystem(agentVersion) {
    return compileStyles({
      prompt: agentVersion.prompt,
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
    const items = commandRegistry.definitions(agentVersion).map((definition) => ({
      name: `/${definition.name}`,
      description: definition.input_schema_json ? '可配置命令' : '可配置命令',
    }))
    return items
  }

  async function runTurn({ message, route, conversationId, epoch, runId, agentVersion }) {
    const text = message.text
    const command = commandRegistry.match(agentVersion, text)
    const completeForAgent = (messages) => {
      const credentialRow = getCredential ? getCredential(agentVersion.model.credentialRef) : null
      const providerRow = getProvider ? getProvider(agentVersion.model.providerId) : null
      return complete({
        provider: { ...(providerRow || { id: agentVersion.model.providerId, base_url: '' }), modelName: agentVersion.model.name },
        credentialRow,
        messages,
      })
    }
    if (command?.builtin === 'reset') {
      const reset = conversations.reset({ conversationId, actor: null })
      scheduler.cancelForConversation({ conversationId, epoch, reason: 'reset' })
      db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
      return { text: RESET_REPLY, immediate: true, epoch: reset.epoch, requiredCapabilities: ['chat'] }
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
      if (result.type === 'reset') {
        const reset = conversations.reset({ conversationId, actor: null })
        scheduler.cancelForConversation({ conversationId, epoch, reason: 'reset' })
        db.prepare("UPDATE runs SET status = 'sent' WHERE id = ?").run(runId)
        return { text: RESET_REPLY, immediate: true, epoch: reset.epoch, requiredCapabilities: ['chat'] }
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
        const system = buildSystem(agentVersion)
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

    const system = buildSystem(agentVersion)
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
