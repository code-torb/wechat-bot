import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { createApprovalStore } from '../../src/management/approvals/store.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'approvals-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  return { db, approvals: createApprovalStore(db) }
}

function seedChain(db, toolRunId) {
  const now = Date.now()
  db.prepare(
    'INSERT INTO conversations (id, bot_account_id, scene, peer_id, sender_id, agent_id, current_epoch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('conv-1', 'bot-a', 'group', '34567', '23456', 'agent-a', now, now)
  db.prepare('INSERT INTO runs (id, event_key, conversation_id, epoch, status, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)').run(
    'run-1',
    'event-1',
    'conv-1',
    'waiting_approval',
    now,
    now,
  )
  db.prepare(
    'INSERT INTO tool_runs (id, run_id, call_id, name, resource_id, arguments_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(toolRunId, 'run-1', 'call-1', 'files.prepare_write', 'notes', '{}', 'pending_approval', now, now)
}

test('approval is pending, can be approved once and executed', (t) => {
  const { db, approvals } = fixture(t)
  seedChain(db, 'tool-run-1')
  const id = approvals.create({ toolRunId: 'tool-run-1', expectedFileHash: 'abc', contentHash: 'def', proposalRef: 'notes/readme.md' })
  assert.equal(approvals.get(id).status, 'pending')
  const decided = approvals.decide({ id, decision: 'approved', actor: 'owner-1' })
  assert.equal(decided.status, 'approved')
  assert.throws(() => approvals.decide({ id, decision: 'approved', actor: 'owner-1' }), /not pending/)
  approvals.markExecuted(id)
  assert.equal(approvals.get(id).status, 'executed')
})

test('expired and unknown approvals are rejected', (t) => {
  const { approvals, db } = fixture(t)
  seedChain(db, 'tool-run-2')
  const id = approvals.create({ toolRunId: 'tool-run-2', proposalRef: 'notes/x.md', ttlMs: 1 })
  db.prepare('UPDATE approvals SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, id)
  assert.throws(() => approvals.decide({ id, decision: 'approved', actor: 'owner-1' }), /expired/)
  assert.throws(() => approvals.decide({ id: 'missing', decision: 'approved', actor: 'owner-1' }), /not found/)
})
