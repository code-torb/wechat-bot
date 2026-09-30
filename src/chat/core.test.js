import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatCore } from './core.js'

let nextMessageId = 0

function message(overrides = {}) {
  return {
    platform: 'qq',
    botId: 'bot-1',
    groupId: 'group-1',
    userId: 'user-1',
    messageId: `message-${++nextMessageId}`,
    text: '你好',
    ...overrides,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function resolveOnNextTurn(promise) {
  const pending = Symbol('pending')
  const result = await Promise.race([
    promise,
    new Promise((resolve) => {
      setImmediate(() => resolve(pending))
    }),
  ])
  return { pending: result === pending, result }
}

test('empty input returns help without calling the provider', async () => {
  let calls = 0
  const core = createChatCore({
    complete: async () => {
      calls += 1
      return '不会被调用'
    },
  })

  const reply = await core.handle(message({ text: '   ' }))

  assert.match(reply, /\/reset/)
  assert.match(reply, /\/help/)
  assert.equal(calls, 0)
})

test('sends system prompt with completed history capped by maxTurns', async () => {
  const calls = []
  const core = createChatCore({
    systemPrompt: '系统提示',
    maxTurns: 1,
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return `回复 ${calls.length}`
    },
  })

  assert.equal(await core.handle(message({ text: '  第一条  ' })), '回复 1')
  assert.equal(await core.handle(message({ text: '第二条' })), '回复 2')
  assert.equal(await core.handle(message({ text: '第三条' })), '回复 3')

  assert.deepEqual(calls[0], [
    { role: 'system', content: '系统提示' },
    { role: 'user', content: '第一条' },
  ])
  assert.deepEqual(calls[1], [
    { role: 'system', content: '系统提示' },
    { role: 'user', content: '第一条' },
    { role: 'assistant', content: '回复 1' },
    { role: 'user', content: '第二条' },
  ])
  assert.deepEqual(calls[2], [
    { role: 'system', content: '系统提示' },
    { role: 'user', content: '第二条' },
    { role: 'assistant', content: '回复 2' },
    { role: 'user', content: '第三条' },
  ])
})

test('stores the same trimmed and clamped reply that it delivers', async () => {
  const calls = []
  const core = createChatCore({
    maxReplyChars: 4,
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return calls.length === 1 ? '  123456  ' : '好的'
    },
  })

  assert.equal(await core.handle(message({ text: '第一条' })), '1234')
  assert.equal(await core.handle(message({ text: '第二条' })), '好的')

  assert.deepEqual(calls[1].slice(1, 4), [
    { role: 'user', content: '第一条' },
    { role: 'assistant', content: '1234' },
    { role: 'user', content: '第二条' },
  ])
})

test('isolates sessions across platform bot group and user ids', async () => {
  const calls = []
  const core = createChatCore({
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return '收到'
    },
  })

  await core.handle(message({ platform: 'a|b', botId: 'c', groupId: 'd', userId: 'e', text: '碰撞一' }))
  await core.handle(message({ platform: 'a', botId: 'b|c', groupId: 'd', userId: 'e', text: '碰撞二' }))
  await core.handle(message({ groupId: 'group-2', text: '另一群' }))
  await core.handle(message({ botId: 'bot-2', text: '另一机器人' }))
  await core.handle(message({ userId: 'user-2', text: '另一用户' }))

  for (const call of calls) {
    assert.equal(call.length, 2)
  }
})

test('reset clears only the current session', async () => {
  const calls = []
  const core = createChatCore({
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return `回复 ${calls.length}`
    },
  })

  await core.handle(message({ userId: 'user-a', text: 'A1' }))
  await core.handle(message({ userId: 'user-b', text: 'B1' }))
  assert.match(await core.handle(message({ userId: 'user-a', text: '/reset' })), /重置/)
  await core.handle(message({ userId: 'user-a', text: 'A2' }))
  await core.handle(message({ userId: 'user-b', text: 'B2' }))

  assert.deepEqual(calls[2], [
    { role: 'system', content: '你是一个友好、简洁的中文聊天助手。' },
    { role: 'user', content: 'A2' },
  ])
  assert.deepEqual(calls[3].slice(1), [
    { role: 'user', content: 'B1' },
    { role: 'assistant', content: '回复 2' },
    { role: 'user', content: 'B2' },
  ])
})

