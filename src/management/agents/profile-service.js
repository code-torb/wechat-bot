import { randomUUID } from 'node:crypto'
import { parseStory } from './story-parser.js'

export const RELATIONS_TTL_MS = 12 * 60 * 60 * 1000
const MAX_KNOWLEDGE_CHARS = 20000

function serializeRelation(row) {
  return {
    id: row.id,
    personName: row.person_name,
    relation: JSON.parse(row.relation_json).description || '',
    contextDoc: row.context_doc,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }
}

function serializeKnowledge(row) {
  return {
    id: row.id,
    title: row.title,
    chars: Array.from(row.content).length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createAgentProfileService({ db, service, audit, complete, getCredential, getProvider, knowledge }) {
  async function generateRelationDoc({ agentVersion, personName, relation }) {
    if (!complete || !getCredential || !getProvider) throw new Error('model is not configured')
    const credentialRow = getCredential(agentVersion.model.credentialRef)
    const providerRow = getProvider(agentVersion.model.providerId)
    if (!credentialRow || !providerRow) throw new Error('model credential or provider is unavailable')
    const attributes = agentVersion.attributes || {}
    let docs = []
    if (knowledge) {
      try {
        const hits = await knowledge.retrieve({ agentId: agentVersion.id, query: personName, topK: 3 })
        docs = hits.map((hit) => ({ title: hit.title, content: hit.content }))
      } catch {
        docs = []
      }
    }
    if (!docs.length) {
      docs = db.prepare('SELECT title, content FROM agent_knowledge_docs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 3').all(agentVersion.id)
    }
    const info = [
      `角色基本信息：${JSON.stringify(attributes)}`,
      `背景故事：${(agentVersion.prompt || '').slice(0, 1500)}`,
      `知识库资料：${docs.map((doc) => `${doc.title}：${doc.content.slice(0, 600)}`).join('\n') || '无'}`,
      `现有关系简介：${relation || '无'}`,
    ].join('\n')
    const result = await complete({
      provider: { ...(providerRow || {}), modelName: agentVersion.model.name },
      credentialRow,
      messages: [
        { role: 'system', content: '你负责根据角色资料生成人物关系上下文文档，只输出正文，不输出标题和说明。' },
        {
          role: 'user',
          content: `${info}\n\n请用第三人称客观总结“${personName}”与主角的关系、该人物的背景，以及相处时需要注意的边界，300 字以内。`,
        },
      ],
    })
    const text = (result?.text || '').trim()
    if (!text) throw new Error('model returned an empty relation document')
    return text
  }

  function auditAction(actorId, action, agentId, resourceId = '') {
    if (!audit) return
    audit.record({
      actorType: 'admin',
      actorId: actorId || '',
      action,
      resourceType: 'agents',
      resourceId: agentId,
      traceId: resourceId || undefined,
    })
  }

  return {
    listRelations(agentId) {
      return db.prepare('SELECT * FROM agent_relations WHERE agent_id = ? ORDER BY created_at DESC').all(agentId).map(serializeRelation)
    },
    upsertRelation({ agentId, personName, relation, actorId }) {
      const name = typeof personName === 'string' ? personName.trim() : ''
      if (!name) throw new Error('person name is required')
      const now = Date.now()
      const existing = db.prepare('SELECT id FROM agent_relations WHERE agent_id = ? AND person_name = ?').get(agentId, name)
      if (existing) {
        db.prepare('UPDATE agent_relations SET relation_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify({ description: typeof relation === 'string' ? relation.trim() : '' }),
          now,
          existing.id,
        )
        auditAction(actorId, 'agent.relation_update', agentId, existing.id)
        return serializeRelation(db.prepare('SELECT * FROM agent_relations WHERE id = ?').get(existing.id))
      }
      const id = randomUUID()
      db.prepare(
        'INSERT INTO agent_relations (id, agent_id, person_name, relation_json, context_doc, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, agentId, name, JSON.stringify({ description: typeof relation === 'string' ? relation.trim() : '' }), '', now, now)
      auditAction(actorId, 'agent.relation_create', agentId, id)
      return serializeRelation(db.prepare('SELECT * FROM agent_relations WHERE id = ?').get(id))
    },
    updateRelation({ agentId, relationId, relation, actorId }) {
      const row = db.prepare('SELECT * FROM agent_relations WHERE id = ? AND agent_id = ?').get(relationId, agentId)
      if (!row) throw new Error('relation not found')
      db.prepare('UPDATE agent_relations SET relation_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify({ description: typeof relation === 'string' ? relation.trim() : '' }),
        Date.now(),
        relationId,
      )
      auditAction(actorId, 'agent.relation_update', agentId, relationId)
      return serializeRelation(db.prepare('SELECT * FROM agent_relations WHERE id = ?').get(relationId))
    },
    removeRelation({ agentId, relationId, actorId }) {
      db.prepare('DELETE FROM agent_relations WHERE id = ? AND agent_id = ?').run(relationId, agentId)
      auditAction(actorId, 'agent.relation_delete', agentId, relationId)
    },
    async refreshRelation({ agentId, relationId }) {
      const row = db.prepare('SELECT * FROM agent_relations WHERE id = ? AND agent_id = ?').get(relationId, agentId)
      if (!row) throw new Error('relation not found')
      const agentVersion = service.getPublished(agentId)
      if (!agentVersion) throw new Error('agent is not published')
      const contextDoc = await generateRelationDoc({
        agentVersion,
        personName: row.person_name,
        relation: JSON.parse(row.relation_json).description || '',
      })
      const now = Date.now()
      const result = db
        .prepare('UPDATE agent_relations SET context_doc = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
        .run(contextDoc, now, relationId, row.updated_at)
      if (result.changes !== 1) return null
      return serializeRelation(db.prepare('SELECT * FROM agent_relations WHERE id = ?').get(relationId))
    },
    async refreshAllRelations({ agentId, actorId }) {
      const rows = db.prepare('SELECT id FROM agent_relations WHERE agent_id = ?').all(agentId)
      let updated = 0
      for (const row of rows) {
        try {
          const refreshed = await this.refreshRelation({ agentId, relationId: row.id })
          if (refreshed) updated += 1
        } catch (error) {
          if (audit) {
            audit.record({
              actorType: 'admin',
              actorId: actorId || '',
              action: 'agent.relation_refresh',
              resourceType: 'agents',
              resourceId: agentId,
              traceId: row.id,
              result: 'error',
            })
          }
        }
      }
      return updated
    },
    async refreshStaleRelations({ agentId }) {
      const cutoff = Date.now() - RELATIONS_TTL_MS
      const rows = db.prepare('SELECT id FROM agent_relations WHERE agent_id = ? AND updated_at < ?').all(agentId, cutoff)
      let updated = 0
      for (const row of rows) {
        const refreshed = await this.refreshRelation({ agentId, relationId: row.id })
        if (refreshed) updated += 1
      }
      return updated
    },
    listKnowledgeDocs(agentId) {
      return db.prepare('SELECT * FROM agent_knowledge_docs WHERE agent_id = ? ORDER BY created_at DESC').all(agentId).map(serializeKnowledge)
    },
    async addKnowledgeDoc({ agentId, title, content, actorId }) {
      const cleanTitle = typeof title === 'string' ? title.trim() : ''
      const cleanContent = typeof content === 'string' ? content.trim() : ''
      if (!cleanTitle) throw new Error('title is required')
      if (!cleanContent) throw new Error('content is required')
      if (Array.from(cleanContent).length > MAX_KNOWLEDGE_CHARS) {
        throw new Error(`content exceeds ${MAX_KNOWLEDGE_CHARS} characters`)
      }
      const id = randomUUID()
      const now = Date.now()
      db.prepare('INSERT INTO agent_knowledge_docs (id, agent_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        agentId,
        cleanTitle,
        cleanContent,
        now,
        now,
      )
      if (knowledge) {
        await knowledge.indexDocument({ agentId, docId: id, title: cleanTitle, content: cleanContent })
      }
      auditAction(actorId, 'agent.knowledge_add', agentId, id)
      return serializeKnowledge(db.prepare('SELECT * FROM agent_knowledge_docs WHERE id = ?').get(id))
    },
    removeKnowledgeDoc({ agentId, docId, actorId }) {
      if (knowledge) knowledge.removeDocument({ docId })
      db.prepare('DELETE FROM agent_knowledge_docs WHERE id = ? AND agent_id = ?').run(docId, agentId)
      auditAction(actorId, 'agent.knowledge_delete', agentId, docId)
    },
    createFromStory({ dataBase64, fileName, nameHint, actorId }) {
      const parsed = parseStory({ dataBase64, fileName, nameHint })
      const agent = service.create({ name: parsed.name || '小说角色', description: '由小说原文创建', actorId })
      service.updateDraft({
        agentId: agent.id,
        draft: {
          name: parsed.name || '小说角色',
          prompt: parsed.background,
          attributes: {
            name: parsed.name,
            birthDate: parsed.birthDate,
            gender: parsed.gender,
            occupation: parsed.occupation,
            hobbies: parsed.hobbies,
          },
        },
        expectedRevision: 1,
        actorId,
      })
      auditAction(actorId, 'agent.create_from_story', agent.id)
      return service.get(agent.id)
    },
  }
}
