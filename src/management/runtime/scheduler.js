import { calculateReplyDelay } from '../../chat/pacing.js'

export function createReplyScheduler({
  db,
  plans,
  conversations,
  client,
  renderReply,
  policyEngine,
  router,
  clock = Date.now,
  sleep,
  intervalMs = 100,
  logger = console,
}) {
  let timer = null
  let stopped = false

  async function deliver(plan) {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(plan.run_id)
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(run.conversation_id)
    const reply = JSON.parse(plan.reply_json)
    if (!conversation || conversation.current_epoch !== plan.epoch) {
      plans.setState(plan.id, 'cancelled')
      return
    }
    if (!client.identity || client.identity.generation !== plan.generation) {
      plans.setState(plan.id, 'cancelled')
      return
    }
    const principal = {
      botAccountId: conversation.bot_account_id,
      scene: conversation.scene,
      peerId: conversation.peer_id,
      senderId: conversation.sender_id,
    }
    const grants = policyEngine.principalGrants(principal)
    const capabilities = reply.requiredCapabilities || ['chat']
    for (const capability of capabilities) {
      const check = policyEngine.authorize({
        agentCapabilities: [capability],
        sceneMaxLevel: 3,
        principalGrants: grants,
        resourceGrants: [],
        capability,
      })
      if (!check.allowed) {
        plans.setState(plan.id, 'cancelled')
        return
      }
    }
    plans.setState(plan.id, 'sending')
    const params = renderReply({
      message: {
        scene: conversation.scene,
        peerId: conversation.peer_id,
        senderId: conversation.sender_id,
        messageId: 'reply-plan',
      },
      reply,
      quote: false,
    })
    try {
      await client.call(params.action, params.params, { generation: plan.generation })
      plans.setState(plan.id, 'sent')
      conversations.markDelivered({ conversationId: conversation.id, runId: plan.run_id, text: reply.text })
    } catch (error) {
      plans.setState(plan.id, 'failed')
      logger.error(`QQ 回复未发送：${error.message}`)
    }
  }

  async function tick() {
    if (stopped) return
    const due = plans.pendingDue(clock())
    for (const plan of due) {
      await deliver(plan)
    }
    timer = setTimeout(tick, intervalMs)
  }

  return {
    schedule({ runId, generation, epoch, reply, pacing }) {
      const delay = calculateReplyDelay(reply.text, pacing)
      const dueAt = clock() + delay
      return plans.insert({ runId, generation, epoch, reply, pacing, dueAt })
    },
    cancelForConversation({ conversationId, epoch, reason = 'reset' }) {
      return plans.cancelForConversation({ conversationId, epoch, reason })
    },
    start() {
      stopped = false
      plans.cancelAll({ reason: 'restart' })
      timer = setTimeout(tick, intervalMs)
    },
    async stop() {
      stopped = true
      clearTimeout(timer)
      timer = null
    },
  }
}