test('new chat clears only the current session', async () => {
  const calls = []
  const core = createChatCore({
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return `回复 ${calls.length}`
    },
  })

  await core.handle(message({ userId: 'user-a', text: 'A1' }))
  await core.handle(message({ userId: 'user-b', text: 'B1' }))
  assert.match(await core.handle(message({ userId: 'user-a', text: '/新对话' })), /开启一轮新的对话/)
  await core.handle(message({ userId: 'user-a', text: 'A2' }))
  await core.handle(message({ userId: 'user-b', text: 'B2' }))

  assert.deepEqual(calls[2], [
    { role: 'system', content: '你是一个友好、简洁的中文聊天助手。' },
    { role: 'user', content: 'A2' },
  ])
  assert.deepEqual(calls[3].slice(1), [
    { role: 'user', content: 'B1' },
    { role: 'assistant', content: '回复 2' },
    { role: 'user', content: 'B2' },
  ])
})

test('failed completions leave history unchanged and release the session', async () => {
  const calls = []
  let shouldFail = true
  const core = createChatCore({
    complete: async (messages) => {
      calls.push(messages)
      if (shouldFail) {
        shouldFail = false
        throw new Error('provider failed')
      }
      return '恢复了'
    },
  })

  assert.match(await core.handle(message({ text: '会失败' })), /抱歉/)
  assert.equal(await core.handle(message({ text: '重试' })), '恢复了')

  assert.deepEqual(calls[1], [
    { role: 'system', content: '你是一个友好、简洁的中文聊天助手。' },
    { role: 'user', content: '重试' },
  ])
})

test('same session rejects overlapping messages and reset while active', async () => {
  const slow = deferred()
  const calls = []
  const core = createChatCore({
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return slow.promise
    },
  })

  const first = core.handle(message({ text: '慢请求' }))
  const overlap = core.handle(message({ text: '并发消息' }))
  const overlapResult = await resolveOnNextTurn(overlap)
  if (overlapResult.pending) {
    slow.resolve('错误地进入了 provider')
    await first
    await overlap
    assert.fail('overlapping same-session message did not return promptly')
  }
  assert.match(overlapResult.result, /稍等|忙/)

  const reset = core.handle(message({ text: '/reset' }))
  const resetResult = await resolveOnNextTurn(reset)
  if (resetResult.pending) {
    slow.resolve('错误地进入了 provider')
    await first
    await reset
    assert.fail('reset did not return promptly while the session was active')
  }
  assert.match(resetResult.result, /稍等|忙/)
  assert.equal(calls.length, 1)

  slow.resolve('慢回复')
  assert.equal(await first, '慢回复')

  const next = core.handle(message({ text: '下一条' }))
  assert.deepEqual(calls[1].slice(1), [
    { role: 'user', content: '慢请求' },
    { role: 'assistant', content: '慢回复' },
    { role: 'user', content: '下一条' },
  ])
  slow.resolve('下一条回复')
  await next
})

test('global concurrency rejects extra model calls without calling provider', async () => {
  const slow = deferred()
  const calls = []
  const core = createChatCore({
    maxConcurrent: 1,
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return slow.promise
    },
  })

  const first = core.handle(message({ userId: 'user-a', text: '慢请求' }))
  const rejected = core.handle(message({ userId: 'user-b', text: '另一个请求' }))
  const rejectedResult = await resolveOnNextTurn(rejected)
  if (rejectedResult.pending) {
    slow.resolve('错误地进入了 provider')
    await first
    await rejected
    assert.fail('global concurrency did not return promptly')
  }
  assert.match(rejectedResult.result, /忙/)
  assert.equal(calls.length, 1)

  slow.resolve('完成')
  assert.equal(await first, '完成')
})

test('cooldown skips model calls but still allows help and reset', async () => {
  let clock = 1000
  const calls = []
  const core = createChatCore({
    cooldownMs: 2000,
    now: () => clock,
    complete: async (messages) => {
      calls.push(messages)
      return `回复 ${calls.length}`
    },
  })

  assert.equal(await core.handle(message({ text: '第一条' })), '回复 1')
  assert.match(await core.handle(message({ text: '太快' })), /稍后|太快/)
  assert.equal(calls.length, 1)
  assert.match(await core.handle(message({ text: '/help' })), /\/reset/)

  clock += 2001
  assert.equal(await core.handle(message({ text: '过了冷却' })), '回复 2')
  assert.match(await core.handle(message({ text: '/reset' })), /重置/)
  assert.equal(await core.handle(message({ text: '重置后' })), '回复 3')
})

