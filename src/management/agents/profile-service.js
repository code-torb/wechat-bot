import { randomUUID } from 'node:crypto'
import { decodeStory, parseStory } from './story-parser.js'

export const RELATIONS_TTL_MS = 12 * 60 * 60 * 1000
const MAX_KNOWLEDGE_CHARS = 1000000

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

function stripJsonFence(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function parseGraphJson(text) {
  const cleaned = stripJsonFence(text)
  if (!cleaned) return { persons: [], relations: [] }
  const parsed = JSON.parse(cleaned)
  return {
    persons: Array.isArray(parsed?.persons) ? parsed.persons : [],
    relations: Array.isArray(parsed?.relations) ? parsed.relations : [],
  }
}

function parseCharactersJson(text) {
  const cleaned = stripJsonFence(text)
  if (!cleaned) return []
  const parsed = JSON.parse(cleaned)
  return Array.isArray(parsed?.characters) ? parsed.characters : []
}

function parseCharacterCardJson(text) {
  const cleaned = stripJsonFence(text)
  if (!cleaned) return null
  const parsed = JSON.parse(cleaned)
  if (!parsed || typeof parsed !== 'object') return null
  return {
    name: typeof parsed.name === 'string' ? parsed.name : '',
    birthDate: typeof parsed.birthDate === 'string' ? parsed.birthDate : '',
    gender: typeof parsed.gender === 'string' ? parsed.gender : '',
    occupation: typeof parsed.occupation === 'string' ? parsed.occupation : '',
    hobbies: typeof parsed.hobbies === 'string' ? parsed.hobbies : '',
    background: typeof parsed.background === 'string' ? parsed.background : '',
  }
}

export function createAgentProfileService({ db, service, audit, complete, getModel, knowledge }) {
  function defaultModelConfig() {
    const row = db.prepare('SELECT * FROM models WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1').get()
    if (!row) return null
    const agent = db
      .prepare("SELECT draft_json FROM agents WHERE json_extract(draft_json, '$.model.name') != '' ORDER BY updated_at DESC LIMIT 1")
      .get()
    const modelName = agent ? JSON.parse(agent.draft_json).model.name : ''
    if (!modelName) return null
    return { modelRow: row, modelName }
  }

  async function storyComplete(messages) {
    if (!complete) throw new Error('model is not configured')
    const config = defaultModelConfig()
    if (!config) throw new Error('model is not configured')
    return complete({ model: config.modelRow, modelName: config.modelName, messages })
  }

  async function generateRelationDoc({ agentVersion, personName, relation }) {
    if (!complete || !getModel) throw new Error('model is not configured')
    const modelRow = getModel(agentVersion.model.modelId)
    if (!modelRow) throw new Error('model is unavailable')
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
      model: modelRow,
      modelName: agentVersion.model.name,
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

  async function writeGraphFromMaterial({ agentId, material, actorId }) {
    if (!complete) return { nodes: [], edges: [] }
    const result = await storyComplete([
      {
        role: 'system',
        content: '你负责从人物资料中抽取人物和人物关系，只输出 JSON，不输出其他内容。',
      },
      {
        role: 'user',
        content: `${material}\n\n请输出 JSON：{"persons":[{"name":"人物名","summary":"人物摘要","attributes":{}}],"relations":[{"source":"人物A","target":"人物B","type":"关系类型","description":"关系描述","boundary":"相处边界"}]}。要求：人物名必须来自资料原文；最多列出 10 个关键人物；关系 type 用简短词，如 丈夫、同事、朋友。`,
      },
    ])
    const graph = parseGraphJson(result?.text)
    const valid = new Set()
    for (const person of graph.persons) {
      if (typeof person?.name === 'string' && person.name && material.includes(person.name)) valid.add(person.name)
    }
    const now = Date.now()
    const upsertNode = db.prepare(
      `INSERT INTO character_nodes (id, agent_id, name, attributes_json, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, name) DO UPDATE SET attributes_json = excluded.attributes_json, summary = excluded.summary, updated_at = excluded.updated_at`,
    )
    const nodeId = (name) => db.prepare('SELECT id FROM character_nodes WHERE agent_id = ? AND name = ?').get(agentId, name)?.id
    db.transaction(() => {
      for (const person of graph.persons) {
        if (!valid.has(person?.name)) continue
        upsertNode.run(
          randomUUID(),
          agentId,
          person.name,
          JSON.stringify(person.attributes && typeof person.attributes === 'object' ? person.attributes : {}),
          typeof person.summary === 'string' ? person.summary : '',
          now,
          now,
        )
      }
      const upsertEdge = db.prepare(
        `INSERT INTO character_edges (id, agent_id, source_id, target_id, relation_type, description, boundary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, source_id, target_id) DO UPDATE SET relation_type = excluded.relation_type, description = excluded.description, boundary = excluded.boundary, updated_at = excluded.updated_at`,
      )
      for (const edge of graph.relations) {
        const source = edge?.source
        const target = edge?.target
        if (!valid.has(source) || !valid.has(target) || source === target) continue
        const sourceId = nodeId(source)
        const targetId = nodeId(target)
        if (!sourceId || !targetId) continue
        upsertEdge.run(
          randomUUID(),
          agentId,
          sourceId,
          targetId,
          typeof edge.type === 'string' ? edge.type : '',
          typeof edge.description === 'string' ? edge.description : '',
          typeof edge.boundary === 'string' ? edge.boundary : '',
          now,
          now,
        )
      }
    })()
    return graphRows(agentId)
  }

  async function extractGraph({ agentId }) {
    const agentVersion = service.getPublished(agentId)
    if (!agentVersion) return { nodes: [], edges: [] }
    const attributes = agentVersion.attributes || {}
    let docs = []
    if (knowledge) {
      try {
        docs = await knowledge.retrieve({ agentId, query: '人物关系和经历', topK: 3 })
      } catch {
        docs = []
      }
    }
    const material = [
      `主角：${attributes.name || ''}`,
      `角色基本信息：${JSON.stringify(attributes)}`,
      `背景故事：${(agentVersion.prompt || '').slice(0, 2000)}`,
      `知识库资料：${docs.map((doc) => `${doc.title}：${doc.content.slice(0, 800)}`).join('\n')}`,
    ].join('\n')
    return writeGraphFromMaterial({ agentId, material })
  }

  function graphRows(agentId) {
    const nodes = db
      .prepare('SELECT id, name, attributes_json, summary, updated_at FROM character_nodes WHERE agent_id = ? ORDER BY updated_at DESC')
      .all(agentId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        attributes: JSON.parse(row.attributes_json),
        summary: row.summary,
        updatedAt: row.updated_at,
      }))
    const nameById = new Map(nodes.map((node) => [node.id, node.name]))
    const edges = db
      .prepare('SELECT * FROM character_edges WHERE agent_id = ? ORDER BY updated_at DESC')
      .all(agentId)
      .map((row) => ({
        id: row.id,
        sourceName: nameById.get(row.source_id) || row.source_id,
        targetName: nameById.get(row.target_id) || row.target_id,
        relationType: row.relation_type,
        description: row.description,
        boundary: row.boundary,
        updatedAt: row.updated_at,
      }))
    return { nodes, edges }
  }

  return {
    listGraph(agentId) {
      return graphRows(agentId)
    },
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
      await extractGraph({ agentId }).catch(() => null)
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
      await extractGraph({ agentId }).catch(() => null)
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
    async analyzeStory({ dataBase64, fileName, nameHint }) {
      const text = decodeStory(dataBase64)
      let characters = []
      if (complete) {
        try {
          const result = await storyComplete([
            { role: 'system', content: '你是小说人物识别器，只输出 JSON，不输出其他内容。' },
            {
              role: 'user',
              content: `以下是小说开头：\n${text.slice(0, 6000)}\n\n请列出主要人物，最多 8 个，输出 JSON：{"characters":[{"name":"人物名","reason":"一句话说明角色分量"}]}。人物名必须来自原文。`,
            },
          ])
          characters = parseCharactersJson(result?.text)
            .filter((item) => typeof item?.name === 'string' && item.name && text.includes(item.name))
            .map((item) => ({ name: item.name.trim(), reason: typeof item.reason === 'string' ? item.reason : '' }))
        } catch {
          characters = []
        }
      }
      if (!characters.length) {
        const fallback = parseStory({ dataBase64, fileName, nameHint })
        if (fallback.name) characters = [{ name: fallback.name, reason: '由文本规则提取' }]
      }
      return { characters }
    },
    async createFromStory({ dataBase64, fileName, characterName, nameHint, actorId }) {
      const text = decodeStory(dataBase64)
      const chosen =
        typeof characterName === 'string' && characterName.trim() ? characterName.trim() : typeof nameHint === 'string' ? nameHint.trim() : ''
      let card = null
      if (complete && chosen) {
        try {
          const result = await storyComplete([
            { role: 'system', content: '你是小说人物提炼器，只输出 JSON，不输出其他内容。' },
            {
              role: 'user',
              content: `以下是小说原文开头：\n${text.slice(0, 30000)}\n\n请提炼小说人物“${chosen}”的角色卡，输出 JSON：{"name":"姓名","birthDate":"出生日期或空","gender":"性别或空","occupation":"职业或空","hobbies":"爱好或空","background":"按时间顺序串联该人物在小说中的一系列重要经历与事件，800-1500字，包含起因、经过与结果，使用第三人称"}。姓名必须与原文一致。`,
            },
          ])
          const parsedCard = parseCharacterCardJson(result?.text)
          card = parsedCard && (!parsedCard.name || !text.includes(parsedCard.name)) ? null : parsedCard
        } catch {
          card = null
        }
      }
      const parsed = parseStory({ dataBase64, fileName, nameHint: chosen })
      const name = card?.name || parsed.name || chosen || '小说角色'
      const background = card?.background || parsed.background
      const attributes = {
        name,
        birthDate: card?.birthDate || parsed.birthDate,
        gender: card?.gender || parsed.gender,
        occupation: card?.occupation || parsed.occupation,
        hobbies: card?.hobbies || parsed.hobbies,
      }
      const agent = service.create({ name, description: '由小说原文创建', actorId })
      service.updateDraft({
        agentId: agent.id,
        draft: { name, prompt: background, attributes },
        expectedRevision: 1,
        actorId,
      })
      const title = (fileName || '').replace(/\.(txt|TXT)$/, '') || '小说原文'
      const chars = Array.from(text)
      const knowledgeContent = chars.length > MAX_KNOWLEDGE_CHARS ? chars.slice(0, MAX_KNOWLEDGE_CHARS).join('') : text
      await this.addKnowledgeDoc({ agentId: agent.id, title, content: knowledgeContent, actorId })
      await writeGraphFromMaterial({
        agentId: agent.id,
        material: `主角：${name}\n提炼经历：${background}\n\n小说原文片段：\n${text.slice(0, 6000)}`,
        actorId,
      }).catch(() => null)
      auditAction(actorId, 'agent.create_from_story', agent.id)
      return service.get(agent.id)
    },
  }
}
