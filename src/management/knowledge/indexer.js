import { randomUUID } from 'node:crypto'

export function chunkText(text, size = 600, overlap = 120) {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  if (chars.length <= size) return chars.length ? [chars.join('')] : []
  const chunks = []
  const step = Math.max(size - overlap, 1)
  for (let start = 0; start < chars.length; start += step) {
    chunks.push(chars.slice(start, start + size).join(''))
  }
  return chunks
}

export function cosine(a, b) {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function createKnowledgeIndexer({ db, embedding }) {
  return {
    async indexDocument({ agentId, docId, title, content }) {
      const chunks = chunkText(content)
      if (!chunks.length) return 0
      let vectors = null
      if (embedding) {
        try {
          vectors = await embedding.embed(chunks)
        } catch {
          vectors = null
        }
      }
      const now = Date.now()
      const insert = db.prepare(
        'INSERT INTO knowledge_chunks (id, agent_id, doc_id, title, content, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      db.transaction(() => {
        for (let i = 0; i < chunks.length; i += 1) {
          insert.run(randomUUID(), agentId, docId, title, chunks[i], vectors ? Buffer.from(vectors[i].buffer) : null, now, now)
        }
      })()
      return chunks.length
    },
    removeDocument({ docId }) {
      db.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(docId)
    },
    async retrieve({ agentId, query, topK = 3 }) {
      if (!embedding || !query) return []
      const rows = db
        .prepare('SELECT id, title, content, embedding FROM knowledge_chunks WHERE agent_id = ? AND embedding IS NOT NULL ORDER BY created_at DESC')
        .all(agentId)
      if (!rows.length) return []
      let queryVector
      try {
        const vectors = await embedding.embed([query])
        queryVector = vectors[0]
      } catch {
        return []
      }
      return rows
        .map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          score: cosine(queryVector, new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, topK)
    },
  }
}
