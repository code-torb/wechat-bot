import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeGroupMessage, groupReplyParams, createOneBotMessageHandler } from './messages.js'

const identity = { selfId: '12345', generation: 1 }
const event = (overrides = {}) => ({
  post_type: 'message',
  message_type: 'group',
  sub_type: 'normal',
  self_id: 12345,
  user_id: 23456,
  group_id: 34567,
  message_id: -123,
  message: [
    { type: 'at', data: { qq: '12345' } },
    { type: 'text', data: { text: '  你好  ' } },
  ],
  ...overrides,
})
const normalize = (e) => normalizeGroupMessage(e, identity, ['34567'])

test('normalizes real at segment into the shared core message including negative message IDs', () => {
  assert.deepEqual(normalize(event()), { platform: 'qq-onebot', botId: '12345', groupId: '34567', userId: '23456', messageId: '-123', text: '你好' })
  assert.equal(normalize(event({ self_id: '12345', user_id: '23456', group_id: '34567' })).botId, '12345')
})

test('ignores ordinary text, other/all mentions, private, self-sent, anonymous and media events', () => {
  for (const override of [
    { message: [{ type: 'text', data: { text: '@小助手 hi [CQ:at,qq=12345]' } }] },
    { message: [{ type: 'at', data: { qq: 'all' } }] },
    { message: [{ type: 'at', data: { qq: '23456' } }] },
    { message: '[CQ:at,qq=12345] hi' },
    { message_type: 'private' },
    { post_type: 'message_sent' },
    { user_id: 12345 },
    { self_id: 54321 },
    { sub_type: 'anonymous' },
    { anonymous: { id: 1 } },
    { group_id: 99999 },
    { message_id: null },
    { group_id: Number.MAX_SAFE_INTEGER + 1 },
    { message: [...event().message, { type: 'image', data: { file: 'anything' } }] },
  ])
    assert.equal(normalize(event(override)), null, JSON.stringify(override))
  assert.equal(normalizeGroupMessage(event(), identity, []), null)
})

test('at-only message reaches core help; reply references are ignored but not used as trigger', () => {
  assert.equal(normalize(event({ message: [{ type: 'at', data: { qq: '12345' } }] })).text, '')
  const segments = [{ type: 'reply', data: { id: '1' } }, ...event().message]
  assert.equal(normalize(event({ message: segments })).text, '你好')
  assert.equal(normalize(event({ message: [segments[0], { type: 'text', data: { text: 'hi' } }] })), null)
})

test('reply output is structured text and cannot inject CQ actions', () => {
  const params = groupReplyParams(normalize(event()), '[CQ:at,qq=all] hello')
  assert.deepEqual(params, {
    group_id: 34567,
    message: [{ type: 'text', data: { text: '[CQ:at,qq=all] hello' } }],
  })
})

test('group reply can explicitly retain the original message quote', () => {
  const params = groupReplyParams(normalize(event()), '[CQ:at,qq=all] hello', true)
  assert.deepEqual(params, {
    group_id: 34567,
    message: [
      { type: 'reply', data: { id: '-123' } },
      { type: 'text', data: { text: '[CQ:at,qq=all] hello' } },
    ],
  })
})

const privateEvent = (overrides = {}) =>
  event({
    message_type: 'private',
    sub_type: 'friend',
    group_id: undefined,
    message: [{ type: 'text', data: { text: '私聊' } }],
    ...overrides,
  })

test('private chat is opt-in, friend-only, and requires a user allowlist', async () => {
  const received = []
  const options = {
    groupAllowlist: ['34567'],
    handleMessage: async (m) => {
      received.push(m)
      return 'hello'
    },
    sendReply: async () => {},
  }
  const disabled = createOneBotMessageHandler(options)
  assert.equal(disabled.accept(privateEvent(), identity), false)
  const noAllowlist = createOneBotMessageHandler({ ...options, privateEnabled: true })
  assert.equal(noAllowlist.accept(privateEvent(), identity), false)
  const handler = createOneBotMessageHandler({ ...options, privateEnabled: true, privateAllowlist: ['23456'] })
  for (const override of [
    { user_id: 34567 },
    { user_id: 12345 },
    { self_id: 54321 },
    { sub_type: 'group' },
    { sub_type: 'other' },
    { sub_type: undefined },
    { post_type: 'message_sent' },
    { message_id: null },
    { user_id: 0 },
    { message: 'plain string' },
    { anonymous: { id: 1 } },
    { message: [{ type: 'image', data: { file: 'x' } }] },
    { message: [{ type: 'at', data: { qq: '12345' } }] },
  ])
    assert.equal(handler.accept(privateEvent(override), identity), false, JSON.stringify(override))
  assert.equal(handler.accept(privateEvent(), identity), true)
  assert.equal(handler.accept(privateEvent(), identity), false)
  await handler.drain()
  assert.equal(received.length, 1)
  assert.equal(received[0].text, '私聊')
  assert.equal(received[0].messageType, 'private')
  assert.equal(received[0].userId, '23456')
})

test('private dedup is isolated per user and from groups; quoted input needs no mention', async () => {
  const received = []
  const handler = createOneBotMessageHandler({
    groupAllowlist: ['34567'],
    privateEnabled: true,
    privateAllowlist: ['23456', '34567'],
    handleMessage: async (m) => {
      received.push(m)
      return 'hello'
    },
    sendReply: async () => {},
  })
  assert.equal(handler.accept(event(), identity), true)
  assert.equal(handler.accept(privateEvent(), identity), true)
  assert.equal(
    handler.accept(
      privateEvent({
        user_id: 34567,
        message: [
          { type: 'reply', data: { id: '99' } },
          { type: 'text', data: { text: '/help' } },
        ],
      }),
      identity,
    ),
    true,
  )
  await handler.drain()
  assert.equal(received.length, 3)
  assert.equal(received[2].text, '/help')
  assert.notEqual(received[0].groupId, received[1].groupId)
})

test('message handler deduplicates in-flight/delivered messages, bounds tasks, and closes admission', async () => {
  let release,
    calls = 0
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const sent = []
  const handler = createOneBotMessageHandler({
    groupAllowlist: ['34567'],
    maxPending: 1,
    handleMessage: async () => {
      calls++
      await wait
      return 'hello'
    },
    sendReply: async (message, text, origin) => sent.push({ message, text, origin }),
  })
  handler.accept(event(), identity)
  handler.accept(event(), identity)
  handler.accept(event({ message_id: 2 }), identity)
  release()
  await handler.drain()
  assert.equal(calls, 1)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].origin.generation, 1)
  handler.accept(event(), identity)
  handler.close()
  handler.accept(event({ message_id: 3 }), identity)
  await handler.drain()
  assert.equal(calls, 1)
})

test('failed send is not regenerated and dedup state survives transport reconnect', async () => {
  let calls = 0,
    errors = 0
  const handler = createOneBotMessageHandler({
    groupAllowlist: ['34567'],
    handleMessage: async () => {
      calls++
      return 'hello'
    },
    sendReply: async () => {
      throw new Error('send failed')
    },
    onError: () => {
      errors++
    },
  })
  handler.accept(event(), identity)
  await handler.drain()
  handler.accept(event(), { ...identity, generation: 2 })
  await handler.drain()
  assert.equal(calls, 1)
  assert.equal(errors, 1)
})
