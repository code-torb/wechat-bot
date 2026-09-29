import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeOneBotEvent } from './normalize.js'

const identity = { selfId: '12345', generation: 1 }

function event(overrides = {}) {
  return {
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    self_id: 12345,
    user_id: 23456,
    group_id: 34567,
    message_id: 99,
    message: [
      { type: 'at', data: { qq: '12345' } },
      { type: 'text', data: { text: '  你好  ' } },
    ],
    ...overrides,
  }
}

test('group message keeps mention flag and parsed text', () => {
  const message = normalizeOneBotEvent({ event: event(), identity, botAccountId: 'bot-a' })
  assert.equal(message.scene, 'group')
  assert.equal(message.peerId, '34567')
  assert.equal(message.senderId, '23456')
  assert.equal(message.mentionedSelf, true)
  assert.equal(message.text, '你好')
  assert.equal(message.botAccountId, 'bot-a')
})

test('group message without mention is still parsed for later trigger decision', () => {
  const message = normalizeOneBotEvent({
    event: event({ message: [{ type: 'text', data: { text: '小助手 帮我查天气' } }] }),
    identity,
    botAccountId: 'bot-a',
  })
  assert.equal(message.mentionedSelf, false)
  assert.equal(message.text, '小助手 帮我查天气')
})

test('private friend and non-friend subtypes are parsed with subtype preserved', () => {
  const friend = normalizeOneBotEvent({
    event: event({
      message_type: 'private',
      sub_type: 'friend',
      group_id: undefined,
      message: [{ type: 'text', data: { text: '私聊' } }],
    }),
    identity,
    botAccountId: 'bot-a',
  })
  assert.equal(friend.scene, 'private')
  assert.equal(friend.peerId, '23456')
  assert.equal(friend.privateSubtype, 'friend')
  const groupSubtype = normalizeOneBotEvent({
    event: event({
      message_type: 'private',
      sub_type: 'group',
      group_id: undefined,
      message: [{ type: 'text', data: { text: '临时会话' } }],
    }),
    identity,
    botAccountId: 'bot-a',
  })
  assert.equal(groupSubtype.privateSubtype, 'group')
})

test('self messages, media, anonymous and malformed events are ignored', () => {
  for (const override of [
    { user_id: 12345 },
    { self_id: 54321 },
    { anonymous: { id: 1 } },
    { message_type: 'group', message: [{ type: 'image', data: { file: 'x' } }] },
    { message_type: 'private', message: 'plain string' },
    { message_id: null },
    { post_type: 'message_sent' },
  ]) {
    assert.equal(normalizeOneBotEvent({ event: event(override), identity, botAccountId: 'bot-a' }), null, JSON.stringify(override))
  }
})
