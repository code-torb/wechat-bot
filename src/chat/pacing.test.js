import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateReplyDelay, resolvePacing, validatePacing } from './pacing.js'

test('length-based delay matches the design example', () => {
  const pacing = { baseDelayMs: 1500, charsPerSecond: 12, maxDelayMs: 12000 }
  assert.equal(calculateReplyDelay('字'.repeat(60), pacing), 6500)
  assert.equal(calculateReplyDelay('字'.repeat(200), pacing), 12000)
})

test('charsPerSecond zero keeps only the fixed delay', () => {
  assert.equal(calculateReplyDelay('字'.repeat(500), { baseDelayMs: 2000, charsPerSecond: 0, maxDelayMs: 15000 }), 2000)
})

test('explicit zero overrides inheritance with nullish coalescing', () => {
  const resolved = resolvePacing({
    system: { baseDelayMs: 1500, charsPerSecond: 12, maxDelayMs: 12000 },
    agent: {},
    scope: { baseDelayMs: 0, charsPerSecond: 0 },
  })
  assert.deepEqual(resolved, { baseDelayMs: 0, charsPerSecond: 0, maxDelayMs: 12000 })
})

test('invalid pacing combinations are rejected', () => {
  assert.throws(() => validatePacing({ baseDelayMs: 20000, charsPerSecond: 0, maxDelayMs: 12000 }), /maxDelayMs/)
  assert.throws(() => validatePacing({ baseDelayMs: 0, charsPerSecond: 201, maxDelayMs: 15000 }), /charsPerSecond/)
  assert.throws(() => validatePacing({ baseDelayMs: -1, charsPerSecond: 0, maxDelayMs: 15000 }), /baseDelayMs/)
  assert.equal(validatePacing(null), null)
})
