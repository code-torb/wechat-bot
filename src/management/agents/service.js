import { randomUUID } from 'node:crypto'
import { createAgentRepository, ConflictError, ValidationError } from './repository.js'

function defaultDraft() {
  return {
    name: '',
    description: '',
    prompt: '',
    model: { providerId: '', credentialRef: '', name: '', supportsTools: false },
    styleValues: [],
    pacing: null,
    capabilities: [],
    searchMode: 'off',
    resourceGrants: [],
    commandRefs: [],
  }
}

function normalizeDraft(input) {
  const base = defaultDraft()
  const draft = { ...base, ...(input || {}) }
  if (typeof draft.name !== 'string' || !draft.name.trim()) throw new ValidationError('agent name is required')
  if (typeof draft.prompt !== 'string' || !draft.prompt.trim()) throw new ValidationError('agent prompt is required')
  if (!draft.model || typeof draft.model.providerId !== 'string' || !draft.model.providerId) {
    throw new ValidationError('agent model provider is required')
  }
  if (!draft.model.credentialRef || typeof draft.model.credentialRef !== 'string') throw new ValidationError('agent model credential is required')
  if (!draft.model.name || typeof draft.model.name !== 'string') throw new ValidationError('agent model name is required')
  if (!Array.isArray(draft.styleValues)) throw new ValidationError('styleValues must be an array')
  if (!Array.isArray(draft.capabilities)) throw new ValidationError('capabilities must be an array')
  return {
    name: draft.name.trim(),
    description: typeof draft.description === 'string' ? draft.description : '',
    prompt: draft.prompt,
    model: {
      providerId: draft.model.providerId,
      credentialRef: draft.model.credentialRef,
      name: draft.model.name,
      supportsTools: Boolean(draft.model.supportsTools),
    },
    styleValues: draft.styleValues,
    pacing: draft.pacing === null || draft.pacing === undefined ? null : draft.pacing,
    capabilities: draft.capabilities,
    searchMode: ['off', 'command', 'auto'].includes(draft.searchMode) ? draft.searchMode : 'off',
    resourceGrants: Array.isArray(draft.resourceGrants) ? draft.resourceGrants : [],
    commandRefs: Array.isArray(draft.commandRefs) ? draft.commandRefs : [],
  }
}

