import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPolicyEngine } from './policy.js'

test('capability matrix intersects agent, scene level and principal grants', () => {
  const engine = createPolicyEngine({ db: null })
  const grants = [{ capability: 'files.read', resourceId: 'notes' }]
  const check = (capability, resourceId = '', overrides = {}) =>
    engine.authorize({
      agentCapabilities: ['search.web', 'files.read'],
      sceneMaxLevel: overrides.sceneMaxLevel ?? 2,
      principalGrants: grants,
      resourceGrants: [{ resourceId: 'notes' }],
      capability,
      resourceId,
    })
  assert.equal(check('chat').allowed, true)
  assert.equal(check('files.read', 'notes').allowed, true)
  assert.equal(check('files.read', 'other').allowed, false)
  assert.equal(check('files.update', 'notes').allowed, false)
  assert.equal(check('files.read', 'notes', { sceneMaxLevel: 1 }).allowed, false)
  assert.equal(
    engine.authorize({
      agentCapabilities: [],
      sceneMaxLevel: 3,
      principalGrants: grants,
      resourceGrants: [{ resourceId: 'notes' }],
      capability: 'files.read',
      resourceId: 'notes',
    }).allowed,
    false,
  )
  assert.equal(
    engine.authorize({
      agentCapabilities: ['files.read'],
      sceneMaxLevel: 2,
      principalGrants: [],
      resourceGrants: [{ resourceId: 'notes' }],
      capability: 'files.read',
      resourceId: 'notes',
    }).reason,
    'principal_grant_missing',
  )
})