test('ttl expires idle sessions before sending history', async () => {
  let clock = 0
  const calls = []
  const core = createChatCore({
    sessionTtlMs: 100,
    cooldownMs: 0,
    now: () => clock,
    complete: async (messages) => {
      calls.push(messages)
      return `回复 ${calls.length}`
    },
  })

  await core.handle(message({ text: '第一条' }))
  clock = 101
  await core.handle(message({ text: '第二条' }))

  assert.deepEqual(calls[1], [
    { role: 'system', content: '你是一个友好、简洁的中文聊天助手。' },
    { role: 'user', content: '第二条' },
  ])
})

test('capacity pruning keeps active sessions and removes idle ones', async () => {
  let clock = 0
  const slow = deferred()
  const calls = []
  const core = createChatCore({
    maxSessions: 2,
    cooldownMs: 0,
    now: () => clock,
    complete: async (messages) => {
      calls.push(messages)
      const text = messages.at(-1).content
      if (text === 'A1') return slow.promise
      return `${text}-reply`
    },
  })

  const activeA = core.handle(message({ userId: 'user-a', text: 'A1' }))
  clock = 1
  await core.handle(message({ userId: 'user-b', text: 'B1' }))
  clock = 2
  await core.handle(message({ userId: 'user-c', text: 'C1' }))
  slow.resolve('A1-reply')
  assert.equal(await activeA, 'A1-reply')

  clock = 3
  await core.handle(message({ userId: 'user-a', text: 'A2' }))
  clock = 4
  await core.handle(message({ userId: 'user-b', text: 'B2' }))

  const a2Call = calls.find((call) => call.at(-1).content === 'A2')
  const b2Call = calls.find((call) => call.at(-1).content === 'B2')
  assert.deepEqual(a2Call.slice(1), [
    { role: 'user', content: 'A1' },
    { role: 'assistant', content: 'A1-reply' },
    { role: 'user', content: 'A2' },
  ])
  assert.deepEqual(b2Call, [
    { role: 'system', content: '你是一个友好、简洁的中文聊天助手。' },
    { role: 'user', content: 'B2' },
  ])
})

test('capacity admission rejects new sessions when all slots are active', async () => {
  const slow = deferred()
  const calls = []
  const core = createChatCore({
    maxSessions: 1,
    maxConcurrent: 4,
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      const text = messages.at(-1).content
      if (text === 'A1') return slow.promise
      return `${text}-reply`
    },
  })

  const activeA = core.handle(message({ userId: 'user-a', text: 'A1' }))
  assert.match(await core.handle(message({ userId: 'user-b', text: 'B1' })), /忙/)
  assert.match(await core.handle(message({ userId: 'user-b', text: 'B2' })), /忙/)
  assert.match(await core.handle(message({ userId: 'user-b', text: '/reset' })), /重置/)
  assert.equal(calls.length, 1)

  slow.resolve('A1-reply')
  assert.equal(await activeA, 'A1-reply')

  await core.handle(message({ userId: 'user-b', text: 'B3' }))
  const b3Call = calls.find((call) => call.at(-1).content === 'B3')
  assert.deepEqual(b3Call, [
    { role: 'system', content: '你是一个友好、简洁的中文聊天助手。' },
    { role: 'user', content: 'B3' },
  ])
})

test('reply truncation preserves whole unicode characters', async () => {
  const calls = []
  const core = createChatCore({
    maxReplyChars: 1,
    cooldownMs: 0,
    complete: async (messages) => {
      calls.push(messages)
      return calls.length === 1 ? '🙂好' : '行'
    },
  })

  assert.equal(await core.handle(message({ text: '第一条' })), '🙂')
  assert.equal(await core.handle(message({ text: '第二条' })), '行')
  assert.deepEqual(calls[1].slice(1, 4), [
    { role: 'user', content: '第一条' },
    { role: 'assistant', content: '🙂' },
    { role: 'user', content: '第二条' },
  ])
})

test('overlong input asks the user to shorten without calling the provider', async () => {
  let calls = 0
  const core = createChatCore({
    maxInputChars: 3,
    complete: async () => {
      calls += 1
      return '不会被调用'
    },
  })

  assert.match(await core.handle(message({ text: '四个字呢' })), /缩短|太长/)
  assert.equal(calls, 0)
})