export function createAgentService({ db, audit }) {
  const repo = createAgentRepository(db)

  function validateModelRefs(draft) {
    const credential = db.prepare('SELECT id FROM credentials WHERE id = ? AND purpose = ? AND enabled = 1').get(draft.model.credentialRef, 'model')
    if (!credential) throw new ValidationError('model credential is missing, disabled or not a model credential')
    const provider = db.prepare('SELECT id FROM providers WHERE id = ? AND enabled = 1').get(draft.model.providerId)
    if (!provider) throw new ValidationError('model provider is missing or disabled')
  }

  function versionSnapshot(agent) {
    const draft = JSON.parse(agent.draft_json)
    return JSON.stringify({
      id: agent.id,
      versionId: agent.published_version_id || '',
      name: draft.name,
      description: draft.description,
      prompt: draft.prompt,
      model: draft.model,
      styleValues: draft.styleValues,
      pacing: draft.pacing,
      capabilities: draft.capabilities,
      searchMode: draft.searchMode,
      resourceGrants: draft.resourceGrants,
      commandRefs: draft.commandRefs,
    })
  }

  return {
    create({ name, description = '', actorId }) {
      const draft = {
        ...defaultDraft(),
        name: typeof name === 'string' ? name.trim() : '',
        description: typeof description === 'string' ? description : '',
      }
      if (!draft.name) throw new ValidationError('agent name is required')
      const agent = repo.insert({
        id: randomUUID(),
        name: draft.name,
        description: draft.description,
        status: 'draft',
        draftJson: JSON.stringify(draft),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      audit.record({
        actorType: 'admin',
        actorId: actorId || '',
        action: 'agent.create',
        resourceType: 'agents',
        resourceId: agent.id,
      })
      return repo.get(agent.id)
    },
    list({ status, cursor, limit } = {}) {
      return repo.list({ status, cursor, limit })
    },
    get(id) {
      return repo.get(id)
    },
    updateDraft({ agentId, draft, expectedRevision, actorId }) {
      const current = repo.get(agentId)
      if (!current) throw new ConflictError('agent not found')
      const normalized = normalizeDraft(draft)
      const updated = repo.updateDraft({ id: agentId, draftJson: JSON.stringify(normalized), expectedRevision, now: Date.now() })
      audit.record({
        actorType: 'admin',
        actorId: actorId || '',
        action: 'agent.draft_update',
        resourceType: 'agents',
        resourceId: agentId,
        beforeRevision: expectedRevision,
        afterRevision: updated.revision,
      })
      return updated
    },
    publish({ agentId, expectedRevision, actorId }) {
      const agent = repo.get(agentId)
      if (!agent) throw new ConflictError('agent not found')
      if (agent.revision !== expectedRevision) throw new ConflictError('agent was modified by another editor')
      if (agent.status === 'archived') throw new ValidationError('archived agents cannot be published')
      const draft = normalizeDraft(JSON.parse(agent.draft_json))
      validateModelRefs(draft)
      const now = Date.now()
      const versionNumber = repo.nextVersion(agentId)
      const versionId = randomUUID()
      db.transaction(() => {
        repo.insertVersion({
          id: versionId,
          agentId,
          version: versionNumber,
          snapshotJson: versionSnapshot({ ...agent, published_version_id: versionId }),
          actorId,
          createdAt: now,
        })
        repo.publishPointer({ agentId, versionId, now })
      })()
      audit.record({
        actorType: 'admin',
        actorId: actorId || '',
        action: 'agent.publish',
        resourceType: 'agents',
        resourceId: agentId,
        beforeRevision: expectedRevision,
        afterRevision: repo.get(agentId).revision,
      })
      return this.getPublished(agentId)
    },
    getPublished(agentId) {
      const agent = repo.get(agentId)
      if (!agent?.published_version_id) return null
      const version = repo.getVersion(agent.published_version_id)
      return JSON.parse(version.snapshot_json)
    },
    versions(agentId) {
      return repo.versions(agentId)
    },
    rollback({ agentId, versionId, expectedRevision, actorId }) {
      const agent = repo.get(agentId)
      if (!agent) throw new ConflictError('agent not found')
      if (agent.revision !== expectedRevision) throw new ConflictError('agent was modified by another editor')
      const source = repo.getVersion(versionId)
      if (!source || source.agent_id !== agentId) throw new ValidationError('version does not belong to this agent')
      const snapshot = JSON.parse(source.snapshot_json)
      const now = Date.now()
      const versionNumber = repo.nextVersion(agentId)
      const newVersionId = randomUUID()
      db.transaction(() => {
        repo.insertVersion({
          id: newVersionId,
          agentId,
          version: versionNumber,
          snapshotJson: JSON.stringify({ ...snapshot, versionId: newVersionId }),
          actorId,
          createdAt: now,
        })
        repo.publishPointer({ agentId, versionId: newVersionId, now })
      })()
      audit.record({
        actorType: 'admin',
        actorId: actorId || '',
        action: 'agent.rollback',
        resourceType: 'agents',
        resourceId: agentId,
        beforeRevision: expectedRevision,
        afterRevision: repo.get(agentId).revision,
      })
      return this.getPublished(agentId)
    },
    setStatus({ agentId, status, actorId }) {
      const agent = repo.get(agentId)
      if (!agent) throw new ConflictError('agent not found')
      const allowed = ['active', 'disabled', 'archived']
      if (!allowed.includes(status)) throw new ValidationError(`status must be one of ${allowed.join(', ')}`)
      const updated = repo.setStatus({ id: agentId, status, now: Date.now() })
      audit.record({
        actorType: 'admin',
        actorId: actorId || '',
        action: `agent.${status}`,
        resourceType: 'agents',
        resourceId: agentId,
        beforeRevision: agent.revision,
        afterRevision: updated.revision,
      })
      return updated
    },
    archive({ agentId, actorId }) {
      return this.setStatus({ agentId, status: 'archived', actorId })
    },
    remove({ agentId, actorId }) {
      const agent = repo.get(agentId)
      if (!agent) throw new ConflictError('agent not found')
      if (agent.published_version_id) throw new ValidationError('published agents must be archived first')
      if (repo.bindingCount(agentId) > 0) throw new ValidationError('agent is still bound to QQ routes')
      db.transaction(() => {
        db.prepare('DELETE FROM agent_style_values WHERE agent_id = ?').run(agentId)
        repo.hardDelete(agentId)
      })()
      audit.record({
        actorType: 'admin',
        actorId: actorId || '',
        action: 'agent.delete',
        resourceType: 'agents',
        resourceId: agentId,
      })
      return { id: agentId, deleted: true }
    },
  }
}
